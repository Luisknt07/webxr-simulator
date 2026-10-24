'use strict';
const assert = require('node:assert/strict');
const h = require('./test-processor-runtime');
const {THREE, behaviorSchema, setup, add, record, inventory, vars, advance, close} = h;
function queue(f, object) { return record(f, object).components.palletQueue; }
function config(f, object) { return f.document.getBehaviors(object).find(value => ['source', 'processor', 'conveyor', 'palletQueue'].includes(value.type)); }
function addQueue(f, values = {}, position = [0, 1.02, 0]) {
  const object = f.document.addPrefab('hall', 'palletQueue');
  f.document.setBehaviors(object, [Object.assign({}, config(f, object), values)]); f.document.setTransform(object, {position}); return object;
}
function ports(value) { return value.type === 'palletQueue' ? behaviorSchema.conveyorLayout.palletQueueLayout(value) : h.ports(value); }
function connect(f, from, to) {
  const a = config(f, from), b = config(f, to);
  f.document.setBehaviors(from, [Object.assign({}, a, {outputId: to.userData.editorId, outputPort: 'input'}, a.type === 'conveyor' ? {} : {delivery: 'automatic'})]);
  f.scene.updateMatrixWorld(true);
  const output = ports(a).outlet || ports(a).output, input = ports(b).input;
  const destination = new THREE.Vector3(output.x, 0, output.z).applyMatrix4(from.matrixWorld).sub(new THREE.Vector3(input.x, 0, input.z));
  f.document.setTransform(to, {position: destination.toArray()});
}
function addHand(f, position = [0, 3, 5]) { const hand = new THREE.Group(); hand.position.fromArray(position); f.scene.add(hand); return hand; }
function noOverlaps(items) {
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) assert(!items[a].box.clone().expandByScalar(-.001).intersectsBox(items[b].box.clone().expandByScalar(-.001)), 'Stacked loads never overlap.');
}

