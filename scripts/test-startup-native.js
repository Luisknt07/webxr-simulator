// Run with node --experimental-vm-modules scripts/test-startup-native.js.
// Parse the shipped GLBs, run every native room's setup and the real ECS pass,
// then register the full scene graph with the editor. Browser-only audio,
// canvas/text rendering and Draco decoding have adapters; scene topology,
// transforms, native logic, schemas, GLTFLoader and ECS are the production code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const baseThree = require('three');
const {World} = require('ecsy');
const root = path.resolve(__dirname, '..');

class AudioAdapter extends baseThree.Group {
  constructor(listener) { super(); this.context = listener && listener.context; this.isAudio = true; }
  setBuffer(buffer) { this.buffer = buffer; return this; }
  setVolume() { return this; }
  setLoop() { return this; }
  play() { this.isPlaying = true; return this; }
  stop() { this.isPlaying = false; return this; }
}
class ListenerAdapter extends baseThree.Group {
  constructor() { super(); this.context = {}; }
}
const THREE = Object.assign({}, baseThree, {
  AudioListener: ListenerAdapter, Audio: AudioAdapter, PositionalAudio: AudioAdapter,
  AudioLoader: class { load(url, success) { success({url}); } }
});
function canvas() {
  const draw = new Proxy({
    getImageData() { return {data: new Uint8ClampedArray(4)}; },
    measureText() { return {width: 0}; }
  }, {get(target, key) { return key in target ? target[key] : () => {}; }});
  return {width: 10, height: 10, style: {}, getContext() { return draw; }, toDataURL() { return ''; }};
}
const context = vm.createContext({
  console, document: {createElement: canvas}, Image: class {}, window: {}, navigator: {},
  URL, TextDecoder, TextEncoder, Blob, ArrayBuffer, Uint8Array, DataView,
  // Native timers/fetch callbacks are outside this synchronous initialization test.
  setTimeout() {}, clearTimeout() {}, fetch: async () => ({ok: true, json: async () => []})
});
const modules = new Map(), commonModules = new Map();

// Shared CommonJS validators must run in the same JS realm as native config
// literals so their strict plain-object checks match browser execution.
function commonModule(file) {
  file = require.resolve(path.resolve(file));
  if (commonModules.has(file)) return commonModules.get(file).exports;
  const module = {exports: {}}; commonModules.set(file, module);
  const factory = new vm.Script('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', {filename: file}).runInContext(context);
  factory(name => commonModule(path.resolve(path.dirname(file), name)), module, module.exports);
  return module.exports;
}
function syntheticModule(key, value) {
  if (modules.has(key)) return modules.get(key);
  const names = Array.from(new Set(Object.keys(value).concat('default')));
  const module = new vm.SyntheticModule(names, function () {
    Object.keys(value).forEach(name => this.setExport(name, value[name]));
    this.setExport('default', value);
  }, {context, identifier: key});
  modules.set(key, module); return module;
}
async function sourceModule(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file);
  if (file.endsWith('three.module.js')) return syntheticModule('three', THREE);
  if (file.startsWith(path.join(root, 'shared') + path.sep)) return syntheticModule(file, commonModule(file));
  if (file.endsWith('textmesh-standalone.esm.js')) {
    class TextMesh extends THREE.Mesh {
      constructor() { super(new THREE.PlaneBufferGeometry(), new THREE.MeshBasicMaterial()); this.anchor = [0, 0]; }
      sync() {} dispose() {}
    }
    return syntheticModule(file, {TextMesh});
  }
  const module = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), {context, identifier: file});
  modules.set(file, module);
  await module.link((name, parent) => {
    if (name === 'three') return syntheticModule('three', THREE);
    if (name === 'ecsy') return syntheticModule('ecsy', require('ecsy'));
    const target = name.startsWith('.') ? path.resolve(path.dirname(parent.identifier), name + (path.extname(name) ? '' : '.js')) : require.resolve(name);
    return sourceModule(target);
  });
  return module;
}
async function load(file) {
  const module = await sourceModule(path.join(root, file));
  await module.evaluate(); return module.namespace;
}

