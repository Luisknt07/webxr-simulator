import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three');
const source=fs.readFileSync(new URL('../../packages/render-three/BrowserInput.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class BrowserInput','return class BrowserInput');
const teleportSource=fs.readFileSync(new URL('../../packages/render-three/src/Teleport.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class Teleport','return class Teleport');
const Teleport=new Function('THREE',teleportSource)(THREE);
const collisionSource=fs.readFileSync(new URL('../../packages/render-three/src/CollisionWorld.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class CollisionWorld','return class CollisionWorld');
const CollisionWorld=new Function('THREE','getGeometryTree',collisionSource)(THREE,()=>{throw Error('Fixture uses actual native Geometry triangles.');});
class Events{
 constructor(tagName='DIV'){this.tagName=tagName;this.events=new Map();this.children=[];this.attributes=new Map();this.captured=new Set();this.hidden=false;this.isConnected=true;}
 addEventListener(type,fn){const rows=this.events.get(type)||new Set();rows.add(fn);this.events.set(type,rows);}
 removeEventListener(type,fn){const rows=this.events.get(type);if(rows)rows.delete(fn);}
 fire(type,event={}){const e={target:this,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...event};for(const fn of this.events.get(type)||[])fn(e);return e;}
 setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name);}
 appendChild(node){this.children.push(node);return node;}remove(){this.isConnected=false;}
 setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);this.fire('lostpointercapture',{pointerId:id});}
 getBoundingClientRect(){return{x:0,y:0,width:100,height:100};}
}
class Ray{
 constructor(){this.controllers=[];this.states={};this.currentStates=[];this.raycasterContext=new THREE.Group();}
 addState(name,state){this.states[name]=state;this.currentStates.push(state);}deactivateState(name){this.currentStates=this.currentStates.filter(state=>state!==this.states[name]);}
 setLineStyle(){}addController(controller,inputSource,aim){const data={controller,inputSource,aim};this.controllers.push(data);return data;}
 removeController(controller){this.controllers=this.controllers.filter(row=>row.controller!==controller);}execute(){}onSelectStart(){}onSelectEnd(){}cancelSelect(){}
}
class Locomotion{reset(){}dispose(){}tick(){}}
function fixture(){
 const document=new Events(),window=new Events(),canvas=new Events('CANVAS');document.body=new Events('BODY');document.createElement=tag=>new Events(tag.toUpperCase());canvas.ownerDocument=document;
 const ctx={room:0,roomId:'hall',desktopFlight:false,vrMode:false,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),cameraRig:new THREE.Group(),renderer:{xr:{getController:()=>new THREE.Group(),getSession:()=>null}}};ctx.camera.position.set(0,1.65,0);ctx.cameraRig.add(ctx.camera);ctx.scene.add(ctx.cameraRig);
 const room=new THREE.Group(),floor=new THREE.Mesh(new THREE.BoxGeometry(30,.2,30),new THREE.MeshBasicMaterial()),wall=new THREE.Mesh(new THREE.BoxGeometry(6,4,.2),new THREE.MeshBasicMaterial());floor.position.y=-.1;wall.position.set(0,2,-1);room.add(floor,wall);ctx.scene.add(room);
 const world=new CollisionWorld(ctx,{getRoot:()=>room});world.setRoom('hall');ctx.collisionWorld=world;
 let capsules=0;const move=world.moveCapsule.bind(world);world.moveCapsule=(...args)=>{capsules++;return move(...args);};
 const Input=new Function('THREE','RayControl','XRLocomotion','Teleport','createXRGrip','updateXRGrip','disposeXRGrip','document','window',source)(THREE,Ray,Locomotion,Teleport,()=>new THREE.Group(),()=>{},()=>{},document,window);
 const input=new Input(ctx,canvas,{canWalk:()=>!ctx.drivingVehicle}),position=()=>{ctx.scene.updateMatrixWorld(true);return ctx.camera.getWorldPosition(new THREE.Vector3());};
 world.dispose=()=>{room.traverse(node=>{if(node.geometry)node.geometry.dispose();if(node.material)node.material.dispose();});};
 const key=(code,extra={})=>window.fire('keydown',{code,ctrlKey:false,metaKey:false,altKey:false,target:canvas,...extra});
 const up=(code,extra={})=>window.fire('keyup',{code,ctrlKey:false,...extra});
 const buttons=Object.fromEntries(input.flightTouch.children.map(button=>[button.getAttribute('data-flight-axis'),button]));
 return{ctx,input,document,window,canvas,room,wall,floor,world,position,key,up,buttons,capsules:()=>capsules};
}
const pointer=id=>({pointerId:id,button:0});
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,actual+' != '+expected);

