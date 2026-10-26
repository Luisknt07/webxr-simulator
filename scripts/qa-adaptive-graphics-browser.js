'use strict';
// Read-only compiled Chrome/WebGL comparison. Device preferences, camera and
// paused execution live only in a disposable browser; project writes are blocked
// by browserForRoom before navigation. The fixed-profile control omits only LOD
// filtering, so actual saved-frame draw reduction can be attributed separately.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {browserForRoom} = require('./qa-industrial-floor-browser'), {request, requestRaw, hash} = require('./upgrade-cedi-examples');
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'data/qa-studio');
const option = key => { const index = process.argv.indexOf(key); return index < 0 ? null : process.argv[index + 1]; };
const PROJECT = option('--project') || '194c1284-1c6e-4f2a-b089-9c540ed6e32b', ROOM = option('--room') || 'sound';
const PROTECTED = ['ce14b39b-5d77-45ea-a85e-1d7e0d76e872', '194c1284-1c6e-4f2a-b089-9c540ed6e32b', 'a18776be-ac57-452b-809a-46e69c2953e7', '05397448-a767-4f3b-8371-2aeb7ed18ae0'];

async function initialize() {
  const e = context.editor, graphics = context.graphics, renderer = context.renderer;
  if (!graphics || !graphics.getLimits || !e.performance || !e.performance.lod || !e.performance.memory) throw new Error('The compiled adaptive graphics/LOD/memory integration is missing.');
  e.projectSync.stop(); e.keepCurrentProject = async () => false; e.saveProject = async () => { throw new Error('Graphics QA cannot save projects.'); }; e.simulationPaused = true;
  const qa = window.__graphicsQA = {mode: graphics.getMode(), project: e.currentProject, glErrors: [], geometry: [], protectedLayers: [], phase: 'initial'};
  const gl = renderer.getContext(), originalRender = renderer.render.bind(renderer);
  renderer.render = (...args) => { const result = originalRender(...args); let error; while ((error = gl.getError()) !== gl.NO_ERROR) qa.glErrors.push({phase: qa.phase, error}); return result; };
  qa.render = () => { context.scene.updateMatrixWorld(true); renderer.render(context.scene, context.camera); return Object.assign({}, renderer.info.render); };
  const machines = e.document.getObjects(e.roomId).filter(object => object.userData.editorNative !== true && ['source', 'conveyor', 'processor', 'palletQueue'].includes(object.userData.editorPrefabKey));
  if (!machines.length) throw new Error('The comparison needs real authored industrial equipment.');
  const line = (e.document.studio.groups || []).find(group => group.roomId === e.roomId && group.members.some(id => machines.some(machine => machine.userData.editorId === id)));
  const focus = line ? line.members.map(id => e.document.getObject(id)).filter(object => machines.includes(object)) : machines.slice(0, 4), firstBox = e.collisionWorld.objectBounds(focus[0]), box = firstBox.clone().makeEmpty();
  focus.forEach(object => box.union(e.collisionWorld.objectBounds(object))); const center = box.getCenter(context.camera.position.clone()), size = box.getSize(context.camera.position.clone());
  const distance = Math.max(18, size.x * .8, size.z * .8), eye = center.clone().add(center.clone().set(distance * .5, distance * .35, distance * .9));
  if (context.studio && context.studio.setDesktopFlight) context.studio.setDesktopFlight(true);
  context.cameraRig.position.copy(eye); context.cameraRig.quaternion.set(0, 0, 0, 1); context.camera.position.set(0, 0, 0); context.camera.fov = 55; context.camera.updateProjectionMatrix(); context.camera.lookAt(center); context.camera.updateWorldMatrix(true, false);
  if (context.desktopLook) context.desktopLook.reset(); if (context.resetCollisionPose) context.resetCollisionPose();
  qa.camera = {eye: eye.toArray(), target: center.toArray(), focusIds: focus.map(object => object.userData.editorId)};
  qa.queries = machines.slice(0, 8).map(object => { const value = e.collisionWorld.objectBounds(object).getCenter(context.camera.position.clone()); return {start: value.clone().add(value.clone().set(-4, .1, 0)), end: value.clone().add(value.clone().set(4, .1, 0))}; });
  qa.collision = () => {
    const world = e.collisionWorld; world.invalidate(); world.refresh();
    return {entries: world.entries.map(entry => ({object: entry.object.uuid, geometry: entry.object.geometry.uuid, matrix: entry.object.matrixWorld.toArray(), bounds: entry.box.min.toArray().concat(entry.box.max.toArray())})),
      queries: qa.queries.map(value => ({blocked: world.rayBlocked(value.start, value.end), movement: world.moveSphere(value.start, value.end, .2).toArray(), occupancy: world.canOccupyCapsule(value.start)}))};
  };
  const protectedMesh = node => {
    for (let current = node; current && current !== e.root; current = current.parent) {
      const data = current.userData || {}, configs = data.editorBehaviors || data.editorDefaultBehaviors || [];
      if (data.editorNative || ['control', 'sensor', 'product', 'plc'].includes(data.editorPrefabKey) || data.industrialDisplay || data.industrialButton || data.industrialSensorLamp || data.industrialSensorVolume || configs.some(value => ['lineMonitor', 'control', 'sensor', 'product'].includes(value.type))) return true;
    } return false;
  };
  e.root.traverse(node => {
    if (!node.geometry) return;
    qa.geometry.push({node, geometry: node.geometry, drawStart: node.geometry.drawRange.start, drawCount: node.geometry.drawRange.count, attributes: Object.entries(node.geometry.attributes).map(([key, value]) => ({key, value, array: value.isInterleavedBufferAttribute ? value.data.array : value.array})), index: node.geometry.index, indices: node.geometry.index && node.geometry.index.array});
    if (protectedMesh(node)) qa.protectedLayers.push({node, mask: node.layers.mask});
  });
  qa.geometryDrift = () => qa.geometry.filter(row => row.node.geometry !== row.geometry || row.geometry.drawRange.start !== row.drawStart || row.geometry.drawRange.count !== row.drawCount || row.geometry.index !== row.index || row.index && row.index.array !== row.indices || row.attributes.some(attribute => row.geometry.attributes[attribute.key] !== attribute.value || (attribute.value.isInterleavedBufferAttribute ? attribute.value.data.array : attribute.value.array) !== attribute.array)).map(row => row.node.name);
  qa.layerDrift = () => qa.protectedLayers.filter(row => row.node.layers.mask !== row.mask).map(row => row.node.name);
  return {roomId: e.roomId, project: e.currentProject, mode: qa.mode, camera: qa.camera, pausedForComparison: e.simulationPaused};
}