async function testNativePanoramaSelection(ctx, document) {
  const {default: RayControl} = await load('src/lib/RayControl.js');
  const {default: BehaviorRuntime} = await load('src/editor/BehaviorRuntime.js');
  const nativeStates = ctx.raycontrol.states;
  const ray = ctx.raycontrol = new RayControl(ctx, 'right');
  Object.entries(nativeStates).forEach(([name, state]) => ray.addState(name, state));
  ray.activateState('panoballs');
  ctx.goto = null;
  ctx.editor = {active: false, document};
  ctx.cameraRig = new THREE.Group();
  ctx.cameraRig.position.set(1.7, -0.2, -0.6);
  ctx.cameraRig.rotation.set(0.07, 0.31, 0);
  ctx.cameraRig.add(ctx.camera);
  ctx.scene.add(ctx.cameraRig);

  // Exercise the shipped desktop setup instead of recreating its pose here.
  // Keeping the real hand offset matters: the old ray missed small portals even
  // though the center reticle was precisely over their visible geometry.
  const index = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
  const desktopSetup = index.match(/function setupDesktopPointer\(\) \{[\s\S]*?\n\}/);
  assert.ok(desktopSetup, 'The production desktop pointer setup is available');
  const setup = new vm.Script('(function(THREE, camera, raycontrol, context) {' +
    'let desktopController, desktopControllerData;\n' + desktopSetup[0] +
    '\nsetupDesktopPointer(); return desktopControllerData; })',
  {filename: 'src/index.js:setupDesktopPointer'}).runInContext(context);
  const desktop = setup(THREE, ctx.camera, ray, ctx);
  assert.ok(ctx.desktopController.position.length() > 0.4, 'The desktop hand remains offset for grabbed objects');

  const balls = document.getObjects('hall').filter(object => Number.isFinite(object.userData.panoId));
  assert.equal(balls.length, 6, 'Use all six generated portals at their shipped GLB positions');
  function pointAt(object) {
    ctx.scene.updateMatrixWorld(true);
    const center = object.getWorldPosition(new THREE.Vector3());
    const origin = center.clone().add(new THREE.Vector3(0.3, 0.2, 1.1));
    ctx.camera.position.copy(ctx.cameraRig.worldToLocal(origin));
    ctx.camera.lookAt(center);
    ctx.scene.updateMatrixWorld(true);
    return center;
  }
  function selectPortal(object, destination) {
    ctx.goto = null;
    pointAt(object);
    ray.execute(ctx, 0.016, 1);
    assert.equal(desktop.currentIntersection && desktop.currentIntersection.intersection.object, object,
      'A centered desktop reticle must hit ' + object.name);
    ray.onSelectStart({target: ctx.desktopController});
    assert.equal(ctx.goto, null, 'Release portals must wait until the button is released');
    ray.onSelectEnd({target: ctx.desktopController});
    assert.equal(ctx.goto, destination, 'Release must enter the configured panorama');
  }
  balls.forEach(ball => selectPortal(ball, ball.userData.panoId));

  // Reproduce the pre-fix ray, without changing production files, to establish
  // that the real-pose regression test detects the original targeting failure.
  pointAt(balls[0]);
  const rayContext = ctx.desktopController.getObjectByName('raycasterContext');
  const centeredPose = rayContext.position.clone();
  rayContext.position.set(0, 0, 0);
  ctx.scene.updateMatrixWorld(true);
  ray.execute(ctx, 0.016, 2);
  assert.notEqual(desktop.currentIntersection && desktop.currentIntersection.intersection.object, balls[0],
    'The former offset ray misses a portal under the camera center');
  rayContext.position.copy(centeredPose);
  ctx.scene.updateMatrixWorld(true);
  selectPortal(balls[0], balls[0].userData.panoId);

  // Editor mode disables input and clears cached selections. Returning to the
  // experience restores the same centered ray and native portal destination.
  ray.disable();
  ctx.goto = null;
  ray.onSelectStart({target: ctx.desktopController});
  ray.onSelectEnd({target: ctx.desktopController});
  assert.equal(ctx.goto, null);
  assert.equal(desktop.currentIntersection, null);
  ray.enable();
  selectPortal(balls[1], balls[1].userData.panoId);

  const copy = await document.pasteObject(document.captureObject(balls[2]), 'hall', 2);
  const copiedMaterial = copy.children[0].material;
  assert.equal(copiedMaterial.vertexShader, balls[2].material.vertexShader);
  assert.equal(copiedMaterial.fragmentShader, balls[2].material.fragmentShader);
  for (const key of ['tex', 'texfx']) {
    assert.notEqual(copiedMaterial.uniforms[key].value, balls[2].material.uniforms[key].value);
    assert(copiedMaterial.uniforms[key].value.version > 0, 'Native panorama copy schedules ' + key + ' for GPU upload');
  }
  const initialPhase = copiedMaterial.uniforms.time.value;
  const runtime = new BehaviorRuntime(ctx, document, {}, message => { throw new Error(message); });
  runtime.start('hall');
  selectPortal(copy, balls[2].userData.panoId);
  runtime.execute(0.1, 1);
  assert.equal(copiedMaterial.uniforms.time.value, initialPhase + 0.1, 'A copied panorama keeps its animated shader');
  assert(copiedMaterial.uniforms.selected.value > 0, 'A copied panorama highlights under the centered reticle');
  runtime.stop();
  assert.equal(copiedMaterial.uniforms.selected.value, 0, 'Returning to edit clears copied highlight');

  // A VR controller keeps its physical ray while the desktop camera looks away.
  // The desktop compensation must not alter the native WebXR input path.
  desktop.enabled = false;
  const vrController = new THREE.Group();
  ctx.cameraRig.add(vrController);
  ray.addController(vrController, {handedness: 'right'});
  ctx.scene.updateMatrixWorld(true);
  const target = balls[3].getWorldPosition(new THREE.Vector3());
  vrController.position.copy(ctx.cameraRig.worldToLocal(target.clone().add(new THREE.Vector3(0.3, 0.2, 1.1))));
  vrController.lookAt(target);
  vrController.rotateY(Math.PI);
  ctx.camera.lookAt(target.clone().add(new THREE.Vector3(10, 7, 2)));
  ctx.scene.updateMatrixWorld(true);
  const vr = ray.controllers.find(entry => entry.controller === vrController);
  ctx.goto = null;
  ray.execute(ctx, 0.016, 3);
  assert.equal(vr.currentIntersection && vr.currentIntersection.intersection.object, balls[3],
    'The VR ray follows the controller independently of the camera');
  ray.onSelectStart({target: vrController});
  ray.onSelectEnd({target: vrController});
  assert.equal(ctx.goto, balls[3].userData.panoId);
}

