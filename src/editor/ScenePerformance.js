import * as THREE from 'three';
import RuntimeResourceMemory from './RuntimeResourceMemory.js';
import CosmeticVisualLod from './CosmeticVisualLod.js';
import StaticArchitectureBatches from './StaticArchitectureBatches.js';

function resources() {
  return {geometries: new Set(), materials: new Set(), textures: new Set(), attributes: new Set(), objects: new Set(), renderTargets: new Set(), renderTargetTextures: new Set(), cpuArrays: new Set(), audioBuffers: new Set(), encodedStrings: new Set()};
}

function texturesIn(value, target, seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || seen.has(value) || depth > 5) return;
  if (value.isTexture) { target.add(value); return; }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
  seen.add(value);
  if (Array.isArray(value)) value.forEach(item => texturesIn(item, target, seen, depth + 1));
  else Object.keys(value).forEach(key => texturesIn(value[key], target, seen, depth + 1));
}

function attributesOf(geometry) {
  const attributes = Object.keys(geometry.attributes || {}).map(key => geometry.attributes[key]);
  if (geometry.index) attributes.push(geometry.index);
  Object.keys(geometry.morphAttributes || {}).forEach(key => attributes.push(...geometry.morphAttributes[key]));
  return attributes.map(attribute => attribute.isInterleavedBufferAttribute ? attribute.data : attribute);
}

function collectMaterial(value, target) {
  (Array.isArray(value) ? value : [value]).filter(material => material && material.isMaterial).forEach(material => {
    if (target.materials.has(material)) return; target.materials.add(material);
    // Uniform structures are visited only during the periodic resource scan.
    const seen = new Set(); Object.keys(material).forEach(key => texturesIn(material[key], target.textures, seen));
  });
}
function collectTarget(value, target) {
  if (!value || !value.isWebGLRenderTarget || target.renderTargets.has(value)) return;
  target.renderTargets.add(value);
  [value.texture, value.depthTexture].filter(Boolean).forEach(texture => { target.textures.add(texture); target.renderTargetTextures.add(texture); });
}
// Object identities only guard recursive collection. Memory/eviction operate on
// resources; merging tens of thousands of scene nodes into three temporary Sets
// every sample adds allocation and GC without changing either result.
function mergeResources(target, source) { Object.keys(target).filter(key => key !== 'objects').forEach(key => source[key].forEach(value => target[key].add(value))); }
const scanClock = () => typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'lightMap', 'alphaMap', 'bumpMap', 'displacementMap', 'envMap', 'gradientMap', 'uniforms', 'preparedConcreteUniforms', 'surfaceWearMap'];
function materialMaps(material) { return MAP_KEYS.map(key => material[key]).concat(material.preparedConcreteUniforms && material.preparedConcreteUniforms.preparedConcreteMap && material.preparedConcreteUniforms.preparedConcreteMap.value); }
function sameMaterialMaps(material, values) { for (let index = 0; index < MAP_KEYS.length; index++) if (material[MAP_KEYS[index]] !== values[index]) return false; return (material.preparedConcreteUniforms && material.preparedConcreteUniforms.preparedConcreteMap && material.preparedConcreteUniforms.preparedConcreteMap.value) === values[MAP_KEYS.length]; }

