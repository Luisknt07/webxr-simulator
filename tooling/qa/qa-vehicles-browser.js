const __layout = require("../layout.cjs");
'use strict';
// Compiled WebGL + actual authoring/API + manual driving. Disposable database,
// account and Chrome profile; never reads or mutates data/studio or live users.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const {startTemporaryServer, withBrowser} = require('./qa-project-workspace-browser.js');
const ROOT = __layout.map(path.resolve(__layout.oldDir("scripts/qa-vehicles-browser.js"), '..')), OUTPUT = __layout.map(path.join(ROOT, 'data/qa-studio'));
const PASSWORD = 'Disposable-cargo-vehicle-browser-fixture-2026!';
async function run() {
  fs.mkdirSync(OUTPUT, {recursive: true}); const fixture = await startTemporaryServer();
  try {
    const account = await fixture.request('/api/studio/register', 'POST', {username: 'qa_cargo_vehicle', displayName: 'QA vehículos temporal', password: PASSWORD}); assert.equal(account.status, 201);
    const report = await withBrowser(fixture.origin, async b => {
      b.report.bundleSha256 = createHash('sha256').update(fs.readFileSync(__layout.map(path.join(ROOT, "bundle.js")))).digest('hex');
      await b.navigate('/'); await b.call(async password => { await context.studio.client.login('qa_cargo_vehicle', password); await context.studio.client.me(); await context.studio.authenticated(); }, PASSWORD);
      await b.navigate('/editor');
      const counts = await b.call(() => {
        const resources = context.editor.resourceBrowser.resources;
        return ['robot', 'vehicle', 'product'].map(kind => resources.filter(item => item.origin === 'library' && item.action && item.action.type === 'prefab' && item.action.kind === kind).length);
      }); assert.deepEqual(counts, [15, 13, 17]); b.report.catalog = counts;
      await b.call(async () => { await context.editor.studioTools.createStudyProject(['cedi-sorting-robotics'], {name: 'QA · CEDI robotizado', continuous: false}); });
      const layout = await b.call(() => {
        const e = context.editor, objects = e.document.getObjects(e.roomId), robots = objects.filter(object => object.parent === e.root && object.name.startsWith('Robótica CEDI') && object.userData.editorPrefabKey === 'robot');
        if (!robots.length) throw Error('No inline robot in the real CEDI template.'); window.__qaCediRobots = robots.map(object => object.userData.editorId);
        e.select(robots[0]); const p = robots[0].position; e.camera.position.set(p.x + 6, 4, p.z + 6); e.orbit.target.set(p.x, 1.1, p.z); e.orbit.update();
        return {robots: robots.length, vehicles: objects.filter(object => object.parent === e.root && object.userData.editorPrefabKey === 'vehicle').length};
      }); assert(layout.robots >= 1 && layout.robots <= 3, 'Loading, transfer and unloading cells require a free physical base.'); assert.equal(layout.vehicles, 1); await b.screenshot('cedi-inline-robots-editor');
      await b.call(async () => {
        const e = context.editor; await e.leave();
        for (let batch = 0; batch < 12; batch++) { for (let frame = 0; frame < 20; frame++) { e.ctx.collisionWorld.beginFrame(); try { e.simulation.execute(.25); } finally { e.ctx.collisionWorld.endFrame(); } } await new Promise(resolve => setTimeout(resolve, 0)); }
        e.industrialVisuals.sync(e.roomId, 0, false); e.lineMonitors.sync(e.roomId, 0, false);
      });
      const flow = await b.call(() => __qaCediRobots.map(id => { const r = context.editor.simulation.records.get(id); return {id, variables: r.variables}; }));
      flow.forEach(row => { assert.equal(row.variables.fault, '', JSON.stringify(row)); assert(row.variables.completed > 0, JSON.stringify(row)); assert(row.variables.inFlight >= 0 && row.variables.inFlight <= 1, 'A pick/place robot retains at most its actual current load.'); }); b.report.cediFlow = flow; await b.screenshot('cedi-inline-robots-running');
      await b.call(() => { const e = context.editor; e.enter(); e.document.getObjects(e.roomId).filter(object => object.parent === e.root && (object.userData.editorPrefabKey || e.document.getBehaviors(object).some(config => ['lineMonitor', 'info'].includes(config.type)))).forEach(object => { object.visible = false; }); });
      b.report.vehicleRenders = [];
      for (const variant of ['forklift-electric-3w', 'forklift-electric-4w', 'reach-truck', 'vna-turret']) {
        const result = await b.call(model => {
          const e = context.editor; if (window.__qaVehicle) __qaVehicle.visible = false;
          const object = e.document.addPrefab(e.roomId, 'vehicle', model); e.document.setTransform(object, {position: [0, 0, 0]}); window.__qaVehicle = object; e.select(object);
          e.camera.position.set(2.7, 2.1, 3.6); e.orbit.target.set(0, 1.05, .5); e.orbit.update();
          let rig; object.traverse(node => { if (node.userData.vehicleRig) rig = node.userData.vehicleRig; });
          return {variant: model, wheels: rig.wheels && rig.wheels.length, hasForks: !!rig.forks, seat: !!rig.driverSeat, physicalWheel: !!(rig.controls && rig.controls.wheel), hydraulicLevers: rig.controls && rig.controls.levers.map(control => control.id)};
        }, variant); assert(result.hasForks && result.seat && result.physicalWheel); assert(result.hydraulicLevers.includes('lift')); b.report.vehicleRenders.push(result); await b.screenshot('vehicle-' + variant);
      }
      await b.call(() => {
        const e = context.editor; __qaVehicle.visible = false; window.__qaVehicle = e.document.addPrefab(e.roomId, 'vehicle', 'forklift-electric-4w'); e.document.setTransform(__qaVehicle, {position: [0, 0, 0]});
        window.__qaPallet = e.document.addPrefab(e.roomId, 'product', 'pallet-loaded'); e.document.setTransform(__qaPallet, {position: [0, 0, 3.6]}); e.select(__qaVehicle);
      });
      const change = async (key, value) => { await b.call((name, next) => { const input = context.editor.inspector.querySelector('[data-behavior-field="' + name + '"]'); if (!input) throw Error('Missing authoring field ' + name); input.value = next; input.dispatchEvent(new Event('change', {bubbles: true})); }, key, value); await b.until(() => b.evaluate('!context.editor.pendingEdits'), 'Edit did not settle.'); };
      await change('width', 1.35); await change('frameColor', '#c45b38'); await change('speed', .5);
      await b.call(() => context.editor.select(__qaPallet)); await change('palletType', 'industrial-1200x1000');
      const industrial = await b.call(() => context.editor.document.getBehaviors(__qaPallet).find(config => config.type === 'product')); assert.equal(industrial.width, 1.2); assert.equal(industrial.depth, 1);
      await change('palletType', 'euro-1200x800'); await change('width', 1.3); await change('color', '#a87544');
      const saved = await b.call(async () => {
        const e = context.editor; await e.saveProject(); const project = await e.projectClient.getProject(e.currentProject.id), rows = project.document.rooms[e.roomId].additions;
        return {vehicle: rows.find(row => row.id === __qaVehicle.userData.editorId).behaviors.find(c => c.type === 'vehicle'), product: rows.find(row => row.id === __qaPallet.userData.editorId).behaviors.find(c => c.type === 'product')};
      }); assert.equal(saved.vehicle.width, 1.35); assert.equal(saved.vehicle.frameColor, '#c45b38'); assert.equal(saved.product.width, 1.3); assert.equal(saved.product.palletType, 'custom'); assert.equal(saved.product.units, 24); assert.equal(saved.product.mass, 145); b.report.savedAuthoring = saved;
      await b.call(() => {
        const e = context.editor; e.select(__qaVehicle); const control = [...e.inspector.querySelectorAll('button')].find(button => button.textContent === 'Probar y conducir'); if (!control) throw Error('Drive inspector action missing.'); control.click();
      });
      await b.until(() => b.evaluate('context.editor.vehicleDriving.id===__qaVehicle.userData.editorId'), 'Driver did not mount from the actual UI.');
      const drive = await b.call(() => {
        const e = context.editor, d = e.vehicleDriving, r = e.simulation.records.get(__qaVehicle.userData.editorId), command = key => { const button = document.querySelector('[data-vehicle-command="' + key + '"]'); if (!button) throw Error('Missing driving HUD action ' + key); button.click(); };
        window.__qaDriverRecord = r;
        if (r.components.vehicle.parkingBrake) command('parkingBrake'); command('start');
        const step = () => { d.beforeStep(); e.ctx.collisionWorld.beginFrame(); try { e.simulation.execute(1 / 60); } finally { e.ctx.collisionWorld.endFrame(); } d.follow(); };
        window.__qaDriveStep = step; window.__qaVehicleCommand = command;
        const before = r.object.position.clone(); window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW', bubbles: true}));
        let frames = 0; while (r.object.position.z < 1.74 && frames++ < 600) step();
        window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW', bubbles: true})); window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space', bubbles: true})); for (let n = 0; n < 60; n++) step(); window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space', bubbles: true}));
        command('parkingBrake'); command('pickup');
        const v = r.components.vehicle, product = v.entry && v.entry.product;
        return {before: before.toArray(), after: r.object.position.toArray(), distance: v.distance, blocked: v.blocked, warning: v.warning, loaded: !!v.entry, mass: product && e.simulation.productMetadata(product).mass, units: v.entry && v.entry.units,
          worldPanelVisible: !!(d.worldPanel && d.worldPanel.plane.visible), desktopHudVisible: !!(d.hud && !d.hud.hidden),
          camera: e.ctx.camera.getWorldPosition(r.object.position.clone()).toArray(), seat: d.seat.getWorldPosition(r.object.position.clone()).toArray()};
      }); assert(drive.distance > 1.5, JSON.stringify(drive)); assert(drive.loaded, JSON.stringify(drive)); assert.equal(drive.mass, 145); assert.equal(drive.units, 24);
      assert(Math.hypot(...drive.camera.map((value, index) => value - drive.seat[index])) < .05, 'The desktop camera occupies the actual driver seat.');
      assert.equal(drive.worldPanelVisible, false, 'The immersive cockpit must not obstruct the desktop driver camera.'); assert.equal(drive.desktopHudVisible, true, 'Desktop driving keeps its HTML HUD.');
      b.report.driving = drive; await b.screenshot('vehicle-loaded-driver-seat');
      const unload = await b.call(() => {
        const e = context.editor, r = __qaDriverRecord, d = e.vehicleDriving;
        window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyQ', bubbles: true})); for (let i = 0; i < 15; i++) __qaDriveStep(); window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyQ', bubbles: true}));
        const distance = r.components.vehicle.distance; __qaVehicleCommand('parkingBrake');
        window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyS', bubbles: true})); let frames = 0; while (r.object.position.z > 1.1 && frames++ < 300) __qaDriveStep();
        window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyS', bubbles: true})); window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space', bubbles: true})); for (let n = 0; n < 60; n++) __qaDriveStep(); window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space', bubbles: true})); __qaVehicleCommand('parkingBrake');
        window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyE', bubbles: true}));
        for (let n = 0; n < 90 && !e.simulation.vehicleRuntime.getDockingState(r).ready; n++) __qaDriveStep();
        window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyE', bubbles: true}));
        __qaVehicleCommand('release'); const v = r.components.vehicle, result = {loaded: !!v.entry, warning: v.warning, delivered: v.delivered, units: v.deliveredUnits, loadedDistance: v.distance - distance}; __qaVehicleCommand('exit'); result.unmounted = !d.id; return result;
      }); assert.equal(unload.loaded, false, JSON.stringify(unload)); assert.equal(unload.units, 24); assert(unload.loadedDistance > .5, JSON.stringify(unload)); assert(unload.unmounted); b.report.unload = unload; await b.screenshot('vehicle-unloaded-floor');
      const cycles = await b.call(() => {
        const e = context.editor, d = e.vehicleDriving, input = e.ctx.raycontrol, before = {states: Object.keys(input.states).length, active: input.currentStates.length};
        for (let index = 0; index < 10; index++) { if (!d.mount(__qaVehicle.userData.editorId)) throw Error('Repeated mounting failed at ' + index); if (d.worldPanel.plane.visible) throw Error('Desktop inherited immersive cockpit'); if (!d.unmount()) throw Error('Repeated unmount failed at ' + index); }
        return {cycles: 10, before, after: {states: Object.keys(input.states).length, active: input.currentStates.length}, retainedPanel: !!d.worldPanel};
      }); assert.deepEqual(cycles.after, cycles.before, 'Ten mount/dismount cycles do not leak active or disabled real RayControl states.'); assert.equal(cycles.retainedPanel, false); b.report.mountCycles = cycles;
      await b.call(() => { context.editor.enter(); __qaVehicle.visible = false; __qaPallet.visible = false; }); b.report.extendedRobotRenders = [];
      for (const variant of ['cylindrical-rpp', 'polar-rrp', 'mobile-manipulator', 'mobile-sorter-crossbelt', 'mobile-sorter-tilttray']) {
        const result = await b.call(model => {
          const e = context.editor; if (window.__qaExtendedRobot) __qaExtendedRobot.visible = false;
          const robot = e.document.addPrefab(e.roomId, 'robot', model); window.__qaExtendedRobot = robot;
          e.document.setBehaviors(robot, e.document.getBehaviors(robot).map(config => config.type === 'robot' ? Object.assign({}, config, {withPanel: false}) : config));
          e.document.setTransform(robot, {position: [0, 0, 0]}); e.select(robot);
          const sorter = model.includes('sorter'); e.camera.position.set(sorter ? 1.8 : 2.7, sorter ? 1.5 : 2.4, sorter ? 2.2 : 3.5); e.orbit.target.set(.2, sorter ? .5 : 1.15, 0); e.orbit.update();
          let rig; robot.traverse(node => { if (node.userData.robotRig) rig = node.userData.robotRig; }); return {variant: model, joints: rig.joints.length, hasTool: !!rig.tool};
        }, variant); assert(result.hasTool); b.report.extendedRobotRenders.push(result); await b.screenshot('extended-robot-' + variant);
      }
      assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.consoleErrors, []); assert.deepEqual(b.report.apiFailures, []);
    });
    fs.writeFileSync(__layout.map(path.join(OUTPUT, 'vehicles-browser.json')), JSON.stringify(report, null, 2)); assert.deepEqual(fixture.errors, []);
    console.log('PASS compiled Chrome cargo/catalog/vehicle authoring, actual CEDI robot flow, seated camera, manual driving and fork pickup/deposit.');
  } finally { await fixture.close(); }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {run};
