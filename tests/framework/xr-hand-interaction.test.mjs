import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url),THREE=require('three');
const source=file=>fs.readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const Events=new Function(source('packages/render-three/src/EventDispatcher.js').replace('default class EventDispatcher','return class EventDispatcher'))();
const Ray=new Function('THREE','EventDispatcher',source('packages/render-three/src/RayControl.js').replace('default class RayControl','return class RayControl'))(THREE,Events);
const Teleport=new Function('THREE',source('packages/render-three/src/Teleport.js').replace('default class Teleport','return class Teleport'))(THREE);
const {createXRGrip,updateXRGrip,disposeXRGrip}=require('../support/load-xr-grip.js')(THREE);
const vec=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);

function tracked(ctx,ray,parent,name='right'){
 const controller=new THREE.Group();parent.add(controller);
 const hand=new Map(['wrist','thumb-tip','index-finger-tip','index-finger-phalanx-distal'].map(name=>[name,{}]));
 const inputSource={handedness:name,targetRayMode:'tracked-pointer',hand},poses=new Map();
 ctx.renderer.xr.getReferenceSpace=()=>({});
 const grip=createXRGrip(ctx.renderer,controller,0);parent.add(grip);
 const data=ray.addController(controller,inputSource);data.grip=grip;
 controller.addEventListener('selectstart',()=>ray.onSelectStart({target:controller}));controller.addEventListener('selectend',()=>ray.onSelectEnd({target:controller}));
 const place=(tip,normal=vec(0,0,1),{thumb=true,distal=true,pinch=false}={})=>{
  parent.updateWorldMatrix(true,false);const local=p=>parent.worldToLocal(p.clone());
  const points={'index-finger-tip':tip,'index-finger-phalanx-distal':tip.clone().addScaledVector(normal,.026),wrist:tip.clone().addScaledVector(normal,.12),'thumb-tip':tip.clone().add(vec(pinch?.015:.07,0,0))};
  poses.clear();for(const [name,joint]of hand){if(name==='thumb-tip'&&!thumb||name==='index-finger-phalanx-distal'&&!distal)continue;const p=local(points[name]);poses.set(joint,{radius:.007,transform:{matrix:new THREE.Matrix4().makeTranslation(p.x,p.y,p.z).toArray()}});}
  updateXRGrip(ctx.renderer,controller,inputSource,{getJointPose:joint=>poses.get(joint)});ctx.scene.updateMatrixWorld(true);
 };
 return{controller,inputSource,data,grip,place,dispose(){ray.removeController(controller);disposeXRGrip(controller);}};
}
function fixture(){
 const scene=new THREE.Scene(),rig=new THREE.Group();scene.add(rig);rig.position.set(2,.2,1);rig.rotation.y=.42;
 const session=new THREE.EventDispatcher();session.visibilityState='visible';
 const ctx={scene,cameraRig:rig,vrMode:true,renderer:{xr:{getSession:()=>session}},editor:{active:false}};
 const ray=ctx.raycontrol=new Ray(ctx),hand=tracked(ctx,ray,rig);
 const plane=new THREE.Mesh(new THREE.PlaneBufferGeometry(.5,.4),new THREE.MeshBasicMaterial());plane.position.set(0,1.2,-.5);rig.add(plane);
 const events={down:0,up:0,cancel:0,hits:[]};
 const state={controller:'both',handTouchable:true,captureSelect:true,consumeSelect:true,colliderMesh:plane,onSelectStart:(hit,token)=>{events.down++;events.hits.push(hit);assert(token.userData.xrDirectTouch);},onSelectEnd:()=>events.up++,onSelectCancel:()=>events.cancel++};
 ray.addState('panel',state,true);
 const step=()=>{scene.updateMatrixWorld(true);ray.execute(ctx,.016,0);};
 const place=(gap,options={})=>{scene.updateMatrixWorld(true);const normal=vec(0,0,1).transformDirection(plane.matrixWorld),point=plane.localToWorld(vec(0,0,gap));hand.place(point,normal,options);step();};
 return{ctx,scene,rig,session,ray,hand,plane,state,events,place,step,dispose(){hand.dispose();ray.dispose();}};
}

test('measured index presses exact mesh/UV without a target ray, debounces jitter and never synthesizes a pinch',()=>{
 const f=fixture();try{
  f.hand.controller.visible=false;f.place(.12);f.place(.03);assert.equal(f.events.down,0);f.place(.006);
  assert.equal(f.events.down,1);assert(Math.abs(f.events.hits[0].uv.x-.5)<1e-5);assert.equal(f.hand.data.active,false);
  for(const gap of [.005,.008,.002,.007])f.place(gap);assert.equal(f.events.down,1);
  f.place(.006,{thumb:false});assert.equal(f.events.cancel,0,'Index contact remains valid when only the thumb is occluded.');
  f.place(.03);assert.equal(f.events.up,1);f.place(.006);assert.equal(f.events.down,1,'A short withdrawal must not retrigger.');
  f.place(.12);f.place(.006);assert.equal(f.events.down,2);
  f.place(.006,{distal:false});assert.equal(f.events.cancel,1);assert(!f.hand.controller.userData.xrTouchActive);
  f.place(.006);assert.equal(f.events.down,2,'Resting on a cap after tracking recovers must not actuate.');
 }finally{f.dispose();}
});