function collect(root, target, stopRoots, hiddenTarget) {
  if (!root || !root.isObject3D || (stopRoots && stopRoots.has(root)) || target.objects.has(root)) return;
  // Authored-hidden native museum meshes can live under an active industrial
  // room. They retain CPU/undo ownership, but are not GPU residents merely for
  // sharing that room ID. Do not use camera/frustum culling for this eviction.
  if (hiddenTarget && root.visible === false) { collect(root, hiddenTarget, stopRoots); return; }
  target.objects.add(root);
  if (root.instanceMatrix) target.attributes.add(root.instanceMatrix);
  if (root.geometry && !target.geometries.has(root.geometry)) {
    target.geometries.add(root.geometry);
    attributesOf(root.geometry).forEach(attribute => target.attributes.add(attribute));
  }
  collectMaterial(root.material, target);
  if (root.shadow) { collectTarget(root.shadow.map, target); collectTarget(root.shadow.mapPass, target); }
  if (root.skeleton) { if (root.skeleton.boneTexture) target.textures.add(root.skeleton.boneTexture); if (root.skeleton.boneMatrices) target.cpuArrays.add(root.skeleton.boneMatrices); }
  (root.animations || []).forEach(clip => (clip.tracks || []).forEach(track => { if (track.times) target.cpuArrays.add(track.times); if (track.values) target.cpuArrays.add(track.values); }));
  if (root.background && root.background.isTexture) target.textures.add(root.background);
  if (root.environment && root.environment.isTexture) target.textures.add(root.environment);
  root.children.forEach(child => collect(child, target, stopRoots, hiddenTarget));
}

function collectAsset(asset, target) {
  if (!asset) return;
  if (asset.isTexture) target.textures.add(asset);
  else if (asset.isObject3D || asset.scene && asset.scene.isObject3D) collect(asset.scene || asset, target);
  else if (ArrayBuffer.isView(asset)) target.cpuArrays.add(asset);
  else if (typeof asset.getChannelData === 'function' && Number.isFinite(asset.numberOfChannels) && Number.isFinite(asset.length)) target.audioBuffers.add(asset);
}
function retainSnapshot(snapshot, target) {
  if (!snapshot) return;
  (snapshot.native || []).forEach(value => { if (value.visual) collect(value.visual.content, target); });
  (snapshot.additions || []).forEach(value => {
    if (value.entry) collect(value.entry.object, target);
    if (value.visuals && value.visuals.forEach) value.visuals.forEach(visual => { if (visual) collect(visual.content, target); });
  });
  (snapshot.imports || []).forEach(value => { if (value.dataUrl) target.encodedStrings.add(value.dataUrl); });
}

// These are the private resource owners used by the editor's derived visuals.
// Do not walk their document/context references or arbitrary application objects.
function retainRuntimeResources(value, target, seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || seen.has(value) || depth > 7) return;
  seen.add(value);
  if (value.isMaterial) { collectMaterial(value, target); return; }
  if (value.isWebGLRenderTarget) { collectTarget(value, target); return; }
  if (value.isTexture || value.isObject3D) { collectAsset(value, target); return; }
  if (value.isBufferGeometry || value.isGeometry) {
    target.geometries.add(value); attributesOf(value).forEach(attribute => target.attributes.add(attribute)); return;
  }
  if (Array.isArray(value) || value instanceof Set) { value.forEach(entry => retainRuntimeResources(entry, target, seen, depth + 1)); return; }
  if (value instanceof Map) { value.forEach((entry, key) => { retainRuntimeResources(key, target, seen, depth + 1); retainRuntimeResources(entry, target, seen, depth + 1); }); return; }
  ['original', 'originals', 'installed', 'binding', 'material', 'materials', 'privateMaterials', 'texture', 'textures', 'textureCopies', 'copies',
    'resource', 'resources', 'proceduralTextures', 'groups', 'meshes', 'geometry', 'object', 'mesh', 'plane', 'backPlane', 'preview', 'surface', 'surfaces', 'loaded'].forEach(key => {
    retainRuntimeResources(value[key], target, seen, depth + 1);
  });
}

/**
 * Keeps native scene objects and CPU asset data intact, while releasing dormant
 * rooms' exclusive WebGL resources. Three uploads them again on the next visit.
 * Frustum tests are advisory: visibility remains an authored document property.
 */
