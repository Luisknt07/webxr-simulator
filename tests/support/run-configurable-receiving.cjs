'use strict';
// The operator uses native steering, pedals, hydraulics and G/K commands in
// the shared CEDI. No actor transform, inventory or completion is assigned.
module.exports=function runReceiving(h,f,built,onProgress=()=>{}){
 const assert=require('node:assert/strict'),ops=require('./cedi-dock-operator.cjs')(h),record=f.runtime.records.get(built.vehicleIds[0]),v=record.components.vehicle,api=f.runtime.vehicleRuntime,w=new h.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest),d=ops.boundedDriver(f,record,{maxSimSeconds:3600}),shipments=[],layout=built.manifest.facility.sharedLayout;
 assert(layout&&layout.id==='cedi-unified-u-v2','The receiving operator must use the current shared U facility.');
 const arcRadius=v.config.wheelbase/Math.tan(v.config.steerLimit*.8),forwardSide=arcRadius+v.config.wheelbase/2,reverseSide=arcRadius-v.config.wheelbase/2,inspection=built.manifest.receiving.inspectionCenter,travelX=layout.aisles.safePolyline[1][0];
 const verifyCustody=()=>{const world=w.snapshot();assert.deepEqual(world.criticalReasons,[]);assert.equal(world.totalUnits,48);return world;};
 const shiftWhileForward=(targetX,heading)=>{
  const sign=Math.sign(targetX-record.object.position.x);if(Math.abs(targetX-record.object.position.x)<.04)return;
  const turn=heading===0?sign:-sign;d.turn(turn);const middle=targetX-sign*forwardSide;
  d.straight('x',middle,sign*(middle-record.object.position.x)<0);d.turn(-turn);
 };
 try{
  w.command('arrival-check',{orderId:built.manifest.receiving.orderId,boxes:48,dockId:'E02'});w.command('secure-dock',{secured:'checked'});api.command(record,'parkingBrake',false);
  for(let i=0;i<6;i++){
   const task=built.tasks[i],approach=task.pickupRoute[0],receiver=f.runtime.records.get(task.destinationId),target=receiver.object.position;
   const receiverFront=new h.THREE.Vector3(0,0,1).applyQuaternion(receiver.object.quaternion);assert(receiverFront.z<-.99,'Receiving floor bays must face the clear north aisle, rather than the weigh station.');
   if(i){
    d.straight('z',16.5,true);d.turn(1,true);d.straight('x',approach.x-reverseSide);d.turn(1,true);d.straight('z',approach.z);
   }
   onProgress({stage:'pickup-approach',pallet:i+1,position:record.object.position.toArray()});d.dock('pickup',task.sourceId,{...approach,yaw:0});ops.heldChecks(f,built,w,record,i);verifyCustody();
   d.lift(.35);d.straight('z',12.5,true);shiftWhileForward(inspection[0],0);
   const loadOffset=v.entry.product.object.getWorldPosition(new h.THREE.Vector3()).z-record.object.getWorldPosition(new h.THREE.Vector3()).z;d.straight('z',inspection[2]-loadOffset,true);d.stop();
   const palletId=task.productId,observed=verifyCustody().pallets.find(row=>row.id===palletId);assert(observed.inInspection,'The original load must physically stop at inspection.');assert.equal(observed.quality,'good','This prepared run requires its six conforming pallets.');
   w.command('inspect-pallet',{palletId,boxes:observed.units,massKg:observed.massKg,lotId:observed.lotId});w.command('disposition',{palletId,decision:'released'});w.command('register-pallet',{palletId,orderId:built.manifest.receiving.orderId});
   const before=w.snapshot().totalUnits;w.command('register-pallet',{palletId,orderId:built.manifest.receiving.orderId});assert.equal(w.snapshot().totalUnits,before);assert.equal(Object.keys(w.state.registrations).length,i+1);
   // Follow the authored front exit: the new receiving roller bank occupies
   // the former rear reversing lane. Clear the weighing platform and staged
   // pallets before turning into the real east receiving aisle. Never move
   // machines, relax contact guards or drive through a conveyor to pass QA.
   assert.equal(built.manifest.receiving.inspectionExit.x,inspection[0]);
   d.straight('z',built.manifest.receiving.inspectionExit.z);d.turn(1);d.straight('x',travelX-forwardSide);d.turn(1);d.straight('z',18.5,true);shiftWhileForward(target.x,Math.PI);
   const dropApproach=target.z+3;d.straight('z',dropApproach,dropApproach>record.object.position.z);d.dock('drop',task.destinationId,{x:target.x,z:dropApproach,yaw:Math.PI});d.straight('z',dropApproach,true);
   const world=verifyCustody(),product=world.pallets.find(row=>row.id===palletId);assert(product.inReleased&&!product.held&&product.ownerId===task.destinationId);assert.equal(world.receiverUnits,(i+1)*8);
   shipments.push({palletId,sourceId:task.sourceId,destinationId:task.destinationId,units:observed.units,massKg:observed.massKg,lotId:observed.lotId,simulationSeconds:f.runtime.time,driving:d.stats()});onProgress({stage:'delivered',pallet:i+1,releasedUnits:world.receiverUnits,driving:d.stats()});
  }
  w.command('confirm-handover',{boxes:48});return{workflow:w,world:verifyCustody(),shipments,driving:d.stats()};
 }catch(error){error.message+=' · '+ops.diagnostics(f,record);w.dispose();throw error;}
};
