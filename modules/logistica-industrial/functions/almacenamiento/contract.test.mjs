import test from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryService} from './service.js';
test('inventory transfer conserves load identity/mass/quantity and rolls back capacity/conflicts', () => {
  let persisted, deny = false;
  const inventory = createInventoryService({persist: next => { if (deny) throw new Error('storage unavailable'); persisted = next; }});
  inventory.transaction({operations: [{type: 'add-location', location: {id: 'field', capacityKg: 100, maxLoads: 2}}, {type: 'add-location', location: {id: 'cold', capacityKg: 25, maxLoads: 1}}, {type: 'add-load', load: {id: 'harvest-1', sku: 'mango', quantity: 12, massKg: 20, locationId: 'field'}}]});
  const revision = inventory.snapshot().revision;
  const reservation = inventory.transaction({expectedRevision: revision, operations: [{type: 'reserve', loadId: 'harvest-1', toLocationId: 'cold', ownerId: 'operator-a'}]}).results[0];
  assert.throws(() => inventory.transaction({expectedRevision: revision, operations: [{type: 'withdraw', loadId: 'harvest-1'}]}), {code: 'inventory_conflict'});
  assert.throws(() => inventory.transaction({operations: [{type: 'reserve', loadId: 'harvest-1', toLocationId: 'cold', ownerId: 'operator-b'}]}), {code: 'load_reserved'});
  const before = inventory.snapshot(); deny = true;
  assert.throws(() => inventory.transaction({operations: [{type: 'commit', reservationId: reservation.id, ownerId: 'operator-a'}]}), /storage unavailable/); assert.deepEqual(inventory.snapshot(), before); deny = false;
  inventory.transaction({operations: [{type: 'commit', reservationId: reservation.id, ownerId: 'operator-a'}]}); assert.deepEqual(inventory.getLoad('harvest-1'), {id: 'harvest-1', sku: 'mango', quantity: 12, massKg: 20, locationId: 'cold'}); assert.deepEqual(persisted, inventory.snapshot());
  const prior = inventory.snapshot(); assert.throws(() => inventory.transaction({operations: [{type: 'add-load', load: {id: 'overflow', sku: 'mango', quantity: 2, massKg: 20, locationId: 'cold'}}]}), {code: 'inventory_capacity'}); assert.deepEqual(inventory.snapshot(), prior);
});
