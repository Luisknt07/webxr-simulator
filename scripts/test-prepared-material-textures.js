'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const materials = require('../shared/materials'), quality = require('../shared/graphics-quality');
function load(file, name, args) { const source = fs.readFileSync(path.join(__dirname, '../' + file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class ' + name, 'return class ' + name); return new Function(...Object.keys(args), source)(...Object.values(args)); }
const Prepared = load('src/lib/PreparedMaterialTextures.js', 'PreparedMaterialTextures', {THREE});
const Surface = load('src/editor/SurfaceMaterialSystem.js', 'SurfaceMaterialSystem', {THREE, materialSchema: materials});
function fixture() {
  let tier = 'balanced'; const requests = [], subscribers = new Set(), canvases = [];
  const ctx = {graphics: {getLimits: () => quality.limitsFor(tier), subscribe(callback) { subscribers.add(callback); callback(); return () => subscribers.delete(callback); }}, renderer: {capabilities: {getMaxAnisotropy: () => 16}}};
  const manager = new Prepared(ctx, {loadImage(url, signal) { return new Promise((resolve, reject) => { requests.push({url, resolve, reject, signal}); }); }, createCanvas(edge) {
    const canvas = {width: edge, height: edge, getContext() { return {drawImage() {}, getImageData() { return {data: new Uint8Array([100, 120, 140, 255, 140, 120, 100, 255])}; }}; }}; canvases.push(canvas); return canvas;
  }}); ctx.preparedMaterials = manager;
  return {ctx, manager, requests, canvases, subscribers, tier(value) { tier = value; subscribers.forEach(callback => callback()); }};
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const image = () => ({width: 2048, height: 2048, closed: 0, close() { this.closed++; }});
function floor(name = 'Piso industrial · hormigón mate', patch = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshStandardMaterial()); mesh.name = name;
  mesh.userData.editorBehaviors = [materials.normalizeMaterial(Object.assign({preset: 'concrete', name: 'Material personalizado', color: '#777c76', repeatX: 18, repeatY: 30}, patch))]; return mesh;
}
async function run() {
  const paths = new Prepared().manifest;
  for (const prefix of ['/', '/webxr-simulator/']) for (const edge of [256, 512, 1024]) {
    const url = new URL(paths[edge], 'https://local.test' + prefix);
    assert.equal(url.pathname, prefix + 'assets/materials/ai-industrial-concrete-v1-' + edge + '.jpg', 'Prepared image requests preserve the deployment directory.');
  }
  const f = fixture(); await flush(); assert.equal(f.requests.length, 0, 'No image is fetched for empty or inactive rooms.');
  let secondValue; const changes = [], first = f.manager.acquireConcrete(value => changes.push(value)), second = f.manager.acquireConcrete(value => { secondValue = value; }); await flush();
  assert.equal(f.requests.length, 1, 'Active floors share the same in-flight request.'); assert.match(f.requests[0].url, /-512\.jpg$/);
  const source = image(); f.requests[0].resolve(source); const readiness = await Promise.all([first.ready, second.ready]), a = changes[0];
  assert.deepEqual(readiness, [true, true], 'Completion promises do not retain obsolete texture/canvas packs after a tier change.');
  assert.equal(a, secondValue); assert.equal(source.closed, 1); assert.equal(a.texture.encoding, THREE.sRGBEncoding); assert.equal(a.texture.image.width, 512);
  assert.equal(a.texture.wrapS, THREE.RepeatWrapping); assert.equal(a.texture.minFilter, THREE.LinearMipmapLinearFilter); assert(a.texture.generateMipmaps);
  assert(a.mean.x > 0 && a.mean.x < 1 && a.mean.y > 0 && a.mean.y < 1); assert.equal(a.texture.anisotropy, 4);
  for (let index = 0; index < 50; index++) await f.manager.update(); assert.equal(f.requests.length, 1, 'Idle frames never re-fetch or rebuild the map.');
  let oldDisposals = 0; a.texture.addEventListener('dispose', () => oldDisposals++);
  f.tier('ultra'); await flush(); assert.match(f.requests[1].url, /-1024\.jpg$/); assert.equal(oldDisposals, 0, 'The previous tile remains valid during the atomic handover.');
  f.requests[1].resolve(image()); await f.manager.update(); assert.equal(oldDisposals, 1); assert.equal(f.manager.getStats().edge, 1024);
  assert(f.manager.getStats().estimatedGpuBytes < 8 * 1024 * 1024, 'A single RGBA1024 map including mipmaps stays below the requested 8 MiB bound.');
  assert.equal(changes.length, 2); first.release(); assert.equal(f.manager.getStats().activeReferences, 1); second.release(); assert.equal(f.manager.getStats().edge, 0);
  f.tier('economy'); const cancelled = f.manager.acquireConcrete(); await flush(); const obsolete = f.requests[2], obsoleteImage = image(); cancelled.release();
  assert(obsolete.signal.aborted); obsolete.resolve(obsoleteImage); await cancelled.ready; assert.equal(obsoleteImage.closed, 1); assert.equal(f.manager.getStats().textureBuilds, 2, 'An image finishing after its room was released is closed without allocating a texture.');
  const failing = f.manager.acquireConcrete(); await flush(); assert.match(f.requests[3].url, /-256\.jpg$/); f.requests[3].reject(new Error('404')); await failing.ready;
  assert.equal(f.manager.getStats().status, 'fallback'); for (let index = 0; index < 10; index++) await f.manager.update(); assert.equal(f.requests.length, 4, 'A failed optional asset does not create a per-frame retry loop.');
  f.manager.setEnabled(false); assert.equal(f.manager.getStats().edge, 0); f.manager.setEnabled(true); await flush(); f.requests[4].resolve(image()); await f.manager.update(); assert.equal(f.manager.getStats().edge, 256); failing.release(); f.manager.dispose(); assert.equal(f.subscribers.size, 0);

  const s = fixture(), root = new THREE.Group(), other = new THREE.Group(), one = floor(), two = floor('CEDI · Piso de hormigón mate', {wear: .2, wearType: 'dirt'}); root.add(one, two);
  const originalOne = one.material, originalTwo = two.material, geometry = one.geometry;
  originalTwo.onBeforeCompile = shader => { shader.uniforms.originalFloorEffect = {value: 1}; };
  const doc = {getRoot: id => id === 'hall' ? root : other, getObjects: id => id === 'hall' ? root.children : []}; const system = new Surface(s.ctx, doc, {});
  const authored = JSON.stringify(root.children.map(object => object.userData.editorBehaviors)); const ready = system.sync('hall'); await flush(); assert.equal(s.requests.length, 1);
  assert(one.material.preparedConcreteUniforms); assert.equal(one.material.preparedConcreteUniforms.preparedConcreteStrength.value, 0, 'Procedural fallback renders while the prepared tile loads.');
  const shader = {uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>'}; one.material.onBeforeCompile(shader);
  assert(shader.fragmentShader.includes('sRGBToLinear(texture2D(preparedConcreteMap, vUv))'), 'A supplemental colour sampler decodes sRGB exactly once.'); assert(shader.fragmentShader.includes('preparedConcreteAlbedo / preparedConcreteMean'));
  s.requests[0].resolve(image()); await ready;
  const uniforms = one.material.preparedConcreteUniforms, common = uniforms.preparedConcreteMap.value;
  assert.equal(common, two.material.preparedConcreteUniforms.preparedConcreteMap.value); assert.equal(uniforms.preparedConcreteStrength.value, .85);
  const layeredShader = {uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>'}; two.material.onBeforeCompile(layeredShader);
  assert.equal(layeredShader.uniforms.originalFloorEffect.value, 1); assert(layeredShader.uniforms.surfaceWearMap.value.isTexture);
  assert(layeredShader.fragmentShader.indexOf('preparedConcreteDetail') < layeredShader.fragmentShader.indexOf('vec4 surfaceWearSample'), 'Prepared albedo composes before editable wear and preserves a source shader hook.');
  assert.equal(one.material.color.r, new THREE.Color('#777c76').convertSRGBToLinear().r, 'Prepared contrast preserves authored linear reflectance and editor colour.');
  assert.deepEqual(one.material.map.repeat.toArray(), [18, 30]); assert.equal(one.material.bumpMap, null, 'The prepared photo does not invent a normal map or reintroduce grazing-angle bump moiré.');
  assert.equal(one.material.roughnessMap.encoding, THREE.LinearEncoding); assert.equal(one.geometry, geometry); assert.equal(JSON.stringify(root.children.map(object => object.userData.editorBehaviors)), authored);
  let release = 0; common.addEventListener('dispose', () => release++); await system.sync('sound'); assert.equal(s.manager.getStats().activeReferences, 0); assert.equal(release, 1); assert.equal(one.material, originalOne); assert.equal(two.material, originalTwo); assert.equal(uniforms.preparedConcreteMap.value, null);
  const custom = [floor('Muro de hormigón'), floor(undefined, {color: '#808080'}), floor(undefined, {colorMapMode: 'none'}), floor(undefined, {name: 'Acabado del cliente'}), floor(undefined, {normalMap: 'assets/custom-normal.png'})];
  const imported = floor(); imported.material.map = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); custom.push(imported);
  const painted = floor(); painted.userData.editorColor = '#777c76'; custom.push(painted); root.children.slice().forEach(child => root.remove(child)); root.add(...custom); await system.sync('hall');
  assert(custom.every(mesh => !mesh.material.preparedConcreteUniforms), 'Walls, custom colour/name/maps, disabled albedo and native/imported images preserve their existing presentation.'); assert.equal(s.requests.length, 1);
  system.dispose(); s.manager.dispose(); [...custom, one, two].forEach(mesh => { mesh.geometry.dispose(); if (mesh.material.map) mesh.material.map.dispose(); mesh.material.dispose(); });
  const c = fixture(), pendingRoot = new THREE.Group(), pendingFloor = floor(); pendingRoot.add(pendingFloor); const pendingSystem = new Surface(c.ctx, {getRoot: id => id === 'hall' ? pendingRoot : other, getObjects: id => id === 'hall' ? [pendingFloor] : []}, {});
  const delayed = pendingSystem.sync('hall'); await flush(); await pendingSystem.sync('sound'); c.requests[0].resolve(image()); await delayed; assert.equal(c.manager.getStats().textureBuilds, 0); assert.equal(pendingFloor.material.preparedConcreteUniforms, undefined, 'A room change cannot install a late tile on the restored original material.');
  pendingSystem.dispose(); c.manager.dispose(); pendingFloor.geometry.dispose(); pendingFloor.material.dispose();
  console.log('Prepared material textures: lazy shared image, tier sizes/mip budget, atomic swap, cancellation, graceful fallback, retry toggle, original/custom map protection, exact authored data/colour and procedural property preservation passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
