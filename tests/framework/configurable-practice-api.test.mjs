import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import apiModule from '../../apps/api/server/api.js';

const require=createRequire(import.meta.url);
const recipes=require('../../modules/logistica-industrial/practices/configurable/Recipes.cjs');
const source=require('../../modules/logistica-industrial/practices/configurable/data/index.json');
const progress=require('../../modules/logistica-industrial/practices/schema/PracticeProgress.cjs');
const sessionSchema=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs');
const BASE='/api/studio/practices',PREFIX='smarttwin-configurable-api-';
const clone=value=>JSON.parse(JSON.stringify(value));
const IDS=['CEDI','SF'].flatMap(prefix=>Array.from({length:5},(_,index)=>prefix+'-'+String(index+1).padStart(2,'0')));

// Actual HTTP handlers, authentication and SQLite, with an otherwise empty
// temporary installation. No private projects or existing user data are read.
async function fixture(run){
 const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),PREFIX))),errors=[];
 let api,server,origin;
 const open=async()=>{
  api=apiModule.createApiHandler({dataDir:directory,requireSecureCookies:false,maintenanceIntervalMs:0,onError:error=>errors.push(error)});
  server=http.createServer(api);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 };
 const close=async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=null;}if(api){api.close();api=null;}};
 const request=async(route,body,{method=body===undefined?'GET':'POST',cookie,headers={}}={})=>{
  const response=await fetch(origin+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const setCookie=response.headers.get('set-cookie');
  return{status:response.status,data:await response.json(),cookie:setCookie&&setCookie.split(';')[0]};
 };
 const attempts=()=>api.studio.db.prepare('SELECT id,user_id,practice_id,settings,source_sha256,completed_at,receipt,checkpoint FROM logistics_practice_attempts ORDER BY created_at,id').all();
 try{
  await open();await api.studio.bootstrapOwner({username:'configurable_owner',password:'Temporary-configurable-owner-846',invitationOnly:false});
  const owner=await request('/api/studio/login',{username:'configurable_owner',password:'Temporary-configurable-owner-846'});assert.equal(owner.status,200);
  await run({request,owner,attempts,close,open,get api(){return api;}});assert.deepEqual(errors,[],'No unexpected API or storage exceptions.');
 }finally{
  await close();assert.equal(path.dirname(directory),fs.realpathSync(os.tmpdir()));assert(path.basename(directory).startsWith(PREFIX));assert(!fs.lstatSync(directory).isSymbolicLink());fs.rmSync(directory,{recursive:true,force:true,maxRetries:3});
 }
}
async function viewer(f,username='configurable_player'){
 const created=await f.request('/api/studio/admin/users',{username,role:'viewer'},{cookie:f.owner.cookie});assert.equal(created.status,201);
 const result=await f.request('/api/studio/login',{username,password:created.data.accessCode});assert.equal(result.status,200);assert.equal(result.data.user.role,'viewer');return result;
}
async function state(f,cookie){const result=await f.request(BASE+'/progress',undefined,{cookie});assert.equal(result.status,200,JSON.stringify(result.data));return result.data;}
function noCompletions(value){for(const route of Object.values(value.progress.routes))assert.deepEqual(route.completed,[]);}
function rejected(result,status,message){assert.equal(result.status,status,message+': '+JSON.stringify(result.data));assert(!result.data.attempt,'A rejected request cannot return a playable attempt.');}
async function start(f,cookie,settings={}){const result=await f.request(BASE+'/attempts',{practiceId:'CEDI-01',executionMode:'isolated',...settings},{cookie});assert.equal(result.status,201,JSON.stringify(result.data));return result.data.attempt;}

