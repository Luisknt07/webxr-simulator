'use strict';
// Actual mechanisms, pallet, monitor and camera. Renderer calls are recorded;
// final browser QA separately verifies the real GPU output.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const h = require('./test-vehicle-runtime.js'), {THREE} = h;
const source = fs.readFileSync(path.join(__dirname, 'test-vehicle-driving.js'), 'utf8');
const {setup, Element} = new Function('require', '__dirname', source.slice(0, source.indexOf('const desktop = setup();')) + '\nreturn {setup,Element};')(require, __dirname);
Element.prototype.getBoundingClientRect = function () { return this.rect || {left: 0, top: 0, width: 768, height: 432}; };
const near = (a, b, eps = 1e-6) => assert(Math.abs(a - b) < eps, `${a} != ${b}`);
function renderer(f) {
  const canvas = new Element('canvas'); canvas.width = 1600; canvas.height = 900; canvas.rect = {left: 0, top: 60, width: 1280, height: 720};
  const state = {target: null, cube: 2, mip: 3, viewport: new THREE.Vector4(4, 5, 800, 450), scissor: new THREE.Vector4(7, 8, 444, 333), scissorTest: true, framebuffer: f.ctx.vrMode ? {} : null};
  f.session.renderState = {baseLayer: {framebuffer: state.framebuffer}};
  const calls = [], api = f.ctx.renderer;
  Object.assign(api, {domElement: canvas, autoClear: false, toneMapping: THREE.ReinhardToneMapping, toneMappingExposure: 1.7,
    shadowMap: {enabled: true, autoUpdate: true, needsUpdate: true}, info: {autoReset: true, render: {calls: 17, triangles: 256, frame: 5, lines: 2, points: 0}},
    getRenderTarget: () => state.target, getActiveCubeFace: () => state.cube, getActiveMipmapLevel: () => state.mip,
    getViewport: out => out.copy(state.viewport), getScissor: out => out.copy(state.scissor), getScissorTest: () => state.scissorTest,
    setRenderTarget(target, cube, mip) { state.target = target; state.cube = cube; state.mip = mip; }, setFramebuffer(value) { state.framebuffer = value; },
    setViewport(x, y, w, z) { state.viewport.copy(x && x.isVector4 ? x : new THREE.Vector4(x, y, w, z)); },
    setScissor(x, y, w, z) { state.scissor.copy(x && x.isVector4 ? x : new THREE.Vector4(x, y, w, z)); }, setScissorTest: value => { state.scissorTest = value; },
    getPixelRatio: () => 1.25, getContext: () => ({isContextLost: () => false}),
    render(scene, camera) {
      calls.push({scene, camera, target: state.target, viewport: state.viewport.clone(), scissor: state.scissor.clone()});
      if (state.target) {
        assert.equal(api.xr.enabled, false); assert.equal(api.shadowMap.autoUpdate, false); assert.equal(api.shadowMap.needsUpdate, false);
        for (const helper of [f.cameraRig, f.driving.docking.plane, f.driving.worldPanel.plane, f.driving.docking.forkCamera.plane]) assert.equal(helper.visible, false);
        if (api.failNext) { api.failNext = false; throw new Error('GPU fixture failure'); }
        scene.updateMatrixWorld(true); f.camera.matrixWorld.makeTranslation(998, 2, 9);
      }
      api.info.render.calls += 200; api.info.render.triangles += 999;
    }});
  api.xr.enabled = true; api.xr.isPresenting = !!f.ctx.vrMode; return {api, calls, state, canvas};
}
function baseline(f, r) { return {target:r.state.target,cube:r.state.cube,mip:r.state.mip,viewport:r.state.viewport.toArray(),scissor:r.state.scissor.toArray(),test:r.state.scissorTest,
  xr:r.api.xr.enabled,autoClear:r.api.autoClear,tone:r.api.toneMapping,exposure:r.api.toneMappingExposure,shadow:Object.assign({},r.api.shadowMap),info:JSON.stringify(r.api.info),
  camera:f.camera.matrixWorld.toArray(),projection:f.camera.projectionMatrix.toArray(),position:f.camera.position.toArray(),quaternion:f.camera.quaternion.toArray(),rig:f.cameraRig.matrixWorld.toArray()}; }
