'use strict';
// Read-only Chrome/WebGL evidence. Changes are deliberately local to this
// disposable browser document; every API write is audited and rejected below.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {withBrowser, request, hash} = require('./upgrade-cedi-examples');
const ROOMS = require('../shared/studio-document').ROOM_IDS;
const PROJECT = '194c1284-1c6e-4f2a-b089-9c540ed6e32b', ORIGINAL = 'ce14b39b-5d77-45ea-a85e-1d7e0d76e872';
const OUTPUT = path.resolve(__dirname, '../data/qa-studio');

function localQuality(roomId) {
  const e = context.editor, configs = (e.document.studio.environments || []).map(value => value.roomId === roomId ? Object.assign({}, value, {renderQuality: 'high', shadows: true, sunIntensity: .85, ambientIntensity: .15, exposure: .90}) : value);
  e.document.begin();
  e.document.setStudio({environments: configs, entities: (e.document.studio.entities || []).map(value => value.roomId === roomId && value.type === 'pointLight' ? Object.assign({}, value, {intensity: .65}) : value)});
  const objects = e.document.getObjects(roomId).filter(object => ['conveyor', 'source', 'processor', 'palletQueue'].includes(object.userData.editorPrefabKey));
  objects.forEach(object => {
    const behaviors = e.document.getBehaviors(object).map(config => {
      if (config.type === 'surfaceMaterial') return Object.assign({}, config, {wear: config.metalness > .15 ? .24 : config.wear, overrides: (config.overrides || []).map(row => Object.assign({}, row, {wear: row.metalness > .15 ? .24 : row.wear}))});
      if (config.type === 'surfaceWear') return Object.assign({}, config, {layers: JSON.stringify(JSON.parse(config.layers).map(layer => Object.assign({}, layer, {opacity: Math.max(layer.opacity, .55), density: Math.max(layer.density, .60)})))});
      return config;
    });
    e.document.setBehaviors(object, behaviors);
  });
  e.document.commit();
  e.entities.sync(); e.materials.invalidate(); e.materials.sync(roomId); e.wearPaint.invalidate(); e.wearPaint.sync(roomId);
  return {roomId, objects: objects.length, quality: e.entities.environment.stats};
}

function frameActor(id, close = false) {
  const e = context.editor, actor = e.document.getObject(id), vector = e.camera.position.clone(), quaternion = e.camera.quaternion.clone();
  actor.updateWorldMatrix(true, true);
  const layer = e.document.getBehaviors(actor).find(value => value.type === 'surfaceWear'), mark = layer && JSON.parse(layer.layers)[0];
  let center = actor.getWorldPosition(vector.clone()), eye;
  if (close && mark) {
    const matrix = actor.matrixWorld.clone().multiply(actor.matrixWorld.clone().fromArray(mark.matrix));
    center.setFromMatrixPosition(matrix);
    const normal = vector.clone().set(0, 0, 1).transformDirection(matrix), tangent = vector.clone().set(1, 0, 0).transformDirection(matrix);
    eye = center.clone().addScaledVector(normal, 1.18).addScaledVector(tangent, .15); eye.y += .13;
  } else {
    const machine = e.document.getBehaviors(actor).find(value => value.type === 'conveyor'), distance = machine ? Math.max(3.2, Math.min(7, machine.length * .9)) : 4.5;
    center.y += .3;
    eye = center.clone().add(vector.clone().set(-1.2, .62, -1.45).normalize().applyQuaternion(actor.getWorldQuaternion(quaternion)).multiplyScalar(distance));
  }
  e.select(null); e.safeCameraPosition = e.safeOrbitTarget = null; e.camera.position.copy(eye); e.camera.fov = close ? 53 : 62; e.camera.updateProjectionMatrix(); e.orbit.target.copy(center); e.orbit.update();
  e.entities.sync(); e.render(0);
  return {id, name: actor.name, close, eye: eye.toArray(), center: center.toArray(), mark: mark && {pattern: mark.pattern, opacity: mark.opacity, width: mark.width, height: mark.height}};
}

