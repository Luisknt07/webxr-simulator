import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { BasisTextureLoader } from 'three/examples/jsm/loaders/BasisTextureLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import assetDefinitions from '../../../../modules/turismo/functions/museo/assets.js';
import assetLimits from '../../../render-three/schema/asset-limits.js';
import { optimizeModel } from '../../../render-three/src/ModelOptimizer.js';
import {prepareModelAcceleration} from '../../../render-three/src/GeometryAcceleration.js';

const EXTENSIONS = {
  model: ['glb', 'gltf', 'obj', 'fbx'],
  image: ['basis', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
  audio: ['ogg', 'mp3', 'wav', 'm4a', 'aac', 'flac'],
  video: ['mp4', 'webm', 'mov'],
  text: ['json', 'js', 'txt', 'md', 'csv', 'xml', 'mtl', 'font'],
  source: ['blend', 'blend1', 'blend2']
};

function normalizedPath(value) {
  const segments = String(value || '').replace(/\\/g, '/').split('/');
  const result = [];
  segments.forEach(segment => {
    if (segment === '..') result.pop();
    else if (segment && segment !== '.') result.push(segment);
  });
  return result.join('/');
}

function entryFor(path, size) {
  path = normalizedPath(path);
  const name = path.split('/').pop();
  const extension = name.indexOf('.') < 0 ? '' : name.split('.').pop().toLowerCase();
  return {
    path, name, extension, size,
    kind: Object.keys(EXTENSIONS).find(kind => EXTENSIONS[kind].indexOf(extension) !== -1) || 'other'
  };
}

function directoryOf(path) {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

function assetURL(path) {
  if (typeof path !== 'string' || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) throw new Error('El recurso incluido debe usar una ruta local.');
  let relative = normalizedPath(path);
  if (!/^(?:modules|packages|projects)\//.test(relative)) {
    // Saved catalog entries retain their logical paths while their physical
    // files belong to the corresponding module or tool package.
    if (relative.startsWith('assets/')) relative = relative.slice(7);
    const roots = {'editor-previews/':'packages/tools/editor/assets/previews/', 'blender/':'modules/logistica-industrial/assets/blender/',
      'materials/':'modules/logistica-industrial/assets/materials/', 'ai/':'packages/tools/ai/assets/', 'scene-thumbnails/':'projects/smarttwin/previews/'};
    const prefix = Object.keys(roots).find(key => relative.startsWith(key));
    relative = prefix ? roots[prefix] + relative.slice(prefix.length) : 'modules/turismo/assets/' + relative;
  }
  return relative.split('/').map(encodeURIComponent).join('/');
}

// Server assets are addressed by content hash and stay on this application's
// origin. A scene file must never turn its saved import reference into a fetch
// to an arbitrary host, endpoint, or local path.
function storedAssetURL(value) {
  if (typeof value !== 'string' || !/^\/api\/assets\/[a-f0-9]{64}$/.test(value)) {
    throw new Error('La referencia del archivo guardado no es válida.');
  }
  return value;
}

function urlFor(entry) {
  return entry.dataUrl || (entry.url ? storedAssetURL(entry.url) : assetURL(entry.path));
}

function loadWith(loader, url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer ' + (file.name || 'el archivo') + '.'));
    reader.onabort = () => reject(new Error('Se canceló la lectura del archivo.'));
    reader.readAsDataURL(file);
  });
}

function importName(file) {
  return file && (file.webkitRelativePath || file.name) || 'el archivo';
}

function sizeInMiB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2).replace(/\.00$/, '');
}

function importSizeError(file, limit) {
  const name = importName(file);
  if (!file || !Number.isSafeInteger(file.size) || file.size < 0) {
    return new Error('No se pudo importar "' + name + '": el tamaño del archivo no es válido.');
  }
  if (file.size > limit) {
    return new Error('No se pudo importar "' + name + '": pesa ' + sizeInMiB(file.size) +
      ' MiB y supera el límite de ' + sizeInMiB(limit) + ' MiB por archivo.');
  }
  return null;
}

