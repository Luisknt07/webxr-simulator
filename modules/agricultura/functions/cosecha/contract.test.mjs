import test from 'node:test';
import assert from 'node:assert/strict';
import {validateHarvest} from './schema.js';
import {authorizeHarvest} from './server.js';
test('harvest validates a complete lot and server writes require an explicit grant', () => {
  const lot = {id: 'harvest-1', crop: 'mango', lot: 'lot-1', locationId: 'field', harvestDate: '2026-10-29', quantity: 12, massKg: 20}; assert.deepEqual(validateHarvest(lot), lot); assert.throws(() => validateHarvest({...lot, massKg: -1})); assert.equal(authorizeHarvest({authenticated: true, permissions: []}), false); assert.equal(authorizeHarvest({authenticated: true, permissions: ['harvest.write']}), true);
});
