'use strict';
// Production station, RayControl, ECS and r112 PositionalAudio. Only WebAudio
// nodes, loader scheduling, images and canvas drawing use controlled adapters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseThree = require('three');
const {World, System, TagComponent} = require('ecsy');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*$/gm, '').replace(/export default /g, '').replace(/export /g, '');
const audioNodes=[], pendingAudio=[];let deferAudio=false;
const parameter=()=>({value:0,setTargetAtTime(value){this.value=value;}});
function audioNode(kind){const node={kind,connections:new Set(),disconnects:0,stops:0,connect(other){this.connections.add(other);},disconnect(other){this.disconnects++;if(other)this.connections.delete(other);else this.connections.clear();},start(){},stop(){this.stops++;},setPosition(){},setOrientation(){},playbackRate:parameter(),detune:parameter()};audioNodes.push(node);return node;}
const audioContext={currentTime:0,createGain:()=>audioNode('gain'),createPanner:()=>audioNode('panner'),createBufferSource:()=>audioNode('source')},listenerInput=audioNode('listener');
class Audio extends baseThree.PositionalAudio {
  setBuffer(value) {this.bufferAssignments=(this.bufferAssignments||0)+1;return super.setBuffer(value);}
  disconnect() {super.disconnect();this.disconnected=true;return this;}
}
const THREE = Object.assign({}, baseThree, {PositionalAudio: Audio, AudioLoader: class { load(url, done, progress, error) {const job={url,done,error};if(deferAudio)pendingAudio.push(job);else done({url});} }});
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
const ctx = {scene, world, room: 0, vrMode: false, audioListener: {context:audioContext,getInput:()=>listenerInput,timeDelta:.016}, shaders: {basic_vert: '', beam_frag: ''}, assets: {
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
// Real r112 PositionalAudio has no source until play(), even after setBuffer().
// A delayed loader must not turn native controller removal into an exception.
deferAudio=true;
const pending=connect('right'), pendingSound=pending.controller.getObjectByName('spraySound'),pendingLoad=pendingAudio.shift();
assert.equal(pendingSound.source,undefined);assert.equal(pendingSound.buffer,null);
assert.doesNotThrow(()=>ctx.raycontrol.removeController(pending.controller),'Disconnect before audio loading/playback must release the native controller.');
assert.equal(pendingSound.parent,null);assert.equal(pendingSound.panner.connections.size,0);assert.equal(pendingSound.gain.connections.size,0);
pendingLoad.done({id:'late-detached-buffer'});assert.equal(pendingSound.buffer,null,'A late load cannot repopulate a detached sound.');assert.equal(pendingSound.bufferAssignments||0,0);
deferAudio=false;
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

const ready=connect('right'),readySound=ready.controller.getObjectByName('spraySound');
assert(readySound.buffer);assert.equal(readySound.source,undefined,'Loading a buffer must not fabricate an Audio source.');
assert.doesNotThrow(()=>ctx.raycontrol.removeController(ready.controller));assert.equal(readySound.panner.connections.size,0);assert.equal(readySound.gain.connections.size,0);

// Reusing the same Group must isolate the old decoder and old ECS callbacks
// from the new input source, even when completions arrive in reverse order.
ctx.vrMode=true;deferAudio=true;
const first=connect('right');tick();const firstSound=first.controller.getObjectByName('spraySound'),firstLoad=pendingAudio.shift();
const firstChecker=world.getSystem(AreaCheckerSystem).queries.checkers.results.find(entity=>entity.getComponent(components.Object3D).value===first.controller),firstReactor=firstChecker.getComponent(components.AreaReactor),oldEnter=firstReactor.onEntering,oldExit=firstReactor.onExiting;
ctx.raycontrol.removeController(first.controller);tick();
const second=ctx.raycontrol.addController(first.controller,{handedness:'right'}),secondSound=second.controller.getObjectByName('spraySound'),secondLoad=pendingAudio.shift();tick();
assert.notEqual(firstSound,secondSound);assert.equal(second.controller.children.filter(object=>object.name==='spraySound').length,1);
const newCan=can(second),newRay={position:second.raycasterContext.position.clone(),quaternion:second.raycasterContext.quaternion.clone()};secondLoad.done({id:'current-buffer'});firstLoad.done({id:'stale-buffer'});
assert.equal(secondSound.buffer.id,'current-buffer');assert.equal(firstSound.buffer,null);assert.equal(firstSound.bufferAssignments||0,0);
oldEnter(firstChecker);oldExit(firstChecker);ctx.raycontrol.dispatchEvent('controllerDisconnected',first);
assert.equal(can(second),newCan);assert.equal(newCan.parent,second.controller);assert(newCan.visible);assert(second.raycasterContext.position.equals(newRay.position)&&second.raycasterContext.quaternion.equals(newRay.quaternion));assert.equal(second.controller.getObjectByName('spraySound'),secondSound,'A stale disconnect event cannot remove the replacement binding.');
ctx.raycontrol.states.graffiti.onSelectStart({uv:new THREE.Vector2(.2,.2),distance:.2},second.controller);assert(secondSound.isPlaying);tick();
const playingSource=secondSound.source;assert(playingSource&&playingSource.connections.has(secondSound.panner));
ctx.raycontrol.removeController(second.controller);ctx.raycontrol.removeController(second.controller);tick();
assert.equal(playingSource.stops,1);assert.equal(playingSource.disconnects,1);assert.equal(playingSource.onended,null);assert.equal(secondSound.source,null);assert.equal(secondSound.buffer,null);
assert.equal(secondSound.panner.connections.size,0);assert.equal(secondSound.gain.connections.size,0);assert.equal(secondSound.panner.disconnects,1);assert.equal(secondSound.gain.disconnects,1);
ctx.raycontrol.states.graffiti.onSelectEnd({});

const beforeSwap=connect('right'),beforeSwapSound=beforeSwap.controller.getObjectByName('spraySound'),beforeSwapLoad=pendingAudio.shift(),secondary=connect('left');tick();
ctx.raycontrol.changeHandedness('left');tick();const afterSwapSound=secondary.controller.getObjectByName('spraySound'),afterSwapLoad=pendingAudio.shift();
beforeSwapLoad.done({id:'obsolete-preference'});afterSwapLoad.done({id:'preferred-left'});assert.equal(beforeSwapSound.buffer,null);assert.equal(afterSwapSound.buffer.id,'preferred-left');assert(!afterSwapSound.isPlaying,'Async decoding never restarts a sound by itself.');
for(const data of ctx.raycontrol.controllers.slice())ctx.raycontrol.removeController(data.controller);tick();
assert.equal(world.getSystem(AreaCheckerSystem).queries.checkers.results.length,0);assert.equal(ctx.raycontrol.controllers.length,0);
assert(audioNodes.filter(node=>['source','panner','gain'].includes(node.kind)).every(node=>node.connections.size===0),'Every owned audio graph is released, including voices that never played.');
console.log('Native graffiti XR: real r112 PositionalAudio, pending/loaded/playing detach, late decode, reversed completion, stale disconnect/ECS callbacks, preference races, exact source/panner/gain release and native controller reconnection passed.');
