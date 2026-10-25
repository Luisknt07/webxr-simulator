'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/studio-document');
const source = fs.readFileSync(path.join(__dirname, '../src/studio/SceneEnvironment.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class SceneEnvironment', 'return class SceneEnvironment');
const Environment = new Function('THREE', 'schema', source)(THREE, schema);
const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(), fill = new THREE.DirectionalLight();
sun.name = 'sun'; sun.position.set(.2, 1, .1); fill.name = 'fillLight'; scene.add(sun, fill);
const root = new THREE.Group(), other = new THREE.Group(), geometry = new THREE.BoxBufferGeometry(), material = new THREE.MeshStandardMaterial(); scene.add(root);
const machine = new THREE.Mesh(geometry, material), floor = new THREE.Mesh(geometry, material), roof = new THREE.Group(), roofMesh = new THREE.Mesh(geometry, material), helper = new THREE.Mesh(geometry, material);
roof.name = 'CEDI · Cubierta interior cerrada'; roof.add(roofMesh); floor.name = 'CEDI · Piso de hormigón'; helper.userData.editorRuntimeHelper = true; root.add(machine, floor, roof, helper);
const inactive = new THREE.Mesh(geometry, material); other.add(inactive);
const genericFloor = new THREE.Mesh(geometry, material); genericFloor.scale.set(30, .05, 30); genericFloor.position.y = -.03; root.add(genericFloor);
const markingGroup = require('../shared/industrialFloor').createVisual(THREE, {type: 'industrialFloor', version: 1, bounds: [-10, -8, 10, 8], floorY: .02, zones: [[-3, -2, 3, 2]], signs: [[3, 3, 0, 1, 6]]}); root.add(markingGroup);
const tallPaintBatch = markingGroup.children.find(mesh => mesh.name === 'Pintura de seguridad amarilla');
assert(tallPaintBatch.geometry.boundingBox.max.y > 1.8, 'The same real batch contains floor paint and a vertical sign, so ground-height culling alone is insufficient.');
const renderer = {toneMapping: THREE.NoToneMapping, toneMappingExposure: .8, shadowMap: {enabled: false, type: THREE.BasicShadowMap}, xr: {isPresenting: false}};
const camera = new THREE.PerspectiveCamera(); camera.position.set(3, 2, 7); camera.updateMatrixWorld(true);
const config = Object.assign(schema.defaultEnvironment('hall'), {sky: 'color', renderQuality: 'high', shadows: true, exposure: 1.15});
const document = {studio: {environments: [config]}, getRoot: id => id === 'hall' ? root : other};
const editor = {document, roomId: 'hall', ctx: {renderer, camera, vrMode: false}, hooks: {renderScene: scene}, changeVersion: 0};
const environment = new Environment(editor), originalPosition = sun.position.clone(), originalTarget = sun.target, originalShadow = sun.shadow;
let scans = 0; const traverse = root.traverse; root.traverse = function(callback) { scans++; return traverse.call(this, callback); };
environment.sync();
assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping); assert.equal(renderer.toneMappingExposure, 1.15);
assert.equal(sun.castShadow, true); assert.equal(sun.shadow.mapSize.x, 2048); assert.equal(renderer.shadowMap.type, THREE.PCFSoftShadowMap);
assert.equal(environment.stats.shadowMaps, 1); assert.equal(scene.children.filter(node => node.isLight).length, 2, 'Shadow quality reuses the key; point lights never require six shadow faces.');
assert(machine.castShadow && machine.receiveShadow); assert(floor.receiveShadow && !floor.castShadow); assert(roofMesh.receiveShadow && !roofMesh.castShadow);
assert(genericFloor.receiveShadow && !genericFloor.castShadow, 'An existing generic level floor also receives contact shadows without self-shadow acne.');
assert(markingGroup.children.every(mesh => mesh.receiveShadow && !mesh.castShadow), 'Batched floor paint and lettering receive contact shadows without projecting false paint/sign silhouettes across routes.');
assert(tallPaintBatch.material.roughness >= .96 && tallPaintBatch.material.metalness === 0);
assert(!helper.castShadow && !helper.receiveShadow && !inactive.castShadow && !inactive.receiveShadow, 'Helpers and inactive rooms do not become shadow work.');
assert.equal(machine.geometry, geometry); assert.equal(machine.material, material);
const initialScans = scans, target = sun.target;
for (let index = 0; index < 20; index++) environment.sync();
assert.equal(scans, initialScans, 'Idle frames do not traverse the document or rebuild maps.'); assert.equal(sun.target, target);
camera.position.x += 8; camera.updateMatrixWorld(true); const before = target.position.clone(); environment.sync(); assert(target.position.distanceTo(before) > 7.9);
const distantActor = new THREE.Group(); distantActor.userData.editorPrefabKey = 'conveyor'; distantActor.position.set(0, 1, -30); root.add(distantActor); root.updateMatrixWorld(true);
document.getObjects = () => [distantActor]; document.objects = new Map([['hydrated-equipment', distantActor]]);
camera.position.set(0, 2, 10); camera.updateMatrixWorld(true); environment.sync();
assert.equal(environment.stats.shadowFocus, 'equipment'); assert(Math.abs(sun.target.position.z + 30) < .1, 'An entrance view focuses its existing bounded map onto visible equipment rather than empty nearby floor.');
assert(environment.shadowActors.includes(distantActor), 'Lazy room hydration invalidates shadow casters through the real object inventory without requiring an authored document edit.');
assert.equal(sun.shadow.mapSize.x, 2048); assert(sun.shadow.camera.right - sun.shadow.camera.left <= 30);
const xrCamera = new THREE.ArrayCamera(); xrCamera.matrixWorld.makeTranslation(100, 1.6, -12); renderer.xr.getCamera = () => xrCamera;
editor.ctx.vrMode = true; environment.sync(); assert.equal(sun.shadow.mapSize.x, 1024); assert.equal(environment.stats.profile, 'high-xr');
assert(Math.abs(sun.target.position.x - 100) < .1 && Math.abs(sun.target.position.z + 17) < .1, 'XR shadow focus uses the headset world matrix without overwriting its tracked pose.');
assert(sun.shadow.camera.right - sun.shadow.camera.left <= 30 && sun.shadow.camera.far <= 55, 'Shadow coverage stays local, including XR.');
let released = 0; sun.shadow.map = {dispose() { released++; }};
config.renderQuality = 'performance'; environment.sync(); assert.equal(released, 1); assert.equal(sun.shadow.map, null); assert.equal(sun.castShadow, false); assert.equal(renderer.shadowMap.enabled, false);
config.renderQuality = 'balanced'; environment.sync(); assert.equal(sun.shadow.mapSize.x, 1024); assert(sun.castShadow);
editor.roomId = 'sound'; environment.sync(); assert.equal(renderer.toneMapping, THREE.NoToneMapping); assert.equal(renderer.toneMappingExposure, .8); assert.equal(renderer.shadowMap.enabled, false);
assert(sun.position.equals(originalPosition)); assert.equal(sun.target, originalTarget); assert.equal(sun.shadow, originalShadow); assert.equal(sun.castShadow, false); assert(!machine.castShadow && !machine.receiveShadow);
assert.equal(target.parent, null); assert.equal(environment.stats.shadowMaps, 0);
environment.dispose(); geometry.dispose(); material.dispose();
markingGroup.children.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });
// Three r112 does not define renderer.isWebGLRenderer. Exercise the actual
// public-method guard and off-screen pass lifecycle without requiring a GPU.
let reflectionPasses = 0, generatorDisposals = 0, reflectionDisposals = 0;
const reflectionTexture = new THREE.Texture({width: 768, height: 768}), targetState = {previous: true}, viewportState = new THREE.Vector4(2, 3, 100, 80), scissorState = new THREE.Vector4(4, 5, 60, 50);
const mockRenderer = {capabilities: {}, getContext() {}, xr: {enabled: true}, getRenderTarget: () => targetState,
  getViewport: target => target.copy(viewportState), getScissor: target => target.copy(scissorState), getScissorTest: () => true,
  setRenderTarget(value) { assert.equal(value, targetState); }, setViewport(value) { assert(value.equals(viewportState)); }, setScissor(value) { assert(value.equals(scissorState)); }, setScissorTest(value) { assert.equal(value, true); }};
const MockThree = Object.assign({}, THREE, {PMREMGenerator: class {
  fromScene(room) { reflectionPasses++; assert.equal(mockRenderer.xr.enabled, false); assert(room.children.length >= 8); return {texture: reflectionTexture, dispose() { reflectionDisposals++; }}; }
  dispose() { generatorDisposals++; }
}});
const MockEnvironment = new Function('THREE', 'schema', source)(MockThree, schema), reflections = new MockEnvironment({});
assert.equal(mockRenderer.isWebGLRenderer, undefined);
assert.equal(reflections.createReflections(mockRenderer), reflectionTexture); assert.equal(mockRenderer.xr.enabled, true);
assert.equal(reflections.createReflections(mockRenderer), reflectionTexture); assert.equal(reflectionPasses, 1); assert.equal(generatorDisposals, 1);
reflections.dispose(); assert.equal(reflectionDisposals, 1); reflectionTexture.dispose();
console.log('Render quality: one local shadow key, bounded PCF maps, XR cap, caster exclusions, idle reuse, actor geometry preservation, inactive rooms, release and exact native renderer/light restoration passed.');
