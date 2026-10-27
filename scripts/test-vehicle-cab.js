'use strict';
// Production geometry, runtime, input adapter and RayControl. Only XR poses,
// the browser DOM and session lifecycle are supplied by this hardware fixture.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const h = require('./test-vehicle-driving.js'), {Driving} = require('./load-vehicle-driving.js')(THREE);
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const Events = new Function(read('src/lib/EventDispatcher.js').replace('default class EventDispatcher', 'return class EventDispatcher'))();
const RayControl = new Function('THREE', 'EventDispatcher', read('src/lib/RayControl.js').replace('default class RayControl', 'class RayControl') + '\nreturn RayControl;')(THREE, Events);
function setup() {
  const f = h.setup(true); f.driving.dispose(); const beamModel = new THREE.Group(), beam = new THREE.Mesh(new THREE.BoxBufferGeometry(.002, .002, 1), new THREE.MeshBasicMaterial()); beam.name = 'beam'; beamModel.add(beam);
  f.ctx.assets = {teleport_model: {scene: beamModel}, beam_tex: new THREE.Texture()}; f.ctx.shaders = {basic_vert: '', beam_frag: ''};
  f.ctx.raycontrol = new RayControl(f.ctx, 'right'); f.driving = new Driving(f.ctx, f.runtime, {document: f.dom, window: f.window});
  const hands = ['left', 'right'].map(name => {const fixture = h.pad(name), grip = new THREE.Group(); fixture.inputSource.gripSpace = {}; f.cameraRig.add(fixture.controller, grip); const data = f.ctx.raycontrol.addController(fixture.controller, fixture.inputSource); data.grip = grip; return data;});
  f.left = hands[0]; f.right = hands[1]; assert(f.driving.mount(f.record.id)); f.driving.beforeStep(); return f;
}
function frame(control) {const object = control.object; object.parent.updateWorldMatrix(true, false); return new THREE.Matrix4().multiplyMatrices(object.parent.matrixWorld, new THREE.Matrix4().compose(object.position, control.restQuaternion, object.scale));}
function handAt(f, hand, point) {hand.grip.position.copy(hand.grip.parent.worldToLocal(point.clone())); hand.controller.position.set(8, 8, 8); f.scene.updateMatrixWorld(true);}
function wheelAt(f, hand, control, angle) {handAt(f, hand, new THREE.Vector3(Math.cos(angle) * control.radius, Math.sin(angle) * control.radius, 0).applyMatrix4(frame(control)));}
function squeeze(hand, down) {h.press(hand, 1, down); hand.controller.dispatchEvent({type: down ? 'squeezestart' : 'squeezeend'});}
function neutral(f) {for (const hand of [f.left, f.right]) {h.axis(hand, 0, 0); squeeze(hand, false);} f.driving.beforeStep();}
const f = setup(), rig = f.api.rig(f.record), wheel = rig.controls.wheel, lift = rig.controls.levers.find(control => control.id === 'lift'); assert(wheel && lift);
const trackedHead = f.camera.quaternion.clone(), trackedPosition = f.camera.position.clone(), trackedController = f.left.controller.quaternion.clone();
wheelAt(f, f.left, wheel, 3); f.driving.beforeStep(); squeeze(f.left, true); f.driving.beforeStep(); assert(f.driving.cab.hands.get(f.left.controller).control, 'Native gripSpace can grab even when the target ray origin is elsewhere.');
wheelAt(f, f.left, wheel, 3.2); f.driving.beforeStep(); assert(f.v.input.steer < -.1 && f.v.input.steer > -.3, 'Counter-clockwise left turn unwraps across ±pi without a jump.');
for (const angle of [3.4, 3.6, 3.8, 4, 4.2, 4.4, 4.6]) {wheelAt(f, f.left, wheel, angle); f.driving.beforeStep();} assert.equal(f.v.input.steer, -1, 'Left steering reaches its bounded mechanical limit.');
h.axis(f.left, .9, -.7); f.driving.beforeStep(); assert.equal(f.v.input.steer, -1, 'Physical left turn owns steering over a conflicting right stick.'); assert(f.v.input.throttle > .5); assert.equal(f.v.input.brake, 0, 'Holding the physical steering wheel is not a brake command.');
f.object.position.x += 2; f.driving.follow(); f.scene.updateMatrixWorld(true); f.driving.beforeStep(); h.near(f.v.input.steer, -1);
wheelAt(f, f.right, wheel, 4.6); f.driving.beforeStep(); squeeze(f.right, true); f.driving.beforeStep(); assert.equal(f.driving.cab.hands.get(f.right.controller).control, null, 'A second controller cannot steal an owned wheel.'); assert(!f.commands.includes('pickup'));
squeeze(f.right, false); h.axis(f.left, 0, 0); f.driving.beforeStep();
lift.grip.updateWorldMatrix(true, false); const liftStart = lift.grip.getWorldPosition(new THREE.Vector3()); handAt(f, f.right, liftStart); f.driving.beforeStep(); squeeze(f.right, true); f.driving.beforeStep();
handAt(f, f.right, liftStart.clone().add(new THREE.Vector3(0, 0, -1).transformDirection(frame(lift)).multiplyScalar(lift.travel * .5))); f.driving.beforeStep();
assert(f.v.input.lift > .4 && f.v.input.lift < .7, 'Pulling the hydraulic lever toward the seated operator raises the forks.'); h.near(f.v.input.steer, -1);
const beforeLift = f.v.pose.lift; f.api.step(.1); assert(f.v.pose.lift > beforeLift, 'Direct cab input reaches the actual hydraulic runtime.');
h.press(f.right, 1, false); f.driving.beforeStep(); assert(!f.driving.cab.hands.get(f.right.controller).control, 'Polled grip release works even if a squeezeend event was lost.');
f.ctx.studioMenuOpen = true; f.driving.beforeStep(); assert.equal(f.v.input.brake, 1); assert(f.driving.cab.controls.every(control => !control.owner)); f.ctx.studioMenuOpen = false; f.driving.beforeStep(); assert.equal(f.v.input.steer, 0); assert.equal(f.v.input.lift, 0);
neutral(f); wheelAt(f, f.left, wheel, .4); f.driving.beforeStep(); squeeze(f.left, true); f.driving.beforeStep(); assert(f.driving.cab.hands.get(f.left.controller).control);
f.v.paused = true; f.driving.beforeStep(); assert(f.driving.cab.controls.every(control => !control.owner)); f.v.paused = false; f.driving.beforeStep(); assert.equal(f.v.input.steer, 0, 'Pause requires a fresh neutral grip.');
neutral(f); wheelAt(f, f.left, wheel, .4); f.driving.beforeStep(); squeeze(f.left, true); f.driving.beforeStep(); f.left.grip.visible = false; f.driving.beforeStep(); assert.equal(f.v.input.steer, 0); assert(f.driving.cab.controls.every(control => !control.owner), 'Lost native grip tracking releases its control.'); f.left.grip.visible = true;
neutral(f); wheelAt(f, f.left, wheel, .4); f.driving.beforeStep(); squeeze(f.left, true); f.driving.beforeStep(); f.session.visibilityState = 'hidden'; f.driving.beforeStep(); f.session.visibilityState = 'visible'; f.driving.beforeStep(); assert.equal(f.v.input.steer, 0);
neutral(f); wheelAt(f, f.left, wheel, .4); f.driving.beforeStep(); squeeze(f.left, true); f.driving.beforeStep(); f.driving.command('emergency'); f.driving.beforeStep(); assert(f.driving.cab.controls.every(control => !control.owner)); f.driving.command('resetEmergency'); f.driving.command('start'); f.driving.beforeStep(); assert.equal(f.v.input.steer, 0);
neutral(f); wheelAt(f, f.left, wheel, .4); f.driving.beforeStep(); squeeze(f.left, true); f.driving.beforeStep(); f.ctx.raycontrol.disable(); f.driving.beforeStep(); assert.equal(f.v.input.brake, 1); assert(f.driving.cab.controls.every(control => !control.owner)); f.ctx.raycontrol.enable(); f.driving.beforeStep(); assert.equal(f.v.input.steer, 0);
neutral(f); wheelAt(f, f.left, wheel, .4); f.driving.beforeStep(); squeeze(f.left, true); f.driving.beforeStep(); f.ctx.raycontrol.removeController(f.left.controller); f.driving.beforeStep(); assert(!f.driving.cab.hands.has(f.left.controller)); assert.equal(f.v.input.steer, 0);
assert(f.camera.quaternion.equals(trackedHead) && f.camera.position.equals(trackedPosition) && f.left.controller.quaternion.equals(trackedController), 'Direct manipulation never overwrites tracked head/controller poses.');
f.driving.unmount(true); assert.equal(f.driving.cab.hands.size, 0); assert.equal(f.driving.cab.controls.length, 0); assert.equal(Object.keys(f.ctx.raycontrol.states).length, 0);
for (let index = 0; index < 10; index++) {assert(f.driving.mount(f.record.id)); f.driving.beforeStep(); assert(f.driving.unmount(true));}
assert.equal(Object.keys(f.ctx.raycontrol.states).length, 0); assert.equal(f.driving.cab.hands.size, 0);
for (const hand of [f.left, f.right]) for (const event of ['squeezestart', 'squeezeend']) assert.equal((hand.controller._listeners[event] || []).length, 0, 'Repeated seating removes direct hand listeners.');
f.driving.dispose(); f.runtime.stop();

