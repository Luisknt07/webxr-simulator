const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../packages/project-model/shared/studio-document');
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-render-quality.js"), '../src/studio/SceneEnvironment.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class SceneEnvironment', 'return class SceneEnvironment');
const Environment = new Function('THREE', 'schema', source)(THREE, schema);
const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(), fill = new THREE.DirectionalLight();
sun.name = 'sun'; sun.position.set(.2, 1, .1); fill.name = 'fillLight'; scene.add(sun, fill);
const root = new THREE.Group(), other = new THREE.Group(), geometry = new THREE.BoxBufferGeometry(), material = new THREE.MeshStandardMaterial(); scene.add(root);
const machine = new THREE.Mesh(geometry, material), floor = new THREE.Mesh(geometry, material), roof = new THREE.Group(), roofMesh = new THREE.Mesh(geometry, material), helper = new THREE.Mesh(geometry, material);
roof.name = 'CEDI · Cubierta interior cerrada'; roof.add(roofMesh); floor.name = 'CEDI · Piso de hormigón'; helper.userData.editorRuntimeHelper = true; root.add(machine, floor, roof, helper);
const inactive = new THREE.Mesh(geometry, material); other.add(inactive);
const genericFloor = new THREE.Mesh(geometry, material); genericFloor.scale.set(30, .05, 30); genericFloor.position.y = -.03; root.add(genericFloor);
const markingGroup = require('../../modules/logistica-industrial/functions/presentacion/schema/industrialFloor').createVisual(THREE, {type: 'industrialFloor', version: 1, bounds: [-10, -8, 10, 8], floorY: .02, zones: [[-3, -2, 3, 2]], signs: [[3, 3, 0, 1, 6]]}); root.add(markingGroup);
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
editor.ctx.graphics = {getLimits: () => require('../../packages/render-three/schema/graphics-quality').limitsFor('economy')}; environment.sync();
assert.equal(sun.shadow.mapSize.x, 512); assert.equal(environment.stats.effectiveTier, 'economy');
config.shadows = false; environment.sync(); assert.equal(sun.castShadow, false); assert.equal(environment.stats.shadowMaps, 0, 'A device tier never overrides an author who disabled shadows.');
config.shadows = true; delete editor.ctx.graphics; environment.sync();
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
const contextListeners = new Map(); let mockTarget = targetState;
const mockRenderer = {capabilities: {}, getContext() {}, xr: {enabled: true}, getRenderTarget: () => mockTarget,
  domElement: {addEventListener(name, listener) { contextListeners.set(name, listener); }, removeEventListener(name, listener) { if (contextListeners.get(name) === listener) contextListeners.delete(name); }},
  shadowMap: {enabled: false, type: THREE.BasicShadowMap}, toneMapping: THREE.NoToneMapping, toneMappingExposure: .6, outputEncoding: THREE.sRGBEncoding,
  getViewport: target => target.copy(viewportState), getScissor: target => target.copy(scissorState), getScissorTest: () => true,
  setRenderTarget(value) { assert(value === targetState || value.isWebGLRenderTarget && value.width === 1 && value.height === 1); mockTarget = value; },
  setViewport(value) { assert(value.equals(viewportState)); }, setScissor(value) { assert(value.equals(scissorState)); }, setScissorTest(value) { assert.equal(typeof value, 'boolean'); },
  render() { throw new Error('Context recovery must not add scene warmup renders.'); }};
