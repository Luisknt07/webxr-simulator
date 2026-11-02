'use strict';
module.exports=function runReceiving(h,f,built,onProgress=()=>{}){
 const record=f.runtime.records.get(built.vehicleIds[0]),v=record.components.vehicle,api=f.runtime.vehicleRuntime,w=new h.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest),d=require('./practice-manual-driver.cjs')(h,f,record),shipments=[];
 w.command('arrival-check',{orderId:built.manifest.receiving.orderId,boxes:48,dockId:'E02'});w.command('secure-dock',{secured:'checked'});api.command(record,'parkingBrake',false);
 const verifyCustody=()=>{const world=w.snapshot();if(world.criticalReasons.length)throw Error(world.criticalReasons.join(' '));if(world.totalUnits!==48)throw Error('The native material total changed.');return world;};
 for(let i=0;i<6;i++){
  const task=built.tasks[i],approach=task.pickupRoute[0],target=f.runtime.records.get(task.destinationId).object.position;
  if(i){d.straight('z',approach.z,true);const r=d.turn(-1,true);d.straight('x',approach.x-r-v.config.wheelbase/2,true);d.turn(1,false);}
  onProgress({stage:'pickup-approach',pallet:i+1,position:record.object.position.toArray()});d.dock('pickup',task.sourceId,approach);verifyCustody();
  const current=api.rig(record).forks.getWorldPosition(new h.THREE.Vector3()).y;d.lift(current+.08);d.straight('z',approach.z,true);d.lift(.35);
  const radius=d.turn(1,true);d.straight('x',-5.5+radius+v.config.wheelbase/2,true);d.turn(-1,false);d.straight('z',-2.8,false);d.stop();
  const palletId=task.productId;w.command('inspect-pallet',{palletId,boxes:8,massKg:60,lotId:built.manifest.receiving.lotId});w.command('disposition',{palletId,decision:'released'});w.command('register-pallet',{palletId,orderId:built.manifest.receiving.orderId});
  const before=w.snapshot().totalUnits;w.command('register-pallet',{palletId,orderId:built.manifest.receiving.orderId});if(w.snapshot().totalUnits!==before||Object.keys(w.state.registrations).length!==i+1)throw Error('Repeated reception created inventory or duplicate registrations.');
  d.straight('z',2,true);const r2=d.turn(1,true);d.straight('x',target.x+r2+v.config.wheelbase/2,true);d.turn(-1,false);d.straight('z',target.z+3,target.z+3>record.object.position.z);d.dock('drop',task.destinationId,{x:target.x,z:target.z+3});d.straight('z',target.z+3,true);
  const world=verifyCustody(),product=world.pallets.find(row=>row.id===palletId);if(!product.inReleased||product.held||product.ownerId!==task.destinationId)throw Error('The original pallet did not reach its native destination queue.');
  if(world.receiverUnits!==(i+1)*8)throw Error('A reception counter differs from actual released custody.');
  shipments.push({palletId,sourceId:task.sourceId,destinationId:task.destinationId,units:8,massKg:60,simulationSeconds:f.runtime.time,driving:d.stats()});onProgress({stage:'delivered',pallet:i+1,releasedUnits:world.receiverUnits,driving:d.stats()});
 }
 w.command('confirm-handover',{boxes:48});return{workflow:w,world:verifyCustody(),shipments,driving:d.stats()};
};
