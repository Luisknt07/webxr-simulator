const __layout = require("../../tooling/layout.cjs");
// Exercise real inspector handlers, TransformControls events and StudioTools
// against the physical port solver. Persistence stays in the editor test adapter.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const schema = require('../../modules/logistica-industrial/contracts/behaviors');
const {validateDocument} = require('../../apps/api/server/validation');
const editorTest = __layout.map(path.join(__layout.oldDir("scripts/test-editor-connection-reflow.js"), 'test-editor-runtime.js'));
const editorSource = fs.readFileSync(editorTest, 'utf8');
const {harness, THREE, dom, browserWindow, storage, remote} = new Function('require', '__dirname',
  editorSource.slice(0, editorSource.indexOf('async function run()')) +
  '\nreturn {harness, THREE, dom, browserWindow, storage, remote};')(createRequire(editorTest), __dirname);
const StudioTools = new Function('THREE', 'schema', 'window', 'document', fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-editor-connection-reflow.js"),
  '../src/studio/StudioTools.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class StudioTools', 'return class StudioTools'))(THREE, schema, browserWindow, dom);
const all = element => [element].concat(element.children.flatMap(all));
const clone = value => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const id = object => object.userData.editorId;
const pose = object => ({position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray()});
const near = (a, b, message) => assert(Math.abs(a - b) < 1e-6, message + ': ' + a + ' / ' + b);

async function fixture() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const result = harness(); const {editor} = result; await editor.ready; editor.enter();
  const tools = new StudioTools(editor), document = editor.document, assembly = editor.assembly;
  const config = object => assembly.config(object);
  const add = (kind = 'conveyor', variant = 'roller-motor', changes = {}) => {
    const object = document.addPrefab('hall', kind, kind === 'conveyor' ? variant : undefined);
    document.setBehaviors(object, document.getBehaviors(object).map(value => value.type === kind ?
      Object.assign({}, value, {withPanel: false, withSensors: false, autoSpawn: false}, changes) : value));
    document.setTransform(object, {position: [0, 1, -20]}); return object;
  };
  const connect = (from, to, out = 'output', input = 'input') => {
    document.begin();
    try {
      assembly.align(from, out, to, input);
      const pair = assembly.pair(to, input, from, out);
      assert(pair && assembly.connect(pair), 'Fixture uses real compatible interfaces.'); document.commit();
    } catch (error) { document.cancel(); throw error; }
  };
  const joined = () => assembly.edges().forEach(edge => {
    const out = assembly.worldPort(edge.source, edge.sourcePort), input = assembly.worldPort(edge.target, edge.targetPort);
    assert(out && input, 'Every saved link retains both physical ports.');
    assert(out.position.distanceTo(input.position) < .0001, 'Edited neighbors remain joined without gaps or intersecting longitudinal decks.');
    assert(out.tangent.dot(input.tangent) > .9999 && out.up.dot(input.up) > .9999, 'Flow and deck orientation agree.');
  });
  const field = (object, key) => {
    editor.select(object); const machine = config(object), definition = schema.definitionFor(machine.type);
    const descriptor = definition.fields.find(value => value.key === key); assert(descriptor, key);
    const equipment = machine.type === 'conveyor' && schema.conveyorLayout.equipment.resolveVariant(machine);
    const parameter = equipment && machine.equipmentId && (equipment.parameters || []).find(value => value.key === key);
    const label = parameter ? parameter.label + (parameter.unit ? ' (' + parameter.unit + ')' : '') : descriptor.label;
    const aria = definition.label + ' · ' + label;
    const input = all(editor.inspector).find(element => element.getAttribute('aria-label') === aria);
    assert(input, 'Inspector exposes ' + machine.type + '.' + key); return input;
  };
  const change = async (object, key, value) => {
    const input = field(object, key); input.value = value; await input.fire('change'); await settle();
  };
  const drag = value => { editor.transform.dragging = value; editor.transform.dispatchEvent({type: 'dragging-changed', value}); };
  const close = () => { editor.projectSync.stop(); editor.clearAssembly(true); };
  return Object.assign(result, {tools, document, assembly, config, add, connect, joined, field, change, drag, close});
}

