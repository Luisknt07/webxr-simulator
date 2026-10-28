import * as THREE from 'three';
import materialSchema from '../../shared/materials.js';

const {normalizeMaterial} = materialSchema;
const DONE = Promise.resolve();
const MAP_FIELDS = {texture: 'map', normalMap: 'normalMap', roughnessMap: 'roughnessMap', metalnessMap: 'metalnessMap'};
const COPY_FIELDS = ['side', 'shadowSide', 'flatShading', 'vertexColors', 'fog', 'depthTest', 'depthWrite', 'alphaTest', 'premultipliedAlpha',
  'blending', 'blendSrc', 'blendDst', 'blendEquation', 'blendSrcAlpha', 'blendDstAlpha', 'blendEquationAlpha', 'dithering', 'toneMapped',
  'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'clipShadows', 'clipIntersection', 'clippingPlanes',
  'lightMap', 'lightMapIntensity', 'aoMap', 'aoMapIntensity', 'emissiveMap', 'emissiveIntensity', 'bumpMap', 'bumpScale', 'normalMapType',
  'displacementMap', 'displacementScale', 'displacementBias', 'alphaMap', 'envMap', 'envMapIntensity', 'refractionRatio',
  'reflectivity', 'clearcoatNormalMap',
  'wireframe', 'wireframeLinewidth', 'wireframeLinecap', 'wireframeLinejoin', 'skinning', 'morphTargets', 'morphNormals'];
let sequence = 0;