const arbitration = setup(), steering = arbitration.api.rig(arbitration.record).controls.wheel;
wheelAt(arbitration, arbitration.right, steering, .2); arbitration.driving.beforeStep(); squeeze(arbitration.right, true); arbitration.driving.beforeStep(); wheelAt(arbitration, arbitration.right, steering, .6); h.axis(arbitration.left, .9, 0); arbitration.driving.beforeStep(); assert(arbitration.v.input.steer < -.1 && arbitration.v.input.steer > -.5);
squeeze(arbitration.right, false); arbitration.driving.beforeStep(); assert.equal(arbitration.v.input.steer, 0, 'Releasing a right-hand wheel does not replay the other hand\'s deflected steering stick.');
h.axis(arbitration.left, 0, 0); arbitration.driving.beforeStep(); h.axis(arbitration.left, .9, 0); arbitration.driving.beforeStep(); assert(arbitration.v.input.steer > .8);
arbitration.driving.dispose(); arbitration.runtime.stop();

const functions = new Set();
for (const variant of ['vna-turret', 'telehandler']) {
  const test = setup(); test.driving.unmount(true); const record = test.addVehicle(variant, [4, 0, 0]); assert(test.driving.mount(record.id)); neutral(test);
  for (const control of test.api.rig(record).controls.levers) {
    neutral(test); const start = control.grip.getWorldPosition(new THREE.Vector3()); handAt(test, test.right, start); test.driving.beforeStep(); squeeze(test.right, true); test.driving.beforeStep();
    const direction = new THREE.Vector3().fromArray(control.axis).transformDirection(frame(control)).multiplyScalar(control.travel * (control.id === 'lift' ? -.6 : .6)); handAt(test, test.right, start.clone().add(direction)); test.driving.beforeStep();
    const input = record.components.vehicle.input; assert(input[control.id] > .4, variant + ': direct ' + control.id); functions.add(control.id);
    for (const channel of ['lift', 'tilt', 'reach', 'sideShift', 'turret']) if (channel !== control.id) assert.equal(input[channel], 0, 'A physical lever never actuates a different hydraulic channel.');
  }
  test.driving.dispose(); test.runtime.stop();
}
assert.deepEqual([...functions].sort(), ['lift', 'reach', 'sideShift', 'tilt', 'turret']);

