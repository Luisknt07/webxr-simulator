'use strict';

// Native product custody stays in SimulationRuntime. This bounded, 60 Hz
// contact solver adds direct rigid grips, loose-body motion and open packing.
function create(THREE,runtime){
 const V=()=>new THREE.Vector3(),Q=()=>new THREE.Quaternion(),M=()=>new THREE.Matrix4(),Y=new THREE.Vector3(0,1,0);
 const world=object=>{object.updateWorldMatrix(true,false);return object.matrixWorld.clone();};
 const size=p=>p.bounds.getSize(V()).multiply(p.scale).toArray().map(Math.abs);
 const visible=o=>{for(;o;o=o.parent)if(!o.visible)return false;return true;};
 const boundsOf=object=>{object.updateWorldMatrix(true,true);const inverse=M().getInverse(object.matrixWorld),box=new THREE.Box3();object.traverse(node=>{if(!node.geometry||node.userData.editorGeometryReplaced)return;if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();box.union(node.geometry.boundingBox.clone().applyMatrix4(M().multiplyMatrices(inverse,node.matrixWorld)));});return box;};
 const helper={runtime,free:new Set(),sleeping:new Set(),pending:new Map(),signals:new Map(),armed:new Map(),origins:new Map(),proxies:new Map(),scanAt:0};
 helper.register=p=>{
  if(p.record)helper.origins.set(p.object,{parent:p.object.parent,matrix:p.object.matrix.clone(),auto:p.object.matrixAutoUpdate});
  const c=p.record&&p.record.components.product&&p.record.components.product.config;
  if(c&&c.packingEnabled){const b=p.bounds.clone(),s=b.getSize(V()),t=Math.max(.006,Math.min(s.x,s.z)*.065);b.min.add(new THREE.Vector3(t,s.y*.085,t));b.max.add(new THREE.Vector3(-t,-.006,-t));p.packing={inner:b,items:new Map(),limit:32};const entry=helper.ensureEntry(p);entry.members=[];entry.units=0;entry.load.containerTare=p.classification.mass;}
 };
 helper.policy=p=>{
  const m=runtime.productMetadata(p),s=size(p),span=Math.max(...s),pallet=m.loadMode==='pallet'||m.productType==='pallet'||m.productType==='cage';
  if(pallet&&(m.units>1||p.sourceEntry&&p.sourceEntry.members&&p.sourceEntry.members.length))return{allowed:false,reason:'Pallet cargado: utiliza el montacargas. Puedes retirar las cajas accesibles.'};
  if(m.mass>25||span>1.4)return{allowed:false,reason:'Esta carga requiere equipo de manutención por su masa o tamaño.'};
  return{allowed:true,two:m.mass>8||span>.45,mass:m.mass};
 };
 helper.pose=controller=>{
  if(!controller)return null;
  const contact=controller.userData.xrHandContact,grip=controller.userData.gripObject;
  if(contact){if(!contact.valid||!grip||!grip.visible)return null;if(contact.grasping&&contact.graspMatrix){const a=M().fromArray(contact.graspMatrix);if(grip.parent)a.premultiply(world(grip.parent));return a;}}
  if(grip){if(!grip.visible)return null;return world(grip);}
  return controller.visible===false?null:world(controller);
 };
 helper.near=(p,controller,tolerance=.085)=>{
  if(!visible(p.object)||!helper.policy(p).allowed||runtime.ctx.drivingVehicle)return null;
  const a=helper.pose(controller);if(!a)return null;const point=V().setFromMatrixPosition(a);p.object.updateWorldMatrix(true,false);
  let closest=p.bounds.clampPoint(p.object.worldToLocal(point.clone()),V()).applyMatrix4(p.object.matrixWorld);
  if(p.packing){let distance=Infinity;for(const box of helper.containerBoxes(p)){const candidate=box.clampPoint(point,V()),d=candidate.distanceTo(point);if(d<distance){distance=d;closest=candidate;}}}
  const distance=point.distanceTo(closest);
  if(distance>tolerance)return null;const hit={object:p.object,point:closest,distance,direct:true};return runtime.validInteraction(p.object,hit,controller,true)?hit:null;
 };
 helper.nearest=controller=>{let best=null;for(const [p,pending]of helper.pending)if(pending.controller!==controller){const hit=helper.near(p,controller);if(hit)return{product:p,hit};}const products=[...runtime.products.values(),...[...helper.proxies.values()].filter(proxy=>helper.accessible(proxy.parent,proxy.product)).map(proxy=>proxy.product)];for(const p of products){const hit=helper.near(p,controller);if(hit&&(!best||hit.distance<best.hit.distance))best={product:p,hit};}return best;};
 helper.second=(p,controller,input)=>{
  if(!p.directGrips||p.directGrips.has(controller)||runtime.held.has(controller)||!helper.near(p,controller))return false;
  const first=helper.pose(p.heldBy),second=helper.pose(controller);if(!first||!second||V().setFromMatrixPosition(first).distanceTo(V().setFromMatrixPosition(second))<.08)return false;
  p.directGrips.set(controller,{input,offset:M().getInverse(second).multiply(world(p.object))});runtime.held.set(controller,p);controller.userData.xrHeldObject={object:p.object,held:true,profile:helper.profile(p)};helper.rebase(p);return true;
 };
 helper.rebase=p=>{
  const grips=[...p.directGrips.keys()];if(grips.length<2)return;
  const a=helper.pose(grips[0]),b=helper.pose(grips[1]);if(!a||!b)return;
  p.twoGrip={a:V().setFromMatrixPosition(a),b:V().setFromMatrixPosition(b),pose:world(p.object),handQ:Q().setFromRotationMatrix(a),handQB:Q().setFromRotationMatrix(b)};
 };
 helper.request=(p,controller,input)=>{
  if(!runtime.running||runtime.ctx.studioMenuOpen||runtime.ctx.publicDialogOpen||runtime.ctx.drivingVehicle||runtime.ctx.editor&&runtime.ctx.editor.active)return false;
  if(!helper.near(p,controller))return false;
  if(runtime.held.has(controller))return false;
  if(p.heldBy)return helper.second(p,controller,input);
  const policy=helper.policy(p);
  if(policy.two){const prior=helper.pending.get(p);if(!prior||prior.controller===controller||!helper.near(p,prior.controller)){helper.pending.set(p,{controller,input});runtime.notify('Acerca y cierra la otra mano: esta carga necesita dos manos.');return false;}
   if(V().setFromMatrixPosition(helper.pose(controller)).distanceTo(V().setFromMatrixPosition(helper.pose(prior.controller)))<.08)return false;
   helper.pending.delete(p);const proxy=helper.proxies.get(p.object),live=proxy?helper.detach(proxy.parent,proxy.member):p;if(!live||!runtime.pickupProduct(live,prior.controller,prior.input,true))return false;return helper.second(live,controller,input);
  }
  const proxy=helper.proxies.get(p.object),live=proxy?helper.detach(proxy.parent,proxy.member):p;return !!live&&runtime.pickupProduct(live,controller,input,true);
 };
 helper.begin=(p,controller,input)=>{
  helper.free.delete(p);helper.sleeping.delete(p);p.freeMotion=null;helper.unpack(p);
  const pose=helper.pose(controller);if(!pose)return;
  p.directGrips=new Map([[controller,{input,offset:M().getInverse(pose).multiply(world(p.object))}]]);p.directVelocity=V();p.directAngular=V();p.directLast=world(p.object);p.directAt=runtime.time;
  controller.userData.xrHeldObject={object:p.object,held:true,profile:helper.profile(p)};
 };
 helper.profile=p=>{const type=runtime.productMetadata(p).productType;return type==='bottle'?'pole':type==='cylinder'?'knob':'generic';};
 helper.dropHand=(p,controller,force=false)=>{
  if(!p.directGrips||!p.directGrips.has(controller))return false;
  p.directGrips.delete(controller);runtime.held.delete(controller);delete controller.userData.xrHeldObject;
  if(p.directGrips.size){
   const next=[...p.directGrips.keys()][0];p.heldBy=next;p.holdInput=p.directGrips.get(next).input;
   const pose=helper.pose(next);if(pose)p.directGrips.get(next).offset=M().getInverse(pose).multiply(world(p.object));p.twoGrip=null;
   if(helper.policy(p).two){helper.end(p);return runtime.releaseProduct(p,true);}
   return true;
  }
  // Keep the last owner until native release commits placement/custody.
  p.heldBy=controller;runtime.held.set(controller,p);helper.end(p);return runtime.releaseProduct(p,force);
 };
 helper.end=p=>{if(p.directGrips)for(const c of p.directGrips.keys()){runtime.held.delete(c);delete c.userData.xrHeldObject;}p.directGrips=null;p.twoGrip=null;};
 helper.options=(p,c)=>{
  const options=runtime.productCollisionOptions(p,c);
  const fork=p.freeMotion&&p.freeMotion.forkIgnore;if(fork&&runtime.time<fork.until)options.ignore.push(fork.object);
  if(p.directGrips)for(const hand of p.directGrips.keys()){options.ignore.push(hand);const grip=hand.userData.gripObject;if(grip)options.ignore.push(grip);}
  return options;
 };
 helper.move=(p,wanted,controller)=>{
  const initial=world(p.object),pos=V(),rot=Q(),scale=V(),nextPos=V(),nextRot=Q(),nextScale=V();initial.decompose(pos,rot,scale);wanted.decompose(nextPos,nextRot,nextScale);
  const angle=rot.angleTo(nextRot),distance=pos.distanceTo(nextPos),fraction=Math.min(1,.3/Math.max(.3,distance),(Math.PI/3)/Math.max(Math.PI/3,angle)),rotation=nextRot.clone();nextPos.lerpVectors(pos,nextPos,fraction);nextRot.copy(rot).slerp(rotation,fraction);
  const count=Math.min(12,Math.max(1,Math.ceil(distance*fraction/.04),Math.ceil(angle*fraction/(Math.PI/36)))),w=runtime.ctx.collisionWorld;
  for(let i=1;i<=count;i++){
   const matrix=M().compose(pos.clone().lerp(nextPos,i/count),rot.clone().slerp(nextRot,i/count),scale),before=p.bounds.clone().applyMatrix4(p.object.matrixWorld),after=p.bounds.clone().applyMatrix4(matrix),motion=after.getCenter(V()).sub(before.getCenter(V()));
   if(w){const options=helper.options(p,controller),hit=w.sweepBox(before,motion,options);if(hit.blocked||w.testBox(after,options))break;}
   runtime.setProductMatrix(p,matrix);
  }
  return world(p.object);
 };
 helper.updateGrip=p=>{
  const policy=helper.policy(p);if(!policy.allowed||policy.two&&p.directGrips.size<2){runtime.notify(policy.reason||'Esta carga necesita dos manos.');runtime.releaseProduct(p,true);return;}
  const hands=[...p.directGrips.keys()];for(const c of hands)if(!helper.pose(c)){helper.dropHand(p,c,true);return;}
  const primary=hands[0],a=helper.pose(primary);let target=a.clone().multiply(p.directGrips.get(primary).offset);
  if(hands.length===2&&p.twoGrip){const base=p.twoGrip,b=helper.pose(hands[1]),pa=V().setFromMatrixPosition(a),pb=V().setFromMatrixPosition(b),before=base.b.clone().sub(base.a),after=pb.clone().sub(pa);if(before.length()>.05&&after.length()>.05){
   const axis=after.clone().normalize(),swing=Q().setFromUnitVectors(before.normalize(),axis),handDelta=Q().setFromRotationMatrix(a).multiply(base.handQ.clone().inverse()).slerp(Q().setFromRotationMatrix(b).multiply(base.handQB.clone().inverse()),.5),twistQ=handDelta.multiply(swing.clone().inverse()),projection=axis.clone().multiplyScalar(new THREE.Vector3(twistQ.x,twistQ.y,twistQ.z).dot(axis)),twist=new THREE.Quaternion(projection.x,projection.y,projection.z,twistQ.w).normalize(),delta=twist.multiply(swing),position=V(),rotation=Q(),scale=V();base.pose.decompose(position,rotation,scale);position.sub(base.a.clone().add(base.b).multiplyScalar(.5)).applyQuaternion(delta).add(pa.add(pb).multiplyScalar(.5));target=M().compose(position,delta.multiply(rotation),scale);
  }}
  const resolved=helper.move(p,target,primary),elapsed=Math.max(1/120,Math.min(.1,runtime.time-p.directAt||1/60));
  const velocity=V().setFromMatrixPosition(resolved).sub(V().setFromMatrixPosition(p.directLast)).divideScalar(elapsed);if(velocity.length()>3)velocity.setLength(3);p.directVelocity.lerp(velocity,.35);
  const dq=Q().setFromRotationMatrix(resolved).multiply(Q().setFromRotationMatrix(p.directLast).inverse()).normalize(),angle=2*Math.acos(Math.min(1,Math.abs(dq.w))),axis=V().set(dq.x,dq.y,dq.z);if(axis.lengthSq()>.000001)axis.normalize().multiplyScalar(Math.min(8,angle/elapsed));p.directAngular.lerp(axis,.35);p.directLast=resolved;p.directAt=runtime.time;
  if(runtime.time>=(p.nextManualPreview||0)){p.nextManualPreview=runtime.time+.1;runtime.updateProductPlacement(p,primary);}
 };
 helper.fall=p=>{helper.free.add(p);p.freeMotion={velocity:p.directVelocity?p.directVelocity.clone():V(),angular:p.directAngular?p.directAngular.clone():V(),rest:0};};
 helper.physics=dt=>{
  for(const p of helper.free){const f=p.freeMotion;if(!f||p.heldBy||p.vehicleOwnerId||p.robotOwnerId||p.packedInto||p.item&&(p.item.beltId||p.item.palletOwnerId)||!runtime.products.has(p.object)){helper.free.delete(p);p.freeMotion=null;continue;}
   if(f.velocity.y<=0){const placement=helper.packPlan(p);if(placement){const inverse=M().getInverse(world(placement.parent.object)),current=p.bounds.clone().applyMatrix4(inverse.multiply(world(p.object)));if(current.min.y-placement.bounds.min.y<.035){helper.pack(p,placement);continue;}}}
   f.velocity.y=Math.max(-6,f.velocity.y-9.81*dt);const w=runtime.ctx.collisionWorld;if(!w){helper.free.delete(p);continue;}const options=helper.options(p),position=p.object.getWorldPosition(V());let landed=false;
   for(const axis of ['x','z','y']){const box=p.bounds.clone().applyMatrix4(p.object.matrixWorld),motion=V();motion[axis]=f.velocity[axis]*dt;const hit=w.sweepBox(box,motion,options);position.add(hit.movement);runtime.setProductMatrix(p,world(p.object).setPosition(position));if(hit.blocked){if(axis==='y'&&f.velocity.y<0){landed=true;if(p.unstableCargo&&Math.abs(f.velocity.y)>1.2)helper.spillPallet(p,f.velocity,f.angular);f.velocity.y=Math.abs(f.velocity.y)>.55?-f.velocity.y*.10:0;f.velocity.x*=Math.max(0,1-12*dt);f.velocity.z*=Math.max(0,1-12*dt);f.angular.multiplyScalar(.7);}else f.velocity[axis]=0;}}
   if(f.angular.lengthSq()>.001){const pos=V(),q=Q(),scale=V(),center=p.bounds.getCenter(V()).applyMatrix4(p.object.matrixWorld);world(p.object).decompose(pos,q,scale);const angle=Math.min(.10,f.angular.length()*dt),candidate=M().compose(pos,q.premultiply(Q().setFromAxisAngle(f.angular.clone().normalize(),angle)),scale);candidate.setPosition(pos.add(center.sub(p.bounds.getCenter(V()).applyMatrix4(candidate))));if(!w.testBox(p.bounds.clone().applyMatrix4(candidate),options))runtime.setProductMatrix(p,candidate);else f.angular.multiplyScalar(.2);}
   if(landed){const belt=runtime.findProductBelt(p,.06);if(belt&&runtime.captureProduct(p,belt)){helper.free.delete(p);continue;}f.rest=f.velocity.length()<.045&&f.angular.length()<.1?f.rest+dt:0;if(f.rest>.22){p.freeMotion=null;helper.free.delete(p);helper.sleeping.add(p);}}
   if(position.y< -10){f.velocity.set(0,0,0);helper.free.delete(p);}
  }
 };
 helper.containerBoxes=p=>{
  const b=p.bounds,i=p.packing.inner,boxes=[new THREE.Box3(b.min.clone(),new THREE.Vector3(b.max.x,i.min.y,b.max.z)),new THREE.Box3(b.min.clone(),new THREE.Vector3(i.min.x,b.max.y,b.max.z)),new THREE.Box3(new THREE.Vector3(i.max.x,b.min.y,b.min.z),b.max.clone()),new THREE.Box3(b.min.clone(),new THREE.Vector3(b.max.x,b.max.y,i.min.z)),new THREE.Box3(new THREE.Vector3(b.min.x,b.min.y,i.max.z),b.max.clone())];return boxes.map(box=>box.applyMatrix4(p.object.matrixWorld));
 };
 helper.collision=(record,excluded,options)=>{
  for(const p of runtime.products.values())if(p.packing&&visible(p.object)&&excluded&&excluded.mesh!==p.object){options.ignore.push(p.object);options.extraBoxes=options.extraBoxes.filter(box=>!box.equals(p.bounds.clone().applyMatrix4(p.object.matrixWorld)));options.extraBoxes.push(...helper.containerBoxes(p));for(const child of p.packing.items.keys())if(!excluded||child.object!==excluded.mesh)options.extraBoxes.push(child.bounds.clone().applyMatrix4(child.object.matrixWorld));}
  return options;
 };
 helper.ensureEntry=p=>{if(!p.sourceEntry){const record=p.record||{id:'manual-packing',components:{}};runtime.sourceRuntime.entryForProduct(record,p);}return p.sourceEntry;};
 helper.expose=parent=>{
  const metadata=runtime.productMetadata(parent);if(metadata.loadMode!=='pallet'||metadata.units<1)return;
  const owner=helper.ensureEntry(parent);
  if(!owner.members||!owner.members.length){
   const children=[];parent.object.traverse(child=>{if(child.userData.industrialPalletCargo)children.push(child);});if(!children.length||children.length>64)return;
   const base=new THREE.Box3(),inverse=M().getInverse(world(parent.object));parent.object.traverse(node=>{if(!node.geometry)return;for(let p=node;p&&p!==parent.object;p=p.parent)if(p.userData.industrialPalletCargo||p.userData.editorRuntimeHelper)return;if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();base.union(node.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(node.matrixWorld)));});if(!base.isEmpty())parent.manualBaseBounds=base;
   const config=parent.record&&parent.record.components.product.config||{},tare=Math.min(metadata.mass,config.palletTareKg>=0?config.palletTareKg:require('../schema/palletTypes.js').dimensions(config,true).tare),payload=metadata.mass-tare;if(payload<=0)return;
   owner.members=children.map((object,i)=>{const local=boundsOf(object),scale=object.getWorldScale(V()),dimensions=local.getSize(V()).multiply(scale),id=(metadata.sku||'pallet').slice(0,32)+'-C'+(i+1),spec={id,name:'Caja '+(i+1)+' · '+(metadata.sku||'pallet'),type:object.userData.industrialPalletCargo.type,width:Math.abs(dimensions.x),height:Math.abs(dimensions.y),depth:Math.abs(dimensions.z),mass:payload/children.length,color:metadata.color,quality:metadata.quality,defect:metadata.defect,base:'flat'},record={id:(parent.record?parent.record.id:owner.id)+'/cargo-'+i,object,components:{product:{config:Object.assign({},spec,{sku:id,productType:spec.type,loadMode:'individual',units:1})}},manualCargo:true};
    return{id:owner.id+':cargo'+i,originId:owner.originId,ownerId:owner.id,spec,load:{loadMode:'individual'},units:1,lineage:(owner.lineage||[]).slice(),manualRecord:record,product:{object,record,bounds:local,scale,heldBy:null,classification:Object.assign({},spec,{sku:id,productType:spec.type,loadMode:'individual',units:1})}};
   });owner.load.palletTare=tare;owner.load.physicalAssembly=true;
  }
  for(const member of owner.members){const p=member.product||member.archivedProduct;if(!p||helper.proxies.has(p.object)||runtime.products.has(p.object))continue;p.sourceEntry=member;
   const name=runtime.statePrefix+'unpack-'+(++runtime.productSequence),state={colliderMesh:p.object,directOnly:true,controller:'both',raycaster:true,consumeSelect:true,captureSelect:true,
    handGrabHit:controller=>helper.accessible(parent,p)?helper.near(p,controller):null,
    isSelectable:(hit,controller)=>helper.accessible(parent,p)&&(!runtime.ctx.vrMode||!!helper.near(p,controller))&&runtime.validInteraction(p.object,hit,controller,false),
    onSelectStart:(hit,controller)=>{if(!helper.accessible(parent,p))return;if(runtime.ctx.vrMode){const data=runtime.ctx.raycontrol.controllers.find(row=>row.controller===controller);helper.request(p,controller,data&&data.inputSource.hand?'pinch':'grip-select');}else{const live=helper.detach(parent,member);if(live)runtime.pickupProduct(live,controller);}},
    onSelectEnd:(hit,controller)=>{runtime.releaseHeldProducts(controller,'pinch');runtime.releaseHeldProducts(controller,'grip-select');},onSelectCancel:(hit,controller)=>runtime.releaseHeldProducts(controller)};
   helper.proxies.set(p.object,{parent,member,product:p,name,state});runtime.ctx.raycontrol.addState(name,state);runtime.ctx.raycontrol.activateState(name);runtime.states.push({name,state});
  }
 };
 helper.accessible=(parent,child)=>{
  if(runtime.products.get(parent.object)!==parent||parent.heldBy||parent.robotOwnerId||parent.vehicleOwnerId||parent.robotReservedBy||parent.vehicleReservedBy||!visible(parent.object))return false;
  const inverse=M().getInverse(world(parent.object)),box=child.bounds.clone().applyMatrix4(inverse.clone().multiply(world(child.object)));
  return !(parent.sourceEntry.members||[]).some(member=>{const other=member.product||member.archivedProduct;if(!other||other.object===child.object)return false;const b=other.bounds.clone().applyMatrix4(inverse.clone().multiply(world(other.object)));return b.min.y>=box.max.y-.015&&b.min.x<box.max.x-.005&&b.max.x>box.min.x+.005&&b.min.z<box.max.z-.005&&b.max.z>box.min.z+.005;});
 };
 helper.detach=(parent,member)=>{
  const old=member.product||member.archivedProduct;if(!old||!helper.accessible(parent,old))return null;const matrix=world(old.object),owner=parent.sourceEntry;
  let live=old;if(member.manualRecord)live=runtime.registerProduct(old.object,member.manualRecord);else{runtime.products.set(old.object,old);if(old.stateEntry){runtime.ctx.raycontrol.addState(old.stateEntry.name,old.stateEntry.state);runtime.ctx.raycontrol.activateState(old.stateEntry.name);runtime.states.push(old.stateEntry);}}
  live.sourceEntry=member;member.product=live;owner.members=owner.members.filter(m=>m!==member);owner.units=owner.members.reduce((n,m)=>n+m.units,0);member.ownerId='';runtime.sourceRuntime.entries.add(member);runtime.processorRuntime.archive.delete(member.id);delete live.palletAssemblyOwner;delete live.object.userData.sourcePalletAssemblyMember;
  const root=runtime.document.getRoot(runtime.roomId);root.add(live.object);runtime.setProductMatrix(live,matrix);const proxy=helper.proxies.get(live.object);if(proxy){runtime.ctx.raycontrol.deactivateState(proxy.name);delete runtime.ctx.raycontrol.states[proxy.name];helper.proxies.delete(live.object);runtime.states=runtime.states.filter(s=>s.name!==proxy.name);}
  parent.object.userData.sourceUnits=owner.units;if(parent.object.userData.sourceProduct)parent.object.userData.sourceProduct.units=owner.units;
  // Keep the base and remaining real carton bodies as the aggregate envelope.
  const box=parent.manualBaseBounds?parent.manualBaseBounds.clone():parent.bounds.clone();if(!parent.manualBaseBounds)box.max.y=box.min.y+(owner.spec.height||.144);const inverse=M().getInverse(world(parent.object));for(const m of owner.members){const p=m.product||m.archivedProduct;if(p)box.union(p.bounds.clone().applyMatrix4(inverse.clone().multiply(world(p.object))));}parent.bounds.copy(box);if(parent.item&&parent.item.box)parent.item.box.copy(box).applyMatrix4(parent.object.matrixWorld);runtime.invalidateCollision(parent.object);runtime.event('simulation','pallet-carton-picked','Caja retirada del pallet; quedan '+owner.units+' unidades.');return live;
 };
 helper.packPlan=p=>{
  if(p.packing||runtime.productMetadata(p).loadMode==='pallet')return null;
  const current=world(p.object);let best=null;
  for(const parent of runtime.products.values()){if(!parent.packing||parent===p||parent.heldBy&&parent.heldBy===p.heldBy||parent.packedInto||!visible(parent.object))continue;const packing=parent.packing,inner=packing.inner,local=M().getInverse(world(parent.object)).multiply(current),bounds=p.bounds.clone().applyMatrix4(local),dimensions=bounds.getSize(V()),center=bounds.getCenter(V()),up=Y.clone().transformDirection(local);if(up.y<.94||packing.items.size>=packing.limit||dimensions.x>inner.max.x-inner.min.x||dimensions.z>inner.max.z-inner.min.z||dimensions.y>inner.max.y-inner.min.y)continue;
   if(center.x<inner.min.x-.04||center.x>inner.max.x+.04||center.z<inner.min.z-.04||center.z>inner.max.z+.04||bounds.min.y<inner.min.y-.03||bounds.min.y>inner.max.y+.18)continue;
   if(bounds.min.y<inner.max.y-.03&&(bounds.min.x<inner.min.x-.003||bounds.max.x>inner.max.x+.003||bounds.min.z<inner.min.z-.003||bounds.max.z>inner.max.z+.003))continue;
   const occupied=[...packing.items.values()].map(slot=>slot.bounds),levels=[inner.min.y,...occupied.map(b=>b.max.y+.003)].sort((a,b)=>a-b),xs=[],zs=[],columns=Math.floor((inner.max.x-inner.min.x+.004)/(dimensions.x+.004)),rows=Math.floor((inner.max.z-inner.min.z+.004)/(dimensions.z+.004)),xStart=inner.min.x+(inner.max.x-inner.min.x-(columns*dimensions.x+(columns-1)*.004))/2,zStart=inner.min.z+(inner.max.z-inner.min.z-(rows*dimensions.z+(rows-1)*.004))/2;
   for(let i=0;i<columns;i++)xs.push(xStart+i*(dimensions.x+.004));for(let i=0;i<rows;i++)zs.push(zStart+i*(dimensions.z+.004));
   for(const y of levels)for(const x of xs)for(const z of zs){const box=new THREE.Box3(new THREE.Vector3(x,y,z),new THREE.Vector3(x+dimensions.x,y+dimensions.y,z+dimensions.z));if(box.max.y>inner.max.y+.0001||occupied.some(other=>box.clone().expandByScalar(-.0005).intersectsBox(other)))continue;const delta=box.getCenter(V()).sub(center),horizontal=Math.hypot(delta.x,delta.z);if(horizontal>.22)continue;const matrix=local.clone().setPosition(V().setFromMatrixPosition(local).add(delta)).premultiply(parent.object.matrixWorld),score=horizontal+Math.abs(delta.y)*.1;if(!best||score<best.score)best={parent,matrix,bounds:box,score};}
  }return best;
 };
 helper.pack=(p,plan)=>{
  const parent=plan.parent,entry=helper.ensureEntry(p),owner=helper.ensureEntry(parent);if(parent===p||parent.packing.items.size>=parent.packing.limit)return false;
  if(!owner.members){owner.members=[];owner.load.containerTare=runtime.productMetadata(parent).mass;}
  runtime.sourceRuntime.entries.delete(entry);owner.members.push(entry);owner.units=owner.members.reduce((n,m)=>n+m.units,0);entry.ownerId=owner.id;parent.packing.items.set(p,{bounds:plan.bounds});p.packedInto=parent;
  parent.object.add(p.object);runtime.setProductMatrix(p,plan.matrix);helper.free.delete(p);p.freeMotion=null;runtime.invalidateCollision(parent.object);runtime.event('simulation','container-packed','Caja: '+owner.units+' unidades colocadas; masa total '+runtime.productMetadata(parent).mass.toFixed(2)+' kg.');return true;
 };
 helper.unpack=p=>{
  const parent=p.packedInto;if(!parent)return;const matrix=world(p.object),entry=p.sourceEntry,owner=parent.sourceEntry;parent.packing.items.delete(p);owner.members=owner.members.filter(e=>e!==entry);owner.units=owner.members.reduce((n,m)=>n+m.units,0);entry.ownerId='';runtime.sourceRuntime.entries.add(entry);p.packedInto=null;const root=runtime.document.getRoot(runtime.roomId);root.add(p.object);runtime.setProductMatrix(p,matrix);runtime.invalidateCollision(parent.object);
 };
 helper.capacity=(p,unit)=>{if(!p.packing)return 0;const a=p.packing.inner.getSize(V()).multiply(p.scale),b=unit.bounds.getSize(V()).multiply(unit.scale);return Math.min(p.packing.limit,Math.floor((a.x+.004)/(b.x+.004))*Math.floor((a.z+.004)/(b.z+.004))*Math.floor((a.y+.003)/(b.y+.003)));};
 helper.spillPallet=(parent,velocity,angular)=>{helper.expose(parent);const owner=parent.sourceEntry;if(!owner||!owner.members)return;for(const member of [...owner.members].reverse()){const child=helper.detach(parent,member);if(!child)continue;child.directVelocity=velocity.clone().clampLength(0,5);child.directAngular=angular.clone();helper.fall(child);}parent.unstableCargo=false;};
 helper.poll=()=>{
  const input=runtime.ctx.raycontrol;if(!input)return;
  if(runtime.time>=(helper.assemblyScanAt||0)){helper.assemblyScanAt=runtime.time+.25;const eye=runtime.ctx.camera&&runtime.ctx.camera.getWorldPosition(V());for(const p of [...runtime.products.values()]){if(!eye||runtime.ctx.drivingVehicle)continue;const b=p.bounds.clone().applyMatrix4(world(p.object));if(b.distanceToPoint(eye)<2.2)helper.expose(p);}for(const [object,proxy]of helper.proxies){if(runtime.products.get(proxy.parent.object)!==proxy.parent){runtime.ctx.raycontrol.deactivateState(proxy.name);delete runtime.ctx.raycontrol.states[proxy.name];runtime.states=runtime.states.filter(s=>s.name!==proxy.name);helper.proxies.delete(object);continue;}const enabled=!runtime.ctx.drivingVehicle&&visible(proxy.parent.object)&&(!eye||proxy.product.bounds.clone().applyMatrix4(world(proxy.product.object)).distanceToPoint(eye)<2.3);proxy.state.colliderMesh=enabled?proxy.product.object:[];}}
  if(!runtime.ctx.vrMode)return;
  const blocked=input.enabled===false||runtime.ctx.studioMenuOpen||runtime.ctx.publicDialogOpen||runtime.ctx.drivingVehicle;
  for(const data of input.controllers||[]){if(data.desktop||!data.inputSource||!data.inputSource.hand)continue;const c=data.controller,contact=c.userData.xrHandContact;if(blocked||!contact||!contact.valid)helper.armed.set(c,false);else if(!contact.grasping)helper.armed.set(c,true);const down=!blocked&&helper.armed.get(c)&&data.enabled!==false&&contact&&contact.valid&&contact.grasping,was=helper.signals.get(c)||false;helper.signals.set(c,!!down);
   if(down&&!was){const held=runtime.held.get(c),grip=held&&held.directGrips&&held.directGrips.get(c);if(grip){grip.input='grasp';held.holdInput='grasp';grip.offset=M().getInverse(helper.pose(c)).multiply(world(held.object));helper.rebase(held);}else{const hit=helper.nearest(c);if(hit)helper.request(hit.product,c,'grasp');}}
   else if(!down&&was){const held=runtime.held.get(c),grip=held&&held.directGrips&&held.directGrips.get(c);if(!blocked&&contact&&contact.valid&&contact.pinching&&grip){grip.input='pinch';held.holdInput='pinch';grip.offset=M().getInverse(helper.pose(c)).multiply(world(held.object));helper.rebase(held);}else runtime.releaseHeldProducts(c,'grasp');}
  }
  for(const [p,pending]of helper.pending)if(blocked||!helper.near(p,pending.controller,.12))helper.pending.delete(p);
 };
 helper.step=dt=>{
  helper.physics(dt);
  for(const p of runtime.products.values())if(p.unstableCargo&&Y.clone().transformDirection(p.object.matrixWorld).y<.7)helper.spillPallet(p,p.freeMotion&&p.freeMotion.velocity||V(),p.freeMotion&&p.freeMotion.angular||V());
  if(runtime.time>=helper.scanAt){helper.scanAt=runtime.time+.1;for(const p of helper.sleeping){if(!runtime.products.has(p.object)||p.heldBy||p.packedInto){helper.sleeping.delete(p);continue;}const w=runtime.ctx.collisionWorld,box=p.bounds.clone().applyMatrix4(p.object.matrixWorld);if(w&&!w.sweepBox(box,new THREE.Vector3(0,-.004,0),helper.options(p)).blocked){helper.sleeping.delete(p);helper.fall(p);}}}
  for(const p of runtime.products.values())if(p.packing&&p.packing.items.size){const up=Y.clone().transformDirection(p.object.matrixWorld);if(up.y<.5)for(const child of [...p.packing.items.keys()]){const offset=child.object.getWorldPosition(V()).sub(p.object.getWorldPosition(V()));child.directVelocity=(p.directVelocity||V()).clone().add((p.directAngular||V()).clone().cross(offset)).clampLength(0,3);child.directAngular=(p.directAngular||V()).clone();helper.unpack(child);helper.fall(child);}}
 };
 helper.stop=()=>{for(const [object,origin]of helper.origins){if(origin.parent&&object.parent!==origin.parent)origin.parent.add(object);object.matrix.copy(origin.matrix);object.matrixAutoUpdate=origin.auto;object.matrix.decompose(object.position,object.quaternion,object.scale);}helper.origins.clear();helper.free.clear();helper.sleeping.clear();helper.pending.clear();helper.signals.clear();helper.armed.clear();helper.proxies.clear();};
 return helper;
}
module.exports={create};
