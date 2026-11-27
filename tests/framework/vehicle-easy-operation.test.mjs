import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),h=require('../legacy/test-vehicle-driving.js'),THREE=require('three');
const CollisionWorld=require('../../packages/render-three/src/CollisionWorld.js').default;
const LoadAssist=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleLoadAssist.js').default;
function fixture(){const f=h.setup(true,true);f.ctx.graphics={hints:{standaloneXR:true}};f.driving.options.assistedLoads=true;assert(f.driving.boardAndStart(f.record.id));return {...f,close(){f.driving.dispose();f.runtime.stop();}};}

test('one action starts the cab, releases P and requires fresh neutral controller input',()=>{
 const f=h.setup(true),pad=h.pad('left');f.ctx.raycontrol.controllers.push(pad);h.axis(pad,0,-1);Object.assign(f.v,{powered:false,running:false,paused:true,parkingBrake:true});
 try{
  assert(f.driving.boardAndStart(f.record.id));assert(f.v.powered&&f.v.running&&!f.v.paused&&!f.v.parkingBrake);
  for(let i=0;i<5;i++)f.driving.beforeStep();assert.equal(f.v.input.throttle,0);
  h.axis(pad,0,0);f.driving.beforeStep();h.axis(pad,0,-1);f.driving.beforeStep();assert(f.v.input.throttle>0);
  const count=f.commands.length;assert(f.driving.command('quickStart'));assert.equal(f.commands.length,count,'A second click must not toggle the brake or restart.');
  f.driving.command('powerOff');f.driving.paintWorldPanel();const region=f.driving.worldPanel.regions.find(r=>r.action==='quickStart');assert(region&&region.w>900&&region.h>100);
  f.driving.worldState.state.onSelectStart({uv:{x:(region.x+region.w/2)/1024,y:1-(region.y+region.h/2)/640}},new THREE.Group());assert(f.v.powered&&f.v.running&&!f.v.parkingBrake);
 }finally{f.driving.dispose();f.runtime.stop();}
});

test('quick start respects emergency, training, depleted battery and open-menu gates',()=>{
 const f=fixture();try{
  f.driving.command('emergency');const count=f.commands.length;assert.equal(f.driving.command('quickStart'),false);assert(f.v.emergency&&!f.v.running);assert.equal(f.commands.length,count);
  f.driving.command('resetEmergency');f.v.enabled=false;assert.equal(f.driving.command('quickStart'),false);assert(!f.v.running);f.v.enabled=true;
  f.v.batteryPercent=0;assert.equal(f.driving.command('quickStart'),false);assert(!f.v.running);f.v.batteryPercent=80;
  f.ctx.publicDialogOpen=true;assert.equal(f.driving.command('quickStart'),false);assert(!f.v.running);f.ctx.publicDialogOpen=false;
  assert(f.driving.command('quickStart'));assert(f.v.running);
 }finally{f.close();}
});

test('explicit local help picks the actual offset pallet and preserves identity, mass and population',()=>{
 const f=fixture();try{
  f.ctx.collisionWorld=new CollisionWorld(f.ctx,f.document);f.ctx.collisionWorld.setRoom('hall');const product=f.runtime.products.get(f.pallet),mass=f.runtime.productMetadata(product).mass,population=f.runtime.products.size;
  f.pallet.position.x=.28;f.pallet.position.z+=.35;f.scene.updateMatrixWorld(true);assert(!f.api.pickupPlan(f.record,product).ready);
  assert(f.driving.command('pickup'),f.notices.at(-1));assert.equal(f.v.entry.product,product);assert.equal(product.vehicleOwnerId,f.record.id);assert.equal(f.v.received,1);assert.equal(f.runtime.products.size,population);assert.equal(f.runtime.productMetadata(product).mass,mass);
 }finally{f.close();}
});

