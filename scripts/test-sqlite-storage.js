'use strict';

// Integration tests use real SQLite files and an ephemeral HTTP server; no WebGL required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {once} = require('node:events');
const {ProjectStore} = require('../server/storage');
const {createApiHandler} = require('../server/api');
const {validateDocument} = require('../server/validation');

const clone = value => JSON.parse(JSON.stringify(value));
const bytes = Buffer.from('scene-binary-fixture-0123456789');
function documentFixture() {
  return {
    format: 'hello-webxr-editor', version: 1,
    rooms: {hall: {
      overrides: [{id: 'native:hall:root.0', position: [2, 0, 0], visible: false,
        behaviors: [{type: 'portal', room: 2}], visual: {importId: 'batch-test-1'}}],
      additions: [{
        id: 'custom-fixture', name: 'Modelo importado', descriptor: {importId: 'batch-test-1'},
        interaction: {type: 'room', room: 1}, behaviors: [{type: 'sound', asset: 'batch-test-1', volume: 0.7}, {type: 'collision', enabled: true, mode: 'trigger'}],
        visual: {type: 'sphere', color: '#ffffff'},
        position: [0, 1, -2], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], visible: true, color: null
      }, {
        id: 'custom-native-copy', name: 'Instrumento copia', descriptor: {nativeId: 'native:hall:root.1'},
        position: [3, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1],
        behaviors: [{type: 'grab'}], nodes: {'0': {
          name: 'Nota', position: [0, 1, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1],
          behaviors: [{type: 'note', asset: 'ogg/xylophone1.ogg', volume: 0.4}], visual: {importId: 'batch-test-1'},
          interaction: {type: 'toggle', targetId: 'custom-fixture', discarded: 'not part of the interaction schema'}
        }}
      }, {
        id: 'custom-decal', name: 'Señal', descriptor: {type: 'decal'},
        position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [1, 1, 1],
        behaviors: [{type: 'decal', asset: 'paintings/sign.png', targetId: 'native:hall:root.0',
          width: 2.5, height: 0.75, depth: 0.08, opacity: 0.6, color: '#abcdef'}]
      }]
    }},
    imports: [{id: 'batch-test-1', importId: 'batch-test-1', batchId: 'batch-test', path: 'pack/model.glb',
      dataUrl: 'data:model/gltf-binary;base64,' + bytes.toString('base64')}]
  };
}

