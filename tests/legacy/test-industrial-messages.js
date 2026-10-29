const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createRequire} = require('node:module');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), {validateDocument} = require('../../apps/api/server/validation');
const helper = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-industrial-messages.js"), '../src/editor/IndustrialMessages.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const applyIndustrialMessages = new Function('schema', helper + '\nreturn applyIndustrialMessages;')(schema);
const file = __layout.map(path.join(__layout.oldDir("scripts/test-industrial-messages.js"), 'test-editor-runtime.js')), source = fs.readFileSync(file, 'utf8');
const {harness, storage, remote} = new Function('require', '__dirname', source.slice(0, source.indexOf('async function run()')) + '\nreturn {harness,storage,remote};')(createRequire(file), __dirname);
async function run() {
  storage.clear(); remote.projects.clear(); const f = harness(), e = f.editor; await e.ready; const document = e.document, roomId = e.roomId;
  const add = (name, color = '#172d42', extra) => { const object = document.addPrimitive(roomId, 'box', color); document.setProperty(object, 'name', name); document.setTransform(object, {position: [3, 3, -4], rotation: [.1, .7, -.2], scale: [4, 2, .1]}); document.setBehaviors(object, [Object.assign(schema.defaultBehavior('info'), {title: 'Título intacto', text: 'Contenido largo editable\nObjetivo y pasos conservados.', color: '#aabbcc'}), schema.defaultBehavior('billboard')].concat(extra || [])); return object; };
  const guide = add('Guía · control manual'), label = add('01 · Rótulo · línea de empaquetado'), terminal = add('Etiqueta de destino · Pallet A');
  const custom = add('Mi guía personal'), customColor = add('Guía · color propio', '#552244'), control = add('Guía · monitor', '#172d42', [schema.defaultBehavior('lineMonitor')]);
  const edited = add('Guía · acabados editados'); document.setProperty(edited, 'color', '#172d42');
  const untouched = new Set([custom, customColor, control, edited].map(object => object.userData.editorId)); const before = await document.serialize(), history = document.undoStack.length;
  const result = applyIndustrialMessages(document, roomId); assert.equal(result.changed, true); assert.deepEqual(new Set(result.changedObjectIds), new Set([guide, label, terminal].map(object => object.userData.editorId))); assert.equal(document.undoStack.length, history + 1);
  for (const object of [guide, label, terminal]) {
    const info = document.getBehaviors(object).find(value => value.type === 'info'); assert.equal(info.title, 'Título intacto'); assert.equal(info.text, 'Contenido largo editable\nObjetivo y pasos conservados.'); assert.equal(info.color, '#aabbcc'); assert.equal(info.presentation, 'contextual'); assert.equal(info.width, 1);
    assert.deepEqual(object.scale.toArray(), [1, .625, .025]); assert.equal(object.position.x, 3); assert.equal(object.position.z, -4); assert.deepEqual(object.quaternion.toArray(), before.rooms[roomId].additions.find(row => row.id === object.userData.editorId).quaternion, 'The authored orientation stays literal.');
  }
  assert.equal(guide.position.y, 1.55); assert.equal(terminal.position.y, 3, 'Elevated destination labels keep their useful overhead location.');
  const after = await document.serialize(); assert.deepEqual(after.rooms[roomId].additions.filter(row => untouched.has(row.id)), before.rooms[roomId].additions.filter(row => untouched.has(row.id)), 'Custom boards, monitor/control boards and custom tints stay literal.');
  assert.deepEqual(after.studio, before.studio); assert.deepEqual(after.imports, before.imports); validateDocument(after, value => value);
  assert.equal(applyIndustrialMessages(document, roomId).changed, false); assert.deepEqual(await document.serialize(), after, 'A second application is a data no-op.');
  document.undo(); assert.deepEqual(await document.serialize(), before, 'One undo restores content, size and presentation together.'); document.redo(); assert.deepEqual(await document.serialize(), after);
  const loaded = harness(); await loaded.editor.ready; await loaded.editor.document.load(after, {activeRoomId: roomId});
  const reopened = loaded.editor.document.getObject(guide.userData.editorId), info = loaded.editor.document.getBehaviors(reopened).find(value => value.type === 'info'); assert.equal(info.presentation, 'contextual'); assert.equal(info.text, 'Contenido largo editable\nObjetivo y pasos conservados.'); assert.equal(reopened.scale.x, 1);
  const roundtrip = await loaded.editor.document.serialize(); validateDocument(roundtrip, value => value); assert.equal(applyIndustrialMessages(loaded.editor.document, roomId).changed, false);
  e.projectSync.stop(); loaded.editor.projectSync.stop(); e.clearAssembly(true); loaded.editor.clearAssembly(true);
  console.log('Industrial messages: strict generated-board selection, compact opt-in presentation, preserved content/IDs/custom boards/monitors/Studio, one undo, idempotence and schema-valid reopen passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
