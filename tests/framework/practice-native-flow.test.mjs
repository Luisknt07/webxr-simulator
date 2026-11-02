import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const actorId=object=>object.userData.editorId;
const sourceIds=(runtime,ids)=>ids.map(id=>runtime.records.get(id));

test('all 64 source outcomes remain present when the source stores several result paragraphs',()=>{
 const recipes=require('../../modules/logistica-industrial/practices/schema/PracticeRecipes.cjs'),source=require('../../modules/logistica-industrial/practices/data/practice-index.cjs');
 assert.equal(source.entries.length,64);
 for(const row of source.entries){const plan=recipes.plan(row.id,{mode:'manual'});assert(Array.isArray(row.result)&&row.result.length>0);assert.equal(plan.result,row.result.join('\n'),row.id+' must retain every expected-result paragraph.');assert(plan.result.trim().length>30,row.id+' cannot show an empty expected outcome.');}
});

function custody(runtime){
 const owners=new Map();
 const add=(entry,record)=>{if(!entry)return;const previous=owners.get(entry.id);assert(!previous,'A material entry cannot occupy two native custody queues: '+entry.id+' / '+previous+' / '+record.id);owners.set(entry.id,record.id);if(record.components.conveyor)assert.equal(entry.product.item.beltId,record.id,'The actual belt package owns the entry during transport.');else assert.equal(entry.ownerId,record.id,'Native owner ID must match the actual custody queue.');};
 for(const record of runtime.records.values()){
  const c=record.components;
  if(c.source)(c.source.queue||[]).forEach(entry=>add(entry,record));
  if(c.processor){(c.processor.input.queue||[]).forEach(entry=>add(entry,record));(c.processor.output.queue||[]).forEach(entry=>add(entry,record));(c.processor.jobs||[]).forEach(job=>(job.inputs||[]).forEach(entry=>add(entry,record)));}
  if(c.palletQueue)(c.palletQueue.queue||[]).forEach(entry=>add(entry,record));
  if(c.robot&&c.robot.entry)add(c.robot.entry,record);
  if(c.vehicle&&c.vehicle.entry)add(c.vehicle.entry,record);
  if(c.conveyor)(c.conveyor.packages||[]).forEach(item=>{const product=item.product||runtime.products.get(item.id);if(product&&product.sourceEntry)add(product.sourceEntry,record);});
 }
 return owners;
}

test('every enabled automatic material practice completes its finite native lot without duplicate custody or fabricated receiver counters',()=>{
 const native=require('../support/load-practice-scenes.cjs')(),results=[];
 const plans=native.recipes.list().filter(row=>native.recipes.availability(row.id,'automatic').ready).map(row=>native.recipes.plan(row.id,{mode:'automatic',units:4})).filter(plan=>plan.kind==='flow'||plan.kind==='robot');
 assert(plans.length>=20,'This is coverage of the enabled material operations, not one generic example.');
 for(const plan of plans){
  const f=native.fixture();
  try{
   const built=native.buildPracticeScene(f.document,'hall',plan.id,{mode:'automatic',units:4,scene:f.scene});f.scene.updateMatrixWorld(true);f.runtime.start('hall');
   let received=0;
   for(let elapsed=0;elapsed<150;elapsed++){
    native.advance(f,1);custody(f.runtime);
    received=sourceIds(f.runtime,built.receiverIds).reduce((sum,record)=>sum+(record.components.palletQueue.receivedUnits||0),0);
    if(received>=built.expectedUnits)break;
   }
   assert.equal(received,built.expectedUnits,plan.id+' must deliver the declared finite lot through its real ports.');
   for(const record of sourceIds(f.runtime,built.sourceIds)){assert.equal(record.components.source.generatedUnits,plan.units,plan.id+' must not regenerate a successful lot.');assert.equal(record.components.source.config.autoGenerate,false);}
   for(const record of sourceIds(f.runtime,built.processIds)){assert(record.components.processor.completedUnits>=plan.units,plan.id+' must pass through every actual process stage.');}
   assert.equal(f.notices.length,0,plan.id+' cannot hide a contact/support rejection: '+f.notices.join('; '));
   results.push({id:plan.id,mode:plan.mode,received,processStages:built.processIds.length,actualLinks:built.links.length,simulationSeconds:f.runtime.time});
  }finally{native.releaseGeometry(f);}
 }
 fs.mkdirSync(new URL('../../data/qa-studio/practice-fidelity/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../../data/qa-studio/practice-fidelity/native-flow-regression.json',import.meta.url),JSON.stringify(results,null,2));
});