const desktop = setup(false, true), r = renderer(desktop); desktop.ctx.graphics = {getLimits: () => ({tier: 'balanced'})};
assert(desktop.driving.mount(desktop.record.id)); const monitor = desktop.driving.docking, feed = monitor.forkCamera;
monitor.feedViewport.rect = {left: 850, top: 480, width: 360, height: 202.5};
assert(monitor.cameraEnabled); assert(!feed.target);
const original = baseline(desktop, r), population = desktop.runtime.products.size;
assert(monitor.renderBefore(desktop.scene, .02)); assert.deepEqual(baseline(desktop, r), original);
assert.equal(feed.target.width, 384); assert.equal(feed.target.height, 216); assert.equal(feed.getStats().maxFPS, 12); assert.equal(feed.getStats().estimatedGpuBytes, 384 * 216 * 6);
assert.equal(r.calls[0].scene, desktop.scene); assert.notEqual(r.calls[0].camera, desktop.camera);
for (let frame = 0; frame < 10; frame++) monitor.renderBefore(desktop.scene, 1 / 120);
assert(feed.getStats().frames <= 2, 'The secondary world pass obeys its independent FPS cap.');
assert(monitor.postRender()); assert.deepEqual(baseline(desktop, r), original);
const overlay = r.calls[r.calls.length - 1]; assert.equal(overlay.target, null); assert.equal(overlay.scene, feed.overlayScene);
assert(overlay.scissor.equals(new THREE.Vector4(850, 97.5, 360, 202.5)), 'CSS coordinates map into renderer units without stretching the image.');
assert.equal(desktop.runtime.products.size, population); assert.equal(desktop.v.entry, null);
const retainedTarget=new THREE.WebGLRenderTarget(16,16);r.state.target=retainedTarget;
const targetState=baseline(desktop,r);assert(monitor.renderBefore(desktop.scene,.2));assert.deepEqual(baseline(desktop,r),targetState);r.state.target=null;retainedTarget.dispose();

