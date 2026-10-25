const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Three = require('three');
const root = path.resolve(__dirname, '..');
function load(file, injected, names) {
  const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/^import .*$/mg, '').replace(/export default /g, '').replace(/export /g, '');
  const sandbox = Object.assign({console, THREE: Three}, injected);
  vm.createContext(sandbox);
  vm.runInContext(read('src/editor/NativeBehaviorAdapters.js'), sandbox);
  if (file) vm.runInContext(read(file), sandbox);
  return vm.runInContext('({' + names.join(',') + '})', sandbox);
}

function testPanoSettings() {
  const api = load('src/stations/PanoBalls.js', {}, ['setup', 'execute']);
  const hall = new Three.Group(), states = {};
  for (let i = 1; i <= 6; i++) { const marker = new Three.Group(); marker.name = 'panoball' + i; marker.position.y = i; hall.add(marker); }
  const ctx = {assets: {}, shaders: {panoball_vert: '', panoball_frag: ''}, raycontrol: {addState(name, state) { states[name] = state; }}};
  api.setup(ctx, hall);
  const ball = hall.children[6].children[0];
  assert.equal(ball.userData.editorDefaultBehaviors[0].type, 'portal');
  states.panoballs.onSelectEnd({object: ball}); assert.equal(ctx.goto, 4);
  ball.userData.editorBehaviors = [{type: 'portal', enabled: true, room: 2, event: 'press', hoverScale: 1}, {type: 'float', enabled: false, speed: 9, amplitude: 2}];
  ctx.goto = null; states.panoballs.onSelectEnd({object: ball}); assert.equal(ctx.goto, null);
  states.panoballs.onSelectStart({object: ball}); assert.equal(ctx.goto, 2);
  api.execute(ctx, 0.1, 10); assert.equal(ball.position.y, ball.userData.floatY);
  ball.userData.editorBehaviors[0].enabled = false; ctx.goto = null;
  states.panoballs.onSelectStart({object: ball}); assert.equal(ctx.goto, null);
}

function testPaintingSettings() {
  const api = load('src/stations/Paintings.js', {}, ['setup']);
  const hall = new Three.Group(), group = new Three.Group(); group.name = 'paintings'; hall.add(group);
  const painting = new Three.Mesh(new Three.PlaneGeometry()); painting.name = 'seurat'; group.add(painting);
  const states = {}, scene = new Three.Group();
  const ctx = {assets: {painting_seurat_tex: new Three.Texture(), zoomicon_tex: new Three.Texture()}, shaders: {basic_vert: '', zoom_frag: ''}, scene, raycontrol: {addState(name, state) { states[name] = state; }}};
  api.setup(ctx, hall);
  painting.userData.editorBehaviors = [{type: 'painting', enabled: true, distance: 8, zoom: 1.2, ratio: 2}];
  const texture = new Three.Texture();
  states.paintings.onSelectStart({object: painting, actualObject: {material: {map: texture}}, distance: 7, point: new Three.Vector3(), uv: new Three.Vector2(0.3, 0.4)}, {});
  const widget = scene.children.find(mesh => mesh.material.isShaderMaterial);
  assert.equal(widget.visible, true); assert.equal(widget.material.uniforms.zoomRatio.value, 2);
  assert.equal(widget.material.uniforms.zoomAmount.value, 1.2); assert.equal(widget.material.uniforms.tex.value, texture);
  states.paintings.onSelectEnd({object: painting}); painting.userData.editorBehaviors[0].enabled = false;
  states.paintings.onSelectStart({object: painting, distance: 1}, {}); assert.equal(widget.visible, false);
}

