'use strict';
const assert = require('node:assert/strict');
const h = require('./test-robot-runtime.js');
const robots = require('../shared/robots.js');
const kinematics = require('../shared/robot-kinematics.js');
const {THREE} = h;
function restart(f) {
  f.scene.updateMatrixWorld(true); f.runtime.start('hall');
  f.r = f.runtime.records.get(f.robot.userData.editorId).components.robot;
  f.input = f.runtime.records.get(f.source.userData.editorId).components.source;
  f.result = f.runtime.records.get(f.output.userData.editorId).components.source;
}
function run() {
  for (const family of ['cylindrical', 'polar']) {
    const config = robots.defaults(family), limits = robots.getJointDefinitions(config);
    assert.deepEqual(limits.map(joint => joint.kind), family === 'cylindrical' ? ['revolute', 'prismatic', 'prismatic'] : ['revolute', 'revolute', 'prismatic']);
    for (const yaw of [-2, -.5, .8, 2.6]) for (const position of [.25, .7]) {
      const joints = [yaw, family === 'cylindrical' ? config.height * position : position, config.reach * .6];
      const pose = kinematics.forward(config, joints), inverse = kinematics.inverse(config, {position: pose.toolPosition, quaternion: pose.quaternion}, joints);
      assert.ok(inverse.reached); assert.ok(inverse.error < 1e-6);
    }
    const f = h.fixture(family, {speed: 3, cycleTime: .3}); h.until(f, () => f.r.completed === 3);
    assert.equal(f.result.queue.length, 3); assert.equal(h.sum(f), 3); assert.equal(f.r.fault, ''); f.runtime.stop();
  }

  const arm = h.fixture('mobile-manipulator', {speed: 3, cycleTime: .3});
  let lastPosition = arm.robot.position.clone(), lastJoints = arm.r.pose.joints.slice(), lastProductPosition = null, maximumJump = 0;
  const phases = new Set();
  for (let frame = 0; frame < 90 * 60 && arm.r.completed !== 3; frame++) {
    h.advance(arm, 1 / 60); phases.add(arm.r.phase);
    if (arm.robot.position.distanceTo(lastPosition) > 1e-6) arm.r.pose.joints.forEach((value, index) => assert.ok(Math.abs(value - lastJoints[index]) < 1e-6, 'The mobile arm remains stowed during chassis travel.'));
    if (arm.r.entry) {
      const position = arm.r.entry.product.object.getWorldPosition(new THREE.Vector3());
      if (lastProductPosition && lastProductPosition.id === arm.r.entry.id) maximumJump = Math.max(maximumJump, position.distanceTo(lastProductPosition.position));
      lastProductPosition = {id: arm.r.entry.id, position};
    } else lastProductPosition = null;
    lastPosition.copy(arm.robot.position); lastJoints = arm.r.pose.joints.slice();
  }
  assert.equal(arm.r.completed, 3); assert.ok(arm.r.distance > 1); assert.equal(h.sum(arm), 3);
  for (const phase of ['drive-input', 'approach', 'pick', 'stow-input', 'drive-output', 'place']) assert.ok(phases.has(phase), phase);
  assert.ok(maximumJump < .2, 'Held loads move continuously through arm and chassis phases: ' + maximumJump);
  assert.equal(arm.r.fault, ''); arm.runtime.stop();

  const sorted = h.fixture('mobile-sorter-crossbelt', {speed: 3, cycleTime: .3, dischargeTime: .3}); sorted.runtime.stop();
  const other = sorted.add('source', {initialCount: 0, autoGenerate: false, delivery: 'manual', running: true, capacity: 20}, [2.6, .65, 1.2]);
  const profiles = ['sku-a', 'sku-b', 'sku-c'].map((id, index) => ({id, name: id, type: 'box', width: .2 + index * .01, height: .25, depth: .25, color: '#b98d53', quality: 'good', defect: 'none', mass: 1, base: 'flat'}));
  Object.assign(sorted.configs.get(sorted.source)[0], {generationMode: 'sequence', catalog: JSON.stringify(profiles)});
  sorted.configs.get(sorted.robot)[0].destinationRulesJson = JSON.stringify([{field: 'sku', operator: 'eq', value: 'sku-b', outputId: other.userData.editorId}]);
  restart(sorted); h.until(sorted, () => sorted.r.completed === 3, 90);
  const alternative = sorted.runtime.records.get(other.userData.editorId).components.source;
  assert.deepEqual(sorted.result.queue.map(entry => entry.spec.id), ['sku-a', 'sku-c']); assert.deepEqual(alternative.queue.map(entry => entry.spec.id), ['sku-b']);
  assert.equal(sorted.input.queue.length + sorted.result.queue.length + alternative.queue.length, 3);
  assert.equal(sorted.r.fault, ''); sorted.runtime.stop();

  const tilt = h.fixture('mobile-sorter-tilttray', {speed: 3, cycleTime: .3, dischargeTime: .5}); tilt.runtime.stop(); tilt.output.position.y = .45; restart(tilt);
  let minimumAngle = 0;
  for (let frame = 0; frame < 90 * 60 && tilt.r.completed !== 3; frame++) { h.advance(tilt, 1 / 60); minimumAngle = Math.min(minimumAngle, tilt.r.pose.joints[1]); }
  assert.equal(tilt.r.completed, 3); assert.ok(minimumAngle < -.10, 'The actual tray inclines while the retained load moves to its lower receiver.'); assert.equal(h.sum(tilt), 3); tilt.runtime.stop();

  assert.throws(() => robots.normalize({destinationRulesJson: '[{"field":"sku","operator":"eq","value":"a","outputId":"__proto__"}]'}));
  assert.throws(() => robots.normalize({destinationRulesJson: '[{"field":"execute","operator":"eq","value":"a","outputId":"safe"}]'}));
  assert.throws(() => robots.normalize({family: 'mobileSorter', tool: 'gripper'}));
  console.log('Robot extensions: RPP/RRP axes and FK/IK, real three-load flow, dock/stow/drive mobile arm with continuous custody, SKU destinations and animated crossbelt/tilt-tray delivery passed.');
}
run();
