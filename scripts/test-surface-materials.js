// Actual Three PBR materials, shader chunks and texture ownership; no GPU/DOM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const materialSchema = require('../shared/materials');
const behaviorSchema = require('../shared/behaviors');
const source = fs.readFileSync(path.join(__dirname, '../src/editor/SurfaceMaterialSystem.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class SurfaceMaterialSystem', 'return class SurfaceMaterialSystem');
const System = new Function('THREE', 'materialSchema', source)(THREE, materialSchema);
const prefabSource = fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialPrefabs.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export const /gm, 'const ').replace(/^export function /gm, 'function ');
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', prefabSource + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
const visualSource = fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialVisuals.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class IndustrialVisuals', 'return class IndustrialVisuals');
const IndustrialVisuals = new Function('THREE', visualSource)(THREE);
function texture(shade = 220) {
  const result = new THREE.DataTexture(new Uint8Array([shade, shade, shade, 255]), 1, 1, THREE.RGBAFormat);
  result.encoding = THREE.sRGBEncoding; result.needsUpdate = true; return result;
}
function mesh(name, material) { const object = new THREE.Mesh(new THREE.BoxBufferGeometry(), material); object.name = name; return object; }
function setConfig(object, config) { object.userData.editorBehaviors = config ? [materialSchema.normalizeMaterial(config)] : []; }
function fixture() {
  const root = new THREE.Group(), other = new THREE.Group(), owner = new THREE.Group(), child = new THREE.Group(); root.add(owner); owner.add(child);
  owner.name = 'Máquina'; child.name = 'Pieza independiente';
  const map = texture(); map.repeat.set(2, 3); map.flipY = false;
  const lightMap = texture(180), original = new THREE.MeshStandardMaterial({map, lightMap, color: '#778899', roughness: 0.7}); original.name = 'Acero original';
  original.onBeforeCompile = shader => { shader.uniforms.nativeSurvives = {value: 1}; };
  const body = mesh('Cuerpo', original), nested = mesh('Pieza hija', original); owner.add(body); child.add(nested);
  const shader = new THREE.ShaderMaterial({uniforms: {source: {value: map}}});
  const portal = mesh('Portal', shader); owner.add(portal);
  const protectedNodes = ['industrialDisplay', 'industrialButton', 'industrialSensorLamp', 'industrialSensorVolume', 'industrialTower'].map(key => {
    const object = mesh(key, original); object.userData[key] = true; owner.add(object); return object;
  });
  const label = mesh('Etiqueta de envío y código de barras', original); owner.add(label); protectedNodes.push(label, portal);
  const helper = new THREE.Group(); helper.userData.editorRuntimeHelper = true; const helperMesh = mesh('Ayuda', original); helper.add(helperMesh); owner.add(helper); protectedNodes.push(helperMesh);
  const document = {getRoot: room => room === 'hall' ? root : other, getObjects: room => room === 'hall' ? [owner, child] : []};
  return {root, other, owner, child, map, lightMap, original, body, nested, portal, protectedNodes, document};
}
function disposed(resource) { let count = 0; resource.addEventListener('dispose', () => count++); return () => count; }
function imagePlane(value = 110) {
  const map = texture(value), material = new THREE.MeshBasicMaterial({map}), object = new THREE.Mesh(new THREE.PlaneBufferGeometry(), material);
  const counts = [disposed(object.geometry), disposed(material), disposed(map)];
  return {object, map, counts};
}
function flush() { return new Promise(resolve => setImmediate(resolve)); }

