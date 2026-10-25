'use strict';
// Browser QA always owns a temporary SQLite store and Chrome profile. The only
// production operation available here is the explicit, read-only inventory.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {spawn} = require('node:child_process'), {createHash} = require('node:crypto'), WebSocket = require('ws');
const behaviorSchema = require('../shared/behaviors');
const ROOT = path.resolve(__dirname, '..'), ARTIFACTS = path.join(ROOT, 'data/qa-studio');
const clone = value => JSON.parse(JSON.stringify(value)), hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const option = key => { const index = process.argv.indexOf(key); return index < 0 ? null : process.argv[index + 1]; };
const CASES = [
  {kind: 'straight', key: 'length', value: 5.5, label: 'Longitud de recorrido (m)'},
  {kind: 'l-transfer', key: 'length', value: 5.5, label: 'Longitud de recorrido (m)'},
  {kind: 'curve', key: 'radius', value: 2.2, label: 'Radio de curva (m)'},
  {kind: 'tee', key: 'length', value: 4, label: 'Longitud de recorrido (m)'},
  {kind: 'merge-y', key: 'length', value: 4.2, label: 'Longitud de recorrido (m)'},
  {id: 'l-width', kind: 'l-transfer', key: 'width', value: 1.1, label: 'Ancho (m)'},
  {id: 'straight-scale', kind: 'straight', key: 'scale', value: 1.25, label: 'Escala X'},
  {id: 'processor-length', kind: 'straight', behavior: 'processor', key: 'length', value: 4.2, label: 'Largo de la máquina (m)'},
  {id: 'cycle-reject', kind: 'straight', key: 'length', value: 5, label: 'Longitud de recorrido (m)', reject: true}
];

function assertPreserved(before, after, fixture, test) {
  assert.deepEqual(Object.keys(after.rooms), Object.keys(before.rooms));
  Object.keys(before).filter(key => key !== 'rooms').forEach(key => assert.deepEqual(after[key], before[key], 'Project metadata/imports must remain intact: ' + key));
  Object.keys(before.rooms).filter(roomId => roomId !== fixture.roomId).forEach(roomId => assert.deepEqual(after.rooms[roomId], before.rooms[roomId], 'Unrelated saved level changed: ' + roomId));
  const previous = before.rooms[fixture.roomId], current = after.rooms[fixture.roomId], ids = new Set(fixture.ids);
  Object.keys(previous).filter(key => key !== 'additions').forEach(key => assert.deepEqual(current[key], previous[key]));
  assert.deepEqual(current.additions.map(row => row.id), previous.additions.map(row => row.id), 'Resizing must preserve every object identity and insertion order.');
  previous.additions.forEach((row, index) => {
    if (!ids.has(row.id)) return assert.deepEqual(current.additions[index], row, 'An unrelated actor changed: ' + row.name);
    const first = clone(row), next = clone(current.additions[index]);
    delete first.position; delete next.position; delete first.quaternion; delete next.quaternion;
    if (row.id === fixture.targetId && test.key === 'scale') { delete first.scale; delete next.scale; }
    const dimensions = ['length', 'width', 'radius', 'supportHeight'];
    for (const record of [first, next]) {
      (record.behaviors || []).filter(config => config.type === 'conveyor' || row.id === fixture.targetId && config.type === test.behavior).forEach(config => dimensions.forEach(key => delete config[key]));
      Object.values(record.nodes || {}).forEach(node => {
        if ((node.behaviors || []).some(config => config.type === 'sensor') || node.name === 'PLC simulado / panel de mando') { delete node.position; delete node.quaternion; }
      });
    }
    assert.deepEqual(next, first, 'Controls, material edits, catalogue identities, Source/product specifications and settings must survive: ' + row.name);
  });
}

