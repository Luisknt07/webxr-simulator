const __layout = require("../../tooling/layout.cjs");
'use strict';
// Production input adapter and vehicle runtime; only DOM/XR tracking surfaces
// are fixtures. A physical headset is still required for final ergonomics QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./test-vehicle-runtime.js');
const {THREE} = h;
const {Driving} = require('../support/load-vehicle-driving.js')(THREE);
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.hidden = false; this.style = {}; this.rectangles = []; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter(value => value !== child); child.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { if (this.listeners.has(type)) this.listeners.get(type).delete(listener); }
  fire(type, value = {}) { const event = Object.assign({target: this, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }}, value); for (const listener of this.listeners.get(type) || []) listener(event); return event; }
  setPointerCapture(id) { this.captured = id; }
  getContext() { return {fillRect: (...args) => this.rectangles.push(args), fillText: () => {}}; }
}
function setup(vr = false, load = false) {
  const f = h.fixture('forklift-electric-4w', false, load), dom = new Element('document'), window = new Element('window');
  dom.body = new Element('body'); dom.createElement = tag => new Element(tag); dom.defaultView = window;
  const cameraRig = new THREE.Group(), camera = new THREE.PerspectiveCamera(70, 1, .05, 100);
  camera.position.set(.12, 1.65, .08); camera.rotation.set(.12, .18, .04); cameraRig.position.set(1, 0, -2); cameraRig.rotation.y = .3; cameraRig.add(camera); f.scene.add(cameraRig);
  const session = {visibilityState: 'visible'}, active = new Set(), input = f.ctx.raycontrol;
  Object.assign(input, {controllers: [], activateState(name) { active.add(name); }, deactivateState(name) { active.delete(name); }, removeState(name) { delete this.states[name]; }});
  Object.assign(f.ctx, {camera, cameraRig, document: dom, vrMode: vr, desktopFlight: true, renderer: {xr: {getSession: () => vr ? session : null, getCamera: () => camera}}});
  const commands = [], notices = [], command = f.runtime.command.bind(f.runtime);
  f.runtime.command = (id, action, value) => { commands.push(action); return command(id, action, value); };
  const driving = new Driving(f.ctx, f.runtime, {document: dom, window, notify: message => notices.push(message)});
  f.scene.updateMatrixWorld(true); return Object.assign(f, {dom, window, camera, cameraRig, session, active, commands, notices, driving});
}
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function key(f, code, down = true, extra = {}) { return f.window.fire(down ? 'keydown' : 'keyup', Object.assign({code, repeat: false, target: f.dom.body}, extra)); }
function nodes(root, predicate) { return root.children.flatMap(child => (predicate(child) ? [child] : []).concat(nodes(child, predicate))); }
function pad(hand) { const source = {handedness: hand, targetRayMode: 'tracked-pointer', gamepad: {mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: Array.from({length: 6}, () => ({pressed: false, value: 0}))}}; return {inputSource: source, controller: new THREE.Group(), enabled: true}; }
function axis(data, x, y) { data.inputSource.gamepad.axes = [0, 0, x, y]; }
function press(data, index, down) { data.inputSource.gamepad.buttons[index] = {pressed: down, value: down ? 1 : 0}; }

