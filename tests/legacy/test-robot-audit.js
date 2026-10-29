const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const h = require('./test-robot-runtime.js'), {THREE, robotSchema, robotKinematics} = h;
const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-robot-audit.js"), '..', 'src', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const visuals = new Function('THREE', 'behaviorSchema', read('editor/IndustrialPrefabs.js') + '\nreturn {createProductVisual,createSourceProductVisual};')(THREE, h.behaviorSchema);
const checkpoint = new Function('THREE', 'createProductVisual', 'createSourceProductVisual', read('studio/SimulationCheckpoint.js') + '\nreturn {captureSimulation,restoreSimulation};')(THREE, visuals.createProductVisual, visuals.createSourceProductVisual);
const record = f => f.runtime.records.get(f.robot.userData.editorId);
const clone = value => JSON.parse(JSON.stringify(value));

// A load may remain listed in its previous source during a vehicle's loading
// handoff. Its explicit custody must win over this transient queue membership.
const owned = h.fixture(); owned.input.queue[0].product.vehicleOwnerId = 'another-vehicle';
h.advance(owned, 2); assert.equal(owned.r.received, 0); assert.equal(owned.input.queue.length, 3);
delete owned.input.queue[0].product.vehicleOwnerId;
h.until(owned, () => owned.r.completed === 3); assert.equal(h.sum(owned), 3); owned.runtime.stop();
const vehicleReserved=h.fixture();vehicleReserved.input.queue[0].product.vehicleReservedBy='vehicle-on-pickup-mission';h.advance(vehicleReserved,2);assert.equal(vehicleReserved.r.received,0);assert.equal(vehicleReserved.input.queue.length,3);delete vehicleReserved.input.queue[0].product.vehicleReservedBy;h.until(vehicleReserved,()=>vehicleReserved.r.completed===3);assert.equal(h.sum(vehicleReserved),3);vehicleReserved.runtime.stop();

// Ownership can change after reservation but before the arm reaches the load.
const raced = h.fixture(); h.until(raced, () => !!raced.r.candidate);
const reserved = raced.r.candidate.product; reserved.vehicleOwnerId = 'another-vehicle';
const stock = raced.input.queue.slice(); assert.equal(raced.runtime.robotRuntime.pick(record(raced)), false);
assert.deepEqual(raced.input.queue, stock); assert.equal(raced.r.entry, null); raced.runtime.stop();

// Moving a source after approach must not teleport its carton into the gripper.
const shifted = h.fixture(); h.until(shifted, () => shifted.r.phase === 'pick');
const candidate = shifted.r.candidate.product; candidate.object.position.x += .4; shifted.scene.updateMatrixWorld(true);
const beforePick = candidate.object.matrixWorld.clone();
assert.equal(shifted.runtime.robotRuntime.pick(record(shifted)), false);
assert(candidate.object.matrixWorld.equals(beforePick)); assert.equal(shifted.input.queue.length, 3); shifted.runtime.stop();

// Changing a receiver during discharge either produces a continuous physical
// correction or blocks while retaining custody; neither case jumps to a queue.
for (const displacement of [.12, .35]) {
  const f = h.fixture('mobile-sorter-crossbelt', {speed: 3, dischargeTime: 1});
  h.until(f, () => f.r.phase === 'sorter-discharge' && f.r.phaseElapsed > .2, 40);
  const product = f.r.entry.product; f.output.position.x += displacement; f.scene.updateMatrixWorld(true);
  let previous = product.object.getWorldPosition(new THREE.Vector3()), maximumStep = 0;
  for (let i = 0; i < 600 && !f.r.completed && !f.r.fault; i++) {
    h.advance(f, 1 / 60); const next = product.object.getWorldPosition(new THREE.Vector3());
    maximumStep = Math.max(maximumStep, next.distanceTo(previous)); previous = next;
  }
  assert(maximumStep < .07, 'A receiver edit must not snap the carried load to its new placement.');
  if (displacement < .2) assert.equal(f.r.completed, 1);
  else { assert.equal(f.r.completed, 0); assert(f.r.entry); assert(f.r.fault.includes('alcance')); }
  assert.equal(h.sum(f), 3); f.runtime.stop();
}

