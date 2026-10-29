const __layout = require("../../tooling/layout.cjs");
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-project-sync.js"), '../src/editor/ProjectSync.js')), 'utf8')
  .replace('export default class ProjectSync', 'class ProjectSync');
const ProjectSync = new Function(source + '\nreturn ProjectSync;')();

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { if (listeners.has(type)) listeners.get(type).delete(listener); },
    dispatch(type, event = {}) { for (const listener of listeners.get(type) || []) listener(event); }
  };
}

function browser() {
  const document = Object.assign(eventTarget(), {visibilityState: 'visible'});
  const window = Object.assign(eventTarget(), {document});
  const timers = new Map();
  const writes = [];
  let nextTimer = 1;
  window.setInterval = (callback, ms) => { const id = nextTimer++; timers.set(id, {callback, ms}); return id; };
  window.clearInterval = id => timers.delete(id);
  window.localStorage = {setItem: (key, value) => writes.push({key, newValue: value})};
  return {window, document, timers, writes, tick() { for (const timer of timers.values()) timer.callback(); }};
}

const clone = value => JSON.parse(JSON.stringify(value));
function storedProject(id = 'shared-project', revision = 1) {
  return {id, name: 'Banda transportadora', revision, document: {rooms: {hall: {additions: [{id: 'conveyor', speed: revision}]}}}};
}

function harness(options = {}) {
  const server = options.server || {project: storedProject()};
  const surface = options.surface || browser();
  const calls = {list: 0, get: 0, refresh: [], remote: [], errors: []};
  let state = {project: {id: server.project.id, revision: server.project.revision}, active: true, dirty: false};
  const client = options.client || {
    async listProjects() { calls.list++; const {document, ...metadata} = server.project; return [clone(metadata)]; },
    async getProject(id) { calls.get++; assert.equal(id, server.project.id); return clone(server.project); }
  };
  const sync = new ProjectSync({
    client, getState: () => state, window: surface.window, document: surface.document,
    onRefresh: async (project, expected) => {
      calls.refresh.push({project, expected});
      if (options.onRefresh) return options.onRefresh(project, expected);
      state.project = {id: project.id, revision: project.revision};
      state.loadedDocument = project.document;
      return true;
    },
    onRemoteChange: project => calls.remote.push(project),
    onError: error => calls.errors.push(error)
  });
  return {sync, calls, surface, server, client, get state() { return state; }, set state(next) { state = next; }};
}

async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

