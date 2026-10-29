import {defineFunction, functionManifest, cloneData, fail} from '../contracts/index.js';
export {defineFunction, defineModule, functionManifest, FrameworkError, CORE_API_VERSION} from '../contracts/index.js';

/** A local code fork with new type identity, not a second copy of live world state.
 * Implementations must register through scope.id/local names. An application may
 * replace register/hooks explicitly; provenance is immutable data, never code. */
export function forkFunction(source, changes) {
  const original = defineFunction(source);
  if (!changes || changes.id === original.id) fail('invalid_fork', 'A copied function needs a different namespaced id.');
  const definition = {...original, ...changes, origin: {functionId: original.id, version: original.version, ...(changes.origin ? cloneData(changes.origin) : {})}};
  return defineFunction(definition);
}
/** Describe a bundled local function without importing its implementation yet. */
export function localFunction(manifest, load) {
  if (typeof load !== 'function') fail('invalid_loader', 'A local function needs a loader callback.');
  return Object.freeze({...functionManifest(manifest), load});
}
