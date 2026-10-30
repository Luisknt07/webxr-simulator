import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0), ASPECT = 16 / 9;
const finite = value => Number.isFinite(value);
const shown = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };

// The original r112 renderer normally uses WebGL1. Its default framebuffer AA
// does not apply to an offscreen camera texture. Filter that texture while it
// is composed, preserving BasicMaterial's UV transform and output encoding.
const CAMERA_FXAA = `
uniform vec2 cameraTexel;
uniform float cameraFxaaEnabled;
vec4 cameraFxaa(sampler2D image, vec2 uv) {
  vec4 center = texture2D(image, uv);
  if (cameraFxaaEnabled < 0.5) return center;
  vec3 nw = texture2D(image, uv + vec2(-1.0, -1.0) * cameraTexel).rgb;
  vec3 ne = texture2D(image, uv + vec2(1.0, -1.0) * cameraTexel).rgb;
  vec3 sw = texture2D(image, uv + vec2(-1.0, 1.0) * cameraTexel).rgb;
  vec3 se = texture2D(image, uv + vec2(1.0, 1.0) * cameraTexel).rgb;
  vec3 weights = vec3(0.299, 0.587, 0.114);
  float lnw = dot(nw, weights), lne = dot(ne, weights);
  float lsw = dot(sw, weights), lse = dot(se, weights), lm = dot(center.rgb, weights);
  float low = min(lm, min(min(lnw, lne), min(lsw, lse)));
  float high = max(lm, max(max(lnw, lne), max(lsw, lse)));
  if (high - low < max(0.025, high * 0.075)) return center;
  vec2 direction = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float reduce = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
  float inverse = 1.0 / (min(abs(direction.x), abs(direction.y)) + reduce);
  direction = clamp(direction * inverse, vec2(-6.0), vec2(6.0)) * cameraTexel;
  vec3 a = 0.5 * (texture2D(image, uv + direction * (-1.0 / 6.0)).rgb + texture2D(image, uv + direction * (1.0 / 6.0)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(image, uv - direction * 0.5).rgb + texture2D(image, uv + direction * 0.5).rgb);
  float lb = dot(b, weights);
  return vec4(lb < low || lb > high ? a : b, center.a);
}
`;

/** Two GPU displays share one throttled auxiliary world-pass budget. Neither
 * camera changes the tracked view, vehicle motion, pallet or fork geometry. */
