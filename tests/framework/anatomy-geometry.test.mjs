import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {SHAPES,SHAPE_DEFINITIONS,createPart,normalizeModel,MODEL_LIMITS} from '../../packages/tools/anatomy/shared/model.mjs';
import {compileModel,transformPoint} from '../../packages/tools/anatomy/shared/geometry.mjs';
import {TEMPLATES,createTemplate} from '../../packages/tools/anatomy/shared/templates.mjs';
import {createContentProject,readContentProject} from '../../packages/project-format/index.js';
const require=createRequire(import.meta.url),THREE=require('three'),cad=require('../../packages/tools/cad/schema/cad.js'),engine=require('../../packages/tools/cad/schema/cad-engine.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const close=(a,b,epsilon=1e-8)=>assert(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
function topology(positions){
 const edges=new Map();let volume=0;const key=p=>p.map(n=>Math.round(n*1e8)).join(',');
 for(let i=0;i<positions.length;i+=9){const a=positions.slice(i,i+3),b=positions.slice(i+3,i+6),c=positions.slice(i+6,i+9);volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;const points=[a,b,c].map(key);for(let j=0;j<3;j++){const from=points[j],to=points[(j+1)%3],k=[from,to].sort().join('|'),edge=edges.get(k)||{count:0,orientation:0};edge.count++;edge.orientation+=from<to?1:-1;edges.set(k,edge);}}
 assert([...edges.values()].every(edge=>edge.count===2&&edge.orientation===0),'Every procedural edge has exactly two opposite faces.');assert(volume>0,'The mesh has outward winding and encloses positive volume.');return volume;
}
const documentFor=part=>({name:'Anatomy test',parts:[part]});
test('all native shapes compile to closed outward Y-up meshes, deterministic local coordinates and detached data',()=>{
 assert.equal(SHAPES.length,10);assert.deepEqual(SHAPE_DEFINITIONS.map(row=>row.id),SHAPES);
 for(const shape of SHAPES){const input=documentFor(createPart(shape)),before=clone(input),compiled=compileModel(input);assert.deepEqual(input,before);assert(compiled.stats.triangles>0&&compiled.stats.triangles<60000);assert(compiled.parts[0].positions.every(Number.isFinite));topology(compiled.parts[0].positions);assert.deepEqual(compiled,compileModel(input));compiled.model.parts[0].position[0]=17;assert.equal(input.parts[0].position[0],0);}
 const b=compileModel(documentFor(createPart('box',{parameters:{width:.8,height:.4,depth:.6}})));close(topology(b.parts[0].positions),.8*.4*.6);assert.deepEqual(b.stats.bounds,[[-.4,-.2,-.3],[.4,.2,.3]]);
});
test('concave profile caps, tapered lathe axis closure and curved tubes retain geometry rather than placeholders',()=>{
 const profile=[[0,0],[1,0],[1,.5],[.5,.5],[.5,1],[0,1]],result=compileModel(documentFor(createPart('extrude',{parameters:{profile,height:.4}})));close(topology(result.parts[0].positions),.75*.4);assert.deepEqual(result.stats.bounds,[[0,0,0],[1,.4,1]]);
 const cone=compileModel(documentFor(createPart('lathe',{parameters:{profile:[[0,-.3],[.2,0],[0,.3]],segments:32}})));topology(cone.parts[0].positions);assert.equal(cone.parts[0].bounds[0][1],-.3);assert.equal(cone.parts[0].bounds[1][1],.3);
 const tube=compileModel(documentFor(createPart('tube',{parameters:{path:[[0,0,0],[.2,.3,0],[.3,.6,.2],[.1,.8,.4]],radius:.03}})));topology(tube.parts[0].positions);assert(tube.stats.bounds[1][2]>.4);
 assert.throws(()=>compileModel(documentFor(createPart('extrude',{parameters:{profile:[[0,0],[1,1],[0,1],[1,0]],height:.3}}))),/crosses|area/);
 assert.throws(()=>compileModel(documentFor(createPart('tube',{parameters:{path:[[0,0,0],[0,1,0],[0,0,0]],radius:.03}}))),/tangent|reverses/);
});
test('part-local coordinates are transformed once and Euler XYZ agrees with the actual Three r112 API',()=>{
 const position=[1,2,-3],rotation=[.31,-.72,.44],input=documentFor(createPart('box',{position,rotation,explode:[.4,1,.2]})),compiled=compileModel(input),plain=compileModel(documentFor(createPart('box')));
 assert.deepEqual(compiled.parts[0].positions,plain.parts[0].positions,'Editing a transform never rebakes the geometry.');
 const matrix=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation,'XYZ'));matrix.setPosition(new THREE.Vector3(...position));
 for(const point of [[.3,.2,.1],[-.25,.14,-.17],[0,0,0]]){const expected=new THREE.Vector3(...point).applyMatrix4(matrix).toArray();transformPoint(point,position,rotation).forEach((value,index)=>close(value,expected[index]));}
 assert.deepEqual(compiled.model.parts[0].explode,[.4,1,.2]);assert.equal(compiled.model.view.explode,0);
});
test('nested hinge and slide groups resolve real compiled poses while preserving editable rest data',()=>{
 const model={parts:[createPart('box',{id:'member',position:[2,0,0],rotation:[.2,.3,.1],groupId:'slide'})],groups:[{id:'hinge',name:'Parent hinge',motion:{type:'hinge',axis:[0,0,1],pivot:[1,0,0],min:0,max:Math.PI,value:Math.PI/2}},{id:'slide',name:'Child slide',parentId:'hinge',motion:{type:'slide',axis:[1,0,0],pivot:[0,0,0],min:0,max:1,value:.5}}]};
 const before=clone(model),compiled=compileModel(model),part=compiled.parts[0];assert.deepEqual(model,before);assert.deepEqual(compiled.model.parts[0].position,[2,0,0]);part.position.forEach((v,i)=>close(v,[1,1.5,0][i]));assert.deepEqual(part.material,compiled.model.parts[0].material);
 const hinge=new THREE.Matrix4().makeTranslation(1,0,0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI/2)).multiply(new THREE.Matrix4().makeTranslation(-1,0,0)),slide=new THREE.Matrix4().makeTranslation(.5,0,0),rest=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(.2,.3,.1,'XYZ')).setPosition(new THREE.Vector3(2,0,0)),expected=hinge.multiply(slide).multiply(rest);
 for(const point of [[.3,.2,-.2],[-.3,-.2,.2]])transformPoint(point,part.position,part.rotation).forEach((v,i)=>close(v,new THREE.Vector3(...point).applyMatrix4(expected).getComponent(i)));
 const zero=clone(model);zero.groups.forEach(group=>{group.motion.value=0;});const resting=compileModel(zero);assert.deepEqual(resting.parts[0].position,[2,0,0]);assert.deepEqual(resting.parts[0].positions,part.positions);assert.notDeepEqual(resting.stats.bounds,compiled.stats.bounds);
});
test('seven reusable industrial designs contain independent detailed pieces within mobile geometry budgets',()=>{
 assert.equal(TEMPLATES.length,7);for(const template of TEMPLATES){const model=createTemplate(template.id),compiled=compileModel(model);assert(compiled.parts.length>=12&&compiled.parts.length<=96,template.id);assert(compiled.stats.triangles<10000,template.id);assert.equal(new Set(compiled.parts.map(part=>part.id)).size,compiled.parts.length);for(const part of compiled.parts)topology(part.positions);const next=createTemplate(template.id);model.parts[0].name='changed';assert.notEqual(next.parts[0].name,'changed');}
 const rack=createTemplate('rack');assert(rack.parts.some(part=>part.name.includes('Pallet A01')));const forks=createTemplate('forklift').parts.filter(part=>part.name.includes('Uña de inserción'));assert.equal(forks.length,2);assert(forks.every(part=>part.material.metalness>.8));assert.equal(createTemplate('flow-cell').view.projection,'top');assert.throws(()=>createTemplate('__proto__'),/unknown/);
});
test('model validation rejects executable/prototype payloads, nonfinite values, invalid links and aggregate budgets',()=>{
 const base=()=>documentFor(createPart('box'));
 for(const patch of [{code:'alert(1)'},{units:'cm'},{version:2},{view:{mode:'script'}},{parts:[]},{parts:Array.from({length:97},(_,i)=>createPart('box',{id:'part-'+i}))}])assert.throws(()=>normalizeModel({...base(),...patch}));
 assert.throws(()=>normalizeModel(Object.assign(Object.create({unsafe:true}),base())));
 let called=false;const getter={...base()};Object.defineProperty(getter,'name',{enumerable:true,get(){called=true;return 'unsafe';}});assert.throws(()=>normalizeModel(getter));assert.equal(called,false);
 for(const n of [NaN,Infinity,-Infinity,'1',null]){const value=base();value.parts[0].parameters.width=n;assert.throws(()=>normalizeModel(value));}
 for(const patch of [{segments:49},{radius:-1},{radius:0},{profile:[[.2,1],[.1,0]]}])assert.throws(()=>normalizeModel(documentFor(createPart(patch.profile?'lathe':'cylinder',{parameters:patch}))));
 const bad=base();bad.parts[0].groupId='missing';assert.throws(()=>normalizeModel(bad),/missing/);
 bad.groups=[{id:'a',name:'A',parentId:'b'},{id:'b',name:'B',parentId:'a'}];delete bad.parts[0].groupId;assert.throws(()=>normalizeModel(bad),/cyclic/);
 const polluted=JSON.parse(JSON.stringify(base()).replace('"width":0.6','"__proto__":{},"width":0.6'));assert.throws(()=>normalizeModel(polluted));assert.equal({}.unsafe,undefined);
 assert.throws(()=>compileModel({parts:Array.from({length:MODEL_LIMITS.parts},(_,i)=>createPart('sphere',{id:'part-'+i,parameters:{segments:48}}))}),/60000/);
 assert.throws(()=>compileModel(documentFor(createPart('box',{position:[100,0,0]}))),/100 m/);
 assert.throws(()=>compileModel(documentFor(createPart('mesh',{parameters:{positions:Array(9).fill(0)}}))),/surface/);
});
function descriptor(part,model){return {type:'cad',recipe:{version:1,steps:[{id:'s1',op:'primitive.mesh',params:{positions:part.positions},inputs:[]}],output:'s1'},mesh:{positions:part.positions},color:part.material.color,smoothingAngle:45,sourceData:{tool:'anatomy',version:1,assemblyId:'assembly-test',partId:part.id,document:{...model,parts:model.parts.filter(row=>row.id===part.id)}}};}
test('generic CAD mesh is the real reconstructible input, preserves Y-up coordinates and source metadata is inert',()=>{
 const compiled=compileModel(documentFor(createPart('lathe'))),part=compiled.parts[0],d=descriptor(part,compiled.model),result=engine.compile(d.recipe);
 assert.deepEqual(result.mesh.positions,part.positions);close(result.stats.volume,topology(part.positions));assert.deepEqual(cad.normalizeDescriptor(d),d);assert.equal(result.recipe.steps[0].op,'primitive.mesh');
 const imported=clone(d);imported.sourceData.document.parts[0].name='Changed later';assert.notEqual(cad.normalizeDescriptor(d).sourceData.document.parts[0].name,imported.sourceData.document.parts[0].name);
 for(const positions of [[0,0,0],Array(9).fill(0),Array(9).fill(NaN),Array(9).fill(101),Array(60000*9+9).fill(0)])assert.throws(()=>cad.normalizeRecipe({steps:[{id:'s1',op:'primitive.mesh',params:{positions},inputs:[]}]}));
 assert.throws(()=>cad.normalizeRecipe({steps:[{id:'s1',op:'solid.box',params:{positions:part.positions},inputs:[]}]}));
 for(const sourceData of [{...d.sourceData,script:'evil()'},{...d.sourceData,document:{x:Infinity}},{...d.sourceData,document:Object.create({x:1})},{...d.sourceData,document:JSON.parse('{"__proto__":{"polluted":true}}')}])assert.throws(()=>cad.normalizeDescriptor({...d,sourceData}));
 const deep={};let pointer=deep;for(let i=0;i<25;i++)pointer=pointer.next={};assert.throws(()=>cad.normalizeDescriptor({...d,sourceData:{...d.sourceData,document:deep}}),/límite/);
});
test('actual SceneDocument one-undo insertion, geometry updates, API validation and portable Content preserve source and independent parts',async()=>{
 const schema=require('../../modules/logistica-industrial/contracts/behaviors.js'),source=readFileSync(new URL('../../packages/project-model/src/SceneDocument.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class SceneDocument','return class SceneDocument');
 const Document=new Function('THREE','behaviorSchema','createIndustrialPrefab','require',source)(THREE,schema,()=>{throw Error('This fixture inserts CAD only.');},path=>{assert.equal(path,'../../tools/cad/schema/cad');return cad;});
 const setup=()=>{const doc=new Document({});doc.registerRoom('hall',new THREE.Group());return doc;};
 const doc=setup(),compiled=compileModel({name:'Editable pair',parts:[createPart('box',{id:'case',position:[.5,.4,0]}),createPart('cylinder',{id:'shaft',position:[-.5,.3,0]})]});
 doc.begin();const objects=compiled.parts.map(part=>{const object=doc.addCAD('hall',descriptor(part,compiled.model));doc.rename(object,part.name);doc.setTransform(object,{position:part.position,quaternion:new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation)).toArray()});return object;});doc.setStudio({groups:[{id:'anatomy-test',name:'Editable assembly',roomId:'hall',members:objects.map(object=>object.userData.editorId)}]});doc.commit();assert.equal(doc.undoStack.length,1);assert.equal(doc.getObjects('hall').length,2);
 const saved=await doc.serialize();assert.doesNotThrow(()=>require('../../apps/api/server/validation.js').validateDocument(saved,value=>value));assert.deepEqual(readContentProject(createContentProject(saved)).document,saved);
 const restored=setup();await restored.load(saved);assert.deepEqual(await restored.serialize(),saved);assert(restored.getObject(objects[0].userData.editorId).children[0].geometry.isBufferGeometry);
 doc.undo();assert.equal(doc.getObjects('hall').length,0);doc.redo();assert.deepEqual(await doc.serialize(),saved);
 const object=doc.getObject(objects[0].userData.editorId),other=doc.getObject(objects[1].userData.editorId),otherGeometry=other.children[0].geometry,updated=compileModel(documentFor(createPart('box',{id:'case',parameters:{width:.9}}))),before=object.children[0].geometry;let disposed=0;before.addEventListener('dispose',()=>disposed++);doc.updateCAD(object,descriptor(updated.parts[0],updated.model));assert.equal(disposed,1);assert.equal(other.children[0].geometry,otherGeometry);assert.deepEqual(object.position.toArray(),[.5,.4,0]);doc.undo();assert.deepEqual(await doc.serialize(),saved);
});