function testIndependentPaintAndBillboard() {
  const canvases = [];
  const drawing = () => ({fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, measureText() { return {width: 0}; }});
  class BoundingBox { constructor() { this.min = new Three.Vector3(); this.max = new Three.Vector3(); } }
  class Area {}
  const api = load(null, {BoundingBox, Area, document: {createElement() { const canvas = {getContext: drawing}; canvases.push(canvas); return canvas; }}}, ['installNativeBehaviorAdapters']);
  const entities = [];
  const ctx = {camera: new Three.PerspectiveCamera(), scene: new Three.Group(), world: {createEntity() {
    const components = new Map();
    const entity = {addComponent(Type) { components.set(Type, new Type()); return this; }, getMutableComponent(Type) { return components.get(Type); }, remove() { this.removed = true; }};
    entities.push(entity); return entity;
  }}}; api.installNativeBehaviorAdapters(ctx);
  const objects = [new Three.Mesh(new Three.PlaneBufferGeometry(), new Three.MeshBasicMaterial()), new Three.Mesh(new Three.PlaneBufferGeometry(), new Three.MeshBasicMaterial())];
  const original = objects.map(object => object.material);
  objects.forEach(object => ctx.scene.add(object));
  const copies = objects.map(object => ctx.editorBehaviorAdapters.graffiti(ctx, object, {distance: 2, brushSize: 0.2, opacity: 0.5}));
  assert.notEqual(objects[0].material.map, objects[1].material.map);
  assert.notEqual(objects[0].material.map.image, objects[1].material.map.image);
  assert.notEqual(entities[0], entities[1]);
  objects[0].visible = false; copies[0].execute();
  const hiddenBounds = entities[0].getMutableComponent(BoundingBox);
  assert.ok(new Three.Box3(hiddenBounds.min, hiddenBounds.max).isEmpty());
  objects[0].visible = true; objects[0].position.x = 10; copies[0].execute();
  assert.equal(entities[0].getMutableComponent(BoundingBox).min.x, 7.5);
  const versions = objects.map(object => object.material.map.version);
  copies[0].state.onSelectStart({uv: new Three.Vector2(), distance: 1});
  assert.equal(objects[0].material.map.version, versions[0] + 1); assert.equal(objects[1].material.map.version, versions[1]);
  copies.forEach(copy => copy.dispose()); objects.forEach((object, index) => assert.equal(object.material, original[index]));
  assert.ok(entities.every(entity => entity.removed));
  const object = new Three.Group(); object.rotation.y = 0.5; const initial = object.quaternion.clone();
  ctx.camera.position.set(5, 2, 1); const billboard = ctx.editorBehaviorAdapters.billboard(ctx, object);
  billboard.execute(); assert.equal(object.quaternion.equals(initial), false); billboard.dispose(); assert.ok(object.quaternion.equals(initial));
}

