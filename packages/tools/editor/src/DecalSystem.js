import * as THREE from 'three';
import {DecalGeometry} from 'three/examples/jsm/geometries/DecalGeometry.js';
import {getGeometryTree} from '../../../render-three/src/GeometryAcceleration.js';
import wearSchema from '../../../render-three/schema/wear.js';

const MAX_INPUT_TRIANGLES = 100000;
const MAX_OUTPUT_VERTICES = 1000000;
const IDENTITY_STAMP = {position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1]};

function createMaterial(procedural) {
  const options = {transparent: true, alphaTest: 0.01, depthWrite: false, side: THREE.DoubleSide, dithering: true,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4};
  return procedural ? new THREE.MeshStandardMaterial(options) : new THREE.MeshBasicMaterial(options);
}

function matrixSignature(matrix) { return matrix.elements.map(value => Math.round(value * 1e8) / 1e8).join(','); }

function materialsOf(object) {
  return Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
}

function within(object, ancestor) {
  for (let node = object; node; node = node.parent) if (node === ancestor) return true;
  return false;
}

function protectedWearSurface(object) {
  for (let node = object; node; node = node.parent) {
    const data = node.userData || {};
    if (data.industrialDisplay || data.industrialButton || data.industrialSensorLamp || data.industrialTower || data.industrialSensorVolume) return true;
    if (/r[oó]tulo|etiqueta|leyenda|pantalla|baliza|piloto|c[oó]digo|identificaci[oó]n/i.test(node.name || '')) return true;
  }
  return false;
}

function versionOf(geometry) {
  const attributes = geometry.attributes || {};
  return [geometry.uuid, attributes.position && attributes.position.version,
    attributes.position && attributes.position.count, attributes.normal && attributes.normal.version,
    geometry.index && geometry.index.version, geometry.index && geometry.index.count,
    geometry.verticesNeedUpdate, geometry.drawRange && geometry.drawRange.start,
    geometry.drawRange && geometry.drawRange.count].join(':');
}

// AssetLibrary returns a private image plane, including Basis textures. Retain
// that resource off-scene, so cancellation/disposal has a single clear owner.
function disposeResource(root) {
  if (!root) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    materialsOf(object).forEach(material => {
      materials.add(material);
      Object.keys(material).forEach(key => {
        if (material[key] && material[key].isTexture) textures.add(material[key]);
      });
    });
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
}

// Project in the logical owner's local space. Relative surface changes clip
// again, while a layer and its moving parent retain their generated geometry.
export default class DecalSystem {
  constructor(ctx, document, library, notify) {
    this.ctx = ctx;
    this.document = document;
    this.library = library;
    this.notify = notify || (() => {});
    this.states = new Map();
    this.bounds = new WeakMap();
    this.worldBounds = new WeakMap();
    this.configurations = new WeakMap();
    this.converted = new WeakMap();
    this.convertedResources = new Set();
    this.stats = {behaviorReads: 0, boundsBuilds: 0, surfacePasses: 0, surfaceVisits: 0, candidateVisits: 0, projections: 0, textureBuilds: 0, inputTriangles: 0};
    this.roomId = null;
  }

  isSurface(object) {
    if (!object || !object.isMesh || !object.geometry || object.userData.editorGeometryReplaced) return false;
    for (let node = object; node; node = node.parent) {
      if (!node.visible || node.userData.editorHelper || node.userData.editorRuntimeHelper || node.userData.editorDecal) return false;
    }
    if (/^(sky|clouds|textMesh|foxr|mozillamr)$/i.test(object.name)) return false;
    const materials = materialsOf(object);
    if (!materials.length || materials.every(material => material.visible === false || material.opacity === 0)) return false;
    const geometry = object.geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    if (geometry.boundingSphere && geometry.boundingSphere.radius >= 100 && materials.some(material => material.side === THREE.BackSide)) return false;
    return Math.abs(object.matrixWorld.determinant()) > 1e-12;
  }

