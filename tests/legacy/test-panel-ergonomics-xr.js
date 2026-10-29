const __layout = require("../../tooling/layout.cjs");
// Standing-height geometry plus the production index.js/RayControl WebXR
// event bridge. Canvas and headset hardware are the only adapted boundaries.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const text = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-panel-ergonomics-xr.js"), 'test-industrial-xr.js')), 'utf8');
const testStart = text.indexOf('async function run()');
assert(testStart > 0, 'The production controller test harness must be reusable.');
const harness = new Function('require', '__dirname', text.slice(0, testStart) +
  '\nreturn {setup,advance,select,vars,close};')(require, __dirname);
const {advance, select, vars, close} = harness;
const MAIN_ACTIONS = new Set(['start', 'stop', 'emergency']);
const TYPES = ['conveyor', 'plc', 'source', 'processor', 'palletQueue'];

function controls(f) {
  const values = [];
  f.head.traverse(object => {
    if (!object.userData.industrialAction) return;
    let cap, caption;
    object.traverse(child => {
      if (child.userData.industrialButton) cap = child;
      if (child.name === 'Rótulo del control') caption = child;
    });
    assert(cap && caption, 'Every mechanical control keeps its cap and visible caption.');
    values.push({object, cap, caption, action: object.userData.industrialAction});
  });
  return values;
}

function lookFrom(f, object, origin, point) {
  object.position.copy(origin);
  object.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(origin, point, new THREE.Vector3(0, 1, 0)));
  f.scene.updateMatrixWorld(true);
  advance(f);
}

function observer(f) {
  const values = controls(f), panel = values[0].object.parent;
  const center = panel.getWorldPosition(new THREE.Vector3());
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(panel.matrixWorld);
  const eye = center.clone().addScaledVector(normal, 0.9); eye.y = 1.6;
  const across = new THREE.Vector3(1, 0, 0).transformDirection(panel.matrixWorld);
  f.camera.position.copy(eye);
  f.camera.lookAt(center.clone().setY(1.5));
  return {panel, normal, eye, across};
}

function assertVisibleFromEye(f, object, eye, label) {
  const point = object.getWorldPosition(new THREE.Vector3());
  const ray = new THREE.Raycaster(eye, point.clone().sub(eye).normalize());
  const hits = ray.intersectObject(f.head, true).filter(hit => hit.object.visible);
  assert(hits.length && hits[0].object === object, label + ' must be visible from a standing eye, without the cabinet or another control covering it; first hit: ' + (hits[0] && hits[0].object.name));
}

function geometry(f, type, mode) {
  const observation = observer(f), values = controls(f);
  assert.equal(values.length, type === 'source' ? 6 : type === 'palletQueue' ? 4 : 9);
  values.forEach(current => {
    const point = current.cap.getWorldPosition(new THREE.Vector3());
    assert(point.y >= 1.10 && point.y <= 1.65,
      type + ' ' + mode + ' ' + current.action + ': standing button height must be 1.10–1.65 m, got ' + point.y);
    const horizontal = Math.hypot(point.x - observation.eye.x, point.z - observation.eye.z);
    const decline = Math.atan2(observation.eye.y - point.y, horizontal) * 180 / Math.PI;
    assert(decline <= 45, type + ' ' + current.action + ' must not require a steep downward gaze.');
    if (MAIN_ACTIONS.has(current.action)) assert(decline <= 30, 'Main machine controls must remain close to the standing sight line.');
    assertVisibleFromEye(f, current.caption, observation.eye, type + ' ' + current.action + ' caption');
    const captionWorld = new THREE.Box3().setFromObject(current.caption);
    assert(captionWorld.min.y >= 1.0, 'Captions remain readable above waist height.');
  });
  let displays = 0;
  f.head.traverse(object => {
    if (!object.userData.industrialDisplay) return;
    displays++;
    const box = new THREE.Box3().setFromObject(object);
    assert(box.min.y >= 1.45 && box.max.y <= 2.05, 'The complete HMI remains around eye height.');
    assertVisibleFromEye(f, object, observation.eye, type + ' HMI');
  });
  assert.equal(displays, 1);
  return observation;
}

function actualPress(f, current, hand, observation) {
  // Both hands stay at a natural standing height. Only the controller's aim
  // changes; moving the hand down to the button would conceal a bad layout.
  const origin = observation.eye.clone().addScaledVector(observation.normal, -0.15)
    .addScaledVector(observation.across, hand === f.left ? -0.18 : 0.18);
  origin.y = 1.25;
  lookFrom(f, hand, origin, current.cap.getWorldPosition(new THREE.Vector3()));
  const entry = f.ctx.raycontrol.controllers.find(value => value.controller === hand);
  assert(entry && f.ctx.raycontrol.selectionEntries(entry).some(value => value.state.colliderMesh === current.object),
    f.type + ' ' + current.action + ': a real standing-hand ray must reach the original control actor.');
  const id = current.object.userData.editorId;
  const sequence = f.runtime.getControlFeedback(id).sequence, rest = current.cap.position.z;
  select(f, hand, 'selectstart');
  assert(f.runtime.getControlFeedback(id).pressed, 'Trigger-down captures the physical control.');
  assert.equal(f.runtime.getControlFeedback(id).sequence, sequence + 1);
  advance(f, 0.08);
  assert(current.cap.position.z < rest - 0.005, 'The raised cap still visibly depresses into its housing.');
  select(f, hand, 'selectend'); advance(f, 0.3);
  assert.equal(f.runtime.getControlFeedback(id).pressed, false);
  close(current.cap.position.z, rest, 0.0001);
  close(hand.position.y, 1.25);
  close(f.camera.position.y, 1.6);
}