// Frame only the base/slots, not the complete carton stack or whole truck.
const product = desktop.runtime.products.get(desktop.pallet), rig = desktop.api.rig(desktop.record);
assert.equal(feed.mode,'entry');monitor.cameraModeButton.fire('click');assert.equal(feed.mode,'tips');assert.match(monitor.cameraModeButton.textContent,/Puntas/);
assert(desktop.driving.command('pickup')); const held = desktop.v.entry;
for (const pose of [{lift: desktop.v.pose.lift, tilt: 0}, {lift: .9, tilt: .06, sideShift: .07}, {lift: 2.4, tilt: -.06}]) {
  desktop.api.applyPose(desktop.record, Object.assign({}, desktop.v.pose, pose), false); monitor.update(true); monitor.renderBefore(desktop.scene, .2);
  const frame = feed.framing, cargoBox = product.bounds.clone().applyMatrix4(product.object.matrixWorld);
  assert(!cargoBox.containsPoint(frame.eye));
  const eyeLocal = frame.eye.clone().applyMatrix4(new THREE.Matrix4().getInverse(desktop.object.matrixWorld)); assert(Math.abs(eyeLocal.x) > desktop.config.width / 2);
  const angle = Math.asin(Math.abs(frame.eye.y - frame.aim.y) / frame.eye.distanceTo(frame.aim)) * 180 / Math.PI;
  assert(angle > 26 && angle < 36, `Isometric working angle, not overhead: ${angle}`);
  assert(frame.height < 1.4, 'The carton stack cannot force a whole-truck overview.');
  for (const point of frame.visible) { const projected = point.clone().project(feed.camera); assert(Math.abs(projected.x) <= 1.001 && Math.abs(projected.y) <= 1.001); }
  const meshes=[]; [desktop.object,product.object].forEach(root=>root.traverse(node=>{if(node.isMesh&&!node.userData.editorRuntimeHelper)meshes.push(node);}));
  let visibleTines=0;
  for (const side of [-1,1]) {
    const point = new THREE.Vector3(side*desktop.config.forkSpread/2,-desktop.config.forkThickness*.20,desktop.config.forkLength-.012).applyMatrix4(rig.forks.matrixWorld);
    const screen=point.clone().project(feed.camera),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(screen.x,screen.y),feed.camera);
    const first=ray.intersectObjects(meshes,false)[0];let node=first&&first.object;while(node&&node!==rig.forks)node=node.parent;if(node===rig.forks)visibleTines++;
  }
  assert.equal(visibleTines,2,'Both actual fork tips are visible before any carton, mast or chassis; no x-ray visibility is assumed.');
  const beforeEye=frame.eye.clone();feed.switchSide();monitor.renderBefore(desktop.scene,.2);assert(beforeEye.distanceTo(feed.framing.eye)>2);feed.switchSide();
  assert.equal(desktop.v.entry,held);
}
const old=feed.target;let disposed=0;old.addEventListener('dispose',()=>disposed++);
desktop.ctx.graphics.getLimits=()=>({tier:'economy'});monitor.renderBefore(desktop.scene,.2);assert.equal(disposed,1);assert.equal(feed.target.width,256);assert.equal(feed.getStats().maxFPS,8);
desktop.ctx.graphics.getLimits=()=>({tier:'ultra'});monitor.renderBefore(desktop.scene,.2);assert.equal(feed.target.width,512);assert.equal(feed.getStats().maxFPS,15);
monitor.toggleCamera();assert(!feed.target);assert(!monitor.renderBefore(desktop.scene,3));monitor.toggleCamera();assert(monitor.renderBefore(desktop.scene,.2));
desktop.ctx.roomTransition=true;assert(!monitor.renderBefore(desktop.scene,.2));assert(!feed.target);desktop.ctx.roomTransition=false;
assert(monitor.renderBefore(desktop.scene,.2));desktop.dom.hidden=true;assert(!monitor.renderBefore(desktop.scene,.2));assert(!feed.target);desktop.dom.hidden=false;
assert(monitor.renderBefore(desktop.scene,.2));r.api.failNext=true;const beforeFailure=baseline(desktop,r);assert(!monitor.renderBefore(desktop.scene,.2));assert.deepEqual(baseline(desktop,r),beforeFailure);assert(!feed.target);
const attempts=r.calls.length;for(let i=0;i<30;i++)monitor.renderBefore(desktop.scene,.2);assert.equal(r.calls.length,attempts,'Failed GPU passes suspend until explicit retry.');
feed.setEnabled(true);assert(monitor.renderBefore(desktop.scene,.2));feed.onLost();assert(!feed.target);assert(!monitor.renderBefore(desktop.scene,.2));feed.onRestored();assert(monitor.renderBefore(desktop.scene,.2));
const {ForkCamera}=require('./load-vehicle-driving.js')(THREE),listenerProbe=new ForkCamera(desktop.driving);
assert(r.canvas.listeners.get('webglcontextlost').has(listenerProbe.onLost));listenerProbe.dispose();assert(!r.canvas.listeners.get('webglcontextlost').has(listenerProbe.onLost));
desktop.driving.dispose();assert(!feed.target);assert.equal(desktop.active.size,0);desktop.runtime.stop();

