import * as THREE from 'three';
import schema from '../../shared/studio-document.js';

const SHADOW_ACTORS = new Set(['conveyor', 'source', 'processor', 'palletQueue']);
const RECOVERED_RENDERERS = new WeakSet();

const vertexShader = `
  varying vec3 skyDirection;
  void main() {
    skyDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w;
  }
`;
const fragmentShader = `
  varying vec3 skyDirection;
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 groundColor;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  void main() {
    vec3 direction = normalize(skyDirection);
    vec3 color = mix(groundColor, horizonColor, smoothstep(-0.35, 0.025, direction.y));
    color = mix(color, topColor, smoothstep(0.0, 0.85, direction.y));
    float sun = max(0.0, dot(direction, sunDirection));
    color += sunColor * (pow(sun, 128.0) * 0.10 + smoothstep(0.9993, 0.99975, sun) * 0.7);
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** Active-level sky, cached reflection lighting and one bounded shadow map.
 * All rendering resources remain derived from the authored environment. */
export default class SceneEnvironment {
  constructor(editor) {
    this.editor = editor; this.scene = null; this.original = null; this.sky = null; this.signature = null; this.configCache = null;
    this.shadowMeshes = new Map(); this.meshVersion = null; this.reflections = null; this.reflectionRenderer = null;
    this.focus = new THREE.Vector3(); this.direction = new THREE.Vector3(); this.shadowTarget = null;
    this.shadowScale = new THREE.Vector3();
    this.shadowBounds = new THREE.Box3();
    this.shadowActors = []; this.shadowAnchor = new THREE.Vector3(); this.actorFocus = new THREE.Vector3();
    this.contextRenderer = null; this.contextCanvas = null; this.contextLost = false; this.recoveryShadowsDisabled = false;
    this.stats = {profile: 'native', shadowMaps: 0, shadowMapSize: 0, shadowFocus: 'native', reflectionBuilds: 0, contextLost: false, contextRestores: 0, recoveryShadowFallback: false};
    this.onContextLost = event => {
      if (event && event.preventDefault) event.preventDefault();
      if (this.contextLost) return;
      this.contextLost = this.stats.contextLost = true;
      // Release while r112 still owns the old WebGLProperties/listeners. Once
      // its restore handler replaces those caches, an RT's CPU object remains
      // valid but its rendered pixels cannot be recovered by texture upload.
      this.releaseRenderTargets();
      const performance = this.editor.performance;
      if (performance && performance.releaseContextTextureHandles) performance.releaseContextTextureHandles();
    };
    this.onContextRestored = () => {
      if (!this.contextLost) return;
      this.contextLost = this.stats.contextLost = false; this.stats.contextRestores++;
      // r112's shadow renderer closes over WebGLObjects from the lost context.
      // A warmup is insufficient when a room switch renders before entity sync.
      // Keep this recovered renderer usable with a derived session fallback;
      // fresh renderer instances retain the author's normal shadow settings.
      if (this.contextRenderer) RECOVERED_RENDERERS.add(this.contextRenderer);
      this.recoveryShadowsDisabled = this.stats.recoveryShadowFallback = true;
      this.signature = null; this.meshVersion = null;
      const renderer = this.contextRenderer;
      if (renderer && renderer.shadowMap) { renderer.shadowMap.enabled = false; renderer.shadowMap.needsUpdate = true; }
      const performance = this.editor.performance;
      if (performance && performance.restoreContextTextureHandles) performance.restoreContextTextureHandles();
      // Rebuild derived lighting on the next active sync, after Three's own
      // restore handler has initialized its new context. No work in the event.
    };
  }

  watchRenderer(renderer) {
    if (renderer === this.contextRenderer) return;
    if (this.contextCanvas && this.contextCanvas.removeEventListener) {
      this.contextCanvas.removeEventListener('webglcontextlost', this.onContextLost);
      this.contextCanvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    }
    this.contextRenderer = renderer; this.contextCanvas = renderer && renderer.domElement;
    this.contextLost = this.stats.contextLost = false;
    this.recoveryShadowsDisabled = this.stats.recoveryShadowFallback = RECOVERED_RENDERERS.has(renderer);
    if (this.contextCanvas && this.contextCanvas.addEventListener) {
      this.contextCanvas.addEventListener('webglcontextlost', this.onContextLost);
      this.contextCanvas.addEventListener('webglcontextrestored', this.onContextRestored);
    }
  }

  releaseRenderTargets() {
    if (this.reflections) {
      if (this.scene && this.scene.environment === this.reflections.texture) this.scene.environment = this.original && this.original.environment || null;
      this.reflections.dispose(); this.reflections = null;
    }
    this.reflectionRenderer = null;
    if (this.original) this.original.lights.forEach(entry => {
      const shadow = entry.object.shadow;
      if (!shadow || shadow === entry.shadow) return;
      for (const field of ['map', 'mapPass']) if (shadow[field]) { shadow[field].dispose(); shadow[field] = null; }
    });
  }

  getConfig() {
    const editor = this.editor, document = editor.document;
    const key = [document, editor.roomId, document.studio, editor.changeVersion, document.loadGeneration, document.undoStack && document.undoStack.length,
      document.additions && document.additions.size, document.overrides && document.overrides.size];
    if (!this.configCache || key.some((value, index) => value !== this.configCache.key[index])) this.configCache = {key, value: schema.environmentFor(document, editor.roomId)};
    return this.configCache.value;
  }

  capture(scene) {
    const lights = ['sun', 'fillLight'].map(name => scene.children.find(object => object.isLight && object.name === name)).filter(Boolean);
    this.scene = scene;
    const renderer = this.editor.ctx && this.editor.ctx.renderer;
    this.watchRenderer(renderer);
    this.original = {background: scene.background, environment: scene.environment, lights: lights.map(object => ({object, color: object.color.clone(), intensity: object.intensity,
      position: object.position.clone(), target: object.target, castShadow: object.castShadow, shadow: object.shadow})), renderer: renderer && {
      object: renderer, toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure,
      shadows: renderer.shadowMap && renderer.shadowMap.enabled, shadowType: renderer.shadowMap && renderer.shadowMap.type}};
  }

  restore() {
    if (!this.scene || !this.original) return;
    this.scene.background = this.original.background;
    this.scene.environment = this.original.environment;
    this.original.lights.forEach(entry => {
      entry.object.color.copy(entry.color); entry.object.intensity = entry.intensity;
      entry.object.position.copy(entry.position); entry.object.target = entry.target; entry.object.castShadow = entry.castShadow;
      if (entry.object.shadow !== entry.shadow) {
        if (entry.object.shadow && entry.object.shadow.map) entry.object.shadow.map.dispose();
        if (entry.object.shadow && entry.object.shadow.mapPass) entry.object.shadow.mapPass.dispose();
        entry.object.shadow = entry.shadow;
      }
    });
    if (this.original.renderer) {
      const saved = this.original.renderer, renderer = saved.object;
      renderer.toneMapping = saved.toneMapping; renderer.toneMappingExposure = saved.exposure;
      if (renderer.shadowMap) { renderer.shadowMap.enabled = this.recoveryShadowsDisabled ? false : saved.shadows; renderer.shadowMap.type = saved.shadowType; }
    }
    this.shadowMeshes.forEach((saved, mesh) => { mesh.castShadow = saved.cast; mesh.receiveShadow = saved.receive; }); this.shadowMeshes.clear();
    this.meshVersion = null;
    this.shadowActors.length = 0;
    if (this.shadowTarget && this.shadowTarget.parent) this.shadowTarget.parent.remove(this.shadowTarget);
    this.stats.profile = 'native'; this.stats.shadowMaps = this.stats.shadowMapSize = 0;
    this.stats.effectiveTier = 'native';
    this.stats.shadowFocus = 'native';
    if (this.sky && this.sky.parent) this.sky.parent.remove(this.sky);
    this.signature = null;
  }

  // A single reusable, prefiltered lighting texture supplies the long ceiling
  // reflections that let brushed metal read as metal. It is rendered once,
  // never captures the production scene and has no per-frame cube cameras.
  createReflections(renderer) {
    this.watchRenderer(renderer);
    if (this.contextLost) return null;
    if (this.reflections && this.reflectionRenderer === renderer) return this.reflections.texture;
    // r112 predates WebGLRenderer.isWebGLRenderer; inspect its public WebGL
    // capabilities instead so the real renderer enters this path as well.
    if (typeof renderer.getContext !== 'function' || !renderer.capabilities || !THREE.PMREMGenerator) return null;
    if (this.reflections) this.reflections.dispose();
    const room = new THREE.Scene(), geometry = new THREE.BoxBufferGeometry(), resources = [];
    const box = (color, position, scale, inside) => {
      const material = new THREE.MeshBasicMaterial({color, side: inside ? THREE.BackSide : THREE.FrontSide}); material.color.convertSRGBToLinear(); resources.push(material);
      const mesh = new THREE.Mesh(geometry, material); mesh.position.fromArray(position); mesh.scale.fromArray(scale); room.add(mesh); return material;
    };
    box('#414743', [0, 2, 0], [20, 12, 24], true);
    box('#272d29', [0, -3.85, 0], [19.8, .1, 23.8]);
    for (const x of [-5, 0, 5]) for (const z of [-7, 5]) box('#fff4e2', [x, 7.6, z], [2.4, .12, 6]).color.multiplyScalar(1.6);
    box('#9aa8b0', [-9.8, 3, 0], [.12, 3.2, 17]).color.multiplyScalar(.85);
    const previous = {target: renderer.getRenderTarget(), xr: renderer.xr && renderer.xr.enabled,
      viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()), scissorTest: renderer.getScissorTest()};
    const generator = new THREE.PMREMGenerator(renderer);
    try {
      if (renderer.xr) renderer.xr.enabled = false;
      this.reflections = generator.fromScene(room, .035, .1, 60); this.reflectionRenderer = renderer; this.stats.reflectionBuilds++;
    } finally {
      renderer.setRenderTarget(previous.target); renderer.setViewport(previous.viewport); renderer.setScissor(previous.scissor); renderer.setScissorTest(previous.scissorTest);
      if (renderer.xr) renderer.xr.enabled = previous.xr;
      generator.dispose(); geometry.dispose(); resources.forEach(material => material.dispose());
    }
    return this.reflections && this.reflections.texture;
  }

  syncRender(config) {
    const editor = this.editor, renderer = editor.ctx && editor.ctx.renderer;
    if (!renderer || !config || this.contextLost) return;
    const profile = ['performance', 'balanced', 'high'].includes(config.renderQuality) ? config.renderQuality : 'balanced';
    const xr = !!(editor.ctx.vrMode || renderer.xr && renderer.xr.isPresenting);
    const graphics = editor.ctx.graphics, limits = graphics && graphics.getLimits ? graphics.getLimits() : null;
    this.stats.profile = profile + (xr ? '-xr' : '');
    this.stats.effectiveTier = limits && limits.tier || profile;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = config.exposure === undefined ? 1 : config.exposure;
    if (!this.original.environment) this.scene.environment = this.createReflections(renderer);
    const sun = this.original.lights.find(entry => entry.object.name === 'sun');
    const enabled = !this.recoveryShadowsDisabled && profile !== 'performance' && config.shadows === true && !!sun && !!renderer.shadowMap;
    if (renderer.shadowMap) { renderer.shadowMap.enabled = enabled; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
    if (!sun) return;
    const light = sun.object; light.castShadow = enabled;
    if (!enabled) {
      if (light.shadow !== sun.shadow && light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
      this.stats.shadowMaps = this.stats.shadowMapSize = 0; this.stats.shadowFocus = this.recoveryShadowsDisabled ? 'context-recovery-fallback' : 'disabled'; return;
    }
    if (light.shadow === sun.shadow) light.shadow = sun.shadow.clone();
    const authoredSize = profile === 'high' && !xr ? 2048 : 1024;
    const mapLimit = limits && (xr ? limits.xrShadowMapSize : limits.shadowMapSize);
    const size = Math.min(authoredSize, Number.isFinite(mapLimit) && mapLimit > 0 ? mapLimit : authoredSize);
    const authoredRadius = xr ? 11 : profile === 'high' ? 13 : 15;
    const radiusLimit = limits && (xr ? limits.xrShadowRadius : limits.shadowRadius);
    const radius = Math.min(authoredRadius, Number.isFinite(radiusLimit) && radiusLimit > 0 ? radiusLimit : authoredRadius);
    const root = editor.document.getRoot && editor.document.getRoot(editor.roomId);
    const version = [root, editor.changeVersion, editor.document.loadGeneration, editor.document.additions && editor.document.additions.size,
      editor.document.objects && editor.document.objects.size, root && root.children.length];
    const changed = !this.meshVersion || version.some((value, index) => value !== this.meshVersion[index]);
    if (changed) this.shadowActors = editor.document.getObjects ? editor.document.getObjects(editor.roomId).filter(object => SHADOW_ACTORS.has((object.userData || {}).editorPrefabKey)) : [];
    const shadow = light.shadow, camera = shadow.camera;
    if (shadow.mapSize.x !== size) { if (shadow.map) { shadow.map.dispose(); shadow.map = null; } shadow.mapSize.set(size, size); }
    camera.left = camera.bottom = -radius; camera.right = camera.top = radius; camera.near = .1; camera.far = 55; camera.updateProjectionMatrix();
    shadow.bias = -.00025; shadow.radius = 2;
    if (!this.shadowTarget) { this.shadowTarget = new THREE.Object3D(); this.shadowTarget.name = 'Studio · objetivo de sombras'; this.shadowTarget.userData.editorRuntimeHelper = true; }
    if (!this.shadowTarget.parent) this.scene.add(this.shadowTarget);
    light.target = this.shadowTarget;
    let view = editor.active && !xr && editor.camera || editor.ctx.camera;
    if (xr && view && renderer.xr && renderer.xr.getCamera) view = renderer.xr.getCamera(view) || view;
    if (view && view.getWorldPosition) {
      if (xr) { this.focus.setFromMatrixPosition(view.matrixWorld); this.direction.set(0, 0, -1).transformDirection(view.matrixWorld); }
      else { view.getWorldPosition(this.focus); view.getWorldDirection(this.direction); }
      // From a warehouse entrance, a camera-centred map often covers only
      // empty floor while the actual equipment is 25–40 m ahead. Keep the same
      // local map and move its coverage onto the visible equipment instead.
      let nearest = Infinity, distanceToActor = 0;
      this.shadowActors.forEach(object => {
        for (let node = object; node; node = node.parent) if (!node.visible) return;
        this.shadowAnchor.setFromMatrixPosition(object.matrixWorld);
        const dx = this.shadowAnchor.x - this.focus.x, dy = this.shadowAnchor.y - this.focus.y, dz = this.shadowAnchor.z - this.focus.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance < .1 || distance > 60) return;
        const alignment = (dx * this.direction.x + dy * this.direction.y + dz * this.direction.z) / distance;
        if (alignment < .65) return;
        const score = distance + (1 - alignment) * 15;
        if (score < nearest) { nearest = score; distanceToActor = distance; this.actorFocus.copy(this.shadowAnchor); }
      });
      this.focus.addScaledVector(this.direction, 5);
      this.stats.shadowFocus = 'view';
      if (distanceToActor > radius * .75) { this.focus.copy(this.actorFocus); this.stats.shadowFocus = 'equipment'; }
    } else this.focus.set(0, 0, 0);
    const texel = radius * 2 / size;
    this.focus.x = Math.round(this.focus.x / texel) * texel; this.focus.z = Math.round(this.focus.z / texel) * texel; this.focus.y = 0;
    this.shadowTarget.position.copy(this.focus); light.position.copy(this.focus).add(this.direction.set(7, 16, 5));
    this.shadowTarget.updateMatrixWorld(true); light.updateMatrixWorld(true);
    this.stats.shadowMaps = 1; this.stats.shadowMapSize = size;
    if (!changed) return;
    this.meshVersion = version;
    if (root) root.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry) return;
      for (let node = mesh; node; node = node.parent) if ((node.userData || {}).editorHelper || (node.userData || {}).editorRuntimeHelper || (node.userData || {}).editorDecal) return;
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);
      if (!materials.length || materials.every(material => material.isShaderMaterial || material.transparent && material.opacity < .85)) return;
      if (!this.shadowMeshes.has(mesh)) this.shadowMeshes.set(mesh, {cast: mesh.castShadow, receive: mesh.receiveShadow});
      mesh.receiveShadow = true;
      // The warehouse's ceiling is above the virtual interior key. Excluding
      // its shell from casting keeps that one bounded key inside the building.
      let shell = false;
      for (let node = mesh; node && node !== root; node = node.parent) if (/CEDI.*(?:cubierta|muro|piso|ventana|franja|cerramiento|luminaria)/i.test(node.name || '')) { shell = true; break; }
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      mesh.getWorldScale(this.shadowScale);
      const radius = mesh.geometry.boundingSphere ? mesh.geometry.boundingSphere.radius * Math.max(Math.abs(this.shadowScale.x), Math.abs(this.shadowScale.y), Math.abs(this.shadowScale.z)) : 1;
      const groundSurface = mesh.geometry.boundingBox && this.shadowBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld).max.y <= .08;
      mesh.castShadow = !mesh.userData.industrialFloorMarking && !shell && !groundSurface && radius >= .055;
    });
  }

  createSky() {
    if (this.sky) return this.sky;
    const material = new THREE.ShaderMaterial({
      uniforms: {topColor: {value: new THREE.Color()}, horizonColor: {value: new THREE.Color()}, groundColor: {value: new THREE.Color()}, sunColor: {value: new THREE.Color()}, sunDirection: {value: new THREE.Vector3(.2, 1, .1).normalize()}},
      vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
    });
    const sky = new THREE.Mesh(new THREE.SphereBufferGeometry(1, 24, 16), material);
    sky.name = 'Studio · cielo del nivel'; sky.userData.editorRuntimeHelper = true;
    sky.frustumCulled = false; sky.renderOrder = -1000000; sky.raycast = () => {};
    // The renderer supplies each actual camera here, including XR eyes and
    // authored camera previews. Move before the model-view matrix is computed.
    sky.onBeforeRender = (renderer, scene, camera) => { camera.getWorldPosition(sky.position); sky.updateMatrixWorld(true); };
    this.sky = sky; return sky;
  }

  sync() {
    const scene = this.editor.hooks && this.editor.hooks.renderScene;
    if (!scene) return;
    if (scene !== this.scene) { this.restore(); this.capture(scene); }
    this.watchRenderer(this.editor.ctx && this.editor.ctx.renderer);
    if (this.contextLost) return;
    const config = this.getConfig();
    const signature = config ? JSON.stringify(config) : '';
    if (signature === this.signature) { this.syncRender(config); return; }
    this.restore(); this.signature = signature;
    if (!config) return;
    const sun = this.original.lights.find(entry => entry.object.name === 'sun');
    const fill = this.original.lights.find(entry => entry.object.name === 'fillLight');
    if (sun) { sun.object.color.set(config.sunColor); sun.object.intensity = config.sunIntensity; }
    if (fill) { fill.object.color.set(config.horizonColor); fill.object.intensity = config.ambientIntensity; }
    this.syncRender(config);
    if (config.sky === 'native') return;
    scene.background = new THREE.Color(config.skyColor);
    if (config.sky !== 'day') return;
    const sky = this.createSky(), uniforms = sky.material.uniforms;
    uniforms.topColor.value.set(config.skyColor); uniforms.horizonColor.value.set(config.horizonColor);
    uniforms.groundColor.value.set(config.groundColor); uniforms.sunColor.value.set(config.sunColor);
    if (sun) uniforms.sunDirection.value.copy(sun.object.position).normalize();
    scene.add(sky);
  }

  dispose() {
    this.restore();
    if (this.sky) { this.sky.geometry.dispose(); this.sky.material.dispose(); this.sky = null; }
    if (this.reflections) { this.reflections.dispose(); this.reflections = null; }
    this.reflectionRenderer = null; this.shadowTarget = null;
    this.watchRenderer(null);
    this.scene = null; this.original = null; this.configCache = null;
  }
}
