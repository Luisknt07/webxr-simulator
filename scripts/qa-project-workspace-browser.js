'use strict';
// Real compiled application + real Chrome + real API, isolated from data/studio.
// Every mutation goes to an HTTPS loopback server backed by an OS-temp database.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https');
const {spawn} = require('node:child_process'), {createHash, X509Certificate} = require('node:crypto'), WebSocket = require('ws');
const {ProjectStore} = require('../server/storage'), {createApiHandler} = require('../server/api');
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'data/qa-studio'), PREFIX = 'hello-workspace-browser-';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = data => createHash('sha256').update(data).digest('hex');
const PASSWORD = 'Disposable-browser-fixture-2026!';
const pem = () => fs.readFileSync(path.join(ROOT, 'node_modules/webpack-dev-server/ssl/server.pem'));
function cleanup(directory) {
  const absolute = path.resolve(directory); assert.equal(path.dirname(absolute), path.resolve(os.tmpdir())); assert(path.basename(absolute).startsWith(PREFIX));
  fs.rmSync(absolute, {recursive: true, force: true, maxRetries: 15, retryDelay: 250});
}
async function startTemporaryServer() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX + 'data-')), errors = [], writes = [];
  const store = new ProjectStore({dataDir: temporary}), api = createApiHandler({store, maintenanceIntervalMs: 0, onError: error => errors.push(error.stack || error.message)});
  const certificate = pem(), mime = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2'};
  const server = https.createServer({key: certificate, cert: certificate}, (req, res) => {
    const pathname = new URL(req.url, 'https://localhost').pathname;
    if (pathname.startsWith('/api/')) { if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) writes.push({method: req.method, path: pathname}); api(req, res); return; }
    let relative; try { relative = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch (_) { res.writeHead(400); res.end(); return; }
    if (!relative || relative === 'editor' || relative === 'editor/') relative = 'index.html';
    const file = path.resolve(ROOT, relative), allowed = ['assets/', 'res/', 'src/', 'shared/', 'examples/', 'node_modules/three/'].some(prefix => relative.startsWith(prefix)) || /^(?:index\.html|bundle\.js(?:\.map)?|collision-worker\.js(?:\.map)?|mesh-optimizer-worker\.js(?:\.map)?)$/.test(relative);
    if (!allowed || !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.stat(file, (error, stat) => { if (error || !stat.isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store'});
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; assert.notEqual(port, 8080);
  const origin = 'https://localhost:' + port;
  const request = (route, method = 'GET', data, cookie) => new Promise((resolve, reject) => {
    const body = data === undefined ? null : JSON.stringify(data), req = https.request(origin + route, {family: 4, method, rejectUnauthorized: false,
      headers: Object.assign(body ? {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)} : {}, cookie ? {Cookie: cookie} : {})}, response => {
      const chunks = []; response.on('data', value => chunks.push(value)); response.on('end', () => { try { resolve({status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()), cookie: (response.headers['set-cookie'] || [])[0]?.split(';')[0]}); } catch (error) { reject(error); } });
    }); req.on('error', reject); req.end(body || undefined);
  });
  return {origin, port, temporary, store, api, errors, writes, request, async close() { await new Promise(resolve => server.close(resolve)); api.close(); cleanup(temporary); }};
}
async function withBrowser(origin, action) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX + 'chrome-')); let browser, socket;
  const report = {exceptions: [], consoleErrors: [], apiFailures: [], writes: [], shots: []};
  const until = async (callback, message, timeout = 180000) => { const start = Date.now(); while (Date.now() - start < timeout) { const value = await callback(); if (value) return value; await delay(150); } throw new Error(message); };
  try {
    const fingerprint = createHash('sha256').update(new X509Certificate(pem()).publicKey.export({type: 'spki', format: 'der'})).digest('base64');
    browser = spawn(process.env.STUDIO_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1600,1000', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--ignore-certificate-errors-spki-list=' + fingerprint, 'about:blank'], {windowsHide: true, stdio: 'ignore'});
    browser.on('error', error => { report.launchError = error.message; });
    const port = await until(() => { if (report.launchError) throw new Error(report.launchError); try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (_) { return null; } }, 'Chrome did not start.', 20000);
    const pages = await fetch('http://127.0.0.1:' + port + '/json/list').then(value => value.json()); socket = new WebSocket(pages.find(value => value.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    let sequence = 0; const pending = new Map();
    socket.on('message', bytes => { const message = JSON.parse(bytes);
      if (message.id && pending.has(message.id)) { const promise = pending.get(message.id); pending.delete(message.id); message.error ? promise.reject(new Error(message.error.message)) : promise.resolve(message.result); }
      if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.consoleErrors.push(message.params.args.map(value => value.value || value.description).join(' '));
      if (message.method === 'Network.requestWillBeSent') { const request = message.params.request; if (request.url.includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) { assert(request.url.startsWith(origin + '/')); report.writes.push({method: request.method, url: request.url}); } }
      if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/') && message.params.response.status >= 400) report.apiFailures.push({status: message.params.response.status, url: message.params.response.url});
    });
    socket.on('close', () => { pending.forEach(value => value.reject(new Error('Chrome CDP closed.'))); pending.clear(); });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 180000); pending.set(id, {resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); }}); socket.send(JSON.stringify({id, method, params})); });
    const evaluate = async expression => { const result = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, timeout: 180000}); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    const call = (fn, ...args) => evaluate('(' + fn.toString() + ')(' + args.map(value => JSON.stringify(value)).join(',') + ')');
    const screenshot = async name => { await delay(120); const result = await send('Page.captureScreenshot', {format: 'png'}), file = path.join(OUTPUT, 'workspace-' + name + '.png'); fs.writeFileSync(file, Buffer.from(result.data, 'base64')); report.shots.push(file); };
    const navigate = async route => { await send('Page.navigate', {url: origin + route}); await until(() => evaluate('Boolean(window.context?.editor&&!context.editor.initializing&&!context.editor.loadingProject&&context.studio?.ready)'), 'Application did not initialize: ' + route); await evaluate('context.studio.ready'); };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', {urls: ['*googletagmanager.com/*', '*google-analytics.com/*', '*localhost:8080/sockjs-node/*']});
    try { await action({send, evaluate, call, until, screenshot, navigate, report}); }
    catch (error) { report.failure = error.stack; await screenshot('failure').catch(() => {}); report.body = await evaluate('document.body.innerText.slice(-9000)').catch(() => 'Unavailable'); throw error; }
    finally { fs.writeFileSync(path.join(OUTPUT, 'project-workspace-browser.json'), JSON.stringify(report, null, 2)); }
    return report;
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) { try { socket.send(JSON.stringify({id: 999999, method: 'Browser.close'})); } catch (_) {} await delay(500); socket.close(); }
    if (browser && browser.exitCode === null) browser.kill(); await delay(700); cleanup(profile);
  }
}
async function run() {
  const index = process.argv.indexOf('--expected-bundle-sha256'), expected = index < 0 ? null : process.argv[index + 1];
  assert(expected && /^[a-f0-9]{64}$/.test(expected), 'Pass --expected-bundle-sha256 after the reviewed build is ready.');
  const actual = digest(fs.readFileSync(path.join(ROOT, 'bundle.js'))); assert.equal(actual, expected, 'QA must run the requested compiled build.');
  fs.mkdirSync(OUTPUT, {recursive: true}); const fixture = await startTemporaryServer();
  try {
    const register = async username => { const result = await fixture.request('/api/studio/register', 'POST', {username, displayName: username, password: PASSWORD}); assert.equal(result.status, 201, JSON.stringify(result.body)); return {cookie: result.cookie, user: result.body.user}; };
    const owner = await register('qa_workspace_admin'), student = await register('qa_workspace_student');
    console.log('Workspace QA isolated server:', fixture.origin, 'build:', actual);
    const report = await withBrowser(fixture.origin, async b => {
      const step = name => console.log('Workspace Chrome:', name);
      const ready = () => b.until(() => b.evaluate('Boolean(context.editor.active&&!context.editor.loadingProject&&!context.editor.busy&&!context.editor.creatingProject&&!context.editor.creatingScene&&!context.editor.creatingStudy)'), 'Editor operation did not finish.');
      const submitChoice = async (kind, name, templateId) => {
        await b.until(() => b.evaluate('Boolean(document.querySelector(".ed-scene-create[open]"))'), 'Creation wizard did not open.');
        await b.call((choice, title, template) => { const dialog = document.querySelector('.ed-scene-create'); const buttons = [...dialog.querySelectorAll('.ed-scene-create-choice')]; buttons[{empty: 0, template: 1, guided: 2}[choice]].click(); dialog.querySelector('input').value = title; if (template) dialog.querySelector('select').value = template; dialog.querySelector('form').requestSubmit(); }, kind, name, templateId);
        await b.evaluate('window.__qaOperation'); await ready();
      };
      const login = async username => { await b.call((name, password) => { context.studio.open('account'); const form = context.studio.content.querySelector('form'); form.querySelector('input[type=text]').value = name; form.querySelector('input[type=password]').value = password; form.requestSubmit(); }, username, PASSWORD); await b.until(() => b.evaluate('Boolean(context.studio.client.user&&!context.studio.busy)'), 'Login did not complete.'); };
      step('guest gallery and limited menu'); await b.navigate('/');
      await b.evaluate('context.studio.open("personal")');
      const guest = await b.evaluate('({user:context.studio.client.user,buttons:[...context.studio.content.querySelectorAll("button")].map(v=>v.textContent),outsideControls:!context.studio.controls.hidden,canEdit:context.editor.canEditDocument()})');
      assert.equal(guest.user, null); assert.equal(guest.outsideControls, false); assert.equal(guest.canEdit, false); assert.equal(guest.buttons.length, 4); assert(!guest.buttons.some(value => /editor|Nuevo escenario|Mis proyectos/.test(value))); b.report.guest = guest; await b.screenshot('guest-menu');
      await b.evaluate('context.studio.open("scenes")'); await b.until(() => b.evaluate('context.studio.content.querySelectorAll(".studio-card").length===2'), 'Guest gallery must show two scenes.'); await b.screenshot('guest-scenes');
      step('login and authenticated editor'); await login('qa_workspace_admin'); await b.navigate('/editor'); await ready(); await b.screenshot('editor-empty-start');
      assert.equal(await b.evaluate('context.studio.client.user.id'), owner.user.id);
      step('new blank project wizard'); await b.evaluate('window.__qaOperation=context.editor.studioTools.newProject();true'); await b.screenshot('creation-wizard'); await submitChoice('empty', 'QA · Proyecto A');
      const blank = await b.evaluate('({project:context.editor.currentProject,scenes:context.editor.document.studio.scenes,environment:context.editor.document.studio.environments,types:context.editor.document.getObjects(context.editor.roomId).filter(v=>!context.editor.document.isNative(v)).map(v=>v.name)})');
      assert.equal(blank.scenes.length, 1); assert.equal(blank.environment[0].sky, 'day'); assert(blank.types.includes('Suelo del nivel')); b.report.blank = blank;
      await b.evaluate('window.__qaProjectA=context.editor.currentProject.id');
      step('new scene from a real template'); await b.evaluate('window.__qaOperation=context.editor.studioTools.newScene();true'); await submitChoice('template', 'QA · Transferencia L', 'included:lab-transfer-l');
      const template = await b.evaluate('({room:context.editor.roomId,count:context.editor.document.getObjects(context.editor.roomId).filter(v=>v.userData.editorPrefabKey==="conveyor").length,history:context.editor.document.undoStack.length})'); assert(template.count >= 3); b.report.template = template; await b.screenshot('template-scene');
      step('guided three conveyor L and three product profiles'); await b.evaluate('window.__qaOperation=context.editor.studioTools.newScene();true'); await submitChoice('guided', 'QA · L guiada');
      await b.until(() => b.evaluate('Boolean(context.editor.sceneGuide.layer)'), 'Guided construction did not open.');
      await b.call(() => { const guide = context.editor.sceneGuide; guide.prompt.value = 'Quiero un modelo con 3 transportadores de rodillos que hagan una L rectangular, ingresen 3 tipos de productos y un monitor de información.'; guide.interpret(); });
      const proposal = await b.evaluate('context.editor.sceneGuide.plan'); assert.equal(proposal.shape, 'l'); assert.equal(proposal.conveyorCount, 3); assert.equal(proposal.productCount, 3); assert.equal(proposal.monitor, true); await b.screenshot('guide-proposal');
      await b.evaluate('context.editor.sceneGuide.build.click()'); await b.until(() => b.evaluate('!context.editor.sceneGuide.layer&&!context.editor.busy'), 'Guided line did not build.');
      const guided = await b.evaluate('(()=>{const e=context.editor,objects=e.document.getObjects(e.roomId),machines=objects.filter(v=>v.parent===e.root&&v.userData.editorPrefabKey),source=machines.find(v=>v.userData.editorPrefabKey==="source");return {room:e.roomId,conveyors:machines.filter(v=>v.userData.editorPrefabKey==="conveyor").length,source:source&&e.document.getBehaviors(source).find(v=>v.type==="source"),monitors:objects.flatMap(v=>e.document.getBehaviors(v).filter(c=>c.type==="lineMonitor").map(c=>({target:c.targetId,title:c.title})))}})()');
      assert.equal(guided.conveyors, 3); assert(guided.source); assert.equal(JSON.parse(guided.source.catalog).length, 3); assert(guided.monitors.some(value => value.target)); b.report.guided = {proposal, built: guided}; await b.screenshot('guided-line');
      step('insert monitor object and bind through its dialog'); await b.call(() => { const e = context.editor; e.select(e.document.getObjects(e.roomId).find(v => v.parent === e.root && v.userData.editorPrefabKey === 'conveyor')); e.monitorWidgets.add(); });
      await b.until(() => b.evaluate('Boolean(context.editor.monitorWidgets.dialog)'), 'Monitor binding did not open.'); await b.screenshot('monitor-binding');
      await b.call(() => { const tools = context.editor.monitorWidgets, form = tools.dialog.querySelector('form'); form.querySelector('input').value = 'QA · Monitor vinculado'; form.requestSubmit(); });
      await b.until(() => b.evaluate('!context.editor.monitorWidgets.dialog&&!context.editor.busy'), 'Monitor binding did not complete.'); assert(await b.evaluate('context.editor.document.getBehaviors(context.editor.selected).some(v=>v.type==="lineMonitor"&&v.targetId&&v.title==="QA · Monitor vinculado")'));
      step('dirty tabs preserve original objects, undo, camera and clipboard'); await b.evaluate('context.editor.saveProject()');
      await b.call(async () => { const e = context.editor; const box = await e.perform(() => { const object = e.document.addPrimitive(e.roomId, 'box', '#aa4422'); e.document.setProperty(object, 'name', 'QA · Caja sin guardar'); return object; }); e.select(box); await e.copyObject(); e.camera.position.set(8, 7, 6); window.__qaTab = {id: box.userData.editorId, object: box, history: e.document.undoStack.length, room: e.roomId, clipboard: e.objectClipboard, renderer: context.renderer}; });
      await b.evaluate('window.__qaOperation=context.editor.studioTools.newProject();true'); await submitChoice('empty', 'QA · Proyecto B');
      await b.evaluate('window.__qaProjectB=context.editor.currentProject.id'); assert(await b.evaluate('context.editor.projectTabs.entries.get("project:"+__qaProjectA).dirty'));
      await b.evaluate('context.editor.projectTabs.activate("project:"+__qaProjectA)'); await ready();
      const restored = await b.evaluate('({sameObject:context.editor.document.getObject(__qaTab.id)===__qaTab.object,sameRenderer:context.renderer===__qaTab.renderer,history:context.editor.document.undoStack.length,expectedHistory:__qaTab.history,camera:context.editor.camera.position.toArray(),expectedCamera:context.editor.projectTabs.entries.get("project:"+__qaProjectA).camera.position.toArray(),clipboard:context.editor.objectClipboard===__qaTab.clipboard,dirty:context.editor.dirty,tabs:context.editor.projectTabs.entries.size,retained:context.editor.projectTabs.retainedSnapshots().length})');
      b.report.restored = restored; assert(restored.sameObject && restored.sameRenderer && restored.clipboard && restored.dirty); assert.equal(restored.history, restored.expectedHistory); assert(restored.camera.every((value, index) => Math.abs(value - restored.expectedCamera[index]) < .000001), JSON.stringify(restored)); assert(restored.tabs >= 2); await b.screenshot('project-tabs-restored');
      step('copy object properties into another level');
      const copied = await b.call(async () => { const e = context.editor, previous = e.roomId; await e.hooks.gotoRoom(0); const object = await e.pasteObject(), values = {room: e.roomId, name: object && object.name, copied: !!object && object.userData.editorId !== __qaTab.id, color: object && object.userData.editorColor}; await e.hooks.gotoRoom(['hall', 'sound', 'photogrammetry', 'vertigo', 'panoramastereo', 'panorama1', 'panorama2', 'panorama3', 'panorama4', 'panorama5'].indexOf(previous)); return values; });
      assert(copied.copied); assert(copied.name.includes('QA · Caja sin guardar')); b.report.copied = copied;
      step('share this project with the second user'); await b.evaluate('context.editor.shareProject()'); await b.until(() => b.evaluate('Boolean(context.editor.sharing.host?.querySelector("form"))'), 'Sharing form did not open.');
      await b.call(username => { const form = context.editor.sharing.host.querySelector('form'); form.querySelector('input').value = username; form.querySelector('select').value = 'editor'; form.requestSubmit(); }, 'qa_workspace_student');
      await b.until(() => b.evaluate('context.editor.sharing.host.textContent.includes("qa_workspace_student")&&!context.editor.busy'), 'Shared access was not granted.'); await b.screenshot('project-sharing'); await b.evaluate('context.editor.sharePanel.hidden=true');
      step('administration users, registration codes and group forms'); await b.evaluate('context.studio.open("users")'); await b.until(() => b.evaluate('Boolean(context.studio.content.querySelector(".studio-admin-body article"))&&!context.studio.busy'), 'Administration users did not load.');
      assert.equal(await b.evaluate('context.studio.content.querySelectorAll(".studio-admin-tabs button").length'), 5); await b.screenshot('admin-users');
      await b.evaluate('[...context.studio.content.querySelectorAll(".studio-admin-tabs button")].find(v=>v.textContent.includes("Grupos")).click()'); await b.until(() => b.evaluate('Boolean(context.studio.content.querySelector(".studio-admin-body form"))&&!context.studio.busy'), 'Group administration did not load.');
      await b.call(() => { const form = context.studio.content.querySelector('.studio-admin-body form'), fields = form.querySelectorAll('input'); fields[0].value = 'QA · Grupo de docencia'; fields[1].value = 'Grupo creado en base temporal por Chrome'; form.requestSubmit(); });
      await b.until(() => b.evaluate('context.studio.content.textContent.includes("QA · Grupo de docencia")&&!context.studio.busy'), 'Teaching group was not created.'); await b.screenshot('admin-groups');
      await b.evaluate('[...context.studio.content.querySelectorAll(".studio-admin-tabs button")].find(v=>v.textContent.includes("Códigos")).click()'); await b.until(() => b.evaluate('Boolean(context.studio.content.querySelector(".studio-admin-body form"))&&!context.studio.busy'), 'Registration codes did not load.');
      await b.call(() => { const form = context.studio.content.querySelector('.studio-admin-body form'); form.querySelector('input').value = 'QA · Invitación temporal'; form.requestSubmit(); });
      await b.until(() => b.evaluate('Boolean(context.studio.content.querySelector(".studio-admin-secret"))&&!context.studio.busy'), 'Registration code was not generated.'); b.report.admin = {tabs: 5, groupCreated: true, codeCreated: true};
      step('logout removes private state, then second user edits shared project');
      const immediate = await b.evaluate('(()=>{window.__qaLogout=context.studio.logout();return {user:context.studio.client.user,visible:[...context.editor.document.rooms.values()].some(v=>v.root.visible),clipboard:context.editor.objectClipboard,tabs:context.editor.projectTabs.entries.size}})()'); assert.equal(immediate.user, null); assert.equal(immediate.visible, false); assert.equal(immediate.clipboard, null); assert.equal(immediate.tabs, 0); await b.evaluate('__qaLogout'); b.report.logout = immediate;
      await login('qa_workspace_student'); await b.navigate('/editor'); await ready();
      const shared = await b.evaluate('(async()=>({user:context.studio.client.user.id,project:context.editor.currentProject,list:await context.editor.projectClient.listProjects()}))()');
      assert.equal(shared.user, student.user.id); assert.equal(shared.project.access.role, 'editor'); assert.equal(shared.list.length, 1); assert.equal(shared.list[0].name, 'QA · Proyecto A');
      await b.call(async () => { const e = context.editor; await e.perform(() => { const object = e.document.addPrimitive(e.roomId, 'box', '#2266aa'); e.document.setProperty(object, 'name', 'QA · Edición del colaborador'); }); await e.saveProject(); });
      b.report.shared = shared; await b.screenshot('collaborator-editor');
      const finish = await b.evaluate('({gl:context.renderer.getContext().getError(),canEdit:context.editor.canEditDocument(),user:context.studio.client.user.id})'); assert.equal(finish.gl, 0); assert(finish.canEdit); b.report.finish = finish;
      step('mobile public viewer and menu'); await b.evaluate('context.studio.logout()');
      await b.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true}); await b.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5}); await b.navigate('/'); await b.evaluate('context.studio.open("personal")');
      const mobile = await b.evaluate('(()=>{const rect=context.studio.drawer.getBoundingClientRect();return {width:innerWidth,drawer:{left:rect.left,right:rect.right,width:rect.width},outsideControls:!context.studio.controls.hidden,buttons:[...context.studio.content.querySelectorAll("button")].map(v=>v.textContent)}})()');
      assert.equal(mobile.width, 390); assert(mobile.drawer.left >= -1 && mobile.drawer.right <= mobile.width + 1); assert.equal(mobile.outsideControls, false); assert.equal(mobile.buttons.length, 4); b.report.mobile = mobile; await b.screenshot('mobile-public-menu');
      assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.consoleErrors, []); assert.deepEqual(b.report.apiFailures, []); b.report.buildHash = actual; b.report.temporaryDatabaseOnly = true;
    });
    assert.deepEqual(fixture.errors, []); assert(fixture.writes.length > 10); console.log('Workspace browser QA passed:', JSON.stringify({screenshots: report.shots.length, writes: fixture.writes.length, exceptions: report.exceptions.length, build: actual}));
  } finally { await fixture.close(); }
}
module.exports = {startTemporaryServer, withBrowser};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
