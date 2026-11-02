import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PracticeSession,normalizeConfig,campaignLedger,GUARDS}=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs');
const config=extra=>({...{practiceId:'nexus-practices-2026:L04',caseId:'A',mode:'manual',difficulty:1,roomId:'practice-room',sourceId:'source',processIds:['native-process'],receiverId:'receiver',expectedUnits:6,sku:'SKU-A',projectId:'private-project',generation:'saved-generation-3',steps:GUARDS.map((guard,i)=>({id:'step-'+(i+1),title:'Original operation '+(i+1),action:'Native operation required',guard}))},...extra});
const fixture=extra=>{const world={sourceUnits:6,processedUnits:0,receiverUnits:0,totalUnits:6,initialUnits:6,blocked:false,paused:false,emergency:false,selectedSku:'',identified:false,prepared:false,documentValidated:false,destinationConfirmed:false,faultInjected:false,faultRecovered:false,time:0},events=[],session=new PracticeSession(config(extra),{snapshot:()=>world,onEvent:event=>events.push(event)});return{world,events,session};};
function identify(f){Object.assign(f.world,{identified:true,selectedSku:'SKU-A',time:f.world.time+1});assert.equal(f.session.act('identify','SKU-A').accepted,true);}
function prepare(f){Object.assign(f.world,{prepared:true,time:f.world.time+1});assert.equal(f.session.act('prepare').accepted,true);}
function operate(f){Object.assign(f.world,{sourceUnits:0,processedUnits:6,time:f.world.time+1});assert.equal(f.session.act('operate').accepted,true);}
function inspect(f){Object.assign(f.world,{documentValidated:true,time:f.world.time+1});assert.equal(f.session.act('inspect').accepted,true);}
function deliver(f){Object.assign(f.world,{receiverUnits:6,destinationConfirmed:true,time:f.world.time+1});assert.equal(f.session.act('deliver').accepted,true);}

test('six original steps require native evidence; clicking or observing cannot fabricate material or completion',()=>{
 const f=fixture(),before=JSON.stringify(f.world);for(const type of GUARDS)assert.equal(f.session.act(type).accepted,false);assert.equal(f.session.state().stepIndex,0);assert.equal(JSON.stringify(f.world),before);
 identify(f);prepare(f);assert.equal(f.session.act('operate').accepted,false);assert.equal(f.world.processedUnits,0);
 operate(f);inspect(f);assert.equal(f.session.act('deliver').accepted,false);deliver(f);
 const result=f.session.act('close');assert.equal(result.accepted,true);assert.equal(result.state.completed,true);assert.equal(result.state.passed,true);assert.equal(result.state.criticalReasons.length,0);
 assert.equal(f.events.filter(e=>e.type==='step-completed').length,6);assert.equal(f.events.filter(e=>e.type==='practice-passed').length,1);
});

test('quantity, SKU, document, critical conditions and conservation cannot be waived by submitted action values',()=>{
 const f=fixture();Object.assign(f.world,{identified:true,selectedSku:'SKU-B'});assert.equal(f.session.act('identify','SKU-A').accepted,false);
 identify(f);prepare(f);operate(f);assert.equal(f.session.act('inspect',{quantity:6,documentValidated:true}).accepted,false);
 inspect(f);Object.assign(f.world,{receiverUnits:5,destinationConfirmed:true});assert.equal(f.session.act('deliver').accepted,false);
 Object.assign(f.world,{receiverUnits:6,totalUnits:7});assert.equal(f.session.act('deliver').accepted,false);f.world.totalUnits=6;deliver(f);
 for(const key of ['blocked','paused','emergency']){f.world[key]=true;assert.equal(f.session.act('close').accepted,false);f.world[key]=false;}
 assert.equal(f.session.act('close').state.passed,true);
});

test('case C requires a fault and observed native recovery, rather than a confirmation button',()=>{
 const f=fixture({caseId:'C'});identify(f);prepare(f);operate(f);inspect(f);deliver(f);assert.equal(f.session.act('close',{faultRecovered:true}).accepted,false);
 Object.assign(f.world,{faultInjected:true,blocked:true,time:20});f.session.observe();assert.equal(f.session.state().faultObserved,true);assert.equal(f.session.state().recoveryObserved,false);
 f.world.faultRecovered=true;assert.equal(f.session.act('close').accepted,false,'A recovery label while the critical condition remains does not count.');
 f.world.blocked=false;f.session.observe();assert.equal(f.session.act('close').state.passed,true);
});

