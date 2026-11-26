import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three'),h=require('../legacy/test-vehicle-driving.js');
const {createXRGrip,updateXRGrip,disposeXRGrip}=require('../support/load-xr-grip.js')(THREE);
const vec=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);

function fixture(){
 const f=h.setup(true);assert(f.driving.mount(f.record.id));f.driving.beforeStep();const cab=f.driving.cab;
 f.ctx.renderer.xr.getReferenceSpace=()=>({});
 const hands=[];
 const tracked=(side='right')=>{
  const controller=new THREE.Group(),joints=new Map(['wrist','thumb-tip','index-finger-tip'].map(name=>[name,{}])),poses=new Map();
  const inputSource={handedness:side,targetRayMode:'tracked-pointer',hand:joints},grip=createXRGrip(f.ctx.renderer,controller,hands.length);
  f.cameraRig.add(controller,grip);const data={controller,inputSource,grip,enabled:true};f.ctx.raycontrol.controllers.push(data);
  const place=(center,gap=.056,{sameSide=false,lost=false}={})=>{
   f.scene.updateMatrixWorld(true);const lateral=vec(1,0,0).transformDirection(f.api.rig(f.record).cabin.matrixWorld);
   const points={'thumb-tip':center.clone().addScaledVector(lateral,gap/2),'index-finger-tip':center.clone().addScaledVector(lateral,sameSide?gap*1.5:-gap/2),wrist:center.clone().add(vec(0,0,-.12))};
   poses.clear();for(const [name,joint]of joints){if(lost&&name==='thumb-tip')continue;const p=f.cameraRig.worldToLocal(points[name]);poses.set(joint,{radius:.007,transform:{matrix:new THREE.Matrix4().makeTranslation(p.x,p.y,p.z).toArray()}});}
   updateXRGrip(f.ctx.renderer,controller,inputSource,{getJointPose:joint=>poses.get(joint)},.016);f.scene.updateMatrixWorld(true);
  };
  const hand={controller,inputSource,grip,data,place,get state(){return cab.hands.get(controller);}};hands.push(hand);return hand;
 };
 const center=c=>{f.scene.updateMatrixWorld(true);return c.descriptor.grip.getWorldPosition(vec());};
 const step=()=>f.driving.beforeStep(),control=id=>cab.controls.find(c=>c.channel===id);
 return {...f,cab,tracked,center,step,control,close(){f.driving.dispose();for(const hand of hands)disposeXRGrip(hand.controller);f.runtime.stop();}};
}

test('measured fingers wrap each actual knob without closing through it and operate only its hydraulic channel',()=>{
 const f=fixture(),hand=f.tracked();try{
  for(const id of ['lift','tilt','sideShift']){
   const c=f.control(id),point=f.center(c);hand.place(point,.11);f.step();hand.place(point);f.step();
   assert.equal(hand.controller.userData.xrHandContact.pinching,false,'A 56 mm wrap must leave the global 25 mm ray pinch inactive.');
   assert.equal(hand.state.control,c);assert.equal(c.owner,hand.state);assert(hand.controller.userData.xrRaySuppressed);
   const axis=c.axis.clone().transformDirection(c.frame);hand.place(point.clone().addScaledVector(axis,-c.descriptor.travel*.6));f.step();
   assert(Math.abs(f.v.input[id])>.5);for(const other of ['lift','tilt','sideShift'].filter(channel=>channel!==id))assert.equal(f.v.input[other],0);
   if(id==='lift'){const before=f.v.pose.lift;f.api.step(.1);assert(f.v.pose.lift>before);}
   hand.place(f.center(c),.11);f.step();assert.equal(c.owner,null);assert.equal(f.v.input[id],0);assert(c.object.quaternion.angleTo(c.rest)<1e-8);
  }
 }finally{f.close();}
});

test('a held lever survives finger jitter and cannot switch to a neighbour until the hand opens',()=>{
 const f=fixture(),hand=f.tracked();try{
  const c=f.control('tilt'),next=f.control('sideShift'),p=f.center(c);hand.place(p,.11);f.step();hand.place(p);f.step();
  for(const gap of [.064,.072,.08]){hand.place(f.center(next),gap);f.step();assert.equal(hand.state.control,c);assert.equal(next.owner,null);}
  hand.place(f.center(c),.10);f.step();assert.equal(c.owner,null);hand.place(f.center(next));f.step();assert.equal(hand.state.control,next);
 }finally{f.close();}
});

test('ambiguous closed pinches and fingers on the same side of a knob cannot actuate adjacent levers',()=>{
 const f=fixture(),hand=f.tracked();try{
  const a=f.control('tilt'),b=f.control('sideShift'),p=f.center(a);hand.place(p,.11);f.step();
  hand.place(p,.03,{sameSide:true});f.step();assert.equal(hand.state.control,null);
  hand.place(p,.11);f.step();const middle=f.center(a).lerp(f.center(b),.5);hand.place(middle,.015);f.step();
  assert.equal(hand.state.control,null);assert(hand.controller.userData.xrRaySuppressed);assert(f.cab.owns(hand.inputSource));
  for(const c of [a,b])assert.equal(c.owner,null);
 }finally{f.close();}
});

test('tracking loss, menus and disabled input release immediately and require a fresh open hand',()=>{
 const f=fixture(),hand=f.tracked();try{
  const c=f.control('lift'),acquire=()=>{hand.place(f.center(c),.11);f.step();hand.place(f.center(c));f.step();assert.equal(hand.state.control,c);};
  acquire();hand.place(f.center(c),.056,{lost:true});f.step();assert.equal(c.owner,null);
  hand.place(f.center(c));f.step();assert.equal(c.owner,null);acquire();
  f.ctx.publicDialogOpen=true;f.step();assert.equal(c.owner,null);f.ctx.publicDialogOpen=false;hand.place(f.center(c));f.step();assert.equal(c.owner,null);acquire();
  f.ctx.raycontrol.enabled=false;f.step();assert.equal(c.owner,null);f.ctx.raycontrol.enabled=true;hand.place(f.center(c));f.step();assert.equal(c.owner,null);
 }finally{f.close();}
});

test('a second measured hand cannot steal an occupied knob or capture it on the first hand release',()=>{
 const f=fixture(),one=f.tracked(),two=f.tracked('left');try{
  const c=f.control('tilt'),p=f.center(c);one.place(p,.11);two.place(p,.11);f.step();one.place(p);f.step();assert.equal(c.owner,one.state);
  two.place(p);f.step();assert.equal(c.owner,one.state);assert(f.cab.owns(two.inputSource));
  one.place(p,.11);f.step();assert.equal(c.owner,null);assert.equal(two.state.control,null);
  two.place(p,.11);f.step();two.place(p);f.step();assert.equal(c.owner,two.state);
 }finally{f.close();}
});
