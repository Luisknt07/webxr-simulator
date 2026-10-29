import * as THREE from 'three';

const MAX_SOURCES = 4096;
const visible = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };
const materials = value => Array.isArray(value) ? value : [value];
const sameMaterials = (value, saved) => Array.isArray(value) ? value.length === saved.length && value.every((material, index) => material === saved[index]) : saved.length === 1 && value === saved[0];
const safeShader = material => material && material.visible !== false && material.opacity === 1 && !material.transparent &&
  (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) && !material.skinning && !material.morphTargets &&
  !(material.clippingPlanes && material.clippingPlanes.length) &&
  (material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile || material.staticInstanceBatchShader === material.onBeforeCompile);
const groupsMatch = (geometry, saved) => geometry.drawRange.start === saved.start && geometry.drawRange.count === saved.count &&
  geometry.groups.length === saved.groups.length && geometry.groups.every((group, index) => { const value = saved.groups[index]; return group.start === value.start && group.count === value.count && group.materialIndex === value.materialIndex; });

/** A draw-only view of identical sibling rollers. Authored mesh triangles, UVs,
 * materials and ray/physics targets stay intact. Local instances follow their
 * original mechanism parent, including lift/turntable animation, without a
 * world-space rebuild. No triangles or texture samples are simplified. */