function materials(object) { return Array.isArray(object.material) ? object.material : object.material ? [object.material] : []; }
function authoredColor(material) {
  if (!material.userData || material.userData.studioColorSpace !== 'linear') return material.color.getHexString();
  const colour = material.color.clone().convertLinearToSRGB();
  // r112's getHex truncates a channel at 254 when the transfer function gives
  // 0.9999999999999999. Quantize once to the nearest authored 8-bit value.
  return [colour.r, colour.g, colour.b].map(value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0')).join('');
}
function within(object, parent) { for (let node = object; node; node = node.parent) if (node === parent) return true; return false; }
function shaderMaterial(material) { return !material || material.isShaderMaterial || material.isRawShaderMaterial; }
function protectedObject(object, allowButton = false) {
  if (!object.isMesh || !object.geometry || object.userData.editorGeometryReplaced) return true;
  for (let node = object; node; node = node.parent) {
    const data = node.userData || {};
    if (data.editorHelper || data.editorRuntimeHelper || data.editorDecal || data.industrialDisplay || data.industrialButton && !allowButton ||
      data.industrialSensorLamp || data.industrialSensorVolume || data.industrialTower) return true;
    if (/^(?:textMesh|sky|clouds|foxr|mozillamr)$/i.test(node.name) || /(?:r[oó]tulo|etiqueta|identificaci[oó]n del tablero)/i.test(node.name)) return true;
  }
  return false;
}
function meshPath(object, owner) {
  const indices = [];
  for (let node = object; node && node !== owner; node = node.parent) {
    if (!node.parent) return null;
    indices.unshift(node.parent.children.indexOf(node));
  }
  return within(object, owner) ? indices.length ? indices.join('.') : 'root' : null;
}
function canTarget(object, owner, slot) {
  return !protectedObject(object, owner.userData.editorPrefabKey === 'control' && slot.startsWith('mesh:'));
}
function slotMatches(slot, object, material, index, owner) {
  if (slot === 'all') return true;
  if (slot.startsWith('index:')) return index === Number(slot.slice(6));
  if (slot.startsWith('name:')) return material.name === slot.slice(5);
  if (slot.startsWith('mesh:')) return slot === 'mesh:' + meshPath(object, owner) + ':' + index;
  if (slot.startsWith('part:')) for (let node = object; node; node = node.parent) {
    if (node.name === slot.slice(5)) return true;
    if (node === owner) break;
  }
  return false;
}
function cloneTexture(source, config, color, flipY) {
  const copy = source.clone();
  // Texture.clone in r112 omits DataTexture/CompressedTexture flags. Keep their
  // upload path and mipmaps while giving the customization a private GPU owner.
  if (source.isDataTexture) copy.isDataTexture = true;
  if (source.isCompressedTexture) copy.isCompressedTexture = true;
  if (source.isCubeTexture) copy.isCubeTexture = true;
  copy.image = source.image;
  copy.userData = Object.assign({}, source.userData || {});
  copy.mipmaps = source.mipmaps ? source.mipmaps.slice() : [];
  copy.encoding = color ? source.encoding : THREE.LinearEncoding;
  if (flipY !== undefined) copy.flipY = flipY;
  copy.repeat.set(source.repeat.x * config.repeatX, source.repeat.y * config.repeatY);
  if (config.repeatX !== 1) copy.wrapS = THREE.RepeatWrapping;
  if (config.repeatY !== 1) copy.wrapT = THREE.RepeatWrapping;
  copy.needsUpdate = true; return copy;
}
function disposeResource(root) {
  if (!root) return;
  const geometries = new Set(), ownedMaterials = new Set(), textures = new Set();
  root.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    materials(node).forEach(material => { ownedMaterials.add(material); Object.keys(material).forEach(key => { if (material[key] && material[key].isTexture) textures.add(material[key]); }); });
  });
  geometries.forEach(value => value.dispose()); ownedMaterials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
}
function hash(x, y, seed) {
  let value = Math.imul(x + 1709, 374761393) ^ Math.imul(y + 741, 668265263) ^ Math.imul(seed + 19, 1274126177);
  value = Math.imul(value ^ value >>> 13, 1274126177); return ((value ^ value >>> 16) >>> 0) / 4294967295;
}
function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy;
  const a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
  return (hash(ix, iy, seed) * (1 - a) + hash(ix + 1, iy, seed) * a) * (1 - b) +
    (hash(ix, iy + 1, seed) * (1 - a) + hash(ix + 1, iy + 1, seed) * a) * b;
}
function dataTexture(data, width, height, color) {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.encoding = color ? THREE.sRGBEncoding : THREE.LinearEncoding;
  texture.needsUpdate = true; return texture;
}
function proceduralBase(config) {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = hash(x, y, config.seed), broad = noise(x / 18, y / 18, config.seed);
    let value = 0.94 + n * 0.06;
    if (config.preset === 'wood') value = 0.72 + 0.23 * (0.5 + 0.5 * Math.sin(y * 0.24 + noise(x / 35, y / 28, config.seed) * 8)) + n * 0.05;
    else if (config.preset === 'steel' || config.preset === 'aluminum') value = 0.89 + noise(x / 38, y * 1.7, config.seed) * 0.075 + n * .025;
    else if (config.preset === 'concrete') value = 0.94 + broad * 0.035 + n * 0.025;
    else if (config.preset === 'rubber') value = 0.87 + broad * 0.07 + n * 0.06;
    const offset = (y * size + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = Math.round(value * 255); data[offset + 3] = 255;
  }
  const texture = dataTexture(data, size, size, true); texture.repeat.set(config.repeatX, config.repeatY); return texture;
}
function proceduralWear(config) {
  const size = 128, data = new Uint8Array(size * size * 4);
  const color = new THREE.Color(config.wearType === 'rust' ? '#a54a21' : config.wearType === 'dirt' ? '#65543b' :
    config.preset === 'wood' ? '#d6b079' : config.wearType === 'chips' ? '#b6bfc5' : '#d3d9dd').convertSRGBToLinear();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const broad = noise(x / 19, y / 19, config.seed), fine = hash(x, y, config.seed + 7), medium = noise(x / 3.5, y / 3.5, config.seed + 3);
    let alpha, shade = .60 + medium * .32 + fine * .16;
    if (config.wearType === 'scratches') {
      // Broken, slightly wandering abrasion rather than uniform white stripes.
      const track = Math.floor((y + noise(x / 26, y / 8, config.seed + 91) * 2.4) / 1.4);
      const line = hash(Math.floor(x / 42), track, config.seed) > .955;
      alpha = line ? (.52 + fine * .48) * Math.max(0, (noise(x / 9, y / 2, config.seed + 5) - .19) * 1.8) : 0;
      shade = .68 + fine * .32;
    } else if (config.wearType === 'chips') {
      const islands = broad * .62 + medium * .38;
      alpha = Math.max(0, Math.min(1, (islands - .58) * 11)) * (.65 + fine * .35);
      shade = islands > .70 ? .85 + fine * .15 : .43 + fine * .2;
    } else if (config.wearType === 'rust') {
      alpha = Math.max(0, Math.min(1, (broad * .72 + medium * .28 - .38) * 3.3)) * (.6 + fine * .4);
      shade = .37 + broad * .49 + medium * .37;
    } else {
      const runoff = noise(x / 6, y / 45, config.seed + 21);
      alpha = Math.max(0, Math.min(1, (broad * .7 + runoff * .3 - .31) * 2.4)) * (.62 + medium * .38);
    }
    const offset = (y * size + x) * 4;
    data[offset] = Math.round(Math.min(1, color.r * shade) * 255); data[offset + 1] = Math.round(Math.min(1, color.g * shade) * 255); data[offset + 2] = Math.round(Math.min(1, color.b * shade) * 255); data[offset + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  }
  return dataTexture(data, size, size, false);
}
function proceduralProperties(config) {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fine = hash(x, y, config.seed), broad = noise(x / 12, y / 12, config.seed), medium = noise(x / 3, y / 3, config.seed + 17);
    const brushed = config.preset === 'steel' || config.preset === 'aluminum';
    const height = brushed ? noise(x / 32, y * 1.6, config.seed) : config.preset === 'paintedMetal' ? medium * .72 + fine * .28 : fine * .4 + broad * .6;
    const index = (y * size + x) * 4;
    data[index] = Math.round((.43 + height * .14) * 255);
    data[index + 1] = Math.round((brushed ? .62 + height * .30 + fine * .08 : config.preset === 'paintedMetal' ? .76 + medium * .18 + fine * .06 : .84 + broad * .10 + fine * .06) * 255);
    data[index + 2] = data[index + 3] = 255;
  }
  const texture = dataTexture(data, size, size, false);
  texture.repeat.set(config.repeatX, config.repeatY); return texture;
}
function installWear(material, original, config, texture) {
  // Keep shader-owned samplers discoverable by GPU accounting and eviction.
  // This runtime field is deliberately outside serializable userData.
  material.surfaceWearMap = texture;
  const before = original.onBeforeCompile;
  const source = before ? before.toString() : '';
  let key = 0; for (let index = 0; index < source.length; index++) key = Math.imul(key, 31) + source.charCodeAt(index) | 0;
  material.defines.SURFACE_BASE_SHADER = key >>> 0;
  material.defines.SURFACE_WEAR = 1;
  const independentUV = !['map', 'bumpMap', 'normalMap', 'alphaMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'clearcoatNormalMap'].some(key => material[key]);
  material.onBeforeCompile = function(shader, renderer) {
    if (before) before.call(this, shader, renderer);
    Object.assign(shader.uniforms, {
      surfaceWearMap: {value: texture}, surfaceWearStrength: {value: config.wear}, surfaceWearScale: {value: config.wearScale},
      surfaceWearRepeat: {value: new THREE.Vector2(config.repeatX, config.repeatY)},
      surfaceWearRoughness: {value: config.wearType === 'scratches' ? 0.4 : 0.92},
      surfaceWearMetalness: {value: ['rust', 'dirt'].includes(config.wearType) || config.metalness < 0.25 ? 0 : 0.7}
    });
    if (independentUV) {
      shader.vertexShader = 'uniform vec2 surfaceWearRepeat;\nvarying vec2 surfaceWearUv;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nsurfaceWearUv = uv * surfaceWearRepeat;');
      shader.fragmentShader = 'varying vec2 surfaceWearUv;\n' + shader.fragmentShader;
    }
    shader.fragmentShader = 'uniform sampler2D surfaceWearMap;\nuniform float surfaceWearStrength;\nuniform float surfaceWearScale;\nuniform float surfaceWearRoughness;\nuniform float surfaceWearMetalness;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nvec4 surfaceWearSample = texture2D(surfaceWearMap, ' + (independentUV ? 'surfaceWearUv' : 'vUv') + ' * surfaceWearScale);\nfloat surfaceWearMask = surfaceWearSample.a * surfaceWearStrength;\ndiffuseColor.rgb = mix(diffuseColor.rgb, surfaceWearSample.rgb, surfaceWearMask);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, surfaceWearRoughness, surfaceWearMask);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, surfaceWearMetalness, surfaceWearMask);');
  };
}