test('desktop and touch walking settle down the physical ramp while flight and vehicle guards retain their own control',()=>{
 for(const touch of [false,true]){
  const f=fixture();f.wall.visible=false;f.room.remove(f.floor);f.floor.geometry.dispose();f.floor.material.dispose();
  const add=(size,p)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial());mesh.position.fromArray(p);f.room.add(mesh);};
  add([4,.24,2],[0,-.12,-1]);add([4,.24,2],[0,-1.27,13]);
  const p=[[-2,0,0],[2,0,0],[2,-1.15,12],[-2,-1.15,12],[-2,-1.4,0],[2,-1.4,0],[2,-1.4,12],[-2,-1.4,12]],faces=[[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]],buffer=new THREE.BufferGeometry();buffer.setAttribute('position',new THREE.Float32BufferAttribute(faces.flatMap(face=>face.flatMap(i=>p[i])),3));const geometry=new THREE.Geometry().fromBufferGeometry(buffer);buffer.dispose();f.room.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));
  f.ctx.cameraRig.position.z=-.5;
  if(touch)f.input.axes.y=-1;else f.key('KeyS');
  for(let i=0;i<65;i++){f.world.beginFrame();f.input.step(.1);f.world.endFrame();}
  assert(Math.abs(f.position().y-.502)<.008,'Walking input must follow the actual depressed apron.');assert(f.position().z>12.4);
  f.ctx.drivingVehicle='fork-1';const stopped=f.position();f.input.step(.1);assert(f.position().equals(stopped),'Pedestrian floor following cannot overwrite vehicle seating.');
  f.input.dispose();f.world.dispose();
 }
});

test('walking uses the real capsule collision world while enabled desktop flight crosses it in native Three coordinates',()=>{
 const f=fixture();f.key('KeyW');for(let i=0;i<10;i++)f.input.step(.1);assert(f.capsules()>=10);assert(f.position().z>-.8,'Walking cannot cross the real wall.');assert(Math.abs(f.position().y-1.65)<.003,'Native floor skin keeps the walking eye at ground height.');
 f.input.reset();f.ctx.desktopFlight=true;f.key('KeyW');const count=f.capsules(),before=f.position();f.input.step(.1);assert.equal(f.capsules(),count,'Flight does not run ground capsule resolution.');near(f.position().distanceTo(before),.3);for(let i=0;i<5;i++)f.input.step(.1);assert(f.position().z<-1.1,'Flight reaches the other side of the actual wall.');f.input.dispose();f.world.dispose();
});

test('a resumed or non-finite desktop walking frame cannot create an unbounded surface-follow sweep',()=>{
 const f=fixture();f.wall.visible=false;f.key('KeyS');let before=f.position();f.input.step(1000);assert(Math.abs(f.position().z-before.z-.2)<.0001);before=f.position();f.input.step(Infinity);assert(f.position().equals(before));f.input.dispose();f.world.dispose();
});

test('flight follows the real look vector, normalizes diagonals, supports Ctrl boost and clamps world altitude/delta',()=>{
 const f=fixture();f.ctx.desktopFlight=true;f.ctx.camera.quaternion.setFromEuler(new THREE.Euler(.4,.3,0,'YXZ'));f.key('KeyW');let before=f.position();f.input.step(.1);near(f.position().distanceTo(before),.3);assert(f.position().y>before.y,'Looking upward advances upward in drone mode.');
 f.input.reset();f.key('KeyW');f.key('KeyD');f.key('KeyQ');before=f.position();f.input.step(.1);near(f.position().distanceTo(before),.3);
 f.input.reset();f.key('KeyQ');before=f.position();f.input.step(.1);near(f.position().y-before.y,.3);
 f.key('ControlLeft',{ctrlKey:true});before=f.position();f.input.step(.1);near(f.position().y-before.y,.9);f.up('ControlLeft');before=f.position();f.input.step(.1);near(f.position().y-before.y,.3);
 f.input.reset();f.key('KeyQ',{ctrlKey:true});before=f.position();f.input.step(100);near(f.position().y-before.y,.9,'A stalled frame cannot teleport the camera.');
 for(let i=0;i<50;i++)f.input.step(.1);near(f.position().y,30);f.input.reset();f.key('KeyE',{ctrlKey:true});for(let i=0;i<50;i++)f.input.step(.1);near(f.position().y,1.65);
 f.input.reset();before=f.position();f.key('KeyQ');f.input.step(Infinity);assert(f.position().equals(before));f.input.dispose();f.world.dispose();
});

