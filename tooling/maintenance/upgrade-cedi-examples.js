const __layout = require("../layout.cjs");
'use strict';
// The default run prepares and verifies a candidate without saving. Applying a
// reviewed candidate is a separate command and never regenerates the levels.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https');
const {spawn} = require('node:child_process'), {createHash, X509Certificate} = require('node:crypto'), WebSocket = require('ws');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), {validateDocument} = require('../../apps/api/server/validation');
const ROOT = __layout.map(path.resolve(__layout.oldDir("scripts/upgrade-cedi-examples.js"), '..')), OUTPUT = __layout.map(path.join(ROOT, 'data/qa-studio'));
const LAB = '194c1284-1c6e-4f2a-b089-9c540ed6e32b', ORIGINAL = 'ce14b39b-5d77-45ea-a85e-1d7e0d76e872';
const ORIGINAL_HASH = '9a990ce7925ca3ca84a98fa02d363c9cef4da0f2a8bba961491e23dab54b3cac';
const ROOMS = ['photogrammetry', 'vertigo'], NAMES = ['CEDI · Clasificación y consolidación', 'CEDI · Packing y transferencias'];
const SCOPED = ['environments', 'entities', 'spawns', 'groups', 'widgets', 'missions'];
const option = key => { const index = process.argv.indexOf(key); return index < 0 ? null : process.argv[index + 1]; };
const clone = value => JSON.parse(JSON.stringify(value)), hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesHash = value => createHash('sha256').update(value).digest('hex'), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pem = fs.readFileSync(__layout.map(path.join(ROOT, 'node_modules/webpack-dev-server/ssl/server.pem')));
const helper = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/upgrade-cedi-examples.js"), 'open-cedi-scenarios.js')), 'utf8');
const {differences, restoreRoomPrecision} = new Function('require', '__dirname', helper.slice(0, helper.indexOf('// Executed in Chrome')) + '\nreturn {differences,restoreRoomPrecision};')(require, __dirname);
function requestRaw(url) { return new Promise((resolve, reject) => https.get({hostname: 'localhost', port: 8080, family: 4, path: url, ca: pem}, response => { const chunks = []; response.on('data', value => chunks.push(value)); response.on('end', () => response.statusCode >= 400 ? reject(new Error('HTTP ' + response.statusCode + ': ' + url)) : resolve(Buffer.concat(chunks))); }).on('error', reject)); }
async function request(url) { return JSON.parse((await requestRaw(url)).toString('utf8')); }
function targetRooms(document) {
  ROOMS.forEach((roomId, index) => {
    assert(document.rooms[roomId], 'The approved level is missing: ' + roomId);
    const matches = (document.studio && document.studio.scenes || []).filter(scene => scene.name === NAMES[index]);
    assert.equal(matches.length, 1); assert.equal(matches[0].id, roomId, 'Only the two approved existing levels can be replaced.');
  });
}
function guardedCandidate(before, candidate) {
  targetRooms(before); targetRooms(candidate);
  const normalized = clone(candidate), restoredPrecision = restoreRoomPrecision(before, normalized, ROOMS), document = clone(before);
  assert.deepEqual(Object.keys(candidate.rooms).sort(), Object.keys(before.rooms).sort(), 'Adding/removing another room is not allowed.');
  Object.keys(before).concat(Object.keys(candidate)).filter(key => !['rooms', 'studio'].includes(key)).forEach(key => assert.deepEqual(differences(before[key], candidate[key]), [], 'Unrelated project data changed: ' + key));
  ROOMS.forEach(roomId => { document.rooms[roomId] = clone(normalized.rooms[roomId]); });
  const previous = before.studio || {}, next = candidate.studio || {};
  Array.from(new Set(Object.keys(previous).concat(Object.keys(next)))).forEach(key => {
    if (!SCOPED.includes(key)) { assert.deepEqual(differences(previous[key], next[key]), [], 'Unrelated Studio data changed: ' + key); return; }
    if (previous[key] === undefined && next[key] === undefined) return;
    assert(Array.isArray(previous[key] || []) && Array.isArray(next[key] || []));
    const outside = (previous[key] || []).filter(item => !ROOMS.includes(item.roomId)), currentOutside = (next[key] || []).filter(item => !ROOMS.includes(item.roomId));
    assert.deepEqual(differences(outside, currentOutside), [], 'Unrelated Studio records changed: ' + key);
    let index = 0; document.studio[key] = (next[key] || []).map(item => clone(ROOMS.includes(item.roomId) ? item : outside[index++]));
  });
  const validated = validateDocument(document, value => value); assert.deepEqual(differences(document, validated), [], 'Server normalization changed the approved payload.');
  const roomHashes = Object.keys(before.rooms).map(roomId => ({roomId, before: hash(before.rooms[roomId]), after: hash(document.rooms[roomId]), changed: ROOMS.includes(roomId)}));
  roomHashes.filter(item => !item.changed).forEach(item => assert.equal(item.after, item.before, 'Every unrelated room stays literal.'));
  return {document, roomHashes, restoredPrecision, differences: differences(before, document)};
}
function verifyManifest(manifest, document) {
  assert(manifest && manifest.scenarios && manifest.scenarios.length === 2);
  manifest.scenarios.forEach((scene, index) => {
    assert.equal(scene.roomId, ROOMS[index]); assert.equal(scene.kind, index ? 'packing' : 'sorting'); assert.equal(scene.expectedUnits, 96); assert.equal(scene.expectedLoads, 68);
    assert.equal(scene.lines.length, index ? 5 : 4); assert.equal(scene.lines.filter(line => line.mode === 'manual').length, 2);
    assert.equal(scene.lines.reduce((sum, line) => sum + line.expectedUnits, 0), 96);
    scene.lines.forEach(line => {
      assert(line.controllerId && line.monitorId && line.memberIds.length && line.sourceIds.length && line.receiverIds.length);
      assert.equal(line.receiverIds.length, line.expectedReceiverUnits.length); assert.equal(line.receiverIds.length, line.expectedReceiverLoads.length);
      assert.equal(line.sourceExpectations.reduce((sum, value) => sum + value.units, 0), line.expectedUnits);
      assert.equal(line.expectedReceiverUnits.reduce((sum, value) => sum + value, 0), line.expectedUnits);
      if (line.mode === 'manual') { assert.equal(line.expectedUnits, 0); assert(line.sourceExpectations.every(value => value.loads === 0 && value.units === 0)); }
    });
    if (document) {
      const byId = new Map(document.rooms[scene.roomId].additions.map(row => [row.id, row])), configuration = id => { const row = byId.get(id); assert(row, 'A manifest ID is missing from the payload: ' + id); return row.behaviors.find(value => ['source', 'conveyor', 'processor', 'palletQueue'].includes(value.type)); };
      scene.lines.forEach(line => {
        line.memberIds.forEach(id => assert(configuration(id))); assert(configuration(line.controllerId).withPanel);
        line.sourceIds.forEach(id => assert.equal(configuration(id).type, 'source')); line.receiverIds.forEach(id => assert.equal(configuration(id).type, 'palletQueue'));
        const monitor = byId.get(line.monitorId), component = monitor && monitor.behaviors.find(value => value.type === 'lineMonitor'); assert(component && component.targetId === line.controllerId && component.scope === 'line');
        if (line.mode === 'manual') line.sourceIds.forEach(id => { assert.equal(configuration(id).autoGenerate, false); assert.equal(configuration(id).initialCount, 0); });
      });
      assert.deepEqual(scene.expectedReceiverUnits, scene.lines.flatMap(line => line.expectedReceiverUnits)); assert.deepEqual(scene.expectedReceiverLoads, scene.lines.flatMap(line => line.expectedReceiverLoads));
      const conveyors = scene.lines.flatMap(line => line.memberIds.map(configuration)).filter(config => config.type === 'conveyor'), sorted = values => [...new Set(values)].sort();
      assert.deepEqual(scene.coverage.variants, sorted(conveyors.map(config => config.equipmentId)));
      assert.deepEqual(scene.coverage.fields, sorted(conveyors.filter(config => config.routing === 'rules').flatMap(config => JSON.parse(config.routingRules).map(value => value.field))));
      assert.deepEqual(scene.coverage.modes, sorted(conveyors.filter(config => ['rules', 'percentage', 'alternate'].includes(config.routing)).map(config => config.routing)));
    }
  });
  const union = key => Array.from(new Set(manifest.scenarios.flatMap(scene => scene.coverage[key]))).sort();
  assert.deepEqual(union('variants'), schema.conveyorEquipment.listEquipment({readyOnly: true}).map(value => value.id).sort());
  assert.deepEqual(union('fields'), schema.conveyorRouting.fields.map(value => value.value).sort()); assert.deepEqual(union('modes'), ['alternate', 'percentage', 'rules']); assert.deepEqual(union('productTypes'), ['bottle', 'box', 'crate', 'drum']);
  return Object.fromEntries(['variants', 'fields', 'modes', 'productTypes'].map(key => [key, union(key)]));
}
function verifyArtifact(artifact, before) {
  assert.equal(artifact.format, 'hello-webxr-verified-cedi-upgrade'); assert.equal(artifact.version, 1); assert.equal(artifact.projectId, LAB); assert.equal(artifact.expectedRevision, 12);
  assert.equal(hash(before), artifact.baseHash); assert.equal(hash(artifact.document), artifact.payloadHash); assert.equal(artifact.original.revision, 9); assert.equal(artifact.original.hash, ORIGINAL_HASH);
  verifyManifest(artifact.manifest, artifact.document); assert.equal(hash(artifact.manifest), artifact.manifestHash); assert.equal(artifact.qa.passed, true); assert.equal(artifact.qa.flows.length, 2);
  artifact.qa.flows.forEach((result, index) => { assert.equal(result.roomId, ROOMS[index]); assert.equal(result.units, 96); assert.equal(result.loads, 68); assert.equal(result.tracePassed, true); assert.equal(result.geometryPassed, true); });
  const safe = guardedCandidate(before, artifact.document); assert.equal(hash(safe.document), artifact.payloadHash); return safe;
}
function propertyOrderChanges(before, after, prefix = '', rows = []) {
  if (!before || typeof before !== 'object' || !after || typeof after !== 'object') return rows;
  if (!Array.isArray(before) && JSON.stringify(Object.keys(before)) !== JSON.stringify(Object.keys(after))) rows.push({path: prefix, before: Object.keys(before), after: Object.keys(after)});
  Object.keys(before).forEach(key => propertyOrderChanges(before[key], after[key], prefix + '/' + key, rows)); return rows;
}
function canonicalSavePlan(before, reviewed) {
  // Compute exactly what the real validator will store before sending the PUT.
  // Values must remain identical; only the known `interaction` key ordering in
  // additions of the two authorized levels may differ from the reviewed bytes.
  const document = validateDocument(reviewed, value => value);
  assert.deepEqual(differences(reviewed, document), [], 'Canonical serialization changed a reviewed value.');
  const safe = guardedCandidate(before, document); assert.equal(hash(safe.document), hash(document));
  Object.keys(before.rooms).filter(id => !ROOMS.includes(id)).forEach(id => assert.equal(hash(document.rooms[id]), hash(before.rooms[id]), 'A protected room must remain literal: ' + id));
  assert.equal(hash(document.studio), hash(reviewed.studio), 'Studio must retain its exact reviewed serialization.');
  const changes = propertyOrderChanges(reviewed, document);
  changes.forEach(change => {
    assert(/^\/rooms\/(photogrammetry|vertigo)\/additions\/\d+$/.test(change.path), 'Key order changed outside the authorized additions: ' + change.path);
    assert(change.before.includes('interaction') && change.after.includes('interaction'));
    assert.deepEqual(change.before.filter(key => key !== 'interaction'), change.after.filter(key => key !== 'interaction'), 'Only interaction may change its key position.');
  });
  return {document, reviewedPayloadHash: hash(reviewed), storedPayloadHash: hash(document), propertyOrderChanges: changes};
}
function verifyStoredCandidate(before, reviewed, stored, plan = canonicalSavePlan(before, reviewed)) {
  assert.deepEqual(differences(reviewed, stored), [], 'The server changed a reviewed document value.');
  assert.equal(hash(stored), plan.storedPayloadHash, 'The server serialization differs from the canonical pre-PUT plan.');
  Object.keys(before.rooms).filter(id => !ROOMS.includes(id)).forEach(id => assert.equal(hash(stored.rooms[id]), hash(before.rooms[id]), 'A protected room changed after save: ' + id));
  assert.equal(hash(stored.studio), hash(reviewed.studio), 'Studio changed after save.');
  assert.deepEqual(propertyOrderChanges(reviewed, stored), plan.propertyOrderChanges, 'Unexpected property order changes after save.'); return plan;
}