function uploadedAsset(uploaded, file, limit) {
  if (!uploaded || typeof uploaded.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(uploaded.sha256) ||
      uploaded.url !== '/api/assets/' + uploaded.sha256 || typeof uploaded.mime !== 'string' ||
      !Number.isSafeInteger(uploaded.size) || uploaded.size !== file.size || uploaded.size > limit) {
    throw new Error('El servidor devolvió una referencia o un tamaño de archivo no válido.');
  }
  return { url: storedAssetURL(uploaded.url), sha256: uploaded.sha256, mime: uploaded.mime, size: uploaded.size };
}

function materialsOf(object) {
  return Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
}

// Each loaded model owns its resources, including copies of native baked materials.
// Disposing a preview never disposes the running WebXR scene's textures.
function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    materialsOf(object).forEach(material => {
      materials.add(material);
      Object.keys(material).forEach(key => {
        if (material[key] && material[key].isTexture) textures.add(material[key]);
      });
      Object.keys(material.uniforms || {}).forEach(key => {
        const value = material.uniforms[key].value;
        if (value && value.isTexture) textures.add(value);
      });
    });
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

function cloneNativeMaterial(material, textureCopies) {
  const copy = material.clone();
  Object.keys(material).forEach(key => {
    const texture = material[key];
    if (texture && texture.isTexture) {
      if (!textureCopies.has(texture)) {
        const textureCopy = texture.clone();
        textureCopy.needsUpdate = true;
        textureCopies.set(texture, textureCopy);
      }
      copy[key] = textureCopies.get(texture);
    }
  });
  // ShaderMaterial.clone already clones its uniforms, including texture uniforms.
  Object.keys(copy.uniforms || {}).forEach(key => {
    const texture = copy.uniforms[key].value;
    if (texture && texture.isTexture) texture.needsUpdate = true;
  });
  return copy;
}

export default class AssetLibrary {
  constructor(ctx) {
    this.ctx = ctx;
    this.catalog = null;
    this.imports = [];
    this.previews = new WeakMap();
    this.nextImport = 1;
  }

  async getCatalog() {
    if (!this.catalog) {
      const response = await fetch("packages/tools/editor/assets/catalog.json", { cache: 'no-store' });
      if (!response.ok) throw new Error('No se pudo cargar el catálogo. Ejecuta node scripts/generate-asset-catalog.js.');
      const catalog = await response.json();
      if (!Array.isArray(catalog)) throw new Error('El catálogo de archivos no es válido.');
      const models = new Set(catalog.filter(entry => entryFor(entry.path, entry.size).kind === 'model').map(entry => entry.path));
      this.catalog = catalog.map(record => {
        const entry = entryFor(record.path, record.size);
        if (typeof record.thumbnailPath === 'string' && /^editor-previews\/[a-zA-Z0-9_-]+\.png$/.test(record.thumbnailPath)) entry.thumbnailPath = record.thumbnailPath;
        if (typeof record.previewPath === 'string' && models.has(record.previewPath) && normalizedPath(record.previewPath) === record.previewPath && !record.previewPath.startsWith('/')) entry.previewPath = record.previewPath;
        return entry;
      });
    }
    return this.catalog.concat(this.imports);
  }

  getEntry(pathOrId) {
    return this.imports.find(entry => entry.id === pathOrId) ||
      (this.catalog || []).find(entry => entry.path === pathOrId) ||
      this.imports.find(entry => entry.path === pathOrId);
  }

  getURL(entryOrDescriptor) {
    if (typeof entryOrDescriptor === 'string') {
      const entry = this.getEntry(entryOrDescriptor);
      return entry ? urlFor(entry) : assetURL(entryOrDescriptor);
    }
    if (!entryOrDescriptor) throw new Error('El archivo no tiene una ruta.');
    if (entryOrDescriptor.importId || entryOrDescriptor.id) {
      const entry = this.getEntry(entryOrDescriptor.importId || entryOrDescriptor.id);
      if (!entry) throw new Error('No se encontró el archivo importado del escenario.');
      return urlFor(entry);
    }
    if (entryOrDescriptor.dataUrl) return entryOrDescriptor.dataUrl;
    if (entryOrDescriptor.url) return storedAssetURL(entryOrDescriptor.url);
    if (entryOrDescriptor.path) return assetURL(entryOrDescriptor.path);
    throw new Error('El archivo no tiene una ruta.');
  }

