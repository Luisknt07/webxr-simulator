// Processor geometry and cosmetic feedback use real Three.js; canvas is adapted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');
const dom = {createElement() {
  const canvas = {width: 0, height: 0, text: [], paints: 0};
  const context = {fillRect(x, y, w, h) { if (!x && !y && w === canvas.width && h === canvas.height) { canvas.text = []; canvas.paints++; } }, fillText(value) { canvas.text.push(String(value)); }};
  canvas.getContext = () => context; return canvas;
}};
const read = file => fs.readFileSync(path.join(__dirname, '../src/editor', file), 'utf8').replace(/^import .*;\r?\n/gm, '');
const createIndustrialPrefab = new Function('THREE', 'behaviorSchema', 'document', read('IndustrialPrefabs.js').replace(/^export const /gm, 'const ').replace(/^export function /gm, 'function ') + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema, dom);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', read('SceneDocument.js').replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
const IndustrialVisuals = new Function('THREE', 'RollerInstanceBatches', read('IndustrialVisuals.js').replace('export default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE, require('./load-roller-instance-batches')(THREE));
const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 0.00001, label || `${actual} != ${expected}`);

async function run() {
  for (const variant of [undefined, 'combiner', 'separator']) {
    const object = createIndustrialPrefab('processor', variant), config = object.userData.editorDefaultBehaviors.find(row => row.type === 'processor');
    assert.equal(config.mode, variant || 'process');
    assert.equal(config.running, false); assert.equal(config.powered, false);
    object.updateMatrixWorld(true);
    close(new THREE.Box3().setFromObject(object).min.y, -1, 'The machine, feet and its panel must rest on the same floor as conveyors.');
    assert.deepEqual(object.userData.industrialProcessor.inputPosition, [-1.15, 0, 0]);
    assert.deepEqual(object.userData.industrialProcessor.outputPosition, [1.15, 0, 0]);
    let meshes = 0, triangles = 0;
    object.traverse(node => { if (node.isMesh) { meshes++; triangles += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3; } });
    assert(meshes < 100, 'Static details must not create hundreds of draw calls.'); assert(triangles < 12000);
    const panel = object.children[2], head = object.children[3], controls = panel.children.filter(node => node.userData.editorPrefabKey === 'control');
    assert.deepEqual(controls.map(node => node.userData.industrialAction), ['start', 'stop', 'emergency', 'pause', 'powerOff', 'powerOn', 'operator', 'dispatch', 'resetEmergency']);
    assert(head.userData.industrialProcessorHead);
    assert(createIndustrialPrefab.refresh(object, Object.assign({}, config, {length: 5, width: 2.2})));
    assert.equal(object.children[2], panel); assert.equal(object.children[3], head);
    controls.forEach(control => assert.equal(control.parent, panel));
    assert.equal(object.userData.industrialProcessor.length, 5); assert.equal(object.userData.industrialProcessor.width, 2.2);
    assert.equal(createIndustrialPrefab.refresh(object, Object.assign({}, config, {length: 5, width: 2.2})), false);
  }
  const document = new SceneDocument({}), root = new THREE.Group(); document.registerRoom('hall', root); document.registerRoom('empty', new THREE.Group());
  const first = document.addPrefab('hall', 'processor'), second = document.addPrefab('hall', 'processor', 'combiner');
  const firstState = {enabled: true, powered: true, running: true, paused: false, emergency: false, state: 'PROCESSING', busy: true,
    progress: 50, utilization: 62.5, queued: 3, queuedUnits: 3, capacity: 8, activeJobs: 1, parallelism: 1, outputQueued: 2, outputCapacity: 8,
    entryCount: 19, exitCount: 12, receivedUnits: 19, deliveredUnits: 12, completed: 15, completedUnits: 15,
    setupSeconds: 4, processSeconds: 50, idleSeconds: 20, blockedSeconds: 3, operatorWaitSeconds: 2, downSeconds: 1, nominalCapacity: 12, operatorAvailable: true};
  const secondState = Object.assign({}, firstState, {state: 'WAITING_OPERATOR', busy: false, waitingOperator: true, progress: 0, entryCount: 6, operatorAvailable: false});
  const feedback = new Map(), records = new Map([[first.userData.editorId, {variables: firstState}], [second.userData.editorId, {variables: secondState}]]);
  const visuals = new IndustrialVisuals({document: dom}, document, {running: true, records, getControlFeedback: id => feedback.get(id)});
  root.updateMatrixWorld(true); const before = await document.serialize(); visuals.sync('hall', 0.2, false);
  assert.equal(visuals.displays.size, 2); assert.equal(visuals.processorHeads.size, 2);
  const screens = Array.from(visuals.displays.values()), firstScreen = screens.find(entry => entry.conveyor.object === first), secondScreen = screens.find(entry => entry.conveyor.object === second);
  const text = entry => entry.canvas.text.join('\n');
  assert.match(text(firstScreen), /PROCESANDO/); assert.match(text(firstScreen), /62\.5%/); assert.match(text(firstScreen), /50%/);
  assert.match(text(firstScreen), /PREPARACIÓN  00:00:04/); assert.match(text(firstScreen), /CAP\. NOMINAL 12\.0/);
  assert.match(text(secondScreen), /ESPERA OPERARIO/); assert.match(text(secondScreen), /COMBINER/); assert(!text(firstScreen).includes('ESPERA OPERARIO'));
  const firstHead = Array.from(visuals.processorHeads.values()).find(entry => entry.processor.object === first);
  const secondHead = Array.from(visuals.processorHeads.values()).find(entry => entry.processor.object === second);
  close(firstHead.object.position.y, firstHead.rest.y - 0.11); close(secondHead.object.position.y, secondHead.rest.y);
  const operator = visuals.bindings.find(binding => binding.kind === 'button' && binding.action === 'operator' && binding.conveyor.object === first);
  assert(operator.entry.privateMaterials[0].emissiveIntensity > 0.5, 'The physical operator button reflects this machine’s availability.');
  const cap = visuals.buttons.get(operator.entry.object); const rest = cap.rest.clone();
  feedback.set(operator.owner.id, {sequence: 1, pressed: true, hovered: true}); visuals.sync('hall', 0.1, false);
  assert(cap.object.position.z < rest.z - 0.01, 'Processor controls retain the native press/depress stroke.');
  feedback.set(operator.owner.id, {sequence: 1, pressed: false, hovered: false});
  for (let index = 0; index < 20; index++) visuals.sync('hall', 0.05, false);
  close(cap.object.position.z, rest.z);
  const paintCount = firstScreen.canvas.paints;
  for (let frame = 0; frame < 120; frame++) visuals.sync('hall', 1 / 60, false);
  assert.equal(firstScreen.canvas.paints, paintCount, 'Unchanged metrics must not repaint the dashboard every frame.');
  firstState.state = 'BLOCKED'; firstState.busy = false; firstState.blocked = true; visuals.sync('hall', 0.2, false);
  assert.match(text(firstScreen), /SALIDA BLOQUEADA/); close(firstHead.object.position.y, firstHead.rest.y);
  firstState.state = 'PROCESSING'; firstState.busy = true; firstState.blocked = false; visuals.sync('hall', 0.2, false);
  close(firstHead.object.position.y, firstHead.rest.y - 0.11);
  Object.assign(firstState, {state: 'SETUP', settingUp: true, setupProgress: 60, setupRemaining: 0.3, processTime: 1.5, setupTime: 0.8});
  visuals.sync('hall', 0.2, false);
  assert.match(text(firstScreen), /60%/); assert.match(text(firstScreen), /CICLO 1\.5 s/); assert.match(text(firstScreen), /PREPARACIÓN 0\.8 s/);
  assert.match(text(firstScreen), /0\.3 s restantes de setup/); close(firstHead.object.position.y, firstHead.rest.y);
  visuals.sync('hall', 0.2, true); close(firstHead.object.position.y, firstHead.rest.y);
  assert.deepEqual(await document.serialize(), before, 'Cosmetic head movement, status lamps and dashboard must never become authored changes.');
  visuals.sync('empty', 0.2, false); assert.equal(visuals.processorHeads.size, 0); assert.equal(visuals.displays.size, 0);
  visuals.dispose();
  console.log('Processor visuals: floor/ports, three modes, stable component paths, bounded geometry, isolated machine metrics, operator lights, pushbutton stroke and cosmetic lifecycle passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
