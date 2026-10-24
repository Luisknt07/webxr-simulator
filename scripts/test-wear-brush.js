// Actual authoring pointer bridge, brush, scene document, triangle raycasts and
// wear projection. DOM widgets/canvas bounds are the only adapted boundary.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');
const wearSchema = require('../shared/wear.js');
const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);
function source(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', source('src/editor/IndustrialPrefabs.js') + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('src/editor/SceneDocument.js').replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const decalSource = fs.readFileSync(path.join(__dirname, '../node_modules/three/examples/jsm/geometries/DecalGeometry.js'), 'utf8').replace(/import \{[\s\S]*?\} from "[^\"]+";/, '').replace('export { DecalGeometry, DecalVertex };', 'return DecalGeometry;');
const DecalGeometry = new Function('BufferGeometry', 'Float32BufferAttribute', 'Matrix4', 'Vector3', decalSource)(THREE.BufferGeometry, THREE.Float32BufferAttribute, THREE.Matrix4, THREE.Vector3);
const DecalSystem = new Function('THREE', 'DecalGeometry', 'getGeometryTree', 'wearSchema', source('src/editor/DecalSystem.js').replace('default class DecalSystem', 'return class DecalSystem'))(THREE, DecalGeometry, getGeometryTree, wearSchema);
const WearPaintSystem = new Function('THREE', 'DecalSystem', 'wearSchema', source('src/editor/WearPaintSystem.js').replace('default class WearPaintSystem', 'return class WearPaintSystem'))(THREE, DecalSystem, wearSchema);
const WearBrush = new Function('THREE', 'wearSchema', source('src/editor/WearBrush.js').replace('default class WearBrush', 'return class WearBrush'))(THREE, wearSchema);
const editorSource = source('src/editor/SceneEditor.js');
let now = 1700000000000;

function block(text, marker) {
  const start = text.indexOf(marker); assert(start >= 0, 'Missing production editor bridge ' + marker);
  const open = text.indexOf('{', start); let depth = 0, quote = '', line = false, comment = false;
  for (let index = open; index < text.length; index++) {
    const ch = text[index], next = text[index + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (comment) { if (ch === '*' && next === '/') { comment = false; index++; } continue; }
    if (quote) { if (ch === '\\') index++; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { line = true; index++; continue; }
    if (ch === '/' && next === '*') { comment = true; index++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  throw new Error('Unbalanced editor bridge ' + marker);
}
function method(name, editor) {
  return new Function('THREE', 'isTyping', 'NAVIGATION_KEYS', 'TOOL_MODES', 'PLACEABLE_KINDS', 'return ({' + block(editorSource, '\n  ' + name + '(') + '}).' + name + ';')
    (THREE, () => false, ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'], ['translate', 'rotate', 'scale'], []).bind(editor);
}
class Element extends THREE.EventDispatcher {
  constructor() {
    super(); this.hidden = false; this.styles = new Set(); this.classList = {add: value => this.styles.add(value), remove: value => this.styles.delete(value)};
    this.captured = new Set(); this.captureLog = []; this.rect = {left: 30, top: 20, width: 800, height: 600};
  }
  getBoundingClientRect() { return this.rect; }
  setAttribute() {}
  focus() {}
  setPointerCapture(id) { this.captured.add(id); this.captureLog.push(['set', id]); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) {
    assert(this.captured.has(id), 'Capture may only be released once.'); this.captured.delete(id); this.captureLog.push(['release', id]);
    // The strongest ordering is a synchronous notification; production must
    // already have detached its stroke before that notification is observed.
    this.dispatchEvent({type: 'lostpointercapture', pointerId: id});
  }
}
function setup() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const owner = document.addPrimitive('hall', 'plane'); document.rename(owner, 'Carcasa industrial'); document.setTransform(owner, {position: [0, 0, 0], scale: [2.6, 1.5, 1]});
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.01, 100); camera.position.set(0, 0, 5); camera.lookAt(new THREE.Vector3()); scene.add(camera);
  const canvas = new Element(), viewport = new Element(), window = new Element(), notices = [], errors = [];
  const ctx = {scene, renderer: {domElement: canvas}, vrMode: false};
  const library = {getEntry() { throw new Error('A procedural brush never needs an image file.'); }, instantiate() { throw new Error('Unexpected image load.'); }};
  const decals = new DecalSystem(ctx, document, library, value => errors.push(value)), wearPaint = new WearPaintSystem(ctx, document, library, value => errors.push(value));
  const transform = {enabled: true, visible: true, object: owner, detach() { this.object = null; }, attach(object) { this.object = object; }};
  const editor = {active: true, editorEnabled: true, loadingProject: false, selected: owner, camera, ctx, root, document, decals, wearPaint, transform, orbit: {enabled: true}, viewport,
    assembly: {clear() {}}, assemblyMessage() {}, refreshAssembly() {}, clearAssembly() {},
    decalPlacement: null, decalPlacementLabel: {}, decalPlacementBar: {hidden: true}, navigationKeys: new Set(), cleared: 0, operations: 0,
    wearBrushSettings: {pattern: 'rust', size: 0.24, opacity: 0.8, density: 0.7, depth: 0.08, color: '#ffffff', roughness: 0.92, metalness: 0.03},
    clearNavigation() { this.navigationKeys.clear(); this.cleared++; }, toast(value) { notices.push(value); }, renderInspector() {}, keyboardOverlayOpen() { return false; },
    perform(action) { this.operations++; try { const result = action(); if (result && result.catch) result.catch(error => errors.push(error)); return result; } catch (error) { errors.push(error); } },
    copyObject() { this.objectClipboard = document.captureObject(owner); }, historyStep(direction) { return document[direction](); }
  };
  editor.wearBrushTool = new WearBrush(editor);
  ['cancelDecalPlacement', 'startWearBrush', 'stopWearBrush', 'onKey', 'bindViewport'].forEach(name => { editor[name] = method(name, editor); });
  editor.bindViewport();
  new Function('window', block(editorSource, "window.addEventListener('blur',") + ');').call(editor, window);
  document.onChange = () => wearPaint.invalidate();
  scene.updateMatrixWorld(true);
  return {scene, root, document, owner, camera, canvas, viewport, window, editor, brush: editor.wearBrushTool, paint: wearPaint, decals, notices, errors};
}
function render(f) { f.scene.updateMatrixWorld(true); f.paint.sync('hall'); }
function point(f, x, y = 0, z = 0) { return f.owner.localToWorld(new THREE.Vector3(x, y, z)); }
function event(f, world, pointerId = 7, button = 0) {
  f.scene.updateMatrixWorld(true); const projected = world.clone().project(f.camera), rect = f.canvas.rect;
  assert(Math.abs(projected.x) <= 1.01 && Math.abs(projected.y) <= 1.01, 'The test point is inside the editor viewport.');
  return {pointerId, button, clientX: rect.left + (projected.x + 1) * rect.width / 2, clientY: rect.top + (1 - projected.y) * rect.height / 2,
    preventDefault() { this.defaultPrevented = true; }};
}
function emit(f, type, world = point(f, 0), pointerId = 7, button = 0) {
  now += 60; const value = Object.assign(event(f, world, pointerId, button), {type}); f.canvas.dispatchEvent(value); return value;
}
function layers(f, owner = f.owner) { const config = f.document.getBehaviors(owner).find(value => value.type === 'surfaceWear'); return config ? wearSchema.normalizeLayers(config.layers) : []; }
function committedState(f, owner = f.owner) {
  const first = layers(f, owner)[0]; assert(first); const entry = f.paint.entries.get(owner.userData.editorId + '/wear/' + first.id); assert(entry);
  const state = f.paint.engine.states.get(entry.object); assert(state); return state;
}
function stroke(f, coordinates, pointerId = 7) {
  emit(f, 'pointerdown', point(f, coordinates[0][0], coordinates[0][1] || 0), pointerId);
  coordinates.slice(1).forEach(([x, y]) => emit(f, 'pointermove', point(f, x, y || 0), pointerId));
  emit(f, 'pointerup', point(f, coordinates.at(-1)[0], coordinates.at(-1)[1] || 0), pointerId); render(f);
}
function close(actual, expected, epsilon = 1e-6) { assert(Math.abs(actual - expected) <= epsilon, actual + ' != ' + expected); }
function vertices(mesh) { mesh.updateWorldMatrix(true, false); return Array.from({length: mesh.geometry.attributes.position.count}, (_, index) => new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index).applyMatrix4(mesh.matrixWorld)); }
function dispose(f) { f.brush.stop(); f.paint.dispose(); f.decals.dispose(); }

async function run() {
  const realNow = Date.now; Date.now = () => now;
  const all = [];
  try {
    const f = setup(); all.push(f); const before = JSON.stringify(await f.document.serialize()), undoCount = f.document.undoStack.length;
    f.editor.startWearBrush();
    assert.equal(f.editor.wearBrush, f.brush); assert.equal(f.editor.transform.enabled, false); assert.equal(f.editor.transform.object, null);
    assert(!f.editor.decalPlacementBar.hidden && f.viewport.styles.has('ed-placing-decal'));
    emit(f, 'pointerdown', point(f, -0.65)); assert(f.brush.stroke); assert(f.canvas.hasPointerCapture(7)); assert.equal(f.editor.orbit.enabled, false);
    for (let index = 1; index <= 36; index++) emit(f, 'pointermove', point(f, -0.65 + index * 1.3 / 36));
    render(f); assert(f.brush.stroke.layer.stamps.length > 20, 'Dragging across actual raycast hits creates many spaced brush stamps.');
    assert(f.paint.entries.has('__wear-preview')); assert.equal(JSON.stringify(await f.document.serialize()), before, 'A live multi-stamp preview cannot persist before pointer-up.');
    assert.equal(f.document.undoStack.length, undoCount); assert.equal(layers(f).length, 0);
    emit(f, 'pointerup', point(f, 0.65)); render(f);
    assert.equal(layers(f).length, 1); assert(layers(f)[0].stamps.length > 20); assert.equal(f.document.undoStack.length, undoCount + 1);
    assert.equal(f.paint.entries.size, 1); assert.equal(f.paint.engine.states.size, 1); assert(!f.paint.entries.has('__wear-preview'));
    const state = committedState(f); assert(state.mesh.geometry.attributes.position.count > 0); assert.equal(state.mesh.geometry.groups.length, 0, 'Many marks remain a single projected draw.');
    assert.equal(f.editor.orbit.enabled, true); assert.equal(f.canvas.captured.size, 0);
    assert.equal(f.editor.operations, 1, 'One pointer-up invokes one document action.');
    assert(f.document.undo()); render(f); assert.equal(layers(f).length, 0); assert.equal(JSON.stringify(await f.document.serialize()), before);
    assert(f.document.redo()); render(f); assert.equal(layers(f).length, 1);

    const committed = JSON.stringify(await f.document.serialize()), history = f.document.undoStack.length;
    emit(f, 'pointerdown', point(f, 0, -0.3), 19); emit(f, 'pointermove', point(f, 0.2, -0.3), 19); render(f);
    f.editor.onKey({code: 'Escape', target: f.canvas, preventDefault() {}}); render(f);
    assert.equal(f.brush.owner, null); assert.equal(f.brush.ring, null); assert.equal(f.canvas.captured.size, 0);
    assert.equal(JSON.stringify(await f.document.serialize()), committed); assert.equal(f.document.undoStack.length, history);
    assert.equal(f.editor.transform.enabled, true); assert.equal(f.editor.transform.object, f.owner); assert(f.editor.decalPlacementBar.hidden);
    f.editor.startWearBrush();
    for (const cancel of ['pointercancel', 'lostpointercapture', 'blur']) {
      emit(f, 'pointerdown', point(f, -0.2, 0.35), 25); emit(f, 'pointermove', point(f, 0.2, 0.35), 25); render(f);
      if (cancel === 'blur') f.window.dispatchEvent({type: 'blur'});
      else f.canvas.dispatchEvent({type: cancel, pointerId: 25});
      render(f); assert.equal(f.brush.stroke, null); assert.equal(f.canvas.captured.size, 0); assert.equal(f.editor.orbit.enabled, true);
      assert.equal(JSON.stringify(await f.document.serialize()), committed, cancel + ' discards preview without changing authored data.');
      assert.equal(f.document.undoStack.length, history);
    }

    emit(f, 'pointerdown', point(f, -0.3, -0.5), 31); const firstStroke = f.brush.stroke;
    const ringBeforeForeign = f.brush.ring.matrix.clone();
    emit(f, 'pointerdown', point(f, 0.3, 0.5), 32); emit(f, 'pointermove', point(f, 0.4, 0.5), 32); emit(f, 'pointerup', point(f, 0.4, 0.5), 32);
    f.canvas.dispatchEvent({type: 'pointercancel', pointerId: 32}); f.canvas.dispatchEvent({type: 'lostpointercapture', pointerId: 32});
    assert.equal(f.brush.stroke, firstStroke, 'An unrelated pointer cannot replace or commit the active captured stroke.');
    assert(f.brush.ring.matrix.equals(ringBeforeForeign), 'An unrelated pointer cannot move the active brush cursor.');
    assert.deepEqual(Array.from(f.canvas.captured), [31]); assert.equal(firstStroke.layer.stamps.length, 1);
    f.brush.cancelStroke(); render(f); assert.equal(f.canvas.captured.size, 0); assert.equal(JSON.stringify(await f.document.serialize()), committed);

    emit(f, 'pointerdown', point(f, -0.1, -0.3), 37); emit(f, 'pointermove', point(f, 0.2, -0.3), 37);
    f.editor.onKey({code: 'KeyZ', ctrlKey: true, target: f.canvas, preventDefault() {}}); render(f);
    assert.equal(f.brush.stroke, null); assert.equal(f.canvas.captured.size, 0);
    assert.equal(JSON.stringify(await f.document.serialize()), committed, 'Ctrl+Z cancels the current preview before it can undo a previous committed stroke.');
    assert.equal(f.document.undoStack.length, history);
    emit(f, 'pointerdown', point(f, -0.1, -0.3), 38); emit(f, 'pointermove', point(f, 0.2, -0.3), 38);
    f.editor.onKey({code: 'KeyC', ctrlKey: true, target: f.canvas, preventDefault() {}}); render(f);
    assert.equal(f.brush.stroke, null); assert.equal(f.canvas.captured.size, 0); assert.equal(layers(f).length, 2);
    const capturedWear = f.editor.objectClipboard.record.behaviors.find(value => value.type === 'surfaceWear'); assert.equal(wearSchema.normalizeLayers(capturedWear.layers).length, 2, 'Copy finishes the live stroke before capturing the object.');
    assert(f.document.undo()); render(f); assert.equal(JSON.stringify(await f.document.serialize()), committed);
    emit(f, 'pointerdown', point(f, 0.1, 0.4), 39);
    f.canvas.dispatchEvent({type: 'pointermove', pointerId: 39, button: 0, clientX: f.canvas.rect.left - 5, clientY: f.canvas.rect.top + 50});
    assert.equal(f.brush.ring.visible, false); assert.equal(f.brush.stroke.layer.stamps.length, 1);
    assert.equal(f.brush.pick({clientX: f.canvas.rect.left - 1, clientY: f.canvas.rect.top + 50}), null, 'Captured pointer motion outside the canvas cannot raycast into the scene.');
    f.brush.cancelStroke(); render(f); assert.equal(JSON.stringify(await f.document.serialize()), committed);

    const obstacle = f.document.addPrimitive('hall', 'plane'); f.document.setTransform(obstacle, {position: [0, 0, 0.2], scale: [0.55, 0.55, 1]});
    const occluded = JSON.stringify(await f.document.serialize());
    emit(f, 'pointerdown', point(f, 0)); emit(f, 'pointermove', point(f, 0.1)); emit(f, 'pointerup', point(f, 0.1)); render(f);
    assert.equal(f.brush.stroke, null); assert.equal(JSON.stringify(await f.document.serialize()), occluded, 'The closest different actor blocks painting through to the selected actor.');
    emit(f, 'pointerdown', point(f, -0.25)); emit(f, 'pointermove', point(f, 0)); emit(f, 'pointermove', point(f, 0.25)); emit(f, 'pointerup', point(f, 0.25)); render(f);
    const crossing = layers(f).at(-1), crossingWorld = f.owner.matrixWorld.clone().multiply(new THREE.Matrix4().fromArray(crossing.matrix));
    assert.equal(crossing.stamps.length, 2, 'A drag breaks interpolation when its ray crosses an occluding actor.');
    crossing.stamps.forEach(stamp => assert(Math.abs(new THREE.Vector3().fromArray(stamp.position).applyMatrix4(crossingWorld).x) > 0.55, 'No interpolated stamp is placed underneath the occluder.'));
    assert(f.document.undo()); render(f); assert.equal(JSON.stringify(await f.document.serialize()), occluded);
    f.document.remove(obstacle);
    const screen = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), new THREE.MeshStandardMaterial({side: THREE.DoubleSide})); screen.userData.industrialDisplay = true; screen.name = 'Pantalla de control'; screen.position.z = 0.03; f.owner.add(screen); render(f);
    const protectedBefore = JSON.stringify(await f.document.serialize());
    emit(f, 'pointerdown', point(f, 0)); emit(f, 'pointerup', point(f, 0)); render(f);
    assert.equal(JSON.stringify(await f.document.serialize()), protectedBefore, 'A functional HMI surface blocks painting itself and the cabinet behind it.');
    f.owner.remove(screen); screen.geometry.dispose(); screen.material.dispose();

    const geometry = committedState(f).mesh.geometry, beforeVertices = vertices(committedState(f).mesh), matrixBefore = f.owner.matrixWorld.clone(), projections = f.paint.engine.stats.projections;
    f.document.setTransform(f.owner, {position: [0.4, -0.2, 0.1], rotation: [0.1, 0.25, 0]}); render(f);
    assert.equal(committedState(f).mesh.geometry, geometry); assert.equal(f.paint.engine.stats.projections, projections);
    const transform = f.owner.matrixWorld.clone().multiply(new THREE.Matrix4().getInverse(matrixBefore)), movedVertices = vertices(committedState(f).mesh);
    beforeVertices.forEach((value, index) => assert(value.clone().applyMatrix4(transform).distanceTo(movedVertices[index]) < 1e-5));
    const copy = await f.document.duplicate(f.owner); render(f); const copiedState = committedState(f, copy);
    assert.deepEqual(layers(f, copy), layers(f)); assert.notEqual(copiedState.mesh, committedState(f).mesh); assert.notEqual(copiedState.material.map, committedState(f).material.map);
    close(vertices(copiedState.mesh)[0].x - vertices(committedState(f).mesh)[0].x, 0.5, 1e-5);

    // The automatic cap commits once and releases capture, even if the pointer
    // keeps moving before its eventual physical release.
    const bounded = setup(); all.push(bounded); bounded.editor.startWearBrush(); bounded.editor.wearBrushSettings.size = 0.05;
    const boundUndo = bounded.document.undoStack.length;
    emit(bounded, 'pointerdown', point(bounded, -0.75, -0.6), 61);
    for (let index = 0; index < 220; index++) emit(bounded, 'pointermove', point(bounded, index % 2 ? 0.75 : -0.75, -0.6 + index % 7 * 0.15), 61);
    emit(bounded, 'pointerup', point(bounded, 0.75), 61); render(bounded);
    assert.equal(layers(bounded).length, 1); assert.equal(layers(bounded)[0].stamps.length, 128);
    assert.equal(bounded.document.undoStack.length, boundUndo + 1); assert.equal(bounded.editor.operations, 1); assert.equal(bounded.canvas.captured.size, 0);

    // Use a true sheared world basis: a rotated child under a rotated,
    // nonuniform parent. Raycast normals require the inverse transpose.
    const rotated = setup(); all.push(rotated); rotated.root.position.set(0.8, 0.2, -0.4); rotated.root.rotation.set(0.15, 0.35, -0.05); rotated.root.scale.set(1.4, 0.8, 1.15);
    rotated.document.setTransform(rotated.owner, {position: [0.2, 0.15, -0.2], rotation: [0.25, -0.4, 0.2], scale: [1.1, 0.65, 1.3]}); rotated.scene.updateMatrixWorld(true);
    const localPoint = new THREE.Vector3(-0.15, 0.12, 0), worldPoint = rotated.owner.localToWorld(localPoint.clone());
    const normal = new THREE.Vector3(0, 0, 1).applyMatrix3(new THREE.Matrix3().getNormalMatrix(rotated.owner.children[0].matrixWorld)).normalize();
    rotated.camera.position.copy(worldPoint).addScaledVector(normal, 4); rotated.camera.lookAt(worldPoint); rotated.scene.updateMatrixWorld(true); rotated.editor.startWearBrush();
    const pick = rotated.brush.pick(event(rotated, worldPoint)); assert(pick); assert(pick.normal.dot(normal) > 0.999999);
    emit(rotated, 'pointerdown', worldPoint, 72); render(rotated);
    const worldLayer = rotated.owner.matrixWorld.clone().multiply(new THREE.Matrix4().fromArray(rotated.brush.stroke.layer.matrix));
    const layerNormal = new THREE.Vector3(0, 0, 1).transformDirection(worldLayer); assert(layerNormal.dot(normal) > 0.999999, 'The stored local projector reproduces the true world surface normal under nonuniform transforms.');
    assert(new THREE.Vector3().setFromMatrixPosition(worldLayer).distanceTo(worldPoint.clone().addScaledVector(normal, 0.001)) < 1e-6);
    emit(rotated, 'pointermove', rotated.owner.localToWorld(new THREE.Vector3(0.15, 0.12, 0)), 72); emit(rotated, 'pointerup', worldPoint, 72); render(rotated);
    const transformedState = committedState(rotated); assert(transformedState.mesh.geometry.attributes.position.count > 0);
    vertices(transformedState.mesh).forEach(value => assert(Math.abs(value.sub(worldPoint).dot(normal)) < 1e-5, 'The generated marks lie on the actual tilted surface.'));

    all.forEach(value => { dispose(value); assert.equal(value.canvas.captured.size, 0); assert.equal(value.paint.entries.size, 0); assert.equal(value.paint.engine.states.size, 0); assert.equal(value.errors.length, 0); });
    console.log('Wear brush: actual editor pointer/key/blur bridges, many-stamp single undo/draw, preview cancellation, occlusion/HMI protection, multi-pointer capture, moving copies, 128-mark bound and nonuniform normal alignment passed.');
  } finally { Date.now = realNow; all.forEach(dispose); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