async function testNativeInformationPanels(ctx, document) {
  const infoPanels = await load('src/stations/InfoPanels.js');
  const panel = document.getObjects('hall').find(object =>
    document.getBehaviors(object).some(behavior => behavior.type === 'info' && behavior.title === '¡BIENVENIDO!'));
  assert.ok(panel, 'Use the real WELCOME panel created from the shipped hall');
  const glyph = panel.getObjectByName('textMesh');
  assert.ok(glyph && glyph.text.includes('¡BIENVENIDO!'), 'The native ECS creates the translated panel text before editor registration');
  const panelId = panel.userData.editorId, glyphId = glyph.userData.editorId;
  assert.equal(document.getObject(glyphId), glyph, 'Generated text keeps its saved native ID for project compatibility');
  assert.equal(document.getEditableObject(glyph), panel, 'Clicking native SDF letters selects their whole information panel');
  assert(!document.getObjects('hall').includes(glyph), 'Generated SDF letters are not separate authoring objects');
  const before = await document.serialize();
  const info = object => document.getBehaviors(object).find(behavior => behavior.type === 'info');
  const editText = (object, title, text) => {
    const behaviors = document.getBehaviors(object);
    const config = behaviors.find(behavior => behavior.type === 'info');
    config.title = title; config.text = text;
    document.setBehaviors(object, behaviors);
  };
  try {
    editText(panel, 'Bienvenidos al laboratorio', 'Recorre el escenario.\nPuedes editar este texto y sus tildes: simulación.');
    infoPanels.execute(ctx, 0, 0);
    ctx.world.execute(0, 0);
    assert.equal(glyph.text, info(panel).title + '\n \n' + info(panel).text,
      'Editing the native info properties updates the actual ECS text');
    const snapshot = document.captureObject(glyph);
    assert.equal(snapshot.record.descriptor.nativeId, panelId, 'Ctrl+C over letters captures the panel asset instead of an uncloneable TextMesh');
    const copy = await document.pasteObject(snapshot, 'hall', 1.25);
    const copyId = copy.userData.editorId;
    assert.notEqual(copyId, panelId);
    assert.equal(JSON.stringify(document.getBehaviors(copy)), JSON.stringify(document.getBehaviors(panel)),
      'A panel copy retains its full editable text and billboard properties');
    assert(!copy.getObjectByName('textMesh'), 'Copies recreate generated text from behavior data instead of cloning native ECS resources');
    editText(panel, 'Título original', 'Contenido del panel original.');
    assert.equal(info(copy).title, 'Bienvenidos al laboratorio', 'Changing the original after copying leaves the copied title independent');
    editText(copy, 'Título copiado', 'Contenido independiente.\nSegunda línea.');
    assert.equal(info(panel).text, 'Contenido del panel original.', 'Changing a copy does not modify the native panel');
    const expectedCopyBehaviors = JSON.stringify(document.getBehaviors(copy));
    const saved = await document.serialize();
    await document.load(saved);
    const restored = document.getObject(copyId);
    assert.ok(restored && restored !== copy, 'Loading reconstructs the copied panel from its saved asset and properties');
    assert.equal(JSON.stringify(document.getBehaviors(restored)), expectedCopyBehaviors,
      'Saving and reopening preserves the copied text, formatting and billboard behavior');
    assert.equal(info(panel).title, 'Título original', 'Saving and reopening also preserves the native title override');
    assert.equal(document.getObject(glyphId), glyph, 'The native text identity survives loading saved panel edits');
    infoPanels.execute(ctx, 0, 0);
    ctx.world.execute(0, 0);
    assert.equal(glyph.text, 'Título original\n \nContenido del panel original.', 'The reopened native panel renders its saved Spanish text');
  } finally {
    await document.load(before);
    infoPanels.execute(ctx, 0, 0);
    ctx.world.execute(0, 0);
  }
}

