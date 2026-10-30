'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const source=fs.readFileSync(path.join(__dirname,'../IndustrialEnvironment.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function createIndustrialEnvironment','return function createIndustrialEnvironment');
const createEnvironment=new Function('THREE','industrialLighting','industrialSurfaces',source)(THREE,require('../../../packages/render-three/schema/industrial-lighting.js'),require('../../../packages/render-three/schema/industrial-surfaces.js')),schema=require('../../../modules/logistica-industrial/contracts/behaviors.js');
const previousDocument=global.document;let canvases=0;
global.document={createElement(type){assert.equal(type,'canvas');canvases++;return {getContext(){return {createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){}};}};}};
try{
 const scene=new THREE.Scene(),background=new THREE.Color('#123456'),fog=new THREE.Fog('#123456',10,30);scene.background=background;scene.fog=fog;
 const geometries=[],materials=[],entries=new Map(),objects=new Map(),settings=new Map();
 const primitive=(id,name,color,descriptor={type:'box'})=>{
  const object=new THREE.Group(),material=new THREE.MeshStandardMaterial({color}),geometry=new THREE.BoxBufferGeometry(),mesh=new THREE.Mesh(geometry,material);
  mesh.castShadow=true;object.name=name;object.add(mesh);scene.add(object);entries.set(id,{object,descriptor:Object.assign({color},descriptor)});objects.set(id,object);geometries.push(geometry);materials.push(material);return {object,mesh,material};
 };
 const floor=primitive('floor','RV · suelo continuo','#657071'),wall=primitive('wall','RV · pared posterior','#777e80'),roof=primitive('roof','RV · cubierta','#56636b');
 const machine=primitive('robot','Robot','#c86b29',{prefab:'robot'}),lamp=primitive('lamp','CEDI · RV luminaria LED de techo','#e1e1d7');
 const coating=Object.assign(schema.defaultBehavior('surfaceMaterial'),{color:'#657071',roughness:.97});settings.set(floor.object,[coating]);
 const emissive=Object.assign(schema.defaultBehavior('surfaceMaterial'),{color:'#dce7e7',emissiveMode:'custom',emissive:'#e9f2ec',emissiveIntensity:.75});settings.set(lamp.object,[emissive]);
 const originalFloor=floor.material.color.clone(),originalMachine=machine.material.color.clone(),listeners=new Map();
 const ctx={renderer:{toneMappingExposure:1,shadowMap:{enabled:false},domElement:{addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name,fn){assert.equal(listeners.get(name),fn);listeners.delete(name);}}},graphics:{getLimits:()=>({shadowMapSize:1024,xrShadowMapSize:512,pointLights:4})}};
 const studio={environments:[{roomId:'hall',sunIntensity:.6,ambientIntensity:.25,exposure:.87,shadows:true}],entities:[]};
 const doc={roomId:'hall',studio,additions:entries,getBehaviors:object=>settings.get(object)||[],getObject:id=>objects.get(id)};
 const saved=JSON.stringify(studio),lighting=createEnvironment(scene,doc,ctx),grain=floor.material.industrialDetailMap;let grainDisposals=0;grain.addEventListener('dispose',()=>grainDisposals++);
 assert.equal(scene.children.filter(object=>object.isLight).length,2);assert.equal(lighting.sun.intensity,1.10);assert.equal(lighting.stats.pointLights,0);assert.equal(ctx.renderer.toneMappingExposure,1);
 assert.equal(lighting.stats.profile,'industrial-neutral');assert.equal(lighting.stats.ambientIntensity,.55);
 assert(floor.material.color.equals(originalFloor.clone().convertSRGBToLinear()),'The public adapter must not treat authored sRGB gray as a linear diffuse color.');
 assert.equal(floor.material.roughness,.97);assert.equal(grain.image.width,512);assert.equal(grain.anisotropy,2);assert.equal(canvases,0);assert.equal(lighting.stats.surfaceDetail.textures,2);
 assert(machine.material.color.equals(originalMachine),'Prefab materials already own their color space.');
 assert(lamp.material.emissive.equals(new THREE.Color(emissive.emissive).convertSRGBToLinear()));assert.equal(lamp.material.emissiveIntensity,.75);
 assert(!wall.mesh.castShadow&&!roof.mesh.castShadow&&!floor.mesh.castShadow);assert(machine.mesh.castShadow);assert(wall.mesh.receiveShadow&&roof.mesh.receiveShadow);
 const linearColor=floor.material.color.clone();for(let i=0;i<30;i++)lighting.sync();assert(floor.material.color.equals(linearColor));assert.equal(lighting.stats.surfaceDetail.allocations,2,'Idle frames reuse the two shared packed maps.');
 let mapDisposals=0;lighting.sun.shadow.map={dispose(){mapDisposals++;}};ctx.vrMode=true;lighting.sync();assert.equal(lighting.sun.shadow.mapSize.x,512);assert.equal(mapDisposals,1);assert.equal(lighting.stats.shadowMapSize,512);
 lighting.sun.shadow.map={dispose(){mapDisposals++;}};listeners.get('webglcontextlost')();assert.equal(mapDisposals,2);listeners.get('webglcontextrestored')();assert.equal(ctx.renderer.shadowMap.needsUpdate,true);
 lighting.dispose();lighting.dispose();assert.equal(grainDisposals,1);assert.equal(listeners.size,0);assert.equal(scene.background,background);assert.equal(scene.fog,fog);assert.equal(ctx.renderer.toneMappingExposure,1);assert.equal(ctx.renderer.shadowMap.enabled,false);
 assert(floor.material.color.equals(originalFloor));assert.equal(floor.material.map,null);assert.equal(floor.material.userData.studioColorSpace,undefined);assert.equal(JSON.stringify(studio),saved);assert(wall.mesh.castShadow&&roof.mesh.castShadow);
 // Optional authored point lights use a bounded shader budget, never six-face shadows.
 const entities=[];for(let i=0;i<6;i++){const marker=primitive('light-'+i,'Luz '+i,'#ffffff');marker.object.position.x=i;entities.push({roomId:'hall',type:'pointLight',id:'lamp-'+i,objectId:'light-'+i,color:'#ffffff',intensity:.35,range:12});}
 studio.entities=entities;studio.environments[0].shadows=false;let budget=4;ctx.graphics.getLimits=()=>({shadowMapSize:512,xrShadowMapSize:512,pointLights:budget});
 const other=createEnvironment(scene,doc,ctx);assert.equal(other.stats.pointLights,4);assert.equal(other.stats.shadowMaps,0);assert.equal(other.stats.shadowMapSize,0);assert(scene.children.filter(object=>object.isPointLight).every(light=>!light.castShadow));
 budget=2;other.sync();assert.equal(other.stats.pointLights,2);other.dispose();assert.equal(scene.children.filter(object=>object.isLight).length,0);assert(materials.every(material=>material.visible));
 geometries.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());
 console.log('Industrial public lighting: authored linear surfaces, matte floor, emissive fixtures, non-casting shell, bounded XR shadows/point lights, no idle rebuild and complete cleanup passed.');
}finally{if(previousDocument===undefined)delete global.document;else global.document=previousDocument;}
