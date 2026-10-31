import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectSession} from '../../packages/core/project-session.js';
import {defineFunction, defineModule, STATE_FORMAT} from '../../packages/contracts/index.js';

const version = '1.0.0', deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};};
const fn = (id, register = () => {}, settings = {}) => defineFunction({id, version, register, ...settings});
const module = (id, definitions, imports = [], loads = []) => defineModule({id, version, imports, functions: definitions.map(definition => ({...definition, load: async () => {loads.push(definition.id); return definition;}}))});
const project = (id, modules, worldId = 'world.project-test') => ({format: 'smarttwin.project', version: 1, id, worldId, modules: modules.map(value => typeof value === 'string' ? {id: value, version} : value), entities: []});
function counter(id, events = []) {
  return fn(id, scope => {
    events.push('start:' + id);
    if (!scope.state.get()) scope.state.set({count: 0});
    scope.register('commands', 'increment', () => {const state = scope.state.get(); state.count++; scope.state.set(state); return state.count;});
    scope.register('commands', 'read', () => scope.state.get().count);
    scope.onDispose(() => events.push('stop:' + id));
  });
}

test('session loads only selected functions and disable releases resources while preserving data for reactivation', async () => {
  const events = [], loads = [], count = counter('alpha.counter', events), unused = fn('alpha.unused', () => {throw Error('Never load this function.');});
  const session = createProjectSession({catalog: [module('sector.alpha', [count, unused], [], loads)]});
  const opened = await session.open(project('p1', [{id: 'sector.alpha', version, functions: [count.id]}]));
  assert.equal(opened.phase, 'ready'); assert.equal(opened.busy, false); assert.deepEqual(loads, [count.id]);
  assert.equal(await session.dispatch(count.id + ':increment'), 1);
  await session.disableModule('sector.alpha');
  assert.equal(session.host.status().functions.length, 0); assert.deepEqual(events, ['start:alpha.counter', 'stop:alpha.counter']);
  assert.equal(session.project.modules[0].enabled, false); assert.equal(session.capture().state.functions[0].data.count, 1);
  await session.enableModule('sector.alpha'); assert.equal(await session.dispatch(count.id + ':read'), 1);
  await session.removeModule('sector.alpha'); assert.deepEqual(session.project.modules, []); assert.equal(session.capture().state.functions[0].data.count, 1);
  await session.setFunctionEnabled('sector.alpha', count.id, false); assert.deepEqual(session.project.modules, []);
  await session.setFunctionEnabled('sector.alpha', count.id, true); assert.equal(await session.dispatch(count.id + ':read'), 1);
  assert.deepEqual(session.host.status().functions.map(entry => entry.id), [count.id]);
  assert.deepEqual(session.status().availableModules[0].functions.map(entry => entry.id), [count.id, unused.id]);
  await session.dispose(); assert.equal(session.status().phase, 'closed');
});

test('removing a sector preserves a shared provider needed by another sector and pausing does not destroy it', async () => {
  let disposed = 0, ticks = 0;
  const inventory = fn('shared.inventory', scope => {scope.provide('world.inventory', {}); scope.register('systems', 'clock', {step() {ticks++;}}); scope.onDispose(() => disposed++);}, {provides: [{id: 'world.inventory', version}]});
  const consumer = id => fn(id, scope => {scope.service('world.inventory');}, {requires: [{id: inventory.id, version}], uses: [{id: 'world.inventory', version}]});
  const session = createProjectSession({catalog: [module('sector.shared', [inventory]), module('sector.farm', [consumer('farm.harvest')]), module('sector.food', [consumer('food.lots')])]});
  await session.open(project('p1', ['sector.farm', 'sector.food'])); session.step(1 / 60); assert.equal(ticks, 1);
  await session.removeModule('sector.farm'); assert.equal(disposed, 0); assert.equal(session.host.status().services.length, 1);
  await session.pauseModule('sector.food'); session.step(1 / 60); assert.equal(ticks, 1); assert.equal(disposed, 0);
  await session.resumeModule('sector.food'); session.step(1 / 60); assert.equal(ticks, 2);
  await session.disableModule('sector.food'); assert.equal(disposed, 1); assert.equal(session.host.status().services.length, 0);
  await session.dispose();
});

