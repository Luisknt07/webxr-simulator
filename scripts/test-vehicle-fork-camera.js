'use strict';
// Actual mechanisms, pallet, monitor and camera. Renderer calls are recorded;
// final browser QA separately verifies the real GPU output.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const h = require('./test-vehicle-runtime.js'), {THREE} = h;
const source = fs.readFileSync(path.join(__dirname, 'test-vehicle-driving.js'), 'utf8');
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
  assert(f.feed.mirrorElement, 'The monitor exposes a separate rear-view display.');
  f.feed.mirrorElement.rect = {left: 1030, top: 370, width: 180, height: 101.25}; return f;
}
function updateBoth(f) { for (let i = 0; i < 3; i++) assert(f.driving.docking.renderBefore(f.scene, .2)); }
function meshes(f) { const values = []; [f.object, f.pallet].forEach(root => root.traverse(node => { if (node.isMesh && !node.userData.editorRuntimeHelper) values.push(node); })); return values; }
function firstAt(f, local, camera) {
  const forks = f.api.rig(f.record).forks, screen = local.clone().applyMatrix4(forks.matrixWorld).project(camera), ray = new THREE.Raycaster();
  assert(Math.abs(screen.x) < .99 && Math.abs(screen.y) < .99, 'Both physical tines remain in the working crop.');
  ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera); return ray.intersectObjects(meshes(f), false)[0];
}
function isFork(f, hit) { let object = hit && hit.object; const forks = f.api.rig(f.record).forks; while (object && object !== forks) object = object.parent; return object === forks; }

function publicThreeWheelOptics() {
  // Use the published lesson's narrow-spread 3w truck and the very same pallet
  // produced by its robot, rather than only a generic 4w factory fixture.
  const lesson = require('./test-robot-grasp-clearance'), f = lesson.cell('vr-robot-dispatch'), runtime = f.runtime;
  const record = runtime.records.get(f.built.vehicle.userData.editorId), vehicle = record.components.vehicle, api = runtime.vehicleRuntime;
  const belt = runtime.records.get(f.built.pickup.userData.editorId).components.conveyor;
  for (let frame = 0; frame < 3600; frame++) { lesson.tick(f); if (belt.packages.length && belt.packages[0].offset >= runtime.pathLength(belt.config) / 2 - .31) break; }
  assert(belt.packages.length, 'The actual robot must deliver the lesson pallet.');
  assert.equal(vehicle.config.variant, 'forklift-electric-3w'); near(vehicle.config.forkSpread, .312);
  const product = belt.packages[0].product, entry = product.sourceEntry, object = product.object, rig = api.rig(record);
  const forward = record.object.getWorldDirection(new THREE.Vector3()), dock = api.pickupDock(record, {yaw: Math.atan2(forward.x, forward.z), targetId: vehicle.config.sourceId}, product);
  assert(dock); const {ForkCamera} = require('./load-vehicle-driving')(THREE), camera = new ForkCamera({ctx: f.ctx, simulation: runtime, record: () => record, visualRoot: vehicle.visualRoot});
  const parts = []; [record.object, product.object].forEach(root => root.traverse(node => { if (node.isMesh && !node.userData.editorRuntimeHelper) parts.push(node); }));
  const belongs = (node, root) => { while (node && node !== root) node = node.parent; return node === root; };
  for (const [state, offset] of [['gap', -1.05], ['partial', -.55], ['full', 0]]) {
    record.object.position.copy(dock.position).add(new THREE.Vector3(Math.sin(dock.yaw || 0), 0, Math.cos(dock.yaw || 0)).multiplyScalar(offset)); record.object.rotation.set(0, dock.yaw || 0, 0);
    api.applyPose(record, Object.assign({}, vehicle.pose, {lift: dock.toolY - vehicle.originWorld.y - vehicle.config.forkBaseHeight}), false); f.scene.updateMatrixWorld(true);
    const poseBefore = Object.assign({}, vehicle.pose), loadBefore = product.object.matrixWorld.toArray(), snapshot = api.getDockingState(record), frame = camera.frame(snapshot), inverse = new THREE.Matrix4().getInverse(rig.forks.matrixWorld), ray = new THREE.Raycaster();
    near(frame.eyeLocal.x, 0); near(frame.eyeLocal.y, .025); near(frame.eyeLocal.z, -.02);
    assert(!frame.localLoad.containsPoint(frame.eyeLocal), 'The optical centre stays outside the actual loaded pallet.');
    const mastEye = frame.eye.clone().applyMatrix4(new THREE.Matrix4().getInverse(rig.mast.matrixWorld));
    const insideCylinder = mastEye.x ** 2 + (mastEye.z - .02) ** 2 < .045 ** 2 && mastEye.y > vehicle.config.mastHeight * .02 && mastEye.y < vehicle.config.mastHeight * .56;
    assert(!insideCylinder, 'A camera inside the hydraulic cylinder cannot be accepted just because its back faces are culled.');
    for (const side of [-1, 1]) for (const quarter of [-.25, 0, .25]) {
      const sample = new THREE.Vector3(side * vehicle.config.forkSpread / 2 + quarter * vehicle.config.forkWidth, 0, Math.min(vehicle.config.forkLength - .16, frame.localLoad.min.z - .025)).applyMatrix4(rig.forks.matrixWorld).project(camera.camera);
      assert(Math.abs(sample.x) < .99 && Math.abs(sample.y) < .99); ray.setFromCamera(new THREE.Vector2(sample.x, sample.y), camera.camera);
      const hit = ray.intersectObjects(parts, false)[0]; assert(hit && belongs(hit.object, rig.forks), state + ': every sampled top face must be the first visible real surface.');
      const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize().applyMatrix3(new THREE.Matrix3().getNormalMatrix(inverse)).normalize(); assert(normal.y > .95, state + ': visible steel must be the upper face, rather than the vertical heel.');
    }
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      ray.setFromCamera(new THREE.Vector2((x - 2) * .12, (y - 2) * .12), camera.camera); const hit = ray.intersectObjects(parts, false)[0];
      assert(!hit || belongs(hit.object, rig.forks) || belongs(hit.object, product.object), state + ': the centre working window cannot be blocked by the truck/mast.');
    }
    assert(camera.camera.fov < (state === 'full' ? 140 : 90)); assert.deepEqual(vehicle.pose, poseBefore); assert.deepEqual(product.object.matrixWorld.toArray(), loadBefore); assert.equal(product.sourceEntry, entry); assert.equal(product.object, object); assert.equal(runtime.productMetadata(product).units, 4);
  }
  camera.dispose(); runtime.stop();
  console.log('Public 3w optics: actual robot-delivered four-unit pallet, both upper faces, empty centre working window, optical centre outside cylinder/cargo and unchanged custody passed in approach/partial/full.');
}