  _bounds(object) {
    const geometry = object.geometry, version = versionOf(geometry);
    let cached = this.bounds.get(geometry);
    if (!cached || cached.version !== version) {
      geometry.computeBoundingBox();
      cached = {version, box: geometry.boundingBox.clone()};
      this.bounds.set(geometry, cached);
    }
    let world = this.worldBounds.get(object);
    if (!world || world.geometry !== geometry || world.version !== version || !world.matrix.equals(object.matrixWorld)) {
      world = {geometry, version, matrix: object.matrixWorld.clone(), box: cached.box.clone().applyMatrix4(object.matrixWorld)};
      world.signature = [object.uuid, version, world.matrix.elements.join(',')].join('/');
      this.worldBounds.set(object, world);
      this.stats.boundsBuilds++;
    }
    return world;
  }

  _configuration(object) {
    // Most indexed nodes have no decal. Do not normalize every component on
    // every object at frame rate merely to discover those few projectors.
    const data = object.userData || {};
    const raw = (data.editorBehaviors || data.editorDefaultBehaviors || []).find(item => item.type === 'decal');
    if (!raw || raw.enabled === false) return null;
    let cached = this.configurations.get(object);
    const keys = Object.keys(raw);
    if (!cached || cached.keys.length !== keys.length || keys.some(key => cached.values[key] !== raw[key])) {
      this.stats.behaviorReads++;
      cached = {keys, values: Object.assign({}, raw), config: this.document.getBehaviors(object).find(item => item.type === 'decal' && item.enabled !== false)};
      this.configurations.set(object, cached);
    }
    return cached.config;
  }

  _create(owner) {
    const material = createMaterial(false);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.name = 'Decal';
    mesh.userData.editorRuntimeHelper = true;
    mesh.userData.editorDecal = true;
    mesh.userData.editorVisualOwnerId = owner.userData.editorId;
    mesh.renderOrder = 2;
    mesh.receiveShadow = true;
    mesh.visible = false;
    return {owner, mesh, material, pattern: 'image', asset: null, generation: 0, resource: null, proceduralTextures: [], textureKey: null, signature: null};
  }

  _releaseTexture(state) {
    ['map', 'roughnessMap', 'metalnessMap', 'bumpMap'].forEach(key => { state.material[key] = null; });
    state.material.needsUpdate = true;
    state.mesh.visible = false;
    disposeResource(state.resource);
    state.resource = null;
    state.proceduralTextures.forEach(texture => texture.dispose());
    state.proceduralTextures = [];
  }

  _pattern(state, pattern) {
    if (state.pattern === pattern) return;
    state.generation++;
    this._releaseTexture(state);
    if ((state.pattern === 'image') !== (pattern === 'image')) {
      state.material.dispose(); state.material = createMaterial(pattern !== 'image'); state.mesh.material = state.material;
    }
    state.pattern = pattern; state.asset = null; state.textureKey = null;
  }

  _loadWear(state, config) {
    const seed = config.seed === undefined ? 1 : config.seed;
    const density = config.wearDensity === undefined ? 0.65 : config.wearDensity;
    const key = [state.pattern, seed, density].join(':');
    if (state.textureKey === key) return;
    state.textureKey = key; state.generation++;
    this._releaseTexture(state);
    try {
      const pixels = wearSchema.generateWear(state.pattern, seed, density);
      const map = new THREE.DataTexture(pixels.data, pixels.width, pixels.height, THREE.RGBAFormat);
      const properties = new THREE.DataTexture(pixels.materialData, pixels.width, pixels.height, THREE.RGBAFormat);
      map.encoding = THREE.sRGBEncoding;
      [map, properties].forEach(texture => {
        texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
        const capabilities = this.ctx && this.ctx.renderer && this.ctx.renderer.capabilities;
        texture.anisotropy = capabilities && capabilities.getMaxAnisotropy ? Math.min(4, capabilities.getMaxAnisotropy()) : 1;
      });
      state.proceduralTextures = [map, properties];
      state.material.map = map; state.material.roughnessMap = properties; state.material.metalnessMap = properties; state.material.bumpMap = properties;
      state.material.bumpScale = wearSchema.patternDefaults[state.pattern].bumpScale;
      state.material.needsUpdate = true; state.mesh.visible = true;
      this.stats.textureBuilds++;
    } catch (error) { this.notify('No se pudo generar el desgaste. ' + error.message); }
  }

