import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),sessionSchema=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs'),progress=require('../../modules/logistica-industrial/practices/schema/PracticeProgress.cjs');
const source=fs.readFileSync(new URL('../../modules/logistica-industrial/practices/runtime/PracticeController.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class PracticeController','class PracticeController');
const Controller=new Function('sessionSchema','progressSchema','PracticePanel',source+'\nreturn PracticeController;')(sessionSchema,progress,class{constructor(){throw Error('Controller proof must not need DOM.');}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 let current=true,savedProjects=0;const events=[],receipts=[],next=[],guides=[],records=new Map(sessionSchema.GUARDS.map((guard,index)=>['actor-'+index,{id:'actor-'+index,object:{name:'Actor '+guard,parent:{}},components:{plc:{}}}]));
 const runtime={records,active:true,runSequence:1,time:0,products:new Map(),sourceRuntime:{entries:new Map()},event:(id,type,text)=>events.push({id,type,text}),setVariable(){throw Error('Documentary records must not issue a physical equipment command.');}};
 const requirements=sessionSchema.GUARDS.map((guard,index)=>({guard,eventId:'checked-'+guard,objectId:'actor-'+index,title:'Dato '+guard,fields:[{key:'reference',label:'Orden',type:'text',expected:'ORD-01'},{key:'count',label:'Pallets',type:'number',expected:12}]}));
 const manifest={practiceId:'CEDI-01',caseId:'A',mode:'manual',difficulty:1,roomId:'hall',sourceId:'actor-0',processIds:[],receiverId:'actor-5',sourceIds:['actor-0'],receiverIds:['actor-5'],expectedUnits:4,sku:'QA',steps:sessionSchema.GUARDS.map(guard=>({id:'CEDI-01-'+guard,title:guard,guard})),evidenceAdapter:{kind:'documentary',requirements},plan:{id:'CEDI-01',title:'Cita y arribo',sourceSha256:progress.SOURCE_SHA256}};
 const editor={simulation:runtime,projectGeneration:1,currentProject:{id:'transient-campaign'},roomId:'hall',canEditDocument:()=>false,saveProject(){savedProjects++;throw Error('Player results must never save a project.');}};
 const controller=new Controller(editor,manifest,{panel:false,campaign:{userId:'alice',routeId:'cedi',progress:progress.empty('alice'),attemptId:'server-bound-attempt'},isCurrent:()=>current,onPassed:async receipt=>{receipts.push(receipt);return{progress:progress.mergeCompletion(progress.empty('alice'),receipt,{userId:'alice'})};},onSave:async()=>true,onNext:id=>next.push(id),onGuide:kind=>guides.push(kind),...options});
 return{controller,runtime,requirements,records,receipts,events,next,guides,setCurrent:value=>current=value,get savedProjects(){return savedProjects;}};
}
function finish(f){for(const requirement of f.requirements){f.runtime.time++;assert(f.controller.perform('record',{kind:requirement.eventId,objectId:requirement.objectId,values:{reference:'ORD-01',count:12}}),f.controller.lastMessage);assert(f.controller.perform('verify',{guard:requirement.guard}),f.controller.lastMessage);}}
test('the reusable player controller records six real-actor transactions without synthetic inventory, then persists one verified result',async()=>{
 const f=fixture();assert.equal(f.controller.next(),false);f.controller.perform('verify',{guard:'close'});assert.equal(f.controller.session.state().stepIndex,0);assert.equal(f.controller.session.state().penalty,2);f.runtime.time=3;finish(f);await tick();
 assert(f.controller.session.state().passed);assert.equal(f.receipts.length,1);assert.equal(f.receipts[0].attemptId,'server-bound-attempt');assert.equal(progress.validateCompletion(f.receipts[0]).score,98);assert.equal(f.events.filter(event=>event.type==='practice-documentary-record').length,6);assert.equal(f.runtime.sourceRuntime.entries.size,0);assert.equal(f.runtime.products.size,0);assert.equal(f.controller.state().world.processedUnits,0);assert.equal(f.controller.state().world.receiverUnits,0);assert.equal(f.controller.state().campaign.completionSaved,true);assert.equal(f.savedProjects,0);
 f.controller.update();await tick();assert.equal(f.receipts.length,1);f.controller.next();assert.deepEqual(f.next,['CEDI-02']);f.controller.guide();f.controller.layout();f.controller.documentation();assert.deepEqual(f.guides,['guide','layout','documentation']);
});
test('wrong fields, retired actors and repeated clicks cannot produce evidence or extra score',()=>{
 const f=fixture(),requirement=f.controller.requirement();assert.equal(f.controller.perform('record',{kind:requirement.eventId,objectId:requirement.objectId,values:{reference:'WRONG',count:12}}),false);assert.equal(f.controller.documentaryEvidence.length,0);assert.equal(f.controller.session.state().penalty,2);
 f.runtime.time=3;f.records.get(requirement.objectId).object.parent=null;assert.equal(f.controller.perform('record',{kind:requirement.eventId,objectId:requirement.objectId,values:{reference:'ORD-01',count:12}}),false);assert.equal(f.controller.documentaryEvidence.length,0);assert.equal(f.controller.session.state().penalty,4);assert.equal(f.receipts.length,0);assert.equal(f.controller.next(),false);
});
test('late persistence does not unlock a next lesson after identity/run revocation, and partial attempts do not require editor rights',async()=>{
 let resolve;const f=fixture({onPassed:()=>new Promise(r=>resolve=r)});finish(f);await tick();assert.equal(f.controller.state().campaign.completionPending,true);assert.equal(f.controller.next(),false);f.setCurrent(false);resolve({progress:progress.empty('alice')});await tick();assert.equal(f.controller.state().campaign.completionSaved,false);assert.equal(f.controller.next(),false);assert.equal(f.controller.perform('verify',{guard:'close'}),false);
 const partial=fixture();assert.equal(await partial.controller.save(),true);assert.equal(partial.savedProjects,0);assert.equal(partial.receipts.length,0);partial.controller.dispose();assert.equal(await partial.controller.save(),false);
});
