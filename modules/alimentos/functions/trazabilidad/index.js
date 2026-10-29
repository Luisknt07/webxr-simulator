import {defineFunction} from '../../../../packages/module-sdk/index.js';
import {traceabilityManifest} from './manifest.js';
import {validateFoodLot, validateFoodSettings} from './schema.js';
import {authorizeFoodWrite} from './server.js';
import {traceabilityPanel} from './ui.js';
export default defineFunction({...traceabilityManifest, register(scope) {
  const inventory = scope.service('world.inventory');
  scope.register('commands', 'register-lot', input => { const value = validateFoodLot(input); return inventory.transaction({operations: [{type: 'add-load', load: {id: value.id, sku: value.sku, quantity: value.quantity, massKg: value.massKg, locationId: value.locationId, metadata: {sector: 'food', batch: value.batch, expires: value.expires}}}]}); });
  scope.register('commands', 'trace', {readOnly:true, validate:input=>!!input&&typeof input.loadId==='string'&&!!input.loadId.trim()&&input.loadId.length<=180, execute:input => ({load: inventory.getLoad(input.loadId), events: inventory.trace(input.loadId)})});
  scope.register('components', 'settings', {schemaVersion: 1, validate: validateFoodSettings});
  scope.register('server-validators', 'register-lot', {validate: validateFoodLot, authorize: authorizeFoodWrite, permissions:['food.write']});
  scope.register('ui', 'traceability', traceabilityPanel);
}});