async function inventory() {
  const file = path.join(__dirname, 'open-cedi-scenarios.js'), text = fs.readFileSync(file, 'utf8');
  const {request, differences} = new Function('require', '__dirname', text.slice(0, text.indexOf('// Executed in Chrome')) + '\nreturn {request,differences};')(require, __dirname);
  const lab = (await request('/api/projects/194c1284-1c6e-4f2a-b089-9c540ed6e32b')).project, original = (await request('/api/projects/ce14b39b-5d77-45ea-a85e-1d7e0d76e872')).project;
  const previous = JSON.parse(fs.readFileSync(path.join(ARTIFACTS, 'fit-l-transfer-saved.json'), 'utf8')), base = JSON.parse(fs.readFileSync(previous.payloadFile, 'utf8'));
  const report = {observedAt: new Date().toISOString(), lab: {id: lab.id, revision: lab.revision, hash: hash(lab.document), afterRevision12Changes: differences(base, lab.document)}, original: {id: original.id, revision: original.revision, hash: hash(original.document)}, writes: []};
  fs.mkdirSync(ARTIFACTS, {recursive: true}); fs.writeFileSync(path.join(ARTIFACTS, 'adaptive-line-production-inventory.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); return report;
}

// Runs inside Chrome using the production factories and metric port assembly.
async function buildFixture(kind) {
  const e = context.editor, d = e.document;
  const roomId = await e.studioTools.newScene({name: 'QA aislada · ' + kind});
  if (!roomId) throw new Error('No se pudo crear el nivel aislado.');
  const objects = [], sources = [], receivers = [], id = object => object.userData.editorId;
  const config = object => e.assembly.config(object);
  const add = (prefab, variant, name, values) => {
    const object = d.addPrefab(roomId, prefab, variant), initial = d.getBehaviors(object);
    d.setProperty(object, 'name', name); d.setBehaviors(object, initial.map(value => value.type === prefab ? Object.assign({}, value, values) : value));
    d.setTransform(object, {position: [-8, 1, 5]}); objects.push(object); return object;
  };
  const source = name => { const object = add('source', undefined, name, {withPanel: false, width: .28, height: .25, depth: .32, interval: .65, totalLimit: 8, capacity: 8, autoGenerate: true, delivery: 'automatic', running: true, powered: true}); sources.push(object); return object; };
  const belt = (variant, name, values = {}) => add('conveyor', variant, name, Object.assign({length: 3, width: 1, speed: .65, autoSpawn: false, withPanel: false, withSensors: true, powered: true, running: true}, values));
  const receiver = (name, capacity = 8) => { const object = add('palletQueue', undefined, name, {withPanel: false, columns: 2, rows: 2, layers: 1, palletCapacity: capacity / 4, capacity, running: true, powered: true}); receivers.push(object); return object; };
  const link = (from, port, to, targetPort = 'input', move = 'target') => {
    const before = config(from), patch = port === 'branch' ? {branchId: id(to), branchPort: targetPort} : {outputId: id(to), outputPort: targetPort};
    d.setBehaviors(from, d.getBehaviors(from).map(value => value.type === before.type ? Object.assign({}, value, patch) : value));
    if (move === 'target') e.assembly.align(from, port, to, targetPort); else e.assembly.align(to, targetPort, from, port);
  };
  const inputSource = source('Source A'), input = belt('roller-motor', 'Entrada'); link(inputSource, 'output', input);
  let target;
  if (kind === 'straight') {
    target = belt('roller-motor', 'Recta central'); const output = belt('roller-motor', 'Salida');
    const processor = add('processor', undefined, 'Proceso intermedio', {withPanel: false, processTime: .5, setupTime: 0, delivery: 'automatic', running: true, powered: true});
    link(input, 'output', target); link(target, 'output', processor); link(processor, 'output', output); link(output, 'output', receiver('Almacén final'));
  } else if (kind === 'l-transfer') {
    target = input; const corner = belt('popup-belt', 'Transferencia L 1 × 1', {length: 1, width: 1, routing: 'branch'}), output = belt('roller-motor', 'Salida L');
    link(input, 'output', corner); link(corner, 'branch', output); link(output, 'output', receiver('Almacén L'));
  } else if (kind === 'curve') {
    target = belt('roller-curve', 'Curva de 90°', {radius: 1.5, curveAngle: 90}); const output = belt('roller-motor', 'Salida curva');
    link(input, 'output', target); link(target, 'output', output); link(output, 'output', receiver('Almacén curva'));
  } else if (kind === 'tee') {
    target = belt('distributor', 'Distribuidor T', {length: 2.8, routing: 'alternate'});
    const main = belt('roller-motor', 'Salida T principal'), branch = belt('roller-motor', 'Salida T lateral');
    link(input, 'output', target); link(target, 'output', main); link(target, 'branch', branch); link(main, 'output', receiver('Almacén T principal', 4)); link(branch, 'output', receiver('Almacén T lateral', 4));
  } else if (kind === 'merge-y') {
    target = belt('merge-angle', 'Unión Y', {length: 3.2, mergeAngle: 45}); link(input, 'output', target);
    const branch = belt('roller-motor', 'Entrada Y lateral'), otherSource = source('Source B'), output = belt('roller-motor', 'Salida Y');
    link(branch, 'output', target, 'branch', 'source'); link(otherSource, 'output', branch, 'input', 'source'); link(target, 'output', output); link(output, 'output', receiver('Almacén Y', 16));
  } else throw new Error('Caso desconocido.');
  d.setBehaviors(target, d.getBehaviors(target).map(value => value.type === 'conveyor' ? Object.assign({}, value, {withPanel: true}) : value));
  d.setBehaviors(target, d.getBehaviors(target).concat([{type: 'surfaceMaterial', preset: 'paintedMetal', name: 'Acabado de usuario · no sobrescribir', slot: 'part:Bastidor', color: '#295c73', colorMapMode: 'none', roughness: .64, metalness: .4, wear: .12, seed: 64}]));
  const cap = d.getObject(id(target) + '/6.2'); if (cap) d.setProperty(cap, 'color', '#31aa77');
  // A customized, unrelated actor must survive resizing and persistence intact.
  const unrelated = d.addPrimitive(roomId, 'box'); d.setProperty(unrelated, 'name', 'No tocar · pieza de usuario'); d.setProperty(unrelated, 'color', '#295c73'); d.setTransform(unrelated, {position: [22, .5, 22], scale: [.6, 1, .8]});
  e.select(target); if (e.materials) e.materials.invalidate(); e.industrialVisuals.invalidate(); e.lineMonitors.invalidate(); e.collisionWorld.invalidate();
  const result = {kind, roomId, targetId: id(target), ids: objects.map(id), sourceIds: sources.map(id), receiverIds: receivers.map(id), unrelatedId: id(unrelated), expectedUnits: sources.length * 8};
  window.__adaptiveFixture = result; return result;
}

function snapshotFixture(fixture) {
  const e = context.editor, d = e.document;
  const target = d.getObject(fixture.targetId), inlet = e.assembly.worldPort(target, 'input'), incoming = e.assembly.edges().find(edge => edge.targetId === fixture.targetId && edge.targetPort === 'input');
  const predecessor = incoming && e.assembly.worldPort(incoming.source, incoming.sourcePort);
  const checks = e.assembly.edges().map(edge => { const result = e.assembly.assessConnection(edge.source, edge.sourcePort, edge.target, edge.targetPort); return {sourceId: edge.source.userData.editorId, sourcePort: edge.sourcePort, targetId: edge.targetId, targetPort: edge.targetPort, ready: result.ready, gap: result.gap, heading: result.heading}; });
  return {roomId: e.roomId, target: e.assembly.config(target), input: {position: inlet.position.toArray(), tangent: inlet.tangent.toArray()}, predecessor: predecessor && {id: incoming.source.userData.editorId, port: incoming.sourcePort, position: predecessor.position.toArray(), tangent: predecessor.tangent.toArray()}, machines: fixture.ids.map(id => { const object = d.getObject(id); return {id, name: object.name, position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(), config: e.assembly.config(object)}; }), checks, undo: d.undoStack.length, redo: d.redoStack.length, transaction: !!d.transaction};
}

async function run() {
  if (process.argv.includes('--inventory-only')) return inventory();
  // Reuse the exact server/static-content/TLS setup already exercised by the
  // primary browser suite, with a separate temporary database and directory.
  const browserText = fs.readFileSync(path.join(__dirname, 'test-studio-browser.js'), 'utf8');
  const prefix = browserText.slice(0, browserText.indexOf('\nasync function run()')).replace(/hello-studio-browser-/g, 'hello-adaptive-line-');
  const h = new Function('require', '__dirname', prefix + '\nreturn {temporary,api,projectWrites,server,fingerprint,delay,until};')(require, __dirname);
  let browser, socket;
  try {
    await new Promise(resolve => h.server.listen(0, '127.0.0.1', resolve));
    const port = h.server.address().port, origin = 'https://127.0.0.1:' + port, profile = path.join(h.temporary, 'chrome');
    browser = spawn(process.env.STUDIO_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1600,1000', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--ignore-certificate-errors-spki-list=' + h.fingerprint, 'about:blank'], {windowsHide: true, stdio: 'ignore'});
    const debugPort = await h.until(() => { try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (_) { return null; } }, 'Chrome no inició.');
    const tabs = await fetch('http://127.0.0.1:' + debugPort + '/json/list').then(response => response.json()); socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    let sequence = 0; const pending = new Map(), exceptions = [], consoleErrors = [], foreignWrites = [];
    socket.on('message', bytes => { const m = JSON.parse(bytes); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(arg => arg.value || arg.description).join(' ')); if (m.method === 'Network.requestWillBeSent' && /\/api\//.test(m.params.request.url) && !['GET', 'HEAD', 'OPTIONS'].includes(m.params.request.method) && new URL(m.params.request.url).origin !== origin) foreignWrites.push(m.params.request.url); });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
    const evaluate = async expression => { const value = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception && value.exceptionDetails.exception.description || value.exceptionDetails.text); return value.result.value; };
    const navigate = async route => { await send('Page.navigate', {url: origin + route}); await h.until(() => evaluate('Boolean(window.context?.editor&&!context.editor.initializing&&!context.editor.loadingProject&&document.querySelector("#loading")?.style.display==="none")'), 'No abrió la aplicación aislada.'); };
    const shots = [], screenshot = async name => { await h.delay(350); const value = await send('Page.captureScreenshot', {format: 'png'}), file = path.join(ARTIFACTS, name + '.png'); fs.writeFileSync(file, Buffer.from(value.data, 'base64')); shots.push(file); };
    fs.mkdirSync(ARTIFACTS, {recursive: true}); await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await navigate('/editor');
    assert.equal(await evaluate('fetch("/api/projects").then(r=>r.json()).then(v=>v.projects.length)'), 0, 'Only an empty, isolated database is allowed.');
    const reports = [];
    const progress = () => fs.writeFileSync(path.join(ARTIFACTS, 'adaptive-line-browser-progress.json'), JSON.stringify({isolated: true, origin, productionWrites: foreignWrites, reports, shots, exceptions, consoleErrors}, null, 2));
    for (const test of CASES.filter(test => !option('--case') || (test.id || test.kind) === option('--case'))) {
      console.log('Chrome QA aislada:', test.id || test.kind);
      const fixture = await evaluate('(' + buildFixture.toString() + ')(' + JSON.stringify(test.kind) + ')');
      if (test.behavior) fixture.targetId = await evaluate('(()=>{const e=context.editor,o=' + JSON.stringify(fixture.ids) + '.map(id=>e.document.getObject(id)).find(o=>e.assembly.config(o)?.type===' + JSON.stringify(test.behavior) + ');if(!o)throw new Error("Falta el equipo para editar");e.select(o);return o.userData.editorId})()');
      if (test.reject) await evaluate('(()=>{const e=context.editor,o=e.document.getObject(' + JSON.stringify(fixture.receiverIds[0]) + ');e.document.setBehaviors(o,e.document.getBehaviors(o).map(config=>config.type==="palletQueue"?Object.assign({},config,{outputId:' + JSON.stringify(fixture.sourceIds[0]) + '}):config));return true})()');
      const beforeDocument = await evaluate('(async()=>context.editor.document.serialize())()'), before = await evaluate('(' + snapshotFixture.toString() + ')(' + JSON.stringify(fixture) + ')');
      const writesBeforeEdit = h.projectWrites.length;
      if (!test.reject) assert(before.checks.every(check => check.ready && check.gap < 1e-6));
      const definition = behaviorSchema.definitionFor(before.target.type), equipment = before.target.equipmentId && behaviorSchema.conveyorLayout.equipment.resolveVariant(before.target), parameter = equipment && equipment.parameters.find(field => field.key === test.key);
      const label = test.key === 'scale' ? test.label : definition.label + ' · ' + (parameter ? parameter.label + (parameter.unit ? ' (' + parameter.unit + ')' : '') : definition.fields.find(field => field.key === test.key).label);
      await evaluate('(()=>{const e=context.editor,input=[...e.inspector.querySelectorAll("input")].find(input=>input.getAttribute("aria-label")===' + JSON.stringify(label) + ');if(!input)throw new Error("Falta el campo real del inspector: "+JSON.stringify([...e.inspector.querySelectorAll("input")].map(node=>node.getAttribute("aria-label"))));input.value=' + test.value + ';input.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
      await h.until(() => evaluate('!context.editor.busy&&!context.editor.document.transaction'), 'La edición no terminó.');
      assert.equal(h.projectWrites.length, writesBeforeEdit, 'Editing a dimension must not write a project automatically.');
      const after = await evaluate('(' + snapshotFixture.toString() + ')(' + JSON.stringify(fixture) + ')');
      if (test.reject) {
        assert.deepEqual(await evaluate('(async()=>context.editor.document.serialize())()'), beforeDocument, 'An inconsistent cycle must reject the complete resize atomically.'); assert.equal(after.undo, before.undo); reports.push({test, fixture, rejected: true, before, after}); progress(); console.log('PASS atomic rejection', test.id); continue;
      }
      assert.equal(test.key === 'scale' ? after.machines.find(machine => machine.id === fixture.targetId).scale[0] : after.target[test.key], test.value, 'The inspector must apply the requested dimension.'); assert.equal(after.undo, before.undo + 1, 'Resize and all dependent placement form one undo transaction.');
      before.input.position.forEach((value, axis) => assert(Math.abs(after.input.position[axis] - value) < 1e-6, 'Geometry and scale resizing anchor the existing input.'));
      before.predecessor.position.forEach((value, axis) => assert(Math.abs(after.predecessor.position[axis] - value) < 1e-6, 'The principal predecessor remains fixed.'));
      assert(after.checks.every(check => check.ready && check.gap < 1e-6), test.kind + ': every linked port remains joined.');
      const afterDocument = await evaluate('(async()=>context.editor.document.serialize())()');
      assertPreserved(beforeDocument, afterDocument, fixture, test);
      await evaluate('context.editor.undoButton.click()'); await h.until(() => evaluate('!context.editor.busy'), 'Undo no terminó.');
      assert.deepEqual(await evaluate('(async()=>context.editor.document.serialize())()'), beforeDocument, 'One real toolbar Undo restores the complete authoring document.');
      await evaluate('context.editor.redoButton.click()'); await h.until(() => evaluate('!context.editor.busy'), 'Redo no terminó.');
      assert.deepEqual(await evaluate('(async()=>context.editor.document.serialize())()'), afterDocument, 'One real toolbar Redo restores the resized line.');
      assert.equal(h.projectWrites.length, writesBeforeEdit, 'Undo/Redo must preserve user control over saving.');
      // Save only to the temporary API and reload through the actual editor.
      const project = await evaluate('(async()=>{const e=context.editor,p=await e.projectClient.createProject(' + JSON.stringify('QA adaptiva · ' + (test.id || test.kind)) + ',await e.document.serialize());return {id:p.id,revision:p.revision,document:p.document}})()');
      await navigate('/editor?project=' + project.id + '&room=' + fixture.roomId);
      const reopened = await evaluate('(' + snapshotFixture.toString() + ')(' + JSON.stringify(fixture) + ')');
      assert.equal(test.key === 'scale' ? reopened.machines.find(machine => machine.id === fixture.targetId).scale[0] : reopened.target[test.key], test.value); assert(reopened.checks.every(check => check.ready && check.gap < 1e-6));
      const reopenedDocument = await evaluate('(async()=>context.editor.document.serialize())()'); assert.deepEqual(reopenedDocument, project.document);
      await evaluate('(()=>{const e=context.editor,o=e.document.getObject(' + JSON.stringify(fixture.targetId) + '),center=o.getWorldPosition(e.camera.position.clone());e.select(o);e.camera.position.copy(center).add(center.clone().set(5,4,5));e.orbit.target.copy(center);e.safeCameraPosition=null;e.safeOrbitTarget=null;e.orbit.update();e.entities.sync();e.render(0)})()'); await screenshot('adaptive-line-' + (test.id || test.kind));
      if (['l-transfer', 'tee', 'merge-y'].includes(test.kind)) {
        await evaluate('('+function (fixture) {
          const e = context.editor, points = fixture.ids.map(id => e.document.getObject(id).getWorldPosition(e.camera.position.clone())), minimum = points[0].clone(), maximum = points[0].clone();
          points.forEach(point => { minimum.min(point); maximum.max(point); });
          const center = minimum.clone().add(maximum).multiplyScalar(.5), span = Math.max(maximum.z - minimum.z, (maximum.x - minimum.x) / e.camera.aspect) + 5;
          e.camera.position.copy(center).add(center.clone().set(0, Math.max(8, span), 0)); e.orbit.target.copy(center); e.safeCameraPosition = null; e.safeOrbitTarget = null;
          const up = e.camera.up.clone(); e.camera.up.set(0, 0, -1); e.orbit.update(); e.camera.lookAt(center); e.camera.up.copy(up); e.render(0);
        }.toString()+')('+JSON.stringify(fixture)+')'); await screenshot('adaptive-line-' + (test.id || test.kind) + '-top');
      }
      const flow = await evaluate('('+function (fixture) {
        const e = context.editor, runtime = e.simulation, world = e.collisionWorld; e.leave(); e.simulationPaused = true;
        const received = () => fixture.receiverIds.reduce((sum, id) => sum + runtime.records.get(id).variables.receivedUnits, 0);
        let elapsed = 0;
        while (elapsed < 300 && received() < fixture.expectedUnits) { world.beginFrame(); try { e.root.updateMatrixWorld(true); runtime.execute(.1); } finally { world.endFrame(); } elapsed += .1; }
        const units = received(), generated = fixture.sourceIds.reduce((sum, id) => sum + runtime.records.get(id).variables.generatedUnits, 0), pallets = fixture.receiverIds.reduce((sum, id) => sum + runtime.records.get(id).variables.completePallets, 0);
        e.enter(); return {seconds: elapsed, units, generated, pallets, gl: context.renderer.getContext().getError()};
      }.toString()+')('+JSON.stringify(fixture)+')');
      assert.equal(flow.generated, fixture.expectedUnits); assert.equal(flow.units, fixture.expectedUnits); assert.equal(flow.pallets, fixture.expectedUnits / 4); assert.equal(flow.gl, 0);
      assert.equal(hash(await evaluate('(async()=>context.editor.document.serialize())()')), hash(reopenedDocument), 'The physical flow preserves authored edits.');
      reports.push({test, fixture, before, after, reopened, flow, projectId: project.id, revision: project.revision}); progress(); console.log('PASS', test.id || test.kind, flow.units, 'units /', flow.pallets, 'pallets');
    }
    assert(reports.length); assert.deepEqual(exceptions, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(foreignWrites, []);
    assert.deepEqual(h.projectWrites, reports.filter(report => !report.rejected).map(() => ({method: 'POST', url: '/api/projects'})), 'Only explicitly creating the isolated QA snapshots may write a project.');
    const report = {isolated: true, origin, productionWrites: [], reports, shots, exceptions, consoleErrors, writes: h.projectWrites}; fs.writeFileSync(path.join(ARTIFACTS, 'adaptive-line-browser.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({passed: reports.length, isolated: true, exceptions, consoleErrors, productionWrites: foreignWrites})); await send('Browser.close').catch(() => {});
  } finally {
    if (socket) socket.close(); if (browser && browser.exitCode === null) { browser.kill(); await new Promise(resolve => { browser.once('exit', resolve); setTimeout(resolve, 2500); }); }
    await new Promise(resolve => h.server.close(resolve)); h.api.close();
    const directory = path.resolve(h.temporary); assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert(path.basename(directory).startsWith('hello-adaptive-line-')); fs.rmSync(directory, {recursive: true, force: true, maxRetries: 8, retryDelay: 200});
  }
}
module.exports = {CASES, buildFixture, snapshotFixture, inventory, assertPreserved};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
