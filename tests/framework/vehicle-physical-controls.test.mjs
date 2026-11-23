import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three'),h=require('../legacy/test-vehicle-driving.js');

function fixture(vr=false){
 const f=h.setup(vr);f.driving.dispose();const canvas=new h.Element('canvas');canvas.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:1000});canvas.hasPointerCapture=id=>canvas.captured===id;canvas.releasePointerCapture=()=>{canvas.captured=null;};f.ctx.renderer.domElement=canvas;
 f.driving=new h.Driving(f.ctx,f.runtime,{document:f.dom,window:f.window,notify:()=>{}});assert(f.driving.mount(f.record.id));f.driving.beforeStep();
 const rig=f.api.rig(f.record),cab=f.driving.cab;
 const view=control=>{f.cameraRig.position.set(0,0,0);f.cameraRig.quaternion.set(0,0,0,1);f.scene.updateMatrixWorld(true);const point=control.descriptor.grip.getWorldPosition(new THREE.Vector3());f.camera.position.copy(point).add(new THREE.Vector3(0,.3,-.5));f.camera.lookAt(point);f.camera.updateMatrixWorld(true);return cab.pointer.project(point);};
 const down=(control,id=1,type='mouse')=>{const p=view(control);canvas.fire('pointerdown',{pointerId:id,pointerType:type,button:0,buttons:1,clientX:p.x,clientY:p.y});return cab.pointer.states.get(id);};
 const up=(id=1,type='pointerup')=>f.window.fire(type,{pointerId:id,pointerType:'mouse',buttons:0});
 return {...f,canvas,cab,rig,view,down,up,close(){f.driving.dispose();f.runtime.stop();}};
}

test('real mesh mouse/touch drags drive hydraulics, animate the lever and cancel without stale input',()=>{
 const f=fixture(),lift=f.cab.controls.find(c=>c.channel==='lift');
 try{
  const state=f.down(lift);assert(state,'The visible native knob must be picked.');
  f.cab.cancelled({desktop:true,controller:new THREE.Group()});assert.equal(f.cab.pointer.states.size,1,'An unrelated idle ray cannot cancel a native pointer drag.');
  f.window.fire('pointermove',{pointerId:1,pointerType:'mouse',buttons:1,clientX:state.startX-state.axis.x*state.travel*.7,clientY:state.startY-state.axis.y*state.travel*.7});
  f.driving.beforeStep();assert(f.v.input.lift>.6);const before=f.v.pose.lift;f.api.step(.1);assert(f.v.pose.lift>before);assert(lift.object.quaternion.angleTo(lift.rest)>.1);
  f.up();f.driving.beforeStep();assert.equal(f.v.input.lift,0);assert.equal(f.ctx.vehicleCabPointerActive,false);assert(lift.object.quaternion.angleTo(lift.rest)<1e-8);
  for(const cancel of ['pointercancel','pointerup']){const s=f.down(lift,2,'touch');assert(s);f.window.fire('pointermove',{pointerId:2,pointerType:'touch',buttons:1,clientX:s.startX-s.axis.x*s.travel*.6,clientY:s.startY-s.axis.y*s.travel*.6});f.driving.beforeStep();assert(f.v.input.lift>.5);f.up(2,cancel);f.driving.beforeStep();assert.equal(f.v.input.lift,0);}
  const s=f.down(lift);assert(s);f.window.fire('blur');assert.equal(f.cab.pointer.states.size,0);assert.equal(f.v.input.lift,0);
 }finally{f.close();}
});

test('two touch contacts retain separate hydraulic ownership and disposal retires their listeners',()=>{
 const f=fixture(),lift=f.cab.controls.find(c=>c.channel==='lift'),tilt=f.cab.controls.find(c=>c.channel==='tilt');
 try{
  const a=f.down(lift,10,'touch'),b=f.down(tilt,11,'touch');assert(a&&b);assert.equal(f.cab.pointer.states.size,2);
  f.window.fire('pointermove',{pointerId:10,pointerType:'touch',buttons:1,clientX:a.startX-a.axis.x*a.travel*.6,clientY:a.startY-a.axis.y*a.travel*.6});
  f.window.fire('pointermove',{pointerId:11,pointerType:'touch',buttons:1,clientX:b.startX+b.axis.x*b.travel*.5,clientY:b.startY+b.axis.y*b.travel*.5});
  f.driving.beforeStep();assert(f.v.input.lift>.5);assert(f.v.input.tilt>.4);f.up(10);f.driving.beforeStep();assert.equal(f.v.input.lift,0);assert(f.v.input.tilt>.4);
  f.ctx.publicDialogOpen=true;f.driving.beforeStep();assert.equal(f.cab.pointer.states.size,0);assert.equal(f.canvas.captured,null,'Cancelling must also release native DOM capture.');assert.equal(f.v.input.tilt,0);assert.equal(f.ctx.vehicleCabPointerActive,false);f.ctx.publicDialogOpen=false;
 }finally{f.close();}
 assert.equal(f.canvas.listeners.get('pointerdown').size,0);assert.equal(f.window.listeners.get('pointermove').size,0);
});

