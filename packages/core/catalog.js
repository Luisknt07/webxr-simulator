import {CORE_API_VERSION, defineModule, versionSatisfies, fail} from '../contracts/index.js';

export function createLocalCatalog(input = []) {
  if (!Array.isArray(input)) fail('invalid_catalog', 'The local catalog must be an array of application-owned definitions.');
  const modules = new Map(), functions = new Map();
  for (const value of input) {
    const module = defineModule(value);
    if (modules.has(module.id)) fail('duplicate_id', `Duplicate module ${module.id}.`);
    modules.set(module.id, module);
    for (const entry of module.functions) { if (functions.has(entry.id)) fail('duplicate_id', `Duplicate function ${entry.id}.`); functions.set(entry.id, Object.freeze({...entry, moduleId: module.id})); }
  }
  const plan = (moduleId, selected) => {
    const module = modules.get(moduleId); if (!module) fail('missing_module', `Module ${moduleId} is not installed.`);
    if (!versionSatisfies(CORE_API_VERSION, module.coreApi)) fail('incompatible_core', `Module ${moduleId} requires core ${module.coreApi}.`);
    const available = new Map(module.functions.map(entry => [entry.id, {id: entry.id, version: entry.version}]));
    for (const entry of module.imports) { if (available.has(entry.id)) fail('duplicate_id', `Duplicate imported function ${entry.id}.`); available.set(entry.id, entry); }
    const roots = selected === undefined ? [...available.keys()] : selected;
    if (!Array.isArray(roots) || roots.length > 512 || new Set(roots).size !== roots.length) fail('invalid_selection', 'Select distinct function identifiers.');
    const ordered = [], visiting = new Set(), done = new Set();
    const visit = (id, range, requester) => {
      const entry = functions.get(id); if (!entry) fail('missing_function', `Required function ${id} is not installed.`);
      if (!versionSatisfies(entry.version, range)) fail('incompatible_version', `Function ${id}@${entry.version} does not satisfy ${range}.`);
      if (!versionSatisfies(CORE_API_VERSION, entry.coreApi)) fail('incompatible_core', `Function ${id} requires core ${entry.coreApi}.`);
      if (requester !== entry.moduleId && !entry.exported) fail('private_function', `Function ${id} is private to its sector.`);
      if (visiting.has(id)) fail('dependency_cycle', `Function dependency cycle at ${id}.`);
      if (done.has(id)) return;
      visiting.add(id); entry.requires.forEach(required => visit(required.id, required.version, entry.moduleId)); visiting.delete(id); done.add(id); ordered.push(entry);
    };
    for (const id of roots) { const reference = available.get(id); if (!reference) fail('invalid_selection', `Function ${id} is not owned/imported by ${moduleId}.`); visit(id, reference.version, moduleId); }
    return Object.freeze({module, roots: Object.freeze([...roots]), functions: Object.freeze(ordered)});
  };
  return Object.freeze({getModule: id => modules.get(id), getFunction: id => functions.get(id), modules: () => [...modules.values()], functions: () => [...functions.values()], plan});
}
