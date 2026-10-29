const __layout = require("../layout.cjs");
'use strict';
// Creates a separate example project through the running application's API and
// authoring tools. Existing projects are never loaded for mutation or replaced.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https');
const {spawn} = require('node:child_process');
const {X509Certificate, createHash} = require('node:crypto');
const WebSocket = require('ws');
const roomIds = require('../../packages/project-model/shared/studio-document').ROOM_IDS;
const root = __layout.map(path.resolve(__layout.oldDir("scripts/open-industrial-lab.js"), '..')), artifacts = __layout.map(path.join(root, 'data/qa-studio'));
const pem = fs.readFileSync(__layout.map(path.join(root, 'node_modules/webpack-dev-server/ssl/server.pem')));
const fingerprint = createHash('sha256').update(new X509Certificate(pem).publicKey.export({type: 'spki', format: 'der'})).digest('base64');
const profile = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'hello-industrial-lab-')));
let browser, socket, id = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body && JSON.stringify(body), req = https.request({hostname: 'localhost', port: 8080, path: url, family: 4, ca: pem, method,
      headers: payload ? {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)} : {}}, response => {
      let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => {
        let result; try { result = JSON.parse(text); } catch (_) { return reject(new Error('Respuesta no válida de ' + url)); }
        if (response.statusCode >= 400) reject(new Error(result.error || response.statusCode)); else resolve(result);
      });
    }); req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
async function until(action, message, milliseconds = 120000) {
  const start = Date.now(); while (Date.now() - start < milliseconds) { const value = await action(); if (value) return value; await delay(250); }
  throw new Error(message);
}