function preparedConcreteFloor(state, original) {
  const config = state.config, owner = state.owner, data = owner.userData || {};
  // This optional presentation belongs only to the generated neutral floor.
  // Imported albedo, an edited colour/name/slot, and explicit map removal keep
  // their authored result; walls and other concrete objects are never opted in.
  return config.preset === 'concrete' && config.color === '#777c76' && config.colorMapMode === 'preserve' && config.slot === 'all' &&
    ['Material personalizado', 'Hormigón'].includes(config.name) && !Object.keys(MAP_FIELDS).some(field => config[field]) && !original.map && !data.editorGeometryReplaced &&
    !data.editorColor && !data.editorVisualOwnerId && /(?:^|[·\s])piso\b/i.test(owner.name || '') && /hormig[oó]n/i.test(owner.name || '');
}
function installPreparedConcrete(material) {
  const before = material.onBeforeCompile;
  const uniforms = {preparedConcreteMap: {value: null}, preparedConcreteMean: {value: new THREE.Vector3(1, 1, 1)}, preparedConcreteStrength: {value: 0}};
  material.defines.SURFACE_PREPARED_CONCRETE = 1;
  // Keep a discoverable texture reference for the periodic resource estimator;
  // this is derived runtime state, never serialized into the document/userData.
  material.preparedConcreteUniforms = uniforms;
  material.onBeforeCompile = function(shader, renderer) {
    if (before) before.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = 'uniform sampler2D preparedConcreteMap;\nuniform vec3 preparedConcreteMean;\nuniform float preparedConcreteStrength;\n' + shader.fragmentShader;
    // A custom sampler must decode sRGB explicitly in r112. Dividing by the
    // measured *linear* mean preserves the authored physical base reflectance,
    // instead of multiplying middle gray by a second dark gray image.
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nif (preparedConcreteStrength > 0.0) {\nvec3 preparedConcreteAlbedo = sRGBToLinear(texture2D(preparedConcreteMap, vUv)).rgb;\nvec3 preparedConcreteDetail = clamp(preparedConcreteAlbedo / preparedConcreteMean, vec3(0.65), vec3(1.4));\ndiffuseColor.rgb *= mix(vec3(1.0), preparedConcreteDetail, preparedConcreteStrength);\n}');
  };
  return uniforms;
}

