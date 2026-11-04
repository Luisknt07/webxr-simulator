import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),THREE=require('three'),cad=require('../../packages/tools/cad/schema/cad.js'),engine=require('../../packages/tools/cad/schema/cad-engine.js'),validation=require('../../apps/api/server/validation.js');
const triangle=[0,0,0,.123456789,0,0,0,.234567891,0];
const descriptor=positions=>({type:'cad',recipe:{version:1,steps:[{id:'s1',op:'primitive.mesh',params:{positions},inputs:[]}],output:'s1'},mesh:{positions},color:'#abcdef',smoothingAngle:35});
const raw=values=>{const bytes=Buffer.alloc(values.length*4);values.forEach((value,i)=>bytes.writeFloatLE(value,i*4));return{encoding:'float32-le-base64',count:values.length,data:bytes.toString('base64')};};

test('legacy editable arrays remain exact; optional compact positions match the actual Float32 GPU coordinates and little-endian bytes',()=>{
 assert.deepEqual(cad.normalizePositions(triangle),triangle);assert.deepEqual(cad.normalizeDescriptor(descriptor(triangle)),descriptor(triangle));
 const encoded=cad.encodePositions(triangle);assert.deepEqual(encoded,raw(triangle));assert.deepEqual(cad.normalizePositions(encoded),Array.from(new Float32Array(triangle)));assert.deepEqual(cad.normalizeDescriptor(descriptor(encoded)),descriptor(encoded));assert.deepEqual(cad.encodePositions(encoded),encoded);
 const detached=cad.normalizeDescriptor(descriptor(encoded));detached.mesh.positions.count=18;assert.equal(encoded.count,9);assert.equal(cad.normalizePositions(encoded).length,9);
});

test('the real CAD engine rebuilds a compact baked mesh with the same topology and GPU positions rather than a proxy shape',()=>{
 const cube=engine.compile({steps:[{id:'s1',op:'solid.box',params:{width:.37,height:.29,depth:.23},inputs:[]}]}),encoded=cad.encodePositions(cube.mesh.positions),rebuilt=engine.compile(descriptor(encoded).recipe);
 assert.equal(rebuilt.stats.triangles,cube.stats.triangles);assert.deepEqual(Array.from(new Float32Array(rebuilt.mesh.positions)),Array.from(new Float32Array(cube.mesh.positions)));assert(Math.abs(rebuilt.stats.volume-cube.stats.volume)<1e-8);assert.deepEqual(rebuilt.recipe.steps[0].params.positions,encoded);
});

test('encoding metadata, padding, length, ranges, nonfinite bytes, degenerate surfaces and existing triangle caps stay strict',()=>{
 const encoded=cad.encodePositions(triangle),bad=[null,{}, {...encoded,count:8},{...encoded,count:cad.MAX_TRIANGLES*9+9},{...encoded,count:Infinity},{...encoded,encoding:'float64'},{...encoded,data:encoded.data.slice(4)},{...encoded,data:' '.repeat(encoded.data.length)},{...encoded,data:encoded.data.slice(0,-1)+'-'},{...encoded,script:'run()'},Object.assign(Object.create({x:1}),encoded),raw(Array(9).fill(0)),raw([0,0,0,Infinity,0,0,0,1,0]),raw([0,0,0,NaN,0,0,0,1,0]),raw([0,0,0,101,0,0,0,1,0])];
 for(const value of bad){assert.throws(()=>cad.normalizePositions(value));assert.throws(()=>cad.normalizeDescriptor(descriptor(value)));}
 let called=false;const getter={...encoded};Object.defineProperty(getter,'data',{enumerable:true,get(){called=true;return encoded.data;}});assert.throws(()=>cad.normalizePositions(getter));assert.equal(called,false);
 const padded=cad.encodePositions(triangle.concat(triangle,triangle));assert(padded.data.endsWith('==')===false,'The codec uses padding only when actual bytes require it.');
 const two=raw(triangle.concat(triangle));assert(two.data.endsWith('==')===false);
 // Nine float coordinates are 36 bytes. Eighteen and twenty-seven are also
 // divisible by three, so the CAD triangle format admits no padding at all.
 assert.throws(()=>cad.normalizePositions({...encoded,data:encoded.data.slice(0,-2)+'=='}));
 const max=Array.from({length:cad.MAX_TRIANGLES*9},(_,i)=>triangle[i%9]),packed=cad.encodePositions(max);assert.equal(cad.normalizePositions(packed).length,cad.MAX_TRIANGLES*9);assert.throws(()=>cad.encodePositions(max.concat(triangle)));
});