// Runs inside the isolated QA browser. Discover recipes through their saved
// behavior graph, never through translated object names or group positions.
function installLabQA() {
  const e = context.editor, r = e.simulation, w = e.collisionWorld;
  if (!r.running || !w || w !== context.collisionWorld) throw new Error('La prueba requiere el CollisionWorld real y la simulación activa.');
  const types = ['source', 'conveyor', 'processor', 'palletQueue'];
  const groups = e.document.studio.groups.filter(group => group.roomId === e.roomId).map(group => {
    const objects = group.members.map(id => e.document.getObject(id)).filter(Boolean);
    const machines = objects.map(object => ({object, id: object.userData.editorId, config: e.document.getBehaviors(object).find(config => types.includes(config.type))})).filter(item => item.config);
    const monitors = objects.filter(object => e.document.getBehaviors(object).some(config => config.type === 'lineMonitor'));
    return {group, machines, monitors};
  }).filter(item => item.monitors.length);
  if (groups.length !== 9) throw new Error('Se necesitan nueve líneas con monitor; se encontraron ' + groups.length);
  groups.forEach(item => {
    if (item.monitors.length !== 1) throw new Error('Cada línea requiere un monitor: ' + item.group.id);
    item.monitor = item.monitors[0]; item.monitorConfig = e.document.getBehaviors(item.monitor).find(config => config.type === 'lineMonitor');
    item.buffers = item.machines.filter(machine => machine.config.type === 'palletQueue');
    item.sources = item.machines.filter(machine => machine.config.type === 'source' && machine.config.autoGenerate);
    item.expectedUnits = item.sources.reduce((sum, machine) => sum + machine.config.totalLimit * (machine.config.loadMode === 'pallet' ? machine.config.palletColumns * machine.config.palletRows * machine.config.palletLayers : 1), 0);
    if (item.expectedUnits !== 16 || item.buffers.reduce((sum, machine) => sum + machine.config.palletCapacity, 0) !== 4) throw new Error('La línea no configura dieciséis unidades y cuatro estibas: ' + item.group.id);
    const panels = item.machines.filter(machine => machine.config.withPanel);
    if (panels.length !== 1 || panels[0].id !== item.monitorConfig.targetId) throw new Error('El monitor debe controlar el único PLC de su línea: ' + item.group.id);
    const detected = new Set(['loading', 'liftTransfer', 'turntable', 'pusher', 'steer', 'merge', 'distributor', 'elevator']);
    const visible = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };
    item.sensors = item.machines.filter(machine => machine.config.type === 'conveyor').map(machine => {
      const expected = detected.has(machine.config.mechanism), actors = [], zones = [];
      machine.object.traverse(node => {
        if (!visible(node)) return;
        if (e.document.getBehaviors(node).some(config => config.type === 'sensor')) actors.push(node.userData.editorId);
        if (node.userData.industrialSignal && node.userData.industrialSignal.zone !== undefined) zones.push(node.userData.industrialSignal.zone);
      });
      if (!!machine.config.withSensors !== expected || !!actors.length !== expected) throw new Error('Sensores externos redundantes o ausentes en ' + machine.id);
      if (machine.config.mechanism === 'zones' && !zones.length) throw new Error('El acumulador perdió su detección interna por zonas.');
      return {id: machine.id, mechanism: machine.config.mechanism, withSensors: !!machine.config.withSensors, visibleActors: actors.length, zoneDetectors: zones.length};
    });
  });
  const qa = {groups, originalPaused: e.simulationPaused, originalLocomotion: context.studioLocomotion,
    rigPosition: context.cameraRig.position.clone(), rigQuaternion: context.cameraRig.quaternion.clone(), cameraPosition: context.camera.position.clone(), cameraQuaternion: context.camera.quaternion.clone()};
  e.simulationPaused = true; context.studioLocomotion = 'teleport';
  qa.flow = () => groups.map(item => {
    const buffers = item.buffers.map(machine => { const state = r.records.get(machine.id).variables; return {id: machine.id, palletCapacity: machine.config.palletCapacity, acceptsPallets: !!machine.config.acceptsPallets, received: state.received, receivedUnits: state.receivedUnits, completePallets: state.completePallets}; });
    return {id: item.group.id, name: item.group.name, mode: 'automatic', expectedUnits: item.expectedUnits,
      sourceIds: item.sources.map(machine => machine.id), monitorId: item.monitor.userData.editorId, sensors: item.sensors, buffers,
      receivedUnits: buffers.reduce((sum, buffer) => sum + buffer.receivedUnits, 0), completePallets: buffers.reduce((sum, buffer) => sum + buffer.completePallets, 0)};
  });
  qa.advance = seconds => {
    const count = Math.round(seconds / .1);
    for (let index = 0; index < count; index++) { w.beginFrame(); try { e.root.updateMatrixWorld(true); r.execute(.1); } finally { w.endFrame(); } }
    return {time: r.time, completed: qa.flow().filter(cell => cell.receivedUnits === 16 && cell.completePallets === 4).length};
  };
  qa.frameMonitor = index => {
    const item = groups[index]; e.lineMonitors.sync(e.roomId, .3, false);
    const entry = e.lineMonitors.entries.get(item.monitor); if (!entry) throw new Error('Falta pantalla física: ' + item.group.id);
    entry.owner.updateWorldMatrix(true, true);
    const center = entry.plane.getWorldPosition(context.camera.position.clone());
    const normal = center.clone().set(0, 0, 1).applyQuaternion(entry.plane.getWorldQuaternion(context.camera.quaternion.clone())).normalize();
    const eye = center.clone().addScaledVector(normal, 3.5), previous = context.camera.getWorldPosition(center.clone());
    context.cameraRig.position.add(eye.clone().sub(previous)); context.cameraRig.updateMatrixWorld(true);
    context.camera.lookAt(center); context.camera.updateMatrixWorld(true);
    if (e.performance) e.performance.update(context.camera, 0);
    entry.dirty = true; e.lineMonitors.sync(e.roomId, .3, false); e.industrialVisuals.sync(e.roomId, 0, false);
    return {id: item.group.id, monitorId: item.monitor.userData.editorId, eye: eye.toArray(), center: center.toArray(), normal: normal.toArray(), distance: 3.5, records: entry.model.records.length, paths: entry.model.paths.length, products: entry.model.products.length};
  };
  qa.press = (index, key) => {
    const item = groups[index], entry = e.lineMonitors.entries.get(item.monitor), controller = context.desktopController;
    if ((['start', 'stop', 'pause', 'powerOn', 'powerOff', 'emergency', 'resetEmergency', 'speedDown', 'speedUp'].includes(key) || key.startsWith('equipment-action-')) && entry.page !== 'control') qa.press(index, 'control');
    entry.dirty = true; e.lineMonitors.sync(e.roomId, .3, false);
    const region = entry.regions.find(region => (region.action === key || region.key === key) && !region.disabled);
    if (!region) throw new Error('Mando virtual no disponible: ' + key);
    const u = (region.x + region.width / 2) / entry.canvas.width, v = 1 - (region.y + region.height / 2) / entry.canvas.height;
    if (!entry.plane.geometry.boundingBox) entry.plane.geometry.computeBoundingBox();
    const bounds = entry.plane.geometry.boundingBox;
    const point = entry.plane.localToWorld(context.camera.position.clone().set(bounds.min.x + (bounds.max.x - bounds.min.x) * u, bounds.min.y + (bounds.max.y - bounds.min.y) * v, 0));
    const origin = r.interactionOrigin(controller), direction = point.clone().sub(origin).normalize();
    const ray = new context.raycontrol.raycaster.constructor(origin, direction, 0, 6), hit = ray.intersectObject(entry.plane, true)[0];
    if (!hit || !entry.state.isSelectable(hit, controller)) throw new Error('El rayo 3D no puede operar el monitor: ' + item.group.id + ' / ' + key);
    entry.state.onSelectStart(hit, controller); entry.state.onSelectEnd(hit, controller);
    if (entry.notice) throw new Error(entry.notice);
    entry.dirty = true; e.lineMonitors.sync(e.roomId, .3, false);
    return {action: key, uv: hit.uv.toArray(), distance: hit.distance};
  };
  qa.analytics = () => groups.map(item => {
    const state = r.getAnalyticsSnapshot(item.monitorConfig.targetId, 'line');
    if (!state || state.history.length < 20 || state.history.length > 600) throw new Error('Historial incompleto o sin límite: ' + item.group.id);
    const summary = state.summary, keys = ['busySeconds', 'idleSeconds', 'setupSeconds', 'blockedSeconds', 'downSeconds', 'pausedSeconds'];
    const total = keys.reduce((sum, key) => sum + summary[key], 0);
    if (Math.abs(total - state.observedSeconds) > 1e-5) throw new Error('Los tiempos no conservan el intervalo observado: ' + item.group.id);
    if (summary.entryUnits !== 16 || summary.exitUnits !== 16) throw new Error('La analítica cuenta transferencias internas como unidades nuevas: ' + item.group.id);
    if (!state.control.ready || state.control.method !== 'I-MR' || !['center', 'lcl', 'ucl', 'mrCenter', 'mrLcl', 'mrUcl'].every(key => Number.isFinite(state.control[key]))) throw new Error('Gráfico I-MR sin muestras/límites válidos: ' + item.group.id);
    if (![summary.utilization, summary.availability, summary.loadPercent, summary.throughputPerMinute].every(Number.isFinite) || summary.utilization >= 100) throw new Error('Utilización sin trabajo o indicadores inválidos: ' + item.group.id);
    if (state.machines.some(machine => machine.state === 'busy')) throw new Error('Una línea vacía sigue computando trabajo útil: ' + item.group.id);
    return {id: item.group.id, observedSeconds: state.observedSeconds, samples: state.history.length, summary, control: Object.assign({}, state.control, {movingRanges: undefined}), stateSecondsTotal: total, noEmptyMachineBusy: true};
  });
  qa.page = (index, page, subpage) => {
    qa.frameMonitor(index); const item = groups[index], entry = e.lineMonitors.entries.get(item.monitor), actions = [];
    if (page === 'equipment') {
      const selected = item.machines.find(machine => machine.config.mechanism === 'distributor') || item.machines.find(machine => machine.config.type === 'conveyor');
      if (selected && entry.selectedId !== selected.id) {
        if (entry.page !== 'diagram') actions.push(qa.press(index, 'diagram'));
        actions.push(qa.press(index, 'node:' + selected.id));
      }
    }
    if (entry.page !== page) actions.push(qa.press(index, page));
    if (subpage !== undefined) actions.push(qa.press(index, (page === 'analytics' ? 'analysis-' : 'equipment-') + subpage));
    return {id: item.group.id, page: entry.page, analysisPage: entry.analysisPage, equipmentPage: entry.equipmentPage, selectedId: entry.selectedId, samples: entry.model.analytics && entry.model.analytics.history.length, actions};
  };
  qa.clickMonitor = index => {
    qa.frameMonitor(index);
    const item = groups[index], entry = e.lineMonitors.entries.get(item.monitor), controller = context.desktopController;
    const fields = ['running', 'paused', 'powered', 'emergency', 'speed'];
    const snapshot = records => records.map(record => ({id: record.id, fields: Object.fromEntries(fields.filter(key => key in record.variables).map(key => [key, record.variables[key]]))}));
    const members = item.machines.map(machine => r.records.get(machine.id)), memberIds = new Set(members.map(record => record.id));
    const before = snapshot(members), unrelated = snapshot(Array.from(r.records.values()).filter(record => !memberIds.has(record.id)));
    const original = {moduleOnly: entry.moduleOnly, page: entry.page, selectedId: entry.selectedId};
    entry.moduleOnly = false; entry.page = 'diagram';
    const actions = [], click = action => actions.push(qa.press(index, action));
    try {
      click('pause'); if (!members.filter(record => 'paused' in record.variables).every(record => record.variables.paused)) throw new Error('Pausa no alcanza toda la línea.');
      click('pause'); click('stop');
      if (!members.every(record => record.components.conveyor && record.components.conveyor.config.drive !== 'motor' ? record.variables.paused : !record.variables.running)) throw new Error('Parar no alcanza toda la línea.');
      click('start');
      if (!members.every(record => record.components.conveyor && record.components.conveyor.config.drive !== 'motor' ? !record.variables.paused : record.variables.running)) throw new Error('Marcha no alcanza toda la línea.');
      if (JSON.stringify(snapshot(Array.from(r.records.values()).filter(record => !memberIds.has(record.id)))) !== JSON.stringify(unrelated)) throw new Error('El monitor alteró otra línea.');
    } finally {
      // Restore runtime switches as well as the monitor's private navigation.
      before.forEach(saved => { const record = r.records.get(saved.id); Object.entries(saved.fields).forEach(([key, value]) => { if (record.variables[key] !== value && record.writable.some(field => field.key === key)) r.setVariable(saved.id, key, value); }); });
      Object.assign(entry, original); entry.dirty = true; e.lineMonitors.sync(e.roomId, .3, false);
    }
    const restored = JSON.stringify(snapshot(members)) === JSON.stringify(before); if (!restored) throw new Error('No se restauraron los mandos de la línea.');
    return {id: item.group.id, monitorId: item.monitor.userData.editorId, method: 'Three.Raycaster → onSelectStart/onSelectEnd', actions, switchesRestored: restored, unrelatedUnchanged: true};
  };
  qa.restoreView = () => {
    context.cameraRig.position.copy(qa.rigPosition); context.cameraRig.quaternion.copy(qa.rigQuaternion);
    context.camera.position.copy(qa.cameraPosition); context.camera.quaternion.copy(qa.cameraQuaternion); context.cameraRig.updateMatrixWorld(true);
    context.studioLocomotion = qa.originalLocomotion; e.simulationPaused = qa.originalPaused;
  };
  window.__industrialLabQA = qa; return qa.flow();
}
async function run() {
  fs.mkdirSync(artifacts, {recursive: true});
  const argument = process.argv.indexOf('--project');
  let projectId = argument >= 0 && process.argv[argument + 1];
  const create = process.argv.includes('--create');
  const refresh = process.argv.includes('--refresh');
  const preview = process.argv.includes('--preview');
  if (preview && (create || refresh)) throw new Error('La previsualización no se combina con crear o guardar.');
  if (!projectId && !create) throw new Error('Usa --create para crear un proyecto separado o --project ID para inspeccionarlo.');
  if (!projectId) {
    const rooms = Object.fromEntries(roomIds.map(roomId => [roomId, {overrides: [], additions: []}]));
    const created = await request('POST', '/api/projects', {name: 'Laboratorio industrial · Ejemplos de configuración', document: {format: 'hello-webxr-editor', version: 1, rooms, imports: []}});
    projectId = created.project.id;
    console.log('Proyecto de ejemplos creado:', projectId);
    fs.mkdirSync(artifacts, {recursive: true}); fs.writeFileSync(__layout.map(path.join(artifacts, 'industrial-lab-project.json')), JSON.stringify({id: projectId}, null, 2));
  }
  const executable = process.env.STUDIO_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  browser = spawn(executable, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1600,1000', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--ignore-certificate-errors-spki-list=' + fingerprint, 'about:blank'], {windowsHide: true, stdio: 'ignore'});
  const port = await until(() => { try { return Number(fs.readFileSync(__layout.map(path.join(profile, 'DevToolsActivePort')), 'utf8').split('\n')[0]); } catch (_) { return null; } }, 'Chrome no inició.');
  const tabs = await fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json());
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const pending = new Map(), exceptions = [], projectWrites = [];
  socket.on('message', bytes => { const data = JSON.parse(bytes); if (data.id && pending.has(data.id)) { const entry = pending.get(data.id); pending.delete(data.id); data.error ? entry.reject(new Error(data.error.message)) : entry.resolve(data.result); } if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails.text); });
  socket.on('message', bytes => { const data = JSON.parse(bytes); if (data.method === 'Network.requestWillBeSent') { const request = data.params.request; if (/\/api\/projects(?:\/|$)/.test(new URL(request.url).pathname) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) projectWrites.push({method: request.method, url: request.url}); } });
  function command(method, params = {}) { return new Promise((resolve, reject) => { const current = ++id; pending.set(current, {resolve, reject}); socket.send(JSON.stringify({id: current, method, params})); }); }
  async function evaluate(expression) { const value = await command('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, timeout: 180000}); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception && value.exceptionDetails.exception.description || value.exceptionDetails.text); return value.result.value; }
  async function screenshot(name) { const result = await command('Page.captureScreenshot', {format: 'png'}); fs.writeFileSync(__layout.map(path.join(artifacts, (preview ? name.replace(/^industrial-lab-/, 'industrial-lab-preview-') : name) + '.png')), Buffer.from(result.data, 'base64')); }
  await command('Runtime.enable'); await command('Page.enable');
  // Keep this isolated measurement on one compiled version while other editor
  // work continues. The application itself still uses the normal live server.
  await command('Network.enable'); await command('Network.setBlockedURLs', {urls: ['*://localhost:8080/sockjs-node/*']});
  await command('Page.navigate', {url: 'https://localhost:8080/editor?project=' + projectId});
  await until(() => evaluate("Boolean(window.context?.editor?.active&&context.editor.studioTools&&!context.editor.loadingProject&&context.editor.currentProject?.id===" + JSON.stringify(projectId) + ')'), 'El editor no cargó el proyecto de ejemplos.');
  const existing = await evaluate("(context.editor.document.studio?.scenes||[]).find(n=>n.name==='Laboratorio industrial · Ejemplos')?.id");
  const expectedArgument = process.argv.indexOf('--expected-revision');
  if (refresh && (expectedArgument < 0 || await evaluate('context.editor.currentProject.revision') !== Number(process.argv[expectedArgument + 1]))) throw new Error('La revisión del proyecto cambió; se conserva sin reconstruir.');
  let result;
  if (!existing) {
    if (!create) throw new Error('El proyecto todavía no contiene el laboratorio; usa --create --project ID para completarlo.');
    result = await evaluate('(async()=>{const e=context.editor;const result=await e.studioTools.createIndustrialExamples();await e.saveProject();return result})()');
  } else {
    await evaluate('context.editor.hooks.gotoRoom(' + roomIds.indexOf(existing) + ')'); result = {roomId: existing};
    if (refresh || preview) result = await evaluate("(async()=>{const e=context.editor,d=e.document,roomId=e.roomId;d.begin();try{d.resetRoom(roomId);d.getObjects(roomId).filter(n=>d.isNative(n)).forEach(n=>d.setProperty(n,'visible',false));e.studioTools.createSceneBase(roomId);const built=e.studioTools.populateIndustrialExamples(roomId);d.commit();" + (preview ? '' : 'await e.saveProject();') + "return {roomId,cells:built.cells.map(c=>({id:c.id,title:c.title,mode:c.mode,objectIds:c.objects.map(n=>n.userData.editorId)}))}}catch(error){d.cancel();throw error}})()");
  }
  const roomId = result.roomId;
  await evaluate("(()=>{const e=context.editor;e.home();e.select(null);return true})()");
  await delay(700);
  const overview = await evaluate("(()=>{const e=context.editor,r=context.renderer;e.render(0);const gl=r.getContext(),w=r.domElement.width,h=r.domElement.height,pixels=new Uint8Array(w*h*4),bins=new Map();gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let samples=0;for(let y=0;y<24;y++)for(let x=0;x<40;x++){const offset=(Math.min(h-1,Math.floor((y+.5)*h/24))*w+Math.min(w-1,Math.floor((x+.5)*w/40)))*4;const key=[pixels[offset]>>3,pixels[offset+1]>>3,pixels[offset+2]>>3].join(':');bins.set(key,(bins.get(key)||0)+1);samples++}return {camera:e.camera.position.toArray(),target:e.orbit.target.toArray(),palette:bins.size,dominantFraction:Math.max(...bins.values())/samples,hasRoof:e.document.getObjects(e.roomId).some(n=>n.name==='CEDI · Cubierta interior cerrada'),gl:gl.getError()}})()");
  if (overview.hasRoof && (overview.camera[1] >= 7.8 || overview.palette < 12 || overview.dominantFraction > .8)) throw new Error('La cámara inicial no muestra el interior del CEDI: ' + JSON.stringify(overview));
  await screenshot('industrial-lab-overview');
  const groups = await evaluate('context.editor.document.studio.groups.filter(n=>n.roomId===context.editor.roomId&&n.members.some(id=>context.editor.document.getBehaviors(context.editor.document.getObject(id)).some(c=>c.type==="lineMonitor"))).map(n=>({id:n.id,name:n.name,members:n.members}))');
  for (let index = 0; index < groups.length; index++) {
    await evaluate("(()=>{const e=context.editor,g=e.document.studio.groups[" + index + "];const box=e.document.getObject(g.members[0]).position.clone();const x=" + (index % 2 ? 18 : -18) + ",z=" + (20 - Math.floor(index / 2) * 20) + ";e.orbit.target.set(x,1,z);e.camera.position.set(x+5,6,z+10);e.orbit.update();return true})()");
    await delay(200); await screenshot('industrial-lab-cell-' + (index + 1));
  }
  const editorStats = await evaluate('(()=>{const e=context.editor;return {objects:e.document.getObjects(e.roomId).filter(n=>!e.document.isNative(n)).length,groups:e.document.studio.groups.length,gl:e.ctx.renderer.getContext().getError()}})()');
  await evaluate('context.editor.syncNative()');
  const authoredBefore = await evaluate('(async()=>JSON.stringify(await context.editor.document.serialize()))()');
  await evaluate('context.editor.leave()'); await delay(2500);
  const lineInventory = await evaluate('(' + installLabQA.toString() + ')()');
  let flowChecks, failedFlows = false;
  if (process.argv.includes('--verify-flows')) {
    for (let elapsed = 0; elapsed < 260; elapsed += 10) {
      const progress = await evaluate('__industrialLabQA.advance(10)');
      if ((elapsed + 10) % 50 === 0 || elapsed === 250) console.log('Flujo físico:', elapsed + 10, '/ 260 s; líneas completas:', progress.completed, '/', lineInventory.length);
    }
    flowChecks = await evaluate('__industrialLabQA.flow()');
    console.log('Flujos verificados:', JSON.stringify(flowChecks));
    failedFlows = flowChecks.length !== 9 || flowChecks.some(cell => cell.receivedUnits !== 16 || cell.completePallets !== 4 || cell.buffers.some(buffer => !(buffer.receivedUnits > 0)));
  }
  const analyticsChecks = flowChecks ? await evaluate('__industrialLabQA.analytics()') : [];
  const monitorViews = [], monitorChecks = [];
  for (let index = 0; index < lineInventory.length; index++) {
    monitorViews.push(await evaluate('__industrialLabQA.frameMonitor(' + index + ')'));
    await delay(200); await screenshot('industrial-lab-monitor-' + (index + 1));
    monitorChecks.push(await evaluate('__industrialLabQA.clickMonitor(' + index + ')'));
  }
  const monitorPages = [], representative = lineInventory.findIndex(cell => cell.buffers.length === 2);
  if (representative < 0) throw new Error('Falta la línea ramificada de clasificación.');
  for (const [page, subpage, name] of [['analytics', 0, 'analytics-indicators'], ['analytics', 1, 'analytics-trends'], ['analytics', 2, 'analytics-imr'],
    ['equipment', 0, 'equipment-info'], ['equipment', 1, 'equipment-contents'], ['equipment', 2, 'equipment-parts'], ['equipment', 3, 'equipment-operation'], ['diagram', undefined, 'diagram-scaled']]) {
    monitorPages.push(await evaluate('__industrialLabQA.page(' + representative + ',' + JSON.stringify(page) + ',' + (subpage === undefined ? 'undefined' : subpage) + ')'));
    await delay(200); await screenshot('industrial-lab-' + name);
  }
  await evaluate('__industrialLabQA.restoreView()');
  const runtime = await evaluate('(()=>{const r=context.editor.simulation;return {running:r.running,records:r.records.size,products:r.products.size,time:r.time,machines:[...r.records.values()].filter(n=>n.components.conveyor||n.components.source||n.components.processor||n.components.palletQueue).map(n=>({id:n.id,name:n.object.name,variables:n.variables})),gl:context.renderer.getContext().getError()}})()');
  await screenshot('industrial-lab-walkthrough');
  const authoredAfter = await evaluate('(async()=>{context.editor.stopRuntime();return JSON.stringify(await context.editor.document.serialize())})()');
  const authoringRestored = authoredBefore === authoredAfter;
  const saved = await request('GET', '/api/projects/' + projectId);
  fs.mkdirSync(__layout.map(path.join(root, 'data/exports')), {recursive: true});
  fs.writeFileSync(__layout.map(path.join(root, 'data/exports/industrial-lab' + (preview ? '-preview' : '') + '.json')), preview ? authoredBefore : JSON.stringify(saved.project.document));
  const cells = result.cells || lineInventory.map(cell => ({id: cell.id, title: cell.name, mode: cell.mode, sourceIds: cell.sourceIds, bufferIds: cell.buffers.map(buffer => buffer.id), monitorId: cell.monitorId}));
  const report = {id: projectId, revision: saved.project.revision, preview, projectWrites, roomId, url: 'https://localhost:8080/editor?project=' + projectId + '&room=' + roomId, exploreUrl: 'https://localhost:8080/?project=' + projectId + '&room=' + roomId, cells, overview, editorStats, lineInventory, flowChecks, physics: 'CollisionWorld', verifiedSeconds: flowChecks ? 260 : 0, analyticsChecks, monitorViews, monitorChecks, monitorPages, authoringRestored, runtime, exceptions};
  fs.writeFileSync(__layout.map(path.join(artifacts, 'industrial-lab-project' + (preview ? '-preview' : '') + '.json')), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({id: projectId, roomId, url: report.url, editorStats, running: runtime.running, records: runtime.records, products: runtime.products, exceptions}, null, 2));
  if (failedFlows) throw new Error('Una línea no entregó productos en la verificación conjunta. Consulta industrial-lab-project.json.');
  if (exceptions.length || editorStats.gl || runtime.gl) throw new Error('El navegador reportó un error en el laboratorio.');
  if (!authoringRestored) throw new Error('La prueba alteró la configuración guardada del escenario.');
  if (preview && projectWrites.length) throw new Error('La previsualización emitió una escritura de proyecto.');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (socket) socket.close(); if (browser) browser.kill(); });
