'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const robots = require('../shared/robots.js');
const kinematics = require('../shared/robot-kinematics.js');
const source = fs.readFileSync(path.join(__dirname, '../src/editor/RobotPrefabs.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const {createRobot, refreshRobotGeometry, updateRobotPose, getRobotToolTransform} = new Function('THREE', 'robotSchema', 'kinematics', source + '\nreturn {createRobot, refreshRobotGeometry, updateRobotPose, getRobotToolTransform};')(THREE, robots, kinematics);
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
function triangles(root) {
  let count = 0;
  root.traverse(node => { if (node.geometry) count += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1); }); return count;
}
function resources(root) {
  const geometry = new Set(), material = new Set(), texture = new Set();
  root.traverse(node => { if (node.geometry) geometry.add(node.geometry); if (node.material) { material.add(node.material); if (node.material.map) texture.add(node.material.map); } }); return {geometry, material, texture};
}
let tested = 0;
for (const definition of robots.VARIANTS) {
  for (const detail of ['low', 'balanced', 'high']) {
    const config = Object.assign({}, definition.preset, {detail}), object = createRobot(config), rig = object.userData.robotRig;
    assert.equal(object.children[0], rig.visual); assert.equal(rig.joints.length, robots.getJointDefinitions(config).length);
    assert.ok(triangles(object) < 18000, `${definition.id}/${detail}: ${triangles(object)} triangles`);
    const bounds = new THREE.Box3().setFromObject(object);
    assert.ok(Number.isFinite(bounds.min.x) && bounds.max.y > .2, definition.id);
    assert.ok(bounds.min.y > -.08, `${definition.id}: below floor ${bounds.min.y}`);
    const home = kinematics.homePose(config), tool = getRobotToolTransform(object);
    near(tool.position.x, home.tcp.x); near(tool.position.y, home.tcp.y); near(tool.position.z, home.tcp.z);
    const q = new THREE.Quaternion().fromArray(home.quaternion); near(Math.abs(q.dot(tool.quaternion)), 1);
    const solved = kinematics.inverse(config, {position: home.toolPosition, quaternion: home.quaternion}, home.joints);
    assert.ok(solved.reached, `${definition.id} cannot return to home TCP`); near(solved.error, 0, .002);
    const alternate = robots.getJointDefinitions(config).map((joint, index) => joint.home + (index % 2 ? -.05 : .05));
    const moving = kinematics.forward(config, alternate); updateRobotPose(object, moving);
    const movedTool = getRobotToolTransform(object);
    near(movedTool.position.x, moving.tcp.x); near(movedTool.position.y, moving.tcp.y); near(movedTool.position.z, moving.tcp.z);
    near(Math.abs(movedTool.quaternion.dot(new THREE.Quaternion().fromArray(moving.quaternion))), 1);
    if (config.family === 'delta') for (const leg of moving.deltaElbows) {
      near(new THREE.Vector3().fromArray(leg.base).distanceTo(new THREE.Vector3().fromArray(leg.elbow)), kinematics.getDimensions(config).deltaUpper);
      const endpoint = moving.deltaPlatform.map((v, i) => v + leg.radial[i] * kinematics.getDimensions(config).deltaEffector);
      near(new THREE.Vector3().fromArray(endpoint).distanceTo(new THREE.Vector3().fromArray(leg.elbow)), kinematics.getDimensions(config).deltaLower);
    }
    if (config.tool === 'gripper') {
      updateRobotPose(object, Object.assign({}, moving, {open: 0, gripSpan: .46}));
      near(Math.abs(rig.fingers[0].position.z - rig.fingers[1].position.z) - .042, .46);
      assert.ok(rig.gripperRail.scale.z > .46, 'The sliding jaw rail supports the actual product span.');
    }
    const again = createRobot(config), first = resources(object), second = resources(again);
    for (const key of Object.keys(first)) for (const resource of first[key]) assert.equal(second[key].has(resource), false, `shared ${key} across independently disposable robots`);
    updateRobotPose(object, home); near(getRobotToolTransform(again).position.y, home.tcp.y);
    assert.doesNotThrow(() => JSON.stringify(object.toJSON()), 'Runtime joint/parent references must never leak into serialized userData');
    const panel = new THREE.Group(); object.add(panel);
    refreshRobotGeometry(object, Object.assign({}, config, {frameColor: '#992233'})); assert.equal(object.children[1], panel); assert.notEqual(object.children[0], rig.visual);
    tested++;
  }
}
// Full six-axis pose preservation, not just a target point: the spherical
// wrist must recover an arbitrary reachable nonplanar orientation.
const articulated = robots.defaults('articulated');
for (const jointValues of [[.7, .6, -1.4, .8, 1.1, -.4], [-1.2, 1.4, -.8, -.5, -1.2, 1.1], [0, .8, -1.45, .7, 0, .2]]) {
  const initial = kinematics.forward(articulated, jointValues), inverse = kinematics.inverse(articulated, {position: initial.toolPosition, quaternion: initial.quaternion}, initial.joints);
  assert.ok(inverse.reached); near(inverse.error, 0, .002);
  near(Math.abs(new THREE.Quaternion().fromArray(initial.quaternion).dot(new THREE.Quaternion().fromArray(inverse.quaternion))), 1, 1e-6);
}
let seed = 1687;
for (let index = 0; index < 64; index++) {
  const joints = robots.getJointDefinitions(articulated).map(limit => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return limit.min + (limit.max - limit.min) * (.02 + .96 * seed / 4294967296);
  });
  const pose = kinematics.forward(articulated, joints), unseeded = kinematics.inverse(articulated, {position: pose.toolPosition, quaternion: pose.quaternion});
  assert.ok(unseeded.reached, 'Global IK considers shoulder, elbow and wrist branches, even without a previous pose.');
}
assert.equal(kinematics.inverse(articulated, [100, 100, 100]).reached, false);
assert.equal(kinematics.inverse(robots.defaults('delta'), [12, 12, 12]).reached, false);
const limited = Object.assign({}, articulated, {jointLimitsJson: '[{"id":"J2","min":0.3,"max":0.7}]'});
near(kinematics.forward(limited, [0, 2, -1]).joints[1], .7);
for (const toolKind of ['fork', 'platform']) {
  const carrier = createRobot(Object.assign({}, robots.defaults('amr'), {tool: toolKind})), rig = carrier.userData.robotRig;
  const supports = rig.toolAssembly.children.filter(child => /Horquilla mecanizada|Cubierta antideslizante/.test(child.name));
  assert.ok(supports.length);
  for (const support of supports) {
    support.geometry.computeBoundingBox();
    const bounds = support.geometry.boundingBox.clone().applyMatrix4(support.matrix);
    assert.ok(bounds.min.x > -.001 && bounds.min.x < .005, 'The actual pallet support face stays below its TCP contact plane.');
    assert.ok(bounds.getSize(new THREE.Vector3()).y > .3, 'Forks run horizontally in a downward tool posture.');
  }
}
console.log(`Robot geometry: ${tested} variants/detail combinations; real joint/TCP transforms, IK orientation, Delta closures, unique GPU owners and <18k triangles passed.`);