const MockThree = Object.assign({}, THREE, {PMREMGenerator: class {
  fromScene(room) { reflectionPasses++; assert.equal(mockRenderer.xr.enabled, false); assert(room.children.length >= 8); return {texture: reflectionPasses === 1 ? reflectionTexture : new THREE.Texture({width: 768, height: 768}), dispose() { reflectionDisposals++; }}; }
  dispose() { generatorDisposals++; }
}});
const MockEnvironment = new Function('THREE', 'schema', source)(MockThree, schema), reflections = new MockEnvironment({});
assert.equal(mockRenderer.isWebGLRenderer, undefined);
assert.equal(reflections.createReflections(mockRenderer), reflectionTexture); assert.equal(mockRenderer.xr.enabled, true);
assert.equal(reflections.createReflections(mockRenderer), reflectionTexture); assert.equal(reflectionPasses, 1); assert.equal(generatorDisposals, 1);
const recoveryScene = new THREE.Scene(), recoveryRoot = new THREE.Group(), recoverySun = new THREE.DirectionalLight(); recoverySun.name = 'sun'; recoveryScene.add(recoveryRoot, recoverySun);
const recoveryMesh = new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshStandardMaterial()); recoveryRoot.add(recoveryMesh);
const recoveryConfig = Object.assign(schema.defaultEnvironment('hall'), {sky: 'color', renderQuality: 'high', shadows: true}), savedRecovery = JSON.stringify(recoveryConfig), nativeShadow = recoverySun.shadow;
let releasedHandles = 0, restoredHandles = 0;
reflections.editor = {roomId: 'hall', active: true, camera, ctx: {renderer: mockRenderer, camera}, performance: {releaseContextTextureHandles() { releasedHandles++; }, restoreContextTextureHandles() { restoredHandles++; }}, hooks: {renderScene: recoveryScene}, document: {studio: {environments: [recoveryConfig]}, getRoot: () => recoveryRoot, getObjects: () => [recoveryMesh]}};
reflections.sync(); assert.equal(recoveryScene.environment, reflectionTexture); assert.notEqual(recoverySun.shadow, nativeShadow);
let shadowDisposals = 0, prevented = 0; recoverySun.shadow.map = {dispose() { shadowDisposals++; }}; recoverySun.shadow.mapPass = {dispose() { shadowDisposals++; }};
contextListeners.get('webglcontextlost')({preventDefault() { prevented++; }});
assert.equal(prevented, 1); assert.equal(reflections.stats.contextLost, true); assert.equal(reflectionDisposals, 1); assert.equal(shadowDisposals, 2);
assert.equal(releasedHandles, 1);
assert.equal(recoveryScene.environment, null); assert.equal(recoverySun.shadow.map, null); assert.equal(recoverySun.shadow.mapPass, null);
for (let frame = 0; frame < 10; frame++) reflections.sync();
assert.equal(reflectionPasses, 1, 'A lost context cannot rebuild or cache an empty PMREM target.');
contextListeners.get('webglcontextrestored')(); contextListeners.get('webglcontextrestored')();
assert.equal(reflections.stats.contextRestores, 1); assert.equal(reflectionPasses, 1, 'Recovery defers GPU allocation until the next active sync.');
assert.equal(restoredHandles, 1);
reflections.sync(); const restoredTexture = recoveryScene.environment;
assert(restoredTexture && restoredTexture !== reflectionTexture, 'A restored context needs freshly rendered IBL pixels, not the old render-target object.');
assert.equal(reflectionPasses, 2); assert.equal(reflections.stats.shadowMaps, 0); assert.equal(mockRenderer.shadowMap.enabled, false);
assert.equal(reflections.stats.recoveryShadowFallback, true); assert.equal(reflections.stats.shadowFocus, 'context-recovery-fallback');
assert.equal(recoveryMesh.frustumCulled, true); assert.equal(mockTarget, targetState); assert.equal(mockRenderer.xr.enabled, true);
for (let frame = 0; frame < 20; frame++) reflections.sync(); assert.equal(reflectionPasses, 2, 'Idle restored frames reuse the single rebuilt PMREM.');
const hydratedCaster = new THREE.Mesh(recoveryMesh.geometry, recoveryMesh.material); hydratedCaster.position.x = 200; recoveryRoot.add(hydratedCaster); reflections.sync();
assert.equal(mockRenderer.shadowMap.enabled, false, 'Newly hydrated casters cannot re-enable r112 shadow caches from a lost context.'); assert.equal(hydratedCaster.frustumCulled, true);
for (let frame = 0; frame < 10; frame++) reflections.sync();
hydratedCaster.geometry.setIndex(hydratedCaster.geometry.index.clone()); reflections.sync();
assert.equal(mockRenderer.shadowMap.enabled, false, 'A lossless optimized-index replacement also keeps the derived recovery fallback.');
assert.equal(JSON.stringify(recoveryConfig), savedRecovery, 'Recovery never edits the authored environment.');
reflections.dispose(); assert.equal(reflectionDisposals, 2); assert.equal(contextListeners.size, 0); assert.equal(recoverySun.shadow, nativeShadow);
reflectionTexture.dispose(); restoredTexture.dispose(); recoveryMesh.geometry.dispose(); recoveryMesh.material.dispose();
const nativeEnvironment = new THREE.Texture(), nativeMap = {dispose() { throw new Error('A foreign native shadow target must remain owned by its original renderer.'); }};
recoveryScene.environment = nativeEnvironment; recoverySun.shadow.map = nativeMap;
const nativeRecovery = new MockEnvironment({roomId: 'hall', ctx: {renderer: mockRenderer}, hooks: {renderScene: recoveryScene}, document: {studio: {version: 1}}});
nativeRecovery.sync(); assert.equal(nativeRecovery.stats.recoveryShadowFallback, true, 'Recreating an environment does not re-enable the broken cache on the same renderer.'); contextListeners.get('webglcontextlost')({preventDefault() {}}); contextListeners.get('webglcontextrestored')(); nativeRecovery.sync();
assert.equal(recoveryScene.environment, nativeEnvironment); assert.equal(recoverySun.shadow.map, nativeMap); assert.equal(reflectionPasses, 2);
nativeRecovery.dispose(); assert.equal(contextListeners.size, 0); nativeEnvironment.dispose(); recoverySun.shadow.map = null;
const freshRenderer = Object.assign({}, mockRenderer, {shadowMap: {enabled: false, type: THREE.BasicShadowMap}}), freshScene = new THREE.Scene(), freshSun = new THREE.DirectionalLight(); freshSun.name = 'sun'; freshScene.add(freshSun);
const freshEnvironment = new MockEnvironment({roomId: 'hall', ctx: {renderer: freshRenderer, camera}, hooks: {renderScene: freshScene}, document: {studio: {environments: [recoveryConfig]}, getRoot: () => recoveryRoot}});
freshEnvironment.sync(); assert.equal(freshEnvironment.stats.recoveryShadowFallback, false); assert.equal(freshRenderer.shadowMap.enabled, true, 'A fresh renderer starts with the unchanged authored shadow setting.'); freshEnvironment.dispose();
console.log('Render quality: bounded shadows, XR cap, cached indoor IBL, context-loss single rebuild/session shadow fallback, author/native resource preservation and fresh-renderer restoration passed.');