/** Private PBR customization; the document stores only its typed behavior. */
export default class SurfaceMaterialSystem {
  constructor(ctx, document, library, notify) {
    this.ctx = ctx || {}; this.document = document; this.library = library; this.notify = notify || (() => {});
    this.states = new Map(); this.meshBindings = new WeakMap(); this.owned = new WeakSet(); this.configurations = new WeakMap();
    this.proceduralPool = new Map(); this.pooledTextures = new WeakSet();
    this.dirty = true; this.roomId = null; this.ready = DONE;
    this.stats = {scans: 0, applications: 0, textureLoads: 0, proceduralPoolHits: 0, proceduralTextures: 0, proceduralReferences: 0};
  }

  invalidate() { this.dirty = true; this.configurations = new WeakMap(); }
  isOwnedMaterial(material) { return !!material && this.owned.has(material); }
  _derived(material, state) { return !!material && material.userData && material.userData.surfaceMaterialBinding === state.id; }
  _configuration(object) {
    const data = object.userData || {};
    const raw = (data.editorBehaviors || data.editorDefaultBehaviors || []).find(item => item.type === 'surfaceMaterial' && item.enabled !== false);
    const cached = this.configurations.get(object);
    if (cached && cached.raw === raw) return cached.config;
    const config = raw ? normalizeMaterial(raw) : null;
    this.configurations.set(object, {raw, config}); return config;
  }
  _originals(mesh) {
    const binding = this.meshBindings.get(mesh), current = materials(mesh);
    return binding && current.every(material => Array.from(binding.states).some(state => this._derived(material, state)) || binding.originals.includes(material)) ? binding.originals : current;
  }
  _alive(state) { return this.states.get(state.owner) === (state.root || state) && String(this.roomId) === String(state.roomId); }