const desktop = setup(false, true);
const r = desktop.screen = renderer(desktop); desktop.ctx.graphics = {getLimits: () => ({tier: 'balanced'})}; assert(desktop.driving.mount(desktop.record.id));
const feed = desktop.feed = desktop.driving.docking.forkCamera, monitor = desktop.driving.docking;
monitor.feedViewport.rect = {left: 850, top: 480, width: 360, height: 202.5}; feed.mirrorElement.rect = {left: 1030, top: 370, width: 180, height: 101.25};
const original = baseline(desktop, r), population = desktop.runtime.products.size;
assert(monitor.renderBefore(desktop.scene, .02)); assert.deepEqual(baseline(desktop, r), original);
assert.equal(feed.target.width, 512); assert.equal(feed.getStats().maxFPS, 12);
assert(r.calls[0].viewport.equals(feed.target.viewport), 'Targets use physical pixels independently of renderer DPR.');
for (let frame = 0; frame < 120; frame++) monitor.renderBefore(desktop.scene, 1 / 120);
const stats = feed.getStats(); assert(stats.frames <= 13, 'Both cameras share one world-pass budget.'); assert(stats.frontFrames > stats.mirrorFrames && stats.mirrorFrames >= 3);
assert.equal(r.calls.filter(call => call.target).length, stats.frames); assert.equal(feed.mirrorTarget.width, 256); assert.equal(feed.mirrorTarget.height, 144);
assert.equal(stats.estimatedGpuBytes, (512 * 288 + 256 * 144) * 8); assert(stats.estimatedGpuBytes < 2 * 1024 * 1024);
assert.equal(desktop.ctx.performanceRenderTargets.size, 2, 'Both actual RT owners are registered for room memory accounting.');
assert.equal(feed.mirrorTarget.texture.repeat.x, -1); assert.equal(feed.mirrorTarget.texture.offset.x, 1); assert.equal(feed.target.texture.repeat.x, 1, 'Only the rear feed is mirror-flipped.');
assert(monitor.postRender()); assert.deepEqual(baseline(desktop, r), original);
const composite = r.calls.slice(-2); assert.equal(composite[0].scene, feed.overlayScene); assert.equal(composite[1].scene, feed.mirrorOverlayScene);
assert(composite[0].scissor.equals(new THREE.Vector4(850, 97.5, 360, 202.5))); assert.equal(composite[1].target, null);
assert.equal(desktop.runtime.products.size, population); assert.equal(desktop.v.entry, null);