test('individual function settings preserve other functions and their state without recreating the active world', async () => {
  const events = [], a = counter('alpha.one', events), b = counter('alpha.two', events);
  const session = createProjectSession({catalog: [module('sector.alpha', [a, b])]});
  await session.open(project('p1', ['sector.alpha'])); const original = session.host;
  await session.dispatch(a.id + ':increment'); await session.dispatch(b.id + ':increment');
  await session.setFunctionEnabled('sector.alpha', a.id, false);
  assert.equal(session.host, original); assert.deepEqual(session.host.status().functions.map(entry => entry.id), [b.id]);
  assert.equal(await session.dispatch(b.id + ':read'), 1); assert.equal(events.filter(event => event === 'start:alpha.two').length, 1);
  await session.setFunctionEnabled('sector.alpha', a.id, true); assert.equal(await session.dispatch(a.id + ':read'), 1);
  assert.deepEqual(session.project.modules[0].functions, [{id: a.id, enabled: true}, b.id]);
  await session.pauseModule('sector.alpha'); await session.setFunctionEnabled('sector.alpha', a.id, false);
  assert.equal(session.host.status().modules[0].status, 'paused');
  await session.setFunctionEnabled('sector.alpha', a.id, true); assert.equal(session.host.status().modules[0].status, 'paused');
  await session.resumeModule('sector.alpha'); assert.equal(await session.dispatch(a.id + ':read'), 1);
  assert.throws(() => session.setFunctionEnabled('sector.alpha', a.id, 'false'), {code: 'invalid_selection'});
  await assert.rejects(session.setFunctionEnabled('sector.alpha', 'other.unknown', false));
  await session.dispose();
});

test('switching project ids in the same world never overlaps live worlds and restores each logical state', async () => {
  let active = 0, maximum = 0;
  const count = counter('alpha.counter');
  const definition = fn(count.id, scope => {active++; maximum = Math.max(maximum, active); count.register(scope); scope.onDispose(() => active--);});
  const session = createProjectSession({catalog: [module('sector.alpha', [definition])]});
  const a = project('a', ['sector.alpha']), b = project('b', ['sector.alpha']);
  await session.open(a); await session.dispatch(count.id + ':increment'); await session.dispatch(count.id + ':increment');
  await session.open(b); assert.equal(await session.dispatch(count.id + ':read'), 0); await session.dispatch(count.id + ':increment');
  await session.open(a); assert.equal(await session.dispatch(count.id + ':read'), 2);
  await session.open(a); assert.equal(await session.dispatch(count.id + ':read'), 2);
  await session.pauseModule('sector.alpha'); await session.open(b); assert.equal(await session.dispatch(count.id + ':read'), 1);
  await session.open(a); assert.equal(session.host.status().modules[0].status, 'paused');
  assert.equal(maximum, 1); assert.equal(session.status().savedProjects.length, 2);
  const inactive = session.status().savedProjects.find(entry => entry.projectId === 'b'); assert.equal(session.forgetProject(inactive.key), true);
  assert.throws(() => session.forgetProject(session.status().savedProjects[0].key), {code: 'active_project'});
  await session.dispose(); assert.equal(active, 0);
});

test('missing modules, capabilities and incompatible saved state fail preflight without stopping the current project', async () => {
  const events = [], a = counter('alpha.counter', events), gpu = fn('scene.graphics', () => {}, {capabilities: ['platform.scene']});
  const session = createProjectSession({catalog: [module('sector.alpha', [a]), module('sector.scene', [gpu])]});
  await session.open(project('a', ['sector.alpha'])); const previous = session.host;
  await assert.rejects(session.open(project('bad', ['sector.absent'])), {code: 'missing_module'});
  await assert.rejects(session.open(project('gpu', ['sector.scene'])), {code: 'capability_denied'});
  const state = {format: STATE_FORMAT, version: 1, worldId: 'world.project-test', functions: [{id: a.id, version: '2.0.0', schemaVersion: 1, data: {count: 20}}]};
  await assert.rejects(session.open(project('bad-state', ['sector.alpha']), {state}), {code: 'state_migration_required'});
  assert.equal(session.host, previous); assert.deepEqual(events, ['start:alpha.counter']);
  assert.equal(await session.dispatch(a.id + ':increment'), 1); await session.dispose();
});