  _loadTexture(state, asset) {
    state.asset = asset;
    const generation = ++state.generation;
    this._releaseTexture(state);
    if (!asset) return;
    Promise.resolve().then(() => {
      const entry = this.library.getEntry(asset);
      if (entry && entry.kind !== 'image') throw new Error('Selecciona una imagen para el decal.');
      return this.library.instantiate(entry && entry.id ? {importId: entry.id} : {path: entry ? entry.path : asset});
    }).then(resource => {
      if (state.generation !== generation || !Array.from(this.states.values()).includes(state)) {
        disposeResource(resource);
        return;
      }
      let texture;
      resource.traverse(object => materialsOf(object).forEach(material => { texture = texture || material.map; }));
      if (!texture || !texture.isTexture) {
        disposeResource(resource);
        throw new Error('El archivo no contiene una textura de imagen.');
      }
      texture.encoding = THREE.sRGBEncoding;
      texture.needsUpdate = true;
      state.resource = resource;
      state.material.map = texture;
      state.material.needsUpdate = true;
      state.mesh.visible = true;
    }).catch(error => {
      if (state.generation !== generation || !Array.from(this.states.values()).includes(state)) return;
      this.notify('No se pudo cargar el decal. ' + (error.message || 'Comprueba la imagen.'));
    });
  }

  _disposeState(state) {
    state.generation++;
    if (state.mesh.parent) state.mesh.parent.remove(state.mesh);
    state.mesh.geometry.dispose();
    this._releaseTexture(state);
    state.material.dispose();
  }