test('actual SceneDocument add/save/load/undo/API validation retain compact descriptors and exact visible triangles',async()=>{
 const schema=require('../../modules/logistica-industrial/contracts/behaviors.js'),source=readFileSync(new URL('../../packages/project-model/src/SceneDocument.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class SceneDocument','return class SceneDocument'),Document=new Function('THREE','behaviorSchema','createIndustrialPrefab','require',source)(THREE,schema,()=>{throw Error('CAD fixture only.');},specifier=>{assert.equal(specifier,'../../tools/cad/schema/cad');return cad;}),setup=()=>{const doc=new Document({});doc.registerRoom('hall',new THREE.Group());return doc;};
 const cube=engine.compile({steps:[{id:'s1',op:'solid.box',params:{width:.4,height:.3,depth:.2},inputs:[]}]}),encoded=cad.encodePositions(cube.mesh.positions),doc=setup(),object=doc.addCAD('hall',descriptor(encoded)),geometry=object.children[0].geometry;
 assert.deepEqual(Array.from(geometry.attributes.position.array),Array.from(new Float32Array(cube.mesh.positions)));assert.equal(geometry.attributes.normal.count,geometry.attributes.position.count);assert.equal(geometry.attributes.uv.count,geometry.attributes.position.count);
 const originalPose=object.position.toArray();doc.setTransform(object,{position:[2,.15,-1]});doc.getRoot('hall').updateMatrixWorld(true);const hit=new THREE.Raycaster(new THREE.Vector3(2,2,-1),new THREE.Vector3(0,-1,0),0,3).intersectObject(object,true);assert(hit.length);assert(Math.abs(hit[0].point.y-.3)<1e-6);
 const saved=await doc.serialize(),validated=validation.validateDocument(saved,value=>value),restored=setup();assert.deepEqual(saved.rooms.hall.additions[0].descriptor.mesh.positions,encoded);await restored.load(validated);assert.deepEqual(await restored.serialize(),saved);assert.deepEqual(Array.from(restored.getObjects('hall')[0].children[0].geometry.attributes.position.array),Array.from(geometry.attributes.position.array));
 doc.undo();assert.deepEqual(object.position.toArray(),originalPose);doc.undo();assert.equal(doc.getObjects('hall').length,0);doc.redo();assert.deepEqual(doc.getObjects('hall')[0].userData.editorDescriptor.mesh.positions,encoded);
});

test('large static CAD scenes fit the existing document complexity guard without changing its limit or dropping any triangle',()=>{
 const positions=Array.from({length:30000*9},(_,i)=>Math.fround(triangle[i%9]+.100001+Math.floor(i/9)*.000001)),encoded=cad.encodePositions(positions),record=(id,p)=>({id:'custom-codec-'+id,name:'Static body '+id,descriptor:descriptor(p),position:[0,0,0],quaternion:[0,0,0,1],scale:[1,1,1],visible:true}),scene=positions=>({format:'hello-webxr-editor',version:1,imports:[],rooms:{hall:{overrides:[],additions:Array.from({length:8},(_,i)=>record(i,positions))}}});
 const original=scene(positions);assert.throws(()=>validation.safeDocumentTree(original),/complejo/);const compact=scene(encoded);assert.doesNotThrow(()=>validation.safeDocumentTree(compact));const saved=validation.validateDocument(compact,value=>value);assert.equal(saved.rooms.hall.additions.length,8);for(const row of saved.rooms.hall.additions){assert.equal(row.descriptor.mesh.positions.count,positions.length);assert.deepEqual(row.descriptor.mesh.positions,encoded);assert.deepEqual(row.descriptor.recipe.steps[0].params.positions,encoded);}assert(JSON.stringify(compact).length<JSON.stringify(original).length/2);
});