async function run() {
  assert.equal(materialSchema.materialTypes.length, 10);
  assert.equal(materialSchema.normalizeMaterial({preset: 'wood'}).roughness, 0.78);
  assert.equal(materialSchema.normalizeMaterial({preset: 'glass'}).opacity, 0.24);
  assert.equal(materialSchema.normalizeMaterial({color: '#AABBCC'}).color, '#aabbcc');
  for (const bad of [{preset: 'unknown'}, {seed: 1.5}, {wear: NaN}, {roughness: 2}, {opacity: -1}, {slot: 'index:256'}, {slot: 'index:01'}, {slot: 'name:'}, {texture: 'https://host/secret.png'}, {normalMap: '../local.png'}, {texture: '/api/assets/123'}, {enabled: 'true'}]) assert.throws(() => materialSchema.normalizeMaterial(bad));
  ['all', 'index:0', 'index:255', 'name:Acero original', 'part:Bastidor'].forEach(slot => assert.equal(materialSchema.normalizeMaterial({slot}).slot, slot));

  const f = fixture(), system = new System({}, f.document, {});
  const slots = system.getSlots(f.owner);
  assert(slots.some(slot => slot.value === 'name:Acero original') && slots.some(slot => slot.value === 'part:Cuerpo'));
  assert.deepEqual(system.getSlots(f.portal), [], 'Functional shader-only actors do not advertise replaceable surfaces.');
  const originalDisposed = disposed(f.original), originalMapDisposed = disposed(f.map), lightMapDisposed = disposed(f.lightMap);
  setConfig(f.owner, {preset: 'paintedMetal', wear: 0.65, wearType: 'rust'});
  setConfig(f.child, {preset: 'wood'});
  await system.sync('hall');
  assert(f.body.material.isMeshPhysicalMaterial && system.isOwnedMaterial(f.body.material));
  assert.equal(f.body.material.clearcoat, 0.4);
  assert.equal(f.nested.material.metalness, 0, 'The nearest child material behavior overrides its parent.');
  assert.notStrictEqual(f.body.material, f.nested.material);
  f.protectedNodes.forEach(object => assert.strictEqual(object.material, object === f.portal ? f.portal.material : f.original));
  assert.strictEqual(f.portal.material.uniforms.source.value, f.map);
  assert.notStrictEqual(f.body.material.map, f.map);
  assert.strictEqual(f.body.material.map.image, f.map.image, 'Original baked/imported color pixels survive the wear overlay.');
  assert.equal(f.body.material.map.isDataTexture, true); assert.equal(f.body.material.map.flipY, false);
  assert.deepEqual(f.body.material.map.repeat.toArray(), [2, 3]);
  assert.strictEqual(f.body.material.lightMap, f.lightMap);
  const shader = {uniforms: {}, fragmentShader: THREE.ShaderLib.physical.fragmentShader};
  f.body.material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.nativeSurvives.value, 1, 'Original material hooks still execute before adding wear.');
  assert(shader.uniforms.surfaceWearMap.value.isDataTexture);
  assert.equal(shader.uniforms.surfaceWearStrength.value, 0.65);
  assert(shader.fragmentShader.includes('#include <map_fragment>\nvec4 surfaceWearSample'));
  assert(shader.fragmentShader.includes('mix(roughnessFactor') && shader.fragmentShader.includes('mix(metalnessFactor'));
  assert.equal(shader.uniforms.surfaceWearMap.value.encoding, THREE.LinearEncoding);
  assert.equal(shader.uniforms.surfaceWearMap.value.image.data.length, 128 * 128 * 4);
  const stable = f.body.material, counts = Object.assign({}, system.stats);
  let traversals = 0; const traverse = f.root.traverse; f.root.traverse = function(callback) { traversals++; return traverse.call(this, callback); };
  for (let index = 0; index < 20; index++) await system.sync('hall');
  assert.strictEqual(f.body.material, stable); assert.equal(traversals, 0); assert.deepEqual(system.stats, counts);
  f.root.traverse = traverse;
  const industrialWrapper = stable.clone(); f.body.material = industrialWrapper;
  await system.sync('hall'); assert.strictEqual(f.body.material, industrialWrapper, 'Industrial UV/material wrappers cannot trigger recursive surface replacement.');
  assert.deepEqual(system.stats, counts);
  system.invalidate(); await system.sync('hall'); assert.strictEqual(f.body.material, industrialWrapper);
  assert.equal(system.getSlots(f.owner).some(slot => slot.value === 'name:Acero original'), true);
  system.dispose(); industrialWrapper.dispose();
  assert.strictEqual(f.body.material, f.original); assert.strictEqual(f.nested.material, f.original);
  assert.equal(originalDisposed(), 0); assert.equal(originalMapDisposed(), 0); assert.equal(lightMapDisposed(), 0);

  const liveCanvas = new THREE.CanvasTexture({width: 32, height: 32}), liveDisposed = disposed(liveCanvas);
  const liveOriginal = new THREE.MeshStandardMaterial({map: liveCanvas}), live = mesh('Superficie de pintura nativa', liveOriginal); f.owner.add(live);
  setConfig(f.owner, {preset: 'custom', slot: 'part:Superficie de pintura nativa', wear: 0.3}); setConfig(f.child, null);
  await system.sync('hall');
  assert.strictEqual(live.material.map, liveCanvas, 'Live native painting/video textures retain their original update lifecycle.');
  const canvasVersion = live.material.map.version; liveCanvas.needsUpdate = true;
  assert.equal(live.material.map.version, canvasVersion + 1);
  system.dispose(); assert.equal(liveDisposed(), 0); assert.strictEqual(live.material, liveOriginal);
  f.owner.remove(live); live.geometry.dispose(); liveOriginal.dispose(); liveCanvas.dispose();

  const wearPixels = async seed => {
    setConfig(f.owner, {preset: 'wood', wear: 1, seed}); system.invalidate(); await system.sync('hall');
    const copy = Buffer.from(system.states.get(f.owner).wear.image.data); system.dispose(); return copy;
  };
  const firstWear = await wearPixels(19), sameWear = await wearPixels(19), anotherWear = await wearPixels(20);
  assert.deepEqual(firstWear, sameWear, 'Procedural wear must survive save/reload deterministically.');
  assert.notDeepEqual(firstWear, anotherWear, 'Changing the seed produces a different surface without large image files.');

  const first = new THREE.MeshStandardMaterial(), second = new THREE.MeshStandardMaterial(); second.name = 'Seleccionado';
  const array = [first, second, f.portal.material], multi = mesh('Carcasa', array); f.owner.add(multi);
  setConfig(f.child, null); setConfig(f.owner, {preset: 'ceramic', slot: 'index:1'});
  await system.sync('hall'); assert.strictEqual(multi.material[0], first); assert(multi.material[1].isMeshPhysicalMaterial); assert.strictEqual(multi.material[2], array[2]);
  assert.strictEqual(f.body.material, f.original);
  system.dispose(); assert.strictEqual(multi.material, array, 'Disposal restores the exact authored material array identity.');
  setConfig(f.owner, {preset: 'glass', slot: 'part:Carcasa'}); await system.sync('hall');
  assert.equal(multi.material[0].opacity, 0.24); assert.equal(multi.material[0].transparent, true); assert.equal(multi.material[0].depthWrite, false);
  const oldMesh = multi; f.owner.remove(oldMesh); const replacement = mesh('Carcasa', second); f.owner.add(replacement);
  await system.sync('hall'); assert(system.isOwnedMaterial(replacement.material), 'Mechanical geometry replacement is detected without treating shader wrappers as new authored sources.');
  assert.strictEqual(oldMesh.material, array);
  await system.sync('other'); assert.strictEqual(replacement.material, second); assert.equal(system.states.size, 0);

  const queue = [], notices = [];
  const library = {getEntry: id => ({id, kind: 'image'}), instantiate(descriptor) { return new Promise((resolve, reject) => queue.push({descriptor, resolve, reject})); }};
  const asyncSystem = new System({}, f.document, library, message => notices.push(message));
  setConfig(f.owner, {texture: 'image-a', normalMap: 'image-a', roughnessMap: 'image-a', metalnessMap: 'image-a', repeatX: 2, repeatY: 4});
  const waiting = asyncSystem.sync('hall'); await flush(); assert.equal(queue.length, 1, 'One image used by several slots loads only once per actor.');
  assert.deepEqual(queue[0].descriptor, {importId: 'image-a'});
  const a = imagePlane(80); queue.shift().resolve(a.object); await waiting;
  assert.equal(f.body.material.map.encoding, THREE.sRGBEncoding); assert.equal(f.body.material.normalMap.encoding, THREE.LinearEncoding);
  assert.equal(f.body.material.normalMap.isDataTexture, true); assert(f.body.material.normalMap.version > 0);
  assert.strictEqual(f.body.material.normalMap, f.body.material.roughnessMap);
  assert.deepEqual(f.body.material.map.repeat.toArray(), [2, 4]); assert.equal(f.body.material.map.flipY, false);
  assert.strictEqual(f.body.material.map.image, a.map.image);
  setConfig(f.owner, {texture: 'image-stale'}); asyncSystem.invalidate(); const stale = asyncSystem.sync('hall'); await flush();
  const staleRequest = queue.shift(); setConfig(f.owner, {texture: 'image-new'}); asyncSystem.invalidate(); const fresh = asyncSystem.sync('hall'); await flush();
  const freshRequest = queue.shift(), staleImage = imagePlane(40), freshImage = imagePlane(190);
  staleRequest.resolve(staleImage.object); await stale; staleImage.counts.forEach(get => assert.equal(get(), 1, 'Cancelled private image planes must release every owned resource.'));
  freshRequest.resolve(freshImage.object); await fresh;
  assert.strictEqual(f.body.material.map.image, freshImage.map.image);
  asyncSystem.dispose(); freshImage.counts.forEach(get => assert.equal(get(), 1)); a.counts.forEach(get => assert.equal(get(), 1));
  assert.equal(originalDisposed(), 0); assert.equal(originalMapDisposed(), 0); assert.equal(lightMapDisposed(), 0);
  setConfig(f.owner, {texture: 'retry-image'}); let rejected = asyncSystem.sync('hall'); await flush(); queue.shift().reject(new Error('fixture unavailable')); await rejected;
  assert.equal(notices.length, 1); asyncSystem.invalidate(); const retry = asyncSystem.sync('hall'); await flush(); const retryImage = imagePlane(140); queue.shift().resolve(retryImage.object); await retry;
  assert.strictEqual(f.body.material.map.image, retryImage.map.image); asyncSystem.dispose();

  // Actual prefab cylinders, the real industrial UV wrapper and a plain
  // Texture carrying DataTexture metadata exercise both private clone layers.
  const conveyor = createIndustrialPrefab('conveyor'), rollingGroup = conveyor.children[2];
  const machine = new THREE.Group(), machineRoot = new THREE.Group(); machineRoot.add(machine); machine.add(rollingGroup);
  machine.name = 'Banda con desgaste'; machine.userData.editorId = 'custom-material-roller'; machine.userData.editorPrefabKey = 'conveyor';
  const roller = rollingGroup.children[0], factoryMap = roller.material.map;
  assert(roller.material.isMeshStandardMaterial);
  const sourceData = new THREE.Texture(factoryMap.image);
  sourceData.isDataTexture = true; sourceData.format = THREE.RGBAFormat; sourceData.encoding = THREE.sRGBEncoding;
  sourceData.flipY = false; sourceData.generateMipmaps = false; sourceData.minFilter = THREE.LinearMipmapLinearFilter;
  for (let width = 64, height = 4; ; width = Math.max(1, width >> 1), height = Math.max(1, height >> 1)) {
    sourceData.mipmaps.push({width, height, data: new Uint8Array(width * height * 4).fill(200)});
    if (width === 1 && height === 1) break;
  }
  sourceData.needsUpdate = true; roller.material.map = sourceData;
  const sourceDisposed = disposed(sourceData), originalRoller = roller.material;
  machine.userData.editorBehaviors = [Object.assign(behaviorSchema.defaultBehavior('conveyor'), {powered: true, running: true}), materialSchema.normalizeMaterial({preset: 'steel', slot: 'part:Rodillos', wear: 0.6, wearType: 'scratches'})];
  const machineDocument = {getRoot: () => machineRoot, getObjects: () => [machine], getBehaviors: object => object.userData.editorBehaviors || []};
  const machineMaterials = new System({}, machineDocument, {});
  await machineMaterials.sync('hall');
  const authoredFinish = roller.material;
  const simulation = {running: true, records: new Map([[machine.userData.editorId, {variables: {powered: true, running: true, paused: false, emergency: false, enabled: true, actualSpeed: 0.4}}]])};
  const industrial = new IndustrialVisuals({}, machineDocument, simulation); machineRoot.updateMatrixWorld(true);
  industrial.sync('hall', 0.01, false);
  const wrapper = roller.material;
  assert.notStrictEqual(wrapper, authoredFinish);
  assert.strictEqual(wrapper.onBeforeCompile, authoredFinish.onBeforeCompile, 'The industrial clone must retain the authored wear shader hook.');
  assert.equal(wrapper.defines.SURFACE_WEAR, 1); assert.equal(wrapper.defines.SURFACE_BASE_SHADER, authoredFinish.defines.SURFACE_BASE_SHADER);
  assert.equal(wrapper.map.isDataTexture, true, 'UV animation must retain the original texture upload path.');
  assert.notStrictEqual(wrapper.map.mipmaps, sourceData.mipmaps);
  assert.deepEqual(wrapper.map.mipmaps, sourceData.mipmaps, 'Explicit mipmap pixels/dimensions survive both PBR and industrial clones.');
  const wrappedShader = {uniforms: {}, fragmentShader: THREE.ShaderLib.physical.fragmentShader}; wrapper.onBeforeCompile(wrappedShader, {});
  assert.equal(wrappedShader.uniforms.surfaceWearStrength.value, 0.6);
  assert(wrappedShader.fragmentShader.includes('surfaceWearMask'));
  const offsetBefore = wrapper.map.offset.x, beforeApplications = machineMaterials.stats.applications;
  industrial.sync('hall', 0.1, false);
  assert.notEqual(wrapper.map.offset.x, offsetBefore, 'The roller still visibly rolls after PBR wear is installed.');
  await machineMaterials.sync('hall'); assert.strictEqual(roller.material, wrapper); assert.equal(machineMaterials.stats.applications, beforeApplications);
  industrial.dispose(); assert.strictEqual(roller.material, authoredFinish);
  machineMaterials.dispose(); assert.strictEqual(roller.material, originalRoller); assert.equal(sourceDisposed(), 0);

  const unmapped = mesh('Sin mapa original', new THREE.MeshStandardMaterial()), unmappedRoot = new THREE.Group(); unmappedRoot.add(unmapped);
  setConfig(unmapped, {preset: 'custom', wear: 0.4});
  const noMapSystem = new System({}, {getRoot: () => unmappedRoot, getObjects: () => [unmapped]}, {});
  await noMapSystem.sync('hall');
  assert(unmapped.material.map && unmapped.material.map.isDataTexture, 'Wear supplies a dummy/procedural base map so r112 defines USE_UV even when the original had no map.');
  const untexturedShader = {uniforms: {}, fragmentShader: THREE.ShaderLib.physical.fragmentShader}; unmapped.material.onBeforeCompile(untexturedShader, {});
  assert(untexturedShader.fragmentShader.includes('texture2D(surfaceWearMap, vUv'));
  // This is the actual r112 program decision, so the patched fragment varying
  // is declared on both WebGL1 and the WebXR WebGL2 compatibility path.
  const programSource = fs.readFileSync(path.join(__dirname, '../node_modules/three/src/renderers/webgl/WebGLPrograms.js'), 'utf8');
  assert(programSource.includes('vertexUvs: !! material.map'));
  noMapSystem.dispose();
  console.log('Surface materials: typed presets/slots, PBR finish, private imported maps, seeded shader wear preserving original pixels, protected functions, nested overrides, UV wrappers, cached frames, geometry refresh, cancellation/retry and resource ownership passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
