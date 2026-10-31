import {createHost} from './host.js';
import {createLocalCatalog} from './catalog.js';
import {resolveProjectSelection} from './project-selection.js';
import {cloneData, deepFreeze, fail, identifier, validateProject, validateState} from '../contracts/index.js';

const keyFor = project => JSON.stringify([project.worldId, typeof project.id === 'string' ? project.id : '']);

/** Application-owned project coordinator. It shares the application's render
 * loop and ports; changing a project never starts another renderer or imports
 * code from a project file. Cached projects contain JSON state, not worlds. */
export function createProjectSession(options = {}) {
  const catalog = options.catalog && typeof options.catalog.plan === 'function' ? options.catalog : createLocalCatalog(options.catalog || []);
  const grants = new Set(options.grants || []), ports = options.ports || {}, defaultFunctions = options.defaultFunctions || {};
  const saved = new Map(), subscribers = new Set();
  let host = null, project = null, missing = [], optionalMissing = options.allowOptionalMissing === true, loadingHost = null, closed = false, closing = false, disposal = null, operations = 0, queue = Promise.resolve();
  const assertOpen = () => {if (closed || closing) fail('session_closed', 'The project session has been closed.');};
  const status = () => {
    const core = host ? host.status() : null;
    return deepFreeze({phase: closed ? 'closed' : operations ? 'transitioning' : host ? 'ready' : 'empty', busy: operations > 0 || closing,
      projectId: project && typeof project.id === 'string' ? project.id : null, worldId: project ? project.worldId : null,
      project: project ? cloneData(project) : null, core, missing: cloneData(missing),
      modules: project ? project.modules.map(reference => {
        const installed = catalog.getModule(reference.id), active = core && core.modules.find(module => module.id === reference.id);
        const running = active ? catalog.plan(reference.id, active.functions).functions : [];
        return {id: reference.id, version: reference.version, enabled: reference.enabled !== false, installed: !!installed,
          status: active ? active.status : reference.enabled === false ? 'disabled' : 'unloaded',
          hotPause: !running.some(entry => entry.metadata && entry.metadata.hotPause === false), hotRemoval: !running.some(entry => entry.metadata && entry.metadata.hotRemoval === false),
          functions: cloneData(reference.functions === undefined ? installed ? rootsFor(reference.id) : [] : reference.functions)};
      }) : [],
      availableModules: catalog.modules().map(module => ({id: module.id, version: module.version, title: module.metadata.title || module.metadata.folder || module.id,
        functions: [...module.functions.map(entry => entry.id), ...module.imports.map(entry => entry.id)].map(id => {
          const entry = catalog.getFunction(id), metadata = entry && entry.metadata || {};
          return {id, title: metadata.title || id, hotPause: metadata.hotPause !== false, hotRemoval: metadata.hotRemoval !== false};
        })})),
      savedProjects: [...saved].map(([key, snapshot]) => ({key, worldId: snapshot.project.worldId, projectId: snapshot.project.id || null}))});
  };
  const publish = () => {const value = status(); for (const callback of subscribers) try {callback(value);} catch (_) { /* Observers cannot invalidate a lifecycle transition. */ }};
  const enqueue = task => {
    operations++; publish();
    const pending = queue.then(task);
    queue = pending.catch(() => {});
    return pending.then(value => {operations--; publish(); if (closed) subscribers.clear(); return value === undefined ? undefined : status();}, error => {operations--; publish(); if (closed) subscribers.clear(); throw error;});
  };
  function resolve(input, allowOptionalMissing = options.allowOptionalMissing === true) {
    const plan = resolveProjectSelection({catalog, project: input, allowOptionalMissing, defaultFunctions});
    for (const entry of plan.functions) for (const capability of entry.capabilities) {
      if (!grants.has(capability) || !Object.hasOwn(ports, capability)) fail('capability_denied', `Function ${entry.id} requires unavailable capability ${capability}.`);
    }
    return plan;
  }
  function rootsFor(moduleId) {
    if (Object.hasOwn(defaultFunctions, moduleId)) return [...defaultFunctions[moduleId]];
    const installed = catalog.getModule(moduleId);
    if (!installed) fail('missing_module', `Module ${moduleId} is not installed.`);
    return [...installed.functions.map(entry => entry.id), ...installed.imports.map(entry => entry.id)];
  }
  function capture() {
    if (!host || !project) return null;
    return cloneData({project, state: host.exportState(), allowOptionalMissing: optionalMissing, pausedModules: host.status().modules.filter(module => module.status === 'paused').map(module => module.id)});
  }
  function remember() {const snapshot = capture(); if (snapshot) saved.set(keyFor(snapshot.project), snapshot); return snapshot;}
  function removable(ids, action = 'remove') {
    for (const id of ids) {
      const definition = catalog.getFunction(id), metadata = definition && definition.metadata;
      if (metadata && (action === 'pause' ? metadata.hotPause === false : metadata.hotRemoval === false)) {
        fail('page_lifetime_module', `Function ${id} has page lifetime; save and open another application instead of ${action}.`);
      }
    }
  }
  function preparedState(input, plan) {
    if (input === undefined || input === null) return null;
    const state = validateState(input);
    if (state.worldId !== plan.project.worldId) fail('world_mismatch', 'Saved state belongs to another world.');
    for (const entry of plan.functions) {
      const previous = state.functions.find(value => value.id === entry.id);
      if (previous && (previous.version !== entry.version || previous.schemaVersion !== entry.stateVersion)) fail('state_migration_required', `State for ${entry.id} needs an explicit migration.`);
    }
    return state;
  }
  async function start(plan, state, pausedModules = []) {
    const next = createHost({...options, catalog, ports, grants: [...grants], worldId: plan.project.worldId});
    loadingHost = next;
    try {
      if (state) next.importState(state);
      for (const selection of plan.selections) {
        if (closing || closed) fail('session_closed', 'The project session has been closed.');
        await next.activate(selection.moduleId, {functions: selection.functions});
      }
      for (const moduleId of pausedModules) if (next.status().modules.some(module => module.id === moduleId)) await next.pause(moduleId);
      if (closing || closed) fail('session_closed', 'The project session has been closed.');
      return next;
    } catch (error) {
      try {await next.dispose({force: true});} catch (cleanup) {throw new AggregateError([error, cleanup], 'Project activation and cleanup failed.');}
      throw error;
    } finally {if (loadingHost === next) loadingHost = null;}
  }
  async function restore(snapshot) {
    const plan = resolve(snapshot.project, snapshot.allowOptionalMissing === true);
    host = await start(plan, preparedState(snapshot.state, plan), snapshot.pausedModules);
    project = plan.project; missing = plan.missing; optionalMissing = snapshot.allowOptionalMissing === true;
  }
  async function changeProject(input, settings = {}) {
    assertOpen();
    if (settings.allowOptionalMissing !== undefined && typeof settings.allowOptionalMissing !== 'boolean') fail('invalid_selection', 'Optional missing selection must be boolean.');
    const permitMissing = settings.allowOptionalMissing === undefined ? options.allowOptionalMissing === true : settings.allowOptionalMissing;
    const plan = resolve(input, permitMissing);
    const cached = project && keyFor(project) === keyFor(plan.project) ? capture() : saved.get(keyFor(plan.project));
    let state = preparedState(settings.state === undefined ? cached && cached.state : settings.state, plan);
    const available = new Set(plan.selections.map(selection => selection.moduleId));
    const paused = settings.pausedModules === undefined ? settings.state === undefined && cached ? cached.pausedModules.filter(id => available.has(id)) : [] : settings.pausedModules;
    if (!Array.isArray(paused) || paused.length > 512 || new Set(paused).size !== paused.length) fail('invalid_selection', 'Saved paused modules must be a distinct bounded list.');
    for (const moduleId of paused) {
      identifier(moduleId); if (!available.has(moduleId)) fail('invalid_selection', 'A saved paused module must be selected by the project.');
      const selection = plan.selections.find(item => item.moduleId === moduleId);
      removable(catalog.plan(moduleId, selection.functions).functions.map(entry => entry.id), 'pause');
    }
    // Preflight all declarative constraints before interrupting the current world.
    if (host) removable(host.status().functions.map(entry => entry.id));
    const previous = remember(), old = host;
    if (old) {
      try {await old.dispose();}
      catch (error) {
        if (!old.status().disposed) throw error;
        previous.state = old.exportState(); saved.set(keyFor(previous.project), previous);
        host = null;
        if (!closing && previous) try {await restore(previous);} catch (rollback) {project = null; missing = []; throw new AggregateError([error, rollback], 'Project retirement and restoration failed.');}
        throw error;
      }
      previous.state = old.exportState(); saved.set(keyFor(previous.project), previous);
      if (settings.state === undefined && keyFor(previous.project) === keyFor(plan.project)) state = preparedState(previous.state, plan);
      host = null;
    }
    try {
      host = await start(plan, state, paused); project = plan.project; missing = plan.missing; optionalMissing = permitMissing; remember(); return status();
    } catch (error) {
      if (!closing && previous) {
        try {await restore(previous);}
        catch (rollback) {host = null; project = null; missing = []; throw new AggregateError([error, rollback], 'Project change failed and the previous project could not be restored.');}
      } else {host = null; project = null; missing = [];}
      throw error;
    }
  }
  function reference(moduleId) {
    if (!host || !project) fail('missing_project', 'Open a project before managing modules.');
    return project.modules.find(module => module.id === moduleId);
  }
  async function reconfigure(nextDocument, moduleId, {resume = false} = {}) {
    const plan = resolve(nextDocument, optionalMissing), selected = plan.selections.find(item => item.moduleId === moduleId);
    const desired = new Set(plan.functions.map(entry => entry.id));
    const wasPaused = host.status().modules.some(item => item.id === moduleId && item.status === 'paused');
    removable(host.status().functions.filter(entry => !desired.has(entry.id)).map(entry => entry.id));
    if (selected && wasPaused && !resume) removable(catalog.plan(moduleId, selected.functions).functions.map(entry => entry.id), 'pause');
    const target = host; loadingHost = target;
    try {
      if (selected) {await host.activate(moduleId, {functions: selected.functions}); if (wasPaused && !resume) await host.pause(moduleId);} else await host.remove(moduleId);
    } catch (error) {
      // A cleanup hook can report an error after the core has committed removal.
      // Reflect that actual configuration rather than inventing a rollback.
      const actual = host.status().modules.find(item => item.id === moduleId);
      if (selected ? actual && JSON.stringify(actual.functions) === JSON.stringify(selected.functions) : !actual) {project = plan.project; missing = plan.missing; remember();}
      throw error;
    } finally {if (loadingHost === target) loadingHost = null;}
    project = plan.project; missing = plan.missing; remember(); return status();
  }
  const api = {
    get busy() {return operations > 0 || closing;},
    get host() {return host;}, get project() {return project ? deepFreeze(cloneData(project)) : null;},
    status,
    subscribe(callback) {assertOpen(); if (typeof callback !== 'function') fail('invalid_callback', 'A session observer must be a function.'); subscribers.add(callback); callback(status()); return () => subscribers.delete(callback);},
    open(input, settings = {}) {assertOpen(); const document = validateProject(input), savedSettings = cloneData(settings); return enqueue(() => changeProject(document, savedSettings));},
    enableModule(moduleId, settings = {}) {
      assertOpen(); const selectedFunctions = settings.functions === undefined ? undefined : cloneData(settings.functions);
      return enqueue(async () => {assertOpen(); const old = reference(moduleId), installed = catalog.getModule(moduleId);
        if (!installed) fail('missing_module', `Module ${moduleId} is not installed in this application.`);
        const next = cloneData(project), row = old ? next.modules.find(item => item.id === moduleId) : {id: moduleId, version: installed.version};
        if (!old) next.modules.push(row); row.enabled = true; if (selectedFunctions !== undefined) row.functions = selectedFunctions;
        return reconfigure(next, moduleId, {resume: true});
      });
    },
    disableModule(moduleId) {
      assertOpen(); return enqueue(async () => {assertOpen(); const old = reference(moduleId); if (!old) fail('missing_module', 'The project does not select that module.');
        const next = cloneData(project); next.modules.find(item => item.id === moduleId).enabled = false; return reconfigure(next, moduleId);
      });
    },
    removeModule(moduleId) {
      assertOpen(); return enqueue(async () => {assertOpen(); const old = reference(moduleId); if (!old) return status();
        const next = cloneData(project); next.modules = next.modules.filter(item => item.id !== moduleId); return reconfigure(next, moduleId);
      });
    },
    pauseModule(moduleId) {
      assertOpen(); return enqueue(async () => {assertOpen(); reference(moduleId);
        const active = host.status().modules.find(item => item.id === moduleId); if (!active) fail('inactive_module', 'The selected module is not active.');
        removable(catalog.plan(moduleId, active.functions).functions.map(entry => entry.id), 'pause');
        await host.pause(moduleId); remember(); return status();
      });
    },
    resumeModule(moduleId) {return api.enableModule(moduleId);},
    setFunctionEnabled(moduleId, functionId, enabled) {
      assertOpen(); if (typeof enabled !== 'boolean') fail('invalid_selection', 'A function enabled flag must be boolean.');
      return enqueue(async () => {assertOpen(); const old = reference(moduleId), installed = catalog.getModule(moduleId);
        if (!installed) fail('missing_module', 'The application does not contain that module.');
        // Listing or disabling a known function must not resolve its absent
        // dependencies. Enabling it still validates the complete dependency plan.
        if (enabled) catalog.plan(moduleId, [functionId]);
        else if (!installed.functions.some(entry => entry.id === functionId) && !installed.imports.some(entry => entry.id === functionId)) fail('invalid_selection', 'The function does not belong to that module.');
        if (!old && !enabled) return status();
        const next = cloneData(project), row = old ? next.modules.find(item => item.id === moduleId) : {id: moduleId, version: installed.version, functions: []};
        if (!old) next.modules.push(row);
        const selected = row.functions === undefined ? rootsFor(moduleId) : row.functions;
        const found = selected.find(item => (typeof item === 'string' ? item : item.id) === functionId);
        row.functions = selected.map(item => (typeof item === 'string' ? item : item.id) === functionId ? {...(typeof item === 'string' ? {id: item} : item), enabled} : item);
        if (!found) row.functions.push({id: functionId, enabled});
        return reconfigure(next, moduleId);
      });
    },
    capture() {assertOpen(); if (operations) fail('session_busy', 'Wait for the project transition before saving.'); return capture();},
    forgetProject(key) {assertOpen(); if (operations) fail('session_busy', 'Wait for the project transition.'); if (project && key === keyFor(project)) fail('active_project', 'Cannot forget the current project.'); const removed = saved.delete(key); publish(); return removed;},
    dispatch(key, payload) {assertOpen(); if (operations) fail('session_busy', 'Wait for the project transition before issuing commands.'); if (!host) fail('missing_project', 'Open a project before issuing commands.'); return host.dispatch(key, payload);},
    step(delta) {assertOpen(); return host && !operations ? host.step(delta) : 0;},
    dispose({force = false} = {}) {
      if (closed) return Promise.resolve(); if (closing) return disposal || queue;
      closing = true;
      // Interrupt a loader that has not settled; its scope owns late cleanup.
      const pending = loadingHost ? loadingHost.dispose({force: loadingHost === host ? force : true}) : Promise.resolve(); pending.catch(() => {});
      disposal = enqueue(async () => {
        try {await pending; if (host) {remember(); await host.dispose({force});} host = null; project = null; missing = []; closed = true;}
        catch (error) {if (host && host.status().disposed) {host = null; project = null; missing = []; closed = true;} throw error;}
        finally {closing = false; if (!closed) disposal = null;}
      });
      return disposal;
    }
  };
  return Object.freeze(api);
}
