import {cloneData, fail, plain} from '../../../../packages/contracts/index.js';
export function validateHarvest(input) {
  const value = cloneData(input);
  if (!plain(value) || !['id', 'crop', 'lot', 'locationId', 'harvestDate'].every(key => typeof value[key] === 'string' && value[key].trim() && value[key].length <= 180) || !/^\d{4}-\d{2}-\d{2}$/.test(value.harvestDate) || !Number.isFinite(value.quantity) || value.quantity <= 0 || !Number.isFinite(value.massKg) || value.massKg < 0) fail('harvest_data', 'Provide crop, lot, harvest date, location, quantity and mass.');
  return value;
}
export const validateHarvestSettings = value => plain(value) && typeof value.crop === 'string' && value.crop.length <= 180;
