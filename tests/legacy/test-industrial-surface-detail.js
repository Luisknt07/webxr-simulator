'use strict';
const assert=require('node:assert/strict'),THREE=require('three');
const detail=require('../../packages/render-three/schema/industrial-surfaces.js');
const fixture=()=>{
 const scene=new THREE.Scene(),root=new THREE.Group();scene.add(root);const entries=new Map(),settings=new Map();
 const add=(id,name,color,position,scale,rotation=0)=>{const mesh=new THREE.Mesh(new THREE.BoxBufferGeometry(),new THREE.MeshStandardMaterial({color,roughness:.96})),owner=new THREE.Group();owner.name=name;owner.add(mesh);owner.position.fromArray(position);owner.scale.fromArray(scale);owner.rotation.y=rotation;root.add(owner);entries.set(id,{roomId:'hall',object:owner,descriptor:{type:'box',color}});settings.set(owner,[{type:'surfaceMaterial',enabled:true,preset:'custom',color,texture:'',normalMap:'',roughnessMap:'',metalnessMap:'',colorMapMode:'none',overrides:[]}]);return {owner,mesh};};
 const floor=add('floor','CEDI · RV suelo continuo','#657071',[0,-.06,0],[22,.12,18]);
 const walls=[add('a','CEDI · RV pared frontal','#777e80',[0,3,9],[22,6,.18]),add('b','CEDI · RV pared posterior','#777e80',[0,3,-9],[22,6,.18]),add('c','CEDI · RV pared lateral','#777e80',[11,3,0],[18,6,.18],Math.PI/2),add('d','CEDI · RV pared lateral','#777e80',[-11,3,0],[18,6,.18],Math.PI/2)];
 const doc={additions:entries,getRoot:()=>root,getBehaviors:object=>settings.get(object)||[]};return{scene,root,doc,settings,floor,walls};
};
const f=fixture(),adapter=new detail.Detail(THREE),before=f.walls.map(w=>({material:w.mesh.material,geometry:w.mesh.geometry,compile:w.mesh.material.onBeforeCompile,defines:w.mesh.material.defines,extensions:w.mesh.material.extensions}));
adapter.sync(f.doc,'hall',true,1);assert.equal(adapter.stats.textures,2);assert.equal(adapter.stats.materials,5);assert(adapter.stats.bytes<=3*1024*1024);
assert(f.floor.mesh.material.industrialDetailMap);const wallMap=f.walls[0].mesh.material.industrialDetailMap;
assert(f.walls.every(w=>w.mesh.material.industrialDetailMap===wallMap),'All four walls share immutable pixels, not one copy per orientation.');
for(const texture of adapter.maps.values()){
 assert.equal(texture.image.width,512);assert.equal(texture.image.height,512);assert.equal(texture.minFilter,THREE.LinearMipmapLinearFilter);assert.equal(texture.anisotropy,2);assert(texture.generateMipmaps);
 const bytes=texture.image.data;let sum=0,sum2=0,min=255,max=0,alphaMin=255,alphaMax=0;
 for(let i=0;i<bytes.length;i+=4){const value=bytes[i];sum+=value;sum2+=value*value;min=Math.min(min,value);max=Math.max(max,value);alphaMin=Math.min(alphaMin,bytes[i+3]);alphaMax=Math.max(alphaMax,bytes[i+3]);}
 const n=bytes.length/4,variance=sum2/n-(sum/n)**2;assert(variance>25,'Pigment variation must be visible beyond a flat gray grain.');assert(max-min>40);assert(alphaMax-alphaMin>35,'Broken wear/staining has spatially distinct regions.');
}
assert.deepEqual(detail.uvAt('floor',[8,0,4],[0,1,0]),[2,1]);
assert.deepEqual(detail.uvAt('wall',[8,2,4],[0,0,1]),[2,.5]);assert.deepEqual(detail.uvAt('wall',[8,2,4],[1,0,0]),[1,.5]);
assert.deepEqual(detail.uvAt('wall',[8,2,4],[-1,0,0]),[1,.5],'Both side walls preserve metres, without borrowing a long box UV.');
const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
f.walls[0].mesh.material.onBeforeCompile(shader,{});assert(shader.vertexShader.includes('instanceMatrix * industrialLocal'));assert(shader.fragmentShader.includes('industrialPosition.zy'));assert(shader.fragmentShader.includes('dFdx(industrialUv)'));assert(shader.uniforms.industrialDetailMap.value===wallMap);assert.equal(shader.uniforms.industrialFloorY.value,0);
for(let i=0;i<500;i++)adapter.sync(f.doc,'hall',true,1);assert.equal(adapter.stats.allocations,2);assert.equal(adapter.stats.scans,1,'Idle frames do not repeatedly traverse/rebuild surfaces.');
f.walls.forEach((w,i)=>{assert.equal(w.mesh.material,before[i].material);assert.equal(w.mesh.geometry,before[i].geometry);});
// A real user map/colour overrides the automatic recipe and releases its binding.
f.settings.get(f.walls[0].owner)[0].texture='my-wall.jpg';adapter.sync(f.doc,'hall',true,2);assert.equal(f.walls[0].mesh.material.onBeforeCompile,before[0].compile);assert.equal(f.walls[0].mesh.material.industrialDetailMap,undefined);
const held=[...adapter.maps.values()],released=new Set();held.forEach(t=>t.addEventListener('dispose',()=>released.add(t)));adapter.sync(f.doc,'hall',false,3);assert.equal(released.size,2);assert.equal(adapter.stats.textures,0);
f.walls.forEach((w,i)=>{assert.equal(w.mesh.material.onBeforeCompile,before[i].compile);assert.equal(w.mesh.material.defines,before[i].defines);assert.equal(w.mesh.material.extensions,before[i].extensions);assert.equal(w.mesh.material.industrialDetailMap,undefined);});
adapter.dispose();f.root.traverse(n=>{if(n.geometry)n.geometry.dispose();if(n.material)n.material.dispose();});
console.log('Industrial surface detail: four wall orientations/metres, visible seeded wear/relief, two mipmapped shared maps, cached idle work, authored overrides, original geometry and complete restoration passed.');
