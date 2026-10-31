import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {createHost, createLocalCatalog, composeSelection, requireClosure} from '../../packages/core/index.js';
import {defineFunction, defineModule, forkFunction} from '../../packages/module-sdk/index.js';
import {cloneData, versionSatisfies, parseProject, serializeProject, CORE_API_VERSION, STATE_FORMAT} from '../../packages/contracts/index.js';

const version = '1.0.0';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const descriptor = (definition, counter) => ({...definition, load: async () => { if (counter) counter.push(definition.id); return definition; }});
const module = (id, definitions, imports = [], counter) => defineModule({id, version, functions: definitions.map(definition => descriptor(definition, counter)), imports});
const fn = (id, register = () => {}, options = {}) => defineFunction({id, version, ...options, register});

test('core boots headless and its recursive imports contain no browser or industrial dependencies', async () => {
  const host = createHost(); assert.equal(host.coreApi, CORE_API_VERSION); assert.deepEqual(host.status().functions, []); assert.equal(host.step(1 / 60), 1); await host.dispose();
  for (const folder of ['core', 'contracts', 'module-sdk']) {
    const base = new URL(`../../packages/${folder}/`, import.meta.url);
    for (const filename of await readdir(base)) if (filename.endsWith('.js')) {
      const source = await readFile(new URL(filename, base), 'utf8');
      assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*['"](?:three|[^'"]*(?:Industrial|SimulationRuntime|shared\/behaviors|src\/editor))/);
      assert.doesNotMatch(source, /\b(?:document|window|requestAnimationFrame|setAnimationLoop)\s*\./);
    }
  }
});

test('selective cross-sector import loads only that function and transitive dependencies', async () => {
  const loaded = [], events = [];
  const custody = fn('shared.custody', scope => { scope.provide('world.custody', {loads: new Map()}); scope.onDispose(() => events.push('custody disposed')); }, {provides: [{id: 'world.custody', version}]});
  const forklift = fn('logistics.forklift', scope => { const service = scope.service('world.custody'); scope.register('commands', 'count', () => service.loads.size); }, {requires: [{id: custody.id, version: '^1.0.0'}], uses: [{id: 'world.custody', version: '^1.0.0'}]});
  const conveyor = fn('logistics.conveyor'), farm = fn('agriculture.crops');
  const host = await composeSelection({catalog: [module('sector.shared', [custody], [], loaded), module('sector.logistics', [forklift, conveyor], [], loaded), module('sector.agriculture', [farm], [{id: forklift.id, version: '^1.0.0'}], loaded)], selections: [{moduleId: 'sector.agriculture', functions: [forklift.id]}]});
  assert.deepEqual(loaded, [custody.id, forklift.id]); assert.deepEqual(host.status().modules.map(item => item.id), ['sector.agriculture']); assert.equal(await host.dispatch(forklift.id + ':count'), 0);
  await host.activate('sector.logistics', {functions: [forklift.id]}); assert.equal(host.status().functions.find(item => item.id === custody.id).references, 2);
  await host.remove('sector.agriculture'); assert.equal(host.status().services.length, 1); assert.deepEqual(events, []);
  await host.remove('sector.logistics'); assert.deepEqual(events, ['custody disposed']); assert.deepEqual(host.status().functions, []); await host.dispose();
});

test('sector pause retains shared service while another active sector runs', async () => {
  let ticks = 0, pauses = 0, resumes = 0, dispose = 0;
  const shared = fn('shared.clock', scope => { scope.register('systems', 'tick', {step() { ticks++; }}); scope.onDispose(() => dispose++); }, {pause() { pauses++; }, resume() { resumes++; }});
  const host = createHost({catalog: [module('sector.shared', [shared]), module('sector.agriculture', [], [{id: shared.id, version}]), module('sector.education', [], [{id: shared.id, version}])]});
  await host.activate('sector.agriculture'); await host.activate('sector.education'); host.step(1 / 60); assert.equal(ticks, 1);
  await host.pause('sector.agriculture'); host.step(1 / 60); assert.equal(ticks, 2); assert.equal(pauses, 0);
  await host.pause('sector.education'); host.step(1 / 60); assert.equal(ticks, 2); assert.equal(pauses, 1); assert.equal(dispose, 0);
  await host.activate('sector.agriculture'); assert.equal(resumes, 1); host.step(1 / 60); assert.equal(ticks, 3);
  await host.dispose(); assert.equal(dispose, 1);
});

test('version incompatibility, private imports and cycles fail before any loader runs', async () => {
  const calls = [], dependency = fn('shared.basic'), a = fn('alpha.a', () => {}, {requires: [{id: 'beta.b', version}]}), b = fn('beta.b', () => {}, {requires: [{id: 'alpha.a', version}]});
  const host = createHost({catalog: [module('sector.shared', [dependency], [], calls), module('sector.bad', [], [{id: dependency.id, version: '^2.0.0'}]), module('sector.alpha', [a], [], calls), module('sector.beta', [b], [], calls)]});
  await assert.rejects(host.activate('sector.bad'), {code: 'incompatible_version'}); await assert.rejects(host.activate('sector.alpha'), {code: 'dependency_cycle'}); assert.deepEqual(calls, []); await host.dispose();
  const secret = fn('private.secret', () => {}, {exported: false});
  const privateHost = createHost({catalog: [module('sector.private', [secret]), module('sector.public', [], [{id: secret.id, version}])]}); await assert.rejects(privateHost.activate('sector.public'), {code: 'private_function'}); await privateHost.dispose();
  assert.equal(versionSatisfies('0.2.3', '^0.2.0'), true); assert.equal(versionSatisfies('0.3.0', '^0.2.0'), false); assert.equal(versionSatisfies('0.0.2', '^0.0.1'), false); assert.throws(() => versionSatisfies(version, 'latest'), {code: 'invalid_version'});
});

test('failed registration rolls back registries, resources and namespaced state; preexisting module survives', async () => {
  let cleanup = 0;
  const stable = fn('stable.running', scope => scope.register('commands', 'ping', () => 'pong'));
  // Register may return cleanup only, so explicitly discard the registration key.
  const stableDefinition = fn(stable.id, scope => { scope.register('commands', 'ping', () => 'pong'); });
  const bad = fn('broken.setup', scope => { scope.register('commands', 'half', () => 1); scope.state.set({half: true}); scope.own({}, () => cleanup++); throw new Error('setup failed'); });
  const host = createHost({catalog: [module('sector.stable', [stableDefinition]), module('sector.broken', [bad])]}); await host.activate('sector.stable');
  await assert.rejects(host.activate('sector.broken'), /setup failed/); assert.equal(cleanup, 1); assert.equal(await host.dispatch(stable.id + ':ping'), 'pong'); assert.equal(host.registry('commands').length, 1); assert.deepEqual(host.exportState().functions, []); await host.dispose();
});

test('duplicate registrations and duplicate world providers roll back without destroying original service', async () => {
  const provider = fn('shared.owner', scope => { scope.provide('world.custody', {id: 1}); }, {provides: [{id: 'world.custody', version}]});
  const duplicate = fn('broken.duplicate', scope => { scope.register('ui', 'panel', {}); scope.register('ui', 'panel', {}); });
  const second = fn('broken.provider', scope => { scope.provide('world.custody', {id: 2}); }, {provides: [{id: 'world.custody', version}]});
  const host = createHost({catalog: [module('sector.shared', [provider]), module('sector.duplicate', [duplicate]), module('sector.provider', [second])]}); await host.activate('sector.shared');
  await assert.rejects(host.activate('sector.duplicate'), {code: 'duplicate_registration'}); await assert.rejects(host.activate('sector.provider'), {code: 'duplicate_service'});
  assert.equal(host.registry('ui').length, 0); assert.equal(host.status().services[0].owner, provider.id); await host.dispose();
});

test('removing during asynchronous setup cancels immediately and disposes late resources once', async () => {
  const ready = deferred(), late = deferred(); let disposed = 0, callbacks = 0, staleScope;
  const asyncFunction = fn('tourism.guide', async scope => { staleScope = scope; ready.resolve(); const callback = scope.guard(() => callbacks++); await scope.track(late.promise, () => disposed++); callback(); });
  const host = createHost({catalog: [module('sector.tourism', [asyncFunction])]}); const activation = host.activate('sector.tourism'); await ready.promise;
  const removal = host.remove('sector.tourism'); await assert.rejects(activation, {code: 'activation_cancelled'}); await removal;
  late.resolve({texture: 'late'}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1); assert.equal(callbacks, 0); assert.equal(staleScope.isCurrent(), false); assert.throws(() => staleScope.register('ui', 'late', {}), {code: 'scope_closed'});
  assert.deepEqual(host.status().functions, []); await host.dispose();
});

test('late returned cleanup after cancelled registration still runs', async () => {
  const ready = deferred(), late = deferred(); let cleanup = 0;
  const pending = fn('education.loader', async () => { ready.resolve(); await late.promise; return () => cleanup++; });
  const host = createHost({catalog: [module('sector.education', [pending])]}); const activation = host.activate('sector.education'); await ready.promise; const removal = host.remove('sector.education'); await assert.rejects(activation); await removal; late.resolve(); await new Promise(resolve => setImmediate(resolve)); assert.equal(cleanup, 1); await host.dispose();
});

test('held resource interlock blocks removal without losing its identity or inventory', async () => {
  const custody = {owner: 'robot.1', units: 12, mass: 25}, provider = fn('shared.cargo', scope => { scope.provide('world.custody', custody); }, {provides: [{id: 'world.custody', version}], canStop: () => custody.owner ? {allowed: false, reason: 'load held'} : true});
  const host = createHost({catalog: [module('sector.logistics', [provider])]}); await host.activate('sector.logistics');
  await assert.rejects(host.remove('sector.logistics'), {code: 'removal_blocked'}); assert.equal(host.status().services.length, 1); assert.equal(custody.owner, 'robot.1'); assert.equal(custody.units, 12);
  custody.owner = ''; await host.remove('sector.logistics'); assert.equal(host.status().services.length, 0); await host.dispose();
});

test('capabilities and declared service dependencies are enforced, not ambient context', async () => {
  let registerCalls = 0;
  const denied = fn('tourism.camera', () => registerCalls++, {capabilities: ['platform.camera']});
  const host = createHost({catalog: [module('sector.tourism', [denied])]}); await assert.rejects(host.activate('sector.tourism'), {code: 'capability_denied'}); assert.equal(registerCalls, 0); await host.dispose();
  const feature = fn('education.reader', scope => { assert.deepEqual(scope.port('platform.scene'), {read: true}); assert.throws(() => scope.port('platform.secrets'), {code: 'capability_denied'}); }, {capabilities: ['platform.scene']});
  const allowed = createHost({catalog: [module('sector.education', [feature])], grants: ['platform.scene'], ports: {'platform.scene': {read: true}, 'platform.secrets': {token: 'private'}}}); await allowed.activate('sector.education'); await allowed.dispose();
});

test('fixed-step ordering, pause, phase dependency cycles and dropped-time budget are deterministic', async () => {
  const order = [], first = fn('education.lesson', scope => { const a = scope.register('systems', 'input', {phase: 0, step() { order.push('input'); }}); scope.register('systems', 'model', {after: [a], phase: 1, step() { order.push('model'); }}); });
  const host = createHost({catalog: [module('sector.education', [first])]}); await host.activate('sector.education'); assert.equal(host.step(1 / 120), 0); assert.equal(host.step(1 / 120), 1); assert.deepEqual(order, ['input', 'model']); assert.equal(host.step(.5), 15); assert.equal(host.status().droppedSeconds, .25); await host.pause('sector.education'); const count = order.length; host.step(.1); assert.equal(order.length, count); await host.dispose();
  const cyclic = fn('broken.schedule', scope => { scope.register('systems', 'a', {after: ['broken.schedule:b'], step() {}}); scope.register('systems', 'b', {after: ['broken.schedule:a'], step() {}}); }); const bad = createHost({catalog: [module('sector.broken', [cyclic])]}); await assert.rejects(bad.activate('sector.broken'), {code: 'system_cycle'}); assert.equal(bad.registry('systems').length, 0); await bad.dispose();
});

test('unknown project components preserve data/schema/version/references and never execute JSON', async () => {
  const project = {format: 'smarttwin.project', version: 1, worldId: 'world.a', modules: [{id: 'sector.missing', version: '7.2.3'}], entities: [{id: 'actor-1', components: [{functionId: 'missing.guide', functionVersion: '7.2.3', type: 'missing.guide:route', schemaVersion: 9, data: {targetId: 'actor-2', nodes: {'0.1': {text: 'preserve'}}, load: 'https://host.invalid/code.js', javascript: 'globalThis.compromised=true'}, future: {keep: true}}]}], extension: {unknown: [1, 2]}};
  const restored = parseProject(serializeProject(project)); assert.deepEqual(restored, project); const host = createHost(); const inspected = host.inspectProject(restored); assert.equal(inspected.components[0].status, 'missing_function'); assert.deepEqual(inspected.project, project); assert.equal(globalThis.compromised, undefined); assert.equal(host.status().functions.length, 0); await host.dispose();
  assert.throws(() => createLocalCatalog([{id: 'sector.remote', version, functions: [{id: 'remote.code', version, load: 'https://host.invalid/evil.js'}]}]), {code: 'invalid_loader'});
});

test('module state roundtrips opaque missing functions and requires explicit versioned migration', async () => {
  const saved = {format: STATE_FORMAT, version: 1, worldId: 'world.saved', future: {unchanged: true}, functions: [{id: 'missing.inventory', version: '3.0.0', schemaVersion: 8, data: {loadId: 'load-1', ownerId: 'robot-1'}, untouched: 42}]};
  const host = createHost({worldId: saved.worldId}); assert.deepEqual(host.importState(saved), saved); assert.deepEqual(host.exportState(), saved); await host.dispose();
  const feature = fn('education.counter', scope => { const previous = scope.state.get(); scope.state.set({count: previous ? previous.count + 1 : 1}); });
  const app = createHost({worldId: saved.worldId, catalog: [module('sector.education', [feature])]}); app.importState({format: STATE_FORMAT, version: 1, worldId: saved.worldId, functions: [{id: feature.id, version: '0.9.0', schemaVersion: 1, data: {count: 4}}]}); await assert.rejects(app.activate('sector.education'), {code: 'state_migration_required'}); assert.equal(app.exportState().functions[0].data.count, 4);
  app.migrateState(feature.id, entry => ({...entry, version})); await app.activate('sector.education'); assert.equal(app.exportState().functions[0].data.count, 5); await app.remove('sector.education'); assert.equal(app.exportState().functions[0].data.count, 5); await app.dispose();
});

test('copying a local function creates a namespace/provenance fork without mutating the source', async () => {
  const source = fn('logistics.scanner', scope => { scope.register('commands', 'scan', () => ({kind: scope.id})); scope.register('components', 'settings', {schemaVersion: 1, validate: value => typeof value.label === 'string'}); }, {metadata: {assets: ['icons/scanner.svg'], serverSchema: 'settings-v1', tests: ['scanner-contract']}});
  const copy = forkFunction(source, {id: 'agriculture.harvest-scanner', version: '1.0.1'});
  assert.equal(source.id, 'logistics.scanner'); assert.equal(copy.origin.functionId, source.id); assert.deepEqual(copy.metadata, source.metadata);
  const host = createHost({catalog: [module('sector.logistics', [source]), module('sector.agriculture', [copy])]}); await host.activate('sector.agriculture');
  assert.deepEqual(host.status().functions.map(item => item.id), [copy.id]); assert.deepEqual(await host.dispatch(copy.id + ':scan'), {kind: copy.id}); await host.activate('sector.logistics'); assert.deepEqual(await host.dispatch(source.id + ':scan'), {kind: source.id});
  await host.remove('sector.agriculture'); assert.deepEqual(await host.dispatch(source.id + ':scan'), {kind: source.id}); await host.dispose();
});

test('stale async command rejects after removal; cleanup continues even when one resource throws', async () => {
  const done = deferred(); let cleanup = 0;
  const feature = fn('tourism.guide', scope => { scope.register('commands', 'wait', () => done.promise); scope.onDispose(() => cleanup++); scope.onDispose(() => { throw new Error('one cleanup failed'); }); });
  const host = createHost({catalog: [module('sector.tourism', [feature])]}); await host.activate('sector.tourism'); const command = host.dispatch(feature.id + ':wait'); const rejection = assert.rejects(command, {code: 'activation_cancelled'});
  await assert.rejects(host.remove('sector.tourism'), AggregateError); await rejection; assert.equal(cleanup, 1); assert.deepEqual(host.status().functions, []); done.resolve('stale'); await host.dispose();
});

test('JSON boundaries reject accessors, prototype pollution, nonfinite values and lossy arrays', () => {
  let getters = 0; const object = {}; Object.defineProperty(object, 'secret', {enumerable: true, get() { getters++; return 1; }}); assert.throws(() => cloneData(object), {code: 'invalid_data'}); assert.equal(getters, 0);
  assert.throws(() => cloneData(JSON.parse('{"__proto__":{"polluted":true}}')), {code: 'unsafe_key'}); assert.equal({}.polluted, undefined);
  assert.throws(() => cloneData({x: Infinity}), {code: 'invalid_data'}); assert.throws(() => cloneData({x() {}}), {code: 'invalid_data'}); const array = [1]; array.extra = 2; assert.throws(() => cloneData(array), {code: 'invalid_data'}); assert.throws(() => cloneData(new Array(2)), {code: 'invalid_data'});
});

test('JSON data rejects leading, interior and trailing array holes before they can serialize as null', () => {
  for (const index of [0, 1, 2]) {
    const values = [1, 2, 3]; delete values[index];
    assert.throws(() => cloneData({values}), {code: 'invalid_data'}, `Missing array item ${index} must be rejected.`);
    assert.equal(Object.hasOwn(values, index), false, 'Validation must not fill a missing item.');
  }
  const dense = {values: [null, 2, null]};
  assert.deepEqual(cloneData(dense), dense);
  assert.equal(JSON.stringify(cloneData(dense)), JSON.stringify(dense));
});

test('a failed new consumer start restores its existing provider to the previous paused state', async () => {
  const events = []; let running = false;
  const provider = fn('shared.provider', () => {}, {start() { running = true; }, pause() { running = false; events.push('pause'); }, resume() { running = true; events.push('resume'); }});
  const consumer = fn('broken.consumer', () => {}, {requires: [{id: provider.id, version}], start() { assert.equal(running, true, 'Provider must resume before starting its new consumer'); throw new Error('consumer failed'); }});
  const catalog = [module('sector.shared', [provider]), module('sector.consumer', [consumer])];
  assert.deepEqual(requireClosure(catalog, 'sector.consumer').map(entry => entry.id), [provider.id, consumer.id]);
  const host = createHost({catalog}); await host.activate('sector.shared'); await host.pause('sector.shared'); await assert.rejects(host.activate('sector.consumer'), /consumer failed/);
  assert.deepEqual(events, ['pause', 'resume', 'pause']); assert.equal(running, false); assert.deepEqual(host.status().modules.map(item => item.status), ['paused']); assert.deepEqual(host.status().functions.map(item => item.id), [provider.id]); await host.dispose();
});
