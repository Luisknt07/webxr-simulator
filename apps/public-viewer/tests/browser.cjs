const __layout = require("../../../tooling/layout.cjs");
'use strict';
// Run only after the reviewed public artifact exists. This server cannot serve
// the source checkout, private workspace, API or any other example snapshot.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), https = require('node:https');
const {createHash} = require('node:crypto');
const ROOT = __layout.map(path.resolve(__layout.oldDir("apps/public-viewer/tests/browser.cjs"), '../../..')), OUTPUT = __layout.map(path.join(ROOT, 'data/qa-studio'));
const {withBrowser} = require(__layout.map(path.join(ROOT, "tooling/qa/qa-public-publication-browser.js")));
const arg = name => {const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1];};
const digest = value => createHash('sha256').update(value).digest('hex');
async function staticServer(artifact) {
  const base = fs.realpathSync(artifact), requests = [], pem = fs.readFileSync(__layout.map(path.join(ROOT, 'node_modules/webpack-dev-server/ssl/server.pem')));
  const mime = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'};
  const server = https.createServer({key: pem, cert: pem}, (request, response) => {
    const entry = {method: request.method, path: new URL(request.url, 'https://localhost').pathname}; requests.push(entry);
    const fail = code => {entry.status = code; response.writeHead(code); response.end();};
    if (!['GET', 'HEAD'].includes(request.method)) return fail(405);
    let relative; try {relative = decodeURIComponent(entry.path).replace(/^\/webxr-simulator\//, '').replace(/^\/+/, '') || 'index.html';} catch (_) {return fail(400);}
    const file = path.resolve(base, relative);
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(404);
    entry.status = 200; const data = fs.readFileSync(file); response.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'}); response.end(request.method === 'HEAD' ? undefined : data);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {origin: 'https://localhost:' + server.address().port, requests, close: () => new Promise(resolve => server.close(resolve))};
}
async function run() {
  const artifact = arg('--artifact'), expected = arg('--expected-bundle-sha256');
  assert(artifact, 'Pass --artifact for the exact packaged public site.'); assert(expected && /^[a-f0-9]{64}$/.test(expected), 'Pass the reviewed --expected-bundle-sha256.');
  assert.equal(digest(fs.readFileSync(__layout.map(path.join(artifact, 'viewer.js')))), expected, 'Wrong public viewer bundle.');
  fs.mkdirSync(OUTPUT, {recursive: true});
  const fixture = await staticServer(artifact), report = {bundle: expected, artifact: __layout.map(path.resolve(artifact)), physicalHeadsetTested: false, sessions: []};
  try {
    await withBrowser(fixture.origin, async b => {
      await b.send('Page.navigate', {url: fixture.origin + '/webxr-simulator/'});
      await b.until(() => b.evaluate('!!window.smartTwinGallery&&!document.getElementById("welcome").hidden&&document.getElementById("scene-grid").getAttribute("aria-busy")==="false"'), 'The welcome screen did not appear.');
      report.welcome=await b.call(()=>({screen:smartTwinGallery.getStats().screen,canvas:document.querySelectorAll('#viewer canvas').length,galleryHidden:document.getElementById('gallery').hidden,loadingHidden:document.getElementById('loading').hidden,title:document.getElementById('welcome-title').textContent}));
      assert.equal(report.welcome.screen,'welcome');assert.equal(report.welcome.canvas,0);assert.equal(report.welcome.galleryHidden,true);assert.equal(report.welcome.loadingHidden,true);assert(report.welcome.title.includes('SMART-TWIN'));
      assert(!fixture.requests.some(value=>/projects\/.*\.json$/.test(value.path)),'The welcome screen must not load a 3D scene.');await b.screenshot('public-welcome-desktop');
      for(const width of [390,320]){await b.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await b.until(()=>b.evaluate('innerWidth==='+width),'Welcome mobile dimensions did not apply.');assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'),false);assert(await b.evaluate('(()=>{const r=document.getElementById("explore-scenes").getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight;})()'),'The primary action must be visible on mobile.');await b.screenshot('public-welcome-mobile-'+width);}
      await b.send('Emulation.clearDeviceMetricsOverride');await b.call(()=>document.getElementById('explore-scenes').click());
      await b.until(()=>b.evaluate('!document.getElementById("gallery").hidden&&smartTwinGallery.getStats().screen==="gallery"'),'Explore must open the catalogue.');
      await b.evaluate('history.back()');await b.until(()=>b.evaluate('smartTwinGallery.getStats().screen==="welcome"'),'Browser Back must return to welcome.');await b.evaluate('history.forward()');await b.until(()=>b.evaluate('smartTwinGallery.getStats().screen==="gallery"'),'Browser Forward must restore the catalogue without 3D.');
      report.gallery = await b.call(() => ({state: smartTwinGallery.getStats(), canvas: document.querySelectorAll('#viewer canvas').length, demo: !!window.smartTwinViewer, cards: document.querySelectorAll('.scene-card').length, title: document.getElementById('gallery-title').textContent, access:document.getElementById('gallery-access').textContent, open:document.querySelector('.scene-open').textContent, description:document.querySelector('.gallery-description').textContent}));
      assert.equal(report.gallery.canvas, 0); assert.equal(report.gallery.demo, false); assert.deepEqual(report.gallery.state.sceneIds, ['vr-robot-dispatch']); assert.equal(report.gallery.cards, 1);
      assert.equal(report.gallery.access,'Iniciar sesión');assert.equal(report.gallery.open,'Explorar escenario');assert(report.gallery.description.length>20);
      await b.until(()=>b.evaluate('Array.from(document.querySelectorAll(".scene-card img")).every(image=>image.complete&&image.naturalWidth>0)'),'The real scene thumbnail did not load.');
      assert.equal(await b.evaluate('document.querySelectorAll(".scene-card img").length'),1);
      assert(!fixture.requests.some(value => /projects\/.*\.json$/.test(value.path)), 'Opening the catalogue must not download or simulate a scene.');
      await b.screenshot('public-gallery-desktop');
      await b.send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
      await b.until(() => b.evaluate('innerWidth===390'), 'Gallery mobile dimensions did not apply.');
      report.gallery.mobile = await b.call(() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,visible:!document.getElementById('gallery').hidden}));
      assert.equal(report.gallery.mobile.width,report.gallery.mobile.scrollWidth); await b.screenshot('public-gallery-mobile');
      await b.send('Emulation.clearDeviceMetricsOverride');
      await b.call(() => document.querySelector('.scene-open[data-scene-id="vr-robot-dispatch"]').click());
      await b.until(async () => {if (b.report.exceptions.length) throw new Error(b.report.exceptions[0]); const value = await b.evaluate('({ready:!!window.smartTwinViewer,failed:document.querySelector("#loading.failed")?.innerText})'); if (value.failed) throw new Error(value.failed); return value.ready;}, 'Public app did not initialize.');
      const initial = await b.call(async () => {
        const api = smartTwinViewer, bytes = await fetch('viewer.js').then(value => value.arrayBuffer()), hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
        return {hash, stats: api.getStats(), editor: !!api.context.editor, studio: !!api.context.studio, canvas: {width: api.context.renderer.domElement.width, height: api.context.renderer.domElement.height}, login: document.getElementById('workspace-link').href, title: document.title};
      });
      assert.equal(initial.hash, expected); assert(!initial.editor && !initial.studio); assert(initial.canvas.width > 300 && initial.canvas.height > 300); report.initial = initial;
      if (initial.login.endsWith('#workspace-access')) {
        await b.call(() => document.getElementById('workspace-link').click());
        assert(await b.evaluate('document.getElementById("workspace-access").open'), 'Unconfigured static deployment must explain private access, not navigate to a missing login page.');
        await b.call(() => document.querySelector('#workspace-access button').click());
      }
      await b.screenshot('public-viewer-desktop');
      report.xrInputFixture = await b.call(() => {
        const api = smartTwinViewer, ctx = api.context, xr = ctx.renderer.xr, T = api.THREE, before = {position: ctx.camera.position.toArray(), quaternion: ctx.camera.quaternion.toArray()},
          saved = {session: xr.getSession, camera: xr.getCamera, presenting: xr.isPresenting, mode: ctx.vrMode, rig: ctx.cameraRig.position.clone(), rotation: ctx.cameraRig.quaternion.clone()},
          left = {handedness: 'left', targetRayMode: 'tracked-pointer', gamepad: {mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: []}},
          right = {handedness: 'right', targetRayMode: 'tracked-pointer', gamepad: {mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: []}},
          session = {inputSources: [left, right], visibilityState: 'visible'}, tracked = new T.PerspectiveCamera();
        const beforeControllers = ctx.raycontrol.controllers.length;
        try {
          xr.getSession = () => session; xr.getCamera = () => {tracked.matrixWorld.multiplyMatrices(ctx.cameraRig.matrixWorld, new T.Matrix4().makeTranslation(0, 1.65, 0)); return tracked;}; xr.isPresenting = true; ctx.vrMode = true;
          ctx.cameraRig.position.set(4, 0, 8); ctx.cameraRig.quaternion.set(0, 0, 0, 1); ctx.input.xrChanged(true);
          ctx.input.step(1 / 60); const centered = ctx.cameraRig.position.clone(), mountedControllers = ctx.raycontrol.controllers.length;
          left.gamepad.axes[3] = -.8; ctx.input.step(1 / 60); const moved = ctx.cameraRig.position.distanceTo(centered);
          right.gamepad.axes[2] = .8; ctx.input.step(1 / 60);
          return {fixtureOnly: true, nativeSession: false, moved, beforeControllers, mountedControllers, headUnchanged: before.position.every((value, i) => value === ctx.camera.position.toArray()[i]) && before.quaternion.every((value, i) => value === ctx.camera.quaternion.toArray()[i])};
        } finally {
          ctx.controllers.forEach(controller => controller.dispatchEvent({type: 'disconnected'})); xr.getSession = saved.session; xr.getCamera = saved.camera; xr.isPresenting = saved.presenting; ctx.vrMode = saved.mode;
          ctx.cameraRig.position.copy(saved.rig); ctx.cameraRig.quaternion.copy(saved.rotation); ctx.input.xrChanged(false);
        }
      });
      assert(report.xrInputFixture.headUnchanged); assert(report.xrInputFixture.moved > 0); assert.equal(report.xrInputFixture.mountedControllers - report.xrInputFixture.beforeControllers, 2);
      assert.equal(await b.evaluate('smartTwinViewer.context.raycontrol.controllers.length'), report.xrInputFixture.beforeControllers, 'Disconnected XR fixture controllers must be removed.');
      await b.call(() => document.getElementById('pause').click());
      const paused = await b.evaluate('smartTwinViewer.getStats().simulation.time');
      await b.until(() => b.evaluate('smartTwinViewer.getStats().frameCount > 15'), 'Primary frame loop did not continue.');
      await new Promise(resolve => setTimeout(resolve, 400));
      assert.equal(await b.evaluate('smartTwinViewer.getStats().simulation.time'), paused, 'Pause must freeze the actual simulation.');
      await b.call(() => document.getElementById('pause').click());
      await b.until(() => b.evaluate('smartTwinViewer.getStats().simulation.robot.completed>=1&&smartTwinViewer.getStats().simulation.belt.packages===1'), 'Actual robot failed to deliver the pallet to its conveyor.');
      report.flow = await b.call(() => {
        const s = smartTwinViewer.context.demo.simulation, products = Array.from(s.products.values());
        return {stats: smartTwinViewer.getStats(), products: products.map(product => ({metadata: s.productMetadata(product), id: product.id, pockets: !!s.vehicleRuntime.productPockets(product)}))};
      });
      assert(report.flow.products.some(value => value.metadata.units === 4 && value.metadata.mass === 33 && value.pockets));
      await b.screenshot('public-viewer-robot-pallet');
      await b.call(() => document.getElementById('drive').click());
      await b.until(() => b.evaluate('!!smartTwinViewer.context.drivingVehicle'), 'The public drive action did not mount the real truck.');
      await b.until(() => b.evaluate('!!smartTwinViewer.context.demo.driving.docking.forkCamera.target&&!!smartTwinViewer.context.demo.driving.docking.forkCamera.mirrorTarget'), 'Both real camera feeds did not initialize.');
      report.cab = await b.call(() => ({stats: smartTwinViewer.getStats(), front: smartTwinViewer.context.demo.driving.docking.forkCamera.getStats(), hud: !document.querySelector('.vehicle-driving-hud').hidden}));
      await b.screenshot('public-viewer-driving-front-mirror');
      await b.call(() => {smartTwinViewer.context.demo.driving.unmount(true); document.getElementById('restart').click();});
      await b.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
      await b.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 2});
      await b.until(() => b.evaluate('innerWidth===390&&getComputedStyle(document.querySelector(".xr-browser-touch")).display!=="none"'), 'Mobile navigation did not appear.');
      report.mobile = await b.call(() => ({stats: smartTwinViewer.getStats(), width: innerWidth, scrollWidth: document.documentElement.scrollWidth, pads: document.querySelectorAll('.touch-pad').length}));
      assert.equal(report.mobile.scrollWidth, report.mobile.width); assert.equal(report.mobile.pads, 2);
      await b.screenshot('public-viewer-mobile');
      report.contextLoss = await b.call(() => {const gl = smartTwinViewer.context.renderer.getContext(), extension = gl.getExtension('WEBGL_lose_context'); if (!extension) return {supported: false}; window.__publicRestoreContext = () => extension.restoreContext(); extension.loseContext(); return {supported: true};});
      if (report.contextLoss.supported) {
        await b.until(() => b.evaluate('smartTwinViewer.getStats().contextLost'), 'The context-loss gate did not activate.');
        await b.evaluate('__publicRestoreContext()');
        await b.until(() => b.evaluate('!smartTwinViewer.getStats().contextLost'), 'The renderer did not recover after context restoration.');
        const frames = await b.evaluate('smartTwinViewer.getStats().frameCount');
        await b.until(() => b.evaluate('smartTwinViewer.getStats().frameCount>' + frames), 'No primary frame after context restoration.');
        report.contextLoss.recovered = true;
      }
      report.resources = await b.evaluate('performance.getEntriesByType("resource").map(value=>({url:value.name,bytes:value.transferSize}))');
      assert(report.resources.every(value => new URL(value.url).origin === fixture.origin), 'The app must not request telemetry, remote fonts or other hosts.');
      assert(!fixture.requests.some(value => /^\/api\//.test(value.path) || /\.gl(?:b|tf)$|\.(?:mp3|ogg|wav)$/.test(value.path)), 'The single example must not request APIs or external model/audio assets.');
      assert.equal(fixture.requests.filter(value => /projects\/.*\.json$/.test(value.path)).length, 1, 'Exactly one selected project snapshot must be fetched.');
      report.final = await b.call(() => {const ctx = smartTwinViewer.context; return {stats: smartTwinViewer.getStats(), gl: ctx.renderer.getContext().getError()};});
      assert.equal(report.final.gl, 0); assert.equal(report.final.stats.frameCount, report.final.stats.primaryRenders);
      report.cleanup = await b.call(async () => {const disposedViewer = smartTwinViewer; await disposedViewer.dispose(); return {canvas: document.querySelectorAll('#viewer canvas').length, touch: document.querySelectorAll('.xr-browser-touch').length, driving: !!disposedViewer.context.vehicleDriving, targets: disposedViewer.context.performanceRenderTargets.size, root: !!disposedViewer.document.root.parent};});
      assert.deepEqual(report.cleanup, {canvas: 0, touch: 0, driving: false, targets: 0, root: false});
      assert.equal(await b.evaluate('window.smartTwinViewer'),null,'The disposed viewer facade must be cleared.');
      await b.call(() => document.getElementById('back-scenes').click());
      await b.until(() => b.evaluate('!document.getElementById("gallery").hidden&&!window.smartTwinViewer'), 'Returning to the catalogue failed.');
      assert.equal(await b.evaluate('document.querySelectorAll("#viewer canvas").length'),0);
      await b.call(() => document.querySelector('.scene-open[data-scene-id="vr-robot-dispatch"]').click());
      await b.until(() => b.evaluate('!!window.smartTwinViewer&&smartTwinViewer.getStats().frameCount>3'), 'The selected scenario could not reopen after returning to the catalogue.');
      report.gallery.reentry = await b.call(() => ({canvas:document.querySelectorAll('#viewer canvas').length,sceneId:smartTwinViewer.getStats().sceneId,galleryHidden:document.getElementById('gallery').hidden}));
      assert.equal(report.gallery.reentry.canvas,1);assert.equal(report.gallery.reentry.galleryHidden,true);await b.evaluate('smartTwinViewer.dispose()');
      await b.call(()=>document.getElementById('home-link').click());await b.until(()=>b.evaluate('smartTwinGallery.getStats().screen==="welcome"&&!window.smartTwinViewer'),'Home must restore welcome.');assert.equal(await b.evaluate('document.querySelectorAll("#viewer canvas").length'),0);
      report.sessions.push(b.report);
      assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.consoleErrors, []); assert.deepEqual(b.report.apiFailures, []); assert.deepEqual(b.report.writes, []);
    });
    report.requests = fixture.requests; report.passed = true;
  } catch (error) {report.failure = error.stack; throw error;}
  finally {report.requests = fixture.requests; fs.writeFileSync(__layout.map(path.join(OUTPUT, 'public-viewer-browser.json')), JSON.stringify(report, null, 2)); await fixture.close();}
  console.log(JSON.stringify({passed: true, bundle: expected, report: __layout.map(path.join(OUTPUT, 'public-viewer-browser.json'))}));
}
module.exports = {staticServer};
if (require.main === module) run().catch(error => {console.error(error); process.exitCode = 1;});
