'use strict';
// Bounded contact model for manually driven trucks. SI units; the configured
// capacity remains the hydraulic limit. Custody is committed by VehicleRuntime.
function create(T,api){
 const rt=api.runtime,V=()=>new T.Vector3(),Q=()=>new T.Quaternion(),M=()=>new T.Matrix4(),clamp=T.Math.clamp;
 const model={};
 model.enabled=record=>{const v=record.components.vehicle;return v.config.naturalHandling!==false&&!!api.rig(record).forks&&!['cart','tow'].includes(v.config.family)&&(v.driving||rt.ctx.drivingVehicle===record.id);};
 model.factor=record=>{const v=record.components.vehicle,m=v.entry&&rt.productMetadata(v.entry.product);return m?1/(1+.7*m.mass/Math.max(1,api.capacity(v,m))):1;};
 model.impact=(record,movement,speed,dt)=>{
  if(!model.enabled(record)||movement.lengthSq()<1e-10||speed<.01)return;const v=record.components.vehicle,parts=api.mechanismBoxes(record),body=api.bodyBox(record),direction=movement.clone().normalize(),motor=(900+v.config.payloadKg*1.5)*v.config.acceleration;
  for(const p of rt.products.values()){
   if(p.vehicleOwnerId||p.robotOwnerId||p.heldBy||p.packedInto||p.item&&(p.item.beltId||p.item.palletOwnerId)||!api.compatible(p))continue;
   const box=p.bounds.clone().applyMatrix4(p.object.matrixWorld),center=box.getCenter(V());if(Math.abs(box.min.y-v.originWorld.y)>.08||center.sub(body.getCenter(V())).dot(direction)<=0)continue;
   if(!box.clone().expandByScalar(.012).intersectsBox(body)&&!parts.forks.some(fork=>box.clone().expandByScalar(.012).intersectsBox(fork)))continue;
   const mass=rt.productMetadata(p).mass,force=motor-.35*mass*9.81;if(force<=0)return;
   const impulse=Math.min(.45,speed*.7+.03,force*dt/mass);p.directVelocity=direction.clone().multiplyScalar(impulse);p.directAngular=V();rt.manualProducts.sleeping.delete(p);rt.manualProducts.fall(p);p.freeMotion.forkIgnore={object:api.rig(record).forks,until:rt.time+.15};api.warn(record,'Contacto con un pallet: se desplaza según su masa y el rozamiento del suelo. Detente y alinea los huecos.');return;
  }
 };
 model.before=(record,input,dt)=>{
  if(!model.enabled(record)||!api.operational(record.components.vehicle))return;
  const v=record.components.vehicle;if(Math.abs(v.actualSpeed)>.06||Math.abs(input.lift)<.01||rt.time<(v.contactProbeAt||0))return;v.contactProbeAt=rt.time+1/12;
  const travel=v.config.liftSpeed*dt+.003;
  if(!v.entry&&input.lift>0){
   const tool=api.rig(record).forks.getWorldPosition(V());let closest=null;
   for(const p of rt.products.values()){if(p.object.getWorldPosition(V()).distanceTo(tool)>v.config.forkLength+1)continue;const belt=p.item&&rt.records.get(p.item.beltId),conveyor=belt&&belt.components.conveyor;if(conveyor&&api.compatible(p)){const metrics=api.dockingMetrics(record,p);if(metrics&&metrics.aligned&&metrics.insertion.actualM>.02&&conveyor.running){rt.setVariable(belt.id,'running',false);rt.event(record.id,'vehicle-loading-interlock','Banda detenida por presencia de horquillas. Reiníciala desde CONTROL después de retirar la carga.');}}
    const contact=api.forkCandidate(record,p);if(contact&&contact.engage<=travel&&(!closest||contact.distance<closest.distance))closest=contact;}
   if(closest)api.pickup(record,closest.product,false);
  }else if(v.entry&&input.lift<0){
   const plan=api.releasePlan(record);if(!plan.ready)return;
   const current=v.entry.product.object.getWorldPosition(V()),desired=V().setFromMatrixPosition(plan.matrix);
   // No magnetic placement: only the last physical millimetres of lowering.
   if(Math.abs(current.y-desired.y)<=travel)api.release(record,undefined,false);
  }
 };
 model.lose=(record,state,force,reason)=>{
  const v=record.components.vehicle,entry=v.entry;if(!entry)return;const p=entry.product,tool=api.rig(record).forks,matrix=p.object.matrixWorld.clone(),q=tool.getWorldQuaternion(Q());
  api.clearLock(p);(rt.document.getRoot(rt.roomId)||rt.ctx.scene).add(p.object);rt.setProductMatrix(p,matrix);entry.ownerId='';v.entry=null;v.queue=[];v.loadMatrix=null;v.loadDynamics=null;v.lostLoads=(v.lostLoads||0)+1;
  p.directVelocity=state.velocity.clone().add(new T.Vector3(state.vx,0,state.vz).applyQuaternion(q)).clampLength(0,5);
  const direction=Math.abs(force.x)>Math.abs(force.z)?new T.Vector3(0,0,-Math.sign(force.x)):new T.Vector3(Math.sign(force.z),0,0);p.directAngular=direction.applyQuaternion(q).multiplyScalar(1.8);p.unstableCargo=true;
  rt.manualProducts.fall(p);p.freeMotion.forkIgnore={object:tool,until:rt.time+.4};rt.invalidateCollision(p.object);api.warn(record,reason);rt.event(record.id,'vehicle-load-lost',reason);
  if(rt.vehicleTraining&&rt.vehicleTraining.onCollision)rt.vehicleTraining.onCollision(record);
 };
 model.after=(record,input,dt)=>{
  if(!model.enabled(record))return;const v=record.components.vehicle;if(!v.entry){v.loadDynamics=null;v.loadContact=null;return;}
  const p=v.entry.product,tool=api.rig(record).forks;tool.updateWorldMatrix(true,false);const point=tool.getWorldPosition(V()),q=tool.getWorldQuaternion(Q()),metadata=rt.productMetadata(p);
  let s=v.loadDynamics;if(!s||s.id!==v.entry.id){s=v.loadDynamics={id:v.entry.id,last:point.clone(),velocity:V(),vx:0,vz:0,unsafe:0,slip:0};}
  const velocity=point.clone().sub(s.last).divideScalar(dt),teleported=velocity.length()>8,acceleration=velocity.clone().sub(s.velocity).divideScalar(dt);s.last.copy(point);
  if(teleported){s.velocity.set(0,0,0);s.vx=s.vz=0;return;}
  const inverse=q.clone().inverse(),gravity=new T.Vector3(0,-9.81,0).applyQuaternion(inverse),inertia=acceleration.applyQuaternion(inverse).multiplyScalar(-1),force=gravity.clone().add(inertia),normal=Math.max(1,-force.y),muStatic=.28,muKinetic=.22;
  // Open longitudinal pockets allow sliding. Transverse runners initially
  // resist side translation; their two-tine support polygon governs tipping.
  let az=force.z;if(Math.abs(s.vz)<.003&&Math.abs(az)<=muStatic*normal)s.vz=0;else{az-=muKinetic*normal*Math.sign(Math.abs(s.vz)>.003?s.vz:az);const prior=s.vz;s.vz=clamp(s.vz+az*dt,-2.5,2.5);if(prior&&Math.sign(prior)!==Math.sign(s.vz)&&Math.abs(force.z)<muStatic*normal)s.vz=0;}
  const slide=s.vz*dt,previous=v.loadMatrix.clone();v.loadMatrix.elements[14]+=slide;s.slip+=slide;
  if(Math.abs(slide)>.000001&&!api.carry(record,true)){v.loadMatrix.copy(previous);api.carry(record,false);s.vz=0;}
  const box=p.bounds.clone().applyMatrix4(v.loadMatrix),center=box.getCenter(V()),pockets=api.productPockets(p),height=Math.max(.04,center.y-(pockets?pockets.maxY:box.min.y)),zmpX=center.x+height*force.x/normal,zmpZ=center.z+height*force.z/normal;
  const left=v.config.forkSpread/2+v.config.forkWidth/2,back=Math.max(.02,box.min.z),front=Math.min(v.config.forkLength,box.max.z),margin=Math.min(left-Math.abs(zmpX),zmpZ-back,front-zmpZ),ratio=metadata.mass/Math.max(1,api.capacity(v,metadata));
  s.unsafe=margin<-.012?s.unsafe+dt:Math.max(0,s.unsafe-dt*2);s.velocity.copy(velocity);v.loadCenter=center.z;
  v.loadContact={massKg:metadata.mass,normalN:metadata.mass*normal,capacityKg:api.capacity(v,metadata),slipM:s.slip,speedMps:s.vz,marginM:margin,stability:margin<0?'unstable':Math.abs(s.vz)>.025?'sliding':ratio>.9?'near-capacity':'supported',hydraulicFactor:model.factor(record)};
  if(s.unsafe>.10||center.z>v.config.forkLength+.015||center.z<-.02){model.lose(record,s,force,'Carga perdida: el centro de presión salió del apoyo de las horquillas. Frena, baja y asegura la zona.');return;}
  if(Math.abs(s.vz)>.04)api.warn(record,'La carga se desliza: reduce la velocidad, baja y corrige la inclinación del mástil.');
  else if(margin<.035)api.warn(record,'Apoyo reducido: centra e introduce más las horquillas antes de transportar.');
 };
 return model;
}
module.exports={create};