async function withBrowser(projectId, action) {
  const profile = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'hello-cedi-upgrade-'))); let browser, socket;
  try {
    const fingerprint = createHash('sha256').update(new X509Certificate(pem).publicKey.export({type: 'spki', format: 'der'})).digest('base64');
    browser = spawn(process.env.STUDIO_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1600,1000', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--ignore-certificate-errors-spki-list=' + fingerprint, 'about:blank'], {windowsHide: true, stdio: 'ignore'});
    const until = async (callback, message, timeout = 120000) => { const start = Date.now(); while (Date.now() - start < timeout) { const result = await callback(); if (result) return result; await delay(200); } throw new Error(message); };
    const port = await until(() => { try { return Number(fs.readFileSync(__layout.map(path.join(profile, 'DevToolsActivePort')), 'utf8').split('\n')[0]); } catch (_) { return null; } }, 'Chrome no inició.');
    const tabs = await fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json()); socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    let sequence = 0; const pending = new Map(), exceptions = [], consoleErrors = [], transport = [], writes = [], shots = [];
    socket.on('message', bytes => { const m = JSON.parse(bytes); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { const value = m.params.args.map(arg => arg.value || arg.description).join(' '); (value === '[WDS] Disconnected!' ? transport : consoleErrors).push(value); } if (m.method === 'Network.requestWillBeSent' && /\/api\//.test(m.params.request.url) && !['GET', 'HEAD', 'OPTIONS'].includes(m.params.request.method)) writes.push({method: m.params.request.method, url: m.params.request.url}); });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
    const evaluate = async expression => { const value = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, timeout: 180000}); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception && value.exceptionDetails.exception.description || value.exceptionDetails.text); return value.result.value; };
    const screenshot = async name => { await delay(100); const value = await send('Page.captureScreenshot', {format: 'png'}), file = __layout.map(path.join(OUTPUT, name + '.png')); fs.writeFileSync(file, Buffer.from(value.data, 'base64')); shots.push(file); };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBlockedURLs', {urls: ['*://localhost:8080/sockjs-node/*']});
    await send('Page.navigate', {url: 'https://localhost:8080/editor?project=' + projectId});
    await until(() => evaluate('Boolean(window.context?.editor?.active&&!context.editor.initializing&&!context.editor.loadingProject&&context.editor.currentProject?.id===' + JSON.stringify(projectId) + ')'), 'No abrió el proyecto esperado.');
    const result = await action({evaluate, screenshot, until, writes, exceptions, consoleErrors, transport, shots});
    await send('Browser.close').catch(() => {}); return result;
  } finally {
    if (socket) socket.close(); if (browser && browser.exitCode === null) browser.kill(); await delay(300);
    const directory = __layout.map(path.resolve(profile)); assert.equal(path.dirname(directory), __layout.map(path.resolve(os.tmpdir()))); assert(path.basename(directory).startsWith('hello-cedi-upgrade-')); fs.rmSync(directory, {recursive: true, force: true, maxRetries: 8, retryDelay: 200});
  }
}

