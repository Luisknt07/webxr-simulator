import {defineFunction} from '../../../../packages/module-sdk/index.js';
import {harvestManifest} from './manifest.js';
import {validateHarvest, validateHarvestSettings} from './schema.js';
import {authorizeHarvest} from './server.js';
import {harvestPanel} from './ui.js';
export default defineFunction({...harvestManifest, register(scope) {
  const inventory = scope.service('world.inventory');
  scope.register('commands', 'record', input => { const value = validateHarvest(input); return inventory.transaction({operations: [{type: 'add-load', load: {id: value.id, sku: value.crop, quantity: value.quantity, massKg: value.massKg, locationId: value.locationId, metadata: {sector: 'agriculture', lot: value.lot, harvestDate: value.harvestDate}}}]}); });
  scope.register('commands', 'harvests', {readOnly:true, validate:input=>input===null||!!input&&typeof input==='object'&&!Array.isArray(input), execute:() => inventory.snapshot().loads.filter(load => load.metadata && load.metadata.sector === 'agriculture')});
  scope.register('components', 'settings', {schemaVersion: 1, validate: validateHarvestSettings});
  scope.register('server-validators', 'record', {validate: validateHarvest, authorize: authorizeHarvest, permissions:['harvest.write']});
  scope.register('ui', 'harvest', harvestPanel);
}});
