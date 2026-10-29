import * as THREE from 'three';

const MANIFEST = {
  256: "modules/logistica-industrial/assets/materials/ai-industrial-concrete-v1-256.jpg",
  512: "modules/logistica-industrial/assets/materials/ai-industrial-concrete-v1-512.jpg",
  1024: "modules/logistica-industrial/assets/materials/ai-industrial-concrete-v1-1024.jpg"
};
const EDGES = {economy: 256, balanced: 512, high: 1024, ultra: 1024};
const linear = value => value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4);
function closeImage(image) { if (image && image.close) image.close(); }
function loadImage(url, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = () => { image.onload = image.onerror = null; if (signal) signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); image.src = ''; reject(new Error('Prepared texture cancelled.')); };
    image.onload = () => { finish(); resolve(image); };
    image.onerror = () => { finish(); reject(new Error('Prepared texture unavailable.')); };
    if (signal) { if (signal.aborted) { abort(); return; } signal.addEventListener('abort', abort, {once: true}); }
    image.src = url;
  });
}
function canvasFor(edge) {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(edge, edge);
  canvas.width = canvas.height = edge; return canvas;
}

/** An offline prepared image, not a per-frame AI service. Only active concrete
 * bindings request it. One shared, mipmapped GPU texture survives each atomic
 * tier change; releasing the last room binding cancels and frees its resources. */
