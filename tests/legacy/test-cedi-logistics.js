const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), VehicleRuntime = require('../support/load-vehicle-runtime')(THREE), builders = require('../support/load-industrial-cedi')(THREE, schema);
const code = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-cedi-logistics.js"), 'test-conveyor-mechanisms.js')), 'utf8');
const h = new Function('require', '__dirname', code.slice(0, code.indexOf('async function run()')) + '\nreturn {setup};')(require, __dirname);
function fixture(scene = 'isolated') {
  const f = h.setup(), built = scene === 'isolated' ? builders.retrofitCediRobotics(f.document, 'hall', {allowExpansion: true}) : scene === 'lab' ? builders.buildIndustrialLab(f.document, 'hall', {scene: f.scene, robotized: true, continuous: false}).robotics : builders.buildIndustrialCediLevel(f.document, 'hall', {kind: scene, scene: f.scene, robotized: true, continuous: false}).robotics, l = built.logistics;
  // Keep the complete authored architecture and equipment collision geometry;
  // unrelated feeds stay empty while the operator exercises this pallet bay.
  f.document.getObjects('hall').filter(object => object !== l.source).forEach(object => {const values = f.document.getBehaviors(object); if (values.some(c => c.type === 'source')) f.document.setBehaviors(object, values.map(c => c.type === 'source' ? {...c, autoGenerate: false, initialCount: 0} : c));});
  f.document.setBehaviors(l.source, f.document.getBehaviors(l.source).map(c => c.type === 'source' ? {...c, autoGenerate: false, totalLimit: 1} : c));
  f.runtime.vehicleRuntime = new VehicleRuntime(f.runtime); f.scene.updateMatrixWorld(true); f.runtime.start('hall');
  f.logistics = l; f.record = f.runtime.records.get(l.vehicle.userData.editorId); f.v = f.record.components.vehicle; f.api = f.runtime.vehicleRuntime;
  f.pickup = f.runtime.records.get(l.pickup.userData.editorId); f.stock = f.runtime.records.get(l.destination.userData.editorId);
  if (process.env.CEDI_DIAGNOSTICS) {const world = f.ctx.collisionWorld, sweep = world.sweepBox.bind(world), test = world.testBox.bind(world); let reported = false; const diagnostic = (box, options) => {const hits = new Set(); world.triangles(box, options, (triangle, object) => {if (box.intersectsTriangle(triangle)) hits.add(object.name); return false;}); return {box: [box.min.toArray(), box.max.toArray()], meshes: [...hits], extraBoxes: (options.extraBoxes || []).filter(b => box.intersectsBox(b)).map(b => [b.min.toArray(), b.max.toArray()])};}; world.testBox = (box, options) => {const result = test(box, options); if (result && !reported && f.v.entry) {reported = true; console.log('TESTBOX ' + JSON.stringify(diagnostic(box, options)));} return result;}; world.sweepBox = (box, motion, options) => {const result = sweep(box, motion, options); if (result.blocked && !reported && Math.hypot(motion.x, motion.z) > .0001) {reported = true; console.log('SWEEP ' + JSON.stringify(diagnostic(box.clone().union(box.clone().translate(motion)), options)));} return result;};}
  f.step = (seconds, input) => {for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {if (input) f.api.setInput(f.record, input); f.scene.updateMatrixWorld(true); f.runtime.execute(1 / 60);}};
  f.until = (condition, input, seconds = 30) => {for (let t = 0; t < seconds; t += 1 / 60) {if (condition()) return; f.step(1 / 60, input);} throw new Error('Logistics timeout: ' + JSON.stringify({state: f.api.getDockingState(f.record), position: f.record.object.position.toArray(), speed: f.v.actualSpeed, blocked: f.v.blocked}));};
  return f;
}
function run(scene = 'isolated') {
  const f = fixture(scene); f.until(() => f.pickup.components.conveyor.packages.length && f.pickup.components.conveyor.packages[0].offset >= 1.19, {brake: 1});
  f.until(() => !f.pickup.components.conveyor.running && f.pickup.components.conveyor.actualSpeed === 0, {brake: 1}); assert.equal(f.pickup.components.conveyor.actualSpeed, 0, 'The actual output interlock stops the chain motor before inserting tines.');
  const product = f.pickup.components.conveyor.packages[0].product, entry = product.sourceEntry, object = product.object, metadata = f.runtime.productMetadata(product), dock = f.api.pickupDock(f.record, {yaw: -Math.PI / 2, targetId: f.pickup.id}, product);
  assert(dock); assert.equal(metadata.units, 12); assert.equal(metadata.mass, 73); assert.equal(metadata.loadMode, 'pallet');
  assert(f.api.applyPose(f.record, {...f.v.pose, lift: dock.toolY - f.v.config.forkBaseHeight}, true), 'The empty forks can lift to the actual pallet openings without crossing the machine.');
  f.api.command(f.record, 'parkingBrake', false);
  f.until(() => f.record.object.position.x <= dock.position.x + .12, {throttle: .12}); f.until(() => Math.abs(f.v.actualSpeed) < .003, {brake: 1});
  const before = f.api.getDockingState(f.record); assert(before.ready, before.reason); assert(before.insertion.ratio >= .99); assert(f.api.pickup(f.record, product), f.v.warning);
  assert.equal(f.v.entry, entry); assert.equal(f.v.entry.product.object, object); assert.equal(f.pickup.components.conveyor.packages.length, 0); assert.equal(product.vehicleOwnerId, f.record.id); assert.equal(f.pickup.components.conveyor.exitUnits, 12);
  f.step(.5, {lift: 1, brake: 1}); const chainEnd = f.logistics.pickup.position.x + 1.5;
  f.until(() => product.item.box.min.x > chainEnd + .85, {throttle: -.2}); f.until(() => Math.abs(f.v.actualSpeed) < .003, {brake: 1});
  assert(!f.v.blocked, 'The loaded pallet withdraws past the real chain frame and sensors.'); assert.equal(f.runtime.productMetadata(product).mass, metadata.mass); assert.equal(f.runtime.productMetadata(product).units, metadata.units);
  assert.equal(f.v.entry.id, entry.id); assert.equal(f.v.entry.product.object, object);
  const yaw = () => {const forward = f.record.object.getWorldDirection(new THREE.Vector3()); return Math.atan2(forward.x, forward.z);}, difference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const stop = () => f.until(() => Math.abs(f.v.actualSpeed) < .003, {brake: 1});
  const quarterTurn = steer => {const initial = yaw(), rotationSign = -Math.sign(steer); f.step(2, {brake: 1, steer}); f.until(() => rotationSign * difference(yaw(), initial) >= Math.PI / 2 - .006, {throttle: .1, steer}, 40); f.until(() => Math.abs(f.v.actualSpeed) < .003, {brake: 1, steer}); f.step(2, {brake: 1}); assert(!f.v.blocked, 'The loaded truck turns in its real clear aisle.');};
  // Two opposite quarter turns and a short reverse alignment exercise the
  // actual rear-steered truck; no vehicle or product matrix is teleported.
  quarterTurn(-1);
  const radius = f.v.config.wheelbase / Math.tan(f.v.config.steerLimit), targetYaw = yaw() - Math.PI / 2, desiredZ = f.stock.object.position.z - radius * (Math.sin(yaw()) - Math.sin(targetYaw)) - f.v.config.wheelbase / 2 * (Math.cos(yaw()) - Math.cos(targetYaw));
  f.until(() => f.record.object.position.z >= desiredZ - .006, {throttle: .06}, 90); stop(); quarterTurn(1);
  const stockLayout = schema.palletQueues.layout(f.stock.components.palletQueue.config), bay = stockLayout.pallets[0], destination = f.stock.object.localToWorld(new THREE.Vector3(...bay.position)), offset = product.object.getWorldPosition(new THREE.Vector3()).sub(f.record.object.getWorldPosition(new THREE.Vector3())), targetX = destination.x - offset.x;
  assert(targetX > f.record.object.position.x, 'The final alignment is a clear reverse movement.'); f.until(() => f.record.object.position.x >= targetX - .006, {throttle: -.03}, 90); stop();
  f.until(() => f.api.releasePlan(f.record).ready, {brake: 1, lift: -1}, 12); const ready = f.api.getDockingState(f.record); assert(ready.ready, ready.reason); assert.equal(ready.targetId, f.stock.id);
  assert(f.api.release(f.record), f.v.warning); assert.equal(f.v.entry, null); assert.equal(f.stock.components.palletQueue.queue[0], entry); assert.equal(f.stock.components.palletQueue.receivedUnits, 12); assert.equal(entry.product.object, object); assert.equal(f.runtime.productMetadata(product).mass, metadata.mass);
  const beforeWithdrawal = f.record.object.position.x; f.until(() => f.record.object.position.x > beforeWithdrawal + 1.1, {throttle: -.12}); stop(); assert(!f.v.blocked, 'The real tines withdraw from the stored pallet without passing through its blocks.'); assert.equal(entry.ownerId, f.stock.id);
  f.runtime.stop(); console.log('CEDI logistics (' + scene + '):12u/73kg Source→chain interlocked stop→real tine pickup→loaded rear-steered aisle manoeuvre→floor stock→tine withdrawal, same mesh/entry and exact conservation with real collisions.');
}
module.exports = {fixture, run}; if (require.main === module) run(process.argv[2] || 'isolated');
