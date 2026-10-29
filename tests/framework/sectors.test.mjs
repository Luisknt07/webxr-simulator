import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access, realpath, rm} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {createHost, requireClosure} from '../../packages/core/index.js';
import {defineModule} from '../../packages/module-sdk/index.js';
import {functionManifest} from '../../packages/contracts/index.js';
import {sectorModules} from '../../modules/catalog.js';
import {copyFunction} from '../../tooling/modules/copy-function.mjs';
import {runSectorExample} from '../../apps/sector-demo/index.mjs';

test('Agriculture and Food share one inventory while the whole Logistics sector remains inactive', async () => {
  const loads = [], catalog = sectorModules.map(module => ({...module, functions: module.functions.map(entry => ({...entry, load: () => { loads.push(entry.id); return entry.load(); }}))}));
  const host = createHost({catalog, worldId: 'world.cross-sector'}); await host.activate('sector.agriculture', {functions: ['agriculture.harvest']}); await host.activate('sector.food', {functions: ['food.traceability']});
  assert.deepEqual(loads, ['logistics.storage', 'agriculture.harvest', 'food.traceability']); assert.equal(host.status().modules.some(module => module.id === 'sector.logistics-industrial'), false); assert.equal(host.status().services.length, 1);
  await host.dispatch('logistics.storage:transaction', {operations: [{type: 'add-location', location: {id: 'field', capacityKg: 100, maxLoads: 3}}, {type: 'add-location', location: {id: 'cold', capacityKg: 100, maxLoads: 3}}]});
  await host.dispatch('agriculture.harvest:record', {id: 'mango-1', crop: 'mango', lot: 'field-1', harvestDate: '2026-10-29', locationId: 'field', quantity: 12, massKg: 20});
  await host.dispatch('food.traceability:register-lot', {id: 'juice-1', sku: 'juice', batch: 'batch-1', expires: '2027-01-01', locationId: 'cold', quantity: 6, massKg: 12});
  const reservation = (await host.dispatch('logistics.storage:transaction', {operations: [{type: 'reserve', loadId: 'mango-1', ownerId: 'operator', toLocationId: 'cold'}]})).results[0];
  await host.remove('sector.agriculture'); assert.equal(host.status().services.length, 1); await assert.rejects(host.remove('sector.food'), {code: 'removal_blocked'});
  await host.dispatch('logistics.storage:transaction', {operations: [{type: 'commit', reservationId: reservation.id, ownerId: 'operator'}]});
  const snapshot = await host.dispatch('logistics.storage:snapshot'); assert.equal(snapshot.loads.length, 2); assert.deepEqual(snapshot.loads.find(load => load.id === 'mango-1'), {id: 'mango-1', sku: 'mango', quantity: 12, massKg: 20, locationId: 'cold', metadata: {sector: 'agriculture', lot: 'field-1', harvestDate: '2026-10-29'}});
  const trace = await host.dispatch('food.traceability:trace', {loadId: 'mango-1'}); assert.equal(trace.events.length, 3);
  const state = host.exportState(); await host.dispose(); const restored = createHost({catalog: sectorModules, worldId: 'world.cross-sector'}); restored.importState(state); await restored.activate('sector.agriculture'); assert.deepEqual(await restored.dispatch('logistics.storage:snapshot'), snapshot); await restored.dispose();
});

test('tourism validates actual stop proximity/order and retains progress after unloading', async () => {
  const host = createHost({catalog: sectorModules}); await host.activate('sector.tourism'); const route = {id: 'gallery', points: [{id: 'entrance', position: [0, 0, 0], radius: 1}, {id: 'hall', position: [10, 0, 0], radius: 1}]}; await host.dispatch('tourism.routes:configure', route);
  const outside = await host.dispatch('tourism.routes:visit', {routeId: route.id, visitorId: 'guest', position: [10, 0, 0]}); assert.equal(outside.accepted, false); assert.equal(outside.visited, 0);
  await host.dispatch('tourism.routes:visit', {routeId: route.id, visitorId: 'guest', position: [0, 0, 0]}); await host.remove('sector.tourism'); await host.activate('sector.tourism'); const completed = await host.dispatch('tourism.routes:visit', {routeId: route.id, visitorId: 'guest', position: [10, 0, 0]}); assert.equal(completed.completed, true); assert.equal(completed.visited, 2); await host.dispose();
});

test('education grades weighted answers and rejects duplicate attempts without storing submitted answers', async () => {
  const host = createHost({catalog: sectorModules}); await host.activate('sector.education'); await host.dispatch('education.assessment:configure', {id: 'lesson', questions: [{id: 'q1', answer: true, weight: 3}, {id: 'q2', answer: 12, weight: 1}]});
  const input = {assessmentId: 'lesson', learnerId: 'learner', answers: {q1: true, q2: 0}}; const result = await host.dispatch('education.assessment:submit', input); assert.equal(result.score, .75); assert.equal(Object.hasOwn(result, 'answers'), false); await assert.rejects(host.dispatch('education.assessment:submit', input), {code: 'duplicate_submission'}); assert.equal((await host.dispatch('education.assessment:report', {assessmentId: 'lesson'})).length, 1); await host.dispose();
});