// Production runtime/CollisionWorld only. Manual annexes are expected to stay
// empty during the automatic run, regardless of their optional finite limit.
function installUpgradeQA(scene, options = {}) {
  const e = context.editor, r = e.simulation, world = e.collisionWorld;
  if (!r.running || context.collisionWorld !== world) throw new Error('Falta la simulación física real.');
  e.simulationPaused = true;
  const visible = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };
  const sourceIds = new Set(scene.sourceIds), generated = new Map(), previousLocomotion = context.studioLocomotion; context.studioLocomotion = 'teleport';
  const leafRows = entry => { const rows = []; const visit = value => { if (value.members && value.members.length) value.members.forEach(visit); else rows.push({originId: value.originId, units: value.units, spec: JSON.parse(JSON.stringify(value.spec)), id: value.id}); }; visit(entry); return rows; };
  const remember = () => r.sourceRuntime.entries.forEach(entry => { if (sourceIds.has(entry.originId) && entry.id.startsWith(entry.originId + ':') && !entry.members && entry.product && !generated.has(entry.id)) generated.set(entry.id, {id: entry.id, originId: entry.originId, units: entry.units, spec: JSON.parse(JSON.stringify(entry.spec)), metadata: r.productMetadata(entry.product)}); });
  const lines = scene.lines.map(line => {
    const panel = r.getPanelSnapshot(line.controllerId, 'line'), actual = panel.memberIds.slice().sort(), expected = line.memberIds.slice().sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('El PLC no corresponde a su red: ' + line.title);
    const panels = line.memberIds.map(id => r.records.get(id)).filter(record => r.machineComponent(record).config.withPanel);
    if (panels.length !== 1 || panels[0].id !== line.controllerId) throw new Error('La red debe conservar exactamente un PLC: ' + line.title);
    line.sourceExpectations.forEach(value => { const record = r.records.get(value.id), config = record.components.source.config; if (line.mode === 'manual' && (config.autoGenerate || config.initialCount !== 0)) throw new Error('Un anexo manual está generando solo.'); if (line.mode === 'automatic' && (!config.autoGenerate || config.totalLimit !== value.loads)) throw new Error('La fuente automática no coincide con su manifiesto.'); });
    line.memberIds.forEach(id => { const record = r.records.get(id), belt = record.components.conveyor; if (!belt) return; let count = 0; record.object.traverse(node => { if (visible(node) && e.document.getBehaviors(node).some(config => config.type === 'sensor')) count++; }); if (Boolean(count) !== Boolean(belt.config.withSensors)) throw new Error('Sensores distintos de la configuración: ' + id); });
    return Object.assign({}, line, {monitor: e.document.getObject(line.monitorId)});
  });
  if (e.document.getObjects(e.roomId).filter(object => e.document.getBehaviors(object).some(config => config.type === 'lineMonitor')).length !== lines.length) throw new Error('Falta un monitor por red.');
  const geometry = e.assembly.edges().map(edge => { const value = e.assembly.assessConnection(edge.source, edge.sourcePort, edge.target, edge.targetPort); if (!value.ready || value.gap > 1e-6) throw new Error('Puerto incompatible o separado: ' + edge.source.name); return {sourceId: edge.source.userData.editorId, targetId: edge.targetId, gap: value.gap}; });
  const qa = {scene, lines, elapsed: 0, geometry, capturedKinds: new Set()};
  qa.flow = () => lines.map(line => ({id: line.id, title: line.title, mode: line.mode, expectedUnits: line.expectedUnits,
    sources: line.sourceExpectations.map(expected => { const state = r.records.get(expected.id).variables; return {id: expected.id, generated: state.generated, generatedUnits: state.generatedUnits, expectedLoads: expected.loads, expectedUnits: expected.units}; }),
    receivers: line.receiverIds.map((id, index) => { const state = r.records.get(id).variables; return {id, received: state.received, units: state.receivedUnits, pallets: state.completePallets, expectedUnits: line.expectedReceiverUnits[index], expectedLoads: line.expectedReceiverLoads[index]}; })}));
  qa.transferProbe = (record, belt, item) => {
    const id = item.route === 'branch' && belt.config.layout === 'tee' && belt.config.junctionMode !== 'merge' ? belt.config.branchId : belt.config.outputId, target = r.records.get(id), receiver = target && target.components.conveyor;
    if (!receiver) return null;
    const tests = [], original = world.testBox;
    world.testBox = function(box, collision = {}) {
      const inner = box.clone().expandByScalar(-.002), triangles = [], extras = (collision.extraBoxes || []).filter(other => inner.intersectsBox(other.clone().expandByScalar(-.002))).map(other => ({min: other.min.toArray(), max: other.max.toArray()}));
      world.triangles(inner, collision, (triangle, object) => { if (inner.intersectsTriangle(triangle) && !triangles.some(value => value.uuid === object.uuid)) { triangles.push({uuid: object.uuid, name: object.name, id: object.userData.editorId, position: object.getWorldPosition(context.camera.position.clone()).toArray(), parent: object.parent && object.parent.name}); } return false; });
      const inside = world.insideEntry(inner.getCenter(context.camera.position.clone()), collision), blocked = original.call(world, box, collision);
      tests.push({box: {min: box.min.toArray(), max: box.max.toArray()}, blocked, ignore: (collision.ignore || []).map(object => ({name: object.name, id: object.userData.editorId})), extras, triangles, inside: inside && {name: inside.object.name, id: inside.object.userData.editorId}}); return blocked;
    };
    let transfer; try { const value = r.transferDetails(record, belt, item); transfer = value && {blocked: value.blocked, targetId: value.target && value.target.id, orientationOffset: value.orientationOffset}; } finally { world.testBox = original; }
    const point = r.pathPoint(receiver.config, 0, 'main');
    return {targetId: id, admission: r.admissionReady(target, receiver), compatible: r.productCompatible(target, receiver, item.product, false), width: item.bounds.getSize(context.camera.position.clone()).z * Math.abs(item.scale.z), availableWidth: receiver.config.width * r.widthScale(target, point), transfer, tests};
  };
  qa.diagnostics = () => ({roomId: e.roomId, seconds: qa.elapsed, rootWorld: e.document.getRoot(e.roomId).matrixWorld.toArray(), flow: qa.flow(), records: lines.flatMap(line => line.memberIds.map(id => { const record = r.records.get(id), source = record.components.source, belt = record.components.conveyor, processor = record.components.processor;
    return {line: line.id, id, name: record.object.name, variables: Object.assign({}, record.variables), position: record.object.position.toArray(), quaternion: record.object.quaternion.toArray(), config: r.machineComponent(record).config,
      source: source && {blocked: source.blocked, queue: source.queue.map(entry => ({id: entry.id, units: entry.units, position: entry.product && entry.product.object.position.toArray(), metadata: entry.product && r.productMetadata(entry.product)}))},
      worldMatrix: record.object.matrixWorld.toArray(), belt: belt && {phase: belt.mechanismPhase, blocked: belt.transferBlocked, items: belt.packages.map(item => ({id: item.sourceEntry && item.sourceEntry.id, entry: item.sourceEntry && {originId: item.sourceEntry.originId, spec: item.sourceEntry.spec, load: item.sourceEntry.load}, metadata: item.product && r.productMetadata(item.product), offset: item.offset, route: item.route, stage: item.mechanismStage, position: item.mesh.position.toArray(), quaternion: item.mesh.quaternion.toArray(), box: {min: item.box.min.toArray(), max: item.box.max.toArray()}, probe: belt.transferBlocked && qa.transferProbe(record, belt, item)}))}, processor: processor && {phase: processor.phase}};
  }))});
  qa.complete = () => qa.flow().every(line => line.receivers.every(receiver => receiver.units === receiver.expectedUnits && receiver.received === receiver.expectedLoads));
  qa.advance = seconds => { let advanced = 0, active = null; for (let time = 0; time < seconds - 1e-8; time += .1) { const step = Math.min(.1, seconds - time); world.beginFrame(); try { e.root.updateMatrixWorld(true); r.execute(step); if (options.syncVisuals !== false) { e.industrialVisuals.sync(e.roomId, step, false); e.root.updateMatrixWorld(true); } remember(); } finally { world.endFrame(); } advanced += step; if (!qa.steerCaptured) { active = [...r.records.values()].find(record => record.components.conveyor && ['steer', 'distributor'].includes(record.components.conveyor.config.mechanism) && !qa.capturedKinds.has(record.components.conveyor.config.mechanism) && record.components.conveyor.actuatorPosition > .2); if (active) break; } } qa.elapsed += advanced; return {seconds: qa.elapsed, units: qa.flow().flatMap(line => line.receivers).reduce((sum, receiver) => sum + receiver.units, 0), complete: qa.complete(), activeId: active && active.id, activeKind: active && active.components.conveyor.config.mechanism}; };
  qa.frameMachine = id => {
    const record = r.records.get(id), object = record.object, center = object.getWorldPosition(context.camera.position.clone()), eye = center.clone().add(center.clone().set(2.5, 2.1, 2.8).applyQuaternion(object.getWorldQuaternion(context.camera.quaternion.clone())));
    context.cameraRig.position.add(eye.clone().sub(context.camera.getWorldPosition(center.clone()))); context.cameraRig.updateMatrixWorld(true); context.camera.lookAt(center); context.camera.updateMatrixWorld(true); e.performance.update(context.camera, 0); e.industrialVisuals.sync(e.roomId, .1, false);
    const banks = [...e.industrialVisuals.steerBanks.values()].filter(entry => entry.conveyor && entry.conveyor.id === id).map(entry => ({angle: entry.angle}));
    if (record.components.conveyor.config.mechanism === 'steer' && record.variables.actuatorPosition > .2 && !banks.some(bank => Math.abs(bank.angle) > .1)) throw new Error('Las ruedas orientables no acompañan el actuador real.');
    return {id, mechanism: record.components.conveyor && record.components.conveyor.config.mechanism, phase: record.variables.mechanismPhase, actuatorPosition: record.variables.actuatorPosition, banks, products: record.components.conveyor && record.components.conveyor.packages.map(item => ({id: item.sourceEntry && item.sourceEntry.id, metadata: r.productMetadata(item.product)})), eye: eye.toArray()};
  };
  qa.framePanel = id => {
    const record = r.records.get(id); let display; record.object.traverse(node => { if (!display && node.userData.industrialDisplay) display = node; }); if (!display) throw new Error('Falta el HMI físico.');
    const center = display.getWorldPosition(context.camera.position.clone()), normal = center.clone().set(0, 0, 1).applyQuaternion(display.getWorldQuaternion(context.camera.quaternion.clone())).normalize(), eye = center.clone().addScaledVector(normal, 1.65);
    context.cameraRig.position.add(eye.clone().sub(context.camera.getWorldPosition(center.clone()))); context.cameraRig.updateMatrixWorld(true); context.camera.lookAt(center); context.camera.updateMatrixWorld(true); e.performance.update(context.camera, 0); e.industrialVisuals.sync(e.roomId, .3, false); return {id, eye: eye.toArray(), center: center.toArray()};
  };
  qa.frameMonitor = (index, page = 'diagram', selectedId) => {
    const line = lines[index]; e.lineMonitors.sync(e.roomId, .3, false); const entry = e.lineMonitors.entries.get(line.monitor); if (!entry) throw new Error('Falta el monitor de la red.');
    const center = entry.plane.getWorldPosition(context.camera.position.clone()), normal = center.clone().set(0, 0, 1).applyQuaternion(entry.plane.getWorldQuaternion(context.camera.quaternion.clone())).normalize(), eye = center.clone().addScaledVector(normal, 3.5);
    context.cameraRig.position.add(eye.clone().sub(context.camera.getWorldPosition(center.clone()))); context.cameraRig.updateMatrixWorld(true); context.camera.lookAt(center); context.camera.updateMatrixWorld(true);
    e.performance.update(context.camera, 0); entry.page = page; if (selectedId) entry.selectedId = selectedId; entry.dirty = true; e.lineMonitors.sync(e.roomId, .3, false); return {id: line.monitorId, page, selectedId: entry.selectedId};
  };
  qa.press = (index, key) => {
    const entry = e.lineMonitors.entries.get(lines[index].monitor), hand = context.desktopController;
    if ((['start', 'stop', 'pause', 'powerOn', 'powerOff', 'emergency', 'resetEmergency', 'speedDown', 'speedUp'].includes(key) || key.startsWith('equipment-action-')) && entry.page !== 'control') qa.press(index, 'control');
    entry.dirty = true; e.lineMonitors.sync(e.roomId, .3, false);
    const region = entry.regions.find(region => region.key === key && !region.disabled);
    if (!region) throw new Error('El mando no está disponible: ' + key);
    const u = (region.x + region.width / 2) / entry.canvas.width, v = 1 - (region.y + region.height / 2) / entry.canvas.height;
    const point = entry.plane.localToWorld(context.camera.position.clone().set((u - .5) * .98, (v - .5) * .98, 0)), origin = r.interactionOrigin(hand), ray = new context.raycontrol.raycaster.constructor(origin, point.clone().sub(origin).normalize(), 0, 6), hit = ray.intersectObject(entry.plane)[0];
    if (!hit || !entry.state.isSelectable(hit, hand)) throw new Error('El rayo real no alcanza el mando: ' + key);
    entry.state.onSelectStart(hit, hand); entry.state.onSelectEnd(hit, hand); if (entry.notice) throw new Error(entry.notice); return {key, distance: hit.distance, uv: hit.uv.toArray()};
  };
  qa.audit = () => {
    remember(); const flow = qa.flow(); if (!qa.complete()) throw new Error('La red no completó sus receptores.');
    flow.forEach(line => line.sources.forEach(source => { if (source.generated !== source.expectedLoads || source.generatedUnits !== source.expectedUnits) throw new Error('La generación no conserva el límite real: ' + source.id); }));
    const inventories = lines.flatMap(line => line.receiverIds.map(id => { const record = r.records.get(id), queue = record.components.palletQueue; return {id, lineId: line.id, entries: queue.queue.map(entry => {
      if (!entry.lineage.includes(id) || !sourceIds.has(entry.originId) || !entry.lineage.includes(entry.originId)) throw new Error('Se perdió procedencia o receptor.');
      return {id: entry.id, originId: entry.originId, units: entry.units, spec: JSON.parse(JSON.stringify(entry.spec)), leaves: leafRows(entry), load: JSON.parse(JSON.stringify(entry.load || {})), scale: entry.scale, metadata: r.productMetadata(entry.product), lineage: entry.lineage.slice()};
    })}; }));
    const products = lines.flatMap(line => line.receiverIds.flatMap(id => r.records.get(id).components.palletQueue.queue.map(entry => entry.product.item)));
    for (let a = 0; a < products.length; a++) for (let b = a + 1; b < products.length; b++) if (products[a].box.clone().expandByScalar(-.001).intersectsBox(products[b].box.clone().expandByScalar(-.001))) throw new Error('Hay cajas finales superpuestas.');
    const analytics = lines.map(line => { const state = r.getAnalyticsSnapshot(line.controllerId, 'line'), summary = state.summary; const seconds = ['busySeconds', 'idleSeconds', 'setupSeconds', 'blockedSeconds', 'downSeconds', 'pausedSeconds'].reduce((sum, key) => sum + summary[key], 0); if (Math.abs(seconds - state.observedSeconds) > 1e-5 || summary.entryUnits !== line.expectedUnits || summary.exitUnits !== line.expectedUnits || state.history.length > 600 || state.observedSeconds > 20 && !state.control.ready) throw new Error('La analítica no conserva tiempos/unidades: ' + line.title); return {id: line.id, observedSeconds: state.observedSeconds, samples: state.history.length, summary, control: state.control}; });
    const warnings = r.events.filter(event => event.type === 'configuration-warning'); if (warnings.length) throw new Error('Advertencias de configuración: ' + JSON.stringify(warnings));
    e.entities.sync(); const lights = [...e.entities.live.values()].filter(entry => entry.config.type === 'pointLight'); if (lights.some(entry => entry.config.roomId !== e.roomId || entry.object.castShadow)) throw new Error('Luces o sombras de otra sala.');
    const ownership = lines.map(line => { const entry = e.lineMonitors.entries.get(line.monitor); if (!entry) throw new Error('Monitor sin recurso privado.'); const model = e.lineMonitors.layout(entry, e.roomId); model.products.forEach(product => { if (!line.memberIds.includes(product.ownerId)) throw new Error('El plano duplica una carga de otra red.'); }); return {id: line.id, products: model.products.length}; });
    const nodes = new Set(), geometries = new Set(), buffers = new Set(); let meshes = 0, triangles = 0;
    scene.lines.flatMap(line => line.memberIds).forEach(id => r.records.get(id).object.traverse(node => { if (nodes.has(node)) return; nodes.add(node); if (!node.geometry) return; const geometry = node.geometry; geometries.add(geometry); if (node.isMesh) { meshes++; triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1); } Object.values(geometry.attributes || {}).concat(geometry.index || []).forEach(attribute => { const array = attribute.array || attribute.data && attribute.data.array; if (array) buffers.add(array.buffer); }); }));
    const geometryStats = {nodes: nodes.size, meshes, triangles, geometryCount: geometries.size, uniqueBufferBytes: [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0), renderer: {memory: Object.assign({}, context.renderer.info.memory), render: Object.assign({}, context.renderer.info.render), programs: context.renderer.info.programs.length}};
    return {roomId: scene.roomId, seconds: qa.elapsed, units: flow.flatMap(line => line.receivers).reduce((sum, receiver) => sum + receiver.units, 0), loads: flow.flatMap(line => line.receivers).reduce((sum, receiver) => sum + receiver.received, 0), flow, generated: [...generated.values()], inventories, analytics, ownership, geometry, geometryPassed: true, geometryStats, lights: lights.map(entry => ({id: entry.config.id, intensity: entry.object.intensity})), stats: e.performance.getStats(), gl: context.renderer.getContext().getError()};
  };
  qa.restore = () => { context.studioLocomotion = previousLocomotion; };
  remember(); window.__upgradeQA = qa; return qa.flow();
}

