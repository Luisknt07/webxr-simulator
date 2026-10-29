const __layout = require("../../tooling/layout.cjs");
/* Reproducible native-station checks without requiring a headset or audio device. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Three = require('three');

const workspace = __layout.map(path.resolve(__layout.oldDir("scripts/test-native-editor.js"), '..'));
function source(relativePath) {
  return fs.readFileSync(__layout.map(path.join(workspace, relativePath)), 'utf8');
}

function station(relativePath, injected, exports) {
  const code = source(relativePath).replace(/^import .*$/mg, '').replace(/export /g, '');
  const sandbox = Object.assign({console}, injected);
  vm.createContext(sandbox);
  const bindings = source("packages/tools/editor/src/NativeBehaviorAdapters.js").replace(/^import .*$/mg, '').replace(/export /g, '');
  vm.runInContext(bindings, sandbox, {filename: "packages/tools/editor/src/NativeBehaviorAdapters.js"});
  vm.runInContext(code + '\nthis.api = {' + exports.join(',') + '};', sandbox, {filename: relativePath});
  return sandbox.api;
}

async function testNativeBindings() {
  const native = await import('data:text/javascript;base64,' + Buffer.from(source("packages/tools/editor/src/NativeBindings.js")).toString('base64'));
  const root = new Three.Group(), hall = new Three.Group();
  root.add(hall);
  const ball = new Three.Mesh();
  ball.userData = {panoId: 4, floatY: 2};
  ball.position.y = 2.02;
  hall.add(ball);
  const marker = new Three.Mesh();
  marker.name = 'panoball1';
  marker.position.y = 3;
  hall.add(marker);
  const note = new Three.Mesh(new Three.BoxBufferGeometry());
  note.name = 'xnote000';
  note.position.y = 5;
  note.userData = {resetY: 4, animation: 1};
  hall.add(note);
  const stick = new Three.Group();
  stick.name = 'xylostick-left';
  stick.position.set(1, 2, 3);
  stick.userData = {
    resetPosition: stick.position.clone(), resetRotation: stick.rotation.clone(),
    desktopHomePosition: stick.position.clone(), desktopHomeRotation: stick.rotation.clone(), grabbedBy: null
  };
  hall.add(stick);
  const controller = new Three.Group();
  controller.userData.grabbing = stick;
  stick.userData.grabbedBy = controller;
  controller.add(stick);
  stick.position.set(0, 0, 0);
  const audio = new Three.Object3D();
  audio.isAudio = true;
  audio.isPlaying = true;
  audio.stop = () => { audio.isPlaying = false; };
  hall.add(audio);
  const ctx = {assets: {hall_model: {scene: hall}}, controllers: [controller], teleport: {onHoverLeave() {}}};
  native.prepareNativeEdit(ctx, root);
  assert.equal(ball.position.y, 2);
  assert.equal(note.position.y, 4);
  assert.equal(stick.parent, hall);
  assert.deepEqual(stick.position.toArray(), [1, 2, 3]);
  assert.equal(controller.userData.grabbing, null);
  assert.equal(audio.isPlaying, false);
  ball.position.y = 7;
  note.position.y = 8;
  stick.position.set(9, 10, 11);
  native.syncNativeTransforms(ctx, root);
  assert.equal(ball.userData.floatY, 7);
  assert.equal(note.userData.resetY, 8);
  assert.deepEqual(stick.userData.resetPosition.toArray(), [9, 10, 11]);
  assert.equal(marker.position.y, 3);
  assert.match(native.describeNative(note), /Nota nativa/);
}

function testXylophone() {
  const THREE = Object.assign({}, Three, {
    AudioListener: class extends Three.Group {},
    AudioLoader: class { load(url, callback) { callback({}); } }
  });
  class Polyphonic extends Three.Group {
    constructor() { super(); this.playCount = 0; }
    setBuffer() {}
    play() { this.playCount++; }
  }
  const api = station("modules/turismo/functions/museo/stations/Xylophone.js", {THREE, PositionalAudioPolyphonic: Polyphonic}, ['setup', 'enter', 'exit', 'execute', 'onSelectStart', 'onSelectEnd']);
  const world = new THREE.Scene(), hall = new THREE.Group();
  world.add(hall);
  hall.position.set(10, 0, -4);
  hall.rotation.y = 0.6;
  hall.scale.setScalar(1.5);
  for (let i = 0; i < 13; i++) {
    const note = new THREE.Mesh(new THREE.BoxBufferGeometry(0.3, 0.2, 0.4));
    note.name = 'xnote0' + (i < 10 ? '0' + i : i);
    note.position.set(i * 3, 1, 0);
    hall.add(note);
  }
  ['left', 'right'].forEach(side => {
    const stick = new THREE.Group();
    stick.name = 'xylostick-' + side;
    stick.position.set(0, 1, side === 'left' ? 0 : 8);
    const tip = new THREE.Mesh(new THREE.SphereBufferGeometry(0.1));
    tip.name = 'xylostickball-' + side;
    stick.add(tip);
    hall.add(stick);
  });
  const controllers = [new THREE.Group(), new THREE.Group()];
  controllers.forEach(controller => {
    world.add(controller);
    controller.userData.grabbing = null;
    controller.boundingBox = new THREE.Box3();
  });
  const desktop = new THREE.Group();
  desktop.userData.grabbing = null;
  const ctx = {
    controllers, desktopController: desktop, camera: new THREE.PerspectiveCamera(), scene: world,
    editor: {active: false}, raycontrol: {enable() {}, disable() {}}
  };
  api.setup(ctx, hall);
  for (let i = 0; i < 3; i++) {
    api.enter(ctx);
    assert.equal(controllers[0]._listeners.selectstart.length, 1);
    api.exit(ctx);
    assert.equal(controllers[0]._listeners.selectstart.length, 0);
  }
  api.enter(ctx);
  world.updateMatrixWorld(true);
  const stick = hall.getObjectByName('xylostick-left');
  controllers[0].position.copy(stick.getWorldPosition(new THREE.Vector3()));
  world.updateMatrixWorld(true);
  controllers[0].boundingBox.setFromCenterAndSize(controllers[0].position, new THREE.Vector3(0.3, 0.3, 0.3));
  api.onSelectStart({target: controllers[0]});
  assert.equal(controllers[0].userData.grabbing, stick);
  world.updateMatrixWorld(true);
  api.execute(ctx, 0.016, 0);
  const note = hall.getObjectByName('xnote000');
  assert.equal(note.userData.sound.playCount, 1);
  api.onSelectEnd({target: controllers[0]});
  assert.equal(stick.parent, hall);
  assert.ok(stick.position.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6);
  note.visible = false;
  controllers[0].userData.noteCollisions = new Array(13).fill(false);
  api.onSelectStart({target: controllers[0]});
  world.updateMatrixWorld(true);
  api.execute(ctx, 0.016, 0);
  assert.equal(note.userData.sound.playCount, 1, 'Hidden notes must not play.');
  api.onSelectEnd({target: controllers[0]});
  // Entering/exiting XR in the same hall releases both native and copied
  // sticks without tearing down the listeners needed by that same room.
  const copiedStick = new THREE.Group(); copiedStick.name = 'copied-stick'; copiedStick.position.set(5, 1, 5);
  copiedStick.add(new THREE.Mesh(new THREE.SphereBufferGeometry(0.1)));
  copiedStick.userData.editorBehaviors = [{type: 'grab', enabled: true, distance: 6, returnOnRelease: false}];
  hall.add(copiedStick); ctx.editorXylophone.addStick(copiedStick);
  world.updateMatrixWorld(true);
  controllers[1].position.copy(copiedStick.getWorldPosition(new THREE.Vector3()));
  world.updateMatrixWorld(true);
  controllers[1].boundingBox.setFromCenterAndSize(controllers[1].position, new THREE.Vector3(0.3, 0.3, 0.3));
  api.onSelectStart({target: controllers[0]}); api.onSelectStart({target: controllers[1]});
  assert.equal(controllers[0].userData.grabbing, stick); assert.equal(controllers[1].userData.grabbing, copiedStick);
  const desktopStick = hall.getObjectByName('xylostick-right');
  world.add(desktop); desktop.userData.isDesktop = true;
  desktop.userData.grabbing = desktopStick; desktop.userData.editorNoteCollisions = new Set([note]);
  desktopStick.userData.grabbedBy = desktop; desktop.add(desktopStick); desktopStick.position.set(0, 0, 0);
  ctx.editorXylophone.releaseHeld();
  [controllers[0], controllers[1], desktop].forEach(controller => {
    assert.equal(controller.userData.grabbing, null);
    assert.equal(controller.userData.editorNoteCollisions, null);
  });
  [stick, copiedStick, desktopStick].forEach(released => { assert.equal(released.parent, hall); assert.equal(released.userData.grabbedBy, null); });
  assert.deepEqual(copiedStick.position.toArray(), [5, 1, 5], 'Mode changes force a copied stick home even when ordinary release leaves it in place');
  assert.equal(controllers[0]._listeners.selectstart.length, 1, 'Mode changes preserve existing native input listeners');
  assert.equal(desktop._listeners.griptoggle.length, 1);
  ctx.editor.active = true;
  api.onSelectStart({target: controllers[0]});
  assert.equal(controllers[0].userData.grabbing, null);
}

function testXylophoneIndustrialHands() {
  const THREE = Object.assign({}, Three, {AudioListener: class extends Three.Group {}, AudioLoader: class {load(url, callback) { callback({}); }}});
  class Polyphonic extends Three.Group {setBuffer() {} play() {}}
  const api = station("modules/turismo/functions/museo/stations/Xylophone.js", {THREE, PositionalAudioPolyphonic: Polyphonic}, ['setup', 'enter', 'exit', 'execute', 'onSelectStart', 'onSelectEnd']);
  const dispatcherSource = source("packages/render-three/src/EventDispatcher.js").replace('export default class EventDispatcher', 'return class EventDispatcher');
  const EventDispatcher = new Function(dispatcherSource)();
  const raySource = source("packages/render-three/src/RayControl.js").replace(/^import .*$/mg, '').replace('export var ', 'var ').replace('export default class RayControl', 'return class RayControl');
  const RayControl = new Function('THREE', 'EventDispatcher', raySource)(Three, EventDispatcher);
  const scene = new Three.Scene(), hall = new Three.Group(); scene.add(hall);
  ['left', 'right'].forEach((side, index) => {
    const stick = new Three.Group(); stick.name = 'xylostick-' + side; stick.position.set(index * 4, 1, 0);
    stick.add(new Three.Mesh(new Three.SphereBufferGeometry(0.1), new Three.MeshBasicMaterial())); hall.add(stick);
  });
  const camera = new Three.PerspectiveCamera(); scene.add(camera);
  const left = new Three.Group(), right = new Three.Group(), desktop = new Three.Group(); scene.add(left, right); camera.add(desktop);
  desktop.userData.isDesktop = true;
  [left, right, desktop].forEach(controller => {controller.userData.grabbing = null; controller.boundingBox = new Three.Box3();});
  const beamModel = new Three.Group(), beam = new Three.Mesh(new Three.BoxBufferGeometry(), new Three.MeshBasicMaterial()); beam.name = 'beam'; beamModel.add(beam);
  const held = new Map(), crate = {name: 'Caja industrial en la otra mano'};
  held.set(right, crate);
  const ctx = {scene, camera, controllers: [left, right], desktopController: desktop, room: 0,
    editor: {active: false, simulation: {held}}, assets: {teleport_model: {scene: beamModel}, beam_tex: new Three.Texture()}, shaders: {basic_vert: '', beam_frag: ''}};
  ctx.raycontrol = new RayControl(ctx, 'right');
  [left, right, desktop].forEach((controller, index) => ctx.raycontrol.addController(controller, {handedness: index === 0 ? 'left' : 'right'}));
  ctx.raycontrol.addState('native-background', {raycaster: false, controller: 'both'}, true);
  const cancellations = [];
  ctx.raycontrol.addEventListener('controllerInputCancelled', data => {cancellations.push(data.controller); held.delete(data.controller);});
  api.setup(ctx, hall); api.enter(ctx);
  const leftData = ctx.raycontrol.controllers.find(data => data.controller === left), rightData = ctx.raycontrol.controllers.find(data => data.controller === right);
  const stick = hall.getObjectByName('xylostick-left'), otherStick = hall.getObjectByName('xylostick-right');
  const near = (controller, object) => {
    scene.updateMatrixWorld(true); controller.position.copy(object.getWorldPosition(new Three.Vector3())); scene.updateMatrixWorld(true);
    controller.boundingBox.setFromCenterAndSize(controller.getWorldPosition(new Three.Vector3()), new Three.Vector3(0.3, 0.3, 0.3));
  };
  near(left, stick); near(right, otherStick);
  api.execute(ctx, 1 / 60, 1); ctx.raycontrol.execute(ctx, 1 / 60, 1);
  assert.equal(ctx.raycontrol.enabled, true, 'Native proximity must never disable all production rays.');
  assert.equal(leftData.enabled, false); assert.equal(rightData.enabled, true);
  assert.equal(held.get(right), crate, 'A hand near a native stick cannot cancel the other hand\'s industrial box.');
  assert(!cancellations.includes(right));
  api.onSelectStart({target: left});
  assert.equal(left.userData.grabbing, stick);
  api.onSelectStart({target: right});
  assert.equal(right.userData.grabbing, null, 'The same trigger cannot acquire a native stick after grabbing an industrial box.');
  assert.equal(otherStick.parent, hall); assert.equal(held.get(right), crate);
  api.onSelectEnd({target: left});
  assert.equal(leftData.enabled, true, 'Releasing a native stick restores that hand\'s original enabled flag.');
  ctx.raycontrol.enabled = false; api.onSelectEnd({target: right});
  assert.equal(ctx.raycontrol.enabled, false, 'An unrelated release cannot reenable globally disabled interaction.');
  ctx.raycontrol.enabled = true;
  leftData.enabled = false; api.onSelectStart({target: left}); api.onSelectEnd({target: left});
  assert.equal(leftData.enabled, false, 'A preexisting per-hand disabled flag is restored exactly.');
  leftData.enabled = true;
  leftData.active = true; leftData.captureConsumed = true;
  api.onSelectStart({target: left}); api.execute(ctx, 1 / 60, 2);
  assert.equal(left.userData.grabbing, null, 'A button/product already consumed by the earlier index listener keeps ownership of its trigger.');
  assert.equal(leftData.enabled, true, 'Native proximity cannot cancel a captured industrial button.');
  leftData.active = true; leftData.captureConsumed = false;
  api.onSelectStart({target: left});
  assert.equal(left.userData.grabbing, stick, 'An empty ray press marked active by index still permits native proximity grabbing.');
  ctx.raycontrol.onSelectEnd({target: left}); api.onSelectEnd({target: left});
  assert.equal(leftData.enabled, true);
  camera.position.set(0, 1, 2); camera.lookAt(new Three.Vector3(0, 1, 0)); scene.updateMatrixWorld(true);
  held.set(desktop, {name: 'Caja de escritorio'});
  desktop.dispatchEvent({type: 'griptoggle'});
  assert.equal(desktop.userData.grabbing, null, 'Desktop right-click cannot add a native stick to a hand holding an industrial box.');
  held.delete(desktop); desktop.dispatchEvent({type: 'griptoggle'});
  assert.equal(desktop.userData.grabbing, stick, 'The same desktop native grip remains functional after the box is released.');
  desktop.dispatchEvent({type: 'griptoggle'}); assert.equal(desktop.userData.grabbing, null);
  near(left, stick); api.onSelectStart({target: left});
  ctx.editorXylophone.releaseHeld();
  assert.equal(left.userData.grabbing, null); assert.equal(leftData.enabled, true);
  assert.equal(held.get(right), crate, 'Native mode cleanup restores its rays without releasing unrelated industrial ownership.');
  api.exit(ctx);
  assert.equal(leftData.enabled, true); assert.equal(rightData.enabled, true);
  assert.equal(left._listeners.selectstart.length, 0); assert.equal(desktop._listeners.griptoggle.length, 0);
}

function testPanoramas() {
  class Text {}
  class Position {}
  class ParentObject3D {}
  const api = station("modules/turismo/functions/museo/rooms/Panorama.js", {THREE: Three, Text, Position, ParentObject3D}, ['setup', 'enter', 'exit']);
  const hall = new Three.Group(), panel = new Three.Mesh();
  panel.name = 'infopanel';
  hall.add(panel);
  const assets = {hall_model: {scene: hall}};
  for (let i = 2; i < 7; i++) assets['pano' + i] = new Three.Texture();
  const components = new Map();
  const ctx = {
    assets, editorRoots: {}, scene: new Three.Group(), controllers: [new Three.Group(), new Three.Group()],
    world: {createEntity() {
      return {addComponent(kind, value) { components.set(kind, value); return this; }, getMutableComponent(kind) { return components.get(kind); }};
    }},
    renderer: {setClearColor() {}}, raycontrol: {addState() {}, activateState() {}, deactivateState() {}}
  };
  api.setup(ctx);
  const roots = Object.values(ctx.editorRoots);
  assert.equal(roots.length, 5);
  assert.equal(new Set(roots).size, 5);
  assert.equal(new Set(roots.map(root => root.children[0])).size, 5);
  assert.equal(new Set(roots.map(root => root.children[0].geometry)).size, 1);
  assert.equal(new Set(roots.map(root => root.children[0].material)).size, 5);
  const addition = new Three.Mesh();
  roots[0].add(addition);
  for (let room = 5; room < 10; room++) {
    ctx.room = room;
    api.enter(ctx);
    assert.equal(ctx.scene.children[0], roots[room - 5]);
    assert.equal(ctx.controllers[1].children[0], panel);
    api.exit(ctx);
    assert.equal(ctx.scene.children.length, 0);
    assert.equal(ctx.controllers[1].children.length, 0);
  }
  assert.equal(addition.parent, roots[0]);
}

function testSoundPause() {
  const scheduled = [];
  const players = [];
  class Audio extends Three.Group {
    constructor() { super(); this.isPlaying = false; this.plays = 0; players.push(this); }
    setBuffer() {}
    play() { this.plays++; this.isPlaying = true; }
    stop() { this.isPlaying = false; }
  }
  const THREE = Object.assign({}, Three, {
    AudioListener: class extends Three.Group {}, PositionalAudio: Audio,
    AudioLoader: class { load(url, callback) { callback({}); } }
  });
  const api = station("modules/turismo/functions/museo/rooms/Sound.js", {
    THREE, setTimeout(callback, delay) { scheduled.push({callback, delay}); return scheduled.length; }, clearTimeout() {}
  }, ['setup', 'exit', 'playSound']);
  const scene = new Three.Group(), door = new Three.Group();
  const instrument = new Three.Group();
  instrument.name = 'bells';
  instrument.add(new Three.Mesh(new Three.BoxBufferGeometry(), new Three.MeshBasicMaterial()));
  scene.add(instrument);
  ['door', 'door_frame'].forEach(name => { const mesh = new Three.Mesh(); mesh.name = name; door.add(mesh); });
  const ctx = {
    assets: {sound_model: {scene, animations: []}, sound_door_model: {scene: door}, grid_tex: new Three.Texture(), sound_shadow_tex: new Three.Texture(), sound_door_lm_tex: new Three.Texture(), doorfx_tex: new Three.Texture()},
    editor: {active: true}, editorRoots: {}, scene: new Three.Group(), camera: new Three.Group(),
    shaders: {basic_vert: '', door_frag: ''}, raycontrol: {addState() {}, deactivateState() {}}
  };
  api.setup(ctx);
  api.playSound();
  assert.equal(players[0].plays, 0);
  assert.equal(scheduled.length, 0, 'A paused sound room must not keep a polling timer alive.');
  ctx.editor.active = false;
  api.playSound();
  assert.equal(players[0].plays, 1);
  assert.equal(scheduled[0].delay, 2000);
  api.exit(ctx);
  assert.equal(players[0].isPlaying, false);
}

async function testSoundDeferredLoad() {
  const requests = [], players = [], scheduled = [], cleared = [];
  class Audio extends Three.Group {
    constructor() { super(); players.push(this); }
    setBuffer(buffer) { this.buffer = buffer; }
    play() { this.isPlaying = true; }
    stop() { this.isPlaying = false; }
  }
  const THREE = Object.assign({}, Three, {
    AudioListener: class extends Three.Group {}, PositionalAudio: Audio,
    AudioLoader: class { load(url, resolve, progress, reject) { requests.push({url, resolve, reject}); } }
  });
  const api = station("modules/turismo/functions/museo/rooms/Sound.js", {
    THREE, setTimeout(callback, delay) { scheduled.push({callback, delay}); return scheduled.length; }, clearTimeout(id) { cleared.push(id); }
  }, ['setup', 'prepare', 'enter', 'exit', 'execute']);
  const scene = new Three.Group(), door = new Three.Group();
  const names = ['bells', 'horn', 'cowbell', 'guiro', 'mandolin', 'squeaker', 'train', 'whistle', 'motorhorn', 'surdo', 'trumpet'];
  names.forEach(name => {
    const instrument = new Three.Group(); instrument.name = name;
    instrument.add(new Three.Mesh(new Three.BoxBufferGeometry(), new Three.MeshBasicMaterial()));
    scene.add(instrument);
  });
  ['door', 'door_frame'].forEach(name => { const mesh = new Three.Mesh(); mesh.name = name; door.add(mesh); });
  const ctx = {
    roomAssets: {}, assets: {sound_model: {scene, animations: []}, sound_door_model: {scene: door}, grid_tex: new Three.Texture(), sound_shadow_tex: new Three.Texture(), sound_door_lm_tex: new Three.Texture(), doorfx_tex: new Three.Texture()},
    editor: {active: false}, editorRoots: {}, scene: new Three.Group(), camera: new Three.Group(), renderer: {setClearColor() {}},
    shaders: {basic_vert: '', door_frag: ''}, raycontrol: {addState() {}, activateState() {}, deactivateState() {}}
  };
  api.setup(ctx);
  assert.equal(requests.length, 0, 'Instrument audio must not download while other rooms are loading.');
  assert.equal(scheduled.length, 0);
  const first = api.prepare(ctx), concurrent = api.prepare(ctx);
  const results = Promise.allSettled([first, concurrent]);
  assert.equal(requests.length, 11, 'Concurrent transitions share each instrument audio request.');
  requests.forEach((request, index) => {
    assert.equal(request.url, "modules/turismo/assets/ogg/" + names[index] + '.ogg');
    if (index === 0) request.reject(new Error('Temporary audio failure'));
    else request.resolve({name: names[index]});
  });
  assert((await results).every(result => result.status === 'rejected'));
  const retry = api.prepare(ctx);
  assert.equal(requests.length, 12, 'Only the failed audio request is retried.');
  requests[11].resolve({name: 'bells'});
  await retry;
  assert(players.every(player => player.buffer));
  await api.prepare(ctx);
  assert.equal(requests.length, 12);
  scene.getObjectByName('bells').userData.editorDefaultBehaviors.find(behavior => behavior.type === 'sound').asset = 'ogg/replaced.ogg';
  const replacement = api.prepare(ctx);
  const rejectedReplacement = assert.rejects(replacement, /Replacement unavailable/);
  requests[12].reject(new Error('Replacement unavailable'));
  await rejectedReplacement;
  const replacementRetry = api.prepare(ctx);
  assert.equal(requests.length, 14, 'A failed replacement must not be mistaken for the old cached buffer.');
  requests[13].resolve({name: 'replacement'});
  await replacementRetry;
  assert.equal(players[0].buffer.name, 'replacement');
  api.enter(ctx);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 2000);
  ctx.editor.active = true;
  scheduled[0].callback();
  assert.equal(scheduled.length, 1, 'Pausing in the editor must stop the sequence without polling.');
  api.execute(ctx, 0.016, 1);
  assert.equal(scheduled.length, 1);
  ctx.editor.active = false;
  api.execute(ctx, 0.016, 2);
  assert.equal(scheduled.length, 2, 'Returning to the runtime resumes the current room.');
  api.exit(ctx);
  assert.equal(cleared[cleared.length - 1], 2);
  assert(players.every(player => !player.isPlaying));
}

async function testGraffitiArea() {
  const native = await import('data:text/javascript;base64,' + Buffer.from(source("packages/tools/editor/src/NativeBindings.js")).toString('base64'));
  class BoundingBox { constructor() { this.min = new Three.Vector3(); this.max = new Three.Vector3(); } }
  class Area {}
  class AreaReactor {}
  class AreaChecker {}
  class Object3D {}
  class ParentObject3D {}
  class DebugHelper {}
  const drawingContext = {clearRect() {}, fillRect() {}};
  const api = station("modules/turismo/functions/museo/stations/Graffiti.js", {
    THREE: Three, BoundingBox, Area, AreaReactor, AreaChecker, Object3D, ParentObject3D, DebugHelper,
    ColorWheel: class {}, angleBetween() {}, getRandomInt() {}, Image: class {},
    document: {createElement() { return {getContext() { return drawingContext; }}; }}
  }, ['setup']);
  const root = new Three.Group(), hall = new Three.Group();
  root.add(hall);
  const wall = new Three.Mesh(new Three.PlaneBufferGeometry(8, 3));
  wall.name = 'graffiti';
  wall.position.set(-1, 1, 6);
  wall.rotation.y = 0.3;
  hall.add(wall);
  const ctx = {
    world: {createEntity() {
      const components = new Map();
      return {
        addComponent(Type, values) { components.set(Type, Object.assign(new Type(), values)); return this; },
        getMutableComponent(Type) { return components.get(Type); }
      };
    }},
    assets: {spray_model: {scene: new Three.Group()}, lightmap_tex: new Three.Texture()},
    raycontrol: {addEventListener() {}, addState() {}}
  };
  api.setup(ctx, hall);
  assert.equal(ctx.editorGraffitiArea.wall, wall);
  const component = ctx.editorGraffitiArea.entity.getMutableComponent(BoundingBox);
  const originalBox = ctx.editorGraffitiArea.originalBox.clone();
  const paintTexture = wall.material.map;
  function boxEquals(min, max) {
    assert.ok(component.min.distanceTo(new Three.Vector3(...min)) < 1e-8);
    assert.ok(component.max.distanceTo(new Three.Vector3(...max)) < 1e-8);
  }
  hall.position.set(4, 2, -3);
  native.syncNativeTransforms(ctx, root);
  boxEquals([-1, 2, 1.4], [7, 5, 4]);
  hall.position.set(0, 0, 0);
  hall.rotation.y = Math.PI / 2;
  hall.scale.set(2, 3, 4);
  native.syncNativeTransforms(ctx, root);
  boxEquals([17.6, 0, -6], [28, 9, 10]);
  native.syncNativeTransforms(ctx, root);
  boxEquals([17.6, 0, -6], [28, 9, 10]);
  wall.visible = false;
  native.syncNativeTransforms(ctx, root);
  const area = new Three.Box3(component.min, component.max);
  assert.equal(area.isEmpty(), true);
  assert.equal(new Three.Box3(new Three.Vector3(-100, -100, -100), new Three.Vector3(100, 100, 100)).intersectsBox(area), false);
  wall.visible = true;
  hall.visible = false;
  native.syncNativeTransforms(ctx, root);
  assert.equal(area.isEmpty(), true);
  hall.visible = true;
  hall.rotation.set(0, 0, 0);
  hall.scale.set(1, 1, 1);
  native.syncNativeTransforms(ctx, root);
  boxEquals([-5, 0, 4.4], [3, 3, 7]);
  assert.ok(ctx.editorGraffitiArea.originalBox.equals(originalBox));
  assert.equal(wall.material.map, paintTexture, 'Transforming the area must preserve the drawing texture.');
}

(async () => {
  await testNativeBindings();
  testXylophone();
  testXylophoneIndustrialHands();
  testPanoramas();
  testSoundPause();
  await testSoundDeferredLoad();
  await testGraffitiArea();
  console.log('PASS native editor anchors/audio, transformed VR xylophone, per-hand native/industrial ownership and ray restoration, hidden notes, editor guards, independent panoramas, sound timers and unchanged graffiti paint.');
})().catch(error => { console.error(error); process.exitCode = 1; });
