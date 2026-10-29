const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three'), {createRequire} = require('node:module');
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-desktop-navigation.js"), '../src/lib/SmoothPointerLockControls.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class SmoothPointerLockControls', 'return class SmoothPointerLockControls');
const Controls = new Function('THREE', source)(THREE);
class Events { constructor() { this.events = new Map(); } addEventListener(type, handler) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(handler); } removeEventListener(type, handler) { this.events.get(type)?.delete(handler); } fire(type, event = {}) { this.events.get(type)?.forEach(handler => handler(event)); } }
const document = new Events(); document.defaultView = new Events(); const canvas = {ownerDocument: document};
canvas.requestPointerLock = () => { document.pointerLockElement = canvas; document.fire('pointerlockchange'); }; document.exitPointerLock = () => { document.pointerLockElement = null; document.fire('pointerlockchange'); };
const scene = new THREE.Scene(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(); rig.add(camera); scene.add(rig); camera.position.y = 1.6;
const controls = new Controls(camera, canvas), initial = camera.quaternion.clone();
document.fire('mousemove', {movementX: 100}); controls.update(1 / 60); assert(camera.quaternion.equals(initial));
controls.lock(); document.fire('mousemove', {movementX: 100, movementY: 10}); assert(camera.quaternion.equals(initial), 'Mouse input is integrated by frames instead of jumping on each event.');
controls.update(1 / 60); const first = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); assert(first.y < 0 && Math.abs(first.y) < .125);
for (let frame = 0; frame < 120; frame++) controls.update(1 / 60);
const settled = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); assert(Math.abs(settled.y + .125) < 1e-6); assert(Math.abs(settled.z) < 1e-9, 'Smoothed desktop look never adds roll.');
document.fire('mousemove', {movementX: 150}); controls.unlock(); const unlocked = camera.quaternion.clone(); controls.update(.1); controls.lock(); controls.update(.1); assert(camera.quaternion.equals(unlocked), 'Esc/relock clears pending camera motion.');
document.fire('mousemove', {movementX: 100}); document.defaultView.fire('blur'); controls.update(.1); assert(camera.quaternion.equals(unlocked));
controls.unlock(); const touchStart = camera.quaternion.clone(), touchPosition = camera.position.clone(); controls.addLookDelta(60, -20); controls.update(1 / 60);
assert(!camera.quaternion.equals(touchStart) && !controls.isLocked, 'Touch look uses the same smoothing without pretending to hold pointer lock.'); assert(camera.position.equals(touchPosition));
for (let frame = 0; frame < 120; frame++) controls.update(1 / 60); assert.equal(controls.touchPending, false, 'A completed touch queue stops updating without hidden camera work.');
const touchSettled = camera.quaternion.clone(); controls.addLookDelta(NaN, 10); controls.update(.1); assert(camera.quaternion.equals(touchSettled)); controls.addLookDelta(40, 20); document.defaultView.fire('blur'); controls.update(.1); assert(camera.quaternion.equals(touchSettled), 'Blur cancels a queued swipe before it can move a hidden camera.');

const index = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-desktop-navigation.js"), '../src/index.js')), 'utf8'), extract = name => { const match = index.match(new RegExp('function ' + name + '\\([^]*?\\n\\}')); assert(match); return match[0]; };
const calls = [], ctx = {cameraRig: rig, desktopFlight: false, studioLocomotion: 'smooth', vrMode: false, collisionWorld: {
  moveSphere(from, desired, radius) { calls.push({type: 'sphere', from: from.clone(), desired: desired.clone(), radius}); return desired.clone(); },
  moveCapsule(from, desired, options) { calls.push({type: 'capsule', from: from.clone(), desired: desired.clone(), options}); return desired.clone(); }
}};
const input = new Function('THREE', 'context', 'camera', 'controls',
  'let keyboardState={}; const keyboardMoveSpeed=3; const debug=false; const raycontrol=null; const desktopControllerData=null;\n' + ['onKeyDown','onKeyUp','clearKeyboardState','updateKeyboardMovement'].map(extract).join('\n') + '\nreturn {down:onKeyDown,up:onKeyUp,clear:clearKeyboardState,update:updateKeyboardMovement,keys:()=>keyboardState};')(THREE, ctx, camera, controls);