function line(f) {
  const source = f.add('source'), first = f.add(), curve = f.add('conveyor', 'roller-curve', {radius: .7}),
    tail = f.add(), processor = f.add('processor'), stock = f.add('palletQueue'), outsider = f.add();
  f.connect(source, first); f.connect(first, curve); f.connect(curve, tail); f.connect(tail, processor); f.connect(processor, stock);
  f.document.setTransform(outsider, {position: [40, 1, 20]});
  return {source, first, curve, tail, processor, stock, outsider};
}

async function assertSingleUndo(f, action, verify) {
  const before = await f.document.serialize(), depth = f.document.undoStack.length;
  await action(); f.joined(); if (verify) verify();
  assert.equal(f.document.transaction, null); assert.equal(f.document.undoStack.length, depth + 1,
    'A UI edit and every neighbor adjustment create one undo action.');
  const after = await f.document.serialize(); assert.notDeepEqual(after, before);
  await f.editor.perform(() => f.editor.historyStep('undo')); await settle();
  assert.deepEqual(await f.document.serialize(), before, 'Undo restores geometry, poses and links together.');
  await f.editor.perform(() => f.editor.historyStep('redo')); await settle();
  assert.deepEqual(await f.document.serialize(), after, 'Redo restores the exact connected result.'); f.joined();
}

