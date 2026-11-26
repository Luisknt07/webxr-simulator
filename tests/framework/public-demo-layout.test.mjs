import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three'),schema=require('../../modules/logistica-industrial/contracts/behaviors.js');
const text=fs.readFileSync('tests/legacy/test-conveyor-mechanisms.js','utf8');
const {setup}=new Function('require','__dirname',text.slice(0,text.indexOf('async function run()'))+'\nreturn {setup};')(require,path.resolve('tests/legacy'));
const {buildPublicDemoScene}=require('../../projects/smarttwin/PublicDemoScene.cjs');
const {validateDocument}=require('../../apps/api/server/validation.js');
function fixture(){
 const f=setup(),study=require('../support/load-study-scenes.js')(THREE,schema,f.document.constructor);
 study.studySceneBase(f.document,'hall');const base=study.buildStudyScene(f.document,'hall','vr-robot-transfer',{scene:f.scene,publicDemo:true});
 const built=buildPublicDemoScene({THREE,schema,document:f.document,roomId:'hall',scene:f.scene,base,ConveyorAssembly:study.ConveyorAssembly});
 return Object.assign(f,{built});
}
function dispose(f){f.runtime.stop();const geometry=new Set(),materials=new Set();f.scene.traverse(n=>{if(n.geometry)geometry.add(n.geometry);(Array.isArray(n.material)?n.material:[n.material]).filter(Boolean).forEach(m=>materials.add(m));});geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}

test('public recipe has one robot, six functional belts, two real wall openings and contextual guides without monitors',async()=>{
 const f=fixture();try{
  const saved=await f.document.serialize(),rows=saved.rooms.hall.additions;
  const count=type=>rows.filter(row=>row.behaviors.some(b=>b.type===type)).length;
  assert.equal(count('robot'),1);assert.equal(count('conveyor'),6);assert.equal(count('lineMonitor'),0);assert.equal(count('hingeDoor'),2);assert.equal(count('info'),6);
  assert(!rows.some(row=>row.name==='CEDI · RV pared frontal'||/guía de la práctica/.test(row.name)));
  validateDocument(saved,()=>{throw Error('No external imports');});
  assert.equal(f.built.rackLayout.cells.length,12);assert.equal(f.built.rackStock.length,4);
  const floor=rows.find(row=>row.descriptor.type==='industrialFloor').descriptor;
  assert(floor.walkways.some(box=>box[0]<-6&&box[2]>-6&&box[3]===10));assert(floor.walkways.some(box=>box[0]<12&&box[2]>12&&box[3]===10));
  assert(floor.crossings.length&&floor.bays.length&&floor.zones.length>=3);
  for(const row of rows.filter(row=>row.behaviors.some(b=>b.type==='info')))assert.equal(row.behaviors.find(b=>b.type==='info').presentation,'contextual');
 }finally{dispose(f);}
});

test('eight genuine cartons traverse every new belt, roller and curve and arrive once in the receiver',()=>{
 const f=fixture();try{
  f.scene.updateMatrixWorld(true);f.runtime.start('hall');require('../../projects/smarttwin/PublicDemoStock.cjs')(THREE,f.runtime);
  const record=object=>f.runtime.records.get(object.userData.editorId),source=record(f.built.transfer.source).components.source,receiver=record(f.built.transfer.receiver).components.palletQueue;
  const belts=f.built.transfer.belts.map(object=>record(object).components.conveyor),seen=belts.map(()=>new Set());
  for(let frame=0;frame<80*30&&receiver.queue.length<8;frame++){
   f.scene.updateMatrixWorld(true);f.runtime.execute(1/30);belts.forEach((belt,index)=>belt.packages.forEach(item=>seen[index].add(item.product.object)));
  }
  assert.equal(source.generatedUnits,8);assert.equal(receiver.queue.length,8,JSON.stringify({received:receiver.received,belts:belts.map(b=>({count:b.packages.length,blocked:b.transferBlocked,warning:b.warning}))}));
  const arrivals=new Set(receiver.queue.map(entry=>entry.product.object));assert.equal(arrivals.size,8);
  for(const crossed of seen)assert.deepEqual(crossed,arrivals,'Every arriving carton must actually have travelled on every segment.');
  assert.equal(record(f.built.robot).components.robot.fault,'');assert(record(f.built.robot).components.robot.completed>=4);
 }finally{dispose(f);}
});

test('native message engine animates either door around its hinge, opens the collision passage and restores everything on stop',()=>{
 const f=fixture(),canvases=[];
 const dom={createElement(){const drawing={fillRect(){},clearRect(){},fillText(){},measureText:text=>({width:String(text).length*8})};const canvas={getContext:()=>drawing};canvases.push(canvas);return canvas;}};
 const source=fs.readFileSync('packages/tools/editor/src/BehaviorRuntime.js','utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class BehaviorRuntime','return class BehaviorRuntime');
 const Runtime=new Function('THREE','behaviorSchema','document',source)(THREE,schema,dom);
 f.ctx.camera=new THREE.PerspectiveCamera();f.scene.add(f.ctx.camera);f.ctx.camera.position.set(-6,1.6,8.3);
 const adapter={getObjects:()=>f.built.doors,getBehaviors:object=>f.document.getBehaviors(object).filter(b=>b.type==='hingeDoor')};
 const runtime=new Runtime(f.ctx,adapter,null,()=>{});
 try{
  f.scene.updateMatrixWorld(true);f.ctx.collisionWorld.setRoom('hall');runtime.start('hall');assert.equal(runtime.states.length,2);
  for(const door of f.built.doors){
   const start=door.position.clone(),rotation=door.quaternion.clone(),x=start.x;
   f.ctx.camera.position.set(x,1.6,8.3);f.scene.updateMatrixWorld(true);
   const blocked=()=>f.ctx.collisionWorld.rayBlocked(new THREE.Vector3(x,1.2,8.5),new THREE.Vector3(x,1.2,11.5));
   assert(blocked(),'Closed door must occupy the doorway.');
   const state=runtime.states.find(entry=>entry.state.colliderMesh===door).state;assert(state.isSelectable());assert(state.handTouchable&&state.captureSelect);state.onSelectStart();
   for(let i=0;i<60;i++)runtime.execute(1/60,i/60);
   assert(door.userData.hingeDoorOpen);assert(!blocked(),'Opening the leaf must really free the wall opening.');
   const hinge=new THREE.Vector3(-door.scale.x/2,0,0).applyQuaternion(door.quaternion).add(door.position);
   assert(hinge.distanceTo(start.clone().add(new THREE.Vector3(-door.scale.x/2,0,0).applyQuaternion(rotation)))<1e-8);
   state.onSelectStart();for(let i=0;i<60;i++)runtime.execute(1/60,i/60);assert(blocked());assert(door.position.distanceTo(start)<1e-8);
  }
  runtime.stop();assert.equal(runtime.states.length,0);assert(f.built.doors.every(door=>!door.children.some(n=>n.userData.editorRuntimeHelper)));
 }finally{runtime.stop();dispose(f);}
});