const gripAPI = require('./load-xr-grip.js')(THREE), controller = new THREE.Group(), reference = {}, source = {gripSpace: {}}, renderer = {xr: {getReferenceSpace: () => reference}};
const grip = gripAPI.createXRGrip(renderer, controller, 0), parent = new THREE.Group(); parent.add(grip);
const matrix = new THREE.Matrix4().makeTranslation(.2, 1.2, -.4).toArray(); gripAPI.updateXRGrip(renderer, controller, source, {getPose: (space, ref) => {assert.equal(space, source.gripSpace); assert.equal(ref, reference); return {transform: {matrix}};}});
assert(grip.visible); assert.deepEqual(grip.position.toArray(), [.2, 1.2, -.4]); gripAPI.updateXRGrip(renderer, controller, source, {getPose: () => null}); assert(!grip.visible);
for (let index = 0; index < 100; index++) gripAPI.updateXRGrip(renderer, controller, source, {getPose: () => ({transform: {matrix}})}); assert.equal(parent.children.length, 1, 'Hot pose updates never allocate extra grip Groups.');
gripAPI.updateXRGrip(renderer, controller, null); assert(!grip.visible);
console.log('Vehicle direct cab: real wheel/lever rigs, bilateral native grip poses, unwrap/clamps, stick arbitration, physical lift, menu/pause/tracking/session/disconnect rearm, cleanup and r112 gripSpace tracking passed.');