  _dispose(state) {
    state.meshes.forEach((entry, mesh) => {
      const current = materials(mesh);
      if (current.some(material => this._derived(material, state))) {
        const restored = current.map((material, index) => this._derived(material, state) ? entry.originals[index] : material);
        mesh.material = restored.every((material, index) => material === entry.originals[index]) ? entry.binding.original : Array.isArray(mesh.material) ? restored : restored[0];
      }
      entry.binding.states.delete(state);
      if (!entry.binding.states.size && this.meshBindings.get(mesh) === entry.binding) this.meshBindings.delete(mesh);
    });
    state.groups.forEach(group => {
      group.generation++;
      if (group.preparedTicket) group.preparedTicket.release();
      if (group.preparedBindings) group.preparedBindings.forEach(uniforms => { uniforms.preparedConcreteMap.value = null; uniforms.preparedConcreteStrength.value = 0; });
      group.materials.forEach(material => material.dispose());
      group.textures.forEach(texture => { if (!this.pooledTextures.has(texture)) texture.dispose(); });
      group.resources.forEach(resource => disposeResource(resource));
    });
    // Immutable procedural maps can be shared across equipment/architecture.
    // Each owner holds one reference per exact pixel/sampler recipe, and the
    // last owner releases the GPU allocation immediately (no unbounded cache).
    if (state.procedural) state.procedural.forEach((texture, key) => {
      const entry = this.proceduralPool.get(key);
      if (!entry || entry.texture !== texture) return;
      entry.references--; this.stats.proceduralReferences--;
      if (!entry.references) { texture.dispose(); this.proceduralPool.delete(key); }
    });
    this.stats.proceduralTextures = this.proceduralPool.size;
  }

  dispose() {
    this.states.forEach(state => this._dispose(state)); this.states.clear();
    this.dirty = true; this.roomId = null; this.ready = DONE;
  }

  _cloneTexture(state, source, color, flipY) {
    // Native drawing/video/render-target surfaces own their update lifecycle.
    // Borrow them without changing UV settings: cloning would freeze updates
    // driven by the original texture's version or framebuffer attachment.
    if (source.isCanvasTexture || source.isVideoTexture || source.isRenderTargetTexture) return source;
    const key = source.uuid + ':' + color + ':' + String(flipY);
    if (!state.textureCopies.has(key)) {
      const texture = cloneTexture(source, state.config, color, flipY);
      state.textureCopies.set(key, texture); state.textures.add(texture);
    }
    return state.textureCopies.get(key);
  }

  _makeMaterial(state, original) {
    if (state.copies.has(original)) return state.copies.get(original);
    const config = state.config, material = new THREE.MeshPhysicalMaterial();
    COPY_FIELDS.forEach(key => { if (original[key] !== undefined) material[key] = original[key]; });
    if (original.emissive) material.emissive.copy(original.emissive);
    if (state.config.emissiveMode === 'custom') { material.emissive.set(state.config.emissive).convertSRGBToLinear(); material.emissiveIntensity = state.config.emissiveIntensity; }
    if (original.normalScale) material.normalScale.copy(original.normalScale);
    if (config.normalMap && Number.isFinite(config.normalStrength)) material.normalScale.set(config.normalStrength, config.normalStrength);
    else if (Number.isFinite(config.normalStrength)) material.normalScale.multiplyScalar(config.normalStrength);
    if (original.clearcoatNormalScale) material.clearcoatNormalScale.copy(original.clearcoatNormalScale);
    if (original.sheen) material.sheen = original.sheen.clone();
    material.visible = original.visible; material.name = config.name;
    // Typed document colours come from HTML colour inputs (sRGB). r112's
    // Color.set(hex) only divides bytes by 255; it does not decode sRGB. PBR
    // lighting and the renderer's final sRGB encoding require linear inputs.
    // Decode once here; image maps already decode through their encoding and
    // preserved native emission/maps keep their own established colour space.
    material.color.set(config.color).convertSRGBToLinear(); material.metalness = config.metalness; material.roughness = config.roughness;
    material.opacity = config.opacity; material.transparent = config.opacity < 1 || original.transparent;
    if (config.opacity < 1) material.depthWrite = false;
    material.clearcoat = config.clearcoat; material.clearcoatRoughness = config.clearcoatRoughness;
    material.dithering = true;
    material.userData = {surfaceMaterialBinding: state.id, studioColorSpace: 'linear'};
    material.defines = Object.assign({}, original.defines || {}, {STANDARD: '', PHYSICAL: ''});
    ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach(key => {
      if (key === 'map' && config.colorMapMode === 'none') return;
      if (original[key] && original[key].isTexture) material[key] = this._cloneTexture(state, original[key], key === 'map');
    });
    if (config.colorMapMode !== 'none' && !material.map && (config.preset !== 'custom' && config.preset !== 'glass' || config.wear > 0)) {
      if (!state.base) state.base = this._procedural(state, 'base', proceduralBase);
      material.map = state.base;
    }
    // Fine brushed/paint/rubber detail uses bounded maps rather than extra
    // bolts or cable polygons. Original/imported property maps keep priority.
    if (['steel', 'aluminum', 'paintedMetal', 'rubber', 'concrete', 'plastic', 'wood'].includes(config.preset) && (!material.roughnessMap || !material.bumpMap)) {
      const properties = this._procedural(state, 'properties', proceduralProperties);
      if (!material.roughnessMap) material.roughnessMap = properties;
      // Large concrete floors span hundreds of metres of repeated UVs. Keep
      // their aggregate in albedo/roughness; finite-difference bump aliases at
      // shallow view angles on r112, especially under the directional key.
      if (!material.bumpMap && !material.normalMap && config.preset !== 'concrete') { material.bumpMap = properties; material.bumpScale = config.preset === 'rubber' ? .0011 : config.preset === 'paintedMetal' ? .00045 : .0007; }
    }
    if (config.wear > 0) {
      if (!state.wear) state.wear = this._procedural(state, 'wear', proceduralWear);
      installWear(material, original, config, state.wear);
    } else material.onBeforeCompile = original.onBeforeCompile;
    if (this.ctx.preparedMaterials && preparedConcreteFloor(state, original)) this._prepareConcrete(state, material);
    if (original.onBeforeCompile === THREE.Material.prototype.onBeforeCompile) material.staticInstanceBatchShader = material.onBeforeCompile;
    // Only generated, static architectural boxes with the standard base shader
    // opt into semantic batching. Unknown imported/custom shader callbacks keep
    // their independent draw. The batcher also compares all live material maps,
    // render flags and UV transforms, so asynchronous or edited maps diverge.
    if (/^CEDI\s*\u00b7\s*/u.test(state.owner.name || '') && state.owner.userData.editorDescriptor &&
      state.owner.userData.editorDescriptor.type === 'box' && original.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && !material.preparedConcreteUniforms) {
      material.userData.staticArchitectureBatchKey = JSON.stringify(config);
      material.staticArchitectureBatchShader = material.onBeforeCompile;
    }
    this.owned.add(material); state.materials.add(material); state.copies.set(original, material);
    return material;
  }

