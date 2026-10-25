'use strict';
// Real editor/document/material handlers; persistence is the in-memory adapter.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createRequire} = require('node:module');
const materials = require('../shared/materials');
const file = path.join(__dirname, 'test-editor-runtime.js'), source = fs.readFileSync(file, 'utf8');
const {harness, storage, remote} = new Function('require', '__dirname', source.slice(0, source.indexOf('async function run()')) + '\nreturn {harness,storage,remote};')(createRequire(file), __dirname);
const all = node => [node].concat(Array.from(node.children || []).flatMap(all));
const heading = node => Array.from(node.children || []).find(child => child.tagName === 'H3')?.textContent;
const settle = async editor => { for (let i = 0; i < 18; i++) await Promise.resolve(); await editor.materials.sync(editor.roomId); };
const clone = value => JSON.parse(JSON.stringify(value));

async function run() {
  storage.clear(); remote.projects.clear(); remote.online = true;
  const f = harness(), e = f.editor; await e.ready; e.enter();
  const actor = e.document.addPrefab('hall', 'conveyor', 'roller-motor'); e.select(actor);
  const input = label => all(e.inspectorContent).find(node => node.getAttribute('aria-label') === label);
  const control = text => all(e.inspectorContent).find(node => node.tagName === 'BUTTON' && node.textContent === text);
  const change = async (label, value) => { const node = input(label); assert(node, label); node.value = value; await node.fire('change'); await settle(e); };
  const config = () => e.document.getBehaviors(actor).find(value => value.type === 'conveyor');
  const finishes = () => { const value = e.document.getBehaviors(actor).find(value => value.type === 'surfaceMaterial'); return value ? materials.assignments(value) : []; };
  const appearance = () => all(e.inspectorContent).find(node => node.getAttribute('data-appearance-inspector') === 'true');
  const authored = await e.document.serialize(), depth = e.document.undoStack.length;
  assert.equal(heading(e.inspectorContent.children[1]), 'TRANSFORMACIÓN');
  assert.equal(heading(e.inspectorContent.children[2]), 'CONFIGURACIÓN DEL EQUIPO');
  assert(appearance());
  for (const label of ['Parte o material a editar', 'Acabado del material', 'Color base', 'Rugosidad', 'Metalizado', 'Mapa de normales', 'Mapa de rugosidad', 'Repeticiones U', 'Nuevo modelo visual', 'Forma / tipología del equipo', 'Tecnología de transporte', 'Archivo de modelo visual propio']) {
    assert(all(appearance()).includes(input(label)), label + ' belongs to the actual Appearance panel, before any material is assigned.');
  }
  assert(control('Importar modelo 3D propio')); assert(control('Importar texturas propias'));
  assert.equal(input('Color'), undefined, 'There is no whole-machine tint competing with the part selector.');
  e.renderInspector(); assert.equal(e.document.undoStack.length, depth); assert.deepEqual(await e.document.serialize(), authored, 'Opening appearance never creates a material or alters the document.');
  const updateBounds = e.box.update; let boundUpdates = 0; e.box.update = () => { boundUpdates++; };
  e.pendingEdits++; e.render(0); e.pendingEdits--; e.loadingProject = true; e.render(0); e.loadingProject = false; e.document.loading = true; e.render(0); e.document.loading = false;
  assert.equal(boundUpdates, 0, 'Rendering during replacement or hydration never reads the selected actor intermediate bounds.');
  e.render(0); assert.equal(boundUpdates, 1, 'Stable authoring resumes its selection bounds.'); e.box.update = updateBounds;

  const slots = e.materials.getSlots(actor).filter(slot => slot.value.startsWith('mesh:'));
  assert(slots.length > 2); assert.equal(input('Parte o material a editar').value, slots[0].value);
  const functions = clone(e.document.getBehaviors(actor));
  await change('Color base', '#d8522e');
  await change('Parte o material a editar', slots[1].value);
  const maps = all(appearance()).find(node => node.tagName === 'DETAILS' && node.children[0]?.textContent === 'Texturas y relieve');
  maps.open = true; await maps.fire('toggle');
  await change('Rugosidad', '0.87');
  assert.equal(all(appearance()).find(node => node.tagName === 'DETAILS' && node.children[0]?.textContent === 'Texturas y relieve').open, true, 'Editing keeps the texture controls open.');
  await change(materials.fields.find(field => field.key === 'texture').label, 'images/picture.png');
  assert.equal(finishes().length, 2); assert.equal(finishes()[0].slot, slots[0].value); assert.equal(finishes()[0].color, '#d8522e'); assert.equal(finishes()[0].texture, '');
  assert.equal(finishes()[1].slot, slots[1].value); assert.equal(finishes()[1].roughness, 0.87); assert.equal(finishes()[1].texture, 'images/picture.png');
  assert.deepEqual(e.document.getBehaviors(actor).filter(value => value.type !== 'surfaceMaterial'), functions, 'Part appearance preserves all machine behavior.');

  const beforeShape = await e.document.serialize(), shapeDepth = e.document.undoStack.length;
  await change('Forma / tipología del equipo', 'curveRight');
  assert.equal(config().layout, 'curveRight'); assert.equal(config().equipmentId, 'conveyor.roller-curve'); assert.equal(e.document.undoStack.length, shapeDepth + 1);
  const afterShape = await e.document.serialize();
  await e.perform(() => e.historyStep('undo')); await settle(e); assert.deepEqual(await e.document.serialize(), beforeShape);
  await e.perform(() => e.historyStep('redo')); await settle(e); assert.deepEqual(await e.document.serialize(), afterShape);
  await change('Tecnología de transporte', 'belt');
  assert.equal(config().equipmentId, 'conveyor.belt-curve'); assert.equal(config().layout, 'curveRight'); assert.equal(config().surface, 'belt');

  // The visual replacement retains independent functional descendants/IDs.
  const ids = e.document.getObjects(e.roomId).filter(node => node !== actor && node.userData.editorPrefabNode).map(node => node.userData.editorId);
  const beforeModel = clone(e.document.getBehaviors(actor)), pose = {p: actor.position.toArray(), q: actor.quaternion.toArray(), s: actor.scale.toArray()};
  const visualBefore = clone(e.document.getVisualDescriptor(actor));
  input('Archivo de modelo visual propio').files = [{name: 'my-machine.glb', type: 'model/gltf-binary', size: 64, contents: 'custom model'}];
  await input('Archivo de modelo visual propio').fire('change'); await settle(e);
  assert.equal(e.document.getVisualDescriptor(actor).importId, 'batch-import-file-0');
  assert.equal(input('Color base').disabled, false, 'An imported model immediately selects an editable surface of the new visual.');
  assert(!slots.some(slot => slot.value === input('Parte o material a editar').value), 'Old hidden mechanical slots do not remain selected after replacing the visual.');
  assert.deepEqual(e.document.getBehaviors(actor), beforeModel); assert.deepEqual({p: actor.position.toArray(), q: actor.quaternion.toArray(), s: actor.scale.toArray()}, pose);
  for (const id of ids) assert(e.document.getObject(id), 'Visual replacement preserves registered sensor and control actors.');
  const controls = e.document.getObjects(e.roomId).filter(node => e.document.getBehaviors(node).some(value => value.type === 'control'));
  assert(controls.length); controls.forEach(node => { assert(node.visible); node.traverse(mesh => { if (mesh.material) assert(!mesh.userData.editorGeometryReplaced, 'Functional controls remain visible after importing a machine shell.'); }); });
  assert(all(appearance()).some(node => /una sola superficie/.test(node.textContent)), 'A single-surface import explains why individual subparts cannot be recolored.');
  assert(all(appearance()).some(node => /no heredan la animación/.test(node.textContent)), 'Machine animation and port constraints are stated before/after replacing its visual.');
  assert(all(appearance()).some(node => /no encuentran su pieza/.test(node.textContent)), 'Unmatched saved finishes are retained with a concrete retargeting explanation.');
  await e.perform(() => e.historyStep('undo')); await settle(e); assert.deepEqual(e.document.getVisualDescriptor(actor), visualBefore);
  await e.perform(() => e.historyStep('redo')); await settle(e); assert.equal(e.document.getVisualDescriptor(actor).importId, 'batch-import-file-0');
  const currentSlot = e.materials.getSlots(actor).find(slot => slot.value.startsWith('mesh:') && /Malla/.test(slot.label));
  assert(currentSlot); await change('Parte o material a editar', currentSlot.value); await change('Color base', '#458ac6');
  const snapshot = await e.document.serialize(); await e.saveProject('Appearance integration');
  const reopened = harness(); await reopened.editor.ready; await settle(reopened.editor);
  assert.deepEqual(clone(await reopened.editor.document.serialize()), clone(snapshot), 'Part finishes, typology/technology and imported visual survive save/reopen without data changes.');
  const loaded = reopened.editor.document.getObject(actor.userData.editorId); assert(loaded);
  assert.equal(reopened.editor.document.getVisualDescriptor(loaded).importId, 'batch-import-file-0');

  const linked = e.document.addPrefab(e.roomId, 'conveyor', 'roller-motor'), tail = e.document.addPrefab(e.roomId, 'conveyor', 'roller-motor');
  e.document.setTransform(linked, {position: [40, 1, -20]});
  e.assembly.align(linked, 'output', tail, 'input');
  assert(e.assembly.connect(e.assembly.pair(tail, 'input', linked, 'output')));
  e.select(linked);
  const linkedBefore = await e.document.serialize(), linkedDepth = e.document.undoStack.length;
  await change('Forma / tipología del equipo', 'curveLeft');
  const outlet = e.assembly.worldPort(linked, 'output'), inlet = e.assembly.worldPort(tail, 'input');
  assert(outlet.position.distanceTo(inlet.position) < 0.0001, 'Appearance typography uses the same reflow solver and keeps the next equipment physically connected.');
  assert(outlet.tangent.dot(inlet.tangent) > 0.9999); assert.equal(e.document.undoStack.length, linkedDepth + 1);
  const linkedAfter = await e.document.serialize();
  await e.perform(() => e.historyStep('undo')); await settle(e); assert.deepEqual(await e.document.serialize(), linkedBefore);
  await e.perform(() => e.historyStep('redo')); await settle(e); assert.deepEqual(await e.document.serialize(), linkedAfter);
  const legacy = e.document.addPrimitive(e.roomId, 'box');
  e.document.setBehaviors(legacy, [Object.assign({type: 'surfaceMaterial', enabled: true}, materials.getPreset('steel'), {slot: 'index:0'})]); e.select(legacy);
  assert.equal(input('Parte o material a editar').value, 'index:0'); assert.equal(input('Color base').disabled, false, 'Legacy index selectors remain editable when they resolve to a real surface.');
  e.projectSync.stop(); reopened.editor.projectSync.stop();
  e.clearAssembly(true); reopened.editor.clearAssembly(true);
  console.log('Appearance inspector: unified real controls, private part colors/maps, persistent groups, functional shape/technology, actor-safe own-model import, exact undo/redo and save/reopen passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
