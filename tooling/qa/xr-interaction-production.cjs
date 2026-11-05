'use strict';
// Immutable public bundle in real Chrome/WebGL. Only XR hardware poses/session
// are adapted: this is integration/visual QA, never a physical Quest result.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createHash, randomBytes} = require('node:crypto');
const {startFixture, withBrowser, request} = require('./workspace-production.cjs');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(ROOT, 'data/qa-studio/xr-interaction-production');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function run({expectedPublicSha256} = {}) {
  assert.match(expectedPublicSha256 || '', /^[a-f0-9]{64}$/);
  const bundle = fs.readFileSync(path.join(ROOT, 'artifacts/public-viewer/viewer.js'));
  assert.equal(hash(bundle), expectedPublicSha256);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/public-viewer/publication.json'))).bundleSha256, expectedPublicSha256);
  fs.mkdirSync(OUT, {recursive: true}); fs.mkdirSync(path.join(ROOT, 'data/qa-studio/workspace-production'), {recursive: true});
  const report = {startedAt: new Date().toISOString(), publicSha256: expectedPublicSha256, physicalQuestTest: false,
    hardwareAdapter: 'XRInputSource/gamepad and XRFrame poses', syntheticUIProbe: true, temporaryDataOnly: true,
    exceptions: [], consoleErrors: [], failedRequests: [], responses: [], screenshots: []};
  const fixture = await startFixture('Disposable-XR-' + randomBytes(16).toString('hex'), {voice: {enabled: false, key: ''}});
  try {
    const served = await request(fixture.origin, '/viewer.js'); assert.equal(served.status, 200); assert.equal(served.sha256, expectedPublicSha256);
    await withBrowser(fixture, report, async b => {
      const shot = async name => {const value = await b.send('Page.captureScreenshot', {format: 'png'}), file = path.join(OUT, name + '.png'); fs.writeFileSync(file, Buffer.from(value.data, 'base64')); report.screenshots.push(file);};
      await b.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 800, deviceScaleFactor: 1, mobile: false});
      await b.send('Page.navigate', {url: fixture.origin + '/#demostracion'});
      await b.until(() => b.call(() => !!document.querySelector('.scene-open[data-scene-id="vr-robot-dispatch"]')), 'Public scenario card did not appear.', 30000);
      await b.call(() => document.querySelector('.scene-open[data-scene-id="vr-robot-dispatch"]').click());
      await b.until(() => b.evaluate('!!window.smartTwinViewer?.context?.demo'), 'Public demonstration did not start.', 120000);
      report.pointer = await b.call(() => {
        const api = smartTwinViewer, ctx = api.context, THREE = api.THREE;
        ctx.renderer.setAnimationLoop(null); ctx.vrMode = true; ctx.publicDialogOpen = false;
        const input = ctx.input, sources = ['left', 'right'].map(handedness => ({handedness, targetRayMode: 'tracked-pointer',
          profiles: ['oculus-touch-v3', 'generic-trigger-squeeze-thumbstick'], gripSpace: {}, targetRaySpace: {},
          gamepad: {mapping: 'xr-standard', buttons: Array.from({length: 6}, () => ({pressed: false, touched: false, value: 0})), axes: [0, 0, 0, 0]}}));
        const session = {inputSources: sources, visibilityState: 'visible'}, reference = {};
        ctx.renderer.xr.getSession = () => session; ctx.renderer.xr.getReferenceSpace = () => reference;
        ctx.renderer.xr.isPresenting = true; ctx.renderer.xr.getCamera = camera => camera;
        ctx.cameraRig.position.set(0, 0, 0); ctx.cameraRig.quaternion.set(0, 0, 0, 1);
        ctx.camera.position.set(3, 1.65, 7); ctx.camera.lookAt(3, 1.4, 0);
        const matrix = new THREE.Matrix4(), frame = {getPose(space) {const source = sources.find(s => s.gripSpace === space || s.targetRaySpace === space); return source?.pose ? {transform: {matrix: source.pose}} : null;}};
        const pose = (index, point, target) => {
          const controller = input.controllers[index]; controller.visible = true; controller.position.copy(point);
          controller.quaternion.setFromRotationMatrix(matrix.lookAt(point, target, new THREE.Vector3(0, 1, 0)));
          controller.updateMatrix(); sources[index].pose = controller.matrix.toArray();
        };
        input.xrChanged(true);
        pose(0, new THREE.Vector3(2.82, 1.47, 6.4), new THREE.Vector3(3, 1.4, 4));
        pose(1, new THREE.Vector3(3.18, 1.47, 6.4), new THREE.Vector3(3, 1.4, 4));
        input.step(1 / 72, frame);
        const probe = new THREE.Mesh(new THREE.PlaneBufferGeometry(.8, .5), new THREE.MeshBasicMaterial({color: 0x12685e}));
        probe.name = 'QA world dashboard UV probe'; probe.position.set(3, 1.4, 4); ctx.scene.add(probe); ctx.scene.updateMatrixWorld(true);
        let presses = 0, uv = null;
        const state = input.ray.addState('qa-xr-probe', {order: -100000, controller: 'both', colliderMesh: probe, captureSelect: true, consumeSelect: true,
          onSelectStart(hit) {presses++; uv = hit.uv.toArray();}}, true);
        const data = input.ray.controllers.find(d => d.inputSource === sources[1]);
        input.step(1 / 72, frame);
        const hit = data.currentIntersection?.intersection;
        if (!hit || data.currentIntersection.state !== state || !data.pointer?.visible) throw Error('The bundled right ray must reach the exact world dashboard surface.');
        const cursorError = data.pointer.getWorldPosition(new THREE.Vector3()).distanceTo(hit.point);
        input.ray.onSelectStart({target: input.controllers[1]}); input.ray.onSelectEnd({target: input.controllers[1]});
        const visuals = input.controllers.map(controller => ({mode: controller.userData.xrHandVisualMode, visible: controller.userData.gripObject?.xrInputVisual?.root.visible,
          fingers: (controller.userData.gripObject?.xrInputVisual?.fingers.length || 0) + Number(!!controller.userData.gripObject?.xrInputVisual?.thumb)}));
        const before = data.grip.xrInputVisual.fingers.map(f => f.map(j => j.rotation.x));
        sources[1].gamepad.buttons[0] = {pressed: true, touched: true, value: 1}; sources[1].gamepad.buttons[1] = {pressed: true, touched: true, value: 1};
        input.step(1 / 72, frame);
        const after = data.grip.xrInputVisual.fingers.map(f => f.map(j => j.rotation.x));
        sources[1].gamepad.buttons[0] = {pressed: false, value: 0}; sources[1].gamepad.buttons[1] = {pressed: false, value: 0};
        input.controllers[1].userData.xrRaySuppressed = true; input.step(1 / 72, frame);
        const heldHandPointerHidden = !data.pointer.visible;
        delete input.controllers[1].userData.xrRaySuppressed; input.step(1 / 72, frame);
        input.controllers[1].visible = false; const savedPose = sources[1].pose; sources[1].pose = null; input.step(1 / 72, frame);
        const lostTrackingCancelled = !data.pointer.visible && !data.currentIntersection && !data.grip.visible;
        sources[1].pose = savedPose; input.controllers[1].visible = true; input.step(1 / 72, frame);
        ctx.renderer.render(ctx.scene, ctx.camera);
        window.xrQA = {ctx, input, sources, session, frame, pose, THREE, probe};
        return {presses, uv, cursorError, beamLength: data.lineBasic.scale.z, distance: hit.distance, visuals,
          fingersAnimated: JSON.stringify(before) !== JSON.stringify(after), heldHandPointerHidden, lostTrackingCancelled};
      });
      assert.equal(report.pointer.presses, 1); assert(report.pointer.uv.every(v => Math.abs(v - .5) < .002));
      assert(report.pointer.cursorError < .004); assert(report.pointer.beamLength > 2);
      assert(report.pointer.visuals.every(v => v.visible && v.mode === 'controller-animated' && v.fingers === 5));
      assert(report.pointer.fingersAnimated); assert(report.pointer.heldHandPointerHidden); assert(report.pointer.lostTrackingCancelled); await shot('controllers-and-exact-hit');
      report.teleport = await b.call(() => {
        const {ctx, input, sources, session, frame, pose, THREE, probe} = xrQA;
        input.ray.deactivateState('qa-xr-probe'); ctx.scene.remove(probe); probe.geometry.dispose(); probe.material.dispose();
        const before = ctx.cameraRig.position.clone(), head = ctx.camera.position.clone(), destination = new THREE.Vector3(3, 0, 5);
        pose(1, new THREE.Vector3(3.3, 1.35, 6.6), destination); input.step(1 / 72, frame);
        sources[1].gamepad.axes[3] = -1; input.step(1 / 72, frame);
        const aiming = !!ctx.teleport.aimController, valid = ctx.teleport.hit === true, visible = ctx.teleport.teleportEntity.children.some(c => c.visible);
        sources[1].gamepad.axes[3] = 0; input.step(1 / 72, frame);
        const moved = ctx.cameraRig.position.distanceTo(before), headUnchanged = ctx.camera.position.equals(head);
        // A menu cancels an in-progress arc rather than confirming on release.
        sources[1].gamepad.axes[3] = -1; input.step(1 / 72, frame); ctx.studioMenuOpen = true; input.step(1 / 72, frame);
        const menuCancelled = !ctx.teleport.aimController;
        sources[1].gamepad.axes[3] = 0; ctx.studioMenuOpen = false; input.step(1 / 72, frame);
        session.inputSources = []; input.step(1 / 72, frame);
        const disconnected = input.controllers.every(c => !c.userData.gripObject.visible);
        return {aiming, valid, visible, moved, headUnchanged, menuCancelled, disconnected};
      });
      assert(report.teleport.aiming && report.teleport.valid && report.teleport.visible);
      assert(report.teleport.moved > .1); assert(report.teleport.headUnchanged); assert(report.teleport.menuCancelled && report.teleport.disconnected);
      assert.deepEqual(report.exceptions, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.failedRequests, []); report.passed = true;
    });
  } finally {report.serverErrors = fixture.errors; await fixture.close(); fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');}
  return report;
}
module.exports = {run};
if (require.main === module) run({expectedPublicSha256: process.env.ST_REVIEWED_PUBLIC_SHA256})
  .then(r => console.log(JSON.stringify({passed: r.passed, output: OUT}))).catch(error => {console.error(error); process.exitCode = 1;});
