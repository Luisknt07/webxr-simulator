const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-room-transition.js"), '../src/lib', file)), 'utf8').replace(/^import .*;\r?\n/gm, '');
const Navigation = new Function(read('RoomNavigation.js').replace('export default class RoomNavigation', 'return class RoomNavigation'))();
const Transition = new Function('THREE', read('RoomTransition.js').replace('export default class RoomTransition', 'return class RoomTransition'))(THREE);
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const tick = async () => {for(let i=0;i<8;i++)await Promise.resolve();};
class Element {
  constructor() {this.style={};this.dataset={};this.children=[];this.hidden=false;}
  appendChild(child){this.children.push(child);child.parentNode=this;}
  setAttribute(){}
  getContext(){return {fillRect(){},fillText(){}};}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);}
}
function setup(xr=false){
  const dom={body:new Element(),createElement:()=>new Element()},camera=new THREE.PerspectiveCamera(80,1.8,.005,100),rig=new THREE.Group();rig.add(camera);rig.position.set(4,0,8);camera.position.set(.08,1.65,.12);camera.rotation.set(.12,.17,.03);rig.updateMatrixWorld(true);
  const tracked=new THREE.Camera();tracked.matrixWorld.compose(new THREE.Vector3(4.1,1.7,8.2),new THREE.Quaternion().setFromEuler(new THREE.Euler(.2,.3,.1)),new THREE.Vector3(1,1,1));
  const calls=[],ctx={room:0,vrMode:xr,camera,cameraRig:rig,raycontrol:{controllers:[]},xrMirror:{postRender:scene=>calls.push(['mirror',scene])}};
  ctx.renderer={xr:{getCamera:()=>tracked,getSession:()=>({end(){calls.push(['xr-exit']);}})},compile:scene=>calls.push(['compile',scene]),render:scene=>calls.push(['render',scene])};
  const view=new Transition(ctx,{document:dom});view.presented();return {dom,camera,rig,tracked,calls,ctx,view};
}
async function frames(f,count=1){for(let i=0;i<count;i++){f.view.render(f.ctx.renderer,f.camera);await tick();}}
async function run(){
  const f=setup(true),controller=new AbortController(),request={signal:controller.signal,isCurrent:()=>true,assertCurrent(){if(this.signal.aborted)throw Error('aborted');}},localP=f.camera.position.clone(),localQ=f.camera.quaternion.clone(),tracked=f.tracked.matrixWorld.clone();
  let covered=false;const cover=f.view.cover(request).then(()=>{covered=true;});assert(f.view.active);assert.equal(f.dom.body.children[0].style.display,'flex');assert.equal(f.view.shell.material.side,THREE.BackSide);
  await frames(f);assert(!covered,'A loader cannot start before an opaque frame has been presented.');await frames(f);await cover;assert(covered);
  assert(f.calls.filter(c=>c[0]==='render').every(c=>c[1]===f.view.scene),'Loading draws only the independent cover, never the previous room.');
  const destination=new THREE.Scene(),warm=f.view.warm(destination,f.camera,request);await frames(f);await warm;
  const renders=f.calls.filter(c=>c[0]==='render');assert.deepEqual(renders.slice(-2).map(c=>c[1]),[destination,f.view.scene],'The opaque cover is the final stereo render after one-time GPU warmup.');
  assert(!f.calls.some(call=>call[0]==='compile'),'r112 compile() traverses hidden rooms; warmup uses the normal visibility-aware renderer instead.');
  assert(f.camera.position.equals(localP)&&f.camera.quaternion.equals(localQ));assert(f.tracked.matrixWorld.equals(tracked),'Rendering the cover never rewrites WebXR camera tracking matrices.');
  const finishing=f.view.finish(request);await frames(f);await finishing;assert(!f.view.active);
  const aborted=new AbortController(),r={signal:aborted.signal,isCurrent:()=>false};const cancellation=f.view.cover(r);aborted.abort();await assert.rejects(cancellation,/cancelada/);f.view.dispose();
  const xrError=setup(true),input={inputSource:{gamepad:{mapping:'xr-standard',buttons:Array.from({length:6},()=>({pressed:false}))}}};xrError.ctx.raycontrol.controllers=[input];let retries=0;xrError.view.fail(new Error('No destination'),()=>{retries++;});input.inputSource.gamepad.buttons[0].pressed=true;await frames(xrError);assert.equal(retries,0,'An already-held trigger cannot immediately retry an error.');input.inputSource.gamepad.buttons[0].pressed=false;await frames(xrError);input.inputSource.gamepad.buttons[0].pressed=true;await frames(xrError);await tick();assert.equal(retries,1);xrError.view.fail(new Error('No destination'),()=>{});input.inputSource.gamepad.buttons[0].pressed=false;await frames(xrError);input.inputSource.gamepad.buttons[5].pressed=true;await frames(xrError);assert(xrError.calls.some(call=>call[0]==='xr-exit'),'The error cover retains a controller path out of immersive VR.');xrError.view.dispose();

  const g=setup(),loads=new Map(),events=[];let generation=1,sourceStopped=false;
  const navigation=new Navigation(g.ctx,{count:4,getVersion:()=>generation,cover:(r,label)=>{r.yieldControl=()=>g.view.nextFrame(r);return g.view.cover(r,label);},suspend(){sourceStopped=true;events.push('suspend');},prepare:async(room,r)=>{events.push('prepare'+room);if(loads.has(room))await loads.get(room).promise;r.assertCurrent();},commit:room=>{g.ctx.room=room;events.push('commit'+room);},prepareCurrent:async r=>{r.assertCurrent();events.push('warm');},recover:async()=>{sourceStopped=false;events.push('recover');},finish:async r=>{await g.view.finish(r);if(r.isCurrent())sourceStopped=false;},failed:(error,retry)=>g.view.fail(error,retry)});
  const old=deferred(),fresh=deferred();loads.set(1,old);loads.set(2,fresh);
  const first=navigation.go(1);await frames(g,2);assert(sourceStopped);const second=navigation.go(2);await frames(g,2);assert.equal(g.ctx.room,0);old.resolve();assert.equal(await first,false);assert(g.view.active);fresh.resolve();await tick();await frames(g);assert.equal(await second,true);assert.equal(g.ctx.room,2);assert(!g.view.active);assert(!events.includes('commit1'));
  const broken=deferred();loads.set(3,broken);const fail=navigation.go(3);await frames(g,2);broken.reject(new Error('missing destination'));await tick();await frames(g);assert.equal(await fail,false);assert(!g.view.active);assert(!g.ctx.roomTransition);assert.equal(g.ctx.room,2);
  const slow=deferred();loads.set(1,slow);const interrupted=navigation.go(1);await frames(g,2);const cancel=navigation.cancel();await frames(g,3);await cancel;assert(!g.view.active);slow.resolve();assert.equal(await interrupted,false);assert.equal(g.ctx.room,2);

  // Same-room project replacement and nested room navigation retain one cover,
  // despite the expected projectGeneration increment inside the document load.
  const external=navigation.runExternal(async r=>{generation++;await r.yieldControl();r.assertCurrent();await navigation.go(0);return 'loaded';});await frames(g,4);await frames(g,2);assert.equal(await external,'loaded');assert.equal(g.ctx.room,0);assert(!g.view.active);
  const staleLoad=deferred(),rollback=deferred(),work=[];
  const stale=navigation.runExternal(async r=>{work.push('old');await staleLoad.promise;r.assertCurrent();},{recover:async()=>{work.push('rollback');await rollback.promise;}});await frames(g,2);
  const next=navigation.runExternal(async r=>{r.assertCurrent();work.push('new');return 7;});await frames(g,2);staleLoad.resolve();await tick();assert.deepEqual(work,['old','rollback']);assert(g.view.active);rollback.resolve();await assert.rejects(stale,/sustituida/);await tick();await frames(g,2);assert.equal(await next,7);assert.deepEqual(work,['old','rollback','new']);assert(!g.view.active);
  const fatal=navigation.runExternal(async()=>{throw Object.assign(new Error('identity changed'),{keepRoomCover:true});});await frames(g,2);await assert.rejects(fatal,/identity/);assert(g.view.active&&g.view.error);assert(g.ctx.roomTransition);
  const safe=navigation.runExternal(async()=>42);await frames(g,3);assert.equal(await safe,42);assert(!g.view.active);g.view.dispose();
  // Run the actual index native lifecycle hooks, including a same-room project
  // replacement and a document rollback which changes ctx.room before exit.
  const index=fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-room-transition.js"),'../src/index.js')),'utf8'),names=['commitRoomChange','suspendRoomChange','recoverRoomChange','prepareCurrentRoom'];
  const hooks=names.map(name=>{const match=index.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n\\}'));assert(match,name);return match[0];}).join('\n');
  const nativeScene=new THREE.Scene(),nativeRoots=[new THREE.Group(),new THREE.Group()],nativeEvents=[],nativeCtx={room:0,vrMode:false,camera:new THREE.PerspectiveCamera(),cameraRig:new THREE.Group(),editorRoots:{a:nativeRoots[0],b:nativeRoots[1]}};
  nativeScene.add(nativeRoots[0]);nativeCtx.cameraRig.add(nativeCtx.camera);
  const nativeRooms=nativeRoots.map((root,id)=>({exit(){nativeEvents.push('exit'+id);nativeScene.remove(root);},enter(){nativeEvents.push('enter'+id);nativeScene.add(root);}}));
  nativeCtx.editor={active:false,beforeRoomChange(){nativeEvents.push('stop');},afterRoomChange(){nativeEvents.push('after');},prepareRoom:async id=>{nativeEvents.push('prepare'+id);},syncNative(){}};
  nativeCtx.roomTransitionView={warm:async()=>{nativeEvents.push('warm');}};
  const native=new Function('THREE','context','rooms','roomNames','scene','camera','renderer','raycontrol','desktopPortalSpawns','targetPositions','playMusic','resetCollisionPose','clearKeyboardState','ambientMusic','let suspendedRoom;\n'+hooks+'\nreturn {commitRoomChange,suspendRoomChange,recoverRoomChange,prepareCurrentRoom};')(THREE,nativeCtx,nativeRooms,['a','b'],nativeScene,nativeCtx.camera,{xr:{getCamera:c=>c}},{deactivateAll(){}},{},{},()=>{},()=>{},()=>{},null);
  const current={isCurrent:()=>true,assertCurrent(){}};native.suspendRoomChange();assert(!nativeRoots[0].parent);await native.prepareCurrentRoom(current);assert.strictEqual(nativeRoots[0].parent,nativeScene);assert.equal(nativeEvents.filter(event=>event==='enter0').length,1,'Replacing a project in the same room re-enters native systems exactly once.');await native.prepareCurrentRoom(current);assert.equal(nativeEvents.filter(event=>event==='enter0').length,1);
  native.commitRoomChange(1);assert.strictEqual(nativeRoots[1].parent,nativeScene);nativeCtx.room=0;await native.recoverRoomChange(current);assert.equal(nativeRoots[1].parent,null,'Recovery exits the room actually entered, even if document rollback already reset ctx.room.');assert.strictEqual(nativeRoots[0].parent,nativeScene);
  native.suspendRoomChange();assert.equal(nativeRoots[0].parent,null,'A newer request also retires a destination entered but never uncovered.');await native.prepareCurrentRoom(current);assert.strictEqual(nativeRoots[0].parent,nativeScene);
  console.log('Room transition: opaque desktop/XR cover before loading, final-cover GPU warmup, unchanged tracked poses, overlap/abort/error/retry, same-room external replacement and serialized stale-project rollback passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
