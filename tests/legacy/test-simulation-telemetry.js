const __layout = require("../../tooling/layout.cjs");
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {once} = require('node:events');
const {DatabaseSync} = require('node:sqlite');
const {ProjectStore} = require('../../apps/api/server/storage');
const {createApiHandler} = require('../../apps/api/server/api');
let authenticationCookie = '';
const authenticatedFetch = (url, options = {}) => global.fetch(url, Object.assign({}, options, {headers: Object.assign({}, options.headers || {}, authenticationCookie ? {Cookie: authenticationCookie} : {})}));

function browserModule(filename, names) {
  const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-simulation-telemetry.js"), '../src/editor/', filename)), 'utf8')
    .replace(/export default class /g, 'class ').replace(/export function /g, 'function ');
  return new Function('fetch', source + '\nreturn {' + names.join(',') + '};')(authenticatedFetch);
}
const {TelemetryRecorder, csv} = browserModule('TelemetryRecorder.js', ['TelemetryRecorder', 'csv']);
const {TelemetryClient} = browserModule('TelemetryClient.js', ['TelemetryClient']);
const clone = value => JSON.parse(JSON.stringify(value));
const document = {format: 'hello-webxr-editor', version: 1, rooms: {hall: {overrides: [], additions: []}}, imports: []};
function runFixture() {
  return {projectRevision: 1, roomId: 'hall', startedAt: '2026-10-22T12:00:00.000Z', endedAt: '2026-10-22T12:00:02.000Z', duration: 2,
    samples: [{time: 0, objectId: 'custom-band', variables: {speed: 1.5, running: true}},
      {time: 2, objectId: 'custom-band/0.1', variables: {speed: 0, running: false}}],
    events: [{time: 1, objectId: 'native:hall:root.0', type: 'sensor.enter', message: 'Paquete detectado'}]};
}