export default class VehicleForkCamera {
  constructor(driving, options = {}) {
    this.driving = driving; this.ctx = driving.ctx; this.options = options; this.renderer = this.ctx.renderer;
    this.enabled = true; this.available = false; this.elapsed = Infinity; this.side = -1; this.mode = 'isometric'; this.selectedFeed = 'front'; this.mounted = false; this.lost = false; this.failed = false; this.nextFeed = 0;
    this.viewport = new THREE.Vector4(); this.scissor = new THREE.Vector4(); this.rendered = new Set();
    this.visibilityProbe = new THREE.PerspectiveCamera();
    this.stats = {status: 'inactive', frames: 0, frontFrames: 0, mirrorFrames: 0, failures: 0, allocations: 0, width: 0, height: 0, mirrorWidth: 0, mirrorHeight: 0, maxFPS: 0, antialias: 'fxaa', samples: 0, estimatedGpuBytes: 0, gpuBudgetBytes: 0, lastRenderMs: 0};
    // Inspection cameras use metric orthographic projection. A perspective
    // lens a few millimetres behind a pallet had to open past 140 degrees;
    // changing insertion depth then produced the reported exploding image.
    this.entryCamera = new THREE.OrthographicCamera(-1, 1, 1 / ASPECT, -1 / ASPECT, .02, 40); this.entryCamera.name = 'Inspección frontal ortográfica · entradas de pallet';
    this.tipCamera = new THREE.OrthographicCamera(-1, 1, 1 / ASPECT, -1 / ASPECT, .02, 40); this.tipCamera.name = 'Inspección ortográfica de salida de puntas';
    this.isometricCamera = new THREE.OrthographicCamera(-1, 1, 1 / ASPECT, -1 / ASPECT, .02, 40); this.isometricCamera.name = 'Cámara isométrica lateral de horquillas y pallet'; this.camera = this.isometricCamera;
    this.mirrorCamera = new THREE.PerspectiveCamera(66, ASPECT, .05, 70); this.mirrorCamera.name = 'Retrovisor · cámara posterior del vehículo';
    this.onLost = () => { this.lost = true; this.release('context-lost'); };
    this.onRestored = () => { this.lost = this.failed = false; this.elapsed = Infinity; };
    const canvas = this.renderer && this.renderer.domElement;
    if (canvas && canvas.addEventListener) { canvas.addEventListener('webglcontextlost', this.onLost); canvas.addEventListener('webglcontextrestored', this.onRestored); }
  }
  displayMaterial(options = {}) {
    const material = new THREE.MeshBasicMaterial(Object.assign({color: 0xffffff, toneMapped: false}, options));
    const filter = {texel: {value: new THREE.Vector2(1, 1)}, enabled: {value: 1}};
    material.userData.vehicleCameraFilter = filter;
    material.onBeforeCompile = shader => {
      shader.uniforms.cameraTexel = filter.texel; shader.uniforms.cameraFxaaEnabled = filter.enabled;
      shader.fragmentShader = CAMERA_FXAA + shader.fragmentShader.replace('#include <map_fragment>',
        '#ifdef USE_MAP\nvec4 texelColor = cameraFxaa(map, vUv);\ntexelColor = mapTexelToLinear(texelColor);\ndiffuseColor *= texelColor;\n#endif');
    };
    return material;
  }
  displayTexture(material, target) {
    material.map = target.texture;
    const filter = material.userData.vehicleCameraFilter;
    if (filter) filter.enabled.value = target.isWebGLMultisampleRenderTarget ? 0 : 1;
    this.displaySampling(material, target, target.width, target.height);
    material.needsUpdate = true;
  }
  displaySampling(material, target, width, height) {
    const filter = material.userData.vehicleCameraFilter;
    if (!filter) return;
    // A high-resolution source may be composed into the adaptive desktop
    // buffer. Filter at least one destination pixel, not a subpixel of that
    // reduced buffer. The XR plane retains its original source sampling.
    filter.texel.value.set(Math.max(1 / target.width, 1 / Math.max(1, Math.floor(width))), Math.max(1 / target.height, 1 / Math.max(1, Math.floor(height))));
  }
  makePlane(name, layout, fallback) {
    const setting = Object.assign({}, fallback, layout), plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(setting.width, setting.height), this.displayMaterial());
    plane.name = name; plane.position.fromArray(setting.position); plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), plane.position, UP));
    plane.userData.editorRuntimeHelper = true; plane.visible = false; if (this.mountOptions.parent) this.mountOptions.parent.add(plane); return plane;
  }
  mount(options = {}) {
    this.unmount(); this.mountOptions = options; this.element = options.element; this.mirrorElement = options.mirrorElement; this.mounted = true; this.enabled = true; this.available = true; this.failed = false; this.mode = 'isometric'; this.selectedFeed = 'front'; this.nextFeed = 0;
    const layout = options.planeLayout || {};
    this.plane = this.makePlane('Inspección de horquillas · imagen real', layout.front, {position: [.84, .08, 1.10], width: .68, height: .3825});
    // The rear image alternates in this same display, including in XR. There
    // is no second picture-in-picture surface over the working camera.
    this.mirrorPlane = null;
    // Informational displays never capture the steering/lever trigger or grip.
    this.state = this.stateName = null; this.elapsed = Infinity;
  }
  setEnabled(value) { this.enabled = !!value; this.failed = false; this.elapsed = Infinity; if (!this.enabled) this.release('disabled'); return this.enabled; }
  setAvailable(value) { this.available = !!value; if (!this.available) this.release('inactive'); }
  switchSide() { this.side *= -1; this.elapsed = Infinity; this.nextFeed = 0; return this.side; }
  setMode(value) { if (!['isometric', 'entry', 'tips'].includes(value)) return false; this.setRearView(false); this.mode = value; this.elapsed = Infinity; this.nextFeed = 0; return true; }
  toggleMode() { const modes = ['isometric', 'entry', 'tips']; this.setMode(modes[(modes.indexOf(this.mode) + 1) % modes.length]); return this.mode; }
  setRearView(value) { const next = value ? 'mirror' : 'front'; if (next !== this.selectedFeed) {this.release('switching-view'); this.selectedFeed = next;} this.elapsed = Infinity; return this.selectedFeed === 'mirror'; }
  toggleRearView() { return this.setRearView(this.selectedFeed !== 'mirror'); }
  getStats() { return Object.assign({}, this.stats, {enabled: this.enabled, targetAllocated: !!this.target, mirrorTargetAllocated: !!this.mirrorTarget, totalFrames: this.stats.frames, mounted: this.mounted, side: this.side, mode: this.mode, selectedFeed: this.selectedFeed}); }
  profile() {
    const graphics = this.ctx.graphics, limits = graphics && graphics.getLimits && graphics.getLimits(), tier = limits && limits.tier;
    const economy = tier === 'economy', high = tier === 'high' || tier === 'ultra', xr = !!this.ctx.vrMode;
    const capability = this.renderer && this.renderer.capabilities || {}, maxTexture = finite(capability.maxTextureSize) ? capability.maxTextureSize : 4096;
    const maxSamples = finite(capability.maxSamples) ? Math.floor(capability.maxSamples) : 4;
    let samples = capability.isWebGL2 && THREE.WebGLMultisampleRenderTarget && maxSamples >= 2 ? !xr && !economy && maxSamples >= 4 ? 4 : 2 : 0;
    const ratio = this.renderer && this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : 1;
    const deviceRatio = typeof window !== 'undefined' && finite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
    const dpr = Math.min(2, Math.max(1, finite(ratio) ? ratio : 1, deviceRatio));
    const minimum = xr ? economy ? 512 : high ? 768 : 640 : economy ? 512 : high ? 960 : 768;
    const maximum = xr ? 768 : economy ? 768 : high ? 1280 : 1024;
    const fitted = (element, low, high) => {
      const rectangle = !xr && this.desktopRect(element), desired = rectangle ? rectangle.rect.width * dpr * 1.2 : low;
      return Math.max(16, Math.floor(Math.min(maxTexture, high, Math.max(low, Math.ceil(desired / 64) * 64)) / 16) * 16);
    };
    const profile = {width: fitted(this.element, minimum, maximum), fps: economy ? 8 : high ? 15 : 12, pixelRatio: dpr, gpuBudgetBytes: (xr ? 12 : 32) * 1024 * 1024};
    profile.mirrorWidth = profile.width;
    if (xr) profile.fps = Math.min(10, profile.fps);
    const bytes = () => profile.width * profile.width / ASPECT * 8 * (samples + 1);
    // Resolved color/depth plus multisample attachments count towards the same
    // budget. Prefer fewer samples/FPS over the previous unreadable 256px feed.
    if (bytes() > profile.gpuBudgetBytes && samples > 2) samples = 2;
    while (bytes() > profile.gpuBudgetBytes && profile.width > 256) {profile.width -= 64; profile.mirrorWidth = profile.width;}
    profile.height = profile.width / ASPECT; profile.mirrorHeight = profile.mirrorWidth / ASPECT;
    profile.samples = samples; profile.antialias = samples ? 'msaa' : 'fxaa'; return profile;
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
  visibleFeeds() { return (this.ctx.vrMode ? this.screenVisible(this.plane) : !!this.desktopRect(this.element)) ? [this.selectedFeed] : []; }
  resources(profile, name = 'front') {
    if (this.stats.width && (this.stats.width !== profile.width || this.stats.height !== profile.height || this.stats.mirrorWidth !== profile.mirrorWidth || this.stats.mirrorHeight !== profile.mirrorHeight || this.stats.samples !== profile.samples)) this.release('allocating');
    const key = name === 'front' ? 'target' : 'mirrorTarget'; if (this[key]) return;
    const width = name === 'front' ? profile.width : profile.mirrorWidth, height = name === 'front' ? profile.height : profile.mirrorHeight;
    const Target = profile.samples ? THREE.WebGLMultisampleRenderTarget : THREE.WebGLRenderTarget;
    const target = this[key] = new Target(width, height, {minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false, generateMipmaps: false});
    if (profile.samples) target.samples = profile.samples;
    target.texture.name = name === 'front' ? 'Inspección de horquillas · GPU' : 'Retrovisor posterior reflejado · GPU'; target.texture.generateMipmaps = false; target.texture.encoding = THREE.LinearEncoding;
    if (name === 'mirror') { target.texture.repeat.x = -1; target.texture.offset.x = 1; target.texture.updateMatrix(); }
    const targets = this.ctx.performanceRenderTargets || (this.ctx.performanceRenderTargets = new Set()); if (targets.add) targets.add(target); else if (Array.isArray(targets) && !targets.includes(target)) targets.push(target);
    if (this.plane) this.displayTexture(this.plane.material, target);
    const sceneKey = name === 'front' ? 'overlayScene' : 'mirrorOverlayScene', overlayKey = name === 'front' ? 'overlay' : 'mirrorOverlay';
    if (!this[sceneKey]) { this[sceneKey] = new THREE.Scene(); this[overlayKey] = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), this.displayMaterial({depthTest: false, depthWrite: false, fog: false})); this[overlayKey].frustumCulled = false; this[sceneKey].add(this[overlayKey]); }
    this.displayTexture(this[overlayKey].material, target);
    if (!this.overlayCamera) this.overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.stats.width = profile.width; this.stats.height = profile.height; this.stats.mirrorWidth = profile.mirrorWidth; this.stats.mirrorHeight = profile.mirrorHeight; this.stats.maxFPS = profile.fps;
    this.stats.antialias = profile.antialias; this.stats.samples = profile.samples; this.stats.pixelRatio = profile.pixelRatio; this.stats.gpuBudgetBytes = profile.gpuBudgetBytes;
    this.stats.estimatedGpuBytes = [this.target, this.mirrorTarget].filter(Boolean).reduce((sum, value) => sum + value.width * value.height * 8 * (value.isWebGLMultisampleRenderTarget ? value.samples + 1 : 1), 0); this.stats.allocations++;
  }
  product(record, snapshot) {
    const vehicle = record.components.vehicle; if (vehicle.entry && vehicle.entry.product) return vehicle.entry.product; if (snapshot === this.lastSnapshot) return this.lastProduct;
    this.lastSnapshot = snapshot; this.lastProduct = null; const outline = snapshot && snapshot.geometry && snapshot.geometry.target; if (!Array.isArray(outline) || outline.length !== 4) return null;
    const center = outline.reduce((point, value) => point.add(new THREE.Vector3().fromArray(value)), new THREE.Vector3()).multiplyScalar(.25); let distance = .06;
    if (this.driving.simulation.products) this.driving.simulation.products.forEach(product => { if (!shown(product.object)) return; product.object.updateWorldMatrix(true, false); const bottom = product.bounds.getCenter(new THREE.Vector3()); bottom.y = product.bounds.min.y; bottom.applyMatrix4(product.object.matrixWorld); const next = bottom.distanceTo(center); if (next < distance) { distance = next; this.lastProduct = product; } }); return this.lastProduct;
  }
  workArea(config) {
    const span = Math.max(.65, config.forkSpread / 2 + config.forkWidth / 2 + .17), points = [];
    // This is the insertion work envelope, not the entire truck or a distant
    // load's bounding box. Its metric scale stays fixed while the truck moves.
    for (const x of [-span, span]) for (const y of [-Math.max(.07, config.forkThickness + .025), .29]) for (const z of [.025, config.forkLength + .28]) points.push(new THREE.Vector3(x, y, z));
    return points;
  }
  fit(camera, visible) {
    const box = new THREE.Box3().setFromPoints(visible.map(point => point.clone().applyMatrix4(camera.matrixWorldInverse))), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const height = Math.max(.45, size.y, size.x / ASPECT) * 1.12, width = height * ASPECT;
    camera.left = center.x - width / 2; camera.right = center.x + width / 2; camera.top = center.y + height / 2; camera.bottom = center.y - height / 2;
    // Start the frontal section at the working envelope. The cab/mast behind
    // it cannot occupy the image, including with an opaque hologram disabled.
    camera.near = Math.max(.02, -box.max.z - .03); camera.far = Math.max(camera.near + 12, -box.min.z + 12);
    camera.updateProjectionMatrix(); return height;
  }
  frameIsometric(record, forks, product, load) {
    const config = record.components.vehicle.config, center = new THREE.Vector3(0, .04, config.forkLength * .52), distance = Math.max(1.5, config.forkLength + .6, config.forkSpread + .6);
    const eyeLocal = center.clone().add(new THREE.Vector3(this.side * distance, distance, -distance)), aimLocal = center;
    const camera = this.camera = this.isometricCamera, eye = eyeLocal.clone().applyMatrix4(forks.matrixWorld), aim = aimLocal.clone().applyMatrix4(forks.matrixWorld);
    camera.position.copy(eye); camera.up.copy(UP).transformDirection(forks.matrixWorld); camera.lookAt(aim); camera.updateMatrixWorld(true);
    const visible = this.workArea(config).map(point => point.applyMatrix4(forks.matrixWorld)), height = this.fit(camera, visible);
    this.framing = {eye, aim, eyeLocal, aimLocal, product, forks, localLoad: load, visible, height, mode: this.mode, side: this.side, direction: 'oblique'}; return this.framing;
  }
  frame(snapshot) {
    const record = this.driving.record(), config = record.components.vehicle.config, forks = this.driving.visualRoot.userData.vehicleRig.forks; forks.updateWorldMatrix(true, false);
    const inverse = new THREE.Matrix4().getInverse(forks.matrixWorld), product = this.product(record, snapshot); if (product) product.object.updateWorldMatrix(true, false);
    const load = product ? product.bounds.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, product.object.matrixWorld)) : null;
    if (this.mode === 'isometric') return this.frameIsometric(record, forks, product, load);
    const entry = this.mode === 'entry', eyeLocal = new THREE.Vector3(0, entry ? .07 : -config.forkThickness * .25,
      entry ? -1.35 : Math.max(config.forkLength, load ? load.max.z : 0) + 1.1);
    const aimLocal = new THREE.Vector3(0, entry ? .005 : eyeLocal.y, config.forkLength * .52);
    this.camera = entry ? this.entryCamera : this.tipCamera;
    const eye = eyeLocal.clone().applyMatrix4(forks.matrixWorld), aim = aimLocal.clone().applyMatrix4(forks.matrixWorld);
    this.camera.position.copy(eye); this.camera.up.copy(UP).transformDirection(forks.matrixWorld); this.camera.lookAt(aim); this.camera.updateMatrixWorld(true);
    const visible = this.workArea(config).map(point => point.applyMatrix4(forks.matrixWorld)), height = this.fit(this.camera, visible);
    this.framing = {eye, aim, eyeLocal, aimLocal, product, forks, localLoad: load, visible, height, mode: this.mode, direction: entry ? 'forward' : 'rearward'}; return this.framing;
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
    const ray = this.ctx.raycontrol, values = [this.plane, this.mirrorPlane, this.ctx.cameraRig, ray && ray.raycasterContext, this.driving.worldPanel && this.driving.worldPanel.plane, this.driving.docking && this.driving.docking.plane, this.driving.holographicGuide && this.driving.holographicGuide.label]; if (this.mountOptions.hiddenObjects) values.push(...this.mountOptions.hiddenObjects());
    const seen = new Set(); this.hidden = []; for (const node of values) if (node && !seen.has(node)) { seen.add(node); this.hidden.push([node, node.visible]); node.visible = false; }
  }
  syncScreenVisibility() {
    const active = !!this.ctx.vrMode && this.active();
    if (this.plane) this.plane.visible = !!(active && (this.selectedFeed === 'mirror' ? this.mirrorTarget : this.target));
    if (this.mirrorPlane) this.mirrorPlane.visible = false;
  }
  renderBefore(scene, delta = 0) {
    if (!this.active()) { this.release(this.failed ? 'unavailable' : this.enabled ? 'inactive' : 'disabled'); return false; }
    [this.plane, this.mirrorPlane].filter(Boolean).forEach(plane => { plane.visible = !!this.ctx.vrMode; }); const profile = this.profile(); this.elapsed += Math.max(0, finite(delta) ? delta : 0);
    // Visibility probes need both candidate surfaces even before their first
    // image exists. Restore display visibility before every early return so a
    // 90 Hz headset never draws the uninitialized white mirror between passes.
    const visible = this.visibleFeeds(); this.syncScreenVisibility(); if (!visible.length) { this.stats.status = 'hidden'; return false; } if (this.rendered.size && this.elapsed < 1 / profile.fps) return false;
    const renderer = this.renderer, gl = renderer.getContext && renderer.getContext(); if (gl && gl.isContextLost && gl.isContextLost()) { this.release('context-lost'); return false; }
    const name = visible[0];
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
    const feeds = [this.selectedFeed === 'mirror' ? {element: this.element, target: this.mirrorTarget, scene: this.mirrorOverlayScene, overlay: this.mirrorOverlay} : {element: this.element, target: this.target, scene: this.overlayScene, overlay: this.overlay}].filter(feed => feed.target && feed.scene && this.desktopRect(feed.element)); if (!feeds.length) return false;
    const renderer = this.renderer, canvas = renderer.domElement, dpr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1, saved = this.saveState();
    try {
      if (renderer.xr) renderer.xr.enabled = false; renderer.setRenderTarget(null); renderer.autoClear = false; if (renderer.info) renderer.info.autoReset = false; if (renderer.shadowMap) { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; }
      feeds.forEach(feed => { const {rect, canvasRect, left, right, top, bottom} = this.desktopRect(feed.element), scaleX = canvas.width / dpr / canvasRect.width, scaleY = canvas.height / dpr / canvasRect.height;
        this.displaySampling(feed.overlay.material, feed.target, rect.width * canvas.width / canvasRect.width, rect.height * canvas.height / canvasRect.height);
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