export default class RollerInstanceBatches {
  constructor() {
    this.sources = []; this.batches = []; this.root = null; this.dirty = true;
    this.ids = new WeakMap(); this.nextId = 1;
    this.stats = {rollerInstanceSources: 0, rollerInstanceBatches: 0, rollerDrawCallsAvoided: 0, rollerInstanceBytes: 0, rollerBatchRebuilds: 0, rollerMatrixUploads: 0};
  }
  static supported(renderer) {
    if (!renderer || !renderer.capabilities) return false;
    if (renderer.capabilities.isWebGL2) return true;
    try { return !!(renderer.extensions && renderer.extensions.get && renderer.extensions.get('ANGLE_instanced_arrays')); } catch (_) { return false; }
  }
  invalidate() { this.dirty = true; }
  id(value) { if (!this.ids.has(value)) this.ids.set(value, this.nextId++); return this.ids.get(value); }
  candidate(object) {
    const geometry = object.geometry, data = object.userData || {};
    if (!object.isMesh || object.isInstancedMesh || object.isSkinnedMesh || !object.parent || object.children.length || !visible(object) || object.layers.mask === 0 || object.frustumCulled === false || object.morphTargetInfluences || object.customDepthMaterial || object.customDistanceMaterial ||
      object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || object.onAfterRender !== THREE.Object3D.prototype.onAfterRender ||
      data.editorGeometryReplaced || data.industrialSteerBank || data.editorRuntimeHelper || !geometry || !geometry.isBufferGeometry || geometry.isInstancedBufferGeometry ||
      geometry.userData.industrialSteerRest || geometry.userData.industrialDynamicGeometry || Object.keys(geometry.morphAttributes || {}).length) return null;
    const names = Object.keys(geometry.attributes);
    // Four matrix attributes plus the base attributes must fit WebGL's minimum
    // eight vertex slots. Unusual layouts keep their ordinary drawing path.
    if (!geometry.attributes.position || names.length > 4 || names.some(name => geometry.attributes[name].isInstancedBufferAttribute || geometry.attributes[name].isInterleavedBufferAttribute || geometry.attributes[name].usage === THREE.DynamicDrawUsage)) return null;
    const list = materials(object.material); if (!list.length || list.some(material => !safeShader(material))) return null;
    if (object.matrixAutoUpdate) object.updateMatrix();
    if (object.matrix.determinant() <= 1e-12) return null;
    const key = [this.id(object.parent), this.id(geometry), Array.isArray(object.material) ? 'array' : 'single', ...list.map(material => this.id(material)), object.layers.mask, object.castShadow, object.receiveShadow, object.renderOrder].join(':');
    return {object, geometry, parent: object.parent, materials: list.slice(), arrayMaterials: Array.isArray(object.material), shaders: list.map(material => material.onBeforeCompile), mask: object.layers.mask, key, hidden: false};
  }
  unchanged(root, rollers) {
    if (this.dirty || this.root !== root || this.rollers !== rollers || this.rollerCount !== rollers.size) return false;
    for (const source of this.sources) {
      const object = source.object;
      if (!rollers.has(object) || object.parent !== source.parent || object.geometry !== source.geometry || !visible(object) || object.layers.mask !== 0 ||
        Array.isArray(object.material) !== source.arrayMaterials || !sameMaterials(object.material, source.materials) || !source.materials.every((material, index) => safeShader(material) && material.onBeforeCompile === source.shaders[index]) ||
        object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || object.onAfterRender !== THREE.Object3D.prototype.onAfterRender || object.customDepthMaterial || object.customDistanceMaterial ||
        object.castShadow !== source.castShadow || object.receiveShadow !== source.receiveShadow || object.renderOrder !== source.renderOrder || object.frustumCulled === false ||
        object.geometry.userData.industrialSteerRest || object.geometry.userData.industrialDynamicGeometry || object.userData.industrialSteerBank || object.userData.editorGeometryReplaced ||
        !groupsMatch(object.geometry, source.draw) || Object.keys(object.geometry.attributes).length !== source.attributeNames.length || source.attributeNames.some((name, index) => object.geometry.attributes[name] !== source.attributes[index] || source.attributes[index].version !== source.versions[index] || source.attributes[index].usage === THREE.DynamicDrawUsage) ||
        object.geometry.index !== source.index || source.index && source.index.version !== source.indexVersion) return false;
    }
    return true;
  }
  updateMatrices() {
    for (const batch of this.batches) {
      let changed = false;
      for (const source of batch.rollerSources) {
        if (source.object.matrixAutoUpdate) source.object.updateMatrix();
        if (!source.object.matrix.equals(source.matrix)) {
          if (source.object.matrix.determinant() <= 1e-12) { this.dirty = true; return false; }
          source.matrix.copy(source.object.matrix); batch.setMatrixAt(source.instanceIndex, source.matrix); changed = true;
        }
      }
      if (changed) { this.bounds(batch); batch.instanceMatrix.needsUpdate = true; this.stats.rollerMatrixUploads++; }
    }
    return true;
  }
  bounds(batch) {
    const bounds = batch.geometry.boundingBox || new THREE.Box3(); bounds.makeEmpty();
    for (const source of batch.rollerSources) {
      if (!source.geometry.boundingBox) source.geometry.computeBoundingBox();
      bounds.union(source.geometry.boundingBox.clone().applyMatrix4(source.matrix));
    }
    batch.geometry.boundingBox = bounds; batch.geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  }
  sync(root, rollers, options = {}) {
    if (options.editing || !options.supported || !root) { if (this.root || this.sources.length) this.clear(); return; }
    if (this.unchanged(root, rollers) && this.updateMatrices()) return;
    this.clear(); this.root = root; this.rollers = rollers; this.rollerCount = rollers.size;
    const groups = new Map();
    for (const object of rollers.keys()) {
      const source = this.candidate(object); if (!source) continue;
      if (!groups.has(source.key)) groups.set(source.key, []); groups.get(source.key).push(source);
    }
    for (const group of groups.values()) {
      if (group.length < 2 || this.sources.length + group.length > MAX_SOURCES) continue;
      const first = group[0], mesh = first.object, geometry = new THREE.BufferGeometry();
      Object.keys(first.geometry.attributes).forEach(name => geometry.setAttribute(name, first.geometry.attributes[name]));
      if (first.geometry.index) geometry.setIndex(first.geometry.index);
      first.geometry.groups.forEach(value => geometry.addGroup(value.start, value.count, value.materialIndex));
      geometry.setDrawRange(first.geometry.drawRange.start, first.geometry.drawRange.count);
      const batch = new THREE.InstancedMesh(geometry, mesh.material, group.length);
      batch.name = 'Rodillos · ' + group.length + ' instancias'; batch.userData.editorRuntimeHelper = true; batch.userData.rollerInstanceBatch = true; batch.rollerSources = group;
      batch.raycast = () => {}; batch.layers.mask = first.mask; batch.castShadow = mesh.castShadow; batch.receiveShadow = mesh.receiveShadow; batch.renderOrder = mesh.renderOrder; batch.frustumCulled = true;
      group.forEach((source, index) => {
        const object = source.object;
        source.matrix = object.matrix.clone(); source.instanceIndex = index; batch.setMatrixAt(index, source.matrix);
        source.castShadow = object.castShadow; source.receiveShadow = object.receiveShadow; source.renderOrder = object.renderOrder;
        source.draw = {start: source.geometry.drawRange.start, count: source.geometry.drawRange.count, groups: source.geometry.groups.map(value => Object.assign({}, value))};
        source.attributeNames = Object.keys(source.geometry.attributes); source.attributes = source.attributeNames.map(name => source.geometry.attributes[name]); source.versions = source.attributes.map(attribute => attribute.version);
        source.index = source.geometry.index; source.indexVersion = source.index && source.index.version;
      });
      this.bounds(batch); batch.instanceMatrix.needsUpdate = true; this.stats.rollerMatrixUploads++;
      first.parent.add(batch); this.batches.push(batch);
      group.forEach(source => { source.object.layers.mask = 0; source.hidden = true; this.sources.push(source); });
    }
    this.stats.rollerBatchRebuilds++; this.dirty = false; this.updateStats();
  }
  updateStats() {
    this.stats.rollerInstanceSources = this.sources.length; this.stats.rollerInstanceBatches = this.batches.length;
    this.stats.rollerInstanceBytes = this.sources.length * 64;
    this.stats.rollerDrawCallsAvoided = this.batches.reduce((sum, batch) => sum + (batch.count - 1) * (Array.isArray(batch.material) ? batch.geometry.groups.filter(group => batch.material[group.materialIndex] && batch.material[group.materialIndex].visible).length : 1), 0);
  }
  getStats() { return Object.assign({}, this.stats); }
  clear() {
    this.sources.forEach(source => { if (source.hidden && source.object.layers.mask === 0) source.object.layers.mask = source.mask; });
    this.batches.forEach(batch => {
      if (batch.parent) batch.parent.remove(batch);
      // Source vertex/index buffers and materials are borrowed. The central
      // renderer releases the owned instanceMatrix when this view is disposed.
      Object.keys(batch.geometry.attributes).forEach(name => batch.geometry.deleteAttribute(name)); batch.geometry.setIndex(null); batch.geometry.dispose();
    });
    this.sources = []; this.batches = []; this.root = this.rollers = null; this.rollerCount = 0; this.dirty = true; this.updateStats();
  }
  dispose() { this.clear(); this.ids = new WeakMap(); this.nextId = 1; }
}
