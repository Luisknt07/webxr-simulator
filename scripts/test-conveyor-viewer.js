/* Production model/document/runtime/visual feedback/collision code with only
 * DOM, OrbitControls and WebGL boundaries adapted. This does not render pixels
 * or establish performance or physical-headset compatibility. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const schema = require('../shared/behaviors');
const automationSchema = require('../shared/automation');
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.style = {}; this.value = ''; this.clientWidth = 800; this.clientHeight = 500; this.width = 800; this.height = 500; }
  set textContent(value) { this.text = String(value); this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  get isConnected() { for (let node = this; node; node = node.parentNode) if (node === dom.body) return true; return false; }
  appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, target) { this.appendChild(child); this.children.splice(this.children.indexOf(child), 1); this.children.splice(Math.max(0, this.children.indexOf(target)), 0, child); }
  removeChild(child) { this.children = this.children.filter(value => value !== child); child.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(key, action) { (this.listeners[key] || (this.listeners[key] = new Set())).add(action); }
  removeEventListener(key, action) { if (this.listeners[key]) this.listeners[key].delete(action); }
  fire(key, event = {}) { return Promise.all(Array.from(this.listeners[key] || []).map(action => action(Object.assign({target: this, preventDefault() {}, stopPropagation() {}}, event)))); }
  focus() { dom.activeElement = this; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  getBoundingClientRect() { return {left: 0, top: 0, width: this.clientWidth, height: this.clientHeight}; }
  querySelectorAll(selector) {
    const matches = node => selector.split(',').some(value => value === 'button' && node.tagName === 'BUTTON' || value === 'input' && node.tagName === 'INPUT' || value === 'select' && node.tagName === 'SELECT' || value === 'a[href]' && node.tagName === 'A' || value === '[tabindex="0"]' && node.tabIndex === 0 || value === '[data-live="phase"]' && node.dataset.live === 'phase');
    return this.children.flatMap(child => (matches(child) ? [child] : []).concat(child.querySelectorAll(selector)));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getContext() { if (!this.context) this.context = new Proxy({measureText: value => ({width: String(value).length * 10}), createLinearGradient: () => ({addColorStop() {}})}, {get: (object, key) => key in object ? object[key] : () => {}}); return this.context; }
  toDataURL() { return 'data:image/png;base64,YWQ='; }
}
const dom = new Element('document'); dom.body = new Element('body'); dom.activeElement = dom.body; dom.createElement = tag => new Element(tag); dom.createTextNode = text => { const value = new Element('text'); value.textContent = text; return value; }; dom.hidden = false;
const win = new Element('window'); win.devicePixelRatio = 1;
function code(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const cargo = require('./load-product-prefabs.js')(THREE);
const prefabs = new Function('THREE', 'behaviorSchema', 'document', 'require', code('src/editor/IndustrialPrefabs.js') + '\nreturn {createIndustrialPrefab,createProductVisual,createSourceProductVisual};')(THREE, schema, dom, id => { assert.equal(id, './ProductPrefabs.js'); return cargo; });
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', code('src/editor/SceneDocument.js').replace('default class SceneDocument', 'return class SceneDocument'))(THREE, schema, prefabs.createIndustrialPrefab);
const ConveyorAssembly = new Function('THREE', 'conveyorLayout', code('src/editor/ConveyorAssembly.js').replace('default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, schema.conveyorLayout);
const {conveyorExamples, buildConveyorExample} = new Function('THREE', 'ConveyorAssembly', code('src/editor/ConveyorExamples.js') + '\nreturn {conveyorExamples,buildConveyorExample};')(THREE, ConveyorAssembly);
const ProductFeedback = new Function('THREE', code('src/editor/ProductFeedback.js').replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const ObjectPlacement = require('./load-object-placement')(THREE);
const ProductSourceRuntime = require('./load-product-source-runtime')(THREE, schema);
const ProcessorRuntime = require('./load-processor-runtime')(THREE, schema);
const PalletQueueRuntime = require('./load-pallet-queue-runtime')(THREE, schema);
const SimulationRuntime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', code('src/editor/SimulationRuntime.js').replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, schema, automationSchema, prefabs.createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const IndustrialVisuals = new Function('THREE', 'RollerInstanceBatches', 'document', code('src/editor/IndustrialVisuals.js').replace('default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE, require('./load-roller-instance-batches')(THREE), dom);
const {getGeometryTree} = require('./load-geometry-acceleration')(THREE);
const CollisionWorld = new Function('THREE', 'getGeometryTree', code('src/lib/CollisionWorld.js').replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const EquipmentPlacement = new Function('THREE', code('src/editor/EquipmentPlacement.js').replace('default class EquipmentPlacement', 'return class EquipmentPlacement'))(THREE);
const Viewer = new Function('THREE', 'schema', 'document', 'window', 'SceneDocument', 'SimulationRuntime', 'IndustrialVisuals', 'createSourceProductVisual', 'CollisionWorld', 'ConveyorAssembly', 'conveyorExamples', 'buildConveyorExample', code('src/editor/ConveyorViewer.js').replace('default class ConveyorViewer', 'return class ConveyorViewer'))(THREE, schema, dom, win, SceneDocument, SimulationRuntime, IndustrialVisuals, prefabs.createSourceProductVisual, CollisionWorld, ConveyorAssembly, conveyorExamples, buildConveyorExample);
class Renderer {
  constructor() { this.domElement = new Element('canvas'); this.ratio = 1; this.frames = 0; this.capabilities = {getMaxAnisotropy: () => 4}; }
  getPixelRatio() { return this.ratio; } setPixelRatio(value) { this.ratio = value; }
  setSize(width, height) { this.domElement.width = Math.floor(width * this.ratio); this.domElement.height = Math.floor(height * this.ratio); }
  render(scene, camera) { assert(scene.isScene && camera.isCamera); this.frames++; }
  dispose() { this.disposed = true; } forceContextLoss() { this.lost = true; }
}
Viewer.prototype.createRenderer = function() { this.renderer = new Renderer(); this.viewport.appendChild(this.renderer.domElement); this.camera = new THREE.PerspectiveCamera(38, 1.6, .02, 250); this.orbit = {target: new THREE.Vector3(), update: () => { this.camera.lookAt(this.orbit.target); this.camera.updateMatrixWorld(true); }, dispose() { this.disposed = true; }}; };
function editorFixture(size = 60) {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(size, .05, size), new THREE.MeshBasicMaterial()); floor.name = 'Suelo'; floor.position.y = -.025; root.add(floor);
  const document = new SceneDocument({}); document.registerRoom('hall', root);
  const notices = [], editor = {active: true, ctx: {scene, vrMode: false}, roomId: 'hall', root, document, orbit: {target: new THREE.Vector3(0, 1, 0)}, camera: new THREE.PerspectiveCamera(), transform: {dragging: false}, toast: value => notices.push(value), select(object) { this.selected = object; }, async perform(action) { return action(); }};
  editor.collisionWorld = new CollisionWorld(editor.ctx, document); editor.collisionWorld.setRoom('hall'); editor.equipmentPlacement = new EquipmentPlacement(editor);
  editor.createPlacedObject = create => { document.begin(); try { const object = create(); editor.equipmentPlacement.place(object, editor.orbit.target); document.commit(); editor.select(object); return object; } catch (error) { document.cancel(); throw error; } };
  return {editor, notices};
}
async function run() {
  const f = editorFixture(), viewer = new Viewer(f.editor), original = await f.editor.document.serialize();
  assert(viewer.open({equipmentId: 'conveyor.roller-motor'}));
  assert.equal(await f.editor.document.serialize().then(JSON.stringify), JSON.stringify(original), 'An isolated exploration never edits the active project.');
  assert.equal(viewer.content.querySelectorAll('button').length, viewer.partButtons.size, 'Rendered part thumbnails update existing cards without duplicates.');
  for (const entry of viewer.partButtons.values()) { assert(viewer.partNodes(entry.part).length); viewer.selectPart(entry.part); assert(viewer.highlight.box.isEmpty() === false); assert(viewer.partCaption.textContent.includes(entry.part.name)); }
  viewer.tab = 'Controles'; viewer.renderTab();
  const buttons = viewer.content.querySelectorAll('button').filter(value => value.dataset.action);
  assert.equal(buttons.length, 9, 'The contextual control pad preserves all nine existing panel actions.');
  const press = async action => { const value = buttons.find(button => button.dataset.action === action); assert(value, action); await value.fire('click'); };
  await press('powerOff'); assert.equal(viewer.variables().powered, false);
  await press('powerOn'); assert.equal(viewer.variables().powered, true); assert.equal(viewer.variables().running, false);
  await press('start'); assert.equal(viewer.variables().running, true);
  await press('pause'); assert.equal(viewer.variables().paused, true); await press('pause'); assert.equal(viewer.variables().paused, false);
  const speed = viewer.variables().speed; await press('speedUp'); assert(viewer.variables().speed > speed); await press('speedDown'); assert.equal(viewer.variables().speed, speed);
  await press('stop'); assert.equal(viewer.variables().running, false);
  await press('emergency'); assert.equal(viewer.variables().emergency, true); await press('emergency'); assert.equal(viewer.variables().emergency, false); assert.equal(viewer.variables().running, false);
  assert(viewer.command('start')); assert(viewer.variables().running);
  await press(buttons.some(button => button.dataset.action === 'insertBox') ? 'insertBox' : 'insert'); assert.equal(viewer.variables().pendingInsert, 1, 'The Insertar caja control delegates to the production insertion command.');
  viewer.advance(.1); assert.equal(viewer.simulation.products.size, 1);
  assert.equal(viewer.addProfile(), false, 'A second load cannot overlap the occupied input.');
  viewer.command('emergency'); viewer.command('emergency'); assert.equal(viewer.variables().running, false, 'Releasing emergency requires a separate Marcha.');
  viewer.command('start'); const time = viewer.simulation.time;
  for (let frame = 0; frame < 20; frame++) viewer.tick(1 / 30);
  assert.equal(viewer.simulation.time, time, 'Animating a button with the clock paused never advances transport.');
  assert(Array.from(viewer.simulation.controlFeedback.values()).every(value => value.until === 0));
  viewer.definition = schema.conveyorEquipment.getDefinition('pallet-chain'); viewer.overrides = {}; viewer.load(); viewer.profileId = 'pallet';
  assert(viewer.addProfile(), 'A compatible pallet is generated by the real loaded-pallet factory.');
  const pallet = Array.from(viewer.simulation.products.values())[0], metadata = viewer.simulation.productMetadata(pallet);
  assert.equal(metadata.loadMode, 'pallet'); assert.equal(metadata.base, 'runners'); assert.equal(metadata.mass, 120);
  assert(Math.abs(metadata.width - .8) < 1e-6 && Math.abs(metadata.depth - 1.2) < 1e-6 && Math.abs(metadata.height - .65) < 1e-6);
  assert.equal(pallet.sourceEntry.load.loadMode, 'pallet'); assert(pallet.object.userData.sourceProduct.loadMode === 'pallet');
  const beforeRejected = viewer.simulation.products.size; viewer.profileId = 'box-small'; assert.equal(viewer.addProfile(), false); assert.equal(viewer.simulation.products.size, beforeRejected);
  viewer.exampleId = 'line-l'; viewer.scope = 'segment'; viewer.load(); viewer.tab = 'Controles'; viewer.renderTab();
  assert(viewer.scopeSummary.textContent.includes(viewer.machines[2].name)); viewer.command('start');
  assert(viewer.machines.every(object => viewer.simulation.records.get(object.userData.editorId).variables.running), 'A segment command reaches exactly the displayed members.');
  const renderer = viewer.renderer, orbit = viewer.orbit; viewer.close(); assert(renderer.disposed && renderer.lost && orbit.disposed); assert.equal(viewer.simulation, null); assert.equal(viewer.context, null);
  assert.deepEqual(await f.editor.document.serialize(), original);
  const existing = f.editor.document.addPrefab('hall', 'conveyor', 'roller-motor');
  f.editor.document.setBehaviors(existing, f.editor.document.getBehaviors(existing).map(value => value.type === 'conveyor' ? Object.assign({}, value, {length: 5.5, width: .8, withSensors: false, outputId: 'custom-unloaded'}) : value));
  const authored = await f.editor.document.serialize();
  viewer.open({equipmentId: 'conveyor.roller-motor', objectId: existing.userData.editorId});
  assert.equal(viewer.config.length, 5.5); assert.equal(viewer.config.width, .8); assert.equal(viewer.config.withSensors, false); assert.equal(viewer.config.outputId, '', 'An isolated viewer cannot refer into the active project graph.');
  viewer.close(); assert.deepEqual(await f.editor.document.serialize(), authored, 'Exploring an instance preserves its dimensions, references and saved state.');
  f.editor.document.remove(existing);
  viewer.open({example: 'line-l'}); await viewer.insertIntoScene();
  const graph = f.editor.document.studio.groups[0]; assert.equal(graph.roomId, 'hall'); assert.equal(graph.members.length, 3); assert.equal(f.editor.root.children.filter(object => object.name === 'Ubicación temporal de línea').length, 0);
  const saved = await f.editor.document.serialize(), assembly = new ConveyorAssembly({document: f.editor.document, roomId: 'hall', root: f.editor.root, ctx: f.editor.ctx, hooks: {renderScene: f.editor.ctx.scene}});
  assembly.edges().forEach(edge => assert(assembly.assessConnection(edge.source, edge.sourcePort, edge.target, edge.targetPort).ready));
  const previous = graph.members.map(id => new THREE.Box3().setFromObject(f.editor.document.getObject(id)));
  viewer.open({example: 'straight'}); await viewer.insertIntoScene();
  const latest = f.editor.document.studio.groups[1]; latest.members.forEach(id => { const bounds = new THREE.Box3().setFromObject(f.editor.document.getObject(id)); previous.forEach(box => assert(!bounds.intersectsBox(box), 'Whole-line placement must avoid existing equipment.')); });
  assert(saved.rooms.hall.additions.length < (await f.editor.document.serialize()).rooms.hall.additions.length);
  const small = editorFixture(.2), rejected = new Viewer(small.editor); rejected.open({example: 'rectangle'});
  await assert.rejects(() => rejected.insertIntoScene(), /espacio|piso|suelo|ubicación/i); assert.equal(small.editor.document.additions.size, 0, 'A line without support space leaves no fragments.'); assert.equal(small.editor.root.children.length, 1);
  rejected.dispose(); viewer.dispose(); assert.equal(dom.listeners.keydown.size, 0); assert.equal(win.listeners.pagehide.size, 0);
  console.log('Conveyor viewer: real runtime controls, scoped members, emergency, paused button feedback, collision-safe products and pallets, real parts, isolated cleanup and floor-safe atomic line insertion passed (DOM/WebGL adapters).');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
