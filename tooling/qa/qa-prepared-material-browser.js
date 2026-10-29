const __layout = require("../layout.cjs");
'use strict';
// Read-only real Chrome shader/texture QA. Fixed camera and authored materials;
// the optional prepared detail is toggled only in this disposable browser.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {withBrowser, request, requestRaw, hash} = require('../maintenance/upgrade-cedi-examples');
const PROJECT = '05397448-a767-4f3b-8371-2aeb7ed18ae0', OUTPUT = __layout.map(path.resolve(__layout.oldDir("scripts/qa-prepared-material-browser.js"), '../data/qa-studio'));
function frameFloor() {
  const e = context.editor;
  for (const panel of ['hierarchy', 'inspector', 'resources']) e.shell.setPanel(panel, false);
  e.resize(); e.select(null); e.safeCameraPosition = e.safeOrbitTarget = null;
  const processor = e.document.getObjects(e.roomId).find(object => object.userData.editorPrefabKey === 'processor');
  if (!processor) throw new Error('The prepared detail QA requires the actual study equipment.');
  processor.updateWorldMatrix(true, true);
  const center = processor.localToWorld(e.camera.position.clone().set(1.4, .05, 1.5)), rotation = processor.getWorldQuaternion(e.camera.quaternion.clone());
  const eye = center.clone().add(e.camera.position.clone().set(1.1, 1.25, 2.1).applyQuaternion(rotation));
  e.camera.position.copy(eye); e.camera.fov = 55; e.camera.updateProjectionMatrix(); e.orbit.target.copy(center); e.orbit.update(); e.entities.sync(); e.render(0);
  return {processor: processor.name, eye: eye.toArray(), target: center.toArray()};
}
function evidence() {
  const e = context.editor, renderer = context.renderer; e.entities.sync(); e.render(0);
  const rows = [];
  e.root.traverse(node => (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => {
    const uniforms = material.preparedConcreteUniforms; if (!uniforms) return;
    rows.push({name: node.name, texture: uniforms.preparedConcreteMap.value && uniforms.preparedConcreteMap.value.uuid, strength: uniforms.preparedConcreteStrength.value,
      colour: material.color.toArray(), normal: !!material.normalMap, bump: !!material.bumpMap, roughness: material.roughness, roughnessEncoding: material.roughnessMap && material.roughnessMap.encoding});
  }));
  const gl = renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const sourceRay = context.controllers.find(controller => controller.raycaster).raycaster, ray = new sourceRay.constructor(), pointer = e.camera.position.clone(), samples = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) {
    const u = (x + .5) / 16, v = (y + .5) / 10; ray.setFromCamera(pointer.set(u * 2 - 1, v * 2 - 1, 0), e.camera);
    const hit = ray.intersectObject(e.root, true).find(hit => e.decals.isSurface(hit.object));
    if (!hit || !(Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material]).some(material => material.preparedConcreteUniforms)) continue;
    const offset = (Math.min(height - 1, Math.floor(v * height)) * width + Math.min(width - 1, Math.floor(u * width))) * 4;
    samples.push({u, v, rgb: Array.from(pixels.slice(offset, offset + 3))});
  }
  return {texture: context.preparedMaterials.getStats(), quality: context.graphics.getStats(), rows, samples, width, height,
    rendering: Object.assign({}, e.entities.environment.stats), gl: gl.getError(), programs: renderer.info.programs.map(program => ({name: program.name, runnable: program.diagnostics ? program.diagnostics.runnable : null}))};
}
async function run() {
  const bundle = await requestRaw('/bundle.js');
  assert(bundle.includes(Buffer.from('SURFACE_PREPARED_CONCRETE')), 'The live bundle must contain prepared-concrete rendering.');
  assert(!bundle.includes(Buffer.from('throw new Error("Module parse failed:')), 'Webpack must serve a runnable bundle before Chrome material QA.');
  const before = (await request('/api/projects/' + PROJECT)).project; let completed, primaryError;
  console.log('Prepared concrete Chrome QA:', PROJECT, 'revision', before.revision);
  const report = await withBrowser(PROJECT, async browser => { try {
    await browser.until(() => browser.evaluate('Boolean(context.graphics&&context.preparedMaterials)'), 'The graphics/prepared texture manager must be wired in the real bundle.');
    // SwiftShader is useful for shader correctness, not a device benchmark.
    // Hold pacing adaptation while comparing fixed tiers, then change modes
    // explicitly to verify resource budgets. Production tick is unchanged.
    await browser.evaluate('(()=>{const g=context.graphics;window.__preparedQaTick=g.tick;g.tick=function(delta,frame){return window.__preparedQaTick.call(this,delta,Object.assign({},frame,{paused:true}))};return true})()');
    await browser.evaluate('(async()=>{const e=context.editor;context.graphics.setMode("high");await e.hooks.gotoRoom(1);e.simulationPaused=true;await e.materials.sync(e.roomId);return true})()');
    const camera = await browser.evaluate('(' + frameFloor.toString() + ')()'); console.log('Prepared concrete: actual packing room loaded.');
    const authored = await browser.evaluate('(async()=>context.editor.document.serialize())()');
    await browser.evaluate('context.preparedMaterials.setEnabled(false);context.graphics.setMode("economy");context.graphics.setMode("high");true');
    const baseline = await browser.evaluate('(' + evidence.toString() + ')()'); await browser.screenshot('prepared-concrete-packing-before');
    await browser.evaluate('context.graphics.setMode("economy");context.graphics.setMode("high");context.preparedMaterials.setEnabled(true);context.preparedMaterials.update().then(()=>true)');
    const after = await browser.evaluate('(' + evidence.toString() + ')()'); await browser.screenshot('prepared-concrete-packing-after');
    assert.equal(baseline.gl, 0); assert.equal(after.gl, 0); assert(after.rows.length >= 1, 'At least one real generated floor must use the prepared detail.');
    assert.equal(baseline.quality.effectiveProfile, 'high'); assert.equal(after.quality.effectiveProfile, 'high'); assert.equal(after.rendering.shadowMapSize, baseline.rendering.shadowMapSize);
    assert(after.rows.every(row => row.strength === .85 && row.texture)); assert.equal(new Set(after.rows.map(row => row.texture)).size, 1);
    assert.equal(after.texture.edge, 1024); assert(after.texture.estimatedGpuBytes < 8 * 1024 * 1024); assert.equal(after.rendering.reflectionBuilds, 1); assert.equal(after.rendering.shadowMaps, 1);
    assert(after.rows.every(row => !row.bump && !row.normal)); assert(!after.programs.some(program => program.runnable === false));
    assert.deepEqual(after.rows.map(row => row.colour), baseline.rows.map(row => row.colour)); assert(after.samples.length >= 8, 'The fixed camera must expose enough actual raycast-selected concrete.');
    const oldSamples = new Map(baseline.samples.map(sample => [sample.u + ':' + sample.v, sample.rgb])); let change = 0, channels = 0;
    after.samples.forEach(sample => { const old = oldSamples.get(sample.u + ':' + sample.v); if (old) sample.rgb.forEach((value, channel) => { change += Math.abs(value - old[channel]); channels++; }); });
    assert(channels >= 24); assert(change / channels > .5, 'The prepared photographic detail must visibly affect rendered concrete at the same camera and lighting.');
    const beforeIdle = after.texture;
    await browser.evaluate('(()=>{const e=context.editor;for(let frame=0;frame<5;frame++){e.materials.sync(e.roomId);e.render(0)}return true})()');
    const idle = await browser.evaluate('context.preparedMaterials.getStats()'); assert.equal(idle.loads, beforeIdle.loads); assert.equal(idle.textureBuilds, beforeIdle.textureBuilds);
    await browser.evaluate('context.graphics.setMode("economy");context.preparedMaterials.update().then(()=>true)');
    const economy = await browser.evaluate('context.preparedMaterials.getStats()'); assert.equal(economy.edge, 256);
    assert.equal(hash(await browser.evaluate('(async()=>context.editor.document.serialize())()')), hash(authored));
    await browser.evaluate('(async()=>{const e=context.editor;await e.hooks.gotoRoom(9);e.simulationPaused=true;return true})()');
    const released = await browser.evaluate('context.preparedMaterials.getStats()'); assert.equal(released.activeReferences, 0); assert.equal(released.edge, 0);
    assert.deepEqual(browser.writes, []); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
    completed = {projectId: PROJECT, revision: before.revision, readOnlyDatabase: true, comparisonHeldAdaptiveSampling: true, renderer: 'Chrome SwiftShader; shader correctness only, no hardware FPS claim', camera, baseline, after, economy, released, meanPixelDifference: change / channels, shots: browser.shots, writes: [], exceptions: [], consoleErrors: []};
    fs.writeFileSync(__layout.map(path.join(OUTPUT, 'prepared-material-browser.json')), JSON.stringify(completed, null, 2)); await browser.evaluate('context.editor.dirty=false;true'); return completed;
  } catch (error) { primaryError = error; throw error; } }).catch(async error => {
    if (primaryError) throw primaryError; if (!completed || error.code !== 'EPERM') throw error;
    const raw = String(error.path || ''), directory = __layout.map(path.resolve(raw.startsWith('\\\\?\\') ? raw.slice(4) : raw)); assert.equal(path.dirname(directory), __layout.map(path.resolve(os.tmpdir()))); assert(path.basename(directory).startsWith('hello-cedi-upgrade-'));
    await new Promise(resolve => setTimeout(resolve, 2000)); try { fs.rmSync(directory, {recursive: true, force: true, maxRetries: 8, retryDelay: 250}); } catch (_) { completed.cleanupPendingPath = directory; } return completed;
  });
  const saved = (await request('/api/projects/' + PROJECT)).project; assert.equal(saved.revision, before.revision); assert.equal(hash(saved.document), hash(before.document));
  fs.writeFileSync(__layout.map(path.join(OUTPUT, 'prepared-material-browser.json')), JSON.stringify(report, null, 2)); console.log(JSON.stringify({revision: report.revision, edge: report.after.texture.edge, meanPixelDifference: report.meanPixelDifference, gl: report.after.gl, shots: report.shots}));
}
// A closed DevTools socket must not look like a successful check merely because
// an unresolved promise leaves Node without other live handles.
const keepAlive = setInterval(() => {}, 1000);
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearInterval(keepAlive));
