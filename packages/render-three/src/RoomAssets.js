import * as THREE from 'three';
import {loadAssets} from './assetManager.js';

// Keep small hall portal previews ready. Full panorama/secondary-room textures
// are fetched only when their room (or a copied native visual) needs them.
const ROOM_TEXTURES = {
  panoramastereo: ['stereopanoL', 'stereopanoR'],
  panorama1: ['pano2'], panorama2: ['pano3'], panorama3: ['pano4'], panorama4: ['pano5'], panorama5: ['pano6'],
  photogrammetry: ['pg_floor_tex', 'pg_floor_lm_tex', 'pg_door_lm_tex', 'pg_object_tex', 'pg_bg_tex', 'pg_flare_tex', 'pg_panel_tex'],
  vertigo: ['vertigo_lm_tex', 'checkboard_tex']
};

function texturesIn(root, visit) {
  if (!root) return;
  const seen = new Set(), materialsSeen = new Set();
  const scan = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 6 || value.isObject3D || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
    if (value.isTexture) { visit(value); return; }
    seen.add(value);
    if (Array.isArray(value)) value.forEach(item => scan(item, depth + 1));
    else Object.keys(value).forEach(key => scan(value[key], depth + 1));
  };
  root.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach(material => {
      if (materialsSeen.has(material)) return; materialsSeen.add(material);
      Object.keys(material).forEach(key => scan(material[key]));
    });
  });
}

function deferredTexture(texture, id, register) {
  // Three r112 textures have no userData and Texture.copy/clone drops custom
  // metadata and compressed/data flags. Scope this compatibility bridge to
  // deferred textures so native visual copies keep their loading dependency.
  texture.userData = Object.assign({}, texture.userData, {roomAssetId: id});
  texture.clone = function() {
    const copy = THREE.Texture.prototype.clone.call(this);
    copy.isDataTexture = !!this.isDataTexture;
    copy.isCompressedTexture = !!this.isCompressedTexture;
    deferredTexture(copy, id, register);
    if (this.userData && this.userData.roomAssetReleased) copy.userData.roomAssetReleased = true;
    if (register) register(copy);
    copy.needsUpdate = true;
    return copy;
  };
  return texture;
}

