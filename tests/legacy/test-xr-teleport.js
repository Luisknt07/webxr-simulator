'use strict';
// Actual Three r112 geometry, RayControl, Teleport, XRLocomotion and capsule
// collisions. Only headset/controller poses and the optional browser are stubbed.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const load = (file, name, values = {}) => new Function('THREE', ...Object.keys(values), read(file).replace('default class ' + name, 'return class ' + name))(THREE, ...Object.values(values));
const EventDispatcher = new Function(read('packages/render-three/src/EventDispatcher.js').replace('default class EventDispatcher', 'return class EventDispatcher'))();
const RayControl = load('packages/render-three/src/RayControl.js', 'RayControl', {EventDispatcher});
const Teleport = load('packages/render-three/src/Teleport.js', 'Teleport'), Locomotion = load('packages/render-three/src/XRLocomotion.js', 'XRLocomotion');
const {getGeometryTree} = require('../support/load-geometry-acceleration')(THREE);
const CollisionWorld = load('packages/render-three/src/CollisionWorld.js', 'CollisionWorld', {getGeometryTree});
const close = (a, b, label = '') => assert(Math.abs(a - b) < 1e-6, label + ': ' + a + ' != ' + b);

function fixture(options = {}) {
  const scene = new THREE.Scene(), parent = new THREE.Group(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(), tracked = new THREE.ArrayCamera(), root = new THREE.Group();
  scene.add(parent, root); parent.add(rig); rig.add(camera); parent.position.set(2, .1, -1); parent.rotation.y = options.parentYaw || 0;
  camera.position.set(31, 22, -18); camera.rotation.set(.2, .3, .1); // obsolete desktop fields may not be used for XR pose.
  const headPose = new THREE.Matrix4().makeTranslation(.3, 1.7, .1), session = {visibilityState: 'visible'};
  const xr = {isPresenting: true, getSession: () => session, getCamera() {rig.updateWorldMatrix(true, false); tracked.matrixWorld.multiplyMatrices(rig.matrixWorld, headPose); return tracked;}};
  const beamRoot = new THREE.Group(), beam = new THREE.Mesh(new THREE.BoxBufferGeometry(.004, .004, 1), new THREE.MeshBasicMaterial()); beam.name = 'beam'; beamRoot.add(beam);
  const ctx = {scene, cameraRig: rig, camera, renderer: {xr}, vrMode: true, goto: null, assets: {teleport_model: {scene: beamRoot}, beam_tex: new THREE.Texture()}, shaders: {basic_vert: '', beam_frag: ''}};
  const ray = ctx.raycontrol = new RayControl(ctx, 'right'), teleport = ctx.teleport = new Teleport(ctx); teleport.installRayState();
  const sources = ['left', 'right'].map(handedness => ({handedness, gamepad: {mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: []}}));
  const controllers = sources.map((source, index) => {const controller = new THREE.Group(); controller.position.set(index ? .2 : -.2, 1.3, -.2); rig.add(controller); ray.addController(controller, source); return controller;});
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(40, .2, 40), new THREE.MeshBasicMaterial()); floor.position.y = -.1; floor.userData.editorBehaviors = [{type: 'collision', enabled: true}, {type: 'teleport', enabled: true}]; root.add(floor);
  const world = ctx.collisionWorld = new CollisionWorld(ctx, {getRoot: () => root}); world.setRoom('hall');
  const navigation = new Locomotion(ctx, {window: null}), head = () => new THREE.Vector3().setFromMatrixPosition(xr.getCamera().matrixWorld);
  let resets = 0; ctx.resetCollisionPose = () => resets++;
  const frame = () => {scene.updateMatrixWorld(true); world.beginFrame(); try {navigation.tick(1 / 72); ray.execute(ctx, 1 / 72, 0);} finally {world.endFrame();}};
  const axes = (hand, x, y) => {sources[hand].gamepad.axes[2] = x; sources[hand].gamepad.axes[3] = y;}; frame();
  return {scene, parent, rig, camera, root, floor, sources, session, xr, ctx, teleport, navigation, ray, world, controllers, axes, frame, head, resets: () => resets,
    dispose() {navigation.dispose(); teleport.dispose();}};
}

