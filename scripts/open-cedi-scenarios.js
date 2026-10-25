'use strict';
// Optional end-to-end QA against the running app. Creation uses the real
// authoring API and saves only after proving that existing levels are intact.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https');
const {spawn} = require('node:child_process'), {X509Certificate, createHash} = require('node:crypto'), WebSocket = require('ws');
const roomIds = require('../shared/studio-document').ROOM_IDS;
const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'data/qa-studio');
const pem = fs.readFileSync(path.join(root, 'node_modules/webpack-dev-server/ssl/server.pem'));
const fingerprint = createHash('sha256').update(new X509Certificate(pem).publicKey.export({type: 'spki', format: 'der'})).digest('base64');
const names = ['CEDI · Clasificación y consolidación', 'CEDI · Packing y transferencias'];
const originalId = 'ce14b39b-5d77-45ea-a85e-1d7e0d76e872';
const option = key => { const index = process.argv.indexOf(key); return index < 0 ? null : process.argv[index + 1]; };
const projectId = option('--project'), create = process.argv.includes('--create');
const smoke = process.argv.includes('--smoke');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let browser, socket, profile;
function request(url) {
  return new Promise((resolve, reject) => {
    https.get({hostname: 'localhost', family: 4, port: 8080, path: url, ca: pem}, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => {
        try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (response.statusCode >= 400) throw new Error(value.error || response.statusCode); resolve(value); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}
async function until(action, message, timeout = 120000) {
  const start = Date.now(); while (Date.now() - start < timeout) { const result = await action(); if (result) return result; await delay(200); } throw new Error(message);
}
function preserveExisting(before, after, newRooms) {
  const allowed = new Set(newRooms), oldScenes = before.studio && before.studio.scenes || [];
  assert(!oldScenes.some(scene => allowed.has(scene.id)), 'Creation cannot replace an existing level.');
  Object.keys(before.rooms).filter(id => !allowed.has(id)).forEach(id => assert.equal(hash(after.rooms[id]), hash(before.rooms[id]), 'Existing room changed: ' + id));
  Object.keys(before).filter(key => !['rooms', 'studio'].includes(key)).forEach(key => assert.equal(hash(after[key]), hash(before[key]), 'Existing project data changed: ' + key));
  const studio = after.studio || {};
  Object.entries(before.studio || {}).filter(([, value]) => Array.isArray(value)).forEach(([key, values]) => {
    const previous = values.filter(value => !allowed.has(value.roomId || key === 'scenes' && value.id));
    previous.forEach(value => assert((studio[key] || []).some(current => hash(current) === hash(value)), 'Existing Studio record changed: ' + key));
  });
}
function differences(before, after, prefix = '', rows = []) {
  if (before === undefined && after === undefined || before !== undefined && after !== undefined && hash(before) === hash(after)) return rows;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') rows.push({path: prefix, before, after});
  else Array.from(new Set(Object.keys(before).concat(Object.keys(after)))).forEach(key => differences(before[key], after[key], prefix + '/' + key, rows));
  return rows;
}
function restoreRoomPrecision(before, after, newRooms) {
  const allowed = new Set(newRooms), restored = [];
  Object.keys(before.rooms).filter(id => !allowed.has(id)).forEach(roomId => {
    if (hash(before.rooms[roomId]) === hash(after.rooms[roomId])) return;
    const delta = differences(before.rooms[roomId], after.rooms[roomId]);
    assert(delta.every(row => /\/quaternion\/[0-3]$/.test(row.path) && typeof row.before === 'number' && typeof row.after === 'number' &&
      Number.isFinite(row.before) && Number.isFinite(row.after) && Math.abs(row.before - row.after) <= 1e-12), 'An existing room changed beyond unit-quaternion roundoff: ' + roomId);
    // Keep every original byte of room data. The strict hash guard still runs
    // afterwards, including on the server-validated payload, before any write.
    after.rooms[roomId] = JSON.parse(JSON.stringify(before.rooms[roomId]));
    restored.push({roomId, quaternionComponents: delta.length, propertyOrderOnly: !delta.length, maxRoundoff: Math.max(0, ...delta.map(row => Math.abs(row.before - row.after)))});
  });
  return restored;
}

// Executed in Chrome using production document, CollisionWorld and runtime.
function installCediQA() {
  const e = context.editor, r = e.simulation, world = e.collisionWorld;
  if (!r.running || !world || context.collisionWorld !== world) throw new Error('Se requiere la simulación con CollisionWorld real.');
  const visible = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };
  const machines = [...r.records.values()].filter(record => ['source', 'conveyor', 'processor', 'palletQueue'].some(type => record.components[type]));
  const monitors = e.document.getObjects(e.roomId).map(object => ({object, config: e.document.getBehaviors(object).find(config => config.type === 'lineMonitor')})).filter(item => item.config);
  const lines = monitors.map(item => {
    const snapshot = r.getPanelSnapshot(item.config.targetId, item.config.scope || 'line'), members = snapshot.memberIds.map(id => r.records.get(id)).filter(record => machines.includes(record));
    const ids = new Set(members.map(record => record.id)), allSources = members.filter(record => record.components.source);
    const sources = allSources.filter(record => record.components.source.config.autoGenerate), manual = !sources.length;
    const receivers = members.filter(record => record.components.palletQueue && !ids.has(record.components.palletQueue.config.outputId));
    const expectedUnits = sources.reduce((sum, record) => { const c = record.components.source.config; return sum + c.totalLimit * (c.loadMode === 'pallet' ? c.palletColumns * c.palletRows * c.palletLayers : 1); }, 0);
    const panels = members.filter(record => r.machineComponent(record).config.withPanel);
    if (panels.length !== 1 || panels[0].id !== item.config.targetId) throw new Error('Cada línea debe conservar su único panel y monitor de control.');
    if (!allSources.length || sources.some(record => !record.components.source.config.totalLimit) || !receivers.length || !manual && !expectedUnits) throw new Error('El ejemplo no tiene una fuente finita y almacén terminal verificable.');
    if (manual && allSources.some(record => record.components.source.config.initialCount)) throw new Error('Un anexo manual vacío no debe generar cargas al abrirse.');
    const sensors = members.filter(record => record.components.conveyor).map(record => {
      let count = 0; record.object.traverse(node => { if (visible(node) && e.document.getBehaviors(node).some(config => config.type === 'sensor')) count++; });
      const config = record.components.conveyor.config;
      if (!!count !== !!config.withSensors) throw new Error('Los sensores físicos no coinciden con la configuración: ' + record.id);
      return {id: record.id, mechanism: config.mechanism, enabled: config.withSensors, count};
    });
    return {object: item.object, config: item.config, ids, members, sources, receivers, expectedUnits, manual, sensors};
  });
  if (!lines.length) throw new Error('Falta el monitor físico del escenario.');
  e.simulationPaused = true;
  const qa = {lines, elapsed: 0, previousLocomotion: context.studioLocomotion}; context.studioLocomotion = 'teleport';
  qa.restore = () => { context.studioLocomotion = qa.previousLocomotion; };
  qa.flow = () => lines.map(line => ({monitorId: line.object.userData.editorId, title: line.config.title, mode: line.manual ? 'manual' : 'automatic', expectedUnits: line.expectedUnits,
    generatedUnits: line.sources.reduce((sum, record) => sum + record.variables.generatedUnits, 0),
    receivedUnits: line.receivers.reduce((sum, record) => sum + record.variables.receivedUnits, 0),
    completePallets: line.receivers.reduce((sum, record) => sum + record.variables.completePallets, 0),
    receivers: line.receivers.map(record => ({id: record.id, receivedUnits: record.variables.receivedUnits, capacity: record.variables.capacity, queued: record.variables.queued, completePallets: record.variables.completePallets})), sensors: line.sensors}));
  qa.advance = seconds => {
    for (let t = 0; t < seconds - 1e-8; t += .1) { world.beginFrame(); try { e.root.updateMatrixWorld(true); r.execute(Math.min(.1, seconds - t)); } finally { world.endFrame(); } }
    qa.elapsed += seconds; const flow = qa.flow(); return {elapsed: qa.elapsed, completed: flow.filter(line => line.receivedUnits === line.expectedUnits).length, lines: flow.length};
  };
  qa.audit = () => {
    const analytics = lines.map(line => {
      const state = r.getAnalyticsSnapshot(line.config.targetId, 'line'), summary = state.summary;
      const seconds = ['busySeconds', 'idleSeconds', 'setupSeconds', 'blockedSeconds', 'downSeconds', 'pausedSeconds'].reduce((sum, key) => sum + summary[key], 0);
      if (Math.abs(seconds - state.observedSeconds) > 1e-5 || summary.entryUnits !== line.expectedUnits || summary.exitUnits !== line.expectedUnits || state.history.length < 20 || state.history.length > 600 || !state.control.ready) throw new Error('La analítica no conserva tiempo/unidades reales: ' + line.config.title);
      return {title: line.config.title, samples: state.history.length, observedSeconds: state.observedSeconds, summary, control: {ready: state.control.ready, samples: state.control.samples, lcl: state.control.lcl, center: state.control.center, ucl: state.control.ucl}};
    });
    const ownership = lines.map(line => {
      const entry = e.lineMonitors.entries.get(line.object); if (!entry) throw new Error('Falta el recurso privado del monitor.');
      const model = e.lineMonitors.layout(entry, e.roomId);
      model.products.forEach(product => { if (!line.ids.has(product.ownerId)) throw new Error('Una carga de otra línea aparece en el monitor.'); });
      return {title: line.config.title, visibleProducts: model.products.length, members: model.records.length};
    });
    e.entities.sync();
    const lights = [...e.entities.live.values()].filter(entry => entry.config.type === 'pointLight');
    if (lights.some(entry => entry.config.roomId !== e.roomId || entry.object.castShadow)) throw new Error('Hay luces de otro nivel o sombras puntuales no previstas.');
    return {flow: qa.flow(), analytics, ownership, lights: lights.map(entry => ({id: entry.config.id, visible: entry.object.visible, intensity: entry.object.intensity, range: entry.object.distance})), stats: e.performance.getStats(), gl: context.renderer.getContext().getError()};
  };
  qa.frameMonitor = (index, page = 'diagram') => {
    const item = lines[index], entry = e.lineMonitors.entries.get(item.object); item.object.updateWorldMatrix(true, true);
    const center = entry.plane.getWorldPosition(context.camera.position.clone()), normal = center.clone().set(0, 0, 1).applyQuaternion(entry.plane.getWorldQuaternion(context.camera.quaternion.clone())).normalize();
    const eye = center.clone().addScaledVector(normal, 3.5), previous = context.camera.getWorldPosition(center.clone());
    context.cameraRig.position.add(eye.clone().sub(previous)); context.cameraRig.updateMatrixWorld(true); context.camera.lookAt(center); context.camera.updateMatrixWorld(true);
    e.performance.update(context.camera, 0); entry.page = page; entry.dirty = true; e.lineMonitors.sync(e.roomId, .3, false);
    return {id: item.object.userData.editorId, page, position: eye.toArray()};
  };
  qa.frameTop = () => {
    const transfer = line => line.members.find(record => record.components.conveyor && record.components.conveyor.config.mechanism === 'liftTransfer');
    const line = lines.find(line => /rectangular|empaque/i.test(line.config.title) && transfer(line)) || lines.find(transfer);
    if (!line) return null;
    const corner = transfer(line), config = corner.components.conveyor.config;
    const inlet = line.members.find(record => record.components.conveyor && [record.components.conveyor.config.outputId, record.components.conveyor.config.branchId].includes(corner.id));
    const outlet = r.records.get(config.branchId || config.outputId), points = [];
    [inlet, corner, outlet].filter(record => record && record.components.conveyor).forEach(record => {
      const belt = record.components.conveyor, routes = belt.config.layout === 'tee' ? ['main', 'branch'] : ['main'];
      routes.forEach(route => { const length = r.pathLength(belt.config, route); for (let index = 0; index <= 24; index++) points.push(r.pathSurface(record, belt, r.pathPoint(belt.config, length * index / 24, route))); });
    });
    const minimum = points[0].clone(), maximum = points[0].clone(); points.forEach(point => { minimum.min(point); maximum.max(point); });
    const center = minimum.clone().add(maximum).multiplyScalar(.5), roof = e.document.getObjects(e.roomId).find(object => /Cubierta interior cerrada/.test(object.name));
    let ceiling = 8;
    if (roof) { roof.updateWorldMatrix(true, true); roof.traverse(node => { if (!node.geometry) return; if (!node.geometry.boundingBox) node.geometry.computeBoundingBox(); ceiling = Math.min(ceiling, node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld).min.y); }); }
    const eye = center.clone(); eye.y = Math.min(7.35, ceiling - .35);
    context.cameraRig.position.add(eye.clone().sub(context.camera.getWorldPosition(center.clone()))); context.cameraRig.updateMatrixWorld(true);
    const up = context.camera.up.clone(); context.camera.up.set(0, 0, -1); context.camera.lookAt(center); context.camera.up.copy(up); context.camera.updateMatrixWorld(true);
    e.performance.update(context.camera, 0);
    return {title: line.config.title, cornerId: corner.id, eye: eye.toArray(), center: center.toArray(), ceiling, belowCeiling: eye.y < ceiling, bounds: {min: minimum.toArray(), max: maximum.toArray()}};
  };
  qa.press = (index, action) => {
    const item = lines[index], entry = e.lineMonitors.entries.get(item.object), hand = context.desktopController;
    if ((['start', 'stop', 'pause', 'powerOn', 'powerOff', 'emergency', 'resetEmergency', 'speedDown', 'speedUp'].includes(action) || action.startsWith('equipment-action-')) && entry.page !== 'control') qa.press(index, 'control');
    entry.dirty = true; e.lineMonitors.sync(e.roomId, .3, false);
    const region = entry.regions.find(region => region.key === action && !region.disabled); if (!region) throw new Error('Mando no disponible: ' + action);
    const u = (region.x + region.width / 2) / entry.canvas.width, v = 1 - (region.y + region.height / 2) / entry.canvas.height;
    const point = entry.plane.localToWorld(context.camera.position.clone().set((u - .5) * .98, (v - .5) * .98, 0));
    const origin = r.interactionOrigin(hand), ray = new context.raycontrol.raycaster.constructor(origin, point.clone().sub(origin).normalize(), 0, 6), hit = ray.intersectObject(entry.plane)[0];
    if (!hit || !entry.state.isSelectable(hit, hand)) throw new Error('El rayo físico no puede alcanzar el mando.');
    entry.state.onSelectStart(hit, hand); entry.state.onSelectEnd(hit, hand); if (entry.notice) throw new Error(entry.notice);
    return {action, uv: hit.uv.toArray(), distance: hit.distance};
  };
  window.__cediQA = qa; return qa.flow();
}

async function run() {
  assert(projectId && projectId !== originalId, 'Usa --project ID del laboratorio separado; Mi escenario está protegido.');
  assert(!(smoke && create), '--smoke es sólo lectura y no admite --create.');
  const [existing, original] = await Promise.all([request('/api/projects/' + projectId), request('/api/projects/' + originalId)]);
  const before = existing.project, originalHash = hash(original.project.document);
  if (process.argv.includes('--inventory-only')) return console.log(JSON.stringify({projectId, revision: before.revision, scenes: before.document.studio.scenes, originalRevision: original.project.revision, originalHash}));
  if (create) assert.equal(before.revision, Number(option('--expected-revision')), 'Crear requiere --expected-revision coincidente.');
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-cedi-qa-'));
  browser = spawn(process.env.STUDIO_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1600,1000', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--ignore-certificate-errors-spki-list=' + fingerprint, 'about:blank'], {windowsHide: true, stdio: 'ignore'});
  const port = await until(() => { try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (_) { return null; } }, 'Chrome no inició.');
  const tabs = await fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json()); socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let next = 0; const pending = new Map(), exceptions = [], consoleErrors = [], expectedTransportMessages = [], apiWrites = [];
  socket.on('message', text => { const message = JSON.parse(text); if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result); } if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text); if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') { const value = message.params.args.map(arg => arg.value || arg.description).join(' '); (value === '[WDS] Disconnected!' ? expectedTransportMessages : consoleErrors).push(value); } if (message.method === 'Network.requestWillBeSent') { const request = message.params.request; if (/\/api\//.test(request.url) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) apiWrites.push({method: request.method, url: request.url}); } });
  const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
  const evaluate = async expression => { const value = await command('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, timeout: 180000}); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception && value.exceptionDetails.exception.description || value.exceptionDetails.text); return value.result.value; };
  fs.mkdirSync(artifacts, {recursive: true});
  const screenshot = async name => { const result = await command('Page.captureScreenshot', {format: 'png'}); fs.writeFileSync(path.join(artifacts, name + '.png'), Buffer.from(result.data, 'base64')); };
  await command('Runtime.enable'); await command('Page.enable'); await command('Network.enable'); await command('Network.setBlockedURLs', {urls: ['*://localhost:8080/sockjs-node/*']});
  if (smoke) {
    await command('Page.addScriptToEvaluateOnNewDocument', {source: 'window.__cediToastLog=[];const descriptor=Object.getOwnPropertyDescriptor(Node.prototype,"textContent");Object.defineProperty(Node.prototype,"textContent",Object.assign({},descriptor,{set(value){if(this.nodeType===1&&this.classList&&this.classList.contains("ed-toast"))window.__cediToastLog.push(String(value));descriptor.set.call(this,value)}}));'});
    const snapshots = [];
    const scenes = before.document.studio.scenes.filter(scene => names.includes(scene.name) || scene.name === 'Laboratorio industrial · Ejemplos');
    assert.equal(scenes.length, 3);
    await command('Page.navigate', {url: 'https://localhost:8080/?project=' + originalId + '&room=hall'});
    await until(async () => { try { return await evaluate('Boolean(window.context?.editor&&!context.editor.loadingProject&&!context.editor.initializing&&context.editor.currentProject)'); } catch (error) { if (/context.*destroyed|Cannot find context|Inspected target navigated/i.test(error.message)) return false; throw error; } }, 'La ruta pública de otro proyecto no abrió.');
    const explicitPublic = await evaluate('({project:context.editor.currentProject,url:location.href,active:context.editor.active,roomId:context.editor.roomId,toasts:window.__cediToastLog})');
    fs.writeFileSync(path.join(artifacts, 'cedi-public-project-probe.json'), JSON.stringify({expectedId: originalId, actual: explicitPublic, apiWrites}, null, 2));
    await screenshot('cedi-public-project-probe');
    assert.equal(explicitPublic.project.id, originalId, 'Una URL pública explícita debe respetar el proyecto solicitado, aunque otro proyecto se haya guardado más recientemente.');
    for (const scene of scenes) for (const mode of ['editor', 'public']) {
      const url = 'https://localhost:8080/' + (mode === 'editor' ? 'editor' : '') + '?project=' + projectId + '&room=' + scene.id;
      await command('Page.navigate', {url});
      await until(async () => { try { return await evaluate('Boolean(window.context?.editor&&!context.editor.loadingProject&&!context.editor.initializing&&context.editor.currentProject?.id===' + JSON.stringify(projectId) + '&&context.editor.roomId===' + JSON.stringify(scene.id) + '&&context.editor.active===' + (mode === 'editor') + ')'); } catch (error) { if (/context.*destroyed|Cannot find context|Inspected target navigated/i.test(error.message)) return false; throw error; } }, 'No abrió la ruta ' + url);
      const snapshot = await evaluate('(async()=>{const e=context.editor;if(context.studio?.ready)await context.studio.ready;e.simulationPaused=true;e.entities.sync();e.resize();if(e.active)e.home();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const camera=e.active?e.camera:context.camera;camera.updateMatrixWorld(true);const position=camera.getWorldPosition(camera.position.clone()),roof=e.document.getObjects(e.roomId).find(object=>/Cubierta interior cerrada/.test(object.name));let bounds=null;if(roof){roof.updateWorldMatrix(true,true);roof.traverse(node=>{if(!node.geometry)return;if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();const box=node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);if(bounds)bounds.union(box);else bounds=box})}const rect=context.renderer.domElement.getBoundingClientRect(),lights=[...e.entities.live.values()].filter(entry=>entry.config.type==="pointLight");return {project:e.currentProject,roomId:e.roomId,url:location.href,active:e.active,position:position.toArray(),ceiling:bounds&&bounds.min.y,inside:!!bounds&&position.y<bounds.min.y&&position.y>.5&&position.x>bounds.min.x&&position.x<bounds.max.x&&position.z>bounds.min.z&&position.z<bounds.max.z,lights:lights.length,foreignLights:lights.some(entry=>entry.config.roomId!==e.roomId),monitors:e.lineMonitors.entries.size,helperFlags:[...e.lineMonitors.entries.values()].every(entry=>entry.plane.userData.editorRuntimeHelper&&entry.plane.userData.editorNonCollidable),toasts:window.__cediToastLog,unsupported:(window.__cediToastLog||[]).filter(text=>/no est[aá] disponible en esta escena/i.test(text)),canvas:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},gl:context.renderer.getContext().getError(),stats:e.performance.getStats()}})()');
      snapshot.palette = await evaluate('(()=>{const e=context.editor,r=context.renderer,camera=e.active?e.camera:context.camera,target=r.getRenderTarget();r.setRenderTarget(null);r.render(e.hooks.renderScene,camera);const gl=r.getContext(),w=r.domElement.width,h=r.domElement.height,pixels=new Uint8Array(w*h*4),colors=new Set();gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let count=0,sum=0,squares=0;for(let y=12;y<h-90;y+=6)for(let x=12;x<w-12;x+=6){const index=(y*w+x)*4,red=pixels[index],green=pixels[index+1],blue=pixels[index+2],light=(red+green+blue)/3;colors.add((red>>3)+"/"+(green>>3)+"/"+(blue>>3));count++;sum+=light;squares+=light*light}const result={colors:colors.size,mean:sum/count,deviation:Math.sqrt(Math.max(0,squares/count-(sum/count)**2)),gl:gl.getError()};r.setRenderTarget(target);return result})()');
      const name = 'cedi-smoke-' + scene.id + '-' + mode; await screenshot(name);
      snapshots.push(Object.assign({mode, screenshot: path.join(artifacts, name + '.png')}, snapshot));
      fs.writeFileSync(path.join(artifacts, 'cedi-smoke.json'), JSON.stringify({projectId, revision: before.revision, snapshots, exceptions, consoleErrors, expectedTransportMessages, apiWrites}, null, 2));
      assert(snapshot.inside && !snapshot.foreignLights && snapshot.lights > 0 && snapshot.lights <= 8 && snapshot.monitors > 0 && snapshot.helperFlags, 'Cámara/luces/monitor incorrectos en ' + url);
      assert.deepEqual(snapshot.unsupported, [], 'La apertura no debe mostrar avisos de funciones no disponibles.'); assert.equal(snapshot.gl, 0);
      assert(snapshot.palette.colors >= 24 && snapshot.palette.deviation > 5, 'La cámara debe mostrar una escena real, no un fondo o paleta plana.');
      console.log('Smoke:', scene.id, mode, '· paleta', snapshot.palette.colors, '· luces', snapshot.lights, '· GL', snapshot.gl);
    }
    const [after, originalAfter] = await Promise.all([request('/api/projects/' + projectId), request('/api/projects/' + originalId)]);
    assert.equal(after.project.revision, before.revision); assert.equal(hash(after.project.document), hash(before.document));
    assert.equal(originalAfter.project.revision, original.project.revision); assert.equal(hash(originalAfter.project.document), originalHash);
    assert.deepEqual(apiWrites, []); assert.deepEqual(exceptions, []); assert.deepEqual(consoleErrors, []);
    const report = {projectId, revision: before.revision, explicitPublic, snapshots, originalUnchanged: true, projectUnchanged: true, apiWrites, exceptions, consoleErrors, expectedTransportMessages};
    fs.writeFileSync(path.join(artifacts, 'cedi-smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({projectId, revision: before.revision, routes: snapshots.length, originalUnchanged: true, projectWrites: apiWrites.length, exceptions, consoleErrors}));
    await command('Browser.close').catch(() => {}); return;
  }
  await command('Page.navigate', {url: 'https://localhost:8080/editor?project=' + projectId});
  await until(() => evaluate('Boolean(window.context?.editor?.active&&!context.editor.loadingProject&&context.editor.currentProject?.id===' + JSON.stringify(projectId) + ')'), 'El laboratorio no cargó.');
  let created;
  if (create) {
    created = await evaluate('(async()=>{const e=context.editor;if(e.currentProject.revision!==' + before.revision + ')throw new Error("Revisión inesperada");if(typeof e.studioTools.createCediExamples!=="function")throw new Error("La API CEDI aún no está disponible");const result=await e.studioTools.createCediExamples();return {result,document:await e.document.serialize()}})()');
    const added = created.result.scenarios.map(item => item.roomId).filter(id => !(before.document.studio.scenes || []).some(scene => scene.id === id));
    try {
      created.restoredPrecision = restoreRoomPrecision(before.document, created.document, added);
      preserveExisting(before.document, created.document, added);
      const validated = require('../server/validation').validateDocument(created.document, value => value);
      preserveExisting(before.document, validated, added);
    }
    catch (error) {
      const changedRooms = Object.keys(before.document.rooms).filter(id => !added.includes(id) && hash(before.document.rooms[id]) !== hash(created.document.rooms[id]));
      fs.writeFileSync(path.join(artifacts, 'cedi-preservation-failure.json'), JSON.stringify({projectId, revision: before.revision, newRooms: added,
        rooms: changedRooms.map(roomId => ({roomId, differences: differences(before.document.rooms[roomId], created.document.rooms[roomId])}))}, null, 2));
      throw error;
    }
    await evaluate('(async()=>{const e=context.editor;const saved=await e.projectClient.updateProject(' + JSON.stringify(projectId) + ',' + JSON.stringify(before.name) + ',' + JSON.stringify(created.document) + ',' + before.revision + ');await e.applyServerProject(saved);return {id:saved.id,revision:saved.revision}})()');
    console.log('Nuevos niveles guardados:', JSON.stringify(created.result.scenarios.map(item => ({roomId: item.roomId, kind: item.kind, title: item.title, expectedUnits: item.expectedUnits, objects: item.objectIds && item.objectIds.length}))));
  }
  const inventory = await evaluate('context.editor.document.studio.scenes');
  const targets = inventory.filter(scene => names.includes(scene.name) || scene.name === 'Laboratorio industrial · Ejemplos');
  assert(names.every(name => targets.some(scene => scene.name === name)), 'Faltan los dos niveles CEDI. Usa --create sólo cuando la API esté lista.');
  const reports = [];
  for (const scene of targets) {
    const interiorView = await evaluate('(async()=>{const e=context.editor;if(!e.active)e.enter();await e.hooks.gotoRoom(' + roomIds.indexOf(scene.id) + ');e.entities.sync();const camera=[...e.entities.live.values()].find(entry=>entry.config.type==="camera");if(camera)e.entities.useCamera(camera.config.id);e.select(null);e.camera.updateMatrixWorld(true);const position=e.camera.getWorldPosition(e.camera.position.clone()),roof=e.document.getObjects(e.roomId).find(object=>/Cubierta interior cerrada/.test(object.name));let bounds=null;if(roof){roof.updateWorldMatrix(true,true);roof.traverse(node=>{if(!node.geometry)return;if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();const box=node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);if(bounds)bounds.union(box);else bounds=box})}return {position:position.toArray(),authoredPosition:camera&&camera.owner.getWorldPosition(position.clone()).toArray(),matchesAuthored:!!camera&&position.distanceTo(camera.owner.getWorldPosition(position.clone()))<1e-5,ceiling:bounds&&bounds.min.y,belowCeiling:!!bounds&&position.y<bounds.min.y,insideRoofXZ:!!bounds&&position.x>bounds.min.x&&position.x<bounds.max.x&&position.z>bounds.min.z&&position.z<bounds.max.z}})()');
    fs.writeFileSync(path.join(artifacts, 'cedi-' + scene.id + '-interior-view.json'), JSON.stringify(interiorView, null, 2));
    await delay(250); await screenshot('cedi-' + scene.id + '-interior');
    assert(interiorView.matchesAuthored && interiorView.belowCeiling && interiorView.insideRoofXZ, 'La cámara inicial debe estar en el interior real bajo la cubierta: ' + JSON.stringify(interiorView));
    const authored = await evaluate('(async()=>{context.editor.syncNative();return JSON.stringify(await context.editor.document.serialize())})()');
    await evaluate('context.editor.leave()'); await delay(200);
    const flow = await evaluate('(' + installCediQA.toString() + ')()');
    for (let seconds = 0; seconds < 600; seconds += 10) {
      const progress = await evaluate('__cediQA.advance(10)');
      if (seconds % 50 === 0 || progress.completed === progress.lines) console.log(scene.name + ': ' + progress.elapsed + ' s · ' + progress.completed + '/' + progress.lines);
      if (progress.elapsed >= 30 && progress.completed === progress.lines) break;
    }
    const finalFlow = await evaluate('__cediQA.flow()');
    if (finalFlow.some(line => line.receivedUnits !== line.expectedUnits)) {
      const diagnostics = await evaluate('(()=>{const r=context.editor.simulation;return {time:r.time,flow:__cediQA.flow(),machines:[...r.records.values()].filter(record=>r.machineComponent(record)).map(record=>({id:record.id,name:record.object.name,variables:record.variables})),events:r.events.slice(-80)}})()');
      fs.writeFileSync(path.join(artifacts, 'cedi-' + scene.id + '-failure.json'), JSON.stringify({scene, diagnostics}, null, 2));
      throw new Error('La línea no entregó todas las unidades; consulta cedi-' + scene.id + '-failure.json.');
    }
    const audit = await evaluate('__cediQA.audit()');
    const presses = [];
    for (let index = 0; index < flow.length; index++) {
      await evaluate('__cediQA.frameMonitor(' + index + ')'); await delay(100); await screenshot('cedi-' + scene.id + '-monitor-' + (index + 1));
      presses.push(await evaluate('__cediQA.press(' + index + ',"pause")')); presses.push(await evaluate('__cediQA.press(' + index + ',"pause")'));
    }
    await evaluate('__cediQA.frameMonitor(0,"analytics")'); await delay(100); await screenshot('cedi-' + scene.id + '-analytics');
    const top = await evaluate('__cediQA.frameTop()');
    if (top) { assert(top.belowCeiling); await delay(100); await screenshot('cedi-' + scene.id + '-transfer-top'); }
    const restored = await evaluate('(async()=>{const e=context.editor;__cediQA.restore();e.enter();return JSON.stringify(await e.document.serialize())})()');
    assert.equal(restored, authored, 'Probar/recorrer no puede modificar el nivel guardado.');
    assert.equal(audit.gl, 0); reports.push({roomId: scene.id, name: scene.name, interiorView, audit, presses, top, authoredUnchanged: true});
  }
  const [saved, originalAfter] = await Promise.all([request('/api/projects/' + projectId), request('/api/projects/' + originalId)]);
  assert.equal(originalAfter.project.revision, original.project.revision); assert.equal(hash(originalAfter.project.document), originalHash, 'Mi escenario debe conservarse completo.');
  if (!create) assert.equal(hash(saved.project.document), hash(before.document), 'La auditoría sin --create no guarda ningún cambio.');
  if (created) preserveExisting(before.document, saved.project.document, created.result.scenarios.map(item => item.roomId).filter(id => !(before.document.studio.scenes || []).some(scene => scene.id === id)));
  const exportDirectory = path.join(root, 'data/exports'); fs.mkdirSync(exportDirectory, {recursive: true});
  fs.writeFileSync(path.join(exportDirectory, 'industrial-cedi-complete.json'), JSON.stringify(saved.project.document));
  const report = {projectId, revision: saved.project.revision, originalUnchanged: true, originalRevision: originalAfter.project.revision, created: created && created.result,
    restoredPrecision: created && created.restoredPrecision, export: path.join(exportDirectory, 'industrial-cedi-complete.json'),
    scenes: reports.map(scene => Object.assign(scene, {url: 'https://localhost:8080/editor?project=' + projectId + '&room=' + scene.roomId,
      exploreUrl: 'https://localhost:8080/?project=' + projectId + '&room=' + scene.roomId})), exceptions, consoleErrors, expectedTransportMessages};
  fs.writeFileSync(path.join(artifacts, 'cedi-scenarios.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(exceptions, []); assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({projectId, revision: saved.project.revision, levels: reports.length, originalUnchanged: true, exceptions, consoleErrors}));
  await command('Browser.close').catch(() => {});
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close(); if (browser && browser.exitCode === null) browser.kill();
  if (profile) { await delay(300); const resolved = path.resolve(profile); assert(path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('hello-cedi-qa-')); fs.rmSync(resolved, {recursive: true, force: true}); }
});