export default class PreparedMaterialTextures {
  constructor(ctx = {}, options = {}) {
    this.ctx = ctx; this.options = options; this.manifest = Object.assign({}, MANIFEST, options.manifest);
    this.loadImage = options.loadImage || loadImage; this.createCanvas = options.createCanvas || canvasFor;
    this.tickets = new Set(); this.failed = new Set(); this.current = null; this.pending = null; this.generation = 0;
    this.enabled = options.enabled !== false; this.disposed = false; this.status = 'idle'; this.enhancedImage = null;
    this.stats = {loads: 0, textureBuilds: 0, disposedTextures: 0, failures: 0};
    this.unsubscribe = ctx.graphics && ctx.graphics.subscribe ? ctx.graphics.subscribe(() => this.update()) : null;
  }
  limits() { return this.ctx.graphics && this.ctx.graphics.getLimits ? this.ctx.graphics.getLimits() : {tier: 'balanced', maxAnisotropy: 4}; }
  edge() {
    const limits = this.limits(), requested = Math.min(1024, EDGES[limits.tier] || 512, Number(limits.textureEdge) || 1024);
    return requested >= 1024 ? 1024 : requested >= 512 ? 512 : 256;
  }
  getStats() {
    const edge = this.current ? this.current.edge : 0;
    return Object.assign({}, this.stats, {enabled: this.enabled, status: this.status, activeReferences: this.tickets.size, edge,
      requestedEdge: this.edge(), estimatedGpuBytes: edge * edge * 4 * 4 / 3, estimateIncludesMipmaps: true,
      enhanced: !!this.enhancedImage, source: this.enhancedImage ? 'browser-ai-concrete-v1' : 'offline-prepared-concrete-v1'});
  }
  notify(value) { this.tickets.forEach(ticket => { if (!ticket.released && ticket.onChange) { try { ticket.onChange(value); } catch (_) { /* An optional binding cannot stop rendering. */ } } }); }
  releaseCurrent() {
    if (!this.current) return;
    this.current.texture.dispose(); this.stats.disposedTextures++; this.current = null;
  }
  cancel() {
    this.generation++;
    if (this.pending) { if (this.pending.abort) this.pending.abort.abort(); this.pending = null; }
  }
  setEnabled(enabled) {
    if (this.disposed || !!enabled === this.enabled) return;
    this.enabled = !!enabled; this.enhancedImage = null; this.cancel(); this.notify(null); this.releaseCurrent(); this.failed.clear(); this.status = 'idle';
    if (this.enabled) this.update();
  }
  acquireConcrete(onChange) {
    if (this.disposed) return {ready: Promise.resolve(null), release() {}};
    const ticket = {onChange, released: false}; this.tickets.add(ticket);
    if (this.current && this.enabled && onChange) onChange(this.current);
    // Resolve only readiness: retaining the first texture in a settled promise
    // would also retain its canvas after subsequent quality/room changes.
    ticket.ready = this.update().then(() => !ticket.released && !!this.current);
    ticket.release = () => {
      if (ticket.released) return; ticket.released = true; this.tickets.delete(ticket);
      if (!this.tickets.size) { this.cancel(); this.releaseCurrent(); this.enhancedImage = null; this.status = 'idle'; }
    };
    return ticket;
  }
  prepare(image, edge) {
    const canvas = this.createCanvas(edge), context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) throw new Error('Prepared texture requires a 2D canvas.');
    context.drawImage(image, 0, 0, edge, edge);
    const data = context.getImageData(0, 0, edge, edge).data, count = Math.max(1, Math.floor(data.length / 4 / 4096)), mean = [0, 0, 0]; let samples = 0;
    for (let pixel = 0; pixel < data.length / 4; pixel += count) { for (let channel = 0; channel < 3; channel++) mean[channel] += linear(data[pixel * 4 + channel] / 255); samples++; }
    const texture = new THREE.CanvasTexture(canvas); texture.name = 'Prepared concrete albedo ' + edge;
    texture.encoding = THREE.sRGBEncoding; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
    const capabilities = this.ctx.renderer && this.ctx.renderer.capabilities;
    texture.anisotropy = Math.min(this.limits().maxAnisotropy || 4, capabilities && capabilities.getMaxAnisotropy ? capabilities.getMaxAnisotropy() : 1);
    this.stats.textureBuilds++;
    return {texture, edge, mean: new THREE.Vector3(...mean.map(value => Math.max(.01, value / samples)))};
  }
  applyEnhancement(image) {
    if (this.disposed || !this.enabled || !this.tickets.size || !image || !image.width || !image.height) return false;
    // The model result is a derived local image. Keep authoring colour, normal,
    // roughness and wear untouched; the regular profile still caps GPU size.
    const value = this.prepare(image, this.edge()), previous = this.current;
    this.cancel(); this.enhancedImage = image; this.current = value; this.status = 'ready'; this.notify(value);
    if (previous) { previous.texture.dispose(); this.stats.disposedTextures++; }
    return true;
  }
  clearEnhancement() {
    if (!this.enhancedImage || this.disposed) return;
    this.enhancedImage = null; this.cancel(); this.notify(null); this.releaseCurrent(); this.failed.clear(); this.status = 'idle'; this.update();
  }
  update() {
    if (this.disposed || !this.enabled || !this.tickets.size) return Promise.resolve(null);
    const edge = this.edge();
    if (this.pending && this.pending.edge === edge) return this.pending.ready;
    if (this.current && this.current.edge === edge) { if (this.pending) this.cancel(); return Promise.resolve(this.current); }
    if (this.enhancedImage) {
      const value = this.prepare(this.enhancedImage, edge), previous = this.current;
      this.cancel(); this.current = value; this.status = 'ready'; this.notify(value);
      if (previous) { previous.texture.dispose(); this.stats.disposedTextures++; }
      return Promise.resolve(value);
    }
    if (this.failed.has(edge)) return Promise.resolve(this.current);
    this.cancel(); const generation = this.generation, abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const pending = {edge, abort}; this.pending = pending; this.status = 'loading'; this.stats.loads++;
    pending.ready = Promise.resolve().then(() => this.loadImage(this.manifest[edge], abort && abort.signal)).then(image => {
      if (this.disposed || generation !== this.generation || !this.tickets.size) { closeImage(image); return null; }
      let value; try { value = this.prepare(image, edge); } finally { closeImage(image); }
      if (this.disposed || generation !== this.generation || !this.tickets.size) { value.texture.dispose(); this.stats.disposedTextures++; return null; }
      const previous = this.current; this.current = value; this.pending = null; this.status = 'ready'; this.notify(value);
      if (previous) { previous.texture.dispose(); this.stats.disposedTextures++; }
      return value;
    }).catch(() => {
      if (this.disposed || generation !== this.generation) return null;
      this.pending = null; this.failed.add(edge); this.stats.failures++; this.status = 'fallback';
      // A failed small image must not keep a larger texture above its budget.
      if (this.current && this.current.edge > edge) { this.notify(null); this.releaseCurrent(); }
      return null;
    });
    return pending.ready;
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.cancel(); this.notify(null); this.releaseCurrent(); this.enhancedImage = null;
    this.tickets.forEach(ticket => { ticket.released = true; }); this.tickets.clear(); if (this.unsubscribe) this.unsubscribe(); this.status = 'disposed';
  }
}