export default class ScenePerformance {
  constructor(ctx, document) {
    this.ctx = ctx;
    this.document = document;
    this.roomId = null;
    this.elapsed = 0;
    this.dirty = true;
    this.disposed = false;
    this.contextTextureHandlesReleased = false;
    this.evicted = new WeakSet();
    this.bounds = new WeakMap();
    this.inactiveInventory = new WeakMap(); this.assetInventory = new WeakMap(); this.snapshotInventory = new WeakMap();
    this.frame = 0;
    this.frustums = [];
    this.matrix = new THREE.Matrix4();
    this.inverse = new THREE.Matrix4();
    this.testBox = new THREE.Box3();
    this.memory = new RuntimeResourceMemory(); this.lod = new CosmeticVisualLod(); this.cameras = [];
    this.architecture = new StaticArchitectureBatches(document);
    this.memoryStats = {gpuGeometryBytes: 0, gpuTextureBytes: 0, retainedCpuBytesEstimated: 0, memoryEstimated: true, estimateKind: 'reachable-resource-backing-stores', estimateConfidence: 'low'};
    this.stats = {inactiveGPUEvictions: 0, releasedGeometries: 0, releasedMaterials: 0, releasedTextures: 0, inactiveRooms: 0, contextTextureReleaseCycles: 0, contextReleasedTextures: 0, contextReleasedRenderTargets: 0, contextReleasedGeometries: 0, contextReleasedMaterials: 0, inventoryCacheHits: 0, inventoryScans: 0, inventoryScanMs: 0};
  }

  setRoom(roomId) {
    roomId = String(roomId);
    if (this.disposed || roomId === this.roomId) return;
    this.lod.clear(); this.clearPresentation();
    this.roomId = roomId;
    this.invalidate();
    if (this.ctx.roomAssets && this.ctx.roomAssets.setActiveRoom) this.ctx.roomAssets.setActiveRoom(roomId, this.document.getRoot(roomId));
    this.reconcile();
  }

  invalidate() { this.dirty = true; this.architecture.invalidate(); this.inactiveInventory = new WeakMap(); this.assetInventory = new WeakMap(); this.snapshotInventory = new WeakMap(); }

  clearPresentation() { this.architecture.clear(); }

  syncPresentation(editing = false) {
    const renderer = this.ctx.renderer;
    const enabled = !!(renderer && (renderer.capabilities && renderer.capabilities.isWebGL2 ||
      renderer.extensions && renderer.extensions.get && renderer.extensions.get('ANGLE_instanced_arrays')));
    this.architecture.sync(this.roomId, {editing, enabled, version: this.ctx.editor && this.ctx.editor.changeVersion});
  }

  cachedInventory(root, cache, collectValue) {
    let entry = cache.get(root); const children = root.children ? root.children.length : 0;
    let changed = entry && entry.maps.some(state => !sameMaterialMaps(state.material, state.values));
    if (entry && !changed) for (const [object, material] of entry.bindings) if (object.material !== material) { changed = true; break; }
    if (!entry || entry.children !== children || changed) { const value = resources(); collectValue(value); const bindings = new Map(); value.objects.forEach(object => { if (object.material) bindings.set(object, object.material); }); entry = {children, value, bindings, maps: Array.from(value.materials).map(material => ({material, values: materialMaps(material)}))}; cache.set(root, entry); }
    else this.stats.inventoryCacheHits++;
    return entry.value;
  }

