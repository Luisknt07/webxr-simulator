const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors');
const canvases = [];
const dom = {createElement(type) {
  assert.equal(type, 'canvas');
  const drawing = {texts: [], clears: 0, clearRect() { this.clears++; this.texts = []; }, fillRect() {},
    measureText(value) { return {width: String(value).length * 9}; }, fillText(value) { this.texts.push(value); }};
  const canvas = {getContext: () => drawing, drawing}; canvases.push(canvas); return canvas;
}};
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-contextual-info.js"), '../src/editor/BehaviorRuntime.js')), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class BehaviorRuntime', 'return class BehaviorRuntime');
const BehaviorRuntime = new Function('THREE', 'behaviorSchema', 'document', source)(THREE, schema, dom);
function board(id, x, z, overrides = {}) {
  const object = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  object.name = 'Guía · ' + id; object.position.set(x, 1.55, z); object.scale.set(3, 2, .1);
  object.userData.editorId = id; object.userData.editorDescriptor = {type: 'box', color: '#172d42'};
  object.userData.editorBehaviors = schema.normalizeBehaviors([Object.assign({type: 'info', title: id, text: 'Contenido editable y conservado.', presentation: 'contextual'}, overrides), {type: 'billboard'}]);
  return object;
}
function fixture(objects) {
  const scene = new THREE.Scene(), root = new THREE.Group(), camera = new THREE.PerspectiveCamera(); scene.add(root, camera); objects.forEach(object => root.add(object)); camera.position.set(0, 1.55, 0);
  const notices = [], rays = [], document = {getObjects: () => objects, getBehaviors: object => object.userData.editorBehaviors || []};
  const ctx = {scene, camera, room: 2, editor: {active: false}, raycontrol: {states: {}, deactivateState() {}},
    collisionWorld: {rayBlocked(from, to, options) { rays.push({from: from.clone(), to: to.clone(), options}); return false; }}};
  const runtime = new BehaviorRuntime(ctx, document, {}, message => notices.push(message)); runtime.start('sound');
  const tick = (count = 20, delta = .05) => { for (let index = 0; index < count; index++) { scene.updateMatrixWorld(true); runtime.execute(delta, index * delta); } assert.deepEqual(notices, []); };
  return {scene, root, camera, ctx, runtime, rays, notices, tick};
}
function close(f) { f.runtime.stop(); assert.equal(f.runtime.contextualStats.canvases, 0); assert.equal(f.runtime.contextualRendering.size, 0); assert.equal(f.scene.children.filter(child => child.userData.editorRuntimeHelper).length, 0); }

// Legacy remains opt-in: existing info adapters and native components retain ownership.
assert.equal(schema.defaultBehavior('info').presentation, 'always'); assert.equal(schema.defaultBehavior('billboard').axis, 'full');
const legacyInfo = [{type: 'info', enabled: true, title: 'Texto previo', text: 'Contenido previo intacto.', fontSize: .05, color: '#ffffff'}, {type: 'billboard', enabled: true}];
let oldRoundtrip = legacyInfo; for (let pass = 0; pass < 3; pass++) oldRoundtrip = schema.normalizeBehaviors(JSON.parse(JSON.stringify(oldRoundtrip))); assert.deepEqual(oldRoundtrip, legacyInfo, 'New presentation defaults never rewrite legacy info or billboard records.');
assert.equal(schema.normalizeBehaviors([{type: 'info', presentation: 'contextual'}])[0].revealDistance, 5); assert.equal(schema.normalizeBehaviors([{type: 'info', width: 1.2}])[0].presentation, 'always', 'Explicit optional configuration receives validated defaults.');
for (const patch of [{presentation: 'floating'}, {revealDistance: 0}, {fadeDistance: 8}, {fadeTime: -1}, {gazeAngle: 180}, {width: .1}]) assert.throws(() => schema.normalizeBehaviors([Object.assign({type: 'info'}, patch)]));
assert.throws(() => schema.normalizeBehaviors([{type: 'billboard', axis: 'pitch'}]));
const legacy = board('legacy', 0, -2, {presentation: 'always'}), native = board('native', 1, -2); native.userData.editorNativeBehaviorTypes = ['info', 'billboard'];
const fLegacy = fixture([]); let legacyCalls = 0; fLegacy.runtime.document.getObjects = () => [legacy, native]; fLegacy.ctx.editorBehaviorAdapters = {info() { legacyCalls++; return {dispose() {}}; }}; fLegacy.runtime.start('sound');
assert.equal(legacyCalls, 1); assert.equal(fLegacy.runtime.contextual.length, 0); close(fLegacy);