async function testNativeHallDecal(ctx, document) {
  const {default: DecalSystem} = await load('src/editor/DecalSystem.js');
  const {default: behaviorSchema} = await load('shared/behaviors.js');
  const room = document.getRoot('hall');
  const hall = ctx.assets.hall_model.scene.getObjectByName('hall');
  assert(hall && hall.isMesh, 'Project onto the shipped combined hall mesh, not a replacement plane.');
  room.updateWorldMatrix(true, true);
  const hit = new THREE.Raycaster(new THREE.Vector3(0, 1.6, 2), new THREE.Vector3(1, 0, 0))
    .intersectObject(hall, false)[0];
  assert(hit && hit.face, 'A ray from the room interior locates a real wall triangle.');
  const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hall.matrixWorld)).normalize();
  assert(Math.abs(normal.y) < 0.05, 'The projection fixture is a wall, rather than the floor or ceiling.');
  const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const projector = new THREE.Matrix4().compose(hit.point, orientation, new THREE.Vector3(1, 1, 1));
  projector.premultiply(new THREE.Matrix4().getInverse(room.matrixWorld));
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  projector.decompose(position, quaternion, scale);
  // Schema values belong to the native VM realm, just as editor values do in
  // the browser. Textures remain ordinary Three resources with no WebGL upload.
  const config = behaviorSchema.defaultBehavior('decal');
  Object.assign(config, {asset: 'paintings/decal-test.png', targetId: hall.userData.editorId,
    width: 0.8, height: 0.5, depth: 0.08, opacity: 0.7});
  const transform = new vm.Script('({})').runInContext(context);
  Object.assign(transform, {position: position.toArray(), quaternion: quaternion.toArray(), scale: scale.toArray()});
  const resources = [], notices = [];
  const library = {
    getEntry: asset => ({path: asset, kind: 'image'}),
    instantiate() {
      const texture = new THREE.Texture({width: 8, height: 8});
      const image = new THREE.Mesh(new THREE.PlaneBufferGeometry(), new THREE.MeshBasicMaterial({map: texture}));
      const disposed = {geometry: 0, material: 0, texture: 0};
      image.geometry.addEventListener('dispose', () => disposed.geometry++);
      image.material.addEventListener('dispose', () => disposed.material++);
      texture.addEventListener('dispose', () => disposed.texture++);
      resources.push({image, texture, disposed});
      return image;
    }
  };
  const system = new DecalSystem(ctx, document, library, notice => notices.push(notice));
  const before = await document.serialize();
  const nativeGeometry = hall.geometry, nativeMaterial = hall.material, nativeId = hall.userData.editorId;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  try {
    const decal = document.addDecal('hall', config, transform), id = decal.userData.editorId;
    system.sync('hall'); await tick();
    const state = system.states.get(decal), geometry = state.mesh.geometry;
    assert(geometry.attributes.position.count > 0, 'Real hall wall triangles produce visible clipped decal geometry.');
    assert.equal(geometry.attributes.normal.count, geometry.attributes.position.count);
    assert.equal(geometry.attributes.uv.count, geometry.attributes.position.count);
    assert(Array.from(geometry.attributes.uv.array).every(value => value >= -0.00001 && value <= 1.00001),
      'Projected image UVs remain inside the image on the real room mesh.');
    const point = new THREE.Vector3();
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      point.fromBufferAttribute(geometry.attributes.position, i);
      assert(Math.abs(point.x) <= config.width / 2 + 0.00001 && Math.abs(point.y) <= config.height / 2 + 0.00001 &&
        Math.abs(point.z) <= config.depth / 2 + 0.00001, 'The projector clips every real-world wall vertex.');
    }
    assert.equal(state.mesh.material.map, resources[0].texture);
    assert.equal(state.mesh.material.opacity, 0.7);
    assert.equal(document.getEditableObject(state.mesh), decal);
    const saved = await document.serialize();
    const record = saved.rooms.hall.additions.find(addition => addition.id === id);
    assert.equal(record.descriptor.type, 'decal');
    assert.equal(record.behaviors[0].targetId, nativeId);
    assert(!JSON.stringify(saved).includes('editorRuntimeHelper'), 'Saved room data excludes projected triangles and GPU resources.');
    await document.load(saved);
    system.sync('hall'); await tick();
    const reopened = document.getObject(id), reopenedState = system.states.get(reopened);
    assert.notEqual(reopened, decal);
    assert(reopenedState.mesh.geometry.attributes.position.count > 0, 'Reopening rebuilds projection on the original combined hall mesh.');
    assert.equal(JSON.stringify(await document.serialize()), JSON.stringify(saved));
    assert.deepEqual(resources[0].disposed, {geometry: 1, material: 1, texture: 1}, 'Reopening releases the previous private image resource.');
    assert.equal(document.getObject(nativeId), hall);
    assert.equal(hall.geometry, nativeGeometry);
    assert.equal(hall.material, nativeMaterial, 'Decal projection preserves native baked wall materials.');
    assert.deepEqual(notices, []);
    system.dispose();
    assert.equal(system.states.size, 0);
    assert.equal(reopenedState.mesh.parent, null);
    assert.deepEqual(resources[1].disposed, {geometry: 1, material: 1, texture: 1}, 'Leaving the projection releases the reopened private texture.');
  } finally {
    system.dispose();
    await document.load(before);
    await tick();
    assert.equal(document.getObject(nativeId), hall);
    assert.equal(hall.geometry, nativeGeometry);
    assert.equal(hall.material, nativeMaterial);
  }
}

