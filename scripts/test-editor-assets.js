const assert = require('assert');
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const assetLimits = require('../shared/asset-limits.js');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/editor/AssetLibrary.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class AssetLibrary', 'class AssetLibrary');
const loadedURLs = [];
const loadedModels = [];
let basisDisposed = 0;
let imageSize = [800, 400];
class TextureLoader {
  constructor(manager) { this.manager = manager; }
  load(url, onLoad) {
    loadedURLs.push(this.manager ? this.manager.resolveURL(url) : url);
    onLoad(new THREE.Texture({ width: imageSize[0], height: imageSize[1] }));
  }
}
class BasisTextureLoader extends TextureLoader {
  setTranscoderPath(value) { assert.equal(value, 'src/vendor/'); return this; }
  setWorkerLimit() { return this; }
  detectSupport(renderer) { assert(renderer); return this; }
  dispose() { basisDisposed++; }
}
class DRACOLoader {
  setDecoderPath(value) { assert.equal(value, 'src/vendor/'); return this; }
  dispose() {}
}
class GLTFLoader {
  constructor(manager) { this.manager = manager; }
  setDRACOLoader() { return this; }
  setResourcePath(value) { this.resourcePath = value; return this; }
  load(url, onLoad) {
    loadedModels.push({
      url: this.manager.resolveURL(url),
      buffer: this.manager.resolveURL(this.resourcePath + 'buffer.bin'),
      texture: this.manager.resolveURL(this.resourcePath + 'textures/color.png'),
      resourcePath: this.resourcePath
    });
    onLoad({ scene: new THREE.Group(), animations: [] });
  }
}
let optimizedModels = 0;
let acceleratedModels = 0;
const AssetLibrary = new Function('THREE', 'assetDefinitions', 'assetLimits', 'BasisTextureLoader', 'GLTFLoader', 'DRACOLoader', 'optimizeModel', 'prepareModelAcceleration', source + '\nreturn AssetLibrary;')(
  Object.assign({}, THREE, { TextureLoader }), {}, assetLimits, BasisTextureLoader, GLTFLoader, DRACOLoader,
  async object => { assert(object.isObject3D); optimizedModels++; },
  async object => { assert(object.isObject3D); acceleratedModels++; assert.equal(optimizedModels, acceleratedModels); }
);

let fileReads = 0;
global.FileReader = class {
  readAsDataURL(file) {
    fileReads++;
    this.result = 'data:' + (file.type || 'application/octet-stream') + ';base64,' + Buffer.from(file.contents).toString('base64');
    Promise.resolve().then(() => this.onload());
  }
};

class PreviewElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.style = {};
    this.pauseCount = 0;
    this.loadCount = 0;
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  appendChild(child) { this.children.push(child); return child; }
  removeAttribute(name) { delete this[name]; }
  pause() { this.pauseCount++; }
  load() { this.loadCount++; }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function checkDirectImports() {
  const MiB = 1024 * 1024;
  const limit = assetLimits.MAX_ASSET_BYTES;
  assert.equal(limit, 256 * MiB, 'Import and persistence must share the 256 MiB default.');
  const library = new AssetLibrary({});
  const original = await library.loadFiles([{name: 'existing.txt', size: 2, contents: 'ok'}]);
  let uploadCalls = 0;
  const readsBefore = fileReads;
  const uploadFile = async file => {
    uploadCalls++;
    const sha256 = require('crypto').createHash('sha256').update(file.webkitRelativePath || file.name).digest('hex');
    return {url: '/api/assets/' + sha256, sha256, size: file.size, mime: file.type || 'application/octet-stream'};
  };
  const small = {name: 'first.gltf', size: 2, contents: '{}'};
  const tooBig = {name: 'very-large.glb', size: limit + 10 * MiB};
  for (const options of [{}, {uploadFile}]) {
    await assert.rejects(() => library.loadFiles([small, tooBig], options), error => {
      assert(error.message.includes(tooBig.name));
      assert(error.message.includes('266 MiB'));
      assert(error.message.includes('256 MiB'));
      return true;
    });
  }
  for (const size of [NaN, Infinity, -1, 0.5, '12', undefined]) {
    await assert.rejects(() => library.loadFiles([small, {name: 'invalid-size.glb', size}], {uploadFile}), /invalid-size\.glb.*tamaño/);
  }
  assert.equal(uploadCalls, 0, 'The full batch must pass preflight before its first network upload.');
  assert.equal(fileReads, readsBefore, 'Oversized batches must not allocate any base64 FileReader payloads.');
  assert.deepEqual(library.exportImports(), original, 'A failed batch must leave existing imports intact.');

  const boundary = {name: 'exact-limit.glb', size: limit};
  const boundaryRecords = await library.loadFiles([boundary], {uploadFile});
  assert.equal(boundaryRecords[0].size, limit);
  assert.equal(boundaryRecords[0].dataUrl, undefined);
  assert.equal(fileReads, readsBefore, 'Direct upload must pass the File object without invoking FileReader.');
  await assert.rejects(() => library.loadFiles([{name: 'over-server-limit.glb', size: 12 * MiB}], {
    maxAssetBytes: 10 * MiB, uploadFile
  }), /over-server-limit\.glb.*12 MiB.*10 MiB/);
  for (const maxAssetBytes of [0, -1, Infinity, NaN, '10']) {
    await assert.rejects(() => library.loadFiles([tooBig], {maxAssetBytes, uploadFile}), /256 MiB/);
  }

  const files = [
    {name: 'scene.gltf', webkitRelativePath: 'direct/scene.gltf', size: 2, contents: '{}', type: 'model/gltf+json'},
    {name: 'buffer.bin', webkitRelativePath: 'direct/buffer.bin', size: 3, contents: 'bin'},
    {name: 'color.png', webkitRelativePath: 'direct/textures/color.png', size: 3, contents: 'png', type: 'image/png'}
  ];
  const gate = deferred();
  const started = [];
  const importing = library.loadFiles(files, {uploadFile: async file => {
    assert.strictEqual(file, files[started.length], 'Upload receives the original selected File in order.');
    started.push(file);
    if (started.length === 1) await gate.promise;
    return uploadFile(file);
  }});
  await Promise.resolve();
  assert.equal(started.length, 1, 'Uploads must remain sequential while the first request is pending.');
  assert.deepEqual(library.exportImports(), original.concat(boundaryRecords), 'A pending batch must not expose incomplete glTF resources.');
  gate.resolve();
  const direct = await importing;
  assert.equal(fileReads, readsBefore);
  assert.equal(new Set(direct.map(record => record.batchId)).size, 1);
  direct.forEach((record, index) => {
    assert.equal(record.path, files[index].webkitRelativePath);
    assert.equal(record.size, files[index].size);
    assert.equal(record.dataUrl, undefined);
    assert.equal(library.getURL(record), record.url);
    assert.equal(record.url, '/api/assets/' + record.sha256);
  });
  const model = await library.loadModel(direct[0].id);
  assert(model.isGroup);
  const prefix = 'editor-imports/' + direct[0].batchId + '/';
  assert.deepEqual(loadedModels.pop(), {
    url: direct[0].url, buffer: direct[1].url, texture: direct[2].url, resourcePath: prefix + 'direct/'
  });
  const saved = library.exportImports();
  const reloaded = new AssetLibrary({});
  reloaded.restoreImports(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(reloaded.exportImports(), saved, 'Direct uploads must survive lightweight scene/history serialization.');
  const manager = reloaded.managerFor(direct[0]);
  assert.equal(manager.resolveURL(prefix + 'direct/textures/color.png'), direct[2].url);

  const beforeFailure = library.exportImports();
  const readsBeforeFailure = fileReads;
  let attempts = 0;
  await assert.rejects(() => library.loadFiles(files, {uploadFile: async file => {
    if (++attempts === 2) throw new Error('El servidor respondió 503.');
    return uploadFile(file);
  }}), /buffer\.bin.*503/);
  assert.equal(attempts, 2);
  assert.equal(fileReads, readsBeforeFailure, 'A failed online upload must not silently fall back to base64.');
  assert.deepEqual(library.exportImports(), beforeFailure, 'A network error must not commit the first file of its batch.');
  const retried = await library.loadFiles(files, {uploadFile});
  assert.equal(retried.length, 3, 'The same selection can be retried after a failed request.');
  assert(new Set(library.imports.map(record => record.id)).size === library.imports.length);

  for (const alter of [
    record => Object.assign(record, {url: 'https://example.com' + record.url}),
    record => Object.assign(record, {sha256: '0'.repeat(64)}),
    record => Object.assign(record, {size: 1}),
    record => Object.assign(record, {size: NaN}),
    record => Object.assign(record, {size: -1}),
    record => Object.assign(record, {mime: undefined})
  ]) {
    const before = library.exportImports();
    await assert.rejects(() => library.loadFiles([small], {
      uploadFile: async file => alter(await uploadFile(file))
    }), /first\.gltf.*referencia o un tamaño/);
    assert.deepEqual(library.exportImports(), before, 'Malformed server metadata must never enter scene JSON.');
  }
  assert.equal(fileReads, readsBeforeFailure);

  const beforePrepared = library.exportImports();
  const prepared = await library.loadFiles(files, {uploadFile, deferCommit: true});
  assert.equal(prepared.length, 3);
  assert(prepared.every(record => record.url && !record.dataUrl));
  assert.deepEqual(library.exportImports(), beforePrepared, 'Preparing a batch must not mutate imports while its project transaction is pending.');
  library.restoreImports(beforePrepared.concat(prepared));
  assert.deepEqual(library.exportImports(), beforePrepared.concat(prepared), 'Prepared records can be committed atomically through the existing restore path.');

  const offline = new AssetLibrary({});
  const offlineRecords = await offline.loadFiles([{name: 'offline.glb', size: 3, contents: 'glb'}]);
  assert(offlineRecords[0].dataUrl.startsWith('data:'));
  assert.equal(offlineRecords[0].url, undefined, 'Standalone use retains its portable inline import path.');
  assert.equal(fileReads, readsBeforeFailure + 1);
}

async function checkPreviewLifecycle() {
  const documentBefore = global.document;
  const fetchBefore = global.fetch;
  global.document = { createElement: name => new PreviewElement(name) };
  try {
    const library = new AssetLibrary({});
    const container = new PreviewElement('div');
    const model = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial());
    let disposed = 0;
    model.geometry.addEventListener('dispose', () => disposed++);
    const pending = deferred();
    library.loadModel = () => pending.promise;
    let rendered = 0;
    library.previewModel = () => { rendered++; };
    const opening = library.preview({ path: 'hall.glb', name: 'hall.glb', kind: 'model' }, container);
    library.cancelPreview(container);
    pending.resolve(model);
    const cancelledCleanup = await opening;
    cancelledCleanup();
    assert.equal(rendered, 0, 'A model that finishes loading after cancellation must not create a hidden WebGL preview.');
    assert.equal(disposed, 1, 'Late-arriving model resources must be disposed once.');
    assert.equal(container.children.length, 0);

    const failed = deferred();
    library.loadModel = () => failed.promise;
    const failedOpening = library.preview({ path: 'broken.glb', name: 'broken.glb', kind: 'model' }, container);
    library.cancelPreview(container);
    failed.reject(new Error('A stale model error'));
    await failedOpening;
    assert.equal(container.children.length, 0, 'A cancelled model failure must not appear in a newer preview.');

    const body = deferred();
    let bodyRequested = false;
    global.fetch = async () => ({ ok: true, text: () => { bodyRequested = true; return body.promise; } });
    const textOpening = library.preview({ path: 'note.txt', name: 'note.txt', kind: 'text' }, container);
    await Promise.resolve();
    assert(bodyRequested);
    library.cancelPreview(container);
    body.resolve('This text belongs to a previous selection.');
    await textOpening;
    assert.equal(container.children.length, 0, 'A cancelled text response must never append stale text.');

    for (const kind of ['audio', 'video']) {
      const cleanup = await library.preview({ path: 'clip.' + (kind === 'audio' ? 'ogg' : 'mov'), name: 'clip', kind }, container);
      const media = container.children[0];
      assert.equal(media.tagName, kind.toUpperCase());
      assert.equal(media.preload, 'metadata');
      assert.equal(typeof media.onerror, 'function', 'Unsupported media must report a decoding error.');
      media.onerror();
      assert(container.textContent.includes('no pudo reproducir'));
      cleanup(); cleanup();
      assert.equal(media.onerror, null);
      assert.equal(media.src, undefined);
      assert.equal(media.pauseCount, 1, 'Leaving a media preview must stop playback exactly once.');
      assert.equal(media.loadCount, 1);
    }

    const sourceModel = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshBasicMaterial());
    let sourceDisposed = 0;
    sourceModel.geometry.addEventListener('dispose', () => sourceDisposed++);
    let requested;
    library.loadModel = async reference => { requested = reference; return sourceModel; };
    library.previewModel = (object, region, disposers) => {
      assert.strictEqual(object, sourceModel);
      region.appendChild(new PreviewElement('canvas'));
      rendered++;
    };
    const beforeSource = rendered;
    const cleanupSource = await library.preview({
      path: 'blender/hall.blend', name: 'hall.blend', kind: 'source',
      thumbnailPath: 'editor-previews/hall.png', previewPath: 'hall.glb'
    }, container);
    const thumbnail = container.children.find(child => child.tagName === 'IMG');
    assert(thumbnail && thumbnail.src === 'assets/editor-previews/hall.png', 'Selecting a Blender source shows its saved preview image.');
    assert.equal(rendered, beforeSource, 'Selecting a Blender file must not eagerly load its associated 3D export.');
    const viewExport = container.children.find(child => child.tagName === 'BUTTON');
    assert(viewExport && typeof viewExport.onclick === 'function');
    await viewExport.onclick();
    assert.equal(requested, 'hall.glb');
    assert.equal(rendered, beforeSource + 1);
    assert(container.children.some(child => child.tagName === 'A' && child.download === 'hall.blend'), 'The original Blender file remains downloadable.');
    cleanupSource(); cleanupSource();
    assert.equal(sourceDisposed, 1);
    assert.equal(thumbnail.src, undefined);
    assert.equal(viewExport.onclick, null);
  } finally {
    global.fetch = fetchBefore;
    if (documentBefore === undefined) delete global.document;
    else global.document = documentBefore;
  }
}