// ENTRY mode must show the two exposed shafts at the first few centimetres,
// not only the tips after passing through the entire pallet. All visibility
// checks use real first surfaces, including the chassis, mast and carton stack.
const partial=setup(false,true);renderer(partial);assert(partial.driving.mount(partial.record.id));
const entryMonitor=partial.driving.docking,entry=entryMonitor.forkCamera,partialRig=partial.api.rig(partial.record),partialProduct=partial.runtime.products.get(partial.pallet);
assert.equal(entry.mode,'entry');const cameraBefore=partial.camera.matrixWorld.clone(),populationBefore=partial.runtime.products.size;
const entryMeshes=[];[partial.object,partialProduct.object].forEach(root=>root.traverse(node=>{if(node.isMesh&&!node.userData.editorRuntimeHelper)entryMeshes.push(node);}));
for(const insertion of [.25,.05]){
  entry.frame(entryMonitor.snapshot);partial.pallet.position.z+=partial.config.forkLength-insertion-entry.framing.localLoad.min.z;partial.scene.updateMatrixWorld(true);
  entryMonitor.update(true);assert(entryMonitor.renderBefore(partial.scene,.2));near(entryMonitor.snapshot.insertion.actualM,insertion,.001);
  const exposed=Math.min(partial.config.forkLength-.015,entry.framing.localLoad.min.z-.035),ray=new THREE.Raycaster();
  for(const side of[-1,1]){const point=new THREE.Vector3(side*partial.config.forkSpread/2,-partial.config.forkThickness*.2,exposed).applyMatrix4(partialRig.forks.matrixWorld).project(entry.camera);assert(Math.abs(point.x)<.99&&Math.abs(point.y)<.99);
    ray.setFromCamera(new THREE.Vector2(point.x,point.y),entry.camera);const first=ray.intersectObjects(entryMeshes,false)[0];let node=first&&first.object;while(node&&node!==partialRig.forks)node=node.parent;assert(node===partialRig.forks,'The exposed shaft reaches the image before any chassis, mast, carton or pallet member.');}
  let body=0,metal=0;for(let y=0;y<18;y++)for(let x=0;x<32;x++){ray.setFromCamera(new THREE.Vector2((x+.5)/32*2-1,1-(y+.5)/18*2),entry.camera);let node=(ray.intersectObjects(entryMeshes,false)[0]||{}).object;if(!node)continue;while(node&&node!==partialRig.forks&&node!==partialProduct.object)node=node.parent;if(node===partialRig.forks)metal++;else if(node!==partialProduct.object)body++;}
  assert(body/(32*18)<.25,'The truck cannot dominate the entry working-camera image.');assert(metal>8,'The exposed metal has readable area, not a hidden subpixel target.');
  assert(partial.camera.matrixWorld.equals(cameraBefore));assert.equal(partial.v.entry,null);assert.equal(partial.runtime.products.size,populationBefore);
}
entryMonitor.select(300,30);assert.equal(entry.mode,'tips');entryMonitor.select(300,30);assert.equal(entry.mode,'entry');
partial.driving.dispose();partial.runtime.stop();

const vr=setup(true,true),xrRenderer=renderer(vr);assert(vr.driving.mount(vr.record.id));
const vrFeed=vr.driving.docking.forkCamera,vrBaseline=baseline(vr,xrRenderer),framebuffer=vr.session.renderState.baseLayer.framebuffer;
assert(vr.driving.docking.renderBefore(vr.scene,.2));assert.deepEqual(baseline(vr,xrRenderer),vrBaseline);assert.equal(xrRenderer.state.framebuffer,framebuffer);
assert(vrFeed.plane.visible);assert.equal(vrFeed.plane.material.map,vrFeed.target.texture);assert.equal(vrFeed.state.controller,'both');assert(vrFeed.state.isSelectable());assert(!vr.driving.docking.postRender());
const side=vrFeed.side;vrFeed.state.onSelectStart({uv:new THREE.Vector2(.5,.5)});assert.equal(vrFeed.side,-side);assert.deepEqual(baseline(vr,xrRenderer),vrBaseline);
vr.session.visibilityState='hidden';assert(!vr.driving.docking.renderBefore(vr.scene,.2));assert(!vrFeed.target);vr.session.visibilityState='visible';assert(vr.driving.docking.renderBefore(vr.scene,.2));
vr.driving.dispose();assert(!vrFeed.target);assert.equal(vr.active.size,0);vr.runtime.stop();
console.log('Vehicle fork camera: real fork/cargo framing and visibility, bounded GPU target, desktop scissor quad, XR framebuffer/head pose and render-state restoration, failure suspension and cleanup passed.');