test('balance and two-family changeover require the native three-stage line to deliver before documentary closure',()=>{
 const native=require('../support/load-practice-scenes.cjs')();
 for(const id of ['I28','I29']){
  const f=native.fixture();
  try{
   const built=native.buildPracticeScene(f.document,'hall',id,{mode:'semiautomatic',units:4,scene:f.scene});assert.equal(built.processIds.length,3);assert.deepEqual(built.manifest.nativeActions,['feed','cycle','dispatch']);
   assert.deepEqual(built.manifest.evidenceAdapter.requirements[5].observe,{component:'world',path:'receiverUnits',minimum:4});
   const spec=JSON.parse(f.document.getBehaviors(built.source).find(row=>row.type==='source').catalog);if(id==='I29'){assert.equal(spec.length,2);assert.notEqual(spec[0].id,spec[1].id);assert.notEqual(spec[0].width,spec[1].width);for(const objectId of built.processIds)assert.equal(f.document.getBehaviors(f.document.getObject(objectId)).find(row=>row.type==='processor').setupPolicy,'productChange');}
   f.scene.updateMatrixWorld(true);f.runtime.start('hall');let received=0;
   for(let elapsed=0;elapsed<150;elapsed++){
    for(const record of sourceIds(f.runtime,built.sourceIds))f.runtime.sourceRuntime.command(record,'dispatch');
    for(const record of sourceIds(f.runtime,built.processIds)){f.runtime.setVariable(record.id,'operatorAvailable',true);f.runtime.sourceRuntime.dispatch(record,record.components.processor.output);}
    native.advance(f,1);custody(f.runtime);received=f.runtime.records.get(actorId(built.receiver)).components.palletQueue.receivedUnits;if(received>=4)break;
   }
   assert.equal(received,4,id+' must execute native feed/cycle/dispatch before recording a successful balance/changeover.');assert.equal(f.notices.length,0);
  }finally{native.releaseGeometry(f);}
 }
});

test('source mappings, tool whitelist and connected process settings survive the real document save/reopen path',async()=>{
 const native=require('../support/load-practice-scenes.cjs')();
 for(const id of ['L01','L12','I23','I29']){
  const authored=native.fixture(),reopened=native.fixture();
  try{
   const built=native.buildPracticeScene(authored.document,'hall',id,{mode:'manual',units:4,scene:authored.scene}),saved=native.validateDocument(await authored.document.serialize(),value=>value);
   await reopened.document.load(saved);const manifest=reopened.document.studio.moduleData['sector.logistics-industrial'].levels.find(row=>row.practiceId===id);
   assert.deepEqual(manifest,built.manifest,'Persisted source/actual layout and operational adapter are authoritative.');
   for(const row of manifest.layoutElements){const object=reopened.document.getObject(row.objectId);assert(object&&object.parent,'Saved native source element remains addressable.');assert.deepEqual(object.position.toArray(),row.actualPosition);}
   if(id==='I23'){assert.equal(manifest.toolOptions.length,3);assert.equal(manifest.requiredToolId,'equipment.tool.three-finger');const robot=reopened.document.getObject(manifest.robotIds[0]);assert.equal(reopened.document.getBehaviors(robot).find(row=>row.type==='robot').catalogueToolId,'equipment.tool.parallel-gripper');}
   reopened.scene.updateMatrixWorld(true);reopened.runtime.start('hall');native.advance(reopened,.1);
   for(const objectId of manifest.sourceIds.concat(manifest.processIds,manifest.receiverIds))assert(reopened.runtime.records.has(objectId),'Native runtime must recognize the saved actor.');
  }finally{native.releaseGeometry(authored);native.releaseGeometry(reopened);}
 }
});
