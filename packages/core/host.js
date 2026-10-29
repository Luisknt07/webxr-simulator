import {CORE_API_VERSION, STATE_FORMAT, cloneData, deepFreeze, defineFunction, functionManifest, fail, FrameworkError, validateState, validateProject, validateComponent, versionSatisfies, plain} from '../contracts/index.js';
import {createLocalCatalog} from './catalog.js';
import {createScope} from './scope.js';

const abortError = () => new FrameworkError('activation_cancelled', 'The lifecycle operation was cancelled.');
function abortable(promise, signal) {
  const pending = Promise.resolve(promise);
  if (signal.aborted) { pending.catch(() => {}); return Promise.reject(abortError()); }
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError()); signal.addEventListener('abort', abort, {once: true});
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function blocked(value) { return value === false || typeof value === 'string' || Array.isArray(value) && value.length > 0 || value && value.allowed === false; }

/** One host per world. No renderer, browser, domain model or autonomous frame loop. */
export function createHost(options = {}) {
  const catalog = options.catalog && typeof options.catalog.plan === 'function' ? options.catalog : createLocalCatalog(options.catalog || []);
  const worldId = options.worldId || 'world.default';
  if (typeof worldId !== 'string' || !worldId || worldId.length > 180) fail('invalid_world', 'A world needs a stable identifier.');
  const records = new Map(), modules = new Map(), registries = new Map(), services = new Map(), states = new Map(), pending = new Map();
  const grants = new Set(options.grants || []), ports = options.ports || {};
  const fixedStep = options.fixedStep === undefined ? 1 / 60 : options.fixedStep, maxFrame = options.maxFrame === undefined ? .25 : options.maxFrame;
  if (!(fixedStep > 0 && fixedStep <= 1 && Number.isFinite(fixedStep)) || !(maxFrame >= fixedStep && maxFrame <= 1 && Number.isFinite(maxFrame))) fail('invalid_clock', 'Invalid fixed-step clock limits.');
  let queue = Promise.resolve(), disposed = false, closing = false, lifecycleBusy = 0, time = 0, accumulator = 0, droppedSeconds = 0, revision = 0, scheduleRevision = -1, schedule = [], stateEnvelope = {};
  const enqueue = task => { const result = queue.then(async () => { lifecycleBusy++; try { return await task(); } finally { lifecycleBusy--; } }); queue = result.catch(() => {}); return result; };
  const assertOpen = () => { if (disposed || closing) fail('host_closed', 'The host has been disposed.'); };
  const internal = {worldId, grants, ports, states,
    register(record, kind, name, value) {
      if (record.status !== 'registering') fail('registration_closed', 'Registrations belong to the awaited register phase.');
      const key = record.id + ':' + name; let entries = registries.get(kind); if (!entries) registries.set(kind, entries = new Map());
      if (entries.has(key)) fail('duplicate_registration', `Duplicate ${kind} registration ${key}.`);
      entries.set(key, {key, functionId: record.id, value}); revision++; return key;
    },
    provide(record, id, value) {
      if (record.status !== 'registering') fail('registration_closed', 'Services belong to the register phase.');
      const declaration = record.definition.provides.find(entry => entry.id === id);
      if (!declaration) fail('undeclared_service', `Function ${record.id} did not declare service ${id}.`);
      if (services.has(id)) fail('duplicate_service', `World ${worldId} already has service ${id}.`);
      services.set(id, {id, version: declaration.version, owner: record.id, value, consumers: new Set()}); return value;
    },
    service(record, id) {
      const declaration = record.definition.uses.find(entry => entry.id === id);
      if (!declaration) fail('undeclared_service', `Function ${record.id} did not declare use of ${id}.`);
      const service = services.get(id); if (!service) fail('missing_service', `World service ${id} is unavailable.`);
      if (!versionSatisfies(service.version, declaration.version)) fail('incompatible_service', `Service ${id} is incompatible with ${record.id}.`);
      // A hidden dependency would let an otherwise unrelated removal steal state.
      if (service.owner !== record.id && !dependencyIds(record.definition).has(service.owner)) fail('undeclared_dependency', `Function ${record.id} must declare dependency on provider ${service.owner}.`);
      service.consumers.add(record.id); return service.value;
    },
    unregister(record) {
      for (const entries of registries.values()) for (const [key, entry] of entries) if (entry.functionId === record.id) entries.delete(key);
      for (const [id, service] of services) { service.consumers.delete(record.id); if (service.owner === record.id) services.delete(id); }
      revision++;
    }
  };
  function dependencyIds(definition, result = new Set()) { for (const entry of definition.requires) { if (result.has(entry.id)) continue; result.add(entry.id); const dependency = catalog.getFunction(entry.id); if (dependency) dependencyIds(dependency, result); } return result; }
  function desiredRecords(nextModules) {
    const result = new Map();
    for (const module of nextModules.values()) for (const entry of module.plan.functions) { let ref = result.get(entry.id); if (!ref) result.set(entry.id, ref = {references: 0, activeReferences: 0}); ref.references++; if (module.status === 'active') ref.activeReferences++; }
    return result;
  }
  function orderedRecords() {
    const ordered = [], seen = new Set();
    const visit = record => { if (seen.has(record.id)) return; seen.add(record.id); for (const dep of record.definition.requires) if (records.has(dep.id)) visit(records.get(dep.id)); ordered.push(record); };
    records.forEach(visit); return ordered;
  }
  async function assertRemovable(ids) {
    for (const record of orderedRecords().reverse()) if (ids.has(record.id)) {
      for (const service of services.values()) if (service.owner === record.id) { const users = [...service.consumers].filter(id => !ids.has(id)); if (users.length) fail('service_in_use', `Service ${service.id} still has consumers.`, users); }
      if (record.definition.canStop) { const verdict = await record.definition.canStop(record.handle.scope); if (blocked(verdict)) fail('removal_blocked', `Function ${record.id} cannot be removed yet.`, verdict); }
    }
  }
  async function destroy(record) {
    const errors = []; record.status = 'stopping';
    try { if (record.started && record.definition.stop) await record.definition.stop(record.handle.scope); } catch (error) { errors.push(error); }
    try { await record.handle.dispose(); } catch (error) { errors.push(error); }
    if (record.unlink) record.unlink(); records.delete(record.id); record.status = 'removed'; revision++;
    if (errors.length) throw new AggregateError(errors, `Removal failed for ${record.id}.`);
  }
  async function destroyMany(ids) { const errors = []; for (const record of orderedRecords().reverse()) if (ids.has(record.id)) try { await destroy(record); } catch (error) { errors.push(error); } if (errors.length) throw new AggregateError(errors, 'Some resources could not be disposed.'); }
  async function transition(nextModules, fresh = new Set()) {
    const desired = desiredRecords(nextModules), changed = [];
    try {
      // Pause consumers before providers; resume providers before consumers.
      for (const record of orderedRecords().reverse()) if (!fresh.has(record.id) && desired.has(record.id) && !desired.get(record.id).activeReferences && record.status === 'active') {
        if (record.definition.pause) await record.definition.pause(record.handle.scope); record.status = 'paused'; changed.push([record, 'active']);
      }
      for (const record of orderedRecords()) if (!fresh.has(record.id) && desired.has(record.id) && desired.get(record.id).activeReferences && record.status === 'paused') {
        if (record.definition.resume) await record.definition.resume(record.handle.scope); record.status = 'active'; changed.push([record, 'paused']);
      }
    } catch (error) {
      const rollback = [];
      for (const [record, previous] of changed.reverse()) try { const hook = previous === 'active' ? 'resume' : 'pause'; if (record.definition[hook]) await record.definition[hook](record.handle.scope); record.status = previous; } catch (failure) { rollback.push(failure); }
      if (rollback.length) throw new AggregateError([error, ...rollback], 'Lifecycle transition and rollback failed.'); throw error;
    }
    return desired;
  }
  async function restoreStatuses(previous) {
    const errors = [];
    for (const record of orderedRecords().reverse()) if (previous.get(record.id) === 'paused' && record.status === 'active') try { if (record.definition.pause) await record.definition.pause(record.handle.scope); record.status = 'paused'; } catch (error) { errors.push(error); }
    for (const record of orderedRecords()) if (previous.get(record.id) === 'active' && record.status === 'paused') try { if (record.definition.resume) await record.definition.resume(record.handle.scope); record.status = 'active'; } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Could not restore previous lifecycle states.');
  }
  function buildSchedule() {
    if (scheduleRevision === revision) return schedule;
    const entries = [...(registries.get('systems') || new Map()).values()], byKey = new Map(entries.map(entry => [entry.key, entry])), edges = new Map(entries.map(entry => [entry.key, new Set()]));
    for (const entry of entries) {
      if (!entry.value || typeof entry.value.step !== 'function') fail('invalid_system', `System ${entry.key} needs step(delta).`);
      const phase = entry.value.phase === undefined ? 0 : entry.value.phase; if (!Number.isFinite(phase)) fail('invalid_system', 'A system phase must be numeric.');
      for (const key of entry.value.after || []) { if (!byKey.has(key)) fail('missing_system', `Unknown system dependency ${key}.`); edges.get(entry.key).add(key); }
      for (const key of entry.value.before || []) { if (!byKey.has(key)) fail('missing_system', `Unknown system dependency ${key}.`); edges.get(key).add(entry.key); }
    }
    // Numeric generic phases are explicit; domain-specific phase names stay in modules.
    for (const entry of entries) for (const other of entries) if ((other.value.phase || 0) < (entry.value.phase || 0)) edges.get(entry.key).add(other.key);
    const ordered = [], done = new Set(), visiting = new Set();
    const visit = key => { if (visiting.has(key)) fail('system_cycle', `System dependency cycle at ${key}.`); if (done.has(key)) return; visiting.add(key); [...edges.get(key)].sort().forEach(visit); visiting.delete(key); done.add(key); ordered.push(byKey.get(key)); };
    [...byKey.keys()].sort().forEach(visit); schedule = ordered; scheduleRevision = revision; return schedule;
  }
  function beginPending(id) { const controller = new AbortController(); let controllers = pending.get(id); if (!controllers) pending.set(id, controllers = new Set()); controllers.add(controller); return controller; }
  function endPending(id, controller) { const controllers = pending.get(id); if (controllers) { controllers.delete(controller); if (!controllers.size) pending.delete(id); } }
  const cancelPending = id => { for (const controller of pending.get(id) || []) controller.abort(); };
  const api = {
    worldId, coreApi: CORE_API_VERSION,
    activate(moduleId, selection = {}) {
      assertOpen(); const controller = beginPending(moduleId);
      const operation = enqueue(async () => {
        assertOpen(); if (controller.signal.aborted) throw abortError();
        const plan = catalog.plan(moduleId, selection.functions), nextModules = new Map(modules);
        nextModules.set(moduleId, {id: moduleId, version: plan.module.version, status: 'active', plan});
        const desired = desiredRecords(nextModules), removed = new Set([...records.keys()].filter(id => !desired.has(id)));
        await assertRemovable(removed);
        const fresh = new Set(), previousStates = new Map(), previousStatuses = new Map([...records.values()].map(record => [record.id, record.status]));
        try {
          for (const entry of plan.functions) {
            if (records.has(entry.id)) continue;
            if (controller.signal.aborted) throw abortError();
            for (const capability of entry.capabilities) if (!grants.has(capability) || !Object.hasOwn(ports, capability)) fail('capability_denied', `Function ${entry.id} requires unavailable capability ${capability}.`);
            const loaded = await abortable(entry.load(), controller.signal), definition = defineFunction(loaded && (loaded.default || loaded.functionDefinition) || loaded);
            if (JSON.stringify(functionManifest(definition)) !== JSON.stringify(functionManifest(entry))) fail('manifest_mismatch', `Loaded function ${entry.id} does not match its catalog declaration.`);
            const localController = new AbortController(), abort = () => localController.abort(); controller.signal.addEventListener('abort', abort, {once: true});
            const record = {id: entry.id, definition, status: 'registering', unlink: () => controller.signal.removeEventListener('abort', abort)};
            record.handle = createScope(internal, record, localController); records.set(record.id, record); fresh.add(record.id); previousStates.set(record.id, states.get(record.id));
            // Late returned cleanup still belongs to this scope after cancellation.
            const registration = Promise.resolve().then(() => definition.register(record.handle.scope)).then(cleanup => { if (cleanup !== undefined) { if (typeof cleanup !== 'function') fail('invalid_disposer', 'register may return only a cleanup function.'); record.handle.scope.onDispose(cleanup); } });
            await abortable(registration, controller.signal);
            for (const service of definition.provides) if (!services.has(service.id) || services.get(service.id).owner !== record.id) fail('missing_service', `Function ${record.id} did not provide declared service ${service.id}.`);
            record.status = 'prepared';
          }
          buildSchedule();
          await transition(nextModules, fresh);
          for (const record of orderedRecords()) if (fresh.has(record.id)) {
            record.status = 'starting'; record.started = true;
            if (record.definition.start) await abortable(record.definition.start(record.handle.scope), controller.signal);
            record.status = 'active';
          }
          if (controller.signal.aborted) throw abortError();
        } catch (error) {
          let cleanupError;
          try { await destroyMany(fresh); } catch (cleanup) { cleanupError = cleanup; }
          try { await restoreStatuses(previousStatuses); } catch (restore) { cleanupError = cleanupError ? new AggregateError([cleanupError, restore], 'Rollback cleanup failed.') : restore; }
          previousStates.forEach((previous, id) => { if (previous) states.set(id, previous); else states.delete(id); });
          if (cleanupError) throw new AggregateError([error, cleanupError], 'Activation failed; cleanup also reported errors.');
          throw error;
        }
        for (const id of fresh) { const record = records.get(id); record.unlink(); record.unlink = null; }
        modules.clear(); nextModules.forEach((value, key) => modules.set(key, value));
        await destroyMany(removed); return api.status();
      });
      operation.then(() => endPending(moduleId, controller), () => endPending(moduleId, controller)); return operation;
    },
    pause(moduleId) {
      assertOpen(); cancelPending(moduleId);
      return enqueue(async () => { assertOpen(); const module = modules.get(moduleId); if (!module) return false; const next = new Map(modules); next.set(moduleId, {...module, status: 'paused'}); await transition(next); modules.clear(); next.forEach((value, key) => modules.set(key, value)); return true; });
    },
    remove(moduleId) {
      assertOpen(); cancelPending(moduleId);
      return enqueue(async () => { assertOpen(); if (!modules.has(moduleId)) return false; const next = new Map(modules); next.delete(moduleId); const desired = desiredRecords(next), removed = new Set([...records.keys()].filter(id => !desired.has(id))); await assertRemovable(removed); await transition(next); modules.clear(); next.forEach((value, key) => modules.set(key, value)); await destroyMany(removed); return true; });
    },
    registry(kind) { return [...(registries.get(kind) || new Map()).values()].map(entry => Object.freeze({...entry})); },
    async dispatch(key, payload = null) {
      assertOpen(); if (lifecycleBusy) fail('lifecycle_busy', 'Wait for the lifecycle transition before issuing commands.'); const commands = registries.get('commands'), entry = commands && commands.get(key), record = entry && records.get(entry.functionId);
      if (!record || record.status !== 'active') fail('inactive_command', `Command ${key} is unavailable or paused.`);
      const descriptor = typeof entry.value === 'function' ? {execute: entry.value} : entry.value;
      if (!descriptor || typeof descriptor.execute !== 'function') fail('invalid_command', `Command ${key} has no execute handler.`);
      if (descriptor.capability && (!record.definition.capabilities.includes(descriptor.capability) || !grants.has(descriptor.capability))) fail('capability_denied', 'This command lacks its required capability.');
      const data = cloneData(payload); if (descriptor.validate && descriptor.validate(data) === false) fail('invalid_command_data', 'Command data failed validation.');
      const result = await abortable(descriptor.execute(data, Object.freeze({worldId, functionId: record.id})), record.handle.controller.signal);
      if (record.status !== 'active') fail('inactive_command', 'The command owner was paused or removed.'); return result;
    },
    step(delta) {
      assertOpen(); if (!Number.isFinite(delta) || delta < 0) fail('invalid_delta', 'A frame delta must be finite and nonnegative.');
      if (lifecycleBusy) return 0;
      droppedSeconds += Math.max(0, delta - maxFrame); accumulator += Math.min(delta, maxFrame); let steps = 0;
      const systems = buildSchedule();
      while (accumulator + 1e-12 >= fixedStep) {
        for (const entry of systems) if (records.has(entry.functionId) && records.get(entry.functionId).status === 'active') {
          const result = entry.value.step(fixedStep, Object.freeze({worldId, time, tick: Math.round(time / fixedStep)}));
          if (result && typeof result.then === 'function') { result.catch(() => {}); fail('async_system', 'Simulation steps must be synchronous; track async work through the scope.'); }
        }
        time += fixedStep; accumulator = Math.max(0, accumulator - fixedStep); steps++;
      }
      return steps;
    },
    status() {
      const desired = desiredRecords(modules);
      return deepFreeze({worldId, disposed, time, droppedSeconds, modules: [...modules.values()].map(({id, version, status, plan}) => ({id, version, status, functions: [...plan.roots]})),
        functions: [...records.values()].map(record => ({id: record.id, version: record.definition.version, status: record.status, ...(desired.get(record.id) || {references: 0, activeReferences: 0})})),
        services: [...services.values()].map(service => ({id: service.id, version: service.version, owner: service.owner, consumers: [...service.consumers]}))});
    },
    exportState() { return validateState({...stateEnvelope, format: STATE_FORMAT, version: 1, worldId, functions: [...states.values()].map(entry => cloneData(entry))}); },
    importState(input) {
      assertOpen(); if (records.size || pending.size) fail('active_state', 'Import state before activating functions.');
      const data = validateState(input); if (data.worldId !== worldId) fail('world_mismatch', 'State belongs to another world.');
      states.clear(); data.functions.forEach(entry => states.set(entry.id, entry)); stateEnvelope = data; return api.exportState();
    },
    migrateState(id, migrate) {
      assertOpen(); if (records.has(id) || typeof migrate !== 'function') fail('active_state', 'Migrate an inactive function using an approved local callback.');
      const existing = states.get(id); if (!existing) fail('missing_state', `No state for ${id}.`);
      const next = migrate(cloneData(existing)); const validated = validateState({format: STATE_FORMAT, version: 1, worldId, functions: [next]}).functions[0];
      if (validated.id !== id) fail('invalid_state', 'A state migration cannot change function identity.'); states.set(id, validated); return cloneData(validated);
    },
    inspectProject(input) {
      const project = validateProject(input);
      return {project, components: project.entities.flatMap(entity => entity.components.map(component => ({entityId: entity.id, component: cloneData(component), status: componentStatus(component)})))};
    },
    readComponent(input) {
      const component = cloneData(input); validateComponent(component); const status = componentStatus(component); if (status !== 'ready') return {status, component};
      const definition = registries.get('components').get(component.type).value;
      const data = cloneData(component.data); if (definition.validate && definition.validate(data) === false) fail('invalid_component', 'Component data failed its installed validator.');
      return {status, component: {...component, data}};
    },
    async dispose({force = false} = {}) {
      if (disposed) return; if (closing) return queue;
      for (const controllers of pending.values()) for (const controller of controllers) controller.abort();
      closing = true;
      return enqueue(async () => {
        const ids = new Set(records.keys());
        try { if (!force) await assertRemovable(ids); } catch (error) { closing = false; throw error; }
        modules.clear(); try { await destroyMany(ids); } finally { disposed = true; closing = false; accumulator = 0; }
      });
    }
  };
  function componentStatus(component) {
    const installed = catalog.getFunction(component.functionId); if (!installed) return 'missing_function';
    if (installed.version !== component.functionVersion) return 'migration_required';
    const record = records.get(component.functionId); if (!record) return 'inactive_function';
    const components = registries.get('components'), registration = components && components.get(component.type); if (!registration) return 'missing_component';
    const definition = registration.value; if (!plain(definition) || definition.schemaVersion !== component.schemaVersion) return 'migration_required'; return 'ready';
  }
  return Object.freeze(api);
}
