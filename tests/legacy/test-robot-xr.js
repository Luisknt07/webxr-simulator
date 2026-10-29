const __layout = require("../../tooling/layout.cjs");
'use strict';
// Production SceneDocument, robot/HMI factory, RayControl, controller bridge,
// contact probes, collision world and RobotRuntime. Only XR hardware is adapted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const robotPrefabs = require('../support/load-robot-prefabs.js')(THREE);
let helperSource = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-robot-xr.js"), 'test-industrial-xr.js')), 'utf8');
helperSource = helperSource.slice(0, helperSource.indexOf('async function run()'))
  .replace("new Function('THREE', 'behaviorSchema', 'document', source('modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js')", "new Function('THREE', 'behaviorSchema', 'document', 'require', source('modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js')")
  .replace('(THREE, behaviorSchema, dom);', "(THREE, behaviorSchema, dom, robotPrefabs.resolve);")
  .replace("id => { assert.equal(path.resolve(path.dirname(__layout.source('editor/IndustrialPrefabs.js')), id), __layout.source('editor/ProductPrefabs.js')); return cargo; }", 'robotPrefabs.resolve');
const helpers = new Function('require', '__dirname', 'robotPrefabs', helperSource + '\nreturn {setup,advance,aim,away,button,select,press,vars,close};')(require, __dirname, robotPrefabs);
const {advance, aim, away, button, select, press, vars, close} = helpers;

function touch(f, controller, current, gap = .008) {
  const contact = f.visuals.contactButtons.find(binding => binding.owner === current.object); assert(contact);
  current.object.updateWorldMatrix(true, false);
  const point = new THREE.Vector3(contact.center.x, contact.center.y, contact.bounds.max.z).applyMatrix4(current.object.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).applyMatrix3(new THREE.Matrix3().getNormalMatrix(current.object.matrixWorld)).normalize();
  controller.position.copy(point).addScaledVector(normal, .045 + gap);
  controller.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(controller.position, point, new THREE.Vector3(0, 1, 0)));
  f.scene.updateMatrixWorld(true);
}
function until(f, condition, limit = 30) {
  for (let time = 0; time < limit; time += 1 / 60) { if (condition()) return; advance(f); }
  throw new Error('Robot XR timeout: ' + JSON.stringify(vars(f)));
}