const near = board('near', 0, -2), far = board('far', 1, -3), behind = board('behind', 0, 2), f = fixture([far, behind, near]);
const authoredPose = [near.position.toArray(), near.quaternion.toArray(), near.scale.toArray()];
assert.equal(canvases.length, 0, 'No canvas or texture is allocated until a relevant card is selected.');
assert.equal(near.material.visible, false, 'The original black backing does not remain as an empty giant board.');
f.tick(); assert.equal(f.runtime.contextualStats.activeId, 'near'); assert.equal(f.runtime.contextualStats.canvases, 1);
let component = f.runtime.contextualActive; assert(component.opacity > .98); assert.equal(component.card.geometry.parameters.width, 1); assert.equal(component.card.geometry.parameters.height, .625);
assert.equal(component.texture.image.width, 480); assert.equal(component.texture.image.height, 300); assert.equal(component.card.material.depthWrite, false); assert.equal(component.card.material.toneMapped, false);
assert(component.card.material.opacity > .98); assert.deepEqual([near.position.toArray(), near.quaternion.toArray(), near.scale.toArray()], authoredPose, 'Camera following never records an authored transform.');
assert(Math.abs(component.card.rotation.x) < 1e-6, 'Contextual cards remain upright.');
const canvas = component.texture.image, clears = canvas.drawing.clears; f.tick(2); assert.equal(canvas.drawing.clears, clears, 'Static content never redraws each frame.');
near.userData.editorBehaviors.find(value => value.type === 'info').text = 'Texto editado sin recrear la tarjeta.';
f.tick(1); assert.equal(component.texture.image, canvas); assert.equal(canvas.drawing.clears, clears + 1); assert(canvas.drawing.texts.join(' ').includes('Texto editado'));

// Close candidates keep their relevance with hysteresis; larger changes switch with one bounded fade.
far.position.set(0, 1.55, -1.9); f.tick(3); assert.equal(f.runtime.contextualStats.activeId, 'near');
far.position.z = -1; f.tick(1); assert.equal(f.runtime.contextualStats.activeId, 'far'); assert(f.runtime.contextualStats.canvases <= 2); f.tick(30); assert.equal(f.runtime.contextualStats.canvases, 1);
f.camera.position.y = 3; f.tick(); assert(Math.abs(f.runtime.contextualActive.card.rotation.x) < 1e-6, 'A high desktop/XR camera only changes yaw.');
f.camera.position.set(0, 1.55, 8); f.tick(30); assert.equal(f.runtime.contextualStats.activeId, null); assert.equal(f.runtime.contextualStats.canvases, 0, 'Cards fade away beyond their reveal distance.');
f.camera.position.z = 0; f.camera.rotation.y = Math.PI; f.tick(); assert.equal(f.runtime.contextualStats.activeId, 'behind', 'Gaze relevance follows the current camera orientation.');
f.root.visible = false; f.tick(30); assert.equal(f.runtime.contextualStats.activeId, null); assert.equal(f.runtime.contextualStats.canvases, 0); f.root.visible = true;
f.camera.rotation.y = 0; f.tick(); assert.equal(f.runtime.contextualStats.activeId, 'far'); f.ctx.room = 3; f.tick(1); assert.equal(f.runtime.contextualStats.canvases, 0, 'A room switch clears cards immediately even before the lifecycle stop.');
close(f); assert.equal(near.material.visible, true); assert.equal(far.material.visible, true);

