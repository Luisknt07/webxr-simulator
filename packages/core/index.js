export {createHost} from './host.js';
export {createLocalCatalog} from './catalog.js';
import {createHost} from './host.js';
import {fail} from '../contracts/index.js';
import {createLocalCatalog} from './catalog.js';
import {functionManifest, deepFreeze} from '../contracts/index.js';

/** Pure export plan for application packaging/copy tools; never calls a loader. */
export function requireClosure(catalog, moduleId, functions) {
  const local = catalog && typeof catalog.plan === 'function' ? catalog : createLocalCatalog(catalog);
  return deepFreeze(local.plan(moduleId, functions).functions.map(entry => ({...functionManifest(entry), moduleId: entry.moduleId})));
}

/** Application-owned local loader table only. Project JSON never reaches imports. */
export async function composeSelection({catalog = [], selections = [], ...options} = {}) {
  if (!Array.isArray(selections)) fail('invalid_selection', 'Selections must be an array.');
  const host = createHost({...options, catalog});
  try { for (const selection of selections) { if (typeof selection === 'string') await host.activate(selection); else if (selection && typeof selection.moduleId === 'string') await host.activate(selection.moduleId, {functions: selection.functions}); else fail('invalid_selection', 'Select a local module identifier.'); } }
  catch (error) { try { await host.dispose({force: true}); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Composition and cleanup failed.'); } throw error; }
  return host;
}
