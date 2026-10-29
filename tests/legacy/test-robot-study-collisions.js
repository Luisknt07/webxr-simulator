const __layout = require("../../tooling/layout.cjs");
'use strict';
// Actual configured teaching cells, including their floor, source tables,
// conveyors and moving products, run against the production collision tree.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors.js');
const {Runtime} = require('./test-robot-runtime.js');
const {getGeometryTree} = require('../support/load-geometry-acceleration.js')(THREE);
const robotPrefabs = require('../support/load-robot-prefabs.js')(THREE);
const code = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-robot-study-collisions.js"), '..', file)), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const factory = new Function('THREE', 'behaviorSchema', 'require', code("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js") + '\nreturn createIndustrialPrefab;')
  (THREE, schema, robotPrefabs.resolve);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', code("packages/project-model/src/SceneDocument.js").replace('default class SceneDocument', 'return class SceneDocument'))(THREE, schema, factory);
const CollisionWorld = new Function('THREE', 'getGeometryTree', code("packages/render-three/src/CollisionWorld.js").replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const study = require('../support/load-study-scenes.js')(THREE, schema, SceneDocument);
async function run() {
  for (const id of ['robot-handling-line', 'robot-scara-sorting']) {
    const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
    const document = new SceneDocument({}); document.registerRoom('hall', root);
    const built = study.buildStudyScene(document, 'hall', id, {scene, preview: true, continuous: false}), line = built.lines[0];
    const ctx = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {}}};
    const world = ctx.collisionWorld = new CollisionWorld(ctx, document); world.setRoom('hall');
    assert.ok(world.entries.length > 10, 'Real environment/equipment meshes must participate in collision queries.');
    const authored = await document.serialize();
    const obstacles = new Set(), sweepBox = world.sweepBox.bind(world);
    world.sweepBox = (box, movement, options) => {
      const result = sweepBox(box, movement, options);
      if (result.blocked && obstacles.size < 8) {
        const broad = box.clone().union(box.clone().translate(movement));
        world.triangles(broad, options, (triangle, object) => {
          if (broad.intersectsTriangle(triangle)) obstacles.add(object.name + ' / ' + (object.parent && object.parent.name)); return false;
        });
      }
      return result;
    };
    const runtime = new Runtime(ctx, document); scene.updateMatrixWorld(true); runtime.start('hall');
    for (let frame = 0; frame < 60 * 60; frame++) {
      world.beginFrame(); try { scene.updateMatrixWorld(true); runtime.execute(1 / 60); } finally { world.endFrame(); }
    }
    const robot = runtime.records.get(line.controller.userData.editorId).components.robot;
    const counts = line.receivers.map(object => runtime.records.get(object.userData.editorId).components.palletQueue.receivedUnits);
    assert.equal(robot.fault, '', id + ': collision-enabled robot must not fault: ' + robot.fault);
    assert.equal(robot.completed, 6, id + ': collision-enabled products complete every transfer. Obstructions: ' + JSON.stringify(Array.from(obstacles)) + ' ' + JSON.stringify(runtime.records.get(line.controller.userData.editorId).variables));
    assert.deepEqual(counts, line.expectedReceiverUnits, id + ': physical flow preserves classification and stock.');
    assert.equal(runtime.products.size, 6, id + ': no missing or duplicated physical load.');
    assert.equal(robot.receivedUnits, robot.deliveredUnits);
    assert.equal(robot.blocked, false, id + ': own source/product/robot meshes do not produce a persistent false obstruction.');
    runtime.stop();
    assert.deepEqual(await document.serialize(), authored, 'Collision-checked playback preserves the complete authored project.');
    console.log(id + ': real CollisionWorld, source table, robot, conveyors and six products passed for 60 simulated seconds.');
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
