const __layout = require("../../tooling/layout.cjs");
'use strict';
// Real Three.js caps, controller poses, RayControl callbacks, collision queries
// and scoped SimulationRuntime commands. Only the XR hardware is adapted.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-xr-contact-buttons.js"), 'test-industrial-xr.js')), 'utf8');
const helpers = new Function('require', '__dirname', source.slice(0, source.indexOf('async function run()')) + '\nreturn {setup,advance,button,select,vars,disconnect,connect,press};')(require, __dirname);
const {advance, button, select, vars, disconnect, connect} = helpers;
function fixture() {
  const f = helpers.setup(); f.session = {visibilityState: 'visible'};
  f.ctx.renderer.xr.getSession = () => f.session;
  f.sources.forEach(value => { value.targetRayMode = 'tracked-pointer'; });
  f.left.position.set(10, 4, 10); f.right.position.set(11, 4, 10);
  f.runtime.start('hall'); advance(f);
  helpers.press(f, 'powerOn'); helpers.press(f, 'start');
  return f;
}
function place(f, controller, current, gap = .008, rear = false) {
  const entry = f.visuals.contactButtons.find(value => value.owner === current.object); assert(entry);
  current.object.updateWorldMatrix(true, false);
  const point = new THREE.Vector3(entry.center.x, entry.center.y, entry.bounds.max.z).applyMatrix4(current.object.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).applyMatrix3(new THREE.Matrix3().getNormalMatrix(current.object.matrixWorld)).normalize();
  if (rear) normal.negate();
  controller.position.copy(point).addScaledVector(normal, .045 + gap);
  controller.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(controller.position, point, new THREE.Vector3(0, 1, 0)));
  f.scene.updateMatrixWorld(true); return {point, normal};
}
function leave(f, controller, current) { place(f, controller, current, .18); advance(f, .3); }
function sequence(f, current) { return f.runtime.getControlFeedback(current.id).sequence; }
function pressed(f, current) { return f.runtime.getControlFeedback(current.id).pressed; }
function cleanup(f) { f.visuals.dispose(); f.runtime.stop(); }

const f = fixture(), pause = button(f, 'pause'), rest = pause.cap.position.z;
place(f, f.left, pause); advance(f, .12);
assert.equal(sequence(f, pause), 1); assert(vars(f).paused && vars(f, f.tail).paused); assert.equal(vars(f, f.unrelated).paused, false);
assert(pressed(f, pause)); assert(pause.cap.position.z < rest - .008, 'Contact physically depresses the same rendered cap.');
advance(f, .4); assert.equal(sequence(f, pause), 1, 'Resting on a cap never repeats its toggle.');
assert(f.pulses.some(value => value.handedness === 'left'), 'Contact uses the real hand haptic actuator when available.');
place(f, f.right, pause); advance(f); assert.equal(sequence(f, pause), 1, 'Two hands share one mechanical press.');
select(f, f.left, 'selectstart'); advance(f); select(f, f.left, 'selectend'); advance(f);
assert.equal(sequence(f, pause), 1); assert(pressed(f, pause), 'Trigger release cannot release the separate physical contact owner.');
leave(f, f.left, pause); assert(pressed(f, pause)); leave(f, f.right, pause); assert(!pressed(f, pause));
assert(Math.abs(pause.cap.position.z - rest) < .0001);
place(f, f.right, pause); advance(f); assert.equal(sequence(f, pause), 2); assert.equal(vars(f).paused, false);
place(f, f.right, pause, .03); advance(f); assert(pressed(f, pause), 'Release hysteresis tolerates small hand jitter.');
leave(f, f.right, pause); place(f, f.right, pause, .08); advance(f); assert.equal(sequence(f, pause), 2, 'A near ray eight centimetres away does not count as touch.');
place(f, f.right, pause, .008, true); advance(f); assert.equal(sequence(f, pause), 2, 'A controller behind the panel cannot press a cap.');