async function main() {
  const recorder = new TelemetryRecorder();
  const object = (id, interval = 1, speed = 1) => ({id, analyticsInterval: interval, variables: {speed, running: true}});
  const event = {id: 1, time: 10.5, objectId: 'custom-band', type: 'sensor.enter', message: 'Entrada'};
  assert.equal(recorder.stop(), null);
  recorder.start({projectRevision: 1, roomId: 'hall'}, {time: 10, objects: [object('custom-band'), {id: 'not-recorded', variables: {speed: 1}}]});
  assert.equal(recorder.payload.samples.length, 1);
  recorder.capture({time: 10.5, objects: [object('custom-band')], events: [event]});
  recorder.capture({time: 11, objects: [object('custom-band', 1, 2), {id: 'no-analytics', variables: {speed: 10}}], events: [event]});
  recorder.capture({time: 10.8, objects: [object('custom-band')], events: [event]});
  const recorded = recorder.stop({time: 12, objects: [object('custom-band', 1, 3)], events: [event]});
  assert.equal(recorded.duration, 2);
  assert.deepEqual(recorded.samples.filter(row => row.objectId === 'custom-band').map(row => row.time), [0, 1, 2]);
  assert.equal(recorded.events.length, 1);
  assert.equal(recorded.events[0].time, 0.5);
  assert.equal(recorded.samples.some(row => row.objectId === 'no-analytics'), false);
  recorded.samples[0].variables.speed = 999;
  assert.equal(recorder.payload.samples[0].variables.speed, 1, 'Consumers cannot mutate stored recording snapshots.');
  const bounded = new TelemetryRecorder({maxSamples: 2, maxEvents: 2});
  bounded.start({projectRevision: 1, roomId: 'hall'}, {time: 0, objects: [object('custom-band')]});
  bounded.capture({time: 1, objects: [object('custom-band')]});
  assert.equal(bounded.active, false);
  assert.equal(bounded.limitReached, true);
  assert.equal(bounded.stop().samples.length, 2);
  bounded.capture({time: 2, objects: [object('custom-band')]});
  assert.equal(bounded.payload.duration, 1);
  const eventsOnly = new TelemetryRecorder({maxEvents: 1});
  eventsOnly.start({projectRevision: 1, roomId: 'hall'}, {time: 10});
  eventsOnly.capture({time: 11, events: [event, Object.assign({}, event, {id: 2, time: 11})]});
  assert.equal(eventsOnly.payload.events.length, 1);
  assert.equal(eventsOnly.active, false);
  assert.equal(eventsOnly.limitReached, true);
  const csvData = csv({samples: [{time: 0, objectId: 'custom-band', variables: {speed: -3, running: false}}],
    events: [{time: 1, objectId: 'custom-band', type: 'message', message: '=HYPERLINK("bad")\nline,2'}]});
  assert(csvData.startsWith('\ufeff"kind","time"'));
  assert(csvData.includes('"-3"'));
  assert(csvData.includes('"\'=HYPERLINK(""bad"")\nline,2"'));

  const directory = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'hello-webxr-telemetry-test-')));
  let store, handler, server;
  try {
    // Create a database with the previous schema to verify additive migration.
    const legacy = new DatabaseSync(__layout.map(path.join(directory, 'projects.sqlite')));
    legacy.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE revisions(project_id TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,name TEXT NOT NULL,document TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,revision));
      CREATE TABLE assets(hash TEXT PRIMARY KEY,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL); PRAGMA user_version = 1;`);
    legacy.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run('legacy-project', 'Proyecto existente', 1, '2026-10-21', '2026-10-21');
    legacy.prepare('INSERT INTO revisions VALUES(?,?,?,?,?)').run('legacy-project', 1, 'Proyecto existente', JSON.stringify(document), '2026-10-21');
    legacy.close();
    store = new ProjectStore({dataDir: directory});
    assert.equal(store.getProject('legacy-project').name, 'Proyecto existente');
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 2);
    const project = store.saveProject(null, {name: 'Banda transportadora', document});
    const payload = runFixture();
    const saved = store.saveSimulationRun(project.id, payload);
    assert.deepEqual(saved.samples, payload.samples);
    assert.deepEqual(saved.events, payload.events);
    assert.equal(saved.sampleCount, 2);
    assert.equal(saved.projectRevision, 1);
    assert.equal(store.listSimulationRuns(project.id)[0].id, saved.id);
    assert.equal(store.listSimulationRuns(project.id)[0].samples, undefined);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM simulation_samples').get().n, 2);
    const invalid = (change, status = 400) => {
      const input = runFixture();
      change(input);
      assert.throws(() => store.saveSimulationRun(project.id, input), error => error.status === status);
      assert.equal(store.listSimulationRuns(project.id).length, 1, 'Invalid payloads cannot partially create runs.');
    };
    invalid(data => { data.samples[0].variables.speed = Infinity; });
    invalid(data => { data.samples[0].variables = {speed: '1'}; });
    invalid(data => { data.samples[0].objectId = '../outside'; });
    invalid(data => { data.samples[1].time = -1; });
    invalid(data => { data.samples[1].time = 3; });
    invalid(data => { data.samples.reverse(); });
    invalid(data => { data.events[0].type = '=unsafe'; });
    invalid(data => { data.events[0].time = NaN; });
    invalid(data => { data.duration = 0; });
    invalid(data => { data.endedAt = '2026-10-21T12:00:00.000Z'; });
    invalid(data => { data.projectRevision = 999; });
    invalid(data => { data.roomId = 'sound'; });
    invalid(data => { data.samples = Array.from({length: 5001}, () => clone(data.samples[0])); }, 413);
    invalid(data => { data.events = Array.from({length: 2001}, () => clone(data.events[0])); }, 413);
    invalid(data => { data.samples[0].variables = JSON.parse('{"__proto__":1}'); });
    store.saveProject(project.id, {name: 'Banda actualizada', document, expectedRevision: 1});
    const historic = store.saveSimulationRun(project.id, payload);
    assert.equal(historic.projectRevision, 1, 'Recordings may refer to a valid historical revision.');
    const other = store.saveProject(null, {name: 'Otro proyecto', document});
    assert.throws(() => store.getSimulationRun(other.id, saved.id), error => error.status === 404);
    store.close(); store = null;
    store = new ProjectStore({dataDir: directory});
    assert.deepEqual(store.getSimulationRun(project.id, saved.id), saved, 'Samples and events survive restart.');
    assert.equal(store.getProject('legacy-project').name, 'Proyecto existente');
    store.close(); store = null;

    handler = createApiHandler({allowBootstrapRegistration:true, publicSceneId:null, requireSecureCookies:false, dataDir: directory, maintenanceIntervalMs: 0});
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    const auth = await fetch(origin + '/api/studio/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'telemetry_fixture_admin', password: 'Private telemetry fixture password 123!'})});
    assert.equal(auth.status, 201); authenticationCookie = auth.headers.get('set-cookie').split(';')[0];
    const client = new TelemetryClient(origin + '/api');
    assert.equal((await client.list(project.id)).length, 2);
    assert.deepEqual(await client.get(project.id, saved.id), saved);
    const httpSaved = await client.save(project.id, payload);
    assert.equal(httpSaved.samples.length, 2);
    assert.equal((await client.list(project.id)).length, 3);
    await assert.rejects(client.get(other.id, saved.id), error => error.status === 404);
    await assert.rejects(client.save(project.id, Object.assign({}, payload, {projectRevision: 999})), error => error.status === 400);
    const stripped = await authenticatedFetch(origin + '/projects/' + project.id + '/runs');
    assert.equal(stripped.status, 200);
    assert.equal((await stripped.json()).runs.length, 3);
    const refused = await fetch(origin + '/api/projects/' + project.id + '/runs', {method: 'POST',
      headers: {'Content-Type': 'application/json', Origin: 'https://other.invalid'}, body: JSON.stringify(payload)});
    assert.equal(refused.status, 403);
    assert.equal((await client.list(project.id)).length, 3);
    console.log('Simulation telemetry: bounded recording, interval sampling, deduplication, safe CSV, additive SQLite migration, revision-linked persistence and HTTP API passed.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (handler) handler.close();
    if (store) store.close();
    const target = __layout.map(path.resolve(directory));
    assert.equal(path.dirname(target), __layout.map(path.resolve(os.tmpdir())));
    assert(path.basename(target).startsWith('hello-webxr-telemetry-test-'));
    fs.rmSync(target, {recursive: true, force: true});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
