const __layout = require("../layout.cjs");
'use strict';
// Compiled Chrome/WebGL/API QA in disposable account, project and storage.
// SwiftShader establishes rendering correctness, never device FPS claims.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const {startTemporaryServer, withBrowser} = require('./qa-project-workspace-browser');
const ROOT = __layout.map(path.resolve(__layout.oldDir("scripts/qa-industrial-realism-browser.js"), '..')), OUTPUT = __layout.map(path.join(ROOT, 'data/qa-studio'));
const PASSWORD = 'Disposable-photographic-browser-2026!';
function evidence() {
  const e = context.editor, system = e.finishes, rows = [], stickers = [], vehicles = [];
  e.root.updateWorldMatrix(true, true);
  system.bindings.forEach((binding, material) => rows.push({name: material.name, id: material.uuid, profile: material.userData.industrialPhotographicDefault,
    key: binding.key, normal: material.normalMap && {id: material.normalMap.uuid, encoding: material.normalMap.encoding, width: material.normalMap.image && material.normalMap.image.width},
    roughness: material.roughnessMap && {id: material.roughnessMap.uuid, encoding: material.roughnessMap.encoding},
    color: material.map && {id: material.map.uuid, encoding: material.map.encoding, photographic: !!(material.map.userData && material.map.userData.industrialPhotographicKey)}}));
  system.stickers.forEach((entry, owner) => entry.meshes.forEach(mesh => {
    const p = mesh.geometry.attributes.position, host = mesh.parent, nearest = host.geometry && host.geometry.boundingBox;
    const normals = mesh.geometry.attributes.normal, sourceRay = context.controllers.find(controller => controller.raycaster).raycaster, ray = new sourceRay.constructor(), normalMatrix = host.matrixWorld.clone().getInverse(host.matrixWorld).transpose(); let maxSurfaceDistance = 0, missingSamples = 0;
    for (let i = 0, stride = Math.max(1, Math.ceil(p.count / 36)) * 3; i + 2 < p.count; i += stride) {
      const point = e.camera.position.clone().set(0, 0, 0), normal = point.clone();
      for (let k = 0; k < 3; k++) {point.add(e.camera.position.clone().fromBufferAttribute(p, i + k).multiplyScalar(1 / 3)); normal.add(e.camera.position.clone().fromBufferAttribute(normals, i + k));}
      point.applyMatrix4(mesh.matrixWorld); normal.transformDirection(normalMatrix); ray.set(point.clone().addScaledVector(normal, .012), normal.clone().negate()); ray.near = 0; ray.far = .04;
      const hit = ray.intersectObject(host, false)[0]; if (hit) maxSurfaceDistance = Math.max(maxSurfaceDistance, Math.abs(hit.distance - .012)); else missingSamples++;
    }
    stickers.push({name: owner.name, parent: host.name, vertices: p.count, runtimeHelper: !!mesh.userData.editorRuntimeHelper,
      decal: !!mesh.userData.editorDecal, atlas: mesh.material.map.uuid, alphaTest: mesh.material.alphaTest, shared: !!mesh.material.map.userData.sharedIndustrialTexture, boundingBoxReady: !!nearest, maxSurfaceDistance, missingSamples});
  }));
  for (const object of e.document.getObjects(e.roomId)) {
    if (object.parent !== e.root || object.userData.editorPrefabKey !== 'vehicle') continue;
    let rig; object.traverse(node => {if (node.userData.vehicleRig) rig = node.userData.vehicleRig;}); if (!rig) continue;
    const wheel = rig.controls.wheel;
    const labels = []; object.traverse(node => {if (node.userData.vehicleDecal) labels.push({name: node.name, opacity: node.material.opacity, alphaTest: node.material.alphaTest, flipY: node.material.map.flipY, atlasWidth: node.material.map.image.width});});
    vehicles.push({name: object.name, variant: rig.config.variant, cabin: !!rig.cabin, driverSeat: !!rig.driverSeat, controls: rig.controls.levers.map(control => control.id),
      wheelType: wheel.object.children.map(child => child.geometry && child.geometry.type).filter(Boolean), labels});
  }
  const renderer = context.renderer, gl = renderer.getContext();
  return {stats: system.getStats(), rows, stickers, vehicles, gl: gl.getError(), draws: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    programs: renderer.info.programs.map(program => ({name: program.name, runnable: program.diagnostics ? program.diagnostics.runnable : null})),
    httpFailures: performance.getEntriesByType('resource').filter(entry => entry.name.startsWith(location.origin) && entry.responseStatus >= 400).map(entry => ({url: entry.name, status: entry.responseStatus}))};
}
async function run() {
  fs.mkdirSync(OUTPUT, {recursive: true}); const fixture = await startTemporaryServer();
  const bundleSha256 = createHash('sha256').update(fs.readFileSync(__layout.map(path.join(ROOT, "bundle.js")))).digest('hex');
  let currentReport;
  try {
    const account = await fixture.request('/api/studio/register', 'POST', {username: 'qa_photographic', displayName: 'QA materiales temporal', password: PASSWORD}); assert.equal(account.status, 201);
    const report = await withBrowser(fixture.origin, async b => {
      currentReport = b.report;
      b.report.bundleSha256 = bundleSha256; b.report.temporaryDatabaseOnly = true;
      const step = name => console.log('Industrial photographic Chrome:', name);
      const ready = async () => {
        await b.call(async () => {const e = context.editor; e.finishes.sync(e.roomId, .5); await Promise.all([...e.finishes.store.entries.values()].map(entry => entry.ready)); e.finishes.sync(e.roomId, .5); await e.materials.sync(e.roomId); e.render(0);});
        await b.until(() => b.evaluate('!!context.editor.finishes&&[...context.editor.finishes.store.entries.values()].every(e=>!e.pending)'), 'Photographic maps did not settle.');
      };
      step('authenticated examples and warehouse'); await b.navigate('/');
      await b.call(async password => {await context.studio.client.login('qa_photographic', password); await context.studio.client.me(); await context.studio.authenticated();}, PASSWORD);
      await b.navigate('/editor');
      await b.call(async () => {await context.editor.studioTools.createStudyProject(['robot-handling-line', 'advanced-packing'], {name: 'QA · Materiales industriales', continuous: false});});
      await b.call(() => {const e = context.editor; context.graphics.setMode('high'); const tick = context.graphics.tick; context.graphics.tick = function(delta, frame) {return tick.call(this, delta, Object.assign({}, frame, {paused: true}));}; e.simulationPaused = true; e.select(null); for (const panel of ['hierarchy', 'inspector', 'resources']) e.shell.setPanel(panel, false); e.resize(); e.camera.position.set(7, 4, 8); e.orbit.target.set(1, 1, 0); e.orbit.update();});
      await ready();
      b.report.warehouse = await b.call(evidence); assert(b.report.warehouse.stats.profiles >= 3); assert.equal(b.report.warehouse.stats.failures, 0); assert.equal(b.report.warehouse.gl, 0);
      await b.screenshot('industrial-warehouse-photographic');

      step('actual six-family detailed sample grid');
      b.report.samples = await b.call(() => {
        const e = context.editor;
        e.document.getObjects(e.roomId).filter(object => object.parent === e.root && (object.userData.editorPrefabKey || e.document.getBehaviors(object).some(config => ['info', 'lineMonitor'].includes(config.type)))).forEach(object => {object.visible = false;});
        window.__photoSamples = {};
        const add = (key, kind, variant, position, values) => {
          const object = e.document.addPrefab(e.roomId, kind, variant); e.document.setTransform(object, {position});
          if (values) e.document.setBehaviors(object, e.document.getBehaviors(object).map(c => c.type === kind ? Object.assign({}, c, values) : c));
          // Different families intentionally use different authoring origins:
          // conveyors/Source reference their working plane; vehicles reference
          // the ground. Ground the real mechanical envelope, never assume Y=0.
          object.updateWorldMatrix(true, true); let minimum = Infinity;
          object.traverse(node => {
            if (!node.geometry || node.userData.editorRuntimeHelper || node.userData.industrialSensorVolume) return;
            for (let parent = node; parent; parent = parent.parent) if (!parent.visible) return;
            if (!node.geometry.boundingBox) node.geometry.computeBoundingBox(); const bounds = node.geometry.boundingBox;
            for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) minimum = Math.min(minimum, e.camera.position.clone().set(x, y, z).applyMatrix4(node.matrixWorld).y);
          });
          if (!Number.isFinite(minimum)) throw Error('Missing groundable geometry: ' + key); object.position.y -= minimum; e.document.setTransform(object, {position: object.position.toArray()});
          object.name = 'QA · ' + key; __photoSamples[key] = object.userData.editorId; return object;
        };
        add('forklift', 'vehicle', 'forklift-electric-4w', [-3.4, 0, 0], {detail: 'high', frameColor: '#c88d23', wear: .5});
        add('source', 'source', undefined, [0, 0, 0], {initialCount: 3, autoGenerate: false, withPanel: true});
        add('conveyor', 'conveyor', undefined, [3.8, 0, 0], {length: 3.2, withPanel: true});
        add('robot', 'robot', 'articulated-general', [-3.3, 0, 4.4], {withPanel: false, detail: 'high'});
        add('processor', 'processor', undefined, [.5, 0, 4.4], {withPanel: true});
        add('stock', 'palletQueue', undefined, [4.6, 0, 4.3], {palletCount: 2});
        add('product', 'product', 'pallet-loaded', [-4.1, 0, 2.5]);
        e.select(null); e.camera.position.set(10, 9, 13); e.orbit.target.set(.1, 1, 2.1); e.orbit.update();
        return __photoSamples;
      });
      await ready(); const grid = b.report.grid = await b.call(evidence); assert.equal(grid.gl, 0); assert.equal(grid.stats.failures, 0); assert(grid.stats.textures >= 12);
      assert(grid.rows.every(row => !row.normal || row.normal.encoding === 3000)); assert(grid.rows.every(row => !row.roughness || row.roughness.encoding === 3000));
      assert(grid.rows.filter(row => row.color && row.color.photographic).every(row => row.color.encoding === 3001));
      assert(grid.stickers.length >= 5); assert(new Set(grid.stickers.map(row => row.atlas)).size === 1); assert(grid.stickers.every(row => row.runtimeHelper && row.decal && row.vertices > 0));
      assert(grid.stickers.every(row => row.maxSurfaceDistance < .009 && row.missingSamples === 0), JSON.stringify(grid.stickers));
      assert(grid.vehicles[0].cabin && grid.vehicles[0].driverSeat && grid.vehicles[0].controls.includes('lift')); assert(grid.vehicles[0].labels.length >= 5);
      assert(grid.vehicles[0].labels.every(row => !row.flipY && row.opacity === 1)); await b.screenshot('industrial-photographic-grid');
      // Geometry is authored by actual factories. Camera changes do not replace
      // the renderer, material system, physical parts or original warehouse.
      const focus = async (key, eye, target) => {
        await b.call((name, eyeOffset, targetOffset) => {
          const e = context.editor, object = e.document.getObject(__photoSamples[name]), p = object.getWorldPosition(e.camera.position.clone());
          e.select(null); e.camera.position.copy(p).add(e.camera.position.clone().fromArray(eyeOffset)); e.orbit.target.copy(p).add(e.camera.position.clone().fromArray(targetOffset)); e.orbit.update(); e.render(0);
        }, key, eye, target);
      };
      await focus('forklift', [2.7, 1.7, 3.1], [0, 1.05, .25]); await b.screenshot('industrial-forklift-whole');
      await focus('forklift', [-1.65, 1.8, -2.3], [0, 1.15, -.05]); await b.screenshot('industrial-forklift-cabin');
      await focus('forklift', [1.05, 1.15, -1.5], [.2, .8, -.55]); await b.screenshot('industrial-forklift-photographic-detail');
      await focus('conveyor', [2.5, 1.5, 2], [.1, 0, 0]); await b.screenshot('industrial-conveyor-photographic-detail');
      await focus('robot', [2.8, 2.4, 2.6], [.5, 1.1, 0]); await b.screenshot('industrial-robot-photographic-detail');
      await focus('processor', [2.4, 1.4, 2.7], [0, .3, 0]); await b.screenshot('industrial-process-photographic-detail');

      step('real per-part material gallery and persistent authored priority');
      b.report.edit = await b.call(async () => {
        const e = context.editor, actor = e.document.getObject(__photoSamples.forklift); e.shell.setPanel('inspector', true); e.resize(); e.select(actor);
        const slots = e.materials.getSlots(actor), target = slots.find(slot => slot.value === 'name:Pintura de carrocería') || slots.find(slot => slot.value.startsWith('mesh:'));
        if (!target) throw Error('No authored part found.'); e.materialInspector.targets.set(actor, target.value); e.renderInspector();
        const snapshot = () => {const list = []; actor.traverse(node => {if (node.material) list.push({uuid: node.uuid, material: (Array.isArray(node.material) ? node.material : [node.material]).map(m => m.uuid)});}); return list;};
        window.__photoBeforeParts = snapshot(); const button = [...e.inspector.querySelectorAll('button.ed-photo-finish')].find(button => button.textContent.includes('Pintura industrial'));
        if (!button) throw Error('Photographic finish gallery missing from inspector.'); for (let parent = button.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true; button.click();
        await new Promise(resolve => setTimeout(resolve, 0)); await e.materials.sync(e.roomId); await e.materials.ready; e.finishes.sync(e.roomId, .5);
        const after = snapshot(), changed = after.filter((row, index) => JSON.stringify(row.material) !== JSON.stringify(__photoBeforeParts[index].material));
        const config = e.document.getBehaviors(actor).find(config => config.type === 'surfaceMaterial');
        const authored = []; actor.traverse(node => (Array.isArray(node.material) ? node.material : [node.material]).filter(m => m && m.userData.surfaceMaterialBinding).forEach(material => authored.push({
          color: material.map && material.map.image && material.map.image.src, normal: material.normalMap && material.normalMap.image && material.normalMap.image.src,
          roughness: material.roughnessMap && material.roughnessMap.image && material.roughnessMap.image.src, normalStrength: material.normalScale.x})));
        return {slot: target.value, config, changed: changed.length, total: after.length, authored, source: e.finishes.getStats()};
      });
      assert(b.report.edit.changed > 0 && b.report.edit.changed < b.report.edit.total); assert.equal(b.report.edit.config.preset, 'photo-paint'); assert.notEqual(b.report.edit.slot, 'all');
      assert(b.report.edit.authored.length > 0); assert(b.report.edit.authored.every(row => /\/assets\/materials\/pbr\/paint-neutral-512\.jpg$/.test(row.color) && /paint-normal-512\.jpg$/.test(row.normal) && /paint-roughness-512\.jpg$/.test(row.roughness) && row.normalStrength === .2));
      await ready(); await b.screenshot('industrial-material-part-inspector');

      step('project save/reopen and active room release/reacquire');
      b.report.storage = await b.call(async () => {
        const e = context.editor; await e.saveProject(); const saved = await e.projectClient.getProject(e.currentProject.id), vehicleId = __photoSamples.forklift;
        const stored = saved.document.rooms[e.roomId].additions.find(row => row.id === vehicleId).behaviors.find(config => config.type === 'surfaceMaterial');
        await e.applyServerProject(saved, {roomId: e.roomId});
        const reopened = e.document.getBehaviors(e.document.getObject(vehicleId)).find(config => config.type === 'surfaceMaterial');
        return {revision: saved.revision, stored, reopened, documentSame: e.finishes.document === e.document};
      }); assert.deepEqual(b.report.storage.stored, b.report.storage.reopened);
      await ready(); const beforeSwitch = await b.call(evidence);
      b.report.transition = await b.call(async () => {
        const e = context.editor, previous = [...e.finishes.store.entries.values()].flatMap(entry => Object.values(entry.textures || {})), counters = previous.map(texture => {const state = {n: 0}; texture.addEventListener('dispose', () => state.n++); return state;});
        await e.hooks.gotoRoom(1); e.simulationPaused = true; e.finishes.sync(e.roomId, .5); await Promise.all([...e.finishes.store.entries.values()].map(entry => entry.ready)); e.finishes.sync(e.roomId, .5);
        const other = e.finishes.getStats(), released = counters.every(state => state.n >= 1); await e.hooks.gotoRoom(0); e.simulationPaused = true;
        return {other, released};
      }); assert(b.report.transition.released); await ready(); const afterSwitch = await b.call(evidence);
      assert.equal(afterSwitch.stats.failures, 0); assert.equal(afterSwitch.stickers.length, beforeSwitch.stickers.length); assert.equal(afterSwitch.stats.materials, beforeSwitch.stats.materials);
      b.report.afterReopen = afterSwitch;

      step('economy texture budget and repeated high-tier rebind, no resource duplication');
      b.report.economy = await b.call(async () => {context.graphics.setMode('economy'); const e = context.editor; e.finishes.sync(e.roomId, .5); await Promise.all([...e.finishes.store.entries.values()].map(entry => entry.ready)); e.finishes.sync(e.roomId, .5); return e.finishes.getStats();});
      assert.equal(b.report.economy.edge, 256);
      await b.call(() => context.graphics.setMode('high')); await ready();
      b.report.final = await b.call(evidence); assert.equal(b.report.final.gl, 0); assert.equal(b.report.final.stats.failures, 0);
      assert(b.report.final.programs.every(program => program.runnable !== false)); assert.deepEqual(b.report.final.httpFailures, []);
      assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.consoleErrors, []); assert.deepEqual(b.report.apiFailures, []);
      b.report.renderer = 'Chrome SwiftShader: shader/visual correctness, no native Quest or hardware FPS claim'; b.report.passed = true;
      console.log('PASS photographic materials Chrome:', JSON.stringify({profiles: b.report.final.stats.profiles, textures: b.report.final.stats.textures, stickers: b.report.final.stickers.length, editedMeshes: b.report.edit.changed, screenshots: b.report.shots.length}));
    });
    assert.deepEqual(fixture.errors, []); fs.writeFileSync(__layout.map(path.join(OUTPUT, 'industrial-realism-browser.json')), JSON.stringify(report, null, 2));
  } finally {if (currentReport) fs.writeFileSync(__layout.map(path.join(OUTPUT, 'industrial-realism-browser.json')), JSON.stringify(currentReport, null, 2)); await fixture.close();}
}
if (require.main === module) run().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {run};
