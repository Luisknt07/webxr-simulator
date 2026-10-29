const __layout = require("../../tooling/layout.cjs");
'use strict';
// Real vehicle rigs and direct grip adapter; canvas and tracked hand samples
// are the only hardware boundaries adapted by this deterministic fixture.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const vehicles = require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles'), prefabs = require('../support/load-vehicle-prefabs')(THREE), Labels = require('../support/load-vehicle-cab-labels')(THREE);
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-vehicle-cab-labels.js"), '../src/editor/VehicleCabInteraction.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class VehicleCabInteraction', 'return class VehicleCabInteraction');
const Cab = new Function('THREE', 'vehicles', 'VehicleCabLabels', source)(THREE, vehicles, Labels);
function fixture(variant = 'forklift-electric-4w', vr = true) {
  const root = prefabs.createVehicle(vehicles.defaults(variant)), rig = root.userData.vehicleRig, scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), canvases = [];
  root.position.set(3, 0, -2); root.rotation.y = .53; scene.add(root, camera); camera.position.set(.03, 1.63, -.04); camera.rotation.set(.07, .12, -.04);
  const dom = {createElement(tag) {assert.equal(tag, 'canvas'); const canvas = {width: 0, height: 0, texts: [], paths: 0}, context = {fillRect() {}, fillText(value) {canvas.texts.push(value);}, beginPath() {canvas.paths++;}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}}; canvas.getContext = () => context; canvases.push(canvas); return canvas;}};
  const controllers = ['left', 'right'].map(handedness => {const controller = new THREE.Group(), grip = new THREE.Group(); scene.add(controller, grip); grip.position.set(20, 20, 20); return {controller, grip, enabled: true, inputSource: {handedness, gripSpace: {}, targetRayMode: 'tracked-pointer', gamepad: {mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: Array.from({length: 6}, () => ({pressed: false, value: 0})), hapticActuators: [{pulse() {return Promise.resolve();}}]}}};});
  const ctx = {scene, camera, document: dom, vrMode: vr, raycontrol: {enabled: true, controllers}}, record = {components: {vehicle: {config: rig.config, pose: vehicles.initialPose(rig.config)}}};
  const driving = {ctx, document: dom, id: 'truck', record: () => record, blocked: () => driving.menuOpen}, cab = new Cab(driving); scene.updateMatrixWorld(true); cab.mount(root); cab.sample(); return {root, rig, scene, camera, ctx, driving, cab, controllers, canvases};
}
function move(f, hand, point) {hand.grip.position.copy(point); f.scene.updateMatrixWorld(true);}
function squeeze(hand, value) {hand.inputSource.gamepad.buttons[1] = {pressed: value, value: value ? 1 : 0}; hand.controller.dispatchEvent({type: value ? 'squeezestart' : 'squeezeend'});}
function localPoint(control, amount = 0) {control.object.updateWorldMatrix(true, true); return control.descriptor.grip.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3().fromArray(control.descriptor.axis).transformDirection(control.frame).multiplyScalar(amount));}
for (const definition of vehicles.VARIANTS) {
  const f = fixture(definition.id), features = vehicles.supports(f.rig.config), labels = f.cab.labels, expected = f.cab.controls.length;
  assert(expected <= 6); assert.equal(labels.entries.length, expected); if (!expected) {assert.equal(f.canvases.length, 0); f.cab.dispose(); continue;} assert.equal(f.canvases.length, 1); assert.equal(labels.getStats().cabLabelAtlases, 1); assert.equal(labels.getStats().cabLabelMeshes, expected * 2); assert.equal(labels.getStats().cabLabelAtlasBytes, 1048576);
  assert(f.canvases[0].paths > expected); assert(f.canvases[0].texts.some(value => value === 'Dirección'));
  labels.entries.forEach(entry => {
    assert(entry.channel === 'steer' || features[entry.channel], 'Only controls physically supported by ' + definition.id + ' receive a label.');
    assert.equal(entry.plate.material.map, labels.texture); assert(entry.plate.visible); assert(!entry.ring.visible); assert.equal(entry.plate.material.depthTest, true);
    assert.notEqual(entry.plate.parent, f.camera); assert(entry.plate.userData.editorRuntimeHelper && entry.ring.userData.editorRuntimeHelper);
    const positions = entry.plate.geometry.attributes.position; assert(positions.array.every(value => Math.abs(value) < .1), 'Labels remain console-sized instead of becoming a headset overlay.');
    assert(entry.plate.geometry.attributes.uv.array.every(value => value >= 0 && value <= 1));
  });
  const texture = labels.texture, geometries = [...labels.geometries], materials = labels.entries.flatMap(entry => [entry.material, entry.ringMaterial]), disposed = new Map();
  [texture, ...geometries, ...materials].forEach(resource => {disposed.set(resource, 0); resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1));});
  const sourceMaterials = new Set(); f.root.traverse(mesh => {if (mesh.material && !mesh.userData.editorRuntimeHelper) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => sourceMaterials.add(material));}); let sourceDisposals = 0; sourceMaterials.forEach(material => material.addEventListener('dispose', () => sourceDisposals++));
  f.cab.clear(); assert.equal(labels.entries.length, 0); disposed.forEach(count => assert.equal(count, 1)); assert.equal(sourceDisposals, 0); f.cab.dispose();
}
const f = fixture('vna-turret'), labels = f.cab.labels, left = f.controllers[0], right = f.controllers[1], lift = f.cab.controls.find(control => control.channel === 'lift'), entry = labels.entries.find(value => value.channel === 'lift');
const head = f.camera.matrix.clone(), rotation = left.controller.quaternion.clone();
f.cab.setGuidance({control: 'lift'}); assert.equal(entry.state, 'guide'); assert(entry.ring.visible);
move(f, left, localPoint(lift)); f.cab.sample(); assert.equal(entry.state, 'hover'); assert.equal(f.cab.hands.get(left.controller).hover, lift);
squeeze(left, true); f.cab.sample(); assert.equal(entry.state, 'held'); assert.equal(lift.owner, f.cab.hands.get(left.controller));
move(f, right, localPoint(lift)); f.cab.sample(); squeeze(right, true); f.cab.sample(); assert.equal(f.cab.hands.get(right.controller).control, null); assert(f.cab.owns(right.inputSource), 'A second hand cannot turn an owned physical control into a cargo grip.');
move(f, left, localPoint(lift, -lift.descriptor.travel * .6)); f.cab.sample(); const input = {lift: 0}; f.cab.apply(input); assert(input.lift > .5 && input.lift < .7);
squeeze(left, false); f.cab.sample(); assert.equal(lift.owner, null); assert(lift.object.quaternion.angleTo(lift.rest) < 1e-8, 'Hydraulic levers spring back to their physical neutral pose.');
left.grip.visible = false; right.grip.visible = false; f.cab.sample(); assert.equal(entry.state, 'guide', 'Lost tracking clears stale hover feedback.');
f.cab.setGuidance(null); assert.equal(entry.state, 'idle'); assert(!entry.ring.visible); f.driving.menuOpen = true; f.cab.sample(); assert(labels.entries.every(value => !value.plate.visible && !value.ring.visible));
f.driving.menuOpen = false; f.cab.reset(); assert(labels.entries.every(value => value.plate.visible)); f.ctx.vrMode = false; f.cab.reset(); assert(labels.entries.every(value => !value.plate.visible));
assert(f.camera.matrix.equals(head) && left.controller.quaternion.equals(rotation), 'Labels and direct interaction never alter headset/controller tracking poses.');
f.cab.clear(); assert.equal(f.cab.hands.size, 0); assert.equal(f.cab.labels.texture, null);
const desktop = fixture('forklift-electric-4w', false); assert.equal(desktop.canvases.length, 0); assert.equal(desktop.cab.labels.getStats().cabLabelAtlases, 0); desktop.ctx.vrMode = true; desktop.cab.reset(); assert.equal(desktop.canvases.length, 1); desktop.cab.dispose();
console.log('Vehicle cab labels: all real variants, feature-correct pictograms/names, one bounded mount atlas, physical console anchors, guide/hover/grip feedback, bilateral ownership, lever return, tracking/menu/Desktop guards and exactly-once cleanup passed.');