// This is deliberately NOT a successful simulated run. It supplies an empty
// checkpoint and no native evidence to exercise hostile completion requests.
// Positive physical completion is covered by the native receiving-flow suite.
function incompleteReceipt(attempt){
 const plan=recipes.plan(attempt.practiceId,attempt.settings);
 const settings=recipes.normalizedOptions(attempt.settings);
 const config=sessionSchema.normalizeConfig({practiceId:attempt.practiceId,mode:attempt.settings.mode,caseId:attempt.settings.caseId,difficulty:attempt.settings.difficulty,roomId:'hall',sourceId:'unoperated-source',processIds:[],receiverId:'unoperated-receiver',expectedUnits:plan.units,sku:attempt.practiceId+'-ORDER',steps:plan.steps,settings,evidenceAdapter:{kind:'workflow',requirements:recipes.workflowRequirements(plan)}});
 return{format:'smarttwin.practice-completion',version:1,attemptId:attempt.id,practiceId:attempt.practiceId,routeId:attempt.routeId,sourceSha256:attempt.sourceSha256,
  config,checkpoint:{configHash:JSON.stringify(config),done:[]},passed:true,score:100};
}

test('configurable API exposes exactly ten source practices in two five-step routes, privately and without an editor project',{timeout:30000},()=>fixture(async f=>{
 rejected(await f.request(BASE+'/progress'),401,'Anonymous progress');rejected(await f.request(BASE+'/attempts',{practiceId:'CEDI-01'}),401,'Anonymous play');
 const player=await viewer(f),cookie=player.cookie,userId=player.data.user.id,other=await viewer(f,'configurable_other');
 const before=await state(f,cookie);assert.equal(before.progress.userId,userId);assert.equal(before.sourceSha256,source.sources[1].sha256);assert.equal(progress.SOURCE_SHA256,source.sources[1].sha256);
 assert.equal(before.routes.length,2);assert.deepEqual(before.routes.map(route=>route.practiceIds.length),[5,5]);assert.deepEqual(before.routes.flatMap(route=>route.practiceIds),IDS);
 assert.equal(before.capabilities.length,10);assert.deepEqual(before.capabilities.map(row=>row.id),IDS);
 for(const row of before.capabilities){assert.equal(row.modes.length,3);assert.deepEqual(row.modes.map(mode=>mode.mode),['manual','semiautomatic','automatic']);assert(row.modes.every(mode=>typeof mode.ready==='boolean'&&Array.isArray(mode.reasons)));}
 noCompletions(before);noCompletions(await state(f,other.cookie));
 const attempt=await start(f,cookie,{userId:other.data.user.id});assert.equal(attempt.practiceId,'CEDI-01');assert.equal(attempt.sourceSha256,before.sourceSha256);assert.equal(recipes.plan(attempt.practiceId,attempt.settings).expectedUnits,48);assert(!Object.hasOwn(attempt.settings,'units'),'A generic batch input must not override the source lot.');
 assert.equal(f.attempts().length,1);assert.equal(f.attempts()[0].user_id,userId,'The authenticated session, never a body userId, owns the attempt.');
 assert.equal(f.api.studio.access.usage(userId).projects,0);assert.equal(f.api.studio.access.usage(other.data.user.id).projects,0);assert.equal(f.api.studio.db.prepare('SELECT COUNT(*) AS count FROM projects').get().count,0);
 const foreign=await state(f,other.cookie);assert(!JSON.stringify(foreign).includes(attempt.id),'Another account cannot discover the live attempt identifier.');
 const targeted=await f.request(BASE+'/progress?userId='+encodeURIComponent(other.data.user.id),undefined,{cookie});assert.equal(targeted.status,200);assert.equal(targeted.data.progress.userId,userId,'A query string cannot redirect the authenticated progress owner.');
 await f.close();await f.open();const restored=await state(f,cookie);assert.deepEqual(restored.progress,before.progress);assert.equal(f.attempts().length,1);assert.equal(f.attempts()[0].user_id,userId);noCompletions(await state(f,other.cookie));
}));