function fingerprint(row) { const spec = row.spec; return JSON.stringify([row.originId, spec.id, spec.type, spec.width, spec.height, spec.depth, spec.color, spec.quality, spec.defect, spec.mass, spec.base]); }
function histogram(rows) { const counts = new Map(); rows.forEach(row => counts.set(fingerprint(row), (counts.get(fingerprint(row)) || 0) + row.units)); return [...counts].sort((a, b) => a[0].localeCompare(b[0])); }
function verifyTrace(result, scene, document) {
  assert.equal(result.units, 96); assert.equal(result.loads, 68); assert.equal(result.gl, 0);
  const expected = scene.lines.flatMap(line => line.sourceExpectations.flatMap(value => { const row = document.rooms[scene.roomId].additions.find(row => row.id === value.id), config = row.behaviors.find(value => value.type === 'source'); return Array.from({length: value.loads}, (_, index) => ({originId: value.id, spec: schema.productSources.specAt(config, index), units: schema.productSources.unitsFor(config)})); }));
  assert.deepEqual(histogram(result.generated), histogram(expected), 'Generation matches the persisted SKU catalogue and unit specifications.');
  assert.deepEqual(histogram(result.inventories.flatMap(inventory => inventory.entries.flatMap(entry => entry.leaves))), histogram(expected), 'Every Source/SKU/type/size/color/quality/defect/mass/base unit is conserved.');
  const entries = result.inventories.flatMap(inventory => inventory.entries); assert.equal(new Set(entries.map(entry => entry.id)).size, 68);
  entries.forEach(entry => {
    const size = schema.productSources.loadSize(entry.spec, entry.load), scale = entry.scale || [1, 1, 1];
    const original = entry.load && entry.load.loadMode === 'pallet' ? result.generated.find(value => value.id === entry.id) : null;
    if (entry.load && entry.load.loadMode === 'pallet') assert(original && original.metadata, 'Missing measured Source pallet dimensions.');
    ['width', 'height', 'depth'].forEach((key, index) => { const expected = original ? original.metadata[key] : size[key] * scale[index]; assert(Math.abs(entry.metadata[key] - expected) < .005, 'Real product dimensions changed: ' + entry.id + ' / ' + key); });
  });
  if (scene.kind === 'sorting') {
    const groups = [['surface-case'], ['damaged-case'], ['priority-sku'], ['blue-case'], ['crate-case'], ['wide-case', 'tall-case', 'long-case']];
    groups.forEach((skus, index) => { const inventory = result.inventories.find(value => value.id === scene.lines[0].receiverIds[index]); skus.forEach(sku => assert.equal(inventory.entries.filter(entry => entry.spec.id === sku).reduce((sum, entry) => sum + entry.units, 0), 8)); assert(inventory.entries.every(entry => skus.includes(entry.spec.id))); });
  } else {
    const singles = result.inventories.find(value => value.id === scene.lines[0].receiverIds[0]); assert(singles.entries.every(entry => entry.units === 1 && entry.spec.id === 'packing-single'));
    const mixed = scene.lines.find(line => line.id === 'multilevel-mixed'); const types = result.inventories.filter(value => mixed.receiverIds.includes(value.id)).flatMap(value => value.entries); ['box', 'crate', 'drum', 'bottle'].forEach(type => assert.equal(types.filter(entry => entry.spec.type === type).reduce((sum, entry) => sum + entry.units, 0), 8));
  }
  result.tracePassed = true; return result;
}

