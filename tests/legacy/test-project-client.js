const __layout = require("../../tooling/layout.cjs");
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {createApiHandler} = require('../../apps/api/server/api');
const {MAX_ASSET_BYTES} = require('../../packages/render-three/schema/asset-limits');

const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-project-client.js"), '../src/editor/ProjectClient.js')), 'utf8')
  .replace(/^import[^\n]+\n/gm, '')
  .replace('export default class ProjectClient', 'class ProjectClient');
const rawFetch = global.fetch, cookies = new Map();
const nativeFetch = (url, options = {}) => {
  const cookie = cookies.get(new URL(url).origin);
  return rawFetch(url, Object.assign({}, options, {headers: Object.assign({}, options.headers || {}, cookie ? {Cookie: cookie} : {})}));
};
let activeFetch = (...args) => nativeFetch(...args);
const ProjectClient = new Function('fetch', 'MAX_ASSET_BYTES', source + '\nreturn ProjectClient;')((...args) => activeFetch(...args), MAX_ASSET_BYTES);

// A real one-pixel PNG exercises byte storage instead of only JSON metadata.
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=', 'base64');
const importId = 'test-texture';

function scene(x = 1) {
  return {
    format: 'hello-webxr-editor', version: 1,
    rooms: {
      hall: {
        overrides: [{id: 'native:hall:root.0', position: [0, 2, 0], visible: true}],
        additions: [{
          id: 'custom-poster', name: 'Imagen de prueba', descriptor: {importId},
          position: [x, 1, -2], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], visible: true,
          interaction: {type: 'message', text: 'Escenario SQLite'}
        }]
      }
    },
    imports: [{
      id: importId, importId, batchId: 'test-batch', path: 'textures/pixel.png',
      size: imageBytes.length, mime: 'image/png', dataUrl: 'data:image/png;base64,' + imageBytes.toString('base64')
    }]
  };
}

async function start(dataDir, options = {}) {
  const handler = createApiHandler(Object.assign({allowBootstrapRegistration:true, publicSceneId:null, requireSecureCookies:false, dataDir, maintenanceIntervalMs: 0}, options));
  const server = http.createServer(handler);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    handler.close();
    throw error;
  }
  const origin = 'http://127.0.0.1:' + server.address().port;
  // Each fixture owns a real authenticated administrator. Restarting a fixture
  // logs in again; no anonymous private-project bypass is retained for tests.
  const credentials = {username: 'client_fixture_admin', password: 'Private project client fixture 123!'};
  let response = await rawFetch(origin + '/api/studio/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(credentials)});
  if (response.status === 409) response = await rawFetch(origin + '/api/studio/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(credentials)});
  assert(response.ok, 'Fixture authentication succeeded');
  const identity = (await response.json()).user;
  cookies.set(origin, response.headers.get('set-cookie').split(';')[0]);
  const client = new ProjectClient(origin + '/api'); client.identityProvider = () => identity.id;
  return {
    handler, origin, client,
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      handler.close();
      cookies.delete(origin);
    }
  };
}

async function assertError(operation, status, code) {
  await assert.rejects(operation, error => {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.equal(typeof error.message, 'string');
    assert(error.message.length > 0);
    return true;
  });
}