async function run() {
  const f = helpers.setup(); [f.head, f.tail, f.unrelated, ...f.cartons].forEach(object => f.document.remove(object));
  f.head = f.document.addPrefab('hall', 'robot', 'articulated-general');
  const source = f.document.addPrefab('hall', 'source'), sink = f.document.addPrefab('hall', 'palletQueue');
  const configure = (object, type, values) => f.document.setBehaviors(object, f.document.getBehaviors(object).map(config => config.type === type ? Object.assign({}, config, values) : config));
  configure(source, 'source', {autoGenerate: false, initialCount: 3, running: true, delivery: 'manual'});
  configure(sink, 'palletQueue', {running: true, delivery: 'manual', palletCount: 1, columns: 2, rows: 2, layers: 2, capacity: 8, width: 1.2, depth: .8});
  configure(f.head, 'robot', {reach: 2.5, baseHeight: .75, powered: false, running: false, speed: 2, cycleTime: 1,
    sourceId: source.userData.editorId, outputId: sink.userData.editorId});
  f.document.setTransform(source, {position: [1.1, 1, 1.2]}); f.document.setTransform(sink, {position: [1.1, 1, -1.2]});
  f.document.setTransform(f.head, {position: [0, 0, 0]});
  const RobotRuntime = require('../support/load-robot-runtime.js')(THREE, robotPrefabs); f.runtime.robotRuntime = new RobotRuntime(f.runtime);
  f.session = {visibilityState: 'visible'}; f.ctx.renderer.xr.getSession = () => f.session;
  f.left.position.set(10, 4, 10); f.right.position.set(11, 4, 10); f.scene.updateMatrixWorld(true);
  const authored = await f.document.serialize(); f.runtime.start('hall'); f.visuals.invalidate(); advance(f);
  const robot = () => f.runtime.records.get(f.head.userData.editorId).components.robot;
  const input = () => f.runtime.records.get(source.userData.editorId).components.source;
  const output = () => f.runtime.records.get(sink.userData.editorId).components.palletQueue;
  assert.equal(f.ctx.raycontrol.controllers.length, 2);
  assert.equal(f.document.getObjects('hall').filter(object => object.userData.industrialAction && f.document.getBehaviors(object).some(config => config.type === 'control' && config.targetId === f.head.userData.editorId)).length, 9);
  press(f, 'powerOn', f.left); assert(vars(f).powered);
  press(f, 'start', f.right); assert(vars(f).running);
  until(f, () => !!robot().entry);
  const carried = robot().entry, originalMesh = carried.product.object;
  assert.equal(carried.ownerId, f.head.userData.editorId); assert.equal(carried.product.robotOwnerId, f.head.userData.editorId);
  assert(originalMesh.parent === robot().visualRoot.userData.robotRig.tool, 'The real robot tool owns the physical carton mesh.');
  aim(f, f.left, carried.product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(originalMesh.matrixWorld));
  select(f, f.left, 'selectstart'); select(f, f.left, 'selectend'); advance(f);
  assert.equal(carried.product.heldBy, null, 'Real XR trigger cannot steal a carton from a closed robot gripper.'); away(f, f.left);

  // Close-contact actuation uses the same owned HMI cap and command as rays.
  const pause = button(f, 'pause'), resting = pause.cap.position.z;
  touch(f, f.left, pause, .18); advance(f, .3); const sequence = f.runtime.getControlFeedback(pause.id).sequence;
  touch(f, f.left, pause); advance(f, .12);
  assert(vars(f).paused); assert.equal(f.runtime.getControlFeedback(pause.id).sequence, sequence + 1);
  assert(pause.cap.position.z < resting - .005); const phaseTime = robot().phaseElapsed;
  advance(f, .4); assert.equal(robot().phaseElapsed, phaseTime); assert.equal(robot().entry, carried);
  assert.equal(f.runtime.getControlFeedback(pause.id).sequence, sequence + 1, 'A resting controller never repeats Pause.');
  touch(f, f.left, pause, .18); advance(f, .3); close(pause.cap.position.z, resting, .0001); away(f, f.left);
  press(f, 'pause', f.right); assert(!vars(f).paused);
  press(f, 'emergency', f.left); assert(vars(f).emergency); assert(!vars(f).running);
  const emergencyCount = input().queue.length + output().queue.length + (robot().entry ? 1 : 0); assert.equal(emergencyCount, 3);
  const atEmergency = robot().phaseElapsed; advance(f, .3); assert.equal(robot().phaseElapsed, atEmergency);
  press(f, 'emergency', f.right); assert(!vars(f).emergency); assert(!vars(f).running, 'Rearm never restarts a robot.');
  press(f, 'start', f.left); assert(vars(f).running);
  until(f, () => robot().completed === 3);
  assert.equal(input().queue.length, 0); assert.equal(output().queue.length, 3); assert(output().queue.some(entry => entry.product.object === originalMesh));
  assert.equal(robot().receivedUnits, robot().deliveredUnits);
  assert(f.pulses.some(pulse => pulse.handedness === 'left') && f.pulses.some(pulse => pulse.handedness === 'right'));
  press(f, 'powerOff', f.right); assert(!vars(f).powered && !vars(f).running);
  f.visuals.dispose(); f.runtime.stop();
  assert.deepEqual(await f.document.serialize(), authored, 'Robot simulation restores all authored materials, transforms and controls.');
  assert.equal(f.runtime.products.size, 0); assert.equal(f.runtime.records.size, 0);
  assert(!Object.keys(f.ctx.raycontrol.states).some(id => id.startsWith(f.runtime.statePrefix)), 'No robot/product/controller runtime states survive exit.');
  console.log('Robot WebXR: actual bilateral rays, front-cap contact/haptics, physical press travel, held-box guards, pause/emergency/rearm, conservation and exact authored cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