async function request(port, method, pathname, body, headers = {}) {
  const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const requestHeaders = Object.assign({}, payload === null ? {} : {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)}, headers);
    const req = http.request({hostname: '127.0.0.1', port, method, path: pathname, headers: requestHeaders}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let json;
        try { json = JSON.parse(buffer.toString()); } catch (_) { /* Binary response. */ }
        resolve({status: res.statusCode, headers: res.headers, buffer, json});
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function testQuaternionPersistence(temporaryRoot) {
  // Separate SQLite database keeps the main fixture's project/revision counts exact.
  const dataDir = path.join(temporaryRoot, 'quaternion-stability');
  let store = new ProjectStore({dataDir});
  try {
    const half = Math.SQRT1_2;
    const rotations = [
      [0, half, 0, half + Number.EPSILON / 2],
      [0.2, -0.4, 0.4, 0.8].map(value => value * (1 + 2 * Number.EPSILON)),
      [0.25, -0.5, 0.125, Math.sqrt(1 - 0.25 ** 2 - 0.5 ** 2 - 0.125 ** 2)].map(value => value * (1 + Number.EPSILON))
    ];
    assert(rotations.some(rotation => Math.hypot(...rotation) !== 1), 'Fixtures include rounded unit poses that previously drifted.');
    const bits = rotation => {
      const bytes = Buffer.alloc(32);
      rotation.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
      return bytes.toString('hex');
    };
    const fixture = values => ({format: 'hello-webxr-editor', version: 1, imports: [], rooms: {hall: {
      overrides: [{id: 'native:hall:root.0', quaternion: values[2].slice()}],
      additions: [{id: 'custom-quaternion-storage', name: 'Rotation stability', descriptor: {nativeId: 'native:hall:root.1'},
        position: [1, 2, 3], quaternion: values[0].slice(), scale: [1, 1, 1],
        nodes: {'0': {name: 'Rotated descendant', position: [0, 1, 0], quaternion: values[1].slice(), scale: [1, 1, 1]}}
      }]
    }}});
    const getRotations = data => [data.rooms.hall.additions[0].quaternion,
      data.rooms.hall.additions[0].nodes['0'].quaternion, data.rooms.hall.overrides[0].quaternion];
    const assertBits = (data, expected, label) => getRotations(data).forEach((rotation, index) =>
      assert.equal(bits(rotation), bits(expected[index]), label + ' slot ' + index));
    const roundTrip = (project, expected, label) => {
      for (let cycle = 0; cycle < 20; cycle++) {
        // Close/reopen ensures this compares the real JSON stored on disk, not cached objects.
        store.close();
        store = new ProjectStore({dataDir});
        project = store.getProject(project.id);
        assertBits(project.document, expected, label + ' read cycle ' + cycle);
        project = store.saveProject(project.id, {name: project.name, expectedRevision: project.revision, document: project.document});
        assertBits(project.document, expected, label + ' write cycle ' + cycle);
      }
      return project;
    };
    let project = store.saveProject(null, {name: 'Unit quaternion persistence', document: fixture(rotations)});
    assertBits(project.document, rotations, 'First validation');
    project = roundTrip(project, rotations, 'Already unit length');
    for (const factor of [0.999, 1.001]) {
      const scaled = rotations.map(rotation => rotation.map(value => value * factor));
      let normalizedProject = store.saveProject(null, {name: 'Normalize ' + factor, document: fixture(scaled)});
      const normalized = getRotations(normalizedProject.document);
      normalized.forEach((rotation, index) => {
        assert(Math.abs(Math.hypot(...rotation) - 1) <= 16 * Number.EPSILON, 'Near-unit input is actually normalized.');
        assert.notEqual(bits(rotation), bits(scaled[index]), 'Near-unit input is not merely retained.');
        rotation.forEach((value, component) => assert(Math.abs(value * Math.hypot(...scaled[index]) - scaled[index][component]) < 1e-14,
          'Normalization preserves the rotation direction.'));
      });
      normalizedProject = roundTrip(normalizedProject, normalized, 'Normalized factor ' + factor);
      assert.equal(normalizedProject.revision, 21);
    }
    const projectCount = store.listProjects().length;
    for (const slot of ['root', 'node', 'override']) for (const rotation of [[0, 0, 0, 0], [1.02, 0, 0, 0], [0.98, 0, 0, 0], [1000001, 0, 0, 0]]) {
      const invalid = fixture(rotations);
      const state = slot === 'root' ? invalid.rooms.hall.additions[0] : slot === 'node' ? invalid.rooms.hall.additions[0].nodes['0'] : invalid.rooms.hall.overrides[0];
      state.quaternion = rotation;
      assert.throws(() => store.saveProject(project.id, {name: 'Invalid rotation', expectedRevision: project.revision, document: invalid}),
        error => error.status === 400, 'Invalid ' + slot + ' rotation is rejected.');
      const unchanged = store.getProject(project.id);
      assert.equal(unchanged.revision, project.revision, 'Rejected rotations never add a revision.');
      assertBits(unchanged.document, rotations, 'Rejected ' + slot + ' rotation leaves saved poses intact');
      assert.equal(store.listProjects().length, projectCount);
    }
  } finally {
    store.close();
  }
}

async function run() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-webxr-sqlite-test-'));
  let store;
  let secondStore;
  let handler;
  let server;
  try {
    const dataDir = path.join(temporaryRoot, 'persistence');
    store = new ProjectStore({dataDir});
    assert.deepEqual(store.listProjects(), []);
    const input = documentFixture();
    const created = store.saveProject(null, {name: ' Mi escenario ', document: input});
    assert.equal(created.name, 'Mi escenario');
    assert.equal(created.revision, 1);
    assert.equal(created.document.rooms.hall.additions[0].interaction.room, 1);
    assert.equal(created.document.rooms.hall.overrides[0].behaviors[0].room, 2);
    assert.deepEqual(created.document.rooms.hall.additions[0].behaviors[1], {type: 'collision', enabled: true, mode: 'trigger'});
    assert.equal(created.document.rooms.hall.overrides[0].visual.importId, 'batch-test-1');
    assert.equal(created.document.rooms.hall.additions[1].descriptor.nativeId, 'native:hall:root.1');
    assert.equal(created.document.rooms.hall.additions[1].nodes['0'].behaviors[0].volume, 0.4);
    assert.deepEqual(created.document.rooms.hall.additions[1].nodes['0'].interaction, {type: 'toggle', targetId: 'custom-fixture'});
    assert.deepEqual(created.document.rooms.hall.additions[2].descriptor, {type: 'decal'});
    assert.deepEqual(created.document.rooms.hall.additions[2].behaviors[0], Object.assign({enabled: true,
      pattern: 'image', seed: 1, wearDensity: 0.65, roughness: 0.85, metalness: 0.08, stamps: '[]'
    }, input.rooms.hall.additions[2].behaviors[0]), 'Legacy image decals retain their saved settings with compatible wear defaults.');
    const legacy = clone(created.document);
    delete legacy.rooms.hall.additions[1].nodes['0'].interaction;
    assert.equal(Object.hasOwn(validateDocument(legacy, record => record).rooms.hall.additions[1].nodes['0'], 'interaction'), false,
      'Version 1 descendant records without an interaction remain compatible.');
    for (const interaction of [{type: 'none'}, {type: 'room', room: 9}, {type: 'sound', asset: 'batch-test-1'},
      {type: 'sound', asset: 'ogg/xylophone1.ogg'}, {type: 'message', text: 'Mensaje copiado'}, {type: 'teleport'}]) {
      const fixture = documentFixture();
      fixture.rooms.hall.additions[1].nodes['0'].interaction = interaction;
      assert.deepEqual(validateDocument(fixture, record => record).rooms.hall.additions[1].nodes['0'].interaction, interaction);
    }
    assert.equal(input.imports[0].dataUrl, documentFixture().imports[0].dataUrl, 'Saving must not mutate the current editor document.');
    const imported = created.document.imports[0];
    assert.equal(imported.path, 'pack/model.glb');
    assert.equal(imported.batchId, 'batch-test');
    assert.equal(imported.dataUrl, undefined);
    assert.equal(imported.url, '/api/assets/' + imported.sha256);
    assert.equal(imported.size, bytes.length);
    assert.equal(imported.mime, 'model/gltf-binary');
    assert.deepEqual(fs.readFileSync(path.join(dataDir, 'uploads', imported.sha256 + '.blob')), bytes);
    assert(fs.readFileSync(path.join(dataDir, 'projects.sqlite')).subarray(0, 16).equals(Buffer.from('SQLite format 3\0')));
    const raw = store.db.prepare('SELECT document FROM revisions').get().document;
    assert(!raw.includes('data:') && !raw.includes(bytes.toString('base64')), 'SQLite stores asset metadata, not encoded binary payloads.');
    store.close();

    store = new ProjectStore({dataDir});
    assert.deepEqual(store.getProject(created.id), created, 'Projects and asset references must survive a server restart.');
    assert.deepEqual(fs.readFileSync(store.asset(imported.sha256).filename), bytes);
    secondStore = new ProjectStore({dataDir});
    const changed = clone(created.document);
    changed.rooms.hall.additions[0].position[0] = 9;
    const updated = secondStore.saveProject(created.id, {name: 'Revisión dos', document: changed, expectedRevision: 1});
    assert.equal(updated.revision, 2);
    assert.throws(() => store.saveProject(created.id, {name: 'Cambio atrasado', document: created.document, expectedRevision: 1}), error => error.status === 409);
    assert.equal(store.getProject(created.id).document.rooms.hall.additions[0].position[0], 9);
    assert.equal(store.listRevisions(created.id).length, 2);
    const historical = store.getProject(created.id, 1);
    assert.equal(historical.revision, 2);
    assert.equal(historical.historicalRevision, 1);
    assert.equal(historical.document.rooms.hall.additions[0].position[0], 0);
    const restored = store.saveProject(created.id, {name: historical.name, document: historical.document, expectedRevision: historical.revision});
    assert.equal(restored.revision, 3);
    assert.equal(store.getProject(created.id, 2).document.rooms.hall.additions[0].position[0], 9);
    assert.equal(fs.readdirSync(path.join(dataDir, 'uploads')).length, 1, 'Imports are deduplicated by content hash across revisions.');
    assert.throws(() => store.saveProject(created.id, {name: 'Sin versión', document: input}), error => error.status === 400);

    const assertInvalid = (mutate, expectedStatus = 400) => {
      const fixture = documentFixture();
      mutate(fixture);
      assert.throws(() => store.saveProject(null, {name: 'No guardar', document: fixture}), error => error.status === expectedStatus);
      assert.equal(store.listProjects().length, 1, 'Invalid scenes must not create partially saved projects.');
    };
    assertInvalid(doc => { doc.rooms.hall.additions[0].scale[1] = 0; });
    assertInvalid(doc => { doc.rooms.hall.additions[0].position[1] = Infinity; });
    assertInvalid(doc => { doc.rooms.hall.additions[0].quaternion = [0, 0, 0, 0]; });
    assertInvalid(doc => { doc.rooms.hall.additions[0].descriptor.importId = 'missing-file'; });
    assertInvalid(doc => { doc.rooms.hall.overrides[0].visual.importId = 'missing-file'; });
    assertInvalid(doc => { doc.rooms.hall.additions[1].nodes['0'].visual.importId = 'missing-file'; });
    assertInvalid(doc => { doc.rooms.hall.additions[1].descriptor.nativeId = 'native:unknown:root'; });
    assertInvalid(doc => { doc.rooms.hall.additions[1].nodes['bad-path'] = doc.rooms.hall.additions[1].nodes['0']; });
    assertInvalid(doc => { doc.rooms.hall.additions[1].nodes['0'].behaviors[0].volume = 10; });
    assertInvalid(doc => { doc.rooms.hall.additions[1].nodes['0'].interaction = {type: 'javascript'}; });
    assertInvalid(doc => { doc.rooms.hall.additions[1].nodes['0'].interaction = {type: 'room', room: 10}; });
    assertInvalid(doc => { doc.rooms.hall.additions[1].nodes['0'].interaction = {type: 'toggle', targetId: 1}; });
    assertInvalid(doc => { doc.rooms.hall.additions[1].nodes['0'].interaction = {type: 'sound', asset: '../outside.ogg'}; });
    assertInvalid(doc => { doc.rooms.hall.additions[1].nodes['0'].interaction = {type: 'message', text: 'x'.repeat(651)}; });
    assertInvalid(doc => { doc.rooms.hall.additions[0].behaviors = [{type: 'javascript', code: 'alert(1)'}]; });
    assertInvalid(doc => { doc.rooms.hall.additions[0].behaviors = [{type: 'sound'}, {type: 'sound'}]; });
    assertInvalid(doc => { doc.rooms.hall.additions[0].behaviors[0].asset = 'https://other.example/sound.ogg'; });
    assertInvalid(doc => { doc.rooms.hall.additions[2].behaviors[0].asset = 'https://other.example/decal.png'; });
    assertInvalid(doc => { doc.rooms.hall.additions[2].behaviors[0].asset = '../private.png'; });
    assertInvalid(doc => { doc.rooms.hall.additions[2].behaviors[0].targetId = '../object'; });
    assertInvalid(doc => { doc.rooms.hall.additions[2].behaviors[0].width = 0; });
    assertInvalid(doc => { doc.rooms.hall.additions[2].behaviors[0].depth = -1; });
    assertInvalid(doc => { doc.rooms.hall.additions[0].nodes = {'0': {}}; });
    assertInvalid(doc => { doc.rooms.hall.overrides[0].id = 'native:sound:root.0'; });
    assertInvalid(doc => { doc.rooms.unknown = doc.rooms.hall; });
    assertInvalid(doc => { doc.imports[0].path = '../outside.glb'; });
    assertInvalid(doc => { doc.imports[0].path = 'C:\\outside.glb'; });
    assertInvalid(doc => { doc.imports[0].path = '%2e%2e/outside.glb'; });
    assertInvalid(doc => { doc.imports[0].dataUrl = 'data:text/plain;base64,%%%'; });
    assertInvalid(doc => { doc.imports[0].dataUrl = 'data:text/plain;base64,A'; });
    assertInvalid(doc => { doc.imports.push(clone(doc.imports[0])); });
    assertInvalid(doc => { delete doc.imports[0].dataUrl; doc.imports[0].url = 'https://other.example/data'; doc.imports[0].sha256 = imported.sha256; });
    assertInvalid(doc => { doc.imports = [Object.assign({}, imported, {size: 123})]; });
    const poisoned = JSON.parse('{"format":"hello-webxr-editor","version":1,"rooms":{"__proto__":{}}}');
    assert.throws(() => store.saveProject(null, {name: 'Poison', document: poisoned}), error => error.status === 400);
    assert.equal({}.polluted, undefined);
    assert.equal(store.listRevisions(created.id).length, 3);
    store.close(); store = null;
    secondStore.close(); secondStore = null;

    handler = createApiHandler({dataDir, maxBodyBytes: 1024 * 1024, maxAssetBytes: 1024});
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    assert.deepEqual((await request(port, 'GET', '/api/health')).json, {storage: 'sqlite', version: 1,
      limits: {maxAssetBytes: 1024, maxProjectBytes: 1024 * 1024}, capabilities: {assetUpload: true}});
    assert.equal((await request(port, 'GET', '/health')).status, 200, 'Express mount-stripped paths are supported.');
    const loaded = await request(port, 'GET', '/api/projects/' + created.id);
    assert.equal(loaded.status, 200);
    assert.equal(loaded.json.project.revision, 3);
    assert.equal((await request(port, 'GET', '/api/projects')).json.projects.length, 1);
    assert.equal((await request(port, 'GET', '/api/projects/' + created.id + '/revisions')).json.revisions.length, 3);
    const oldHttp = await request(port, 'GET', '/api/projects/' + created.id + '/revisions/1');
    assert.equal(oldHttp.json.project.historicalRevision, 1);
    assert.equal(oldHttp.json.project.revision, 3);
    const assetResponse = await request(port, 'GET', imported.url);
    assert.equal(assetResponse.status, 200);
    assert.deepEqual(assetResponse.buffer, bytes);
    assert.equal(assetResponse.headers['content-type'], 'model/gltf-binary');
    assert.equal(assetResponse.headers['x-content-type-options'], 'nosniff');
    assert.match(assetResponse.headers['cache-control'], /immutable/);
    const range = await request(port, 'GET', imported.url, undefined, {Range: 'bytes=2-6'});
    assert.equal(range.status, 206);
    assert.deepEqual(range.buffer, bytes.subarray(2, 7));
    assert.equal((await request(port, 'GET', imported.url, undefined, {Range: 'bytes=-4'})).buffer.toString(), bytes.subarray(-4).toString());
    assert.equal((await request(port, 'GET', imported.url, undefined, {Range: 'bytes=999999-'})).status, 416);
    const head = await request(port, 'HEAD', imported.url);
    assert.equal(head.status, 200);
    assert.equal(head.buffer.length, 0);
    assert.equal(Number(head.headers['content-length']), bytes.length);
    assert.equal((await request(port, 'GET', imported.url, undefined, {'If-None-Match': assetResponse.headers.etag})).status, 304);
    assert.equal((await request(port, 'GET', '/api/assets/invalid')).status, 404);
    assert.equal((await request(port, 'GET', '/api/projects/missing')).status, 404);
    assert.equal((await request(port, 'GET', '/api/projects/' + created.id + '/revisions/999')).status, 404);
    assert.equal((await request(port, 'POST', '/api/projects', '{broken')).status, 400);
    assert.equal((await request(port, 'POST', '/api/projects', {name: 'Unsafe', document: input}, {Origin: 'https://other.example'})).status, 403);
    assert.equal((await request(port, 'POST', '/api/projects', {name: 'Unsafe', document: input}, {'Sec-Fetch-Site': 'cross-site'})).status, 403);
    assert.equal((await request(port, 'POST', '/api/projects', {name: 'Unsafe', document: input}, {'Content-Type': 'text/plain'})).status, 415);
    assert.equal((await request(port, 'POST', '/api/projects', '{"name":"x","__proto__":{}}')).status, 400);
    assert.equal((await request(port, 'POST', '/api/projects', ' '.repeat(1024 * 1024 + 1))).status, 413);
    const oversized = documentFixture();
    oversized.imports[0].dataUrl = 'data:model/gltf-binary;base64,' + Buffer.alloc(1025).toString('base64');
    assert.equal((await request(port, 'POST', '/api/projects', {name: 'Grande', document: oversized})).status, 413);
    const httpCreated = await request(port, 'POST', '/api/projects', {name: 'Desde navegador', document: input}, {Origin: 'http://127.0.0.1:' + port});
    assert.equal(httpCreated.status, 201);
    assert.equal(httpCreated.json.project.revision, 1);
    const id = httpCreated.json.project.id;
    const update = await request(port, 'PUT', '/api/projects/' + id, {name: 'Renombrado', document: httpCreated.json.project.document, expectedRevision: 1});
    assert.equal(update.status, 200);
    assert.equal(update.json.project.revision, 2);
    assert.equal((await request(port, 'PUT', '/api/projects/' + id, {name: 'Atrasado', document: input, expectedRevision: 1})).status, 409);
    assert.equal((await request(port, 'GET', '/api/projects/' + id + '/revisions')).json.revisions.length, 2);
    const hostileSvg = documentFixture();
    hostileSvg.imports[0].path = 'unsafe.svg';
    hostileSvg.imports[0].dataUrl = 'data:image/svg+xml;base64,' + Buffer.from('<svg onload="alert(1)"></svg>').toString('base64');
    const svg = await request(port, 'POST', '/api/projects', {name: 'SVG', document: hostileSvg});
    const svgResponse = await request(port, 'GET', svg.json.project.document.imports[0].url);
    assert.match(svgResponse.headers['content-disposition'], /^attachment/);
    assert.match(svgResponse.headers['content-security-policy'], /sandbox/);

    testQuaternionPersistence(temporaryRoot);
    console.log('SQLite storage: restart persistence, atomic history/restoration, optimistic concurrency, binary deduplication, schema validation and HTTP integration passed.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (handler) handler.close();
    if (secondStore) secondStore.close();
    if (store) store.close();
    // Delete only the unique test directory created above, after checking its absolute boundary.
    const target = path.resolve(temporaryRoot);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert(path.basename(target).startsWith('hello-webxr-sqlite-test-'));
    fs.rmSync(target, {recursive: true, force: true});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
