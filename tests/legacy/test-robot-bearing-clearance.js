'use strict';
// Native manufactured geometry, real joint transforms and runtime self guards.
// No Anatomy proxies, replacement models or altered TCPs are involved.
const assert = require('node:assert/strict'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/functions/robots/schema/robots.js');
const kinematics = require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js');
const prefabs = require('../support/load-robot-prefabs.js')(THREE);
const Runtime = require('../support/load-robot-runtime.js')(THREE, prefabs);
const api = new Runtime({ctx: {}}), variants = ['articulated-general', 'articulated-process', 'collaborative', 'palletizer', 'mobile-manipulator'];
let checked = 0, maxTriangles = 0;
for (const variant of variants) for (const detail of ['low', 'balanced', 'high']) for (const filletRadius of [0, .025, .06]) {
  const config = schema.normalize(Object.assign({}, schema.defaults(variant), {detail, filletRadius}));
  const object = prefabs.createRobot(config), rig = object.userData.robotRig, component = {visualRoot: object, config}, record = {object, components: {robot: component}};
  assert.equal(object.userData.robotGeometryVersion, 3);
  assert.equal(rig.shoulderCheeks.length, 2);
  assert.equal(rig.design.manufacturerReplica, false, 'This is a generic teaching mechanism, never labelled as manufacturer CAD.');
  const upper = rig.castingShells.find(mesh => /Brazo superior/.test(mesh.name)); upper.geometry.computeBoundingBox();
  const maxZ = Math.max(Math.abs(upper.geometry.boundingBox.min.z), Math.abs(upper.geometry.boundingBox.max.z));
  assert(maxZ + .002 < rig.design.fixedCheekInnerZ, 'The entire tapered rotating shell fits between the real fixed yoke cheeks.');
  for (const cheek of rig.shoulderCheeks) {
    cheek.updateMatrix(); cheek.geometry.computeBoundingBox();
    const bounds = cheek.geometry.boundingBox.clone().applyMatrix4(cheek.matrix);
    assert(Math.min(Math.abs(bounds.min.z), Math.abs(bounds.max.z)) > maxZ + .002);
    assert(Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)) < rig.design.coverOuterZ - .001,
      'The bearing cover sits beyond both cheeks instead of cutting through their exposed faces.');
  }
  const ids = new Set(rig.components.map(part => part.id));
  for (const id of ['robot.base', 'robot.shoulder', 'robot.upper-arm', 'robot.elbow', 'robot.forearm', 'robot.tool']) assert(ids.has(id), variant + ': ' + id);
  let triangles = 0;
  object.traverse(mesh => {if (!mesh.geometry) return;triangles += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1);assert(mesh.userData.equipmentComponentId);});
  assert(triangles < 18000); maxTriangles = Math.max(maxTriangles, triangles);
  for (const values of [[0, 1.4, -2.4, 0, -.57, 0], [.8, .6, -1.3, .3, .7, -.2], [-1, 1.1, -.6, -.2, -.4, .5]]) {
    const pose = kinematics.forward(config, values); prefabs.updateRobotPose(object, pose);
    assert(api.selfClear(record), 'An ordinary manipulation pose must clear the central self-interference guards: ' + component.clearanceBody);
    const actual = prefabs.getRobotToolTransform(object);
    assert(actual.position.distanceTo(new THREE.Vector3().fromArray(pose.toolPosition)) < 1e-8);
    assert(Math.abs(actual.quaternion.dot(new THREE.Quaternion().fromArray(pose.quaternion))) > 1 - 1e-8);
  }
  prefabs.updateRobotPose(object, kinematics.forward(config, [0, -1.4, 0, 0, 0, 0]));
  assert.equal(api.selfClear(record), false, 'A downward link cannot pass through its pedestal core, even without an external collision world.');
  assert.match(component.clearanceBody, /base/);
  if (variant !== 'collaborative') {
    prefabs.updateRobotPose(object, kinematics.forward(config, [0, .8, -2.7, 0, -.57, 0]));
    assert.equal(api.selfClear(record), false, 'A folded pair of structural arm cores cannot pass through each other.');
    assert.match(component.clearanceBody, /brazo superior \/ antebrazo/);
  }
  assert.doesNotThrow(() => JSON.stringify(object.toJSON()), 'Semantic study identities do not serialize runtime parent references.');
  checked++;
}
// The same production collision world sees a real external obstacle entering
// the rigid arm core; neither a same-owner ignore nor product-only filtering
// may let that wall pass through the running mechanism.
const {cell} = require('./test-robot-grasp-clearance.js'), f = cell('vr-robot-dispatch');
const runtime = f.runtime.robotRuntime, rig = f.r.visualRoot.userData.robotRig, core = rig.selfCollisionCores.upper;
assert(runtime.structureClear(f.robot));
const obstacle = new THREE.Mesh(new THREE.BoxBufferGeometry(.04, .12, .12), new THREE.MeshBasicMaterial()); obstacle.name = 'Pared de comprobación';
const midpoint = core.object.localToWorld(new THREE.Vector3().fromArray(core.start).lerp(new THREE.Vector3().fromArray(core.end), .5));
const room = f.document.getRoot('hall'); room.updateWorldMatrix(true, false); obstacle.position.copy(room.worldToLocal(midpoint.clone())); room.add(obstacle); obstacle.updateMatrixWorld(true);
f.runtime.ctx.collisionWorld.invalidate(obstacle);
assert.equal(runtime.structureClear(f.robot), false, 'An external solid wall cannot occupy the central arm material.');
assert.equal(f.r.clearanceObstacle, obstacle.name);
obstacle.scale.set(100, 35, 35); obstacle.updateMatrixWorld(true); f.runtime.ctx.collisionWorld.invalidate(obstacle);
assert.equal(runtime.structureClear(f.robot), false, 'A closed obstacle containing the whole core also blocks, even when its boundary is far away.');
obstacle.scale.set(1, 1, 1);
obstacle.position.z += 4; obstacle.updateMatrixWorld(true); f.runtime.ctx.collisionWorld.invalidate(obstacle);
assert(runtime.structureClear(f.robot), 'Moving the real obstacle clear restores a valid approach without disabling collisions.');
f.runtime.stop();
console.log('Native robot bearings: ' + checked + ' profiles, separated fixed/moving yoke faces, semantic components, real TCP, bounded self guards and <18k triangles; max=' + maxTriangles + '.');
