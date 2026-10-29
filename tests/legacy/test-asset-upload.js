const __layout = require("../../tooling/layout.cjs");
'use strict';

// Real HTTP/SQLite uploads use isolated temporary data and bounded-size chunks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {once} = require('node:events');
const {PassThrough, Readable} = require('node:stream');
const {ProjectStore, MAX_ASSET_BYTES} = require('../../apps/api/server/storage');
const {createApiHandler} = require('../../apps/api/server/api');
const cookies = new Map();

function responseRequest(port, method, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port, method, path: pathname,
      headers: Object.assign({'Connection': 'close'}, cookies.has(port) ? {Cookie: cookies.get(port)} : {}, headers)}, res => {
      const chunks = [];
      res.on('error', reject);
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let json;
        try { json = JSON.parse(buffer.toString()); } catch (_) { /* Binary response. */ }
        resolve({status: res.statusCode, headers: res.headers, buffer, json});
      });
    });
    req.on('error', reject);
    if (body && typeof body.pipe === 'function') body.pipe(req);
    else req.end(body);
  });
}

function upload(port, body, mime = 'model/gltf-binary', extra = {}) {
  return responseRequest(port, 'POST', '/api/assets', body,
    Object.assign({'Content-Type': 'application/octet-stream', 'X-Asset-Mime': mime,
      'Content-Length': body.length}, extra));
}

function documentFixture(asset) {
  return {format: 'hello-webxr-editor', version: 1, rooms: {hall: {overrides: [], additions: []}},
    imports: [Object.assign({id: 'large-model', batchId: 'large', path: 'equipment.glb'}, asset)]};
}

async function start(dataDir, options = {}) {
  const errors = [];
  const handler = createApiHandler(Object.assign({allowBootstrapRegistration:true, publicSceneId:null, requireSecureCookies:false, dataDir, maintenanceIntervalMs: 0, onError: error => errors.push(error)}, options));
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port, credentials = JSON.stringify({username: 'upload_fixture_admin', password: 'Private upload fixture password 123!'});
  let auth = await responseRequest(port, 'POST', '/api/studio/register', credentials, {'Content-Type': 'application/json'});
  if (auth.status === 409) auth = await responseRequest(port, 'POST', '/api/studio/login', credentials, {'Content-Type': 'application/json'});
  assert([200, 201].includes(auth.status), 'Fixture authenticates through the real account API');
  cookies.set(port, auth.headers['set-cookie'][0].split(';')[0]);
  return {handler, server, errors, port: server.address().port,
    async close() { await new Promise(resolve => server.close(resolve)); handler.close(); cookies.delete(port); }};
}

