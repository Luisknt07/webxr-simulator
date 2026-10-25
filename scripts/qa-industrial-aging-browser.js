'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {withBrowser, request, hash} = require('./upgrade-cedi-examples');
const PROJECT = '05397448-a767-4f3b-8371-2aeb7ed18ae0', OUTPUT = path.resolve(__dirname, '../data/qa-studio');
function frameCabinet() {
  const e = context.editor;
  for (const panel of ['hierarchy', 'inspector', 'resources']) e.shell.setPanel(panel, false);
  e.resize(); e.select(null);
  const processors = e.document.getObjects(e.roomId).filter(object => object.userData.editorPrefabKey === 'processor'), owner = processors.find(object => e.document.getBehaviors(object).some(value => value.type === 'processor' && value.withPanel)) || processors[0];
  const cabinet = owner.getObjectByName('Armario y pedestal Processor'), visibleCabinet = e.document.getBehaviors(owner).some(value => value.type === 'processor' && value.withPanel);
  const target = visibleCabinet ? cabinet : owner;
  const center = target.localToWorld(e.camera.position.clone().set(0, visibleCabinet ? .42 : .15, .12)), rotation = target.getWorldQuaternion(e.camera.quaternion.clone());
  const eye = center.clone().add(e.camera.position.clone().set(-1.8, .65, 2.1).applyQuaternion(rotation));
  e.safeCameraPosition = e.safeOrbitTarget = null; e.camera.position.copy(eye); e.camera.fov = 52; e.camera.updateProjectionMatrix(); e.orbit.target.copy(center); e.orbit.update(); e.entities.sync(); e.render(0);
  return {id: owner.userData.editorId, name: owner.name, eye: eye.toArray(), target: center.toArray()};
}
function agingEvidence() {
  const e = context.editor, ids = [], materials = [], layers = [];
  e.entities.sync(); e.render(0);
  e.root.traverse(node => { if (node.geometry && !node.userData.editorHelper && !node.userData.editorRuntimeHelper && !node.userData.editorDecal) ids.push(node.geometry.uuid); });
  for (const owner of e.document.getObjects(e.roomId).filter(object => ['source', 'processor', 'conveyor', 'palletQueue'].includes(object.userData.editorPrefabKey))) {
    const configs = e.document.getBehaviors(owner); const surface = configs.find(value => value.type === 'surfaceMaterial'), wear = configs.find(value => value.type === 'surfaceWear');
    if (surface) materials.push({id: owner.userData.editorId, name: owner.name, assignments: 1 + surface.overrides.length});
    if (wear) layers.push({id: owner.userData.editorId, layers: JSON.parse(wear.layers).map(layer => ({id: layer.id, pattern: layer.pattern, opacity: layer.opacity, stamps: Math.max(1, layer.stamps.length)}))});
  }
  return {geometryIds: ids.sort(), materials, layers, wear: Object.assign({}, e.wearPaint.engine.stats), projectionMeshes: Array.from(e.wearPaint.engine.states.values(), state => ({vertices: state.mesh.geometry.attributes.position.count, material: state.material.type})), quality: Object.assign({}, e.entities.environment.stats), gl: context.renderer.getContext().getError()};
}
async function run() {
  const before = (await request('/api/projects/' + PROJECT)).project; assert.equal(before.revision, 3);
  let completed, primaryError;
  const report = await withBrowser(PROJECT, async browser => { try {
    await browser.until(() => browser.evaluate('typeof context.editor.studioTools.applyIndustrialAging==="function"'), 'The running bundle lacks the aging API.');
    await browser.evaluate('(async()=>{const e=context.editor;await e.hooks.gotoRoom(1);e.simulationPaused=true;return true})()');
    const camera = await browser.evaluate('(' + frameCabinet.toString() + ')()');
    const baseline = await browser.evaluate('(' + agingEvidence.toString() + ')()'); await browser.screenshot('industrial-aging-packing-before');
    const authored = await browser.evaluate('(async()=>context.editor.document.serialize())()');
    const result = await browser.evaluate('context.editor.studioTools.applyIndustrialAging()');
    await browser.evaluate('(()=>{const e=context.editor;e.syncSurfaceVisuals();e.entities.sync();e.render(0);return true})()');
    const after = await browser.evaluate('(' + agingEvidence.toString() + ')()'); await browser.screenshot('industrial-aging-packing-after');
    assert.deepEqual(after.geometryIds, baseline.geometryIds); assert.equal(after.gl, 0); assert.equal(baseline.gl, 0); assert(after.materials.length > baseline.materials.length); assert(result.layers >= 25);
    const stable = await browser.evaluate('(()=>{const e=context.editor;for(let n=0;n<5;n++){e.wearPaint.sync(e.roomId);e.render(0)}return Object.assign({},e.wearPaint.engine.stats)})()');
    for (const key of ['projections', 'textureBuilds', 'inputTriangles']) assert.equal(stable[key], after.wear[key]);
    const changed = await browser.evaluate('(async()=>context.editor.document.serialize())()');
    for (const roomId of Object.keys(authored.rooms)) {
      const clean = value => JSON.stringify(value, (key, item) => key === 'behaviors' && Array.isArray(item) ? item.filter(value => !['surfaceWear', 'surfaceMaterial'].includes(value.type)) : item);
      assert.equal(clean(changed.rooms[roomId]), clean(authored.rooms[roomId]), 'Aging must not alter room topology, machines, controls or operating recipes.');
    }
    assert.deepEqual(browser.writes, []); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
    completed = {projectId: PROJECT, revision: before.revision, readOnlyDatabase: true, localUnsavedAgingOnly: true, camera, result, baseline, after, shots: browser.shots, writes: [], errors: []};
    fs.writeFileSync(path.join(OUTPUT, 'industrial-aging-browser.json'), JSON.stringify(completed, null, 2));
    // The disposable browser must close without an unsaved-document prompt.
    // This flag changes no authored record and sends no persistence request.
    await browser.evaluate('context.editor.dirty=false;true');
    return completed;
  } catch (error) { primaryError = error; console.error('Aging QA assertion:', error.stack); throw error; } }).catch(async error => {
    if (primaryError) throw primaryError;
    if (!completed || error.code !== 'EPERM') throw error;
    // Windows may retain the just-closed Chrome profile for another moment.
    // Retry only our verified disposable profile, never an arbitrary path.
    const raw = String(error.path || ''), directory = path.resolve(raw.startsWith('\\\\?\\') ? raw.slice(4) : raw);
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert(path.basename(directory).startsWith('hello-cedi-upgrade-'));
    await new Promise(resolve => setTimeout(resolve, 2500));
    try { fs.rmSync(directory, {recursive: true, force: true, maxRetries: 8, retryDelay: 250}); }
    catch (_) { completed.cleanupPendingPath = directory; }
    return completed;
  });
  const saved = (await request('/api/projects/' + PROJECT)).project; assert.equal(saved.revision, before.revision); assert.equal(hash(saved.document), hash(before.document));
  fs.writeFileSync(path.join(OUTPUT, 'industrial-aging-browser.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({result: report.result, gl: report.after.gl, shots: report.shots}));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
