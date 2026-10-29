import * as THREE from 'three';

/** Largest centered rectangle at the companion canvas aspect. This only crops
 * the aspect; it never shrinks the field of view to satisfy a memory budget. */
export function mirrorRegion(viewport, aspect, maxPixels = 4000000, maxSize = 4096) {
  if (!viewport || !Number.isFinite(aspect) || aspect <= 0) return null;
  const x = Math.floor(Number(viewport.x)), y = Math.floor(Number(viewport.y));
  const width = Math.floor(Number(viewport.width === undefined ? viewport.z : viewport.width));
  const height = Math.floor(Number(viewport.height === undefined ? viewport.w : viewport.height));
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width < 1 || height < 1) return null;
  let w = width, h = height;
  if (width / height > aspect) w = Math.max(1, Math.floor(height * aspect));
  else h = Math.max(1, Math.floor(width / aspect));
  if (w > maxSize || h > maxSize || w * h > maxPixels) return null;
  return {x: x + Math.floor((width - w) / 2), y: y + Math.floor((height - h) / 2), width: w, height: h};
}

/** One-eye GPU copy to the existing canvas. Call only immediately after the XR
 * world render, inside that session's animation callback: opaque XR framebuffers
 * may not be read outside it. No CPU pixels, extra WebGL context, animation loop
 * or second world traversal is involved. The private scene is one screen quad. */