const desktop = setup();
const originalCamera = desktop.camera.quaternion.clone(), originalPosition = desktop.camera.position.clone();
assert.ok(desktop.driving.mount(desktop.record.id)); assert.equal(desktop.ctx.drivingVehicle, desktop.record.id);
assert.equal(desktop.driving.hud.className, 'vehicle-driving-hud'); assert.ok(!desktop.driving.hud.hidden);
const seat = desktop.api.rig(desktop.record).driverSeat;
near(desktop.camera.getWorldPosition(new THREE.Vector3()).distanceTo(seat.getWorldPosition(new THREE.Vector3())), 0);
const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(desktop.camera.getWorldQuaternion(new THREE.Quaternion())); near(forward.dot(new THREE.Vector3(0, 0, 1)), 1);
assert.ok(key(desktop, 'KeyW').prevented); key(desktop, 'KeyD'); key(desktop, 'KeyQ'); desktop.driving.beforeStep();
assert.equal(desktop.v.input.throttle, 1); assert.equal(desktop.v.input.steer, 1); assert.equal(desktop.v.input.lift, 1);
key(desktop, 'KeyW', false, {target: {tagName: 'INPUT'}}); desktop.driving.beforeStep(); assert.equal(desktop.v.input.throttle, 0, 'A key release remains effective when focus enters a text field.');
key(desktop, 'KeyW', true, {target: {tagName: 'TEXTAREA'}}); desktop.driving.beforeStep(); assert.equal(desktop.v.input.throttle, 0);
key(desktop, 'KeyD', false); key(desktop, 'KeyQ', false);
key(desktop, 'KeyW'); desktop.ctx.studioMenuOpen = true; desktop.driving.beforeStep(); assert.equal(desktop.v.input.brake, 1); assert.equal(desktop.v.input.throttle, 0);
desktop.ctx.studioMenuOpen = false; key(desktop, 'KeyW', true, {repeat: true}); desktop.driving.beforeStep(); assert.equal(desktop.v.input.throttle, 0, 'Closing a menu does not replay a held key.');
key(desktop, 'KeyW', false); key(desktop, 'KeyW'); desktop.driving.beforeStep(); assert.equal(desktop.v.input.throttle, 1);
desktop.driving.command('emergency'); desktop.driving.beforeStep(); assert.equal(desktop.v.input.throttle, 0); desktop.driving.command('resetEmergency'); desktop.driving.command('start'); desktop.driving.beforeStep(); assert.equal(desktop.v.input.throttle, 0);
key(desktop, 'KeyW', false);
const touch = nodes(desktop.driving.hud, element => element.dataset.vehicleHold === 'KeyQ')[0];
touch.fire('pointerdown', {pointerId: 7}); desktop.driving.beforeStep(); assert.equal(desktop.v.input.lift, 1); touch.fire('pointercancel', {pointerId: 7}); desktop.driving.beforeStep(); assert.equal(desktop.v.input.lift, 0);
assert.equal(desktop.driving.worldPanel.plane.visible, false); assert.equal(desktop.driving.worldState.state.isSelectable(), false);
function verifyWorldGrid(f) {
  const page = () => {
    const panel = f.driving.worldPanel, regions = panel.regions.slice(), hits = [], invoke = f.driving.command;
    assert.deepEqual(regions.map(region => region.action), panel.actions.map(([action]) => action)); assert(regions.length);
    f.driving.command = action => {hits.push(action); return true;};
    try {
      regions.forEach((region, index) => {
        assert(region.w > 0 && region.h > 0 && region.x >= 0 && region.y >= 0 && region.x + region.w <= 1024 && region.y + region.h <= 640);
        f.driving.worldState.state.onSelectStart({uv: {x: (region.x + region.w / 2) / 1024, y: 1 - (region.y + region.h / 2) / 640}}); assert.equal(hits[index], region.action);
      });
      f.driving.worldState.state.onSelectStart({uv: {x: .01, y: .99}}); assert.equal(hits.length, regions.length, 'The informational header cannot issue a vehicle command.');
    } finally {f.driving.command = invoke;}
    return hits;
  };
  assert.equal(f.driving.worldPage, 'cab'); const compact = page(); assert(compact.length <= 6 && compact.includes('controls') && compact.includes('exit'));
  assert(f.driving.command('controls')); assert.equal(f.driving.worldPage, 'controls'); const secondary = page();
  assert.ok(['lights', 'powerOff', 'stop', 'pause', 'resetEmergency', 'controls'].every(action => secondary.includes(action)), 'All safety and energy commands remain available on the complete panel.');
  const hitch = f.driving.features().hitch || f.record.components.vehicle.config.maxTowKg > 0;
  for (const action of ['couple', 'uncouple']) assert.equal(secondary.includes(action), !!hitch, 'Only an actual hitch offers towing commands.');
  assert(f.driving.command('controls')); assert.equal(f.driving.worldPage, 'cab');
}
desktop.v.actualSpeed = .2; desktop.record.variables.actualSpeed = 0; assert.equal(desktop.driving.unmount(), false, 'Exit uses actual runtime speed, never stale HMI telemetry.'); desktop.v.actualSpeed = 0;
assert.ok(desktop.driving.unmount()); assert.equal(desktop.ctx.drivingVehicle, null); assert.ok(desktop.v.parkingBrake); assert.equal(desktop.v.input.brake, 1);
assert.ok(desktop.camera.quaternion.equals(originalCamera)); assert.ok(desktop.camera.position.equals(originalPosition)); assert.equal(desktop.active.size, 0);
desktop.ctx.studio = {room: {role: 'participant'}}; assert.equal(desktop.driving.mount(desktop.record.id), false); desktop.driving.dispose(); desktop.runtime.stop();