async function run() {
  const temporaryRoot = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'hello-webxr-upload-test-')));
  const dataDir = __layout.map(path.join(temporaryRoot, 'data'));
  let live;
  let customStore;
  try {
    assert.equal(MAX_ASSET_BYTES, 256 * 1024 * 1024);
    for (const maximum of [0, -1, 1.5, Infinity, 2048 * 1024 * 1024 + 1]) {
      assert.throws(() => new ProjectStore({dataDir, maxAssetBytes: maximum}), /límite/);
    }
    const previous = process.env.HELLO_WEBXR_MAX_ASSET_MIB;
    try {
      for (const configured of ['', '0', '-1', '256.5', '2049', 'NaN']) {
        process.env.HELLO_WEBXR_MAX_ASSET_MIB = configured;
        assert.throws(() => new ProjectStore({dataDir}), /entero|límite/);
      }
      process.env.HELLO_WEBXR_MAX_ASSET_MIB = '96';
      customStore = new ProjectStore({dataDir});
      assert.equal(customStore.maxAssetBytes, 96 * 1024 * 1024);
      customStore.close(); customStore = null;
    } finally {
      if (previous === undefined) delete process.env.HELLO_WEBXR_MAX_ASSET_MIB;
      else process.env.HELLO_WEBXR_MAX_ASSET_MIB = previous;
    }

    live = await start(dataDir, {maxAssetBytes: 128, maxBodyBytes: 1024});
    const port = live.port;
    assert.deepEqual((await responseRequest(port, 'GET', '/api/health')).json,
      {storage: 'sqlite', version: 1, limits: {maxAssetBytes: 128, maxProjectBytes: 1024, defaultMaxProjects: 2, defaultStorageBytes: 20971520}, capabilities: {assetUpload: true, privateProjects: true, publicSceneCatalog: true, projectSharing: true}});
    const bytes = Buffer.alloc(128, 7);
    const expectedHash = createHash('sha256').update(bytes).digest('hex');
    const created = await upload(port, bytes, 'MODEL/GLTF-BINARY', {Origin: 'http://127.0.0.1:' + port});
    assert.equal(created.status, 201);
    assert.deepEqual(created.json.asset, {url: '/api/assets/' + expectedHash, sha256: expectedHash,
      mime: 'model/gltf-binary', size: 128});
    const duplicate = await upload(port, bytes, 'application/octet-stream');
    assert.deepEqual(duplicate.json.asset, created.json.asset, 'Identical content reuses its canonical MIME and URL.');
    assert.equal(fs.readdirSync(__layout.map(path.join(dataDir, 'uploads'))).length, 1);
    assert.equal(live.handler.store.db.prepare("SELECT COUNT(*) AS count FROM assets").get().count, 1);
    const tooBig = await upload(port, Buffer.alloc(129));
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.json.code, 'payload_too_large', 'an administrator still receives the per-file limit, not an account-quota error');
    assert.match(tooBig.json.error, /128 bytes/);
    assert.match(tooBig.json.error, /129 bytes/);
    const chunked = await responseRequest(port, 'POST', '/api/assets', Readable.from([Buffer.alloc(64), Buffer.alloc(65)]),
      {'Content-Type': 'application/octet-stream'});
    assert.equal(chunked.status, 413, 'Chunked requests must enforce the measured size without Content-Length.');
    assert.equal(chunked.json.code, 'payload_too_large');
    const concurrent = await Promise.all([upload(port, Buffer.alloc(128, 1)), upload(port, Buffer.alloc(128, 2))]);
    assert(concurrent.every(result => result.status === 201), 'administrator uploads do not share a per-account quota reservation');
    assert.equal(fs.readdirSync(__layout.map(path.join(dataDir, 'uploads'))).filter(name => name.endsWith('.tmp')).length, 0);
    assert.equal((await upload(port, Buffer.from('x'), 'text/plain', {Origin: 'https://other.example'})).status, 403);
    assert.equal((await upload(port, Buffer.from('x'), 'text/plain', {'Sec-Fetch-Site': 'cross-site'})).status, 403);
    assert.equal((await upload(port, Buffer.from('x'), 'text/plain', {'Content-Type': 'application/json'})).status, 415);
    assert.equal((await upload(port, Buffer.from('x'), 'text/plain; charset=utf-8')).status, 400);
    assert.equal((await responseRequest(port, 'POST', '/api/projects', Buffer.from('{}'),
      {'Content-Type': 'application/octet-stream'})).status, 415, 'Binary writes are allowed only on the asset endpoint.');
    const svg = await upload(port, Buffer.from('<svg onload="alert(1)"></svg>'), 'image/svg+xml');
    const svgGet = await responseRequest(port, 'GET', svg.json.asset.url);
    assert.equal(svgGet.headers['content-type'], 'image/svg+xml');
    assert.equal(svgGet.headers['x-content-type-options'], 'nosniff');
    assert.match(svgGet.headers['content-disposition'], /^attachment/);
    assert.match(svgGet.headers['content-security-policy'], /sandbox/);

    // Simulated read failure checks cleanup without requiring an HTTP response
    // after the client has disconnected.
    const broken = new PassThrough();
    broken.headers = {'x-asset-mime': 'model/gltf-binary'};
    broken.complete = false;
    const rejected = live.handler.store.receiveAsset(broken);
    broken.write(Buffer.alloc(16));
    await new Promise(resolve => setImmediate(resolve));
    broken.aborted = true;
    broken.destroy(new Error('Fixture disconnected'));
    await assert.rejects(rejected, error => error.status === 400);
    assert.equal(fs.readdirSync(__layout.map(path.join(dataDir, 'uploads'))).filter(name => name.endsWith('.tmp')).length, 0);

    const originalOpen = fs.promises.open;
    const diskFailure = new Error('Fixture disk write failed');
    const failedWrite = new PassThrough();
    failedWrite.headers = {'x-asset-mime': 'model/gltf-binary'};
    failedWrite.complete = true;
    try {
      fs.promises.open = async (...args) => {
        const file = await originalOpen(...args);
        return {write: async () => { throw diskFailure; }, close: () => file.close()};
      };
      const failed = live.handler.store.receiveAsset(failedWrite);
      failedWrite.end(Buffer.from('incomplete disk output'));
      await assert.rejects(failed, error => error === diskFailure);
    } finally { fs.promises.open = originalOpen; }
    assert.equal(fs.readdirSync(__layout.map(path.join(dataDir, 'uploads'))).filter(name => name.endsWith('.tmp')).length, 0);

    // Test a real HTTP abort after the spool exists, then wait for its cleanup.
    const abort = http.request({hostname: '127.0.0.1', port, path: '/api/assets', method: 'POST',
      headers: {'Content-Type': 'application/octet-stream', 'Content-Length': '100', 'Connection': 'close', Cookie: cookies.get(port)}});
    abort.on('error', () => {});
    abort.write(Buffer.alloc(10));
    for (let attempt = 0; attempt < 50 && !fs.readdirSync(__layout.map(path.join(dataDir, 'uploads'))).some(name => name.endsWith('.tmp')); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert(fs.readdirSync(__layout.map(path.join(dataDir, 'uploads'))).some(name => name.endsWith('.tmp')));
    abort.destroy();
    for (let attempt = 0; attempt < 50 && fs.readdirSync(__layout.map(path.join(dataDir, 'uploads'))).some(name => name.endsWith('.tmp')); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(fs.readdirSync(__layout.map(path.join(dataDir, 'uploads'))).filter(name => name.endsWith('.tmp')).length, 0);
    assert.deepEqual(live.errors, []);
    await live.close(); live = null;

    // More than the former 50 MiB limit, with only a single reusable 64 KiB
    // payload chunk in memory. The project itself contains only its reference.
    live = await start(dataDir, {maxAssetBytes: MAX_ASSET_BYTES, maxBodyBytes: 1024});
    const size = 51 * 1024 * 1024 + 17;
    const chunk = Buffer.alloc(64 * 1024, 0x5a);
    const hash = createHash('sha256');
    function * chunks() {
      for (let remaining = size; remaining > 0; remaining -= chunk.length) {
        const part = chunk.subarray(0, Math.min(remaining, chunk.length));
        hash.update(part);
        yield part;
      }
    }
    const large = await responseRequest(live.port, 'POST', '/api/assets', Readable.from(chunks()),
      {'Content-Type': 'application/octet-stream', 'X-Asset-Mime': 'model/gltf-binary', 'Content-Length': size});
    assert.equal(large.status, 201);
    assert.equal(large.json.asset.size, size);
    assert.equal(large.json.asset.sha256, hash.digest('hex'));
    const asset = large.json.asset;
    assert.equal(fs.statSync(live.handler.store.asset(asset.sha256).filename).size, size);
    const projectBody = JSON.stringify({name: 'Equipo grande', document: documentFixture(asset)});
    assert(Buffer.byteLength(projectBody) < 1024);
    const saved = await responseRequest(live.port, 'POST', '/api/projects', projectBody, {'Content-Type': 'application/json'});
    assert.equal(saved.status, 201, 'A large binary must not consume the project JSON limit.');
    assert.equal(saved.json.project.document.imports[0].sha256, asset.sha256);
    const bad = documentFixture(Object.assign({}, asset, {size: size - 1}));
    assert.equal((await responseRequest(live.port, 'POST', '/api/projects',
      JSON.stringify({name: 'Wrong metadata', document: bad}), {'Content-Type': 'application/json'})).status, 400);
    const head = await responseRequest(live.port, 'HEAD', asset.url);
    assert.equal(head.status, 200);
    assert.equal(head.buffer.length, 0);
    assert.equal(Number(head.headers['content-length']), size);
    const range = await responseRequest(live.port, 'GET', asset.url, undefined, {Range: 'bytes=52428798-52428817'});
    assert.equal(range.status, 206);
    assert.equal(range.buffer.length, 20);
    assert(range.buffer.equals(Buffer.alloc(20, 0x5a)));
    assert.equal((await responseRequest(live.port, 'GET', asset.url, undefined, {'If-None-Match': head.headers.etag})).status, 304);
    assert.equal((await responseRequest(live.port, 'GET', asset.url, undefined, {Range: 'bytes=' + size + '-'})).status, 416);
    assert.deepEqual(live.errors, []);
    const projectId = saved.json.project.id;
    await live.close(); live = null;
    live = await start(dataDir, {maxAssetBytes: MAX_ASSET_BYTES});
    const restored = await responseRequest(live.port, 'GET', '/api/projects/' + projectId);
    assert.equal(restored.json.project.document.imports[0].size, size);
    assert.equal((await responseRequest(live.port, 'HEAD', asset.url)).status, 200);
    assert.equal(fs.readdirSync(__layout.map(path.join(dataDir, 'uploads'))).filter(name => name.endsWith('.tmp')).length, 0);
    console.log('Asset uploads: streamed 51 MiB, exact/declared/chunked limits, cleanup on abort/error, MIME/CSRF, dedup, range/HEAD and reference persistence passed.');
  } finally {
    if (customStore) customStore.close();
    if (live) await live.close();
    const target = __layout.map(path.resolve(temporaryRoot));
    assert.equal(path.dirname(target), __layout.map(path.resolve(os.tmpdir())));
    assert(path.basename(target).startsWith('hello-webxr-upload-test-'));
    fs.rmSync(target, {recursive: true, force: true});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
