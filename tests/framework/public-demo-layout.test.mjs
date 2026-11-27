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

test('public recipe has a native dashboard, one robot, six belts, reachable stock and two real wall openings',async()=>{
 const f=fixture();try{
  const saved=await f.document.serialize(),rows=saved.rooms.hall.additions;
  const count=type=>rows.filter(row=>row.behaviors.some(b=>b.type===type)).length;
  assert.equal(count('robot'),1);assert.equal(count('conveyor'),6);assert.equal(count('lineMonitor'),1);assert.equal(count('hingeDoor'),2);assert.equal(count('info'),6);assert.equal(count('control'),0);
  assert(!rows.some(row=>row.name==='CEDI · RV pared frontal'||/guía de la práctica/.test(row.name)));
  validateDocument(saved,()=>{throw Error('No external imports');});
  assert.equal(f.built.rackLayout.cells.length,12);assert.equal(f.built.rackStock.length,4);
  assert(rows.filter(row=>row.behaviors.some(b=>b.type==='source'&&b.autoGenerate)).length===1);
  assert(f.built.rackLayout.cells.every(cell=>cell.position[1]+f.built.rack.position.y<=3));
  const floor=rows.find(row=>row.descriptor.type==='industrialFloor').descriptor;
  assert(floor.walkways.some(box=>box[0]<-6&&box[2]>-6&&box[3]===10));assert(floor.walkways.some(box=>box[0]<12&&box[2]>12&&box[3]===10));
  assert(floor.crossings.length&&floor.bays.length&&floor.zones.length>=3);
  for(const row of rows.filter(row=>row.behaviors.some(b=>b.type==='info')))assert.equal(row.behaviors.find(b=>b.type==='info').presentation,'contextual');
 }finally{dispose(f);}
});

test('the same eight cartons traverse every belt and the real robot makes two 33kg pallets without collisions',()=>{
 const f=require('../support/public-demo-fixture.cjs')();try{
  const Ops=require('../../projects/smarttwin/PublicDemoOperations.js').default,operations=new Ops(f.runtime),record=f.record;
  const belts=f.built.transfer.belts.map(object=>record(object).components.conveyor),seen=belts.map(()=>new Set()),robot=record(f.built.robot).components.robot;
  for(let frame=0;frame<150*30&&robot.completed<8;frame++){
   f.tick(1/30);belts.forEach((belt,index)=>belt.packages.forEach(item=>seen[index].add(item.product.object)));assert.equal(robot.fault,'');
  }
  const s=operations.snapshot();assert.equal(s.generated,8);assert.equal(s.arrived,8);assert.equal(s.palletized,8);assert.equal(s.pallets,2);assert.equal(s.waiting,0);
  const pallets=[...f.runtime.products.values()].filter(product=>product.sourceEntry?.load?.physicalAssembly);
  assert.equal(pallets.length,2);const originals=new Set(pallets.flatMap(product=>product.sourceEntry.members.map(entry=>entry.product.object)));assert.equal(originals.size,8);
  for(const crossed of seen)assert.deepEqual(crossed,originals,'The physical pallet members crossed every transport segment.');
  for(const product of pallets){assert.equal(f.runtime.productMetadata(product).mass,33);assert.equal(product.sourceEntry.members.length,4);assert(product.sourceEntry.members.every(entry=>entry.product.object.parent===product.object));}
 }finally{dispose(f);}
});

test('dashboard commands preserve the lot, emergency stays latched and reset requires an explicit start',()=>{
 const f=require('../support/public-demo-fixture.cjs')();try{
  const Ops=require('../../projects/smarttwin/PublicDemoOperations.js').default,o=new Ops(f.runtime);f.tick(4);o.command('stop');
  const poses=[...f.runtime.products.values()].map(p=>[p.object,p.object.matrixWorld.toArray()]),count=o.snapshot().generated;f.tick(1);
  assert.equal(o.snapshot().generated,count);for(const [object,matrix]of poses)assert.deepEqual(object.matrixWorld.toArray(),matrix);
  o.command('emergency');o.command('emergency');const members=f.runtime.lineLookup.get(o.refs().source.id).memberIds;
  assert(members.every(id=>f.runtime.machineComponent(f.runtime.records.get(id)).emergency));
  assert.throws(()=>o.command('start'),/emergencia/);o.command('resetEmergency');assert(members.every(id=>!f.runtime.machineComponent(f.runtime.records.get(id)).running));
  o.command('start');f.tick(1);assert.equal(o.snapshot().generated,count);assert(members.every(id=>!f.runtime.machineComponent(f.runtime.records.get(id)).emergency));
  const robot=o.refs().robot;o.command('stop',robot.id);assert(!robot.components.robot.running);assert(o.refs().source.components.source.running);o.command('start',robot.id);assert(robot.components.robot.running);
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