function testInfoEditorPreview() {
  const canvases = [];
  const browserDocument = {createElement() {
    const draw = {texts: [], fillRect() {}, fillText(text) { this.texts.push(text); }, measureText(text) { return {width: text.length * 18}; }};
    const canvas = {draw, getContext() { return draw; }}; canvases.push(canvas); return canvas;
  }};
  const {InfoPanelPreview, canvasCard} = load('src/editor/InfoPanelPreview.js', {document: browserDocument}, ['InfoPanelPreview', 'canvasCard']);
  const scene = new Three.Group();
  const panel = new Three.Mesh(new Three.PlaneBufferGeometry(0.9, 0.9), new Three.MeshBasicMaterial({opacity: 0, transparent: true}));
  panel.name = 'infopanel015'; panel.userData.editorId = 'native:hall:root.0.35';
  panel.userData.editorDefaultBehaviors = [{type: 'info', enabled: true, title: 'WELCOME!', text: 'Contenido original', fontSize: 0.05, color: '#ffffff'}, {type: 'billboard', enabled: true}];
  panel.userData.editorNativeBehaviorTypes = ['info', 'billboard'];
  const text = new Three.Mesh(new Three.PlaneBufferGeometry(0.1, 0.1), new Three.MeshBasicMaterial());
  text.name = 'textMesh'; panel.add(text);
  const hiddenText = new Three.Mesh(new Three.PlaneBufferGeometry(0.1, 0.1), new Three.MeshBasicMaterial());
  hiddenText.name = 'textMesh'; hiddenText.visible = false; hiddenText.material.visible = false; panel.add(hiddenText);
  const copy = new Three.Group(); copy.userData.editorId = 'custom-info';
  copy.userData.editorDefaultBehaviors = JSON.parse(JSON.stringify(panel.userData.editorDefaultBehaviors));
  copy.add(new Three.Mesh(panel.geometry, panel.material.clone()));
  scene.add(panel, copy);
  let objects = [panel, text, hiddenText, copy, copy.children[0]];
  const document = {visuals: new Map(), getObjects(roomId) { return roomId === 'hall' ? objects : []; }};
  const camera = new Three.PerspectiveCamera(); camera.position.set(-3, 2, -4);
  const preview = new InfoPanelPreview({scene}, document);
  const helperOf = object => object.children.find(child => child.userData.editorInfoPreview);
  const originalQuaternion = panel.quaternion.clone();
  preview.sync('hall', camera);
  const helper = helperOf(panel), copyHelper = helperOf(copy);
  assert(helper && copyHelper, 'Original and pasted panels have readable editor text before Probar');
  assert.equal(helper.userData.editorVisualOwnerId, panel.userData.editorId);
  assert.equal(helper.userData.editorRuntimeHelper, true);
  assert.equal(helper.material.side, Three.DoubleSide, 'The preview is editable from either side');
  assert.equal(helper.material.opacity, 1, 'A native support faded to opacity 0 does not hide its editor text');
  assert.notEqual(helper.material.map.image, copyHelper.material.map.image, 'Copies own independent canvas textures');
  assert.equal(text.visible, true, 'Preview does not change serializable Object3D visibility');
  assert.equal(text.material.visible, false, 'Generated native text does not overlap the preview');
  assert(panel.quaternion.equals(originalQuaternion), 'Billboard preview cannot author a camera-dependent rotation');
  assert(canvases[0].draw.texts.includes('WELCOME!'));
  assert(canvases[0].draw.texts.some(value => value.includes('Contenido original')));
  for (let frame = 0; frame < 3; frame++) preview.sync('hall', camera);
  assert.equal(canvases.length, 2, 'Unchanged frames reuse both canvas textures');
  assert.equal(helperOf(panel), helper);
  const releases = {texture: 0, material: 0, geometry: 0};
  helper.material.map.addEventListener('dispose', () => releases.texture++);
  helper.material.addEventListener('dispose', () => releases.material++);
  helper.geometry.addEventListener('dispose', () => releases.geometry++);
  const info = panel.userData.editorDefaultBehaviors[0];
  info.title = 'Bienvenidos'; info.text = 'Texto nuevo\nSegunda línea'; info.color = '#abcdef'; info.fontSize = 0.08;
  preview.sync('hall', camera);
  assert.notEqual(helperOf(panel), helper, 'Property edits rebuild only the changed panel');
  assert.deepEqual(releases, {texture: 1, material: 1, geometry: 1});
  assert.equal(helperOf(copy), copyHelper, 'Updating native text leaves the pasted panel independent');
  assert(canvases[2].draw.texts.includes('Bienvenidos'));
  assert(canvases[2].draw.texts.some(value => value.includes('Texto nuevo')));
  assert.equal(canvases[2].draw.fillStyle, '#abcdef');
  assert.equal(text.material.visible, false);
  const beforeVisual = helperOf(panel);
  document.visuals.set(panel.userData.editorId, {content: new Three.Group()});
  preview.sync('hall', camera);
  assert.notEqual(helperOf(panel), beforeVisual, 'Replacing the visual refreshes the fitted text card');
  info.enabled = false;
  preview.sync('hall', camera);
  assert.equal(helperOf(panel), undefined, 'Disabling info removes its editor card');
  assert.equal(text.material.visible, false, 'Disabled info cannot reveal the old native SDF contents');
  panel.userData.editorBehaviors = [];
  preview.sync('hall', camera);
  assert.equal(helperOf(panel), undefined, 'Removing native info also suppresses its stale text');
  objects = objects.filter(object => object !== copy && object !== copy.children[0]); scene.remove(copy);
  preview.sync('hall', camera);
  assert.equal(helperOf(copy), undefined, 'Deleting a panel releases its helper');
  preview.dispose();
  assert.equal(preview.panels.size, 0);
  assert.equal(text.material.visible, true, 'Leaving edit mode restores the native SDF material');
  assert.equal(text.visible, true);
  assert.equal(hiddenText.material.visible, false, 'An originally hidden material stays hidden');
  assert.equal(hiddenText.visible, false);
  delete panel.userData.editorBehaviors; info.enabled = true;
  preview.sync('hall', camera); assert(helperOf(panel));
  preview.sync('other-room', camera);
  assert.equal(helperOf(panel), undefined, 'Changing rooms removes previews in the previous room');
  assert.equal(text.material.visible, true);
  preview.dispose(); preview.dispose();
  // The shared runtime adapter follows the same visibility contract and owns
  // fresh materials, so changing editor modes never persists hidden SDF nodes.
  const runtime = canvasCard(panel, info);
  assert.equal(text.visible, true); assert.equal(text.material.visible, false);
  runtime.dispose(); runtime.dispose();
  assert.equal(text.material.visible, true);
}

