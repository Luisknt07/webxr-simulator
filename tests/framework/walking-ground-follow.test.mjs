import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),T=require('three');
const {getGeometryTree}=require('../support/load-geometry-acceleration.js')(T);
const source=fs.readFileSync(new URL('../../packages/render-three/src/CollisionWorld.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class CollisionWorld','class CollisionWorld');
const CollisionWorld=new Function('THREE','getGeometryTree',source+'\nreturn CollisionWorld;')(T,getGeometryTree);
const xrSource=fs.readFileSync(new URL('../../packages/render-three/src/XRLocomotion.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class XRLocomotion','return class XRLocomotion');
const XRLocomotion=new Function('THREE',xrSource)(T);
const v=(x,y,z)=>new T.Vector3(x,y,z),capsule={radius:.25,height:1.65,eyeHeight:1.65};
function fixture(){const root=new T.Group(),world=new CollisionWorld({}, {getRoot:()=>root});world.setRoom('test');return{root,world};}
function box(root,size,position){const mesh=new T.Mesh(new T.BoxBufferGeometry(...size),new T.MeshBasicMaterial());mesh.position.fromArray(position);root.add(mesh);return mesh;}
function walk(world,from,x,z,options=capsule){let position=from.clone(),n=0;while(Math.hypot(position.x-x,position.z-z)>.015&&n++<2400){const delta=v(x-position.x,0,z-position.z);delta.multiplyScalar(Math.min(.03,delta.length())/delta.length());world.beginFrame();position=world.moveWalkingCapsule(position,position.clone().add(delta),options);world.endFrame();}assert(n<2400,'Real horizontal walking became stuck: '+position.toArray());return position;}
function dispose(root){root.traverse(object=>{if(object.geometry)object.geometry.dispose();if(object.material)object.material.dispose();});}
function ramp(root){const p=[[-2,0,0],[2,0,0],[2,-1.15,12],[-2,-1.15,12],[-2,-1.4,0],[2,-1.4,0],[2,-1.4,12],[-2,-1.4,12]],f=[[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]],g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(f.flatMap(face=>face.flatMap(i=>p[i])),3));root.add(new T.Mesh(g,new T.MeshBasicMaterial()));}

test('pedestrians follow the same real ramp upward and downward without changing tracked eye height',()=>{
 for(const height of [1.65,.85]){const {root,world}=fixture(),options={radius:.25,height,eyeHeight:height};try{
  box(root,[4,.24,2],[0,-.12,-1]);box(root,[4,.24,2],[0,-1.27,13]);ramp(root);
  let position=v(0,height+.002,-.5);position=walk(world,position,0,12.5,options);assert(Math.abs(position.y-(-1.15+height+.002))<.006,'Descending must settle on the actual lower apron.');
  position=walk(world,position,0,-.5,options);assert(Math.abs(position.y-height-.002)<.006,'Ascending reaches the actual upper floor.');
 }finally{dispose(root);}}
});

test('real treads work in both directions while a high wall remains impassable',()=>{
 const {root,world}=fixture();try{
  box(root,[3,.24,2],[0,-.12,-1]);for(let i=0;i<6;i++)box(root,[3,(i+1)*.165,.28],[0,(i+1)*.165/2,(i+.5)*.28]);box(root,[3,.24,2],[0,.99-.12,2.68]);
  let position=walk(world,v(0,1.652,-.5),0,2.2);assert(Math.abs(position.y-2.642)<.006);position=walk(world,position,0,-.5);assert(Math.abs(position.y-1.652)<.006,'Descending all treads cannot float above the lower landing.');
  box(root,[3,.8,.25],[0,.4,-.15]);const stop=world.moveWalkingCapsule(position,v(0,1.652,.5),capsule);assert(stop.z<-.5+.2,'Step assistance must not climb an .8 m barrier.');
 }finally{dispose(root);}
});

test('grounding cannot cross a ceiling, pull down from flight height, or bridge an unsupported drop',()=>{
 const {root,world}=fixture();try{
  box(root,[4,.24,4],[0,-.12,0]);box(root,[4,.24,4],[0,3.18,0]);
  const airborne=v(0,3,0),airResult=world.moveWalkingCapsule(airborne,v(.1,3,0),capsule);assert.equal(airResult.y,3,'Nearby ceiling underside is not a walking floor.');
  const high=v(0,8,0);assert.equal(world.moveWalkingCapsule(high,v(.1,8,0),capsule).y,8,'No floor search reaches through several metres.');
  const stopped=world.moveWalkingCapsule(v(0,1.652,0),v(5,1.652,0),capsule);assert(stopped.x<2.05&&stopped.x>1.8);assert(Math.abs(stopped.y-1.652)<.006,'The last supported point remains on the real floor.');
  const raw=v(0,1.85,0);assert.equal(world.moveCapsule(raw,v(.1,1.85,0),capsule).y,1.85,'Equipment/raw capsules have no implicit floor following.');assert.equal(world.moveSphere(v(0,2,0),v(.1,2,0)).y,2,'Flying sphere correction remains unchanged.');
 }finally{dispose(root);}
});

test('a low head obstruction prevents a raised walking destination even when its tread is nearby',()=>{
 const {root,world}=fixture();try{
  box(root,[4,.24,4],[0,-.12,0]);box(root,[4,.165,1],[0,.0825,1.5]);box(root,[4,.2,2],[0,1.78,1.7]);
  const start=v(0,1.652,.2),result=world.moveWalkingCapsule(start,v(0,1.652,1.6),capsule);assert(result.z<1,'Pedestrian cannot step through a low ceiling.');assert(world.canOccupyCapsule(result,capsule));
 }finally{dispose(root);}
});

test('XR stick descent moves the rig onto the lower real floor and preserves headset tracking and vehicle guards',()=>{
 const {root,world}=fixture(),scene=new T.Scene(),rig=new T.Group(),camera=new T.PerspectiveCamera(),trackedCamera=new T.ArrayCamera();scene.add(root,rig);rig.add(camera);rig.position.z=-.5;camera.position.set(19,23,17);
 box(root,[4,.24,2],[0,-.12,-1]);box(root,[4,.24,2],[0,-1.27,13]);ramp(root);
 const tracked=new T.Matrix4().makeTranslation(0,1.7,0),local=camera.position.clone(),inputSource={handedness:'left',gamepad:{mapping:'xr-standard',axes:[0,0,0,0]}},session={visibilityState:'visible'};
 const xr={isPresenting:true,getSession:()=>session,getCamera(){rig.updateWorldMatrix(true,false);trackedCamera.matrixWorld.multiplyMatrices(rig.matrixWorld,tracked);return trackedCamera;}};
 const ctx={vrMode:true,cameraRig:rig,camera,renderer:{xr},collisionWorld:world,studioLocomotion:'smooth',raycontrol:{controllers:[{inputSource}]}};
 const app=fs.readFileSync(new URL('../../apps/workspace/src/index.js',import.meta.url),'utf8'),start=app.indexOf('function constrainVRCamera()'),end=app.indexOf('function setupControllers()',start);assert(start>=0&&end>start);
 const constrain=new Function('THREE','context','renderer','camera','let lastVRCollisionPosition=null;function resetCollisionPose(){lastVRCollisionPosition=null;}\n'+app.slice(start,end)+'\nreturn constrainVRCamera;')(T,ctx,ctx.renderer,camera);
 const navigation=new XRLocomotion(ctx);try{
  navigation.tick(1/60);constrain();inputSource.gamepad.axes[3]=1;for(let i=0;i<520;i++){world.beginFrame();navigation.tick(1/60);constrain();world.endFrame();}
  assert(Math.abs(rig.position.y+1.15)<.008,'XR rig descends to the physical apron instead of floating.');assert(rig.position.z>12.4);assert(camera.position.equals(local),'Headset local tracking fields remain untouched.');
  ctx.drivingVehicle='fork-1';const before=rig.position.clone();navigation.tick(1/60);assert(rig.position.equals(before),'Vehicle seating is outside pedestrian ground following.');
 }finally{navigation.dispose();dispose(root);}
});

test('the exact workspace keyboard/mobile path follows floors and leaves occupied cabs and tracked XR untouched',()=>{
 const app=fs.readFileSync(new URL('../../apps/workspace/src/index.js',import.meta.url),'utf8'),a=app.indexOf('function updateKeyboardMovement(delta)'),b=app.indexOf('function constrainVRCamera()',a);assert(a>=0&&b>a);
 for(const mobile of [false,true]){const {root,world}=fixture(),camera=new T.PerspectiveCamera(),rig=new T.Group();rig.add(camera);camera.position.set(0,1.6,-.5);box(root,[4,.24,2],[0,-.12,-1]);box(root,[4,.24,2],[0,-1.27,13]);ramp(root);
  const keyboard=mobile?{}:{KeyS:true},ctx={cameraRig:rig,collisionWorld:world,...(mobile?{mobileNavigation:{consume:()=>({forward:-1,right:0})}}:{})},controls={moveForward(distance){camera.position.z-=distance;},moveRight(distance){camera.position.x+=distance;}};
  const move=new Function('THREE','context','camera','controls','keyboardState','keyboardMoveSpeed',app.slice(a,b)+'\nreturn updateKeyboardMovement;')(T,ctx,camera,controls,keyboard,2);try{
   for(let i=0;i<65;i++){world.beginFrame();move(.1);world.endFrame();}assert(Math.abs(camera.position.y-.452)<.008);assert(camera.position.z>12.4);
   for(const flag of ['drivingVehicle','vrMode']){ctx[flag]=true;const before=camera.position.clone();move(.1);assert(camera.position.equals(before),flag+' must retain control of its own camera.');ctx[flag]=false;}
  }finally{dispose(root);}
 }
});
