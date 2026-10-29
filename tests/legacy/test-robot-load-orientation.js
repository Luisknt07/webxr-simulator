const __layout = require("../../tooling/layout.cjs");
'use strict';
// Actual Source, articulated/SCARA tool, rotated receiver and CollisionWorld.
// A successful receiver call alone would miss a final-frame 90-degree snap.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), robots = require('../../modules/logistica-industrial/functions/robots/schema/robots'), kinematics = require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics');
const fixture = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-robot-load-orientation.js"), 'test-conveyor-mechanisms.js')), 'utf8');
const {setup, checkpoint} = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('async function run()')) + '\nreturn {setup,checkpoint};')(require, __dirname);
const angle = (a, b) => 2 * Math.acos(THREE.Math.clamp(Math.abs(a.dot(b)), 0, 1));
function fixtureCell(family = 'articulated', count = 3) {
  const f = setup(), add = (type, values, position, yaw = 0) => {
    const object = f.document.addPrefab('hall', type, type === 'robot' ? family === 'scara' ? 'scara' : 'articulated-general' : undefined);
    f.document.setBehaviors(object, f.document.getBehaviors(object).map(config => config.type === type ? {...config, withPanel: false, ...values} : config));
    f.document.setTransform(object, {position, rotation: [0, yaw, 0]}); return object;
  };
  f.source = add('source', {initialCount: count, autoGenerate: false, delivery: 'manual', width: .28, depth: .30, height: .25, mass: 2, capacity: 4, catalog: '[]'}, [.85, 1, .5]);
  f.stock = add('palletQueue', {running: true, palletCapacity: 1, capacity: 4, columns: 2, rows: 2, layers: 1, width: 1.2, depth: .8, autoRelease: false, delivery: 'manual'}, [.85, family === 'scara' ? 1.75 : 1, -.65], Math.PI / 2);
  if (family === 'scara') {
    const table = f.document.addPrimitive('hall', 'box', '#637079'); f.document.setTransform(table, {position: [.85, .375, -.65], scale: [1.4, .75, 1.1]}); f.document.setBehaviors(table, [schema.defaultBehavior('collision')]);
  }
  const config = {...robots.defaults(family), running: true, reach: family === 'scara' ? 1.8 : 2.2, baseHeight: family === 'scara' ? 1.8 : .65, cycleTime: .8, setupTime: 0, approachHeight: .18, speed: 1.2,
    sourceId: f.source.userData.editorId, outputId: f.stock.userData.editorId, tool: 'gripper'};
  if (family !== 'scara') {
    const home = kinematics.inverse(config, {x: .35, y: 1.3, z: 0}); assert(home.reached);
    config.jointLimitsJson = JSON.stringify(robots.getJointDefinitions(config).map((joint, index) => ({id: joint.id, min: joint.min, max: joint.max, home: home.joints[index]})));
  }
  f.robot = add('robot', config, [0, 0, 0]);
  f.document.setBehaviors(f.source, f.document.getBehaviors(f.source).map(value => value.type === 'source' ? {...value, outputId: f.robot.userData.editorId} : value));
  f.scene.updateMatrixWorld(true); f.runtime.start('hall'); refresh(f); return f;
}
function refresh(f) { f.record = f.runtime.records.get(f.robot.userData.editorId); f.r = f.record.components.robot; f.receiver = f.runtime.records.get(f.stock.userData.editorId).components.palletQueue; }
function tick(f) { f.scene.updateMatrixWorld(true); f.runtime.execute(1 / 60); assert.equal(f.r.fault, '', f.r.fault); }
function until(f, condition, seconds = 60) { for (let i = 0; i < seconds * 60; i++) { if (condition()) return; tick(f); } throw Error('Timeout: ' + JSON.stringify(f.runtime.robotRuntime.variables(f.record))); }
function state(f) {
  f.scene.updateMatrixWorld(true);
  return {time: f.runtime.time, phase: f.r.phase, elapsed: f.r.phaseElapsed, joints: f.r.pose.joints.slice(), grip: f.r.gripQuaternion && f.r.gripQuaternion.toArray(), span: f.r.gripSpan,
    entry: f.r.entry && f.r.entry.id, products: Array.from(f.runtime.products.values(), product => [product.sourceEntry.id, product.object.matrixWorld.toArray()]).sort()};
}
function numericEqual(actual, expected, label) {
  if (typeof actual === 'number') return assert(Math.abs(actual - expected) < 1e-8, label + ': ' + actual + ' != ' + expected);
  if (Array.isArray(actual)) { assert.equal(actual.length, expected.length, label); actual.forEach((value, index) => numericEqual(value, expected[index], label + '/' + index)); return; }
  if (actual && typeof actual === 'object') { assert.deepEqual(Object.keys(actual), Object.keys(expected), label); Object.keys(actual).forEach(key => numericEqual(actual[key], expected[key], label + '/' + key)); return; }
  assert.equal(actual, expected, label);
}
function rotationAndCustody(family = 'articulated') {
  const f = fixtureCell(family), api = f.runtime.robotRuntime, input = f.runtime.records.get(f.source.userData.editorId).components.source;
  const entries = input.queue.slice(), objects = new Map(), rotations = new Map(); let middle = 0, releases = 0;
  until(f, () => {
    if (f.r.entry) {
      const entry = f.r.entry, product = entry.product, rotation = product.object.getWorldQuaternion(new THREE.Quaternion());
      if (!objects.has(entry.id)) objects.set(entry.id, product.object); assert.equal(objects.get(entry.id), product.object);
      const previous = rotations.get(entry.id); if (previous) assert(angle(previous, rotation) < .04, 'A loaded step cannot hide a final-frame 90-degree rotation.'); rotations.set(entry.id, rotation.clone());
      if (angle(new THREE.Quaternion(), rotation) > .15 && angle(new THREE.Quaternion(), rotation) < 1.4) middle++;
      const relative = api.tool(f.record).getWorldQuaternion(new THREE.Quaternion()).inverse().multiply(rotation); assert(angle(relative, f.r.gripQuaternion) < 1e-7, 'The load remains fixed to its actual tool grasp.');
      assert.equal(f.r.pose.gripSpan, f.r.gripSpan, 'Rotating the held carton cannot widen or close its gripping jaws.');
      if (f.r.phase === 'release') {
        const destination = api.destination(f.record, entry); assert(destination);
        const target = new THREE.Quaternion(); destination.matrix.decompose(new THREE.Vector3(), target, new THREE.Vector3()); assert(angle(rotation, target) < .02, 'The carton is already oriented at the receiver before committing custody.'); releases++;
      }
    }
    return f.r.completed === 3 && f.r.phase === 'idle';
  });
  assert(middle > 10 && releases === 3); assert.deepEqual(f.receiver.queue.map(entry => entry.id).sort(), entries.map(entry => entry.id).sort());
  entries.forEach(entry => { assert(f.receiver.queue.includes(entry)); assert.equal(entry.product.object, objects.get(entry.id)); assert.equal(entry.ownerId, f.stock.userData.editorId); assert.equal(f.runtime.productMetadata(entry.product).mass, 2); });
  assert.equal(f.r.receivedUnits, 3); assert.equal(f.r.deliveredUnits, 3); assert.equal(f.runtime.products.size, 3); f.runtime.stop();
}
function checkpointRotation(legacy = false) {
  const f = fixtureCell('articulated', 1);
  until(f, () => f.r.entry && (legacy ? f.r.phase === 'lift' && f.r.phaseElapsed > .05 : f.r.phase === 'carry' && angle(new THREE.Quaternion(), f.r.entry.product.object.getWorldQuaternion(new THREE.Quaternion())) > .25));
  if (legacy) { delete f.r.gripQuaternion; delete f.r.gripSpan; delete f.r.cartesianOrientations; }
  const saved = JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime))), before = state(f);
  for (let i = 0; i < 12; i++) tick(f); const uninterrupted = state(f);
  checkpoint.restoreSimulation(f.runtime, saved); refresh(f); numericEqual(state(f), before, 'Checkpoint restores loaded pose/grasp');
  for (let i = 0; i < 12; i++) tick(f); numericEqual(state(f), uninterrupted, 'Checkpoint continuation remains physically identical');
  until(f, () => f.r.completed === 1 && f.r.phase === 'idle'); assert.equal(f.receiver.queue.length, 1); f.runtime.stop();
}
function run() { rotationAndCustody(); rotationAndCustody('scara'); checkpointRotation(); checkpointRotation(true); console.log('Robot load orientation: articulated/SCARA real 90-degree pallet placement, gradual fixed grasp above neighbors, no release snap, same entries/meshes/units/mass, rotating checkpoint and old-checkpoint fallback passed.'); }
if (require.main === module) run(); module.exports = {fixtureCell, tick, until, run};
