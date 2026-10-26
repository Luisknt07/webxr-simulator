'use strict';
// Private Chrome WebGL loss/restore test; no scene edits or persistence calls.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {withBrowser, request, requestRaw, hash} = require('./upgrade-cedi-examples');
const PROJECT = '05397448-a767-4f3b-8371-2aeb7ed18ae0', OUTPUT = path.resolve(__dirname, '../data/qa-studio');
function differences(before, after, prefix = '', rows = []) {
  if (Object.is(before, after)) return rows;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) { rows.push({path: prefix, before, after}); return rows; }
  const keys = Array.from(new Set(Object.keys(before).concat(Object.keys(after))));
  keys.forEach(key => differences(before[key], after[key], prefix + '/' + key, rows)); return rows;
}
function recoveryEvidence() {
  const e = context.editor, renderer = context.renderer; e.entities.sync(); e.render(0);
  const environment = e.entities.environment, sun = environment.original.lights.find(entry => entry.object.name === 'sun').object;
  const gl = renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let sum = 0, black = 0, count = 0;
  for (let y = 0; y < 20; y++) for (let x = 0; x < 32; x++) {
    const offset = (Math.floor((y + .5) * height / 20) * width + Math.floor((x + .5) * width / 32)) * 4;
    const brightness = (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3 / 255; sum += brightness; count++; if (brightness < .015) black++;
  }
  const floor = Array.from(e.materials.states.values()).flatMap(state => Array.from(state.materials)).find(material => material.preparedConcreteUniforms);
  return {environment: Object.assign({}, environment.stats), graphics: context.graphics.getStats(), reflectionTexture: environment.scene.environment && environment.scene.environment.uuid,
    shadowTexture: sun.shadow.map && sun.shadow.map.texture.uuid, prepared: context.preparedMaterials.getStats(),
    concreteTexture: floor && floor.preparedConcreteUniforms.preparedConcreteMap.value && floor.preparedConcreteUniforms.preparedConcreteMap.value.uuid,
    pixels: {width, height, mean: sum / count, black: black / count}, memory: Object.assign({}, renderer.info.memory),
    performance: {contextTextureReleaseCycles: e.performance.stats.contextTextureReleaseCycles, contextReleasedTextures: e.performance.stats.contextReleasedTextures, contextReleasedRenderTargets: e.performance.stats.contextReleasedRenderTargets,
      contextReleasedGeometries: e.performance.stats.contextReleasedGeometries, contextReleasedMaterials: e.performance.stats.contextReleasedMaterials},
    camera: {position: e.camera.position.toArray(), quaternion: e.camera.quaternion.toArray()},
    programs: renderer.info.programs.map(program => ({name: program.name, runnable: program.diagnostics ? program.diagnostics.runnable : null})), gl: gl.getError()};
}
function newOffscreenCaster() {
  const e = context.editor, environment = e.entities.environment; let source;
  e.root.traverse(mesh => { if (!source && mesh.isMesh && mesh.geometry && !Array.isArray(mesh.material) && mesh.material.isMeshStandardMaterial) source = mesh; });
  const geometry = source.geometry.clone(); geometry.center(); geometry.computeBoundingBox();
  const material = new source.material.constructor({color: 0x73807c, metalness: .5, roughness: .65}), probe = new source.constructor(geometry, material);
  const size = geometry.boundingBox.getSize(e.camera.position.clone());
  probe.scale.set(.6 / Math.max(.01, size.x), 1 / Math.max(.01, size.y), .6 / Math.max(.01, size.z));
  const forward = e.camera.getWorldDirection(e.camera.position.clone()), point = e.camera.getWorldPosition(e.camera.position.clone()).addScaledVector(forward, 5), right = point.clone().set(1, 0, 0).applyQuaternion(e.camera.getWorldQuaternion(e.camera.quaternion.clone())); point.addScaledVector(right, 8); point.y = .6;
  probe.position.copy(e.root.worldToLocal(point)); probe.name = 'Private recovery QA caster'; probe.castShadow = true; e.root.add(probe); e.root.updateMatrixWorld(true); e.entities.sync(); e.render(0);
  const result = {cast: probe.castShadow, cameraVisible: e.performance.frustums[0].intersectsObject(probe), frustumRestored: probe.frustumCulled,
    fallback: environment.stats.recoveryShadowFallback, shadowMaps: environment.stats.shadowMaps, gl: context.renderer.getContext().getError()};
  const savedEye = e.camera.position.clone(), savedTarget = e.orbit.target.clone(), target = probe.getWorldPosition(e.camera.position.clone());
  e.camera.position.copy(target).addScaledVector(forward, -2); e.camera.position.y += 1; e.orbit.target.copy(target); e.orbit.update(); e.render(0);
  result.jumpVisible = e.performance.frustums[0].intersectsObject(probe); result.jumpGl = context.renderer.getContext().getError();
  e.camera.position.copy(savedEye); e.orbit.target.copy(savedTarget); e.orbit.update();
  e.root.remove(probe); geometry.dispose(); material.dispose(); e.entities.sync(); e.render(0); result.cleanupGl = context.renderer.getContext().getError(); return result;
}
async function materialRoundtrip() {
  const e = context.editor, owner = e.document.getObjects(e.roomId).find(object => object.userData.editorPrefabKey === 'conveyor'), before = e.document.getBehaviors(owner), next = JSON.parse(JSON.stringify(before));
  const config = next.find(value => value.type === 'surfaceMaterial'), roughness = config.roughness > .4 ? .33 : .7; config.roughness = roughness;
  try {
    e.document.setBehaviors(owner, next); e.materials.invalidate(); await e.materials.sync(e.roomId); e.entities.sync(); e.render(0);
    const state = e.materials.states.get(owner), changed = state && state.groups.some(group => Array.from(group.materials).some(material => material.roughness === roughness));
    return {changed, roughness, gl: context.renderer.getContext().getError(), disposalErrors: window.__qaDisposalErrors || []};
  } finally { e.document.setBehaviors(owner, before); e.materials.invalidate(); await e.materials.sync(e.roomId); e.entities.sync(); e.render(0); }
}
async function run() {
  const bundle = await requestRaw('/bundle.js'); assert(bundle.includes(Buffer.from('recoveryShadowFallback')) && bundle.includes(Buffer.from('contextReleasedGeometries')) && bundle.includes(Buffer.from('contextReleasedMaterials')), 'The live bundle needs IBL, shadow fallback and complete GPU-handle recovery.'); assert(!bundle.includes(Buffer.from('throw new Error("Module parse failed:')));
  const before = (await request('/api/projects/' + PROJECT)).project; let completed, primaryError;
  console.log('Chrome context recovery:', PROJECT, 'revision', before.revision);
  const report = await withBrowser(PROJECT, async browser => { try {
    await browser.evaluate('(async()=>{const e=context.editor,g=context.graphics;window.__recoveryQaTick=g.tick;g.tick=function(delta,frame){return window.__recoveryQaTick.call(this,delta,Object.assign({},frame,{paused:true}))};g.setMode("high");await e.hooks.gotoRoom(1);e.simulationPaused=true;await e.materials.sync(e.roomId);for(const panel of ["hierarchy","inspector","resources"])e.shell.setPanel(panel,false);e.resize();e.select(null);const object=e.document.getObjects(e.roomId).find(object=>object.userData.editorPrefabKey==="conveyor");const center=object.getWorldPosition(e.camera.position.clone());center.y=.65;e.safeCameraPosition=e.safeOrbitTarget=null;e.camera.position.copy(center).add(e.camera.position.clone().set(1.4,1.3,3.6));e.camera.fov=55;e.camera.updateProjectionMatrix();e.orbit.target.copy(center);e.orbit.update();e.entities.sync();e.render(0);return true})()');
    // Establish the baseline after the normal lazy-room hydration path as well
    // as material loads. A cold room visit can canonicalize legacy native state;
    // it must not be confused with a context-recovery edit.
    const cold = await browser.evaluate('(async()=>context.editor.document.serialize())()'), savedPose = await browser.evaluate('({eye:context.editor.camera.position.toArray(),target:context.editor.orbit.target.toArray()})');
    const normalVisit = '(async()=>{const e=context.editor;for(const index of [2,1]){await e.hooks.gotoRoom(index);e.simulationPaused=true;await e.materials.sync(e.roomId);e.entities.sync();e.render(0)}return e.document.serialize()})()';
    const hydrated = await browser.evaluate(normalVisit), stable = await browser.evaluate(normalVisit);
    const hydration = {coldHash: hash(cold), hydratedHash: hash(hydrated), stableHash: hash(stable), differences: differences(cold, hydrated).slice(0, 16)};
    console.log('Normal room hydration:', JSON.stringify(hydration)); assert.equal(hash(hydrated), hash(stable), 'Ordinary room hydration must settle before recovery assertions.');
    await browser.evaluate('(()=>{const e=context.editor,p=' + JSON.stringify(savedPose) + ';e.safeCameraPosition=e.safeOrbitTarget=null;e.camera.position.fromArray(p.eye);e.orbit.target.fromArray(p.target);e.orbit.update();e.entities.sync();e.render(0);return true})()');
    const supported = await browser.evaluate('(()=>{const renderer=context.renderer;window.__qaContextExtension=renderer.getContext().getExtension("WEBGL_lose_context");window.__qaContextEvents=[];for(const type of ["webglcontextlost","webglcontextrestored"])renderer.domElement.addEventListener(type,()=>window.__qaContextEvents.push({type,graphics:context.graphics.getStats(),environment:Object.assign({},context.editor.entities.environment.stats)}));return !!window.__qaContextExtension})()');
    if (!supported) { completed = {projectId: PROJECT, revision: before.revision, supported: false, skipped: 'WEBGL_lose_context unavailable; no simulated success', writes: browser.writes}; return completed; }
    const authored = await browser.evaluate('(async()=>context.editor.document.serialize())()');
    if (process.argv.includes('--diagnose-disposal')) await browser.evaluate('(()=>{const gl=context.renderer.getContext();window.__qaDisposalErrors=[];for(const name of ["deleteTexture","deleteBuffer","deleteFramebuffer","deleteRenderbuffer"]){const original=gl[name];gl[name]=function(...args){const before=this.getError();const value=original.apply(this,args);const after=this.getError();if(!this.isContextLost()&&(before||after))window.__qaDisposalErrors.push({name,before,after,stack:new Error().stack});return value}}return true})()');
    const baseline = await browser.evaluate('(' + recoveryEvidence.toString() + ')()'); await browser.screenshot('context-recovery-before'); assert.equal(baseline.gl, 0);
    await browser.evaluate('setTimeout(()=>window.__qaContextExtension.loseContext(),50);true');
    await browser.until(() => browser.evaluate('context.graphics.getStats().contextLost&&context.editor.entities.environment.stats.contextLost&&context.renderer.getContext().isContextLost()'), 'A real lost-context event must reach both graphics and environment controllers.', 30000);
    const lost = await browser.evaluate('({graphics:context.graphics.getStats(),environment:Object.assign({},context.editor.entities.environment.stats),reflection:!!context.editor.entities.environment.reflections})');
    assert.equal(lost.graphics.status, 'context-lost'); assert.equal(lost.reflection, false); assert.equal(lost.environment.reflectionBuilds, baseline.environment.reflectionBuilds);
    await browser.evaluate('setTimeout(()=>window.__qaContextExtension.restoreContext(),250);true');
    await browser.until(() => browser.evaluate('!context.graphics.getStats().contextLost&&!context.renderer.getContext().isContextLost()&&context.editor.entities.environment.stats.contextRestores===1&&context.editor.entities.environment.stats.reflectionBuilds===' + (baseline.environment.reflectionBuilds + 1)), 'Restoration must rebuild the lost IBL exactly once.', 45000);
    const restored = await browser.evaluate('(' + recoveryEvidence.toString() + ')()'); await browser.screenshot('context-recovery-after');
    console.log('Recovered scene:', JSON.stringify({gl: restored.gl, meanBefore: baseline.pixels.mean, meanAfter: restored.pixels.mean, iblBuilds: restored.environment.reflectionBuilds, shadowFallback: restored.environment.recoveryShadowFallback}));
    assert.equal(restored.gl, 0); assert.equal(restored.environment.contextRestores, 1); assert.equal(restored.environment.reflectionBuilds, baseline.environment.reflectionBuilds + 1);
    assert.equal(restored.performance.contextTextureReleaseCycles, 1); assert(restored.performance.contextReleasedTextures > 0);
    assert(restored.performance.contextReleasedGeometries > 0); assert(restored.performance.contextReleasedMaterials > 0);
    assert.equal(restored.environment.recoveryShadowFallback, true);
    assert.notEqual(restored.reflectionTexture, baseline.reflectionTexture); assert.equal(restored.shadowTexture, null);
    assert.equal(baseline.environment.shadowMaps, 1); assert.equal(restored.environment.shadowMaps, 0);
    assert.equal(restored.prepared.loads, baseline.prepared.loads); assert.equal(restored.prepared.textureBuilds, baseline.prepared.textureBuilds);
    assert.equal(restored.concreteTexture, baseline.concreteTexture, 'CPU-backed albedo reuploads through Three without fetching or rebuilding the image.');
    assert(restored.pixels.mean > baseline.pixels.mean * .85); assert(Math.abs(restored.pixels.mean - baseline.pixels.mean) < .08, 'Recovered lighting stays non-black and similarly lit while contact shadows use the documented session fallback.');
    assert(restored.pixels.black < .15); assert(!restored.programs.some(program => program.runnable === false)); assert.deepEqual(restored.camera, baseline.camera);
    assert(restored.memory.textures > 0 && restored.memory.geometries > 0);
    const idle = await browser.evaluate('(()=>{const e=context.editor;for(let frame=0;frame<8;frame++){e.entities.sync();e.render(0)}return {environment:Object.assign({},e.entities.environment.stats),prepared:context.preparedMaterials.getStats(),gl:context.renderer.getContext().getError()}})()');
    assert.equal(idle.gl, 0); assert.equal(idle.environment.reflectionBuilds, restored.environment.reflectionBuilds); assert.equal(idle.environment.recoveryShadowFallback, true); assert.equal(idle.prepared.textureBuilds, restored.prepared.textureBuilds);
    const events = await browser.evaluate('window.__qaContextEvents'); assert.deepEqual(events.map(event => event.type), ['webglcontextlost', 'webglcontextrestored']); assert.equal(events[0].graphics.contextLost, true); assert.equal(events[1].graphics.contextLost, false);
    const caster = await browser.evaluate('(' + newOffscreenCaster.toString() + ')()'); console.log('New caster:', JSON.stringify(caster)); assert.equal(caster.gl, 0); assert.equal(caster.jumpGl, 0); assert.equal(caster.cleanupGl, 0); assert.equal(caster.cast, true); assert.equal(caster.cameraVisible, false); assert.equal(caster.jumpVisible, true); assert.equal(caster.fallback, true); assert.equal(caster.shadowMaps, 0); assert.equal(caster.frustumRestored, true);
    const edited = await browser.evaluate('(' + materialRoundtrip.toString() + ')()'); console.log('Material edit:', JSON.stringify(edited)); assert.equal(edited.gl, 0); assert.equal(edited.changed, true); assert.deepEqual(edited.disposalErrors, []);
    assert.equal(hash(await browser.evaluate('(async()=>context.editor.document.serialize())()')), hash(authored)); assert.deepEqual(browser.writes, []); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
    const rooms = await browser.evaluate('(async()=>{const e=context.editor,result=[];for(const index of [2,1]){await e.hooks.gotoRoom(index);e.simulationPaused=true;await e.materials.sync(e.roomId);e.entities.sync();e.render(0);result.push({room:e.roomId,environment:Object.assign({},e.entities.environment.stats),gl:context.renderer.getContext().getError()})}return result})()');
    const roomDisposalErrors = await browser.evaluate('window.__qaDisposalErrors||[]'); console.log('Room recovery:', JSON.stringify({rooms, disposalErrors: roomDisposalErrors.slice(0, 2), count: roomDisposalErrors.length})); assert.equal(roomDisposalErrors.length, 0);
    assert(rooms.every(room => room.gl === 0)); assert.deepEqual(browser.writes, []); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
    const secondBaseline = await browser.evaluate('(' + recoveryEvidence.toString() + ')()');
    const cpuBefore = await browser.evaluate('(()=>{const e=context.editor;window.__qaCpuFingerprint=a=>a?String(a.length)+":"+Array.from({length:Math.min(64,a.length)},(_,i)=>a[Math.floor(i*(a.length-1)/Math.max(1,Math.min(64,a.length)-1))]).join(","):"none";window.__qaRecoveryCpu=[];e.root.traverse(node=>{if(!node.geometry)return;const g=node.geometry,p=g.attributes.position,i=g.index,pa=p&&(p.array||p.data?.array),ia=i&&(i.array||i.data?.array);window.__qaRecoveryCpu.push({node,geometry:g,position:p,index:i,positionArray:pa,indexArray:ia,positionHash:__qaCpuFingerprint(pa),indexHash:__qaCpuFingerprint(ia)})});e.collisionWorld.refresh();window.__qaRecoveryCollision=JSON.stringify(e.collisionWorld.snapshot.map(row=>({object:row.object.uuid,geometry:row.geometry.geometry.uuid,matrix:row.matrix,bounds:row.bounds})));window.__qaContextExtension=context.renderer.getContext().getExtension("WEBGL_lose_context");return {geometries:window.__qaRecoveryCpu.length,collisionEntries:e.collisionWorld.entries.length}})()');
    await browser.evaluate('setTimeout(()=>window.__qaContextExtension.loseContext(),50);true');
    await browser.until(() => browser.evaluate('context.graphics.getStats().contextLost&&context.editor.entities.environment.stats.contextLost'), 'The second independent loss must also be observed.', 30000);
    await browser.evaluate('setTimeout(()=>window.__qaContextExtension.restoreContext(),250);true');
    await browser.until(() => browser.evaluate('!context.graphics.getStats().contextLost&&context.editor.entities.environment.stats.contextRestores===2&&context.editor.entities.environment.stats.reflectionBuilds===' + (secondBaseline.environment.reflectionBuilds + 1)), 'A second independent restoration must rebuild once.', 45000);
    const secondRestored = await browser.evaluate('(' + recoveryEvidence.toString() + ')()'); assert.equal(secondRestored.gl, 0); assert.equal(secondRestored.performance.contextTextureReleaseCycles, 2); assert.equal(secondRestored.environment.recoveryShadowFallback, true);
    assert.equal(secondRestored.prepared.loads, secondBaseline.prepared.loads); assert.equal(secondRestored.prepared.textureBuilds, secondBaseline.prepared.textureBuilds);
    const cpuAfter = await browser.evaluate('(()=>{const e=context.editor;const same=window.__qaRecoveryCpu.every(row=>{const g=row.node.geometry,p=g.attributes.position,i=g.index,pa=p&&(p.array||p.data?.array),ia=i&&(i.array||i.data?.array);return g===row.geometry&&p===row.position&&i===row.index&&pa===row.positionArray&&ia===row.indexArray&&__qaCpuFingerprint(pa)===row.positionHash&&__qaCpuFingerprint(ia)===row.indexHash});e.collisionWorld.refresh();return {sameArrays:same,sameCollision:window.__qaRecoveryCollision===JSON.stringify(e.collisionWorld.snapshot.map(row=>({object:row.object.uuid,geometry:row.geometry.geometry.uuid,matrix:row.matrix,bounds:row.bounds}))),geometries:window.__qaRecoveryCpu.length,collisionEntries:e.collisionWorld.entries.length}})()');
    assert.equal(cpuAfter.sameArrays, true); assert.equal(cpuAfter.sameCollision, true); assert.equal(cpuAfter.collisionEntries, cpuBefore.collisionEntries);
    const editedAgain = await browser.evaluate('(' + materialRoundtrip.toString() + ')()'); assert.equal(editedAgain.gl, 0); assert.equal(editedAgain.changed, true);
    const finalRoom = await browser.evaluate('(async()=>{const e=context.editor;await e.hooks.gotoRoom(2);e.simulationPaused=true;e.entities.sync();e.render(0);await e.hooks.gotoRoom(1);e.simulationPaused=true;await e.materials.sync(e.roomId);e.entities.sync();e.render(0);return {room:e.roomId,environment:Object.assign({},e.entities.environment.stats),gl:context.renderer.getContext().getError()}})()'); assert.equal(finalRoom.gl, 0);
    assert.equal(hash(await browser.evaluate('(async()=>context.editor.document.serialize())()')), hash(authored));
    assert.deepEqual(browser.writes, []); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
    completed = {projectId: PROJECT, revision: before.revision, supported: true, readOnlyDatabase: true, renderer: 'Chrome SwiftShader; recovery correctness only', comparisonHeldAdaptiveSampling: true, hydration, baseline, lost, restored, idle, events, caster, edited, rooms, secondBaseline, secondRestored, cpuBefore, cpuAfter, editedAgain, finalRoom, shots: browser.shots, writes: [], exceptions: [], consoleErrors: []};
    fs.writeFileSync(path.join(OUTPUT, 'context-recovery-browser.json'), JSON.stringify(completed, null, 2)); await browser.evaluate('context.editor.dirty=false;true'); return completed;
  } catch (error) { primaryError = error; throw error; } }).catch(async error => {
    if (primaryError) throw primaryError; if (!completed || error.code !== 'EPERM') throw error;
    const raw = String(error.path || ''), directory = path.resolve(raw.startsWith('\\\\?\\') ? raw.slice(4) : raw); assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert(path.basename(directory).startsWith('hello-cedi-upgrade-'));
    await new Promise(resolve => setTimeout(resolve, 2000)); try { fs.rmSync(directory, {recursive: true, force: true, maxRetries: 8, retryDelay: 250}); } catch (_) { completed.cleanupPendingPath = directory; } return completed;
  });
  const saved = (await request('/api/projects/' + PROJECT)).project; assert.equal(saved.revision, before.revision); assert.equal(hash(saved.document), hash(before.document));
  fs.writeFileSync(path.join(OUTPUT, 'context-recovery-browser.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({supported: report.supported, revision: report.revision, lossCycles: report.secondRestored && report.secondRestored.environment.contextRestores, rebuilds: report.restored && report.restored.environment.reflectionBuilds - report.baseline.environment.reflectionBuilds, gl: report.finalRoom && report.finalRoom.gl, shadowFallback: report.finalRoom && report.finalRoom.environment.recoveryShadowFallback, shots: report.shots}));
}
const keepAlive = setInterval(() => {}, 1000); run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearInterval(keepAlive));
