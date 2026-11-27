'use strict';
const assert=require('node:assert/strict'),T=require('three');
const {setup,pad,axis,press}=require('./test-vehicle-driving.js'),physics=require('./test-vehicle-runtime.js');
function fixture(){
 const f=setup(true);f.v.config.naturalHandling=true;
 const hands=['left','right'].map(side=>{const data=pad(side);data.inputSource.gripSpace={};data.grip=new T.Group();f.cameraRig.add(data.controller,data.grip);return data;});
 f.ctx.raycontrol.controllers=hands;assert(f.driving.boardAndStart(f.record.id));
 f.hands=hands;f.pose=(data,point,worldRotation)=>{data.grip.position.copy(data.grip.parent.worldToLocal(point.clone()));if(worldRotation)data.grip.quaternion.copy(data.grip.parent.getWorldQuaternion(new T.Quaternion()).inverse().multiply(worldRotation));f.scene.updateMatrixWorld(true);};
 f.neutral=()=>{for(const data of hands){axis(data,0,0);for(let i=0;i<6;i++)press(data,i,false);}f.driving.beforeStep();};
 f.tick=(seconds)=>{for(let i=0;i<seconds*60;i++){f.ctx.xrPoseSequence=(f.ctx.xrPoseSequence||0)+1;f.scene.updateMatrixWorld(true);f.driving.beforeStep();physics.step(f,1/60);f.driving.follow();}};
 for(let i=0;i<2;i++)f.pose(hands[i],new T.Vector3(10+i,2,10));f.neutral();return f;
}
function rim(f,angle){const wheel=f.api.rig(f.record).controls.wheel;wheel.object.parent.updateWorldMatrix(true,false);return new T.Vector3(Math.cos(angle)*wheel.radius,Math.sin(angle)*wheel.radius,0).applyMatrix4(new T.Matrix4().multiplyMatrices(wheel.object.parent.matrixWorld,new T.Matrix4().compose(wheel.object.position,wheel.restQuaternion,wheel.object.scale)));}
for(const index of [0,1]){
 const f=fixture(),hand=f.hands[index],right=f.hands[1],left=f.hands[0];try{
  f.pose(hand,rim(f,.2));press(hand,1,true);f.driving.beforeStep();const held=f.driving.cab.hands.get(hand.controller).control;assert(held&&held.kind==='wheel');
  const start=held.object.quaternion.clone(),tracked=f.camera.quaternion.clone(),q=hand.grip.getWorldQuaternion(new T.Quaternion()),wheelAxis=new T.Vector3(0,0,1).transformDirection(held.frame);
  f.pose(hand,rim(f,.2),new T.Quaternion().setFromAxisAngle(wheelAxis,.3).multiply(q));f.driving.beforeStep();assert(held.object.quaternion.angleTo(start)>.25,'A fixed-position wrist twist visibly turns the native wheel with either hand.');assert(f.v.input.steer<-.15);
  const first=held.value;f.pose(hand,rim(f,.5),new T.Quaternion().setFromAxisAngle(wheelAxis,.6).multiply(q));f.driving.beforeStep();assert(Math.abs(held.value-first-.3/held.descriptor.maxAngle)<1e-5,'Rim travel and wrist rotation are not doubled.');assert(f.camera.quaternion.equals(tracked));
  const stable=held.value;f.ctx.xrPoseSequence=20;f.driving.beforeStep();const once=held.value;f.object.rotation.y+=.01;f.scene.updateMatrixWorld(true);f.driving.beforeStep();assert.equal(held.value,once,'Repeated physics steps reuse the same XR sample.');f.object.rotation.y-=.01;f.scene.updateMatrixWorld(true);delete f.ctx.xrPoseSequence;
  // Right trigger still accelerates when that same hand owns the wheel.
  right.inputSource.gamepad.buttons[0]={pressed:true,value:.55};f.driving.beforeStep();assert(f.v.input.throttle>.45&&f.v.input.throttle<.6);assert.equal(f.driving.cab.hands.get(hand.controller).control,held);
  f.tick(1);assert(f.v.distance>.02,'The real vehicle travels under analog trigger input.');
  press(left,0,true);f.driving.beforeStep();assert.equal(f.v.input.throttle,0);assert.equal(f.v.input.brake,1);press(right,0,false);f.tick(1.2);assert(Math.abs(f.v.actualSpeed)<.01);
  press(right,4,true);f.driving.beforeStep();assert.equal(f.driving.xrDriveDirection,-1);assert.equal(f.driving.cab.hands.get(hand.controller).control,held,'Changing direction while stopped retains the wheel grasp.');f.driving.beforeStep();assert.equal(f.driving.xrDriveDirection,-1,'Holding A cannot oscillate the selected gear.');press(right,4,false);press(left,0,false);
  right.inputSource.gamepad.buttons[0]={pressed:true,value:.8};f.tick(1);assert(f.v.actualSpeed<-.02,'The same trigger drives the physical vehicle backwards in R.');
  press(right,4,true);f.driving.beforeStep();assert.equal(f.driving.xrDriveDirection,-1,'Moving or holding the accelerator rejects a direction change.');press(right,4,false);
  right.selectionCapture=[{}];f.driving.beforeStep();assert.equal(f.v.input.throttle,0);right.selectionCapture=null;f.driving.beforeStep();assert.equal(f.v.input.throttle,0,'Leaving a menu does not replay a held accelerator.');
  right.grip.visible=false;f.driving.beforeStep();assert.equal(f.v.input.throttle,0);right.grip.visible=true;f.driving.beforeStep();assert.equal(f.v.input.throttle,0,'Tracking recovery requires a released trigger.');
 }finally{f.driving.dispose();f.runtime.stop();}
}
// Source ordering is not left/right ordering in WebXR.
const ordered=fixture();try{ordered.ctx.raycontrol.controllers=ordered.hands.slice().reverse();ordered.hands[1].inputSource.gamepad.buttons[0]={pressed:true,value:.6};ordered.driving.beforeStep();assert(ordered.v.input.throttle>.5);press(ordered.hands[0],0,true);ordered.driving.beforeStep();assert.equal(ordered.v.input.throttle,0);}finally{ordered.driving.dispose();ordered.runtime.stop();}
for(const index of [0,1]){
 const f=fixture(),data=f.hands[index];try{
  data.inputSource.hand={};const palm=new T.Matrix4().compose(data.grip.parent.worldToLocal(rim(f,.4)),new T.Quaternion(),new T.Vector3(1,1,1));data.controller.userData.xrHandContact={valid:true,pinching:false,grasping:false,graspMatrix:palm.toArray()};f.driving.beforeStep();
  data.controller.userData.xrHandContact.grasping=true;const tracked=data.grip.matrix.clone();f.driving.beforeStep();const control=f.driving.cab.hands.get(data.controller).control;assert(control&&control.kind==='wheel','A measured closed palm can grasp either side without an empty-air pinch.');
  const initial=control.object.quaternion.clone(),rotation=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),.25),position=new T.Vector3().setFromMatrixPosition(palm);data.controller.userData.xrHandContact.graspMatrix=new T.Matrix4().compose(position,rotation,new T.Vector3(1,1,1)).toArray();f.driving.beforeStep();assert(control.object.quaternion.angleTo(initial)>.1);assert(data.grip.matrix.equals(tracked),'The private grasp pose never writes the tracked grip.');
 }finally{f.driving.dispose();f.runtime.stop();}
}
console.log('Wheel/trigger: bilateral rim and wrist steering, measured closed palms, shared-hand acceleration, analog pedals, D/R interlocks, brake priority, source ordering, sample reuse and tracking/menu rearm passed.');
