const __layout = require("../../tooling/layout.cjs");
'use strict';
// Actual mechanisms, pallet, monitor and camera. Renderer calls are recorded;
// final browser QA separately verifies the real GPU output.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const h = require('./test-vehicle-runtime.js'), {THREE} = h;
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-vehicle-fork-camera.js"), 'test-vehicle-driving.js')), 'utf8');
const {setup, Element} = new Function('require', '__dirname', source.slice(0, source.indexOf('const desktop = setup();')) + '\nreturn {setup,Element};')(require, __dirname);
Element.prototype.getBoundingClientRect = function () { return this.rect || {left: 0, top: 0, width: 768, height: 432}; };
const near = (a, b, eps = 1e-6) => assert(Math.abs(a - b) < eps, `${a} != ${b}`);
function renderer(f, pixelRatio = 1.25) {
  const canvas = new Element('canvas'); canvas.width = 1600; canvas.height = 900; canvas.rect = {left: 0, top: 60, width: 1280, height: 720};
  const state = {target: null, cube: 2, mip: 3, viewport: new THREE.Vector4(4, 5, 800, 450), scissor: new THREE.Vector4(7, 8, 444, 333), scissorTest: true, framebuffer: f.ctx.vrMode ? {} : null};
  state.glViewport = state.viewport.clone().multiplyScalar(pixelRatio).floor();
  f.session.renderState = {baseLayer: {framebuffer: state.framebuffer}};
  const calls = [], api = f.ctx.renderer;
  Object.assign(api, {domElement: canvas, autoClear: false, toneMapping: THREE.ReinhardToneMapping, toneMappingExposure: 1.7,
    shadowMap: {enabled: true, autoUpdate: true, needsUpdate: true}, info: {autoReset: true, render: {calls: 17, triangles: 256, frame: 5, lines: 2, points: 0}},
    getRenderTarget: () => state.target, getActiveCubeFace: () => state.cube, getActiveMipmapLevel: () => state.mip,
    getViewport: out => out.copy(state.viewport), getScissor: out => out.copy(state.scissor), getScissorTest: () => state.scissorTest,
    setRenderTarget(target, cube, mip) { state.target = target; state.cube = cube; state.mip = mip; state.glViewport.copy(target ? target.viewport : state.viewport.clone().multiplyScalar(pixelRatio).floor()); }, setFramebuffer(value) { state.framebuffer = value; },
    setViewport(x, y, w, z) { state.viewport.copy(x && x.isVector4 ? x : new THREE.Vector4(x, y, w, z)); state.glViewport.copy(state.viewport).multiplyScalar(pixelRatio).floor(); },
    setScissor(x, y, w, z) { state.scissor.copy(x && x.isVector4 ? x : new THREE.Vector4(x, y, w, z)); }, setScissorTest: value => { state.scissorTest = value; },
    getPixelRatio: () => pixelRatio, getContext: () => ({isContextLost: () => false}),
    render(scene, camera) {
      calls.push({scene, camera, target: state.target, viewport: state.glViewport.clone(), scissor: state.scissor.clone()});
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

function mounted(vr = false, pixelRatio = 1.25) {
  const f = setup(vr, true); f.screen = renderer(f, pixelRatio); f.ctx.graphics = {getLimits: () => ({tier: 'balanced'})};
  assert(f.driving.mount(f.record.id)); f.feed = f.driving.docking.forkCamera;
  f.driving.docking.feedViewport.rect = {left: 850, top: 480, width: 360, height: 202.5};
  return f;
}
function updateBoth(f) { for (let i = 0; i < 3; i++) assert(f.driving.docking.renderBefore(f.scene, .2)); }
function meshes(f) { const values = []; [f.object, f.pallet].forEach(root => root.traverse(node => { if (node.isMesh && !node.userData.editorRuntimeHelper) values.push(node); })); return values; }
function firstAt(f, local, camera) {
  const forks = f.api.rig(f.record).forks, screen = local.clone().applyMatrix4(forks.matrixWorld).project(camera), ray = new THREE.Raycaster();
  assert(Math.abs(screen.x) < .99 && Math.abs(screen.y) < .99, 'Both physical tines remain in the working crop.');
  ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera); ray.near = camera.near; ray.far = camera.far; return ray.intersectObjects(meshes(f), false)[0];
}
function isFork(f, hit) { let object = hit && hit.object; const forks = f.api.rig(f.record).forks; while (object && object !== forks) object = object.parent; return object === forks; }

const desktop = setup(false, true);
const r = desktop.screen = renderer(desktop); desktop.ctx.graphics = {getLimits: () => ({tier: 'balanced'})}; assert(desktop.driving.mount(desktop.record.id));
const feed = desktop.feed = desktop.driving.docking.forkCamera, monitor = desktop.driving.docking;
monitor.feedViewport.rect = {left:850,top:480,width:360,height:202.5};
assert.equal(feed.mode,'isometric'); assert.equal(feed.selectedFeed,'front'); assert.equal(feed.toggleMode(),'entry'); assert.equal(feed.toggleMode(),'tips'); assert.equal(feed.toggleMode(),'isometric');
assert.equal(monitor.plan.hidden,false); assert.equal(monitor.metrics.hidden,false); assert(!monitor.guidancePanel.hidden); assert.notEqual(monitor.guidancePanel.parentNode,monitor.element);
assert.equal(monitor.rear.parentNode,undefined,'No picture-in-picture camera obscures the working image.');
const original=baseline(desktop,r),population=desktop.runtime.products.size;
assert(monitor.renderBefore(desktop.scene,.02)); assert.deepEqual(baseline(desktop,r),original);
assert.equal(feed.target.width,768); assert(!feed.mirrorTarget); assert.equal(desktop.ctx.performanceRenderTargets.size,1);
for(let i=0;i<120;i++)monitor.renderBefore(desktop.scene,1/120);
assert(feed.stats.frames<=13); assert.equal(feed.stats.mirrorFrames,0,'A hidden rear feed never renders in the background.');
assert(monitor.postRender()); assert.deepEqual(baseline(desktop,r),original); const frontComposite=r.calls[r.calls.length-1];
assert.equal(frontComposite.scene,feed.overlayScene); assert(frontComposite.scissor.equals(new THREE.Vector4(850,97.5,360,202.5)));
let disposed=0;const frontTarget=feed.target;frontTarget.addEventListener('dispose',()=>disposed++);
assert.equal(monitor.toggleRearView(),true); assert.equal(disposed,1); assert(!feed.target&&!feed.mirrorTarget); assert(monitor.renderBefore(desktop.scene,.2));
assert.equal(feed.selectedFeed,'mirror');assert(!feed.target&&feed.mirrorTarget);assert.equal(feed.mirrorTarget.width,768,'Alternating rear view uses the full working-display resolution.');
assert.equal(feed.mirrorTarget.texture.repeat.x,-1); assert.equal(feed.mirrorTarget.texture.offset.x,1);assert.equal(desktop.ctx.performanceRenderTargets.size,1);
assert(monitor.postRender());assert.equal(r.calls[r.calls.length-1].scene,feed.mirrorOverlayScene);assert.deepEqual(baseline(desktop,r),original);
const rearFrames=feed.stats.mirrorFrames;monitor.toggleRearView();assert(monitor.renderBefore(desktop.scene,.2));assert.equal(feed.stats.mirrorFrames,rearFrames);assert(feed.target&&!feed.mirrorTarget);
assert.equal(desktop.runtime.products.size,population);assert.equal(desktop.v.entry,null);
// World target banners are not photographed into the inspection camera.
const label=new THREE.Object3D(),contour=new THREE.Object3D();desktop.driving.holographicGuide.label=label;desktop.driving.holographicGuide.root=contour;
const savedRender=r.api.render;r.api.render=(scene,camera)=>{if(r.state.target){assert.equal(label.visible,false);assert.equal(contour.visible,true);}return savedRender(scene,camera);};
assert(monitor.renderBefore(desktop.scene,.2));assert.equal(label.visible,true);r.api.render=savedRender;

// The same real forks retain metric projection down to 0/10/50/100 mm gaps.
const {ForkCamera}=require('../support/load-vehicle-driving')(THREE);
let variants=0;
for(const definition of h.vehicles.VARIANTS.filter(value=>h.vehicles.supports(value.preset).forks)){
 const f=h.fixture(definition.id,false,true),product=f.runtime.products.get(f.pallet),camera=new ForkCamera({ctx:f.ctx,simulation:f.runtime,record:()=>f.record,visualRoot:f.v.visualRoot}),rig=f.api.rig(f.record),saved={pose:JSON.stringify(f.v.pose),parent:product.object.parent,population:f.runtime.products.size};
 const originalPosition=f.pallet.position.clone();
 for(const mode of ['isometric','entry','tips']){
  camera.setMode(mode);let crop=null;
  for(const gap of [.6,.1,.05,.01,0,-.12]){
   f.scene.updateMatrixWorld(true);const local=product.bounds.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().getInverse(rig.forks.matrixWorld),product.object.matrixWorld));
   f.pallet.position.z+=f.config.forkLength+gap-local.min.z;f.scene.updateMatrixWorld(true);
   const before=product.object.matrixWorld.toArray(),frame=camera.frame(f.api.getDockingState(f.record)),view=camera.camera;
   assert(view.isOrthographicCamera,mode+' has no fisheye FOV at a near-zero pallet gap.'); assert(view.projectionMatrix.elements.every(Number.isFinite));assert(view.near>=.02&&view.far>view.near);
   const next=[view.left,view.right,view.top,view.bottom];if(crop)next.forEach((value,index)=>near(value,crop[index],1e-7));else crop=next;
   for(const side of [-1,1])for(const fraction of [.12,.55,.94]){const point=new THREE.Vector3(side*f.config.forkSpread/2,0,f.config.forkLength*fraction).applyMatrix4(rig.forks.matrixWorld).project(view);assert(Math.abs(point.x)<1&&Math.abs(point.y)<1,'Both insertion blades remain in the fixed crop.');}
   if(gap===.1&&mode==='entry')for(const side of [-1,1])assert(isFork(f,firstAt(f,new THREE.Vector3(side*f.config.forkSpread/2,0,f.config.forkLength*.7),view)),definition.id+': the actual visible surface of both insertion blades is inside the precise frontal section.');
   assert.deepEqual(product.object.matrixWorld.toArray(),before);assert.equal(JSON.stringify(f.v.pose),saved.pose);assert.equal(product.object.parent,saved.parent);assert.equal(f.runtime.products.size,saved.population);
   if(mode==='isometric'){const inverse=new THREE.Matrix4().getInverse(rig.forks.matrixWorld),direction=view.getWorldDirection(new THREE.Vector3()).transformDirection(inverse);near(Math.abs(direction.x),1/Math.sqrt(3));near(direction.y,-1/Math.sqrt(3));}
  }
 }
 f.pallet.position.copy(originalPosition);f.scene.updateMatrixWorld(true);assert(f.api.pickup(f.record),definition.id+': '+f.v.warning);const held=f.v.entry;
 for(const mode of ['isometric','entry','tips']){camera.setMode(mode);camera.frame(f.api.getDockingState(f.record));assert.equal(f.v.entry,held);}
 camera.dispose();f.runtime.stop();variants++;
}
assert(variants>=9);

// Main/tracked camera and render state survive AA, rear switching, failures,
// context recovery, DPR differences and high-frequency headset frames.
for(const dpr of [1,1.5,2,2.5]){const f=mounted(false,dpr),state=baseline(f,f.screen);updateBoth(f);assert.deepEqual(baseline(f,f.screen),state);f.driving.docking.toggleRearView();updateBoth(f);assert.deepEqual(baseline(f,f.screen),state);assert.equal(f.ctx.performanceRenderTargets.size,1);f.driving.dispose();assert.equal(f.ctx.performanceRenderTargets.size,0);f.runtime.stop();}
const xr=mounted(true),xrFeed=xr.feed;xr.camera.lookAt(xrFeed.plane.getWorldPosition(new THREE.Vector3()));xr.scene.updateMatrixWorld(true);
xr.ctx.renderer.xr.getCamera=probe=>{assert.notEqual(probe,xr.camera);probe.matrixWorld.makeTranslation(999,888,777);return xr.camera;};
const tracked=baseline(xr,xr.screen);updateBoth(xr);assert.deepEqual(baseline(xr,xr.screen),tracked);assert(xrFeed.plane.visible);assert.equal(xrFeed.mirrorPlane,null);assert.equal(xrFeed.plane.material.map,xrFeed.target.texture);
xr.driving.docking.toggleRearView();assert.equal(xrFeed.plane.visible,false,'Switching does not expose an uninitialized white texture.');updateBoth(xr);assert.equal(xrFeed.plane.material.map,xrFeed.mirrorTarget.texture);assert(xrFeed.plane.visible);assert.equal(xr.ctx.performanceRenderTargets.size,1);assert(xrFeed.stats.estimatedGpuBytes<=12*1024*1024);
assert.deepEqual(baseline(xr,xr.screen),tracked);assert.equal(xrFeed.state,null);assert.equal(xr.driving.docking.postRender(),false);
const frames=xrFeed.stats.frames;assert.equal(xrFeed.renderBefore(xr.scene,1/90),false);assert.equal(xrFeed.stats.frames,frames);assert(xrFeed.plane.visible);
const beforeFailure=baseline(xr,xr.screen);xr.screen.api.failNext=true;assert.equal(xrFeed.renderBefore(xr.scene,.2),false);assert.deepEqual(baseline(xr,xr.screen),beforeFailure);assert(!xrFeed.target&&!xrFeed.mirrorTarget);
xrFeed.setEnabled(true);updateBoth(xr);xrFeed.onLost();assert.equal(xr.ctx.performanceRenderTargets.size,0);xrFeed.onRestored();updateBoth(xr);xr.driving.dispose();xr.runtime.stop();
desktop.driving.dispose();desktop.runtime.stop();assert.equal(desktop.ctx.performanceRenderTargets.size,0);
console.log('Precise vehicle camera: stable metric crops at 0/10/50/100mm, '+variants+' fork variants, real custody, single full-size alternating rear feed, separate targets, always-visible plan, source-label exclusion, DPR/XR/render restoration and cleanup passed.');