test('isolated practice never bypasses availability, campaign preserves order, and a preview cannot allocate an attempt',{timeout:30000},()=>fixture(async f=>{
 const cookie=f.owner.cookie,before=await state(f,cookie);noCompletions(before);
 for(const practiceId of ['CEDI-02','SF-02']){const result=await f.request(BASE+'/attempts',{practiceId,executionMode:'campaign'},{cookie});rejected(result,403,'Campaign prerequisite '+practiceId);assert.equal(result.data.code,'practice_locked');}
 assert.equal(f.attempts().length,0);
 for(const row of before.capabilities.filter(row=>row.id!=='CEDI-01')){
  const mode=row.modes.find(mode=>mode.ready)||row.modes[0],count=f.attempts().length,result=await f.request(BASE+'/attempts',{practiceId:row.id,mode:mode.mode,executionMode:'isolated'},{cookie});
  if(mode.ready){assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.attempt.settings.executionMode,'isolated');assert.equal(f.attempts().length,count+1);}else{rejected(result,400,'Unvalidated isolated configuration '+row.id);assert.equal(f.attempts().length,count);}
 }
 const count=f.attempts().length;
 for(const request of [{practiceId:'CEDI-01',preview:true},{practiceId:'CEDI-01',executionMode:'preview'}]){rejected(await f.request(BASE+'/attempts',request,{cookie}),400,'A preview is not an evaluated attempt');assert.equal(f.attempts().length,count);}
 for(const practiceId of ['L01','I01','CEDI-00','CEDI-06','SF-06','not-a-practice']){rejected(await f.request(BASE+'/attempts',{practiceId,executionMode:'isolated'},{cookie}),400,'Old or unknown practice '+practiceId);assert.equal(f.attempts().length,count);}
 const firstCampaign=await start(f,cookie,{executionMode:'campaign',evaluation:'assessed'});assert.equal(firstCampaign.settings.executionMode,'campaign');assert.equal(firstCampaign.settings.evaluation,'assessed');
 noCompletions(await state(f,cookie));assert.equal(f.api.studio.access.usage(f.owner.data.user.id).projects,0);
}));

test('attempts bind normalized source quantities and all declared selectors instead of silently replacing the authored lot',{timeout:30000},()=>fixture(async f=>{
 const cookie=f.owner.cookie;
 const requested={mode:'manual',caseId:'A',difficulty:2,executionMode:'isolated',equipmentSelections:{},layout:{preset:'prepared',overrides:[]},helps:{text:false,voice:false,hints:'on-request'},evaluation:'assessed',device:'mobile'};
 const attempt=await start(f,cookie,requested);for(const [key,value]of Object.entries(requested))assert.deepEqual(attempt.settings[key],value,key);
 assert.equal(recipes.plan(attempt.practiceId,attempt.settings).units,48);assert(!Object.hasOwn(attempt.settings,'units'));assert(!Object.hasOwn(attempt.settings,'expectedUnits'));assert.equal(attempt.sourceSha256,source.sources[1].sha256);
 const stored=f.attempts().find(row=>row.id===attempt.id);assert.deepEqual(JSON.parse(stored.settings),attempt.settings);assert.equal(stored.source_sha256,attempt.sourceSha256);assert.equal(stored.completed_at,null);assert.equal(stored.receipt,null);
 const independent=await start(f,cookie,{mode:'manual',caseId:'A',difficulty:3});assert.equal(independent.settings.difficulty,3);assert.equal(independent.settings.caseId,'A','Difficulty is independent from source case selection.');
 const invalid=[{units:4},{units:47},{units:49},{mode:'unknown'},{caseId:'D'},{difficulty:0},{difficulty:4},{executionMode:'shared'},{evaluation:'passed'},{device:'console'},{equipmentSelections:[]},{equipmentSelections:{UNKNOWN:'equipment.vehicle.counterbalance'}},{equipmentSelections:{E03:'equipment.robot.articulated'}},{layout:{preset:'prepared',overrides:'none'}},{helps:{text:'yes',voice:false,hints:'guided'}},{helps:{text:true,voice:false,hints:'always'}}];
 for(const settings of invalid){const count=f.attempts().length;rejected(await f.request(BASE+'/attempts',{practiceId:'CEDI-01',executionMode:'isolated',...settings},{cookie}),400,'Invalid selectors '+JSON.stringify(settings));assert.equal(f.attempts().length,count);}
 const unverified={equipmentSelections:{E03:'equipment.vehicle.counterbalance'}};assert.equal(recipes.availability('CEDI-01','manual',unverified).ready,false);const count=f.attempts().length,unverifiedResult=await f.request(BASE+'/attempts',{practiceId:'CEDI-01',executionMode:'isolated',...unverified},{cookie});rejected(unverifiedResult,400,'A configurable but unverified equipment choice cannot become an evaluated attempt');assert.equal(unverifiedResult.data.code,'practice_not_verified');assert.equal(f.attempts().length,count);
 for(const mode of ['semiautomatic','automatic']){const available=recipes.availability('CEDI-01',mode,{caseId:'A'});if(!available.ready)rejected(await f.request(BASE+'/attempts',{practiceId:'CEDI-01',mode,executionMode:'isolated'},{cookie}),400,'Unvalidated automation '+mode);}
 noCompletions(await state(f,cookie));assert.equal(f.api.studio.access.usage(f.owner.data.user.id).projects,0);
}));

