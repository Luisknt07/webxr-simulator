'use strict';
// Fit only the two persisted unit-load L transfers. Default mode is a dry run:
// real authoring, topology/geometry checks and physical flow, with no API write.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {spawn} = require('node:child_process'), {X509Certificate, createHash} = require('node:crypto'), WebSocket = require('ws');
const helperFile = path.join(__dirname, 'open-cedi-scenarios.js'), helperText = fs.readFileSync(helperFile, 'utf8');
const {request, hash, differences, installCediQA} = new Function('require', '__dirname', helperText.slice(0, helperText.indexOf('\nasync function run()')) + '\nreturn {request,hash,differences,installCediQA};')(require, __dirname);
const {validateDocument} = require('../server/validation'), roomIds = require('../shared/studio-document').ROOM_IDS;
const conveyorLayout = require('../shared/behaviors').conveyorLayout;
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'data/qa-studio');
const LAB = '194c1284-1c6e-4f2a-b089-9c540ed6e32b', ORIGINAL = 'ce14b39b-5d77-45ea-a85e-1d7e0d76e872';
const clone = value => JSON.parse(JSON.stringify(value));
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function targets(document) {
  const result = [];
  Object.entries(document.rooms).forEach(([roomId, room]) => room.additions.forEach(row => {
    const config = (row.behaviors || []).find(value => value.type === 'conveyor');
    if (!config || config.mechanism !== 'liftTransfer' || config.equipmentId !== 'conveyor.popup-belt' || config.surface !== 'rollers') return;
    const name = row.name || '';
    if (roomId === 'sound' && /Transferencia a 90°.*correas elevables entre rodillos/.test(name) || roomId === 'vertigo' && /^L rectangular.*transferencia por correas a 90°$/.test(name)) result.push({roomId, id: row.id, name});
  }));
  assert.equal(result.length, 2, 'Exactly the saved Lab and Packing L transfers must match; pallet transfers are excluded.');
  return result;
}