test('machine-readable sector manifests and package file allowlists describe existing portable implementations', async () => {
  const modulesBase = new URL('../../modules/', import.meta.url);
  for (const module of sectorModules) {
    const manifest = JSON.parse(await readFile(new URL(`${module.metadata.folder}/manifest.json`, modulesBase), 'utf8')); assert.equal(manifest.id, module.id); assert.equal(manifest.version, module.version); assert.deepEqual(manifest.functions.map(entry => { const {entry: ignored, ...metadata} = entry; return metadata; }), module.functions.map(functionManifest));
    for (const entry of module.functions) {
      const base = new URL(`${module.metadata.folder}/${entry.metadata.packageRoot}/`, modulesBase); for (const filename of entry.metadata.files) await access(new URL(filename, base)); assert.ok(entry.metadata.files.includes(entry.metadata.schema)); assert.ok(entry.metadata.files.includes(entry.metadata.server)); assert.ok(entry.metadata.files.includes(entry.metadata.ui));
      const loaded = await entry.load(); const definition = loaded.default; assert.deepEqual(functionManifest(definition), functionManifest(entry));
    }
  }
  assert.deepEqual(requireClosure(sectorModules, 'sector.agriculture', ['agriculture.harvest']).map(entry => entry.id), ['logistics.storage', 'agriculture.harvest']);
});

test('copy CLI copies actual schema/runtime/UI/server/tests under a new namespace and never copies legacy machinery', async () => {
  const folder = 'storage-copy-' + randomUUID(), originalIndex = new URL('../../modules/logistica-industrial/functions/almacenamiento/index.js', import.meta.url), original = await readFile(originalIndex, 'utf8');
  let receipt, host;
  try {
    receipt = await copyFunction({functionId: 'logistics.storage', sector: 'agricultura', folder, id: 'agriculture.storage-copy'});
    assert.ok(receipt.files.includes('schema.js')); assert.ok(receipt.files.includes('server.js')); assert.ok(receipt.files.includes('contract.test.mjs')); assert.equal(receipt.files.some(file => file.startsWith('runtime/') || file.startsWith('schema/')), false);
    const copyDescriptor = (await import(pathToFileURL(receipt.descriptor).href)).default;
    const copyModule = defineModule({id: 'sector.copied-storage', version: '1.0.0', functions: [copyDescriptor]});
    host = createHost({catalog: [copyModule]}); await host.activate(copyModule.id); await host.dispatch('agriculture.storage-copy:transaction', {operations: [{type: 'add-location', location: {id: 'field', capacityKg: 100, maxLoads: 2}}]}); assert.equal((await host.dispatch('agriculture.storage-copy:snapshot')).locations.length, 1); assert.equal(host.status().functions.length, 1); assert.equal(host.status().services[0].owner, 'agriculture.storage-copy'); await host.dispose();
    host = createHost({catalog: [sectorModules[0], copyModule]}); await host.activate('sector.logistics-industrial'); await assert.rejects(host.activate(copyModule.id), {code: 'duplicate_service'}); assert.equal(host.status().services[0].owner, 'logistics.storage'); await host.dispose(); host = null;
    assert.equal(await readFile(originalIndex, 'utf8'), original); await assert.rejects(copyFunction({functionId: 'logistics.storage', sector: '../agricultura', folder, id: 'agriculture.other'}), {code: 'invalid_copy_path'}); await assert.rejects(copyFunction({functionId: 'logistics.storage', sector: 'agricultura', folder, id: 'agriculture.other'}), {code: 'copy_exists'});
    const sourceRoot = new URL('../../modules/logistica-industrial/functions/almacenamiento/', import.meta.url);
    for (const [filename, originalHash] of Object.entries(receipt.origin.sourceHashes)) assert.equal(createHash('sha256').update(await readFile(new URL(filename, sourceRoot))).digest('hex'), originalHash, `Copying must preserve source ${filename}`);
  } finally {
    if (host) await host.dispose({force: true});
    if (receipt) { const base = await realpath(fileURLToPath(new URL('../../modules/agricultura/functions/', import.meta.url))), destination = await realpath(receipt.destination), relative = path.relative(base, destination); assert.equal(path.dirname(relative), '.'); assert.equal(path.basename(destination), folder); await rm(destination, {recursive: true}); }
  }
});

test('approved project compositions boot and perform real sector operations', async () => {
  const agriculture = await runSectorExample('agricultura'); assert.equal(agriculture.result[0].locationId, 'cold-room'); assert.equal(agriculture.result[0].quantity, 12); assert.equal(agriculture.status.modules.length, 1); assert.equal(agriculture.status.modules[0].id, 'sector.agriculture');
  const tourism = await runSectorExample('turismo'); assert.equal(tourism.result.completed, true); assert.equal(tourism.status.functions.length, 1);
  const education = await runSectorExample('educacion'); assert.equal(education.result.score, .75);
  const food = await runSectorExample('alimentos'); assert.equal(food.result.load.metadata.batch, 'batch-1'); assert.equal(food.result.events.length, 1);
});