async function run() {
  const f = setup(), source = add(f, 'source', {initialCount: 3, outputInterval: .1}), belt = add(f, 'conveyor'), pallet = addQueue(f, {width: .8, depth: .4, columns: 2, rows: 1, layers: 2, capacity: 4});
  connect(f, source, belt); connect(f, belt, pallet); const before = JSON.stringify(await f.document.serialize()); f.runtime.start('hall');
  const first = inventory(f, source).queue[0], original = first.product.object; advance(f, 3);
  assert.equal(vars(f, pallet).queued, 3); assert.equal(vars(f, pallet).received, 3); assert.equal(vars(f, pallet).receivedUnits, 3); close(vars(f, pallet).occupancy, 75);
  assert.equal(record(f, belt).components.conveyor.exitCount, 3); assert.equal(record(f, belt).components.conveyor.pallets.size, 0);
  assert(queue(f, pallet).queue.some(entry => entry.product.object === original), 'Flow keeps the same product, SKU and canonical source identity.');
  assert.equal(first.ownerId, pallet.userData.editorId); assert(first.product.item.palletOwnerId === pallet.userData.editorId); noOverlaps(queue(f, pallet).items);
  const bottom = queue(f, pallet).items.find(item => item.palletSlot === 0), top = queue(f, pallet).items.find(item => item.palletSlot === 2);
  assert(bottom && top); assert(top.box.min.y > bottom.box.max.y, 'The next layer uses the actual height of the supporting load.');
  const hand = addHand(f); f.ctx.vrMode = true;
  assert.equal(f.runtime.pickupProduct(bottom.product, hand), false, 'A lower load cannot be extracted through a load above it.');
  assert(f.runtime.pickupProduct(top.product, hand)); assert.equal(vars(f, pallet).delivered, 1); assert.equal(vars(f, pallet).queued, 2);
  assert.equal(f.runtime.pickupProduct(top.product, hand), false); assert.equal(vars(f, pallet).delivered, 1, 'A repeated grab never recounts a queue output.');
  f.runtime.stop(); assert.equal(JSON.stringify(await f.document.serialize()), before); assert.equal(Object.keys(f.ctx.raycontrol.states).length, 0);

  const manual = setup(), manualPallet = addQueue(manual, {columns: 1, rows: 1, layers: 1, capacity: 1}), authored = manual.document.addPrefab('hall', 'product');
  manual.document.setTransform(authored, {position: [0, 2, 4]}); const manualBefore = JSON.stringify(await manual.document.serialize()); manual.runtime.start('hall');
  const product = manual.runtime.products.get(authored), controller = addHand(manual); manual.ctx.vrMode = true;
  assert(manual.runtime.pickupProduct(product, controller));
  const target = manual.runtime.palletQueueRuntime.placement(record(manual, manualPallet), product); assert(target);
  manual.runtime.setProductMatrix(product, target.matrix); assert(manual.runtime.releaseProduct(product));
  assert.equal(vars(manual, manualPallet).queued, 1); assert.equal(vars(manual, manualPallet).full, true); assert.equal(product.item.palletOwnerId, manualPallet.userData.editorId);
  assert.equal(queue(manual, manualPallet).queue[0].product.object, authored);
  assert(manual.runtime.pickupProduct(product, controller)); assert.equal(vars(manual, manualPallet).delivered, 1); assert.equal(product.item.palletOwnerId, null);
  manual.runtime.stop(); assert.equal(JSON.stringify(await manual.document.serialize()), manualBefore, 'A manually stored authored asset returns to its exact document transform and parent.');

  const lifo = setup(), lifoSource = add(lifo, 'source', {initialCount: 3, outputInterval: .1}), lifoPallet = addQueue(lifo, {columns: 1, rows: 1, layers: 3, capacity: 3}), buffer = add(lifo, 'source', {capacity: 1});
  connect(lifo, lifoSource, lifoPallet); connect(lifo, lifoPallet, buffer);
  // Fill the store before explicitly dispatching its accessible upper load.
  lifo.document.setBehaviors(lifoPallet, [Object.assign({}, config(lifo, lifoPallet), {delivery: 'manual'})]); lifo.runtime.start('hall'); advance(lifo, 1);
  const upper = queue(lifo, lifoPallet).queue[0], upperMesh = upper.product.object;
  assert(lifo.runtime.command(lifoPallet.userData.editorId, 'dispatch')); assert.equal(vars(lifo, lifoPallet).delivered, 1); assert.equal(vars(lifo, lifoPallet).queued, 2);
  assert.equal(inventory(lifo, buffer).queue[0].id, upper.id); assert.equal(inventory(lifo, buffer).queue[0].product.object, upperMesh, 'Automatic removal selects an accessible top load and preserves the actual object.');
  assert.equal(lifo.runtime.command(lifoPallet.userData.editorId, 'dispatch'), false); assert.equal(vars(lifo, lifoPallet).delivered, 1); assert.equal(vars(lifo, lifoPallet).queued, 2);
  const bufferHand = addHand(lifo); assert(lifo.runtime.pickupProduct(inventory(lifo, buffer).queue[0].product, bufferHand)); advance(lifo, .1);
  assert(lifo.runtime.command(lifoPallet.userData.editorId, 'dispatch')); assert.equal(vars(lifo, lifoPallet).delivered, 2); lifo.runtime.stop();

  const full = setup(), fullSource = add(full, 'source', {initialCount: 3, outputInterval: .1}), fullBelt = add(full, 'conveyor'), small = addQueue(full, {columns: 1, rows: 1, layers: 1, capacity: 1});
  connect(full, fullSource, fullBelt); connect(full, fullBelt, small); full.runtime.start('hall'); advance(full, 3);
  assert.equal(vars(full, small).queued, 1); assert.equal(vars(full, small).full, true); assert.equal(record(full, fullBelt).components.conveyor.actualSpeed, 0);
  assert(record(full, fullBelt).components.conveyor.packages.length > 0, 'A full downstream pallet retains upstream loads instead of deleting them.');
  const fullHand = addHand(full); assert(full.runtime.pickupProduct(queue(full, small).queue[0].product, fullHand)); advance(full, .8);
  assert.equal(vars(full, small).received, 2); assert.equal(vars(full, small).queued, 1, 'Removing a top load frees capacity and resumes incoming transport.'); full.runtime.stop();

  const incompatible = setup(), wide = add(incompatible, 'source', {initialCount: 1, width: .6}), narrow = addQueue(incompatible);
  connect(incompatible, wide, narrow); incompatible.runtime.start('hall'); advance(incompatible, .5);
  assert.equal(vars(incompatible, narrow).queued, 0); assert.equal(vars(incompatible, wide).queued, 1); assert(vars(incompatible, wide).blocked, 'Loads must fit a pallet cell before entering its storage.'); incompatible.runtime.stop();

  const units = setup(), palletSource = add(units, 'source', {initialCount: 2, outputInterval: .1, loadMode: 'pallet', palletColumns: 2, palletRows: 2, palletLayers: 1}), carrier = addQueue(units, {columns: 1, rows: 1, layers: 2, capacity: 2});
  connect(units, palletSource, carrier); units.runtime.start('hall'); advance(units, 1);
  assert.equal(vars(units, carrier).queued, 2); assert.equal(vars(units, carrier).queuedUnits, 8); assert.equal(vars(units, carrier).receivedUnits, 8); assert.equal(units.runtime.products.size, 2, 'Complete pallet loads conserve their contained units without registering duplicate products.'); noOverlaps(queue(units, carrier).items); units.runtime.stop();

  const route = setup(), routeSource = add(route, 'source', {initialCount: 2, outputInterval: .1}), firstQueue = addQueue(route, {columns: 1, rows: 1, layers: 2, capacity: 2, outputInterval: .1}), machine = add(route, 'processor', {delivery: 'automatic', outputInterval: .1}), lastQueue = addQueue(route);
  connect(route, routeSource, firstQueue); connect(route, firstQueue, machine); connect(route, machine, lastQueue);
  route.runtime.start('hall'); advance(route, 2);
  assert.equal(vars(route, firstQueue).received, 2); assert.equal(vars(route, firstQueue).delivered, 2); assert.equal(vars(route, machine).completed, 2); assert.equal(vars(route, lastQueue).queued, 2); assert.equal(route.runtime.sourceRuntime.liveLoads(), 2); route.runtime.stop();

  const stores = setup(), storeSource = add(stores, 'source', {initialCount: 2, outputInterval: .1}), storeA = addQueue(stores, {columns: 1, rows: 1, layers: 2, capacity: 2}), storeB = addQueue(stores, {columns: 1, rows: 1, layers: 2, capacity: 2});
  connect(stores, storeSource, storeA); connect(stores, storeA, storeB);
  stores.document.setBehaviors(storeA, [Object.assign({}, config(stores, storeA), {delivery: 'manual'})]); stores.runtime.start('hall'); advance(stores, .5);
  const moved = queue(stores, storeA).queue[0].product;
  assert(stores.runtime.command(storeA.userData.editorId, 'dispatch')); assert.equal(moved.item.palletOwnerId, storeB.userData.editorId); assert.equal(moved.item.palletSlot, 0);
  assert(stores.runtime.command(storeA.userData.editorId, 'dispatch')); assert.equal(queue(stores, storeB).items.length, 2); noOverlaps(queue(stores, storeB).items);
  const lower = queue(stores, storeB).items.find(item => item.palletSlot === 0); assert.equal(stores.runtime.pickupProduct(lower.product, addHand(stores)), false, 'The receiving queue retains ownership and protects its lower support after a queue-to-queue transfer.'); stores.runtime.stop();

  const end = setup(), unconnected = add(end, 'conveyor', {role: 'end', withPallet: true}); end.runtime.start('hall');
  assert(end.runtime.insertProduct(unconnected.userData.editorId)); advance(end, 3);
  const conveyor = record(end, unconnected).components.conveyor;
  assert.equal(conveyor.packages.length, 1); assert.equal(conveyor.exitCount, 0); assert.equal(conveyor.pallets.size, 0); assert.equal(conveyor.actualSpeed, 0);
  end.runtime.setupPallet(record(end, unconnected)); assert.equal(conveyor.palletTemplate, null); end.runtime.stop();
  console.log('Pallet queues: independent physical storage, actual-height stacking, bounded flow/backpressure, LIFO accessible tops, VR manipulation, exact identities/unit conservation and cleanup passed.');
}
module.exports = {queue, config, addQueue, ports, connect, addHand, noOverlaps};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
