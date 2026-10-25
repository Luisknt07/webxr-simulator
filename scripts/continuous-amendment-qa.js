'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createHash} = require('node:crypto');
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'data/qa-studio');
const RUNTIME = 'src/editor/SimulationRuntime.js', RECIPE = 'src/editor/IndustrialLabLines.js';
const OLD_WORK = "      useful = belt.packages.length > 0 && (Math.abs(belt.actualSpeed || 0) > 1e-7 || belt.mechanismPhase !== 'ready');";
const NEW_WORK = "      const waitingForOperator = ['waitingOperator', 'waitingManualAction'].includes(belt.mechanismPhase);\n      useful = belt.packages.length > 0 && (Math.abs(belt.actualSpeed || 0) > 1e-7 || !waitingForOperator && belt.mechanismPhase !== 'ready');";
const NEW_ROUTE = "routing: continuous ? 'percentage' : 'branch', branchPercentage: continuous ? 90 : 50";
const OLD_FEED = "source('Source · entrada al circuito rectangular')", NEW_FEED = "source('Source · entrada al circuito rectangular', continuous ? {outputInterval: 6} : {})";
const sha = value => createHash('sha256').update(value).digest('hex');
const normalized = value => String(value).replace(/\r\n/g, '\n');
const objectHash = value => sha(JSON.stringify(value));
function productionMethod(text) {
  const source = normalized(text), start = source.indexOf('\n  productionRow(record) {'), end = source.indexOf('\n\n  observeProduction(', start);
  assert(start >= 0 && end > start, 'Expected the exact analytics method boundary.');
  return {method: source.slice(start, end), rest: source.slice(0, start) + source.slice(end)};
}
function verifySourceProof(before, oldRuntime, readFile = file => fs.readFileSync(path.join(ROOT, file), 'utf8')) {
  assert.equal(sha(oldRuntime), before.sourceHash);
  const currentRuntime = readFile(RUNTIME), old = productionMethod(oldRuntime), current = productionMethod(currentRuntime);
  assert.equal(old.method, before.method); assert.equal(old.rest, current.rest, 'Physics or another runtime method changed.');
  assert.equal(old.method.split(OLD_WORK).length, 2);
  assert.equal(current.method, old.method.replace(OLD_WORK, NEW_WORK), 'Only the two manual waiting phases may change analytics.');
  const recipe = readFile(RECIPE); assert.equal(recipe.split(NEW_ROUTE).length, 2); assert.equal(recipe.split(NEW_FEED).length, 2);
  assert.equal(sha(recipe.replace(NEW_ROUTE, "routing: 'branch'").replace(NEW_FEED, OLD_FEED)), before.files[RECIPE], 'The Lab recipe has an unrelated change.');
  const files = {}, changedFiles = [];
  Object.keys(before.files).forEach(file => {
    files[file] = sha(readFile(file));
    if (files[file] !== before.files[file]) changedFiles.push(file);
    if (![RUNTIME, RECIPE].includes(file)) assert.equal(files[file], before.files[file], 'An unrelated application source changed: ' + file);
  });
  assert.deepEqual(changedFiles.sort(), [RECIPE, RUNTIME].sort());
  return {oldBundleHash: before.bundleHash, oldSourceHash: before.sourceHash, sourceHash: sha(currentRuntime), physicsHash: sha(old.rest),
    unchangedRuntimeOutsideProductionRow: true, exactManualWaitingAnalyticsChange: true, exactContinuousLabRoutingAndDispatchChange: true,
    changedFiles, beforeFilesHash: objectHash(before.files), filesHash: objectHash(files), files};
}
function patchReturn(document, manifest) {
  const clone = JSON.parse(JSON.stringify(document)), scene = manifest.scenarios.find(value => value.roomId === 'sound'), line = scene.lines.find(value => value.id === 'rectangle');
  const matches = clone.rooms.sound.additions.filter(value => line.memberIds.includes(value.id) && /Desvío.*descarga del circuito/.test(value.name));
  assert.equal(matches.length, 1); const object = matches[0], config = object.behaviors.find(value => value.type === 'conveyor');
  assert.equal(config.routing, 'branch'); assert.equal(config.branchPercentage, 50); assert(config.outputId && config.branchId); config.routing = 'percentage'; config.branchPercentage = 90;
  assert.equal(line.sourceIds.length, 1); const sourceObject = clone.rooms.sound.additions.find(value => value.id === line.sourceIds[0]);
  const source = sourceObject.behaviors.find(value => value.type === 'source'); assert(source); assert.equal(source.interval, 2); assert.equal(source.outputInterval, 1.2); source.outputInterval = 6;
  return {document: clone, objectId: object.id, sourceId: sourceObject.id, oldRouting: 'branch', routing: 'percentage', oldBranchPercentage: 50, branchPercentage: 90, oldOutputInterval: 1.2, outputInterval: 6};
}
function readSourceProof() {
  const before = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'manual-analytics-before.json'), 'utf8'));
  const oldRuntime = fs.readFileSync(path.join(OUTPUT, 'SimulationRuntime-before-manual-analytics.js'), 'utf8');
  const proof = verifySourceProof(before, oldRuntime), canonical = require('./verify-continuous-amendment')();
  assert.equal(canonical.beforeBundleHash, proof.oldBundleHash); assert.equal(canonical.afterRuntimeHash, proof.sourceHash);
  return {...proof, canonical};
}
function verifyAmendment(amendment, document, manifest, bundleHash) {
  assert.equal(amendment.format, 'hello-webxr-reviewed-continuous-amendment'); assert.equal(amendment.bundleHash, bundleHash);
  assert.deepEqual(amendment.sourceProof, readSourceProof()); assert.equal(amendment.evidenceOldBundleHash, amendment.sourceProof.oldBundleHash);
  const oldDocument = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'continuous-before-amendment-payload.json'), 'utf8'));
  assert.equal(objectHash(oldDocument), amendment.oldDocumentHash); const patched = patchReturn(oldDocument, manifest);
  assert.equal(objectHash(document), amendment.documentHash); assert.equal(amendment.oldRouting, 'branch'); assert.equal(amendment.routing, 'percentage');
  assert.equal(amendment.sourceId, patched.sourceId); assert.equal(amendment.oldBranchPercentage, 50); assert.equal(amendment.branchPercentage, 90); assert.equal(amendment.oldOutputInterval, 1.2); assert.equal(amendment.outputInterval, 6);
  assert.deepEqual(document, patched.document, 'The candidate changed beyond the three approved Lab routing/dispatch fields.'); assert.equal(patched.objectId, amendment.objectId);
  for (const roomId of ['photogrammetry', 'vertigo']) {
    assert.equal(objectHash(document.rooms[roomId]), objectHash(oldDocument.rooms[roomId]));
    assert.equal(amendment.preservedRoomHashes[roomId], objectHash(document.rooms[roomId]));
  }
  return amendment;
}
async function prepare(bundleHash) {
  const {requestRaw, bytesHash} = require('./upgrade-cedi-examples'), {guardContinuousCandidate, verifyContinuousManifest} = require('./upgrade-continuous-examples');
  assert(/^[a-f0-9]{64}$/.test(bundleHash || '')); assert.equal(bytesHash(await requestRaw('/bundle.js')), bundleHash);
  const payloadFile = path.join(OUTPUT, 'continuous-unverified-payload.json'), trialFile = path.join(OUTPUT, 'continuous-qa-trial.json');
  assert(!fs.existsSync(path.join(OUTPUT, 'continuous-before-amendment-payload.json')), 'An amendment was already prepared.');
  const previousBytes = fs.readFileSync(payloadFile), oldDocument = JSON.parse(previousBytes), manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'continuous-manifest.json'), 'utf8'));
  const trial = JSON.parse(fs.readFileSync(trialFile, 'utf8')), before = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'continuous-before-rev13.json'), 'utf8'));
  const sourceProof = readSourceProof(); assert.equal(trial.bundleHash, sourceProof.oldBundleHash); assert.equal(trial.documentHash, objectHash(oldDocument));
  const patched = patchReturn(oldDocument, manifest), safe = guardContinuousCandidate(before.document, patched.document); verifyContinuousManifest(manifest, safe.document);
  assert.deepEqual(patched.document, safe.document);
  const amendment = {format: 'hello-webxr-reviewed-continuous-amendment', preparedAt: new Date().toISOString(), bundleHash,
    evidenceOldBundleHash: sourceProof.oldBundleHash, oldDocumentHash: objectHash(oldDocument), documentHash: objectHash(patched.document),
    objectId: patched.objectId, sourceId: patched.sourceId, oldRouting: patched.oldRouting, routing: patched.routing,
    oldBranchPercentage: patched.oldBranchPercentage, branchPercentage: patched.branchPercentage, oldOutputInterval: patched.oldOutputInterval, outputInterval: patched.outputInterval,
    preservedRoomHashes: Object.fromEntries(['photogrammetry', 'vertigo'].map(id => [id, objectHash(oldDocument.rooms[id])])), sourceProof};
  for (const roomId of ['photogrammetry', 'vertigo']) { const raw = fs.readFileSync(path.join(OUTPUT, 'continuous-' + roomId + '-flow.json')); assert.equal(bytesHash(raw), trial.flows[roomId].hash); }
  fs.writeFileSync(path.join(OUTPUT, 'continuous-before-amendment-payload.json'), previousBytes);
  fs.writeFileSync(path.join(OUTPUT, 'continuous-before-amendment-trial.json'), JSON.stringify(trial, null, 2));
  fs.copyFileSync(path.join(OUTPUT, 'continuous-candidate.json'), path.join(OUTPUT, 'continuous-before-amendment-candidate.json'));
  fs.copyFileSync(path.join(OUTPUT, 'continuous-sound-flow.json'), path.join(OUTPUT, 'continuous-sound-old-routing-flow.json'));
  trial.bundleHash = bundleHash; trial.documentHash = amendment.documentHash; trial.amendment = amendment; delete trial.flows.sound;
  ['photogrammetry', 'vertigo'].forEach(id => { trial.flows[id].evidenceBundleHash = sourceProof.oldBundleHash; trial.flows[id].roomDocumentHash = amendment.preservedRoomHashes[id]; });
  verifyAmendment(amendment, patched.document, manifest, bundleHash);
  fs.writeFileSync(payloadFile, JSON.stringify(patched.document)); fs.writeFileSync(trialFile, JSON.stringify(trial, null, 2));
  fs.writeFileSync(path.join(OUTPUT, 'continuous-amendment.json'), JSON.stringify(amendment, null, 2));
  console.log(JSON.stringify({prepared: true, databaseWrites: 0, changedFields: [patched.objectId + '.routing',patched.objectId + '.branchPercentage',patched.sourceId + '.outputInterval'], preservedRooms: amendment.preservedRoomHashes, rerun: 'sound 900s', bundleHash}));
}
module.exports = {verifySourceProof, verifyAmendment, patchReturn, productionMethod, sha};
if (require.main === module) prepare(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
