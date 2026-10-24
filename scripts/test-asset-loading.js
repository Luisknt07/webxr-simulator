const assert = require('assert');
const fs = require('fs');
const path = require('path');
const THREE = require('three');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/assetManager.js'), 'utf8')
  .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace('export function loadAssets', 'function loadAssets');

function harness(options = {}) {
  const pending = [];
  const timers = new Map();
  const errors = [];
  const warnings = [];
  const disposed = {basis: 0, draco: 0};
  let aborted = 0;
  let timerId = 0;
  const textureValue = () => new THREE.Texture();
  class Loader {
    load(url, onLoad, onProgress, onError) {
      const item = {url, onLoad, onError};
      pending.push(item);
      if (options.throwLoad) throw new Error('Loader threw');
      if (options.sync) onLoad(textureValue());
      return {abort() { aborted++; }};
    }
  }
  class GLTFLoader extends Loader { setDRACOLoader() { return this; } }
  class DRACOLoader {
    setDecoderPath(value) { assert.equal(value, 'src/vendor/'); return this; }
    dispose() { disposed.draco++; }
  }
  class BasisTextureLoader extends Loader {
    constructor() { super(); this.workerConfig = {}; this.workerNextTaskID = 1; }
    setTranscoderPath(value) { assert.equal(value, 'src/vendor/'); return this; }
    detectSupport() {
      if (options.noCompression) throw new Error('THREE.BasisTextureLoader: No suitable compressed texture format found.');
      if (options.detectError) throw new Error('Renderer failed');
      return this;
    }
    dispose() { disposed.basis++; }
    _allocateWorker() {
      const worker = {
        _taskLoad: 4, _callbacks: {},
        postMessage: message => {
          assert.equal(this.workerConfig.format, 13);
          const pixels = new Uint8Array([255, 64, 0, 255]);
          worker._callbacks[message.id].resolve({width: 1, height: 1, mipmaps: [{data: pixels, width: 1, height: 1}]});
        }
      };
      this.worker = worker;
      return Promise.resolve(worker);
    }
    load(url, onLoad, onProgress, onError) {
      if (!options.noCompression) return super.load(url, onLoad, onProgress, onError);
      this._createTexture(new ArrayBuffer(4)).then(onLoad, onError);
      return {};
    }
  }
  BasisTextureLoader.BASIS_FORMAT = {cTFRGBA32: 13};
  const api = new Function('THREE', 'BasisTextureLoader', 'GLTFLoader', 'OBJLoader', 'DRACOLoader', 'setTimeout', 'clearTimeout', 'console', source + '\nreturn {loadAssets};')(
    Object.assign({}, THREE, {TextureLoader: Loader, FontLoader: Loader, AudioLoader: Loader}),
    BasisTextureLoader, GLTFLoader, Loader, DRACOLoader,
    (fn, ms) => { assert.equal(ms, 90000); const id = ++timerId; timers.set(id, fn); return id; },
    id => timers.delete(id),
    {error(...args) { errors.push(args); }, warn(...args) { warnings.push(args); }, info() {}}
  );
  Object.assign(api, {pending, timers, errors, warnings, disposed});
  Object.defineProperty(api, 'aborted', {get() {return aborted;}});
  return api;
}