// Holding a product/native object cannot press controls accidentally.
leave(f, f.left, pause); f.left.userData.grabbing = new THREE.Group(); place(f, f.left, pause); advance(f);
assert.equal(sequence(f, pause), 2); f.left.userData.grabbing = null; advance(f); assert.equal(sequence(f, pause), 2);
leave(f, f.left, pause); const product = f.runtime.products.get(f.cartons[0]), productMatrix = product.object.matrixWorld.clone();
assert(f.runtime.pickupProduct(product, f.left, 'squeeze')); place(f, f.left, pause); f.visuals.sync('hall', .016, false); assert.equal(sequence(f, pause), 2);
f.runtime.releaseProduct(product); f.runtime.setProductMatrix(product, productMatrix);
leave(f, f.left, pause);

// Initial overlap, menu resume, hidden session, editor, loading and reconnect
// all need a clear outside sample before a new approach can actuate a button.
for (const guard of [
  value => { f.ctx.studioMenuOpen = value; }, value => { f.ctx.xrExitPending = value; },
  value => { f.ctx.editor.active = value; }, value => { f.ctx.editor.loadingProject = value; },
  value => { f.left.visible = !value; },
  value => { f.session.visibilityState = value ? 'visible-blurred' : 'visible'; }, value => { f.ctx.document.hidden = value; }
]) {
  place(f, f.left, pause); advance(f); const before = sequence(f, pause);
  guard(true); advance(f, .2); assert(!pressed(f, pause)); guard(false); advance(f); assert.equal(sequence(f, pause), before);
  leave(f, f.left, pause); place(f, f.left, pause); advance(f); assert.equal(sequence(f, pause), before + 1); leave(f, f.left, pause);
}
place(f, f.left, pause); advance(f); const beforeDisconnect = sequence(f, pause);
disconnect(f, f.left); advance(f, .2); assert(!pressed(f, pause)); connect(f, f.left); advance(f); assert.equal(sequence(f, pause), beforeDisconnect);
leave(f, f.left, pause); place(f, f.left, pause); advance(f); assert.equal(sequence(f, pause), beforeDisconnect + 1); leave(f, f.left, pause);

// Use the same obstruction query used by ray controls, not a direct command.
const {point, normal} = place(f, f.left, pause), obstruction = new THREE.Mesh(new THREE.BoxBufferGeometry(.25, .25, .012), new THREE.MeshBasicMaterial());
obstruction.position.copy(point).addScaledVector(normal, .027); obstruction.quaternion.copy(pause.object.getWorldQuaternion(new THREE.Quaternion()));
f.root.add(obstruction); f.ctx.collisionWorld.invalidate(obstruction); const beforeBlocked = sequence(f, pause); advance(f);
assert.equal(sequence(f, pause), beforeBlocked); f.root.remove(obstruction); f.ctx.collisionWorld.invalidate(obstruction); obstruction.geometry.dispose(); obstruction.material.dispose();
leave(f, f.left, pause); cleanup(f);

// World metres, front normals and bounds remain correct under transformed,
// nonuniformly scaled panel ancestors; authored button transforms are restored.
const transformed = fixture(); transformed.root.position.set(3, .2, -4); transformed.root.rotation.y = .8; transformed.root.scale.set(1.4, .7, 1.1); transformed.scene.updateMatrixWorld(true);
transformed.visuals.invalidate(); advance(transformed); const cap = button(transformed, 'pause');
leave(transformed, transformed.right, cap); place(transformed, transformed.right, cap); advance(transformed, .12); assert.equal(sequence(transformed, cap), 1);
leave(transformed, transformed.right, cap); const listeners = transformed.ctx.raycontrol._listeners;
cleanup(transformed); assert(!listeners.controllerDisconnected.includes(transformed.visuals.contactCancelled));
console.log('XR contact buttons: real front-cap contact, 3D press/release, bilateral/trigger deduplication, scoped commands, haptics, hold jitter, held-load guards, menu/session/editor/loading/reconnect rearming, obstruction and transformed panels passed.');
