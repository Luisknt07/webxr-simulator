const __layout = require("../layout.cjs");
'use strict';
// Reads the two saved study projects in disposable Chrome profiles. All API
// writes are blocked before navigation; no authoring or database save occurs.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createRequire} = require('node:module');
const {request, hash} = require('../maintenance/upgrade-cedi-examples'), {validateDocument} = require('../../apps/api/server/validation');
const ROOMS = require('../../packages/project-model/shared/studio-document').ROOM_IDS;
const OUTPUT = __layout.map(path.resolve(__layout.oldDir("scripts/qa-study-projects-browser.js"), '../data/qa-studio'));
const PROJECTS = [{key: 'fundamentals', id: 'a18776be-ac57-452b-809a-46e69c2953e7', scenes: 9}, {key: 'advanced', id: '05397448-a767-4f3b-8371-2aeb7ed18ae0', scenes: 4}];
function readOnlySession() {
  const original = window.fetch.bind(window); window.__studyBlockedWrites = [];
  window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href), method = String(options.method || input.method || 'GET').toUpperCase();
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(method)) { __studyBlockedWrites.push({url: url.href, method}); return Promise.reject(new Error('Study QA is read-only.')); }
    if (url.pathname === '/api/studio/me') return Promise.resolve(new Response(JSON.stringify({user: null, configured: false, capabilities: {accounts: true, rooms: true}}), {status: 200, headers: {'Content-Type': 'application/json'}}));
    return original(input, options);
  };
}
const helperFile = __layout.map(path.join(__layout.oldDir("scripts/qa-study-projects-browser.js"), 'upgrade-cedi-examples.js')), helperSource = fs.readFileSync(helperFile, 'utf8');
const prefix = helperSource.slice(0, helperSource.indexOf('// Production runtime/CollisionWorld'))
  .replace("{windowsHide: true, stdio: 'ignore'}", "{windowsHide:true,stdio:['ignore','ignore','pipe']}")
  .replace('const port = await until', 'let chromeStderr="";browser.stderr.on("data",bytes=>{chromeStderr=(chromeStderr+bytes.toString()).slice(-12000);});\n    const port = await until')
  .replace('await send(\'Page.navigate\',', 'await send("Page.addScriptToEvaluateOnNewDocument", {source: ' + JSON.stringify('(' + readOnlySession.toString() + ')()') + '});\n    await send(\'Page.navigate\',')
  .replace('action({evaluate, screenshot, until, writes, exceptions, consoleErrors, transport, shots})', 'action({send, evaluate, screenshot, until, writes, exceptions, consoleErrors, transport, shots})')
  .replace('pending.set(id, {resolve, reject});', 'const timer=setTimeout(()=>{pending.delete(id);reject(new Error("Study CDP timeout: "+method));},120000);pending.set(id,{method,resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});')
  .replace("socket.on('message', bytes =>", 'socket.on("close",(code,reason)=>{for(const request of pending.values())request.reject(new Error("Study Chrome debugging socket closed at "+request.method+" ("+code+" "+reason+") "+chromeStderr));pending.clear();});socket.on(\'message\', bytes =>');
assert(prefix.includes('Page.addScriptToEvaluateOnNewDocument')); assert(prefix.includes('action({send, evaluate'));
const {withBrowser} = new Function('require', '__dirname', prefix + '\nreturn {withBrowser};')(createRequire(helperFile), __dirname);

