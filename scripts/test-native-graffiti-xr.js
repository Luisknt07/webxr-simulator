'use strict';
// Production station, RayControl and ECS systems. Only audio, image loading and
// canvas drawing are adapted; no tracked headset is claimed by this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseThree = require('three');
const {World, System, TagComponent} = require('ecsy');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*$/gm, '').replace(/export default /g, '').replace(/export /g, '');
class Audio extends baseThree.Group {
  setLoop(value) { this.loop = value; return this; }
  setBuffer(value) { this.buffer = value; return this; }
  play() { this.isPlaying = true; }
  stop() { this.isPlaying = false; }
  disconnect() { this.disconnected = true; }
}
const THREE = Object.assign({}, baseThree, {PositionalAudio: Audio, AudioLoader: class { load(url, done) { done({url}); } }});
const componentNames = ['Area', 'AreaReactor', 'AreaInside', 'AreaExiting', 'AreaEntering', 'AreaChecker', 'Object3D', 'BoundingBox', 'ParentObject3D', 'DebugHelper'];
const components = new Function('THREE', 'TagComponent', read('src/components/index.js') + '\nreturn {' + componentNames.join(',') + '};')(THREE, TagComponent);
const {nativeBehavior, declareNativeBehaviors} = new Function('THREE', read('src/editor/NativeBehaviorAdapters.js') + '\nreturn {nativeBehavior,declareNativeBehaviors};')(THREE);
const EventDispatcher = new Function(read('src/lib/EventDispatcher.js') + '\nreturn EventDispatcher;')();
const RayControl = new Function('THREE', 'EventDispatcher', read('src/lib/RayControl.js') + '\nreturn RayControl;')(THREE, EventDispatcher);
const ColorWheel = new Function('THREE', 'hsv2rgb', read('src/lib/ColorWheel.js') + '\nreturn ColorWheel;')(THREE, () => ({r: 32, g: 64, b: 128}));
function canvas() {
  return {width: 10, height: 10, getContext: () => new Proxy({getImageData: () => ({data: new Uint8ClampedArray(4)})}, {get(target, key) { return target[key] || (() => {}); }}), toDataURL: () => ''};
}
const names = Object.keys(components);
const graffiti = new Function('THREE', 'nativeBehavior', 'declareNativeBehaviors', 'ColorWheel', ...names, 'document', 'Image', 'angleBetween', 'getRandomInt',
  read('src/stations/Graffiti.js') + '\nreturn {setup,enter,execute};')(THREE, nativeBehavior, declareNativeBehaviors, ColorWheel, ...names.map(name => components[name]), {createElement: canvas}, class {}, () => 0, () => 1);
