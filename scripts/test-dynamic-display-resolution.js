'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors'), Resolution = require('./load-dynamic-display-resolution')(THREE);
const read = file => fs.readFileSync(path.join(__dirname, '../src/editor', file), 'utf8').replace(/^import .*;\r?\n/gm, '');
const Monitor = new Function('THREE', 'behaviorSchema', 'DynamicDisplayResolution', read('LineMonitorSystem.js').replace('export default class LineMonitorSystem', 'return class LineMonitorSystem'))(THREE, schema, Resolution);
const Memory = new Function('THREE', read('RuntimeResourceMemory.js').replace('export default class RuntimeResourceMemory', 'return class RuntimeResourceMemory'))(THREE);
function drawingCanvas() {
  let width = 0, height = 0;
  const canvas = {transforms: [], clears: [], text: [], resized: 0}, reset = () => {canvas.resized++; context.matrix = [1, 0, 0, 1, 0, 0];};
  const context = {matrix: [1, 0, 0, 1, 0, 0],
    setTransform(...values) {this.matrix = values; canvas.transforms.push(values);},
    fillRect(x, y, w, h) {if (!x && !y) {canvas.clears.push({logical: [w, h], physical: [w * this.matrix[0], h * this.matrix[3]]}); canvas.text = [];}},
    fillText(text) {canvas.text.push(String(text));}, measureText: text => ({width: String(text).length * 8}),
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, closePath() {}, fill() {}, save() {}, restore() {}, rect() {}, clip() {}, strokeRect() {}, setLineDash() {}};
  Object.defineProperties(canvas, {width: {get: () => width, set: value => {width = value; reset();}}, height: {get: () => height, set: value => {height = value; reset();}}});
  canvas.getContext = () => context; return canvas;
}
function memory(entries) {
  const textures = new Set(entries.map(entry => entry.texture)), roots = {textures, attributes: new Set(), renderTargets: new Set()};
  return new Memory().sample(roots, roots).gpuTextureBytes;
}
const camera = new THREE.PerspectiveCamera(50, 16 / 9, .1, 200); camera.position.set(0, 1.6, 0); camera.updateMatrixWorld(true);
const scene = new THREE.Scene(), boards = [], byId = new Map(), ctx = {camera, renderer: {domElement: {width: 1280, height: 720}}, graphics: {getLimits: () => ({tier: 'balanced'})}, document: {createElement: drawingCanvas}};
ctx.performanceVisibility = {cameras: [camera], isVisible: owner => owner.userData.shown !== false};
for (let index = 0; index < 24; index++) {
  const board = new THREE.Group(); board.userData.editorId = 'monitor-' + index;
  board.userData.editorBehaviors = [{type: 'lineMonitor', scope: 'module', refreshHz: 4, title: 'Monitor ' + index}];
  board.position.set(index % 2 ? 1 : -1, 1.6, index < 2 ? -4 : index < 8 ? -10 : -30);
  board.scale.set(3.6, 2.025, .12); scene.add(board); boards.push(board); byId.set(board.userData.editorId, board);
}
const document = {getObjects: () => boards, getObject: id => byId.get(id), getBehaviors: object => object.userData.editorBehaviors};
const monitor = new Monitor(ctx, document, {running: false, products: new Map(), records: new Map(), events: []});
monitor.sync('hall', 0, true); const entries = Array.from(monitor.entries.values()), originalTextures = entries.map(entry => entry.texture), authored = boards.map(board => JSON.stringify(board.userData.editorBehaviors));
const fullBytes = memory(entries); assert.equal(fullBytes, 24 * 1024 * 576 * 4);
monitor.sync('hall', .5, false); monitor.sync('hall', .5, false);
const adaptiveBytes = memory(entries), dimensions = entries.reduce((counts, entry) => {counts[entry.canvas.width] = (counts[entry.canvas.width] || 0) + 1; return counts;}, {});
assert.deepEqual(dimensions, {256: 16, 512: 6, 1024: 2}); assert(adaptiveBytes < fullBytes * .2);
entries.forEach((entry, index) => {
  assert.equal(entry.texture, originalTextures[index]); assert.equal(entry.plane.material, entry.backPlane.material); assert.equal(entry.texture.image, entry.canvas);
  assert.equal(entry.texture.generateMipmaps, false); assert.equal(entry.texture.minFilter, THREE.LinearFilter); assert.equal(entry.texture.encoding, THREE.sRGBEncoding);
  assert.deepEqual(entry.drawing.matrix, [entry.canvas.width / 1024, 0, 0, entry.canvas.height / 576, 0, 0]);
  const clear = entry.canvas.clears.at(-1); assert.deepEqual(clear.logical, [1024, 576]); assert.deepEqual(clear.physical, [entry.canvas.width, entry.canvas.height]);
  assert(entry.regions.every(region => region.x + region.width <= 1024 && region.y + region.height <= 576));
});
const resizes = monitor.displayResolution.stats.resizes;
for (let frame = 0; frame < 120; frame++) monitor.sync('hall', 1 / 60, false);
assert.equal(monitor.displayResolution.stats.resizes, resizes, 'Unchanged view must not resize textures every frame.');
// Logical UV selection does not depend on the backing-store size. Existing
// controller reach/obstruction validation has its own real XR regression.
const far = entries.at(-1), region = far.regions.find(value => value.key === 'analytics'), controller = {};
monitor.valid = () => true; monitor.press(far, {uv: new THREE.Vector2((region.x + region.width / 2) / 1024, 1 - (region.y + region.height / 2) / 576)}, controller);
assert.equal(far.page, 'analytics'); monitor.displayResolution.update(far, 0, false, true); assert.equal(far.canvas.width, 1024, 'Interacting promotes the display immediately.'); monitor.release(far, controller);
camera.position.z = -28; camera.updateMatrixWorld(true); monitor.sync('hall', 0, false);
assert.equal(far.canvas.width, 1024, 'Teleporting toward a monitor restores full detail before drawing.');
camera.position.z = 0; camera.updateMatrixWorld(true);
// A hidden display shrinks after settling, releases the old texture allocation,
// and cannot redraw analytics until it is visible again.
far.owner.userData.shown = false; far.dirty = true; const draws = far.canvas.clears.length, version = far.texture.version; let releases = 0; far.texture.addEventListener('dispose', () => releases++);
monitor.sync('hall', .5, false); monitor.sync('hall', .5, false);
assert.equal(far.canvas.width, 256); assert.equal(releases, 1); assert(far.texture.version > version); assert.equal(far.canvas.clears.length, draws);
far.owner.userData.shown = true; camera.position.z = -28; camera.updateMatrixWorld(true); monitor.sync('hall', 0, false); assert.equal(far.canvas.width, 1024); assert.equal(far.dirty, false);
monitor.sync('hall', 0, true); assert.equal(memory(entries), fullBytes, 'Editing preserves full authored resolution for every monitor.');
assert.deepEqual(boards.map(board => JSON.stringify(board.userData.editorBehaviors)), authored);
// Both tracked XR eyes are considered without rebuilding their local matrices.
const eyeA = new THREE.PerspectiveCamera(50, 1, .1, 200), eyeB = eyeA.clone(); eyeA.matrixWorld.makeTranslation(0, 1.6, 0); eyeB.matrixWorld.makeTranslation(0, 1.6, -28);
eyeA.viewport = new THREE.Vector4(0, 0, 1200, 1200); eyeB.viewport = new THREE.Vector4(1200, 0, 1200, 1200);
const savedEye = eyeB.matrixWorld.clone(), xrContext = {vrMode: true, camera, renderer: {domElement: {width: 800, height: 600}, xr: {getCamera: () => ({isArrayCamera: true, cameras: [eyeA, eyeB]})}}, graphics: {getLimits: () => ({tier: 'economy'})}};
const xr = new Resolution(xrContext); xr.resize(far, 256); xr.update(far, 0, false, true); assert.equal(far.canvas.width, 1024); assert.deepEqual(eyeB.matrixWorld.elements, savedEye.elements);
const measuredA = xr.projectedWidth(far.plane, [eyeA]), measuredBoth = xr.projectedWidth(far.plane, [eyeA, eyeB]); assert(measuredBoth > measuredA * 4, 'The eye with the larger projected monitor controls detail.');
// A renderer with no measured camera and an adapter without transform support
// conservatively retains the original display instead of scaling its layout.
const fallback = new Resolution({}); fallback.resize(far, 256); fallback.update(far, 0); assert.equal(far.canvas.width, 1024);
monitor.dispose(); entries.forEach(entry => {assert.equal(entry.canvas.width, 0); assert.equal(entry.canvas.height, 0);});
console.log('Dynamic monitor resolution: 24 production canvases, logical drawing/UVs, near/editor/interaction detail, two-eye XR poses, stable resize cadence and exact cleanup passed.');
console.log(JSON.stringify({fullBytes, adaptiveBytes, reduction: 1 - adaptiveBytes / fullBytes, dimensions, resizesAtStableView: resizes}));
