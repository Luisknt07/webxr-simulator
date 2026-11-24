'use strict';
// Load the shipped scene, not a substitute rack. Precision fixture poses
// exercise all authored heights against real prefabs, pockets and collisions.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'test-conveyor-mechanisms.js'), 'utf8');
const {THREE, setup} = new Function('require', '__dirname', source.slice(0, source.indexOf('async function run()')) + '\nreturn {THREE,setup};')(require, __dirname);
const VehicleRuntime = require('../support/load-vehicle-runtime')(THREE);
const seedStock = require('../../projects/smarttwin/PublicDemoStock.cjs');
const schema = require('../../modules/logistica-industrial/contracts/behaviors');

async function run() {
  const project = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../projects/smarttwin/scenes/vr-robot-dispatch.json'))).project;
  const f = setup(); await f.document.load(project.document);
  f.runtime.vehicleRuntime = new VehicleRuntime(f.runtime);
  f.scene.updateMatrixWorld(true); f.runtime.start('hall'); f.ctx.collisionWorld.setRoom('hall');
  assert.equal(seedStock(THREE, f.runtime), 4);
  const rows = [...f.runtime.records.values()], rack = rows.find(r => r.components.palletQueue?.rack), stock = rack.components.palletQueue;
  const truck = rows.find(r => r.components.vehicle), api = f.runtime.vehicleRuntime, v = truck.components.vehicle;
  assert.equal(stock.config.rackBays, 2); assert.equal(stock.config.rackLevels, 3); assert.equal(stock.rack.layout.cells.length, 12);
  assert.equal(stock.queue.length, 4); assert.equal(stock.config.capacity, 12);
  assert.equal(rack.id, 'custom-public-28'); assert(stock.queue.some(e => e.product.record.id === 'custom-public-29'));
  assert.equal(new Set(stock.rack.layout.cells.map(c => c.code)).size, 12);
  assert.equal(new Set(stock.queue.map(e => stock.rack.layout.cells[e.product.item.palletIndex].level)).size, 3);
  v.parkingBrake = false; v.actualSpeed = 0;
  for (const entry of stock.queue.slice()) {
    const product = entry.product, mesh = product.object, cell = stock.rack.layout.cells[product.item.palletIndex], code = cell.code;
    const dock = api.pickupDock(truck, {yaw:Math.PI, targetId:rack.id}, product); assert(dock, code);
    assert(dock.toolY - v.originWorld.y - v.config.forkBaseHeight < v.config.maxLift, 'The real truck must reach ' + code);
    // Lift in the aisle first: lifting through a beam while the forks are
    // already inserted below its support is correctly rejected.
    truck.object.position.copy(dock.position).add(new THREE.Vector3(0, 0, 1.1)); truck.object.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dock.yaw);
    truck.object.updateWorldMatrix(true, true);
    const liftPose = Object.assign({}, v.pose, {lift:dock.toolY-v.originWorld.y-v.config.forkBaseHeight});
    assert(api.applyPose(truck, liftPose, true), 'Mast/forks clear structure at ' + code);
    truck.object.position.copy(dock.position); truck.object.updateWorldMatrix(true, true);
    assert(api.mechanismClear(truck, null), 'The raised mast fits the actual docking opening at ' + code);
    f.scene.updateMatrixWorld(true);
    const plan = api.pickupPlan(truck); assert(plan.ready, code + ': ' + plan.reason); assert.equal(plan.candidate.product, product);
    assert(api.pickup(truck), code + ': ' + v.warning); assert.equal(v.entry, entry); assert.equal(product.object.parent, api.rig(truck).forks);
    const raised = Object.assign({}, v.pose, {lift:v.pose.lift+.08});
    assert(api.applyPose(truck, raised, true), 'Actual mast and carried load clear the upper tie at ' + code);
    assert(api.applyPose(truck, Object.assign({}, raised, {lift:raised.lift-.08}), true));
    f.scene.updateMatrixWorld(true);
    const drop = api.releasePlan(truck); assert(drop.ready, code + ': ' + drop.reason); assert.equal(drop.kind, 'stock');
    assert.equal(drop.targetId, rack.id); assert.equal(drop.placement.palletIndex, cell.index);
    assert(api.release(truck), code + ': ' + v.warning);
    assert.equal(stock.queue.find(e => e.id === entry.id), entry); assert.equal(product.object, mesh); assert.equal(entry.units, 4);
    assert.equal(f.runtime.productMetadata(product).mass, 33); assert.equal(product.object.userData.sourceRackLocationCode, code);
  }
  const more = schema.warehouseRacks.layout(Object.assign({}, stock.config, {rackLevels:4}));
  assert.equal(more.cells.length, 16); assert(more.cells.some(c => c.level===3 && c.y+1 > v.config.maxLift+v.config.forkBaseHeight));
  assert(more.bounds[4] > stock.rack.layout.bounds[4], 'More levels extend the actual framing; the old cap is not a storage position.');
  assert.equal(stock.queue.length, 4); f.runtime.stop();
  console.log('Public double rack: 12 real positions, 4 original-custody pallets across 3 levels; real mast/pocket pickup, lift and return in both bays, codes/units/mass preserved. A fourth tier exceeds the current truck reach.');
}
if (require.main === module) run().catch(error => {console.error(error); process.exitCode=1;});
module.exports = {run};
