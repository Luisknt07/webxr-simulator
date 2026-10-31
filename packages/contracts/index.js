export const CORE_API_VERSION = '1.0.0';
export const PROJECT_FORMAT = 'smarttwin.project';
export const STATE_FORMAT = 'smarttwin.module-state';

export class FrameworkError extends Error {
  constructor(code, message, details) { super(message); this.name = 'FrameworkError'; this.code = code; if (details !== undefined) this.details = details; }
}
export function fail(code, message, details) { throw new FrameworkError(code, message, details); }
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
/** Data boundary shared by hosts and server adapters. It never invokes toJSON/getters. */
export function cloneData(value, options = {}) {
  const budget = {nodes: 0}, seen = new Set();
  const visit = (input, depth) => {
    if (++budget.nodes > (options.maxNodes || 100000) || depth > (options.maxDepth || 40)) fail('data_limit', 'Data exceeds the allowed complexity.');
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'string') { if (input.length > (options.maxString || 1000000)) fail('data_limit', 'A string exceeds the allowed length.'); return input; }
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (!Array.isArray(input) && !plain(input)) fail('invalid_data', 'Only finite JSON data is allowed.');
    if (seen.has(input)) fail('invalid_data', 'Circular data is not allowed.');
    seen.add(input);
    const output = Array.isArray(input) ? [] : {};
    for (const key of Object.keys(input)) {
      if (FORBIDDEN.has(key)) fail('unsafe_key', 'A data property is not allowed.');
      if (Array.isArray(input) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length)) fail('invalid_data', 'Array data must contain only indexed items.');
      const property = Object.getOwnPropertyDescriptor(input, key);
      if (!property || !Object.hasOwn(property, 'value')) fail('invalid_data', 'Data accessors are not allowed.');
      output[key] = visit(property.value, depth + 1);
    }
    if (Array.isArray(input) && (output.length !== input.length || Object.keys(output).length !== input.length)) fail('invalid_data', 'Sparse arrays are not allowed.');
    seen.delete(input); return output;
  };
  return visit(value, 0);
}
export function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
export function identifier(value, label = 'identifier') {
  if (typeof value !== 'string' || value.length > 180 || !/^[a-z][a-z0-9-]*(?:[./][a-z0-9][a-z0-9-]*)+$/.test(value)) fail('invalid_id', `Invalid namespaced ${label}.`);
  return value;
}
export function localName(value) { if (typeof value !== 'string' || value.length > 120 || !/^[a-z][a-z0-9._/-]*$/.test(value)) fail('invalid_id', 'Invalid local registration name.'); return value; }
export function version(value) { if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) || value.split('.').some(part => !Number.isSafeInteger(Number(part)))) fail('invalid_version', 'Expected a stable major.minor.patch version.'); return value; }
function compare(left, right) { const a = left.split('.').map(Number), b = right.split('.').map(Number); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }
export function versionSatisfies(actual, range) {
  version(actual);
  if (range === '*') return true;
  if (typeof range !== 'string') fail('invalid_version', 'Invalid compatibility range.');
  const match = /^(\^|~|>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(range);
  if (!match) fail('invalid_version', 'Use an exact, caret, tilde, or single comparison version range.');
  const expected = version(match[2]), op = match[1] || '=', delta = compare(actual, expected);
  if (op === '=') return delta === 0;
  if (op === '>=') return delta >= 0; if (op === '<=') return delta <= 0; if (op === '>') return delta > 0; if (op === '<') return delta < 0;
  const [major, minor, patch] = expected.split('.').map(Number);
  const upper = op === '~' ? `${major}.${minor + 1}.0` : major > 0 ? `${major + 1}.0.0` : minor > 0 ? `0.${minor + 1}.0` : `0.0.${patch + 1}`;
  return delta >= 0 && compare(actual, upper) < 0;
}
function references(input, label) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 256) fail('invalid_manifest', `${label} must be an array.`);
  const ids = new Set();
  return input.map(item => { if (!plain(item)) fail('invalid_manifest', `Invalid ${label} entry.`); const id = identifier(item.id); if (ids.has(id)) fail('duplicate_id', `Duplicate ${label}: ${id}`); ids.add(id); const range = item.version || '*'; versionSatisfies('1.0.0', range); return Object.freeze({id, version: range}); });
}
function uniqueIds(input) { if (!Array.isArray(input) || input.length > 128) fail('invalid_manifest', 'Capabilities must be an array.'); return [...new Set(input.map(id => identifier(id, 'capability')))]; }
export function functionManifest(input) {
  if (!plain(input)) fail('invalid_manifest', 'A function definition must be a plain object.');
  const stateVersion = input.stateVersion === undefined ? 1 : input.stateVersion;
  if (!Number.isSafeInteger(stateVersion) || stateVersion < 1) fail('invalid_manifest', 'Invalid function state schema version.');
  const result = {id: identifier(input.id, 'function'), version: version(input.version), coreApi: input.coreApi || '^1.0.0',
    requires: references(input.requires, 'dependencies'), capabilities: uniqueIds(input.capabilities || []),
    uses: references(input.uses, 'service requirements'), provides: references(input.provides, 'provided services'), exported: input.exported !== false, stateVersion};
  versionSatisfies(CORE_API_VERSION, result.coreApi);
  // Providers publish a concrete version; consumers declare a compatibility range.
  result.provides.forEach(item => version(item.version));
  if (input.origin !== undefined) result.origin = cloneData(input.origin);
  if (input.metadata !== undefined) result.metadata = cloneData(input.metadata);
  return deepFreeze(result);
}
export function defineFunction(input) {
  const manifest = functionManifest(input);
  if (typeof input.register !== 'function') fail('invalid_manifest', `Function ${manifest.id} needs register(scope).`);
  const result = {...manifest, register: input.register};
  for (const name of ['start', 'pause', 'resume', 'canStop', 'stop']) { if (input[name] !== undefined && typeof input[name] !== 'function') fail('invalid_manifest', `Invalid ${name} lifecycle hook.`); if (input[name]) result[name] = input[name]; }
  return Object.freeze(result);
}
export function defineModule(input) {
  if (!plain(input) || !Array.isArray(input.functions) || input.functions.length > 256) fail('invalid_manifest', 'A sector module needs a functions array.');
  const id = identifier(input.id, 'module'), ids = new Set();
  const functions = input.functions.map(entry => {
    const manifest = functionManifest(entry);
    if (ids.has(manifest.id)) fail('duplicate_id', `Duplicate function ${manifest.id}.`); ids.add(manifest.id);
    if (typeof entry.load !== 'function') fail('invalid_loader', 'Functions require an application-owned loader callback; code URLs are forbidden.');
    return Object.freeze({...manifest, load: entry.load});
  });
  const coreApi = input.coreApi || '^1.0.0'; versionSatisfies(CORE_API_VERSION, coreApi);
  return Object.freeze({id, version: version(input.version), coreApi, functions: Object.freeze(functions), imports: Object.freeze(references(input.imports, 'function imports')), metadata: deepFreeze(cloneData(input.metadata || {}))});
}
/** Unknown function payloads and future extension fields remain unchanged. */
export function validateProject(input) {
  const data = cloneData(input);
  if (!plain(data) || data.format !== PROJECT_FORMAT || data.version !== 1 || typeof data.worldId !== 'string' || !data.worldId || data.worldId.length > 180 || !Array.isArray(data.entities) || !Array.isArray(data.modules)) fail('invalid_project', 'Invalid project envelope.');
  const modules = new Set(), entities = new Set();
  data.modules.forEach(item => {
    if (!plain(item)) fail('invalid_project', 'Invalid module reference.'); identifier(item.id); version(item.version);
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean' || item.optional !== undefined && typeof item.optional !== 'boolean') fail('invalid_project', 'Module flags must be boolean.');
    if (modules.has(item.id)) fail('duplicate_id', 'Duplicate project module.'); modules.add(item.id);
    if (item.functions !== undefined) {
      if (!Array.isArray(item.functions) || item.functions.length > 512) fail('invalid_selection', 'Project functions must be an array.');
      const functions = new Set();
      item.functions.forEach(reference => {
        const id = typeof reference === 'string' ? reference : plain(reference) && reference.id;
        identifier(id);
        if (functions.has(id)) fail('duplicate_id', 'Duplicate project function.'); functions.add(id);
        if (plain(reference) && (reference.enabled !== undefined && typeof reference.enabled !== 'boolean' || reference.optional !== undefined && typeof reference.optional !== 'boolean')) fail('invalid_project', 'Function flags must be boolean.');
      });
    }
  });
  data.entities.forEach(entity => {
    if (!plain(entity) || typeof entity.id !== 'string' || !entity.id || entity.id.length > 240 || entities.has(entity.id) || !Array.isArray(entity.components)) fail('invalid_project', 'Invalid or duplicate entity.');
    entities.add(entity.id); const types = new Set();
    entity.components.forEach(component => { validateComponent(component); if (types.has(component.type)) fail('duplicate_id', 'Duplicate component on entity.'); types.add(component.type); });
  });
  return data;
}
export function validateComponent(input) {
  if (!plain(input)) fail('invalid_component', 'Invalid component envelope.');
  identifier(input.functionId); version(input.functionVersion);
  if (typeof input.type !== 'string' || !input.type.startsWith(input.functionId + ':')) fail('invalid_component', 'A component must belong to its function namespace.');
  localName(input.type.slice(input.functionId.length + 1));
  if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1 || !Object.hasOwn(input, 'data')) fail('invalid_component', 'Invalid component schema version/data.');
  return input;
}
export function parseProject(text) { if (typeof text !== 'string' || text.length > 16000000) fail('data_limit', 'Project text is invalid or too large.'); return validateProject(JSON.parse(text)); }
export function serializeProject(project) { return JSON.stringify(validateProject(project)); }
export function validateState(input) {
  const data = cloneData(input);
  if (!plain(data) || data.format !== STATE_FORMAT || data.version !== 1 || typeof data.worldId !== 'string' || !data.worldId || !Array.isArray(data.functions)) fail('invalid_state', 'Invalid state envelope.');
  const ids = new Set();
  data.functions.forEach(entry => { if (!plain(entry)) fail('invalid_state', 'Invalid function state.'); identifier(entry.id); version(entry.version); if (ids.has(entry.id)) fail('duplicate_id', 'Duplicate function state.'); ids.add(entry.id); if (!Number.isSafeInteger(entry.schemaVersion) || entry.schemaVersion < 1 || !Object.hasOwn(entry, 'data')) fail('invalid_state', 'Invalid state schema/data.'); });
  return data;
}
