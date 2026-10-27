'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors.js'), {validateDocument} = require('../server/validation.js');
const fixtureCode = fs.readFileSync(path.join(__dirname, 'test-conveyor-mechanisms.js'), 'utf8');
const harness = new Function('require', '__dirname', fixtureCode.slice(0, fixtureCode.indexOf('async function run()')) + '\nreturn {setup,advance};')(require, __dirname);
const builders = require('./load-industrial-cedi.js')(THREE, schema);
async function run() {
  for (const kind of ['sorting', 'packing']) {
    const f = harness.setup(), built = builders.buildIndustrialCediLevel(f.document, 'hall', {kind, scene: f.scene, continuous: false, robotized: true});
    assert(built.robotics.robots.length > 0, kind + ': existing production lines contain working process robots.');
    assert.equal(built.robotics.vehicles.length, 1); assert.equal(built.robotics.products.length, 2);
    const snapshot = JSON.parse(JSON.stringify(await f.document.serialize())); validateDocument(snapshot, value => value);
    const oldCount = f.document.getObjects('hall').length;
    const again = builders.retrofitCediRobotics(f.document, 'hall', {scene: f.scene, lines: built.lines});
    assert.equal(again.changed, false, 'Retrofitting twice does not duplicate equipment.'); assert.equal(f.document.getObjects('hall').length, oldCount);
    f.scene.updateMatrixWorld(true); f.runtime.start('hall');
    harness.advance(f, 35);
    for (const object of built.robotics.robots) {
      const record = f.runtime.records.get(object.userData.editorId), robot = record.components.robot;
      assert.equal(robot.fault, '', kind + ': ' + robot.fault); assert(robot.completed > 0, kind + ': robot operates on actual conveyor products.');
      assert.equal(robot.entry, null, 'Nozzles do not carry cartons.');
    }
    for (const object of built.robotics.products) {
      const product = f.runtime.products.get(object); assert(product, 'Pallets are actual grabbable production actors.');
      assert.equal(f.runtime.productMetadata(product).loadMode, 'pallet'); let pockets; product.object.traverse(node => { if (node.userData.forkPockets) pockets = node.userData.forkPockets; }); assert(pockets);
    }
    f.runtime.stop(); assert.deepEqual(JSON.parse(JSON.stringify(await f.document.serialize())), snapshot, 'Playback restores the complete authored CEDI.');
    console.log('CEDI ' + kind + ': idempotent robot/vehicle retrofit, valid save and actual in-situ conveyor processing passed.');
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