export default class RoomAssets {
  constructor(renderer, assets, options = {}) {
    this.renderer = renderer;
    this.assets = assets;
    this.options = options; this.activeIds = new Set(); this.activeRoot = null; this.activeRoom = null;
    this.prepared = new Map(); this.tracked = new WeakSet(); this.sequence = 0; this.disposed = false;
    this.queue = []; this.running = 0;
    this.stats = {loads: 0, cancellations: 0, releases: 0, cacheHits: 0};
    this.placeholder = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
    this.records = new Map();
    Object.keys(ROOM_TEXTURES).forEach(room => ROOM_TEXTURES[room].forEach(id => {
      if (this.records.has(id) || !assets[id]) return;
      const descriptor = assets[id];
      const texture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
      deferredTexture(texture, id, copy => this.track(id, copy));
      texture.needsUpdate = true;
      this.records.set(id, {descriptor, texture, loaded: null, promise: null, pending: null, references: new Set(), lastUse: 0});
      this.track(id, texture);
      assets[id] = texture;
    }));
  }
  async cooperativeTargets(root, options) {
    const targets = new Map(), stack = root ? [root] : [], materials = new Set(), seen = new Set(), now = () => typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); let started = now(), count = 0;
    const visit = texture => { const id = texture.userData && texture.userData.roomAssetId; if (!this.records.has(id)) return; this.track(id, texture); if (!targets.has(id)) targets.set(id, new Set()); targets.get(id).add(texture); };
    const scan = (value, depth = 0) => { if (!value || typeof value !== 'object' || depth > 6 || value.isObject3D || seen.has(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return; if (value.isTexture) { visit(value); return; } seen.add(value); if (Array.isArray(value)) value.forEach(item => scan(item, depth + 1)); else Object.keys(value).forEach(key => scan(value[key], depth + 1)); };
    while (stack.length) { if (options.signal && options.signal.aborted) throw this.abortError(); const object = stack.pop(); stack.push(...object.children); (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).forEach(material => { if (materials.has(material)) return; materials.add(material); Object.keys(material).forEach(key => scan(material[key])); }); if (++count % 64 === 0 && now() - started >= 8) { await options.yieldControl(); started = now(); } }
    return targets;
  }

  track(id, texture) {
    if (this.tracked.has(texture)) return; const record = this.records.get(id); if (!record) return;
    this.tracked.add(texture); record.references.add(typeof WeakRef === 'function' ? new WeakRef(texture) : texture);
  }
  references(record, visit) { record.references.forEach(reference => { const texture = reference && typeof reference.deref === 'function' ? reference.deref() : reference; if (texture) visit(texture); else record.references.delete(reference); }); }
  idsFor(roomId, root) { const ids = new Set(ROOM_TEXTURES[roomId] || []); texturesIn(root, texture => { const id = texture.userData && texture.userData.roomAssetId; if (this.records.has(id)) { ids.add(id); this.track(id, texture); } }); return ids; }
  abortError() { const error = new Error('La preparación de la sala fue cancelada.'); error.name = 'AbortError'; return error; }
  bytes(texture) {
    if (!texture) return 0; const buffers = new Set(); let bytes = 0;
    const read = image => { if (!image) return; if (Array.isArray(image)) { image.forEach(read); return; } if (image.data && ArrayBuffer.isView(image.data)) { if (!buffers.has(image.data.buffer)) { buffers.add(image.data.buffer); bytes += image.data.buffer.byteLength; } } else if (!texture.isCompressedTexture && image.width && image.height) bytes += image.width * image.height * 4; };
    if (texture.mipmaps && texture.mipmaps.length) texture.mipmaps.forEach(read); else read(texture.image); return bytes;
  }
  limits() { const limits = this.options.getLimits && this.options.getLimits() || {}; return {bytes: this.options.maxRetainedBytes || limits.nativeTextureCacheBytes || 128 * 1024 * 1024, count: this.options.maxCachedTextures || 8, concurrency: this.options.maxConcurrent || limits.assetLoadConcurrency || 2}; }
  getStats() { const loaded = Array.from(this.records.values()).filter(record => record.loaded), bytes = loaded.reduce((sum, record) => sum + this.bytes(record.loaded), 0), limits = this.limits(); return Object.assign({}, this.stats, {loadedTextures: loaded.length, pendingTextures: Array.from(this.records.values()).filter(record => record.pending).length, runningLoads: this.running, queuedLoads: this.queue.filter(job => !job.finished).length, loadConcurrency: limits.concurrency, retainedBytesEstimated: bytes, budgetBytes: limits.bytes, protectedTextures: this.activeIds.size, overBudgetBytes: Math.max(0, bytes - limits.bytes), estimateKind: 'owned-decoded-native-texture-backing-stores'}); }
  finishLoad(job) { if (job.finished) return; job.finished = true; if (job.started) this.running--; this.drain(); }
  drain() { if (this.disposed) return; const limit = Math.max(1, Math.min(4, this.limits().concurrency)); while (this.running < limit && this.queue.length) { const job = this.queue.shift(); if (job.finished || job.record.pending !== job) continue; const wanted = job.pinned || job.signal && !job.signal.aborted || Array.from(job.users).some(token => !token.signal.aborted); if (!wanted) { job.record.pending = null; job.record.promise = null; job.finished = true; this.stats.cancellations++; job.reject(this.abortError()); continue; } job.started = true; this.running++; job.start(); } }
  uv(texture) { return {offset: texture.offset.clone(), repeat: texture.repeat.clone(), center: texture.center.clone(), rotation: texture.rotation, matrix: texture.matrix.clone(), matrixAutoUpdate: texture.matrixAutoUpdate}; }
  restoreUV(texture, state) { texture.offset.copy(state.offset); texture.repeat.copy(state.repeat); texture.center.copy(state.center); texture.rotation = state.rotation; texture.matrix.copy(state.matrix); texture.matrixAutoUpdate = state.matrixAutoUpdate; }
  release(id) {
    const record = this.records.get(id); if (!record || !record.loaded || record.pending || this.activeIds.has(id) || Array.from(this.prepared.values()).some(pin => pin.ids.has(id))) return false;
    this.references(record, texture => { const uv = this.uv(texture); texture.dispose(); this.apply(texture, this.placeholder, id); this.restoreUV(texture, uv); texture.userData.roomAssetReleased = true; });
    record.loaded.dispose(); record.loaded = null; record.promise = null; this.stats.releases++; return true;
  }
  prune() {
    const limits = this.limits(), loaded = Array.from(this.records.entries()).filter(([, record]) => record.loaded).sort((a, b) => a[1].lastUse - b[1].lastUse); let bytes = loaded.reduce((sum, [, record]) => sum + this.bytes(record.loaded), 0), count = loaded.length;
    for (const [id, record] of loaded) { if (bytes <= limits.bytes && count <= limits.count) break; const size = this.bytes(record.loaded); if (this.release(id)) { bytes -= size; count--; } }
    return this.getStats();
  }
  setActiveRoom(roomId, root) {
    if (this.disposed) return; this.activeRoom = String(roomId); this.activeRoot = root; const prepared = Array.from(this.prepared.values()).find(pin => pin.root === root && pin.roomId === this.activeRoom); this.activeIds = prepared ? new Set(prepared.ids) : this.idsFor(roomId, root);
    this.activeIds.forEach(id => { const record = this.records.get(id); if (record) record.lastUse = ++this.sequence; });
    this.prepared.forEach(pin => this.forgetPin(pin)); this.prepared.clear(); this.prune();
  }
  forgetPin(pin) { if (pin.signal && pin.abort) pin.signal.removeEventListener('abort', pin.abort); if (pin.parentSignal && pin.bridge) pin.parentSignal.removeEventListener('abort', pin.bridge); }

  initialAssets() {
    const result = {};
    Object.keys(this.assets).forEach(id => { if (!this.records.has(id)) result[id] = this.assets[id]; });
    return result;
  }

  apply(texture, source, id) {
    const userData = texture.userData;
    texture.copy(source);
    texture.isDataTexture = !!source.isDataTexture;
    texture.isCompressedTexture = !!source.isCompressedTexture;
    texture.userData = Object.assign({}, userData, {roomAssetId: id});
    texture.needsUpdate = true;
  }

  load(id, options = {}) {
    const record = this.records.get(id);
    if (!record) return Promise.resolve();
    const signal = options.signal; if (this.disposed || signal && signal.aborted) return Promise.reject(this.abortError());
    record.lastUse = ++this.sequence; if (record.loaded) this.stats.cacheHits++;
    if (!record.promise) {
      let resolveJob, rejectJob; const promise = new Promise((resolve, reject) => { resolveJob = resolve; rejectJob = reject; });
      const job = {record, signal, users: new Set(), pinned: !signal, handle: null, reject: rejectJob}; record.pending = job; this.stats.loads++;
      record.promise = promise.catch(error => { if (record.pending === job) { record.pending = null; record.promise = null; } throw error; });
      const batch = {[id]: record.descriptor};
      job.start = () => { job.handle = loadAssets(this.renderer, "modules/turismo/assets/", batch, () => {
        if (record.pending !== job || this.disposed) { if (batch[id] && batch[id].dispose) batch[id].dispose(); return; }
        record.loaded = batch[id];
        this.references(record, texture => { const uv = texture.userData && texture.userData.roomAssetReleased ? this.uv(texture) : null; this.apply(texture, record.loaded, id); if (uv) this.restoreUV(texture, uv); delete texture.userData.roomAssetReleased; });
        record.pending = null; resolveJob(); this.finishLoad(job);
      }, null, false, error => { rejectJob(error); this.finishLoad(job); }); };
      this.queue.push(job); this.drain();
    }
    if (!signal || !record.pending) { if (record.pending) record.pending.pinned = true; return record.promise; }
    const job = record.pending, token = {signal}; job.users.add(token);
    return new Promise((resolve, reject) => {
      const finish = () => { signal.removeEventListener('abort', abort); job.users.delete(token); };
      const abort = () => { finish(); reject(this.abortError()); if (!job.pinned && !job.users.size && record.pending === job) { record.pending = null; record.promise = null; if (job.handle) job.handle.cancel(); this.stats.cancellations++; job.reject(this.abortError()); this.finishLoad(job); } };
      signal.addEventListener('abort', abort, {once: true}); record.promise.then(value => { finish(); resolve(value); }, error => { finish(); reject(error); });
    });
  }

  async prepareDependencies(root, options = {}) {
    let targets = new Map();
    if (typeof options.yieldControl === 'function') targets = await this.cooperativeTargets(root, options);
    else texturesIn(root, texture => {
      const id = texture.userData && texture.userData.roomAssetId;
      if (!this.records.has(id)) return;
      this.track(id, texture);
      if (!targets.has(id)) targets.set(id, new Set());
      targets.get(id).add(texture);
    });
    await Promise.all(Array.from(targets.keys()).map(id => this.load(id, options)));
    if (options.signal && options.signal.aborted) throw this.abortError();
    targets.forEach((textures, id) => textures.forEach(texture => {
      const record = this.records.get(id);
      // New clones may have inherited a placeholder before the source was loaded.
      if (record.loaded && texture.image !== record.loaded.image) this.apply(texture, record.loaded, id);
    }));
    for (let node = root; node; node = node.parent) if (node === this.activeRoot) { targets.forEach((_, id) => this.activeIds.add(id)); break; }
    return targets;
  }

  async prepareRoom(roomId, root, options = {}) {
    if (this.disposed || options.signal && options.signal.aborted) throw this.abortError();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null, effective = controller ? Object.assign({}, options, {signal: controller.signal}) : options;
    const token = {}, pin = {ids: new Set(ROOM_TEXTURES[roomId] || []), root, roomId: String(roomId), signal: effective.signal, parentSignal: options.signal}; this.prepared.set(token, pin);
    if (controller && options.signal) { pin.bridge = () => controller.abort(); options.signal.addEventListener('abort', pin.bridge, {once: true}); }
    if (pin.signal) { pin.abort = () => { this.prepared.delete(token); this.prune(); }; pin.signal.addEventListener('abort', pin.abort, {once: true}); }
    try { const native = Promise.all(Array.from(pin.ids).map(id => this.load(id, effective))), result = await Promise.all([native, this.prepareDependencies(root, effective)]); result[1].forEach((_, id) => pin.ids.add(id)); }
    catch (error) { if (controller) controller.abort(); this.forgetPin(pin); this.prepared.delete(token); throw error; }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.activeIds.clear(); this.prepared.forEach(pin => this.forgetPin(pin)); this.prepared.clear();
    this.records.forEach(record => { if (record.pending) { const job = record.pending; record.pending = null; record.promise = null; if (job.handle) job.handle.cancel(); job.reject(this.abortError()); this.finishLoad(job); } }); this.queue.length = 0;
    this.records.forEach((_, id) => this.release(id)); this.placeholder.dispose();
  }
}