test('native XR grips and measured hand pinches can operate cab buttons while stopped and preserve emergency interlocks',()=>{
 const f=fixture(true),pad=h.pad('right'),grip=new THREE.Group();pad.inputSource.gripSpace={};pad.grip=grip;f.cameraRig.add(grip,pad.controller);f.ctx.raycontrol.controllers.push(pad);
 const button=id=>f.cab.controls.find(c=>c.channel===id),place=id=>{const point=button(id).descriptor.grip.getWorldPosition(new THREE.Vector3());grip.position.copy(grip.parent.worldToLocal(point));f.scene.updateMatrixWorld(true);};
 const release=()=>{if(pad.inputSource.gamepad)h.press(pad,1,false);if(pad.controller.userData.xrHandContact)pad.controller.userData.xrHandContact.pinching=false;f.driving.beforeStep();};
 const press=id=>{release();place(id);f.driving.beforeStep();if(pad.inputSource.hand)pad.controller.userData.xrHandContact.pinching=true;else h.press(pad,1,true);f.driving.beforeStep();};
 try{
  f.driving.command('powerOff');f.driving.beforeStep();press('ignition');assert(f.v.powered&&f.v.running);release();press('lights');assert.equal(f.v.lights,true);release();
  pad.inputSource.hand=new Map([['wrist',{}],['thumb-tip',{}],['index-finger-tip',{}]]);delete pad.inputSource.gamepad;delete pad.inputSource.gripSpace;pad.controller.userData.xrHandContact={valid:true,pinching:false};
  press('emergency');assert(f.v.emergency&&!f.v.running);release();press('resetEmergency');assert(!f.v.emergency&&!f.v.running);release();press('ignition');assert(f.v.running);release();
  press('horn');f.cab.cancelled({desktop:true,controller:new THREE.Group()});f.cab.cancelled({controller:new THREE.Group()});f.cab.cancelled(pad);assert(button('horn').owner,'Ray suppression is not cancellation of a valid physical grip.');const count=f.v.hornCount;f.runtime.time+=.3;f.driving.beforeStep();assert(f.v.hornCount>count);pad.controller.userData.xrHandContact.valid=false;f.cab.cancelled(pad);assert.equal(button('horn').owner,null);pad.controller.userData.xrHandContact.valid=true;release();const ended=f.v.hornCount;f.runtime.time+=1;f.driving.beforeStep();assert.equal(f.v.hornCount,ended);
 }finally{f.close();}
});

test('actual cab buttons operate ignition from off, parking/lights/horn and a latched emergency with separate reset',()=>{
 const f=fixture(),control=id=>f.cab.controls.find(c=>c.channel===id),tap=id=>{const c=control(id);f.cab.frame(c);const hand={pointer:true};assert(f.cab.take(hand,c,c.descriptor.grip.getWorldPosition(new THREE.Vector3())));f.cab.release(hand);f.driving.beforeStep();};
 try{
  f.driving.command('powerOff');f.driving.beforeStep();assert.equal(f.v.powered,false);tap('ignition');assert(f.v.powered&&f.v.running);
  const parking=f.v.parkingBrake;tap('parkingBrake');assert.equal(f.v.parkingBrake,!parking);tap('lights');assert.equal(f.v.lights,true);
  const horn=f.v.hornCount;tap('horn');assert.equal(f.v.hornCount,horn+1);
  tap('emergency');assert(f.v.emergency);assert.equal(f.v.running,false);assert.equal(f.v.input.brake,1);assert.equal(f.cab.canTake(control('lift')),false);
  tap('resetEmergency');assert.equal(f.v.emergency,false);assert.equal(f.v.running,false,'Reset must never automatically restart the forklift.');tap('ignition');assert(f.v.running);
  f.ctx.publicDialogOpen=true;const c=control('lights');assert.equal(f.cab.canTake(c),false);f.ctx.publicDialogOpen=false;
 }finally{f.close();}
});

