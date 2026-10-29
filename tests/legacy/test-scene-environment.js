const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const schema = require('../../packages/project-model/shared/studio-document');
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-scene-environment.js"), '../src/studio/SceneEnvironment.js')), 'utf8').replace(/^import .*$/gm, '').replace('export default class SceneEnvironment', 'return class SceneEnvironment');
const SceneEnvironment = new Function('THREE', 'schema', source)(THREE, schema);

assert.equal(schema.normalize({version: 1}).environments, undefined, 'Legacy documents retain native environments.');
const defaults = schema.defaultEnvironment('sound');
assert.deepEqual(schema.normalize({version: 1, environments: [{roomId: 'sound'}]}).environments, [defaults]);
assert.deepEqual(schema.normalize(JSON.parse(JSON.stringify({version: 1, environments: [defaults]}))).environments[0], defaults);
assert.throws(() => schema.defaultEnvironment('another-room'), /compatible/);
assert.throws(() => schema.normalize({version: 1, environments: [defaults, defaults]}), /repetidos/);
for (const patch of [{sky: 'video'}, {skyColor: 'url(test)'}, {sunIntensity: -1}, {ambientIntensity: 6}, {roomId: 'missing'}]) assert.throws(() => schema.normalize({version: 1, environments: [Object.assign({}, defaults, patch)]}));
const explicit = schema.normalize({version: 1, environments: [defaults]}).environments[0];
assert.equal(schema.hasSceneContent({studio: {environments: [explicit]}}, 'sound'), true, 'A level with only environment settings must not be reused by New level.');
assert.equal(schema.hasSceneContent({studio: {environments: [explicit]}}, 'hall'), false);
for (const key of ['entities', 'spawns', 'widgets', 'missions', 'groups']) assert.equal(schema.hasSceneContent({studio: {[key]: [{roomId: 'sound'}]}}, 'sound'), true);
assert.equal(schema.environmentFor({studio: {environments: [explicit]}}, 'sound'), explicit);
assert.equal(schema.environmentFor({studio: {scenes: [{id: 'sound', name: 'Sound renamed'}]}}, 'sound'), null, 'A scene name is not evidence of an empty custom level.');

const native = new THREE.Group(); native.userData.editorNative = true;
const floor = new THREE.Group(); floor.rotation.x = -Math.PI / 2; floor.userData.editorRoom = 'sound';
const legacy = {studio: {version: 1, scenes: [{id: 'sound', name: 'Earlier new level'}]}, getObjects: () => [native, floor], additions: new Map([['floor', {roomId: 'sound', object: floor, descriptor: {type: 'plane'}}]])};
assert.equal(schema.environmentFor(legacy, 'sound'), null);
native.visible = false;
assert.deepEqual(schema.environmentFor(legacy, 'sound'), defaults, 'Restore the exact older custom-level shape without mutating metadata.');
assert.equal(legacy.studio.environments, undefined);
floor.rotation.x = 0; assert.equal(schema.environmentFor(legacy, 'sound'), null, 'A wall is not a floor.'); floor.rotation.x = -Math.PI / 2;
const cachedEditor = {document: legacy, roomId: 'sound', changeVersion: 61}, cached = new SceneEnvironment(cachedEditor);
assert.deepEqual(cached.getConfig(), defaults);
native.visible = true; cachedEditor.changeVersion++;
assert.equal(cached.getConfig(), null, 'Committed visibility edits invalidate inference even after capped undo history fills.');
native.visible = false;

const scene = new THREE.Scene(), originalBackground = new THREE.Color('#09121a'); scene.background = originalBackground;
const sun = new THREE.DirectionalLight('#eeffff', 1), fill = new THREE.DirectionalLight('#fff0ee', .3);
sun.name = 'sun'; sun.position.set(.2, 1, .1); fill.name = 'fillLight'; scene.add(sun, fill);
const originalSun = sun.color.clone(), originalFill = fill.color.clone();
const editor = {roomId: 'sound', hooks: {renderScene: scene}, document: {studio: {environments: [explicit]}}};
const environment = new SceneEnvironment(editor); environment.sync();
const sky = environment.sky, geometry = sky.geometry, material = sky.material;
assert.equal(environment.getConfig(), explicit); assert.equal(sky.parent, scene);
assert.equal(scene.background.getHexString(), defaults.skyColor.slice(1));
assert.equal(material.uniforms.topColor.value.getHexString(), defaults.skyColor.slice(1));
assert.equal(sun.color.getHexString(), defaults.sunColor.slice(1)); assert.equal(fill.intensity, .4);
assert.equal(scene.children.filter(child => child.isLight).length, 2, 'Reuse the main sun and fill lights.');
assert.equal(sky.frustumCulled, false); assert.equal(sky.userData.editorRuntimeHelper, true);
assert.equal(material.depthWrite, false); assert.equal(material.depthTest, false); assert.equal(material.side, THREE.BackSide);
assert.deepEqual(new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1)).intersectObject(sky), [], 'The sky never intercepts editing or XR interactions.');
const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(); rig.position.set(5, 2, -3); camera.position.set(.04, 1.6, 0); rig.add(camera); rig.updateMatrixWorld(true);
sky.onBeforeRender(null, scene, camera); assert.deepEqual(sky.position.toArray(), [5.04, 3.6, -3], 'Each actual render camera centers the sky, including XR eyes and previews.');
for (let index = 0; index < 10; index++) environment.sync();
assert.equal(environment.sky, sky); assert.equal(sky.geometry, geometry); assert.equal(sky.material, material, 'Frame updates do not allocate new sky resources.');

editor.roomId = 'hall'; environment.sync();
assert.equal(environment.getConfig(), null); assert.equal(sky.parent, null); assert.equal(scene.background, originalBackground);
assert.equal(sun.color.getHex(), originalSun.getHex()); assert.equal(fill.color.getHex(), originalFill.getHex()); assert.equal(fill.intensity, .3);
editor.roomId = 'sound'; environment.sync(); assert.equal(environment.sky, sky); assert.equal(sky.parent, scene);
editor.document = {studio: {version: 1}}; environment.sync(); assert.equal(sky.parent, null); assert.equal(scene.background, originalBackground, 'Changing project clears the previous project sky.');

function settings(patch) { editor.document.studio = schema.normalize({version: 1, environments: [Object.assign({}, defaults, patch)]}); environment.sync(); }
settings({sky: 'color', skyColor: '#123456', sunIntensity: .7});
assert.equal(sky.parent, null); assert.equal(scene.background.getHexString(), '123456'); assert.equal(sun.intensity, .7);
settings({sky: 'native', sunIntensity: 0}); assert.equal(scene.background, originalBackground); assert.equal(sun.intensity, 0);
settings({sky: 'day', horizonColor: '#cceeff'}); assert.equal(sky.parent, scene); assert.equal(material.uniforms.horizonColor.value.getHexString(), 'cceeff');

const nextScene = new THREE.Scene(); editor.hooks.renderScene = nextScene; environment.sync();
assert.equal(scene.background, originalBackground); assert.equal(fill.intensity, .3); assert.equal(sky.parent, nextScene);
let geometryDisposed = 0, materialDisposed = 0;
geometry.addEventListener('dispose', () => geometryDisposed++); material.addEventListener('dispose', () => materialDisposed++);
environment.dispose(); assert.equal(sky.parent, null); assert.equal(nextScene.background, null); assert.equal(geometryDisposed, 1); assert.equal(materialDisposed, 1);
console.log('Scene environments: per-level validated settings/roundtrip, precise legacy repair, real reusable sky, main-light reuse, native/project restoration, XR-camera centering, no raycasts and GPU disposal passed.');