test('contact cancels on menus, obstruction, session blur and state removal; native pinch cannot click through it',()=>{
 const f=fixture();try{
  f.place(.12);f.place(.006);f.hand.controller.visible=true;
  f.ray.onSelectStart({target:f.hand.controller});assert.equal(f.hand.data.active,false);
  f.session.visibilityState='visible-blurred';f.session.dispatchEvent({type:'visibilitychange'});assert.equal(f.events.cancel,1);
  f.session.visibilityState='visible';f.place(.006);assert.equal(f.events.down,1);f.place(.12);f.place(.006);assert.equal(f.events.down,2);
  f.ctx.publicDialogOpen=true;f.step();assert.equal(f.events.cancel,2);f.ctx.publicDialogOpen=false;
  f.ctx.collisionWorld={rayBlocked:()=>true};f.place(.12);f.place(.006);assert.equal(f.events.down,2);
  delete f.ctx.collisionWorld;f.place(.12);f.place(.006);assert.equal(f.events.down,3);
  f.ray.deactivateState('panel');assert.equal(f.events.cancel,3);assert.equal(f.hand.data.handTouch.entry,null);
  f.ray.activateState('panel');f.place(.12);f.place(.006);assert.equal(f.events.down,4);
  f.session.dispatchEvent({type:'end'});assert.equal(f.events.cancel,4,'Session end cancels immediately even when visibility has not changed.');
  f.ctx.renderer.xr.getSession=()=>null;f.place(.006);assert.equal(f.events.down,4);assert(!f.hand.controller.userData.xrTouchActive);
 }finally{f.dispose();}
 assert.equal((f.session._listeners.squeezestart||[]).length,0);
});

const industrialText=fs.readFileSync('tests/legacy/test-industrial-xr.js','utf8');
const industrial=new Function('require','__dirname',industrialText.slice(0,industrialText.indexOf('async function run()'))+'\nreturn{setup,advance,aim,button,select};')(require,require('node:path').resolve('tests/legacy'));
test('production industrial cap accepts measured index, and real cargo uses pinch-down/up with native squeeze isolation',()=>{
 const f=industrial.setup();f.runtime.start('hall');industrial.advance(f);
 f.left.dispatchEvent({type:'disconnected'});
 const hand=tracked(f.ctx,f.ctx.raycontrol,f.scene,'left');
 try{
  const button=industrial.button(f,'powerOn'),normal=vec(0,0,1).transformDirection(button.object.matrixWorld);
  // Native cylinders are rotated onto the panel's +Z normal.
  const point=button.cap.getWorldPosition(vec()).addScaledVector(normal,.016);
  hand.controller.visible=false;hand.place(point.clone().addScaledVector(normal,.12),normal);industrial.advance(f);
  const before=f.runtime.getControlFeedback(button.id).sequence;
  hand.place(point.clone().addScaledVector(normal,.004),normal);industrial.advance(f);
  assert.equal(f.runtime.getControlFeedback(button.id).sequence,before+1);
  hand.place(point.clone().addScaledVector(normal,.15),normal);industrial.advance(f);
  const product=f.runtime.products.get(f.cartons[0]),center=product.bounds.getCenter(vec()).applyMatrix4(product.object.matrixWorld);
  hand.controller.visible=true;industrial.aim(f,hand.controller,center);hand.place(center,vec(0,0,1),{pinch:true});industrial.advance(f);
  industrial.select(f,hand.controller,'selectstart');assert.equal(product.heldBy===hand.controller,true,'Native pinch-down picks the box.');assert.equal(product.holdInput,'pinch');
  assert.equal(hand.controller.userData.xrHeldObject.object,product.object);
  industrial.advance(f);const position=product.object.getWorldPosition(vec());
  hand.place(center.clone().add(vec(0,.08,0)),vec(0,0,1),{pinch:true});industrial.advance(f);assert(product.object.getWorldPosition(vec()).y>position.y+.04);
  industrial.select(f,hand.controller,'squeezestart');industrial.select(f,hand.controller,'squeezeend');assert.equal(product.heldBy===hand.controller,true);
  industrial.select(f,hand.controller,'selectend');assert.equal(product.heldBy,null);
  assert.equal(hand.controller.userData.xrHeldObject,undefined,'Dropping retires the visual grip together with custody.');
  industrial.advance(f,.1);const next=product.bounds.getCenter(vec()).applyMatrix4(product.object.matrixWorld);
  hand.place(next,vec(0,0,1),{pinch:true});industrial.aim(f,hand.controller,next);industrial.select(f,hand.controller,'selectstart');assert.equal(product.heldBy===hand.controller,true,'A fresh pinch can pick the released box.');
  hand.place(next,vec(0,0,1),{thumb:false});industrial.advance(f);assert.equal(product.heldBy,null,'Lost measured pinch tracking cancels cargo custody.');
 }finally{hand.dispose();f.visuals.dispose();f.runtime.stop();f.ctx.raycontrol.dispose();}
});