function testAreasAreAUnion() {
  class Area {} class AreaInside {} class AreaExiting {} class AreaEntering {} class Object3D {} class AreaChecker {} class BoundingBox {} class AreaReactor {} class System {}
  const api = load('src/systems/AreaCheckerSystem.js', {Area, AreaInside, AreaExiting, AreaEntering, Object3D, AreaChecker, BoundingBox, AreaReactor, System}, ['AreaCheckerSystem']);
  const box = new Three.Box3(new Three.Vector3(-1, -1, -1), new Three.Vector3(1, 1, 1));
  const near = new Three.Box3(new Three.Vector3(-2, -2, -2), new Three.Vector3(2, 2, 2));
  const far = new Three.Box3(new Three.Vector3(10, 10, 10), new Three.Vector3(12, 12, 12));
  const components = new Set();
  const checker = {getComponent() { return {value: {boundingBox: box}}; }, hasComponent(Type) { return components.has(Type); }, addComponent(Type) { components.add(Type); }, removeComponent(Type) { components.delete(Type); }};
  const system = new api.AreaCheckerSystem();
  system.queries = {areas: {results: [{getComponent() { return near; }}, {getComponent() { return far; }}]}, checkers: {results: [checker]}};
  system.execute(); assert.equal(components.has(AreaInside), true);
  system.queries.areas.results.reverse(); system.execute(); assert.equal(components.has(AreaInside), true);
  near.makeEmpty(); system.execute(); assert.equal(components.has(AreaInside), false);
  system.queries.areas.results = []; system.execute(); assert.equal(components.has(AreaInside), false);
}

