// Actual equipment geometry, editor IDs and HMI feedback; canvas is adapted.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');
const dom = {createElement() {
  const canvas = {width: 0, height: 0, text: [], paints: 0};
  const context = {fillRect(x, y, width, height) { if (!x && !y && width === canvas.width && height === canvas.height) { canvas.text = []; canvas.paints++; } }, fillText(value) { canvas.text.push(String(value)); }};
  canvas.getContext = () => context; return canvas;
}};
const read = file => fs.readFileSync(path.join(__dirname, '../src/editor', file), 'utf8').replace(/^import .*;\r?\n/gm, '');
const {createIndustrialPrefab, createSourceProductVisual} = new Function('THREE', 'behaviorSchema', 'document', read('IndustrialPrefabs.js').replace(/^export const /gm, 'const ').replace(/^export function /gm, 'function ') + '\nreturn {createIndustrialPrefab,createSourceProductVisual};')(THREE, behaviorSchema, dom);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', read('SceneDocument.js').replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const IndustrialVisuals = new Function('THREE', read('IndustrialVisuals.js').replace('export default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE);
const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 0.00001, label || `${actual} != ${expected}`);
function bounds(object) { object.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(object); }

async function run() {
  const queue = createIndustrialPrefab('palletQueue'), marker = queue.children[0], wood = marker.children[0], panel = queue.children[1];
  const config = queue.userData.editorDefaultBehaviors.find(row => row.type === 'palletQueue');
  assert.equal(config.capacity, 48); assert.equal(config.running, true); assert.equal(config.paused, false);
  close(bounds(queue).min.y, -1); close(bounds(marker).min.y, -1);
  assert(Math.abs(bounds(marker).max.y + 0.85) <= 0.002, 'Nails may protrude at most two millimetres above the physical wood deck.');
  const size = bounds(marker).getSize(new THREE.Vector3()); close(size.x, 1.2); close(size.z, 1.05);
  assert.deepEqual(marker.scale.toArray(), [1, 1, 1], 'Physical slot metadata is expressed on an unscaled marker.');
  assert.deepEqual(marker.userData.industrialPallet, {width: 1.2, depth: 1.05, columns: 4, rows: 3, layers: 4, capacity: 48, top: 0.15});
  assert(!wood.userData.industrialPallet, 'Only the unscaled holder supplies physical slot coordinates.');
  assert.equal(queue.userData.industrialPalletQueue.top, -0.85);
  assert.equal(queue.userData.industrialPalletQueue.slots.length, 48);
  assert(!queue.getObjectByName('Mesa de próxima carga'));
  assert(!queue.children.some(node => node.userData.editorPrefabKey === 'product'), 'The new equipment starts empty.');
  let meshes = 0, triangles = 0;
  queue.traverse(node => { if (node.isMesh) { meshes++; triangles += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3; } });
  assert(meshes < 40 && triangles < 7000, 'Wood details and four controls must retain a small rendering budget.');
  const controls = panel.children.filter(node => node.userData.editorPrefabKey === 'control');
  assert.deepEqual(controls.map(node => node.userData.industrialAction), ['start', 'stop', 'pause', 'dispatch']);
  const inverse = new THREE.Matrix4().getInverse(panel.matrixWorld);
  const cabinet = bounds(panel.children[0]).applyMatrix4(inverse);
  panel.traverse(node => {
    if (!node.isMesh || !(node.name.startsWith('Identificaci') || node.parent.userData.industrialAction)) return;
    if (node.geometry.type !== 'PlaneBufferGeometry') return;
    const box = bounds(node).applyMatrix4(inverse);
    assert(box.min.x >= cabinet.min.x + 0.02 && box.max.x <= cabinet.max.x - 0.02 &&
      box.min.y >= cabinet.min.y + 0.02 && box.max.y <= cabinet.max.y - 0.02,
    'Every control caption and header stays inside the cabinet with a visible border.');
  });
  const privateWoodMaterial = wood.children.find(mesh => mesh.material.map).material;
  assert(privateWoodMaterial.roughness > 0.8);
  const other = createIndustrialPrefab('palletQueue');
  assert.notEqual(other.children[0].children[0].children.find(mesh => mesh.material.map).material.map, privateWoodMaterial.map);
  const updated = Object.assign({}, config, {width: 2.4, depth: 1.8, columns: 6, rows: 4, layers: 4, capacity: 96});
  assert(createIndustrialPrefab.refresh(queue, updated));
  assert.equal(queue.children[0], marker); assert.equal(queue.children[1], panel); assert.equal(marker.children[0], wood);
  assert.equal(wood.children.find(mesh => mesh.material.map).material, privateWoodMaterial, 'Resizing never replaces or discards authored wood materials.');
  const resized = bounds(marker).getSize(new THREE.Vector3()); close(resized.x, 2.4); close(resized.z, 1.8); close(bounds(marker).min.y, -1);
  assert.equal(queue.userData.industrialPalletQueue.slots.length, 96); assert.equal(createIndustrialPrefab.refresh(queue, updated), false);
  panel.position.x += 0.23; const authoredPanelX = panel.position.x;
  createIndustrialPrefab.refresh(queue, Object.assign({}, updated, {width: 3})); close(panel.position.x, authoredPanelX, 'A manually positioned panel stays authored.');
  const loadedPallet = createSourceProductVisual({id: 'box', name: 'Carga', type: 'box', width: 0.25, height: 0.25, depth: 0.25, color: '#b78b53'},
    {loadMode: 'pallet', palletColumns: 2, palletRows: 2, palletLayers: 1});
  assert.equal(loadedPallet.userData.sourceProduct.units, 4, 'Removing built-in outlet pallets must preserve Source-generated pallet loads.');
  assert(bounds(loadedPallet).getSize(new THREE.Vector3()).y > 0.39);

  const document = new SceneDocument({}), root = new THREE.Group(); document.registerRoom('hall', root); document.registerRoom('empty', new THREE.Group());
  const first = document.addPrefab('hall', 'palletQueue'), second = document.addPrefab('hall', 'palletQueue'), belt = document.addPrefab('hall', 'conveyor');
  const copied = await document.duplicate(first), copiedEntry = document.additions.get(copied.userData.editorId);
  copiedEntry.nodes.forEach(node => document.getBehaviors(node).filter(row => row.type === 'control').forEach(row => assert.equal(row.targetId, copied.userData.editorId)));
  assert.equal(copiedEntry.nodes.size, 4);
  const firstState = {enabled: true, running: true, paused: false, queued: 24, queuedUnits: 48, capacity: 48, occupancy: 50, received: 30, receivedUnits: 60, delivered: 6, deliveredUnits: 12};
  const secondState = Object.assign({}, firstState, {queued: 48, queuedUnits: 48, occupancy: 100, full: true, received: 48, receivedUnits: 48, delivered: 0, deliveredUnits: 0});
  const beltState = {powered: true, enabled: true, running: true, paused: false, actualSpeed: 0.4, speed: 0.4, externalSupply: true};
  const records = new Map([[first.userData.editorId, {variables: firstState}], [second.userData.editorId, {variables: secondState}],
    [copied.userData.editorId, {variables: Object.assign({}, firstState, {queued: 0, queuedUnits: 0, occupancy: 0})}], [belt.userData.editorId, {variables: beltState}]]);
  const feedback = new Map(), visuals = new IndustrialVisuals({document: dom}, document, {running: true, records, getControlFeedback: id => feedback.get(id)});
  const saved = await document.serialize(); root.updateMatrixWorld(true); visuals.sync('hall', 0.2, false);
  const screen = object => Array.from(visuals.displays.values()).find(entry => entry.conveyor.object === object);
  const text = object => screen(object).canvas.text.join('\n');
  assert.match(text(first), /24 \/ 48/); assert.match(text(first), /OCUPACIÓN 50\.0%/); assert(!text(first).includes('ESTIBA LLENA'));
  assert.match(text(second), /ESTIBA LLENA/); assert.match(text(second), /48 \/ 48/);
  assert.match(text(belt), /ALIMENTACIÓN/); assert.match(text(belt), /EXTERNA/); assert(!screen(belt).canvas.text.includes('PALLET'));
  const paints = screen(first).canvas.paints;
  for (let frame = 0; frame < 90; frame++) visuals.sync('hall', 1 / 60, false);
  assert.equal(screen(first).canvas.paints, paints);
  firstState.paused = true; visuals.sync('hall', 0.2, false); assert.match(text(first), /EN PAUSA/);
  const button = visuals.bindings.find(binding => binding.kind === 'button' && binding.action === 'dispatch' && binding.conveyor.object === first);
  const cap = visuals.buttons.get(button.entry.object), rest = cap.rest.z;
  feedback.set(button.owner.id, {sequence: 1, pressed: true, hovered: true}); visuals.sync('hall', 0.1, false); assert(cap.object.position.z < rest - 0.01);
  visuals.dispose(); close(cap.object.position.z, rest);
  assert.deepEqual(await document.serialize(), saved, 'Stock indicators and physical feedback never become authored edits.');
  const reopened = new SceneDocument({}); reopened.registerRoom('hall', new THREE.Group()); reopened.registerRoom('empty', new THREE.Group()); await reopened.load(saved);
  assert.deepEqual(await reopened.serialize(), saved, 'The equipment, independent controls and references survive the document roundtrip.');
  console.log('Pallet Queue visuals: ground-level wood, exact slots, independent editable controls, stable resizing, loaded Source pallets, bounded geometry and isolated stock HMI passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
