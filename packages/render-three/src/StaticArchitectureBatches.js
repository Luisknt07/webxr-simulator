import * as THREE from 'three';

const MAPS = ['map', 'alphaMap', 'aoMap', 'lightMap', 'bumpMap', 'normalMap', 'displacementMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'envMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap', 'surfaceWearMap'];
const PROPS = ['type', 'side', 'shadowSide', 'blending', 'blendSrc', 'blendDst', 'blendEquation', 'blendSrcAlpha', 'blendDstAlpha', 'blendEquationAlpha', 'depthFunc', 'depthTest', 'depthWrite', 'colorWrite', 'alphaTest', 'premultipliedAlpha', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'dithering', 'fog', 'flatShading', 'wireframe', 'vertexColors', 'roughness', 'metalness', 'opacity', 'transparent', 'emissiveIntensity', 'lightMapIntensity', 'aoMapIntensity', 'bumpScale', 'displacementScale', 'displacementBias', 'envMapIntensity', 'reflectivity', 'refractionRatio', 'clearcoat', 'clearcoatRoughness', 'combine', 'normalMapType', 'toneMapped', 'precision', 'vertexTangents', 'stencilWrite', 'stencilWriteMask', 'stencilFunc', 'stencilRef', 'stencilFuncMask', 'stencilFail', 'stencilZFail', 'stencilZPass', 'clipIntersection', 'clipShadows'];
const ALLOWED = new Set(['collision', 'surfaceMaterial']);
const MAX_SOURCES = 512;
const COLORS = ['color', 'emissive', 'specular', 'normalScale', 'clearcoatNormalScale', 'sheen'];
const TEX_PROPS = ['version', 'mapping', 'encoding', 'wrapS', 'wrapT', 'minFilter', 'magFilter', 'anisotropy', 'flipY', 'premultiplyAlpha', 'unpackAlignment', 'rotation', 'matrixAutoUpdate'];
const visible = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const within = (object, owner) => { for (let node = object; node; node = node.parent) if (node === owner) return true; return false; };
const pose = object => ({position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), visible: object.visible, mask: object.layers.mask});
const samePose = (object, saved, ignoreMask = false) => object.position.equals(saved.position) && object.quaternion.equals(saved.quaternion) && object.scale.equals(saved.scale) && object.visible === saved.visible && (ignoreMask || object.layers.mask === saved.mask);
const rawBehaviors = object => object.userData.editorBehaviors || object.userData.editorDefaultBehaviors;
const plainShader = material => material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile;

/** A reversible rendering view of generated architectural primitives. All
 * authored objects, surfaces and collider triangles remain untouched. Layer
 * mask zero suppresses only their render submission in r112, whose Raycaster
 * and CollisionWorld still query the original physical meshes. */
