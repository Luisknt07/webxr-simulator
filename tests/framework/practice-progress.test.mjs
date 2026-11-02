import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),progress=require('../../modules/logistica-industrial/practices/schema/PracticeProgress.cjs'),schema=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(id='CEDI-01',extra={}){
 const config=schema.normalizeConfig({practiceId:id,roomId:'hall',sourceId:'source',processIds:['machine'],receiverId:'stock',expectedUnits:4,sku:'QA',steps:schema.GUARDS.map(guard=>({id:id+'-'+guard,title:guard,guard})),...extra});
 const world={sourceUnits:4,processedUnits:0,receiverUnits:0,totalUnits:4,initialUnits:4,time:0,selectedSku:'',identified:false,prepared:false,documentValidated:false,destinationConfirmed:false,blocked:false,paused:false,emergency:false,faultInjected:config.caseId==='C',faultRecovered:false};const session=new schema.PracticeSession(config,{snapshot:()=>world});
 return{config,world,session};
}
function finish(f){for(const guard of schema.GUARDS){f.world.time++;Object.assign(f.world,{faultRecovered:true});if(guard==='identify')Object.assign(f.world,{selectedSku:'QA',identified:true});if(guard==='prepare')f.world.prepared=true;if(guard==='operate')Object.assign(f.world,{sourceUnits:0,processedUnits:4});if(guard==='inspect')f.world.documentValidated=true;if(guard==='deliver')Object.assign(f.world,{receiverUnits:4,destinationConfirmed:true});assert(f.session.act(guard,{sku:'QA'}).accepted,guard);}return progress.receipt(f.config,f.session,{attemptId:'server-attempt-'+f.config.practiceId});}
test('campaign routes start independently and only a verified prefix can unlock the next operation',()=>{
 let p=progress.empty('alice');assert.equal(progress.ROUTES.length,2);assert.equal(progress.ROUTES.reduce((n,r)=>n+r.practiceIds.length,0),10);assert(progress.access(p,'CEDI-01').allowed);assert(progress.access(p,'SF-01').allowed);assert(!progress.access(p,'CEDI-02').allowed);assert.equal(progress.access(p,'CEDI-02').prerequisite,'CEDI-01');assert(progress.access(p,'CEDI-05',{author:true}).allowed);
 assert.throws(()=>progress.mergeCompletion(p,finish(fixture('CEDI-02')),{userId:'alice'}),/CEDI-01/);p=progress.mergeCompletion(p,finish(fixture()),{userId:'alice'});assert(progress.access(p,'CEDI-02').allowed);assert(!progress.access(p,'CEDI-03').allowed);assert(!progress.access(p,'SF-02').allowed);assert.equal(p.routes.cedi.completed.length,1);
});
test('pure receipt replay preserves its modality without requiring duplicate variants; native capability validation belongs to the host',()=>{
 for(const mode of ['manual','semiautomatic','automatic'])for(const caseId of ['A','B','C']){const receipt=finish(fixture('CEDI-01',{mode,caseId,difficulty:3})),one=progress.mergeCompletion(progress.empty('alice'),receipt,{userId:'alice'}),twice=progress.mergeCompletion(one,receipt,{userId:'alice'});assert.deepEqual(twice,one);assert(progress.access(one,'CEDI-02').allowed);assert.equal(one.routes.cedi.completed[0].mode,mode);}
});
test('progress and receipts cannot be carried between identities, editions or incomplete native evidence',()=>{
 const p=progress.mergeCompletion(progress.empty('alice'),finish(fixture()),{userId:'alice'});assert.throws(()=>progress.normalize(p,'bob'),/cuenta/);assert.throws(()=>progress.normalize({...p,sourceSha256:'0'.repeat(64)},'alice'),/edición/);assert.throws(()=>progress.validateCompletion({passed:true,score:100}),/resultado/);const receipt=finish(fixture());
 for(const alter of [r=>r.checkpoint.done.pop(),r=>r.finalEvidence.totalUnits++,r=>r.finalEvidence.emergency=true,r=>r.checkpoint.done[2].evidence.processedUnits=0,r=>r.checkpoint.done[1].time=-1,r=>r.sourceSha256='0'.repeat(64)]){const invalid=clone(receipt);alter(invalid);if(invalid.checkpoint.done[2]&&invalid.checkpoint.done[2].evidence.processedUnits===0)invalid.checkpoint.done[2].evidence.sourceUnits=4;assert.throws(()=>progress.validateCompletion(invalid));}
});
test('documentary operations require real-actor data checks while the material inventory stays unchanged',()=>{
 const requirements=schema.GUARDS.map((guard,index)=>({guard,eventId:'event-'+guard,objectId:'actor-'+index,title:guard,fields:[{key:'reference',label:'Referencia de la orden',type:'text',expected:'ORDER-12'},{key:'count',label:'Pallets de la cita',type:'number',expected:12}]})),f=fixture('CEDI-01',{evidenceAdapter:{kind:'documentary',requirements}});f.world.documentaryEvidence=[];
 assert(!f.session.act('identify').accepted);f.session.penalty=0;
 for(const requirement of requirements){assert.throws(()=>schema.validateRecord(requirement,{kind:requirement.eventId,objectId:'wrong-actor',values:{reference:'ORDER-12',count:12}}));const event=schema.validateRecord(requirement,{kind:requirement.eventId,objectId:requirement.objectId,values:{reference:'ORDER-12',count:12}});f.world.time++;f.world.documentaryEvidence.push({...event,time:f.world.time});assert(f.session.act(requirement.guard).accepted);}
 assert(f.session.state().passed);assert.equal(f.world.sourceUnits,4);assert.equal(f.world.processedUnits,0);assert.equal(f.world.receiverUnits,0);assert.equal(progress.validateCompletion(progress.receipt(f.config,f.session,{attemptId:'documentary-attempt'})).score,100);
 const forged=f.session.state().evidence;forged.documentaryEvidence[0].values.count=11;const receipt=progress.receipt(f.config,f.session,{attemptId:'documentary-attempt'});receipt.finalEvidence=forged;assert.throws(()=>progress.validateCompletion(receipt));
});