async function run() {
  await checkDirectImports();
  const library = new AssetLibrary({ assets: {}, renderer: {} });
  const records = await library.loadFiles([
    { name: 'scene.gltf', webkitRelativePath: 'pack/scene.gltf', size: 2, contents: '{}' },
    { name: 'buffer.bin', webkitRelativePath: 'pack/buffer.bin', size: 3, contents: 'bin' },
    { name: 'color.png', webkitRelativePath: 'pack/textures/color.png', size: 3, contents: 'png' }
  ]);
  assert.equal(records.length, 3);
  assert.equal(records[0].kind, 'model');
  assert.equal(library.getURL({ importId: records[0].id }), records[0].dataUrl);
  const manager = library.managerFor(records[0]);
  const prefix = 'editor-imports/' + records[0].batchId + '/';
  assert.equal(manager.resolveURL(prefix + 'pack/buffer.bin'), records[1].dataUrl);
  assert.equal(manager.resolveURL(prefix + 'pack/textures/color.png'), records[2].dataUrl);
  assert.equal(manager.resolveURL(prefix + 'elsewhere/color.png'), records[2].dataUrl);
  assert.equal(manager.resolveURL('src/vendor/draco_decoder.js'), 'src/vendor/draco_decoder.js');
  assert.throws(() => manager.resolveURL(prefix + 'pack/missing.bin'), /Falta el recurso/);
  const restored = new AssetLibrary({});
  restored.restoreImports(JSON.parse(JSON.stringify(library.exportImports())));
  assert.deepEqual(restored.exportImports(), library.exportImports());
  assert.throws(() => restored.restoreImports([records[0], records[0]]), /repetido/);
  assert.equal(library.getURL({ path: 'some dir/model.glb' }), 'assets/some%20dir/model.glb');

  const remote = new AssetLibrary({ renderer: {} });
  const remoteRecords = records.map((record, index) => {
    const sha256 = String(index + 1).repeat(64);
    const saved = Object.assign({}, record, { sha256, url: '/api/assets/' + sha256 });
    delete saved.dataUrl;
    return saved;
  });
  remote.restoreImports(remoteRecords);
  assert.deepEqual(remote.exportImports(), remoteRecords);
  assert.equal(remote.getURL(remoteRecords[0].id), remoteRecords[0].url);
  assert.equal(remote.getURL({ importId: remoteRecords[2].id }), remoteRecords[2].url);
  assert.equal(remote.getURL({ url: remoteRecords[2].url }), remoteRecords[2].url);
  const remoteManager = remote.managerFor(remote.imports[0]);
  assert.equal(remoteManager.resolveURL(remoteRecords[0].url), remoteRecords[0].url);
  assert.equal(remoteManager.resolveURL(prefix + 'pack/buffer.bin'), remoteRecords[1].url);
  assert.equal(remoteManager.resolveURL(prefix + 'pack/textures/color.png'), remoteRecords[2].url);
  const remoteModel = await remote.loadModel(remoteRecords[0].id);
  assert(remoteModel.isGroup);
  assert.deepEqual(loadedModels.pop(), {
    url: remoteRecords[0].url,
    buffer: remoteRecords[1].url,
    texture: remoteRecords[2].url,
    resourcePath: prefix + 'pack/'
  });
  await remote.instantiate({ importId: remoteRecords[2].id });
  assert.equal(loadedURLs[loadedURLs.length - 1], remoteRecords[2].url);
  for (const url of [
    'https://example.com' + remoteRecords[0].url,
    '//example.com' + remoteRecords[0].url,
    '/api/assets/../projects',
    remoteRecords[0].url + '?redirect=1',
    '/api/assets/not-a-hash',
    'data:application/octet-stream;base64,Ymlu'
  ]) {
    assert.throws(() => remote.restoreImports([Object.assign({}, remoteRecords[0], { url })]), /referencia/);
    assert.throws(() => remote.getURL({ url }), /referencia/);
  }
  assert.throws(() => remote.restoreImports([Object.assign({}, remoteRecords[0], { sha256: 'f'.repeat(64) })]), /referencia/);
  assert.deepEqual(remote.exportImports(), remoteRecords, 'Failed restores must leave current imports intact.');

  const fetchBefore = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push(url);
    assert.equal(options.credentials, 'same-origin');
    return { ok: true, blob: async () => ({ type: 'application/octet-stream', contents: 'saved-' + url.slice(-1) }) };
  };
  const portable = await remote.exportPortableImports();
  assert.deepEqual(requests, remoteRecords.map(record => record.url));
  portable.forEach((record, index) => {
    assert.equal(record.dataUrl, 'data:application/octet-stream;base64,' + Buffer.from('saved-' + (index + 1)).toString('base64'));
    assert.equal(record.url, undefined);
    assert.equal(record.sha256, undefined);
  });
  assert.deepEqual(remote.exportImports(), remoteRecords, 'Portable export must not mutate lightweight server references.');
  const portableRestored = new AssetLibrary({});
  portableRestored.restoreImports(portable);
  assert.deepEqual(portableRestored.exportImports(), portable);
  requests.length = 0;
  assert.deepEqual(await library.exportPortableImports(), library.exportImports());
  assert.equal(requests.length, 0, 'Legacy inline imports do not need network access.');
  global.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => remote.exportPortableImports(), /No se pudo descargar.*404/);
  global.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(() => remote.exportPortableImports(), /No se pudo descargar.*offline/);
  global.fetch = async () => ({ ok: true, json: async () => [
    { path: 'hall.glb', size: 123 },
    { path: 'blender/hall.blend', size: 456, thumbnailPath: 'editor-previews/hall.png', previewPath: 'hall.glb' },
    { path: 'blender/missing.blend', size: 1, thumbnailPath: '../outside.png', previewPath: 'missing.glb' },
    { path: 'blender/external.blend', size: 1, thumbnailPath: 'https://example.com/image.png', previewPath: 'https://example.com/model.glb' },
    { path: 'blender/wrong-type.blend', size: 1, thumbnailPath: 'editor-previews/not-an-image.js', previewPath: 'note.txt' },
    { path: 'note.txt', size: 10 }
  ] });
  assert.equal((await remote.getCatalog()).length, remoteRecords.length + 6);
  const sourceEntry = remote.getEntry('blender/hall.blend');
  assert.equal(sourceEntry.kind, 'source');
  assert.equal(sourceEntry.thumbnailPath, 'editor-previews/hall.png', 'Catalogued Blender files retain their embedded-thumbnail reference.');
  assert.equal(sourceEntry.previewPath, 'hall.glb', 'Catalogued Blender files retain their associated exported model.');
  for (const name of ['missing', 'external', 'wrong-type']) {
    const entry = remote.getEntry('blender/' + name + '.blend');
    assert.equal(entry.thumbnailPath, undefined, 'Invalid preview image paths must be ignored.');
    assert.equal(entry.previewPath, undefined, 'Only associated models that exist in the catalog may be previewed.');
  }
  const importWithPreview = Object.assign({}, records[0], {
    thumbnailPath: 'editor-previews/hall.png', previewPath: 'hall.glb'
  });
  const safeImports = new AssetLibrary({});
  safeImports.restoreImports([importWithPreview]);
  assert.equal(safeImports.imports[0].thumbnailPath, undefined, 'An imported scene cannot add trusted catalog preview metadata.');
  assert.equal(safeImports.imports[0].previewPath, undefined);
  global.fetch = fetchBefore;

  const landscape = await library.instantiate({ importId: records[2].id });
  assert(landscape.isMesh);
  assert.equal(landscape.geometry.parameters.width, 2);
  assert.equal(landscape.geometry.parameters.height, 1);
  assert.equal(landscape.material.side, THREE.DoubleSide);
  assert.equal(landscape.material.map.encoding, THREE.sRGBEncoding);
  assert.equal(loadedURLs[loadedURLs.length - 1], records[2].dataUrl);
  imageSize = [400, 800];
  const portrait = await library.instantiate({ path: 'poster.jpg' });
  assert.equal(portrait.geometry.parameters.width, 1);
  assert.equal(portrait.geometry.parameters.height, 2);
  assert.notEqual(portrait.material, landscape.material);
  assert.notEqual(portrait.material.map, landscape.material.map);
  const basis = await library.instantiate({ path: 'paintings/seurat.basis' });
  assert(basis.isMesh);
  assert.equal(basisDisposed, 1);
  await assert.rejects(() => restored.instantiate({ path: 'poster.basis' }), /renderizador/);
  let requestedModel;
  library.loadModel = async reference => { requestedModel = reference; return 'model'; };
  assert.equal(await library.instantiate({ path: 'hall.glb' }), 'model');
  assert.equal(requestedModel, 'hall.glb');

  await checkPreviewLifecycle();
  assert(optimizedModels > 0, 'Loaded models must await the lossless preparation path before being returned.');
  assert.equal(acceleratedModels, optimizedModels, 'Model acceleration must prepare the finalized optimized index buffer.');

  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/editor-catalog.json')));
  assert(catalog.length > 90);
  assert(catalog.some(entry => entry.path === 'blender/hall.blend' && entry.kind === 'source'));
  assert(!catalog.some(entry => entry.path === 'editor-catalog.json'));
  assert(!catalog.some(entry => entry.path.startsWith('editor-previews/')), 'Generated thumbnails must not clutter the project asset browser.');
  assert(catalog.every(entry => fs.statSync(path.join(root, 'assets', entry.path)).size === entry.size));
  const sourceThumbnails = catalog.filter(entry => entry.kind === 'source' && entry.thumbnailPath);
  assert(sourceThumbnails.length > 0, 'The native Blender files must have real extracted previews.');
  sourceThumbnails.forEach(entry => {
    assert(/^editor-previews\/[^/]+\.png$/.test(entry.thumbnailPath));
    const png = fs.readFileSync(path.join(root, 'assets', entry.thumbnailPath));
    assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'A Blender thumbnail must be a valid PNG: ' + entry.path);
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, 'A Blender thumbnail must have a nonempty image.');
    if (entry.previewPath) assert(catalog.some(model => model.path === entry.previewPath && model.kind === 'model'));
  });
  console.log('Asset library: server references, portable exports and failures, glTF resources, independent image planes, Basis cleanup and ' + catalog.length + ' catalog files passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
