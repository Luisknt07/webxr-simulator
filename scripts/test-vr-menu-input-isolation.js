'use strict';
// Real ray selection; the small canvas/XR hardware boundary is not involved.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const EventDispatcher = new Function(read('src/lib/EventDispatcher.js').replace('default class EventDispatcher', 'return class EventDispatcher'))();
const RayControl = new Function('THREE', 'EventDispatcher', read('src/lib/RayControl.js').replace('default class RayControl', 'class RayControl') + '\nreturn RayControl;')(THREE, EventDispatcher);

function fixture() {
  const scene = new THREE.Scene(), beamModel = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.BoxBufferGeometry(.001, .001, 1), new THREE.MeshBasicMaterial()); beam.name = 'beam'; beamModel.add(beam);
  const ctx = {scene, vrMode: true, assets: {teleport_model: {scene: beamModel}, beam_tex: new THREE.Texture()}, shaders: {basic_vert: '', beam_frag: ''}};
  const input = ctx.raycontrol = new RayControl(ctx, 'right');
  const controllers = ['left', 'right'].map(handedness => { const controller = new THREE.Group(); scene.add(controller); const data = input.addController(controller, {handedness}); return {controller, data}; });
  const machine = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), new THREE.MeshBasicMaterial()); machine.position.z = -.5; scene.add(machine);
  const panel = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), new THREE.MeshBasicMaterial()); panel.position.z = -1.5; scene.add(panel);
  const values = {machineStart: 0, machineEnd: 0, machineCancel: 0, nativeStart: 0, nativeEnd: 0, menuStart: 0, menuEnd: 0};
  input.addState('machine', {controller: 'both', colliderMesh: machine, captureSelect: true, consumeSelect: true,
    onSelectStart() { values.machineStart++; }, onSelectEnd() { values.machineEnd++; }, onSelectCancel() { values.machineCancel++; }}, true);
  input.addState('native', {controller: 'both', raycaster: false, onSelectStart() { values.nativeStart++; }, onSelectEnd() { values.nativeEnd++; }}, true);
  input.addState('vr-menu', {controller: 'both', colliderMesh: panel, captureSelect: true, consumeSelect: true, vrOnly: true, xrMenu: true,
    onSelectStart() { values.menuStart++; }, onSelectEnd() { values.menuEnd++; }}, true);
  scene.updateMatrixWorld(true);
  const step = () => { scene.updateMatrixWorld(true); input.execute(ctx, .016, .1); };
  const click = data => { input.onSelectStart({target: data.controller}); input.onSelectEnd({target: data.controller}); };
  return {ctx, scene, input, controllers, machine, panel, values, step, click};
}

const f = fixture(); f.step();
assert(f.controllers.every(row => row.data.currentIntersection.state.name === 'machine'), 'Nearby equipment remains clickable while the VR menu is closed.');
f.controllers.forEach(f.click); assert.equal(f.values.machineStart, 2); assert.equal(f.values.machineEnd, 2); assert.equal(f.values.menuStart, 0);
f.ctx.studioMenuOpen = true; f.step();
assert(f.controllers.every(row => row.data.currentIntersection.state.xrMenu), 'The menu wins over nearer physical equipment while it is open.');
f.controllers.forEach(f.click); assert.equal(f.values.menuStart, 2); assert.equal(f.values.menuEnd, 2); assert.equal(f.values.machineStart, 2); assert.equal(f.values.nativeStart, 0);

// No-hit presses must not fall through to non-raycaster native handlers.
f.panel.visible = false; f.step(); f.controllers.forEach(f.click);
assert.equal(f.values.nativeStart, 0); assert.equal(f.values.nativeEnd, 0); assert.equal(f.values.machineStart, 2);

// A cached world hit/capture from just before opening cannot act underneath UI.
f.ctx.studioMenuOpen = false; f.panel.visible = true; f.step();
f.input.onSelectStart({target: f.controllers[0].controller}); assert.equal(f.values.machineStart, 3);
f.ctx.studioMenuOpen = true;
f.input.onSelectEnd({target: f.controllers[0].controller});
assert.equal(f.values.machineEnd, 2, 'A release captured by world machinery is blocked after entering a modal menu.');
f.controllers[1].data.currentIntersection = {state: f.input.states.machine, intersection: {object: f.machine, distance: .5}};
assert(!f.input.selectionEntries(f.controllers[1].data).some(entry => !entry.state.xrMenu), 'Stale machine hits are excluded before the next raycast frame.');

// New scene runtimes may activate machine states while the menu stays open.
f.input.deactivateAll(); f.input.activateState('machine'); f.input.activateState('native'); f.input.activateState('vr-menu'); f.step();
f.controllers.forEach(f.click); assert.equal(f.values.machineStart, 3); assert.equal(f.values.menuStart, 4);
f.ctx.studioMenuOpen = false; f.step(); f.controllers.forEach(f.click); assert.equal(f.values.machineStart, 5);
assert.equal(f.input.currentStates.length, 3, 'Filtering never snapshots or destroys runtime state registrations.');
console.log('VR menu input isolation: both controller rays, nearer machinery, stale captures, non-ray native handlers and runtime reactivation remain isolated, with normal controls restored after close.');