async function run() {
  {
    const h = harness({sync: true});
    const options = {repeat: [4, 5], flipY: false};
    const assets = {a: {url: 'model.glb'}, b: {url: 'image.png', options}, c: {url: 'sound.ogg'}};
    let complete = 0;
    const progress = [];
    const handle = h.loadAssets({}, 'assets', assets, () => complete++, value => progress.push(value));
    assert.equal(complete, 1, 'Synchronous callbacks must wait for every asset');
    assert.deepEqual(progress, [1, 2, 3], 'Models and audio must also report progress');
    assert.equal(handle.state, 'complete');
    assert.equal(h.timers.size, 0);
    assert.equal(h.disposed.draco, 1);
    assert.deepEqual(options.repeat, [4, 5], 'Source options remain reusable');
    assert.equal(assets.b.repeat.x, 4);
    assert.equal(assets.b.flipY, false);
  }
  {
    const h = harness();
    const assets = {a: {url: 'missing.png'}, b: {url: 'model.glb'}};
    const errors = [];
    let complete = 0;
    const handle = h.loadAssets({}, 'assets/', assets, () => complete++, null, false, error => errors.push(error));
    h.pending[0].onError(new Error('HTTP 404'));
    h.pending[1].onError(new Error('Decoder failed'));
    h.pending[1].onLoad({scene: new THREE.Group()});
    assert.equal(errors.length, 1);
    assert.equal(errors[0].assetId, 'a');
    assert.equal(errors[0].path, 'assets/missing.png');
    assert.match(errors[0].message, /HTTP 404/);
    assert.equal(complete, 0);
    assert.equal(handle.state, 'failed');
    assert.equal(h.timers.size, 0);
    assert.equal(h.disposed.draco, 1);
    assert.equal(h.aborted, 2);
    assert.equal(assets.a.loading, false);
  }
  for (const failure of ['invalid', 'unsupported', 'load', 'detect', 'decode', 'progress', 'complete']) {
    const h = harness({throwLoad: failure === 'load', detectError: failure === 'detect'});
    const assets = {asset: failure === 'invalid' ? {} : {url: failure === 'unsupported' ? 'data.exe' : failure === 'detect' || failure === 'decode' ? 'image.basis' : 'image.png'}};
    let error;
    const handle = h.loadAssets({}, 'assets', assets,
      () => { if (failure === 'complete') throw new Error('Completion failed'); },
      () => { if (failure === 'progress') throw new Error('Progress failed'); }, false,
      value => { error = value; });
    if (failure === 'decode') h.pending[0].onError(new Error('Invalid texture'));
    if (failure === 'progress' || failure === 'complete') h.pending[0].onLoad(new THREE.Texture());
    assert(error, failure + ' must report a terminal error');
    assert.equal(error.assetId, 'asset');
    assert.equal(handle.state, 'failed');
    assert.equal(h.timers.size, 0);
  }
  {
    const h = harness();
    let error;
    let completed = false;
    const handle = h.loadAssets({}, 'assets', {image: {url: 'stuck.basis'}}, () => {completed = true;}, null, false, value => {error = value;});
    [...h.timers.values()][0]();
    assert.match(error.message, /Tiempo de espera/);
    assert.equal(error.path, 'assets/stuck.basis');
    assert.equal(handle.state, 'failed');
    assert.equal(completed, false);
    assert.equal(h.timers.size, 0);
    assert.equal(h.disposed.basis, 1);
  }
  {
    const h = harness();
    let callbacks = 0;
    const handle = h.loadAssets({}, '', {model: {url: 'model.glb'}}, () => callbacks++, () => callbacks++, false, () => callbacks++);
    handle.cancel(); handle.dispose();
    h.pending[0].onLoad({}); h.pending[0].onError(new Error('Late error'));
    assert.equal(callbacks, 0);
    assert.equal(handle.state, 'cancelled');
    assert.equal(h.timers.size, 0);
    assert.equal(h.disposed.draco, 1);
    assert.equal(h.aborted, 1);
  }
  {
    const h = harness();
    let complete = 0;
    const handle = h.loadAssets({}, '', {}, () => complete++);
    assert.equal(handle.state, 'complete');
    assert.equal(complete, 1);
  }
  {
    const h = harness({noCompression: true});
    const assets = {texture: {url: 'controller.basis'}};
    let completed = false;
    let error;
    const handle = h.loadAssets({}, 'assets', assets, () => {completed = true;}, null, false, value => {error = value;});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(error, undefined);
    assert.equal(completed, true);
    assert.equal(handle.state, 'complete');
    assert(assets.texture.isDataTexture);
    assert.deepEqual([...assets.texture.image.data], [255, 64, 0, 255]);
    assert.equal(assets.texture.format, THREE.RGBAFormat);
    assert.equal(h.disposed.basis, 1);
    assert.equal(h.warnings.length, 1);
    assert.equal(h.timers.size, 0);
  }

  // Verify the shipped WASM really supports this output, independently of the
  // GPU and fake worker used above. No placeholder or substitute texture.
  const BASIS = require('../src/vendor/basis_transcoder.js');
  await new Promise((resolve, reject) => {
    const module = {
      wasmBinary: fs.readFileSync(path.join(__dirname, '../src/vendor/basis_transcoder.wasm')),
      onRuntimeInitialized() {
        try {
          module.initializeBasis();
          const bytes = fs.readFileSync(path.join(__dirname, '../assets/controller.basis'));
          const file = new module.BasisFile(new Uint8Array(bytes));
          assert(file.startTranscoding());
          const width = file.getImageWidth(0, 0), height = file.getImageHeight(0, 0);
          const pixels = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 13));
          assert.equal(pixels.length, width * height * 4);
          assert(file.transcodeImage(pixels, 0, 0, 13, 0, file.getHasAlpha()));
          file.close(); file.delete(); resolve();
        } catch (error) {reject(error);}
      }
    };
    BASIS(module);
  });
  console.log('Asset loading: progress, failures, timeout, cleanup, callback errors and real RGBA Basis transcoding passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
