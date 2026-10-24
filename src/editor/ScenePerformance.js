import * as THREE from 'three';

function resources() {
  return {geometries: new Set(), materials: new Set(), textures: new Set(), attributes: new Set()};
}

function texturesIn(value, target, seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || seen.has(value) || depth > 5) return;
  if (value.isTexture) { target.add(value); return; }
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

function collect(root, target, stopRoots) {
  if (!root || !root.isObject3D || (stopRoots && stopRoots.has(root))) return;
  if (root.geometry && !target.geometries.has(root.geometry)) {
    target.geometries.add(root.geometry);
    attributesOf(root.geometry).forEach(attribute => target.attributes.add(attribute));
  }
  const materials = Array.isArray(root.material) ? root.material : [root.material];
  materials.filter(Boolean).forEach(material => {
    if (target.materials.has(material)) return;
    target.materials.add(material);
    // Includes conventional maps and textures nested in ShaderMaterial uniforms.
    Object.keys(material).forEach(key => texturesIn(material[key], target.textures));
  });
  if (root.background && root.background.isTexture) target.textures.add(root.background);
  if (root.environment && root.environment.isTexture) target.textures.add(root.environment);
  root.children.forEach(child => collect(child, target, stopRoots));
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
    this.evicted = new WeakSet();
    this.bounds = new WeakMap();
    this.frame = 0;
    this.frustums = [];
    this.matrix = new THREE.Matrix4();
    this.inverse = new THREE.Matrix4();
    this.testBox = new THREE.Box3();
    this.stats = {inactiveGPUEvictions: 0, releasedGeometries: 0, releasedMaterials: 0, releasedTextures: 0, inactiveRooms: 0};
  }

  setRoom(roomId) {
    roomId = String(roomId);
    if (this.disposed || roomId === this.roomId) return;
    this.roomId = roomId;
    this.dirty = true;
    this.reconcile();
  }

  invalidate() { this.dirty = true; }

  reconcile() {
    if (this.disposed || this.roomId === null || !this.document.getRoot(this.roomId)) return;
    const resident = resources();
    const inactive = resources();
    const roomRoots = new Set();
    this.stats.inactiveRooms = 0;
    this.document.rooms.forEach((room, roomId) => {
      const root = this.document.getRoot(roomId);
      if (!root) return;
      roomRoots.add(root);
      if (String(roomId) === this.roomId) collect(root, resident);
      else { collect(root, inactive); this.stats.inactiveRooms++; }
    });

    // Global lights/controllers/camera helpers can share materials with a room.
    // Asset-cache references themselves are CPU ownership, not GPU residency.
    [this.ctx.scene, this.ctx.cameraRig, this.ctx.camera].concat(this.ctx.controllers || []).forEach(root => collect(root, resident, roomRoots));
    Object.keys(this.ctx.assets || {}).filter(key => /controller|(?:^|_)hand(?:_|$)|pointer/i.test(key)).forEach(key => {
      const asset = this.ctx.assets[key];
      if (asset && asset.isTexture) resident.textures.add(asset);
      else collect(asset && (asset.scene || asset), resident, roomRoots);
    });

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
        if (kind === 'textures' && resource.isRenderTargetTexture) return;
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
    this.dirty = false;
    this.elapsed = 0;
  }

  update(camera, delta = 0) {
    if (this.disposed) return;
    this.elapsed += Math.max(0, Number.isFinite(delta) ? delta : 0);
    if (this.dirty || this.elapsed >= 1) this.reconcile();
    this.frame++;
    this.frustums.length = 0;
    if (!camera) return;
    let view = camera;
    if (this.ctx.vrMode && this.ctx.renderer && this.ctx.renderer.xr) view = this.ctx.renderer.xr.getCamera(camera) || camera;
    // An XR ArrayCamera's projection alone does not cover both eyes. Test the
    // union so an object seen by just one eye keeps receiving visual updates.
    const cameras = view.isArrayCamera && view.cameras.length ? view.cameras : [view];
    cameras.forEach(eye => {
      if (!view.isArrayCamera) eye.updateMatrixWorld(true);
      this.inverse.getInverse(eye.matrixWorld);
      this.matrix.multiplyMatrices(eye.projectionMatrix, this.inverse);
      this.frustums.push(new THREE.Frustum().setFromMatrix(this.matrix));
    });
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
    return Object.assign({}, this.stats, {
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
    this.frustums.length = 0;
    this.bounds = new WeakMap();
  }
}