function legacyPosition(type, action) {
  const plc = {start: [-0.24, -0.17, 0.17], stop: [0, -0.17, 0.17], emergency: [0.24, -0.17, 0.17],
    pause: [-0.30, -0.39, 0.17], powerOff: [0, -0.39, 0.17], powerOn: [0.30, -0.39, 0.17],
    speedUp: [0.30, -0.61, 0.17], speedDown: [-0.30, -0.61, 0.17], insertBox: [0, -0.61, 0.17]};
  const source = {start: [-0.23, 0.06, 0.08], stop: [0, 0.06, 0.08], pause: [0.23, 0.06, 0.08],
    generate: [-0.23, -0.12, 0.08], dispatch: [0, -0.12, 0.08], clearQueue: [0.23, -0.12, 0.08]};
  const processor = {start: [-0.29, -0.08, 0.15], stop: [0, -0.08, 0.15], emergency: [0.29, -0.08, 0.15],
    pause: [-0.29, -0.30, 0.15], powerOff: [0, -0.30, 0.15], powerOn: [0.29, -0.30, 0.15],
    operator: [-0.29, -0.52, 0.15], dispatch: [0, -0.52, 0.15], resetEmergency: [0.29, -0.52, 0.15]};
  const pallet = {start: [-0.15, 0.055, 0.08], stop: [0.15, 0.055, 0.08],
    pause: [-0.15, -0.11, 0.08], dispatch: [0.15, -0.11, 0.08]};
  return (type === 'source' ? source : type === 'processor' ? processor : type === 'palletQueue' ? pallet : plc)[action];
}

async function setup(type, savedLegacy) {
  const f = harness.setup(); f.type = type;
  [f.head, f.tail, f.unrelated].concat(f.cartons).forEach(object => f.document.remove(object));
  f.head = f.document.addPrefab('hall', type);
  f.document.setTransform(f.head, {position: [0, type === 'plc' ? 1.28 : 1, 0], rotation: [0, savedLegacy ? -0.55 : 0.35, 0]});
  f.document.setBehaviors(f.head, f.document.getBehaviors(f.head).map(config => {
    if (config.type === 'source') return Object.assign({}, config, {autoGenerate: false, initialQuantity: 0});
    if (config.type === 'conveyor') return Object.assign({}, config, {withSensors: false, autoSpawn: false});
    return config;
  }));
  if (savedLegacy) {
    const data = await f.document.serialize(), record = data.rooms.hall.additions.find(item => item.id === f.head.userData.editorId);
    const entry = f.document.additions.get(record.id);
    entry.nodes.forEach((object, nodePath) => {
      const previous = legacyPosition(type, object.userData.industrialAction);
      if (previous) record.nodes[nodePath].position = previous;
    });
    await f.document.load(data);
    f.head = f.document.getObject(record.id);
  }
  f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate();
  return f;
}

async function verify(type, legacy) {
  const f = await setup(type, legacy), authored = JSON.stringify(await f.document.serialize());
  const observation = geometry(f, type, legacy ? 'migrated' : 'new');
  f.runtime.start('hall'); advance(f);
  const values = controls(f);
  for (const current of values) {
    actualPress(f, current, f.left, observation);
    actualPress(f, current, f.right, observation);
  }
  const push = (action, hand = f.right) => actualPress(f, values.find(value => value.action === action), hand, observation);
  if (type !== 'plc') {
    if (type === 'conveyor' || type === 'processor') {
      if (vars(f).emergency) push('emergency');
      push('powerOn', f.left); assert(vars(f).powered);
    }
    push('stop', f.left); assert.equal(vars(f).running, false);
    push('start'); assert.equal(vars(f).running, true);
    if (vars(f).paused) push('start');
    push('pause', f.left); assert.equal(vars(f).paused, true);
    push(type === 'source' ? 'pause' : 'start'); assert.equal(vars(f).paused, false, type + ' resumes through its physical controls.');
    if (type === 'conveyor' || type === 'processor') {
      push('powerOff', f.left); assert.equal(vars(f).powered, false); assert.equal(vars(f).running, false);
    }
  }
  assert(f.pulses.some(value => value.handedness === 'left') && f.pulses.some(value => value.handedness === 'right'));
  assert.deepEqual(f.native, {starts: 0, ends: 0, backgroundStarts: 0, backgroundEnds: 0}, 'Raised panels keep the native WebXR background actions isolated.');
  f.visuals.dispose(); f.runtime.stop();
  assert.equal(JSON.stringify(await f.document.serialize()), authored, 'Raised-panel play restores every authored control and property exactly.');
}

async function run() {
  for (const type of TYPES) { await verify(type, false); await verify(type, true); }
  console.log('Standing panels WebXR: new and migrated conveyor/PLC/Source/Processor/Pallet Queue heights, readable HMI and captions, bilateral real rays at fixed standing eye/hand heights, commands, cap presses and exact cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