  resourceInventory() {
    const started = scanClock(); this.stats.inventoryScans++;
    const resident = resources();
    const inactive = resources();
    const roomRoots = new Set();
    this.stats.inactiveRooms = 0;
    this.document.rooms.forEach((room, roomId) => {
      const root = this.document.getRoot(roomId);
      if (!root) return;
      roomRoots.add(root);
      if (String(roomId) === this.roomId) collect(root, resident, null, inactive);
      else { mergeResources(inactive, this.cachedInventory(root, this.inactiveInventory, target => collect(root, target))); this.stats.inactiveRooms++; }
    });

    // Global lights/controllers/camera helpers can share materials with a room.
    // Asset-cache references themselves are CPU ownership, not GPU residency.
    [this.ctx.scene, this.ctx.cameraRig, this.ctx.camera].concat(this.ctx.controllers || []).forEach(root => collect(root, resident, roomRoots));
    // The mono XR canvas owns one private quad/texture outside the world.
    collect(this.ctx.xrMirror && this.ctx.xrMirror.scene, resident);
    Object.keys(this.ctx.assets || {}).filter(key => /controller|(?:^|_)hand(?:_|$)|pointer/i.test(key)).forEach(key => {
      const asset = this.ctx.assets[key];
      if (asset && asset.isTexture) resident.textures.add(asset);
      else collect(asset && (asset.scene || asset), resident, roomRoots);
    });

    const editor = this.ctx.editor, entities = editor && editor.entities;
    collectTarget(entities && entities.target, resident);
    collectTarget(entities && entities.environment && entities.environment.reflections, resident);
    if (this.ctx.renderer && this.ctx.renderer.getRenderTarget) collectTarget(this.ctx.renderer.getRenderTarget(), resident);
    // Optional explicit targets owned by integrations; no arbitrary traversal of
    // renderer internals or WebGL allocation queries is needed.
    (this.ctx.performanceRenderTargets || []).forEach(target => collectTarget(target, resident));

    const retained = resources(); mergeResources(retained, resident); mergeResources(retained, inactive);
    Object.keys(this.ctx.assets || {}).forEach(key => {
      const asset = this.ctx.assets[key], root = asset && (asset.scene || asset);
      if (root && root.isObject3D) mergeResources(retained, this.cachedInventory(root, this.assetInventory, target => collectAsset(asset, target)));
      else collectAsset(asset, retained);
    });
    const runtimeSeen = new Set();
    const roomAssets = this.ctx.roomAssets;
    retainRuntimeResources(roomAssets && roomAssets.records, retained, runtimeSeen);
    retainRuntimeResources(this.ctx.retainedRoomAssets, retained, runtimeSeen);
    const surfaces = editor && editor.materials, visuals = editor && editor.industrialVisuals;
    retainRuntimeResources(surfaces && surfaces.states, retained, runtimeSeen);
    ['displays', 'colors', 'rollers', 'belts', 'steerBanks', 'rollerTextures', 'rollerMaterials'].forEach(key => retainRuntimeResources(visuals && visuals[key], retained, runtimeSeen));
    [editor && editor.decals, editor && editor.wearPaint && editor.wearPaint.engine].forEach(system => {
      retainRuntimeResources(system && system.states, retained, runtimeSeen);
      retainRuntimeResources(system && system.convertedResources, retained, runtimeSeen);
    });
    retainRuntimeResources(editor && editor.lineMonitors && editor.lineMonitors.entries, retained, runtimeSeen);
    if (this.document.native && this.document.native.forEach) this.document.native.forEach(entry => { collectMaterial(entry.material, retained); (entry.children || []).forEach(child => collect(child, retained)); });
    if (this.document.visualMasks && this.document.visualMasks.forEach) this.document.visualMasks.forEach(value => collectMaterial(value.material, retained));
    const snapshots = (this.document.undoStack || []).concat(this.document.redoStack || [], this.document.transaction ? [this.document.transaction] : []);
    snapshots.forEach(snapshot => mergeResources(retained, this.cachedInventory(snapshot, this.snapshotInventory, target => retainSnapshot(snapshot, target))));
    const workspace = editor && editor.projectTabs;
    (workspace && workspace.retainedSnapshots ? workspace.retainedSnapshots() : []).forEach(snapshot => retainSnapshot(snapshot, retained));
    const clipboard = editor && editor.objectClipboard;
    if (clipboard) { collect(clipboard.content, retained); if (clipboard.visuals && clipboard.visuals.forEach) clipboard.visuals.forEach(value => collect(value && (value.content || value), retained)); }
    (workspace && workspace.retainedClipboards ? workspace.retainedClipboards() : []).forEach(value => { collect(value.content, retained); if (value.visuals && value.visuals.forEach) value.visuals.forEach(visual => collect(visual && (visual.content || visual), retained)); });
    const library = this.document.assetLibrary;
    (library && library.imports || []).forEach(value => { if (value.dataUrl) retained.encodedStrings.add(value.dataUrl); });
    // GPU eviction releases allocations only. CPU data reachable through history,
    // original assets or paste remains retained and is included in RAM estimates.
    mergeResources(inactive, retained);

    this.stats.inventoryScanMs = scanClock() - started;
    return {resident, inactive, retained, snapshots};
  }

