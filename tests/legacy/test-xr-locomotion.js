const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-xr-locomotion.js"), '..', file)), 'utf8').replace(/^import .*;\r?\n/gm, '');
const Navigation = new Function('THREE', read("packages/render-three/src/XRLocomotion.js").replace('export default class XRLocomotion', 'return class XRLocomotion'))(THREE);
const {getGeometryTree} = require('../support/load-geometry-acceleration')(THREE);
const CollisionWorld = new Function('THREE', 'getGeometryTree', read("packages/render-three/src/CollisionWorld.js").replace('export default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const close = (a, b, message) => assert(Math.abs(a - b) < 1e-7, message || `${a} != ${b}`);
function fixture(options = {}) {
  const scene = new THREE.Scene(), parent = new THREE.Group(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(), arrayCamera = new THREE.ArrayCamera();
  scene.add(parent); parent.add(rig); rig.add(camera);
  parent.position.set(2, .1, -3); parent.rotation.y = options.parentYaw || 0;
  camera.position.set(19, 23, 17); camera.rotation.set(.1, .2, .3); // stale desktop local fields, like Three r112.
  const tracked = new THREE.Matrix4().compose(new THREE.Vector3(...(options.head || [0, 1.7, 0])), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), options.headYaw || 0), new THREE.Vector3(1, 1, 1));
  let session = {visibilityState: 'visible'};
  const listeners = new Map(), window = {addEventListener(type, handler) { listeners.set(type, handler); }, removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); }};
  const xr = {isPresenting: true, getSession: () => session, getCamera() { rig.updateWorldMatrix(true, false); arrayCamera.matrixWorld.multiplyMatrices(rig.matrixWorld, tracked); camera.matrixWorld.copy(arrayCamera.matrixWorld); return arrayCamera; }};
  const sources = ['left', 'right'].map(handedness => ({handedness, gamepad: {mapping: 'xr-standard', axes: [0, 0, 0, 0]}}));
  const ctx = {vrMode: true, cameraRig: rig, camera, renderer: {xr}, raycontrol: {controllers: sources.map(inputSource => ({inputSource}))}, studioLocomotion: 'smooth', goto: null};
  const navigation = new Navigation(ctx, {window});
  const head = () => new THREE.Vector3().setFromMatrixPosition(xr.getCamera().matrixWorld);
  const axes = (hand, x, y) => { const pad = sources[hand].gamepad; pad.axes = pad.axes.length >= 4 ? [0, 0, x, y] : [x, y]; };
  const frame = (delta = 1 / 72) => { scene.updateMatrixWorld(true); return navigation.tick(delta); };
  frame();
  return {scene, parent, rig, camera, arrayCamera, tracked, sources, ctx, xr, navigation, listeners, head, axes, frame, changeSession(value) { session = value; }};
}

