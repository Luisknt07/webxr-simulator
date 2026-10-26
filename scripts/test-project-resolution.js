'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createApiHandler} = require('../server/api');
let authenticationCookie = '';
const authenticatedFetch = (url, options = {}) => global.fetch(url, Object.assign({}, options, {headers: Object.assign({}, options.headers || {}, authenticationCookie ? {Cookie: authenticationCookie} : {})}));

const resolverSource = fs.readFileSync(path.join(__dirname, '../src/editor/ProjectResolver.js'), 'utf8')
  .replace('export default async function resolveProject', 'async function resolveProject');
const resolveProject = new Function(resolverSource + '\nreturn resolveProject;')();
const clientSource = fs.readFileSync(path.join(__dirname, '../src/editor/ProjectClient.js'), 'utf8')
  .replace(/^import[^\n]+\n/gm, '')
  .replace('export default class ProjectClient', 'class ProjectClient');
const ProjectClient = new Function('fetch', 'MAX_ASSET_BYTES', clientSource + '\nreturn ProjectClient;')(
  authenticatedFetch, require('../shared/asset-limits').MAX_ASSET_BYTES);

function failure(status, message = 'Project load failed') {
  return Object.assign(new Error(message), status === undefined ? {} : {status});
}

function fixture(options = {}) {
  const projects = options.projects || [{id: 'recent'}, {id: 'older'}, {id: 'oldest'}];
  const calls = [];
  return {
    calls,
    async listProjects() { calls.push(['list']); if (options.listError) throw options.listError; return projects; },
    async getProject(id) {
      calls.push(['get', id]);
      if (options.errors && options.errors[id]) throw options.errors[id];
      return {id, revision: 2, document: {rooms: {hall: {additions: [{id: 'saved-conveyor'}]}}}};
    }
  };
}

async function testResolution() {
  let client = fixture();
  let result = await resolveProject(client, {explicitId: 'older', rememberedId: 'recent', hasLocalBackup: true});
  assert.equal(result.project.id, 'older');
  assert.equal(result.source, 'url');
  assert.deepEqual(client.calls, [['get', 'older']], 'An explicit link stays pinned to its project');

  const missing = failure(404);
  client = fixture({errors: {missing}});
  await assert.rejects(() => resolveProject(client, {explicitId: 'missing', rememberedId: 'recent'}), error => error === missing);
  assert.deepEqual(client.calls, [['get', 'missing']], 'An invalid explicit link must never open a different project');

  client = fixture({errors: {'': missing}});
  await assert.rejects(() => resolveProject(client, {explicitId: ''}), error => error === missing);
  assert.deepEqual(client.calls, [['get', '']], 'An explicitly empty link is not treated as an absent project');

  client = fixture();
  result = await resolveProject(client, {rememberedId: 'older', hasLocalBackup: true});
  assert.equal(result.project.id, 'older');
  assert.equal(result.source, 'remembered');
  assert.deepEqual(client.calls, [['get', 'older']]);

  client = fixture();
  assert.deepEqual(await resolveProject(client, {hasLocalBackup: true}), {project: null, source: 'none'});
  assert.deepEqual(client.calls, [], 'An unsaved browser backup has priority over recent projects');

  client = fixture({errors: {missing}});
  result = await resolveProject(client, {rememberedId: 'missing'});
  assert.equal(result.project.id, 'recent');
  assert.equal(result.source, 'recent');
  assert.deepEqual(client.calls, [['get', 'missing'], ['list'], ['get', 'recent']]);

  client = fixture({errors: {missing}});
  assert.deepEqual(await resolveProject(client, {rememberedId: 'missing', hasLocalBackup: true}), {project: null, source: 'none'});
  assert.deepEqual(client.calls, [['get', 'missing']], 'A stale remembered pointer must not discard a local backup');

  for (const status of [undefined, 403, 500]) {
    const unavailable = failure(status);
    client = fixture({errors: {older: unavailable}});
    await assert.rejects(() => resolveProject(client, {rememberedId: 'older'}), error => error === unavailable);
    assert.deepEqual(client.calls, [['get', 'older']], 'An outage must not select a different project');
  }
  const offline = failure(undefined, 'Offline');
  client = fixture({listError: offline});
  await assert.rejects(() => resolveProject(client), error => error === offline);

  client = fixture({projects: []});
  assert.deepEqual(await resolveProject(client), {project: null, source: 'none'});
  assert.deepEqual(client.calls, [['list']]);

  client = fixture({errors: {recent: missing}});
  result = await resolveProject(client);
  assert.equal(result.project.id, 'older');
  assert.deepEqual(client.calls, [['list'], ['get', 'recent'], ['get', 'older']], 'A deletion race tries only the next project');

  client = fixture({errors: {recent: missing, older: missing}});
  await assert.rejects(() => resolveProject(client), error => error === missing);
  assert.deepEqual(client.calls, [['list'], ['get', 'recent'], ['get', 'older']], 'Loading failures must not walk every unrelated project');
  client = fixture({projects: [{id: 'recent'}], errors: {recent: missing}});
  await assert.rejects(() => resolveProject(client), error => error === missing);
}

