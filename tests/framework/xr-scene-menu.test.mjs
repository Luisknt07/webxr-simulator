import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three');
const source=file=>fs.readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const Events=new Function(source('packages/render-three/src/EventDispatcher.js').replace('default class EventDispatcher','return class EventDispatcher'))();
const Ray=new Function('THREE','EventDispatcher',source('packages/render-three/src/RayControl.js').replace('default class RayControl','return class RayControl'))(THREE,Events);
const Launcher=new Function('THREE',source('packages/navigation-ui/XRMenuLauncher.js').replace('default class XRMenuLauncher','return class XRMenuLauncher'))(THREE);
const Menu=new Function('THREE','XRMenuLauncher',source('packages/navigation-ui/XRSceneMenu.js').replace('default class XRSceneMenu','return class XRSceneMenu'))(THREE,Launcher);
const vec=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
function fixture(){
 const scene=new THREE.Scene(),rig=new THREE.Group(),camera=new THREE.PerspectiveCamera();scene.add(rig);rig.add(camera);camera.position.set(0,1.65,0);scene.updateMatrixWorld(true);
 const canvases=[],calls=[],document={createElement(tag){assert.equal(tag,'canvas');const canvas={width:0,height:0,text:[]},d={fillRect(){},strokeRect(){},fillText(text,x,y){canvas.text.push({text,x,y});},measureText:text=>({width:String(text).length*14})};canvas.getContext=()=>d;canvases.push(canvas);return canvas;}};
 const session={visibilityState:'visible',async end(){calls.push('exit');}},beam=new THREE.Group();const mesh=new THREE.Mesh(new THREE.BoxBufferGeometry(.001,.001,1));mesh.name='beam';beam.add(mesh);
 const ctx={scene,camera,cameraRig:rig,document,vrMode:true,renderer:{xr:{isPresenting:true,getSession:()=>session,getCamera:()=>{scene.updateMatrixWorld(true);return camera;}}},assets:{teleport_model:{scene:beam},beam_tex:new THREE.Texture()},shaders:{basic_vert:'',beam_frag:''},input:{reset(){calls.push('reset');}},teleport:{cancel(){calls.push('teleportCancel');}}};
 const ray=ctx.raycontrol=new Ray(ctx,'right');const controls=['left','right'].map(handedness=>{const controller=new THREE.Group();rig.add(controller);const inputSource={handedness,targetRayMode:'tracked-pointer',gamepad:{mapping:'xr-standard',buttons:Array.from({length:6},()=>({pressed:false,value:0})),axes:[0,0,0,0]}};return{controller,inputSource,data:ray.addController(controller,inputSource)};});
 ctx.demo={paused:false,simulation:{onInputModeChange(){calls.push('releaseWorld');}},driving:{nearest:()=>({id:'forklift'}),resetInput(){calls.push('neutralCab');}}};
 const menu=new Menu(ctx,{beforeOpen(){calls.push('beforeOpen');},onBoard(){calls.push('board');},onPause(){ctx.demo.paused=!ctx.demo.paused;},onRestart(){calls.push('restart');}});
 const step=()=>{scene.updateMatrixWorld(true);menu.tick(.016);scene.updateMatrixWorld(true);ray.execute(ctx,.016,1);};
 const toggle=(index,button,pressed)=>{controls[index].inputSource.gamepad.buttons[button]={pressed,value:Number(pressed)};step();};
 const point=(mesh,u=.5,v=.5)=>mesh.localToWorld(vec((u-.5)*mesh.geometry.parameters.width,(v-.5)*mesh.geometry.parameters.height,0));
 const aim=(index,target,u=.5,v=.5)=>{const p=point(target,u,v),normal=vec(0,0,1).transformDirection(target.matrixWorld),origin=p.clone().addScaledVector(normal,.5),c=controls[index].controller;c.position.copy(rig.worldToLocal(origin));const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(origin,p,vec(0,1,0)));c.quaternion.copy(rig.getWorldQuaternion(new THREE.Quaternion()).inverse().multiply(q));scene.updateMatrixWorld(true);};
 const click=(key,index=1)=>{const r=menu.regions.find(r=>r.key===key);assert(r,'Missing region '+key);aim(index,menu.mesh,(r.x+r.w/2)/1024,1-(r.y+r.h/2)/960);step();assert.equal(controls[index].data.currentIntersection?.state,menu.state);ray.onSelectStart({target:controls[index].controller});ray.onSelectEnd({target:controls[index].controller});step();};
 const hand=(index,wrist)=>{const c=controls[index];delete c.inputSource.gamepad;c.inputSource.hand=new Map();c.controller.userData.xrHandContact={pokeValid:true,valid:true,pinching:false,wrist:wrist.clone(),indexTip:wrist.clone().add(vec(0,0,-.1)),indexDistal:wrist.clone().add(vec(0,0,-.07)),indexRadius:.007};return c;};
 const finger=(index,target,gap=.1)=>{const normal=vec(0,0,1).transformDirection(target.matrixWorld),p=point(target).addScaledVector(normal,gap),contact=controls[index].controller.userData.xrHandContact;Object.assign(contact,{indexTip:rig.worldToLocal(p.clone()),indexDistal:rig.worldToLocal(p.clone().addScaledVector(normal,.025)),wrist:rig.worldToLocal(p.clone().addScaledVector(normal,.12))});step();};
 const dispose=()=>{menu.dispose();ray.dispose();beam.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});ctx.assets.beam_tex.dispose();};
 return{ctx,menu,ray,scene,rig,camera,session,controls,calls,canvases,step,toggle,click,hand,finger,aim,dispose};
}

