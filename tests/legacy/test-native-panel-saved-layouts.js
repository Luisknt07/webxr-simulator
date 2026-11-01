'use strict';
// Historic poses are immutable captured data from the old real prefab, rather
// than a second implementation of the production migration formula.
const assert=require('node:assert/strict'),fs=require('node:fs'),THREE=require('three');
const behaviors=require('../../modules/logistica-industrial/contracts/behaviors.js');
const validateDocument=require('../../apps/api/server/validation.js').validateDocument;
const robots=require('../support/load-robot-prefabs.js')(THREE);
const fixture=require('../fixtures/native-panel-layouts-v1.json');
const source=file=>fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const nativeFactory=new Function('THREE','behaviorSchema','require',source('modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js')+'\nreturn createIndustrialPrefab;')(THREE,behaviors,robots.resolve);
let factoryCalls=0;
function factory(...args){factoryCalls++;return nativeFactory(...args);}
factory.refresh=nativeFactory.refresh;factory.enforceOptions=nativeFactory.enforceOptions;
const SceneDocument=new Function('THREE','behaviorSchema','createIndustrialPrefab',source('packages/project-model/src/SceneDocument.js').replace('default class SceneDocument','return class SceneDocument'))(THREE,behaviors,factory);
const clone=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
freeze(fixture);
function setup(){const d=new SceneDocument({});for(const room of ['hall','sound'])d.registerRoom(room,new THREE.Group());return d;}
function near(actual,expected,label='value'){
 if(typeof expected==='number')return assert(Math.abs(actual-expected)<1e-11,`${label}: ${actual} != ${expected}`);
 if(!expected||typeof expected!=='object')return assert.equal(actual,expected,label);
 assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),label);
 for(const key of Object.keys(expected))near(actual[key],expected[key],label+'.'+key);
}
const all=data=>Object.values(data.rooms).flatMap(room=>room.additions);
const find=(data,id)=>all(data).find(row=>row.id===id);
const cases=['robot','conveyor'].flatMap(kind=>['compact','pendant','console','cabinet'].map(design=>({kind,design,before:design})));
cases.push({kind:'robot',design:'auto',before:'pendant'},{kind:'conveyor',design:'auto',before:'console',surface:'belt'});
function prefix(test){return test.kind==='robot'?'1.':'6.';}
function configuration(d,object,patch){d.setBehaviors(object,d.getBehaviors(object).map(row=>row.type===object.userData.editorPrefabKey?Object.assign({},row,patch):row));}
async function run(){
 const document=setup(),created=[];
 for(let index=0;index<cases.length;index++){
  const test=cases[index],room=index%2?'sound':'hall';
  const object=document.addPrefab(room,test.kind,test.kind==='robot'?'articulated-general':'roller-start');
  configuration(document,object,{panelDesign:test.design,...test.surface?{surface:test.surface}:{}});
  document.setTransform(object,{position:[index*7,1,index*3],rotation:[.07,.16,-.03],scale:[1.02,.98,1.01]});
  const entry=document.additions.get(object.userData.editorId),panel=entry.nodes.get(prefix(test).slice(0,-1));
  document.setTransform(panel,{position:[-.93,1.31,-1.42],rotation:[.02,-.26,.01],scale:[.94,1.03,.96]});
  const marked=entry.nodes.get(prefix(test)+'9');
  document.setBehaviors(marked,document.getBehaviors(marked).concat([Object.assign(behaviors.defaultBehavior('surfaceMaterial'),{color:'#a94822',wear:.62})]));
  document.setTransform(marked,{visible:false});
  await document.replaceAsset(marked,{type:'cylinder',color:'#25c8a9'});
  created.push({test,object,entry});
 }
 const expected=await document.serialize(),legacy=clone(expected),immutableBefore=JSON.stringify(fixture);
 for(const {test,object} of created){
  const row=find(legacy,object.userData.editorId),target=find(expected,object.userData.editorId),p=prefix(test);
  // The panel actor itself is editable. Its shell/HMI are generated geometry,
  // while only the nine independently editable control actors have records.
  assert.equal(Object.keys(row.nodes).filter(key=>key.startsWith(p)).length,9);
  assert(!row.nodes[p+'0']&&!row.nodes[p+'1'],'Cabinet and HMI are rebuilt, not persisted TRS overrides.');
  fixture.controls[test.before].forEach((pose,index)=>{
   const state=row.nodes[p+(index+2)];
   assert.equal(created.find(item=>item.object===object).entry.nodes.get(p+(index+2)).userData.industrialAction,pose.action==='insertBox'&&test.kind==='robot'?'dispatch':pose.action);
   for(const field of ['position','quaternion','scale'])state[field]=pose[field].slice();
  });
  // Three independent author edits must keep the entire saved actor TRS,
  // including its legacy local position; no speculative delta reconstruction.
  row.nodes[p+'2'].position=[-.61,.32,.25];
  row.nodes[p+'3'].quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(.06,.18,-.02)).toArray();
  row.nodes[p+'4'].scale=[.91,1.03,.87];
  for(const index of [2,3,4])target.nodes[p+index]=clone(row.nodes[p+index]);
  // Equivalent quaternion sign is still recognized for an untouched actor.
  row.nodes[p+'7'].quaternion=row.nodes[p+'7'].quaternion.map(value=>value===0?0:-value);
 }
 const untouched=clone(legacy),validator=setup(),calls=factoryCalls;
 near(validator._validate(legacy).rooms,expected.rooms,'validated historical layouts');
 assert.equal(factoryCalls,calls,'Inactive-room validation must not allocate native models.');
 assert.deepEqual(legacy,untouched,'Incoming project records must remain immutable.');
 assert.equal(JSON.stringify(fixture),immutableBefore,'Historical fixture is never rewritten.');
 const loaded=setup();await loaded.load(legacy,{activeRoomId:'hall'});
 assert(loaded.hasPendingRoom('sound'));near((await loaded.serialize()).rooms,expected.rooms,'lazy rooms');
 await loaded.activateRoom('sound');near((await loaded.serialize()).rooms,expected.rooms,'hydrated rooms');
 for(const {test,object} of created){
  const entry=loaded.additions.get(object.userData.editorId),p=prefix(test),newPanel=entry.nodes.get(p.slice(0,-1));
  assert.equal(newPanel.userData.industrialPanelDesign,test.kind==='robot'&&test.design==='auto'?'console':test.before);
  for(let index=2;index<=10;index++){
   const actor=entry.nodes.get(p+index),state=find(expected,object.userData.editorId).nodes[p+index];
   near(actor.position.toArray(),state.position);near(actor.quaternion.toArray(),state.quaternion);near(actor.scale.toArray(),state.scale);
   assert.equal(loaded.getBehaviors(actor).find(row=>row.type==='control').targetId,object.userData.editorId);
  }
  near(newPanel.position.toArray(),find(expected,object.userData.editorId).nodes[p.slice(0,-1)].position,'Author panel anchor retained');
 }
 const saved=await loaded.serialize();assert.doesNotThrow(()=>validateDocument(saved,value=>value));
 const reopened=setup();await reopened.load(saved);near(await reopened.serialize(),saved,'idempotent saved project');
 // Both a robot auto layout and an explicit console are copied through the
 // same public clipboard validator; every command retargets the fresh owner.
 for(const index of [2,8]){
  const {test,object}=created[index],snapshot=document.captureObject(object),p=prefix(test);
  snapshot.record=clone(find(legacy,object.userData.editorId));const original=clone(snapshot);
  const copy=await loaded.pasteObject(snapshot,'hall',2),entry=loaded.additions.get(copy.userData.editorId);
  assert.deepEqual(snapshot,original,'Clipboard source must stay immutable.');
  for(let control=2;control<=10;control++){
   const actor=entry.nodes.get(p+control),state=find(expected,object.userData.editorId).nodes[p+control];
   near(actor.position.toArray(),state.position);near(actor.quaternion.toArray(),state.quaternion);near(actor.scale.toArray(),state.scale);
   assert.equal(loaded.getBehaviors(actor).find(row=>row.type==='control').targetId,copy.userData.editorId);
  }
  const changed=await loaded.serialize();assert(loaded.undo());assert(!loaded.getObject(copy.userData.editorId));assert(loaded.redo());near(await loaded.serialize(),changed,'clipboard undo/redo');
 }
 // One deliberately historical-looking actor in a current document is not
 // sufficient evidence to migrate an entire design or undo author intent.
 const lone=clone(saved),row=find(lone,created[2].object.userData.editorId),old=fixture.controls.console[0];
 for(const field of ['position','quaternion','scale'])row.nodes['1.2'][field]=old[field].slice();
 const once=setup();near(once._validate(lone).rooms,lone.rooms,'single legacy-like author edit');
 console.log('Saved native panels: 4 historical designs for robot/conveyor, auto pendant to console, immutable fixtures, custom TRS/assets, no-allocation validation, lazy hydration, clipboard bindings and idempotence passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
