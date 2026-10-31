'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors');
const trainingSchema = require('../../modules/logistica-industrial/functions/montacargas/schema/vehicle-training.js');
const {validateDocument} = require('../../apps/api/server/validation');
const fixtureSource = fs.readFileSync(path.resolve(__dirname, 'test-conveyor-mechanisms.js'), 'utf8');
const {setup} = new Function('require', '__dirname', fixtureSource.slice(0, fixtureSource.indexOf('async function run()')) + '\nreturn {setup};')(require, __dirname);
const load = file => fs.readFileSync(path.resolve(__dirname, '../../', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const {addWarehouseMissionExperience, inspectWarehouseMissionRoom} = new Function('THREE', 'schema', load('modules/logistica-industrial/scenarios/WarehouseMissionEnhancement.js') + '\nreturn {addWarehouseMissionExperience,inspectWarehouseMissionRoom};')(THREE, schema);
const Training = new Function('THREE', 'trainingSchema', load('modules/logistica-industrial/functions/montacargas/runtime/VehicleTrainingRuntime.js').replace('default class VehicleTrainingRuntime', 'return class VehicleTrainingRuntime'))(THREE, trainingSchema);
const VehicleRuntime = require('../support/load-vehicle-runtime')(THREE);
const component = (document, object, type) => document.getBehaviors(object).find(config => config.type === type);
const round = value => JSON.parse(JSON.stringify(value, (key, item) => typeof item === 'number' ? Number(item.toFixed(9)) : item));
function dispose(f) { f.runtime.stop(); const geometry = new Set(), material = new Set(); f.scene.traverse(object => { if (object.geometry) geometry.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).forEach(value => material.add(value)); }); geometry.forEach(value => value.dispose()); material.forEach(value => value.dispose()); }
async function run() {
  for (const initialStudio of [null, {}]) {
    const minimal = setup(); minimal.document.studio = initialStudio;
    const built = addWarehouseMissionExperience(minimal.document, 'hall');
    assert(built.changed && built.tasks.length === 3, 'A minimal room can add training before studio metadata exists.');
    assert.equal(minimal.document.studio.groups.length, 1); assert.equal(addWarehouseMissionExperience(minimal.document, 'hall').changed, false);
    validateDocument(await minimal.document.serialize(), () => { throw Error('No external assets'); }); dispose(minimal);
  }
  const f = setup(), d = f.document;
  const robot = d.addPrefab('hall', 'robot'), belt = d.addPrefab('hall', 'conveyor', 'pallet-chain'), originalPallet = d.addPrefab('hall', 'product', 'pallet-loaded'), manual = d.addPrefab('hall', 'vehicle', 'forklift-electric-3w');
  d.setTransform(robot, {position: [25, 0, 25]}); d.setTransform(belt, {position: [30, 1, 25]}); d.setTransform(originalPallet, {position: [34, 0, 25]}); d.setTransform(manual, {position: [30, 0, 30]});
  d.setBehaviors(manual, d.getBehaviors(manual).map(config => config.type === 'vehicle' ? Object.assign({}, config, {mode: 'manual', trainingTasksJson: '[]'}) : config));
  d.setStudio({scenes: [{id: 'hall', name: 'Sala existente'}], environments: [schema.studio.defaultEnvironment('hall')]});
  const before = await d.serialize(), nativeFloor = f.root.children[0], floorTransform = nativeFloor.position.toArray(), originalCount = d.getObjects('hall').length;
  const built = addWarehouseMissionExperience(d, 'hall');
  assert(built.changed && built.reusedVehicle); assert.equal(built.vehicle, manual); assert.equal(built.tasks.length, 3); assert(built.tasks.every(task => task.scoring && task.pickupRoute.length && task.route.length));
  assert.equal(component(d, built.rack, 'palletQueue').withPanel, false); assert.equal(built.layout.cells.length, 8); assert.equal(component(d, built.rack, 'palletQueue').rackBays, 2); assert.equal(component(d, built.rack, 'palletQueue').rackLevels, 2);
  assert.equal(d.getObjects('hall').filter(object => object.parent === f.root && component(d, object, 'vehicle')).length, 1, 'Reuse the existing manual forklift.');
  assert(d.getObjects('hall').length > originalCount); assert.deepEqual(nativeFloor.position.toArray(), floorTransform);
  const after = await d.serialize(); validateDocument(after, () => { throw Error('No external assets'); });
  for (const object of [robot, belt, originalPallet]) {
    const old = before.rooms.hall.additions.find(row => row.id === object.userData.editorId), current = after.rooms.hall.additions.find(row => row.id === object.userData.editorId);
    assert.deepEqual(current, old, 'Existing robot, conveyor and unrelated pallet retain exact serialized content.');
  }
  assert.deepEqual(after.studio.environments, before.studio.environments); assert.deepEqual(after.studio.scenes, before.studio.scenes);
  const history = d.undoStack.length, repeated = addWarehouseMissionExperience(d, 'hall'); assert.equal(repeated.changed, false); assert.deepEqual(await d.serialize(), after); assert.equal(d.undoStack.length, history);
  const restored = setup(); await restored.document.load(after); const reopened = addWarehouseMissionExperience(restored.document, 'hall'); assert.equal(reopened.changed, false); assert.deepEqual(round(await restored.document.serialize()), round(after));
  f.runtime.vehicleRuntime = new VehicleRuntime(f.runtime); f.runtime.vehicleTraining = new Training(f.runtime); f.scene.updateMatrixWorld(true); f.runtime.start('hall');
  const truck = f.runtime.records.get(built.vehicleId); assert.equal(f.runtime.vehicleTraining.guidance(truck).phase, 'pickup', f.runtime.vehicleTraining.guidance(truck).status);
  const first = f.runtime.vehicleTraining.guidance(truck); assert.equal(first.score, 0); assert.equal(first.scoreMax, 495); assert.equal(first.total, 3);
  for (const task of built.tasks) {
    const product = f.runtime.vehicleTraining.product(task.productId), store = f.runtime.records.get(task.sourceId).components.palletQueue, meta = f.runtime.productMetadata(product);
    assert.equal(product.sourceEntry.ownerId, task.sourceId); assert(store.queue.includes(product.sourceEntry)); assert.equal(meta.units, 4); assert.equal(meta.mass, 33);
    assert(f.runtime.vehicleRuntime.productPockets(product), 'Real standard Euro pallet has usable metal-tine openings.');
    if (task.sourceLocationCode) assert.equal(product.object.userData.sourceRackLocationCode, task.sourceLocationCode);
  }
  const occupied = f.runtime.palletQueueRuntime.locations(f.runtime.records.get(built.rack.userData.editorId)); assert.equal(occupied.filter(row => row.status === 'occupied').length, 2); assert.equal(occupied.find(row => row.code === built.destinationSlot.code).status, 'reserved');
  const blocked = setup(), original = await blocked.document.serialize(), obstacle = blocked.document.addPrimitive('hall', 'box', '#ffffff');
  blocked.document.setTransform(obstacle, {position: [0, 1, 0], scale: [18, 2, 14]}); const blockedBefore = await blocked.document.serialize();
  assert.throws(() => addWarehouseMissionExperience(blocked.document, 'hall', {usableBounds: [-10, -7, 10, 9], layout: {center: [0, 0]}}), /obstáculos/); assert.deepEqual(await blocked.document.serialize(), blockedBefore, 'A failed fit never changes the room.');
  assert(inspectWarehouseMissionRoom(d, 'hall').floors.length); assert(original.rooms.hall); dispose(f); dispose(restored); dispose(blocked);
  console.log('Additive warehouse missions: preserved room, exact 3-pallet custody, Euro fork openings, scoring bindings, one manual truck, collision-space guard and save/reopen idempotence passed.');
}
module.exports = {run}; if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
