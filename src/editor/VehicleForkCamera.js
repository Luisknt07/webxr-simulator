import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0), ASPECT = 16 / 9;
const finite = value => Number.isFinite(value);
const shown = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };

/** Two GPU displays share one throttled auxiliary world-pass budget. Neither
 * camera changes the tracked view, vehicle motion, pallet or fork geometry. */
export default class VehicleForkCamera {
  constructor(driving, options = {}) {
    this.driving = driving; this.ctx = driving.ctx; this.options = options; this.renderer = this.ctx.renderer;
    this.enabled = true; this.available = false; this.elapsed = Infinity; this.side = -1; this.mode = 'entry'; this.mounted = false; this.lost = false; this.failed = false; this.nextFeed = 0;
    this.viewport = new THREE.Vector4(); this.scissor = new THREE.Vector4(); this.rendered = new Set();
    this.visibilityProbe = new THREE.PerspectiveCamera();
    this.stats = {status: 'inactive', frames: 0, frontFrames: 0, mirrorFrames: 0, failures: 0, allocations: 0, width: 0, height: 0, mirrorWidth: 0, mirrorHeight: 0, maxFPS: 0, estimatedGpuBytes: 0, lastRenderMs: 0};
    this.entryCamera = new THREE.PerspectiveCamera(90, ASPECT, .008, 60); this.entryCamera.name = 'Cámara frontal de entrada · eje de horquillas';
    this.tipCamera = new THREE.PerspectiveCamera(65, ASPECT, .008, 60); this.tipCamera.name = 'Cámara frontal de salida de puntas'; this.camera = this.entryCamera;
    this.mirrorCamera = new THREE.PerspectiveCamera(66, ASPECT, .05, 70); this.mirrorCamera.name = 'Retrovisor · cámara posterior del vehículo';
    this.onLost = () => { this.lost = true; this.release('context-lost'); };
    this.onRestored = () => { this.lost = this.failed = false; this.elapsed = Infinity; };
    const canvas = this.renderer && this.renderer.domElement;
    if (canvas && canvas.addEventListener) { canvas.addEventListener('webglcontextlost', this.onLost); canvas.addEventListener('webglcontextrestored', this.onRestored); }
  }
  makePlane(name, layout, fallback) {
    const setting = Object.assign({}, fallback, layout), plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(setting.width, setting.height), new THREE.MeshBasicMaterial({color: 0xffffff, toneMapped: false}));
    plane.name = name; plane.position.fromArray(setting.position); plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), plane.position, UP));
    plane.userData.editorRuntimeHelper = true; plane.visible = false; if (this.mountOptions.parent) this.mountOptions.parent.add(plane); return plane;
  }
  mount(options = {}) {
    this.unmount(); this.mountOptions = options; this.element = options.element; this.mirrorElement = options.mirrorElement; this.mounted = true; this.enabled = true; this.available = true; this.failed = false; this.mode = 'entry'; this.nextFeed = 0;
    const layout = options.planeLayout || {};
    this.plane = this.makePlane('Frontal de horquillas · imagen real', layout.front, {position: [.84, .08, 1.10], width: .68, height: .3825});
    this.mirrorPlane = this.makePlane('Retrovisor · imagen posterior reflejada', layout.mirror, {position: [.84, .405, 1.10], width: .36, height: .2025});
    // Informational displays never capture the steering/lever trigger or grip.
    this.state = this.stateName = null; this.elapsed = Infinity;
  }
  setEnabled(value) { this.enabled = !!value; this.failed = false; this.elapsed = Infinity; if (!this.enabled) this.release('disabled'); return this.enabled; }
  setAvailable(value) { this.available = !!value; if (!this.available) this.release('inactive'); }
  switchSide() { this.side *= -1; return this.side; } // Legacy binding; frontal lenses stay centred.
  setMode(value) { if (!['entry', 'tips'].includes(value)) return false; this.mode = value; this.elapsed = Infinity; this.nextFeed = 0; return true; }
  toggleMode() { this.setMode(this.mode === 'entry' ? 'tips' : 'entry'); return this.mode; }
  getStats() { return Object.assign({}, this.stats, {enabled: this.enabled, targetAllocated: !!this.target, mirrorTargetAllocated: !!this.mirrorTarget, totalFrames: this.stats.frames, mounted: this.mounted, side: this.side, mode: this.mode}); }
  profile() {
    const graphics = this.ctx.graphics, limits = graphics && graphics.getLimits && graphics.getLimits(), tier = limits && limits.tier;
    const profile = tier === 'economy' ? {width: 256, height: 144, fps: 8} : tier === 'high' || tier === 'ultra' ? {width: 640, height: 360, fps: 15} : {width: 512, height: 288, fps: 12};
    if (this.ctx.vrMode) { profile.width = Math.min(384, profile.width); profile.height = profile.width / ASPECT; profile.fps = Math.min(10, profile.fps); }
    profile.mirrorWidth = Math.max(128, profile.width / 2); profile.mirrorHeight = profile.mirrorWidth / ASPECT; return profile;
  }
  active() {
    const driving = this.driving, record = driving.record(), document = driving.document, xr = this.renderer && this.renderer.xr, session = xr && xr.getSession && xr.getSession();
    return !!(this.mounted && this.enabled && this.available && !this.lost && !this.failed && this.renderer && driving.id && record && shown(record.object) && driving.visualRoot && driving.visualRoot.userData.vehicleRig && driving.visualRoot.userData.vehicleRig.forks && !this.ctx.roomTransition && !(this.ctx.editor && this.ctx.editor.active) && (!document || !document.hidden || this.ctx.vrMode) && (!this.ctx.vrMode || session && (!session.visibilityState || session.visibilityState === 'visible')));
  }
  desktopRect(element) {
    if (!element) return null;
    for (let node = element; node; node = node.parentNode) if (node.hidden || node.style && (node.style.display === 'none' || node.style.visibility === 'hidden')) return null;
    const canvas = this.renderer.domElement, rect = element.getBoundingClientRect && element.getBoundingClientRect(), canvasRect = canvas && canvas.getBoundingClientRect && canvas.getBoundingClientRect();
    if (!rect || !canvasRect || rect.width <= 0 || rect.height <= 0 || canvasRect.width <= 0 || canvasRect.height <= 0) return null;
    const left = Math.max(rect.left, canvasRect.left), right = Math.min(rect.right === undefined ? rect.left + rect.width : rect.right, canvasRect.left + canvasRect.width), top = Math.max(rect.top, canvasRect.top), bottom = Math.min(rect.bottom === undefined ? rect.top + rect.height : rect.bottom, canvasRect.top + canvasRect.height);
    return right > left && bottom > top ? {rect, canvasRect, left, right, top, bottom} : null;
  }
  screenVisible(plane) {
    if (!plane || !shown(plane)) return false;
    const xr = this.renderer.xr; let camera = this.ctx.camera;
    if (!camera) return true;
    // r112 getCamera writes the supplied camera's world matrix and children.
    // Query the stereo frustum with a childless probe, never the tracked head.
    if (this.ctx.vrMode && xr && xr.getCamera) { this.visibilityProbe.parent = camera.parent; camera = xr.getCamera(this.visibilityProbe) || camera; }
    if (!camera.projectionMatrix) return true;
    const cameras = camera.cameras && camera.cameras.length ? camera.cameras : [camera]; plane.updateWorldMatrix(true, false); if (!plane.geometry.boundingSphere) plane.geometry.computeBoundingSphere();
    const sphere = plane.geometry.boundingSphere.clone().applyMatrix4(plane.matrixWorld);
    return cameras.some(view => new THREE.Frustum().setFromMatrix(new THREE.Matrix4().multiplyMatrices(view.projectionMatrix, new THREE.Matrix4().getInverse(view.matrixWorld))).intersectsSphere(sphere));
  }
  visibleFeeds() { return ['front', 'mirror'].filter(name => this.ctx.vrMode ? this.screenVisible(name === 'front' ? this.plane : this.mirrorPlane) : !!this.desktopRect(name === 'front' ? this.element : this.mirrorElement)); }
  resources(profile, name = 'front') {
    if (this.stats.width && (this.stats.width !== profile.width || this.stats.height !== profile.height)) this.release('allocating');
    const key = name === 'front' ? 'target' : 'mirrorTarget'; if (this[key]) return;
    const width = name === 'front' ? profile.width : profile.mirrorWidth, height = name === 'front' ? profile.height : profile.mirrorHeight;
    const target = this[key] = new THREE.WebGLRenderTarget(width, height, {minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false, generateMipmaps: false});
    target.texture.name = name === 'front' ? 'Frontal de horquillas · GPU' : 'Retrovisor posterior reflejado · GPU'; target.texture.generateMipmaps = false; target.texture.encoding = THREE.LinearEncoding;
    if (name === 'mirror') { target.texture.repeat.x = -1; target.texture.offset.x = 1; target.texture.updateMatrix(); }
    const targets = this.ctx.performanceRenderTargets || (this.ctx.performanceRenderTargets = new Set()); if (targets.add) targets.add(target); else if (Array.isArray(targets) && !targets.includes(target)) targets.push(target);
    const plane = name === 'front' ? this.plane : this.mirrorPlane; if (plane) { plane.material.map = target.texture; plane.material.needsUpdate = true; }
    const sceneKey = name === 'front' ? 'overlayScene' : 'mirrorOverlayScene', overlayKey = name === 'front' ? 'overlay' : 'mirrorOverlay';
    if (!this[sceneKey]) { this[sceneKey] = new THREE.Scene(); this[overlayKey] = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), new THREE.MeshBasicMaterial({map: target.texture, depthTest: false, depthWrite: false, toneMapped: false, fog: false})); this[overlayKey].frustumCulled = false; this[sceneKey].add(this[overlayKey]); }
    else { this[overlayKey].material.map = target.texture; this[overlayKey].material.needsUpdate = true; }
    if (!this.overlayCamera) this.overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.stats.width = profile.width; this.stats.height = profile.height; this.stats.mirrorWidth = profile.mirrorWidth; this.stats.mirrorHeight = profile.mirrorHeight; this.stats.maxFPS = profile.fps;
    this.stats.estimatedGpuBytes = [this.target, this.mirrorTarget].filter(Boolean).reduce((sum, value) => sum + value.width * value.height * 8, 0); this.stats.allocations++;
  }
  product(record, snapshot) {
    const vehicle = record.components.vehicle; if (vehicle.entry && vehicle.entry.product) return vehicle.entry.product; if (snapshot === this.lastSnapshot) return this.lastProduct;
    this.lastSnapshot = snapshot; this.lastProduct = null; const outline = snapshot && snapshot.geometry && snapshot.geometry.target; if (!Array.isArray(outline) || outline.length !== 4) return null;
    const center = outline.reduce((point, value) => point.add(new THREE.Vector3().fromArray(value)), new THREE.Vector3()).multiplyScalar(.25); let distance = .06;
    if (this.driving.simulation.products) this.driving.simulation.products.forEach(product => { if (!shown(product.object)) return; product.object.updateWorldMatrix(true, false); const bottom = product.bounds.getCenter(new THREE.Vector3()); bottom.y = product.bounds.min.y; bottom.applyMatrix4(product.object.matrixWorld); const next = bottom.distanceTo(center); if (next < distance) { distance = next; this.lastProduct = product; } }); return this.lastProduct;
  }
  fit(camera, visible, entry = false) {
    const points = visible.map(point => point.clone().applyMatrix4(camera.matrixWorldInverse)), slopes = new THREE.Box2().setFromPoints(points.map(point => new THREE.Vector2(point.x / Math.max(.008, -point.z), point.y / Math.max(.008, -point.z))));
    const size = slopes.getSize(new THREE.Vector2()).multiplyScalar(1.14), middle = slopes.getCenter(new THREE.Vector2()), h = Math.max(.18, size.y, size.x / ASPECT), w = h * ASPECT, n = camera.near;
    // A wide frontal lens has spare vertical field. Shift its sensor toward
    // the working floor rather than filling the top with the truck's chassis.
    if (entry) middle.y = Math.min(middle.y, slopes.max.y + Math.max(.04, size.y * .12) - h / 2);
    camera.fov = 2 * Math.atan(h / 2) * 180 / Math.PI; camera.projectionMatrix.makePerspective((middle.x - w / 2) * n, (middle.x + w / 2) * n, (middle.y + h / 2) * n, (middle.y - h / 2) * n, n, camera.far); camera.projectionMatrixInverse.getInverse(camera.projectionMatrix); return h;
  }
  frame(snapshot) {
    const record = this.driving.record(), config = record.components.vehicle.config, forks = this.driving.visualRoot.userData.vehicleRig.forks; forks.updateWorldMatrix(true, false);
    const inverse = new THREE.Matrix4().getInverse(forks.matrixWorld), product = this.product(record, snapshot); if (product) product.object.updateWorldMatrix(true, false);
    const load = product ? product.bounds.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, product.object.matrixWorld)) : null, entry = this.mode === 'entry', face = load ? entry ? load.min.z : load.max.z : config.forkLength;
    let pocketY = -config.forkThickness * .25;
    const runtime = this.driving.simulation.vehicleRuntime, pockets = product && runtime && runtime.productPockets && runtime.productPockets(product);
    if (pockets) { const center = product.bounds.getCenter(new THREE.Vector3()); center.y = (pockets.minY + pockets.maxY) / 2; pocketY = center.applyMatrix4(product.object.matrixWorld).applyMatrix4(inverse).y; }
    // A slight elevation exposes the broad upper faces, instead of sighting
    // through the metal thickness. The lens clears the hydraulic cylinder's
    // front face, keeps a frontal axis and uses at most 15° optical pitch.
    const eyeLocal = new THREE.Vector3(0, entry ? .025 : -config.forkThickness * .25, entry ? -.02 : Math.max(config.forkLength, face) + .65);
    const aimZ = entry ? Math.max(face, eyeLocal.z + .3) : config.forkLength - .02;
    const aimLocal = new THREE.Vector3(0, entry ? Math.max(pocketY, eyeLocal.y - Math.tan(15 * Math.PI / 180) * (aimZ - eyeLocal.z)) : eyeLocal.y, aimZ);
    this.camera = entry ? this.entryCamera : this.tipCamera;
    const eye = eyeLocal.clone().applyMatrix4(forks.matrixWorld), aim = aimLocal.clone().applyMatrix4(forks.matrixWorld); this.camera.position.copy(eye); this.camera.up.copy(UP).transformDirection(forks.matrixWorld); this.camera.lookAt(aim); this.camera.updateMatrixWorld(true);
    const visible = [], span = config.forkSpread / 2 + config.forkWidth / 2, shaft = entry && load ? [Math.max(.055, Math.min(config.forkLength - .02, load.min.z - .45)), Math.min(config.forkLength, Math.max(.06, load.min.z - .015))] : [Math.max(.02, config.forkLength - .22), config.forkLength];
    for (const side of [-1, 1]) for (const x of [-1, 1]) for (const z of shaft) for (const y of [-config.forkThickness, 0]) visible.push(new THREE.Vector3(side * config.forkSpread / 2 + x * config.forkWidth / 2, y, z).applyMatrix4(forks.matrixWorld));
    if (load) for (const x of [Math.max(load.min.x, -span - .12), Math.min(load.max.x, span + .12)]) for (const y of [load.min.y, Math.min(load.max.y, load.min.y + .18)]) visible.push(new THREE.Vector3(x, y, face).applyMatrix4(forks.matrixWorld));
    const pocketPoints = snapshot && snapshot.geometry && snapshot.geometry.pockets || [];
    pocketPoints.flat().filter(point => Array.isArray(point) && point.length === 3 && point.every(finite)).forEach(point => { const local = new THREE.Vector3().fromArray(point).applyMatrix4(inverse); if (Math.abs(local.z - face) < .06) visible.push(new THREE.Vector3().fromArray(point)); });
    const height = this.fit(this.camera, visible, false); this.framing = {eye, aim, eyeLocal, aimLocal, product, forks, localLoad: load, visible, height, mode: this.mode, direction: entry ? 'forward' : 'rearward'}; return this.framing;
  }
  frameMirror() {
    const root = this.driving.visualRoot, config = this.driving.record().components.vehicle.config; root.updateWorldMatrix(true, false);
    const eyeLocal = new THREE.Vector3(0, Math.max(1.55, config.height * .84), -config.length * .12), aimLocal = new THREE.Vector3(0, .45, -config.length * 2.8), eye = eyeLocal.clone().applyMatrix4(root.matrixWorld), aim = aimLocal.clone().applyMatrix4(root.matrixWorld);
    this.mirrorCamera.position.copy(eye); this.mirrorCamera.up.copy(UP).transformDirection(root.matrixWorld); this.mirrorCamera.lookAt(aim); this.mirrorCamera.updateMatrixWorld(true); this.mirrorCamera.updateProjectionMatrix(); this.mirrorFraming = {eye, aim, eyeLocal, aimLocal, root, mirrored: true}; return this.mirrorFraming;
  }
  saveState() {
    const renderer = this.renderer, xr = renderer.xr, shadow = renderer.shadowMap, info = renderer.info;
    return {target: renderer.getRenderTarget(), cube: renderer.getActiveCubeFace && renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel && renderer.getActiveMipmapLevel(), viewport: renderer.getViewport(this.viewport).clone(), scissor: renderer.getScissor(this.scissor).clone(), scissorTest: renderer.getScissorTest(), xr: xr && xr.enabled, autoClear: renderer.autoClear, toneMapping: renderer.toneMapping, toneMappingExposure: renderer.toneMappingExposure, shadow: shadow && {enabled: shadow.enabled, autoUpdate: shadow.autoUpdate, needsUpdate: shadow.needsUpdate}, primary: this.ctx.camera && {matrix: this.ctx.camera.matrix.clone(), world: this.ctx.camera.matrixWorld.clone(), inverse: this.ctx.camera.matrixWorldInverse.clone(), projection: this.ctx.camera.projectionMatrix.clone(), needsUpdate: this.ctx.camera.matrixWorldNeedsUpdate}, infoReset: info && info.autoReset, info: info && info.render && Object.assign({}, info.render)};
  }
  restoreState(saved) {
    const renderer = this.renderer, xr = renderer.xr; if (xr) xr.enabled = saved.xr; renderer.autoClear = saved.autoClear; renderer.toneMapping = saved.toneMapping; renderer.toneMappingExposure = saved.toneMappingExposure;
    if (renderer.shadowMap && saved.shadow) Object.assign(renderer.shadowMap, saved.shadow); if (renderer.info) { renderer.info.autoReset = saved.infoReset; if (saved.info) Object.assign(renderer.info.render, saved.info); }
    if (saved.primary && this.ctx.camera) { this.ctx.camera.matrix.copy(saved.primary.matrix); this.ctx.camera.matrixWorld.copy(saved.primary.world); this.ctx.camera.matrixWorldInverse.copy(saved.primary.inverse); this.ctx.camera.projectionMatrix.copy(saved.primary.projection); this.ctx.camera.matrixWorldNeedsUpdate = saved.primary.needsUpdate; }
    const session = xr && xr.isPresenting && xr.getSession && xr.getSession(), layer = session && session.renderState && session.renderState.baseLayer; if (renderer.setFramebuffer && layer && layer.framebuffer) renderer.setFramebuffer(layer.framebuffer);
    renderer.setRenderTarget(saved.target, saved.cube, saved.mip); renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.scissorTest);
  }
  hideHelpers() {
    const ray = this.ctx.raycontrol, values = [this.plane, this.mirrorPlane, this.ctx.cameraRig, ray && ray.raycasterContext, this.driving.worldPanel && this.driving.worldPanel.plane, this.driving.docking && this.driving.docking.plane]; if (this.mountOptions.hiddenObjects) values.push(...this.mountOptions.hiddenObjects());
    const seen = new Set(); this.hidden = []; for (const node of values) if (node && !seen.has(node)) { seen.add(node); this.hidden.push([node, node.visible]); node.visible = false; }
  }
  syncScreenVisibility() {
    const active = !!this.ctx.vrMode && this.active();
    if (this.plane) this.plane.visible = !!(active && this.target);
    if (this.mirrorPlane) this.mirrorPlane.visible = !!(active && this.mirrorTarget);
  }
  renderBefore(scene, delta = 0) {
    if (!this.active()) { this.release(this.failed ? 'unavailable' : this.enabled ? 'inactive' : 'disabled'); return false; }
    [this.plane, this.mirrorPlane].filter(Boolean).forEach(plane => { plane.visible = !!this.ctx.vrMode; }); const profile = this.profile(); this.elapsed += Math.max(0, finite(delta) ? delta : 0);
    // Visibility probes need both candidate surfaces even before their first
    // image exists. Restore display visibility before every early return so a
    // 90 Hz headset never draws the uninitialized white mirror between passes.
    const visible = this.visibleFeeds(); this.syncScreenVisibility(); if (!visible.length) { this.stats.status = 'hidden'; return false; } if (this.rendered.size && this.elapsed < 1 / profile.fps) return false;
    const renderer = this.renderer, gl = renderer.getContext && renderer.getContext(); if (gl && gl.isContextLost && gl.isContextLost()) { this.release('context-lost'); return false; }
    const schedule = ['front', 'front', 'mirror'], missing = visible.find(value => !this.rendered.has(value)); let name = missing || schedule[this.nextFeed++ % schedule.length]; if (!visible.includes(name)) name = visible[0];
    const saved = this.saveState(), started = typeof performance === 'undefined' ? Date.now() : performance.now();
    try {
      this.resources(profile, name); const camera = name === 'front' ? (this.frame(this.driving.docking && this.driving.docking.snapshot), this.camera) : (this.frameMirror(), this.mirrorCamera);
      this.hideHelpers(); if (renderer.xr) renderer.xr.enabled = false; renderer.autoClear = true; if (renderer.shadowMap) { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; } if (renderer.info) renderer.info.autoReset = false;
      renderer.setRenderTarget(name === 'front' ? this.target : this.mirrorTarget); renderer.setScissorTest(false); renderer.render(scene, camera); this.elapsed = 0; this.rendered.add(name); this.stats.frames++; this.stats[name === 'front' ? 'frontFrames' : 'mirrorFrames']++; this.stats.lastFeed = name; this.stats.status = 'active'; return true;
    } catch (_) { this.stats.failures++; this.failed = true; this.release('unavailable'); this.elapsed = 0; return false; }
    finally {
      if (this.hidden) { this.hidden.forEach(([node, visible]) => { node.visible = visible; }); this.hidden = null; } this.restoreState(saved);
      this.syncScreenVisibility();
      this.stats.lastRenderMs = (typeof performance === 'undefined' ? Date.now() : performance.now()) - started;
    }
  }
  postRender() {
    if (this.ctx.vrMode || !this.active()) return false;
    const feeds = [{element: this.element, target: this.target, scene: this.overlayScene}, {element: this.mirrorElement, target: this.mirrorTarget, scene: this.mirrorOverlayScene}].filter(feed => feed.target && feed.scene && this.desktopRect(feed.element)); if (!feeds.length) return false;
    const renderer = this.renderer, canvas = renderer.domElement, dpr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1, saved = this.saveState();
    try {
      if (renderer.xr) renderer.xr.enabled = false; renderer.setRenderTarget(null); renderer.autoClear = false; if (renderer.info) renderer.info.autoReset = false; if (renderer.shadowMap) { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; }
      feeds.forEach(feed => { const {rect, canvasRect, left, right, top, bottom} = this.desktopRect(feed.element), scaleX = canvas.width / dpr / canvasRect.width, scaleY = canvas.height / dpr / canvasRect.height;
        renderer.setViewport((rect.left - canvasRect.left) * scaleX, (canvasRect.height - (rect.top - canvasRect.top) - rect.height) * scaleY, rect.width * scaleX, rect.height * scaleY); renderer.setScissor((left - canvasRect.left) * scaleX, (canvasRect.height - (bottom - canvasRect.top)) * scaleY, (right - left) * scaleX, (bottom - top) * scaleY); renderer.setScissorTest(true); renderer.render(feed.scene, this.overlayCamera); }); return true;
    } catch (_) { this.stats.failures++; this.failed = true; this.release('unavailable'); return false; } finally { this.restoreState(saved); }
  }
  release(status = 'inactive') {
    [this.plane, this.mirrorPlane].filter(Boolean).forEach(plane => { plane.visible = false; if (plane.material.map) { plane.material.map = null; plane.material.needsUpdate = true; } }); [this.overlay, this.mirrorOverlay].filter(Boolean).forEach(overlay => { overlay.material.map = null; });
    for (const key of ['target', 'mirrorTarget']) if (this[key]) { const targets = this.ctx.performanceRenderTargets; if (targets && targets.delete) targets.delete(this[key]); else if (Array.isArray(targets)) { const index = targets.indexOf(this[key]); if (index >= 0) targets.splice(index, 1); } this[key].dispose(); this[key] = null; }
    this.rendered.clear(); this.elapsed = Infinity; this.stats.width = this.stats.height = this.stats.mirrorWidth = this.stats.mirrorHeight = this.stats.estimatedGpuBytes = 0; this.stats.status = status;
  }
  unmount() {
    this.release('inactive'); this.mounted = false; this.available = false; this.lastSnapshot = this.lastProduct = this.framing = this.mirrorFraming = null;
    for (const key of ['plane', 'mirrorPlane']) if (this[key]) { if (this[key].parent) this[key].parent.remove(this[key]); this[key].geometry.dispose(); this[key].material.dispose(); this[key] = null; }
    this.state = this.stateName = null; this.element = this.mirrorElement = this.mountOptions = null;
  }
  dispose() {
    this.unmount(); for (const key of ['overlay', 'mirrorOverlay']) if (this[key]) { this[key].geometry.dispose(); this[key].material.dispose(); this[key] = null; } this.overlayScene = this.mirrorOverlayScene = this.overlayCamera = null;
    const canvas = this.renderer && this.renderer.domElement; if (canvas && canvas.removeEventListener) { canvas.removeEventListener('webglcontextlost', this.onLost); canvas.removeEventListener('webglcontextrestored', this.onRestored); }
  }
}