async function testNativeEquipmentPlacement(ctx, document, collisions) {
  const {default: EquipmentPlacement} = await load('src/editor/EquipmentPlacement.js');
  const room = document.getRoot('hall'), hall = ctx.assets.hall_model.scene.getObjectByName('hall');
  const saved = JSON.stringify(await document.serialize()), previousRoom = collisions.roomId;
  const nativeGeometry = hall.geometry, nativeMaterial = hall.material, originalChildren = room.children.slice();
  const target = new THREE.Vector3(0, 1, 2);
  const placement = new EquipmentPlacement({root: room, collisionWorld: collisions, camera: ctx.camera, orbit: {target}});
  function visibleBounds(object) {
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    object.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry || mesh.userData.industrialSensorVolume) return;
      for (let parent = mesh; parent; parent = parent.parent) if (!parent.visible || parent.userData.editorHelper || parent.userData.editorRuntimeHelper) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    });
    return box;
  }
  function assertOnNativeFloor(object, result) {
    const box = visibleBounds(object), center = box.getCenter(new THREE.Vector3());
    hall.updateWorldMatrix(true, false);
    const hits = new THREE.Raycaster(new THREE.Vector3(center.x, 0.5, center.z), new THREE.Vector3(0, -1, 0))
      .intersectObject(hall, false).filter(hit => hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hall.matrixWorld)).y > 0.85);
    assert(hits.length, 'The equipment must be above the actual upward-facing shipped hall floor.');
    assert(Math.abs(result.floorY - hits[0].point.y) < 0.002, 'Placement must report the native floor height rather than a table or a model bounding-box top.');
    assert(Math.abs(box.min.y - hits[0].point.y) < 0.002, 'The equipment feet must rest on the native floor without floating.');
    assert(Math.abs(hits[0].point.y) < 0.01, 'The shipped hall support fixture is its ground floor.');
    return box;
  }
  collisions.setRoom('hall');
  document.begin();
  try {
    const first = document.addPrefab('hall', 'conveyor');
    const firstResult = placement.place(first, target);
    const firstBox = assertOnNativeFloor(first, firstResult);
    // The clear inlet now leaves room for more equipment. An explicitly
    // oversized machine still must not escape the real furnished floor.
    const crowded = document.addPrefab('hall', 'conveyor');
    crowded.scale.set(8, 1, 8); crowded.updateMatrix();
    const unplacedPose = crowded.position.clone();
    assert.throws(() => placement.place(crowded, target), /No hay espacio libre sobre el suelo/);
    assert(crowded.position.equals(unplacedPose), 'Insufficient space must leave the tentative equipment pose unchanged.');
    document.remove(crowded);
    const second = document.addPrefab('hall', 'conveyor', 'roller-middle');
    const secondResult = placement.place(second, target);
    const secondBox = assertOnNativeFloor(second, secondResult);
    assert(!firstBox.clone().expandByScalar(-0.003).intersectsBox(secondBox.clone().expandByScalar(-0.003)),
      'A modular conveyor aimed at the same location must find separate space from the full machine in the real native hall.');
    assert(first.position.distanceTo(second.position) > 1, 'The second machine must not spawn on the first machine.');
    assert.equal(hall.geometry, nativeGeometry); assert.equal(hall.material, nativeMaterial);
  } finally {
    document.cancel(); collisions.setRoom(previousRoom);
  }
  assert.equal(JSON.stringify(await document.serialize()), saved, 'The real-scene placement fixture must leave no project edits behind.');
  assert.deepEqual(room.children, originalChildren, 'Temporary equipment must be removed without replacing any native hall objects.');
}