function inspectRendering() {
  const e = context.editor, renderer = context.renderer, environment = e.entities.environment, shadows = [];
  e.hooks.renderScene.traverse(node => { if (node.isLight && node.castShadow) shadows.push({name: node.name, type: node.type, map: node.shadow.mapSize.toArray(), allocated: !!node.shadow.map}); });
  const texture = e.hooks.renderScene.environment;
  return {quality: Object.assign({}, environment.stats), shadows, reflection: texture && {width: texture.image.width, height: texture.image.height, mapping: texture.mapping}, gl: renderer.getContext().getError(), programs: renderer.info.programs.map(program => ({name: program.name, runnable: program.diagnostics ? program.diagnostics.runnable : null})), performance: e.performance.getStats(), decals: {entries: e.wearPaint.entries.size, textureBuilds: e.wearPaint.engine.stats.textureBuilds, projections: e.wearPaint.engine.stats.projections}};
}

async function run() {
  const before = (await request('/api/projects/' + PROJECT)).project, original = (await request('/api/projects/' + ORIGINAL)).project;
  assert.equal(before.revision, 14); assert.equal(original.revision, 9);
  const report = await withBrowser(PROJECT, async browser => {
    const reports = [];
    for (const roomId of (process.argv.includes('--lab-only') ? ['sound'] : ['photogrammetry', 'sound'])) {
      console.log('Chrome render realism:', roomId);
      await browser.evaluate('(async()=>{const e=context.editor;if(!e.active)e.enter();await e.hooks.gotoRoom(' + ROOMS.indexOf(roomId) + ');e.simulationPaused=true;return true})()');
      const actor = await browser.evaluate('(()=>{const e=context.editor;const objects=e.document.getObjects(e.roomId).filter(o=>o.userData.editorPrefabKey==="conveyor"&&e.document.getBehaviors(o).some(c=>c.type==="surfaceWear"));return objects.find(o=>e.document.getBehaviors(o).some(c=>c.type==="conveyor"&&!c.withPanel&&c.length>=3&&c.layout==="straight"))?.userData.editorId||objects[0]?.userData.editorId})()');
      assert(actor, 'A real finished conveyor is required.');
      const frame = await browser.evaluate('(' + frameActor.toString() + ')(' + JSON.stringify(actor) + ')');
      await browser.screenshot('realism-' + roomId + '-before');
      const local = await browser.evaluate('(' + localQuality.toString() + ')(' + JSON.stringify(roomId) + ')');
      console.log('Chrome local rendering:', JSON.stringify(local));
      await browser.until(() => browser.evaluate('Boolean(context.editor.entities.environment.reflections&&context.editor.entities.environment.stats.shadowMaps===1)'), 'No se generó IBL o sombra real.');
      await browser.evaluate('context.editor.entities.sync();context.editor.render(0);true');
      await browser.screenshot('realism-' + roomId + '-after');
      const detail = await browser.evaluate('(' + frameActor.toString() + ')(' + JSON.stringify(actor) + ',true)');
      await browser.screenshot('realism-' + roomId + '-wear-detail');
      const initial = await browser.evaluate('(' + inspectRendering.toString() + ')()');
      await browser.evaluate('(()=>{const e=context.editor;for(let i=0;i<4;i++){e.entities.sync();e.render(0)}return true})()');
      const stable = await browser.evaluate('(' + inspectRendering.toString() + ')()');
      assert.equal(initial.gl, 0); assert.equal(stable.gl, 0); assert.equal(stable.shadows.length, 1); assert.equal(stable.shadows[0].type, 'DirectionalLight');
      assert.equal(stable.quality.reflectionBuilds, 1); assert.equal(stable.quality.shadowMapSize, 2048); assert(stable.reflection && stable.reflection.width <= 1024);
      assert.equal(stable.decals.projections, initial.decals.projections); assert.equal(stable.decals.textureBuilds, initial.decals.textureBuilds);
      assert(!stable.programs.some(program => program.runnable === false));
      reports.push({roomId, frame, local, detail, rendering: stable});
    }
    assert.deepEqual(browser.writes, []); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
    return {readOnly: true, revision: before.revision, localEditsOnly: true, reports, shots: browser.shots, writes: browser.writes, exceptions: browser.exceptions, consoleErrors: browser.consoleErrors};
  });
  const after = (await request('/api/projects/' + PROJECT)).project, untouched = (await request('/api/projects/' + ORIGINAL)).project;
  assert.equal(after.revision, before.revision); assert.equal(hash(after.document), hash(before.document)); assert.equal(hash(untouched.document), hash(original.document));
  fs.mkdirSync(OUTPUT, {recursive: true}); fs.writeFileSync(path.join(OUTPUT, 'render-realism-browser.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({readOnly: true, reports: report.reports.map(value => ({roomId: value.roomId, shadows: value.rendering.shadows, quality: value.rendering.quality, gl: value.rendering.gl})), shots: report.shots}));
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
