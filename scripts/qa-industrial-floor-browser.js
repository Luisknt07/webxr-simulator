'use strict';
// Compiled public viewer, disposable Chrome profile and local-only candidate.
// Never PUTs or uploads; server revisions/hashes are audited after each route.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createRequire} = require('node:module');
const helperFile = path.join(__dirname, 'upgrade-cedi-examples.js'), helperSource = fs.readFileSync(helperFile, 'utf8');
const {request, hash} = require('./upgrade-cedi-examples');
const OUTPUT = path.resolve(__dirname, '../data/qa-studio'), ORIGINAL = 'ce14b39b-5d77-45ea-a85e-1d7e0d76e872';
function readOnlySession() {
  const fetchOriginal = window.fetch.bind(window); window.__qaBlockedWrites = [];
  window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href), method = String(options.method || input.method || 'GET').toUpperCase();
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(method)) { window.__qaBlockedWrites.push({url: url.href, method}); return Promise.reject(new Error('Floor QA read-only: API writes are disabled.')); }
    if (url.pathname === '/api/studio/me') return Promise.resolve(new Response(JSON.stringify({user: null, configured: false, capabilities: {accounts: true, rooms: true}}), {status: 200, headers: {'Content-Type': 'application/json'}}));
    return fetchOriginal(input, options);
  };
}
function browserForRoom(roomId) {
  let prefix = helperSource.slice(0, helperSource.indexOf('// Production runtime/CollisionWorld'))
    .replace('await send(\'Page.navigate\',', 'await send("Page.addScriptToEvaluateOnNewDocument", {source: ' + JSON.stringify('(' + readOnlySession.toString() + ')()') + '});\n    await send(\'Page.navigate\',')
    .replace("'https://localhost:8080/editor?project=' + projectId", "'https://localhost:8080/?project=' + projectId + '&room=' + QA_ROOM")
    .replace('window.context?.editor?.active&&!context.editor.initializing', 'window.context?.editor&&!context.editor.active&&!context.editor.initializing')
    .replace('const result = await action({evaluate, screenshot, until, writes, exceptions, consoleErrors, transport, shots});', 'let result;try{result=await action({send,evaluate,screenshot,until,writes,exceptions,consoleErrors,transport,shots});}catch(error){console.error("Chrome QA failure:",error,{exceptions,consoleErrors,writes});throw error;}')
    .replace("socket.on('message', bytes =>", "socket.on('close', () => { for (const p of pending.values()) p.reject(new Error('Chrome CDP closed before completion.')); pending.clear(); }); socket.on('message', bytes =>")
    .replace('pending.set(id, {resolve, reject}); socket.send', "const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},180000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}}); socket.send")
    .replace("await send('Browser.close').catch(() => {}); return result;", "await send('Browser.close').catch(() => {}); await delay(1200); return result;")
    .replace('fs.rmSync(directory, {recursive: true, force: true, maxRetries: 8, retryDelay: 200});', 'try{fs.rmSync(directory,{recursive:true,force:true,maxRetries:12,retryDelay:300});}catch(error){console.error("Temporary Chrome profile cleanup:",error.message);}');
  assert(prefix.includes('Page.addScriptToEvaluateOnNewDocument')); assert(prefix.includes('QA_ROOM'));
  return new Function('require', '__dirname', 'QA_ROOM', prefix + '\nreturn withBrowser;')(createRequire(helperFile), __dirname, roomId);
}
async function initializeFloorQA() {
  const e = context.editor; e.projectSync.stop(); e.keepCurrentProject = async () => false;
  e.saveProject = async () => { throw new Error('Floor QA read-only: saving is disabled.'); };
  const visible = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };
  const controls = () => [...e.simulation.records.values()].filter(row => row.components.control).map(row => ({id: row.id, visible: visible(row.object), command: row.components.control.config.command, target: row.components.control.config.targetId}));
  const camera = {rig: context.cameraRig.position.toArray(), rigQuaternion: context.cameraRig.quaternion.toArray(), position: context.camera.position.toArray(), quaternion: context.camera.quaternion.toArray(), fov: context.camera.fov};
  window.__floorQA = {roomId: e.roomId, metadata: e.currentProject, camera, visible, controls, before: await e.document.serialize(), beforeControls: controls()};
  const gl = context.renderer.getContext(); window.__floorQA.glErrors = []; const render = context.renderer.render.bind(context.renderer);
  context.renderer.render = (...args) => { const result = render(...args); let error; while ((error = gl.getError()) !== gl.NO_ERROR) __floorQA.glErrors.push(error); return result; };
  const header = context.studio.header.getBoundingClientRect();
  return {project: e.currentProject, roomId: e.roomId, activeEditor: e.active, camera, controls: __floorQA.beforeControls, header: {visible: header.width > 0 && header.height > 0}, render: Object.assign({}, context.renderer.info.render)};
}
async function applyLocalCandidate(candidate) {
  const e = context.editor, qa = __floorQA;
  await e.applyServerProject({id: qa.metadata.id, name: qa.metadata.name, revision: qa.metadata.revision, document: candidate}, {roomId: qa.roomId});
  e.projectSync.stop(); e.simulationPaused = true;
  context.cameraRig.position.fromArray(qa.camera.rig); context.cameraRig.quaternion.fromArray(qa.camera.rigQuaternion); context.camera.position.fromArray(qa.camera.position); context.camera.quaternion.fromArray(qa.camera.quaternion); context.camera.fov = qa.camera.fov; context.camera.updateProjectionMatrix(); context.camera.updateWorldMatrix(true, false);
  if (context.desktopLook) context.desktopLook.reset(); if (context.resetCollisionPose) context.resetCollisionPose();
  const actor = e.document.getObjects(qa.roomId).find(object => object.userData.editorDescriptor?.type === 'industrialFloor'); if (!actor) throw new Error('Candidate floor actor was not instantiated.');
  qa.actorId = actor.userData.editorId; const floor = e.document.getObjects(qa.roomId).find(object => /piso.*(?:industrial|hormig)/i.test(object.name)); qa.floorId = floor?.userData.editorId;
  const plan = actor.userData.editorDescriptor, meshes = [], textures = new Set(), invalid = [], y = new Set();
  actor.traverse(mesh => { if (!mesh.geometry) return; const geometry = mesh.geometry, positions = geometry.attributes.position;
    if (mesh.material.map) textures.add(mesh.material.map); if (Array.from(positions.array).some(value => !Number.isFinite(value))) invalid.push(mesh.name);
    for (let index = 0; index < positions.count; index++) if (positions.getY(index) < plan.floorY + .03) y.add(Number(positions.getY(index).toFixed(6)));
    meshes.push({name: mesh.name, vertices: positions.count, triangles: geometry.index.count / 3, roughness: mesh.material.roughness, metalness: mesh.material.metalness, map: !!mesh.material.map, visible: mesh.material.visible, indexed: !!geometry.index, bias: mesh.material.polygonOffset, castsShadow: mesh.castShadow});
  });
  const wear = JSON.parse(e.document.getBehaviors(floor).find(value => value.type === 'surfaceWear')?.layers || '[]').filter(value => value.id.startsWith('industrial-floor-v1-'));
  const root = e.document.getRoot(qa.roomId), occupancy = plan.walkways.slice(0, 8).map(box => { const point = root.localToWorld(context.camera.position.clone().set((box[0] + box[2]) / 2, plan.floorY + 1.62, (box[1] + box[3]) / 2)); return {point: point.toArray(), free: e.collisionWorld.canOccupyCapsule(point)}; });
  return {id: actor.userData.editorId, pivot: actor.position.toArray(), floorId: qa.floorId, floorY: plan.floorY, bounds: plan.bounds, walkways: plan.walkways.length, zones: plan.zones.length, bays: plan.bays.length, labels: plan.labels.length, signs: plan.signs.length, crossings: plan.crossings.length, meshes, triangles: meshes.reduce((sum, row) => sum + row.triangles, 0), atlas: [...textures].map(texture => ({width: texture.image.width, height: texture.image.height})), invalid, floorLevels: [...y].sort((a, b) => a - b), wear: wear.map(layer => ({id: layer.id, stamps: layer.stamps.length, depth: layer.depth})), controls: qa.controls(), collisionDisabled: e.document.getBehaviors(actor).some(value => value.type === 'collision' && value.enabled === false), occupancy, gl: context.renderer.getContext().getError()};
}
function closeupFloor() {
  const e = context.editor, qa = __floorQA, actor = e.document.getObject(qa.actorId), plan = actor.userData.editorDescriptor, root = e.document.getRoot(qa.roomId);
  if (context.studio.setDesktopFlight) context.studio.setDesktopFlight(true);
  const label = plan.labels.find(row => row[5] === 1 || row[5] === 2 || row[5] === 3) || plan.labels.find(row => row[5] === 4);
  const target = root.localToWorld(context.camera.position.clone().set(label?.[0] || 0, plan.floorY + .3, label?.[1] || 0));
  const eye = target.clone().add(target.clone().set(5.4, 5.8, 7.5).transformDirection(root.matrixWorld).multiplyScalar(10));
  context.cameraRig.position.copy(eye); context.cameraRig.quaternion.set(0, 0, 0, 1); context.camera.position.set(0, 0, 0); context.camera.lookAt(target); context.camera.updateWorldMatrix(true, false); if (context.desktopLook) context.desktopLook.reset(); if (context.resetCollisionPose) context.resetCollisionPose();
  return {label, target: target.toArray(), eye: eye.toArray()};
}
async function run() {
  fs.mkdirSync(OUTPUT, {recursive: true});
  const artifact = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'industrial-floor-upgrade.json'), 'utf8'));
  const original = (await request('/api/projects/' + ORIGINAL)).project;
  const targets = [{key: 'advanced', room: 'sound'}, {key: 'fundamentals', room: 'hall'}, {key: 'laboratory', room: 'sound'}], reports = [];
  for (const target of targets) {
    const entry = artifact.projects.find(value => value.key === target.key), before = (await request('/api/projects/' + entry.id)).project, candidate = JSON.parse(fs.readFileSync(entry.candidateFile, 'utf8'));
    assert.equal(before.revision, entry.baseRevision); assert.equal(hash(before.document), entry.baseHash); assert.equal(hash(candidate), entry.payloadHash);
    console.log('Floor Chrome opening:', target.key, target.room);
    const report = await browserForRoom(target.room)(entry.id, async b => {
      await b.until(() => b.evaluate('Boolean(context.studio?.header&&context.editor.roomId===' + JSON.stringify(target.room) + '&&context.editor.simulation.running)'), 'Published level did not start.');
      const initial = await b.evaluate('(' + initializeFloorQA.toString() + ')()'); assert(initial.header.visible); assert.equal(initial.activeEditor, false);
      console.log('Floor Chrome initial:', target.key, initial.project.revision);
      await b.screenshot('floor-' + target.key + '-before');
      const floor = await b.evaluate('(' + applyLocalCandidate.toString() + ')(' + JSON.stringify(candidate) + ')');
      assert.equal(floor.floorY, 0); assert.deepEqual(floor.pivot, [0, 0, 0]); assert(floor.meshes.length <= 8); assert(floor.triangles < 8000); assert.deepEqual(floor.invalid, []); assert(floor.atlas.length === 1); assert.deepEqual(floor.atlas[0], {width: 1024, height: 256}); assert(floor.collisionDisabled); assert(floor.occupancy.every(row => row.free)); assert(floor.meshes.every(row => row.indexed && row.bias && !row.castsShadow)); assert.deepEqual(floor.controls, initial.controls); assert.equal(floor.gl, 0);
      await b.screenshot('floor-' + target.key + '-after'); const closeup = await b.evaluate('(' + closeupFloor.toString() + ')()'); await b.screenshot('floor-' + target.key + '-closeup');
      const finish = await b.evaluate('({blockedWrites:__qaBlockedWrites,glErrors:__floorQA.glErrors,gl:context.renderer.getContext().getError(),headerVisible:context.studio.header.getBoundingClientRect().height>0})'); assert.deepEqual(finish.blockedWrites, []); assert.deepEqual(finish.glErrors, []); assert.equal(finish.gl, 0); assert(finish.headerVisible); assert.deepEqual(b.writes, []); assert.deepEqual(b.exceptions, []); assert.deepEqual(b.consoleErrors, []);
      return {projectId: entry.id, revision: before.revision, roomId: target.room, candidateHash: entry.payloadHash, initial, floor, closeup, finish, writes: b.writes, exceptions: b.exceptions, consoleErrors: b.consoleErrors, shots: b.shots};
    });
    const after = (await request('/api/projects/' + entry.id)).project; assert.equal(after.revision, before.revision); assert.equal(hash(after.document), hash(before.document)); reports.push(report); fs.writeFileSync(path.join(OUTPUT, 'industrial-floor-browser.json'), JSON.stringify({readOnly: true, reports}, null, 2)); console.log('Floor Chrome:', target.key, floorSummary(report));
  }
  const untouched = (await request('/api/projects/' + ORIGINAL)).project; assert.equal(untouched.revision, original.revision); assert.equal(hash(untouched.document), hash(original.document));
}
function floorSummary(report) { return JSON.stringify({room: report.roomId, meshes: report.floor.meshes.length, triangles: report.floor.triangles, walkways: report.floor.walkways, bays: report.floor.bays, controls: report.floor.controls.length, glErrors: report.finish.glErrors.length, writes: report.writes.length}); }
module.exports = {browserForRoom};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