function payloadFor(before, candidate, plans) {
  assert.deepEqual(plans.map(plan => [plan.roomId, plan.id]).sort(), targets(before).map(target => [target.roomId, target.id]).sort(), 'The plan must contain exactly the two approved L transfers.');
  const payload = clone(before), allowed = new Set(), changedRooms = new Set(plans.map(plan => plan.roomId));
  plans.forEach(plan => {
    const baseRows = before.rooms[plan.roomId].additions, nextRows = candidate.rooms[plan.roomId].additions, rows = payload.rooms[plan.roomId].additions;
    assert.deepEqual(nextRows.map(row => row.id), baseRows.map(row => row.id), 'Object IDs and insertion order must remain intact.');
    const byId = new Map(baseRows.map(row => [row.id, row])), corner = byId.get(plan.id), config = corner.behaviors.find(value => value.type === 'conveyor');
    const downstream = new Set(), pending = [config.branchId];
    while (pending.length) {
      const id = pending.shift(); assert.notEqual(id, plan.id, 'A cyclic line requires manual review.'); if (downstream.has(id)) continue;
      const row = byId.get(id); assert(row, 'A downstream link points outside the saved level.'); downstream.add(id);
      const machine = (row.behaviors || []).find(value => ['conveyor', 'source', 'processor', 'palletQueue'].includes(value.type));
      if (machine) conveyorLayout.connections(machine).forEach(link => pending.push(link.targetId));
    }
    assert.deepEqual(plan.moves.map(move => move.id).sort(), [plan.id, ...downstream].sort(), 'Move exactly the corner and all its downstream descendants.');
    assert(plan.delta.length === 3 && plan.delta.every(Number.isFinite));
    plan.moves.forEach(move => {
      const index = baseRows.findIndex(row => row.id === move.id); assert(index >= 0);
      assert.deepEqual(move.before, baseRows[index].position, 'The plan was built for a different initial placement.');
      assert.deepEqual(nextRows[index].position, move.after);
      assert(move.after.length === 3 && move.after.every(Number.isFinite)); rows[index].position = move.after.slice();
      if (move.id !== plan.id) move.after.forEach((value, axis) => assert(Math.abs(value - move.before[axis] - plan.delta[axis]) < 1e-9, 'Every downstream machine must receive the identical displacement.'));
      for (let axis = 0; axis < 3; axis++) allowed.add('/rooms/' + plan.roomId + '/additions/' + index + '/position/' + axis);
    });
    const index = baseRows.findIndex(row => row.id === plan.id), behavior = baseRows[index].behaviors.findIndex(value => value.type === 'conveyor');
    assert.equal(baseRows[index].behaviors[behavior].width, 1); assert.equal(baseRows[index].behaviors[behavior].length, 2.4);
    assert.equal(nextRows[index].behaviors[behavior].length, 1); assert.equal(nextRows[index].behaviors[behavior].width, 1);
    rows[index].behaviors[behavior].length = 1; allowed.add('/rooms/' + plan.roomId + '/additions/' + index + '/behaviors/' + behavior + '/length');
    plan.actorMoves.forEach(move => {
      const base = baseRows[index].nodes && baseRows[index].nodes[move.path], next = nextRows[index].nodes && nextRows[index].nodes[move.path];
      assert(base && next && move.automatic, 'Only existing automatically positioned actors may change.');
      assert((base.behaviors || []).some(value => value.type === 'sensor') || base.name === 'PLC simulado / panel de mando', 'Only presence sensors and their hidden factory PLC may be repositioned automatically.');
      assert.deepEqual(move.before, base.position); assert(move.after.length === 3 && move.after.every(Number.isFinite));
      assert.deepEqual(next.position, move.after); rows[index].nodes[move.path].position = move.after.slice();
      for (let axis = 0; axis < 3; axis++) allowed.add('/rooms/' + plan.roomId + '/additions/' + index + '/nodes/' + move.path + '/position/' + axis);
    });
  });
  const delta = differences(before, candidate), unexpected = delta.filter(row => !allowed.has(row.path) && !(/\/quaternion\/[0-3]$/.test(row.path) && Number.isFinite(row.before) && Number.isFinite(row.after) && Math.abs(row.before - row.after) <= 1e-12));
  assert.deepEqual(unexpected, [], 'Unexpected fields changed; the project must not be saved.');
  // Copying only the whitelist onto the original also restores property order
  // and quaternion roundoff, and leaves every unrelated room byte-for-byte.
  Object.keys(before.rooms).filter(room => !changedRooms.has(room)).forEach(room => assert.equal(hash(payload.rooms[room]), hash(before.rooms[room])));
  assert.equal(hash(payload.studio), hash(before.studio));
  const validated = validateDocument(payload, value => value);
  assert.deepEqual(differences(payload, validated), [], 'Server validation must not introduce any additional change.');
  return {document: payload, differences: differences(before, payload), roomHashes: Object.keys(before.rooms).map(roomId => ({roomId, before: hash(before.rooms[roomId]), after: hash(payload.rooms[roomId]), changed: changedRooms.has(roomId)}))};
}

