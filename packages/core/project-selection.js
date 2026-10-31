import {validateProject, identifier, versionSatisfies, functionManifest, deepFreeze, fail, plain} from '../contracts/index.js';
import {createLocalCatalog} from './catalog.js';

/** Resolve data against application-owned local loaders. Disabled references
 * remain in the document; dependencies are always resolved, never suppressed. */
export function resolveProjectSelection({catalog = [], project, allowOptionalMissing = false, defaultFunctions = {}} = {}) {
  const local = catalog && typeof catalog.plan === 'function' ? catalog : createLocalCatalog(catalog);
  const projectData = validateProject(project), selections = [], missing = [], selected = new Map();
  for (const reference of projectData.modules) {
    if (reference.enabled === false) continue;
    const module = local.getModule(reference.id), optionalModule = allowOptionalMissing && reference.optional === true;
    if (!module) {
      if (optionalModule) {missing.push({moduleId: reference.id, code: 'missing_module'}); continue;}
      fail('missing_module', `Project needs local module ${reference.id}.`);
    }
    if (!versionSatisfies(module.version, reference.version)) fail('incompatible_version', `Project module ${reference.id} needs migration from ${reference.version}.`);
    let requested = reference.functions;
    if (requested === undefined) requested = Object.hasOwn(defaultFunctions, module.id) ? defaultFunctions[module.id] : module.functions.map(entry => entry.id).concat(module.imports.map(entry => entry.id));
    if (!Array.isArray(requested) || requested.length > 512) fail('invalid_selection', 'Project functions must be an array.');
    const roots = [], seen = new Set();
    for (const request of requested) {
      const id = typeof request === 'string' ? request : request && request.id;
      identifier(id);
      if (seen.has(id)) fail('duplicate_id', 'A composition selects the same root function twice.');
      seen.add(id);
      if (plain(request) && request.enabled === false) continue;
      const optional = optionalModule || allowOptionalMissing && plain(request) && request.optional === true;
      const available = module.functions.some(entry => entry.id === id) || module.imports.some(entry => entry.id === id);
      if (!available) {
        if (optional) {missing.push({moduleId: module.id, functionId: id, code: 'missing_function'}); continue;}
        fail('missing_function', `Module ${module.id} does not expose ${id}.`);
      }
      // Optionality applies only to this root. A present function with missing
      // required dependencies is a broken package, never an optional success.
      const plan = local.plan(module.id, [id]);
      for (const entry of plan.functions) selected.set(entry.id, {...functionManifest(entry), moduleId: entry.moduleId});
      roots.push(id);
    }
    if (roots.length) selections.push({moduleId: module.id, functions: roots});
  }
  return deepFreeze({project: projectData, selections, missing, functions: [...selected.values()]});
}