  _prepareConcrete(state, material) {
    const uniforms = installPreparedConcrete(material);
    if (!state.preparedBindings) state.preparedBindings = new Set(); state.preparedBindings.add(uniforms);
    const apply = value => { uniforms.preparedConcreteMap.value = value ? value.texture : null; uniforms.preparedConcreteStrength.value = value ? .85 : 0; if (value) uniforms.preparedConcreteMean.value.copy(value.mean); };
    if (state.preparedValue) apply(state.preparedValue);
    if (!state.preparedTicket) {
      const generation = state.generation;
      state.preparedTicket = this.ctx.preparedMaterials.acquireConcrete(value => {
        if (!this._alive(state) || state.generation !== generation) return;
        state.preparedValue = value;
        state.preparedBindings.forEach(binding => { binding.preparedConcreteMap.value = value ? value.texture : null; binding.preparedConcreteStrength.value = value ? .85 : 0; if (value) binding.preparedConcreteMean.value.copy(value.mean); });
      });
    }
  }

  _procedural(state, kind, create) {
    const owner = state.root || state, config = state.config;
    if (!owner.procedural) owner.procedural = new Map();
    const capabilities = this.ctx.renderer && this.ctx.renderer.capabilities;
    const anisotropy = capabilities && capabilities.getMaxAnisotropy ? Math.min(4, capabilities.getMaxAnisotropy()) : 1;
    const key = JSON.stringify([kind, config.preset, config.seed, config.repeatX, config.repeatY,
      kind === 'wear' ? config.wearType : '', anisotropy]);
    if (!owner.procedural.has(key)) {
      let entry = this.proceduralPool.get(key);
      if (entry) this.stats.proceduralPoolHits++;
      else {
        const texture = create(config); texture.anisotropy = anisotropy;
        entry = {texture, references: 0}; this.proceduralPool.set(key, entry); this.pooledTextures.add(texture);
      }
      entry.references++; this.stats.proceduralReferences++;
      owner.procedural.set(key, entry.texture); owner.textures.add(entry.texture);
      this.stats.proceduralTextures = this.proceduralPool.size;
    }
    return owner.procedural.get(key);
  }

