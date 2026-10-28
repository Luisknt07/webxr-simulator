'use strict';
const assert = require('node:assert/strict'), robots = require('../shared/robots'), kinematics = require('../shared/robot-kinematics');
const near = (a, b, label) => assert(Math.abs(a - b) < 1e-9, label + ': ' + a + ' / ' + b);
for (const id of ['articulated-general', 'articulated-process']) {
  const c = robots.defaults(id), d = kinematics.getDimensions(c), home = kinematics.homePose(c);
  assert.equal(c.reach, 1.4); assert.equal(c.payloadKg, 12); assert.equal(c.baseHeight, .45);
  assert.deepEqual([c.length, c.width, c.height], [.8, .8, 1.6]);
  near(d.upperArm + d.forearm, c.reach, 'The two physical links retain the saved reach contract');
  near(d.toolLength, .2, 'The existing tool offset remains additional to flange reach');
  assert(Math.hypot(home.tcp.x, home.tcp.z) <= .4 * c.reach, 'The wrist is folded near the base, not extended horizontally over a neighbouring conveyor.');
  assert(home.tcp.y > .25 && Math.max(...home.frames.map(frame => frame.position[1])) < 1.3, 'The compact home fits an ordinary cell instead of rising several metres.');
  const toolAxis = new (require('three').Vector3)(1, 0, 0).applyQuaternion(new (require('three').Quaternion)(...home.quaternion));
  near(toolAxis.y, -1, 'The folded tool points down');
  const extended = kinematics.forward(c, [0, 0, 0, 0, 0, 0]); near(extended.tcp.x, c.reach + .2, 'Full extension is not silently shortened');
  const solved = kinematics.inverse(c, home.tcp, home.joints, home.quaternion); assert(solved.reached && solved.error < .002, 'The folded home is a real IK pose.');
}
const collaborative = robots.defaults('collaborative'); assert.equal(collaborative.reach, 1.3); assert.equal(collaborative.payloadKg, 8); assert.equal(collaborative.baseHeight, .35);
assert.equal(robots.defaults('palletizer').reach, 2.6); assert.equal(robots.defaults('palletizer').payloadKg, 60); assert.equal(robots.defaults('amr').payloadKg, 250);
// A custom long arm is intentional authored content, not a request to replace
// it with the new compact insertion preset. Explicit old homes also survive.
const legacy = robots.normalize({variant: 'articulated-general', reach: 2.2, payloadKg: 20, baseHeight: .65, length: 2.8, width: 2.2, height: 1.4});
const joints = [0, .8, -1.45, 0, .65, 0]; legacy.jointLimitsJson = JSON.stringify(robots.getJointDefinitions(legacy).map((joint, index) => ({id: joint.id, min: joint.min, max: joint.max, home: joints[index]})));
const restored = robots.normalize(JSON.parse(JSON.stringify(legacy))); assert.deepEqual(restored, legacy); assert.deepEqual(kinematics.homePose(restored).joints, joints);
const golden = kinematics.forward(restored, [.4, .9, -1.2, .3, -.5, .8]);
[golden.tcp.x, golden.tcp.y, golden.tcp.z].forEach((value, index) => near(value, [1.7026584320109177, 1.09467671933787, -.7506369452865786][index], 'Legacy FK coordinate ' + index));
for (const reach of [.55, 3.2, 5.5, 10]) {const custom = robots.normalize({variant: 'articulated-general', reach, baseHeight: .85, payloadKg: 120}); assert.equal(custom.reach, reach); assert.equal(custom.baseHeight, .85); assert.equal(custom.payloadKg, 120); near(kinematics.getDimensions(custom).upperArm + kinematics.getDimensions(custom).forearm, reach, 'Custom physical link lengths');}
console.log('Robot dimensions: compact insertion defaults, folded downward home, true link/TCP reach, IK validity, heavy palletizer/mobile distinctions and lossless custom/legacy poses with unchanged FK passed.');