// Collision chassis uses the authored world scale and starts at floor level.
const scaled = h.fixture('mobile-sorter-crossbelt'); const rr = record(scaled), robotRuntime = scaled.runtime.robotRuntime;
const first = robotRuntime.chassisBox(rr).getSize(new THREE.Vector3());
scaled.robot.scale.set(2, 2, 2); scaled.scene.updateMatrixWorld(true);
const second = robotRuntime.chassisBox(rr).getSize(new THREE.Vector3());
assert(second.distanceTo(first.multiplyScalar(2)) < 1e-9); assert.equal(robotRuntime.chassisBox(rr).min.y, 0); scaled.runtime.stop();

// A blocked docking turn rolls back both chassis and attached load transforms.
const turning = h.fixture('mobile-sorter-crossbelt', {speed: 3, dischargeTime: 1});
h.until(turning, () => turning.r.phase === 'sorter-discharge' && turning.r.phaseElapsed > .2, 40);
turning.output.position.z += .15; turning.scene.updateMatrixWorld(true);
const rotation = turning.robot.quaternion.clone(), loadMatrix = turning.r.entry.product.object.matrixWorld.clone();
turning.ctx.collisionWorld = {testBox: () => false, sweepBox: () => ({blocked: true})};
assert.equal(turning.runtime.robotRuntime.sorterDischarge(record(turning), .1), false);
assert(turning.robot.quaternion.equals(rotation)); assert(turning.r.entry.product.object.matrixWorld.equals(loadMatrix));
assert(turning.r.blocked); delete turning.ctx.collisionWorld; turning.runtime.stop();

// Mechanical state cannot silently clamp missing/out-of-range joints or accept
// a TCP that disagrees with them. Check every family, including zero-axis AMRs.
for (const variant of robotSchema.VARIANTS) {
  const config = robotSchema.defaults(variant.id), pose = robotKinematics.homePose(config);
  assert.doesNotThrow(() => robotKinematics.validatePose(config, pose));
  assert.throws(() => robotKinematics.validatePose(config, Object.assign({}, pose, {joints: pose.joints.concat([0])})), /ejes/);
  const moved = clone(pose); moved.tcp.x += .1; assert.throws(() => robotKinematics.validatePose(config, moved), /TCP/);
  const opened = Object.assign({}, pose, {open: 1.1}); assert.throws(() => robotKinematics.validatePose(config, opened), /apertura/);
}

function tamper(change, expected, candidatePhase = false) {
  const f = h.fixture();
  h.until(f, () => candidatePhase ? !!f.r.candidate : f.r.phase === 'carry' && f.r.phaseElapsed > .08);
  const state = clone(checkpoint.captureSimulation(f.runtime)), nodes = state.graph.nodes;
  const component = nodes.find(node => node.t === 'object' && node.v.pose && node.v.phase && node.v.config);
  const pose = nodes[component.v.pose.r];
  change(nodes, component, pose);
  assert.throws(() => checkpoint.restoreSimulation(f.runtime, state), expected);
  assert.equal(f.runtime.running, false, 'A corrupted checkpoint must leave no partially running simulation.');
}
tamper((nodes, component, pose) => nodes[pose.v.joints.r].v.pop(), /ejes/);
tamper((nodes, component, pose) => nodes[pose.v.joints.r].v[0] = 999, /ejes/);
tamper((nodes, component, pose) => nodes[pose.v.tcp.r].v.x += .25, /TCP/);
tamper((nodes, component, pose) => { pose.v.open = {n: 'nan'}; }, /apertura/);
tamper(nodes => {
  const product = nodes.find(node => node.t === 'object' && typeof node.v.robotOwnerId === 'string' && node.v.robotOwnerId); product.v.robotOwnerId = '';
}, /propiedad/);
tamper(nodes => {
  const product = nodes.find(node => node.t === 'object' && typeof node.v.robotReservedBy === 'string' && node.v.robotReservedBy); product.v.robotReservedBy = '';
}, /reserva/, true);

console.log('Robot adversarial audit: custody races, moving pickup/receiver, continuous sorter correction, scaled collision/turn rollback and malformed checkpoint rejection passed.');