test('every physical button is visible from the actual default driver eye, including the parking button beside the rim',()=>{
 const f=fixture();try{f.scene.updateMatrixWorld(true);const eye=f.rig.driverSeat.getWorldPosition(new THREE.Vector3());for(const c of f.cab.controls.filter(c=>c.kind==='button')){const point=c.descriptor.grip.getWorldPosition(new THREE.Vector3()),ray=new THREE.Raycaster(eye,point.clone().sub(eye).normalize()),hit=ray.intersectObjects(f.cab.pointer.meshes(),false)[0];assert(f.cab.pointer.controlFor(hit&&hit.object)===c,'A body shell or steering hub must not hide '+c.channel+'; hit '+(hit&&hit.object.name));}}finally{f.close();}
});

test('keyboard, external axes and real pedal contacts share the existing runtime and visible neutral return',()=>{
 const f=fixture(),lift=f.cab.controls.find(c=>c.channel==='lift'),brake=f.cab.controls.find(c=>c.channel==='brake');
 try{
  h.key(f,'KeyQ');f.driving.beforeStep();assert.equal(f.v.input.lift,1);assert(lift.object.quaternion.angleTo(lift.rest)>.2);h.key(f,'KeyQ',false);f.driving.beforeStep();assert(lift.object.quaternion.angleTo(lift.rest)<1e-8);
  f.driving.sampleExternalInput=()=>({ready:true,input:{lift:.6,brake:0}});f.driving.externalInput={getState:()=>({armed:true}),reset(){},dispose(){}};f.driving.beforeStep();assert.equal(f.v.input.lift,.6);assert(lift.object.quaternion.angleTo(lift.rest)>.1);
  f.driving.sampleExternalInput=()=>null;f.driving.externalInput=null;
  f.scene.updateMatrixWorld(true);const hinge=brake.origin.clone().applyMatrix4(brake.object.matrixWorld),floor=new THREE.Box3().setFromObject(f.rig.cabFloor);
  const hand={pointer:true};f.cab.frame(brake);assert(f.cab.take(hand,brake,brake.descriptor.grip.getWorldPosition(new THREE.Vector3())));f.driving.beforeStep();assert.equal(f.v.input.brake,1);assert(brake.object.quaternion.angleTo(brake.rest)>.05);
  f.scene.updateMatrixWorld(true);assert(brake.origin.clone().applyMatrix4(brake.object.matrixWorld).distanceTo(hinge)<1e-8,'The real pedal rotates about its heel hinge.');assert(new THREE.Box3().setFromObject(brake.object).min.y>floor.max.y,'A fully depressed pedal stays above the floor.');
  f.cab.release(hand);f.driving.beforeStep();assert.equal(f.v.input.brake,0);
 }finally{f.close();}
});

test('dragging the actual steering rim supplies the same driver-side steering sign as XR',()=>{
 const f=fixture(),wheel=f.cab.controls.find(c=>c.kind==='wheel');
 try{
  f.cameraRig.position.set(0,0,0);f.cameraRig.quaternion.set(0,0,0,1);f.scene.updateMatrixWorld(true);
  const center=wheel.object.getWorldPosition(new THREE.Vector3()),normal=new THREE.Vector3(0,0,1).transformDirection(wheel.object.matrixWorld),up=new THREE.Vector3(0,1,0).transformDirection(wheel.object.matrixWorld);
  f.camera.position.copy(center).addScaledVector(normal,.7);f.camera.up.copy(up);f.camera.lookAt(center);f.camera.updateMatrixWorld(true);
  const point=f.cab.pointer.project(new THREE.Vector3(.17,0,0).applyMatrix4(wheel.object.matrixWorld));f.canvas.fire('pointerdown',{pointerId:3,pointerType:'mouse',button:0,buttons:1,clientX:point.x,clientY:point.y});const state=f.cab.pointer.states.get(3);assert(state&&state.control===wheel);
  const radius=Math.hypot(point.x-state.center.x,point.y-state.center.y);f.window.fire('pointermove',{pointerId:3,pointerType:'mouse',buttons:1,clientX:state.center.x+Math.cos(.5)*radius,clientY:state.center.y-Math.sin(.5)*radius});f.driving.beforeStep();assert(f.v.input.steer<-.3,'Counter-clockwise rim movement turns left.');f.up(3);f.driving.beforeStep();assert.equal(f.v.input.steer,0);
 }finally{f.close();}
});