{
  const f = fixture({headYaw: Math.PI / 2}), start = f.head(), local = f.camera.position.clone(), rotation = f.camera.quaternion.clone();
  f.axes(0, 0, -1); for (let index = 0; index < 72; index++) f.frame();
  const finish = f.head(); close(finish.x - start.x, -1.5); close(finish.y, start.y); close(finish.z, start.z);
  assert(f.camera.position.equals(local) && f.camera.quaternion.equals(rotation), 'Locomotion never rewrites tracked/local camera fields.');
  f.navigation.dispose(); assert.equal(f.listeners.size, 0);
}
{
  const atRate = hz => { const f = fixture(), start = f.head(); f.axes(0, 1, -1); for (let i = 0; i < hz; i++) f.frame(1 / hz); return f.head().sub(start); };
  const a = atRate(60), b = atRate(90); close(a.distanceTo(b), 0); close(a.length(), 1.5, 'Diagonal travel has the same total speed.');
  const f = fixture(), start = f.head(); f.axes(0, 0, -1); f.frame(3); close(f.head().distanceTo(start), .075, 'A long paused frame cannot teleport the user.');
}
{
  const f = fixture({head: [.6, 1.7, -.4], parentYaw: .35}), start = f.head(), local = f.camera.quaternion.clone();
  f.axes(1, .9, 0); f.frame(); close(f.head().distanceTo(start), 0, 'Snap turning preserves the actual headset pivot with a rotated parent.');
  const angle = f.rig.quaternion.clone(); for (let i = 0; i < 100; i++) f.frame(); assert(f.rig.quaternion.equals(angle), 'Holding the stick turns once.');
  f.axes(1, 0, .8); f.frame(); f.axes(1, .9, 0); f.frame(); assert(f.rig.quaternion.equals(angle), 'The stick must return to its center before the next snap.');
  f.axes(1, 0, 0); f.frame(); f.axes(1, -.9, 0); f.frame(); close(f.rig.quaternion.angleTo(new THREE.Quaternion()), 0); assert(f.camera.quaternion.equals(local));
}
{
  const f = fixture(), start = f.head(); f.axes(0, .1, .1); f.frame(); assert(f.head().equals(start));
  f.ctx.studioMenuOpen = true; f.axes(0, 0, -1); f.axes(1, 1, 0); f.frame(); assert(f.head().equals(start));
  f.ctx.studioMenuOpen = false; f.frame(); assert(f.head().equals(start)); assert(f.rig.quaternion.equals(new THREE.Quaternion()));
  f.axes(0, 0, 0); f.axes(1, 0, 0); f.frame(); f.axes(0, 0, -1); f.frame(); assert(f.head().distanceTo(start) > 0);
  const paused = f.head(); f.changeSession({visibilityState: 'visible-blurred'}); f.frame(); assert(f.head().equals(paused));
  f.changeSession({visibilityState: 'visible'}); f.frame(); assert(f.head().equals(paused));
  f.axes(0, 0, 0); f.frame(); f.axes(0, 0, -1); f.frame(); assert(f.head().distanceTo(paused) > 0);
  f.listeners.get('blur')(); const blurred = f.head(); f.frame(); assert(f.head().equals(blurred));
}
{
  const f = fixture(), start = f.head(); f.sources[0].gamepad.axes = [0, 0]; f.frame(); f.axes(0, 0, -1); f.frame(); assert(f.head().distanceTo(start) > 0, 'Two-axis controllers retain a supported fallback.');
  const held = {handedness: 'left', gamepad: {mapping: 'xr-standard', axes: [0, 0, 0, -1]}};
  f.ctx.raycontrol.controllers[0] = {inputSource: held}; const before = f.head(); f.frame(); assert(f.head().equals(before), 'A replacement controller must center its held stick.');
  held.gamepad.axes[3] = 0; f.frame(); held.gamepad.axes[3] = -1; f.frame(); assert(f.head().distanceTo(before) > 0);
  f.ctx.studioLocomotion = 'teleport'; const stopped = f.head(); f.frame(); assert(f.head().equals(stopped)); f.axes(1, 1, 0); f.frame(); close(f.head().distanceTo(stopped), 0); assert(!f.rig.quaternion.equals(new THREE.Quaternion()), 'Teleport-only preference still permits turning.');
}
{
  const a = fixture(), b = fixture(); b.ctx.raycontrol.controllers.reverse();
  for (const f of [a, b]) { f.axes(0, .5, -.7); f.axes(1, .8, 0); f.frame(); }
  close(a.head().distanceTo(b.head()), 0, 'Movement/turning do not depend on r112 input-source index order.');
  close(a.rig.quaternion.angleTo(b.rig.quaternion), 0);
}
{
  const f = fixture(), root = new THREE.Group(); f.scene.add(root);
  const start = f.head(), wall = new THREE.Mesh(new THREE.BoxBufferGeometry(8, 4, .02), new THREE.MeshBasicMaterial());
  wall.position.set(start.x, start.y, start.z - 1); root.add(wall); f.scene.updateMatrixWorld(true);
  const world = f.ctx.collisionWorld = new CollisionWorld({}, {getRoot: () => root}); world.setRoom('hall');
  f.axes(0, 0, -1); for (let i = 0; i < 150; i++) { world.beginFrame(); f.frame(); world.endFrame(); }
  const finish = f.head(); assert(finish.z > start.z - .75 && finish.z < start.z - .6, 'The real capsule sweep stops before a thin wall.'); close(finish.y, start.y);
}
{
  const f = fixture(), start = f.head(); f.ctx.editor = {loadingProject: true}; f.axes(0, 0, -1); f.frame(); assert(f.head().equals(start));
  f.ctx.editor.loadingProject = false; f.frame(); assert(f.head().equals(start));
  f.axes(0, 0, 0); f.frame(); f.ctx.xrExitPending = true; f.axes(0, 0, -1); f.frame(); assert(f.head().equals(start)); f.ctx.xrExitPending = false; f.frame(); assert(f.head().equals(start));
  f.axes(0, 0, 0); f.frame(); f.axes(0, 0, -1); f.ctx.vrMode = false; f.frame(); assert(f.head().equals(start));
  f.ctx.vrMode = true; f.frame(); assert(f.head().equals(start)); f.axes(0, 0, 0); f.frame(); f.sources[0].gamepad.mapping = ''; f.axes(0, 1, 1); f.frame(); assert(f.head().equals(start));
}
const index = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-xr-locomotion.js"), '../src/index.js')), 'utf8');
const constrainStart = index.indexOf('function constrainVRCamera()'), constrainEnd = index.indexOf('function setupControllers()', constrainStart);
assert(constrainStart >= 0 && constrainEnd > constrainStart);
function productionFrame(f, root) {
  const world = f.ctx.collisionWorld = new CollisionWorld({}, {getRoot: () => root}); world.setRoom('hall');
  const pass = new Function('THREE', 'context', 'renderer', 'camera',
    'let lastVRCollisionPosition = null; function resetCollisionPose() { lastVRCollisionPosition = null; }\n' +
    index.slice(constrainStart, constrainEnd) + '\nreturn {constrain: constrainVRCamera, previous: () => lastVRCollisionPosition};')
    (THREE, f.ctx, f.ctx.renderer, f.camera);
  pass.constrain();
  return () => {
    world.beginFrame();
    try { f.frame(); pass.constrain(); } finally { world.endFrame(); }
    close(pass.previous().distanceTo(f.head()), 0, 'The production physical-head collision snapshot follows resolved locomotion.');
  };
}
{
  const f = fixture({head: [.6, 1.7, -.4], parentYaw: .35, headYaw: .2}), root = new THREE.Group(); f.scene.add(root);
  const frame = productionFrame(f, root), start = f.head(), trackedLocal = f.camera.position.clone(), trackedRotation = f.camera.quaternion.clone();
  f.axes(0, 0, -1); for (let i = 0; i < 72; i++) frame();
  close(f.head().distanceTo(start), 1.5, 'The exact constrainVRCamera pass does not undo stick movement through lastVRCollisionPosition.');
  f.axes(0, 0, 0); frame(); const pivot = f.head(); f.axes(1, 1, 0); frame();
  for (let i = 0; i < 72; i++) frame();
  close(f.head().distanceTo(pivot), 0, 'The subsequent production collision pass introduces no head-pivot drift when snap turning.');
  assert(f.camera.position.equals(trackedLocal) && f.camera.quaternion.equals(trackedRotation));
}
{
  const f = fixture(), root = new THREE.Group(); f.scene.add(root); const start = f.head();
  const wall = new THREE.Mesh(new THREE.BoxBufferGeometry(8, 4, .02), new THREE.MeshBasicMaterial());
  wall.position.set(start.x, start.y, start.z - 1); root.add(wall); f.scene.updateMatrixWorld(true);
  const frame = productionFrame(f, root); f.axes(0, 0, -1);
  for (let i = 0; i < 150; i++) frame();
  const finish = f.head(); assert(finish.z > start.z - .75 && finish.z < start.z - .6, 'Module movement followed by the exact main-loop collision pass stops at the thin wall.');
  close(finish.y, start.y);
}
const animateStart = index.indexOf('function animate(time, frame)'), controllerSync = index.indexOf('syncXRControllers(frame);', animateStart);
assert(animateStart >= 0 && controllerSync > animateStart);
assert(controllerSync < index.indexOf('context.xrLocomotion.tick(delta)'));
assert(index.indexOf('context.xrLocomotion.tick(delta)') < index.indexOf('ecsyWorld.execute(delta, elapsedTime);', animateStart));
console.log('XR sticks: head-relative collision walking, head-pivot 30-degree turns, neutral rearm, both mappings/hotplug, frame limits, menu/session/load guards and exact production collision-pass/tracked-pose preservation passed.');
