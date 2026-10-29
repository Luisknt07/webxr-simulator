import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFoodLot} from './schema.js';
import {authorizeFoodWrite} from './server.js';
test('food lots require batch and expiry; no ambient write authority', () => {
  const lot = {id: 'food-1', sku: 'juice', batch: 'batch-1', locationId: 'cold', expires: '2027-01-01', quantity: 3, massKg: 6}; assert.deepEqual(validateFoodLot(lot), lot); assert.throws(() => validateFoodLot({...lot, batch: ''})); assert.equal(authorizeFoodWrite(null), false); assert.equal(authorizeFoodWrite({authenticated: true, permissions: ['food.write']}), true);
});
