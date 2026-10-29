'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const schema = require('../shared/behaviors');
const fixtureCode = fs.readFileSync(path.join(__dirname, 'test-conveyor-mechanisms.js'), 'utf8');
const {setup, checkpoint} = new Function('require', '__dirname', fixtureCode.slice(0, fixtureCode.indexOf('async function run()')) + '\nreturn {setup,checkpoint};')(require, __dirname);
function cell(id, beforeStart) {
  const f = setup(), study = require('./load-study-scenes')(THREE, schema, f.document.constructor);
  if (id.startsWith('vr-')) study.studySceneBase(f.document, 'hall');
  f.built = study.buildStudyScene(f.document, 'hall', id, {scene: f.scene, preview: true, continuous: false});
  if (beforeStart) beforeStart(f);
  f.runtime.vehicleRuntime = new (require('./load-vehicle-runtime')(THREE))(f.runtime);
  f.scene.updateMatrixWorld(true); f.runtime.start('hall');
  f.robot = Array.from(f.runtime.records.values()).find(record => record.components.robot);
  f.r = f.robot.components.robot; return f;
}
function tick(f, delta = 1 / 60) { f.scene.updateMatrixWorld(true); f.runtime.execute(delta); }
function until(f, condition, seconds = 35, delta = 1 / 60) {
  for (let elapsed = 0; elapsed < seconds; elapsed += delta) { if (condition()) return; tick(f, delta); assert.equal(f.r.fault, '', f.r.fault); }
  throw Error('Timed out: ' + JSON.stringify(f.robot.variables));
}
function addObstacle(f, size = .025) {
  f.obstacle = f.document.addPrefab('hall', 'product');
  const config = f.document.getBehaviors(f.obstacle).find(value => value.type === 'product');
  const authoredSize = Math.max(.05, size);
  f.document.setBehaviors(f.obstacle, [Object.assign({}, config, {width: authoredSize, height: authoredSize, depth: authoredSize, mass: .1})]);
  f.obstacle.updateWorldMatrix(true, true);
  const visualSize = new THREE.Box3().setFromObject(f.obstacle).getSize(new THREE.Vector3());
  f.document.setTransform(f.obstacle, {position: [20, 2, 20], scale: [size / visualSize.x, size / visualSize.y, size / visualSize.z]});
}
function obstacleAt(f, point) {
  const product = f.runtime.products.get(f.obstacle), matrix = product.object.matrixWorld.clone(); matrix.setPosition(point);
  f.runtime.setProductMatrix(product, matrix); return product;
}
function canonical(f) {
  f.scene.updateMatrixWorld(true);
  return {time: f.runtime.time, phase: f.r.phase, elapsed: f.r.phaseElapsed, joints: f.r.pose.joints, span: f.r.lastGripSpan,
    completed: f.r.completed, entry: f.r.entry && f.r.entry.id, path: f.r.cartesianPath,
    products: Array.from(f.runtime.products.values(), product => [product.sourceEntry && product.sourceEntry.id || product.record.id, product.object.matrixWorld.toArray()]).sort()};
}
function constraints() {
  // Save in the middle of an actual loaded Cartesian route. Graph decoding
  // restores the seed, jaw span, path, tool parent and exact same entry IDs.
  const resume = cell('vr-robot-dispatch'); until(resume, () => resume.r.phase === 'carry' && resume.r.phaseElapsed > .1);
  const saved = JSON.parse(JSON.stringify(checkpoint.captureSimulation(resume.runtime))), before = canonical(resume);
  for (let i = 0; i < 12; i++) tick(resume); const expected = canonical(resume);
  checkpoint.restoreSimulation(resume.runtime, saved); resume.robot = resume.runtime.records.get(resume.robot.id); resume.r = resume.robot.components.robot;
  assert.deepEqual(canonical(resume), before, 'Mid-grasp checkpoint restores exact pose, span, cargo and path.');
  for (let i = 0; i < 12; i++) tick(resume);
  assert.deepEqual(canonical(resume), expected, 'Resumed loaded movement matches uninterrupted execution.'); resume.runtime.stop();

  const blocked = cell('vr-robot-dispatch', addObstacle); until(blocked, () => blocked.r.phase === 'carry' && blocked.r.phaseElapsed > .1);
  const api = blocked.runtime.robotRuntime, rig = blocked.r.visualRoot.userData.robotRig;
  const body = rig.collisionBodies.find(value => /Antebrazo.*carcasa/.test(value.object.name)); assert(body);
  blocked.scene.updateMatrixWorld(true);
  const obstacle = obstacleAt(blocked, body.bounds.getCenter(new THREE.Vector3()).applyMatrix4(body.object.matrixWorld));
  const pose = blocked.r.pose.joints.slice(), elapsed = blocked.r.phaseElapsed, entry = blocked.r.entry, matrix = entry.product.object.matrixWorld.toArray();
  assert.equal(api.armClear(blocked.robot, api.carriedMatrix(blocked.robot)), false, 'A tiny load completely contained inside the casting is an obstruction.');
  tick(blocked, .25);
  assert(blocked.r.blocked); assert.deepEqual(blocked.r.pose.joints, pose); assert.equal(blocked.r.phaseElapsed, elapsed);
  assert.equal(blocked.r.entry, entry); assert.deepEqual(entry.product.object.matrixWorld.toArray(), matrix, 'A refused motion rolls back tool and carried product together.');
  obstacleAt(blocked, new THREE.Vector3(20, 2, 20)); until(blocked, () => blocked.r.completed === 1 && blocked.r.phase === 'idle');
  assert.equal(blocked.r.blocked, false); assert.equal(blocked.r.entry, null); assert.equal(obstacle.object, blocked.obstacle); blocked.runtime.stop();

  const contact = cell('robot-handling-line', f => addObstacle(f, .003)), contactApi = contact.runtime.robotRuntime;
  const pad = contact.r.visualRoot.userData.robotRig.collisionBodies.find(value => value.role === 'contact' && value.object.userData.robotContactSurface === 'jaw'); assert(pad);
  contact.scene.updateMatrixWorld(true);
  const padPoint = pad.bounds.getCenter(new THREE.Vector3()); padPoint.z -= pad.object.parent.userData.robotFingerSign * .004;
  const neighbor = obstacleAt(contact, padPoint.applyMatrix4(pad.object.matrixWorld));
  assert.equal(contactApi.armClear(contact.robot), false, 'Contact pads are not exempt against an unrelated neighboring carton.');
  contact.r.candidate = {product: neighbor}; assert(contactApi.armClear(contact.robot), 'The intended pad contact may touch the selected load: ' + contact.r.clearanceBody); contact.r.candidate = null;
  obstacleAt(contact, new THREE.Vector3(20, 2, 20));
  const product = Array.from(contact.runtime.products.values()).find(value => value.sourceEntry);
  const top = new THREE.Vector3(product.bounds.getCenter(new THREE.Vector3()).x, product.bounds.max.y, product.bounds.getCenter(new THREE.Vector3()).z).applyMatrix4(product.object.matrixWorld);
  assert(Math.abs(top.distanceTo(contactApi.worldContact(product, null, contact.robot)) - .04) < 1e-7, 'Gripper pads straddle the upper sides by 40 mm without changing the TCP calibration.');
  contact.runtime.stop();

  const lowFps = cell('vr-robot-dispatch'); until(lowFps, () => lowFps.r.completed === 1 && lowFps.r.phase === 'idle', 35, .25);
  assert(lowFps.runtime.robotRuntime.armClear(lowFps.robot), 'Fixed substeps preserve safe return at four render frames per second.'); lowFps.runtime.stop();
  console.log('Constraints: contact depth, unrelated-pad obstruction, contained carton, exact rollback/retry, loaded checkpoint and low-frame-rate return passed.');
}
function run() {
  const ids = process.argv.slice(2);
  for (const id of ids.length ? ids : ['vr-robot-dispatch', 'vr-robot-transfer', 'vr-robot-turn', 'robot-handling-line', 'robot-scara-sorting']) {
    const f = cell(id); let returned = false, blocked = 0, previousPhase = '', returnStart = null;
    const entries = Array.from(f.runtime.sourceRuntime.entries);
    for (let frame = 0; frame < 60 * 45; frame++) {
      tick(f);
      if (f.r.phase === 'return' && previousPhase !== 'return') returnStart = {...f.r.pose.tcp};
      if (f.r.blocked && ++blocked === 4) throw Error(id + ' blocked: ' + JSON.stringify({phase: f.r.phase, fault: f.r.fault, body: f.r.clearanceBody, obstacle: f.r.clearanceObstacle, own: f.r.entry && f.r.entry.product.object.name, pose: f.r.pose}));
      if (!f.r.blocked) blocked = 0;
      assert.equal(f.r.fault, '', id + ': ' + f.r.fault);
      if (previousPhase === 'return' && f.r.phase === 'idle') { returned = true; break; }
      previousPhase = f.r.phase;
    }
    assert(returned, id + ': first real transfer must finish and return safely.');
    assert.equal(f.r.completed, 1); assert.equal(f.r.entry, null);
    assert(f.runtime.robotRuntime.armClear(f.robot), id + ': resting pose clears deposited cartons.');
    assert(entries.some(entry => entry.lineage.includes(f.robot.id)), 'The original source entry passes through the robot.');
    if (id.startsWith('vr-')) {
      assert(returnStart && f.r.cartesianPath.length >= 3, 'Return includes a vertical withdrawal before crossing the pallet.');
      const points = f.r.cartesianPath; assert.equal(points[0][0], points[1][0]); assert.equal(points[0][2], points[1][2]); assert(points[1][1] > points[0][1] + .1);
    }
    console.log(id + ': real load/contact, coherent custody and clear complete return passed.');
    if (!id.startsWith('vr-')) {
      until(f, () => f.r.completed === 6 && f.r.phase === 'idle', 65);
      assert.equal(f.r.receivedUnits, f.r.deliveredUnits);
      assert(f.runtime.robotRuntime.armClear(f.robot), 'Multi-cycle return clears all accumulated cartons.');
      console.log(id + ': all six mixed-size loads complete, retain valid jaw span and preserve units.');
    }
    f.runtime.stop();
  }
  if (!ids.length) constraints();
}
if (require.main === module) run();
module.exports = {cell, tick, checkpoint, constraints, THREE};
