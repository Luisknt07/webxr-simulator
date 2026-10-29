const __layout = require("../../tooling/layout.cjs");
'use strict';
// Use the real driver's eye, rim axis, rear wheels and tracked grip controls.
// Vehicle-forward is+Z. The seated driver's right is-X in this Y-up frame.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const vehicles=require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles'),prefabs=require('../support/load-vehicle-prefabs')(THREE);
const code=fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-vehicle-steering.js"),'../src/editor/VehicleCabInteraction.js')),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class VehicleCabInteraction','return class VehicleCabInteraction');
const Cab=new Function('THREE','vehicles','VehicleCabLabels',code)(THREE,vehicles,require('../support/load-vehicle-cab-labels')(THREE));
const close=(a,b,tolerance=1e-9)=>assert(Math.abs(a-b)<tolerance,a+' != '+b),delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
function observer(root,rig){root.updateWorldMatrix(true,true);const camera=new THREE.PerspectiveCamera(55,1,.01,100);camera.position.copy(rig.driverSeat.getWorldPosition(new THREE.Vector3()));camera.up.set(0,1,0);camera.lookAt(rig.controls.wheel.object.getWorldPosition(new THREE.Vector3()));camera.updateMatrixWorld(true);return camera;}
function screenAngle(camera,wheel){const center=wheel.object.getWorldPosition(new THREE.Vector3()).project(camera),mark=new THREE.Vector3(0,wheel.radius,0).applyMatrix4(wheel.object.matrixWorld).project(camera);return Math.atan2(mark.y-center.y,mark.x-center.x);}
let rimVariants=0;
for(const variant of vehicles.VARIANTS){
  const root=prefabs.createVehicle(variant.preset),rig=root.userData.vehicleRig,c=rig.config,wheel=rig.controls.wheel;
  root.position.set(2,0,-3);root.rotation.y=.57;root.updateWorldMatrix(true,true);
  if(rig.cabin){
    rimVariants++;assert.equal(wheel.inputSign,-1);const camera=observer(root,rig);prefabs.updateVehiclePose(root,vehicles.initialPose(c));const straight=screenAngle(camera,wheel);
    for(const [steer,clockwise]of [[.30,true],[-.30,false]]){
      prefabs.updateVehiclePose(root,Object.assign(vehicles.initialPose(c),{steer}));const turn=delta(screenAngle(camera,wheel),straight);
      assert(clockwise?turn<-.10:turn>.10,variant.id+' steering rim turns '+(clockwise?'clockwise/right':'counter-clockwise/left')+' from the actual driver eye.');
      for(const rear of rig.wheels.filter(value=>value.steering&&value.pivot.position.z<0)){
        const heading=new THREE.Vector3(0,0,1).applyQuaternion(rear.pivot.quaternion);assert(Math.sign(heading.x)===Math.sign(steer),'Rear wheels face opposite the new front heading in a rear-steered truck.');
      }
      if((c.family==='counterbalance'&&c.variant!=='forklift-electric-3w')||c.family==='rough-terrain'){
        const rears=rig.wheels.filter(value=>value.steering&&value.pivot.position.z<0),inside=rears.find(value=>Math.sign(value.pivot.position.x)===-Math.sign(steer)),outside=rears.find(value=>value!==inside);
        assert(Math.abs(inside.pivot.rotation.y)>Math.abs(outside.pivot.rotation.y),'The inside rear wheel turns farther than the outside wheel.');
        const radii=rears.map(value=>c.wheelbase/Math.tan(value.pivot.rotation.y)-value.pivot.position.x);close(radii[0],radii[1]);close(radii[0],c.wheelbase/Math.tan(steer));
      }
    }
    if(rig.pedals){
      const center=rig.cabFloor.getWorldPosition(new THREE.Vector3()),forward=new THREE.Vector3(0,0,1).applyQuaternion(root.quaternion),right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
      const accelerator=rig.pedals.accelerator.getWorldPosition(new THREE.Vector3()).sub(center),brake=rig.pedals.brake.getWorldPosition(new THREE.Vector3()).sub(center);
      assert(accelerator.dot(right)>.10,'Accelerator is on the seated driver right.');assert(brake.dot(right)<-.10,'Brake is on the seated driver left.');
    }
  }
  if(wheel&&wheel.gripOnly){
    assert.equal(wheel.inputSign,1);prefabs.updateVehiclePose(root,vehicles.initialPose(c));const before=wheel.grip.getWorldPosition(new THREE.Vector3());prefabs.updateVehiclePose(root,Object.assign(vehicles.initialPose(c),{steer:.30}));const after=wheel.grip.getWorldPosition(new THREE.Vector3()),right=new THREE.Vector3(-1,0,0).applyQuaternion(root.quaternion);
    assert(after.sub(before).dot(right)>.04,'A rear-pointing tiller rotates its handle to the operator right with its own+Y convention.');
  }
}
function fixture(variant='forklift-electric-4w',steer=0){
  const scene=new THREE.Scene(),root=prefabs.createVehicle(vehicles.defaults(variant));root.position.set(2,0,-3);root.rotation.y=.57;scene.add(root);const rig=root.userData.vehicleRig,c=rig.config,pose=Object.assign(vehicles.initialPose(c),{steer});prefabs.updateVehiclePose(root,pose);
  const hands=['left','right'].map(handedness=>{const controller=new THREE.Group(),grip=new THREE.Group();scene.add(controller,grip);grip.position.set(20,20,20);return {controller,grip,enabled:true,inputSource:{handedness,gripSpace:{},targetRayMode:'tracked-pointer',gamepad:{mapping:'xr-standard',axes:[0,0,0,0],buttons:Array.from({length:6},()=>({pressed:false,value:0}))}}};});
  const record={components:{vehicle:{config:c,pose}}},ctx={scene,vrMode:true,raycontrol:{enabled:true,controllers:hands}},cab=new Cab({ctx,id:'truck',record:()=>record,blocked:()=>false});cab.mount(root);cab.sample();
  return {scene,root,rig,c,record,hands,cab,wheel:rig.controls.wheel};
}
function pointAt(f,hand,angle){const w=f.wheel,frame=new THREE.Matrix4().multiplyMatrices(w.object.parent.matrixWorld,new THREE.Matrix4().compose(w.object.position,w.restQuaternion,w.object.scale));
  const point=w.gripOnly?w.grip.position.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().fromArray(w.axis),angle)):new THREE.Vector3(Math.cos(angle)*w.radius,Math.sin(angle)*w.radius,0);
  hand.grip.position.copy(point.applyMatrix4(frame));f.scene.updateWorldMatrix(true,true);
}
function squeeze(hand,on){hand.inputSource.gamepad.buttons[1]={pressed:on,value:on?1:0};hand.controller.dispatchEvent({type:on?'squeezestart':'squeezeend'});}
function input(f){const value={steer:0,lift:0,throttle:0,brake:0};f.cab.apply(value);return value;}
for(const handedness of ['left','right'])for(const direction of [-1,1]){
  const f=fixture(),hand=f.hands.find(value=>value.inputSource.handedness===handedness);pointAt(f,hand,.4);f.cab.sample();squeeze(hand,true);f.cab.sample();pointAt(f,hand,.4+direction*.35);f.cab.sample();
  close(input(f).steer,-direction*.35/f.wheel.maxAngle,1e-7);assert(f.cab.hands.get(hand.controller).control,'Either tracked grip owns the rim.');f.cab.dispose();
}
for(const handedness of ['left','right'])for(const variant of ['forklift-electric-4w','pallet-truck-electric'])for(const steer of [-.35,.35]){
  const f=fixture(variant,steer),hand=f.hands.find(value=>value.inputSource.handedness===handedness),physical=steer/f.c.steerLimit*f.wheel.inputSign;
  for(let repeat=0;repeat<3;repeat++){
    const orientation=f.wheel.object.quaternion.clone();pointAt(f,hand,f.wheel.gripOnly?physical*f.wheel.maxAngle:.5);f.cab.sample();squeeze(hand,true);f.cab.sample();
    close(input(f).steer,steer/f.c.steerLimit);assert(f.wheel.object.quaternion.angleTo(orientation)<1e-7,'Grabbing an already turned control never flips or snaps its geometry.');
    const control=f.cab.hands.get(hand.controller).control;close(control.value,physical);squeeze(hand,false);f.cab.sample();
  }
  f.cab.dispose();
}
for(const handedness of ['left','right'])for(const variant of ['forklift-electric-4w','pallet-truck-electric']){
  const f=fixture(variant),hand=f.hands.find(value=>value.inputSource.handedness===handedness),start=f.wheel.gripOnly?0:.4,end=start+.20;
  pointAt(f,hand,start);f.cab.sample();squeeze(hand,true);f.cab.sample();pointAt(f,hand,end);f.cab.sample();
  const expected=input(f).steer,physical=f.wheel.object.quaternion.clone();squeeze(hand,false);f.cab.sample();squeeze(hand,true);f.cab.sample();
  close(input(f).steer,expected,1e-7);assert(f.wheel.object.quaternion.angleTo(physical)<1e-7,'Fast release/regrab preserves the physical wheel while rate-limited road steering catches up.');f.cab.dispose();
}
console.log('Vehicle steering: '+rimVariants+' real seated rim views, left/right and Ackermann rear geometry, driver-side pedals, both XR hands, separate tiller sign,24 non-neutral and4 rate-lag regrabs passed.');