function editorInterior(roomId) {
  const e = context.editor; e.select(null); e.entities.sync(); e.home(); e.render(0);
  const position = e.camera.getWorldPosition(e.camera.position.clone()), roof = e.document.getObjects(roomId).find(object => /Cubierta interior cerrada/.test(object.name)); let bounds = null;
  if (roof) roof.traverse(node => { if (!node.geometry) return; if (!node.geometry.boundingBox) node.geometry.computeBoundingBox(); const box = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld); if (bounds) bounds.union(box); else bounds = box; });
  return {eye: position.toArray(), ceiling: bounds && bounds.min.y, belowCeiling: !!bounds && position.y < bounds.min.y, inside: !!bounds && position.x > bounds.min.x && position.x < bounds.max.x && position.z > bounds.min.z && position.z < bounds.max.z, gl: context.renderer.getContext().getError()};
}
function editorWideInterior(roomId) {
  const e = context.editor, root = e.document.getRoot(roomId), roof = e.document.getObjects(roomId).find(object => /Cubierta interior cerrada/.test(object.name)); let bounds = null;
  roof.traverse(node => { if (!node.geometry) return; if (!node.geometry.boundingBox) node.geometry.computeBoundingBox(); const box = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld); if (bounds) bounds.union(box); else bounds = box; });
  const authored = (e.document.studio.entities || []).find(value => value.roomId === roomId && value.type === 'camera'), marker = authored && e.document.getObject(authored.objectId), local = marker ? marker.position.clone() : e.camera.position.clone();
  local.y = Math.min(7.1, bounds.min.y - .45); const position = root.localToWorld(local), center = root.localToWorld(local.clone().set(0, 1.2, 0));
  e.safeCameraPosition = null; e.safeOrbitTarget = null; e.camera.position.copy(position); e.camera.fov = 82; e.camera.updateProjectionMatrix(); e.orbit.target.copy(center); e.orbit.update(); e.render(0);
  return {eye: position.toArray(), target: center.toArray(), fov: e.camera.fov, ceiling: bounds.min.y, belowCeiling: position.y < bounds.min.y, inside: position.x > bounds.min.x && position.x < bounds.max.x && position.z > bounds.min.z && position.z < bounds.max.z, gl: context.renderer.getContext().getError()};
}
async function dryRun(before, original, bundleHash, expected) {
  return withBrowser(LAB, async b => {
    assert.equal(await b.evaluate('context.editor.currentProject.revision'), expected);
    const manifest = await b.evaluate('context.editor.studioTools.refreshCediExamples()'), coverage = verifyManifest(manifest);
    const candidate = await b.evaluate('(async()=>context.editor.document.serialize())()'), safe = guardedCandidate(before.document, candidate), flows = [], views = [], manual = []; verifyManifest(manifest, safe.document);
    // Write reviewable drafts even before long physical verification. They are
    // never eligible for --apply-candidate until the final passed artifact exists.
    fs.writeFileSync(__layout.map(path.join(OUTPUT, 'cedi-upgrade-unverified-payload.json')), JSON.stringify(safe.document));
    fs.writeFileSync(__layout.map(path.join(OUTPUT, 'cedi-upgrade-manifest.json')), JSON.stringify(manifest, null, 2));
    for (const scene of manifest.scenarios) {
      if (option('--diagnose-room') && scene.roomId !== option('--diagnose-room')) continue;
      await b.evaluate('(async()=>{const e=context.editor;if(!e.active)e.enter();await e.hooks.gotoRoom(' + schema.studio.ROOM_IDS.indexOf(scene.roomId) + ');return true})()');
      const view = await b.evaluate('(' + editorInterior.toString() + ')(' + JSON.stringify(scene.roomId) + ')'); assert(view.belowCeiling && view.inside); assert.equal(view.gl, 0); views.push(Object.assign({roomId: scene.roomId}, view)); await b.screenshot('cedi-upgrade-' + scene.roomId + '-interior');
      const wide = await b.evaluate('(' + editorWideInterior.toString() + ')(' + JSON.stringify(scene.roomId) + ')'); assert(wide.belowCeiling && wide.inside); assert.equal(wide.gl, 0); views.push(Object.assign({roomId: scene.roomId, kind: 'wide-interior'}, wide)); await b.screenshot('cedi-upgrade-' + scene.roomId + '-layout'); await b.evaluate('context.editor.home()');
      await b.evaluate('(()=>{const e=context.editor,o=e.document.getObjects(e.roomId).find(o=>e.document.getBehaviors(o).some(c=>c.type==="conveyor"&&c.routing==="rules"));if(!o)throw new Error("Faltan reglas");e.select(o);e.inspectorContent.querySelector(".ed-rule-builder")?.scrollIntoView({block:"start"});e.render(0);return true})()'); await b.screenshot('cedi-upgrade-' + scene.roomId + '-rules');
      const authored = await b.evaluate('(async()=>context.editor.document.serialize())()');
      await b.evaluate('context.editor.leave();context.editor.simulationPaused=true'); await b.evaluate('(' + installUpgradeQA.toString() + ')(' + JSON.stringify(scene) + ',' + JSON.stringify({syncVisuals: !process.argv.includes('--without-visual-sync')}) + ')');
      if (option('--diagnose-line')) {
        const line = option('--diagnose-line'), seconds = Number(option('--diagnose-seconds') || 160);
        await b.evaluate('(()=>{const q=__upgradeQA,r=context.editor.simulation;q.steerCaptured=true;q.lines.forEach(line=>{if(line.id!==' + JSON.stringify(line) + ')r.command(line.controllerId,"stop",undefined,"line")});return true})()');
        for (let elapsed = 0; elapsed < seconds; elapsed += 10) await b.evaluate('__upgradeQA.advance(10)');
        const diagnostic = await b.evaluate('__upgradeQA.diagnostics()'); fs.writeFileSync(__layout.map(path.join(OUTPUT, 'cedi-upgrade-diagnostic.json')), JSON.stringify(diagnostic, null, 2));
        await b.evaluate('__upgradeQA.frameMachine(' + JSON.stringify(scene.lines.find(value => value.id === line).controllerId) + ')'); await b.screenshot('cedi-upgrade-diagnostic');
        assert.deepEqual(b.writes, []); console.log(JSON.stringify(diagnostic.records.filter(record => record.line === line))); return {verified: false, diagnostic: true};
      }
      let progress = {seconds: 0, complete: false}, nextLog = 0;
      while (progress.seconds < 900 && !progress.complete) {
        progress = await b.evaluate('__upgradeQA.advance(10)');
        if (progress.activeId) { const pose = await b.evaluate('__upgradeQA.frameMachine(' + JSON.stringify(progress.activeId) + ')'); await b.screenshot('cedi-upgrade-' + scene.roomId + '-' + progress.activeKind + '-active'); await b.evaluate('__upgradeQA.capturedKinds.add(' + JSON.stringify(progress.activeKind) + ')'); views.push(Object.assign({roomId: scene.roomId, kind: progress.activeKind}, pose)); }
        if (progress.seconds >= nextLog || progress.complete) { console.log(scene.kind, progress.seconds.toFixed(1) + 's', progress.units + '/96'); nextLog = progress.seconds + 50; }
      }
      if (!progress.complete) fs.writeFileSync(__layout.map(path.join(OUTPUT, 'cedi-upgrade-diagnostic.json')), JSON.stringify(await b.evaluate('__upgradeQA.diagnostics()'), null, 2));
      assert(progress.complete, 'Incomplete CEDI after 900 seconds: ' + JSON.stringify(await b.evaluate('__upgradeQA.flow()')));
      const actual = await b.evaluate('__upgradeQA.audit()'); fs.writeFileSync(__layout.map(path.join(OUTPUT, 'cedi-upgrade-' + scene.roomId + '-flow.json')), JSON.stringify(actual, null, 2)); const result = verifyTrace(actual, scene, safe.document); flows.push(result);
      assert.deepEqual(await b.evaluate('[...__upgradeQA.capturedKinds].sort()'), ['distributor', 'steer']);
      const panel = await b.evaluate('__upgradeQA.framePanel(' + JSON.stringify(scene.lines[0].controllerId) + ')'); views.push(Object.assign({roomId: scene.roomId, kind: 'physical-hmi'}, panel)); await b.screenshot('cedi-upgrade-' + scene.roomId + '-plc');
      for (let index = 0; index < scene.lines.length; index++) {
        await b.evaluate('__upgradeQA.frameMonitor(' + index + ')'); await b.screenshot('cedi-upgrade-' + scene.roomId + '-monitor-' + (index + 1));
        const press = await b.evaluate('__upgradeQA.press(' + index + ',"pause")'); assert(press.distance <= 6); await b.evaluate('__upgradeQA.press(' + index + ',"start")');
      }
      await b.evaluate('__upgradeQA.frameMonitor(0,"analytics")'); await b.screenshot('cedi-upgrade-' + scene.roomId + '-analytics');
      for (let index = 0; index < scene.lines.length; index++) if (scene.lines[index].mode === 'manual') {
        const line = scene.lines[index];
        await b.evaluate('__upgradeQA.frameMonitor(' + index + ',"equipment",' + JSON.stringify(line.controllerId) + ')');
        const generated = await b.evaluate('__upgradeQA.press(' + index + ',"equipment-action-generate")'); await b.evaluate('__upgradeQA.steerCaptured=true;__upgradeQA.advance(5)');
        const stationId = await b.evaluate('(()=>{const line=__upgradeQA.lines[' + index + '];return line.memberIds.find(id=>context.editor.simulation.records.get(id).components.conveyor)})()');
        if (line.id === 'manual-manual-station') {
          assert.equal(await b.evaluate('context.editor.simulation.records.get(' + JSON.stringify(stationId) + ').variables.mechanismPhase'), 'waitingOperator');
          await b.evaluate('__upgradeQA.frameMonitor(' + index + ',"equipment",' + JSON.stringify(stationId) + ')'); await b.evaluate('__upgradeQA.press(' + index + ',"equipment-action-operator")'); await b.evaluate('__upgradeQA.advance(1)');
          assert.equal(await b.evaluate('context.editor.simulation.records.get(' + JSON.stringify(stationId) + ').variables.mechanismPhase'), 'waitingManualAction');
          await b.screenshot('cedi-upgrade-' + scene.roomId + '-manual-operator'); await b.evaluate('__upgradeQA.press(' + index + ',"equipment-action-dispatch")'); await b.evaluate('__upgradeQA.advance(12)');
          assert.equal(await b.evaluate('context.editor.simulation.records.get(' + JSON.stringify(line.receiverIds[0]) + ').variables.receivedUnits'), 1);
        } else {
          assert.equal(await b.evaluate('context.editor.simulation.records.get(' + JSON.stringify(stationId) + ').components.conveyor.entryCount'), 0); assert.equal(await b.evaluate('context.editor.simulation.records.get(' + JSON.stringify(line.sourceIds[0]) + ').components.source.queue.length'), 1); await b.screenshot('cedi-upgrade-' + scene.roomId + '-manual-grab-ready');
        }
        manual.push({roomId: scene.roomId, lineId: line.id, generatedRay: generated, expectedAutomaticUnits: 0, demonstrated: true});
      }
      await b.evaluate('__upgradeQA.restore();context.editor.enter()');
      assert.deepEqual(differences(authored, await b.evaluate('(async()=>context.editor.document.serialize())()')), [], 'The verification must restore every authored recipe and pose.');
    }
    const after = await b.evaluate('(async()=>context.editor.document.serialize())()'); const final = guardedCandidate(before.document, after); assert.equal(hash(final.document), hash(safe.document));
    assert.deepEqual(b.writes, []); assert.deepEqual(b.exceptions, []); assert.deepEqual(b.consoleErrors, []);
    assert.equal(bytesHash(await requestRaw('/bundle.js')), bundleHash, 'Frontend changed during QA; the candidate is not eligible for save.');
    const current = (await request('/api/projects/' + LAB)).project, protectedNow = (await request('/api/projects/' + ORIGINAL)).project;
    assert.equal(current.revision, expected); assert.equal(hash(current.document), hash(before.document)); assert.equal(protectedNow.revision, 9); assert.equal(hash(protectedNow.document), ORIGINAL_HASH);
    const beforeFile = __layout.map(path.join(OUTPUT, 'cedi-upgrade-before-rev12.json')); fs.writeFileSync(beforeFile, JSON.stringify(before));
    const artifact = {format: 'hello-webxr-verified-cedi-upgrade', version: 1, createdAt: new Date().toISOString(), projectId: LAB, expectedRevision: expected, baseHash: hash(before.document), payloadHash: hash(final.document), bundleHash, original: {revision: original.revision, hash: hash(original.document)}, beforeFile, manifest, manifestHash: hash(manifest), document: final.document,
      qa: {passed: true, flows, coverage, manual, views, shots: b.shots, writes: b.writes, exceptions: b.exceptions, consoleErrors: b.consoleErrors, intentionalTransport: b.transport}, preservation: {roomHashes: final.roomHashes, restoredPrecision: final.restoredPrecision}};
    verifyArtifact(artifact, before.document);
    const file = __layout.map(path.join(OUTPUT, 'cedi-upgrade-candidate.json')), bytes = JSON.stringify(artifact); fs.writeFileSync(file, bytes); fs.writeFileSync(__layout.map(path.join(OUTPUT, 'cedi-upgrade-report.json')), JSON.stringify({candidateFile: file, candidateHash: bytesHash(bytes), payloadHash: artifact.payloadHash, baseHash: artifact.baseHash, expectedRevision: expected, qaPassed: true, flows: flows.map(result => ({roomId: result.roomId, seconds: result.seconds, units: result.units, loads: result.loads, tracePassed: result.tracePassed})), coverage, preservation: artifact.preservation, shots: b.shots}, null, 2));
    console.log(JSON.stringify({saved: false, expectedRevision: expected, candidateFile: file, candidateHash: bytesHash(bytes), units: flows.map(result => result.units), loads: flows.map(result => result.loads), errors: []})); return artifact;
  });
}