const key = code => ({code, target: {tagName: 'CANVAS'}, preventDefault() { this.prevented = true; }});
camera.quaternion.setFromEuler(new THREE.Euler(-.4, .3, 0, 'YXZ')); camera.updateMatrix(); const held = new THREE.Group(); held.quaternion.setFromEuler(new THREE.Euler(0, .7, 0)); const heldRotation = held.quaternion.clone();
input.down(key('KeyW')); input.update(.1); assert.equal(calls.at(-1).type, 'capsule'); assert(Math.abs(calls.at(-1).desired.y - calls.at(-1).from.y) < 1e-9, 'Walking stays horizontal while looking up/down.'); input.clear();
ctx.desktopFlight = true; input.down(key('KeyQ')); input.update(.1); assert.equal(calls.at(-1).type, 'sphere'); assert(Math.abs(calls.at(-1).desired.y - calls.at(-1).from.y - .3) < 1e-9); input.clear();
input.down(key('KeyE')); input.down(key('ControlLeft')); input.update(.1); assert(Math.abs(calls.at(-1).desired.y - calls.at(-1).from.y + .9) < 1e-9); input.clear();
input.down(key('KeyW')); input.down(key('KeyD')); input.down(key('KeyQ')); input.update(.1); assert(Math.abs(calls.at(-1).desired.distanceTo(calls.at(-1).from) - .3) < 1e-9, 'Diagonal flight is normalized.'); input.clear();
ctx.studioLocomotion = 'teleport'; ctx.desktopFlight = false; const count = calls.length; input.down(key('KeyW')); input.update(.1); assert.equal(calls.length, count, 'Teleport-only mode keeps its existing keyboard policy.');
ctx.desktopFlight = true; input.update(.1); assert.equal(calls.length, count + 1); input.clear();
ctx.vrMode = true; input.down(key('KeyQ')); const position = camera.position.clone(), rotation = camera.quaternion.clone(); input.update(.1); assert(camera.position.equals(position) && camera.quaternion.equals(rotation), 'Drone input never changes tracked XR poses.');
assert(held.quaternion.equals(heldRotation), 'Camera smoothing/flight does not rewrite a grabbed product orientation.');
ctx.vrMode = false; ctx.studioLocomotion = 'smooth'; ctx.desktopFlight = false; input.clear(); let mobileInput = {forward: .25, right: 0, vertical: 0, lookX: 0, lookY: 0};
ctx.mobileNavigation = {consume: () => mobileInput, reset: () => { mobileInput = {forward: 0, right: 0, vertical: 0, lookX: 0, lookY: 0}; }};
input.update(.1); assert.equal(calls.at(-1).type, 'capsule'); assert(Math.abs(calls.at(-1).desired.distanceTo(calls.at(-1).from) - .075) < 1e-6, 'A light analog touch walks at quarter speed through the same collision path.');
ctx.desktopFlight = true; mobileInput = {forward: 0, right: 0, vertical: .25, lookX: 0, lookY: 0}; input.update(.1); assert.equal(calls.at(-1).type, 'sphere'); assert(Math.abs(calls.at(-1).desired.y - calls.at(-1).from.y - .075) < 1e-6, 'Analog drone input preserves its pressure instead of jumping to full speed.');
ctx.vrMode = true; mobileInput = {forward: 1, right: 0, vertical: 1, lookX: 100, lookY: 30}; const xrTouchPosition = camera.position.clone(), xrTouchRotation = camera.quaternion.clone(); input.update(.1); assert(camera.position.equals(xrTouchPosition) && camera.quaternion.equals(xrTouchRotation), 'Pending mobile input cannot move a tracked XR camera.'); delete ctx.mobileNavigation;
ctx.vrMode = false; input.clear(); const typing = key('KeyW'); typing.target.tagName = 'INPUT'; input.down(typing); assert.equal(input.keys().KeyW, undefined); controls.dispose(); assert.equal(document.events.get('mousemove').size, 0);

