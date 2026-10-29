'use strict';
const assert = require('node:assert/strict');
const THREE = require('three');
const robots = require('../../modules/logistica-industrial/functions/robots/schema/robots.js');
const kinematics = require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js');
const {createRobot, updateRobotPose, getRobotToolTransform} = require('../support/load-robot-prefabs.js')(THREE);
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const same = (a, b) => near(a.distanceTo(b), 0);
const v = array => new THREE.Vector3().fromArray(array);
const endpoints = mesh => [-1, 1].map(side => new THREE.Vector3(0, side * mesh.geometry.parameters.height / 2, 0).applyMatrix4(mesh.matrixWorld));

function resources(root) {
  const geometries = new Set(); let triangles = 0, draws = 0;
  root.traverse(mesh => {
    if (!mesh.geometry) return;
    draws++; geometries.add(mesh.geometry);
    triangles += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1);
    for (const attribute of Object.values(mesh.geometry.attributes)) for (const value of attribute.array) assert.ok(Number.isFinite(value));
  });
  let bytes = 0;
  for (const geometry of geometries) {
    for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
    if (geometry.index) bytes += geometry.index.array.byteLength;
  }
  return {triangles, draws, bytes};
}

const maxima = {};
for (const detail of ['low', 'balanced', 'high']) {
  const maximum = maxima[detail] = {triangles: 0, draws: 0, bytes: 0};
  for (const variant of ['articulated-general', 'articulated-process', 'collaborative', 'palletizer', 'mobile-manipulator']) {
    const config = robots.normalize(Object.assign({}, robots.defaults(variant), {detail}));
    const robot = createRobot(config), rig = robot.userData.robotRig, d = kinematics.getDimensions(config);
    assert.equal(robot.userData.robotGeometryVersion, 2);
    assert.ok(rig.castingShells.length >= 6, `${variant}: the silhouette requires actual contoured housings`);
    const links = rig.castingShells.filter(mesh => /Brazo superior|Antebrazo/.test(mesh.name));
    assert.equal(links.length, 2);
    for (const shell of links) {
      const dimensions = shell.geometry.userData.robotCasting;
      assert.ok(dimensions && dimensions.proximal > dimensions.distal, 'The casting narrows towards its distal bearing.');
      assert.equal(dimensions.volumetric, true, 'The main arm must use a rounded volumetric section, not a beveled flat plate.');
      shell.geometry.computeBoundingBox(); const bounds = shell.geometry.boundingBox;
      assert.ok(bounds.min.x < -dimensions.proximal * .7 && bounds.max.x > dimensions.length + dimensions.distal * .7,
        'Both bearing centres are enclosed by curved ends, rather than a rectangular link ending before its joints.');
      const position = shell.geometry.attributes.position, normal = shell.geometry.attributes.normal;
      let proximalZ = 0, distalZ = 0, bevelNormals = 0;
      for (let index = 0; index < position.count; index++) {
        const x = position.getX(index), z = Math.abs(position.getZ(index));
        if (x < dimensions.length * .12) proximalZ = Math.max(proximalZ, z);
        if (x > dimensions.length * .88) distalZ = Math.max(distalZ, z);
        if (Math.abs(normal.getZ(index)) > .05 && Math.abs(normal.getZ(index)) < .98) bevelNormals++;
      }
      assert.ok(proximalZ > distalZ * 1.18, 'Depth tapers as well as the visible profile.');
      assert.ok(dimensions.bevel > 0 && bevelNormals > 8, 'The shell has real fillet/chamfer geometry.');
      assert.ok(shell.userData.industrialStickerAnchors.length > 0);
      const anchor = shell.userData.industrialStickerAnchors[0];
      const ray = new THREE.Raycaster(v(anchor.position).addScaledVector(v(anchor.normal), .02), v(anchor.normal).negate(), 0, .04);
      // Test in shell-local coordinates so this remains independent of home.
      const sample = new THREE.Mesh(shell.geometry, shell.material); sample.updateMatrixWorld(true);
      const hit = ray.intersectObject(sample)[0];
      assert.ok(hit, 'Safety/identity stickers project onto the real casing face.');
      assert.ok(hit.point.distanceTo(v(anchor.position)) < .004, 'A sticker anchor must not float away from its casing.');
      const crossSection = [0, dimensions.proximal * .45].map(y => new THREE.Raycaster(new THREE.Vector3(dimensions.length * .38, y, dimensions.depth * 2), new THREE.Vector3(0, 0, -1), 0, dimensions.depth * 4).intersectObject(sample)[0]);
      assert.ok(crossSection.every(Boolean));
      assert.ok(Math.abs(crossSection[0].point.z - crossSection[1].point.z) > dimensions.depth * .025,
        'The visible face must bulge across its height instead of remaining coplanar like an excavator plate.');
    }
    for (const joints of [[0, 1.4, -2.4, 0, -.5707963267948966, 0], [.8, .6, -1.3, .3, .7, -.2], [-1, 1.1, -.6, -.2, -.4, .5]]) {
      const pose = kinematics.forward(config, joints); updateRobotPose(robot, pose);
      const tool = getRobotToolTransform(robot);
      same(tool.position, v(pose.toolPosition)); near(Math.abs(tool.quaternion.dot(new THREE.Quaternion().fromArray(pose.quaternion))), 1);
      if (config.family === 'palletizer') for (const side of [0, 1]) {
        const mounts = rig.parallelMounts.slice(side * 3, side * 3 + 3);
        for (let index = 0; index < 3; index++) {
          const axle = endpoints(mounts[index].axle), bridge = endpoints(mounts[index].bridge), pin = mounts[index].pin.getWorldPosition(new THREE.Vector3());
          same(axle[0], v(pose.frames[index === 0 ? 1 : index === 1 ? 2 : 3].position));
          same(axle[1], bridge[0]); same(bridge[1], pin);
        }
        const first = endpoints(rig.parallelRods[side * 2]), second = endpoints(rig.parallelRods[side * 2 + 1]);
        same(first[0], mounts[0].pin.getWorldPosition(new THREE.Vector3()));
        same(first[1], mounts[1].pin.getWorldPosition(new THREE.Vector3()));
        same(second[0], first[1]); same(second[1], mounts[2].pin.getWorldPosition(new THREE.Vector3()));
        near(first[0].distanceTo(first[1]), d.upperArm); near(second[0].distanceTo(second[1]), d.forearm);
      }
    }
    const measured = resources(robot); assert.ok(measured.triangles < 18000, `${variant}/${detail}: ${measured.triangles}`);
    for (const key of Object.keys(maximum)) maximum[key] = Math.max(maximum[key], measured[key]);
  }
}
const sharp = createRobot(Object.assign({}, robots.defaults('articulated-general'), {filletRadius: 0}));
const rounded = createRobot(Object.assign({}, robots.defaults('articulated-general'), {filletRadius: .06}));
const arm = robot => robot.userData.robotRig.castingShells.find(mesh => /Brazo superior/.test(mesh.name));
assert.notEqual(arm(sharp).geometry.userData.robotCasting.exponent, arm(rounded).geometry.userData.robotCasting.exponent);
assert.ok(arm(sharp).geometry.attributes.position.array.some((value, index) => Math.abs(value - arm(rounded).geometry.attributes.position.array[index]) > .001),
  'Changing the casing radius edits the actual rounded section, not just its inspector metadata.');
console.log('Industrial robot design: curved tapered castings, real bevels, supported palletizer linkages, surface-mounted stickers and unchanged articulated TCP passed.');
console.log(JSON.stringify(maxima));