  _load(state, field, asset) {
    if (field === 'texture' && state.config.colorMapMode === 'none') return DONE;
    if (!asset || !this.library || !this.library.instantiate) return DONE;
    const ownerState = state.root || state;
    const generation = state.generation;
    if (!ownerState.loads.has(asset)) {
      this.stats.textureLoads++;
      ownerState.loads.set(asset, Promise.resolve().then(() => {
        const entry = this.library.getEntry && this.library.getEntry(asset);
        if (entry && entry.kind !== 'image') throw new Error('Selecciona una imagen para el mapa del material.');
        return this.library.instantiate(entry && entry.id ? {importId: entry.id} : {path: entry ? entry.path : asset});
      }).then(resource => {
        if (!this._alive(state) || state.generation !== generation) { disposeResource(resource); return null; }
        let source;
        resource.traverse(node => materials(node).forEach(material => { if (!source && material.map && material.map.isTexture) source = material.map; }));
        if (!source) { disposeResource(resource); throw new Error('El archivo no contiene una textura.'); }
        ownerState.resources.add(resource); return source;
      }));
    }
    return ownerState.loads.get(asset).then(source => {
      if (!source || !this._alive(state) || state.generation !== generation) return;
      state.copies.forEach((material, original) => {
        const flipY = original.map ? original.map.flipY : original.normalMap ? original.normalMap.flipY : source.flipY;
        const texture = this._cloneTexture(state, source, field === 'texture', flipY);
        if (field === 'texture') texture.encoding = THREE.sRGBEncoding;
        material[MAP_FIELDS[field]] = texture; material.needsUpdate = true;
      });
    }).catch(error => {
      if (!this._alive(state) || state.generation !== generation) return;
      ownerState.failed = true;
      if (!ownerState.reported.has(asset)) { ownerState.reported.add(asset); this.notify('No se pudo cargar el mapa del material. ' + (error.message || 'Comprueba la imagen.')); }
    });
  }

  getSlots(owner) {
    const result = [{value: 'all', label: 'Todas las superficies compatibles'}], seen = new Set(['all']);
    let compatible = false;
    const add = (value, label) => { if (!seen.has(value) && value.length <= 220) { seen.add(value); result.push({value, label}); } };
    owner.traverse(mesh => {
      const buttonOnly = protectedObject(mesh);
      if (protectedObject(mesh, owner.userData.editorPrefabKey === 'control')) return;
      const originals = this._originals(mesh);
      if (!originals.some(material => !shaderMaterial(material))) return;
      compatible = true;
      originals.forEach((material, index) => {
        if (shaderMaterial(material)) return;
        if (!buttonOnly && material.name) add('name:' + material.name, 'Material: ' + material.name);
        const selector = 'mesh:' + meshPath(mesh, owner) + ':' + index;
        add(selector, (buttonOnly ? 'Pulsador: ' : 'Superficie: ') + (mesh.name || 'Malla ' + meshPath(mesh, owner)) + (originals.length > 1 ? ' / material ' + (index + 1) : '') + ' [' + meshPath(mesh, owner) + ']');
      });
      if (!buttonOnly) for (let node = mesh; node && node !== owner; node = node.parent) if (node.name) add('part:' + node.name, 'Parte: ' + node.name);
    });
    return compatible ? result : [];
  }

  getSlotDefaults(owner, slot) {
    let result = null;
    owner.traverse(mesh => {
      if (result || !canTarget(mesh, owner, slot)) return;
      this._originals(mesh).some((material, index) => {
        if (shaderMaterial(material) || !slotMatches(slot, mesh, material, index, owner)) return false;
        const values = {slot, name: material.name || materialSchema.defaults.name};
        if (material.color) values.color = '#' + authoredColor(material);
        ['metalness', 'roughness', 'opacity', 'clearcoat', 'clearcoatRoughness'].forEach(key => {
          if (typeof material[key] === 'number' && Number.isFinite(material[key])) values[key] = Math.max(0, Math.min(1, material[key]));
        });
        result = normalizeMaterial(values); return true;
      });
    });
    return result && materialSchema.assignments(result)[0];
  }