async function editorZoom() {
  const file = __layout.map(path.join(__layout.oldDir("scripts/test-desktop-navigation.js"), 'test-editor-connection-reflow.js')), text = fs.readFileSync(file, 'utf8');
  const {fixture} = new Function('require','__dirname',text.slice(0,text.lastIndexOf('\nasync function run()'))+'\nreturn {fixture};')(createRequire(file),__dirname);
  const f = await fixture(), e = f.editor; assert(e.orbit.enableDamping); assert(e.orbit.rotateSpeed < 1 && e.orbit.panSpeed < 1);
  const before = e.camera.position.distanceTo(e.orbit.target); e.pendingZoom = .144; e.updateSmoothZoom(1/60); const first = e.camera.position.distanceTo(e.orbit.target);
  assert(first > before && first < before * Math.exp(.144), 'Wheel zoom advances gradually.'); for(let frame=0;frame<120;frame++)e.updateSmoothZoom(1/60);
  assert(Math.abs(e.camera.position.distanceTo(e.orbit.target)-before*Math.exp(.144))<.001);
  e.pendingZoom=.2;e.transform.dragging=true;const position=e.camera.position.clone();e.updateSmoothZoom(.1);assert(e.camera.position.equals(position));e.transform.dragging=false;e.clearNavigation();assert.equal(e.pendingZoom,0);f.close();
}
function vehicleEntryClick() {
  const doc = new Events(), target = {ownerDocument: doc}, look = new Controls(new THREE.PerspectiveCamera(), target), context = {};
  target.requestPointerLock = () => { doc.pointerLockElement = target; doc.fire('pointerlockchange'); };
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.fire('pointerlockchange'); };
  let enter = true, selects = 0, releases = 0;
  const controller = {dispatchEvent() {}}, raycontrol = {onSelectStart() { selects++; if (enter) { context.drivingVehicle = 'truck'; look.unlock(); } }, onSelectEnd() { releases++; }};
  const handlers = new Function('context', 'controls', 'raycontrol', 'desktopController',
    'let desktopControllerData={}; let desktopVehicleAtMouseDown=null;\n' + ['onDesktopCanvasClick', 'onDesktopSelectStart', 'onDesktopSelectEnd'].map(extract).join('\n') + '\nreturn {down:onDesktopSelectStart,up:onDesktopSelectEnd,click:onDesktopCanvasClick};')(context, look, raycontrol, controller);
  const event = {button: 0};
  look.lock(); handlers.down(event); handlers.up(event); handlers.click(event);
  assert.equal(context.drivingVehicle, 'truck'); assert.equal(look.isLocked, false, 'Clicking an operator zone cannot recapture the cursor released by mount during the same press.');
  enter = false; handlers.down(event); handlers.up(event); handlers.click(event);
  assert(look.isLocked, 'A separate canvas click from the cockpit still captures look.'); assert.equal(selects, 2); assert.equal(releases, 2);
  look.unlock(); context.editor = {active: true}; handlers.down(event); handlers.click(event); assert.equal(look.isLocked, false);
  context.editor.active = false; context.vrMode = true; handlers.down(event); handlers.click(event); assert.equal(look.isLocked, false, 'Desktop mouse capture cannot alter immersive input.');
  look.dispose();
}
vehicleEntryClick();

async function deniedCapture() {
  const doc = new Events(), target = {ownerDocument: doc, isConnected: true}, camera = new THREE.PerspectiveCamera(), control = new Controls(camera, target), unhandled = [];
  const record = error => unhandled.push(error); process.on('unhandledRejection', record);
  try {
    let calls = 0, actions = 0; target.requestPointerLock = () => { calls++; return Promise.reject(new Error('Pointer permission denied.')); };
    control.lock(); actions++; await new Promise(resolve => setImmediate(resolve));
    assert.equal(actions, 1); assert.equal(calls, 1); assert.deepEqual(unhandled, []); assert.equal(control.isLocked, false, 'Denied capture leaves the world click usable and never reports an uncaught promise.');
    target.requestPointerLock = () => { calls++; throw new Error('Inactive document.'); }; assert.doesNotThrow(() => { control.lock(); actions++; }); assert.equal(actions, 2);
    target.isConnected = false; control.lock(); assert.equal(calls, 2, 'A detached canvas never asks to capture the pointer.');
    target.isConnected = true; delete target.requestPointerLock; assert.doesNotThrow(() => control.lock());
    target.requestPointerLock = () => { calls++; }; control.disconnect(); control.lock(); assert.equal(calls, 2, 'Disposed controls cannot recapture pointer input.');
  } finally { control.dispose(); process.removeListener('unhandledRejection', record); }
}
deniedCapture().then(editorZoom).then(()=>console.log('Desktop navigation: denied/unsupported pointer capture keeps clicks usable without uncaught errors; smoothed yaw/pitch, unlock/blur cleanup, walk/drone/teleport/XR and collision-ready editor zoom passed.')).catch(error=>{console.error(error);process.exitCode=1;});