test('failed or ineligible pickup rolls back the pallet and actual hydraulic pose',()=>{
 for(const kind of ['far','reserved','heavy','obstacle']){
  const f=fixture();try{
   const p=f.runtime.products.get(f.pallet);f.pallet.position.x=.25;if(kind==='far')f.pallet.position.z+=4;if(kind==='reserved')p.robotReservedBy='another-robot';if(kind==='heavy')f.v.config.payloadKg=1;
   if(kind==='obstacle'){f.ctx.collisionWorld=new CollisionWorld(f.ctx,f.document);f.ctx.collisionWorld.setRoom('hall');const wall=new THREE.Mesh(new THREE.BoxBufferGeometry(.2,2,3),new THREE.MeshBasicMaterial());wall.position.set(0,1,f.pallet.position.z);f.root.add(wall);f.ctx.collisionWorld.invalidate(wall);}
   f.scene.updateMatrixWorld(true);const matrix=p.object.matrixWorld.toArray(),pose={...f.v.pose};assert.equal(f.driving.command('pickup'),false,kind);assert.equal(f.v.entry,null);assert.deepEqual(p.object.matrixWorld.toArray(),matrix,kind);assert.deepEqual(f.v.pose,pose);assert.equal(f.v.received,0);
  }finally{f.close();}
 }
});

test('a queued pickup brakes first and menu or emergency cancellation cannot pick up later',()=>{
 for(const cancel of [null,'menu','emergency']){const f=fixture();try{
  f.pallet.position.x=.2;f.pallet.position.z+=.25;f.scene.updateMatrixWorld(true);f.v.actualSpeed=.2;assert(f.driving.command('pickup'));assert(f.driving.loadAssist.pending);assert.equal(f.v.entry,null);f.driving.beforeStep();assert.equal(f.v.input.throttle,0);assert.equal(f.v.input.brake,1);
  if(cancel==='menu')f.ctx.publicDialogOpen=true;if(cancel==='emergency')f.driving.command('emergency');
  f.v.actualSpeed=0;f.driving.beforeStep();assert.equal(f.driving.loadAssist.pending,null);assert.equal(!!f.v.entry,!cancel);
  if(cancel){f.ctx.publicDialogOpen=false;f.driving.beforeStep();assert.equal(f.v.entry,null);}
 }finally{f.close();}}
});

// The real rack/document fixture also exercises native stock custody and capacity.
const source=fs.readFileSync('tests/legacy/test-vehicle-drop-placement.js','utf8');
const rackFixture=new Function('require','__dirname',source.slice(0,source.indexOf('const bay=fixture()'))+'\nreturn {fixture,dockAt,close};')(createRequire(path.resolve('tests/legacy/test-vehicle-drop-placement.js')),path.resolve('tests/legacy'));
function rack(){const f=rackFixture.fixture(true);f.ctx.graphics={hints:{standaloneXR:true}};const target=f.guide.getTargets().find(t=>t.allowed&&f.guide.targets.find(raw=>raw.id===t.id).matrix.elements[13]>1.5);assert(target);f.guide.setTarget(target.id);rackFixture.dockAt(f,f.guide.currentTarget);f.truck.position.x+=.4;f.truck.position.z-=.25;f.api.applyPose(f.record,{...f.v.pose,lift:f.v.pose.lift-.6},false);f.scene.updateMatrixWorld(true);f.api.carry(f.record,false);const floor=new THREE.Mesh(new THREE.BoxBufferGeometry(100,.05,100),new THREE.MeshBasicMaterial());floor.position.y=-.025;f.root.add(floor);f.ctx.collisionWorld=new CollisionWorld(f.ctx,f.document);f.ctx.collisionWorld.setRoom('hall');Object.assign(f.driving,{options:{assistedLoads:true},resetInput(){},notify(){}});f.assist=new LoadAssist(f.driving);return f;}

test('assisted rack release tolerates nearby offsets and height, retaining native stock custody',()=>{
 const f=rack();try{
  const entry=f.v.entry,population=f.runtime.products.size,mass=f.runtime.productMetadata(f.product).mass;assert(!f.api.releasePlan(f.record,f.guide.currentTarget.destination).ready);
  assert(f.assist.release(),f.v.warning);assert.equal(f.v.entry,null);assert.equal(f.stock.queue.length,1);assert.equal(f.stock.queue[0],entry);assert.equal(entry.product,f.product);assert.equal(f.v.delivered,1);assert.equal(f.runtime.products.size,population);assert.equal(f.runtime.productMetadata(f.product).mass,mass);assert(!f.product.vehicleOwnerId);
 }finally{rackFixture.close(f);}
});

