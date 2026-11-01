import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createPart} from '../../packages/tools/anatomy/shared/model.mjs';
import {createTemplate} from '../../packages/tools/anatomy/shared/templates.mjs';
import {createModel,descriptors,exportFiles,normalizeMaterial} from '../../packages/tools/anatomy/adapter.mjs';
import {createContentProject,readContentProject} from '../../packages/project-format/index.js';
const require=createRequire(import.meta.url),cad=require('../../packages/tools/cad/schema/cad.js'),validation=require('../../apps/api/server/validation.js');

test('the native adapter produces real CAD inputs and can reopen a complete articulated assembly from independent parts',()=>{
 const original=createTemplate('robot'),built=descriptors(original,{assemblyId:'design-robot-test'});
 assert(built.parts.length>10);assert(built.stats.triangles<10000);
 const groupsById=new Map(original.groups.map(group=>[group.id,group]));
 for(const part of built.parts){assert.doesNotThrow(()=>cad.normalizeDescriptor(part.descriptor));assert.equal(part.descriptor.recipe.steps[0].op,'primitive.mesh');const source=part.descriptor.sourceData.document;assert.equal(source.parts.length,1);assert.equal(part.descriptor.mesh.positions.length,part.descriptor.recipe.steps[0].params.positions.length);const needed=new Set();let groupId=original.parts.find(row=>row.id===part.id).groupId;while(groupId){needed.add(groupId);groupId=groupsById.get(groupId).parentId;}assert.deepEqual(source.groups,original.groups.filter(group=>needed.has(group.id)),'A portable piece retains exactly its group and complete ancestor motion chain.');}
 const model=createModel({sources:built.parts.map(part=>part.descriptor.sourceData)});assert.deepEqual(model,built.model);
 const totalSource=JSON.stringify(built.parts.map(part=>part.descriptor.sourceData)).length;
 assert(totalSource<JSON.stringify(original).length*3,'The bridge must not duplicate the full model for every component.');
 const moved=structuredClone(original);moved.groups.find(group=>group.id==='upper-arm').motion.value=.35;moved.groups.find(group=>group.id==='forearm').motion.value=-.2;moved.groups.find(group=>group.id==='wrist').motion.value=.15;
 const posed=descriptors(moved,{assemblyId:'design-posed'}),reopened=createModel({sources:posed.parts.map(part=>part.descriptor.sourceData)});assert.deepEqual(reopened,posed.model,'Per-part motion chains reconstruct the complete nested assembly.');const rebuilt=descriptors(reopened,{assemblyId:'design-rebuilt'});assert.deepEqual(rebuilt.parts.map(({id,position,rotation})=>({id,position,rotation})),posed.parts.map(({id,position,rotation})=>({id,position,rotation})),'Reopening preserves the actual compiled articulated pose.');
 const before=JSON.stringify(original);built.parts[0].descriptor.mesh.positions[0]+=1;assert.equal(JSON.stringify(original),before);
});
test('existing object snapshots stay local and labels cannot become executable markup',()=>{
 const base=descriptors({name:'Safe source',parts:[createPart('box')]},{assemblyId:'design-source'}).parts[0];
 const model=createModel({selection:{name:'<machine>',parts:[{name:'<frame>',positions:base.descriptor.mesh.positions,material:{color:'#123456',metalness:.7,roughness:.3,opacity:1}}]}});
 assert.equal(model.name,'machine');assert.equal(model.parts[0].shape,'mesh');assert.equal(model.parts[0].name,'frame');assert.deepEqual(model.parts[0].position,[0,0,0]);assert.deepEqual(model.parts[0].rotation,[0,0,0]);
 assert.throws(()=>createModel({selection:{parts:[{positions:Array(9).fill(Infinity)}]}}));assert.throws(()=>normalizeMaterial({color:'javascript:alert(1)'}));assert.throws(()=>normalizeMaterial({shader:'evil'}));
});
test('parent-owned exports contain portable model data and a standalone non-executable SVG',()=>{
 const files=exportFiles(createTemplate('pump'));assert.equal(files.length,2);const json=files.find(file=>file.mime==='application/json'),svg=files.find(file=>file.mime==='image/svg+xml');
 assert.equal(JSON.parse(json.text).format,'smarttwin.anatomy');assert.match(svg.text,/<svg\b/);assert(!/<script\b|foreignObject|onload=|https?:\/\//i.test(svg.text.replace('http://www.w3.org/2000/svg','')));assert.match(json.name,/\.anatomy\.json$/);assert(!files.some(file=>file.mime==='text/html'));
});
test('Content preserves a legitimate near-60k-triangle rebuildable CAD assembly above the previous 1m-node ceiling',()=>{
 const model={name:'Dense but bounded',parts:Array.from({length:13},(_,i)=>createPart('torus',{id:'ring-'+i,position:[(i%4)*1,0,Math.floor(i/4)*1],parameters:{radius:.25,tubeRadius:.05,segments:48,tubeSegments:48}}))};
 const built=descriptors(model,{assemblyId:'design-dense'});assert(built.stats.triangles>55000&&built.stats.triangles<=60000);
 const saved={format:'hello-webxr-editor',version:1,imports:[],rooms:{hall:{overrides:[],additions:built.parts.map((part,i)=>({id:'custom-dense-'+i,name:part.name,descriptor:part.descriptor,interaction:{type:'none'},position:part.position,quaternion:[0,0,0,1],scale:[1,1,1],visible:true,behaviors:[]}))}}};
 assert.doesNotThrow(()=>validation.validateDocument(saved,value=>value));
 const restored=readContentProject(createContentProject(saved));assert.equal(restored.document.rooms.hall.additions.length,13);assert.deepEqual(restored.document.rooms.hall.additions[12].descriptor.mesh,saved.rooms.hall.additions[12].descriptor.mesh);assert.deepEqual(restored.document.rooms.hall.additions[0].descriptor.sourceData,saved.rooms.hall.additions[0].descriptor.sourceData);
});

test('larger scene budget retains default request limits and JSON security checks',()=>{
 const many=Array(500001).fill(0);
 assert.throws(()=>validation.safeTree(many),/complejo/);
 assert.doesNotThrow(()=>validation.safeDocumentTree(many));
 assert.throws(()=>validation.safeDocumentTree(Array(4000001).fill(0)),/complejo/);
 assert.throws(()=>validation.safeDocumentTree(JSON.parse('{"__proto__":{"polluted":true}}')),/permitida/);
 assert.throws(()=>validation.safeDocumentTree({coordinates:[NaN]}),/inválido/);
 assert.throws(()=>validation.safeDocumentTree({object:new Date()}),/JSON/);
});