test('each hand visibly highlights its exact menu region and a steady hover reuses the canvas without repeated uploads',()=>{
 const f=fixture();try{assert(f.menu.open());for(const [index,key]of [[0,'guide'],[1,'controls']]){const r=f.menu.regions.find(row=>row.key===key);f.aim(index,f.menu.mesh,(r.x+r.w/2)/1024,1-(r.y+r.h/2)/960);}f.step();assert.equal(f.menu.hovers.get(f.controls[0].controller),'guide');assert.equal(f.menu.hovers.get(f.controls[1].controller),'controls');const texture=f.menu.texture,canvas=f.menu.canvas;f.step();const version=texture.version;for(let i=0;i<20;i++)f.step();assert.equal(texture.version,version);assert.equal(f.menu.texture,texture);assert.equal(f.menu.canvas,canvas);f.menu.close();assert.equal(f.menu.hovers.size,0);}finally{f.dispose();}
});

test('the public group-room entry works with either real controller ray and closes the scene menu before delegating',()=>{
 for(const hand of [0,1]){const f=fixture();try{
  let opened=0;f.menu.options.onRooms=()=>{assert.equal(f.menu.opened,false);opened++;};
  f.menu.open();f.click('rooms',hand);assert.equal(opened,1);assert(!f.calls.includes('board'));
 }finally{f.dispose();}}
});

test('public XR menu uses real rays, blocks nearer machines and delegates actual scene actions',()=>{
 const f=fixture();try{
  const machine=new THREE.Mesh(new THREE.PlaneBufferGeometry(6,6),new THREE.MeshBasicMaterial());machine.position.set(0,1.6,-.6);f.scene.add(machine);let starts=0;f.ray.addState('machine',{controller:'both',colliderMesh:machine,onSelectStart(){starts++;}},true);
  f.step();assert.equal(f.canvases.length,0,'Controller entry remains lazy.');f.toggle(1,4,true);assert(f.menu.opened&&f.ctx.studioMenuOpen);assert(f.calls.includes('releaseWorld')&&f.calls.includes('teleportCancel')&&f.calls.includes('neutralCab'));
  assert(f.menu.mesh.material.transparent&&f.menu.mesh.renderOrder>=10000,'World decals must not render over the modal canvas in the opaque/transparent passes.');
  f.click('controls');assert.equal(f.menu.page,'controls');assert.equal(starts,0);assert(f.menu.canvas.text.some(row=>row.text.includes('Teletransporte:')));
  f.click('back');f.click('pause');assert(f.ctx.demo.paused);f.click('pause');assert(!f.ctx.demo.paused);f.click('drive');assert(!f.menu.opened&&!f.ctx.studioMenuOpen);assert(f.calls.includes('board'));
  machine.geometry.dispose();machine.material.dispose();
 }finally{f.dispose();}
});

test('walking X/A, seated Y and neutral rearm preserve brake/cargo and reject tracking suspension',()=>{
 const f=fixture();try{
  f.toggle(1,4,true);assert(!f.menu.opened,'Held on entry is not a fresh press.');f.toggle(1,4,false);f.toggle(1,4,true);assert(f.menu.opened);f.menu.close();
  f.ctx.drivingVehicle='forklift';f.step();f.toggle(0,4,true);f.toggle(1,5,true);assert(!f.menu.opened);f.toggle(0,5,true);assert(f.menu.opened);f.menu.close();
  f.session.visibilityState='visible-blurred';f.step();f.session.visibilityState='visible';f.step();assert(!f.menu.opened);f.toggle(0,5,false);f.toggle(0,5,true);assert(f.menu.opened);
 }finally{f.dispose();}
});

