'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const source = fs.readFileSync(path.join(__dirname, '../../packages/render-three/BrowserInput.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class BrowserInput', 'return class BrowserInput');
class Events {
  constructor() {this.events = new Map(); this.children = []; this.isConnected = true; this.captured = new Set();}
  addEventListener(type, handler) {if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(handler);}
  removeEventListener(type, handler) {this.events.get(type)?.delete(handler);}
  fire(type, event = {}) {this.events.get(type)?.forEach(handler => handler(event));}
  setAttribute() {} appendChild(child) {this.children.push(child);} remove() {this.isConnected = false;}
  setPointerCapture(id) {this.captured.add(id);} hasPointerCapture(id) {return this.captured.has(id);} releasePointerCapture(id) {this.captured.delete(id); this.fire('lostpointercapture', {pointerId: id});}
}
class Ray {
  constructor() {this.controllers = []; this.raycasterContext = new THREE.Group(); this.selections = 0;}
  setLineStyle() {} addController(controller, inputSource, aim) {const data = {controller, inputSource, aim}; this.controllers.push(data); return data;}
  removeController(controller) {this.controllers = this.controllers.filter(data => data.controller !== controller);}
  execute() {} onSelectStart() {this.selections++;} onSelectEnd() {} cancelSelect() {}
}
class Locomotion {reset() {} dispose() {} tick() {}}
function fixture(pointerLock = true) {
  const document = new Events(), window = new Events(), canvas = new Events(); document.body = new Events(); document.createElement = () => new Events(); canvas.ownerDocument = document;
  const ctx = {camera: new THREE.PerspectiveCamera(), cameraRig: new THREE.Group(), scene: new THREE.Scene(), renderer: {xr: {getController: () => new THREE.Group(), getSession: () => null}}}; ctx.cameraRig.add(ctx.camera); ctx.scene.add(ctx.cameraRig);
  const Input = new Function('THREE', 'RayControl', 'XRLocomotion', 'createXRGrip', 'updateXRGrip', 'document', 'window', source)(THREE, Ray, Locomotion, () => new THREE.Group(), () => {}, document, window);
  let requests = 0;
  canvas.requestPointerLock = () => {requests++; document.pointerLockElement = canvas; document.fire('pointerlockchange');};
  document.exitPointerLock = () => {document.pointerLockElement = null; document.fire('pointerlockchange');};
  const input = new Input(ctx, canvas, {desktopPointerLock: pointerLock});
  return {ctx, input, canvas, document, window, requests: () => requests};
}
const mouse = (extra = {}) => ({pointerType: 'mouse', pointerId: 7, button: 0, buttons: 1, clientX: 280, clientY: 200, movementX: 0, movementY: 0, ...extra});
async function run() {
  const f = fixture(), {input, canvas, document, ctx} = f, initial = ctx.camera.quaternion.clone();
  document.fire('pointermove', mouse({movementX: 80})); canvas.fire('pointermove', mouse({movementX: 80})); assert(ctx.camera.quaternion.equals(initial), 'A free cursor never moves desktop look.');
  canvas.fire('pointerdown', mouse()); canvas.fire('pointerup', mouse({buttons: 0}));
  assert.equal(f.requests(), 1); assert(ctx.desktopLook.isLocked); assert.equal(input.ray.selections, 0, 'The capture click cannot accidentally operate equipment.');
  document.fire('pointermove', mouse({movementX: 30, movementY: -5})); assert(!ctx.camera.quaternion.equals(initial), 'Captured mouse movement controls the centre look direction.');
  ctx.scene.updateMatrixWorld(true); const aim = ctx.desktopControllerData.aim.getWorldPosition(new THREE.Vector3()), centre = ctx.camera.getWorldPosition(new THREE.Vector3()); assert(aim.distanceTo(centre) < 1e-8, 'The desktop ray starts at the camera centre regardless of the former browser cursor position.');
  canvas.fire('pointerdown', mouse()); canvas.fire('pointerup', mouse({buttons: 0})); assert.equal(input.ray.selections, 1, 'A subsequent captured click operates the centre ray.');
  ctx.desktopLook.unlock(); const released = ctx.camera.quaternion.clone(); document.fire('pointermove', mouse({movementX: 100})); canvas.fire('pointermove', mouse({clientX: 500})); assert(ctx.camera.quaternion.equals(released), 'Leaving a truck or pressing Escape cannot leave mouse look attached.');
  ctx.publicDialogOpen = true; canvas.fire('pointerdown', mouse()); assert.equal(f.requests(), 1); ctx.publicDialogOpen = false;
  canvas.fire('pointerdown', mouse({pointerType: 'touch', pointerId: 12})); canvas.fire('pointermove', mouse({pointerType: 'touch', pointerId: 12, clientX: 310})); canvas.fire('pointerup', mouse({pointerType: 'touch', pointerId: 12, buttons: 0})); assert.equal(f.requests(), 1, 'Touch keeps swipe navigation without requesting mouse lock.');
  const unhandled = [], onRejected = error => unhandled.push(error); process.on('unhandledRejection', onRejected);
  try {
    let deniedRequests = 0; canvas.requestPointerLock = () => {deniedRequests++; return Promise.reject(new Error('Denied pointer permission.'));}; canvas.fire('pointerdown', mouse()); canvas.fire('pointerup', mouse({buttons: 0})); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(unhandled, []); assert(!ctx.desktopLook.isLocked); assert.equal(input.pointerLockUnavailable,true);
    const beforeFallback = ctx.camera.quaternion.clone(); canvas.fire('pointerdown', mouse()); canvas.fire('pointermove', mouse({clientX: 320})); assert(!ctx.camera.quaternion.equals(beforeFallback),'Denied capture falls back to deliberate hold-drag look.'); canvas.fire('pointerup',mouse({clientX:320,buttons:0})); assert.equal(deniedRequests,1,'Embedded browsers do not receive a denied permission request on every click.');
    ctx.scene.updateMatrixWorld(true); assert(ctx.desktopControllerData.aim.getWorldPosition(new THREE.Vector3()).distanceTo(ctx.camera.getWorldPosition(new THREE.Vector3()))<1e-8,'Fallback drag still uses the centre ray.');
    const afterFallback=ctx.camera.quaternion.clone(); canvas.fire('pointermove',mouse({clientX:450,buttons:0})); document.fire('pointermove',mouse({movementX:100,buttons:0})); assert(ctx.camera.quaternion.equals(afterFallback),'Releasing fallback drag immediately frees the mouse.');
    const throwing=fixture(); throwing.canvas.requestPointerLock=()=>{throw Error('Inactive document.');}; assert.doesNotThrow(()=>throwing.canvas.fire('pointerdown',mouse())); assert.equal(throwing.input.pointerLockUnavailable,true); throwing.input.dispose();
    const eventFailure=fixture(); eventFailure.canvas.fire('pointerdown',mouse()); eventFailure.ctx.desktopLook.unlock(); eventFailure.document.fire('pointerlockerror'); assert.equal(eventFailure.input.pointerLockUnavailable,true); eventFailure.input.dispose();
  } finally {process.removeListener('unhandledRejection', onRejected);}
  input.pointerLockUnavailable=false; canvas.requestPointerLock = () => {document.pointerLockElement = canvas; document.fire('pointerlockchange');}; canvas.fire('pointerdown', mouse()); assert(ctx.desktopLook.isLocked); input.dispose(); assert(!ctx.desktopLook.isLocked); assert.equal(document.events.get('pointermove').size, 0, 'Disposal releases owned pointer lock and document handlers.');
  const legacy = fixture(false); legacy.canvas.fire('pointerdown', mouse()); legacy.canvas.fire('pointermove', mouse({clientX: 310})); assert(!legacy.ctx.camera.quaternion.equals(new THREE.Quaternion()), 'Other BrowserHost apps retain opt-in drag navigation.'); assert.equal(legacy.requests(), 0); legacy.input.dispose();
  console.log('Browser pointer navigation: centre capture/select, free cursor, touch, blocked dialogs, denied permission, legacy drag and disposal passed.');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