// Runs in the real editor. The inlet is fixed; the entire output subgraph
// receives the same world-space displacement as the rebuilt branch port.
function fitInEditor(target) {
  const e = context.editor, d = e.document, assembly = e.assembly;
  if (!e.active || e.roomId !== target.roomId || !assembly || e.transform.dragging || d.transaction) throw new Error('El nivel debe estar abierto y sin otra operación activa.');
  const corner = d.getObject(target.id), oldConfig = assembly.config(corner), records = assembly.records(), byId = new Map(records.map(object => [object.userData.editorId, object]));
  if (!corner || oldConfig.mechanism !== 'liftTransfer' || oldConfig.equipmentId !== 'conveyor.popup-belt' || oldConfig.length !== 2.4 || oldConfig.width !== 1 || oldConfig.outputId || !oldConfig.branchId) throw new Error('La transferencia guardada ya no coincide con el caso aprobado.');
  const edges = assembly.edges(records), incoming = edges.filter(edge => edge.target === corner && edge.targetPort === 'input');
  if (incoming.length !== 1) throw new Error('La entrada necesita un único predecesor fijo.');
  const previous = incoming[0], next = byId.get(oldConfig.branchId); if (!next) throw new Error('Falta la salida perpendicular.');
  const upstream = new Set([target.id]), reverse = [target.id];
  while (reverse.length) { const id = reverse.shift(); edges.filter(edge => edge.targetId === id).forEach(edge => { const source = edge.source.userData.editorId; if (!upstream.has(source)) { upstream.add(source); reverse.push(source); } }); }
  const downstream = new Set(), queue = [oldConfig.branchId];
  while (queue.length) { const id = queue.shift(); if (upstream.has(id)) throw new Error('La salida retorna a la entrada; no se moverá una red cíclica.'); if (downstream.has(id)) continue; if (!byId.has(id)) throw new Error('Un enlace apunta fuera del nivel.'); downstream.add(id); edges.filter(edge => edge.source.userData.editorId === id).forEach(edge => queue.push(edge.targetId)); }
  edges.filter(edge => downstream.has(edge.targetId) && !downstream.has(edge.source.userData.editorId)).forEach(edge => { if (!(edge.source === corner && edge.sourcePort === 'branch')) throw new Error('La subred comparte otra alimentación fija; el ajuste necesita revisión.'); });
  const snapshotPort = port => ({position: port.position.toArray(), tangent: port.tangent.toArray(), width: port.width});
  const beforeInlet = assembly.worldPort(corner, 'input').position.clone(), beforeBranch = assembly.worldPort(corner, 'branch').position.clone();
  const before = {length: oldConfig.length, width: oldConfig.width, input: snapshotPort(assembly.worldPort(corner, 'input')), branch: snapshotPort(assembly.worldPort(corner, 'branch')), output: snapshotPort(assembly.worldPort(corner, 'output'))};
  const original = new Map([target.id, ...downstream].map(id => { const object = byId.get(id); return [id, {object, position: object.position.toArray(), quaternion: object.quaternion.clone(), scale: object.scale.clone()}]; }));
  const entry = d.additions.get(target.id), actorBefore = new Map();
  entry.nodes.forEach((node, path) => { if (d.getBehaviors(node).some(value => value.type === 'sensor') || node.name === 'PLC simulado / panel de mando') actorBefore.set(path, {name: node.name, position: node.position.toArray()}); });
  d.begin();
  try {
    d.setBehaviors(corner, d.getBehaviors(corner).map(value => value.type === 'conveyor' ? Object.assign({}, value, {length: 1, width: 1}) : value));
    if (assembly.config(corner).length !== 1) throw new Error('El schema todavía no admite una transferencia elevable 1 × 1 m.');
    assembly.align(previous.source, previous.sourcePort, corner, 'input');
    const delta = assembly.worldPort(corner, 'branch').position.clone().sub(beforeBranch);
    downstream.forEach(id => {
      const object = byId.get(id), world = object.getWorldPosition(object.position.clone()).add(delta);
      d.setTransform(object, {position: object.parent ? object.parent.worldToLocal(world).toArray() : world.toArray()});
    });
    corner.updateWorldMatrix(true, true);
    if (assembly.worldPort(corner, 'input').position.distanceTo(beforeInlet) > 1e-6) throw new Error('La entrada fija se movió.');
    original.forEach(saved => { if (1 - Math.abs(saved.object.quaternion.dot(saved.quaternion)) > 1e-12 || saved.object.scale.distanceTo(saved.scale) > 1e-12) throw new Error('El ajuste modificó orientación o escala.'); });
    const checks = assembly.edges().map(edge => {
      const assessment = assembly.assessConnection(edge.source, edge.sourcePort, edge.target, edge.targetPort);
      if (!assessment.ready || assessment.gap > 1e-6) throw new Error('Quedó un puerto desconectado: ' + edge.source.name);
      return {source: edge.source.userData.editorId, port: edge.sourcePort, target: edge.targetId, gap: assessment.gap, heading: assessment.heading};
    });
    const after = {length: assembly.config(corner).length, width: assembly.config(corner).width, input: snapshotPort(assembly.worldPort(corner, 'input')), branch: snapshotPort(assembly.worldPort(corner, 'branch')), output: snapshotPort(assembly.worldPort(corner, 'output'))};
    const outside = () => { const end = assembly.worldPort(corner, 'output'), receiver = assembly.worldPort(next, oldConfig.branchPort || 'input'); return Math.abs(end.position.clone().sub(receiver.position).dot(end.tangent)) - receiver.width / 2; };
    const protrusion = outside(); if (Math.abs(protrusion) > 1e-6) throw new Error('La punta sigue sobresaliendo del perímetro de salida.');
    const actorMoves = []; entry.nodes.forEach((node, path) => { const old = actorBefore.get(path); if (old && JSON.stringify(old.position) !== JSON.stringify(node.position.toArray())) actorMoves.push({path, name: old.name, before: old.position, after: node.position.toArray(), automatic: true}); });
    const moves = Array.from(original, ([id, saved]) => ({id, name: saved.object.name, before: saved.position, after: saved.object.position.toArray(), role: id === target.id ? 'corner' : 'downstream'}));
    d.commit(); e.materials.invalidate && e.materials.invalidate(); e.industrialVisuals.invalidate(); e.lineMonitors.invalidate(); e.collisionWorld.invalidate();
    return {roomId: target.roomId, id: target.id, name: target.name, before, after, delta: delta.toArray(), moves, actorMoves, checks, beforeProtrusion: (oldConfig.length - oldConfig.width) / 2, afterProtrusion: protrusion, downstream: [...downstream]};
  } catch (error) { d.cancel(); throw error; }
}