// Approach, partial insertion and the deepest valid insertion use actual first
// surfaces. The centred camera cannot see through truck, pallet or cartons.
const product = desktop.runtime.products.get(desktop.pallet), forks = desktop.api.rig(desktop.record).forks;
for (const insertion of [-.18, .35, .97]) {
  feed.frame(monitor.snapshot); desktop.pallet.position.z += desktop.config.forkLength - insertion - feed.framing.localLoad.min.z;
  desktop.scene.updateMatrixWorld(true); monitor.update(true); feed.setMode('entry'); feed.frame(monitor.snapshot);
  const frame = feed.framing, inverse = new THREE.Matrix4().getInverse(forks.matrixWorld), direction = feed.camera.getWorldDirection(new THREE.Vector3()).transformDirection(inverse);
  near(frame.eye.clone().applyMatrix4(inverse).x, 0); near(frame.eyeLocal.y, .025); near(frame.eyeLocal.z, -.02); near(direction.x, 0); assert(direction.y <= 0 && direction.y >= -Math.sin(15 * Math.PI / 180) - 1e-7); assert(direction.z >= Math.cos(15 * Math.PI / 180) - 1e-7);
  assert(!product.bounds.clone().applyMatrix4(product.object.matrixWorld).containsPoint(frame.eye));
  const exposed = Math.min(desktop.config.forkLength - .16, frame.localLoad.min.z - .025);
  for (const side of [-1, 1]) {
    const hit = firstAt(desktop, new THREE.Vector3(side * (desktop.config.forkSpread / 2 - desktop.config.forkWidth * .25), 0, exposed), feed.camera);
    assert(isFork(desktop, hit), 'Both upper tine surfaces are unobstructed at insertion ' + insertion);
    const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize().applyMatrix3(new THREE.Matrix3().getNormalMatrix(inverse)).normalize();
    assert(normal.y > .95, 'The first visible steel is the actual broad top face, rather than a side/heel/bevel silhouette.');
  }
  assert(feed.camera.fov < (insertion < .8 ? 90 : 160), 'The approach crop remains focused; deep insertion uses a wider real lens, with Tips available for the opposite face.');
  let forkPixels = 0, truckPixels = 0; const ray = new THREE.Raycaster(), geometry = meshes(desktop);
  for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) { ray.setFromCamera(new THREE.Vector2((x + .5) / 32 * 2 - 1, 1 - (y + .5) / 18 * 2), feed.camera); const hit = ray.intersectObjects(geometry, false)[0]; if (!hit) continue; if (isFork(desktop, hit)) forkPixels++; else { let node = hit.object; while (node && node !== product.object) node = node.parent; if (!node) truckPixels++; } }
  assert(forkPixels >= 4, 'The metal has readable image area: ' + insertion + ' ' + forkPixels); assert(truckPixels < 32 * 18 * (insertion < .8 ? .30 : .40), 'The truck cannot dominate the crop, including the outer borders of the wider 4w full-insertion lens: ' + JSON.stringify({insertion, forkPixels, truckPixels, eye: frame.eyeLocal.toArray(), fov: feed.camera.fov}));
  const before = frame.eye.clone(); feed.switchSide(); feed.frame(monitor.snapshot); near(before.distanceTo(feed.framing.eye), 0, 1e-7);
}

// Full insertion and lift: the complementary opposite front view shows the
// emerging tips, with no scene object hidden or custody altered.
desktop.pallet.position.z += .08 - feed.framing.localLoad.min.z; desktop.scene.updateMatrixWorld(true); monitor.update(true); assert(desktop.driving.command('pickup')); const held = desktop.v.entry;
for (const pose of [{lift: desktop.v.pose.lift, tilt: 0}, {lift: .9, tilt: .06, sideShift: .07}, {lift: 2.4, tilt: -.06}]) {
  desktop.api.applyPose(desktop.record, Object.assign({}, desktop.v.pose, pose), false); monitor.update(true); feed.setMode('tips'); feed.frame(monitor.snapshot);
  const inverse = new THREE.Matrix4().getInverse(forks.matrixWorld), direction = feed.camera.getWorldDirection(new THREE.Vector3()).transformDirection(inverse); near(direction.x, 0); near(direction.y, 0); near(direction.z, -1);
  for (const side of [-1, 1]) assert(isFork(desktop, firstAt(desktop, new THREE.Vector3(side * desktop.config.forkSpread / 2, -desktop.config.forkThickness * .20, desktop.config.forkLength - .012), feed.camera)), 'Both actual emerging tips are visible.');
  assert.equal(desktop.v.entry, held);
}
feed.frameMirror(); const rearDirection = feed.mirrorCamera.getWorldDirection(new THREE.Vector3()).transformDirection(new THREE.Matrix4().getInverse(desktop.driving.visualRoot.matrixWorld));
assert(rearDirection.z < -.9 && rearDirection.y < 0, 'The rear lens looks into the actual rear aisle with truck context below.');

