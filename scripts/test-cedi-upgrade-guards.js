'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three'), schema = require('../shared/behaviors');
const {validateDocument} = require('../server/validation');
const {guardedCandidate, verifyManifest, verifyArtifact, canonicalSavePlan, verifyStoredCandidate, hash} = require('./upgrade-cedi-examples');
const text = fs.readFileSync(path.join(__dirname, 'test-industrial-lab-lines.js'), 'utf8');
const {harness, releaseGeometry} = new Function('require', '__dirname', text.slice(0, text.indexOf('\nasync function run()')) + '\nreturn {harness,releaseGeometry};')(require, __dirname);
const builders = require('./load-industrial-cedi')(THREE, schema), clone = value => JSON.parse(JSON.stringify(value));
const LAB = '194c1284-1c6e-4f2a-b089-9c540ed6e32b', ORIGINAL = '9a990ce7925ca3ca84a98fa02d363c9cef4da0f2a8bba961491e23dab54b3cac';

async function run() {
  const f = harness.setup();
  for (const roomId of ['sound', 'photogrammetry', 'vertigo']) { const root = new THREE.Group(); f.scene.add(root); f.document.registerRoom(roomId, root); }
  for (const roomId of ['hall', 'sound', 'photogrammetry', 'vertigo']) { const box = f.document.addPrimitive(roomId, 'box'); f.document.setProperty(box, 'name', 'Original ' + roomId); }
  f.document.setStudio({scenes: [{id: 'hall', name: 'Sala principal'}, {id: 'sound', name: 'Laboratorio industrial · Ejemplos'}, {id: 'photogrammetry', name: 'CEDI · Clasificación y consolidación'}, {id: 'vertigo', name: 'CEDI · Packing y transferencias'}], startRoomId: 'hall', environments: ['hall', 'sound', 'photogrammetry', 'vertigo'].map(schema.studio.defaultEnvironment)});
  const before = validateDocument(await f.document.serialize(), value => value), candidate = clone(before); candidate.rooms.photogrammetry.additions[0].position[0] += 3; candidate.rooms.vertigo.additions[0].color = '#336677'; candidate.studio.environments.find(item => item.roomId === 'photogrammetry').skyColor = '#123456';
  const safe = guardedCandidate(before, candidate); assert.equal(safe.roomHashes.filter(room => room.changed).length, 2); assert.equal(hash(safe.document.rooms.hall), hash(before.rooms.hall)); assert.equal(hash(safe.document.rooms.sound), hash(before.rooms.sound));
  const reject = (change, expression) => { const value = clone(candidate); change(value); assert.throws(() => guardedCandidate(before, value), expression); };
  reject(value => { value.rooms.sound.additions[0].position[0] = 1e-16; }, /roundoff/);
  reject(value => { value.rooms.hall.additions[0].name = 'Changed'; }, /roundoff/);
  reject(value => { value.imports.push({id: 'surprise', path: 'surprise.png'}); }, /project data/);
  reject(value => { value.studio.startRoomId = 'photogrammetry'; }, /Studio data/);
  reject(value => { value.studio.scenes[2].name = 'Rebound'; }, /strict|equal|Assertion/);
  reject(value => { value.studio.environments[0].skyColor = '#ff0000'; }, /Studio records/);
  reject(value => { value.rooms.panorama1 = {overrides: [], additions: []}; }, /room/);
  const rounded = clone(candidate); rounded.rooms.sound.additions[0].quaternion[2] += Number.EPSILON;
  const repaired = guardedCandidate(before, rounded); assert.equal(hash(repaired.document.rooms.sound), hash(before.rooms.sound)); assert(repaired.restoredPrecision.length);
  const reordered = clone(candidate); reordered.rooms.hall.additions[0] = Object.fromEntries(Object.entries(reordered.rooms.hall.additions[0]).reverse()); assert.equal(hash(guardedCandidate(before, reordered).document.rooms.hall), hash(before.rooms.hall));

  const scenarios = [];
  for (const [roomId, kind] of [['photogrammetry', 'sorting'], ['vertigo', 'packing']]) {
    f.document.resetRoom(roomId); const built = builders.buildIndustrialCediLevel(f.document, roomId, {kind, scene: f.scene});
    scenarios.push({roomId, kind, expectedUnits: built.expectedUnits, expectedLoads: built.expectedLoads, coverage: built.coverage, objectIds: built.objects.map(o => o.userData.editorId), sourceIds: built.sourceIds, receiverIds: built.receiverIds, expectedReceiverUnits: built.expectedReceiverUnits, expectedReceiverLoads: built.expectedReceiverLoads,
      lines: built.lines.map(line => ({id: line.id, title: line.title, mode: line.mode, controllerId: line.controller.userData.editorId, monitorId: line.monitor.userData.editorId, memberIds: line.memberIds, sourceIds: line.sourceIds, receiverIds: line.bufferIds, sourceExpectations: line.sourceExpectations, expectedUnits: line.expectedUnits, expectedLoads: line.expectedLoads, expectedReceiverUnits: line.expectedReceiverUnits, expectedReceiverLoads: line.expectedReceiverLoads}))});
  }
  const full = guardedCandidate(before, await f.document.serialize()), manifest = {scenarios}; verifyManifest(manifest, full.document);
  const savePlan = canonicalSavePlan(before, full.document);
  assert(savePlan.propertyOrderChanges.length > 0, 'The real authoring serialization puts interaction after the transform fields.');
  assert.notEqual(savePlan.reviewedPayloadHash, savePlan.storedPayloadHash);
  assert.doesNotThrow(() => verifyStoredCandidate(before, full.document, clone(savePlan.document), savePlan));
  assert(savePlan.propertyOrderChanges.every(change => /^\/rooms\/(photogrammetry|vertigo)\/additions\/\d+$/.test(change.path)));
  for (const mutate of [
    value => { value.rooms.photogrammetry.additions[0].name += ' Changed'; },
    value => { value.rooms.vertigo.additions[0].position[0] += 1e-12; },
    value => { value.rooms.sound.additions[0].color = '#ff0000'; },
    value => { value.studio.startRoomId = 'vertigo'; }
  ]) { const changed = clone(savePlan.document); mutate(changed); assert.throws(() => verifyStoredCandidate(before, full.document, changed, savePlan), /reviewed document value/); }
  const reorderedProtected = clone(savePlan.document); reorderedProtected.rooms.sound.additions[0] = Object.fromEntries(Object.entries(reorderedProtected.rooms.sound.additions[0]).reverse());
  assert.throws(() => verifyStoredCandidate(before, full.document, reorderedProtected, savePlan), /canonical pre-PUT|protected room/);
  const reorderedStudio = clone(savePlan.document); reorderedStudio.studio = Object.fromEntries(Object.entries(reorderedStudio.studio).reverse());
  assert.throws(() => verifyStoredCandidate(before, full.document, reorderedStudio, savePlan), /canonical pre-PUT|Studio/);
  const artifact = {format: 'hello-webxr-verified-cedi-upgrade', version: 1, projectId: LAB, expectedRevision: 12, baseHash: hash(before), document: full.document, payloadHash: hash(full.document), original: {revision: 9, hash: ORIGINAL}, manifest, manifestHash: hash(manifest), qa: {passed: true, flows: scenarios.map(scene => ({roomId: scene.roomId, units: 96, loads: 68, tracePassed: true, geometryPassed: true}))}};
  assert.doesNotThrow(() => verifyArtifact(artifact, before));
  const tampered = clone(artifact); tampered.document.rooms.sound.additions[0].name = 'Overwrite'; assert.throws(() => verifyArtifact(tampered, before));
  const unverified = clone(artifact); unverified.qa.passed = false; assert.throws(() => verifyArtifact(unverified, before));
  const badManifest = clone(artifact); badManifest.manifest.scenarios[0].lines[2].sourceExpectations[0].loads = 4; badManifest.manifestHash = hash(badManifest.manifest); assert.throws(() => verifyArtifact(badManifest, before), /Assertion/);
  const missing = clone(artifact); missing.manifest.scenarios[0].lines[0].monitorId = 'missing'; missing.manifestHash = hash(missing.manifest); assert.throws(() => verifyArtifact(missing, before));
  releaseGeometry(f); console.log('CEDI upgrade guards: two named rooms, literal unrelated rooms and Studio, canonical interaction key ordering, changed-value rejection, full 96-unit/25-variant manifests, empty manual annexes and tamper/unverified candidate rejection passed without database writes.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