async function run() {
  // Separate browsers have separate localStorage, so polling the shared SQLite API
  // remains necessary even when immediate storage notifications are available.
  const server = {project: storedProject()};
  const first = harness({server}), second = harness({server});
  await Promise.all([first.sync.start(), second.sync.start()]);
  assert.equal(first.calls.get + second.calls.get, 0, 'Unchanged metadata must not download the scene.');
  assert.equal(second.surface.timers.size, 1);
  assert.equal([...second.surface.timers.values()][0].ms, 5000);
  server.project = storedProject('shared-project', 2);
  first.state.project.revision = 2;
  first.sync.publish(server.project);
  assert.equal(second.state.project.revision, 1, 'Different browsers cannot share localStorage.');
  second.surface.tick();
  await settle();
  assert.equal(second.state.project.revision, 2);
  assert.equal(second.state.loadedDocument.rooms.hall.additions[0].speed, 2);
  assert.deepEqual(second.calls.refresh[0].expected, {id: 'shared-project', revision: 1});
  assert.deepEqual(second.calls.remote.map(project => project && project.revision), [2, null]);
  await second.sync.check();
  assert.equal(second.calls.get, 1, 'A revision must only be downloaded once after it has been applied.');

  // Same-browser tabs can check immediately after a save. Only metadata goes into
  // localStorage; the authoritative scene is still loaded from the API.
  server.project = storedProject('shared-project', 3);
  first.state.project.revision = 3;
  first.sync.publish(server.project);
  const publication = first.surface.writes[first.surface.writes.length - 1];
  const payload = JSON.parse(publication.newValue);
  assert.equal(payload.document, undefined);
  second.surface.window.dispatch('storage', publication);
  await settle();
  assert.equal(second.state.project.revision, 3);
  const listCount = second.calls.list;
  second.surface.window.dispatch('storage', {key: publication.key, newValue: '{broken'});
  second.surface.window.dispatch('storage', {key: 'unrelated', newValue: publication.newValue});
  second.surface.window.dispatch('storage', {key: publication.key, newValue: JSON.stringify({id: 'other', revision: 100})});
  second.surface.window.dispatch('storage', publication);
  await settle();
  assert.equal(second.calls.list, listCount, 'Irrelevant, malformed and already-applied notifications are ignored.');
  server.project = storedProject('shared-project', 4);
  second.surface.document.visibilityState = 'hidden';
  second.surface.document.dispatch('visibilitychange');
  assert.equal(second.calls.list, listCount);
  second.surface.document.visibilityState = 'visible';
  second.surface.document.dispatch('visibilitychange');
  await settle();
  assert.equal(second.state.project.revision, 4);
  server.project = storedProject('shared-project', 5);
  second.surface.window.dispatch('focus');
  await settle();
  assert.equal(second.state.project.revision, 5);
  first.sync.stop(); second.sync.stop();

  // Keep drafts, ongoing operations, historical revisions and running VR intact.
  for (const [flag, value] of [['dirty', true], ['busy', true], ['loading', true], ['transaction', true], ['pinned', true], ['active', false], ['vrMode', true]]) {
    const fixture = harness();
    await fixture.sync.start();
    fixture.state[flag] = value;
    fixture.server.project = storedProject('shared-project', 2);
    await fixture.sync.check();
    await fixture.sync.check();
    assert.equal(fixture.calls.get, 0, flag + ' must not trigger an automatic scene replacement.');
    assert.equal(fixture.state.project.revision, 1);
    assert.deepEqual(fixture.calls.remote.map(project => project && project.revision), [2], 'Repeated polling must not repeat the same notification.');
    fixture.state[flag] = flag === 'active' ? true : false;
    await fixture.sync.check();
    assert.equal(fixture.state.project.revision, 2, 'A clean editor should refresh once ' + flag + ' no longer blocks it.');
    assert.deepEqual(fixture.calls.remote.map(project => project && project.revision), [2, null]);
    fixture.sync.stop();
  }

  const unopened = harness();
  unopened.state.project = null;
  await unopened.sync.start();
  assert.equal(unopened.calls.list, 0, 'A new editor must not silently choose a project.');
  unopened.state.project = {id: 'a-different-project', revision: 1};
  await unopened.sync.check();
  assert.equal(unopened.calls.get, 0, 'Polling must not switch to another project.');
  unopened.sync.stop();

  // A pristine default editor opened before the first save may explicitly opt
  // into discovering the latest project. Once bound, it keeps that project ID.
  const discovery = harness();
  discovery.state.project = null;
  discovery.state.allowDiscover = true;
  discovery.server.project = null;
  discovery.client.listProjects = async () => {
    discovery.calls.list++;
    if (!discovery.server.project) return [];
    const {document, ...metadata} = discovery.server.project;
    return [metadata];
  };
  await discovery.sync.start();
  assert.equal(discovery.state.project, null);
  discovery.server.project = storedProject('newly-saved-project', 1);
  discovery.surface.tick();
  await settle();
  assert.equal(discovery.state.project.id, 'newly-saved-project');
  assert.deepEqual(discovery.calls.refresh[0].expected, {id: null, revision: null});
  discovery.server.project = storedProject('another-new-project', 10);
  await discovery.sync.check();
  assert.equal(discovery.state.project.id, 'newly-saved-project', 'Discovery must never switch an already-bound tab to a newer project.');
  discovery.sync.stop();

  const dirtyDiscovery = harness();
  dirtyDiscovery.state.project = null;
  dirtyDiscovery.state.allowDiscover = true;
  dirtyDiscovery.state.dirty = true;
  await dirtyDiscovery.sync.start();
  assert.equal(dirtyDiscovery.calls.get, 0, 'Discovery must not overwrite an unsaved scene.');
  assert.equal(dirtyDiscovery.state.project, null);
  assert.deepEqual(dirtyDiscovery.calls.remote.map(project => project && project.revision), [1]);
  dirtyDiscovery.state.dirty = false;
  dirtyDiscovery.state.allowDiscover = false;
  await dirtyDiscovery.sync.check();
  assert.equal(dirtyDiscovery.calls.get, 0, 'A scene that is no longer eligible for discovery stays unbound.');
  assert.equal(dirtyDiscovery.calls.remote[dirtyDiscovery.calls.remote.length - 1], null);
  dirtyDiscovery.sync.stop();

  for (const race of ['dirty', 'bound', 'allowDiscover']) {
    const fetch = deferred();
    const fixture = harness();
    fixture.state.project = null;
    fixture.state.allowDiscover = true;
    fixture.client.getProject = () => fetch.promise;
    const request = fixture.sync.start();
    await settle();
    if (race === 'bound') fixture.state.project = {id: 'other', revision: 1};
    else fixture.state[race] = race === 'dirty';
    fetch.resolve(storedProject());
    await request;
    assert.equal(fixture.calls.refresh.length, 0, 'Discovery must recheck ' + race + ' after downloading.');
    fixture.sync.stop();
  }

  // A slow download must not overwrite work made after the metadata request.
  for (const race of ['dirty', 'busy', 'loading', 'transaction', 'pinned', 'vrMode', 'runtime', 'project', 'revision', 'stopped']) {
    const fetch = deferred();
    const fixture = harness();
    await fixture.sync.start();
    fixture.server.project = storedProject('shared-project', 2);
    fixture.client.getProject = async () => { fixture.calls.get++; return fetch.promise; };
    const request = fixture.sync.check();
    await settle();
    assert.equal(fixture.calls.get, 1);
    if (race === 'project') fixture.state.project = {id: 'other-project', revision: 1};
    else if (race === 'revision') fixture.state.project.revision = 3;
    else if (race === 'runtime') fixture.state.active = false;
    else if (race === 'stopped') fixture.sync.stop();
    else fixture.state[race] = true;
    fetch.resolve(storedProject('shared-project', 2));
    await request;
    assert.equal(fixture.calls.refresh.length, 0, 'The ' + race + ' race must be checked again after the download.');
    fixture.sync.stop();
  }

  const metadata = deferred();
  const pendingList = harness({client: {listProjects: () => metadata.promise, getProject: () => assert.fail('The old project must not be downloaded.')}});
  const initial = pendingList.sync.start();
  assert.equal(pendingList.sync.check(), initial, 'Concurrent triggers must share one pending check.');
  pendingList.state.project = {id: 'other', revision: 1};
  metadata.resolve([{id: 'shared-project', revision: 2}]);
  await initial;
  assert.equal(pendingList.calls.refresh.length, 0);
  pendingList.sync.stop();

  // The scene loader owns its final transactional guard. If it refuses to apply,
  // retain the available revision so the user can explicitly load it later.
  const refused = harness({onRefresh: () => false});
  await refused.sync.start();
  refused.server.project = storedProject('shared-project', 2);
  assert.equal(await refused.sync.check(), false);
  assert.equal(refused.state.project.revision, 1);
  assert.deepEqual(refused.calls.remote.map(project => project && project.revision), [2]);
  refused.sync.stop();

  const failures = harness();
  await failures.sync.start();
  const successfulList = failures.client.listProjects;
  failures.client.listProjects = async () => { throw new Error('Network unavailable'); };
  await failures.sync.check(); await failures.sync.check();
  assert.equal(failures.calls.errors.length, 1, 'A disconnected server must not emit an error every five seconds.');
  failures.client.listProjects = successfulList;
  await failures.sync.check();
  failures.client.listProjects = async () => { throw new Error('Network unavailable again'); };
  await failures.sync.check();
  assert.equal(failures.calls.errors.length, 2, 'A new outage may be reported after a successful retry.');
  failures.surface.window.localStorage = {setItem() { throw new Error('Storage disabled'); }};
  assert.doesNotThrow(() => failures.sync.publish(storedProject()));
  failures.sync.stop();
  assert.equal(failures.surface.timers.size, 0);
  for (const listeners of failures.surface.window.listeners.values()) assert.equal(listeners.size, 0);
  for (const listeners of failures.surface.document.listeners.values()) assert.equal(listeners.size, 0);
  const beforeStop = failures.calls.errors.length;
  failures.surface.tick(); failures.surface.window.dispatch('focus');
  await failures.sync.check();
  assert.equal(failures.calls.errors.length, beforeStop);

  // No global timer is created by a consumer whose supplied window has no timers.
  const headless = new ProjectSync({client: {listProjects: async () => []}, getState: () => ({project: null}), window: {}});
  await headless.start();
  assert.equal(headless.timer, undefined);
  headless.stop();
  console.log('Project sync: cross-browser polling, pristine-tab discovery, tab/focus notifications, unchanged metadata, draft/VR safeguards, asynchronous races, retries and cleanup passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
