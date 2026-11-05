'use strict';
// Production cab, rig and physics. The fixture supplies only tracked poses
// and native xr-standard button/axis samples, never substitutes cargo motion.
const assert=require('node:assert/strict'),THREE=require('three');
const {setup,pad,axis,press}=require('./test-vehicle-driving.js');
function attach(f,hand){const grip=new THREE.Group();hand.inputSource.gripSpace={};hand.grip=grip;f.cameraRig.add(hand.controller,grip);return hand;}
function place(f,hand,point){hand.grip.position.copy(hand.grip.parent.worldToLocal(point.clone()));f.scene.updateMatrixWorld(true);}
function neutral(f,hands){for(const hand of hands){axis(hand,0,0);for(const index of [0,1,3,4,5])press(hand,index,false);}f.driving.beforeStep();}
function rimPoint(f,angle){const wheel=f.api.rig(f.record).controls.wheel,object=wheel.object;object.parent.updateWorldMatrix(true,false);const matrix=new THREE.Matrix4().multiplyMatrices(object.parent.matrixWorld,new THREE.Matrix4().compose(object.position,wheel.restQuaternion,object.scale));return new THREE.Vector3(Math.cos(angle)*wheel.radius,Math.sin(angle)*wheel.radius,0).applyMatrix4(matrix);}
const f=setup(true),left=attach(f,pad('left')),right=attach(f,pad('right'));
f.ctx.raycontrol.controllers=[left,right];assert(f.driving.mount(f.record.id));
try{
 place(f,left,new THREE.Vector3(10,2,10));place(f,right,new THREE.Vector3(12,2,10));neutral(f,[left,right]);
 // Side grip may be squeezed before the hand reaches the visible rim.
 press(left,1,true);f.driving.beforeStep();assert(!f.driving.cab.hands.get(left.controller).control);
 place(f,left,rimPoint(f,.3));f.driving.beforeStep();const wheel=f.driving.cab.hands.get(left.controller).control;
 assert(wheel&&wheel.kind==='wheel','A held side grip catches the physical rim on approach.');
 assert.equal(left.controller.userData.xrRaySuppressed,true);assert.deepEqual(left.controller.userData.vehicleCabGrip,{kind:'wheel',channel:'steer',held:true});
 assert.equal(right.controller.userData.xrRaySuppressed,false,'The free hand retains its ray.');
 place(f,left,rimPoint(f,.6));axis(left,.9,0);f.driving.beforeStep();assert(f.v.input.steer<-.1,'The held wheel takes priority over conflicting stick steering.');
 // The second hand cannot steal, including after the first hand releases.
 place(f,right,rimPoint(f,.6));press(right,1,true);f.driving.beforeStep();assert.equal(f.driving.cab.hands.get(right.controller).control,null);
 press(left,1,false);f.driving.beforeStep();assert.equal(left.controller.userData.xrRaySuppressed,false);assert.equal(f.driving.cab.hands.get(right.controller).control,null);
 f.driving.beforeStep();assert.equal(f.driving.cab.hands.get(right.controller).control,null,'A blocked second grasp requires release and another squeeze.');
 press(right,1,false);axis(left,0,0);f.driving.beforeStep();press(right,1,true);f.driving.beforeStep();assert.equal(f.driving.cab.hands.get(right.controller).control,wheel);
 f.ctx.studioMenuOpen=true;f.driving.beforeStep();assert.equal(f.v.input.brake,1);assert.equal(right.controller.userData.xrRaySuppressed,false);assert(!right.controller.userData.vehicleCabGrip);
 f.ctx.studioMenuOpen=false;f.driving.beforeStep();assert.equal(f.driving.cab.hands.get(right.controller).control,null,'Menu resume cannot regrasp while grip is still held.');
 neutral(f,[left,right]);place(f,left,new THREE.Vector3(10,2,10));place(f,right,new THREE.Vector3(12,2,10));axis(left,.7,-.8);axis(right,.6,-.7);f.driving.beforeStep();
 assert(f.v.input.throttle>.5&&f.v.input.steer>.4&&f.v.input.lift>.5&&f.v.input.tilt>.4,'Free sticks can drive and lift in default cab mode.');
 left.grip.visible=false;right.grip.visible=false;f.driving.beforeStep();assert.equal(f.v.input.throttle,0);assert.equal(f.v.input.steer,0);assert.equal(f.v.input.lift,0);
 left.grip.visible=true;right.grip.visible=true;f.driving.beforeStep();assert.equal(f.v.input.throttle,0,'Tracking recovery with deflected sticks requires neutral.');
 neutral(f,[left,right]);axis(left,0,-.8);left.selectionCapture=[{}];f.driving.beforeStep();assert.equal(f.v.input.throttle,0,'A ray pressing a panel cannot also accelerate.');
 left.selectionCapture=null;f.driving.beforeStep();assert.equal(f.v.input.throttle,0,'Releasing the panel does not replay a held acceleration stick.');
 neutral(f,[left,right]);f.ctx.raycontrol.controllers=[];f.driving.beforeStep();
 assert(!left.controller.userData.vehicleCabGrip&&!('xrRaySuppressed'in left.controller.userData),'Disconnect cleans occupied hand presentation flags.');
}finally{f.driving.dispose();f.runtime.stop();}
const cargo=setup(true,true),l=pad('left'),r=pad('right');cargo.ctx.raycontrol.controllers=[l,r];assert(cargo.driving.mount(cargo.record.id));
try{
 neutral(cargo,[l,r]);cargo.v.parkingBrake=true;press(l,4,true);cargo.driving.beforeStep();assert.equal(cargo.v.parkingBrake,false,'X releases the real parking brake.');assert.equal(cargo.v.input.throttle,0);
 neutral(cargo,[l,r]);const original=cargo.runtime.products.get(cargo.pallet),count=cargo.runtime.products.size;
 r.selectionCapture=[{}];press(r,4,true);cargo.driving.beforeStep();assert.equal(cargo.v.entry,null,'A cannot take cargo while its hand selects a panel.');
 r.selectionCapture=null;cargo.driving.beforeStep();assert.equal(cargo.v.entry,null,'Releasing a panel while A is held never takes cargo.');
 neutral(cargo,[l,r]);press(r,4,true);cargo.driving.beforeStep();assert.equal(cargo.v.entry.product,original,'A takes the actual compatible pallet through runtime validation.');
 const pickups=cargo.commands.filter(value=>value==='pickup').length;cargo.driving.beforeStep();assert.equal(cargo.commands.filter(value=>value==='pickup').length,pickups,'Holding A does not repeat pickup/release.');assert.equal(cargo.runtime.products.size,count);
 neutral(cargo,[l,r]);cargo.ctx.studioMenuOpen=true;press(r,4,true);cargo.driving.beforeStep();cargo.ctx.studioMenuOpen=false;cargo.driving.beforeStep();assert.equal(cargo.v.entry.product,original,'A held across a menu cannot release existing cargo.');
}finally{cargo.driving.dispose();cargo.runtime.stop();}
console.log('Quest cab usability: held approach grip, bilateral ownership, occupied/free hand rays, physical priority, default sticks, tracking/menu/panel neutral rearm, X brake and A native custody passed.');