  _project(state, config, root, surfaces) {
    const owner = state.owner;
    if (Math.abs(owner.matrixWorld.determinant()) < 1e-12) {
      if (state.signature !== 'degenerate') this._replaceGeometry(state, this._geometry([], [], []));
      state.signature = 'degenerate'; return;
    }
    const stampJSON = config.stamps || '[]';
    const projectorInputs = [config.width, config.height, config.depth, stampJSON];
    if (!state.projectorInputs || projectorInputs.some((value, index) => value !== state.projectorInputs[index])) {
      state.projectorInputs = projectorInputs; state.projectorKey = (state.projectorKey || 0) + 1;
      try {
        const stamps = wearSchema.normalizeStamps(stampJSON);
        state.projectors = (stamps.length ? stamps : [IDENTITY_STAMP]).map(stamp => {
          const position = new THREE.Vector3().fromArray(stamp.position), quaternion = new THREE.Quaternion().fromArray(stamp.quaternion);
          const size = new THREE.Vector3(config.width * stamp.scale[0], config.height * stamp.scale[1], config.depth * stamp.scale[2]);
          const matrix = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
          return {position, orientation: new THREE.Euler().setFromQuaternion(quaternion), normal: new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion), size,
            box: new THREE.Box3(size.clone().multiplyScalar(-0.5), size.clone().multiplyScalar(0.5)).applyMatrix4(matrix)};
        });
        state.projectionBox = new THREE.Box3(); state.projectionBox.makeEmpty();
        state.projectors.forEach(projector => state.projectionBox.union(projector.box));
        state.projectorError = false;
      } catch (error) {
        this.notify(error.message); this._replaceGeometry(state, this._geometry([], [], []));
        state.projectorError = true; return;
      }
    }
    if (state.projectorError) return;
    const target = config.targetId === 'self' ? owner : config.targetId ? this.document.getObject(config.targetId) : null;
    const inverseOwner = new THREE.Matrix4().getInverse(owner.matrixWorld);
    const candidates = [];
    surfaces.forEach(entry => {
      this.stats.candidateVisits++;
      const object = entry.object;
      if (state.pattern !== 'image' && protectedWearSurface(object)) return;
      if (target ? !within(object, target) : within(object, owner)) return;
      if (config.targetId && !target) return;
      const relative = new THREE.Matrix4().multiplyMatrices(inverseOwner, object.matrixWorld);
      const bounds = object.geometry.boundingBox.clone().applyMatrix4(relative);
      if (!bounds.intersectsBox(state.projectionBox)) return;
      candidates.push({object, relative, bounds, signature: [object.uuid, versionOf(object.geometry), matrixSignature(relative)].join('/')});
    });
    // Project in the owner's local coordinates. A parented wear layer follows
    // a moving machine without re-clipping an unchanged relative surface.
    const signature = [state.projectorKey, state.pattern === 'image' ? 'image' : 'wear', config.targetId, candidates.map(entry => entry.signature).join('|')].join(';');
    if (state.signature === signature) return;
    state.signature = signature; this.stats.projections++;
    const positions = [], normals = [], uvs = [], budget = {triangles: 0, exceeded: false};
    state.projectors.forEach((projector, stampIndex) => {
      if (budget.exceeded) return;
      candidates.forEach(entry => {
        if (budget.exceeded || !entry.bounds.intersectsBox(projector.box)) return;
        const inverseSurface = new THREE.Matrix4().getInverse(entry.relative);
        const localBox = projector.box.clone().applyMatrix4(inverseSurface);
        // A thin door can put both faces inside the projector's depth. Wear
        // belongs on faces pointing toward the brush, not on the back of it.
        const facing = state.pattern === 'image' ? null : projector.normal.clone().transformDirection(inverseSurface);
        const subset = this._nearbyGeometry(entry.object.geometry, localBox, budget, facing);
        if (budget.exceeded || !subset.attributes.position.count) { subset.dispose(); return; }
        const clipped = new DecalGeometry({geometry: subset, matrixWorld: entry.relative}, projector.position, projector.orientation, projector.size);
        subset.dispose();
        const attributes = clipped.attributes;
        if (positions.length / 3 + attributes.position.count > MAX_OUTPUT_VERTICES) { budget.exceeded = true; clipped.dispose(); return; }
        for (let index = 0; index < attributes.position.array.length; index++) positions.push(attributes.position.array[index]);
        for (let index = 0; index < attributes.normal.array.length; index++) normals.push(attributes.normal.array[index]);
        const turns = state.pattern === 'image' ? 0 : stampIndex % 4;
        for (let index = 0; index < attributes.uv.count; index++) {
          let u = attributes.uv.getX(index), v = attributes.uv.getY(index);
          for (let turn = 0; turn < turns; turn++) { const previous = u; u = 1 - v; v = previous; }
          uvs.push(u, v);
        }
        clipped.dispose();
      });
    });
    if (budget.exceeded) {
      this.notify('La pincelada supera el límite de geometría. Divide el trazo o reduce el tamaño de la brocha.');
      this._replaceGeometry(state, this._geometry([], [], []));
    } else this._replaceGeometry(state, this._geometry(positions, normals, uvs));
  }

  _nearbyGeometry(original, box, budget, facing = null) {
    let geometry = original;
    if (!geometry.isBufferGeometry) {
      const version = versionOf(original); let cached = this.converted.get(original);
      if (!cached || cached.version !== version) {
        if (cached) { cached.geometry.dispose(); this.convertedResources.delete(cached.geometry); }
        cached = {version, geometry: new THREE.BufferGeometry().fromGeometry(original)};
        this.converted.set(original, cached); this.convertedResources.add(cached.geometry);
      }
      geometry = cached.geometry;
    }
    const positions = [], normals = [], attribute = geometry.attributes.normal, face = new THREE.Vector3();
    const tree = getGeometryTree(geometry);
    if (tree) tree.query(box, (triangle, offset) => {
      if (budget.triangles >= MAX_INPUT_TRIANGLES) { budget.exceeded = true; return true; }
      budget.triangles++; this.stats.inputTriangles++;
      if (facing || !attribute) triangle.getNormal(face);
      if (facing && face.dot(facing) <= 1e-6) return false;
      [triangle.a, triangle.b, triangle.c].forEach((point, index) => {
        positions.push(point.x, point.y, point.z);
        const vertex = geometry.index ? geometry.index.getX(offset + index) : offset + index;
        if (attribute) normals.push(attribute.getX(vertex), attribute.getY(vertex), attribute.getZ(vertex));
        else normals.push(face.x, face.y, face.z);
      });
      return false;
    });
    return this._geometry(positions, normals, []);
  }

  _geometry(positions, normals, uvs) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
  }

  _replaceGeometry(state, geometry) {
    state.mesh.geometry.dispose();
    state.mesh.geometry = geometry;
    // An empty projection stays in its reusable state, outside the scene tree.
    // r112 Box3 expands an attached empty mesh's +/-Infinity bounds and makes
    // selection helpers NaN after a visual/typology no longer intersects wear.
    if (geometry.attributes.position.count) {
      if (state.mesh.parent !== state.owner) state.owner.add(state.mesh);
    } else if (state.mesh.parent) state.mesh.parent.remove(state.mesh);
  }

  sync(roomId) {
    roomId = String(roomId);
    if (this.roomId !== roomId) {
      this.dispose();
      this.roomId = roomId;
    }
    const root = this.document.getRoot(roomId);
    if (!root) return;
    const owners = this.document.getObjects(roomId).map(object => ({object, config: this._configuration(object)})).filter(entry => entry.config);
    const keep = new Set(owners.map(entry => entry.object));
    this.states.forEach((state, owner) => {
      if (!keep.has(owner)) { this._disposeState(state); this.states.delete(owner); }
    });
    if (!owners.length) return;
    const surfaceLists = new Map();
    this.stats.surfacePasses++;
    owners.forEach(({object: owner, config}) => {
      owner.updateWorldMatrix(true, false);
      const target = config.targetId === 'self' ? owner : config.targetId ? this.document.getObject(config.targetId) : root;
      // Most industrial brush layers target their own machine. They cannot
      // clip any other machine, wall or helper in the room, so share that
      // target's current surface inventory instead of scanning the entire room
      // for every layer. Unbound image projectors keep the global inventory.
      const surfaces = target && within(target, root) ? this._surfaces(target, surfaceLists) : [];
      let state = this.states.get(owner);
      if (!state) { state = this._create(owner); this.states.set(owner, state); }
      const pattern = config.pattern || 'image';
      this._pattern(state, pattern);
      if (pattern === 'image') { if (state.asset !== config.asset) this._loadTexture(state, config.asset || ''); }
      else {
        this._loadWear(state, config);
        const defaults = wearSchema.patternDefaults[pattern] || wearSchema.patternDefaults.rust;
        state.material.roughness = config.roughness === undefined ? defaults.roughness : config.roughness;
        state.material.metalness = config.metalness === undefined ? defaults.metalness : config.metalness;
      }
      state.material.opacity = config.opacity;
      state.material.color.set(config.color).convertSRGBToLinear();
      state.material.userData.studioColorSpace = 'linear';
      this._project(state, config, root, surfaces);
    });
  }

  _surfaces(target, lists) {
    if (lists.has(target)) return lists.get(target);
    target.updateWorldMatrix(true, true);
    const surfaces = [];
    target.traverse(object => { this.stats.surfaceVisits++; if (this.isSurface(object)) surfaces.push({object, bounds: this._bounds(object)}); });
    lists.set(target, surfaces);
    return surfaces;
  }

  dispose() {
    this.states.forEach(state => this._disposeState(state));
    this.states.clear();
    this.bounds = new WeakMap();
    this.worldBounds = new WeakMap();
    this.configurations = new WeakMap();
    this.convertedResources.forEach(geometry => geometry.dispose()); this.convertedResources.clear(); this.converted = new WeakMap();
    this.roomId = null;
  }
}
