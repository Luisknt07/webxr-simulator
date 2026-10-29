import {defineFunction} from '../../../../packages/module-sdk/index.js';
import {storageManifest} from './manifest.js';
import {createInventoryService} from './service.js';
import {validateInventoryRequest, validateStorageSettings} from './schema.js';
import {authorizeInventoryWrite} from './server.js';
import {migrateStorageState} from './migrations.js';
import {inventoryPanel} from './ui.js';
// No global inventory: each registration creates exactly one world service.
export function createStorageFunction(manifest = storageManifest) { return defineFunction({...manifest,
  register(scope) {
    const inventory = createInventoryService({initialState: scope.state.get(), persist: data => scope.state.set(data)});
    scope.provide('world.inventory', inventory);
    scope.register('commands', 'transaction', input => inventory.transaction(input));
    scope.register('commands', 'snapshot', {readOnly:true, validate:input=>input===null||!!input&&typeof input==='object'&&!Array.isArray(input), execute:() => inventory.snapshot()});
    scope.register('commands', 'trace', {readOnly:true, validate:input=>!!input&&typeof input.loadId==='string'&&!!input.loadId.trim()&&input.loadId.length<=180, execute:input => inventory.trace(input.loadId)});
    scope.register('components', 'settings', {schemaVersion: 1, validate: validateStorageSettings});
    scope.register('server-validators', 'transaction', {validate: validateInventoryRequest, authorize: authorizeInventoryWrite, permissions:['inventory.write']});
    scope.register('migrations', 'state', migrateStorageState);
    scope.register('ui', 'inventory', inventoryPanel);
  },
  canStop(scope) { const state = scope.state.get(); return state && state.reservations.length ? {allowed: false, reason: 'Release pending inventory reservations first.'} : true; }
}); }
export default createStorageFunction();
