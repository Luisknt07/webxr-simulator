const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors.js'), kinematics = require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js');
const {Runtime} = require('./test-robot-runtime.js');
const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-robot-study-scenes.js"), '../src/editor', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const robotPrefabs = require('../support/load-robot-prefabs.js')(THREE);
const factory = new Function('THREE', 'behaviorSchema', 'require', read('IndustrialPrefabs.js') + '\nreturn createIndustrialPrefab;')(THREE, schema, robotPrefabs.resolve);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', read('SceneDocument.js').replace('default class SceneDocument', 'return class SceneDocument'))(THREE, schema, factory);
const {getGeometryTree} = require('../support/load-geometry-acceleration.js')(THREE);
const collisionCode = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-robot-study-scenes.js"), '../src/lib/CollisionWorld.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class CollisionWorld', 'return class CollisionWorld');
const CollisionWorld = new Function('THREE', 'getGeometryTree', collisionCode)(THREE, getGeometryTree);
const study = require('../support/load-study-scenes.js')(THREE, schema, SceneDocument);
for (const id of ['robot-handling-line', 'robot-scara-sorting']) {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const built = study.buildStudyScene(document, 'hall', id, {scene, continuous: false});
  assert(built.environment && built.floorPresentation && built.monitorLayout, 'A complete study includes the CEDI shell, floor and suspended HMI.');
  assert.equal(built.monitorLayout.warnings.length, 0, 'The robot is a valid target for its suspended monitor.');
  assert.equal(built.lines.length, 1); const line = built.lines[0];
  const ctx = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {}}};
  ctx.collisionWorld = new CollisionWorld(ctx, document);
  const runtime = new Runtime(ctx, document); scene.updateMatrixWorld(true); runtime.start('hall');
  for (let frame = 0; frame < 60 * 60; frame++) { scene.updateMatrixWorld(true); runtime.execute(1 / 60); }
  const robot = runtime.records.get(line.controller.userData.editorId).components.robot;
  const counts = line.receivers.map(object => runtime.records.get(object.userData.editorId).components.palletQueue.receivedUnits);
  assert.equal(robot.fault, '', id + ': no robot interlock: ' + robot.fault);
  assert.equal(robot.completed, 6, id + ': every generated load traverses the robot. ' + JSON.stringify(runtime.records.get(line.controller.userData.editorId).variables));
  assert.deepEqual(counts, line.expectedReceiverUnits, id + ': products follow the configured classification.');
  assert.equal(runtime.products.size, 6, id + ': no duplicate or missing products.');
  assert(robot.busySeconds > 0); assert.equal(robot.receivedUnits, robot.deliveredUnits);
  runtime.stop();
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).forEach(material => { materials.add(material); Object.values(material).forEach(value => { if (value && value.isTexture) textures.add(value); }); }); });
  textures.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); geometries.forEach(value => value.dispose());
  console.log(id + ': six source loads, robot, conveyor and stock verified for 60 simulated seconds.');
}