function testCopiedNotesAndSticks() {
  const loaded = [];
  const THREE = Object.assign({}, Three, {AudioListener: class extends Three.Group {}, AudioLoader: class {load(url, callback) { loaded.push(url); callback({url}); }}});
  class Polyphonic extends Three.Group {
    constructor() { super(); this.plays = 0; this.children.push({setVolume(value) { this.volume = value; }}); }
    setBuffer(buffer) { this.buffer = buffer; }
    play() { this.plays++; }
  }
  const api = load('src/stations/Xylophone.js', {THREE, PositionalAudioPolyphonic: Polyphonic}, ['setup', 'execute', 'onSelectStart', 'onSelectEnd']);
  const world = new Three.Group(), hall = new Three.Group(); world.add(hall);
  for (let i = 0; i < 13; i++) { const note = new Three.Mesh(new Three.BoxBufferGeometry(0.4, 0.2, 0.4)); note.name = 'xnote0' + (i < 10 ? '0' + i : i); note.position.set(i * 3, 1, 0); hall.add(note); }
  ['left', 'right'].forEach(side => { const stick = new Three.Group(); stick.name = 'xylostick-' + side; stick.position.set(0, 1, side === 'left' ? 0 : 8); stick.add(new Three.Mesh(new Three.SphereBufferGeometry(0.1), new Three.MeshBasicMaterial())); hall.add(stick); });
  const controller = new Three.Group(); controller.userData.grabbing = null; controller.boundingBox = new Three.Box3(); world.add(controller);
  const ctx = {scene: world, camera: new Three.PerspectiveCamera(), controllers: [controller], raycontrol: {enable() {}, disable() {}}};
  api.setup(ctx, hall);
  const originalNote = hall.getObjectByName('xnote000'); originalNote.userData.editorBehaviors = [{type: 'note', enabled: false, asset: 'ogg/xylophone1.ogg', volume: 1}];
  const copy = new Three.Mesh(new Three.BoxBufferGeometry(0.4, 0.2, 0.4), new Three.MeshLambertMaterial()); copy.position.set(0, 1, 0);
  copy.userData.editorBehaviors = [{type: 'note', enabled: true, asset: 'ogg/xylophone2.ogg', volume: 0.3}]; hall.add(copy);
  ctx.editorXylophone.addNote(copy, copy.userData.editorBehaviors[0]);
  world.updateMatrixWorld(true); controller.position.set(0, 1, 0); world.updateMatrixWorld(true);
  controller.boundingBox.setFromCenterAndSize(controller.position, new Three.Vector3(0.3, 0.3, 0.3));
  api.onSelectStart({target: controller}); world.updateMatrixWorld(true); api.execute(ctx, 0.016, 1);
  assert.equal(originalNote.userData.sound.plays, 0); assert.equal(copy.userData.sound.plays, 1);
  assert.notEqual(originalNote.userData.sound, copy.userData.sound); assert.equal(copy.userData.sound.children[0].volume, 0.3);
  api.onSelectEnd({target: controller});
  copy.userData.editorBehaviors[0].asset = 'ogg/xylophone3.ogg'; api.execute(ctx, 0.016, 2);
  assert.equal(copy.userData.sound.buffer.url, 'assets/ogg/xylophone3.ogg');
  ctx.editorXylophone.removeNote(copy); assert.equal(copy.userData.sound, undefined);

  // A lost XR hand returns only its own native mallet. The other hand keeps
  // playing with its ray suspended until it releases or the whole mode exits.
  const other = new Three.Group(); other.userData.grabbing = null; other.boundingBox = new Three.Box3(); world.add(other); ctx.controllers.push(other);
  const firstData = {controller, enabled: true}, otherData = {controller: other, enabled: true};
  ctx.raycontrol.controllers = [firstData, otherData];
  controller.position.set(0, 1, 0); other.position.set(0, 1, 8); world.updateMatrixWorld(true);
  controller.boundingBox.setFromCenterAndSize(controller.position, new Three.Vector3(0.3, 0.3, 0.3));
  other.boundingBox.setFromCenterAndSize(other.position, new Three.Vector3(0.3, 0.3, 0.3));
  const firstStick = hall.getObjectByName('xylostick-left'), otherStick = hall.getObjectByName('xylostick-right');
  api.onSelectStart({target: controller}); api.onSelectStart({target: other});
  assert.equal(controller.userData.grabbing, firstStick); assert.equal(other.userData.grabbing, otherStick);
  assert.equal(firstData.enabled, false); assert.equal(otherData.enabled, false);
  ctx.editorXylophone.releaseHeld(controller);
  assert.equal(controller.userData.grabbing, null); assert.equal(firstStick.parent, hall); assert.equal(firstData.enabled, true);
  assert.equal(other.userData.grabbing, otherStick, 'Disconnecting the first hand must retain the other mallet');
  assert.equal(otherStick.parent, other); assert.equal(otherData.enabled, false, 'The surviving mallet still owns only its own ray suspension');
  ctx.editorXylophone.releaseHeld();
  assert.equal(other.userData.grabbing, null); assert.equal(otherStick.parent, hall); assert.equal(otherData.enabled, true);
}

testPanoSettings(); testPaintingSettings(); testIndependentPaintAndBillboard(); testInfoEditorPreview(); testAreasAreAUnion(); testCopiedNotesAndSticks();
console.log('PASS native components, independent info previews/edit/copy/cleanup, painting replacement, graffiti, billboard restore, native/copied notes and editable audio.');