test('source, mode, case, difficulty, owner and CSRF guards reject forged claims before persistence',{timeout:30000},()=>fixture(async f=>{
 const player=await viewer(f),other=await viewer(f,'configurable_foreign'),cookie=player.cookie,attempt=await start(f,cookie),receipt=incompleteReceipt(attempt);
 rejected(await f.request(BASE+'/progress',{receipt},{cookie:other.cookie}),404,'Another account cannot claim this attempt');
 rejected(await f.request(BASE+'/progress',{receipt},{cookie,headers:{'X-Studio-User':other.data.user.id}}),409,'Expected identity must match the session');
 rejected(await f.request(BASE+'/progress',{receipt},{cookie,headers:{Origin:'https://unrelated.invalid'}}),403,'Foreign origin');
 rejected(await f.request(BASE+'/progress',{receipt},{cookie,headers:{'Sec-Fetch-Site':'cross-site'}}),403,'Cross-site fetch');
 rejected(await f.request(BASE+'/progress',{receipt},{cookie,headers:{'Content-Type':'text/plain'}}),415,'Wrong media type');
 for(const [key,value]of [['mode','automatic'],['caseId','B'],['difficulty',2]]){const forged=clone(receipt);forged.config[key]=value;rejected(await f.request(BASE+'/progress',{receipt:forged},{cookie}),409,'Server-bound '+key);}
 for(const [key,value]of [['executionMode','campaign'],['evaluation','assessed'],['device','vr'],['helps',{text:false,voice:false,hints:'none'}],['equipmentSelections',{E03:'equipment.vehicle.reach-truck'}],['layout',{preset:'prepared',overrides:[{alias:'E04',x:1,z:1,yaw:0}]}]]){const forged=clone(receipt);forged.config.settings[key]=value;rejected(await f.request(BASE+'/progress',{receipt:forged},{cookie}),409,'Server-bound settings '+key);}
 for(const [key,value]of [['sourceSha256','0'.repeat(64)],['practiceId','SF-01']]){const forged=clone(receipt);forged[key]=value;rejected(await f.request(BASE+'/progress',{receipt:forged},{cookie}),409,'Source identity '+key);}
 rejected(await f.request(BASE+'/progress',{receipt},{cookie}),400,'passed:true and a score are not physical evidence');
 const onlyFlags={attemptId:attempt.id,practiceId:attempt.practiceId,sourceSha256:attempt.sourceSha256,passed:true,score:100};assert([400,409].includes((await f.request(BASE+'/progress',{receipt:onlyFlags},{cookie})).status));
 for(const row of f.attempts()){assert.equal(row.completed_at,null);assert.equal(row.receipt,null);assert.equal(row.checkpoint,null);}
 noCompletions(await state(f,cookie));noCompletions(await state(f,other.cookie));assert.equal(f.api.studio.db.prepare('SELECT COUNT(*) AS count FROM logistics_practice_progress').get().count,0);
 assert.equal(f.api.studio.access.usage(player.data.user.id).projects,0);
}));

