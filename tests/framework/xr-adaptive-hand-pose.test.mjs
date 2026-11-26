import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three');
const {createXRGrip,updateXRGrip,disposeXRGrip}=require('../support/load-xr-grip.js')(THREE);
const vec=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);

function fixture(side='right'){
 const scene=new THREE.Scene(),rig=new THREE.Group(),controller=new THREE.Group();scene.add(rig);rig.add(controller);
 const renderer={xr:{getReferenceSpace:()=>({})}},grip=createXRGrip(renderer,controller,0);rig.add(grip);
 const source={handedness:side,gripSpace:{},gamepad:{buttons:[{value:0},{value:0}]}},matrix=new THREE.Matrix4(),frame={getPose:()=>({transform:{matrix:matrix.toArray()}})};
 const step=(delta=1/72)=>{updateXRGrip(renderer,controller,source,frame,delta);scene.updateMatrixWorld(true);};step();
 const skin=grip.xrInputVisual.skin,tip=finger=>skin.bones.get(finger+'-tip').getWorldPosition(vec());
 const settle=(seconds=.7,hz=72)=>{for(let elapsed=0;elapsed<seconds-1e-9;elapsed+=1/hz)step(Math.min(1/hz,seconds-elapsed));};
 const object=(radius,position=vec())=>{const mesh=new THREE.Mesh(new THREE.SphereBufferGeometry(radius,12,8),new THREE.MeshBasicMaterial());mesh.position.copy(position);scene.add(mesh);return mesh;};
 return{scene,rig,controller,renderer,grip,source,matrix,step,skin,tip,settle,object,dispose(){disposeXRGrip(controller);scene.traverse(n=>{if(n.isMesh){n.geometry.dispose();n.material.dispose();}});}};
}

test('controller fingers close independently, oppose the thumb for pinch and blend at the same speed at 72/90/120 Hz',()=>{
 for(const side of ['left','right']){
  const f=fixture(side);try{
   const index=f.tip('index-finger'),middle=f.tip('middle-finger');f.source.gamepad.buttons[1].value=1;f.settle();
   assert(f.tip('index-finger').distanceTo(index)<.012,'Squeeze leaves the independent trigger finger available.');
   assert(f.tip('middle-finger').distanceTo(middle)>.045);
   const before=f.skin.bones.get('index-finger-phalanx-proximal').quaternion.clone();f.source.gamepad.buttons[0].value=1;f.step();
   const first=f.skin.bones.get('index-finger-phalanx-proximal').quaternion.clone();f.settle();const end=f.skin.bones.get('index-finger-phalanx-proximal').quaternion;
   assert(first.angleTo(before)>0&&first.angleTo(end)>.3,'A trigger press does not snap to the final bend.');
   const target=f.object(.01,vec(0,0,-2));f.controller.userData.xrHeldObject={object:target,profile:'pinch',held:true};f.settle();
   const gap=f.tip('thumb').distanceTo(f.tip('index-finger'));assert(gap>.006&&gap<.025,'Thumb and index meet without collapsing the fingertips.');
   assert.equal(f.skin.root.userData.handGrabPose,'pinch');
  }finally{f.dispose();}
 }
 const poses=[72,90,120].map(hz=>{const f=fixture();f.source.gamepad.buttons[0].value=1;f.settle(.1,hz);const pose=f.skin.bones.get('index-finger-phalanx-proximal').quaternion.clone();f.dispose();return pose;});
 assert(poses[0].angleTo(poses[2])<.025&&poses[1].angleTo(poses[2])<.025);
});

test('knob size limits each finger before contact, with the same result under rotated and scaled scene ancestors',()=>{
 for(const side of ['left','right']){
  const f=fixture(side);try{
   const knob=f.object(.036);f.controller.userData.xrHeldObject={object:knob,profile:'knob',held:true};f.settle();
   const check=()=>{
    const center=knob.getWorldPosition(vec()),radius=.036*knob.getWorldScale(vec()).x;
    for(const prefix of ['thumb','index-finger','middle-finger','ring-finger','pinky-finger']){
     const parts=prefix==='thumb'?['metacarpal','phalanx-proximal','phalanx-distal','tip']:['phalanx-proximal','phalanx-intermediate','phalanx-distal','tip'];
     const chain=parts.map(part=>f.skin.bones.get(prefix+'-'+part).getWorldPosition(vec()));
     for(let i=1;i<chain.length;i++)for(let j=0;j<=4;j++)assert(chain[i-1].clone().lerp(chain[i],j/4).distanceTo(center)>=radius+.0055,'Finger capsules stay outside the knob.');
    }
   };
   check();const limits=f.skin.pose.limits.slice();assert(new Set(limits.map(n=>n.toFixed(2))).size>2,'Fingers do not all stop at the same bend.');
   f.rig.add(knob);f.rig.position.set(2,.4,-3);f.rig.rotation.set(.2,.8,-.4);f.rig.scale.setScalar(1.4);f.settle();check();
   limits.forEach((value,index)=>assert(Math.abs(value-f.skin.pose.limits[index])<.01));
   const small=f.object(.012,f.rig.localToWorld(vec()));small.quaternion.copy(f.rig.quaternion);small.scale.copy(f.rig.scale);
   f.controller.userData.xrHeldObject={object:small,profile:'knob',held:true};f.settle();assert(f.skin.pose.limits[2]>limits[2]+.2,'Smaller controls allow more finger closure.');
   delete f.controller.userData.xrHeldObject;f.settle();assert.equal(f.skin.root.userData.handGrabPose,'relax');
  }finally{f.dispose();}
 }
});

