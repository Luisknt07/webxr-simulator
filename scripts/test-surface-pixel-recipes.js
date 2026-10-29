'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const materialSchema=require('../shared/materials');
const source=fs.readFileSync(path.join(__dirname,'../src/editor/SurfaceMaterialSystem.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class SurfaceMaterialSystem','class SurfaceMaterialSystem');
const {SurfaceMaterialSystem,proceduralRecipeKey,proceduralBase,proceduralProperties,proceduralWear}=new Function('THREE','materialSchema',source+'\nreturn {SurfaceMaterialSystem,proceduralRecipeKey,proceduralBase,proceduralProperties,proceduralWear};')(THREE,materialSchema);
const factories={base:proceduralBase,properties:proceduralProperties,wear:proceduralWear},seen=new Map();
// Compare actual pixels, UV transforms and sampler settings across materials,
// wear types and repeats. No hash is used to authorize shared ownership.
for(const preset of ['steel','aluminum','paintedMetal','rubber','plastic','concrete','wood'])for(const wearType of ['scratches','chips','rust','dirt'])for(const repeats of [[1,1],[3,5]])for(const [kind,create]of Object.entries(factories)){
 const config=materialSchema.normalizeMaterial({preset,wearType,repeatX:repeats[0],repeatY:repeats[1],seed:19,wear:.2});
 const key=proceduralRecipeKey(kind,config,4),texture=create(config),previous=seen.get(key);
 if(previous){assert.deepEqual(texture.image.data,previous.image.data,'Canonical recipes must preserve every pixel.');for(const name of ['repeat','offset','center','matrix'])assert(texture[name].equals(previous[name]));for(const name of ['type','format','encoding','wrapS','wrapT','minFilter','magFilter','generateMipmaps'])assert.equal(texture[name],previous[name]);texture.dispose();}else seen.set(key,texture);
 assert.notEqual(proceduralRecipeKey(kind,{...config,seed:20},4),key,'Seeds must never collapse.');assert.notEqual(proceduralRecipeKey(kind,config,2),key,'Sampler limits remain independent.');
}
const root=new THREE.Group(),owners=[];
for(const preset of ['steel','aluminum']){const owner=new THREE.Group();owner.userData.editorBehaviors=[materialSchema.normalizeMaterial({preset,seed:19,wear:.2,wearType:'scratches'})];owner.add(new THREE.Mesh(new THREE.BoxBufferGeometry(),new THREE.MeshStandardMaterial()));root.add(owner);owners.push(owner);}
const doc={getRoot:()=>root,getObjects:()=>owners,getBehaviors:o=>o.userData.editorBehaviors};
(async()=>{const system=new SurfaceMaterialSystem({},doc,{});await system.sync('hall');const [a,b]=owners.map(o=>o.children[0].material);assert.notEqual(a,b);for(const name of ['map','roughnessMap','surfaceWearMap'])assert.equal(a[name],b[name]);assert.equal(system.proceduralPool.size,3);let disposed=0;a.map.addEventListener('dispose',()=>disposed++);owners[0].userData.editorBehaviors=[];system.invalidate();await system.sync('hall');assert.equal(disposed,0);system.dispose();assert.equal(disposed,1);assert.equal(system.proceduralPool.size,0);seen.forEach(t=>t.dispose());console.log('Lossless surface recipes: 168 generated maps compared byte-for-byte; independent editable materials, UV/sampler/seed distinctions and final-owner disposal passed.');})().catch(e=>{console.error(e);process.exitCode=1;});