export default class XRMirror {
  constructor(ctx = {}, options = {}) {
    this.ctx = ctx; this.renderer = ctx.renderer; this.options = options;
    this.document = options.document || (typeof document === 'undefined' ? null : document);
    this.enabled = options.enabled !== false; this.captureActive = false; this.disposed = false; this.lost = false;
    this.standalone = !!(ctx.graphics && ctx.graphics.hints && ctx.graphics.hints.standaloneXR);
    this.mirrorOnHeadset = options.mirrorOnHeadset === true;
    this.maxPixels = Math.max(1, Math.min(4000000, Number(options.maxPixels) || 4000000));
    this.maxFPS = Math.max(1, Math.min(30, Number(options.maxFPS) || 15));
    this.elapsed = Infinity; this.session = null; this.failedSession = null;
    this.scene = null; this.camera = null; this.geometry = null; this.material = null; this.texture = null;
    this.position = new THREE.Vector2(); this.viewport = new THREE.Vector4(); this.scissor = new THREE.Vector4();
    this.stats = {status: 'inactive', frames: 0, allocations: 0, failures: 0, width: 0, height: 0, estimatedGpuBytes: 0, maxFPS: this.maxFPS, mono: true, eye: 'left'};
    this.end = () => this.reset('inactive');
    this.onLost = () => { this.lost = true; this.reset('context-lost'); };
    this.onRestored = () => { this.lost = false; this.failedSession = null; this.elapsed = Infinity; this.stats.status = 'inactive'; };
    const renderer = this.renderer, canvas = renderer && renderer.domElement;
    if (renderer && renderer.xr && renderer.xr.addEventListener) renderer.xr.addEventListener('sessionend', this.end);
    if (canvas && canvas.addEventListener) { canvas.addEventListener('webglcontextlost', this.onLost); canvas.addEventListener('webglcontextrestored', this.onRestored); }
  }
  setEnabled(value) { this.enabled = !!value; if (!this.enabled) this.reset('disabled'); else { this.failedSession = null; this.elapsed = Infinity; } }
  setCaptureActive(value) { this.captureActive = !!value; }
  getStats() { return Object.assign({}, this.stats, {enabled: this.enabled, captureActive: this.captureActive}); }
  release() {
    if (this.texture) this.texture.dispose();
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    this.texture = this.geometry = this.material = this.scene = this.camera = null;
    this.stats.width = this.stats.height = this.stats.estimatedGpuBytes = 0;
  }
  reset(status = 'inactive') { this.release(); this.session = this.failedSession = null; this.elapsed = Infinity; this.stats.status = status; }
  resources(region, alpha) {
    if (!this.scene) {
      this.geometry = new THREE.PlaneBufferGeometry(2, 2);
      this.material = new THREE.RawShaderMaterial({
        uniforms: {mirrorMap: {value: null}, mirrorScale: {value: new THREE.Vector2(1, 1)}}, depthTest: false, depthWrite: false, fog: false,
        vertexShader: 'precision mediump float; attribute vec3 position; attribute vec2 uv; varying vec2 mirrorUV; void main(){mirrorUV=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
        // The eye buffer already contains output-encoded, tone-mapped colour.
        fragmentShader: 'precision mediump float; uniform sampler2D mirrorMap; uniform vec2 mirrorScale; varying vec2 mirrorUV; void main(){vec2 uv=(mirrorUV-0.5)*mirrorScale+0.5;gl_FragColor=vec4(texture2D(mirrorMap,uv).rgb,1.0);}'
      });
      const mesh = new THREE.Mesh(this.geometry, this.material); mesh.frustumCulled = false;
      this.scene = new THREE.Scene(); this.scene.autoUpdate = false; this.scene.add(mesh);
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); this.camera.updateMatrixWorld(true);
    }
    if (this.texture && this.stats.width === region.width && this.stats.height === region.height && this.texture.format === (alpha ? THREE.RGBAFormat : THREE.RGBFormat)) return;
    if (this.texture) this.texture.dispose();
    this.texture = new THREE.DataTexture(null, region.width, region.height, alpha ? THREE.RGBAFormat : THREE.RGBFormat);
    this.texture.name = 'XR one-eye mirror'; this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping; this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true; this.material.uniforms.mirrorMap.value = this.texture;
    this.stats.width = region.width; this.stats.height = region.height; this.stats.estimatedGpuBytes = region.width * region.height * 4; this.stats.allocations++;
  }
  postRender(scene, camera, delta = 0) {
    if (this.disposed) return false;
    const renderer = this.renderer, xr = renderer && renderer.xr;
    if (!this.enabled || this.lost || !xr || !xr.isPresenting) {
      if (this.scene || this.session) this.reset(this.lost ? 'context-lost' : this.enabled ? 'inactive' : 'disabled');
      return false;
    }
    // An autonomous headset has no companion monitor. Its normal OS casting
    // captures the XR compositor, not this page canvas. Avoid an otherwise
    // unused eye-sized texture and GPU copy without changing either XR eye.
    // Explicit application capture can still request the canvas mirror.
    if (this.standalone && !this.captureActive && !this.mirrorOnHeadset) {
      if (this.scene || this.session) this.reset('headset-only');
      this.stats.status = 'headset-only'; return false;
    }
    const session = xr.getSession && xr.getSession();
    if (session !== this.session) { this.release(); this.session = session; this.failedSession = null; this.elapsed = Infinity; }
    if (!session || session === this.failedSession) return false;
    if (this.document && this.document.hidden && !this.captureActive) { this.release(); this.stats.status = 'hidden'; return false; }
    this.elapsed += Math.max(0, Number.isFinite(delta) ? delta : 0);
    if (this.elapsed < 1 / this.maxFPS) return false;
    const canvas = renderer.domElement, layer = session.renderState && session.renderState.baseLayer;
    const gl = renderer.getContext && renderer.getContext();
    if (!canvas || !canvas.width || !canvas.height || !layer || !layer.framebuffer || !gl || gl.isContextLost && gl.isContextLost() ||
        typeof renderer.copyFramebufferToTexture !== 'function' || typeof renderer.setFramebuffer !== 'function' || !xr.getCamera) { this.stats.status = 'unsupported'; return false; }
    // The caller must have rendered the real XR scene, not an unrelated RT.
    if (renderer.getRenderTarget && renderer.getRenderTarget()) { this.stats.status = 'render-target-active'; return false; }
    const view = xr.getCamera(camera), eye = view && view.cameras && view.cameras[0];
    const maxSize = renderer.capabilities && renderer.capabilities.maxTextureSize || 4096;
    const region = mirrorRegion(eye && eye.viewport, canvas.width / canvas.height, this.maxPixels, maxSize);
    if (!region) { this.release(); this.stats.status = 'eye-or-memory-limit'; return false; }
    if (Number.isFinite(layer.framebufferWidth) && region.x + region.width > layer.framebufferWidth || Number.isFinite(layer.framebufferHeight) && region.y + region.height > layer.framebufferHeight) { this.stats.status = 'invalid-eye-viewport'; return false; }
    const alpha = gl.getContextAttributes ? gl.getContextAttributes().alpha !== false : true;
    const saved = {xr: xr.enabled, autoClear: renderer.autoClear, target: renderer.getRenderTarget(), cube: renderer.getActiveCubeFace && renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel && renderer.getActiveMipmapLevel(),
      viewport: renderer.getViewport(this.viewport).clone(), scissor: renderer.getScissor(this.scissor).clone(), scissorTest: renderer.getScissorTest(), shadow: renderer.shadowMap && renderer.shadowMap.enabled,
      info: renderer.info && renderer.info.render && Object.assign({}, renderer.info.render), infoReset: renderer.info && renderer.info.autoReset};
    try {
      this.resources(region, alpha); this.position.set(region.x, region.y);
      // Correct the subpixel aspect rounding with UVs, never stretch a box.
      const sourceAspect = region.width / region.height, aspect = canvas.width / canvas.height;
      this.material.uniforms.mirrorScale.value.set(Math.min(1, aspect / sourceAspect), Math.min(1, sourceAspect / aspect));
      renderer.setFramebuffer(layer.framebuffer); renderer.setRenderTarget(null);
      renderer.copyFramebufferToTexture(this.position, this.texture);
      xr.enabled = false; renderer.setFramebuffer(null); renderer.setRenderTarget(null);
      const dpr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
      renderer.setViewport(0, 0, canvas.width / dpr, canvas.height / dpr); renderer.setScissorTest(false); renderer.autoClear = false;
      if (renderer.shadowMap) renderer.shadowMap.enabled = false;
      if (renderer.info) renderer.info.autoReset = false;
      renderer.render(this.scene, this.camera);
      this.elapsed = 0; this.stats.status = 'active'; this.stats.frames++; return true;
    } catch (_) {
      this.failedSession = session; this.stats.failures++; this.release(); this.stats.status = 'unavailable'; return false;
    } finally {
      xr.enabled = saved.xr; renderer.autoClear = saved.autoClear;
      if (renderer.shadowMap) renderer.shadowMap.enabled = saved.shadow;
      if (renderer.info) { renderer.info.autoReset = saved.infoReset; if (saved.info) Object.assign(renderer.info.render, saved.info); }
      // Restore the opaque XR binding while still inside its animation frame.
      renderer.setFramebuffer(layer.framebuffer); renderer.setRenderTarget(saved.target, saved.cube, saved.mip);
      renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.scissorTest);
    }
  }
  dispose() {
    if (this.disposed) return; this.reset('disposed'); this.disposed = true;
    const xr = this.renderer && this.renderer.xr, canvas = this.renderer && this.renderer.domElement;
    if (xr && xr.removeEventListener) xr.removeEventListener('sessionend', this.end);
    if (canvas && canvas.removeEventListener) { canvas.removeEventListener('webglcontextlost', this.onLost); canvas.removeEventListener('webglcontextrestored', this.onRestored); }
  }
}