  async loadFiles(files, options = {}) {
    const list = Array.from(files || []);
    if (!list.length) return [];
    const maxAssetBytes = Number.isSafeInteger(options.maxAssetBytes) && options.maxAssetBytes > 0 ?
      options.maxAssetBytes : assetLimits.MAX_ASSET_BYTES;
    // Check the complete selection before reading or uploading its first byte.
    // A glTF batch must never become a partially imported set of dependencies.
    list.forEach(file => {
      const error = importSizeError(file, maxAssetBytes);
      if (error) throw error;
    });
    if (options.uploadFile !== undefined && typeof options.uploadFile !== 'function') {
      throw new Error('El servicio de importación de archivos no es válido.');
    }
    const batchId = 'batch-' + Date.now().toString(36) + '-' + this.nextImport++;
    const records = [];
    // Send the File itself online instead of retaining its base64 representation
    // in browser history and scene JSON. Upload serially to bound peak memory.
    for (const file of list) {
      const id = batchId + '-' + this.nextImport++;
      try {
        const payload = options.uploadFile ?
          uploadedAsset(await options.uploadFile(file), file, maxAssetBytes) :
          { mime: file.type || '', dataUrl: await readFile(file) };
        records.push(Object.assign(entryFor(file.webkitRelativePath || file.name, file.size), {
          id, importId: id, batchId
        }, payload));
      } catch (error) {
        throw new Error('No se pudo importar "' + importName(file) + '". ' +
          (error.message || 'Comprueba el archivo y la conexión.'));
      }
    }
    if (!options.deferCommit) this.imports = this.imports.concat(records);
    return records;
  }

  exportImports() {
    return this.imports.map(record => Object.assign({}, record));
  }

  // History and server saves use lightweight references. Only standalone JSON
  // exports and browser backups need to fetch every imported asset's bytes.
  async exportPortableImports() {
    return Promise.all(this.exportImports().map(async record => {
      if (!record.dataUrl) {
        try {
          const response = await fetch(storedAssetURL(record.url), { credentials: 'same-origin' });
          if (!response.ok) throw new Error('El servidor respondió ' + response.status + '.');
          record.dataUrl = await readFile(await response.blob());
        } catch (error) {
          throw new Error('No se pudo descargar ' + record.name + ' para incluirlo en el escenario. ' + (error.message || 'Comprueba la conexión.'));
        }
      }
      delete record.url;
      delete record.sha256;
      return record;
    }));
  }

