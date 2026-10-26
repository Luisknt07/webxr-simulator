import {MAX_ASSET_BYTES} from '../../shared/asset-limits.js';

const MIME = /^[a-zA-Z0-9!#$&^_.+-]{1,99}\/[a-zA-Z0-9!#$&^_.+-]{1,100}$/;
const HASH = /^[a-f0-9]{64}$/;

function limitError(maximum, name) {
  const amount = maximum >= 1024 * 1024 ? Number((maximum / (1024 * 1024)).toFixed(2)) + ' MiB' : maximum + ' bytes';
  return Object.assign(new Error((name ? 'El archivo «' + name + '»' : 'El archivo importado') +
    ' supera el límite de ' + amount + '.'), {status: 413, code: 'payload_too_large'});
}

// Copy before the first await without serializing large base64 strings. Saving
// must never change the live document or capture a later editor action.
function snapshot(value, ancestors = new Set()) {
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) throw new Error('El documento contiene una referencia circular.');
  ancestors.add(value);
  const result = Array.isArray(value) ? [] : Object.create(null);
  Object.keys(value).forEach(key => { result[key] = snapshot(value[key], ancestors); });
  ancestors.delete(value);
  return result;
}

function inlineBlob(record, maximum) {
  const value = record.dataUrl;
  if (typeof value !== 'string') throw new Error('Un archivo importado no contiene datos base64 válidos.');
  const comma = value.indexOf(',');
  const header = comma < 0 || comma > 300 ? null :
    /^data:([a-zA-Z0-9!#$&^_.+\/-]*)(?:;[a-zA-Z0-9!#$&^_.+\/=\-]+)*;base64$/.exec(value.slice(0, comma));
  if (!header) throw new Error('Un archivo importado no contiene datos base64 válidos.');
  const start = comma + 1, length = value.length - start;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const expectedSize = Math.floor(length * 3 / 4) - padding;
  if (expectedSize > maximum) throw limitError(maximum, record.path);
  if (length % 4 === 1 || (padding && length % 4 !== 0)) {
    throw new Error('Un archivo importado no contiene datos base64 válidos.');
  }
  const chunks = [];
  // A multiple of four keeps base64 groups intact; no second full-size binary
  // string is created while migrating older inline project documents.
  const chunkSize = 256 * 1024;
  let size = 0;
  for (let offset = 0; offset < length; offset += chunkSize) {
    const encoded = value.slice(start + offset, start + Math.min(offset + chunkSize, length));
    let decoded;
    try {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || (offset + chunkSize < length && encoded.includes('='))) throw new Error();
      decoded = atob(encoded);
      if (btoa(decoded).replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error();
    } catch (_) { throw new Error('Un archivo importado no contiene datos base64 válidos.'); }
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
    size += bytes.length;
    chunks.push(bytes);
  }
  if (size !== expectedSize || (record.size !== undefined && record.size !== size)) {
    throw new Error('El tamaño del archivo importado no coincide con sus datos.');
  }
  return new Blob(chunks, {type: header[1] || 'application/octet-stream'});
}

// All persistence requests share the editor's HTTPS origin and leave WebXR untouched.
export default class ProjectClient {
  constructor(base = '/api') {
    this.base = base;
    this.maxAssetBytes = MAX_ASSET_BYTES;
    this.assetUploadAvailable = false;
    this.uploads = new WeakMap();
    // Keep short hashes/references only, never base64 data.
    this.inlineAssets = new Map();
    this.identityProvider = null;
  }

  identityHeaders() {
    const userId = typeof this.identityProvider === 'function' ? this.identityProvider() : null;
    return typeof userId === 'string' && userId ? {'X-Studio-User': userId} : {};
  }

  scopeIdentity() { return typeof this.identityProvider === 'function' ? this.identityProvider() || null : null; }
  assertIdentity(identity) { if (identity !== this.scopeIdentity()) throw Object.assign(new Error('La cuenta cambió durante la operación. El resultado anterior no se aplicó.'), {status: 409, code: 'session_changed'}); }

  async responseResult(response, identity = this.scopeIdentity()) {
    let result;
    try { result = await response.json(); }
    catch (cause) {
      throw new Error('El servidor no ofrece el guardado de proyectos. Inicia el sitio con npm.cmd start.');
    }
    if (!response.ok) {
      const detail = result && result.error;
      const error = new Error(typeof detail === 'string' ? detail : detail && detail.message || 'No se pudo completar la operación.');
      error.status = response.status;
      error.code = result && (result.code || detail && detail.code);
      if ((error.code === 'session_changed' || error.status === 401) && this.onSessionChange && identity === this.scopeIdentity()) this.onSessionChange(error);
      throw error;
    }
    return result;
  }

  async request(method, path, body) {
    const identity = this.scopeIdentity();
    let response;
    try {
      response = await fetch(this.base + path, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: Object.assign(body === undefined ? {Accept: 'application/json'} : {Accept: 'application/json', 'Content-Type': 'application/json'}, this.identityHeaders()),
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (cause) {
      throw new Error('No se pudo conectar con el guardado del servidor. Comprueba que npm.cmd start siga ejecutándose.');
    }
    this.assertIdentity(identity);
    const result = await this.responseResult(response, identity); this.assertIdentity(identity); return result;
  }

  async health() {
    const result = await this.request('GET', '/health');
    if (!result || result.storage !== 'sqlite') throw new Error('El almacenamiento SQLite no está disponible.');
    this.assetUploadAvailable = !!(result.capabilities && result.capabilities.assetUpload === true);
    if (result.limits && Number.isSafeInteger(result.limits.maxAssetBytes) && result.limits.maxAssetBytes > 0) {
      this.maxAssetBytes = result.limits.maxAssetBytes;
    }
    return result;
  }

  async uploadAsset(fileOrBlob, mime, name) {
    const identity = this.scopeIdentity();
    name = name || fileOrBlob && fileOrBlob.name || '';
    if (!fileOrBlob || !Number.isSafeInteger(fileOrBlob.size) || fileOrBlob.size < 0 ||
        typeof fileOrBlob.arrayBuffer !== 'function' || typeof fileOrBlob.slice !== 'function') {
      throw new Error('Selecciona un archivo válido para importar.');
    }
    if (fileOrBlob.size > this.maxAssetBytes) throw limitError(this.maxAssetBytes, name);
    mime = mime || fileOrBlob.type || 'application/octet-stream';
    if (typeof mime !== 'string' || !MIME.test(mime)) throw new Error('El tipo del archivo no es válido.');
    mime = mime.toLowerCase();
    const previous = this.uploads.get(fileOrBlob);
    if (previous && previous.mime === mime && previous.identity === identity) { const result = await previous.promise; this.assertIdentity(identity); return Object.assign({}, result); }
    const promise = (async () => {
      let response;
      try {
        response = await fetch(this.base + '/assets', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: Object.assign({Accept: 'application/json', 'Content-Type': 'application/octet-stream', 'X-Asset-Mime': mime}, this.identityHeaders()),
          body: fileOrBlob
        });
      } catch (_) { throw new Error('No se pudo subir el archivo al servidor. Comprueba que npm.cmd start siga ejecutándose.'); }
      this.assertIdentity(identity);
      const result = await this.responseResult(response, identity); this.assertIdentity(identity);
      const asset = result && result.asset;
      if (!asset || typeof asset.sha256 !== 'string' || !HASH.test(asset.sha256) ||
          asset.url !== '/api/assets/' + asset.sha256 || typeof asset.mime !== 'string' || !MIME.test(asset.mime) ||
          !Number.isSafeInteger(asset.size) || asset.size !== fileOrBlob.size) {
        throw new Error('El servidor devolvió una referencia de archivo inválida.');
      }
      return {url: asset.url, sha256: asset.sha256, mime: asset.mime, size: asset.size};
    })();
    const pending = {mime, promise, identity};
    this.uploads.set(fileOrBlob, pending);
    try { return Object.assign({}, await promise); }
    catch (error) {
      if (this.uploads.get(fileOrBlob) === pending) this.uploads.delete(fileOrBlob);
      throw error;
    }
  }

  async stageDocument(document) {
    const identity = this.scopeIdentity();
    // Old servers and offline adapters keep accepting their original JSON API.
    if (!this.assetUploadAvailable || !document || !Array.isArray(document.imports)) return document;
    for (const record of document.imports) {
      this.assertIdentity(identity);
      if (!record || record.dataUrl === undefined) continue;
      const blob = inlineBlob(record, this.maxAssetBytes);
      let hash;
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        this.assertIdentity(identity);
        hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      }
      const cacheKey = hash && (identity || 'legacy') + ':' + hash;
      let asset = cacheKey && this.inlineAssets.get(cacheKey);
      if (!asset) {
        asset = await this.uploadAsset(blob, blob.type, record.path);
        this.assertIdentity(identity);
        if (hash && asset.sha256 !== hash) throw new Error('El archivo recibido no coincide con el archivo importado.');
        if (hash) {
          this.inlineAssets.set(cacheKey, asset);
          if (this.inlineAssets.size > 128) this.inlineAssets.delete(this.inlineAssets.keys().next().value);
        }
      }
      Object.assign(record, asset);
      delete record.dataUrl;
    }
    return document;
  }
  async listProjects() { return (await this.request('GET', '/projects')).projects; }
  async getProject(id, revision) {
    const suffix = revision === undefined || revision === null || revision === '' ? '' : '/revisions/' + encodeURIComponent(revision);
    return (await this.request('GET', '/projects/' + encodeURIComponent(id) + suffix)).project;
  }
  async listRevisions(id) { return (await this.request('GET', '/projects/' + encodeURIComponent(id) + '/revisions')).revisions; }
  async createProject(name, document) {
    const identity = this.scopeIdentity();
    const savedDocument = await this.stageDocument(snapshot(document));
    this.assertIdentity(identity);
    return (await this.request('POST', '/projects', {name, document: savedDocument})).project;
  }
  async updateProject(id, name, document, expectedRevision) {
    const identity = this.scopeIdentity();
    const savedDocument = await this.stageDocument(snapshot(document));
    this.assertIdentity(identity);
    return (await this.request('PUT', '/projects/' + encodeURIComponent(id), {name, document: savedDocument, expectedRevision})).project;
  }
}