async function binaryImportTests(dataDir) {
  const running = await start(__layout.map(path.join(dataDir, 'binary')), {maxBodyBytes: 4096, maxAssetBytes: 64 * 1024});
  let uploadRequests = 0, jsonRequests = 0;
  try {
    const {client, origin} = running;
    assert.equal(client.maxAssetBytes, MAX_ASSET_BYTES);
    const health = await client.health();
    assert.equal(health.capabilities.assetUpload, true);
    assert.equal(health.limits.maxAssetBytes, 64 * 1024);
    assert.equal(client.maxAssetBytes, 64 * 1024);
    activeFetch = async (url, options) => {
      if (url === origin + '/api/assets' && options.method === 'POST') {
        uploadRequests++;
        assert(options.body instanceof Blob, 'Assets travel as binary Blobs, never JSON or base64.');
        assert.equal(options.headers['Content-Type'], 'application/octet-stream');
        assert.equal(options.credentials, 'same-origin');
        assert.equal(options.cache, 'no-store');
      }
      if (options && ['POST', 'PUT'].includes(options.method) && !url.endsWith('/assets')) {
        jsonRequests++;
        assert(Buffer.byteLength(options.body) < 4096, 'Project metadata fits even when inline import data exceeded the JSON limit.');
        assert(!options.body.includes('data:'));
      }
      return nativeFetch(url, options);
    };
    const bytes = Buffer.alloc(32 * 1024, 173);
    const original = scene();
    original.imports = [{id: importId, path: 'models/detailed.glb', size: bytes.length,
      mime: 'model/gltf-binary', dataUrl: 'data:model/gltf-binary;base64,' + bytes.toString('base64')}];
    const originalSnapshot = JSON.parse(JSON.stringify(original));
    assert(Buffer.byteLength(JSON.stringify(original)) > 4096);
    const pending = client.createProject('Modelo detallado', original);
    // The user is free to keep editing while upload awaits hashing/the network.
    original.rooms.hall.additions[0].position[0] = 99;
    original.imports[0].path = 'models/later-name.glb';
    const created = await pending;
    assert.deepEqual(created.document.rooms, originalSnapshot.rooms);
    assert.equal(created.document.imports[0].path, originalSnapshot.imports[0].path);
    assert.equal(original.imports[0].dataUrl, originalSnapshot.imports[0].dataUrl);
    assert.equal(original.imports[0].url, undefined, 'Staging never mutates the live import record.');
    assert.equal(uploadRequests, 1);
    assert.equal(jsonRequests, 1);
    const asset = created.document.imports[0];
    assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(Buffer.from(await (await nativeFetch(origin + asset.url)).arrayBuffer()), bytes);

    // Repeated saves and conflict recovery reuse the binary hash, even when the
    // editor provided a fresh document object containing the same inline bytes.
    const updated = await client.updateProject(created.id, 'Editado', originalSnapshot, 1);
    await assertError(() => client.updateProject(created.id, 'Obsoleto', originalSnapshot, 1), 409, 'revision_conflict');
    await client.createProject('Copia tras conflicto', JSON.parse(JSON.stringify(originalSnapshot)));
    assert.equal(uploadRequests, 1);
    assert.equal(updated.revision, 2);
    assert.deepEqual(originalSnapshot.imports[0].dataUrl, original.imports[0].dataUrl);

    const blob = new Blob([imageBytes], {type: 'image/png'});
    const uploaded = await client.uploadAsset(blob);
    assert.equal(uploaded.size, imageBytes.length);
    assert.equal(uploaded.mime, 'image/png');
    const duplicate = await client.uploadAsset(blob);
    assert.deepEqual(duplicate, uploaded);
    duplicate.url = 'https://untrusted.invalid/changed';
    assert.equal((await client.uploadAsset(blob)).url, uploaded.url, 'Callers cannot change the cached asset reference.');
    assert.equal(uploadRequests, 2, 'A repeated File/Blob uploads once.');

    const beforeInvalid = uploadRequests;
    await assert.rejects(() => client.uploadAsset(new Blob([Buffer.alloc(64 * 1024 + 1)]), undefined, 'enorme.glb'), error =>
      error.status === 413 && error.code === 'payload_too_large' && /enorme.glb.*65536/.test(error.message));
    const tooLargeInline = scene();
    tooLargeInline.imports[0].dataUrl = 'data:image/png;base64,' + Buffer.alloc(64 * 1024 + 1).toString('base64');
    tooLargeInline.imports[0].size = 64 * 1024 + 1;
    await assert.rejects(() => client.createProject('Excesivo', tooLargeInline), error => error.status === 413);
    for (const dataUrl of ['data:image/png;base64,AP==', 'data:image/png;base64,a', 'data:image/png;base64,AA==AAAA', 'data:image/png;base64,AA A=']) {
      const invalid = scene();
      invalid.imports[0].dataUrl = dataUrl;
      await assert.rejects(() => client.createProject('Inválido', invalid), /base64/);
    }
    const inconsistent = scene();
    inconsistent.imports[0].size++;
    await assert.rejects(() => client.createProject('Tamaño inválido', inconsistent), /tamaño/);
    assert.equal(uploadRequests, beforeInvalid, 'Oversized/malformed data is rejected before sending any bytes.');
  } finally {
    activeFetch = (...args) => nativeFetch(...args);
    await running.close();
  }
}