async function applyCandidate(before, original, expected) {
  const file = __layout.map(path.resolve(option('--apply-candidate'))), allowed = __layout.map(path.resolve(OUTPUT)) + path.sep; assert(file.startsWith(allowed), 'Select a reviewed candidate under data/qa-studio.');
  const bytes = fs.readFileSync(file), expectedHash = option('--candidate-hash'); assert(/^[a-f0-9]{64}$/.test(expectedHash || ''), 'Pass the exact reviewed --candidate-hash.'); assert.equal(bytesHash(bytes), expectedHash);
  const artifact = JSON.parse(bytes.toString('utf8')); verifyArtifact(artifact, before.document); assert.equal(expected, artifact.expectedRevision); assert.equal(bytesHash(await requestRaw('/bundle.js')), artifact.bundleHash, 'The verified frontend changed.');
  const savePlan = canonicalSavePlan(before.document, artifact.document);
  const history = (await request('/api/projects/' + LAB + '/revisions')).revisions;
  return withBrowser(LAB, async b => {
    assert.equal(await b.evaluate('context.editor.currentProject.revision'), expected); assert.deepEqual(b.writes, []);
    const saved = await b.evaluate('context.editor.projectClient.updateProject(' + JSON.stringify(LAB) + ',' + JSON.stringify(before.name) + ',' + JSON.stringify(artifact.document) + ',' + expected + ').then(project=>({id:project.id,revision:project.revision}))');
    assert.equal(saved.revision, 13); assert.deepEqual(b.writes, [{method: 'PUT', url: 'https://localhost:8080/api/projects/' + LAB}]); assert.deepEqual(b.exceptions, []); assert.deepEqual(b.consoleErrors, []);
    const current = (await request('/api/projects/' + LAB)).project, protectedNow = (await request('/api/projects/' + ORIGINAL)).project, revisions = (await request('/api/projects/' + LAB + '/revisions')).revisions;
    assert.equal(current.revision, 13); verifyStoredCandidate(before.document, artifact.document, current.document, savePlan); assert.deepEqual(revisions.filter(item => item.revision !== 13), history); assert.equal(protectedNow.revision, original.revision); assert.equal(hash(protectedNow.document), ORIGINAL_HASH);
    const exports = __layout.map(path.join(ROOT, 'data/exports')); fs.mkdirSync(exports, {recursive: true}); fs.writeFileSync(__layout.map(path.join(exports, 'industrial-cedi-complete.json')), JSON.stringify(current.document));
    fs.writeFileSync(__layout.map(path.join(OUTPUT, 'cedi-upgrade-saved.json')), JSON.stringify({projectId: LAB, beforeRevision: expected, revision: current.revision, candidateHash: expectedHash, baseHash: artifact.baseHash, reviewedPayloadHash: savePlan.reviewedPayloadHash, storedPayloadHash: savePlan.storedPayloadHash, payloadHash: savePlan.storedPayloadHash, semanticDifferences: [], propertyOrderChanges: savePlan.propertyOrderChanges, originalUnchanged: true, preservation: artifact.preservation, revisions, writes: b.writes, errors: []}, null, 2)); console.log(JSON.stringify({saved: true, revision: current.revision, reviewedPayloadHash: savePlan.reviewedPayloadHash, storedPayloadHash: savePlan.storedPayloadHash, writes: b.writes.length})); return current;
  });
}
async function run() {
  const expected = Number(option('--expected-revision')), project = option('--project') || LAB; assert.equal(project, LAB); assert.equal(expected, 12, 'This reviewed upgrade requires explicit --expected-revision 12.');
  fs.mkdirSync(OUTPUT, {recursive: true}); const before = (await request('/api/projects/' + LAB)).project, original = (await request('/api/projects/' + ORIGINAL)).project;
  assert.equal(before.revision, expected); assert.equal(original.revision, 9); assert.equal(hash(original.document), ORIGINAL_HASH); targetRooms(before.document);
  if (option('--apply-candidate')) return applyCandidate(before, original, expected);
  return dryRun(before, original, bytesHash(await requestRaw('/bundle.js')), expected);
}

module.exports = {guardedCandidate, verifyManifest, verifyArtifact, canonicalSavePlan, verifyStoredCandidate, targetRooms, hash, bytesHash, request, requestRaw, withBrowser, editorInterior, editorWideInterior};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