  restoreImports(records) {
    if (!Array.isArray(records)) throw new Error('La lista de archivos importados no es válida.');
    const ids = new Set();
    const restored = records.map(record => {
      if (!record || typeof record.id !== 'string' || ids.has(record.id) ||
          typeof record.path !== 'string' ||
          (record.dataUrl !== undefined && (typeof record.dataUrl !== 'string' || !/^data:[^,]*;base64,/.test(record.dataUrl))) ||
          (!record.dataUrl && !record.url)) {
        throw new Error('Hay un archivo importado inválido o repetido en el escenario.');
      }
      ids.add(record.id);
      const restoredRecord = Object.assign(entryFor(record.path, Number(record.size) || 0), {
        id: record.id, importId: record.id,
        batchId: typeof record.batchId === 'string' ? record.batchId : 'restored',
        mime: typeof record.mime === 'string' ? record.mime : ''
      });
      if (record.dataUrl) restoredRecord.dataUrl = record.dataUrl;
      if (record.url !== undefined) restoredRecord.url = storedAssetURL(record.url);
      if (record.sha256 !== undefined) {
        if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256) ||
            (restoredRecord.url && restoredRecord.url !== '/api/assets/' + record.sha256)) {
          throw new Error('La referencia del archivo guardado no es válida.');
        }
        restoredRecord.sha256 = record.sha256;
      }
      return restoredRecord;
    });
    this.imports = restored;
    return this.exportImports();
  }

  managerFor(record) {
    const manager = new THREE.LoadingManager();
    if (!record || !record.id) return manager;
    const batch = this.imports.filter(item => item.batchId === record.batchId);
    manager.setURLModifier(url => {
      if (/^(data:|blob:)/i.test(url)) return url;
      if (batch.some(item => item.url === url)) return storedAssetURL(url);
      // Decoder code belongs to this application, rather than to the imported bundle.
      if (url.indexOf("packages/render-three/vendor/") === 0) return url;
      let decoded;
      try { decoded = decodeURIComponent(url); } catch (error) { decoded = url; }
      const decodedPrefix = 'editor-imports/' + record.batchId + '/';
      const offset = decoded.indexOf(decodedPrefix);
      const requested = normalizedPath(offset === -1 ? decoded : decoded.slice(offset + decodedPrefix.length));
      const exact = batch.find(item => item.path === requested);
      if (exact) return urlFor(exact);
      // Selecting separate files without directory upload loses their folder paths.
      // Permit an unambiguous filename match in the same import batch.
      const candidates = batch.filter(item => item.name === requested.split('/').pop());
      if (candidates.length === 1) return urlFor(candidates[0]);
      if (offset !== -1 || !/^[a-z]+:/i.test(url)) {
        throw new Error('Falta el recurso "' + requested + '". Importa el modelo junto con sus texturas y archivos .bin.');
      }
      return url;
    });
    return manager;
  }

  async instantiate(descriptor, options = {}) {
    if (!descriptor) throw new Error('Selecciona un modelo de la biblioteca.');
    const reference = descriptor.importId || descriptor.path || descriptor.id;
    if (!reference) throw new Error('El modelo no tiene una ruta de archivo.');
    const entry = this.getEntry(reference) || entryFor(reference, 0);
    if (entry.kind === 'image') {
      let loader;
      let texture;
      let material;
      let geometry;
      try {
        const manager = this.managerFor(entry);
        if (entry.extension === 'basis') {
          if (!this.ctx.renderer) throw new Error('La imagen Basis necesita el renderizador WebGL de la escena.');
          loader = new BasisTextureLoader(manager).setTranscoderPath("packages/render-three/vendor/").setWorkerLimit(1);
          loader.detectSupport(this.ctx.renderer);
        } else {
          loader = new THREE.TextureLoader(manager);
        }
        texture = await loadWith(loader, this.getURL(entry));
        texture.encoding = THREE.sRGBEncoding;
        texture.needsUpdate = true;
        const image = texture.image || {};
        const width = image.naturalWidth || image.width || 1;
        const height = image.naturalHeight || image.height || 1;
        const ratio = Math.max(width / height, 0.000001);
        // Longest side starts at two metres; normal transform controls set its final size.
        geometry = new THREE.PlaneBufferGeometry(2 * Math.min(ratio, 1), 2 * Math.min(1 / ratio, 1));
        material = new THREE.MeshBasicMaterial({
          map: texture, side: THREE.DoubleSide, transparent: true, alphaTest: 0.01
        });
        const object = new THREE.Mesh(geometry, material);
        object.name = entry.name.replace(/\.[^.]+$/, '');
        return object;
      } catch (error) {
        if (geometry) geometry.dispose();
        if (material) material.dispose();
        if (texture) texture.dispose();
        throw new Error('No se pudo añadir la imagen ' + entry.name + '. ' + (error.message || 'Comprueba el formato de imagen.'));
      } finally {
        if (loader && loader.dispose) loader.dispose();
      }
    }
    return this.loadModel(reference, options);
  }

  async loadModel(pathOrId, options = {}) {
    const entry = this.getEntry(pathOrId) || entryFor(pathOrId, 0);
    if (entry.kind !== 'model') throw new Error('Este archivo no es un modelo compatible. Usa GLB, glTF, OBJ o FBX.');
    const manager = this.managerFor(entry);
    const url = urlFor(entry);
    const resourcePath = entry.id ? 'editor-imports/' + encodeURIComponent(entry.batchId) + '/' + directoryOf(entry.path) : directoryOf(url);
    let draco;
    let object;
    try {
      if (entry.extension === 'glb' || entry.extension === 'gltf') {
        draco = new DRACOLoader(manager).setDecoderPath("packages/render-three/vendor/");
        const loader = new GLTFLoader(manager).setDRACOLoader(draco).setResourcePath(resourcePath);
        const result = await loadWith(loader, url);
        object = result.scene || result.scenes[0];
        if (!object) throw new Error('El archivo glTF no contiene una escena.');
        object.animations = result.animations || [];
      } else if (entry.extension === 'obj') {
        const loader = new OBJLoader(manager);
        const mtlPath = entry.path.replace(/\.obj$/i, '.mtl');
        const mtl = (entry.id ? this.imports.filter(item => item.batchId === entry.batchId) : (this.catalog || [])).find(item => item.path === mtlPath);
        if (mtl) {
          const materials = await loadWith(new MTLLoader(manager).setResourcePath(resourcePath), urlFor(mtl));
          materials.preload();
          loader.setMaterials(materials);
        }
        object = await loadWith(loader, url);
      } else {
        object = await loadWith(new FBXLoader(manager).setResourcePath(resourcePath), url);
      }
      if (!entry.id) this.applyNativeMaterials(object, entry.path);
      object.name = object.name || entry.name.replace(/\.[^.]+$/, '');
      let heavy = false;
      object.traverse(mesh => {
        const geometry = mesh.geometry, position = geometry && geometry.attributes && geometry.attributes.position;
        if (position && (geometry.index ? geometry.index.count : position.count) >= 150000) heavy = true;
      });
      if (heavy && !options.preview && this.onPreparingModel) this.onPreparingModel(entry.name);
      await optimizeModel(object);
      if (!options.preview) await prepareModelAcceleration(object);
      return object;
    } catch (error) {
      if (object) disposeObject(object);
      throw new Error('No se pudo abrir ' + entry.name + '. ' + (error.message || 'Comprueba el archivo y sus recursos asociados.'));
    } finally {
      if (draco) draco.dispose();
    }
  }

  applyNativeMaterials(object, path) {
    const key = Object.keys(assetDefinitions).find(key => assetDefinitions[key].url === path);
    const native = key && this.ctx.assets && this.ctx.assets[key];
    if (!native || !native.scene) return;
    const materialCopies = new Map();
    const textureCopies = new Map();
    const oldMaterials = new Set();
    object.traverse(mesh => {
      if (!mesh.isMesh || !mesh.name) return;
      const original = native.scene.getObjectByName(mesh.name);
      if (!original || !original.material) return;
      materialsOf(mesh).forEach(material => oldMaterials.add(material));
      const copy = material => {
        if (!materialCopies.has(material)) materialCopies.set(material, cloneNativeMaterial(material, textureCopies));
        return materialCopies.get(material);
      };
      mesh.material = Array.isArray(original.material) ? original.material.map(copy) : copy(original.material);
    });
    // Original GLB materials are private to this newly loaded model.
    const retainedTextures = new Set();
    const retainedMaterials = new Set();
    object.traverse(mesh => materialsOf(mesh).forEach(material => {
      retainedMaterials.add(material);
      Object.keys(material).forEach(key => {
        if (material[key] && material[key].isTexture) retainedTextures.add(material[key]);
      });
    }));
    oldMaterials.forEach(material => {
      if (retainedMaterials.has(material)) return;
      Object.keys(material).forEach(key => {
        const texture = material[key];
        if (texture && texture.isTexture && !retainedTextures.has(texture)) {
          retainedTextures.add(texture);
          texture.dispose();
        }
      });
      material.dispose();
    });
  }

  cancelPreview(container) {
    const cleanup = this.previews.get(container);
    if (cleanup) cleanup();
  }

  async preview(entry, container) {
    if (typeof entry === 'string') entry = this.getEntry(entry);
    if (!entry) throw new Error('No se encontró el archivo seleccionado.');
    const previous = this.previews.get(container);
    if (previous) previous();
    let cancelled = false;
    const disposers = [];
    const cleanup = () => {
      if (cancelled) return;
      cancelled = true;
      disposers.forEach(dispose => dispose());
      if (this.previews.get(container) === cleanup) {
        container.textContent = '';
        this.previews.delete(container);
      }
    };
    this.previews.set(container, cleanup);
    container.textContent = '';
    const url = urlFor(entry);
    const addText = text => {
      const node = document.createElement('p');
      node.textContent = text;
      container.appendChild(node);
      return node;
    };
    try {
      if (entry.kind === 'model') {
        const object = await this.loadModel(entry.importId || entry.path, {preview: true});
        if (cancelled) { disposeObject(object); return cleanup; }
        disposers.push(() => disposeObject(object));
        this.previewModel(object, container, disposers);
        addText('Arrastra para girar · rueda para acercar. Usa «Añadir» para colocarlo en el escenario.');
      } else if (entry.kind === 'image' && entry.extension === 'basis') {
        await this.previewBasis(entry, container, disposers, () => cancelled);
      } else if (entry.kind === 'image') {
        const image = document.createElement('img');
        image.alt = entry.name;
        image.style.cssText = 'display:block;max-width:100%;max-height:320px;object-fit:contain;margin:auto';
        image.src = url;
        image.onerror = () => { if (!cancelled) addText('El navegador no pudo decodificar esta imagen.'); };
        container.appendChild(image);
        disposers.push(() => { image.onerror = null; image.removeAttribute('src'); });
      } else if (entry.kind === 'audio' || entry.kind === 'video') {
        const audio = document.createElement(entry.kind === 'video' ? 'video' : 'audio');
        audio.controls = true;
        audio.preload = 'metadata';
        audio.style.maxWidth = '100%';
        audio.src = url;
        audio.onerror = () => { if (!cancelled) addText('El navegador no pudo reproducir este archivo. Puedes descargarlo para abrirlo con otra aplicación.'); };
        container.appendChild(audio);
        const download = document.createElement('a');
        download.href = url; download.download = entry.name; download.textContent = 'Descargar ' + entry.name;
        container.appendChild(download);
        disposers.push(() => { audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); });
      } else if (entry.kind === 'text') {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (controller) disposers.push(() => controller.abort());
        const response = await fetch(url, controller ? {signal: controller.signal} : undefined);
        if (!response.ok) throw new Error('No se pudo leer el archivo de texto.');
        const text = await response.text();
        if (cancelled) return cleanup;
        const pre = document.createElement('pre');
        pre.style.cssText = 'white-space:pre-wrap;overflow:auto;max-height:320px;font-size:11px';
        pre.textContent = text.slice(0, 120000);
        container.appendChild(pre);
        if (text.length > 120000) addText('Vista previa limitada a los primeros 120 000 caracteres.');
      } else {
        if (entry.kind === 'source' && entry.thumbnailPath) {
          const image = document.createElement('img');
          image.alt = 'Vista guardada en Blender · ' + entry.name;
          image.src = this.getURL({path: entry.thumbnailPath});
          image.style.cssText = 'display:block;max-width:100%;object-fit:contain;margin:auto';
          image.onerror = () => { if (!cancelled) addText('No se pudo cargar la vista guardada de Blender.'); };
          container.appendChild(image);
          addText('Vista guardada en el archivo de Blender.');
          disposers.push(() => { image.onerror = null; image.removeAttribute('src'); });
        }
        addText(entry.kind === 'source' ? 'Archivo de Blender: contiene la escena editable original. Ábrelo en Blender y expórtalo a GLB para añadirlo al escenario web.' : 'Archivo disponible en el proyecto. Este formato no tiene vista previa en el navegador.');
        if (entry.kind === 'source' && entry.previewPath) {
          const viewModel = document.createElement('button');
          viewModel.type = 'button'; viewModel.className = 'ed-button'; viewModel.textContent = 'Ver modelo 3D exportado';
          const region = document.createElement('div'); container.appendChild(viewModel); container.appendChild(region);
          viewModel.onclick = async () => {
            if (cancelled || viewModel.disabled) return;
            viewModel.disabled = true; region.textContent = 'Cargando modelo 3D…';
            let object;
            const resources = [];
            try {
              object = await this.loadModel(entry.previewPath, {preview: true});
              if (cancelled) { disposeObject(object); return; }
              resources.push(() => disposeObject(object));
              region.textContent = '';
              this.previewModel(object, region, resources);
              disposers.push(...resources); resources.length = 0;
              addText('Modelo exportado asociado: ' + entry.previewPath + '.');
            } catch (error) {
              resources.forEach(dispose => dispose());
              if (!cancelled) { region.textContent = error.message || 'No se pudo abrir el modelo asociado.'; viewModel.disabled = false; }
            }
          };
          disposers.push(() => { viewModel.onclick = null; });
        }
        const download = document.createElement('a');
        download.textContent = 'Descargar ' + entry.name;
        download.href = url;
        download.download = entry.name;
        container.appendChild(download);
      }
      return cleanup;
    } catch (error) {
      if (cancelled) return cleanup;
      cleanup();
      throw error;
    }
  }

  previewModel(object, container, disposers) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    disposers.push(() => { renderer.dispose(); renderer.forceContextLoss(); });
    renderer.domElement.style.cssText = 'display:block;width:100%;height:240px;touch-action:none';
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x172131);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x525b70, 1.2));
    const light = new THREE.DirectionalLight(0xffffff, 1.3);
    light.position.set(4, 8, 6);
    scene.add(light);
    scene.add(object);
    const box = new THREE.Box3().setFromObject(object);
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.01);
    const camera = new THREE.PerspectiveCamera(40, 1, Math.max(radius / 1000, 0.001), radius * 100 + 100);
    camera.position.copy(center).add(new THREE.Vector3(1.2, 0.8, 1.5).normalize().multiplyScalar(radius * 3.2));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.update();
    const render = () => renderer.render(scene, camera);
    const resize = () => {
      const width = Math.max(container.clientWidth, 160);
      renderer.setSize(width, 240, false);
      camera.aspect = width / 240;
      camera.updateProjectionMatrix();
      render();
    };
    controls.addEventListener('change', render);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(container);
    else window.addEventListener('resize', resize);
    resize();
    disposers.push(() => {
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', resize);
      controls.removeEventListener('change', render);
      controls.dispose();
    });
  }

  async previewBasis(entry, container, disposers, isCancelled) {
    const renderer = new THREE.WebGLRenderer({ alpha: true });
    renderer.outputEncoding = THREE.sRGBEncoding;
    disposers.push(() => { renderer.dispose(); renderer.forceContextLoss(); });
    const loader = new BasisTextureLoader(this.managerFor(entry)).setTranscoderPath("packages/render-three/vendor/").setWorkerLimit(1);
    try {
      loader.detectSupport(renderer);
      const texture = await loadWith(loader, urlFor(entry));
      if (isCancelled()) { texture.dispose(); return; }
      disposers.push(() => texture.dispose());
      texture.encoding = THREE.sRGBEncoding;
      const image = texture.image || {};
      const width = image.width || 512;
      const height = image.height || 512;
      const scale = Math.min(1, 1024 / width, 512 / height);
      renderer.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
      renderer.domElement.style.cssText = 'display:block;max-width:100%;max-height:320px;margin:auto;object-fit:contain';
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
      const geometry = new THREE.PlaneBufferGeometry(2, 2);
      disposers.push(() => { geometry.dispose(); material.dispose(); });
      const scene = new THREE.Scene();
      scene.add(new THREE.Mesh(geometry, material));
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
      camera.position.z = 1;
      renderer.render(scene, camera);
      container.appendChild(renderer.domElement);
    } finally {
      loader.dispose();
    }
  }
}