async function testStartup() {
  assert.equal(typeof vm.SourceTextModule, 'function', 'Use the --experimental-vm-modules flag for this startup regression');
  const {GLTFLoader} = await load('node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  let dracoCalls = 0;
  const loader = new GLTFLoader().setDRACOLoader({
    preload() {},
    // Only angel.min.glb is Draco compressed. Keep its real GLTF hierarchy and
    // materials while replacing decoded vertex buffers with a small geometry.
    decodeDracoFile(buffer, success) { dracoCalls++; success(new THREE.BoxBufferGeometry()); }
  });
  const assets = {};
  for (const [id, filename] of Object.entries({
    hall_model: 'hall', sound_model: 'sound', sound_door_model: 'sound_door',
    vertigo_model: 'vertigo', generic_controller_model: 'generic_controller',
    spray_model: 'spray', teleport_model: 'teleport', pg_object_model: 'angel.min'
  })) {
    const buffer = fs.readFileSync(path.join(root, 'assets', filename + '.glb'));
    assets[id] = await new Promise((resolve, reject) => loader.parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length), '', resolve, reject));
  }
  assert.ok(dracoCalls > 0, 'Photogrammetry is parsed from the real compressed asset');
  const definitions = (await load('src/assets.js')).default;
  Object.keys(definitions).forEach(id => { if (!assets[id]) assets[id] = new THREE.Texture(); });
  const world = new World();
  for (const name of ['SDFTextSystem', 'AreaCheckerSystem', 'ControllersSystem', 'DebugHelperSystem', 'TransformSystem', 'BillboardSystem', 'HierarchySystem']) {
    const module = await load('src/systems/' + name + '.js');
    world.registerSystem(module.default || module[name]);
  }
  const raycontrol = new THREE.EventDispatcher();
  Object.assign(raycontrol, {
    states: {}, addState(name, state) { this.states[name] = state; },
    activateState() {}, setLineStyle() {}, matchController() { return true; }
  });
  const ctx = {
    assets, world, room: 0, scene: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    audioListener: new ListenerAdapter(), shaders: (await load('src/lib/shaders.js')).shaders,
    editorRoots: {}, controllers: [new THREE.Group(), new THREE.Group()],
    desktopController: new THREE.Group(), renderer: {setClearColor() {}}, raycontrol, teleport: {},
    systemsGroup: {roomHall: {play() {}, stop() {}}}
  };
  ctx.desktopController.userData.isDesktop = true;
  context.window.context = ctx;
  const rooms = {};
  for (const name of ['Hall', 'Panorama', 'PanoramaStereo', 'PhotogrammetryObject', 'Vertigo', 'Sound']) {
    rooms[name] = await load('src/rooms/' + name + '.js');
    rooms[name].setup(ctx);
  }
  rooms.Hall.enter(ctx);
  world.execute(0, 0);
  const {default: SceneDocument} = await load('src/editor/SceneDocument.js');
  const document = new SceneDocument(ctx);
  for (const [id, room] of Object.entries(ctx.editorRoots)) document.registerRoom(id, room);
  assert.equal(document.rooms.size, 10, 'All native rooms reach editor registration');
  const door = assets.vertigo_model.scene.getObjectByName('door');
  assert.equal(document.getBehaviors(door).find(behavior => behavior.type === 'portal').hoverScale, 0.8,
    'Opening the editor preserves the native Vertigo portal scale');
  assert.ok(document.getObject(door.userData.editorId) === door);
  assert.ok(document.getObjects('sound').length > 40, 'Full instrument model trees are registered');
  assert.ok(await document.serialize(), 'A freshly initialized editor document can be serialized');
  const {default: CollisionWorld} = await load('src/lib/CollisionWorld.js');
  const collisions = new CollisionWorld(ctx, document); collisions.setRoom('hall');
  const interior = new THREE.Vector3(0, 2.5, 2);
  const inside = collisions.moveSphere(interior, interior.clone().add(new THREE.Vector3(0.5, 0, 0)));
  assert(inside.distanceTo(interior.clone().add(new THREE.Vector3(0.5, 0, 0))) < 1e-6,
    'The real concave hall remains hollow for editor navigation');
  const ground = collisions.moveSphere(new THREE.Vector3(3.2, 2.8, 4.5), new THREE.Vector3(3.2, -4, 4.5));
  assert(ground.y >= 0.17, 'The shipped room floor blocks the editor camera');
  const wall = collisions.moveCapsule(new THREE.Vector3(0, 1.6, 2), new THREE.Vector3(12, 1.6, 2));
  assert(wall.x < 8.2 && wall.x > 0.1, 'The visitor stops before the real right wall');
  assert(collisions.canOccupyCapsule(new THREE.Vector3(0, 1.6, 2)), 'The room interior is a valid capsule destination');
  assert(!collisions.entries.some(entry => /^(sky|clouds|teleport)$/.test(entry.object.name)));
  collisions.setRoom('panorama1');
  assert.equal(collisions.entries.length, 0, 'The immersive panorama background is not a solid room shell');
  await testNativeEquipmentPlacement(ctx, document, collisions);
  await testNativeInformationPanels(ctx, document);
  await testNativeHallDecal(ctx, document);
  await testNativePanoramaSelection(ctx, document);
  console.log('PASS shipped GLBs/ECS startup, real hollow-room/floor/wall collisions, floor-supported separate equipment placement and safe no-space rejection, 10 editor rooms, native WELCOME text selection/copy/edit/reopen, real hall wall decal projection/UVs/reopen/cleanup, native/copied panorama portals, centered desktop targeting and independent VR controller targeting.');
}
testStartup().catch(error => { console.error(error); process.exitCode = 1; });
