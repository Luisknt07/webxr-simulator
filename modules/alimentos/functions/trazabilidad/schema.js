import {cloneData, fail, plain} from '../../../../packages/contracts/index.js';
export function validateFoodLot(input) {
  const value = cloneData(input);
  if (!plain(value) || !['id', 'sku', 'batch', 'locationId', 'expires'].every(key => typeof value[key] === 'string' && value[key].trim() && value[key].length <= 180) || !/^\d{4}-\d{2}-\d{2}$/.test(value.expires) || !Number.isFinite(value.quantity) || value.quantity <= 0 || !Number.isFinite(value.massKg) || value.massKg < 0) fail('food_data', 'Provide lot, batch, expiry, location, quantity and mass.');
  return value;
}
export const validateFoodSettings = value => plain(value) && (value.expiryPolicy === 'fifo' || value.expiryPolicy === 'fefo');