function system(file, name) { return new Function('THREE', 'System', ...names, read(file) + '\nreturn ' + name + ';')(THREE, System, ...names.map(key => components[key])); }
const world = new World();
const AreaCheckerSystem = system('src/systems/AreaCheckerSystem.js', 'AreaCheckerSystem');
world.registerSystem(AreaCheckerSystem);
world.registerSystem(system('src/systems/ControllersSystem.js', 'ControllersSystem'));
const scene = new THREE.Group(), hall = new THREE.Group(); scene.add(hall);
const wall = new THREE.Mesh(new THREE.PlaneBufferGeometry(5, 3), new THREE.MeshBasicMaterial()); wall.name = 'graffiti'; wall.position.set(0, 1.5, 6); hall.add(wall);
const sprayModel = new THREE.Group();
for (const name of ['spraycan', 'spraycolor']) { const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(.08, .15, .08), new THREE.MeshBasicMaterial()); mesh.name = name; sprayModel.add(mesh); }
const originalCan = sprayModel.getObjectByName('spraycan'), geometry = Array.from(originalCan.geometry.attributes.position.array);
const beamModel = new THREE.Group(), beam = new THREE.Mesh(new THREE.BoxBufferGeometry(.001, .001, 1), new THREE.MeshBasicMaterial()); beam.name = 'beam'; beamModel.add(beam);
const ctx = {scene, world, room: 0, vrMode: false, audioListener: new THREE.Group(), shaders: {basic_vert: '', beam_frag: ''}, assets: {
  spray_model: {scene: sprayModel}, spray_tex: new THREE.Texture(), lightmap_tex: new THREE.Texture(), teleport_model: {scene: beamModel}, beam_tex: new THREE.Texture()
}};
ctx.raycontrol = new RayControl(ctx, 'right');
graffiti.setup(ctx, hall);
function connect(handedness, desktop = false) {
  const controller = new THREE.Group(); controller.userData.isDesktop = desktop;
  controller.boundingBox = new THREE.Box3(new THREE.Vector3(-.05, .95, 4.95), new THREE.Vector3(.05, 1.05, 5.05));
  const model = new THREE.Group(); model.name = 'Scene'; controller.add(model); scene.add(controller);
  return ctx.raycontrol.addController(controller, {handedness});
}
const desktop = connect('right', true), right = connect('right'), left = connect('left');
function tick() { scene.updateMatrixWorld(true); world.execute(.016, 1); }
const can = data => data.controller.getObjectByName('spray');
tick();
assert(can(desktop).visible && !can(right).visible, 'Desktop and XR keep independent spray cans, active only in their input mode.');
assert.notEqual(can(desktop), can(right)); assert.equal(can(desktop).parent, desktop.controller); assert.equal(can(right).parent, right.controller);
assert.deepEqual(Array.from(originalCan.geometry.attributes.position.array), geometry, 'Connecting hands never rotates or deforms the shared asset geometry.');
assert(ctx.raycontrol.currentStates.some(state => state.name === 'graffiti'));
ctx.vrMode = true; desktop.enabled = false; tick();
assert(!can(desktop).visible && can(right).visible, 'Entering VR activates the tracked primary hand without losing the desktop can.');
assert(left.controller.getObjectByName('ColorWheel').visible);
assert(ctx.raycontrol.currentStates.some(state => state.name === 'graffiti'));
const wheel = left.controller.getObjectByName('ColorWheel');
ctx.raycontrol.states.colorwheel.onSelectStart({object: wheel.getObjectByName('colorWheel'), point: new THREE.Vector3(), uv: new THREE.Vector2(.75, .75)}, right.controller);
assert.equal(can(right).getObjectByName('spraycolor').material.color.getHex(), new THREE.Color(32 / 255, 64 / 255, 128 / 255).getHex());
ctx.raycontrol.changeHandedness('left'); tick();
assert(can(left).visible && !left.controller.getObjectByName('ColorWheel'));
assert(right.controller.getObjectByName('ColorWheel').visible && !can(right), 'Changing preferred hand swaps native tools and disposes the old bindings.');
assert.deepEqual(Array.from(originalCan.geometry.attributes.position.array), geometry);
const leftCan = can(left), oldSound = left.controller.getObjectByName('spraySound'); oldSound.play();
ctx.raycontrol.removeController(left.controller); tick();
assert.equal(leftCan.parent, null); assert(!oldSound.isPlaying && oldSound.disconnected);
assert(!ctx.raycontrol.currentStates.some(state => state.name === 'graffiti'), 'Removing an active painting hand stops its state and looping sound.');
const reconnected = ctx.raycontrol.addController(left.controller, {handedness: 'left'}); tick();
assert(can(reconnected).visible); assert.equal(left.controller.children.filter(object => object.name === 'spray').length, 1);
ctx.raycontrol.removeController(right.controller); tick();
assert(!ctx.raycontrol.states.colorwheel); assert.equal(right.controller.getObjectByName('ColorWheel'), undefined);
ctx.vrMode = false; desktop.enabled = true; ctx.raycontrol.changeHandedness('right'); tick();
assert(can(desktop).visible && !reconnected.controller.getObjectByName('ColorWheel').visible, 'Exiting VR restores the desktop native experience.');
for (const data of ctx.raycontrol.controllers.slice()) ctx.raycontrol.removeController(data.controller);
tick(); assert.equal(world.getSystem(AreaCheckerSystem).queries.checkers.results.length, 0, 'Disconnect removes the native per-controller area checkers.');
assert.equal(ctx.raycontrol.controllers.length, 0);
console.log('Native graffiti XR: independent desktop/tracked tools, unchanged source geometry, real ECS input-mode changes, hand preference, color wheel, disconnect/reconnect cleanup and desktop restoration passed.');
