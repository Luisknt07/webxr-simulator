import * as THREE from 'three';

const INTERVAL = .5, DOWNGRADE_DELAY = 1, NEAR_DISTANCE = 6.5;

/** A smaller backing store for distant world-space displays. All authored
 * drawing and UV hit regions remain in the original logical coordinate space.
 * Never creates a renderer or reads back pixels from the application's GPU. */
export default class DynamicDisplayResolution {
  constructor(ctx, width = 1024, height = 576) {
    this.ctx = ctx; this.width = width; this.height = height;
    this.eye = new THREE.Vector3(); this.center = new THREE.Vector3(); this.point = new THREE.Vector3();
    this.inverse = new THREE.Matrix4(); this.projection = new THREE.Matrix4();
    this.stats = {resizes: 0, projectionSamples: 0};
  }

  cameras() {
    const visibility = this.ctx.performanceVisibility;
    if (visibility && visibility.cameras && visibility.cameras.length) return visibility.cameras;
    let camera = this.ctx.camera;
    if (!camera) return [];
    const renderer = this.ctx.renderer;
    if (this.ctx.vrMode && renderer && renderer.xr && renderer.xr.getCamera) camera = renderer.xr.getCamera(camera) || camera;
    // r112's tracked XR eye matrices already include the rig. Updating them
    // from local TRS here would overwrite their pose with an unrelated origin.
    if (camera.isArrayCamera && camera.cameras.length) return camera.cameras;
    camera.updateWorldMatrix(true, false); return [camera];
  }

  projectedWidth(plane, cameras) {
    const geometry = plane.geometry;
    if (!geometry) return this.width;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (!bounds || bounds.isEmpty()) return this.width;
    const renderer = this.ctx.renderer, canvas = renderer && renderer.domElement;
    let pixels = 0;
    for (const camera of cameras) {
      this.inverse.getInverse(camera.matrixWorld);
      this.projection.multiplyMatrices(camera.projectionMatrix, this.inverse);
      const viewport = camera.viewport, viewportWidth = viewport && viewport.z || canvas && canvas.width || 1280;
      const viewportHeight = viewport && viewport.w || canvas && canvas.height || 720;
      let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity, front = false, behind = false;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
        this.point.set(x, y, bounds.min.z).applyMatrix4(plane.matrixWorld);
        const depth = this.point.x * this.inverse.elements[2] + this.point.y * this.inverse.elements[6] + this.point.z * this.inverse.elements[10] + this.inverse.elements[14];
        if (depth >= -(camera.near || .01)) {behind = true; continue;}
        front = true; this.point.applyMatrix4(this.projection);
        left = Math.min(left, this.point.x); right = Math.max(right, this.point.x); bottom = Math.min(bottom, this.point.y); top = Math.max(top, this.point.y);
      }
      if (front && behind) return this.width; // Crossing the near plane: preserve detail.
      if (front) pixels = Math.max(pixels, (right - left) * viewportWidth / 2, (top - bottom) * viewportHeight / 2 * this.width / this.height);
    }
    this.stats.projectionSamples++; return pixels;
  }

  resize(entry, width) {
    const height = Math.round(width * this.height / this.width);
    if (entry.canvas.width === width && entry.canvas.height === height) return false;
    entry.canvas.width = width; entry.canvas.height = height;
    if (entry.drawing.setTransform) entry.drawing.setTransform(width / this.width, 0, 0, height / this.height, 0, 0);
    // Disposing preserves this Texture's identity, filters and material map.
    // It releases the old allocation even if the display is currently hidden;
    // r112 then uploads the resized canvas on the next visible render.
    entry.texture.dispose(); entry.texture.needsUpdate = true; entry.dirty = true;
    this.stats.resizes++; return true;
  }

  update(entry, delta = 0, editing = false, shown = true) {
    const state = entry.displayResolution || (entry.displayResolution = {elapsed: INTERVAL, candidate: 0, pending: 0});
    state.elapsed += Math.max(0, Number.isFinite(delta) ? delta : 0);
    const current = entry.canvas.width, reset = () => {state.candidate = 0; state.pending = 0;};
    if (editing || entry.presses && entry.presses.size || !entry.drawing.setTransform) {reset(); state.elapsed = 0; return this.resize(entry, this.width);}
    const cameras = this.cameras();
    if (!cameras.length) {reset(); state.elapsed = 0; return this.resize(entry, this.width);}
    entry.plane.updateWorldMatrix(true, false); this.center.setFromMatrixPosition(entry.plane.matrixWorld);
    // Upgrade before the next draw or interaction, including teleporting toward
    // a display. The wider exit distance prevents toggling at the boundary.
    const near = cameras.some(camera => this.eye.setFromMatrixPosition(camera.matrixWorld).distanceTo(this.center) <= NEAR_DISTANCE + (current === this.width ? 1 : 0));
    if (shown && near) {reset(); state.elapsed = 0; return this.resize(entry, this.width);}
    if (state.elapsed < INTERVAL) return false;
    const sampledSeconds = Math.min(2, state.elapsed); state.elapsed = 0;
    const limits = this.ctx.graphics && this.ctx.graphics.getLimits ? this.ctx.graphics.getLimits() : {tier: 'high'};
    const oversample = {economy: 1.15, balanced: 1.3, high: 1.6, ultra: 2}[limits.tier] || 1.6;
    const demand = shown ? this.projectedWidth(entry.plane, cameras) * oversample : 0, scale = this.width / 1024;
    let wanted = current;
    if (!shown || demand < 192 * scale) wanted = Math.round(this.width / 4);
    else if (current === this.width) wanted = demand < 410 * scale ? Math.round(this.width / 2) : this.width;
    else if (demand > 615 * scale) wanted = this.width;
    else if (current === Math.round(this.width / 4)) wanted = demand > 308 * scale ? Math.round(this.width / 2) : Math.round(this.width / 4);
    if (wanted >= current) {reset(); return this.resize(entry, wanted);}
    if (state.candidate !== wanted) {state.candidate = wanted; state.pending = 0;}
    state.pending += sampledSeconds;
    if (state.pending < DOWNGRADE_DELAY) return false;
    reset(); return this.resize(entry, wanted);
  }
}
