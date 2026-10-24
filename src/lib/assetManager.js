import * as THREE from 'three';
import { BasisTextureLoader } from 'three/examples/jsm/loaders/BasisTextureLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const BASIS_LIB_PATH = 'src/vendor/';
const DRACO_LIB_PATH = 'src/vendor/';
const ASSET_TIMEOUT_MS = 90000;

// Three r112 only accepts compressed GPU output, although its Basis transcoder
// also supports RGBA32. Keep the same texture data on software renderers and
// devices without a supported compression extension.
function enableRGBAFallback(loader) {
  loader.workerConfig.format = BasisTextureLoader.BASIS_FORMAT.cTFRGBA32;
  loader._createTexture = function(buffer) {
    let worker;
    let taskID;
    const taskCost = buffer.byteLength;
    return this._allocateWorker(taskCost).then(allocated => {
      worker = allocated;
      taskID = this.workerNextTaskID++;
      return new Promise((resolve, reject) => {
        worker._callbacks[taskID] = {resolve, reject};
        worker.postMessage({type: 'transcode', id: taskID, buffer}, [buffer]);
      });
    }).then(message => {
      const {width, height, mipmaps} = message;
      const texture = new THREE.DataTexture(mipmaps[0].data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
      texture.mipmaps = mipmaps;
      texture.minFilter = mipmaps.length === 1 ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      return texture;
    }).finally(() => {
      if (worker && taskID !== undefined) {
        worker._taskLoad -= taskCost;
        delete worker._callbacks[taskID];
      }
    });
  };
}

// onError is optional for existing callers; errors also reach the console. A
// terminal error stops completion, rather than leaving the welcome spinner up.
export function loadAssets(renderer, basePath, assets, onComplete, onProgress, debug, onError) {
  basePath = basePath || '';
  if (basePath && !basePath.endsWith('/')) basePath += '/';
  let state = 'loading';
  let loadedCount = 0;
  const records = Object.keys(assets).map(id => ({id, descriptor: assets[id], timer: null, request: null, settled: false}));
  let basisLoader;
  let dracoLoader;

  function cleanup() {
    records.forEach(record => {
      clearTimeout(record.timer);
      record.timer = null;
      if (!record.settled && record.request && typeof record.request.abort === 'function') {
        try { record.request.abort(); } catch (_) { /* Already completed. */ }
      }
    });
    if (basisLoader) basisLoader.dispose();
    if (dracoLoader) dracoLoader.dispose();
  }

  function fail(record, cause) {
    if (state !== 'loading') return;
    state = 'failed';
    const path = record && record.url ? basePath + record.url : null;
    const reason = cause && cause.message ? cause.message : String(cause || 'Error desconocido');
    const error = new Error((path ? 'No se pudo cargar ' + path + ': ' : 'No se pudieron cargar los recursos: ') + reason);
    error.assetId = record ? record.id : null;
    error.path = path;
    error.cause = cause;
    cleanup();
    records.forEach(item => { if (item.descriptor && typeof item.descriptor === 'object') item.descriptor.loading = false; });
    console.error('Error loading asset', error);
    if (onError) onError(error);
  }

  const handle = {
    cancel() {
      if (state !== 'loading') return;
      state = 'cancelled';
      cleanup();
      records.forEach(item => { if (item.descriptor && typeof item.descriptor === 'object') item.descriptor.loading = false; });
    },
    dispose() { this.cancel(); },
    get state() { return state; }
  };

  try {
    records.forEach(record => {
      if (!record.descriptor || typeof record.descriptor.url !== 'string' || !record.descriptor.url.trim()) {
        throw Object.assign(new Error('El recurso no tiene una URL válida.'), {record});
      }
      record.url = record.descriptor.url;
      record.extension = record.url.split(/[?#]/)[0].split('.').pop().toLowerCase();
      record.descriptor.loading = true;
    });

    const loaders = {
      gltf: null, glb: null, obj: new OBJLoader(),
      gif: new THREE.TextureLoader(), png: new THREE.TextureLoader(), jpg: new THREE.TextureLoader(),
      basis: null, font: new THREE.FontLoader(), ogg: new THREE.AudioLoader()
    };
    const unsupported = records.find(record => !Object.prototype.hasOwnProperty.call(loaders, record.extension));
    if (unsupported) throw Object.assign(new Error('Formato de recurso no compatible: .' + unsupported.extension), {record: unsupported});

    if (records.some(record => record.extension === 'basis')) {
      basisLoader = new BasisTextureLoader();
      basisLoader.setTranscoderPath(BASIS_LIB_PATH);
      try {
        basisLoader.detectSupport(renderer);
      } catch (error) {
        if (!error || !/No suitable compressed texture format found/.test(error.message)) throw error;
        enableRGBAFallback(basisLoader);
        console.warn('No hay compresión de texturas GPU disponible. Se usarán texturas RGBA con los mismos datos.');
      }
      loaders.basis = basisLoader;
    }

    if (records.some(record => record.extension === 'glb' || record.extension === 'gltf')) {
      const gltfLoader = new GLTFLoader();
      dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath(DRACO_LIB_PATH);
      gltfLoader.setDRACOLoader(dracoLoader);
      loaders.gltf = loaders.glb = gltfLoader;
    }

    if (!records.length) {
      if (onComplete) onComplete();
      state = 'complete';
      cleanup();
    }

    records.forEach(record => {
      if (state !== 'loading') return;
      record.timer = setTimeout(() => fail(record, new Error('Tiempo de espera agotado al descargar o decodificar el recurso (90 s).')), ASSET_TIMEOUT_MS);
      try {
        record.request = loaders[record.extension].load(basePath + record.url, asset => {
          if (state !== 'loading' || record.settled) return;
          clearTimeout(record.timer);
          record.timer = null;
          try {
            const value = record.extension === 'font' ? asset.data : asset;
            const options = record.descriptor.options;
            if (options) {
              Object.keys(options).forEach(option => {
                if (option === 'repeat') value.repeat.set(options.repeat[0], options.repeat[1]);
                else value[option] = options[option];
              });
            }
            assets[record.id] = value;
            record.settled = true;
            loadedCount++;
            if (debug) console.info('%c ' + record.url + ' loaded', 'color:green');
            if (onProgress) onProgress(loadedCount);
            if (state === 'loading' && loadedCount === records.length) {
              if (onComplete) onComplete();
              state = 'complete';
              cleanup();
            }
          } catch (error) { fail(record, error); }
        }, undefined, error => fail(record, error));
      } catch (error) { fail(record, error); }
    });
  } catch (error) { fail(error.record || records[0], error); }

  return handle;
}
