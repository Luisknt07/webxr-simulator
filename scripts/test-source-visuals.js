// Real metric geometry and live HMI bindings; only the canvas boundary is adapted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');

const dom = {createElement(tag) {
  assert.equal(tag, 'canvas');
  const canvas = {width: 0, height: 0, text: [], paints: 0};
  const context = {fillRect(x, y, w, h) { if (!x && !y && w === canvas.width && h === canvas.height) { canvas.text = []; canvas.paints++; } },
    fillText(value) { canvas.text.push(String(value)); }};
  canvas.getContext = () => context; return canvas;
}};
const read = file => fs.readFileSync(path.join(__dirname, '../src/editor', file), 'utf8').replace(/^import .*;\r?\n/gm, '');
const cargo = require('./load-product-prefabs.js')(THREE);
const prefab = new Function('THREE', 'behaviorSchema', 'document', 'require', read('IndustrialPrefabs.js')
  .replace(/^export const /gm, 'const ').replace(/^export function /gm, 'function ') + '\nreturn {createIndustrialPrefab,createSourceProductVisual};')(THREE, behaviorSchema, dom, id => { assert.equal(id, './ProductPrefabs.js'); return cargo; });
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', read('SceneDocument.js').replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, prefab.createIndustrialPrefab);
const IndustrialVisuals = new Function('THREE', 'RollerInstanceBatches', read('IndustrialVisuals.js').replace('export default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE, require('./load-roller-instance-batches')(THREE));
const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 0.00001, message || `${actual} != ${expected}`);
function bounds(object) { object.updateMatrixWorld(true); return new THREE.Box3().setFromObject(object); }

async function run() {
  for (const type of ['box', 'crate', 'drum', 'bottle']) {
    const spec = {id: type, name: type, type, width: 0.43, height: 0.61, depth: 0.27, color: '#6f9dc6'};
    const object = prefab.createSourceProductVisual(spec), size = bounds(object).getSize(new THREE.Vector3());
    close(size.x, spec.width); close(size.y, spec.height); close(size.z, spec.depth);
    close(bounds(object).min.y, 0, 'All shapes rest on the table rather than sinking through it.');
    close(bounds(object).getCenter(new THREE.Vector3()).x, 0); close(bounds(object).getCenter(new THREE.Vector3()).z, 0);
    assert.equal(object.userData.sourceProduct.units, 1);
    object.traverse(node => assert(!node.userData.editorId && !node.userData.editorPrefabNode, 'Generated details must not become independent editor actors.'));
  }
  const spec = {id: 'carton-01', name: 'Carga de cajas', type: 'box', width: 0.32, height: 0.27, depth: 0.25, color: '#d3b285'};
  const load = {loadMode: 'pallet', palletColumns: 4, palletRows: 4, palletLayers: 4};
  const pallet = prefab.createSourceProductVisual(spec, load), expected = behaviorSchema.productSources.loadSize(spec, load);
  const palletBounds = bounds(pallet), palletSize = palletBounds.getSize(new THREE.Vector3());
  close(palletBounds.min.y, 0); close(palletSize.x, expected.width); close(palletSize.y, expected.height); close(palletSize.z, expected.depth);
  assert.equal(pallet.userData.sourceProduct.units, 64);
  assert(pallet.userData.forkPockets && pallet.userData.sourceProduct.forkPockets, 'Source pallets expose the actual openings used by fork handling.');
  let meshes = 0, triangles = 0;
  pallet.traverse(node => { if (node.isMesh) { meshes++; triangles += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3; } });
  assert(meshes < 12, 'A 64-box pallet must remain one inexpensive handling unit with a few material batches.');
  assert(triangles < 15000);
  const independent = prefab.createSourceProductVisual(spec, load);
  assert.notEqual(pallet.children[0].geometry, independent.children[0].geometry);
  assert.notEqual(pallet.children[0].material, independent.children[0].material);

  const source = prefab.createIndustrialPrefab('source'), queue = prefab.createIndustrialPrefab('source', 'queue');
  assert.equal(source.userData.editorDefaultBehaviors[0].type, 'source');
  assert.equal(queue.userData.editorDefaultBehaviors[0].autoGenerate, false);
  close(bounds(source).min.y, -1, 'Source and conveyor surfaces align when both equipment feet rest on the same floor.');
  assert.equal(source.userData.industrialSource.slots.length, 1, 'Only the next FIFO load is physically presented.');
  const panel = source.children[2], controls = panel.children.filter(node => node.userData.editorPrefabKey === 'control');
  assert.deepEqual(controls.map(node => node.userData.industrialAction), ['start', 'stop', 'pause', 'generate', 'dispatch', 'clearQueue']);
  const cabinet = bounds(panel.children[0]);
  panel.traverse(node => {
    if (!['Rótulo del control', 'Identificación Source'].includes(node.name)) return;
    const caption = bounds(node);
    assert(caption.min.x >= cabinet.min.x + 0.02 && caption.max.x <= cabinet.max.x - 0.02 &&
      caption.min.y >= cabinet.min.y + 0.02 && caption.max.y <= cabinet.max.y - 0.02,
    'Every caption must fit the cabinet face with a visible border.');
    close(caption.min.z, cabinet.max.z + 0.003, 'Captions are mounted on the panel face.');
  });
  source.updateMatrixWorld(true);
  const tableHits = new THREE.Raycaster(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, -1, 0)).intersectObject(source.children[0], true);
  close(tableHits[0].point.y, 0, 'The handling height and product placement remain unchanged.');
  assert(tableHits.filter(hit => Math.abs(hit.point.y) < 0.00001).every(hit => hit.object.material.metalness === 0 && hit.object.material.roughness >= 0.9),
    'Only the matte antislip surface can occupy the deck plane; metal must not flicker through it.');
  assert(tableHits.some(hit => hit.object.material.color.getHexString() === 'aab8c2' && hit.point.y < -0.003));
  const resized = Object.assign(behaviorSchema.defaultBehavior('source'), {loadMode: 'pallet', width: 1.2, depth: 0.7});
  assert(prefab.createIndustrialPrefab.refresh(source, resized));
  assert.equal(source.children[2], panel, 'Resizing the deck must retain authored panel and control paths.');
  controls.forEach(control => assert(control.parent === panel));
  assert(source.userData.industrialSource.length > 2.6);
  assert.equal(prefab.createIndustrialPrefab.refresh(source, resized), false, 'Unchanged settings must not rebuild geometry every frame.');
  panel.position.x = 0.4;
  prefab.createIndustrialPrefab.refresh(source, Object.assign({}, resized, {width: 1.6}));
  close(panel.position.x, 0.4, 'A deliberately repositioned panel must keep its authored pose.');

  const document = new SceneDocument({}), root = new THREE.Group(); document.registerRoom('hall', root);
  const first = document.addPrefab('hall', 'source'), second = document.addPrefab('hall', 'source', 'queue');
  const sourceState = {enabled: true, running: true, queued: 3, capacity: 8, queuedUnits: 12, generated: 5, delivered: 2, received: 0, nextProduct: 'Cajas medianas', delivery: 'manual', interval: 3};
  const queueState = {enabled: true, running: true, queued: 1, capacity: 4, queuedUnits: 1, generated: 0, delivered: 6, received: 7, nextProduct: 'Bidón azul', delivery: 'automatic', interval: 5};
  const records = new Map([[first.userData.editorId, {variables: sourceState}], [second.userData.editorId, {variables: queueState}]]);
  const visuals = new IndustrialVisuals({document: dom}, document, {running: true, records});
  const before = await document.serialize(); root.updateMatrixWorld(true); visuals.sync('hall', 0.2, false);
  assert.equal(visuals.displays.size, 2);
  const displays = Array.from(visuals.displays.values());
  const screen = displays.find(entry => entry.conveyor.object === first), secondScreen = displays.find(entry => entry.conveyor.object === second);
  assert(screen && secondScreen, 'Each physical Source screen resolves its own source ID.');
  const text = entry => entry.canvas.text.join('\n');
  assert.match(text(screen), /Cajas medianas/); assert.match(text(screen), /3 \/ 8/); assert.match(text(screen), /SALIDA MANUAL/);
  assert(!text(screen).includes('Bidón azul'));
  assert.match(text(secondScreen), /Bidón azul/); assert.match(text(secondScreen), /1 \/ 4/); assert.match(text(secondScreen), /SALIDA AUTOMÁTICA/);
  const paints = screen.canvas.paints;
  for (let frame = 0; frame < 60; frame++) visuals.sync('hall', 1 / 60, false);
  assert.equal(screen.canvas.paints, paints, 'Stable FIFO indicators must not continually redraw/upload textures.');
  sourceState.queued = 8; visuals.sync('hall', 0.2, false); assert.match(text(screen), /COLA LLENA/);
  assert.deepEqual(await document.serialize(), before, 'Physical feedback must not overwrite authored properties.');
  visuals.dispose();
  console.log('Source visuals: exact product sizes, base alignment, bounded pallet batches, compact FIFO deck, stable component paths and independent live HMI passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
