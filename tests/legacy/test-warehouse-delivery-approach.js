'use strict';
const assert = require('node:assert/strict');
const {lessonFixture} = require('./test-warehouse-training-score.js');
const THREE = require('three');
const schema = require('../../modules/logistica-industrial/functions/montacargas/schema/vehicle-training.js');
const clone = value => JSON.parse(JSON.stringify(value));

function alternate() {
  const f = lessonFixture(2), v = f.record.components.vehicle;
  const tasks = JSON.parse(v.config.trainingTasksJson); tasks[0].route = [{x: 7, z: 7}, {x: 7, z: 2}];
  v.config.trainingTasksJson = JSON.stringify(tasks);
  v.training = {index: 0, completed: [], scoring: schema.score.create(schema.parse(v.config.trainingTasksJson))};
  f.api.beginRoute(f.record, 'pickup'); f.pickup();
  return f;
}
const destination = f => ({kind: 'stock', targetId: f.task.destinationId, placement: {palletIndex: 0}, matrix: new THREE.Matrix4().makeTranslation(0, 0, 2)});

function run() {
  const f = alternate(), v = f.record.components.vehicle, a = f.api;
  f.drive(2); assert(v.distance > 1.9, 'The learner actually drove to the delivery area.');
  assert.equal(a.routeComplete(f.record), false); assert.equal(v.training.waypointIndex, 0);
  assert.deepEqual(v.training.routeCredits, []); assert.equal(v.training.scoring.score, 20);
  assert.equal(a.validateDrop(f.record, destination(f)), '', 'A continuous driven arrival must not be blocked by missed arrows.');
  assert(a.validateDrop(f.record, {...destination(f), targetId: 'wrong-store'}));
  assert(a.validateDrop(f.record, {...destination(f), placement: {palletIndex: 1}}), 'The exact assigned destination is still required.');
  const actualEntry = v.entry; v.entry = {product: {...f.product, id: 'another-pallet'}};
  assert(a.validateDrop(f.record, destination(f))); v.entry = actualEntry;

  let probes = 0, ready = false; a.destination = () => destination(f);
  a.runtime.vehicleRuntime.releasePlan = () => {probes++; return {ready};};
  a.runtime.time = 1; const before = clone(v.training);
  assert.equal(a.guidance(f.record).stage, 'align', 'A nearby alternative arrival gets alignment guidance rather than a stale transport gate.');
  assert.equal(a.guidance(f.record).dropRouteAdvisory, true);
  for (let i = 0; i < 100; i++) {a.guidance(f.record); a.variables(f.record);}
  assert.equal(probes, 1, 'Delivery readiness keeps the existing bounded read-only probe.');
  ready = true; a.runtime.time += .21; assert.equal(a.guidance(f.record).stage, 'drop');
  assert.deepEqual(v.training, before, 'Ready guidance does not credit untraveled points or mutate custody.');

  a.onDrop(f.record, f.product, destination(f)); assert.equal(v.training.phase, 'drop', 'A replay hook cannot replace a real custody transfer.');
  f.deposit(); assert.equal(v.training.phase, 'withdraw'); assert(a.validateState(f.record));
  a.step(1 / 60); assert.equal(v.training.completed.length, 0, 'A successful release still requires actual fork withdrawal.');
  v.training = clone(v.training); assert(a.validateState(f.record), 'Alternative-route withdrawal survives a plain JSON checkpoint.');
  f.drive(.3); assert.equal(v.training.index, 1); assert.equal(v.training.completed.length, 1);
  assert.equal(v.training.scoring.score, 145, 'Pickup, delivery and clean rewards are earned, but missed route arrows earn no points.');
  assert(!v.training.scoring.rewardKeys.includes('lesson-1:route')); assert.deepEqual(v.training.routeCredits, []); assert(a.validateState(f.record));
  const completed = clone(v.training); a.onDrop(f.record, f.product, destination(f)); assert.deepEqual(v.training, completed);
  v.training.routeCredits = ['lesson-1']; assert.equal(a.validateState(f.record), false, 'A forged route receipt cannot add an unearned score reward.');
  v.training = completed;

  for (const fullRoute of [false, true]) {
    const moved = fullRoute ? lessonFixture() : alternate(), truck = moved.record.components.vehicle;
    if (fullRoute) moved.pickup(); moved.drive(2);
    assert.equal(moved.api.routeComplete(moved.record), fullRoute);
    moved.record.object.position.x += 3; moved.root.updateMatrixWorld(true);
    const saved = clone(truck.training);
    assert.match(moved.api.validateDrop(moved.record, destination(moved)), /sin conducción/);
    assert.deepEqual(truck.training, saved, 'The fresh teleport refusal is read-only.');
    moved.api.step(1 / 60); assert(truck.training.routeFault);
    moved.api.step(1 / 60); assert(moved.api.validateDrop(moved.record, destination(moved)), 'Waiting after a teleport cannot enable delivery.');
    assert(moved.api.validateState(moved.record), 'A detected route fault remains a valid resumable checkpoint even after every route arrow was driven.');
  }

  const legacy = lessonFixture(); legacy.pickup(); legacy.deposit(); legacy.drive(.3); delete legacy.state().routeCredits;
  assert(legacy.api.validateState(legacy.record), 'Existing completed checkpoints retain their already-earned route award.');
  const shortTeleport = alternate(), shortV = shortTeleport.record.components.vehicle, validPose = shortTeleport.record.object.position.clone();
  shortTeleport.record.object.position.z += .5; shortTeleport.root.updateMatrixWorld(true); shortTeleport.api.step(1 / 60);
  assert(shortV.training.routeFault, 'A half-meter teleport inside the old 85 cm checkpoint radius is still rejected.');
  shortTeleport.api.step(1 / 60); assert(shortTeleport.api.validateDrop(shortTeleport.record, destination(shortTeleport)));
  shortTeleport.drive(validPose.z); assert.equal(shortV.training.routeFault, false, 'Driving back to the last observed valid position restores the lesson.');
  assert.equal(shortTeleport.api.validateDrop(shortTeleport.record, destination(shortTeleport)), '');
  console.log('Delivery approach: continuously driven alternative accepted, exact cargo/slot retained, no false waypoint or route credit, bounded ready guidance, actual custody/withdrawal, JSON/replay checks and pre/post-route teleport guards passed.');
}
module.exports = {run}; if (require.main === module) run();
