'use strict';
// Actual compiled WebGL/editor/API, disposable users and database only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const {startTemporaryServer, withBrowser} = require('./qa-project-workspace-browser.js');
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'data/qa-studio');
const PASSWORD = 'Disposable-robot-browser-fixture-2026!';
async function run() {
  fs.mkdirSync(OUTPUT, {recursive: true});
  const bundleSha256 = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'bundle.js'))).digest('hex');
  const fixture = await startTemporaryServer();
  try {
    const account = await fixture.request('/api/studio/register', 'POST', {username: 'qa_robot_operator', displayName: 'Robótica · QA temporal', password: PASSWORD});
    assert.equal(account.status, 201);
    const report = await withBrowser(fixture.origin, async b => {
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
      for (const variant of ['articulated-general', 'collaborative', 'scara', 'delta', 'cartesian', 'palletizer', 'amr', 'agv', 'shuttle', 'articulated-process']) {
        const rendered = await b.call(model => {
          const e = context.editor;
          if (window.__qaGalleryRobot) __qaGalleryRobot.visible = false;
          const robot = e.document.addPrefab(e.roomId, 'robot', model); robot.position.set(0, 0, 0); window.__qaGalleryRobot = robot;
          e.document.setBehaviors(robot, e.document.getBehaviors(robot).map(config => config.type === 'robot' ? Object.assign({}, config, {withPanel: false}) : config));
          e.select(robot); e.camera.position.set(3.4, 2.8, 3.4); e.orbit.target.set(.35, 1.1, 0); e.orbit.update(); e.resize();
          const root = robot.children[0], rig = root.userData.robotRig;
          return {variant: model, joints: rig.joints.length, materials: [...new Set(rig.visual.children.flatMap(node => node.material ? [node.material.name] : []))]};
        }, variant);
        await b.screenshot('robot-rig-' + variant); b.report.rigRenders.push(rendered);
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
      assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.consoleErrors, []); assert.deepEqual(b.report.apiFailures, []);
    });
    fs.writeFileSync(path.join(OUTPUT, 'robots-browser.json'), JSON.stringify(report, null, 2)); assert.deepEqual(fixture.errors, []);
    console.log('PASS robot browser authoring, HMI, real WebGL, fixed-step flow and actual CollisionWorld.');
  } finally { await fixture.close(); }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {run};
