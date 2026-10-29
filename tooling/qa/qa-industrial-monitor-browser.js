const __layout = require("../layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), {request, hash} = require('../maintenance/upgrade-cedi-examples'), {browserForRoom} = require('./qa-industrial-floor-browser');
const floor = require('../maintenance/upgrade-industrial-floor'), monitorAPI = require('../../tests/support/load-industrial-monitor-layout')(THREE, schema);
const messagesSource = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/qa-industrial-monitor-browser.js"), '../src/editor/IndustrialMessages.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const applyMessages = new Function('schema', messagesSource + '\nreturn applyIndustrialMessages;')(schema), clone = value => JSON.parse(JSON.stringify(value));
const OUTPUT = __layout.map(path.resolve(__layout.oldDir("scripts/qa-industrial-monitor-browser.js"), '../data/qa-studio'));
async function candidateFor(before, roomId) {
  const cpu = floor.loadCPU(), workspace = floor.nativeRoots(before.document), document = new cpu.SceneDocument({scene: workspace.scene}); Object.entries(workspace.roots).forEach(([id, root]) => document.registerRoom(id, root)); await document.load(before.document);
  const messages = applyMessages(document, roomId), layout = monitorAPI.applyIndustrialMonitorLayout(document, roomId); assert.deepEqual(layout.warnings, []); assert(layout.changed);
  const loaded = await document.serialize(), candidate = clone(before.document), removed = new Set(layout.removedLegacyIds), affected = new Set(layout.affectedObjectIds.concat(messages.changedObjectIds)), added = new Set(layout.addedObjectIds), afterById = new Map(loaded.rooms[roomId].additions.map(row => [row.id, row]));
  candidate.rooms[roomId].additions = candidate.rooms[roomId].additions.filter(row => !removed.has(row.id)).map(row => affected.has(row.id) ? Object.assign({}, row, {position: afterById.get(row.id).position, quaternion: afterById.get(row.id).quaternion, scale: afterById.get(row.id).scale, behaviors: afterById.get(row.id).behaviors}) : row).concat([...added].map(id => afterById.get(id)));
  candidate.studio.groups = candidate.studio.groups.map(group => layout.affectedGroupIds.includes(group.id) ? Object.assign({}, group, {members: loaded.studio.groups.find(value => value.id === group.id).members}) : group);
  const machineRows = value => value.rooms[roomId].additions.filter(row => row.behaviors.some(config => schema.simulationTypes.includes(config.type)));
  assert.deepEqual(machineRows(candidate), machineRows(before.document), 'Preparing a monitor candidate preserves every machine/control record.');
  const report = {affectedObjectIds: layout.affectedObjectIds, addedObjectIds: layout.addedObjectIds, removedLegacyIds: layout.removedLegacyIds, affectedGroupIds: layout.affectedGroupIds, layouts: layout.layouts, warnings: layout.warnings, report: layout.report, messages};
  return {document: candidate, report};
}
async function initialize() {
  const e = context.editor; e.projectSync.stop(); e.keepCurrentProject = async () => false; e.saveProject = async () => { throw new Error('Monitor QA cannot save.'); };
  window.__monitorQA = {metadata: e.currentProject, roomId: e.roomId, trusted: []}; context.renderer.domElement.addEventListener('mousedown', event => __monitorQA.trusted.push(event.isTrusted));
  __monitorQA.glErrors = []; const gl = context.renderer.getContext(), render = context.renderer.render.bind(context.renderer); context.renderer.render = (...args) => { const result = render(...args); let error; while ((error = gl.getError()) !== gl.NO_ERROR) __monitorQA.glErrors.push(error); return result; };
  return {project: e.currentProject, roomId: e.roomId, activeEditor: e.active};
}
async function applyLocal(candidate, monitorId) {
  const e = context.editor, qa = __monitorQA; await e.applyServerProject({id: qa.metadata.id, name: qa.metadata.name, revision: qa.metadata.revision, document: candidate}, {roomId: qa.roomId}); e.projectSync.stop(); e.simulationPaused = true;
  context.studio.setDesktopFlight(true); qa.monitorId = monitorId; e.lineMonitors.sync(e.roomId, 1, false); qa.entry = e.lineMonitors.entries.get(e.document.getObject(monitorId)); if (!qa.entry) throw new Error('No actual monitor entry.');
  qa.beforeActions = JSON.stringify(await e.document.serialize());
  return {faces: qa.entry.planes.length, sameTexture: qa.entry.planes.every(face => face.material.map === qa.entry.texture), sameMaterial: qa.entry.planes[0].material === qa.entry.planes[1].material, registeredFaces: qa.entry.state.colliderMesh.length, canvas: [qa.entry.canvas.width, qa.entry.canvas.height], owner: {position: qa.entry.owner.position.toArray(), scale: qa.entry.owner.scale.toArray()}, supportCount: e.document.getObjects(e.roomId).filter(object => object.name.startsWith('Suspensión HMI v1 · ' + monitorId)).length, gl: context.renderer.getContext().getError()};
}
function frame(side, overview = false, regionKey = '') {
  const e = context.editor, qa = __monitorQA, entry = qa.entry, face = side === 'rear' ? entry.backPlane : entry.plane, root = e.document.getRoot(e.roomId);
  face.updateWorldMatrix(true, false); const target = face.getWorldPosition(context.camera.position.clone()), normal = target.clone().set(0, 0, 1).transformDirection(face.matrixWorld), up = target.clone().set(0, 1, 0).transformDirection(root.matrixWorld), right = target.clone().set(1, 0, 0).transformDirection(face.matrixWorld);
  const eye = target.clone().addScaledVector(normal, overview ? 5 : 2).addScaledVector(up, overview ? 2.4 : -.53); if (overview) eye.addScaledVector(right, 2.7);
  if (regionKey) { const region = entry.regions.find(value => value.key === regionKey); if (!region) throw new Error('No region ' + regionKey); target.set(((region.x + region.width / 2) / 1024 - .5) * .98, (.5 - (region.y + region.height / 2) / 576) * .98, 0).applyMatrix4(face.matrixWorld); }
  context.cameraRig.position.copy(eye); context.cameraRig.quaternion.set(0, 0, 0, 1); context.camera.position.set(0, 0, 0); context.camera.lookAt(target); context.camera.updateWorldMatrix(true, false); if (context.desktopLook) context.desktopLook.reset(); if (context.resetCollisionPose) context.resetCollisionPose(); e.lineMonitors.sync(e.roomId, .3, false);
  const rect = context.renderer.domElement.getBoundingClientRect(); return {side, eye: eye.toArray(), target: target.toArray(), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, page: entry.page};
}
function status() {
  const e = context.editor, entry = __monitorQA.entry, panel = e.simulation.getPanelSnapshot(e.lineMonitors.targetId(entry), entry.config.scope || 'line');
  const sound = e.industrialAudio;
  if (sound.master && !__monitorQA.analyser) { __monitorQA.analyser = context.audioListener.context.createAnalyser(); __monitorQA.analyser.fftSize = 512; sound.master.connect(__monitorQA.analyser); }
  let rms = 0; if (__monitorQA.analyser) { const samples = new Float32Array(__monitorQA.analyser.fftSize); __monitorQA.analyser.getFloatTimeDomainData(samples); rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length); }
  return {page: entry.page, members: panel.memberIds, powered: panel.memberIds.map(id => e.simulation.records.get(id).variables.powered), presses: entry.presses.size, trusted: __monitorQA.trusted, audio: {activated: sound.activated, muted: sound.muted, context: context.audioListener.context.state, voices: sound.voices.size, rms}, gl: context.renderer.getContext().getError(), hit: !!context.desktopControllerData.currentIntersection};
}
function contextualMessage(far = false) {
  const e = context.editor, runtime = e.behaviors, component = runtime.contextual[0]; if (!component) throw new Error('No actual contextual info component.');
  const point = component.object.getWorldPosition(context.camera.position.clone()), eye = far ? point.clone().set(1000, 100, 1000) : point.clone().add(point.clone().set(0, .1, 2));
  context.cameraRig.position.copy(eye); context.cameraRig.quaternion.set(0, 0, 0, 1); context.camera.position.set(0, 0, 0); context.camera.lookAt(point); context.camera.updateWorldMatrix(true, false); if (context.desktopLook) context.desktopLook.reset(); if (context.resetCollisionPose) context.resetCollisionPose();
  for (let index = 0; index < 30; index++) runtime.execute(.05, index * .05);
  const active = runtime.contextualActive, card = active && active.card, texture = card && card.material.map;
  return {expectedId: component.object.userData.editorId, stats: Object.assign({}, runtime.contextualStats), targetOpacity: active && active.targetOpacity, dimensions: texture ? [texture.image.width, texture.image.height] : null, visibleTargets: runtime.contextual.filter(value => value.targetOpacity > 0).length};
}
async function run() {
  fs.mkdirSync(OUTPUT, {recursive: true}); const targets = [{key: 'fundamentals', id: 'a18776be-ac57-452b-809a-46e69c2953e7', room: 'hall'}];
  if (process.argv.includes('--all')) targets.push({key: 'advanced', id: '05397448-a767-4f3b-8371-2aeb7ed18ae0', room: 'sound'}, {key: 'laboratory', id: '194c1284-1c6e-4f2a-b089-9c540ed6e32b', room: 'sound'});
  const reports = [];
  const artifactIndex = process.argv.indexOf('--candidate-manifest'), artifact = artifactIndex < 0 ? null : JSON.parse(fs.readFileSync(__layout.map(path.resolve(process.argv[artifactIndex + 1])), 'utf8'));
  for (const target of targets) {
    const before = (await request('/api/projects/' + target.id)).project; let prepared;
    if (artifact) {
      const project = artifact.projects.find(value => value.key === target.key); assert.equal(project.id, target.id); assert.equal(before.revision, project.baseRevision);
      const candidate = JSON.parse(fs.readFileSync(project.candidateFile, 'utf8')); assert.equal(hash(candidate), project.payloadHash); const manifest = project.manifest.find(value => value.roomId === target.room);
      prepared = {document: candidate, report: {affectedObjectIds: manifest.monitorIds, addedObjectIds: manifest.addedObjectIds, removedLegacyIds: manifest.removedLegacyIds, layouts: manifest.layouts, warnings: manifest.warnings, report: manifest.helperReports.monitors, candidateHash: project.payloadHash, helperReports: manifest.helperReports}};
    } else prepared = await candidateFor(before, target.room);
    console.log('Monitor Chrome opening:', target.key, prepared.report.report);
    const report = await browserForRoom(target.room)(target.id, async b => {
      await b.until(() => b.evaluate('Boolean(context.studio?.header&&context.editor.simulation.running)'), 'Public viewer did not start.'); const initial = await b.evaluate('(' + initialize.toString() + ')()'); await b.screenshot('monitor-' + target.key + '-before');
      const geometry = await b.evaluate('(' + applyLocal.toString() + ')(' + JSON.stringify(prepared.document) + ',' + JSON.stringify(prepared.report.affectedObjectIds[0]) + ')'); assert.equal(geometry.faces, 2); assert(geometry.sameTexture && geometry.sameMaterial); assert.equal(geometry.supportCount, 3); assert.equal(geometry.gl, 0);
      let messages = null;
      if (process.argv.includes('--contextual')) {
        const near = await b.evaluate('(' + contextualMessage.toString() + ')()'); assert.equal(near.stats.canvases, 1); assert.equal(near.stats.activeId, near.expectedId); assert(near.targetOpacity > 0); assert.equal(near.visibleTargets, 1); assert.deepEqual(near.dimensions, [480, 300]); await b.screenshot('messages-' + target.key + '-near');
        const far = await b.evaluate('(' + contextualMessage.toString() + ')(true)'); assert.equal(far.stats.canvases, 0); assert.equal(far.visibleTargets, 0); messages = {near, far};
      }
      await b.evaluate('(' + frame.toString() + ')("front",true)'); await b.until(() => b.evaluate('context.studio.notice.hidden'), 'Flight notice did not expire.', 15000); await b.screenshot('monitor-' + target.key + '-ceiling-layout');
      const front = await b.evaluate('(' + frame.toString() + ')("front")'); await b.screenshot('monitor-' + target.key + '-front');
      const click = async (side, key) => { const point = await b.evaluate('(' + frame.toString() + ')(' + JSON.stringify(side) + ',false,' + JSON.stringify(key) + ')'); await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await b.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1}); await b.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1}); return b.evaluate('(' + status.toString() + ')()'); };
      await click('front', 'control'); await b.until(() => b.evaluate('__monitorQA.entry.page==="control"'), 'Front click did not select the actual control tab.');
      await click('front', 'powerOff'); const off = await b.until(() => b.evaluate('(()=>{const v=(' + status.toString() + ')();return v.powered.every(value=>value===false)?v:null})()'), 'Front button did not turn off its actual line.');
      const rear = await b.evaluate('(' + frame.toString() + ')("rear")'); await b.screenshot('monitor-' + target.key + '-rear'); await click('rear', 'powerOn'); const on = await b.until(() => b.evaluate('(()=>{const v=(' + status.toString() + ')();return v.powered.every(value=>value===true)&&v.audio.activated&&v.audio.context==="running"&&v.audio.rms>0.000001?v:null})()'), 'Rear UV button and automatic audio did not become active.'); assert.equal(on.audio.muted, false);
      const finish = await b.evaluate('(async()=>{const e=context.editor;if(__monitorQA.analyser){e.industrialAudio.master.disconnect(__monitorQA.analyser);__monitorQA.analyser.disconnect();}e.stopRuntime();return {authoredUnchanged:JSON.stringify(await e.document.serialize())===__monitorQA.beforeActions,blockedWrites:__qaBlockedWrites,glErrors:__monitorQA.glErrors,gl:context.renderer.getContext().getError()}})()'); assert(finish.authoredUnchanged); assert.deepEqual(finish.blockedWrites, []); assert.deepEqual(finish.glErrors, []); assert.equal(finish.gl, 0); assert.deepEqual(b.writes, []); assert.deepEqual(b.exceptions, []); assert.deepEqual(b.consoleErrors, []); assert(on.trusted.length >= 3 && on.trusted.every(Boolean));
      return {initial, geometry, messages, front, rear, off, on, finish, shots: b.shots, writes: b.writes, exceptions: b.exceptions, consoleErrors: b.consoleErrors};
    });
    const after = (await request('/api/projects/' + target.id)).project; assert.equal(after.revision, before.revision); assert.equal(hash(after.document), hash(before.document)); reports.push({target, candidate: prepared.report, browser: report}); fs.writeFileSync(__layout.map(path.join(OUTPUT, process.argv.includes('--contextual') ? 'industrial-equipment-contextual-browser.json' : artifact ? 'industrial-equipment-browser.json' : 'industrial-monitor-browser.json')), JSON.stringify({readOnly: true, reports}, null, 2)); console.log('Monitor Chrome passed:', target.key);
  }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