test('native r112 session squeeze reaches the correct controller once and retires on session change',()=>{
 const f=fixture(),source={handedness:'left'},controller=new THREE.Group();f.rig.add(controller);f.ray.addController(controller,source);
 let down=0,up=0;controller.addEventListener('squeezestart',()=>down++);controller.addEventListener('squeezeend',()=>up++);
 try{f.step();f.step();f.session.dispatchEvent({type:'squeezestart',inputSource:source});f.session.dispatchEvent({type:'squeezeend',inputSource:source});assert.deepEqual([down,up],[1,1]);f.ray.syncXRSession(null);f.session.dispatchEvent({type:'squeezestart',inputSource:source});assert.equal(down,1);}finally{f.dispose();}
});

test('the actual forklift caps accept index presses while stopped and cancel held horn when tracking disappears',()=>{
 const h=require('../legacy/test-vehicle-driving.js'),f=h.setup(true);f.driving.dispose();
 f.ctx.raycontrol=new Ray(f.ctx);f.driving=new h.Driving(f.ctx,f.runtime,{document:f.dom,window:f.window});assert(f.driving.mount(f.record.id));
 const hand=tracked(f.ctx,f.ctx.raycontrol,f.cameraRig),cab=f.driving.cab;
 const step=()=>{f.scene.updateMatrixWorld(true);f.ctx.raycontrol.execute(f.ctx,.016,0);f.driving.beforeStep();};
 const place=(id,gap,options)=>{const c=cab.controls.find(c=>c.channel===id);f.scene.updateMatrixWorld(true);const normal=new THREE.Vector3().fromArray(c.descriptor.pressAxis).negate().transformDirection(c.object.matrixWorld),point=c.object.getWorldPosition(vec()).addScaledVector(normal,.006+gap);hand.place(point,normal,options);step();};
 const press=id=>{place(id,.13);place(id,.003);};
 try{
  f.driving.command('powerOff');step();hand.controller.visible=false;press('ignition');assert(f.v.powered&&f.v.running);
  press('lights');assert.equal(f.v.lights,true);place('lights',.13);press('emergency');assert(f.v.emergency&&!f.v.running);
  press('resetEmergency');assert(!f.v.emergency&&!f.v.running);press('ignition');assert(f.v.running);
  press('horn');const count=f.v.hornCount;f.runtime.time+=.3;step();assert(f.v.hornCount>count);
  place('horn',.003,{distal:false});const ended=f.v.hornCount;f.runtime.time+=1;step();assert.equal(f.v.hornCount,ended);
  assert(cab.touchStates.length>=6);
 }finally{hand.dispose();f.driving.dispose();assert(!f.ctx.raycontrol.currentStates.some(s=>s.handTouchOnly));f.runtime.stop();f.ctx.raycontrol.dispose();}
});

test('original hand ray teleport requires a fresh pinch, rejects intervening walls and preserves headset offset',()=>{
 const f=fixture();f.ray.deactivateState('panel');f.ctx.camera=new THREE.PerspectiveCamera();f.rig.add(f.ctx.camera);f.ctx.camera.position.set(.2,1.65,.1);
 f.ctx.renderer.xr.isPresenting=true;f.ctx.renderer.xr.getCamera=()=>{f.scene.updateMatrixWorld(true);return f.ctx.camera;};
 const floor=new THREE.Mesh(new THREE.PlaneBufferGeometry(20,20),new THREE.MeshBasicMaterial());floor.rotation.x=-Math.PI/2;floor.userData.editorBehaviors=[{type:'teleport'}];f.scene.add(floor);
 f.ctx.collisionWorld={root:f.scene,canOccupyCapsule:()=>true,rayBlocked:()=>false};
 const teleport=f.ctx.teleport=new Teleport(f.ctx);teleport.installRayState();
 try{
  f.hand.place(vec(2,1,1));f.hand.controller.position.set(0,1.2,0);f.hand.controller.rotation.x=-.7;teleport.tick();f.step();
  assert(f.hand.data.currentIntersection?.state.teleport);const start=f.rig.position.clone();f.ray.onSelectEnd({target:f.hand.controller});assert(f.rig.position.equals(start));
  const target=f.hand.data.currentIntersection.intersection.point.clone();f.ray.onSelectStart({target:f.hand.controller});f.ray.onSelectEnd({target:f.hand.controller});
  const head=f.ctx.camera.getWorldPosition(vec());assert(Math.abs(head.x-target.x)<1e-6&&Math.abs(head.z-target.z)<1e-6);assert.equal(f.ctx.camera.position.x,.2);
  f.ctx.collisionWorld.rayBlocked=()=>true;f.step();assert.equal(f.hand.data.currentIntersection,null);
 }finally{teleport.dispose();f.dispose();}
});