// No background work for hidden slots or a view turned away in XR.
const beforeHidden = feed.stats.frames; monitor.feedViewport.hidden = true; feed.mirrorElement.hidden = true;
for (let i = 0; i < 10; i++) assert(!monitor.renderBefore(desktop.scene, .2)); assert.equal(feed.stats.frames, beforeHidden); monitor.feedViewport.hidden = false; feed.mirrorElement.hidden = false;
const targets = [feed.target, feed.mirrorTarget]; let disposed = 0; targets.forEach(target => target.addEventListener('dispose', () => disposed++));
desktop.ctx.graphics.getLimits = () => ({tier: 'economy'}); updateBoth(desktop); assert.equal(disposed, 2); assert.equal(feed.target.width, 256); assert.equal(feed.mirrorTarget.width, 128); assert.equal(feed.stats.maxFPS, 8);
desktop.ctx.graphics.getLimits = () => ({tier: 'high'}); updateBoth(desktop); assert.equal(feed.target.width, 640); assert.equal(feed.mirrorTarget.width, 320);
assert.equal(feed.stats.estimatedGpuBytes, (640 * 360 + 320 * 180) * 8); assert(feed.stats.estimatedGpuBytes < 3 * 1024 * 1024, 'High desktop quality remains below its explicit three-MiB two-target cap.');
desktop.ctx.graphics.getLimits = () => ({tier: 'economy'}); updateBoth(desktop);
monitor.toggleCamera(); assert(!feed.target && !feed.mirrorTarget); assert.equal(desktop.ctx.performanceRenderTargets.size, 0); assert(!monitor.renderBefore(desktop.scene, 3)); monitor.toggleCamera(); updateBoth(desktop);
desktop.ctx.roomTransition = true; assert(!monitor.renderBefore(desktop.scene, .2)); assert(!feed.target && !feed.mirrorTarget); desktop.ctx.roomTransition = false; updateBoth(desktop);
desktop.dom.hidden = true; assert(!monitor.renderBefore(desktop.scene, .2)); assert(!feed.target && !feed.mirrorTarget); desktop.dom.hidden = false; updateBoth(desktop);
r.api.failNext = true; const failureState = baseline(desktop, r); assert(!monitor.renderBefore(desktop.scene, .2)); assert.deepEqual(baseline(desktop, r), failureState); assert(!feed.target && !feed.mirrorTarget);
const attempts = r.calls.length; for (let i = 0; i < 30; i++) monitor.renderBefore(desktop.scene, .2); assert.equal(r.calls.length, attempts, 'Failed GPU passes suspend until explicit retry.');
feed.setEnabled(true); updateBoth(desktop); feed.onLost(); assert(!feed.target && !feed.mirrorTarget); assert(!monitor.renderBefore(desktop.scene, .2)); feed.onRestored(); updateBoth(desktop);
const {ForkCamera} = require('./load-vehicle-driving.js')(THREE), listenerProbe = new ForkCamera(desktop.driving);
assert(r.canvas.listeners.get('webglcontextlost').has(listenerProbe.onLost)); listenerProbe.dispose(); assert(!r.canvas.listeners.get('webglcontextlost').has(listenerProbe.onLost));
desktop.driving.dispose(); assert(!feed.target && !feed.mirrorTarget); assert.equal(desktop.active.size, 0); assert.equal(desktop.ctx.performanceRenderTargets.size, 0); desktop.runtime.stop();