test('rubric weights normalize not-applicable criteria and duplicate events never produce more reward',()=>{
 const f=fixture({notApplicable:['service','coordination']});identify(f);prepare(f);operate(f);inspect(f);deliver(f);f.session.act('close');assert.equal(f.session.state().score,100);
 const before=JSON.stringify(f.session.serialize()),events=f.events.length;assert.equal(f.session.act('close').duplicate,true);f.session.observe();assert.equal(f.events.length,events);assert.equal(JSON.stringify(f.session.serialize()),before);
 assert.throws(()=>normalizeConfig(config({notApplicable:['accuracy','process','service','diagnosis','coordination']})),/applicability/);
});

test('wrong attempts have a simulated-time cooldown, a bounded penalty and at most 64 retained events',()=>{
 const f=fixture();for(let i=0;i<100;i++)f.session.act('close');assert.equal(f.session.state().penalty,2);assert.equal(f.session.state().history.length,1);
 for(let i=1;i<90;i++){f.world.time=i*3;f.session.act('close');}assert.equal(f.session.state().penalty,40);assert.equal(f.session.state().history.length,64);
 identify(f);prepare(f);operate(f);inspect(f);deliver(f);const closed=f.session.act('close').state;assert.equal(closed.completed,true);assert.equal(closed.score,60);assert.equal(closed.passed,false,'Completing material objectives does not erase accumulated wrong-attempt penalties.');
});

test('checkpoint restore is bounded, context-specific, atomic and still requires the actual native world',()=>{
 const f=fixture();identify(f);prepare(f);operate(f);const checkpoint=f.session.serialize();
 const restored=PracticeSession.restore(config(),checkpoint,{snapshot:()=>f.world});assert.equal(restored.state().stepIndex,3);assert.equal(restored.state().passed,false);inspect({...f,session:restored});deliver({...f,session:restored});assert.equal(restored.act('close').state.passed,true);
 assert.throws(()=>PracticeSession.restore(config({generation:'other-project-generation'}),checkpoint,{snapshot:()=>f.world}),/another configuration/);
 const reset={...f.world,sourceUnits:6,processedUnits:0};assert.throws(()=>PracticeSession.restore(config(),checkpoint,{snapshot:()=>reset}),/Native world/);
 const before=JSON.stringify(restored.serialize()),bad={...checkpoint,lastPenaltyTime:-1};assert.throws(()=>restored.restore(bad),/last penalty/);assert.equal(JSON.stringify(restored.serialize()),before);
 assert.throws(()=>PracticeSession.restore(config(),{...checkpoint,history:Array(65).fill({})},{snapshot:()=>f.world}),/limits/);
});

test('configuration and native snapshots reject unsupported or nonfinite state without executing source text',()=>{
 assert.throws(()=>normalizeConfig(config({steps:[{id:'eval',guard:'eval',action:'console.log(1)'}]})),/six/);
 assert.throws(()=>normalizeConfig(config({mode:'omniscient'})),/mode/);assert.throws(()=>normalizeConfig(config({expectedUnits:Infinity})),/expected/);
 assert.equal(normalizeConfig(config({mode:'semi',difficulty:'D3'})).mode,'semiautomatic');
 const f=fixture();f.world.totalUnits=NaN;const state=f.session.observe();assert.equal(state.stepIndex,0);assert.equal(state.passed,false);assert(state.criticalReasons.includes('native-evidence-unavailable'));
});

test('reference campaign ledger conserves physical boxes, consumed BOM inputs and rejected finished products',()=>{
 const ledger=campaignLedger();assert.deepEqual(ledger.logistics,{initialBoxes:240,blockedBoxes:20,eligibleBoxes:220,dispatchedBoxes:160,remainingBoxes:80,remainingBlockedBoxes:20,remainingEligibleBoxes:60});
 assert.deepEqual(ledger.manufacturing,{initialA:120,initialB:80,produced:20,consumedA:40,consumedB:20,remainingA:80,remainingB:60,conforming:18,rejected:2});assert.equal(ledger.mass.known,false);
 const measured=campaignLedger({massKg:{a:2,b:3}});assert.equal(measured.mass.productUnit,7);assert.equal(measured.mass.conserved,true);assert.equal(measured.mass.conforming,126);assert.equal(measured.mass.rejected,14);
 assert.throws(()=>campaignLedger({logistics:{dispatchBoxes:221}}),/eligible/);assert.throws(()=>campaignLedger({manufacturing:{produced:81}}),/BOM/);assert.throws(()=>campaignLedger({manufacturing:{bomA:0,bomB:0}}),/BOM/);
});
