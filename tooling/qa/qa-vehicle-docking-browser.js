const __layout = require("../layout.cjs");
'use strict';
// Compiled application, real product/fork geometry and trusted Chrome controls.
// Only fixture placement is scripted. No live accounts/projects are accessed.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const {startTemporaryServer} = require('./qa-project-workspace-browser');
const {withBrowser} = require('./qa-public-publication-browser');
const ROOT = __layout.map(path.resolve(__layout.oldDir("scripts/qa-vehicle-docking-browser.js"), '..')), OUTPUT = __layout.map(path.join(ROOT, 'data/qa-studio'));
const PASSWORD = 'Disposable-native-docking-fixture-2026!';
async function run() {
  const at = process.argv.indexOf('--expected-bundle-sha256'), expected = at < 0 ? '' : process.argv[at + 1];
  assert(/^[a-f0-9]{64}$/.test(expected), 'Pass the SHA256 of the reviewed production build.');
  assert.equal(createHash('sha256').update(fs.readFileSync(__layout.map(path.join(ROOT, "bundle.js")))).digest('hex'), expected);
  fs.mkdirSync(OUTPUT, {recursive: true}); const fixture = await startTemporaryServer();
  try {
    assert.equal((await fixture.request('/api/studio/register', 'POST', {username: 'qa_docking', displayName: 'QA atraque', password: PASSWORD})).status, 201);
    const report = await withBrowser(fixture.origin, async b => {
      b.report.bundleSha256 = expected;
      await b.send('Page.addScriptToEvaluateOnNewDocument', {source: "window.__qaDockInputs=[];window.addEventListener('keydown',e=>{if(['KeyC','KeyF'].includes(e.code))__qaDockInputs.push({code:e.code,trusted:e.isTrusted});},true);document.addEventListener('click',e=>{const b=e.target.closest?.('[data-vehicle-command],[data-vehicle-view],[data-vehicle-docking-help],[data-vehicle-fork-camera],[data-vehicle-fork-camera-side]');if(b)__qaDockInputs.push({action:b.dataset.vehicleCommand||b.dataset.vehicleView||'camera-or-guide',trusted:e.isTrusted});},true);"});
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
      // A real navigation must not be left waiting on the unsaved-project
      // beforeunload dialog. Persist only this disposable QA document.
      await b.call(() => context.editor.saveProject());
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
      const place = async (offset, approach = 0) => b.call(async (lateral, longitudinal) => {
        const e = context.editor, runtime = e.simulation, record = runtime.records.get(__qaVehicleId), product = [...runtime.products.values()].find(p => p.record?.id === __qaPalletId || p.object.userData.editorId === __qaPalletId);
        if (!product) throw Error('Real authored pallet not registered.');
        const dock = runtime.vehicleRuntime.pickupDock(record, {yaw: 0}, product); if (!dock) throw Error('Real pallet has no reachable dock.');
        record.object.position.copy(dock.position); record.object.position.x += lateral; record.object.position.z += longitudinal; record.object.rotation.set(0, dock.yaw || 0, 0);
        const v = record.components.vehicle, pose = {...v.pose, lift: dock.toolY - v.originWorld.y - v.config.forkBaseHeight};
        runtime.vehicleRuntime.applyPose(record, pose, false); record.object.updateWorldMatrix(true, true); runtime.ctx.collisionWorld?.invalidate(record.object);
        e.vehicleDriving.follow(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); e.vehicleDriving.docking.update(true);
        return runtime.vehicleRuntime.getDockingState(record);
      }, offset, approach);
      b.report.misaligned = await place(.4); assert.equal(b.report.misaligned.ready, false);
      assert.notEqual(await b.evaluate('context.editor.vehicleDriving.docking.element.dataset.state'), 'ready');
      await hud('pickup'); assert.equal(await b.evaluate('!!context.editor.simulation.records.get(__qaVehicleId).components.vehicle.entry'), false);
      b.report.shallow = await place(0, -.55); assert.equal(b.report.shallow.ready, false); assert(b.report.shallow.insertion.actualM < b.report.shallow.insertion.requiredM);
      const beforeApproachFrame = await b.evaluate('context.editor.vehicleDriving.docking.forkCamera.getStats().frames');
      await b.until(() => b.call(n => context.editor.vehicleDriving.docking.forkCamera.getStats().frames > n, beforeApproachFrame), 'The approach camera did not refresh.');
      await b.screenshot('docking-shallow-entry');
      b.report.aligned = await place(0); assert.equal(b.report.aligned.ready, true, JSON.stringify(b.report.aligned));
      assert.equal(await b.evaluate('context.editor.vehicleDriving.docking.element.dataset.state'), 'ready');
      await b.until(() => b.evaluate('context.editor.toastNode.hidden'), 'The rejected-pickup feedback did not clear.', 10000);
      const view = () => b.call(() => ({index: context.editor.vehicleDriving.viewIndex, position: context.camera.getWorldPosition(context.camera.position.clone()).toArray(), rotation: context.camera.quaternion.toArray(), rig: context.cameraRig.matrix.toArray()}));
      const feed = () => b.evaluate('context.editor.vehicleDriving.docking.forkCamera.getStats()');
      await b.until(async () => (await feed()).frames > 1, 'Auxiliary GPU camera never rendered.');
      b.report.camera = await feed(); assert.equal(b.report.camera.failures, 0); assert(b.report.camera.width <= 512 && b.report.camera.height <= 288); assert(b.report.camera.maxFPS <= 15);
      b.report.views = [await view()]; await b.screenshot('docking-aligned-isometric');
      assert.equal((await feed()).mode, 'entry');
      await click('context.editor.vehicleDriving.docking.cameraModeButton'); assert.equal((await feed()).mode, 'tips');
      assert.deepEqual(await view(), b.report.views[0], 'Changing auxiliary perspective must preserve the driver camera.');
      await b.screenshot('docking-emerging-tips'); await click('context.editor.vehicleDriving.docking.cameraModeButton'); assert.equal((await feed()).mode, 'entry');
      b.report.feedLayout = await b.call(() => {
        const monitor = context.editor.vehicleDriving.docking, rect = monitor.feedViewport.getBoundingClientRect();
        const a = monitor.canvas.getBoundingClientRect(), fc = monitor.forkCamera;
        return {width: rect.width, height: rect.height, besideGuide: rect.left >= a.right, background: getComputedStyle(monitor.element).backgroundColor,
          framed: fc.framing.visible.map(p => p.clone().project(fc.camera).toArray()), side: fc.side};
      });
      assert(b.report.feedLayout.width > 200 && b.report.feedLayout.height > 110 && b.report.feedLayout.besideGuide);
      assert.equal(b.report.feedLayout.background, 'rgba(0, 0, 0, 0)', 'An opaque DOM ancestor would conceal the real GPU feed.');
      b.report.feedLayout.framed.forEach(p => assert(p.every(Number.isFinite) && Math.abs(p[0]) < 1 && Math.abs(p[1]) < 1, 'Actual fork/load outline must fit inside the isometric frame.'));
      await key('KeyC'); assert.equal((await feed()).targetAllocated, false); assert.deepEqual(await view(), b.report.views[0], 'C must not move the driving or head camera.');
      await key('KeyC'); await b.until(async () => (await feed()).targetAllocated, 'C did not restore the auxiliary camera.'); assert.deepEqual(await view(), b.report.views[0]);
      await click('context.editor.vehicleDriving.forkCameraButton'); assert.equal((await feed()).targetAllocated, false);
      await click('context.editor.vehicleDriving.forkCameraButton'); await b.until(async () => (await feed()).targetAllocated, 'HUD camera toggle did not restore the feed.');
      await click('context.editor.vehicleDriving.docking.sideButton'); assert.equal((await feed()).side, -b.report.feedLayout.side); await b.screenshot('docking-isometric-opposite-side');
      await click('context.editor.vehicleDriving.viewButton'); b.report.views.push(await view()); assert.equal(b.report.views[1].index, 1);
      await click('context.editor.vehicleDriving.viewButton'); assert.equal((await view()).index, 0);
      await b.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
      await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      b.report.mobile = await b.call(() => {
        const d = context.editor.vehicleDriving.docking, a = d.element.getBoundingClientRect(), f = d.feedViewport.getBoundingClientRect();
        return {width: innerWidth, left: a.left, right: a.right, feedWidth: f.width, feedHeight: f.height, target: d.forkCamera.getStats().targetAllocated};
      });
      assert(b.report.mobile.left >= 0 && b.report.mobile.right <= b.report.mobile.width && b.report.mobile.feedWidth > 100 && b.report.mobile.target);
      await b.screenshot('docking-mobile-camera'); await b.send('Emulation.clearDeviceMetricsOverride');
      await click('context.editor.vehicleDriving.dockingButton'); assert.equal(await b.evaluate('context.editor.vehicleDriving.docking.element.hidden'), true);
      assert.equal((await feed()).targetAllocated, false, 'Hiding the guide releases the auxiliary GPU target.');
      await click('context.editor.vehicleDriving.dockingButton'); assert.equal(await b.evaluate('context.editor.vehicleDriving.docking.element.hidden'), false);
      await hud('pickup');
      b.report.loaded = await b.call(() => {const r = context.editor.simulation.records.get(__qaVehicleId), v = r.components.vehicle; return {id: v.entry?.id, units: v.entry?.units, mass: v.entry && context.editor.simulation.productMetadata(v.entry.product).mass, state: context.editor.simulation.vehicleRuntime.getDockingState(r)};});
      assert(b.report.loaded.id); assert.equal(b.report.loaded.units, 24); assert.equal(b.report.loaded.mass, 145);
      await b.screenshot('docking-loaded-forks');
      await hud('release'); assert.equal(await b.evaluate('!!context.editor.simulation.records.get(__qaVehicleId).components.vehicle.entry'), false);
      b.report.delivered = await b.call(() => {const r = context.editor.simulation.records.get(__qaVehicleId), v = r.components.vehicle; return {loads: v.delivered, units: v.deliveredUnits};}); assert.equal(b.report.delivered.loads, 1); assert.equal(b.report.delivered.units, 24);
      await hud('exit'); assert.equal(await b.evaluate('!!context.editor.vehicleDriving.id'), false);
      assert.equal((await feed()).targetAllocated, false); assert.equal(await b.evaluate('!!document.querySelector("[data-vehicle-fork-camera-viewport]")'), false);
      b.report.nativeInputs = await b.evaluate('__qaDockInputs'); assert(b.report.nativeInputs.length >= 6); assert(b.report.nativeInputs.every(event => event.trusted));
      // Exercise the separately published lesson, using its actual parked
      // vehicles and native mount action. This does not modify its document.
      await b.call(() => context.editor.saveProject());
      await b.navigate('/?scene=forklift-training');
      await b.until(() => b.evaluate('context.editor.currentProject?.publicSceneId==="forklift-training"&&!context.roomTransition&&!context.editor.loadingProject'), 'The forklift lesson was not publicly accessible.', 180000);
      b.report.training = await b.call(() => {
        const e = context.editor, records = [...e.simulation.records.values()];
        window.__qaTrainingVehicles = records.filter(r => r.components.vehicle).map(r => r.id);
        return {scene: e.currentProject.publicSceneId, variants: __qaTrainingVehicles.map(id => e.simulation.records.get(id).components.vehicle.config.variant),
          pallets: [...e.simulation.products.values()].length, conveyors: records.filter(r => r.components.conveyor).length};
      });
      assert.equal(b.report.training.variants.length, 11); assert.equal(b.report.training.pallets, 22); assert.equal(b.report.training.conveyors, 22);
      await b.screenshot('forklift-training-warehouse');
      b.report.training.cameras = [];
      for (let index = 0; index < b.report.training.variants.length; index++) {
        await b.call(async i => {
          const r = context.editor.simulation.records.get(__qaTrainingVehicles[i]); context.cameraRig.position.copy(r.object.position); context.cameraRig.position.x += 2;
          context.cameraRig.quaternion.set(0, 0, 0, 1); context.camera.position.set(0, 1.6, 0); context.camera.rotation.set(0, -Math.PI / 2, 0); context.cameraRig.updateWorldMatrix(true, true); context.resetCollisionPose?.();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, index);
        await key('KeyF'); await b.until(() => b.call(i => context.editor.vehicleDriving.id === __qaTrainingVehicles[i], index), 'Cannot mount training variant ' + index);
        await b.until(async () => (await feed()).frames > 0 && (await feed()).targetAllocated, 'No auxiliary image in training variant ' + index);
        const stats = await feed(); assert.equal(stats.failures, 0); b.report.training.cameras.push({variant: b.report.training.variants[index], stats});
        if (index === 0) await b.screenshot('forklift-training-electric-isometric');
        await hud('exit'); assert.equal((await feed()).targetAllocated, false);
      }
      assert.equal(await b.evaluate('context.renderer.getContext().getError()'), 0);
      assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.apiFailures, []); assert.deepEqual(b.report.consoleErrors, []);
      return b.report;
    });
    fs.writeFileSync(__layout.map(path.join(OUTPUT, 'vehicle-docking-browser.json')), JSON.stringify(report, null, 2)); assert.deepEqual(fixture.errors, []);
    console.log('PASS real isometric GPU mirror, unchanged driving camera, bounded/released resources, trusted controls, exact pickup/release and all eleven public training variants in compiled Chrome.');
  } finally {await fixture.close();}
}
if (require.main === module) run().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {run};