test('rack assistance preserves moving, occupied and obstacle restrictions',()=>{
 for(const kind of ['moving','occupied','obstacle']){const f=rack();try{
  const entry=f.v.entry,d=f.guide.currentTarget.destination;
  if(kind==='moving')f.v.actualSpeed=.2;
  if(kind==='occupied'){f.stock.config.capacity=1;f.stock.queue.push({id:'occupied'});}
  if(kind==='obstacle'){const wall=new THREE.Mesh(new THREE.BoxBufferGeometry(3,5,3),new THREE.MeshBasicMaterial());wall.position.copy(f.product.bounds.clone().applyMatrix4(d.matrix).getCenter(new THREE.Vector3()));f.root.add(wall);f.scene.updateMatrixWorld(true);f.ctx.collisionWorld.invalidate(wall);}
  assert.equal(f.assist.release(),false,kind);assert.equal(f.v.entry,entry);assert.equal(f.v.delivered,0);
 }finally{rackFixture.close(f);}}
});

test('a named rack destination checks that cell once and never substitutes an occupied slot',()=>{
 const f=rack();try{
  const target=f.guide.currentTarget,d=target.destination,receiver=f.runtime.records.get(d.targetId),api=f.runtime.palletQueueRuntime,center=f.product.bounds.clone().applyMatrix4(d.matrix).getCenter(new THREE.Vector3());let checks=0;const world=f.ctx.collisionWorld,check=world.testBox.bind(world);world.testBox=(...args)=>{checks++;return check(...args);};
  const placement=api.placement(receiver,f.product,[],center,false,()=>[f.record.object],d.placement.palletIndex);assert(placement);assert.equal(placement.palletIndex,d.placement.palletIndex);assert.equal(checks,1);
  f.stock.items.push({palletIndex:d.placement.palletIndex,palletSlot:0});checks=0;assert.equal(api.placement(receiver,f.product,[],center,false,()=>[f.record.object],d.placement.palletIndex),null);assert.equal(checks,0);
 }finally{rackFixture.close(f);}
});

test('the actual conveyor stops for assisted pickup, transfers its pallet once and resumes',()=>{
 const f=rackFixture.fixture();f.guide.dispose();f.runtime.stop();
 const beltObject=f.document.addPrefab('hall','conveyor','pallet-chain');beltObject.position.set(0,.65,4);
 f.document.setBehaviors(beltObject,f.document.getBehaviors(beltObject).map(c=>c.type==='conveyor'?{...c,powered:true,running:true,autoSpawn:false,length:2.4,width:1.4,supportHeight:.65,speed:.25,maxLoad:150,clearance:1.5,maxPackages:1}:c));f.scene.updateMatrixWorld(true);f.runtime.start('hall');
 try{
  const runtime=f.runtime,api=runtime.vehicleRuntime,record=runtime.records.get(f.truck.userData.editorId),v=record.components.vehicle,product=runtime.products.get(f.product.object),beltRecord=runtime.records.get(beltObject.userData.editorId),belt=beltRecord.components.conveyor;
  assert(runtime.captureProduct(product,{record:beltRecord,belt,offset:0,route:'main',lateral:0}),JSON.stringify({compatible:runtime.productCompatible(beltRecord,belt,product),admission:runtime.admissionReady(beltRecord,belt,false),warnings:[...beltRecord.warned],config:belt.config,metadata:runtime.productMetadata(product)}));f.scene.updateMatrixWorld(true);
  const dock=api.pickupDock(record,{targetId:beltRecord.id,yaw:Math.PI},product);assert(dock);f.truck.position.copy(dock.position).add(new THREE.Vector3(.2,0,.2));f.truck.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),dock.yaw);f.scene.updateMatrixWorld(true);api.applyPose(record,{...v.pose,lift:Math.max(0,dock.toolY-v.originWorld.y-v.config.forkBaseHeight-.2)},false);f.scene.updateMatrixWorld(true);v.driving=true;v.parkingBrake=false;
  const driving={simulation:runtime,options:{assistedLoads:true},record:()=>record,blocked:()=>false,notify(){},resetInput(){api.setInput(record,{throttle:0,brake:1});}},assist=new LoadAssist(driving);
  belt.actualSpeed=.25;assert(assist.pickup());assert(assist.pending);assert.equal(belt.running,false);assert.equal(v.entry,null);
  for(let i=0;i<120&&!v.entry;i++){f.scene.updateMatrixWorld(true);runtime.execute(1/60);assist.update();}
  assert.equal(v.entry?.product,product,v.warning);assert.equal(assist.pending,null);assert.equal(belt.running,true);assert.equal(belt.packages.length,0);assert.equal(v.received,1);assert.equal(product.vehicleOwnerId,record.id);
 }finally{f.runtime.stop();}
});