async function responseValidationTests() {
  const blob = new Blob([imageBytes], {type: 'image/png'});
  const sha256 = createHash('sha256').update(imageBytes).digest('hex');
  const good = {sha256, url: '/api/assets/' + sha256, mime: 'image/png', size: imageBytes.length};
  const client = new ProjectClient();
  for (const invalid of [null, {}, Object.assign({}, good, {sha256: 'wrong'}),
    Object.assign({}, good, {url: 'https://outside.invalid/api/assets/' + sha256}),
    Object.assign({}, good, {size: good.size + 1}), Object.assign({}, good, {mime: 'image/png\r\nInjected: true'}),
    Object.assign({}, good, {mime: 'not-a-mime'})]) {
    activeFetch = async () => ({ok: true, json: async () => ({asset: invalid})});
    await assert.rejects(() => client.uploadAsset(blob), /referencia.*inválida/);
  }
  activeFetch = async () => { throw new Error('offline'); };
  await assert.rejects(() => client.uploadAsset(blob), /No se pudo subir/);
  activeFetch = async () => ({ok: false, status: 413, json: async () => ({error: 'Archivo demasiado grande', code: 'payload_too_large'})});
  await assertError(() => client.uploadAsset(blob), 413, 'payload_too_large');
  activeFetch = async () => ({ok: true, json: async () => ({asset: good})});
  assert.deepEqual(await client.uploadAsset(blob), good, 'Failed uploads never poison the retry cache.');

  // A server without the capability retains the existing inline JSON path.
  let captured;
  activeFetch = async (url, options) => {
    if (url.endsWith('/health')) return {ok: true, json: async () => ({storage: 'sqlite'})};
    captured = JSON.parse(options.body);
    return {ok: true, json: async () => ({project: {document: captured.document}})};
  };
  const legacy = new ProjectClient();
  await legacy.health();
  await legacy.createProject('Compatible', scene());
  assert.equal(captured.document.imports[0].dataUrl, scene().imports[0].dataUrl);
  activeFetch = (...args) => nativeFetch(...args);
}