for (const dpr of [1, 1.5, 2, 2.5]) {
  const f = mounted(false, dpr), initial = baseline(f, f.screen); updateBoth(f); assert.deepEqual(baseline(f, f.screen), initial);
  f.screen.calls.filter(call => call.target).forEach(call => assert(call.viewport.equals(call.target.viewport), 'No DPR multiplication on auxiliary RTs.'));
  f.driving.dispose(); f.runtime.stop();
}
const vr = mounted(true), vrFeed = vr.feed;
vr.camera.lookAt(vrFeed.plane.getWorldPosition(new THREE.Vector3()).add(vrFeed.mirrorPlane.getWorldPosition(new THREE.Vector3())).multiplyScalar(.5)); vr.scene.updateMatrixWorld(true);
vr.ctx.renderer.xr.getCamera = probe => { assert.notEqual(probe, vr.camera, 'Visibility must never ask r112 to overwrite the tracked head camera.'); probe.matrixWorld.makeTranslation(999, 888, 777); return vr.camera; };
const xrBaseline = baseline(vr, vr.screen), framebuffer = vr.session.renderState.baseLayer.framebuffer;
updateBoth(vr); assert.deepEqual(baseline(vr, vr.screen), xrBaseline); assert.equal(vr.screen.state.framebuffer, framebuffer);
assert(vrFeed.plane.visible && vrFeed.mirrorPlane.visible); assert.equal(vrFeed.plane.material.map, vrFeed.target.texture); assert.equal(vrFeed.mirrorPlane.material.map, vrFeed.mirrorTarget.texture);
assert.equal(vrFeed.state, null, 'Neither display captures a trigger/grip interaction.'); assert(!vr.driving.docking.postRender()); assert(vrFeed.stats.maxFPS <= 10);
assert(vrFeed.target.width <= 384 && vrFeed.stats.estimatedGpuBytes < 1024 * 1024, 'XR keeps its own smaller two-target GPU budget.');
const beforeTurn = vrFeed.stats.frames, oldRotation = vr.camera.quaternion.clone(); vr.camera.rotation.y += Math.PI; vr.camera.updateMatrixWorld(true);
for (let i = 0; i < 10; i++) vr.driving.docking.renderBefore(vr.scene, .2); assert.equal(vrFeed.stats.frames, beforeTurn, 'Offscreen XR displays do not render the world.'); vr.camera.quaternion.copy(oldRotation); vr.camera.updateMatrixWorld(true); updateBoth(vr);
vr.session.visibilityState = 'hidden'; assert(!vr.driving.docking.renderBefore(vr.scene, .2)); assert(!vrFeed.target && !vrFeed.mirrorTarget); vr.session.visibilityState = 'visible'; updateBoth(vr);
vr.driving.dispose(); assert(!vrFeed.target && !vrFeed.mirrorTarget); assert.equal(vr.active.size, 0); vr.runtime.stop();

// Headset frames arrive much faster than the shared camera budget. Frustum
// probes may consider an uninitialized surface, but the world must never draw
// its white fallback material on a skipped 90 Hz frame.
const cold = mounted(true), coldFeed = cold.feed;
coldFeed.visibleFeeds = () => ['front', 'mirror'];
function firstFrontWithoutBlankMirror() {
  const beforeFrames = coldFeed.stats.frames;
  assert(coldFeed.renderBefore(cold.scene, .2));
  assert(coldFeed.target && !coldFeed.mirrorTarget);
  assert(coldFeed.plane.visible && !coldFeed.mirrorPlane.visible);
  const frames = coldFeed.stats.frames;
  assert.equal(frames, beforeFrames + 1, 'Initialization still renders only one world pass.');
  assert(!coldFeed.renderBefore(cold.scene, 1 / 90));
  assert.equal(coldFeed.stats.frames, frames, 'A 90 Hz frame keeps the shared render budget.');
  assert(!coldFeed.mirrorPlane.visible && !coldFeed.mirrorPlane.material.map, 'A throttled frame cannot reveal an uninitialized mirror.');
  const visibleFeeds = coldFeed.visibleFeeds; coldFeed.visibleFeeds = () => [];
  assert(!coldFeed.renderBefore(cold.scene, 1 / 90));
  assert(!coldFeed.mirrorPlane.visible, 'The hidden-frustum return also preserves display readiness.');
  coldFeed.visibleFeeds = visibleFeeds;
  assert(coldFeed.renderBefore(cold.scene, .2));
  assert(coldFeed.mirrorTarget && coldFeed.mirrorPlane.visible);
  assert.equal(coldFeed.mirrorPlane.material.map, coldFeed.mirrorTarget.texture);
}
firstFrontWithoutBlankMirror();
cold.ctx.graphics.getLimits = () => ({tier: 'economy'});
firstFrontWithoutBlankMirror();
assert.equal(coldFeed.target.width, 256);
coldFeed.onLost(); assert(!coldFeed.target && !coldFeed.mirrorTarget);
coldFeed.onRestored(); firstFrontWithoutBlankMirror();
cold.driving.dispose(); cold.runtime.stop();
publicThreeWheelOptics();
console.log('Vehicle cameras: real frontal pocket/shaft visibility, emerging tips, mirrored rear view, shared world-pass/GPU budget, desktop/XR visibility, renderer/head restoration, lifecycle and custody passed.');