test('failed target activation cleans its resources and restores the previous project including paused status', async () => {
  const events = [], a = counter('alpha.counter', events);
  const broken = fn('broken.failure', scope => {scope.onDispose(() => events.push('broken disposed')); throw Error('Target startup failed');});
  const session = createProjectSession({catalog: [module('sector.alpha', [a]), module('sector.broken', [broken])]});
  await session.open(project('a', ['sector.alpha'])); await session.dispatch(a.id + ':increment'); await session.pauseModule('sector.alpha');
  await assert.rejects(session.open(project('b', ['sector.broken'])), /Target startup failed/);
  assert.equal(session.project.id, 'a'); assert.equal(session.host.status().modules[0].status, 'paused');
  assert.deepEqual(events, ['start:alpha.counter', 'stop:alpha.counter', 'broken disposed', 'start:alpha.counter']);
  await session.resumeModule('sector.alpha'); assert.equal(await session.dispatch(a.id + ':read'), 1); await session.dispose();
});

test('held-resource interlocks reject a switch or removal without losing the previous host and its custody', async () => {
  let held = true, disposed = 0;
  const definition = fn('alpha.held', scope => {scope.register('commands', 'release', () => {held = false;}); scope.onDispose(() => disposed++);}, {canStop: () => ({allowed: !held, reason: 'A pallet is held.'})});
  const session = createProjectSession({catalog: [module('sector.alpha', [definition])]});
  await session.open(project('a', ['sector.alpha'])); const previous = session.host;
  await assert.rejects(session.open(project('b', [])), {code: 'removal_blocked'});
  await assert.rejects(session.disableModule('sector.alpha'), {code: 'removal_blocked'});
  assert.equal(session.host, previous); assert.equal(session.project.modules[0].enabled, undefined); assert.equal(disposed, 0);
  await session.dispatch(definition.id + ':release'); await session.open(project('b', [])); assert.equal(disposed, 1); await session.dispose();
});

test('page-lifetime adapters cannot be paused, removed or replaced by project controls; terminal force cleanup remains available', async () => {
  let disposed = 0;
  const legacy = fn('alpha.workspace', scope => {scope.onDispose(() => disposed++);}, {metadata: {hotPause: false, hotRemoval: false}, canStop: () => ({allowed: false})});
  const session = createProjectSession({catalog: [module('sector.alpha', [legacy])]});
  await session.open(project('a', ['sector.alpha'])); const previous = session.host;
  assert.equal(session.status().modules[0].hotPause, false); assert.equal(session.status().modules[0].hotRemoval, false);
  await assert.rejects(session.pauseModule('sector.alpha'), {code: 'page_lifetime_module'});
  await assert.rejects(session.removeModule('sector.alpha'), {code: 'page_lifetime_module'});
  await assert.rejects(session.open(project('b', [])), {code: 'page_lifetime_module'});
  await assert.rejects(session.dispose(), {code: 'removal_blocked'}); assert.equal(session.host, previous); assert.equal(session.status().phase, 'ready');
  await session.dispose({force: true}); assert.equal(disposed, 1); assert.equal(session.status().phase, 'closed');
});

test('optional missing functions retain opaque components and state across project changes and module reconfiguration', async () => {
  const definition = counter('alpha.counter'), session = createProjectSession({catalog: [module('sector.alpha', [definition])]});
  const document = project('a', ['sector.alpha', {id: 'sector.absent', version, optional: true}]);
  document.entities.push({id: 'kept', components: [{functionId: 'absent.shape', functionVersion: version, type: 'absent.shape:data', schemaVersion: 3, data: {references: ['pallet-7'], custom: [1, 2, 3]}}]});
  const state = {format: STATE_FORMAT, version: 1, worldId: document.worldId, functions: [{id: 'absent.shape', version, schemaVersion: 3, data: {untouched: true}}]};
  await session.open(document, {state, allowOptionalMissing: true}); assert.equal(session.status().missing.length, 1);
  await session.disableModule('sector.alpha'); assert.deepEqual(session.project.entities, document.entities);
  await session.enableModule('sector.alpha'); assert.deepEqual(session.capture().state.functions.find(entry => entry.id === 'absent.shape').data, {untouched: true});
  await session.open(project('b', [])); await session.open(document, {allowOptionalMissing: true});
  assert.deepEqual(session.project.entities, document.entities); assert.equal(session.status().modules.find(entry => entry.id === 'sector.absent').installed, false);
  await session.dispose();
});