  sync(roomId) {
    roomId = String(roomId);
    if (this.roomId !== roomId) { this.dispose(); this.roomId = roomId; }
    if (!this.dirty) {
      // Cheap checks on customized meshes detect a mechanical rebuild without
      // scanning every unrelated object or mistaking IndustrialVisuals clones
      // for authored material changes.
      for (const state of this.states.values()) {
        if (this._configuration(state.owner) !== state.config) { this.dirty = true; break; }
        for (const [mesh, entry] of state.meshes) if (!within(mesh, state.owner) || mesh.geometry !== entry.geometry || mesh.userData.editorGeometryReplaced ||
          !materials(mesh).every(material => Array.from(entry.binding.states).some(bound => this._derived(material, bound)) || entry.originals.includes(material))) { this.dirty = true; break; }
        if (this.dirty) break;
      }
      if (!this.dirty) return this.ready;
    }
    this.stats.scans++;
    const owners = new Map(), objects = this.document.getObjects(roomId), root = this.document.getRoot(roomId);
    objects.forEach(owner => { const config = this._configuration(owner); if (config) owners.set(owner, config); });
    const desired = new Map(Array.from(owners.keys(), owner => [owner, []]));
    const ownerAssignments = new Map(Array.from(owners, ([owner, config]) => [owner, materialSchema.assignments(config)]));
    if (root) root.traverse(mesh => {
      if (protectedObject(mesh, true)) return;
      const originals = this._originals(mesh), rows = new Map();
      originals.forEach((material, index) => {
        if (shaderMaterial(material)) return;
        for (let owner = mesh; owner; owner = owner.parent) {
          const assignments = ownerAssignments.get(owner);
          if (!assignments) continue;
          let selected = -1;
          assignments.forEach((config, assignment) => {
            if (config.enabled !== false && canTarget(mesh, owner, config.slot) && slotMatches(config.slot, mesh, material, index, owner)) selected = assignment;
          });
          if (selected < 0) continue;
          if (!rows.has(owner)) rows.set(owner, {mesh, originals, selected: originals.map(() => -1)});
          rows.get(owner).selected[index] = selected;
          break;
        }
      });
      rows.forEach((row, owner) => desired.get(owner).push(row));
    });
    this.states.forEach((state, owner) => {
      const rows = desired.get(owner), config = owners.get(owner);
      const unchanged = config && !state.failed && JSON.stringify(config) === state.signature && rows.length === state.meshes.size && rows.every(row => {
        const old = state.meshes.get(row.mesh); return old && old.geometry === row.mesh.geometry && old.originals.length === row.originals.length && old.originals.every((material, index) => material === row.originals[index]) && old.selected.every((value, index) => value === row.selected[index]);
      });
      if (!unchanged) { this._dispose(state); this.states.delete(owner); }
      else state.config = config;
    });
    const pending = [];
    desired.forEach((rows, owner) => {
      if (this.states.has(owner) || !rows.length) return;
      const config = owners.get(owner), state = {id: 'surface-' + (++sequence), roomId, owner, config, signature: JSON.stringify(config), generation: 0, meshes: new Map(), copies: new Map(), materials: new Set(), textures: new Set(), textureCopies: new Map(), resources: new Set(), loads: new Map(), reported: new Set(), failed: false};
      state.groups = [state].concat(ownerAssignments.get(owner).slice(1).map(assignment => ({id: state.id, roomId, owner, root: state, config: assignment, generation: 0, copies: new Map(), materials: new Set(), textures: new Set(), textureCopies: new Map(), resources: new Set(), loads: new Map(), reported: new Set()})));
      this.states.set(owner, state);
      rows.forEach(row => {
        const values = materials(row.mesh).map((material, index) => row.selected[index] >= 0 ? this._makeMaterial(state.groups[row.selected[index]], row.originals[index]) : material);
        let binding = this.meshBindings.get(row.mesh);
        if (!binding) { binding = {original: row.mesh.material, originals: row.originals, states: new Set()}; this.meshBindings.set(row.mesh, binding); }
        binding.states.add(state);
        const installed = Array.isArray(row.mesh.material) ? values : values[0];
        const entry = {state, binding, originals: row.originals, installed, geometry: row.mesh.geometry, selected: row.selected};
        state.meshes.set(row.mesh, entry); row.mesh.material = installed;
        this.stats.applications++;
      });
      state.groups.forEach(group => {
        if (group.preparedTicket) pending.push(group.preparedTicket.ready);
        if (group.copies.size) Object.keys(MAP_FIELDS).forEach(field => { if (group.config[field]) pending.push(this._load(group, field, group.config[field])); });
      });
    });
    this.dirty = false; this.ready = pending.length ? Promise.all(pending).then(() => undefined) : DONE;
    return this.ready;
  }
}