test('preferred-hand and movement choices stay connected to native selectors after leaving XR',()=>{
 const f=fixture();try{
  f.ctx.desktopControllerData={inputSource:{handedness:'right'}};f.menu.open();f.click('navigation');f.click('hand');assert.equal(f.ctx.handedness,'left');assert(f.ray.matchController(f.ctx.desktopControllerData,'primary'),'Desktop selection must follow the same primary-hand setting.');f.click('movement');assert.equal(f.ctx.studioLocomotion,'teleport');f.click('movement');assert.equal(f.ctx.studioLocomotion,'smooth');
 }finally{f.dispose();}
});

test('measured index opens the wrist launcher without a target ray; resting/own hand never repeats',()=>{
 const f=fixture();try{
  f.hand(0,vec(-.2,1.2,-.4));f.hand(1,vec(.2,1.2,-.4));f.step();const launcher=f.menu.launcher;assert(launcher.mesh.visible);assert.equal(f.canvases.length,1);
  f.ray.deactivateAll();f.step();assert(f.ray.currentStates.includes(launcher.state),'Scene runtime reactivation must preserve the measured-hand menu entry.');
  assert(!launcher.state.isSelectable({distance:.01},{userData:{xrDirectTouch:true},controller:f.controls[0].controller}));
  f.finger(1,launcher.mesh,.1);f.finger(1,launcher.mesh,.004);assert(f.menu.opened&&f.ctx.studioMenuOpen);f.step();assert.equal(f.canvases.length,2,'Only the launcher and one menu surface are allocated.');
  f.menu.close();f.step();assert(!f.menu.opened,'Resting index must withdraw before pressing again.');
  delete f.controls[0].controller.userData.xrHandContact;delete f.controls[1].controller.userData.xrHandContact;f.step();assert(!launcher.mesh.visible);
 }finally{f.dispose();}
});

test('one measured hand gets a reachable entry while transformed rigs preserve the headset',()=>{
 const f=fixture();try{
  f.rig.position.set(3,.2,-4);f.rig.rotation.y=.8;f.scene.updateMatrixWorld(true);const position=f.camera.position.clone(),rotation=f.camera.quaternion.clone();
  f.hand(1,vec(.2,1.2,-.4));f.step();const launcher=f.menu.launcher;assert(launcher.mesh.visible);const eye=f.camera.getWorldPosition(vec()),distance=launcher.mesh.getWorldPosition(vec()).distanceTo(eye);assert(distance>.4&&distance<.8);
  f.finger(1,launcher.mesh,.1);f.finger(1,launcher.mesh,.004);assert(f.menu.opened);assert(f.camera.position.equals(position)&&f.camera.quaternion.equals(rotation));
  f.ctx.vrMode=false;f.step();assert(!f.menu.mesh&&!launcher.mesh);f.ctx.vrMode=true;f.step();assert(launcher.mesh.visible,'Re-entry reconstructs its bounded resources.');
 }finally{f.dispose();}
});

test('tracked controllers without X/A/Y retain a real ray-selectable menu entry',()=>{
 const f=fixture();try{
  for(const row of f.controls)row.inputSource.gamepad.buttons.length=2;f.step();const launcher=f.menu.launcher;assert(launcher.mesh.visible);f.aim(1,launcher.mesh);f.step();assert.equal(f.controls[1].data.currentIntersection?.state,launcher.state);f.ray.onSelectStart({target:f.controls[1].controller});f.ray.onSelectEnd({target:f.controls[1].controller});assert(f.menu.opened);
 }finally{f.dispose();}
});

test('public session exit has one pending request, supports rejection/retry and never fabricates an exit',async()=>{
 const f=fixture();try{
  f.menu.open();let reject;f.session.end=()=>{f.calls.push('end');return new Promise((resolve,fail)=>{reject=fail;});};const request=f.menu.exit();await f.menu.exit();assert.equal(f.calls.filter(x=>x==='end').length,1);assert(f.ctx.xrExitPending);
  reject(Error('device busy'));await request;assert(!f.ctx.xrExitPending&&f.ctx.vrMode&&f.menu.opened);assert(f.menu.error.includes('Vuelve a pulsar'));
  f.session.end=async()=>{f.ctx.vrMode=false;};await f.menu.exit();f.step();assert(!f.ctx.vrMode&&!f.menu.mesh&&!f.ctx.studioMenuOpen);
 }finally{f.dispose();}
});
