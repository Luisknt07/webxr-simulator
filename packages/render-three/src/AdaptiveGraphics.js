import quality from '../schema/graphics-quality.js';

const STORAGE_KEY = 'hello-webxr.graphics-mode.v1';
const CLARITY_KEY = 'hello-webxr.xr-clarity.v1';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Resource ceilings and measured frame pacing; never mutates authored scenes.
 * r112's framebuffer-scale setter is a no-op, so XR pixel ratio is untouched.
 * Foveation is optional and only uses the actual session layer when supported. */
export default class AdaptiveGraphics {
  constructor(renderer, options = {}) {
    this.renderer = renderer; this.options = options; this.window = options.window || (typeof window !== 'undefined' ? window : null);
    const navigator = options.navigator || this.window && this.window.navigator || {};
    let coarse = false; try { coarse = !!(this.window && this.window.matchMedia && this.window.matchMedia('(pointer: coarse)').matches); } catch (_) { /* Optional hint. */ }
    this.hints = quality.hints(Object.assign({coarse, deviceMemory: navigator.deviceMemory, hardwareConcurrency: navigator.hardwareConcurrency, userAgent: navigator.userAgent, mobile: navigator.userAgentData && navigator.userAgentData.mobile}, options.hints));
    this.storage = options.storage === undefined ? (() => { try { return this.window && this.window.localStorage; } catch (_) { return null; } })() : options.storage;
    let mode = options.mode || 'auto'; try { if (!options.mode && this.storage) mode = this.storage.getItem(STORAGE_KEY) || mode; } catch (_) { /* Storage may be unavailable. */ }
    this.mode = quality.MODES.includes(mode) ? mode : 'auto'; this.tier = Math.min(quality.initialTier(this.hints, this.mode), quality.ceilingFor(this.mode, this.hints));
    let clarity = options.xrClarity || (this.hints.standaloneXR ? 'sharp' : 'balanced');
    try { if (!options.xrClarity && this.storage) clarity = this.storage.getItem(CLARITY_KEY) || clarity; } catch (_) { /* Optional local preference. */ }
    this.xrClarity = ['sharp', 'balanced'].includes(clarity) ? clarity : this.hints.standaloneXR ? 'sharp' : 'balanced';
    this.desktopAntialias = null; try { const gl = renderer && renderer.getContext && renderer.getContext(); this.desktopAntialias = gl && gl.getContextAttributes().antialias; } catch (_) { /* Diagnostic only. */ }
    this.originalRatio = renderer && renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
    this.width = renderer && renderer.domElement && renderer.domElement.clientWidth || this.window && this.window.innerWidth || 1;
    this.height = renderer && renderer.domElement && renderer.domElement.clientHeight || this.window && this.window.innerHeight || 1;
    this.dpr = this.window && this.window.devicePixelRatio || 1; this.appliedRatio = null;
    this.xr = !!(renderer && renderer.xr && renderer.xr.isPresenting); this.layer = null; this.originalFoveation = null; this.foveationSupported = null; this.foveation = null;
    this.lost = false; this.disposed = false; this.listeners = new Set(); this.elapsed = 0; this.lastNotify = 0; this.lastChange = -100;
    this.warmup = 3; this.slow = 0; this.healthy = 0; this.spikes = 0; this.frameMs = null; this.targetFPS = 60;
    this.status = 'warming-up'; this.reason = 'initial-device-hints';
    this.foveationBias = 0; this.lastFoveationChange = -100; this.budgetOverruns = 0;
    this.onLost = event => { if (event && event.preventDefault) event.preventDefault(); this.contextLost(); };
    this.onRestored = () => this.contextRestored();
    if (renderer && renderer.domElement && renderer.domElement.addEventListener && options.listen !== false) {
      renderer.domElement.addEventListener('webglcontextlost', this.onLost); renderer.domElement.addEventListener('webglcontextrestored', this.onRestored);
    }
    this.applyDesktopRatio();
  }
  getMode() { return this.mode; }
  getLimits() { return quality.limitsFor(this.tier, this.hints); }
  getState() { return this.getStats(); }
  getStats() {
    const limits = this.getLimits(), ratio = this.appliedRatio === null ? this.originalRatio : this.appliedRatio;
    return {mode: this.mode, tier: limits.tier, effectiveProfile: limits.tier, ceiling: quality.TIERS[quality.ceilingFor(this.mode, this.hints)],
      pixelRatio: ratio, renderScale: ratio / this.dpr, targetFPS: this.targetFPS, frameMs: this.frameMs, fps: this.frameMs ? 1000 / this.frameMs : null,
      status: this.status, reason: this.reason, xr: this.xr, contextLost: this.lost, foveationSupported: this.foveationSupported, foveation: this.foveation,
      frameBudgetMs: 1000 / this.targetFPS, frameBudgetRatio: this.frameMs ? this.frameMs / (1000 / this.targetFPS) : null, budgetOverruns: this.budgetOverruns, adaptiveFoveationBias: this.foveationBias,
      pixelBudget: limits.maxPixels, estimatedMemoryMB: null, xrClarity: this.xrClarity,
      antialias: this.xr ? this.layer && typeof this.layer.antialias === 'boolean' ? this.layer.antialias : null : this.desktopAntialias,
      hints: Object.assign({}, this.hints), limits};
  }
  getXRClarity() { return this.xrClarity; }
  setXRClarity(value) {
    if (!['sharp', 'balanced'].includes(value)) throw new Error('Nitidez de RV no compatible.');
    if (this.disposed) return this.getStats();
    this.xrClarity = value; this.foveationBias = 0;
    try { if (this.storage) this.storage.setItem(CLARITY_KEY, value); } catch (_) { /* Optional preference. */ }
    this.applyFoveation(); this.notify(); return this.getStats();
  }
  updateCameraDepth(xr, camera) {
    const target = xr && this.hints.standaloneXR ? camera || this.depthCamera : null;
    if (this.depthCamera && this.depthCamera !== target) {
      if (this.depthCamera.near === .02) {this.depthCamera.near = this.originalNear; this.depthCamera.updateProjectionMatrix();}
      this.depthCamera = null; this.originalNear = null;
    }
    // A 5 mm near plane wastes depth precision on distant floor paint and
    // thin machine surfaces. Keep the far plane and all authored geometry;
    // use a 2 cm near plane only for the standalone headset presentation.
    if (target && !this.depthCamera && Number.isFinite(target.near) && target.near > 0 && target.near < .02) {
      this.depthCamera = target; this.originalNear = target.near; target.near = .02; target.updateProjectionMatrix();
    }
  }
  subscribe(listener) { this.listeners.add(listener); try { listener(this.getStats()); } catch (_) { /* Optional UI isolation. */ } return () => this.listeners.delete(listener); }
  notify() { this.lastNotify = this.elapsed; const state = this.getStats(); this.listeners.forEach(listener => { try { listener(state); } catch (_) { /* An optional UI cannot interrupt rendering. */ } }); }
  setMode(mode) {
    if (!quality.MODES.includes(mode)) throw new Error('Modo gráfico no compatible.');
    if (this.disposed || mode === this.mode) return this.getStats();
    this.mode = mode; this.tier = mode === 'auto' ? Math.min(this.tier, quality.ceilingFor(mode, this.hints)) : quality.ceilingFor(mode, this.hints);
    this.resetPacing(2); this.reason = 'user-mode-ceiling';
    try { if (this.storage) this.storage.setItem(STORAGE_KEY, mode); } catch (_) { /* Preferences are local and optional. */ }
    this.applyDesktopRatio(); this.applyFoveation(); this.notify(); return this.getStats();
  }
  setViewport(width, height, dpr) {
    this.width = Math.max(1, Number(width) || 1); this.height = Math.max(1, Number(height) || 1);
    if (Number.isFinite(dpr) && dpr > 0) this.dpr = dpr;
    else if (this.window && this.window.devicePixelRatio) this.dpr = this.window.devicePixelRatio;
    this.applyDesktopRatio();
  }
  applyDesktopRatio() {
    if (this.disposed || this.lost || this.xr || this.renderer && this.renderer.xr && this.renderer.xr.isPresenting) return;
    const ratio = quality.pixelRatioFor(this.width, this.height, this.dpr, this.getLimits());
    if (this.appliedRatio !== null && Math.abs(ratio - this.appliedRatio) < .015) return;
    if (this.renderer && this.renderer.setPixelRatio) this.renderer.setPixelRatio(ratio); this.appliedRatio = ratio;
  }
  resetPacing(warmup = 1) { this.warmup = warmup; this.frameMs = null; this.slow = this.healthy = this.spikes = 0; this.status = 'warming-up'; }
  changeTier(index, reason) {
    const next = clamp(index, 0, quality.ceilingFor(this.mode, this.hints)); if (next === this.tier) return;
    this.tier = next; this.lastChange = this.elapsed; this.reason = reason; this.slow = this.healthy = 0;
    this.applyDesktopRatio(); this.applyFoveation(); this.notify();
  }
  restoreFoveation() {
    if (this.layer && typeof this.originalFoveation === 'number') { try { this.layer.fixedFoveation = this.originalFoveation; } catch (_) { /* The session may already have ended. */ } }
    this.layer = null; this.originalFoveation = null; this.foveationSupported = null; this.foveation = null;
  }
  applyFoveation(session) {
    if (!this.xr || this.lost || this.disposed) return;
    const layer = session && session.renderState && session.renderState.baseLayer || this.layer;
    if (layer !== this.layer) {
      this.restoreFoveation(); this.layer = layer;
      if (layer) { try { this.originalFoveation = layer.fixedFoveation; this.foveationSupported = typeof this.originalFoveation === 'number' && Number.isFinite(this.originalFoveation); } catch (_) { this.foveationSupported = false; } }
    }
    if (!this.layer) { this.foveationSupported = false; return; }
    if (!this.foveationSupported) return;
    const base = this.getLimits().fixedFoveation, sharp = this.xrClarity === 'sharp';
    const wanted = Math.min(sharp ? .5 : .75, (sharp ? Math.min(.25, base) : base) + this.foveationBias);
    try {
      if (Math.abs(this.layer.fixedFoveation - wanted) > .01) this.layer.fixedFoveation = wanted;
      const actual = this.layer.fixedFoveation;
      if (typeof actual !== 'number' || !Number.isFinite(actual) || Math.abs(actual - wanted) > .1) { this.foveationSupported = false; this.foveation = null; }
      else this.foveation = actual;
    } catch (_) { this.foveationSupported = false; this.foveation = null; }
  }
  tick(delta = 0, frame = {}) {
    if (this.disposed) return this.getStats();
    const xr = frame.xr === undefined ? !!(this.renderer && this.renderer.xr && this.renderer.xr.isPresenting) : !!frame.xr;
    if (xr !== this.xr) { this.xr = xr; this.foveationBias = 0; this.restoreFoveation(); this.resetPacing(2); this.notify(); }
    this.updateCameraDepth(xr, frame.camera);
    if (frame.width !== undefined || frame.height !== undefined || frame.dpr !== undefined) this.setViewport(frame.width || this.width, frame.height || this.height, frame.dpr);
    const session = frame.session || this.renderer && this.renderer.xr && this.renderer.xr.getSession && this.renderer.xr.getSession();
    const fps = quality.targetFrameRate(xr, session);
    if (fps !== this.targetFPS) { this.targetFPS = fps; this.resetPacing(2); }
    this.applyFoveation(session); this.applyDesktopRatio();
    if (this.lost) return this.getStats();
    if (frame.paused || frame.loading || frame.hidden || this.window && this.window.document && this.window.document.hidden && !xr) {
      const changed = this.status !== 'paused'; this.reason = frame.loading ? 'loading' : frame.hidden ? 'hidden' : 'paused'; this.resetPacing(1); this.status = 'paused'; if (changed) this.notify(); return this.getStats();
    }
    if (!Number.isFinite(delta) || delta <= 0) return this.getStats();
    const dt = Math.min(delta, .25); this.elapsed += dt;
    if (this.warmup > 0) { this.warmup -= dt; this.status = 'warming-up'; return this.getStats(); }
    if (delta > .25) {
      this.spikes++; this.healthy = 0;
      if (this.spikes >= 3 && this.elapsed - this.lastChange > 5) { this.status = 'pressure'; this.changeTier(this.tier - 1, 'repeated-long-frames'); this.spikes = 0; }
      return this.getStats();
    }
    this.spikes = 0;
    const budget = 1000 / this.targetFPS, sample = Math.min(delta * 1000, budget * 4), alpha = 1 - Math.exp(-dt / .4);
    this.frameMs = this.frameMs === null ? sample : this.frameMs + (sample - this.frameMs) * alpha;
    const slow = this.frameMs > budget * 1.24;
    const healthy = this.frameMs <= budget * 1.08 && (!Number.isFinite(frame.workMs) || frame.workMs < budget * .78);
    this.slow = slow ? this.slow + dt : Math.max(0, this.slow - dt * 2); this.healthy = healthy ? this.healthy + dt : 0;
    if (sample > budget * 1.2) this.budgetOverruns++;
    // On a real supported XR layer, try a bounded peripheral-rate adjustment
    // before a full tier change rebuilds materials/shadows. Centre detail stays
    // intact; cadence and recovery have separate hysteresis.
    if (xr && this.foveationSupported && this.elapsed - this.lastFoveationChange >= 1.5 && this.slow >= .6 && this.foveationBias < .3) { this.foveationBias = Math.min(.3, this.foveationBias + .1); this.lastFoveationChange = this.elapsed; this.applyFoveation(session); }
    else if (xr && this.healthy >= 8 && this.elapsed - this.lastFoveationChange >= 5 && this.foveationBias > 0) { this.foveationBias = Math.max(0, this.foveationBias - .05); this.lastFoveationChange = this.elapsed; this.applyFoveation(session); }
    this.status = slow ? 'pressure' : 'steady';
    if (this.slow >= 1.6 && this.elapsed - this.lastChange >= 5) this.changeTier(this.tier - 1, 'sustained-frame-pressure');
    else if (this.healthy >= 20 && this.elapsed - this.lastChange >= 30) this.changeTier(this.tier + 1, 'sustained-healthy-trial');
    if (this.elapsed - this.lastNotify >= 1) this.notify(); return this.getStats();
  }
  contextLost() { if (this.disposed) return; this.lost = true; this.status = 'context-lost'; this.reason = 'webgl-context-lost'; this.notify(); }
  contextRestored() { if (this.disposed) return; this.lost = false; this.appliedRatio = null; this.resetPacing(3); this.reason = 'webgl-context-restored'; this.applyDesktopRatio(); this.notify(); }
  dispose() {
    if (this.disposed) return; this.restoreFoveation();
    this.updateCameraDepth(false);
    if (!this.xr && !this.lost && this.renderer && this.renderer.setPixelRatio) this.renderer.setPixelRatio(this.originalRatio);
    if (this.renderer && this.renderer.domElement && this.renderer.domElement.removeEventListener) { this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost); this.renderer.domElement.removeEventListener('webglcontextrestored', this.onRestored); }
    this.disposed = true; this.listeners.clear();
  }
}