async function profile(mode) {
  const e = context.editor, qa = __graphicsQA; qa.phase = mode; context.graphics.setMode(mode);
  if (context.preparedMaterials) await context.preparedMaterials.update(); e.entities.sync(); await e.materials.sync(e.roomId);
  context.scene.updateMatrixWorld(true); e.performance.reconcile(); e.performance.update(context.camera, 0);
  const lod = e.performance.lod, limits = context.graphics.getLimits(), count = Math.ceil(lod.getStats().cosmeticLodCandidates / 64) + 1;
  // Exercise the bounded production decision method at a fixed camera. Each
  // call retains its normal 64-decision ceiling; no authored pose is changed.
  for (let index = 0; index < count; index++) lod.update(e.performance.cameras, .16, limits, context.renderer.domElement.height, e.performance.frustums);
  const render = qa.render(); e.performance.reconcile(); const stats = e.performance.getStats(), geometryDrift = qa.geometryDrift(), layerDrift = qa.layerDrift();
  const sample = {requested: mode, graphics: context.graphics.getStats(), render, resources: stats, prepared: context.preparedMaterials && context.preparedMaterials.getStats(), collision: qa.collision(), geometryDrift, protectedLayerDrift: layerDrift, authored: await e.document.serialize(), gl: context.renderer.getContext().getError()};
  if (mode === 'economy') {
    const update = lod.update, hidden = [...lod.entries.values()].filter(entry => entry.hidden); lod.update = () => {};
    try { hidden.forEach(entry => { entry.mesh.layers.mask = entry.mask; }); sample.sameProfileFullDetailControl = qa.render(); }
    finally { hidden.forEach(entry => { entry.mesh.layers.mask = 0; }); lod.update = update; qa.render(); }
  }
  return sample;
}
async function uiContract() {
  const e = context.editor, performance = e.performance, samples = performance.getStats().resourceMemorySamples;
  context.studio.open('settings'); const panel = context.studio.graphicsSettings; if (!panel) throw new Error('The real device graphics settings are missing.');
  for (let index = 0; index < 20; index++) panel.update();
  const result = {mode: panel.select.value, effective: panel.effective.textContent, target: panel.values.target.textContent, resolution: panel.values.resolution.textContent, memory: panel.values.memory.textContent,
    hasEstimateLabel: panel.values.memory.textContent.includes('estimación'), cachedStatsReads: samples === performance.getStats().resourceMemorySamples, visible: panel.root.getBoundingClientRect().height > 0};
  context.studio.close(); return result;
}
async function finish() {
  const e = context.editor, qa = __graphicsQA; qa.phase = 'restored'; context.graphics.setMode(qa.mode); e.performance.update(context.camera, 0);
  return {authored: await e.document.serialize(), collision: qa.collision(), geometryDrift: qa.geometryDrift(), protectedLayerDrift: qa.layerDrift(), glErrors: qa.glErrors, gl: context.renderer.getContext().getError(), blockedWrites: __qaBlockedWrites};
}
async function run() {
  fs.mkdirSync(OUTPUT, {recursive: true});
  const bundle = await requestRaw('/bundle.js'); for (const marker of ['industrialCosmeticDetail', 'gpuResourceBytesEstimated', 'hello-webxr.graphics-mode.v1']) assert(bundle.includes(Buffer.from(marker)), 'The live bundle is missing ' + marker);
  const before = await Promise.all([...new Set(PROTECTED.concat(PROJECT))].map(async id => ({id, project: (await request('/api/projects/' + id)).project})));
  console.log('Graphics Chrome opening:', PROJECT, ROOM);
  const report = await browserForRoom(ROOM)(PROJECT, async browser => {
    await browser.until(() => browser.evaluate('Boolean(context.graphics&&context.editor.simulation.running&&context.editor.performance.lod&&context.editor.performance.memory)'), 'The compiled adaptive graphics runtime did not start.');
    const initial = await browser.evaluate('(' + initialize.toString() + ')()');
    console.log('Graphics Chrome loaded:', initial.roomId);
    await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const baseline = await browser.evaluate('(async()=>({authored:await context.editor.document.serialize(),collision:__graphicsQA.collision()}))()');
    const ultra = await browser.evaluate('(' + profile.toString() + ')("ultra")'); console.log('Graphics Chrome ultra:', ultra.graphics.tier, ultra.render.calls, ultra.render.triangles); await browser.screenshot('adaptive-graphics-ultra');
    const economy = await browser.evaluate('(' + profile.toString() + ')("economy")'); console.log('Graphics Chrome economy:', economy.graphics.tier, economy.render.calls, economy.render.triangles, economy.resources.cosmeticLodHidden); await browser.screenshot('adaptive-graphics-economy');
    const restored = await browser.evaluate('(' + profile.toString() + ')("ultra")');
    const ui = await browser.evaluate('(' + uiContract.toString() + ')()');
    const last = await browser.evaluate('(' + finish.toString() + ')()');
    for (const sample of [ultra, economy, restored, last]) { assert.equal(hash(sample.authored), hash(baseline.authored), 'Device graphics changed authored content.'); assert.deepEqual(sample.collision, baseline.collision, 'Cosmetic graphics changed collision entries or actual queries.'); assert.deepEqual(sample.geometryDrift, []); assert.deepEqual(sample.protectedLayerDrift, []); assert.equal(sample.gl, 0); }
    assert.equal(ultra.graphics.tier, 'ultra'); assert.equal(economy.graphics.tier, 'economy'); assert.equal(restored.graphics.tier, 'ultra');
    assert.equal(ultra.resources.cosmeticLodHidden, 0); assert.equal(restored.resources.cosmeticLodHidden, 0); assert(economy.resources.cosmeticLodHidden > 0); assert(economy.resources.cosmeticLodMaxDecisionsPerFrame <= 64);
    assert(economy.render.calls < economy.sameProfileFullDetailControl.calls, 'Actual same-profile WebGL draw calls must fall when cosmetic LOD is applied.'); assert(economy.render.triangles < economy.sameProfileFullDetailControl.triangles);
    assert(economy.render.calls < ultra.render.calls); assert(economy.resources.gpuGeometryBytes > 0 && economy.resources.gpuTextureBytes > 0); assert(economy.resources.retainedCpuBytesEstimated > 0 && economy.resources.memoryEstimated);
    assert(economy.resources.gpuResourceBytesEstimated <= ultra.resources.gpuResourceBytesEstimated, 'The lower profile should not increase the known resource budget.');
    assert(ui.visible && ui.cachedStatsReads && ui.hasEstimateLabel); assert.equal(ui.mode, 'ultra'); assert(ui.effective.includes('Cinemática'));
    assert.deepEqual(last.glErrors, []); assert.deepEqual(last.blockedWrites, []); assert.deepEqual(browser.writes, []); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
    const summarize = sample => { const copy = Object.assign({}, sample, {authoredHash: hash(sample.authored), collisionHash: hash(sample.collision), collisionEntries: sample.collision.entries.length, collisionQueries: sample.collision.queries}); delete copy.authored; delete copy.collision; return copy; };
    return {readOnly: true, initial, baselineAuthoredHash: hash(baseline.authored), baselineCollisionHash: hash(baseline.collision), ultra: summarize(ultra), economy: summarize(economy), restored: summarize(restored), ui, finish: summarize(last), shots: browser.shots, writes: browser.writes, exceptions: browser.exceptions, consoleErrors: browser.consoleErrors};
  });
  for (const entry of before) { const after = (await request('/api/projects/' + entry.id)).project; assert.equal(after.revision, entry.project.revision); assert.equal(hash(after.document), hash(entry.project.document)); }
  report.serverProjectsUnchanged = before.map(entry => ({id: entry.id, revision: entry.project.revision, hash: hash(entry.project.document)})); fs.writeFileSync(path.join(OUTPUT, 'adaptive-graphics-browser.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({readOnly: true, projectId: PROJECT, roomId: ROOM, ultra: report.ultra.render, economy: report.economy.render, sameProfileFullDetailControl: report.economy.sameProfileFullDetailControl, hiddenCosmeticMeshes: report.economy.resources.cosmeticLodHidden, gpuBytesEstimated: {ultra: report.ultra.resources.gpuResourceBytesEstimated, economy: report.economy.resources.gpuResourceBytesEstimated}, writes: 0, shots: report.shots}, null, 2));
  return report;
}
module.exports = {run};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
