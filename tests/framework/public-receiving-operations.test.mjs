import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),fixture=require('../support/public-demo-fixture.cjs');

test('reception requires authorization, preserves declared SKU/quality and cancels only pending quantities',()=>{
 const f=fixture({manual:true}),o=f.operations;try{
  f.tick(4);assert.equal(o.snapshot().generated,0);assert.equal(o.orders.length,0);
  const product=o.addProduct({id:'QA-CRATE',name:'Retornable dañado',type:'crate',quality:'defective',mass:3});
  const order=o.createOrder(product.id,3);f.tick(1);assert.equal(o.snapshot().generated,0);o.authorize(order.id);o.pauseReceiving();f.tick(1);assert.equal(o.snapshot().generated,0);o.pauseReceiving();
  o.command('stop');f.tick(1);assert.equal(o.snapshot().generated,0);o.command('start');
  // Keep the new real load on the reception tray for inspection and withdrawal.
  o.holdReceiving();assert(o.snapshot().receptionHeld);f.tick(.2);
  let load=o.snapshot().loads.find(p=>p.sku===product.id);assert(load&&load.withdrawable);assert.equal(load.mass,3);assert.equal(load.quality,'defective');
  assert.equal(o.inspect(load.id).inspected,true);const entry=o.entry(load.id),body=entry.product?.object;o.withdraw(load.id);assert(!o.snapshot().loads.some(p=>p.id===load.id));assert.equal(o.snapshot().withdrawn,1);assert(!body||!f.runtime.products.has(body));
  o.cancelOrder(order.id);assert.equal(order.admitted,1);f.tick(4);assert.equal(o.snapshot().generated,1);assert.equal(o.snapshot().total,1,'Cancelling pending goods must retain already admitted quantities in the indicators.');
  assert.throws(()=>o.addProduct({...product,id:'heavy',mass:11}),/10 kg/);assert.throws(()=>o.createOrder(product.id,17),/16/);assert.throws(()=>o.createOrder('missing',1),/tipología/);
 }finally{f.close();}
});

test('three received plastic crates become a real partial pallet and can be forked, inspected and shipped',()=>{
 const f=fixture({manual:true}),o=f.operations,s=f.runtime,T=f.THREE;try{
  o.createOrder('demo-crate',3);o.authorize();const robot=f.record(f.built.robot).components.robot;
  for(let i=0;i<100*30&&!(robot.completed===3&&!robot.entry&&['idle','return'].includes(robot.phase));i++){f.tick(1/30);assert.equal(robot.fault,'');}
  assert.equal(robot.completed,3);assert(o.finishPallet());f.tick(22);
  const belt=f.record(f.built.pickup),product=belt.components.conveyor.packages[0]?.product;assert(product,'The closed partial pallet reaches collection physically.');
  const entry=product.sourceEntry;assert.equal(entry.units,3);assert.equal(entry.members.length,3);assert.equal(s.productMetadata(product).mass,31);assert(entry.members.every(m=>m.spec.id==='demo-crate'&&m.product.object.parent===product.object));
  entry.members[0].spec.quality='defective';entry.members[0].spec.defect='damaged';assert.equal(o.snapshot().loads.find(p=>p.id===entry.id).quality,'defective','Inspection must reveal a damaged carton inside an assembled pallet.');
  const truck=f.record(f.built.vehicle),v=truck.components.vehicle,api=s.vehicleRuntime,forward=new T.Vector3(0,0,1).applyQuaternion(truck.object.quaternion),dock=api.pickupDock(truck,{targetId:belt.id,yaw:Math.atan2(forward.x,forward.z)},product);assert(dock);
  s.setVariable(belt.id,'running',false);truck.object.position.copy(dock.position);truck.object.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),dock.yaw);f.scene.updateMatrixWorld(true);assert(api.applyPose(truck,{...v.pose,lift:dock.toolY-v.originWorld.y-v.config.forkBaseHeight},false));assert(api.pickup(truck,product),v.warning);assert.equal(v.entry,entry);
  const dispatch=f.record(f.built.destination),placement=s.palletQueueRuntime.placement(dispatch,product);assert(placement);const destination={kind:'stock',targetId:dispatch.id,matrix:placement.matrix,placement};
  const drop=api.dropDock(truck,{},destination);truck.object.position.copy(drop.position);truck.object.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),drop.yaw);f.scene.updateMatrixWorld(true);assert(api.applyPose(truck,{...v.pose,lift:drop.toolY-v.originWorld.y-v.config.forkBaseHeight},false));api.carry(truck,false);f.scene.updateMatrixWorld(true);assert(api.release(truck,destination),v.warning);
  assert.throws(()=>o.ship(entry.id),/inspecciónala/);o.inspect(entry.id);assert(o.snapshot().loads.find(p=>p.id===entry.id).shippable);o.ship(entry.id);const result=o.snapshot();assert.equal(result.shipped,1);assert.equal(result.shippedUnits,3);assert.equal(result.shipments[0].mass,31);assert.equal(dispatch.components.palletQueue.queue.length,0);assert(!s.products.has(product.object));
 }finally{f.close();}
});
