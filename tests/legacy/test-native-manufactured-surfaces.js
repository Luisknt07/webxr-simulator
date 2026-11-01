'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const root=path.resolve(__dirname,'../..'),read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const pbr=require('../../modules/logistica-industrial/functions/presentacion/schema/industrial-pbr.js');
const Pool=new Function('THREE','pbr',read('modules/logistica-industrial/functions/presentacion/runtime/IndustrialPBRTextures.js').replace('default class IndustrialPBRTextures','return class IndustrialPBRTextures'))(THREE,pbr);
const Finish=new Function('THREE','DecalGeometry','pbr','IndustrialPBRTextures','makeStickerAtlas','stickerTile',read('modules/logistica-industrial/functions/presentacion/runtime/IndustrialFinishSystem.js').replace('default class IndustrialFinishSystem','return class IndustrialFinishSystem'))(THREE,null,pbr,Pool,()=>{throw Error('No decals expected.');},()=>{});
const smooth=new Function('THREE',read('modules/logistica-industrial/functions/montacargas/runtime/VehicleDetailGeometry.js')+'\nreturn manufacturedNormals;')(THREE);
const factory=require('../support/load-vehicle-prefabs.js')(THREE),vehicles=require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles.js');
const buffer=attribute=>Buffer.from(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength);
function topology(object){let triangles=0,draws=0;object.traverse(node=>{if(!node.isMesh)return;draws++;triangles+=(node.geometry.index?node.geometry.index.count:node.geometry.attributes.position.count)/3*(node.isInstancedMesh?node.count:1);});return{triangles,draws};}

// Smoothing is strictly appearance. It must not close a fork entry, alter a
// contact surface, blur a real ninety-degree fold, or add a triangle.
for(const geometry of [new THREE.BoxBufferGeometry(.7,.4,.9).toNonIndexed(),new THREE.TorusBufferGeometry(.4,.08,8,20).toNonIndexed()]){
 const positions=Buffer.from(buffer(geometry.attributes.position)),uv=Buffer.from(buffer(geometry.attributes.uv)),normals=geometry.attributes.normal.array.slice(),count=geometry.attributes.position.count,groups=JSON.stringify(geometry.groups);
 smooth(geometry);assert.deepEqual(buffer(geometry.attributes.position),positions);assert.deepEqual(buffer(geometry.attributes.uv),uv);assert.equal(geometry.attributes.position.count,count);assert.equal(JSON.stringify(geometry.groups),groups);
 const n=geometry.attributes.normal;for(let i=0;i<n.count;i++)assert(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-6);
 if(geometry.type==='BoxBufferGeometry')assert.deepEqual(n.array,normals,'Folded flat faces retain their sharp 90-degree corners.');
}

async function run(){
 const object=factory.createVehicle(vehicles.defaults('forklift-electric-4w')),native=object.userData.vehicleRig.resources.materials,physical=topology(object),beforeColors=new Map(Object.values(native).map(m=>[m,m.color.clone()]));
 assert(native.frame.roughness<.42&&native.frame.metalness<.25);assert(native.steel.metalness>.75);assert(native.forkSteel.roughness===.36);
 const ground=new THREE.Group();ground.add(object);object.userData.editorPrefabKey='vehicle';const ctx={graphics:{getLimits:()=>({tier:'balanced',textureEdge:512})},renderer:{capabilities:{getMaxAnisotropy:()=>4}}},doc={getRoot:()=>ground};
 const requests=[],system=new Finish(ctx,doc,{load:url=>{requests.push(url);return Promise.resolve({width:512,height:512,src:url});}});
 const original={map:native.frame.map,bump:native.frame.bumpMap,roughness:native.frame.roughness,metalness:native.frame.metalness};
 system.sync('hall',1);await Promise.all([...system.store.entries.values()].map(entry=>entry.ready));system.sync('hall',1);
 assert.strictEqual(native.frame.map,original.map,'Original factory coating must remain visible.');assert.strictEqual(native.frame.bumpMap,original.bump);assert.equal(native.frame.normalMap,null);assert.equal(native.frame.roughness,original.roughness);assert.equal(native.frame.metalness,original.metalness);assert(!requests.some(url=>/\/paint-/.test(url)),'Native paint must not download the chipped paint preset.');
 assert(native.steel.normalMap,'Machined metal still receives its independent shared detail.');assert(native.rubber.normalMap);assert(native.seat.normalMap);assert.deepEqual(topology(object),physical);beforeColors.forEach((color,m)=>assert(m.color.equals(color)));
 // An explicit per-part worn material remains an authoring choice and cannot
 // be silently converted into the factory default by the automatic layer.
 const authored=new THREE.MeshStandardMaterial({color:'#776644',roughness:.85,metalness:.05});authored.userData={industrialManufacturedFinish:true,surfaceMaterialBinding:true,industrialMaterialRole:'frame'};authored.map=new THREE.Texture();const mesh=new THREE.Mesh(new THREE.BoxBufferGeometry(),authored);object.add(mesh);const authoredMap=authored.map;system.sync('hall',1);assert.strictEqual(authored.map,authoredMap);assert.equal(authored.roughness,.85);
 system.dispose();assert.strictEqual(native.frame.map,original.map);assert.equal(native.steel.normalMap,null);
 console.log('Native manufactured surfaces: unchanged contact geometry and folds, clean factory paint, distinct steel/rubber/vinyl, no chipped default or authored-material overwrite, bounded shared maps and cleanup passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