async function run() {
  {
    const f = await fixture(), parts = line(f), {source, first, curve, processor, stock, outsider} = parts;
    const sourcePose = pose(source), untouched = pose(outsider), inlet = f.assembly.worldPort(first, 'input').position.clone();
    const productSettings = clone([f.config(source), f.config(processor), f.config(stock)]);
    await assertSingleUndo(f, () => f.change(first, 'length', 6.3), () => {
      near(f.config(first).length, 6.3, 'Inspector changes the authored length');
      assert.deepEqual(pose(source), sourcePose, 'The fixed predecessor remains in place.');
      assert(f.assembly.worldPort(first, 'input').position.distanceTo(inlet) < 1e-6);
      assert.deepEqual(pose(outsider), untouched, 'Disconnected equipment remains untouched.');
    });
    await assertSingleUndo(f, () => f.change(curve, 'radius', 1.8));
    await assertSingleUndo(f, () => f.change(first, 'width', 1.5), () => {
      for (const object of [first, curve, parts.tail]) near(f.config(object).width, 1.5, 'Connected conveyor widths adapt');
      assert.deepEqual([f.config(source), f.config(processor), f.config(stock)], productSettings,
        'Changing a conveyor width does not scale the source products, process chamber or pallet capacity.');
      assert.deepEqual(pose(outsider), untouched);
    });
    await assertSingleUndo(f, () => f.change(processor, 'length', 4.1), () => near(f.config(processor).length, 4.1, 'Processor UI uses the same connection transaction'));
    const beforeHeight = await f.document.serialize(), depth = f.document.undoStack.length, messages = [];
    f.editor.toast = message => messages.push(message);
    await f.change(first, 'supportHeight', 1.3);
    assert.deepEqual(await f.document.serialize(), beforeHeight,
      'An unsupported support-height change cannot bury connected machine feet or leave floating neighbors.');
    assert.equal(f.document.undoStack.length, depth); assert.equal(f.document.transaction, null);
    assert(messages.some(message => /piso|apoyos|altura/i.test(message)), 'The height conflict explains the physical support requirement.');
    f.close();
  }
  {
    const f = await fixture(), parts = line(f), {source, first, outsider} = parts;
    const inlet = f.assembly.worldPort(first, 'input').position.clone(), fixed = pose(source), untouched = pose(outsider);
    f.editor.select(first);
    await assertSingleUndo(f, async () => {
      const input = f.editor.transformInputs.scale[0]; input.value = 1.35; await input.fire('change'); await settle();
    }, () => {
      near(first.scale.x, 1.35, 'Numeric scale is retained');
      assert(f.assembly.worldPort(first, 'input').position.distanceTo(inlet) < 1e-6, 'Scaling preserves the connected inlet.');
      assert.deepEqual(pose(source), fixed); assert.deepEqual(pose(outsider), untouched);
    });
    f.editor.select(first); f.editor.setTool('scale');
    await assertSingleUndo(f, async () => {
      f.drag(true); first.scale.x = 1.5; f.editor.transform.dispatchEvent({type: 'objectChange'}); f.joined();
      const preview = Object.values(parts).map(pose);
      f.editor.transform.dispatchEvent({type: 'objectChange'});
      assert.deepEqual(Object.values(parts).map(pose), preview, 'Repeated gizmo frames do not accumulate drift.');
      first.scale.x = 1.75; f.editor.transform.dispatchEvent({type: 'objectChange'}); f.joined();
      f.drag(false); await settle();
    }, () => { near(first.scale.x, 1.75, 'Gizmo retains the requested scale'); assert.deepEqual(pose(source), fixed); assert.deepEqual(pose(outsider), untouched); });
    const before = await f.document.serialize(), depth = f.document.undoStack.length;
    f.editor.select(first); f.editor.setTool('scale'); f.drag(true); first.scale.x = 1.9; f.editor.transform.dispatchEvent({type: 'objectChange'});
    assert(f.editor.cancelTransformDrag()); await settle();
    assert.deepEqual(await f.document.serialize(), before, 'Cancelling a scale restores all connected neighbors.');
    assert.equal(f.document.undoStack.length, depth); assert.equal(f.document.transaction, null);
    f.close();
  }
  {
    const f = await fixture(), source = f.add('source'), first = f.add(), transfer = f.add('conveyor', 'popup-belt',
      {length: 1, width: 1, routing: 'branch'}), out = f.add(), stock = f.add('palletQueue');
    f.connect(source, first); f.connect(first, transfer); f.connect(transfer, out, 'branch'); f.connect(out, stock);
    await assertSingleUndo(f, () => f.change(transfer, 'width', 1.4), () => {
      near(f.config(transfer).length, 1.4, 'The real inspector keeps the compact L transfer square before validation.');
      near(f.config(first).width, 1.4, 'Upstream interface width'); near(f.config(out).width, 1.4, 'Downstream interface width');
    });
    f.close();
  }
  {
    const f = await fixture(), ring = Array.from({length: 4}, () => f.add('conveyor', 'roller-curve', {radius: 1.5}));
    for (let i = 1; i < ring.length; i++) f.connect(ring[i - 1], ring[i]);
    f.document.begin(); assert(f.assembly.connect(f.assembly.pair(ring[0], 'input', ring[3], 'output'))); f.document.commit(); f.joined();
    const before = await f.document.serialize(), depth = f.document.undoStack.length, messages = [];
    f.editor.toast = message => messages.push(message);
    await f.change(ring[1], 'radius', 2);
    assert.deepEqual(await f.document.serialize(), before, 'An impossible closed-loop dimension edit rolls back through the actual inspector.');
    assert.equal(f.document.undoStack.length, depth); assert.equal(f.document.transaction, null);
    assert(messages.some(message => /circuito|uniones/i.test(message)), 'The editor reports why a closed circuit cannot accommodate that edit.');
    f.close();
  }
  {
    const f = await fixture(), {first, outsider} = line(f);
    f.document.setStudio({groups: [{id: 'logical-group', name: 'Two independent objects', roomId: 'hall', members: [id(first), id(outsider)]}]});
    const untouched = pose(outsider); f.editor.select(first); f.editor.setTool('scale');
    const inlet = f.assembly.worldPort(first, 'input').position.clone();
    await assertSingleUndo(f, async () => { f.drag(true); first.scale.x = 1.3; f.editor.transform.dispatchEvent({type: 'objectChange'}); f.drag(false); await settle(); }, () => {
      assert.deepEqual(pose(outsider), untouched, 'A single equipment scale does not transform an implicit metadata group.');
      assert(f.assembly.worldPort(first, 'input').position.distanceTo(inlet) < 1e-6);
    });
    f.editor.select(outsider); f.tools.selectObject(first, {shiftKey: true}); assert.equal(f.tools.selection.size, 2);
    await assertSingleUndo(f, async () => {
      const input = f.editor.transformInputs.scale[0]; input.value = 1.4; await input.fire('change'); await settle();
    }, () => {
      near(first.scale.x, 1.4, 'Numeric inputs edit the indicated machine even with a Shift selection.');
      assert.deepEqual(pose(outsider), untouched, 'Numeric inspector input keeps its prior single-object semantics.');
      assert(f.assembly.worldPort(first, 'input').position.distanceTo(inlet) < 1e-6);
    });
    const a = f.add(), b = f.add(); f.document.setTransform(a, {position: [-25, 1, 10]}); f.document.setTransform(b, {position: [-21, 1, 10]});
    f.editor.select(a); f.tools.selectObject(b, {shiftKey: true}); f.editor.setTool('scale');
    const anchor = b, originalA = a.position.clone(), originalB = b.position.clone(), originalScale = a.scale.clone();
    const before = await f.document.serialize(), depth = f.document.undoStack.length;
    f.drag(true); anchor.scale.setScalar(1.25); f.editor.transform.dispatchEvent({type: 'objectChange'}); f.drag(false); await settle();
    assert(a.position.distanceTo(originalA.clone().sub(originalB).multiplyScalar(1.25).add(originalB)) < 1e-6,
      'Explicit multiselection retains its original group transform semantics.');
    assert(a.scale.distanceTo(originalScale.multiplyScalar(1.25)) < 1e-6);
    assert.equal(f.document.undoStack.length, depth + 1); f.document.undo(); assert.deepEqual(await f.document.serialize(), before);
    f.close();
  }
  {
    const f = await fixture(), parts = line(f);
    f.document.setTransform(parts.tail, {position: parts.tail.position.clone().add(new THREE.Vector3(0, 0, 2)).toArray()});
    const saved = await f.document.serialize();
    const reopened = harness(); await reopened.editor.ready;
    const actualPlanner = reopened.editor.assembly.planReflow;
    reopened.editor.assembly.planReflow = () => { throw new Error('Loading must not repair or move authored equipment.'); };
    await reopened.editor.document.load(saved, {activeRoomId: 'hall'}); await reopened.editor.prepareRoom('hall'); reopened.editor.enter(); await settle();
    assert.deepEqual(await reopened.editor.document.serialize(), saved, 'Opening a document preserves authored positions and links exactly.');
    validateDocument(saved, value => value);
    reopened.editor.assembly.planReflow = actualPlanner;
    reopened.editor.select(reopened.editor.document.getObject(id(parts.first)));
    const repair = all(reopened.editor.inspector).find(element => element.tagName === 'BUTTON' && element.textContent.startsWith('Sincronizar'));
    assert(repair && !repair.disabled, 'An explicit action can realign a legacy line after opening it.');
    const depth = reopened.editor.document.undoStack.length;
    await repair.click(); await settle();
    reopened.editor.assembly.edges().forEach(edge => {
      const a = reopened.editor.assembly.worldPort(edge.source, edge.sourcePort), b = reopened.editor.assembly.worldPort(edge.target, edge.targetPort);
      assert(a.position.distanceTo(b.position) < .0001, 'Explicit synchronization closes every old gap.');
    });
    assert.equal(reopened.editor.document.undoStack.length, depth + 1);
    reopened.editor.document.undo(); assert.deepEqual(await reopened.editor.document.serialize(), saved, 'Undo of explicit repair restores the exact original document.');
    reopened.editor.projectSync.stop(); f.close();
  }
  console.log('Editor connection reflow: real inspector dimensions, compact L width, numeric/gizmo scales, undo/redo, cancel, cycle rollback, groups and unchanged loaded documents passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
