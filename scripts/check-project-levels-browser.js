'use strict';
// Read-only navigation QA against two explicit projects and a fresh profile.
// It never creates, saves, refreshes or merges a project.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https');
const {spawn} = require('node:child_process'), {X509Certificate, createHash} = require('node:crypto'), WebSocket = require('ws');
const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'data/qa-studio');
const pem = fs.readFileSync(path.join(root, 'node_modules/webpack-dev-server/ssl/server.pem'));
const fingerprint = createHash('sha256').update(new X509Certificate(pem).publicKey.export({type: 'spki', format: 'der'})).digest('base64');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function argument(name) { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error('Falta ' + name); return process.argv[index + 1]; }
function project(id) {
  return new Promise((resolve, reject) => https.get({hostname: 'localhost', port: 8080, path: '/api/projects/' + encodeURIComponent(id), family: 4, ca: pem}, response => {
    let body = ''; response.on('data', part => body += part); response.on('end', () => { try { const result = JSON.parse(body); if (response.statusCode !== 200) throw new Error(result.error); resolve(result.project); } catch (error) { reject(error); } });
  }).on('error', reject));
}
async function until(action, message, maximum = 180000) {
  const start = Date.now();
  while (Date.now() - start < maximum) {
    try { const result = await action(); if (result) return result; }
    catch (error) { if (!/context.*destroyed|Cannot find context|Inspected target navigated/i.test(error.message)) throw error; }
    await delay(250);
  }
  throw new Error(message);
}
async function withBrowser(action) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-project-levels-'));
  const executable = process.env.STUDIO_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = spawn(executable, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1600,1000', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--ignore-certificate-errors-spki-list=' + fingerprint, 'about:blank'], {windowsHide: true, stdio: 'ignore'});
  let socket;
  try {
    const port = await until(() => { try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (_) { return null; } }, 'Chrome no inició.');
    const tabs = await fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json());
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const pending = new Map(), exceptions = [], writes = []; let next = 0;
    socket.on('message', bytes => {
      const data = JSON.parse(bytes); if (data.id && pending.has(data.id)) { const entry = pending.get(data.id); pending.delete(data.id); data.error ? entry.reject(new Error(data.error.message)) : entry.resolve(data.result); }
      if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails.text);
      if (data.method === 'Network.requestWillBeSent') { const request = data.params.request; if (/\/api\/projects(?:\/|$)/.test(new URL(request.url).pathname) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) writes.push({method: request.method, url: request.url}); }
    });
    function command(method, params = {}) { return new Promise((resolve, reject) => { const id = ++next; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); }); }
    async function evaluate(expression) { const value = await command('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, timeout: 180000}); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception && value.exceptionDetails.exception.description || value.exceptionDetails.text); return value.result.value; }
    async function navigate(url, id) {
      await command('Page.navigate', {url});
      try { await until(() => evaluate('Boolean(window.context?.editor?.active&&!context.editor.loadingProject&&!context.editor.initializing&&context.editor.currentProject?.id===' + JSON.stringify(id) + ')'), 'No abrió el proyecto explícito ' + id); }
      catch (error) {
        console.error('Navegación pendiente:', await evaluate('({url:location.href,editor:Boolean(window.context?.editor),active:window.context?.editor?.active,initializing:window.context?.editor?.initializing,loading:window.context?.editor?.loadingProject,project:window.context?.editor?.currentProject,room:window.context?.editor?.roomId,toast:window.context?.editor?.toastNode?.textContent})'));
        await screenshot('project-level-navigation-error'); throw error;
      }
      console.log('Abierto:', id, url);
    }
    async function screenshot(name) { const result = await command('Page.captureScreenshot', {format: 'png'}); fs.writeFileSync(path.join(artifacts, name + '.png'), Buffer.from(result.data, 'base64')); }
    const snapshot = () => evaluate('(()=>{const e=context.editor;return {project:e.currentProject,roomId:e.roomId,url:location.href,dirty:e.dirty,projectLabel:e.projectButton.textContent,levels:e.getSceneEntries(),gl:context.renderer.getContext().getError()}})()');
    await command('Runtime.enable'); await command('Page.enable'); await command('Network.enable'); await command('Network.setBlockedURLs', {urls: ['*://localhost:8080/sockjs-node/*']});
    const result = await action({evaluate, navigate, screenshot, snapshot}); assert.deepEqual(exceptions, []); assert.deepEqual(writes, [], 'Project navigation QA must issue no project writes.');
    return Object.assign(result, {exceptions, projectWrites: writes});
  } finally { if (socket) socket.close(); browser.kill(); }
}
async function run() {
  fs.mkdirSync(artifacts, {recursive: true});
  const originalId = argument('--original'), labId = argument('--lab'); assert.notEqual(originalId, labId);
  const before = await project(originalId), lab = await project(labId), roomId = lab.document.studio.startRoomId;
  assert(roomId, 'The saved laboratory must declare its initial level.');
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const originalHash = hash(before.document), originalURL = 'https://localhost:8080/editor?project=' + originalId;
  const labURL = 'https://localhost:8080/editor?project=' + labId + '&room=' + roomId;
  const sameBrowser = await withBrowser(async browser => {
    await browser.navigate(labURL, labId); const directLab = await browser.snapshot(); assert.equal(directLab.roomId, roomId);
    await browser.navigate(originalURL, originalId); const pinnedOriginal = await browser.snapshot(), original = pinnedOriginal;
    assert.equal(pinnedOriginal.project.id, originalId, 'Remembering the lab cannot override an explicit original-project URL.');
    assert(pinnedOriginal.projectLabel.includes(before.name), 'The current project is visible beside the level selector.');
    await browser.evaluate('context.editor.shell.browseProjectsButton.click()');
    await until(() => browser.evaluate('!context.editor.projectLibrary.overlay.hidden&&!context.editor.projectLibrary.loading'), 'No abrió la biblioteca visible.');
    await browser.evaluate('context.editor.projectLibrary.list.querySelector(' + JSON.stringify('[data-project-id="' + labId + '"]') + ').click()');
    await until(() => browser.evaluate('Boolean(context.editor.projectLibrary.levelList?.querySelector(' + JSON.stringify('[data-room-id="' + roomId + '"]') + '))'), 'No se muestra el nivel de laboratorio del otro proyecto.');
    await browser.screenshot('project-level-picker');
    await browser.evaluate('context.editor.projectLibrary.levelList.querySelector(' + JSON.stringify('[data-room-id="' + roomId + '"]') + ').click()');
    try {
      await until(async () => {
        const result = await browser.evaluate('(()=>{const e=context.editor,p=e.projectLibrary;return {ready:e.currentProject?.id===' + JSON.stringify(labId) + '&&e.roomId===' + JSON.stringify(roomId) + '&&!e.loadingProject&&p.overlay.hidden,error:p.feedback.hidden?null:p.feedbackText.textContent}})()');
        if (result.error) throw new Error(result.error); return result.ready;
      }, 'No abrió el nivel seleccionado.');
    } catch (error) { await browser.screenshot('project-level-open-error'); console.error('Estado al abrir:', await browser.snapshot()); throw error; }
    const openedLevel = await browser.snapshot(); assert.equal(new URL(openedLevel.url).searchParams.get('room'), roomId); assert.equal(openedLevel.dirty, false);
    await browser.screenshot('project-active-level');
    const otherRoom = roomId === 'hall' ? 1 : 0;
    await browser.evaluate('(()=>{const select=context.editor.roomSelect;select.value=' + JSON.stringify(String(otherRoom)) + ';select.dispatchEvent(new Event("change",{bubbles:true}))})()');
    await until(() => browser.evaluate('context.editor.ctx.room===' + otherRoom + '&&new URL(location.href).searchParams.get("room")===context.editor.roomId'), 'Cambiar de nivel no actualizó el enlace.');
    const changedLevel = await browser.snapshot(); assert.equal(changedLevel.dirty, false); assert.equal(new URL(changedLevel.url).searchParams.get('project'), labId);
    return {original, directLab, pinnedOriginal, openedLevel, changedLevel};
  });
  const freshBrowser = await withBrowser(async browser => { await browser.navigate(labURL, labId); const direct = await browser.snapshot(); assert.equal(direct.roomId, roomId); assert.equal(direct.dirty, false); await browser.screenshot('project-level-fresh-browser'); return {direct}; });
  const after = await project(originalId); assert.equal(after.revision, before.revision); assert.equal(hash(after.document), originalHash, 'The original project document must remain byte-for-byte equivalent.');
  const report = {originalId, labId, originalURL, labURL, originalRevisionBefore: before.revision, originalRevisionAfter: after.revision, originalUnchanged: true, sameBrowser, freshBrowser};
  fs.writeFileSync(path.join(artifacts, 'project-level-discovery.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({originalId, labId, originalRevision: after.revision, originalUnchanged: true, explicitURLsPinned: true, crossProjectLevelOpened: true, roomURLUpdated: true, freshBrowser: true, projectWrites: 0, exceptions: 0}, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