{
  const f = fixture({parentYaw: .4}), local = f.camera.position.clone(), rotation = f.camera.quaternion.clone(), start = f.head();
  f.axes(1, 0, -1); f.frame(); assert(f.teleport.arc.visible && f.teleport.teleportHitGeometry.visible, 'Right stick forward displays the curved arc and standing footprint without museum goal/glow/audio assets.');
  assert(f.teleport.hit && f.teleport.aimPoint); const target = f.teleport.aimPoint.clone(); assert(f.head().equals(start), 'Aiming does not move the rig.');
  f.axes(1, 0, 0); f.frame(); close(f.head().x, target.x); close(f.head().z, target.z); close(f.head().y, 1.7, 'The head follows the destination floor height');
  assert(!f.teleport.arc.visible && !f.teleport.teleportHitGeometry.visible); assert.equal(f.resets(), 1);
  assert(f.camera.position.equals(local) && f.camera.quaternion.equals(rotation), 'Teleport preserves r112 tracked/local camera fields even with a transformed rig parent.');
  assert(!f.teleport.teleportEntity.children.some(node => node.geometry && node.geometry.attributes.position.count > 200), 'The guide stays a small procedural overlay.'); f.dispose();
}
{
  const f = fixture(), start = f.head(); f.axes(1, 0, -1); f.frame(); f.axes(1, .9, 0); f.frame(); f.axes(1, 0, 0); f.frame();
  assert(f.head().equals(start), 'Changing aim sideways cancels rather than accidentally teleporting.');
  f.axes(1, 0, -1); f.frame(); f.ray.removeController(f.controllers[1]); f.frame(); assert(!f.teleport.arc.visible); assert(f.head().equals(start), 'Disconnect cancels the pending destination.'); f.dispose();
}
for (const key of ['drivingVehicle', 'studioMenuOpen', 'publicDialogOpen', 'voicePanelOpen', 'assistantPanelOpen', 'externalDevicePanelOpen', 'xrEntryPending', 'xrExitPending', 'roomTransition']) {
  const f = fixture(), start = f.head(); f.axes(1, 0, -1); f.frame(); f.ctx[key] = true; f.frame();
  assert(!f.teleport.arc.visible && !f.teleport.teleportHitGeometry.visible, key + ' hides and cancels the guide');
  assert.equal(f.teleport.onSelectEnd(new THREE.Vector3(3, 0, 3)), false, key + ' rejects stale trigger release');
  f.ctx[key] = false; f.frame(); assert(f.head().equals(start)); assert(!f.teleport.arc.visible, key + ' cannot revive a held stick after closing'); f.dispose();
}
{
  const f = fixture(), start = f.head(), right = f.controllers[1], left = f.controllers[0];
  f.axes(1, 0, -1); f.frame(); assert(f.teleport.hit);
  right.visible = false; f.axes(1, 0, 0); f.frame();
  assert(!f.teleport.arc.visible && f.head().equals(start), 'Losing the native target-ray pose on neutral release cancels the pending destination.');
  right.visible = true; f.axes(1, 0, -1); f.frame(); assert(!f.teleport.arc.visible, 'Recovered tracking requires a neutral frame before rearming.');
  f.axes(1, 0, 0); f.frame(); f.axes(1, 0, -1); f.frame(); assert(f.teleport.hit);
  right.visible = false; assert.equal(f.teleport.endAim(right), false, 'Direct confirmation also rejects a lost pose.'); assert(f.head().equals(start));
  left.visible = false; f.axes(0, 0, -1); f.frame(); assert(f.head().equals(start), 'A lost left-controller pose cannot move the rig from stale stick values.');
  left.visible = true; f.frame(); assert(f.head().equals(start)); f.axes(0, 0, 0); f.frame(); f.axes(0, 0, -1); f.frame(); assert(!f.head().equals(start), 'Recentered recovered tracking restores deliberate locomotion.');
  f.dispose();
}
{
  const f = fixture(), start = f.head(); f.ctx.editor = {active: true}; f.axes(1, 0, -1); f.frame(); assert(f.head().equals(start)); assert(!f.teleport.arc.visible);
  f.ctx.editor.active = false; f.frame(); assert(!f.teleport.arc.visible); f.axes(1, 0, 0); f.frame(); f.axes(1, 0, -1); f.frame();
  f.session.visibilityState = 'visible-blurred'; f.frame(); assert(!f.teleport.arc.visible); f.axes(1, 0, 0); f.session.visibilityState = 'visible'; f.frame();
  f.controllers[1].userData.grabbing = new THREE.Group(); f.axes(1, 0, -1); f.frame(); assert(!f.teleport.arc.visible, 'Holding equipment cannot start a teleport.'); f.dispose();
}
{
  const f = fixture(), start = f.head(), wall = new THREE.Mesh(new THREE.BoxBufferGeometry(8, 5, .1), new THREE.MeshBasicMaterial());
  wall.position.set(start.x, 2.5, start.z - 1.6); f.root.add(wall); f.scene.updateMatrixWorld(true); f.axes(1, 0, -1); f.frame();
  assert(f.teleport.arc.visible && !f.teleport.hit, 'An intervening wall terminates the arc, rather than offering the floor behind it.');
  f.axes(1, 0, 0); f.frame(); assert(f.head().equals(start));
  f.teleport.onHover(new THREE.Vector3(wall.position.x, 0, wall.position.z), true); assert(!f.teleport.hit, 'The actual destination capsule rejects a standing position inside a thin wall.');
  assert.equal(f.teleport.onSelectEnd(new THREE.Vector3(wall.position.x, 0, wall.position.z)), false); f.dispose();
}
{
  const f = fixture(), right = f.controllers[1]; right.rotation.x = -.55; f.frame();
  const hit = f.ray.controllers.find(data => data.controller === right).currentIntersection;
  assert(hit && hit.state.teleport, 'The public input state discovers authored floor teleport behavior.');
  const target = hit.intersection.point.clone(); f.ray.onSelectStart({target: right}); f.ray.onSelectEnd({target: right});
  close(f.head().x, target.x); close(f.head().z, target.z); assert.equal(f.resets(), 1, 'The original point-and-trigger teleport remains available.');
  f.ctx.drivingVehicle = true; f.frame(); assert(!f.ray.controllers.find(data => data.controller === right).currentIntersection, 'Driving removes floor selection rather than consuming a dashboard trigger.');
  f.dispose(); assert(!f.ctx.teleport); assert(!f.ray.states['xr-browser-teleport']); assert(!f.teleport.teleportEntity.parent);
}
console.log('XR teleport: native/public procedural arc and footprint, stick neutral/trigger confirmation, authored floors, destination height/capsule and wall guards, transformed tracked rigs, menus/driving/reconnect cancellation and disposal passed.');