function inspectLevel(expected) {
  const e = context.editor, document = e.document, roomId = e.roomId, root = document.getRoot(roomId), errors = [], machineTypes = ['source', 'conveyor', 'processor', 'palletQueue'];
  e.entities.sync(); if (e.active) { e.home(); e.render(0); } root.updateWorldMatrix(true, true);
  const visible = object => { for (let current = object; current; current = current.parent) if (!current.visible) return false; return true; };
  const additions = Array.from(document.additions.values()).filter(entry => entry.roomId === roomId);
  const savedIds = expected.additions.map(row => row.id).sort(), liveIds = additions.map(entry => entry.id).sort();
  if (JSON.stringify(savedIds) !== JSON.stringify(liveIds)) errors.push('Top-level persisted object IDs differ.');
  let nodes = 0, machines = [], savedMachines = [];
  expected.additions.forEach(row => {
    const object = document.getObject(row.id); if (!object) { errors.push('Missing object ' + row.id); return; }
    const actual = document.getBehaviors(object).filter(value => machineTypes.includes(value.type)), saved = (row.behaviors || []).filter(value => machineTypes.includes(value.type));
    if (JSON.stringify(actual) !== JSON.stringify(saved)) errors.push('Machine configuration differs: ' + row.id);
    actual.forEach(value => machines.push({id: row.id, type: value.type})); saved.forEach(value => savedMachines.push({id: row.id, type: value.type}));
    Object.entries(row.nodes || {}).forEach(([nodePath, value]) => { nodes++; const child = document.getObject(row.id + '/' + nodePath); if (!child) errors.push('Missing persisted node ' + row.id + '/' + nodePath); else { const configs = document.getBehaviors(child).filter(config => machineTypes.includes(config.type)); configs.forEach(config => machines.push({id: row.id + '/' + nodePath, type: config.type})); (value.behaviors || []).filter(config => machineTypes.includes(config.type)).forEach(config => savedMachines.push({id: row.id + '/' + nodePath, type: config.type})); } });
  });
  if (JSON.stringify(machines) !== JSON.stringify(savedMachines)) errors.push('Machine IDs/types differ from persisted JSON.');
  const objects = document.getObjects(roomId), native = objects.filter(object => document.isNative(object)), nativeVisible = native.filter(visible);
  const walls = additions.filter(entry => /CEDI · Muro/.test(entry.object.name) && visible(entry.object));
  const roof = additions.find(entry => entry.object.name === 'CEDI · Cubierta interior cerrada' && visible(entry.object));
  const floor = additions.find(entry => /Piso de hormigón|Piso industrial/.test(entry.object.name) && visible(entry.object));
  const environment = e.entities.environment.getConfig(), background = e.hooks.renderScene.background, skyColor = background && background.isColor ? '#' + background.getHexString() : null;
  const pointLights = [...e.entities.live.values()].filter(entry => entry.config.type === 'pointLight').map(entry => ({id: entry.config.id, intensity: entry.object.intensity, expectedIntensity: entry.config.intensity, visible: entry.object.visible}));
  const camera = e.active ? e.camera : context.camera, eye = root.worldToLocal(camera.getWorldPosition(camera.position.clone()));
  const ceiling = roof && roof.object, inside = ceiling ? Math.abs(eye.x - ceiling.position.x) < ceiling.scale.x / 2 && Math.abs(eye.z - ceiling.position.z) < ceiling.scale.z / 2 && eye.y > 0 && eye.y < ceiling.position.y : false;
  return {roomId, name: expected.name, activeEditor: e.active, topLevelObjects: additions.length, expectedObjects: expected.additions.length, persistedNodes: nodes, machines: machines.length, machineTypes: machines.reduce((counts, machine) => { counts[machine.type] = (counts[machine.type] || 0) + 1; return counts; }, {}), nativeObjects: native.length, nativeVisible: nativeVisible.map(object => object.name), walls: walls.length, roof: !!roof, floor: !!floor, environment, skyColor, pointLights, cameraLocal: eye.toArray(), cameraInside: inside, gl: context.renderer.getContext().getError(), rendererPrograms: context.renderer.info.programs.length, pendingRoom: document.hasPendingRoom(roomId), errors};
}
function assertLevel(actual, room, savedEnvironment) {
  assert.deepEqual(actual.errors, [], actual.roomId); assert.equal(actual.topLevelObjects, room.additions.length); assert(actual.machines > 0); assert(actual.persistedNodes > 0); assert(actual.nativeObjects > 0); assert.deepEqual(actual.nativeVisible, []); assert(actual.walls >= 4); assert(actual.roof && actual.floor); assert.equal(actual.gl, 0); assert(!actual.pendingRoom); assert.deepEqual(actual.environment, savedEnvironment); assert.equal(actual.skyColor, savedEnvironment.skyColor); assert(actual.pointLights.length > 0 && actual.pointLights.every(light => light.visible && light.intensity === light.expectedIntensity)); assert(actual.cameraInside, 'The authored camera must be inside the actual building: ' + JSON.stringify(actual.cameraLocal));
}
async function snapshot() {
  const list = (await request('/api/projects')).projects, rows = [];
  for (const project of list) { const value = (await request('/api/projects/' + project.id)).project; rows.push({id: value.id, name: value.name, revision: value.revision, hash: hash(value.document)}); }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}