test('saving an unfinished attempt is owner-only, bounded, persistent and cannot unlock campaign practice two',{timeout:30000},()=>fixture(async f=>{
 const player=await viewer(f),other=await viewer(f,'configurable_checkpoint_other'),cookie=player.cookie,attempt=await start(f,cookie),route=BASE+'/attempts/'+attempt.id+'/checkpoint';
 const checkpoint={format:'smarttwin.practice-session',version:1,done:[],history:[],note:'Incomplete native attempt; no completed actions.'};
 rejected(await f.request(route,{checkpoint},{cookie:other.cookie}),404,'Checkpoint owner');
 rejected(await f.request(route,{checkpoint},{cookie,headers:{'X-Studio-User':other.data.user.id}}),409,'Checkpoint expected identity');
 rejected(await f.request(route,{checkpoint:{done:Array(7).fill({})}},{cookie}),400,'More than six steps');
 rejected(await f.request(route,{checkpoint:{done:[],note:'x'.repeat(100000)}},{cookie}),413,'Checkpoint byte budget');
 const saved=await f.request(route,{checkpoint},{cookie});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.recorded,true);assert.equal(saved.data.resumable,false);
 assert.deepEqual(JSON.parse(f.attempts().find(row=>row.id===attempt.id).checkpoint),checkpoint);
 rejected(await f.request(BASE+'/attempts',{practiceId:'CEDI-02',executionMode:'campaign'},{cookie}),403,'A checkpoint is not success');
 noCompletions(await state(f,cookie));assert.equal(f.attempts()[0].completed_at,null);
 await f.close();await f.open();assert.deepEqual(JSON.parse(f.attempts().find(row=>row.id===attempt.id).checkpoint),checkpoint);noCompletions(await state(f,cookie));noCompletions(await state(f,other.cookie));
 assert.equal(f.api.studio.access.usage(player.data.user.id).projects,0);assert.equal(f.api.studio.access.usage(other.data.user.id).projects,0);
}));

test('reading an empty prior-edition ledger offers the current curriculum without overwriting historical storage',{timeout:30000},()=>fixture(async f=>{
 const cookie=f.owner.cookie,userId=f.owner.data.user.id;await state(f,cookie);
 const historicalSource=require('../fixtures/practice-campaign-source-layouts.json').sources[0].sha256;assert.notEqual(historicalSource,progress.SOURCE_SHA256);
 // Migration fixture only: no prior completions, no simulated success and no
 // manual unlock. Its exact bytes must remain available to the old edition.
 const archived={format:'smarttwin.practice-progress',version:1,userId,sourceSha256:historicalSource,routes:{cedi:{completed:[]},'smart-factory':{completed:[]}}},raw=JSON.stringify(archived),updatedAt=1700000000000;
 f.api.studio.db.prepare('INSERT INTO logistics_practice_progress(user_id,value,updated_at) VALUES(?,?,?)').run(userId,raw,updatedAt);
 const before=f.api.studio.db.prepare('SELECT value,updated_at FROM logistics_practice_progress WHERE user_id=?').get(userId),current=await state(f,cookie);
 assert.equal(current.progress.sourceSha256,progress.SOURCE_SHA256);assert.equal(current.progress.userId,userId);assert.deepEqual(current.routes.flatMap(route=>route.practiceIds),IDS);noCompletions(current);
 assert.deepEqual(f.api.studio.db.prepare('SELECT value,updated_at FROM logistics_practice_progress WHERE user_id=?').get(userId),before,'A read must not discard or rewrite the old curriculum ledger.');
 await f.close();await f.open();noCompletions(await state(f,cookie));const restored=f.api.studio.db.prepare('SELECT value,updated_at FROM logistics_practice_progress WHERE user_id=?').get(userId);assert.equal(restored.value,raw);assert.equal(restored.updated_at,updatedAt);
 assert.equal(f.api.studio.access.usage(userId).projects,0);
}));