async function legacyLargeImportTest(dataDir) {
  // An already-open editor can still hold the old inline representation. This
  // fixture crosses the former 50 MiB cap and cannot fit the JSON request limit.
  const running = await start(__layout.map(path.join(dataDir, 'legacy-large')), {maxBodyBytes: 4096});
  const size = 51 * 1024 * 1024;
  let bytes = Buffer.alloc(size, 193);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const dataUrl = 'data:model/gltf-binary;base64,' + bytes.toString('base64');
  bytes = null;
  let uploads = 0, saves = 0;
  try {
    const {client, origin} = running;
    await client.health();
    activeFetch = async (url, options) => {
      if (options && options.method === 'POST' && url.endsWith('/assets')) {
        uploads++;
        assert(options.body instanceof Blob);
        assert.equal(options.body.size, size);
        assert.equal(options.headers['Content-Type'], 'application/octet-stream');
      } else if (options && options.method === 'POST') {
        saves++;
        assert(Buffer.byteLength(options.body) < 4096);
        assert(!options.body.includes('data:'));
      }
      return nativeFetch(url, options);
    };
    const original = scene();
    original.imports = [Object.freeze({id: importId, importId, batchId: 'old-tab-batch',
      path: 'models/large-equipment.glb', size, mime: 'model/gltf-binary', dataUrl})];
    Object.freeze(original.imports);
    Object.freeze(original);
    const expectedRooms = JSON.parse(JSON.stringify(original.rooms));
    const created = await client.createProject('Equipo de una pestaña anterior', original);
    assert.equal(uploads, 1);
    assert.equal(saves, 1);
    assert.equal(created.document.imports[0].dataUrl, undefined);
    assert.equal(created.document.imports[0].size, size);
    assert.equal(created.document.imports[0].sha256, hash);
    assert.equal(created.document.imports[0].url, '/api/assets/' + hash);
    assert.equal(original.imports[0].dataUrl, dataUrl, 'Migrating a 51 MiB inline file preserves the old tab’s live document.');
    assert.equal(original.imports[0].url, undefined);
    assert.deepEqual(original.rooms, expectedRooms);
    const reopened = await client.getProject(created.id);
    assert.deepEqual(reopened, created, 'The large legacy import reopens from saved server references.');
    assert.equal(reopened.document.imports[0].dataUrl, undefined);
    const downloaded = await nativeFetch(origin + reopened.document.imports[0].url);
    assert.equal(Number(downloaded.headers.get('content-length')), size);
    assert.equal(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'), hash);
  } finally {
    activeFetch = (...args) => nativeFetch(...args);
    await running.close();
  }
}

async function run() {
  const temporaryRoot = __layout.map(path.resolve(os.tmpdir()));
  const dataDir = fs.mkdtempSync(__layout.map(path.join(temporaryRoot, 'hello-webxr-client-test-')));
  let running;
  try {
    running = await start(dataDir);
    const {client, origin} = running;
    assert.equal((await client.health()).storage, 'sqlite');
    assert.deepEqual(await client.listProjects(), []);

    const original = scene();
    const originalSnapshot = JSON.parse(JSON.stringify(original));
    const created = await client.createProject('Escenario uno', original);
    assert.deepEqual(original, originalSnapshot, 'Binary staging preserves the caller’s inline document.');
    assert.equal(created.name, 'Escenario uno');
    assert.equal(created.revision, 1);
    assert.equal(typeof created.id, 'string');
    assert.equal(typeof created.createdAt, 'string');
    assert.equal(typeof created.updatedAt, 'string');
    assert.deepEqual(created.document.rooms, original.rooms);
    const savedImport = created.document.imports[0];
    const hash = createHash('sha256').update(imageBytes).digest('hex');
    assert.equal(savedImport.sha256, hash);
    assert.equal(savedImport.url, '/api/assets/' + hash);
    assert.equal(savedImport.dataUrl, undefined);
    assert.equal(savedImport.mime, 'image/png');
    assert.equal(savedImport.size, imageBytes.length);
    assert.equal(savedImport.kind, 'image');

    const asset = await nativeFetch(origin + savedImport.url);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), imageBytes);

    // A normal edit sends the returned server references, without reuploading bytes.
    const edited = JSON.parse(JSON.stringify(created.document));
    edited.rooms.hall.additions[0].position[0] = 7;
    const updated = await client.updateProject(created.id, 'Escenario editado', edited, created.revision);
    assert.equal(updated.revision, 2);
    assert.equal(updated.name, 'Escenario editado');
    assert.equal(updated.document.rooms.hall.additions[0].position[0], 7);
    assert.deepEqual(updated.document.imports, created.document.imports);
    assert.equal(fs.readdirSync(__layout.map(path.join(dataDir, 'uploads'))).filter(name => name.endsWith('.blob')).length, 1);
    assert.deepEqual(await client.getProject(created.id), updated);
    assert.deepEqual((await client.listProjects()).map(project => [project.id, project.name, project.revision]), [
      [created.id, 'Escenario editado', 2]
    ]);

    await assertError(() => client.updateProject(created.id, 'Cambio obsoleto', original, 1), 409, 'revision_conflict');
    assert.deepEqual(await client.getProject(created.id), updated, 'A stale save must not replace the current scene.');
    assert.deepEqual((await client.listRevisions(created.id)).map(revision => [revision.revision, revision.name]), [
      [2, 'Escenario editado'], [1, 'Escenario uno']
    ]);
    const historical = await client.getProject(created.id, 1);
    assert.equal(historical.historicalRevision, 1);
    assert.equal(historical.name, 'Escenario uno');
    assert.equal(historical.document.rooms.hall.additions[0].position[0], 1);
    assert.deepEqual(historical.document.imports, created.document.imports);
    await assertError(() => client.getProject('missing-project'), 404, 'not_found');
    await assertError(() => client.getProject(created.id, 99), 404, 'not_found');

    await running.close();
    running = null;
    assert(fs.existsSync(__layout.map(path.join(dataDir, 'projects.sqlite'))));
    running = await start(dataDir);
    assert.deepEqual(await running.client.getProject(created.id), updated, 'Saved scenes must survive a new API/store instance.');
    assert.equal((await running.client.listRevisions(created.id)).length, 2);
    const persistedAsset = await nativeFetch(running.origin + savedImport.url);
    assert.equal(persistedAsset.status, 200);
    assert.deepEqual(Buffer.from(await persistedAsset.arrayBuffer()), imageBytes);

    await binaryImportTests(dataDir);
    await legacyLargeImportTest(dataDir);
    await responseValidationTests();

    // Errors from an old/static server and network outages stay readable in the UI.
    activeFetch = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(() => client.health(), /No se pudo conectar/);
    activeFetch = async () => ({ok: true, json: async () => { throw new SyntaxError('Unexpected HTML'); }});
    await assert.rejects(() => client.listProjects(), /no ofrece el guardado/);
    activeFetch = async () => ({ok: true, json: async () => ({storage: 'memory'})});
    await assert.rejects(() => client.health(), /SQLite/);
    activeFetch = async () => ({ok: false, status: 503, json: async () => ({error: {message: 'Servicio temporalmente detenido', code: 'unavailable'}})});
    await assertError(() => client.listProjects(), 503, 'unavailable');
    console.log('Project client: SQLite API, binary uploads outside JSON limits, immutable snapshots, legacy inline migration, deduplication/conflict retries, response validation, revisions and persistence passed.');
  } finally {
    activeFetch = (...args) => nativeFetch(...args);
    if (running) await running.close();
    // Delete only the unique test directory created in the verified temp root.
    assert.equal(path.dirname(__layout.map(path.resolve(dataDir))), temporaryRoot);
    assert(path.basename(dataDir).startsWith('hello-webxr-client-test-'));
    fs.rmSync(dataDir, {recursive: true, force: true});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