test('terminal disposal interrupts pending registration and late resources are disposed once without reviving the world', async () => {
  const entered = deferred(), resource = deferred(); let disposed = 0, starts = 0;
  const definition = fn('alpha.slow', async scope => {entered.resolve(); await scope.track(resource.promise, () => disposed++);}, {start() {starts++;}});
  const session = createProjectSession({catalog: [module('sector.alpha', [definition])]});
  const opening = session.open(project('a', ['sector.alpha'])); const rejected = assert.rejects(opening, error => ['activation_cancelled', 'session_closed'].includes(error.code));
  await entered.promise; const closing = session.dispose(); await rejected; await closing;
  resource.resolve({}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1); assert.equal(starts, 0); assert.equal(session.host, null); assert.equal(session.status().phase, 'closed');
});

test('session suppresses commands and ticks during transitions and observers see committed state even when another observer throws', async () => {
  const entered = deferred(), release = deferred(); let ticks = 0;
  const a = fn('alpha.clock', scope => {scope.register('systems', 'tick', {step() {ticks++;}}); scope.register('commands', 'ping', () => 'pong');});
  const b = fn('beta.slow', async () => {entered.resolve(); await release.promise;});
  const session = createProjectSession({catalog: [module('sector.alpha', [a]), module('sector.beta', [b])]});
  const phases = [], unsubscribe = session.subscribe(state => {phases.push(state.phase); assert.equal(Object.isFrozen(state), true);});
  session.subscribe(state => {if (state.busy) throw Error('Observer failure');});
  await session.open(project('a', ['sector.alpha'])); session.step(1 / 60); assert.equal(ticks, 1);
  const opening = session.open(project('b', ['sector.beta'])); await entered.promise;
  assert.throws(() => session.dispatch(a.id + ':ping'), {code: 'session_busy'}); assert.equal(session.step(1 / 60), 0);
  release.resolve(); const complete = await opening; assert.equal(complete.phase, 'ready'); assert.equal(complete.busy, false);
  await session.dispose(); assert.equal(phases.at(-1), 'closed'); unsubscribe();
});

test('a cleanup error reports the actual committed module removal while preserving reactivation state', async () => {
  let shouldThrow = true;
  const definition = counter('alpha.counter');
  const noisy = fn(definition.id, scope => {definition.register(scope); scope.onDispose(() => {if (shouldThrow) throw Error('Resource cleanup reported a failure');});});
  const session = createProjectSession({catalog: [module('sector.alpha', [noisy])]});
  await session.open(project('a', ['sector.alpha'])); await session.dispatch(definition.id + ':increment');
  await assert.rejects(session.disableModule('sector.alpha'), /resources could not be disposed/);
  assert.equal(session.project.modules[0].enabled, false); assert.equal(session.host.status().functions.length, 0);
  await session.enableModule('sector.alpha'); assert.equal(await session.dispatch(definition.id + ':read'), 1);
  shouldThrow = false; await session.dispose();
});

test('an exported project snapshot restores paused modules and state in a fresh session; malformed pauses fail preflight', async () => {
  const definition = counter('alpha.counter'), catalog = [module('sector.alpha', [definition])];
  const a = createProjectSession({catalog}); await a.open(project('a', ['sector.alpha']));
  await a.dispatch(definition.id + ':increment'); await a.pauseModule('sector.alpha');
  const snapshot = a.capture(); await a.dispose();
  const b = createProjectSession({catalog});
  await b.open(snapshot.project, {state: snapshot.state, pausedModules: snapshot.pausedModules});
  assert.equal(b.host.status().modules[0].status, 'paused'); const previous = b.host;
  await assert.rejects(b.open(snapshot.project, {pausedModules: ['sector.absent']}), {code: 'invalid_selection'});
  await assert.rejects(b.open(snapshot.project, {pausedModules: ['sector.alpha', 'sector.alpha']}), {code: 'invalid_selection'});
  await assert.rejects(b.open(snapshot.project, {pausedModules: 'sector.alpha'}), {code: 'invalid_selection'});
  assert.equal(b.host, previous); await b.resumeModule('sector.alpha'); assert.equal(await b.dispatch(definition.id + ':read'), 1);
  await b.dispose();
});

