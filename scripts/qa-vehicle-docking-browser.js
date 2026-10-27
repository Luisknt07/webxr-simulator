'use strict';
// Compiled application, real product/fork geometry and trusted Chrome controls.
// Only fixture placement is scripted. No live accounts/projects are accessed.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const {startTemporaryServer, withBrowser} = require('./qa-project-workspace-browser');
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'data/qa-studio');
const PASSWORD = 'Disposable-native-docking-fixture-2026!';
async function run() {
  const at = process.argv.indexOf('--expected-bundle-sha256'), expected = at < 0 ? '' : process.argv[at + 1];
  assert(/^[a-f0-9]{64}$/.test(expected), 'Pass the SHA256 of the reviewed production build.');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'bundle.js'))).digest('hex'), expected);
  fs.mkdirSync(OUTPUT, {recursive: true}); const fixture = await startTemporaryServer();
  try {
    assert.equal((await fixture.request('/api/studio/register', 'POST', {username: 'qa_docking', displayName: 'QA atraque', password: PASSWORD})).status, 201);
    const report = await withBrowser(fixture.origin, async b => {
      b.report.bundleSha256 = expected;
      await b.send('Page.addScriptToEvaluateOnNewDocument', {source: "window.__qaDockInputs=[];window.addEventListener('keydown',e=>{if(['KeyC','KeyF'].includes(e.code))__qaDockInputs.push({code:e.code,trusted:e.isTrusted});},true);document.addEventListener('click',e=>{const b=e.target.closest?.('[data-vehicle-command],[data-vehicle-view],[data-vehicle-docking-help]');if(b)__qaDockInputs.push({action:b.dataset.vehicleCommand||b.dataset.vehicleView||'docking-help',trusted:e.isTrusted});},true);"});
      await b.navigate('/'); await b.call(async password => {await context.studio.client.login('qa_docking', password); await context.studio.client.me(); await context.studio.authenticated();}, PASSWORD); await b.navigate('/editor');
      await b.call(() => {window.__qaCreate = context.editor.studioTools.newProject();});
      await b.until(() => b.evaluate('!!document.querySelector(".ed-scene-create[open]")'), 'New project wizard missing.');
      await b.call(() => {const d = document.querySelector('.ed-scene-create'); d.querySelectorAll('.ed-scene-create-choice')[0].click(); d.querySelector('input').value = 'QA · Atraque y cámara de uñas'; d.querySelector('form').requestSubmit();}); await b.evaluate('__qaCreate');
      await b.call(async () => {
        const e = context.editor; e.document.getObjects(e.roomId).filter(o => o !== e.root && e.document.isNative(o)).forEach(o => {o.visible = false;});
        await e.perform(() => {
          const v = e.document.addPrefab(e.roomId, 'vehicle', 'forklift-electric-4w');
          e.document.setBehaviors(v, e.document.getBehaviors(v).map(c => c.type === 'vehicle' ? {...c, mode: 'manual', powered: true, running: true, parkingBrake: true} : c));
          e.document.setTransform(v, {position: [0, 0, 0]}); window.__qaVehicleId = v.userData.editorId;
          const p = e.document.addPrefab(e.roomId, 'product', 'pallet-loaded'); e.document.setTransform(p, {position: [0, 0, 3.6]}); window.__qaPalletId = p.userData.editorId;
          e.select(v);
        });
      });
      const click = async expression => {
        const p = await b.until(() => b.call(source => {const el = (0, eval)(source); if (!el || el.hidden || el.disabled) return null; const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y); return r.width && r.height && top && (top === el || el.contains(top)) ? {x, y} : null;}, expression), 'Obscured control: ' + expression, 15000);
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', {type, x: p.x, y: p.y, ...(type === 'mouseMoved' ? {} : {button: 'left', clickCount: 1})});
      };
      const key = async code => {for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', {type, code, key: code.slice(3).toLowerCase(), windowsVirtualKeyCode: code.charCodeAt(3), nativeVirtualKeyCode: code.charCodeAt(3)});};
      const hud = action => click('context.editor.vehicleDriving.hud.querySelector(\'[data-vehicle-command="' + action + '"]\')');
      await click('context.editor.playButton');
      await b.until(() => b.evaluate('context.editor.simulation.running&&!context.editor.active'), 'Play did not start.');
      await b.call(async () => {context.cameraRig.position.set(3, 0, 0); context.cameraRig.quaternion.set(0, 0, 0, 1); context.camera.position.set(0, 1.6, 0); context.camera.rotation.set(0, -Math.PI / 2, 0); context.cameraRig.updateWorldMatrix(true, true); context.resetCollisionPose?.(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));});
      await key('KeyF'); await b.until(() => b.evaluate('context.editor.vehicleDriving.id===__qaVehicleId'), 'F did not mount.');
      // The fixture moves the vehicle to the same exact physical dock used by
      // automatic missions. The monitor and pickup still use production checks.
      const place = async offset => b.call(async lateral => {
        const e = context.editor, runtime = e.simulation, record = runtime.records.get(__qaVehicleId), product = [...runtime.products.values()].find(p => p.record?.id === __qaPalletId || p.object.userData.editorId === __qaPalletId);
        if (!product) throw Error('Real authored pallet not registered.');
        const dock = runtime.vehicleRuntime.pickupDock(record, {yaw: 0}, product); if (!dock) throw Error('Real pallet has no reachable dock.');
        record.object.position.copy(dock.position); record.object.position.x += lateral; record.object.rotation.set(0, dock.yaw || 0, 0);
        const v = record.components.vehicle, pose = {...v.pose, lift: dock.toolY - v.originWorld.y - v.config.forkBaseHeight};
        runtime.vehicleRuntime.applyPose(record, pose, false); record.object.updateWorldMatrix(true, true); runtime.ctx.collisionWorld?.invalidate(record.object);
        e.vehicleDriving.follow(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); e.vehicleDriving.docking.update(true);
        return runtime.vehicleRuntime.getDockingState(record);
      }, offset);
      b.report.misaligned = await place(.4); assert.equal(b.report.misaligned.ready, false);
      assert.notEqual(await b.evaluate('context.editor.vehicleDriving.docking.element.dataset.state'), 'ready');
      await hud('pickup'); assert.equal(await b.evaluate('!!context.editor.simulation.records.get(__qaVehicleId).components.vehicle.entry'), false);
      b.report.aligned = await place(0); assert.equal(b.report.aligned.ready, true, JSON.stringify(b.report.aligned));
      assert.equal(await b.evaluate('context.editor.vehicleDriving.docking.element.dataset.state'), 'ready');
      await b.until(() => b.evaluate('context.editor.toastNode.hidden'), 'The rejected-pickup feedback did not clear.', 10000);
      const view = () => b.call(() => ({index: context.editor.vehicleDriving.viewIndex, position: context.camera.getWorldPosition(context.camera.position.clone()).toArray()}));
      b.report.views = [await view()];
      await b.screenshot('docking-aligned-cab');
      await key('KeyC'); await b.screenshot('docking-follow-view'); b.report.views.push(await view());
      await key('KeyC'); await b.screenshot('docking-forks-view'); b.report.views.push(await view());
      assert.deepEqual(b.report.views.map(v => v.index), [0, 1, 2]);
      assert(Math.hypot(...b.report.views[0].position.map((v, i) => v - b.report.views[2].position[i])) > .2, 'Fork view must actually change the main camera.');
      await click('context.editor.vehicleDriving.viewButton'); assert.equal((await view()).index, 0);
      await key('KeyC'); await key('KeyC');
      await click('context.editor.vehicleDriving.dockingButton'); assert.equal(await b.evaluate('context.editor.vehicleDriving.docking.element.hidden'), true);
      await click('context.editor.vehicleDriving.dockingButton'); assert.equal(await b.evaluate('context.editor.vehicleDriving.docking.element.hidden'), false);
      await hud('pickup');
      b.report.loaded = await b.call(() => {const r = context.editor.simulation.records.get(__qaVehicleId), v = r.components.vehicle; return {id: v.entry?.id, units: v.entry?.units, mass: v.entry && context.editor.simulation.productMetadata(v.entry.product).mass, state: context.editor.simulation.vehicleRuntime.getDockingState(r)};});
      assert(b.report.loaded.id); assert.equal(b.report.loaded.units, 24); assert.equal(b.report.loaded.mass, 145);
      await b.screenshot('docking-loaded-forks');
      await hud('release'); assert.equal(await b.evaluate('!!context.editor.simulation.records.get(__qaVehicleId).components.vehicle.entry'), false);
      b.report.delivered = await b.call(() => {const r = context.editor.simulation.records.get(__qaVehicleId), v = r.components.vehicle; return {loads: v.delivered, units: v.deliveredUnits};}); assert.equal(b.report.delivered.loads, 1); assert.equal(b.report.delivered.units, 24);
      await hud('exit'); assert.equal(await b.evaluate('!!context.editor.vehicleDriving.id'), false);
      b.report.nativeInputs = await b.evaluate('__qaDockInputs'); assert(b.report.nativeInputs.length >= 6); assert(b.report.nativeInputs.every(event => event.trusted));
      assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.apiFailures, []); assert.deepEqual(b.report.consoleErrors, []);
    });
    fs.writeFileSync(path.join(OUTPUT, 'vehicle-docking-browser.json'), JSON.stringify(report, null, 2)); assert.deepEqual(fixture.errors, []);
    console.log('PASS actual fork/pallet docking, monitor truth, native view switching and identity-preserving pickup/release in compiled Chrome.');
  } finally {await fixture.close();}
}
if (require.main === module) run().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {run};