test('XR including a missing session, driving, modal and typing never receive desktop-flight transforms or stale resumed input',()=>{
 for(const flag of ['vrMode','drivingVehicle','publicDialogOpen','studioMenuOpen','voicePanelOpen','assistantPanelOpen','externalDevicePanelOpen']){
  const f=fixture();f.ctx.desktopFlight=true;f.key('KeyQ');f.input.step(.1);f.ctx[flag]=flag==='drivingVehicle'?'fork-1':true;const before=f.position(),rotation=f.ctx.camera.quaternion.clone();f.input.step(.1);f.key('KeyQ');f.input.step(.1);assert(f.position().equals(before),flag);assert(f.ctx.camera.quaternion.equals(rotation),flag);assert.equal(f.input.keys.size,0);assert(f.input.flightTouch.hidden);f.ctx[flag]=false;f.input.step(.1);assert(f.position().equals(before),'Reopening '+flag+' cannot revive held flight keys.');f.input.dispose();f.world.dispose();
 }
 const f=fixture();f.ctx.desktopFlight=true;for(const target of [{tagName:'INPUT'},{tagName:'TEXTAREA'},{tagName:'SELECT'},{tagName:'DIV',isContentEditable:true}]){const before=f.position();f.key('KeyQ',{target});f.input.step(.1);assert(f.position().equals(before));}
 const before=f.position();f.key('KeyW',{metaKey:true});f.key('KeyQ',{altKey:true});f.input.step(.1);assert(f.position().equals(before));f.ctx.desktopFlight=false;f.key('KeyQ');f.key('KeyW',{ctrlKey:true});f.input.step(.1);assert(f.position().equals(before));f.input.dispose();f.world.dispose();
});

test('touch altitude is held, additive, released on cancel/capture loss/global-up/blur and cannot revive after mode changes',()=>{
 const f=fixture();assert(f.input.flightTouch.hidden);f.ctx.desktopFlight=true;f.input.step(0);assert(!f.input.flightTouch.hidden);assert.equal(f.input.movePad.textContent,'Volar');
 f.buttons.up.fire('pointerdown',pointer(1));let before=f.position();f.input.step(.1);near(f.position().y-before.y,.3);assert(f.buttons.up.hasPointerCapture(1));
 f.buttons.down.fire('pointerdown',pointer(2));near(f.input.axes.z,0);f.buttons.up.fire('pointercancel',pointer(1));near(f.input.axes.z,-1);f.window.fire('pointerup',pointer(2));near(f.input.axes.z,0);assert(!f.buttons.down.hasPointerCapture(2));
 f.buttons.up.fire('pointerdown',pointer(3));f.buttons.up.fire('lostpointercapture',pointer(3));near(f.input.axes.z,0);
 f.buttons.up.fire('pointerdown',pointer(4));f.window.fire('blur');near(f.input.axes.z,0);assert(!f.buttons.up.hasPointerCapture(4));assert.equal(f.input.flightPointers.size,0);
 f.buttons.up.fire('pointerdown',pointer(5));f.ctx.desktopFlight=false;f.input.step(.1);assert(f.input.flightTouch.hidden);near(f.input.axes.z,0);f.ctx.desktopFlight=true;before=f.position();f.input.step(.1);assert(f.position().equals(before));assert.equal(f.input.flightPointers.size,0);
 f.buttons.up.fire('keydown',{key:'Enter'});near(f.input.axes.z,1);f.buttons.up.fire('keyup',{key:'Enter'});near(f.input.axes.z,0);f.buttons.up.fire('keydown',{key:' '});f.buttons.up.fire('blur');near(f.input.axes.z,0);
 f.buttons.down.fire('pointerdown',pointer(6));f.document.hidden=true;f.document.fire('visibilitychange');near(f.input.axes.z,0);f.input.dispose();assert.equal(f.window.events.get('pointercancel').size,0);assert.equal(f.buttons.up.events.get('pointerdown').size,0);f.world.dispose();
});
