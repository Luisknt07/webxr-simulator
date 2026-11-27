import * as THREE from 'three';

const UP=new THREE.Vector3(0,1,0),shown=object=>{for(let n=object;n;n=n.parent)if(!n.visible)return false;return true;};
/** Explicit, local help for the free-play lesson. Never changes truck/head pose
 * or manufactures cargo. Native pickup and warehouse admission own custody. */
export default class VehicleLoadAssist {
 constructor(driving){this.driving=driving;this.pending=null;}
 get runtime(){return this.driving.simulation;}
 get api(){return this.runtime.vehicleRuntime;}
 enabled(){return !!this.driving.options.assistedLoads;}
 eligible(record,product){
  const api=this.api,r=this.runtime;
  return !!(product&&shown(product.object)&&api.compatible(product)&&!product.heldBy&&!product.robotOwnerId&&!product.robotReservedBy&&!product.vehicleOwnerId&&(!product.vehicleReservedBy||product.vehicleReservedBy===record.id)&&!api.pickupRestriction(record,product)&&(!r.vehicleTraining||!r.vehicleTraining.validatePickup(record,product)));
 }
 nearest(record){
  const forks=this.api.rig(record).forks;if(!forks)return null;forks.updateWorldMatrix(true,false);const inverse=new THREE.Matrix4().getInverse(forks.matrixWorld);let best=null;
  for(const product of this.runtime.products.values()){
   if(!this.eligible(record,product))continue;product.object.updateWorldMatrix(true,false);const box=product.bounds.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,product.object.matrixWorld)),center=box.getCenter(new THREE.Vector3());
   if(Math.abs(center.x)>.85||box.min.z>record.components.vehicle.config.forkLength+.8||box.max.z<.05||Math.abs(box.min.y)>1.4)continue;
   const distance=Math.hypot(center.x,Math.max(0,box.min.z-record.components.vehicle.config.forkLength),box.min.y*.35);if(!best||distance<best.distance)best={product,distance};
  }return best&&best.product;
 }
 pickup(){
  const d=this.driving,record=d.record();if(!record||record.components.vehicle.entry||d.blocked()||!this.api.operational(record.components.vehicle))return false;
  const product=this.nearest(record);if(!product){d.notify('Acerca las horquillas al frente de un pallet y pulsa Tomar cercano o A.');return false;}
  d.resetInput();const belt=this.runtime.records.get(product.item&&product.item.beltId);
  if(Math.abs(record.components.vehicle.actualSpeed)>.06||belt&&Math.abs(belt.components.conveyor.actualSpeed)>.025){
   this.cancel();this.pending={record,product,belt,resume:!!(belt&&belt.components.conveyor.running),deadline:this.runtime.time+3};if(belt)this.runtime.command(belt.id,'stop');d.notify('Deteniendo el movimiento para tomar el pallet…');return true;
  }
  return this.take(record,product);
 }
 take(record,product){
  if(!this.eligible(record,product))return false;
  const api=this.api,v=record.components.vehicle,rig=api.rig(record),object=product.object,savedPose={...v.pose};object.updateWorldMatrix(true,true);const saved=object.matrixWorld.clone(),position=object.getWorldPosition(new THREE.Vector3()),rotation=object.getWorldQuaternion(new THREE.Quaternion()),scale=object.getWorldScale(new THREE.Vector3());
  let accepted=false;
  try{
   const pose={...v.pose,tilt:0,sideShift:0,turret:0};api.applyPose(record,pose,false);rig.forks.updateWorldMatrix(true,false);
   const height=position.y+api.productPockets(product).maxY*scale.y-.004,delta=height-rig.forks.getWorldPosition(new THREE.Vector3()).y;
   if(v.config.family==='telehandler'||pose.lift+delta<0||pose.lift+delta>v.config.maxLift)return false;
   pose.lift+=delta;api.applyPose(record,pose,false);const forkRotation=rig.forks.getWorldQuaternion(new THREE.Quaternion()),axes=api.productPockets(product).approachAxes||['x','z'];let wanted=null,error=Infinity;
   for(const axis of axes)for(const angle of axis==='x'?[Math.PI/2,-Math.PI/2]:[0,Math.PI]){const q=forkRotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP,-angle)),difference=q.angleTo(rotation);if(difference<error){error=difference;wanted=q;}}
   if(!wanted||error>Math.PI/3)return false;
   const inverse=new THREE.Matrix4().getInverse(rig.forks.matrixWorld),relative=new THREE.Matrix4().multiplyMatrices(inverse,new THREE.Matrix4().compose(new THREE.Vector3(),wanted,scale));relative.setPosition(0,0,0);
   const box=product.bounds.clone().applyMatrix4(relative),center=box.getCenter(new THREE.Vector3()),origin=rig.forks.localToWorld(new THREE.Vector3(-center.x,0,.05-box.min.z));origin.y=position.y;
   const target=new THREE.Matrix4().compose(origin,wanted,scale);if(origin.distanceTo(position)>1.2)return false;
   this.runtime.setProductMatrix(product,target);
   accepted=api.pickup(record,product,true);return accepted;
  }finally{
   if(!accepted){this.runtime.setProductMatrix(product,saved);api.applyPose(record,savedPose,false);}
   this.feedback(accepted,accepted?'Pallet tomado. Conduce hasta la estantería y pulsa A o Colocar cerca de un hueco libre.':'Acércate un poco más al frente del pallet; la ayuda mantiene libre el espacio de carga.');
  }
 }
 release(){
  const d=this.driving,record=d.record(),v=record&&record.components.vehicle;if(!v||!v.entry||d.blocked()||!this.api.operational(v))return false;
  d.resetInput();if(Math.abs(v.actualSpeed)>.06){d.notify('Detén el montacargas junto a la estantería para colocar el pallet.');return false;}
  const product=v.entry.product;product.object.updateWorldMatrix(true,false);const center=product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(product.object.matrixWorld),choices=[];
  for(const target of this.runtime.records.values()){
   if(!target.components.palletQueue||!shown(target.object))continue;
   const placement=this.runtime.palletQueueRuntime.placement(target,product,[],center,false,()=>[record.object]);if(!placement)continue;
   const p=placement.bounds.getCenter(new THREE.Vector3()),distance=Math.hypot(center.x-p.x,center.z-p.z)+Math.abs(center.y-p.y)*.35;
   if(Math.hypot(center.x-p.x,center.z-p.z)<=.95&&Math.abs(center.y-p.y)<=1.5)choices.push({destination:{kind:'stock',targetId:target.id,matrix:placement.matrix,placement},distance});
  }
  choices.sort((a,b)=>a.distance-b.distance);
  for(const choice of choices)if(this.api.release(record,choice.destination,true,true)){this.feedback(true,'Pallet colocado en un hueco libre de la estantería.');return true;}
  const result=this.api.release(record,undefined,true);this.feedback(result,result?'Pallet depositado.':'Acerca el pallet a un hueco libre; la ayuda ajustará la altura y el centrado.');return result;
 }
 update(){
  const task=this.pending;if(!task)return false;
  const d=this.driving;if(d.record()!==task.record||d.blocked()||!this.api.operational(task.record.components.vehicle)||this.runtime.time>task.deadline||this.runtime.products.get(task.product.object)!==task.product){this.cancel();return false;}
  if((!task.belt||Math.abs(task.belt.components.conveyor.actualSpeed)<=.025)&&Math.abs(task.record.components.vehicle.actualSpeed)<=.06){this.pending=null;if(this.nearest(task.record)===task.product)this.take(task.record,task.product);this.resume(task);return false;}
  return true;
 }
 resume(task){const belt=task&&task.belt&&task.belt.components.conveyor;if(task&&task.resume&&belt&&!belt.emergency&&belt.powered&&!belt.paused)this.runtime.command(task.belt.id,'start');}
 cancel(){const task=this.pending;this.pending=null;if(task)this.resume(task);}
 feedback(ok,message){const d=this.driving;if(ok)d.operatorIntent=d.record().components.vehicle.entry?'transport':'auto';d.guideUpdated=d.hudUpdated=-Infinity;d.notify(message);}
}