test('terminal disposal also interrupts a module being enabled in an already active project', async () => {
  const entered = deferred(), resource = deferred(); let disposed = 0;
  const definition = fn('beta.slow', async scope => {entered.resolve(); await scope.track(resource.promise, () => disposed++);});
  const session = createProjectSession({catalog: [module('sector.alpha', [counter('alpha.counter')]), module('sector.beta', [definition])]});
  await session.open(project('a', ['sector.alpha']));
  const activation = session.enableModule('sector.beta'), rejected = assert.rejects(activation, {code: 'activation_cancelled'});
  await entered.promise; const closing = session.dispose(); await rejected; await closing;
  resource.resolve({}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1); assert.equal(session.status().phase, 'closed'); assert.equal(session.host, null);
});

test('cancelling a pending module does not bypass a held-resource interlock on the existing project', async () => {
  const entered = deferred(), resource = deferred(); let held = true, lateDisposed = 0, heldDisposed = 0;
  const owner = fn('alpha.held', scope => {scope.register('commands', 'release', () => {held = false;}); scope.onDispose(() => heldDisposed++);}, {canStop: () => !held});
  const slow = fn('beta.slow', async scope => {entered.resolve(); await scope.track(resource.promise, () => lateDisposed++);});
  const session = createProjectSession({catalog: [module('sector.alpha', [owner]), module('sector.beta', [slow])]});
  await session.open(project('a', ['sector.alpha'])); const previous = session.host;
  const activation = session.enableModule('sector.beta'), rejected = assert.rejects(activation, {code: 'activation_cancelled'});
  await entered.promise; const closing = session.dispose(); await rejected; await assert.rejects(closing, {code: 'removal_blocked'});
  assert.equal(session.host, previous); assert.equal(heldDisposed, 0); assert.equal(session.status().phase, 'ready');
  resource.resolve({}); await new Promise(resolve => setImmediate(resolve)); assert.equal(lateDisposed, 1);
  await session.dispatch(owner.id + ':release'); await session.dispose(); assert.equal(heldDisposed, 1);
});

test('project switching preserves a final state flush performed by a stop hook, including reopening the same project', async () => {
  const definition = counter('alpha.counter');
  const flushing = fn(definition.id, definition.register, {stop(scope) {const state = scope.state.get(); state.count += 100; scope.state.set(state);}});
  const session = createProjectSession({catalog: [module('sector.alpha', [flushing])]});
  const a = project('a', ['sector.alpha']), b = project('b', []);
  await session.open(a); await session.dispatch(definition.id + ':increment'); await session.open(b);
  await session.open(a); assert.equal(await session.dispatch(definition.id + ':read'), 101);
  await session.open(a); assert.equal(await session.dispatch(definition.id + ':read'), 201);
  await session.dispose();
});

test('a disabled module can be inspected and configured after an unused dependency is uninstalled', async () => {
  const definition = fn('alpha.consumer', () => {throw Error('Disabled code must not load.');}, {requires: [{id: 'absent.provider', version}]});
  const session = createProjectSession({catalog: [module('sector.alpha', [definition])]});
  await session.open(project('a', [{id: 'sector.alpha', version, enabled: false}]));
  assert.equal(session.status().modules[0].status, 'disabled'); assert.deepEqual(session.status().modules[0].functions, [definition.id]);
  await session.setFunctionEnabled('sector.alpha', definition.id, false); assert.equal(session.host.status().functions.length, 0);
  await session.enableModule('sector.alpha'); // Its only function remains explicitly disabled.
  await assert.rejects(session.setFunctionEnabled('sector.alpha', definition.id, true), {code: 'missing_function'});
  assert.equal(session.host.status().functions.length, 0); await session.dispose();
});