  // Three r112 retains old renderer dispose listeners across restoration. Detach
  // those while that renderer still owns its GPU handles. Keep this API name for
  // its existing caller; geometry/material dispose also preserves the CPU object,
  // arrays, BVH, configuration, colors and image data used on the next upload.
  releaseContextTextureHandles() {
    if (this.disposed || this.contextTextureHandlesReleased) return {textures: 0, renderTargets: 0, geometries: 0, materials: 0};
    this.contextTextureHandlesReleased = true;
    const {retained} = this.resourceInventory();
    const released = {textures: 0, renderTargets: 0, geometries: 0, materials: 0};
    retained.renderTargets.forEach(target => { target.dispose(); released.renderTargets++; });
    ['geometries', 'materials'].forEach(kind => retained[kind].forEach(resource => {
      if (typeof resource.dispose !== 'function') return;
      resource.dispose(); this.evicted.add(resource); released[kind]++;
    }));
    retained.textures.forEach(texture => {
      if (retained.renderTargetTextures.has(texture) || texture.isRenderTargetTexture || typeof texture.dispose !== 'function') return;
      texture.dispose(); texture.needsUpdate = true; this.evicted.add(texture); released.textures++;
    });
    this.stats.contextTextureReleaseCycles++;
    this.stats.contextReleasedTextures += released.textures;
    this.stats.contextReleasedRenderTargets += released.renderTargets;
    this.stats.contextReleasedGeometries += released.geometries;
    this.stats.contextReleasedMaterials += released.materials;
    this.invalidate();
    return released;
  }

  restoreContextTextureHandles() {
    if (this.disposed) return;
    this.contextTextureHandlesReleased = false;
    this.invalidate(); this.elapsed = 1;
  }

  reconcile() {
    if (this.disposed || this.contextTextureHandlesReleased || this.roomId === null || !this.document.getRoot(this.roomId)) return;
    const {resident, inactive, retained, snapshots} = this.resourceInventory();

    ['geometries', 'materials', 'textures'].forEach(kind => {
      resident[kind].forEach(resource => {
        if (!this.evicted.has(resource)) return;
        // Texture.dispose leaves version unchanged; explicitly request reupload,
        // including compressed mipmaps and uniforms, on re-entering the room.
        if (kind === 'textures') resource.needsUpdate = true;
        this.evicted.delete(resource);
      });
      inactive[kind].forEach(resource => {
        if (resident[kind].has(resource) || this.evicted.has(resource) || typeof resource.dispose !== 'function') return;
        // Separate geometries may share BufferAttributes (including interleaved
        // data). Disposing one must not delete an active geometry's GPU buffer.
        if (kind === 'geometries' && attributesOf(resource).some(attribute => resident.attributes.has(attribute))) return;
        // Render-target textures are owned and recreated by their render target.
        if (kind === 'textures' && (resource.isRenderTargetTexture || retained.renderTargetTextures.has(resource))) return;
        resource.dispose();
        // This flag allocates nothing until a renderer actually uses the map.
        // It also keeps resources valid if another renderer draws a cached room
        // before this manager is notified of a room switch.
        if (kind === 'textures') resource.needsUpdate = true;
        this.evicted.add(resource);
        this.stats.inactiveGPUEvictions++;
        this.stats['released' + kind.charAt(0).toUpperCase() + kind.slice(1)]++;
      });
    });
    this.memoryStats = this.memory.sample(resident, retained, {capabilities: this.ctx.renderer && this.ctx.renderer.capabilities, historySnapshots: snapshots.length});
    this.lod.reconcile(this.document.getRoot(this.roomId));
    this.dirty = false;
    this.elapsed = 0;
  }

