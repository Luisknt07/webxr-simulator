'use strict';
// Real immutable production artifacts + real HTTPS/API/SQLite + disposable Chrome.
// No repository account, project, session, database or external service is used.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https');
const {spawn, spawnSync} = require('node:child_process'), {createHash, randomBytes, X509Certificate} = require('node:crypto'), WebSocket = require('ws');
const {createApplication} = require('../../apps/api/index.cjs');
const ROOT = path.resolve(__dirname, '../..'), OUTPUT = path.join(ROOT, 'data/qa-studio/workspace-production'), PREFIX = 'smarttwin-workspace-production-';
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function cleanup(directory) {
  const absolute = fs.realpathSync(directory), temporary = fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(absolute), temporary); assert(path.basename(absolute).startsWith(PREFIX)); assert(!fs.lstatSync(directory).isSymbolicLink());
  fs.rmSync(absolute, {recursive: true, force: true, maxRetries: 15, retryDelay: 250});
}
function request(origin, route, method = 'GET', data, cookie, expectedUser) {
  return new Promise((resolve, reject) => {
    const bytes = data === undefined ? null : Buffer.from(JSON.stringify(data)), headers = {Accept: 'application/json'};
    if (bytes) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = bytes.length; headers.Origin = origin; }
    if (cookie) headers.Cookie = cookie; if (expectedUser) headers['X-Studio-User'] = expectedUser;
    const req = https.request(new URL(route, origin), {method, family: 4, rejectUnauthorized: false, headers}, res => {
      const chunks = []; res.on('data', bytes => chunks.push(bytes)); res.on('end', () => { const body = Buffer.concat(chunks), text = body.toString('utf8'); let json = null; try { json = JSON.parse(text); } catch (_) {} resolve({status: res.statusCode, headers: res.headers, json, text, sha256: hash(body)}); });
    }); req.on('error', reject); req.end(bytes || undefined);
  });
}
async function startFixture(password, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX + 'data-')), errors = [];
  const bootstrap = spawnSync(process.execPath, [path.join(ROOT, 'apps/api/admin.cjs'), 'bootstrap', '--data-dir', directory, '--username', 'qa_production_owner', '--display-name', 'QA production owner', '--open-registration'], {cwd: ROOT, input: password, encoding: 'utf8', windowsHide: true});
  if (bootstrap.status !== 0) { cleanup(directory); throw new Error('Local owner bootstrap failed: ' + (bootstrap.stderr || bootstrap.stdout)); }
  const certificate = fs.readFileSync(path.join(ROOT, 'node_modules/webpack-dev-server/ssl/server.pem'));
  let application;
  try {
    application = createApplication({host: '127.0.0.1', tls: {key: certificate, cert: certificate}, dataDir: directory, voice:options.voice, voiceFetch:options.voiceFetch, maintenanceIntervalMs: 0, onError: error => errors.push(error.stack || String(error))});
    await new Promise((resolve, reject) => { application.server.once('error', reject); application.server.listen(0, '127.0.0.1', resolve); });
  } catch (error) { if (application) await application.close(); cleanup(directory); throw error; }
  return {application, certificate, errors, origin: 'https://localhost:' + application.server.address().port, async close() { await application.close(); cleanup(directory); }};
}
async function withBrowser(fixture, report, action) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX + 'chrome-')); let chrome, socket;
  const until = async (callback, message, timeout = 180000) => { const start = Date.now(); while (Date.now() - start < timeout) { const result = await callback(); if (result) return result; await delay(150); } throw new Error(message); };
  try {
    const fingerprint = createHash('sha256').update(new X509Certificate(fixture.certificate).publicKey.export({type: 'spki', format: 'der'})).digest('base64');
    chrome = spawn(process.env.STUDIO_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1600,1000', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--ignore-certificate-errors-spki-list=' + fingerprint, 'about:blank'], {windowsHide: true, stdio: 'ignore'});
    let launchError; chrome.on('error', error => { launchError = error; });
    const port = await until(() => { if (launchError) throw launchError; try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (_) { return null; } }, 'Disposable Chrome failed to start.', 20000);
    const pages = await fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json()); socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    let sequence = 0; const pending = new Map(), requests = new Map();
    socket.on('message', bytes => {
      const event = JSON.parse(bytes);
      if (event.id && pending.has(event.id)) { const task = pending.get(event.id); pending.delete(event.id); event.error ? task.reject(new Error(event.error.message)) : task.resolve(event.result); }
      if (event.method === 'Runtime.exceptionThrown') report.exceptions.push(event.params.exceptionDetails.exception && event.params.exceptionDetails.exception.description || event.params.exceptionDetails.text);
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') report.consoleErrors.push(event.params.args.map(value => value.value || value.description).join(' '));
      if (event.method === 'Network.requestWillBeSent') { const request = event.params.request; requests.set(event.params.requestId, {url: request.url, method: request.method}); }
      if (event.method === 'Network.responseReceived') { const response = event.params.response; report.responses.push({url: response.url, status: response.status, type: event.params.type}); }
      if (event.method === 'Network.loadingFailed' && event.params.errorText !== 'net::ERR_ABORTED') report.failedRequests.push({...requests.get(event.params.requestId), error: event.params.errorText});
    });
    socket.on('close', () => { for (const task of pending.values()) task.reject(new Error('Chrome CDP closed.')); pending.clear(); });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 180000); pending.set(id, {resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); }}); socket.send(JSON.stringify({id, method, params})); });
    const evaluate = async expression => { const result = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, timeout: 180000}); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception && result.exceptionDetails.exception.description || result.exceptionDetails.text); return result.result.value; };
    const call = (callback, ...args) => evaluate('(' + callback.toString() + ')(' + args.map(value => JSON.stringify(value)).join(',') + ')');
    const screenshot = async name => { await delay(150); const result = await send('Page.captureScreenshot', {format: 'png'}), filename = path.join(OUTPUT, name + '.png'); fs.writeFileSync(filename, Buffer.from(result.data, 'base64')); report.screenshots.push(filename); };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    try { return await action({send, evaluate, call, until, screenshot}); }
    catch (error) { await screenshot('failure').catch(() => {}); report.pageText = await evaluate('document.body.innerText.slice(-10000)').catch(() => 'unavailable'); throw error; }
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) { try { socket.send(JSON.stringify({id: 999999, method: 'Browser.close'})); } catch (_) {} await delay(500); socket.close(); }
    if (chrome && chrome.exitCode === null) chrome.kill(); await delay(700); cleanup(profile);
  }
}
async function verifyAccess(fixture, password, report) {
  const get = (route, cookie) => request(fixture.origin, route, 'GET', undefined, cookie);
  const editor = await get('/editor'); assert.equal(editor.status, 302); assert.match(editor.headers.location, /^\/login\?next=/);
  assert.equal((await get('/workspace/bundle.js')).status, 401); assert.equal((await get('/workspace/publication.json')).status, 401); assert.equal((await get('/data/studio.sqlite')).status, 404); assert.equal((await get('/api/library/scenes')).status, 401);
  const anonymous = await get('/api/public/scenes'); assert.equal(anonymous.status, 200); assert.deepEqual(anonymous.json.scenes.map(scene => scene.id), ['vr-robot-dispatch']);
  const owner = await request(fixture.origin, '/api/studio/login', 'POST', {username: 'qa_production_owner', password}); assert.equal(owner.status, 200); const setCookie = owner.headers['set-cookie'][0]; assert.match(setCookie, /; HttpOnly/); assert.match(setCookie, /; Secure/); assert.match(setCookie, /SameSite=Strict/); const ownerCookie = setCookie.split(';')[0];
  const library = await get('/api/library/scenes', ownerCookie); assert.equal(library.status, 200); assert.equal(library.json.scenes.length, require('../assets/validate-public-scenes').inventory(ROOT).includedCount);assert(library.json.scenes.some(scene=>scene.id==='vr-warehouse-missions'));
  const regular = await request(fixture.origin, '/api/studio/register', 'POST', {username: 'qa_production_creator', displayName: 'QA creator', password, role: 'superadmin', superadmin: true}); assert.equal(regular.status, 201); assert.equal(regular.json.user.role, 'creator'); assert.equal(regular.json.user.superadmin, false); assert.equal(regular.json.user.permissions.manageUsers, false); const cookie = regular.headers['set-cookie'][0].split(';')[0], userId = regular.json.user.id;
  const admin = await get('/api/studio/admin/users', cookie); assert.equal(admin.status, 403);
  const promote = await request(fixture.origin, '/api/studio/users/' + owner.json.user.id + '/role', 'PUT', {role: 'viewer'}, cookie, userId); assert.equal(promote.status, 403);
  const publish = await request(fixture.origin, '/api/publication/scenes', 'PUT', {previewAllExamples: true}, cookie, userId); assert.equal(publish.status, 403);
  const bundle = await get('/workspace/bundle.js', ownerCookie); assert.equal(bundle.status, 200); assert.equal(bundle.sha256, report.workspaceSha256);
  report.access = {anonymousEditor: editor.status, anonymousWorkspaceBundle: 401, anonymousLibrary: 401, anonymousScenes: anonymous.json.scenes.length, authenticatedScenes: library.json.scenes.length, cookie: {secure: true, httpOnly: true, sameSite: 'Strict'}, defaultRole: regular.json.user.role, attemptedPrivilegeIgnored: true, administrationDenied: admin.status, promotionDenied: promote.status, publicationDenied: publish.status};
  return owner.json.user;
}
async function verifyEditor(fixture, owner, password, report) {
  await withBrowser(fixture, report, async browser => {
    const ready = () => browser.until(() => browser.evaluate('Boolean(window.context && context.editor && !context.editor.initializing && !context.editor.loadingProject && context.studio && context.studio.ready)'), 'Production Workspace did not initialize.');
    const idle = () => browser.until(() => browser.evaluate('Boolean(context.editor.active && !context.editor.busy && !context.editor.loadingProject && !context.editor.creatingProject && !context.editor.creatingScene && !context.editor.creatingStudy)'), 'Editor operation did not complete.');
    console.log('Private production Chrome: login');
    await browser.send('Page.navigate', {url: fixture.origin + '/editor'}); await browser.until(() => browser.evaluate('location.pathname === "/login" && !!document.getElementById("login")'), 'Anonymous editor did not redirect to login.');
    await browser.call((username, password) => { const form = document.getElementById('login'); form.elements.username.value = username; form.elements.password.value = password; form.requestSubmit(); }, owner.username, password);
    await ready(); await browser.evaluate('context.studio.ready'); await idle();
    const identity = await browser.evaluate('({id:context.studio.client.user.id,canEdit:context.editor.canEditDocument(),base:document.baseURI,saveButton:context.editor.saveButton.isConnected,tree:context.editor.tree.isConnected,cookie:document.cookie})'); assert.equal(identity.id, owner.id); assert.equal(identity.canEdit, true); assert.equal(identity.saveButton, true); assert.equal(identity.tree, true); assert.equal(identity.cookie.includes('hello_studio_session'), false); assert.equal(new URL(identity.base).pathname, '/workspace/'); report.editor = {canEdit: true, base: identity.base, ui: true, sessionHiddenFromJS: true};
    const cookies = await browser.send('Network.getCookies', {urls: [fixture.origin]}); const session = cookies.cookies.find(cookie => cookie.name === 'hello_studio_session'); assert(session && session.httpOnly && session.secure && session.sameSite === 'Strict'); await browser.screenshot('editor-start');
    const wizard = async (method, title) => {
      await browser.call(method => { window.__workspaceQA = window.__workspaceQA || {}; window.__workspaceQA.operation = context.editor.studioTools[method](); return true; }, method);
      await browser.until(() => browser.evaluate('Boolean(document.querySelector(".ed-scene-create[open]"))'), 'Scene creation dialog did not open.');
      await browser.call(title => { const dialog = document.querySelector('.ed-scene-create'); dialog.querySelector('.ed-scene-create-choice').click(); dialog.querySelector('input').value = title; dialog.querySelector('form').requestSubmit(); }, title);
      await browser.evaluate('window.__workspaceQA.operation'); await idle();
    };
    console.log('Private production Chrome: create/save project'); await wizard('newProject', 'QA production project');
    const before = await browser.call(async () => { const editor = context.editor; const cube = await editor.perform(() => { const object = editor.document.addPrimitive(editor.roomId, 'box', '#e87542'); editor.document.setProperty(object, 'name', 'QA saved cube'); object.position.set(0, 1, 0); return object; }); window.__workspaceQA.cubeId = cube.userData.editorId; window.__workspaceQA.firstRoom = editor.roomId; return {id: editor.currentProject.id, revision: editor.currentProject.revision, room: editor.roomId, cubeId: cube.userData.editorId}; });
    await browser.evaluate('context.editor.saveButton.click()'); await browser.until(() => browser.call(revision => !context.editor.busy && !context.editor.dirty && context.editor.currentProject.revision > revision, before.revision), 'UI Save did not persist the cube.');
    console.log('Private production Chrome: create/change scene'); await wizard('newScene', 'QA second scene'); const secondRoom = await browser.evaluate('context.editor.roomId'); assert.notEqual(secondRoom, before.room); await browser.call(async () => { const saved = await context.editor.saveProject(); if (!saved) throw new Error('Scene save was not completed.'); });
    await browser.call(async firstRoom => { const ids = ['hall','sound','photogrammetry','vertigo','panoramastereo','panorama1','panorama2','panorama3','panorama4','panorama5']; await context.editor.hooks.gotoRoom(ids.indexOf(firstRoom)); }, before.room); await idle(); assert.equal(await browser.evaluate('context.editor.document.getObject(__workspaceQA.cubeId).name'), 'QA saved cube'); await browser.screenshot('saved-project-first-scene');
    const persisted = await browser.call(async id => { const editor = context.editor, saved = await editor.projectClient.getProject(id); await editor.openServerProject(saved, __workspaceQA.firstRoom); return {id: editor.currentProject.id, revision: editor.currentProject.revision, room: editor.roomId, cube: editor.document.getObject(__workspaceQA.cubeId).name, scenes: editor.document.studio.scenes.map(scene => scene.id)}; }, before.id); assert.equal(persisted.id, before.id); assert.equal(persisted.cube, 'QA saved cube'); assert.ok(persisted.scenes.includes(secondRoom));
    // A new document boot proves this was persisted, not merely retained in tabs.
    await browser.send('Page.navigate', {url: fixture.origin + '/editor?project=' + encodeURIComponent(before.id) + '&room=' + encodeURIComponent(before.room)}); await ready(); await browser.evaluate('context.studio.ready'); await idle();
    const reopened = await browser.call(cubeId => ({projectId: context.editor.currentProject.id, cube: context.editor.document.getObject(cubeId) && context.editor.document.getObject(cubeId).name, room: context.editor.roomId, scenes: context.editor.document.studio.scenes.map(scene => scene.id), gl: context.renderer.getContext().getError(), triangles: context.renderer.info.render.triangles}), before.cubeId); assert.equal(reopened.projectId, before.id); assert.equal(reopened.cube, 'QA saved cube'); assert.ok(reopened.scenes.includes(secondRoom)); assert.equal(reopened.gl, 0); assert.ok(reopened.triangles > 0); report.project = {saved: persisted, reopened}; await browser.screenshot('reopened-project');
    report.browserCookies = {secure: session.secure, httpOnly: session.httpOnly, sameSite: session.sameSite};
    assert.deepEqual(report.exceptions, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.failedRequests, []); const failures = report.responses.filter(value => value.url.startsWith(fixture.origin + '/') && value.status >= 400); assert.deepEqual(failures, []); assert.deepEqual(fixture.errors, []);
  });
}
async function run(options = {}) {
  const expected = options.expectedWorkspaceSha256; assert.match(expected || '', /^[a-f0-9]{64}$/, 'Pass the reviewed --expected-workspace-sha256 before running Chrome.');
  const bundle = fs.readFileSync(path.join(ROOT, 'artifacts/workspace/bundle.js')), manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/workspace/publication.json'), 'utf8')); assert.equal(hash(bundle), expected, 'Workspace artifact changed after review.'); assert.equal(manifest.bundleSha256, expected, 'Workspace receipt is stale.');
  fs.mkdirSync(OUTPUT, {recursive: true}); const report = {startedAt: new Date().toISOString(), workspaceSha256: expected, temporaryDatabaseOnly: true, exceptions: [], consoleErrors: [], failedRequests: [], responses: [], screenshots: []}, password = 'Disposable-Workspace-QA-' + randomBytes(12).toString('hex');
  const fixture = await startFixture(password);
  try { const owner = await verifyAccess(fixture, password, report); await verifyEditor(fixture, owner, password, report); report.passed = true; console.log('Private production QA passed: ' + expected); return report; }
  catch (error) { report.passed = false; report.failure = error.stack || String(error); throw error; }
  finally { report.completedAt = new Date().toISOString(); report.serverErrors = fixture.errors; fs.writeFileSync(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2)); await fixture.close(); }
}
module.exports = {run, request, startFixture, withBrowser};
if (require.main === module) { const flag = process.argv.indexOf('--expected-workspace-sha256'); run({expectedWorkspaceSha256: flag < 0 ? null : process.argv[flag + 1]}).catch(error => { console.error(error); process.exitCode = 1; }); }