function scene(x) {
  return {format: 'hello-webxr-editor', version: 1, imports: [], rooms: {hall: {
    overrides: [], additions: [{id: 'custom-shared', name: 'Banda compartida', descriptor: {prefab: 'conveyor'},
      position: [x, 1, -4], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], visible: true,
      behaviors: [{type: 'conveyor', enabled: true, axis: 'x', length: 4, width: 1, speed: 0.6, running: true, spawnInterval: 3, maxPackages: 20}]}]
  }}};
}

async function testIndependentClients() {
  const temporaryRoot = path.resolve(os.tmpdir());
  const dataDir = fs.mkdtempSync(path.join(temporaryRoot, 'hello-webxr-project-resolution-'));
  const handler = createApiHandler({dataDir, maintenanceIntervalMs: 0});
  const server = http.createServer(handler);
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = 'http://127.0.0.1:' + server.address().port + '/api';
    const auth = await fetch(base + '/studio/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'resolution_fixture_admin', password: 'Private project resolution fixture 123!'})});
    assert.equal(auth.status, 201); const identity = (await auth.json()).user;
    authenticationCookie = auth.headers.get('set-cookie').split(';')[0];
    // Neither client has localStorage or shares any remembered project state.
    const firstBrowser = new ProjectClient(base), otherBrowser = new ProjectClient(base);
    firstBrowser.identityProvider = otherBrowser.identityProvider = () => identity.id;
    const created = await firstBrowser.createProject('Equipo compartido', scene(2));
    const saved = await firstBrowser.updateProject(created.id, created.name, scene(5), created.revision);
    const first = await resolveProject(firstBrowser);
    const other = await resolveProject(otherBrowser);
    assert.equal(first.source, 'recent'); assert.equal(other.source, 'recent');
    assert.deepEqual(first.project, saved);
    assert.deepEqual(other.project, saved, 'A fresh browser opens the saved SQLite scene with its latest changes');
    assert.equal(other.project.document.rooms.hall.additions[0].position[0], 5);
    assert.equal(other.project.document.rooms.hall.additions[0].behaviors[0].speed, 0.6);
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    handler.close();
    // Only remove this test's verified temporary directory.
    assert.equal(path.dirname(dataDir), temporaryRoot);
    assert.ok(path.basename(dataDir).startsWith('hello-webxr-project-resolution-'));
    fs.rmSync(dataDir, {recursive: true, force: true});
  }
}

testResolution().then(testIndependentClients).then(() => {
  console.log('PASS project resolution: explicit and remembered links, protected drafts, fresh independent browsers, SQLite latest revision and failure handling.');
}).catch(error => { console.error(error); process.exitCode = 1; });
