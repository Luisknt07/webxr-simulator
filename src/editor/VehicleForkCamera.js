import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0), ASPECT = 16 / 9;
const finite = value => Number.isFinite(value);
const shown = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };

/** One bounded auxiliary world pass on the application's existing renderer.
 * The feed and its desktop quad stay on the GPU. It owns no animation loop,
 * physics, inventory, browser canvas context or tracked-camera transforms. */
export default class VehicleForkCamera {
  constructor(driving, options = {}) {
    this.driving = driving; this.ctx = driving.ctx; this.options = options; this.renderer = this.ctx.renderer;
    this.enabled = true; this.available = false; this.elapsed = Infinity; this.side = -1; this.mode = 'entry'; this.mounted = false; this.lost = false; this.failed = false;
    this.viewport = new THREE.Vector4(); this.scissor = new THREE.Vector4();
    this.stats = {status: 'inactive', frames: 0, failures: 0, allocations: 0, width: 0, height: 0, maxFPS: 0, estimatedGpuBytes: 0, lastRenderMs: 0};
    this.tipCamera = new THREE.OrthographicCamera(-1, 1, 1 / ASPECT, -1 / ASPECT, .04, 80);
    this.entryCamera = new THREE.PerspectiveCamera(35, ASPECT, .025, 80); this.camera = this.entryCamera;
    this.camera.name = 'Cámara auxiliar isométrica de horquillas';
    this.onLost = () => { this.lost = true; this.release('context-lost'); };
    this.onRestored = () => { this.lost = this.failed = false; this.elapsed = Infinity; };
    const canvas = this.renderer && this.renderer.domElement;
    if (canvas && canvas.addEventListener) { canvas.addEventListener('webglcontextlost', this.onLost); canvas.addEventListener('webglcontextrestored', this.onRestored); }
  }
  mount(options = {}) {
    this.unmount(); this.mountOptions = options; this.element = options.element; this.mounted = true; this.enabled = true; this.available = true; this.failed = false; this.mode = 'entry';
    this.plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(.66, .37125), new THREE.MeshBasicMaterial({color: 0xffffff, toneMapped: false}));
    this.plane.name = 'Cámara de horquillas · imagen real'; this.plane.position.set(.79, -.13, .68); this.plane.rotation.y = Math.PI;
    this.plane.userData.editorRuntimeHelper = true; this.plane.visible = false;
    if (options.parent) options.parent.add(this.plane); this.elapsed = Infinity;
    const input = this.ctx.raycontrol;
    this.stateName = this.driving.simulation.statePrefix + 'vehicle-fork-camera';
    this.state = {colliderMesh: this.plane, controller: 'both', raycaster: true, consumeSelect: true, mergeSelection: true, captureSelect: true,
      isSelectable: () => !!this.ctx.vrMode && !!this.plane && this.plane.visible && this.active() && !this.driving.blocked(),
      onSelectStart: hit => { if (this.state.isSelectable() && hit && hit.uv) this.switchSide(); }};
    if (input) { input.addState(this.stateName, this.state); input.activateState(this.stateName); }
  }
  setEnabled(value) { this.enabled = !!value; this.failed = false; this.elapsed = Infinity; if (!this.enabled) this.release('disabled'); return this.enabled; }
  setAvailable(value) { this.available = !!value; if (!this.available) this.release('inactive'); }
  switchSide() { this.side *= -1; this.elapsed = Infinity; return this.side; }
  setMode(value) { if (!['entry', 'tips'].includes(value)) return false; this.mode = value; this.elapsed = Infinity; return true; }
  toggleMode() { this.setMode(this.mode === 'entry' ? 'tips' : 'entry'); return this.mode; }
  getStats() { return Object.assign({}, this.stats, {enabled: this.enabled, targetAllocated: !!this.target, mounted: this.mounted, side: this.side, mode: this.mode}); }
  profile() {
    const graphics = this.ctx.graphics, limits = graphics && graphics.getLimits && graphics.getLimits(), tier = limits && limits.tier;
    return tier === 'economy' ? {width: 256, height: 144, fps: 8} : tier === 'high' || tier === 'ultra' ? {width: 512, height: 288, fps: 15} : {width: 384, height: 216, fps: 12};
  }
  active() {
    const driving = this.driving, record = driving.record(), document = driving.document, xr = this.renderer && this.renderer.xr;
    const session = xr && xr.getSession && xr.getSession();
    return !!(this.mounted && this.enabled && this.available && !this.lost && !this.failed && this.renderer && driving.id && record && shown(record.object) &&
      driving.visualRoot && driving.visualRoot.userData.vehicleRig && driving.visualRoot.userData.vehicleRig.forks &&
      !this.ctx.roomTransition && !(this.ctx.editor && this.ctx.editor.active) &&
      (!document || !document.hidden || this.ctx.vrMode) && (!this.ctx.vrMode || session && (!session.visibilityState || session.visibilityState === 'visible')));
  }
  resources(profile) {
    if (this.target && this.stats.width === profile.width && this.stats.height === profile.height) return;
    this.release('allocating');
    this.target = new THREE.WebGLRenderTarget(profile.width, profile.height, {minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false, generateMipmaps: false});
    this.target.texture.name = 'Horquillas · cámara auxiliar GPU'; this.target.texture.generateMipmaps = false;
    // The offscreen scene has already been tone mapped. Basic feed surfaces
    // skip a second tone mapping, then apply the main output transfer once.
    this.target.texture.encoding = THREE.LinearEncoding;
    // In desktop mode the world-space VR screen is hidden and the visible feed
    // is composited by a separate GPU quad. Register the actual target owner so
    // room memory reclamation cannot mistake its hidden screen map for an
    // unused image texture. r112 does not mark RT textures automatically.
    const targets = this.ctx.performanceRenderTargets || (this.ctx.performanceRenderTargets = new Set());
    if (targets.add) targets.add(this.target);
    else if (Array.isArray(targets) && !targets.includes(this.target)) targets.push(this.target);
    if (this.plane) { this.plane.material.map = this.target.texture; this.plane.material.needsUpdate = true; }
    if (!this.overlayScene) {
      this.overlayScene = new THREE.Scene(); this.overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.overlay = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), new THREE.MeshBasicMaterial({map: this.target.texture, depthTest: false, depthWrite: false, toneMapped: false, fog: false}));
      this.overlay.frustumCulled = false; this.overlayScene.add(this.overlay);
    } else { this.overlay.material.map = this.target.texture; this.overlay.material.needsUpdate = true; }
    this.stats.width = profile.width; this.stats.height = profile.height; this.stats.maxFPS = profile.fps;
    this.stats.estimatedGpuBytes = profile.width * profile.height * 6; this.stats.allocations++;
  }
  product(record, snapshot) {
    const vehicle = record.components.vehicle;
    if (vehicle.entry && vehicle.entry.product) return vehicle.entry.product;
    if (snapshot === this.lastSnapshot) return this.lastProduct;
    this.lastSnapshot = snapshot; this.lastProduct = null;
    const outline = snapshot && snapshot.geometry && snapshot.geometry.target;
    if (!Array.isArray(outline) || outline.length !== 4) return null;
    const center = outline.reduce((point, value) => point.add(new THREE.Vector3().fromArray(value)), new THREE.Vector3()).multiplyScalar(.25); let distance = .06;
    if (this.driving.simulation.products) this.driving.simulation.products.forEach(product => {
      if (!shown(product.object)) return; product.object.updateWorldMatrix(true, false);
      const bottom = product.bounds.getCenter(new THREE.Vector3()); bottom.y = product.bounds.min.y; bottom.applyMatrix4(product.object.matrixWorld);
      const next = bottom.distanceTo(center); if (next < distance) { distance = next; this.lastProduct = product; }
    }); return this.lastProduct;
  }
  frame(snapshot) {
    const record = this.driving.record(), vehicle = record.components.vehicle, config = vehicle.config;
    const forks = this.driving.visualRoot.userData.vehicleRig.forks; forks.updateWorldMatrix(true, false);
    const inverse = new THREE.Matrix4().getInverse(forks.matrixWorld), product = this.product(record, snapshot);
    if (product) product.object.updateWorldMatrix(true, false);
    const load = product ? product.bounds.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, product.object.matrixWorld)) : null;
    const pocketPoints = snapshot && snapshot.geometry && snapshot.geometry.pockets || [];
    let pocketY = -.025;
    const samples = pocketPoints.flat().filter(point => Array.isArray(point) && point.length === 3 && point.every(finite));
    if (samples.length) pocketY = samples.reduce((sum, point) => sum + new THREE.Vector3().fromArray(point).applyMatrix4(inverse).y, 0) / samples.length;
    const runtime = this.driving.simulation.vehicleRuntime, pockets = product && runtime && runtime.productPockets && runtime.productPockets(product);
    if (pockets) {
      const center = product.bounds.getCenter(new THREE.Vector3()); center.y = (pockets.minY + pockets.maxY) / 2;
      pocketY = center.applyMatrix4(product.object.matrixWorld).applyMatrix4(inverse).y;
    }
    // Inspect the front pocket face and the emerging tine tips at three-quarter
    // angle. Keep the truck behind that face and crop to the pallet base: the
    // complete carton stack must never turn this into a whole-truck overview.
    const entry = this.mode === 'entry', entryFace = load ? entry ? load.min.z : load.max.z : config.forkLength * .65;
    this.camera = entry ? this.entryCamera : this.tipCamera;
    const aim = new THREE.Vector3(load ? load.getCenter(new THREE.Vector3()).x : 0, pocketY, entryFace + (entry ? -.012 : -.006));
    const width = Math.max(.65, config.forkSpread + config.forkWidth, load ? load.max.x - load.min.x : 0);
    const distance = Math.max(1.05, width * 1.05);
    const eyeZ = entry ? Math.min(entryFace - .025, Math.max(.08, entryFace - .17)) : entryFace + distance;
    const elevation = entry ? Math.hypot(distance, eyeZ - aim.z) * .61 : distance * .82;
    const eye = new THREE.Vector3(aim.x + this.side * distance, aim.y + elevation, eyeZ);
    const localAimX = aim.x;
    eye.applyMatrix4(forks.matrixWorld); aim.applyMatrix4(forks.matrixWorld);
    this.camera.position.copy(eye); this.camera.up.copy(UP); this.camera.lookAt(aim); this.camera.updateMatrixWorld(true);
    const visible = [];
    const shaft = entry && load ? [Math.max(.04, Math.min(config.forkLength, load.min.z - .28)), Math.min(config.forkLength, load.min.z + .10)] : [0, config.forkLength];
    for (const side of [-1, 1]) for (const x of [-1, 1]) for (const z of shaft) visible.push(new THREE.Vector3(side * config.forkSpread / 2 + x * config.forkWidth / 2, -config.forkThickness, z).applyMatrix4(forks.matrixWorld));
    const loadZ = load && entry ? [load.min.z, Math.min(load.max.z, load.min.z + .18)] : load && [load.min.z, load.max.z];
    const pocketSpan = config.forkSpread / 2 + config.forkWidth / 2 + .12;
    const loadX = load && entry ? [Math.max(load.min.x, localAimX - pocketSpan), Math.min(load.max.x, localAimX + pocketSpan)] : load && [load.min.x, load.max.x];
    if (load) for (const x of loadX) for (const z of loadZ) for (const y of [load.min.y, Math.min(load.max.y, load.min.y + (entry ? .22 : .35))]) visible.push(new THREE.Vector3(x, y, z).applyMatrix4(forks.matrixWorld));
    const view = this.camera.matrixWorldInverse, viewPoints = visible.map(point => point.clone().applyMatrix4(view));
    const bounds = new THREE.Box3().setFromPoints(viewPoints);
    const height = Math.max(.55, bounds.max.y - bounds.min.y + .10, (bounds.max.x - bounds.min.x + .14) / ASPECT);
    const center = bounds.getCenter(new THREE.Vector3());
    if (entry) {
      // A close orthographic image starts parallel rays behind the side of the
      // chassis and includes its whole flank. A real working-camera lens has
      // one exterior optical centre; crop/shift its sensor to the entry slots.
      const slopes = new THREE.Box2().setFromPoints(viewPoints.map(point => new THREE.Vector2(point.x / Math.max(.03, -point.z), point.y / Math.max(.03, -point.z))));
      const size = slopes.getSize(new THREE.Vector2()).multiplyScalar(1.12), middle = slopes.getCenter(new THREE.Vector2());
      const h = Math.max(.25, size.y, size.x / ASPECT), w = h * ASPECT, n = this.camera.near;
      this.camera.fov = 2 * Math.atan(h / 2) * 180 / Math.PI;
      this.camera.projectionMatrix.makePerspective((middle.x - w / 2) * n, (middle.x + w / 2) * n, (middle.y + h / 2) * n, (middle.y - h / 2) * n, n, this.camera.far);
      this.camera.projectionMatrixInverse.getInverse(this.camera.projectionMatrix);
    } else {
      this.camera.left = center.x - height * ASPECT / 2; this.camera.right = center.x + height * ASPECT / 2;
      this.camera.bottom = center.y - height / 2; this.camera.top = center.y + height / 2; this.camera.updateProjectionMatrix();
    }
    this.framing = {eye: eye.clone(), aim: aim.clone(), product, forks, localLoad: load, visible, height, mode: this.mode}; return this.framing;
  }
  saveState() {
    const renderer = this.renderer, xr = renderer.xr, shadow = renderer.shadowMap, info = renderer.info;
    return {target: renderer.getRenderTarget(), cube: renderer.getActiveCubeFace && renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel && renderer.getActiveMipmapLevel(),
      viewport: renderer.getViewport(this.viewport).clone(), scissor: renderer.getScissor(this.scissor).clone(), scissorTest: renderer.getScissorTest(),
      xr: xr && xr.enabled, autoClear: renderer.autoClear, toneMapping: renderer.toneMapping, toneMappingExposure: renderer.toneMappingExposure,
      shadow: shadow && {enabled: shadow.enabled, autoUpdate: shadow.autoUpdate, needsUpdate: shadow.needsUpdate},
      primary: this.ctx.camera && {matrix: this.ctx.camera.matrix.clone(), world: this.ctx.camera.matrixWorld.clone(), inverse: this.ctx.camera.matrixWorldInverse.clone(), projection: this.ctx.camera.projectionMatrix.clone(), needsUpdate: this.ctx.camera.matrixWorldNeedsUpdate},
      infoReset: info && info.autoReset, info: info && info.render && Object.assign({}, info.render)};
  }
  restoreState(saved) {
    const renderer = this.renderer, xr = renderer.xr;
    if (xr) xr.enabled = saved.xr; renderer.autoClear = saved.autoClear; renderer.toneMapping = saved.toneMapping; renderer.toneMappingExposure = saved.toneMappingExposure;
    if (renderer.shadowMap && saved.shadow) Object.assign(renderer.shadowMap, saved.shadow);
    if (renderer.info) { renderer.info.autoReset = saved.infoReset; if (saved.info) Object.assign(renderer.info.render, saved.info); }
    if (saved.primary && this.ctx.camera) { this.ctx.camera.matrix.copy(saved.primary.matrix); this.ctx.camera.matrixWorld.copy(saved.primary.world); this.ctx.camera.matrixWorldInverse.copy(saved.primary.inverse); this.ctx.camera.projectionMatrix.copy(saved.primary.projection); this.ctx.camera.matrixWorldNeedsUpdate = saved.primary.needsUpdate; }
    // r112 uses an opaque XR framebuffer even when getRenderTarget() is null.
    const session = xr && xr.isPresenting && xr.getSession && xr.getSession(), layer = session && session.renderState && session.renderState.baseLayer;
    if (renderer.setFramebuffer && layer && layer.framebuffer) renderer.setFramebuffer(layer.framebuffer);
    renderer.setRenderTarget(saved.target, saved.cube, saved.mip); renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.scissorTest);
  }
  hideHelpers() {
    const ray = this.ctx.raycontrol, values = [this.plane, this.ctx.cameraRig, ray && ray.raycasterContext, this.driving.worldPanel && this.driving.worldPanel.plane,
      this.driving.docking && this.driving.docking.plane];
    if (this.mountOptions.hiddenObjects) values.push(...this.mountOptions.hiddenObjects());
    const seen = new Set(); this.hidden = [];
    for (const node of values) if (node && !seen.has(node)) { seen.add(node); this.hidden.push([node, node.visible]); node.visible = false; }
  }
  renderBefore(scene, delta = 0) {
    if (!this.active()) { this.release(this.failed ? 'unavailable' : this.enabled ? 'inactive' : 'disabled'); return false; }
    const profile = this.profile(); this.elapsed += Math.max(0, finite(delta) ? delta : 0);
    if (this.target && this.elapsed < 1 / profile.fps) return false;
    const renderer = this.renderer, gl = renderer.getContext && renderer.getContext();
    if (gl && gl.isContextLost && gl.isContextLost()) { this.release('context-lost'); return false; }
    const saved = this.saveState(), started = typeof performance === 'undefined' ? Date.now() : performance.now();
    try {
      this.resources(profile); this.frame(this.driving.docking && this.driving.docking.snapshot);
      this.hideHelpers(); if (renderer.xr) renderer.xr.enabled = false;
      renderer.autoClear = true; if (renderer.shadowMap) { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; }
      if (renderer.info) renderer.info.autoReset = false;
      // setRenderTarget applies the target's physical-pixel viewport. Calling
      // setViewport here would multiply it by the desktop DPR again in r112.
      renderer.setRenderTarget(this.target); renderer.setScissorTest(false);
      renderer.render(scene, this.camera); this.elapsed = 0; this.stats.frames++; this.stats.status = 'active';
      if (this.plane) this.plane.visible = !!this.ctx.vrMode; return true;
    } catch (_) { this.stats.failures++; this.failed = true; this.release('unavailable'); this.elapsed = 0; return false; }
    finally {
      if (this.hidden) { this.hidden.forEach(([node, visible]) => { node.visible = visible; }); this.hidden = null; }
      this.restoreState(saved); if (this.plane) this.plane.visible = !!(this.target && this.ctx.vrMode && this.active());
      this.stats.lastRenderMs = (typeof performance === 'undefined' ? Date.now() : performance.now()) - started;
    }
  }
  postRender() {
    if (this.ctx.vrMode || !this.active() || !this.target || !this.element || !this.overlayScene) return false;
    const renderer = this.renderer, canvas = renderer.domElement, rect = this.element.getBoundingClientRect && this.element.getBoundingClientRect(), canvasRect = canvas && canvas.getBoundingClientRect && canvas.getBoundingClientRect();
    if (!rect || !canvasRect || rect.width <= 0 || rect.height <= 0 || canvasRect.width <= 0 || canvasRect.height <= 0) return false;
    const left = Math.max(rect.left, canvasRect.left), right = Math.min(rect.right === undefined ? rect.left + rect.width : rect.right, canvasRect.left + canvasRect.width);
    const top = Math.max(rect.top, canvasRect.top), bottom = Math.min(rect.bottom === undefined ? rect.top + rect.height : rect.bottom, canvasRect.top + canvasRect.height);
    if (right <= left || bottom <= top) return false;
    const dpr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1, scaleX = canvas.width / dpr / canvasRect.width, scaleY = canvas.height / dpr / canvasRect.height;
    const saved = this.saveState();
    try {
      if (renderer.xr) renderer.xr.enabled = false; renderer.setRenderTarget(null); renderer.autoClear = false;
      if (renderer.info) renderer.info.autoReset = false;
      if (renderer.shadowMap) { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; }
      renderer.setViewport((rect.left - canvasRect.left) * scaleX, (canvasRect.height - (rect.top - canvasRect.top) - rect.height) * scaleY, rect.width * scaleX, rect.height * scaleY);
      renderer.setScissor((left - canvasRect.left) * scaleX, (canvasRect.height - (bottom - canvasRect.top)) * scaleY, (right - left) * scaleX, (bottom - top) * scaleY); renderer.setScissorTest(true);
      renderer.render(this.overlayScene, this.overlayCamera); return true;
    } catch (_) { this.stats.failures++; this.failed = true; this.release('unavailable'); return false; }
    finally { this.restoreState(saved); }
  }
  release(status = 'inactive') {
    if (this.plane) { this.plane.visible = false; if (this.plane.material.map) { this.plane.material.map = null; this.plane.material.needsUpdate = true; } }
    if (this.overlay) this.overlay.material.map = null;
    if (this.target) {
      const targets = this.ctx.performanceRenderTargets;
      if (targets && targets.delete) targets.delete(this.target);
      else if (Array.isArray(targets)) { const index = targets.indexOf(this.target); if (index >= 0) targets.splice(index, 1); }
      this.target.dispose();
    }
    this.target = null;
    this.stats.width = this.stats.height = this.stats.estimatedGpuBytes = 0; this.stats.status = status;
  }
  unmount() {
    const input = this.ctx.raycontrol;
    if (input && this.stateName) { if (input.deactivateState) input.deactivateState(this.stateName); if (input.removeState) input.removeState(this.stateName); else if (input.states && input.states[this.stateName] === this.state) delete input.states[this.stateName]; }
    this.state = this.stateName = null;
    this.release('inactive'); this.mounted = false; this.available = false; this.lastSnapshot = this.lastProduct = this.framing = null;
    if (this.plane) { if (this.plane.parent) this.plane.parent.remove(this.plane); this.plane.geometry.dispose(); this.plane.material.dispose(); this.plane = null; }
    this.element = this.mountOptions = null;
  }
  dispose() {
    this.unmount(); if (this.overlay) { this.overlay.geometry.dispose(); this.overlay.material.dispose(); }
    this.overlay = this.overlayScene = this.overlayCamera = null;
    const canvas = this.renderer && this.renderer.domElement;
    if (canvas && canvas.removeEventListener) { canvas.removeEventListener('webglcontextlost', this.onLost); canvas.removeEventListener('webglcontextrestored', this.onRestored); }
  }
}