// XR uses the renderer's current camera, including switching XR eyes/desktop between frames.
const desktop = board('desktop', 0, -2), xrBoard = board('xr', 10, -2), xr = fixture([desktop, xrBoard]);
const xrCamera = new THREE.PerspectiveCamera(); xrCamera.position.set(10, 1.55, 0); xr.scene.add(xrCamera); xr.ctx.renderer = {xr: {getCamera: value => { assert.equal(value, xr.camera); return xrCamera; }}};
xr.tick(); assert.equal(xr.runtime.contextualStats.activeId, 'desktop'); xr.ctx.vrMode = true; xr.tick(); assert.equal(xr.runtime.contextualStats.activeId, 'xr');
xr.ctx.vrMode = false; xr.tick(); assert.equal(xr.runtime.contextualStats.activeId, 'desktop'); close(xr);

const transformed = board('transformed', 0, -2), rotated = fixture([transformed]); rotated.root.position.set(7, 2, -3); rotated.root.rotation.set(.12, .7, -.08); rotated.root.scale.set(1.2, .8, .9); rotated.scene.updateMatrixWorld(true);
const worldPosition = transformed.getWorldPosition(new THREE.Vector3()); rotated.camera.position.copy(worldPosition).add(new THREE.Vector3(0, 0, 2)); rotated.tick();
assert.equal(rotated.runtime.contextualStats.activeId, 'transformed'); assert(rotated.runtime.contextualActive.card.getWorldPosition(new THREE.Vector3()).distanceTo(worldPosition) < 1e-8, 'Cards follow the exact world position under translated/rotated/scaled room roots.'); assert.deepEqual(rotated.runtime.contextualActive.card.scale.toArray(), [1, 1, 1], 'Authored room/object scaling cannot inflate the reading card.'); close(rotated);

const disabled = board('disabled', 0, -2), edited = fixture([disabled]); edited.tick(); const oldCard = edited.runtime.contextualActive.card, oldOpacity = oldCard.material.opacity; let released = 0;
[oldCard.geometry, oldCard.material, oldCard.material.map].forEach(resource => resource.addEventListener('dispose', () => released++));
disabled.userData.editorBehaviors.find(value => value.type === 'info').enabled = false; edited.tick(1); assert(oldCard.material.opacity < oldOpacity, 'Disabling a live message fades its current texture rather than leaving stale content visible.'); edited.tick(30); assert.equal(released, 3, 'Geometry, material and canvas texture are all disposed exactly once.'); assert.equal(edited.runtime.contextualStats.canvases, 0); close(edited);

// Work stays bounded independently of the number of authored guides, and blockers suppress the selected card.
const many = Array.from({length: 137}, (_, index) => board('card-' + index, 0, -2 - index * .01)); const bounded = fixture(many);
bounded.tick(40); assert.equal(bounded.runtime.contextualStats.activeId, 'card-0'); assert.equal(bounded.runtime.contextualStats.maxScannedPerFrame, 8); assert.equal(bounded.runtime.contextualStats.canvases, 1);
bounded.ctx.collisionWorld.rayBlocked = () => true; const probes = bounded.runtime.contextualStats.occlusionRays; bounded.tick(4); assert(bounded.runtime.contextualStats.occlusionRays - probes <= 4, 'At most one accelerated visibility probe occurs per frame.'); assert.equal(bounded.runtime.contextualStats.activeId, null);
bounded.tick(30); assert(bounded.runtime.contextualStats.canvases <= 2); close(bounded);

// Info on a functioning machine cannot hide its physical body or controls.
const machine = board('machine', 0, -2); machine.userData.editorBehaviors.push(schema.defaultBehavior('processor')); const machineFixture = fixture([machine]);
assert.equal(machine.material.visible, true); machineFixture.tick(); close(machineFixture);
console.log('Contextual info: legacy/native ownership, lazy compact cards, bounded nearest/gaze selection and hysteresis, fade/occlusion, room visibility, XR camera, live text redraw and complete resource/pose restoration passed.');