export default class StaticArchitectureBatches {
  constructor(document, options = {}) {
    this.document = document; this.chunkSize = Math.max(8, Math.min(32, options.chunkSize || 32));
    this.sources = []; this.batches = []; this.roomId = null; this.dirty = true; this.disposed = false;
    this.textureIds = new WeakMap(); this.nextTexture = 1; this.geometryKeys = new WeakMap(); this.materialKeys = new WeakMap();
    this.stats = {architectureSources: 0, architectureBatches: 0, architectureDrawCallsAvoided: 0, architectureInstanceBytes: 0, architectureRebuilds: 0, architectureChunkSize: this.chunkSize};
  }
  invalidate() { this.dirty = true; }
  textureKey(texture) {
    if (!texture) return null;
    if (!this.textureIds.has(texture)) this.textureIds.set(texture, this.nextTexture++);
    // A live canvas/video target cannot be frozen into a static submission.
    if (texture.isCanvasTexture || texture.isVideoTexture || texture.isRenderTargetTexture) return false;
    return [this.textureIds.get(texture), TEX_PROPS.map(key => texture[key]),
      texture.offset && texture.offset.toArray(), texture.repeat && texture.repeat.toArray(), texture.center && texture.center.toArray(), texture.matrix && texture.matrix.toArray()];
  }
  materialKey(material) {
    if (!material || material.visible === false || material.transparent || material.opacity !== 1 || material.isShaderMaterial || material.isRawShaderMaterial || material.skinning || material.morphTargets || material.clippingPlanes && material.clippingPlanes.length) return null;
    const token = material.userData && material.userData.staticArchitectureBatchKey;
    if (!plainShader(material) && (!token || material.staticArchitectureBatchShader !== material.onBeforeCompile)) return null;
    const cached = this.materialKeys.get(material), definitions = material.defines || {};
    if (cached && cached.token === token && cached.shader === material.onBeforeCompile && PROPS.every((key, i) => material[key] === cached.props[i]) &&
      COLORS.every((key, i) => cached.colors[i] && cached.colors[i].equals ? material[key] && material[key].equals(cached.colors[i]) : material[key] === cached.colors[i]) &&
      Object.keys(definitions).length === cached.defineKeys.length && cached.defineKeys.every(key => definitions[key] === cached.defines[key]) &&
      MAPS.every((key, i) => {
        const value = material[key], entry = cached.maps[i]; if (!entry) return !value;
        return value === entry.texture && TEX_PROPS.every((name, at) => value[name] === entry.props[at]) && ['offset', 'repeat', 'center', 'matrix'].every(name => value[name] && value[name].equals(entry[name]));
      })) return cached.key;
    const maps = MAPS.map(key => this.textureKey(material[key])); if (maps.includes(false)) return null;
    const key = JSON.stringify([token || '', PROPS.map(key => material[key]), COLORS.map(key => material[key] && material[key].toArray ? material[key].toArray() : material[key]), definitions, maps]);
    this.materialKeys.set(material, {key, token, shader: material.onBeforeCompile, props: PROPS.map(key => material[key]), colors: COLORS.map(key => material[key] && material[key].clone ? material[key].clone() : material[key]),
      defineKeys: Object.keys(definitions), defines: Object.assign({}, definitions), maps: MAPS.map(key => {const texture = material[key]; return texture ? {texture, props: TEX_PROPS.map(key => texture[key]), offset: texture.offset.clone(), repeat: texture.repeat.clone(), center: texture.center.clone(), matrix: texture.matrix.clone()} : null;})});
    return key;
  }
  geometryKey(geometry) {
    if (!geometry || !geometry.isBufferGeometry || geometry.isInstancedBufferGeometry || Object.keys(geometry.morphAttributes || {}).length || geometry.drawRange.start !== 0) return null;
    const attributes = geometry.attributes, names = Object.keys(attributes).sort();
    if (!attributes.position || !attributes.normal || names.length > 4 || names.some(name => !['position', 'normal', 'uv', 'uv2', 'color'].includes(name))) return null;
    if (names.some(name => attributes[name].isInterleavedBufferAttribute || attributes[name].isInstancedBufferAttribute)) return null;
    const count = geometry.index ? geometry.index.count : attributes.position.count;
    if (count > 144 || geometry.drawRange.count !== Infinity && geometry.drawRange.count !== count) return null;
    const version = names.map(name => attributes[name].version).concat(geometry.index ? geometry.index.version : -1);
    let cached = this.geometryKeys.get(geometry);
    if (!cached || !same(cached.version, version) || cached.names !== names.join(',') || !same(cached.attributes, names.map(name => attributes[name])) || cached.index !== geometry.index) {
      const key = JSON.stringify([names.map(name => [name, attributes[name].itemSize, attributes[name].normalized, attributes[name].array.constructor.name, Array.from(attributes[name].array)]), geometry.index && Array.from(geometry.index.array)]);
      cached = {key, version, names: names.join(','), attributes: names.map(name => attributes[name]), index: geometry.index}; this.geometryKeys.set(geometry, cached);
    } return cached.key;
  }
  candidate(owner, root) {
    const data = owner.userData || {}, descriptor = data.editorDescriptor;
    if (!/^CEDI\s*·\s*/u.test(owner.name || '') || data.editorNative || data.editorPrefabKey || !descriptor || descriptor.type !== 'box' || !visible(owner)) return null;
    const behaviors = this.document.getBehaviors(owner);
    if (behaviors.some(value => value.enabled !== false && !ALLOWED.has(value.type))) return null;
    for (let node = owner; node && node !== root; node = node.parent) {
      const entry = node.userData || {};
      if (entry.editorHelper || entry.editorRuntimeHelper || entry.editorGeometryReplaced || entry.editorVisualOwnerId || entry.editorDecal || node.animations && node.animations.length ||
        node !== owner && this.document.getBehaviors(node).some(value => value.enabled !== false && !ALLOWED.has(value.type))) return null;
    }
    const meshes = []; owner.traverse(node => { if (node.isMesh) meshes.push(node); });
    if (meshes.length !== 1) return null;
    const mesh = meshes[0];
    if (mesh.parent !== owner || mesh.children.length || mesh.frustumCulled === false || mesh.isInstancedMesh || mesh.isSkinnedMesh || mesh.morphTargetInfluences || Array.isArray(mesh.material) || mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || mesh.onAfterRender !== THREE.Object3D.prototype.onAfterRender || mesh.userData.editorGeometryReplaced || !visible(mesh)) return null;
    const material = this.materialKey(mesh.material), geometry = this.geometryKey(mesh.geometry);
    if (!material || !geometry || mesh.layers.mask === 0) return null;
    owner.updateWorldMatrix(true, true);
    if (mesh.matrixWorld.determinant() <= 1e-12) return null; // Per-instance mirrored winding is not supported by r112.
    return {owner, mesh, material, geometry, mask: mesh.layers.mask, hidden: false};
  }
  unchanged(root) {
    if (this.dirty || !root || this.root !== root) return false;
    if (this.document.objects && this.document.objects.size !== this.objectCount) return false;
    for (const source of this.sources) {
      const {owner, mesh} = source;
      if (!owner.parent || !within(mesh, owner) || owner.userData.editorGeometryReplaced || mesh.userData.editorGeometryReplaced || !visible(owner) || !visible(mesh) || mesh.layers.mask !== 0 || mesh.geometry !== source.originalGeometry || mesh.material !== source.originalMaterial ||
        !samePose(owner, source.ownerPose) || !samePose(mesh, source.meshPose, true) || !same(source.renderState, [mesh.castShadow, mesh.receiveShadow, mesh.renderOrder, mesh.frustumCulled]) || this.materialKey(mesh.material) !== source.material || this.geometryKey(mesh.geometry) !== source.geometry ||
        rawBehaviors(owner) !== source.behaviors) return false;
    }
    // A moved ancestor changes every instance matrix, including world scale.
    for (const entry of this.ancestors) if (!samePose(entry.object, entry.pose)) return false;
    return true;
  }
  sync(roomId, options = {}) {
    if (this.disposed) return;
    roomId = String(roomId);
    if (options.version !== undefined && options.version !== this.version) { this.version = options.version; this.dirty = true; }
    if (options.editing || options.enabled === false) { this.clear(); this.roomId = roomId; return; }
    if (this.roomId !== roomId) { this.clear(); this.roomId = roomId; }
    const root = this.document.getRoot(roomId); if (this.unchanged(root)) return;
    this.clear(); this.roomId = roomId; this.root = root; if (!root) return;
    root.updateWorldMatrix(true, false);
    const inverse = new THREE.Matrix4().getInverse(root.matrixWorld), groups = new Map(), objects = this.document.getObjects(roomId);
    this.objectCount = this.document.objects ? this.document.objects.size : objects.length; this.ancestors = []; const parents = new Set();
    let candidates = 0;
    for (const owner of objects) {
      if (candidates >= MAX_SOURCES) break;
      const source = this.candidate(owner, root); if (!source) continue;
      candidates++;
      const position = owner.getWorldPosition(new THREE.Vector3());
      const key = Math.floor(position.x / this.chunkSize) + ':' + Math.floor(position.z / this.chunkSize) + ':' + source.mask + ':' + source.mesh.castShadow + ':' + source.mesh.receiveShadow + ':' + source.mesh.renderOrder + ':' + source.material + ':' + source.geometry;
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(source);
    }
    const helper = new THREE.Group(); helper.name = 'Arquitectura · lotes de dibujo'; helper.userData.editorRuntimeHelper = true;
    helper.userData.staticArchitectureBatches = true; root.add(helper); this.helper = helper;
    for (const group of groups.values()) {
      if (group.length < 2 || this.sources.length + group.length > MAX_SOURCES) continue;
      const first = group[0].mesh, geometry = new THREE.BufferGeometry();
      // A geometry view borrows immutable attribute backing stores. Only its
      // union bounds belong to this batch; original collider bounds never move.
      Object.keys(first.geometry.attributes).forEach(key => geometry.setAttribute(key, first.geometry.attributes[key]));
      if (first.geometry.index) geometry.setIndex(first.geometry.index);
      geometry.boundingBox = new THREE.Box3();
      const batch = new THREE.InstancedMesh(geometry, first.material, group.length);
      batch.name = 'Arquitectura · ' + group.length + ' superficies'; batch.userData.editorRuntimeHelper = true; batch.userData.staticArchitectureBatch = true;
      batch.raycast = () => {}; batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow; batch.renderOrder = first.renderOrder; batch.layers.mask = group[0].mask; batch.frustumCulled = true;
      group.forEach((source, index) => {
        const mesh = source.mesh, matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
        batch.setMatrixAt(index, matrix); if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox(); geometry.boundingBox.union(mesh.geometry.boundingBox.clone().applyMatrix4(matrix));
        source.originalGeometry = mesh.geometry; source.originalMaterial = mesh.material; source.ownerPose = pose(source.owner); source.meshPose = pose(mesh); source.behaviors = rawBehaviors(source.owner);
        source.renderState = [mesh.castShadow, mesh.receiveShadow, mesh.renderOrder, mesh.frustumCulled];
        for (let parent = source.owner.parent; parent; parent = parent.parent) if (!parents.has(parent)) { parents.add(parent); this.ancestors.push({object: parent, pose: pose(parent)}); }
      });
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere()); batch.instanceMatrix.needsUpdate = true;
      helper.add(batch); this.batches.push(batch);
      group.forEach(source => { source.mesh.layers.mask = 0; source.hidden = true; this.sources.push(source); });
    }
    if (!this.batches.length) { root.remove(helper); this.helper = null; }
    this.stats.architectureRebuilds++; this.dirty = false; this.updateStats();
  }
  updateStats() {
    this.stats.architectureSources = this.sources.length; this.stats.architectureBatches = this.batches.length;
    this.stats.architectureDrawCallsAvoided = this.sources.length - this.batches.length;
    this.stats.architectureInstanceBytes = this.sources.length * 16 * 4;
  }
  getStats() { return Object.assign({}, this.stats); }
  clear() {
    this.sources.forEach(source => { if (source.hidden && source.mesh.layers.mask === 0) source.mesh.layers.mask = source.mask; });
    this.batches.forEach(batch => {
      // Borrowed source buffers remain owned by their authored geometry. Only
      // this view and its private instance matrix may be disposed here.
      const geometry = batch.geometry;
      Object.keys(geometry.attributes).forEach(key => geometry.deleteAttribute(key));
      geometry.setIndex(null); geometry.dispose();
    });
    if (this.helper && this.helper.parent) this.helper.parent.remove(this.helper);
    this.sources = []; this.batches = []; this.helper = this.root = null; this.ancestors = []; this.objectCount = 0; this.dirty = true; this.updateStats();
    this.geometryKeys = new WeakMap(); this.materialKeys = new WeakMap(); this.textureIds = new WeakMap(); this.nextTexture = 1;
  }
  dispose() { this.clear(); this.disposed = true; this.geometryKeys = new WeakMap(); this.textureIds = new WeakMap(); this.materialKeys = new WeakMap(); }
}
