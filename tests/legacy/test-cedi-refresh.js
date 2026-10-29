const __layout = require("../../tooling/layout.cjs");
'use strict';
// Refresh is an explicitly requested replacement, not a migration on load.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const file = __layout.map(path.join(__layout.oldDir("scripts/test-cedi-refresh.js"), 'test-cedi-levels.js')), content = fs.readFileSync(file, 'utf8');
const localRequire = require('node:module').createRequire(file);
const {fixture, releaseGeometry} = new Function('require', '__dirname', content.slice(0, content.indexOf('\nasync function authoringTransactions()')) + '\nreturn {fixture,releaseGeometry};')(localRequire, __dirname);
const copy = value => JSON.parse(JSON.stringify(value));
const rounded = value => JSON.parse(JSON.stringify(value, (key, item) => typeof item === 'number' ? Number(item.toFixed(10)) : item));
const equal = (a, b, message) => assert.deepEqual(rounded(a), rounded(b), message);
function setup() {
  const f = fixture();
  f.document.setStudio({scenes: [{id: 'hall', name: 'Original'}, {id: 'sound', name: 'Laboratorio protegido'},
    {id: 'photogrammetry', name: 'CEDI · Clasificación y consolidación'}, {id: 'vertigo', name: 'CEDI · Packing y transferencias'}], startRoomId: 'sound'});
  ['hall', 'sound', 'photogrammetry', 'vertigo'].forEach(roomId => {
    const object = f.document.addPrimitive(roomId, 'box', '#b67b45'); f.document.setProperty(object, 'name', 'Anterior · ' + roomId);
  });
  // Real refresh orchestration with a tiny factory: full factories and physics
  // are covered separately, avoiding another pair of large networks here.
  f.tools.populateCediScenario = (roomId, kind) => {
    const source = f.document.addPrefab(roomId, 'source'), receiver = f.document.addPrefab(roomId, 'palletQueue');
    const sourceId = source.userData.editorId, receiverId = receiver.userData.editorId;
    const line = {id: kind, title: kind, mode: 'automatic', controller: source, sources: [source], receivers: [receiver],
      memberIds: [sourceId, receiverId], expectedUnits: 96, expectedLoads: 96, expectedReceiverUnits: [96], expectedReceiverLoads: [96],
      sourceExpectations: [{id: sourceId, loads: 96, units: 96}], routingCoverage: []};
    f.document.setStudio({groups: (f.document.studio.groups || []).concat({id: 'new-' + roomId, name: kind, roomId, members: line.memberIds})});
    return {expectedUnits: 96, expectedLoads: 96, coverage: {variants: [], fields: [], modes: [], productTypes: []},
      sources: [source], receivers: [receiver], controllers: [source], objects: [source, receiver], lines: [line],
      expectedReceiverUnits: [96], expectedReceiverLoads: [96]};
  };
  return f;
}
async function run() {
  const f = setup(), before = copy(await f.document.serialize()), length = f.document.undoStack.length;
  const refreshed = await f.tools.refreshCediExamples();
  assert.deepEqual(refreshed.scenarios.map(item => item.roomId), ['photogrammetry', 'vertigo']);
  assert(refreshed.scenarios.every(item => item.expectedUnits === 96 && item.lines.length === 1));
  assert.equal(f.document.undoStack.length, length + 1);
  const after = copy(await f.document.serialize());
  for (const roomId of ['hall', 'sound']) equal(after.rooms[roomId], before.rooms[roomId], 'Other levels remain intact.');
  assert.equal(after.studio.startRoomId, before.studio.startRoomId);
  equal(after.studio.scenes, before.studio.scenes, 'Room identities and labels are preserved.');
  assert(!after.rooms.photogrammetry.additions.some(item => item.name === 'Anterior · photogrammetry'));
  f.document.undo(); equal(await f.document.serialize(), before); f.document.redo(); equal(await f.document.serialize(), after);
  releaseGeometry(f);
  const failed = setup(), initial = copy(await failed.document.serialize()), history = failed.document.undoStack.length, previousRoom = failed.editor.roomId;
  const populate = failed.tools.populateCediScenario;
  failed.tools.populateCediScenario = (roomId, kind) => { if (kind === 'packing') throw new Error('Second refresh failed'); return populate(roomId, kind); };
  await assert.rejects(() => failed.tools.refreshCediExamples(), /Second refresh failed/);
  equal(await failed.document.serialize(), initial, 'A failure in the second room restores both old examples and their metadata.');
  assert.equal(failed.document.undoStack.length, history); assert.equal(failed.editor.roomId, previousRoom); assert.equal(failed.editor.creatingScene, false);
  failed.document.setStudio({scenes: failed.document.studio.scenes.filter(item => item.id !== 'vertigo')});
  const unknown = copy(await failed.document.serialize());
  await assert.rejects(() => failed.tools.refreshCediExamples(), /No se encontró/); equal(await failed.document.serialize(), unknown);
  releaseGeometry(failed);
  console.log('CEDI refresh: explicit two-room replacement, other rooms/start/labels preserved, one undo/redo, complete second-room rollback and missing-target preflight passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
