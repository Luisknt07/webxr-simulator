'use strict';
module.exports=function runPutaway(h,f,built,onProgress=()=>{}){
 const assert=require('node:assert/strict'),record=f.runtime.records.get(built.vehicleIds[0]),v=record.components.vehicle,api=f.runtime.vehicleRuntime,w=new h.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest),d=require('./cedi-dock-operator.cjs')(h).boundedDriver(f,record,{maxSimSeconds:7200}),shipments=[],originalIds=[...f.runtime.products.keys()].sort();
 assert.equal(built.manifest.facility.sharedLayout.id,'cedi-unified-u-v2');assert.equal(originalIds.length,6);
 const verify=()=>{w.update();const world=w.snapshot();assert.deepEqual(world.criticalReasons,[]);assert.equal(world.totalUnits,48);assert.deepEqual(world.materialBalance.actual,{box:48});assert.deepEqual([...f.runtime.products.keys()].sort(),originalIds,'The seven native transfers must conserve the six original products.');return world;};
 w.command('material-order',{orderId:built.materialRecipe.orderId,quantity:48});w.command('material-prepare',{method:'ruta-y-capacidad-verificadas'});
 for(const task of built.tasks.slice(0,6)){const rack=f.runtime.records.get(task.destinationId),cell=f.runtime.palletQueueRuntime.locations(rack).find(row=>row.index===task.destinationSlot);w.command('assign-stock-location',{palletId:task.productId,locationCode:cell.code});}
 api.command(record,'parkingBrake',false);
 const aisles=built.manifest.facility.sharedLayout.aisles.safePolyline,aisleX=aisles[1][0],crossZ=aisles[2][2];let forwardShift=0,sideShift=0;
 const move=(axis,target)=>{const forward=axis==='x'?Math.sin(d.yaw()):Math.cos(d.yaw());d.straight(axis,target,(target-record.object.position[axis])*forward<0);};
 // Actual rear-steered quarter turns are asymmetric about the chassis origin.
 // Measure the first loaded turn instead of borrowing the former plant's
 // coordinates or moving the carrier/pallet transforms directly.
 const fromInput=approach=>{move('z',Math.min(built.manifest.facility.bounds.maxZ-3,approach.z+3.35));const before=record.object.getWorldPosition(new h.THREE.Vector3());d.turn(-1);const change=record.object.getWorldPosition(new h.THREE.Vector3()).sub(before);if(!forwardShift){forwardShift=Math.abs(change.x);sideShift=Math.abs(change.z);}move('x',aisleX-sideShift);d.turn(1);move('z',crossZ);};
 const approachRack=target=>{const direction=Math.sign(target.x-record.object.position.x)||-1;d.turn(-direction);move('x',target.x-direction*sideShift);d.turn(direction);move('z',target.z+3.5);};
 const leaveRack=()=>{move('z',crossZ+sideShift);};
 const returnToInput=approach=>{leaveRack();const direction=Math.sign(aisleX-record.object.position.x)||1;d.turn(-direction);move('x',aisleX-direction*sideShift);d.turn(-direction);move('z',approach.z+forwardShift-sideShift);d.turn(-1);move('x',approach.x+sideShift);d.turn(-1);move('z',approach.z);};
 for(let i=0;i<6;i++){
  const task=built.tasks[i],approach=task.pickupRoute[0];
  if(i)returnToInput(approach);
  onProgress({stage:'pickup',index:i,position:record.object.position.toArray()});d.dock('pickup',task.sourceId,approach);assert(v.entry);assert.equal(v.entry.product.record.id,task.productId);assert.equal(w.product(task.productId).sourceEntry.ownerId,record.id);assert(!f.runtime.records.get(task.sourceId).components.palletQueue.queue.includes(w.product(task.productId).sourceEntry));verify();
  d.lift(api.rig(record).forks.getWorldPosition(new h.THREE.Vector3()).y+.1);move('z',approach.z);d.lift(.35);fromInput(approach);
  const destination=f.runtime.vehicleTraining.destination(record),target=new h.THREE.Vector3().setFromMatrixPosition(destination.matrix);approachRack(target);
  onProgress({stage:'drop-approach',index:i,position:record.object.position.toArray(),yaw:d.yaw(),target:target.toArray()});
  d.dock('drop',task.destinationId,{x:target.x,z:target.z+3.5,yaw:Math.PI});move('z',target.z+3.5);d.lift(.35);verify();
  const world=verify(),product=w.product(task.productId),rack=f.runtime.records.get(task.destinationId),cell=f.runtime.palletQueueRuntime.locations(rack).find(row=>row.index===task.destinationSlot);assert.equal(v.entry,null);assert.equal(product.sourceEntry.ownerId,rack.id);assert(rack.components.palletQueue.queue.includes(product.sourceEntry));assert.equal(cell.palletId,task.productId);assert.equal(world.sourceUnits,48-(i+1)*8);assert.equal(world.processedUnits,(i+1)*8);assert.equal(world.finalizedUnits,0,'Putaway alone cannot award completion before physical replenishment.');
  shipments.push({productId:task.productId,destinationId:task.destinationId,locationCode:cell.code,world});onProgress({stage:'delivered',index:i,driving:d.stats()});
 }
 w.command('material-inspect',{quantity:48,quality:'conforme'});
 const refill=built.tasks[6],source=f.runtime.records.get(refill.sourceId),product=w.product(refill.productId),rackTarget=product.object.getWorldPosition(new h.THREE.Vector3());leaveRack();const rackDirection=Math.sign(rackTarget.x-record.object.position.x)||-1;d.turn(-rackDirection);move('x',rackTarget.x-rackDirection*sideShift);d.turn(rackDirection);move('z',rackTarget.z+3.5);
 onProgress({stage:'replenishment-pickup',position:record.object.position.toArray(),target:rackTarget.toArray()});d.dock('pickup',source.id,{x:rackTarget.x,z:rackTarget.z+3.5,yaw:Math.PI});assert.equal(v.entry.product.record.id,refill.productId);assert.equal(product.sourceEntry.ownerId,record.id);assert(!source.components.palletQueue.queue.includes(product.sourceEntry));verify();d.lift(api.rig(record).forks.getWorldPosition(new h.THREE.Vector3()).y+.1);leaveRack();d.lift(.35);
 const destination=f.runtime.vehicleTraining.destination(record),target=new h.THREE.Vector3().setFromMatrixPosition(destination.matrix);d.turn(-1);move('x',target.x-sideShift);d.turn(-1);move('z',target.z-3.5);
 onProgress({stage:'replenishment-drop',position:record.object.position.toArray(),target:target.toArray()});d.dock('drop',refill.destinationId,{x:target.x,z:target.z-3.5,yaw:0});move('z',target.z-3.5);assert.equal(v.entry,null);assert.equal(product.sourceEntry.ownerId,refill.destinationId);assert(f.runtime.records.get(refill.destinationId).components.palletQueue.queue.includes(product.sourceEntry));verify();w.command('material-close',{quantity:48});
 const world=verify();assert.equal(world.sourceUnits,0);assert.equal(world.finalizedUnits,48);assert.equal(world.stageEvidence.length,6);assert.equal(d.stats().contacts,0);return{w,shipments,world,driving:d.stats(),replenishment:{productId:refill.productId,sourceId:refill.sourceId,destinationId:refill.destinationId,ownerId:product.sourceEntry.ownerId}};
};