function frameCorner(target, mode) {
  const e = context.editor, object = e.document.getObject(target.id), center = object.getWorldPosition(e.camera.position.clone());
  const eye = center.clone().add(mode === 'top' ? center.clone().set(0, 5.8, 0) : center.clone().set(3.2, 2.5, -3.2));
  e.camera.position.copy(eye); e.orbit.target.copy(center); e.safeCameraPosition = null; e.safeOrbitTarget = null;
  const up = e.camera.up.clone(); if (mode === 'top') e.camera.up.set(0, 0, -1); e.orbit.update(); e.camera.lookAt(center); e.camera.up.copy(up);
  e.entities.sync(); e.render(0); return {eye: e.camera.position.toArray(), target: center.toArray(), gl: context.renderer.getContext().getError()};
}

async function run() {
  const projectId = option('--project') || LAB, expected = Number(option('--expected-revision')), apply = process.argv.includes('--apply'), verifySaved = process.argv.includes('--verify-saved');
  assert(!(apply && verifySaved), 'Reopening verification never writes a project.');
  assert.equal(projectId, LAB, 'Only the separate Lab project is allowed; Mi escenario is never a write target.'); assert(Number.isInteger(expected) && expected > 0, 'Pass an explicit --expected-revision.');
  const [fetched, protectedProject] = await Promise.all([request('/api/projects/' + projectId), request('/api/projects/' + ORIGINAL)]), before = fetched.project;
  assert.equal(before.revision, expected, 'The expected revision changed; nothing will be modified.');
  const beforeOriginal = {revision: protectedProject.project.revision, hash: hash(protectedProject.project.document)}, selected = targets(before.document);
  const pem = fs.readFileSync(path.join(ROOT, 'node_modules/webpack-dev-server/ssl/server.pem')), fingerprint = createHash('sha256').update(new X509Certificate(pem).publicKey.export({type: 'spki', format: 'der'})).digest('base64');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-fit-l-')); let browser, socket;
  try {
    browser = spawn(process.env.STUDIO_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1600,1000', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--ignore-certificate-errors-spki-list=' + fingerprint, 'about:blank'], {windowsHide: true, stdio: 'ignore'});
    const until = async (action, label) => { const start = Date.now(); while (Date.now() - start < 120000) { const value = await action(); if (value) return value; await delay(200); } throw new Error(label); };
    const port = await until(() => { try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (_) { return null; } }, 'Chrome no inició.');
    const pages = await fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json()); socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    let sequence = 0; const pending = new Map(), exceptions = [], errors = [], writes = [];
    socket.on('message', bytes => { const m = JSON.parse(bytes); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { const value = m.params.args.map(arg => arg.value || arg.description).join(' '); if (value !== '[WDS] Disconnected!') errors.push(value); } if (m.method === 'Network.requestWillBeSent' && /\/api\//.test(m.params.request.url) && !['GET', 'HEAD', 'OPTIONS'].includes(m.params.request.method)) writes.push({method: m.params.request.method, url: m.params.request.url}); });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
    const evaluate = async expression => { const response = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, timeout: 180000}); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text); return response.result.value; };
    fs.mkdirSync(OUTPUT, {recursive: true}); const shots = [], frames = [];
    const shot = async name => { await delay(200); const value = await send('Page.captureScreenshot', {format: 'png'}), file = path.join(OUTPUT, name + '.png'); fs.writeFileSync(file, Buffer.from(value.data, 'base64')); shots.push(file); };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setBlockedURLs', {urls: ['*://localhost:8080/sockjs-node/*']});
    await send('Page.navigate', {url: 'https://localhost:8080/editor?project=' + projectId});
    await until(() => evaluate('Boolean(window.context?.editor?.active&&!context.editor.loadingProject&&!context.editor.initializing&&context.editor.currentProject?.id===' + JSON.stringify(projectId) + ')'), 'No abrió el Lab.');
    assert.equal(await evaluate('context.editor.currentProject.revision'), expected);
    if (verifySaved) {
      const savedReport = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'fit-l-transfer-saved.json'), 'utf8')), previous = JSON.parse(fs.readFileSync(savedReport.beforeFile, 'utf8'));
      assert.equal(savedReport.revision, expected); assert.equal(savedReport.saved, true); assert.equal(hash(before.document), savedReport.afterHash);
      assert.deepEqual(beforeOriginal, savedReport.original, 'The protected original project changed after the approved save.');
      const guarded = payloadFor(previous.document, before.document, savedReport.plans), reopened = [];
      for (const target of selected) {
        const plan = savedReport.plans.find(value => value.id === target.id);
        await evaluate('(async()=>{const e=context.editor;await e.hooks.gotoRoom(' + roomIds.indexOf(target.roomId) + ');e.select(null);return true})()');
        const state = await evaluate('('+function (plan) {
          const e = context.editor, object = e.document.getObject(plan.id), config = e.assembly.config(object), entry = e.document.additions.get(plan.id);
          if (config.length !== 1 || config.width !== 1) throw new Error('La transferencia reabierta no conserva 1 × 1 m.');
          const epsilon = (a, b) => a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) < 1e-8);
          if (!epsilon(e.assembly.worldPort(object, 'input').position.toArray(), plan.before.input.position)) throw new Error('La entrada fija cambió al reabrir.');
          if (!epsilon(e.assembly.worldPort(object, 'branch').position.toArray(), plan.after.branch.position)) throw new Error('La salida cambió al reabrir.');
          plan.moves.forEach(move => { const object = e.document.getObject(move.id); if (!object || !epsilon(object.position.toArray(), move.after)) throw new Error('Una máquina descendiente perdió su posición o identidad.'); });
          plan.actorMoves.forEach(move => { const node = entry.nodes.get(move.path); if (!node || !epsilon(node.position.toArray(), move.after)) throw new Error('Un sensor perdió su identidad o pose.'); });
          const checks = e.assembly.edges().map(edge => { const result = e.assembly.assessConnection(edge.source, edge.sourcePort, edge.target, edge.targetPort); if (!result.ready || result.gap > 1e-6) throw new Error('La conexión reabierta no está ensamblada.'); return {gap: result.gap, heading: result.heading}; });
          return {roomId: e.roomId, id: plan.id, length: config.length, width: config.width, movedIdentities: plan.moves.map(move => move.id), connections: checks};
        }.toString()+')('+JSON.stringify(plan)+')'); reopened.push(state);
        for (const mode of ['top', 'angle']) { const frame = await evaluate('(' + frameCorner.toString() + ')(' + JSON.stringify(target) + ',' + JSON.stringify(mode) + ')'); assert.equal(frame.gl, 0); frames.push(Object.assign({roomId: target.roomId, phase: 'reopened', mode}, frame)); await shot('fit-l-' + target.roomId + '-saved-' + mode); }
      }
      const live = await evaluate('(async()=>context.editor.document.serialize())()'); assert.deepEqual(differences(before.document, live), []);
      const unchanged = (await request('/api/projects/' + projectId)).project; assert.equal(unchanged.revision, expected); assert.equal(hash(unchanged.document), savedReport.afterHash);
      assert.deepEqual(exceptions, []); assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      const report = {projectId, revision: expected, originalUnchanged: true, original: beforeOriginal, projectHash: hash(unchanged.document), reopened, roomHashes: guarded.roomHashes, shots, frames, exceptions, consoleErrors: errors, writes};
      fs.writeFileSync(path.join(OUTPUT, 'fit-l-transfer-reopened.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({reopened: reopened.length, revision: expected, writes, exceptions, consoleErrors: errors}));
      await send('Browser.close').catch(() => {}); return;
    }
    const plans = [], flows = [];
    for (const target of selected) {
      await evaluate('(async()=>{const e=context.editor;if(!e.active)e.enter();await e.hooks.gotoRoom(' + roomIds.indexOf(target.roomId) + ');e.select(null);return true})()');
      for (const mode of ['top', 'angle']) { const frame = await evaluate('(' + frameCorner.toString() + ')(' + JSON.stringify(target) + ',' + JSON.stringify(mode) + ')'); assert.equal(frame.gl, 0); frames.push(Object.assign({roomId: target.roomId, phase: 'before', mode}, frame)); await shot('fit-l-' + target.roomId + '-before-' + mode); }
      const plan = await evaluate('(' + fitInEditor.toString() + ')(' + JSON.stringify(target) + ')'); plans.push(plan);
      for (const mode of ['top', 'angle']) { const frame = await evaluate('(' + frameCorner.toString() + ')(' + JSON.stringify(target) + ',' + JSON.stringify(mode) + ')'); assert.equal(frame.gl, 0); frames.push(Object.assign({roomId: target.roomId, phase: 'after', mode}, frame)); await shot('fit-l-' + target.roomId + '-after-' + mode); }
      const authored = await evaluate('(async()=>JSON.stringify(await context.editor.document.serialize()))()');
      await evaluate('context.editor.leave();context.editor.simulationPaused=true');
      await evaluate('(' + installCediQA.toString() + ')()');
      const lineIndex = await evaluate('(()=>{const qa=__cediQA,r=context.editor.simulation,index=qa.lines.findIndex(line=>line.ids.has(' + JSON.stringify(target.id) + '));if(index<0)throw new Error("Falta la línea de la transferencia");qa.lines.forEach((line,i)=>{if(i!==index)r.command(line.config.targetId,"stop",undefined,"line")});return index})()');
      let flow;
      for (let elapsed = 0; elapsed < 400; elapsed += 10) { await evaluate('__cediQA.advance(10)'); flow = await evaluate('__cediQA.flow()[' + lineIndex + ']'); if ((elapsed + 10) % 50 === 0) console.log(target.roomId, elapsed + 10, 's:', flow.receivedUnits, '/', flow.expectedUnits); if (flow.receivedUnits === 16 && flow.completePallets === 4) break; }
      assert.equal(flow.expectedUnits, 16); assert.equal(flow.receivedUnits, 16); assert.equal(flow.completePallets, 4); flows.push(Object.assign({roomId: target.roomId}, flow));
      const restored = await evaluate('(async()=>{__cediQA.restore();context.editor.enter();return JSON.stringify(await context.editor.document.serialize())})()'); assert.equal(restored, authored, 'The flow test changed authoring data.');
    }
    const candidate = await evaluate('(async()=>context.editor.document.serialize())()'), safe = payloadFor(before.document, candidate, plans);
    const protectedNow = (await request('/api/projects/' + ORIGINAL)).project; assert.equal(protectedNow.revision, beforeOriginal.revision); assert.equal(hash(protectedNow.document), beforeOriginal.hash);
    assert.deepEqual(exceptions, []); assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    const beforeFile = path.join(OUTPUT, 'fit-l-transfer-before-rev' + expected + '.json'), payloadFile = path.join(OUTPUT, 'fit-l-transfer-payload-rev' + expected + '.json');
    fs.writeFileSync(beforeFile, JSON.stringify(before)); fs.writeFileSync(payloadFile, JSON.stringify(safe.document));
    let saved;
    if (apply) saved = await evaluate('(async()=>{const e=context.editor,p=await e.projectClient.updateProject(' + JSON.stringify(projectId) + ',' + JSON.stringify(before.name) + ',' + JSON.stringify(safe.document) + ',' + expected + ');return {id:p.id,revision:p.revision,document:p.document}})()');
    const persisted = (await request('/api/projects/' + projectId)).project;
    assert.equal(persisted.revision, apply ? expected + 1 : expected); assert.equal(hash(persisted.document), hash(apply ? safe.document : before.document));
    assert.deepEqual(writes, apply ? [{method: 'PUT', url: 'https://localhost:8080/api/projects/' + projectId}] : [], 'Only the one guarded Lab update is allowed.');
    const protectedAfter = (await request('/api/projects/' + ORIGINAL)).project; assert.equal(protectedAfter.revision, beforeOriginal.revision); assert.equal(hash(protectedAfter.document), beforeOriginal.hash);
    let exportFile = null;
    if (apply) { const directory = path.join(ROOT, 'data/exports'); fs.mkdirSync(directory, {recursive: true}); exportFile = path.join(directory, 'industrial-cedi-complete.json'); fs.writeFileSync(exportFile, JSON.stringify(persisted.document)); }
    const report = {projectId, beforeRevision: expected, revision: persisted.revision, saved: !!saved, originalUnchanged: true, original: beforeOriginal, beforeHash: hash(before.document), afterHash: hash(persisted.document), beforeFile, payloadFile, exportFile, plans, flows, differences: safe.differences, roomHashes: safe.roomHashes, shots, frames, exceptions, consoleErrors: errors, writes};
    fs.writeFileSync(path.join(OUTPUT, apply ? 'fit-l-transfer-saved.json' : 'fit-l-transfer-plan.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({saved: report.saved, revision: persisted.revision, transfers: plans.length, changes: safe.differences.length, flows: flows.map(flow => ({roomId: flow.roomId, units: flow.receivedUnits, pallets: flow.completePallets})), exceptions, consoleErrors: errors}));
    await send('Browser.close').catch(() => {});
  } finally {
    if (socket) socket.close(); if (browser && browser.exitCode === null) browser.kill(); await delay(300);
    const resolved = path.resolve(profile); assert(path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('hello-fit-l-')); fs.rmSync(resolved, {recursive: true, force: true});
  }
}
module.exports = {targets, payloadFor, fitInEditor};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
