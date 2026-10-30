'use strict';

// Derived architecture detail, shared by the public viewer and Workspace.
// As in SurfaceMaterialSystem, immutable seeded pixels are pooled; this smaller
// presentation uses two packed maps and metre coordinates instead of per-mesh
// repeats, so long walls and a grazing floor do not stretch or glitter in XR.
const SIZE = 512, PERIOD_M = 4;
const STANDARD = {floor: new Set(['#657071', '#777c76']), wall: new Set(['#777e80', '#858981'])};
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function hash(x, y, seed) {let h = Math.imul(x + 1709, 374761393) ^ Math.imul(y + 741, 668265263) ^ Math.imul(seed + 19, 1274126177); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967295;}
function noise(x, y, seed, period) {
  const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
  const wrap = n => (n % period + period) % period, h = (xx, yy) => hash(wrap(xx), wrap(yy), seed);
  return (h(ix, iy) * (1 - a) + h(ix + 1, iy) * a) * (1 - b) + (h(ix, iy + 1) * (1 - a) + h(ix + 1, iy + 1) * a) * b;
}
function pixels(kind, size = SIZE) {
  const data = new Uint8Array(size * size * 4), wall = kind === 'wall', seed = wall ? 71 : 29;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, broad = noise(u * 4, v * 4, seed, 4), medium = noise(u * 16, v * 16, seed + 7, 16), fine = hash(x, y, seed + 17);
    const pores = noise(u * 128, v * 128, seed + 29, 128);
    const streak = wall ? noise(u * 32, v * 4, seed + 43, 32) : noise(u * 4, v * 32, seed + 43, 32);
    // Low-frequency staining and broad broken abrasions, not sharp white noise.
    const marks = clamp((medium * .54 + streak * .46 - .58) * 3.2);
    const pigment = .38 + broad * .40 + medium * .18 + (fine - .5) * .02 - marks * (wall ? .14 : .22);
    const offset = (y * size + x) * 4;
    data[offset] = Math.round(clamp(pigment) * 255);
    data[offset + 1] = Math.round(clamp(.75 + medium * .19 - marks * .10) * 255);
    data[offset + 2] = Math.round(clamp(.40 + pores * .16 + (fine - .5) * .04) * 255);
    data[offset + 3] = Math.round(clamp(marks * .85 + Math.max(0, .40 - broad) * .65) * 255);
  }
  return data;
}
function visible(object) {for (let n = object; n; n = n.parent) if (!n.visible) return false; return true;}
function kindOf(entry, document) {
  const object = entry.object, descriptor = entry.descriptor || object.userData.editorDescriptor || {};
  if (!['box', 'plane'].includes(descriptor.type) || descriptor.prefab || object.userData.editorColor || object.userData.editorGeometryReplaced || !visible(object)) return null;
  const name = object.name || '', kind = /\b(?:piso|suelo)\b/i.test(name) ? 'floor' : /\b(?:pared|muro)\b/i.test(name) ? 'wall' : null;
  if (!kind) return null;
  const behaviors = document.getBehaviors ? document.getBehaviors(object) : object.userData.editorBehaviors || [];
  const config = behaviors.find(value => value.type === 'surfaceMaterial' && value.enabled !== false);
  const color = String(config && config.color || descriptor.color || '').toLowerCase();
  if (!STANDARD[kind].has(color)) return null;
  if (config && (['texture', 'normalMap', 'roughnessMap', 'metalnessMap'].some(key => config[key]) || (config.overrides || []).length || config.wear > 0)) return null;
  if (behaviors.some(value => value.type === 'surfaceWear' && value.enabled !== false)) return null;
  return kind;
}
function uvAt(kind, world, normal) {
  return kind === 'floor' ? [world[0] / PERIOD_M, world[2] / PERIOD_M] : Math.abs(normal[0]) > Math.abs(normal[2]) ? [world[2] / PERIOD_M, world[1] / PERIOD_M] : [world[0] / PERIOD_M, world[1] / PERIOD_M];
}
class Detail {
  constructor(THREE) {this.THREE = THREE; this.bindings = new Map(); this.maps = new Map(); this.lastScan = -Infinity; this.key = null; this.stats = {textures: 0, materials: 0, scans: 0, allocations: 0, bytes: 0};}
  texture(kind) {
    if (this.maps.has(kind)) return this.maps.get(kind);
    const T = this.THREE, texture = new T.DataTexture(pixels(kind), SIZE, SIZE, T.RGBAFormat);
    texture.name = 'Industrial · ' + kind + ' · pigmento, rugosidad y relieve'; texture.encoding = T.LinearEncoding;
    texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = 2; texture.needsUpdate = true;
    texture.userData = {industrialSurfaceDetail: true}; this.maps.set(kind, texture); this.stats.allocations++;
    this.stats.textures = this.maps.size; this.stats.bytes = this.maps.size * SIZE * SIZE * 4 * 4 / 3; return texture;
  }
  install(material, kind, floorY) {
    if (!material || !material.isMeshStandardMaterial || material.transparent && material.opacity < .95) return;
    const existing = this.bindings.get(material);
    if (existing && material.onBeforeCompile === existing.wrapper) {existing.floor.value = floorY; return;}
    if (existing) {this.remove(material, existing); this.bindings.delete(material);}
    const texture = this.texture(kind), previous = {compile: material.onBeforeCompile, defines: material.defines, extensions: material.extensions, detailMap: material.industrialDetailMap, batchShader: material.staticArchitectureBatchShader};
    const floor = {value: floorY}, isFloor = kind === 'floor';
    const wrapper = function(shader, renderer) {
      if (previous.compile) previous.compile.call(this, shader, renderer);
      shader.uniforms.industrialDetailMap = {value: texture}; shader.uniforms.industrialFloorY = floor;
      shader.vertexShader = 'varying vec3 industrialPosition;\nvarying vec3 industrialNormal;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 industrialLocal = vec4(transformed, 1.0);\nvec3 industrialLocalNormal = normal;\n#ifdef USE_INSTANCING\nindustrialLocal = instanceMatrix * industrialLocal;\nindustrialLocalNormal = mat3(instanceMatrix) * industrialLocalNormal;\n#endif\nindustrialPosition = (modelMatrix * industrialLocal).xyz;\nindustrialNormal = normalize(mat3(modelMatrix) * industrialLocalNormal);');
      shader.fragmentShader = 'uniform sampler2D industrialDetailMap;\nuniform float industrialFloorY;\nvarying vec3 industrialPosition;\nvarying vec3 industrialNormal;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' +
        'vec2 industrialUv = ' + (isFloor ? 'industrialPosition.xz' : '(abs(industrialNormal.x) > abs(industrialNormal.z) ? industrialPosition.zy : industrialPosition.xy)') + ' * 0.25;\n' +
        'vec4 industrialSample = texture2D(industrialDetailMap, industrialUv);\n' +
        'float industrialMacro = sin(industrialPosition.x * 0.17 + industrialPosition.z * 0.13) * sin(industrialPosition.z * 0.21 - industrialPosition.x * 0.11);\n' +
        'float industrialPigment = 0.58 + industrialSample.r * 0.63 + industrialMacro * 0.025;\n' +
        'float industrialAge = industrialSample.a * ' + (isFloor ? '0.22' : '(0.12 + 0.18 * (1.0 - smoothstep(0.04, 0.8, industrialPosition.y - industrialFloorY)))') + ';\n' +
        'diffuseColor.rgb *= mix(vec3(industrialPigment), vec3(0.61, 0.56, 0.49), industrialAge);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (0.86 + industrialSample.g * 0.18), 0.68, 1.0);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' +
        'vec2 industrialDx = dFdx(industrialUv), industrialDy = dFdy(industrialUv);\n' +
        'float industrialHx = (texture2D(industrialDetailMap, industrialUv + industrialDx).b - industrialSample.b) * 0.012;\n' +
        'float industrialHy = (texture2D(industrialDetailMap, industrialUv + industrialDy).b - industrialSample.b) * 0.012;\n' +
        'vec3 industrialSx = dFdx(-vViewPosition), industrialSy = dFdy(-vViewPosition);\n' +
        'vec3 industrialR1 = cross(industrialSy, normal), industrialR2 = cross(normal, industrialSx);\n' +
        'float industrialDet = dot(industrialSx, industrialR1);\n' +
        'normal = normalize(max(abs(industrialDet), 0.00000001) * normal - sign(industrialDet) * (industrialHx * industrialR1 + industrialHy * industrialR2));');
    };
    material.defines = Object.assign({}, material.defines, {INDUSTRIAL_SURFACE_DETAIL: isFloor ? 1 : 2});
    material.extensions = Object.assign({}, material.extensions, {derivatives: true}); material.onBeforeCompile = wrapper;
    if (material.userData && material.userData.staticArchitectureBatchKey) material.staticArchitectureBatchShader = wrapper;
    // Discoverable by the existing GPU texture accounting, outside serialized data.
    material.industrialDetailMap = texture; material.needsUpdate = true;
    this.bindings.set(material, {previous, wrapper, kind, floor}); this.stats.materials = this.bindings.size;
  }
  remove(material, state) {
    // Another editor/module may replace its shader while retaining the same
    // material. Never overwrite that newer hook, but retire our own samplers.
    if (material.onBeforeCompile === state.wrapper) {material.onBeforeCompile = state.previous.compile; material.defines = state.previous.defines; material.extensions = state.previous.extensions;}
    if (material.industrialDetailMap === this.maps.get(state.kind)) {if (state.previous.detailMap === undefined) delete material.industrialDetailMap; else material.industrialDetailMap = state.previous.detailMap;}
    if (material.staticArchitectureBatchShader === state.wrapper) {if (state.previous.batchShader === undefined) delete material.staticArchitectureBatchShader; else material.staticArchitectureBatchShader = state.previous.batchShader;}
    material.needsUpdate = true;
  }
  sync(document, roomId, enabled, version) {
    if (!enabled || !document || !document.additions) {this.dispose(); return;}
    const root = document.getRoot && document.getRoot(roomId), key = [document, roomId, root, root && root.visible, document.loadGeneration, version, document.additions.size];
    const now = Date.now(); if (this.key && key.every((value, index) => value === this.key[index]) && now - this.lastScan < 350) return;
    this.key = key; this.lastScan = now; this.stats.scans++;
    const candidates = [], live = new Set(); let floorY = root ? root.getWorldPosition(new this.THREE.Vector3()).y : 0;
    document.additions.forEach(entry => {
      if (entry.roomId && entry.roomId !== roomId || !entry.object) return;
      const kind = kindOf(entry, document); if (!kind) return;
      if (kind === 'floor') {entry.object.updateWorldMatrix(true, true); floorY = new this.THREE.Box3().setFromObject(entry.object).max.y;}
      entry.object.traverse(node => {
        if (!node.isMesh || !node.geometry || node.userData.editorHelper || node.userData.editorRuntimeHelper || node.userData.industrialFloorMarking || node.userData.editorGeometryReplaced) return;
        (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => {live.add(material); candidates.push({material, kind});});
      });
    });
    this.bindings.forEach((state, material) => {if (!live.has(material)) {this.remove(material, state); this.bindings.delete(material);}});
    candidates.forEach(({material, kind}) => this.install(material, kind, floorY)); this.stats.materials = this.bindings.size;
    if (!this.bindings.size) this.releaseMaps();
  }
  restoreBindings() {this.bindings.forEach((state, material) => this.remove(material, state)); this.bindings.clear(); this.key = null; this.stats.materials = 0;}
  releaseMaps() {this.maps.forEach(texture => texture.dispose()); this.maps.clear(); this.stats.textures = this.stats.bytes = 0;}
  dispose() {this.restoreBindings(); this.releaseMaps();}
}
module.exports = {Detail, pixels, kindOf, uvAt, SIZE, PERIOD_M};