// Use the production pointer-lock controller and actual DOM click handlers.
// In browsers a captured pointer sends clicks to the locked canvas, so an
// otherwise-visible cockpit HUD cannot receive its Encender button at all.
const cold = setup(), canvas = new Element('canvas'); canvas.ownerDocument = cold.dom; canvas.isConnected = true;
canvas.requestPointerLock = () => { cold.dom.pointerLockElement = canvas; cold.dom.fire('pointerlockchange'); };
cold.dom.exitPointerLock = () => { cold.dom.pointerLockElement = null; cold.dom.fire('pointerlockchange'); };
const Look = new Function('THREE', fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-vehicle-driving.js"), '../src/lib/SmoothPointerLockControls.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class SmoothPointerLockControls', 'return class SmoothPointerLockControls'))(THREE);
const look = new Look(cold.camera, canvas); cold.ctx.desktopLook = look;
canvas.addEventListener('click', () => { if (!look.isLocked) look.lock(); });
cold.v.powered = false; cold.v.running = false; cold.v.parkingBrake = true;
Object.assign(cold.record.variables, {powered: true, running: true, parkingBrake: false}); // Deliberately stale telemetry.
canvas.fire('click'); assert(look.isLocked);
assert(cold.driving.mount(cold.record.id)); assert.equal(cold.dom.pointerLockElement, null); assert.equal(look.isLocked, false, 'Mounting releases the real pointer lock so cockpit buttons can receive clicks.');
const button = action => nodes(cold.driving.hud, element => element.dataset.vehicleCommand === action)[0];
const mouseClick = action => (cold.dom.pointerLockElement || button(action)).fire('click');
assert.equal(cold.driving.status.textContent, cold.record.object.name); assert.match(cold.driving.phase.textContent, /Apagado.*Freno P activo/); assert.equal(cold.driving.nextStep.action, 'powerOn'); assert.match(cold.driving.guideText.textContent, /Enciende.*Mando: B/);
mouseClick('start'); assert.equal(cold.v.running, false); assert.match(cold.notices.at(-1), /Enciende y rearma/);
mouseClick('powerOn'); assert.equal(cold.v.powered, true); assert.equal(cold.v.running, false); assert.equal(button('powerOn').attributes['aria-pressed'], 'true'); assert.equal(cold.driving.nextStep.action, 'start'); assert.match(cold.driving.guideText.textContent, /Pulsa Marcha.*Mando: V/);
mouseClick('start'); assert.equal(cold.v.running, true); assert.equal(button('start').attributes['aria-pressed'], 'true'); assert.equal(button('parkingBrake').attributes['aria-pressed'], 'true'); assert.equal(cold.driving.nextStep.action, 'parkingBrake'); assert.match(cold.driving.guideText.textContent, /libera el freno.*Mando: P/);
key(cold, 'KeyW'); cold.driving.beforeStep(); const parked = cold.object.position.clone(); h.step(cold, .3); assert(cold.object.position.equals(parked), 'Starting never silently releases the parking brake.'); key(cold, 'KeyW', false);
mouseClick('parkingBrake'); assert.equal(cold.v.parkingBrake, false); assert.equal(button('parkingBrake').attributes['aria-pressed'], 'false');
cold.driving.beforeStep(); key(cold, 'KeyW');
for (let frame = 0; frame < 90; frame++) {
  cold.driving.beforeStep(); h.step(cold, 1/60);
  if (frame === 29) assert(cold.object.position.distanceTo(parked) > 0 && cold.object.position.distanceTo(parked) < .1, 'The first half-second of throttle begins progressively rather than jumping forward.');
}
assert(cold.object.position.distanceTo(parked) > .1, 'Trusted cockpit actions followed by keyboard input actually move the runtime vehicle.'); key(cold, 'KeyW', false);
mouseClick('powerOff'); assert.equal(cold.v.powered, false); assert.equal(cold.v.running, false); assert.equal(cold.v.actualSpeed, 0); assert.equal(button('powerOn').attributes['aria-pressed'], 'false'); assert.equal(button('start').attributes['aria-pressed'], 'false');
canvas.fire('click'); assert(look.isLocked); key(cold, 'Tab'); assert.equal(look.isLocked, false, 'Tab frees a pointer captured again after mounting.'); key(cold, 'Tab', false);
mouseClick('powerOn'); mouseClick('start'); assert(cold.v.powered && cold.v.running); mouseClick('emergency'); assert(cold.v.emergency && !cold.v.running); mouseClick('start'); assert(!cold.v.running); mouseClick('resetEmergency'); assert(!cold.v.emergency && !cold.v.running); mouseClick('start'); assert(cold.v.running);
cold.driving.dispose(); look.dispose(); cold.runtime.stop();

// Default VR cab reserves grip for physical controls. Traction uses the left
// stick; the left trigger brakes, while right-stick clicking opens the panel.
const cabMode = setup(true, true), cabLeft = pad('left'), cabRight = pad('right'); cabMode.ctx.raycontrol.controllers = [cabLeft, cabRight];
const cabHead = cabMode.camera.quaternion.clone(), cabPosition = cabMode.camera.position.clone(); assert(cabMode.driving.mount(cabMode.record.id)); assert.equal(cabMode.driving.xrControlMode, 'cab'); cabMode.driving.beforeStep();
axis(cabLeft, .7, -.8); axis(cabRight, .8, -.7); cabMode.driving.beforeStep(); assert(cabMode.driving.fineControlActive&&cabMode.v.input.throttle > .175&&cabMode.v.input.throttle<=.35,'Near a real pallet, default-cab traction is metered after the stick input.'); assert.equal(cabMode.v.input.steer, 0, 'The default cab uses the real wheel for steering.'); assert.equal(cabMode.v.input.lift, 0); assert.equal(cabMode.v.input.tilt, 0);
press(cabLeft, 1, true); press(cabRight, 1, true); cabMode.driving.beforeStep(); assert.equal(cabMode.v.input.brake, 0, 'A free grip does not brake in cab mode.'); assert.equal(cabMode.v.entry, null); assert(!cabMode.commands.includes('pickup') && !cabMode.commands.includes('release'), 'A free right grip cannot take or drop cargo.');
press(cabLeft, 0, true); cabMode.driving.beforeStep(); assert.equal(cabMode.v.input.brake, 1, 'The left trigger operates the cab brake.'); press(cabLeft, 0, false);
axis(cabLeft, 0, 0); axis(cabRight, 0, 0); press(cabLeft, 1, false); press(cabRight, 1, false); cabMode.driving.beforeStep();
press(cabRight, 3, true); cabMode.driving.beforeStep(); assert.equal(cabMode.driving.worldPage, 'controls'); cabMode.driving.beforeStep(); assert.equal(cabMode.driving.worldPage, 'controls', 'A held right-stick click cannot repeatedly toggle the control panel.'); press(cabRight, 3, false); cabMode.driving.beforeStep(); press(cabRight, 3, true); cabMode.driving.beforeStep(); assert.equal(cabMode.driving.worldPage, 'cab');
assert(cabMode.camera.quaternion.equals(cabHead) && cabMode.camera.position.equals(cabPosition), 'Default cab actions preserve the actual tracked headset pose.'); cabMode.driving.unmount(true); cabMode.driving.dispose(); cabMode.runtime.stop();

const towing = setup(true), towRecord = towing.addVehicle('tow-tractor', [4, 0, 0]); towing.record = towRecord; assert(towing.driving.mount(towRecord.id)); verifyWorldGrid(towing);
assert(towing.driving.command('controls')); assert(towing.driving.worldPanel.actions.some(([action]) => action === 'couple') && towing.driving.worldPanel.actions.some(([action]) => action === 'uncouple')); assert(!towing.driving.worldPanel.actions.some(([action]) => action === 'pickup' || action === 'release'), 'A tow tractor exposes its hitch and omits unsupported fork-cargo commands.'); towing.driving.unmount(true); towing.driving.dispose(); towing.runtime.stop();

const vr = setup(true, true), left = pad('left'), right = pad('right'); vr.ctx.raycontrol.controllers = [left, right];
const trackingRotation = vr.camera.quaternion.clone(), trackingPosition = vr.camera.position.clone();
axis(left, .5, -.8); axis(right, 0, -.7); assert.ok(vr.driving.mount(vr.record.id)); vr.driving.beforeStep();
assert.equal(vr.v.input.throttle, 0); assert.equal(vr.v.input.lift, 0, 'Held sticks must return to neutral when mounting.');
assert.ok(vr.camera.quaternion.equals(trackingRotation)); assert.ok(vr.camera.position.equals(trackingPosition)); assert.ok(vr.driving.hud.hidden);
assert.ok(vr.driving.worldPanel.plane.visible); assert.ok(vr.driving.worldState.state.isSelectable()); verifyWorldGrid(vr);
assert.equal(vr.driving.xrControlMode, 'cab'); assert(vr.driving.command('xrControls')); assert.equal(vr.driving.xrControlMode, 'controllers', 'Legacy stick/hydraulic/grip shortcuts are an explicit accessibility alternative.');
axis(left, 0, 0); axis(right, 0, 0); vr.driving.beforeStep(); axis(left, .5, -.8); axis(right, 0, -.7); vr.driving.beforeStep();
assert(vr.driving.fineControlActive);assert.ok(vr.v.input.throttle > .175&&vr.v.input.throttle<=.35); assert.ok(vr.v.input.steer > 0); assert.ok(vr.v.input.lift > .15&&vr.v.input.lift<=.3);
const metered = {throttle: vr.v.input.throttle, steer: vr.v.input.steer};
assert(metered.steer < .32 && metered.throttle < .73, 'Partial stick travel meters direction and traction for precise approach.');
axis(left, -.5, .8); vr.driving.beforeStep(); near(vr.v.input.steer, -metered.steer); near(vr.v.input.throttle, -metered.throttle);
axis(left, 1, -1); vr.driving.beforeStep(); near(vr.v.input.steer, 1); near(vr.v.input.throttle, .35);
axis(left, -1, 1); vr.driving.beforeStep(); near(vr.v.input.steer, -1); near(vr.v.input.throttle, -.35);
axis(left, .5, -.8); vr.driving.beforeStep();
press(left, 1, true); vr.driving.beforeStep(); assert.equal(vr.v.input.brake, 1); press(left, 1, false);
axis(left, 0, 0); axis(right, 0, 0); press(right, 3, true); vr.driving.beforeStep(); assert.equal(vr.driving.mode, 1); vr.driving.beforeStep(); assert.equal(vr.driving.mode, 1, 'A held stick click advances one mode.'); press(right, 3, false); vr.driving.beforeStep();
axis(right, .6, -.7); vr.driving.beforeStep(); assert.ok(vr.v.input.reach > .15&&vr.v.input.reach<=.3); assert.ok(vr.v.input.sideShift > .12&&vr.v.input.sideShift<=.3); axis(right, 0, 0);
press(right, 1, true); vr.driving.beforeStep(); assert.ok(vr.v.entry); const pickupCount = vr.commands.filter(action => action === 'pickup').length; vr.driving.beforeStep(); assert.equal(vr.commands.filter(action => action === 'pickup').length, pickupCount);
vr.ctx.studioMenuOpen = true; vr.driving.beforeStep(); vr.ctx.studioMenuOpen = false; axis(left, 0, -.8); vr.driving.beforeStep(); assert.equal(vr.v.input.throttle, 0); assert.equal(vr.commands.filter(action => action === 'pickup').length, pickupCount);
axis(left, 0, 0); press(right, 1, false); vr.driving.beforeStep(); axis(left, 0, -.8); vr.driving.beforeStep(); assert.ok(vr.v.input.throttle > .5);
vr.ctx.studio = {room: {role: 'participant'}}; vr.driving.beforeStep(); assert.equal(vr.v.input.brake, 1); assert.equal(vr.driving.command('horn'), false); vr.ctx.studio = null;
axis(left, 0, 0); axis(right, 0, 0); vr.driving.beforeStep();
vr.camera.position.x += .10; vr.camera.rotation.z += .08; const currentTracking = vr.camera.quaternion.clone(), currentHead = vr.camera.position.clone(); vr.driving.follow();
assert.ok(vr.camera.quaternion.equals(currentTracking)); assert.ok(vr.camera.position.equals(currentHead), 'Following the seat never overwrites tracked headset pose.');
press(right, 5, true); vr.driving.beforeStep(); assert.equal(vr.ctx.drivingVehicle, null, 'Right B exits a stationary vehicle.'); assert.ok(vr.camera.quaternion.equals(currentTracking)); assert.ok(vr.camera.position.equals(currentHead)); assert.ok(vr.v.parkingBrake);
vr.driving.dispose(); vr.runtime.stop();
const stopped = setup(true), stopRight = pad('right'); stopped.ctx.raycontrol.controllers = [stopRight];
stopped.v.towedBy = 'tractor'; assert.equal(stopped.driving.mount(stopped.record.id), false); stopped.v.towedBy = '';
assert.ok(stopped.driving.mount(stopped.record.id)); stopped.driving.command('powerOff'); stopped.driving.beforeStep();
for (const state of [{powered: false}, {powered: true, running: false}, {powered: true, running: true, parkingBrake: true}]) {
  assert(!/\([BVP]\)/.test(stopped.driving.guidance(state)), 'The VR cockpit never labels desktop keyboard shortcuts as controller buttons.');
}
press(stopRight, 5, true); stopped.driving.beforeStep(); assert.equal(stopped.ctx.drivingVehicle, null, 'A powered-off vehicle still permits right B to exit after neutral rearm.'); stopped.driving.dispose(); stopped.runtime.stop();
assert.match(fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-vehicle-driving.js"), '../src/editor/editor.css')), 'utf8'), /\.vehicle-driving-hud\s*\{/);
console.log('Vehicle driving: real pointer-lock release and DOM cold start, guided state feedback, keyboard/touch/default physical cab and explicit legacy XR inputs, compact/full capability-aware ray regions, neutral rearm, host authority and exact headset preservation passed.');
module.exports = {setup, pad, axis, press, near, key, nodes, Element, Driving};