test('button pointing, a rim, thin parts and native sticks select different usable grips without changing the tracked controller',()=>{
 const f=fixture();try{
  f.matrix.makeTranslation(.4,1.2,-.5);f.step();const tracked=f.grip.matrix.clone(),target=f.object(.02,vec(0,0,-3));
  f.controller.userData.xrHandPointing=true;f.settle();assert.equal(f.skin.root.userData.handGrabPose,'point');
  const index=f.tip('index-finger'),middle=f.tip('middle-finger');assert(index.distanceTo(middle)>.06);
  f.controller.userData.vehicleCabGrip={object:target,shape:'torus',radius:.17,profile:'pole',held:true};f.settle();assert.equal(f.skin.root.userData.handGrabPose,'pole');
  delete f.controller.userData.vehicleCabGrip;delete f.controller.userData.xrHandPointing;
  f.controller.userData.grabbing=target;f.settle();assert.equal(f.skin.root.userData.handGrabPose,'stick');
  delete f.controller.userData.grabbing;
  const plate=new THREE.Mesh(new THREE.BoxBufferGeometry(.16,.008,.12),new THREE.MeshBasicMaterial());plate.position.z=-3;f.scene.add(plate);
  f.controller.userData.xrHeldObject={object:plate,held:true};f.settle();assert.equal(f.skin.root.userData.handGrabPose,'plate');
  assert(f.grip.matrix.equals(tracked),'Visual adaptation never moves gripSpace or targetRaySpace.');
  const geometry=f.skin.geometry,material=f.skin.material,nodes=[];f.skin.root.traverse(n=>nodes.push(n));for(let i=0;i<200;i++)f.step();
  const after=[];f.skin.root.traverse(n=>after.push(n));assert.deepEqual(after,nodes);assert.equal(f.skin.geometry,geometry);assert.equal(f.skin.material,material);
 }finally{f.dispose();}
});

test('measured joints bypass all artificial poses, hide on loss and return to the controller bind pose after a device change',()=>{
 const f=fixture();try{
  const hand=new Map([...f.skin.bind.keys()].map(name=>[name,{}])),poses=new Map();
  const base=new THREE.Matrix4().compose(vec(.3,1.4,-.4),new THREE.Quaternion().setFromAxisAngle(vec(0,1,0),.7),vec(1.1,1.1,1.1));
  for(const [name,joint]of hand)poses.set(joint,{transform:{matrix:base.clone().multiply(f.skin.bind.get(name)).toArray()}});
  const source={handedness:'right',hand};f.controller.userData.xrHeldObject={object:f.object(.04),profile:'pole',held:true};
  updateXRGrip(f.renderer,f.controller,source,{getJointPose:joint=>poses.get(joint)});f.scene.updateMatrixWorld(true);
  for(const [name,bone]of f.skin.bones)assert(bone.getWorldPosition(vec()).distanceTo(vec().setFromMatrixPosition(base.clone().multiply(f.skin.bind.get(name))))<1e-6);
  poses.clear();updateXRGrip(f.renderer,f.controller,source,{getJointPose:joint=>poses.get(joint)});assert(!f.skin.root.visible);
  delete f.controller.userData.xrHeldObject;f.step();assert(f.skin.root.visible);assert.equal(f.skin.mode,'controller');assert(f.skin.bones.get('wrist').position.length()<1e-9);
  updateXRGrip(f.renderer,f.controller,f.source,{getPose:()=>null});assert(!f.skin.root.visible);f.step();assert(f.skin.root.visible);
 }finally{f.dispose();}
});

test('steering contact uses the hollow rim and invalid optional object metadata cannot break hand animation',()=>{
 const f=fixture();try{
  const wheel=new THREE.Mesh(new THREE.TorusBufferGeometry(.17,.014,8,32),new THREE.MeshBasicMaterial());f.scene.add(wheel);
  f.controller.userData.vehicleCabGrip={object:wheel,profile:'pole',held:true,shape:'torus',radius:.17,axis:[0,0,1]};f.settle();
  const free=f.skin.pose.limits.slice();assert(free[2]>.8,'The empty wheel centre does not behave like a solid box.');
  f.matrix.makeTranslation(.17,0,0);f.settle();assert(f.skin.pose.limits.some((limit,i)=>limit<free[i]-.05),'Only the actual rim limits closing fingers.');
  delete f.controller.userData.vehicleCabGrip;
  const target=f.object(.02,vec(0,0,-3));target.userData.handGrab={profile:'constructor',axis:[NaN,0,0],center:'invalid'};
  f.controller.userData.xrHeldObject={object:target,held:true};f.settle();assert.equal(f.skin.root.userData.handGrabPose,'knob');
  for(const bone of f.skin.bones.values())assert(bone.quaternion.toArray().every(Number.isFinite));
 }finally{f.dispose();}
});