  update(camera, delta = 0) {
    if (this.disposed) return;
    if (this.ctx.editor && this.ctx.editor.active) this.clearPresentation();
    this.elapsed += Math.max(0, Number.isFinite(delta) ? delta : 0);
    // A continuous transform/paint drag can invalidate every frame. Expensive
    // ownership/texture scans stay at most once a second, except room switches.
    // A stable immersive scene has no authoring/history changes. Keep its
    // accounting work away from most XR frames; actual edits still reconcile
    // within one second, and switching a room reconciles immediately above.
    const scanInterval = this.ctx.vrMode && !this.dirty ? 4 : 1;
    if (this.elapsed >= scanInterval) this.reconcile();
    this.frame++;
    this.frustums.length = 0;
    this.cameras.length = 0;
    if (!camera) return;
    let view = camera;
    if (this.ctx.vrMode && this.ctx.renderer && this.ctx.renderer.xr) view = this.ctx.renderer.xr.getCamera(camera) || camera;
    // An XR ArrayCamera's projection alone does not cover both eyes. Test the
    // union so an object seen by just one eye keeps receiving visual updates.
    const cameras = view.isArrayCamera && view.cameras.length ? view.cameras : [view];
    this.cameras.push(...cameras);
    cameras.forEach(eye => {
      if (!view.isArrayCamera) eye.updateMatrixWorld(true);
      this.inverse.getInverse(eye.matrixWorld);
      this.matrix.multiplyMatrices(eye.projectionMatrix, this.inverse);
      this.frustums.push(new THREE.Frustum().setFromMatrix(this.matrix));
    });
    const limits = this.ctx.graphics && this.ctx.graphics.getLimits ? this.ctx.graphics.getLimits() : {tier: 'high', visualDistanceScale: 1};
    const renderer = this.ctx.renderer, height = renderer && renderer.domElement && renderer.domElement.height || 720;
    this.lod.update(cameras, delta, limits, height, this.frustums);
  }

  objectBounds(object) {
    let entry = this.bounds.get(object);
    if (entry && entry.frame === this.frame) return entry.box;
    if (!entry) { entry = {box: new THREE.Box3()}; this.bounds.set(object, entry); }
    entry.frame = this.frame;
    entry.uncullable = object.frustumCulled === false;
    const box = entry.box.makeEmpty();
    if (!object.visible) return box;
    if (object.geometry) {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (object.geometry.boundingBox) box.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
    }
    object.children.forEach(child => {
      box.union(this.objectBounds(child));
      if (child.visible && this.bounds.get(child).uncullable) entry.uncullable = true;
    });
    return box;
  }

  isVisible(object) {
    if (!object || this.disposed) return true;
    for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return false;
    // These meshes deliberately opt out of Three's ordinary geometric culling,
    // e.g. skinned or shader-displaced meshes without conservative static bounds.
    if (object.frustumCulled === false || !this.frustums.length) return true;
    const box = this.objectBounds(object);
    if (this.bounds.get(object).uncullable) return true;
    if (box.isEmpty()) return true;
    this.testBox.copy(box).expandByScalar(0.5);
    return this.frustums.some(frustum => frustum.intersectsBox(this.testBox));
  }

  getStats() {
    const info = this.ctx.renderer && this.ctx.renderer.info;
    const visuals = this.ctx.editor && this.ctx.editor.industrialVisuals;
    return Object.assign({}, this.stats, this.memoryStats, this.lod.getStats(), this.architecture.getStats(), visuals && visuals.getStats ? visuals.getStats() : {}, {
      roomId: this.roomId,
      drawCalls: info && info.render ? info.render.calls : 0,
      triangles: info && info.render ? info.render.triangles : 0,
      gpuGeometries: info && info.memory ? info.memory.geometries : 0,
      gpuTextures: info && info.memory ? info.memory.textures : 0
    });
  }

  dispose() {
    // Resources still belong to the document; disposing this manager must not
    // destroy the active room or invalidate undo/copy references.
    this.disposed = true;
    this.architecture.dispose();
    this.lod.dispose();
    this.frustums.length = 0;
    this.bounds = new WeakMap();
    this.inactiveInventory = new WeakMap(); this.assetInventory = new WeakMap(); this.snapshotInventory = new WeakMap();
  }
}
