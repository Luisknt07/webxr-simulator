'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const ROOT = path.resolve(__dirname, '../../..'), OUTPUT = path.join(ROOT, 'data/qa-studio');
const {staticServer} = require('../../public-viewer/tests/browser.cjs');
const {withBrowser} = require(path.join(ROOT, 'tooling/qa/qa-public-publication-browser.js'));
const arg = key => {const index = process.argv.indexOf(key); return index < 0 ? null : process.argv[index + 1];};
async function run() {
  const artifact = arg('--artifact'), expected = arg('--expected-bundle-sha256');
  assert(artifact && expected && /^[a-f0-9]{64}$/.test(expected), 'Pass the reviewed core artifact and exact hash.');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(artifact, 'core-empty.js'))).digest('hex'), expected);
  fs.mkdirSync(OUTPUT, {recursive: true}); const fixture = await staticServer(artifact), report = {bundle: expected, physicalHeadsetTested: false};
  try {
    await withBrowser(fixture.origin, async b => {
      await b.send('Page.navigate', {url: fixture.origin + '/webxr-simulator/'});
      await b.until(() => b.evaluate('!!window.smartTwinCore&&smartTwinCore.getStats().frames>3'), 'Core browser did not start.');
      const networkHash = await b.call(async () => {const bytes = await fetch('core-empty.js').then(value => value.arrayBuffer()); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');});
      assert.equal(networkHash, expected); report.networkHash = networkHash;
      report.initial = await b.evaluate('smartTwinCore.getStats()');
      assert.deepEqual(report.initial.core.modules, []); assert.deepEqual(report.initial.core.functions, []);
      assert.equal(report.initial.frames, report.initial.primaryRenders); assert(report.initial.render.calls >= 2);
      report.headPose = await b.call(() => {
        const ctx = smartTwinCore.context, xr = ctx.renderer.xr, T = smartTwinCore.THREE, saved = {session: xr.getSession, camera: xr.getCamera, present: xr.isPresenting}, position = ctx.camera.position.toArray(), quaternion = ctx.camera.quaternion.toArray(),
          source = {handedness: 'left', targetRayMode: 'tracked-pointer', gamepad: {mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: []}}, tracked = new T.PerspectiveCamera(), session = {inputSources: [source], visibilityState: 'visible'};
        try {
          xr.getSession = () => session; xr.isPresenting = true; ctx.vrMode = true;
          xr.getCamera = () => {tracked.matrixWorld.multiplyMatrices(ctx.cameraRig.matrixWorld, new T.Matrix4().makeTranslation(0, 1.65, 0)); return tracked;};
          const from = ctx.cameraRig.position.clone(); ctx.input.xrChanged(true); ctx.input.step(1 / 60); source.gamepad.axes[3] = -.8; ctx.input.step(1 / 60);
          return {fixtureOnly: true, nativeSession: false, moved: ctx.cameraRig.position.distanceTo(from), unchanged: position.every((value, i) => value === ctx.camera.position.toArray()[i]) && quaternion.every((value, i) => value === ctx.camera.quaternion.toArray()[i])};
        } finally {ctx.controllers.forEach(controller => controller.dispatchEvent({type: 'disconnected'})); xr.getSession = saved.session; xr.getCamera = saved.camera; xr.isPresenting = saved.present; ctx.vrMode = false; ctx.input.xrChanged(false);}
      });
      assert(report.headPose.unchanged && report.headPose.moved > 0);
      await b.screenshot('core-empty-desktop');
      await b.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true}); await b.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 2});
      await b.until(() => b.evaluate('getComputedStyle(document.querySelector(".xr-browser-touch")).display!=="none"'), 'Core mobile inputs did not appear.');
      await b.screenshot('core-empty-mobile');
      report.resources = await b.evaluate('performance.getEntriesByType("resource").map(value=>value.name)');
      assert(report.resources.every(value => new URL(value).origin === fixture.origin));
      assert(!fixture.requests.some(value => /api\/|projects\/|modules\/|workspace\/|\.(?:glb|gltf|ogg|mp3|wav|json)$/.test(value.path)), 'Core empty must not request a project, sector, API or industry asset.');
      assert.equal(await b.evaluate('smartTwinCore.context.renderer.getContext().getError()'), 0);
      await b.evaluate('smartTwinCore.dispose()'); assert.equal(await b.evaluate('document.querySelectorAll("canvas,.xr-browser-touch").length'), 0);
      assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.consoleErrors, []); assert.deepEqual(b.report.apiFailures, []); assert.deepEqual(b.report.writes, []); report.session = b.report;
    });
    report.passed = true;
  } catch (error) {report.failure = error.stack; throw error;}
  finally {report.requests = fixture.requests; fs.writeFileSync(path.join(OUTPUT, 'core-empty-browser.json'), JSON.stringify(report, null, 2)); await fixture.close();}
  console.log(JSON.stringify({passed: true, bundle: expected, report: path.join(OUTPUT, 'core-empty-browser.json')}));
}
run().catch(error => {console.error(error); process.exitCode = 1;});
