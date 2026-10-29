import {cloneData, fail, plain} from '../../../../packages/contracts/index.js';
export function text(value, label = 'id') { if (typeof value !== 'string' || !value.trim() || value.length > 180 || /[\u0000-\u001f]/.test(value)) fail('inventory_data', `Invalid ${label}.`); return value; }
export function positive(value, label, zero = false) { if (typeof value !== 'number' || !Number.isFinite(value) || (zero ? value < 0 : value <= 0)) fail('inventory_data', `Invalid ${label}.`); return value; }
export function validateLocation(value) { if (!plain(value)) fail('inventory_data', 'A location must be an object.'); text(value.id); positive(value.capacityKg, 'capacityKg'); if (!Number.isSafeInteger(value.maxLoads) || value.maxLoads < 1 || value.maxLoads > 100000) fail('inventory_data', 'Invalid maxLoads.'); return true; }
export function validateLoad(value) { if (!plain(value)) fail('inventory_data', 'A load must be an object.'); text(value.id); text(value.sku, 'sku'); text(value.locationId, 'location'); positive(value.quantity, 'quantity'); positive(value.massKg, 'massKg', true); if (value.metadata !== undefined) cloneData(value.metadata); return true; }
export function validateInventoryRequest(input) {
  const value = cloneData(input);
  if (!plain(value) || !Array.isArray(value.operations) || !value.operations.length || value.operations.length > 128) fail('inventory_data', 'Provide 1–128 inventory operations.');
  if (value.expectedRevision !== undefined && (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0)) fail('inventory_data', 'Invalid expected revision.');
  for (const operation of value.operations) {
    if (!plain(operation)) fail('inventory_data', 'An operation must be an object.');
    if (operation.type === 'add-location') validateLocation(operation.location);
    else if (operation.type === 'add-load') validateLoad(operation.load);
    else if (operation.type === 'reserve') { text(operation.loadId); text(operation.ownerId); text(operation.toLocationId); if (operation.reservationId !== undefined) text(operation.reservationId); }
    else if (operation.type === 'commit' || operation.type === 'release') { text(operation.reservationId); text(operation.ownerId); }
    else if (operation.type === 'withdraw') text(operation.loadId);
    else fail('inventory_data', 'Unsupported inventory operation.');
  }
  return value;
}
export function validateStorageSettings(value) { return plain(value) && (value.title === undefined || typeof value.title === 'string' && value.title.length <= 180); }
