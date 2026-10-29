'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors.js'), {validateDocument} = require('../server/validation.js');
const fixtureCode = fs.readFileSync(path.join(__dirname, 'test-conveyor-mechanisms.js'), 'utf8');
const harness = new Function('require', '__dirname', fixtureCode.slice(0, fixtureCode.indexOf('async function run()')) + '\nreturn {setup,advance};')(require, __dirname);
const builders = require('./load-industrial-cedi.js')(THREE, schema);
const VehicleRuntime = require('./load-vehicle-runtime.js')(THREE);
async function run() {
  const selected = process.argv.slice(2).filter(value => ['sorting', 'packing', 'lab'].includes(value));
  const continuous = process.argv.includes('--continuous-layout');
  for (const kind of selected.length ? selected : ['sorting', 'packing', 'lab']) {
    const f = harness.setup(), built = kind === 'lab' ? builders.buildIndustrialLab(f.document, 'hall', {scene: f.scene, continuous, robotized: true}) : builders.buildIndustrialCediLevel(f.document, 'hall', {kind, scene: f.scene, continuous, robotized: true}), lines = built.lines || built.cells;
    assert.deepEqual(built.robotics.cells.map(cell => cell.role), ['loading', 'transfer', 'unloading'], kind + ': the existing layout has all three real custody operations.');
    assert.equal(built.robotics.vehicles.length, 1); assert.equal(built.robotics.products.length, 0, 'Pallets come from a real production Source, not decorative copies.');
    assert(lines.some(line => line.id === 'robotics-expedition' && line.controller === built.robotics.logistics.pickup));
    for (const object of f.document.getObjects('hall')) {
      const values = f.document.getBehaviors(object);
      if (values.some(c => c.type === 'source' && c.autoGenerate)) f.document.setBehaviors(object, values.map(c => c.type === 'source' ? {...c, totalLimit: c.loadMode === 'pallet' ? 1 : 4, interval: 3, capacity: 4} : c));
    }
    const snapshot = JSON.parse(JSON.stringify(await f.document.serialize())); validateDocument(snapshot, value => value);
    const oldCount = f.document.getObjects('hall').length;
    const again = builders.retrofitCediRobotics(f.document, 'hall', {scene: f.scene, lines});
    assert.equal(again.changed, false, 'Retrofitting twice does not duplicate equipment.'); assert.equal(f.document.getObjects('hall').length, oldCount);
    const generated = new Map(), originalGenerate = f.runtime.sourceRuntime.generate.bind(f.runtime.sourceRuntime);
    f.runtime.sourceRuntime.generate = record => {const result = originalGenerate(record); if (result) {const entry = record.components.source.queue[record.components.source.queue.length - 1]; generated.set(entry.id, {units: entry.units, mass: schema.productSources.entryMass(entry)});} return result;};
    f.runtime.vehicleRuntime = new VehicleRuntime(f.runtime); f.scene.updateMatrixWorld(true); f.runtime.start('hall');
    const record = object => f.runtime.records.get(object.userData.editorId), startIds = new Map();
    built.robotics.cells.forEach(cell => {
      const source = record(cell.source), cfg = record(cell.robot).components.robot.config; assert.equal(cfg.sourceId, source.id); assert.equal(f.runtime.machineComponent(source).config.outputId, cell.robot.userData.editorId);
      const belt = source.components.conveyor ? cell.source : cell.target;
      const jaws = new THREE.Vector3(0, 0, 1).transformDirection(cell.robot.matrixWorld), flow = new THREE.Vector3(1, 0, 0).transformDirection(belt.matrixWorld);
      assert(Math.abs(jaws.dot(flow)) < 1e-7, 'The authored gripper closes across the conveyor rather than into the next retained carton.');
    });
    for (let frame = 0; frame < 100 * 30; frame++) {f.scene.updateMatrixWorld(true); f.runtime.execute(1 / 30);
      for (const cell of built.robotics.cells) {const r = record(cell.robot).components.robot; if (r.entry) {const entry = r.entry, previous = startIds.get(entry.id); if (previous) assert.equal(entry.product.object, previous, 'The same product mesh crosses each robotic custody boundary.'); else startIds.set(entry.id, entry.product.object); assert.equal(entry.product.robotOwnerId, record(cell.robot).id);}}
    }
    for (const object of built.robotics.robots) {
      const record = f.runtime.records.get(object.userData.editorId), robot = record.components.robot;
      assert.equal(robot.fault, '', kind + ': ' + robot.fault); assert(robot.completed > 0, kind + ': robot picks and deposits actual products. ' + JSON.stringify(f.runtime.robotRuntime.variables(record)));
      assert(robot.receivedUnits >= robot.deliveredUnits); assert.equal(robot.receivedUnits - robot.deliveredUnits, robot.entry ? robot.entry.units : 0);
    }
    const contents = [...f.runtime.records.values()].filter(r => f.runtime.machineComponent(r)).flatMap(r => f.runtime.productionContents(r));
    assert.equal(new Set(contents.map(row => row.id)).size, contents.length, 'Each active load has one machine owner.');
    const total = key => contents.reduce((sum, row) => sum + row[key], 0), expected = key => [...generated.values()].reduce((sum, row) => sum + row[key], 0);
    assert.equal(total('units'), expected('units'), kind + ': all generated units remain in the actual machines.'); assert(Math.abs(total('mass') - expected('mass')) < 1e-5, kind + ': payload and pallet tare are conserved.');
    const logistics = built.robotics.logistics, pickup = record(logistics.pickup).components.conveyor;
    assert.equal(pickup.packages.length, 1, 'A real full pallet waits on the chains for its manual operator.'); const product = pickup.packages[0].product;
    assert.equal(f.runtime.productMetadata(product).units, 12); assert.equal(f.runtime.productMetadata(product).loadMode, 'pallet'); assert(product.sourceEntry && product.sourceEntry.originId === logistics.source.userData.editorId);
    assert(f.runtime.vehicleRuntime.productPockets(product), 'The actual generated pallet has real entry pockets.');
    const completions = built.robotics.cells.map(cell => cell.role + '=' + record(cell.robot).components.robot.completed).join(', ');
    f.runtime.stop(); assert.deepEqual(JSON.parse(JSON.stringify(await f.document.serialize())), snapshot, 'Playback restores the complete authored CEDI.');
    console.log('CEDI ' + kind + (continuous ? ' · public continuous layout with bounded test batch' : '') + ': robot completions ' + completions + ';100s real collision-world flow, exact unit/mass custody, real pallet-chain expedition, idempotence and authored restoration passed.');
  }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {run, harness, builders, THREE, schema};
