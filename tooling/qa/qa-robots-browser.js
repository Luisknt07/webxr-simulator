const __layout = require("../layout.cjs");
'use strict';
// Actual compiled WebGL/editor/API, disposable users and database only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const {startTemporaryServer} = require('./qa-project-workspace-browser.js');
const {withBrowser} = require('./qa-public-publication-browser.js');
const ROOT = __layout.map(path.resolve(__layout.oldDir("scripts/qa-robots-browser.js"), '..')), OUTPUT = __layout.map(path.join(ROOT, 'data/qa-studio'));
const PASSWORD = 'Disposable-robot-browser-fixture-2026!';
async function run() {
  fs.mkdirSync(OUTPUT, {recursive: true});
  const bundleSha256 = createHash('sha256').update(fs.readFileSync(__layout.map(path.join(ROOT, "bundle.js")))).digest('hex');
  const hashAt = process.argv.indexOf('--expected-bundle-sha256');
  if (hashAt >= 0) assert.equal(bundleSha256, process.argv[hashAt + 1], 'Review the exact compiled build.');
  const fixture = await startTemporaryServer();
  try {
    const account = await fixture.request('/api/studio/register', 'POST', {username: 'qa_robot_operator', displayName: 'Robótica · QA temporal', password: PASSWORD});
    assert.equal(account.status, 201);
    let captured;
    await withBrowser(fixture.origin, async b => {
      captured = b.report;
      await b.navigate('/');
      await b.call(async password => { await context.studio.client.login('qa_robot_operator', password); await context.studio.client.me(); await context.studio.authenticated(); }, PASSWORD);
      await b.navigate('/editor');
      await b.call(async () => { await context.editor.studioTools.createStudyProject(['robot-handling-line', 'robot-scara-sorting'], {name: 'QA · Celdas robóticas', continuous: false}); });
      b.report.bundleSha256 = bundleSha256; b.report.robotScenes = [];
      for (const index of [0, 1]) {
        await b.call(async roomIndex => { const e = context.editor; if (!e.active) e.enter(); await e.hooks.gotoRoom(roomIndex); e.home(); }, index);
        const authoring = await b.call(() => {
          const e = context.editor, robot = e.document.getObjects(e.roomId).find(object => object.parent === e.root && object.userData.editorPrefabKey === 'robot');
          if (!robot) throw Error('Robot example missing.');
          e.select(robot); window.__qaRobotId = robot.userData.editorId;
          e.camera.position.set(6, 4, 7); e.orbit.target.set(1, 1, 0); e.orbit.update();
          const sections = [...e.inspectorContent.querySelectorAll('section > h3')].map(value => value.textContent);
          return {roomId: e.roomId, id: __qaRobotId, family: e.document.getBehaviors(robot).find(value => value.type === 'robot').family,
            joints: e.inspector.querySelectorAll('[data-robot-joint]').length,
            fields: [...e.inspector.querySelectorAll('[data-behavior-field]')].map(value => value.dataset.behaviorField), sections};
        });
        assert(authoring.joints >= 4); assert(authoring.fields.includes('filletRadius') && authoring.fields.includes('sourceId'));
        assert(authoring.sections.indexOf('TRANSFORMACIÓN') < authoring.sections.indexOf('CONFIGURACIÓN DEL EQUIPO'));
        await b.screenshot('robot-' + authoring.family + '-editor');
        await b.call(async () => {
          const e = context.editor; e.leave();
          // Accelerate deterministic fixed steps with the actual CollisionWorld;
          // geometry, body clearance and source/output adapters remain enabled.
          for (let batch = 0; batch < 12; batch++) { for (let frame = 0; frame < 20; frame++) e.simulation.execute(.25); await new Promise(resolve => setTimeout(resolve, 0)); }
          e.industrialVisuals.sync(e.roomId, 0, false); e.lineMonitors.sync(e.roomId, 0, false);
        });
        const result = await b.call(() => {
          const e = context.editor, r = e.simulation.records.get(__qaRobotId), root = r.components.robot.visualRoot, rig = root.userData.robotRig;
          const stocks = [...e.simulation.records.values()].filter(record => record.components.palletQueue).map(record => ({name: record.object.name, units: record.components.palletQueue.receivedUnits}));
          const displays = [...e.industrialVisuals.displays.values()].filter(entry => entry.conveyor && entry.conveyor.id === r.id);
          return {variables: r.variables, stocks, products: e.simulation.products.size, tcp: rig.tool.getWorldPosition(r.object.position.clone()).toArray(), displays: displays.length,
            graphics: e.ctx.graphics && e.ctx.graphics.profile, errors: e.simulation.events.filter(event => event.type === 'robot-interlock')};
        });
        assert.equal(result.variables.fault, '', JSON.stringify(result));
        assert.equal(result.variables.completed, 6, JSON.stringify(result)); assert.equal(result.products, 6);
        assert.equal(result.stocks.reduce((total, stock) => total + stock.units, 0), 6, JSON.stringify(result));
        assert(result.displays >= 1); assert.equal(result.errors.length, 0);
        b.report.robotScenes.push({authoring, result}); await b.screenshot('robot-' + authoring.family + '-running');
        console.log('Chrome robot cell:', authoring.family, '6 products delivered with real collision geometry.');
      }
      await b.call(() => {
        const e = context.editor; e.enter();
        e.document.getObjects(e.roomId).filter(object => object.parent === e.root && (object.userData.editorPrefabKey || e.document.getBehaviors(object).some(value => ['info', 'lineMonitor'].includes(value.type)))).forEach(object => { object.visible = false; });
      });
      b.report.rigRenders = [];
      for (const variant of ['articulated-general', 'collaborative', 'scara', 'delta', 'cartesian', 'palletizer', 'amr', 'agv', 'shuttle', 'cylindrical-rpp', 'polar-rrp', 'mobile-manipulator', 'mobile-sorter-crossbelt', 'mobile-sorter-tilttray', 'articulated-process']) {
        const rendered = await b.call(model => {
          const e = context.editor;
          if (window.__qaGalleryRobot) __qaGalleryRobot.visible = false;
          const robot = e.document.addPrefab(e.roomId, 'robot', model); robot.position.set(0, 0, 0); window.__qaGalleryRobot = robot;
          e.document.setBehaviors(robot, e.document.getBehaviors(robot).map(config => config.type === 'robot' ? Object.assign({}, config, {withPanel: false}) : config));
          e.select(robot); e.resize();
          const root = robot.children[0], rig = root.userData.robotRig;
          root.updateWorldMatrix(true, true);
          let triangles = 0, meshes = 0, box, roles = new Set();
          rig.visual.traverse(node => {if (node.geometry) {meshes++; const g = node.geometry; triangles += (g.index ? g.index.count : g.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1); if (!g.boundingBox) g.computeBoundingBox(); const bounds = g.boundingBox.clone().applyMatrix4(node.matrixWorld); box ? box.union(bounds) : box = bounds;} if(node.material?.userData?.industrialMaterialRole) roles.add(node.material.userData.industrialMaterialRole);});
          const center=box.getCenter(robot.position.clone()),size=box.getSize(robot.position.clone()),distance=Math.max(size.x,size.y,size.z)*1.55;
          e.orbit.target.copy(center); e.camera.position.copy(center).add(center.clone().set(distance*.65,distance*.35,distance*.8));e.orbit.update();e.box.visible=false;e.transform.visible=false;
          return {variant: model, joints: rig.joints.length, triangles, meshes, bounds: {min:box.min.toArray(),max:box.max.toArray()}, roles:[...roles], tcp:rig.tool.getWorldPosition(robot.position.clone()).toArray()};
        }, variant);
        assert(rendered.triangles < 18000, JSON.stringify(rendered)); assert(rendered.bounds.min[1] > -.08, JSON.stringify(rendered)); assert(rendered.roles.length >= 3);
        await b.screenshot('robot-rig-' + variant); b.report.rigRenders.push(rendered);
        if (['articulated-general', 'palletizer', 'mobile-manipulator'].includes(variant)) {
          await b.call(() => {const e=context.editor, target=e.orbit.target, offset=e.camera.position.clone().sub(target); e.camera.position.copy(target).add(offset.set(-offset.x, offset.y*.7, offset.z));e.orbit.update();});
          await b.screenshot('robot-rig-' + variant + '-reverse');
        }
      }
      const changeField = async (key, value) => {
        await b.call((name, next) => { const input = context.editor.inspector.querySelector('[data-behavior-field="' + name + '"]'); if (!input) throw Error('Robot field missing: ' + name); input.value = next; input.dispatchEvent(new Event('change', {bubbles: true})); }, key, value);
        await b.until(() => b.evaluate('!context.editor.pendingEdits'), 'Robot field edit did not settle.');
      };
      await changeField('tool', 'vacuum');
      assert.equal(await b.evaluate('context.editor.document.getBehaviors(__qaGalleryRobot).find(v=>v.type==="robot").operation'), 'pick-place');
      await changeField('family', 'cartesian'); await changeField('frameColor', '#c4563a'); await changeField('length', 5);
      const edited = await b.call(() => {
        const e = context.editor, config = e.document.getBehaviors(__qaGalleryRobot).find(v => v.type === 'robot'), root = __qaGalleryRobot.children[0];
        const colors = []; root.userData.robotRig.visual.traverse(node => { if (node.isMesh && node.material && node.material.userData.industrialMaterialRole === 'frame') colors.push(node.material.color.clone().convertLinearToSRGB().toArray()); });
        const slider = e.inspector.querySelector('[data-robot-joint="J1"]'); slider.value = .35; slider.dispatchEvent(new Event('change', {bubbles: true}));
        return {family: config.family, variant: config.variant, length: config.length, frameColor: config.frameColor, colors};
      });
      assert.equal(edited.family, 'cartesian'); assert.equal(edited.variant, 'cartesian'); assert.equal(edited.length, 5); assert.equal(edited.frameColor, '#c4563a'); assert(edited.colors.length > 0);
      assert(edited.colors.every(color => color.every((value, index) => Math.abs(value - [196 / 255, 86 / 255, 58 / 255][index]) < .00001)));
      await b.until(() => b.evaluate('!context.editor.pendingEdits'), 'Robot joint edit did not settle.');
      const limits = await b.evaluate('JSON.parse(context.editor.document.getBehaviors(__qaGalleryRobot).find(v=>v.type==="robot").jointLimitsJson)');
      assert.equal(limits.find(value => value.id === 'J1').home, .35);
      b.report.inspectorEdits = edited; await b.screenshot('robot-parametric-editor');
      // The reported oversized actor came from this bundled laboratory, not
      // from the compact catalogue preset. Review that actual public recipe.
      await b.evaluate('context.editor.accessView.loadPublic("industrial-lab-complete")');
      b.report.publicLab = await b.call(() => {
        const e = context.editor, rows = [...e.simulation.records.values()].filter(r => r.components.robot);
        const unload = rows.find(r => /Descarga/.test(r.object.name)); if (!unload) throw Error('Laboratory unloading cell missing.');
        window.__qaPublicRobot = unload;
        const p = unload.object.getWorldPosition(unload.object.position.clone());
        context.cameraRig.position.set(0,0,0); context.cameraRig.quaternion.set(0,0,0,1);
        context.camera.position.copy(p).add(p.clone().set(2.8,2.0,3.4)); context.camera.lookAt(p.clone().add(p.clone().set(.1,1.1,0)));
        return rows.map(r => ({name:r.object.name,reach:r.components.robot.config.reach,baseHeight:r.components.robot.config.baseHeight,homeHeight:r.components.robot.initialPose.tcp.y,position:r.object.position.toArray()}));
      });
      assert.equal(b.report.publicLab.length,3); assert(b.report.publicLab.every(r => r.reach<=3.2 && r.homeHeight<=1.4));
      await b.screenshot('robot-laboratory-scaled-cell');
      // The full warehouse runs live here. Long fixed-step conservation is
      // verified separately by test-cedi-robotics with the same geometry; doing
      // 100 accelerated seconds under software WebGL can starve the CDP loop.
      await b.call(() => new Promise(resolve=>setTimeout(resolve,1500)));
      const labFlow = await b.evaluate('[...context.editor.simulation.records.values()].filter(r=>r.components.robot).map(r=>({name:r.object.name,completed:r.components.robot.completed,fault:r.components.robot.fault}))');
      assert(labFlow.every(r=>!r.fault),JSON.stringify(labFlow)); b.report.publicLabFlow=labFlow;
      await b.screenshot('robot-laboratory-running-cell');
      assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.consoleErrors, []); assert.deepEqual(b.report.apiFailures, []);
    });
    fs.writeFileSync(__layout.map(path.join(OUTPUT, 'robots-browser.json')), JSON.stringify(captured, null, 2)); assert.deepEqual(fixture.errors, []);
    console.log('PASS robot browser authoring, HMI, real WebGL, fixed-step flow and actual CollisionWorld.');
  } finally { await fixture.close(); }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {run};
