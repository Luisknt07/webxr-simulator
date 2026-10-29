const MODEL = 'espcn-x3-bsd300-onnx10';
const MAX_INPUT = 256, MAX_CACHE_BYTES = 6 * 1024 * 1024;
const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

/** Local, trained image-model inference. It runs outside rendering and is
 * cancelled before immersive presentation. No CDN, account or server inference. */
export default class NativeTextureAI {
  constructor(ctx = {}, options = {}) {
    this.ctx = ctx; this.options = options; this.window = options.window || (typeof window === 'undefined' ? null : window);
    this.document = options.document || this.window && this.window.document; this.job = null; this.sequence = 0; this.disposed = false;
    this.cache = new Map(); this.cacheBytes = 0; this.suspensions = new Set(); this.listeners = new Set();
    this.stats = {status: 'idle', model: MODEL, provider: 'wasm-single-thread', jobs: 0, completions: 0, failures: 0, cancellations: 0, cacheHits: 0, workerActive: false, lastError: null};
    this.visibility = () => { if (this.document && this.document.hidden) this.suspend('hidden'); else this.resume('hidden'); };
    this.contextLost = () => this.suspend('context-lost'); this.contextRestored = () => this.resume('context-lost');
    this.xrStarted = () => this.suspend('xr'); this.xrEnded = () => this.resume('xr'); this.xr = ctx.renderer && ctx.renderer.xr;
    if (this.document && this.document.addEventListener) this.document.addEventListener('visibilitychange', this.visibility);
    this.canvas = ctx.renderer && ctx.renderer.domElement;
    if (this.canvas && this.canvas.addEventListener) { this.canvas.addEventListener('webglcontextlost', this.contextLost); this.canvas.addEventListener('webglcontextrestored', this.contextRestored); }
    if (this.xr && this.xr.addEventListener) { this.xr.addEventListener('sessionstart', this.xrStarted); this.xr.addEventListener('sessionend', this.xrEnded); }
  }
  getStats() { return Object.assign({}, this.stats, {cacheEntries: this.cache.size, cacheBytes: this.cacheBytes, suspended: this.suspensions.size > 0}); }
  subscribe(listener) { this.listeners.add(listener); listener(this.getStats()); return () => this.listeners.delete(listener); }
  notify() { const value = this.getStats(); this.listeners.forEach(listener => { try { listener(value); } catch (_) { /* Optional UI. */ } }); }
  blocked() {
    const ctx = this.ctx, editor = ctx.editor;
    return this.disposed || this.suspensions.size > 0 || this.document && this.document.hidden || ctx.xrEntryPending || ctx.vrMode || ctx.roomTransition ||
      ctx.renderer && ctx.renderer.xr && ctx.renderer.xr.isPresenting || ctx.graphics && ctx.graphics.getStats && ctx.graphics.getStats().contextLost ||
      editor && (editor.initializing || editor.loadingProject || editor.busy || editor.importingFiles || editor.creatingScene || editor.document && editor.document.loading);
  }
  suspend(reason = 'manual') { if (this.disposed) return; this.suspensions.add(reason); this.cancel(reason); this.stats.status = 'suspended'; this.notify(); }
  resume(reason = 'manual') { this.suspensions.delete(reason); if (!this.disposed && !this.job) { this.stats.status = this.blocked() ? 'suspended' : 'idle'; this.notify(); } }
  cancel(reason = 'cancelled') { if (!this.job) return; this.stats.cancellations++; this.finish(this.job, null, reason); }
  sync() { if (this.job && this.blocked()) this.cancel('unavailable'); }
  createCanvas(width, height) {
    const canvas = this.options.canvasFactory ? this.options.canvasFactory(width, height) : this.document && this.document.createElement ? this.document.createElement('canvas') : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : null;
    if (!canvas) throw new Error('El navegador no permite preparar la imagen.'); canvas.width = width; canvas.height = height; return canvas;
  }
  estimateBytes(width, height) {
    // Includes a conservative runtime allowance and live neural activations;
    // this is not a measurement of total browser or device memory.
    return 64 * 1024 * 1024 + width * height * (64 + 64 + 32 + 9 + 1) * 4 + width * height * 40;
  }
  enhance(image, options = {}) {
    if (this.disposed || options.signal && options.signal.aborted) return Promise.resolve(null);
    const tile = options.tile === true, padding = tile ? 5 : 0;
    const edge = Math.max(16, Math.min(MAX_INPUT - padding * 2, Math.floor(Number(options.maxInputEdge) || 128)));
    const sourceWidth = image && (image.naturalWidth || image.videoWidth || image.width), sourceHeight = image && (image.naturalHeight || image.videoHeight || image.height);
    if (!(Number.isFinite(sourceWidth) && Number.isFinite(sourceHeight) && sourceWidth > 0 && sourceHeight > 0)) return Promise.resolve(null);
    const scale = Math.min(1, edge / Math.max(sourceWidth, sourceHeight)), width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale));
    const key = options.key ? MODEL + ':' + (tile ? 'tile:' : '') + width + 'x' + height + ':' + String(options.key) : null;
    if (key && this.cache.has(key)) { const result = this.cache.get(key); this.cache.delete(key); this.cache.set(key, result); this.stats.cacheHits++; return Promise.resolve(Object.assign({}, result, {cached: true})); }
    if (this.blocked()) { this.stats.status = 'suspended'; this.notify(); return Promise.resolve(null); }
    const estimate = this.estimateBytes(width + padding * 2, height + padding * 2), budget = Math.min(192 * 1024 * 1024, Math.max(80 * 1024 * 1024, Number(options.maxWorkingBytes) || 96 * 1024 * 1024));
    if (estimate > budget) { this.stats.status = 'budget-exceeded'; this.stats.lastError = 'La imagen supera el presupuesto local de IA.'; this.notify(); return Promise.resolve(null); }
    if (this.job && key && key === this.job.key) return this.job.promise;
    this.cancel('superseded');
    let pixels;
    try { const canvas = this.createCanvas(width, height), context = canvas.getContext('2d', {willReadFrequently: true}); if (!context) throw new Error('Canvas 2D no disponible.'); context.drawImage(image, 0, 0, width, height); pixels = context.getImageData(0, 0, width, height).data; }
    catch (error) { this.stats.failures++; this.stats.status = 'fallback'; this.stats.lastError = error.message; this.notify(); return Promise.resolve(null); }
    const id = ++this.sequence, started = clock(), job = {id, key, width, height, estimate, started}; job.promise = new Promise(resolve => { job.resolve = resolve; }); this.job = job;
    this.stats.jobs++; this.stats.status = 'loading'; this.stats.lastError = null; this.stats.estimatedWorkingBytes = estimate;
    try {
      const workerURL = this.options.workerURL || "packages/tools/ai/assets/native-texture-ai-worker.js";
      const url = this.document && this.document.baseURI ? new URL(workerURL, this.document.baseURI).href : workerURL;
      job.worker = this.options.workerFactory ? this.options.workerFactory(url) : new Worker(url, {name: 'HELLO Texture AI'});
      this.stats.workerActive = true;
      job.worker.onmessage = event => {
        const data = event.data || {}; if (this.job !== job || data.id !== id) return;
        if (data.type === 'progress') { this.stats.status = data.stage; this.notify(); return; }
        if (data.type === 'error') { this.stats.failures++; this.stats.lastError = data.error || 'No se pudo procesar la textura.'; this.finish(job, null, 'fallback'); return; }
        if (data.type !== 'result') return;
        try {
          if (this.blocked() || data.width !== width * 3 || data.height !== height * 3 || !(data.pixels instanceof ArrayBuffer) || data.pixels.byteLength !== data.width * data.height * 4) { this.finish(job, null, 'invalid-result'); return; }
          const canvas = this.createCanvas(data.width, data.height), context = canvas.getContext('2d'), output = context.createImageData(data.width, data.height); output.data.set(new Uint8ClampedArray(data.pixels)); context.putImageData(output, 0, 0);
          const result = {canvas, width: data.width, height: data.height, model: MODEL, cached: false, stats: Object.assign({}, data.stats, {elapsedMs: clock() - started, estimatedWorkingBytes: estimate})};
          if (key) { const bytes = data.pixels.byteLength; this.cache.set(key, result); this.cacheBytes += bytes; while (this.cache.size > 2 || this.cacheBytes > MAX_CACHE_BYTES) { const oldest = this.cache.keys().next().value, value = this.cache.get(oldest); this.cacheBytes -= value.width * value.height * 4; this.cache.delete(oldest); } }
          this.stats.completions++; this.stats.lastRun = result.stats; this.finish(job, result, 'ready');
        } catch (error) { this.stats.failures++; this.stats.lastError = error.message; this.finish(job, null, 'fallback'); }
      };
      job.worker.onerror = event => { if (event.preventDefault) event.preventDefault(); if (this.job !== job) return; this.stats.failures++; this.stats.lastError = 'El proceso local de IA no está disponible.'; this.finish(job, null, 'fallback'); };
      const timeout = Math.max(1000, Math.min(30000, Number(options.timeoutMs) || 15000)); job.timer = setTimeout(() => { if (this.job !== job) return; this.stats.failures++; this.stats.lastError = 'Se alcanzó el tiempo máximo de IA.'; this.finish(job, null, 'timeout'); }, timeout);
      if (options.signal) { job.signal = options.signal; job.abort = () => { if (this.job === job) this.cancel('aborted'); }; options.signal.addEventListener('abort', job.abort, {once: true}); }
      job.worker.postMessage({type: 'enhance', id, width, height, tile, pixels: pixels.buffer}, [pixels.buffer]); this.notify();
    } catch (error) { this.stats.failures++; this.stats.lastError = error.message; this.finish(job, null, 'fallback'); }
    return job.promise;
  }
  finish(job, result, status) {
    if (this.job !== job) return; this.job = null; clearTimeout(job.timer);
    if (job.signal && job.abort) job.signal.removeEventListener('abort', job.abort);
    if (job.worker) { job.worker.onmessage = job.worker.onerror = null; job.worker.terminate(); }
    this.stats.workerActive = false; this.stats.status = status; job.resolve(result); this.notify();
  }
  dispose() { if (this.disposed) return; this.cancel('disposed'); this.disposed = true; this.cache.clear(); this.cacheBytes = 0; this.listeners.clear(); if (this.document && this.document.removeEventListener) this.document.removeEventListener('visibilitychange', this.visibility); if (this.canvas && this.canvas.removeEventListener) { this.canvas.removeEventListener('webglcontextlost', this.contextLost); this.canvas.removeEventListener('webglcontextrestored', this.contextRestored); } if (this.xr && this.xr.removeEventListener) { this.xr.removeEventListener('sessionstart', this.xrStarted); this.xr.removeEventListener('sessionend', this.xrEnded); } }
}
