import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),load=require('../support/load-practice-scenes.cjs');
// This is the archived NEXUS appointment operation, not the newer physical
// CEDI-01 receiving curriculum. It keeps its native transaction regression but
// must never submit its documentary result to the current ten-practice ledger.
test('archived NEXUS L01 executes six native documentary transactions, rejects wrong fields and unimplemented automation',{timeout:30000},async()=>{
 const native=load();let passed=0,unavailable=0;
 for(const mode of ['manual','semiautomatic','automatic'])for(const caseId of ['A','B','C']){
  if(!native.recipes.availability('L01',mode).ready){assert.throws(()=>native.recipes.plan('L01',{mode,caseId}),/automatizada|automatiz|información|modalidad/i);unavailable++;continue;}
  const f=native.fixture();let controller;
  try{
   const built=native.buildPracticeScene(f.document,'hall','L01',{caseId,mode,difficulty:1,units:4,scene:f.scene});assert.equal(built.plan.kind,'documentary');assert.equal(built.manifest.expectedUnits,12);assert.equal(built.manifest.evidenceAdapter.context.expectedPallets,12);f.runtime.start('hall');
   assert.equal(built.plan.key,'nexus-practices-2026:L01');
   const editor={simulation:f.runtime,projectGeneration:1,currentProject:null,roomId:'hall',canEditDocument:()=>false};
   controller=new native.PracticeController(editor,built.manifest,{panel:false});
   const before=controller.snapshot();assert.equal(before.initialUnits,0);assert.equal(before.processedUnits,0);assert.equal(before.receiverUnits,0);assert.equal(f.runtime.sourceRuntime.entries.size,0);assert.equal(f.runtime.products.size,0);
   if(caseId==='C')assert(controller.perform('diagnose',{kind:built.plan.incidentKind}));
   for(const requirement of built.manifest.evidenceAdapter.requirements){
    assert(f.runtime.records.get(requirement.objectId)?.object.parent,'The evidence actor must be attached in the actual native runtime.');
    const completed=controller.session.done.length,values=Object.fromEntries(requirement.fields.map(field=>[field.key,field.expected])),field=requirement.fields[0],wrong={...values,[field.key]:field.type==='number'?field.expected+1:'WRONG-'+field.expected};
    assert.equal(controller.perform('record',{kind:requirement.eventId,objectId:requirement.objectId,values:wrong}),false,'Incorrect source values cannot become documentary evidence.');
    controller.perform('verify',{guard:requirement.guard});assert.equal(controller.session.done.length,completed,'Verification without the current native record cannot advance.');
    assert(controller.perform('record',{kind:requirement.eventId,objectId:requirement.objectId,values}),controller.lastMessage);controller.perform('verify',{guard:requirement.guard});assert.equal(controller.session.done.length,completed+1,controller.lastMessage);
   }
   await new Promise(resolve=>setImmediate(resolve));const result=controller.state().session;assert(result.passed,controller.lastMessage);assert.equal(result.completedSteps.length,6);assert(result.score>=75&&result.score<=100);assert.deepEqual(result.criticalReasons,[]);assert.equal(result.history.filter(row=>row.type==='step-completed').length,6);assert(result.history.some(row=>row.type==='attempt-rejected'));assert.equal(controller.state().campaign,null,'An archived source operation must not unlock the new curriculum.');
   const after=controller.snapshot();assert.equal(after.totalUnits,0);assert.equal(after.processedUnits,0);assert.equal(after.receiverUnits,0);assert.equal(after.documentaryEvidence.length,6);passed++;
  }finally{if(controller)controller.dispose();if(f.runtime.active)f.runtime.stop();native.releaseGeometry(f);}
 }
 assert.equal(passed,6);assert.equal(unavailable,3);
});