async function run() {
  console.log('Study Chrome QA: reading the saved project inventory.');
  fs.mkdirSync(OUTPUT, {recursive: true}); const before = await snapshot(), reports = [];
  for (const definition of PROJECTS) {
    const saved = (await request('/api/projects/' + definition.id)).project; assert.equal(saved.revision, 1, 'QA runs before the passive presentation batch.'); validateDocument(saved.document, value => value); assert.equal(saved.document.studio.scenes.length, definition.scenes);
    console.log('Study Chrome QA: opening', definition.key, saved.revision);
    const report = await withBrowser(definition.id, async browser => {
      await browser.evaluate('context.editor.projectSync.stop();context.editor.keepCurrentProject=async()=>false;context.editor.saveProject=async()=>{throw new Error("Read-only study QA");};true');
      const levels = [], shots = [];
      for (let index = 0; index < saved.document.studio.scenes.length; index++) {
        const level = saved.document.studio.scenes[index], expected = Object.assign({name: level.name}, saved.document.rooms[level.id]); console.log('Chrome study', definition.key, index + 1, '/', definition.scenes, level.id, level.name);
        await browser.evaluate('(async()=>{const e=context.editor;await e.hooks.gotoRoom(' + ROOMS.indexOf(level.id) + ');return true})()');
        await browser.until(() => browser.evaluate('context.editor.roomId===' + JSON.stringify(level.id) + '&&!context.editor.document.hasPendingRoom(' + JSON.stringify(level.id) + ')&&!context.editor.loadingProject&&!context.editor.pendingEdits'), 'The level did not settle: ' + level.id);
        const actual = await browser.evaluate('(' + inspectLevel.toString() + ')(' + JSON.stringify(expected) + ')'); assertLevel(actual, expected, saved.document.studio.environments.find(environment => environment.roomId === level.id)); levels.push(actual);
        if (definition.key === 'fundamentals' && index === 0 || definition.key === 'advanced' && index < 2) { const name = 'study-' + definition.key + '-' + index; await browser.screenshot(name); shots.push(name); }
      }
      assert.deepEqual(await browser.evaluate('__studyBlockedWrites'), []); assert.deepEqual(browser.writes, []);
      await browser.send('Page.navigate', {url: 'https://localhost:8080/?project=' + definition.id + '&room=' + saved.document.studio.startRoomId});
      await browser.until(() => browser.evaluate('Boolean(window.context?.editor&&!context.editor.initializing&&!context.editor.loadingProject&&context.editor.currentProject?.id===' + JSON.stringify(definition.id) + '&&!context.editor.active&&context.editor.simulation.running)'), 'The saved public project did not start.');
      const initial = saved.document.studio.scenes.find(level => level.id === saved.document.studio.startRoomId), publicExpected = Object.assign({name: initial.name}, saved.document.rooms[initial.id]);
      await browser.evaluate('context.editor.simulationPaused=true;true'); const publicRoute = await browser.evaluate('(' + inspectLevel.toString() + ')(' + JSON.stringify(publicExpected) + ')'); assert.equal(publicRoute.activeEditor, false); assertLevel(publicRoute, publicExpected, saved.document.studio.environments.find(environment => environment.roomId === initial.id));
      await browser.screenshot('study-' + definition.key + '-public-start');
      assert.deepEqual(await browser.evaluate('__studyBlockedWrites'), []); assert.deepEqual(browser.writes, []); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
      return {projectId: definition.id, name: saved.name, revision: saved.revision, levels, publicRoute, shots: browser.shots, writes: browser.writes, exceptions: browser.exceptions, consoleErrors: browser.consoleErrors, blockedWrites: []};
    }); reports.push(report);
  }
  assert.deepEqual(await snapshot(), before, 'Browser QA must preserve all saved projects.');
  const result = {readOnly: true, projects: reports, levels: reports.reduce((count, project) => count + project.levels.length, 0), publicRoutes: reports.length, allProjectsUnchanged: true, writes: []}; fs.writeFileSync(__layout.map(path.join(OUTPUT, 'study-projects-browser.json')), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({readOnly: true, levels: result.levels, publicRoutes: result.publicRoutes, allProjectsUnchanged: true, shots: reports.flatMap(project => project.shots)})); return result;
}
module.exports = {run}; if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
