const __layout = require("../../../tooling/layout.cjs");
'use strict';
// Run only after the reviewed public artifact exists. This server cannot serve
// the source checkout, private workspace, API or any other example snapshot.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), https = require('node:https');
const {createHash} = require('node:crypto');
const ROOT = __layout.map(path.resolve(__layout.oldDir("apps/public-viewer/tests/browser.cjs"), '../../..')), OUTPUT = __layout.map(path.join(ROOT, 'data/qa-studio'));
const {withBrowser} = require(__layout.map(path.join(ROOT, "tooling/qa/qa-public-publication-browser.js")));
const {verifyPublic} = require(path.join(ROOT, 'tooling/deploy/verify-public.cjs'));
const arg = name => {const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1];};
const digest = value => createHash('sha256').update(value).digest('hex');
async function clickVisible(browser, selector) {
  const point = await browser.call(selector => {
    const element = document.querySelector(selector); if (!element) throw Error('Missing control: ' + selector);
    element.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
    const rect = element.getBoundingClientRect();
    if (element.disabled || rect.width < 1 || rect.height < 1) throw Error('Unavailable control: ' + selector);
    return {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2};
  }, selector);
  await browser.send('Input.dispatchMouseEvent', {type:'mousePressed', button:'left', clickCount:1, ...point});
  await browser.send('Input.dispatchMouseEvent', {type:'mouseReleased', button:'left', clickCount:1, ...point});
}
function probe(origin, route, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = https.request(origin + route, {method, rejectUnauthorized:false}, response => {
      let bytes = 0; response.on('data', chunk => {bytes += chunk.length;}); response.on('end', () => resolve({method, route, status:response.statusCode, bytes}));
    }); request.on('error', reject); request.end();
  });
}
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
  const verified = verifyPublic({root:ROOT});
  assert.equal(fs.realpathSync(artifact), verified.directory, 'Only the exact verified public artifact may be served.');
  fs.mkdirSync(OUTPUT, {recursive: true});
  const fixture = await staticServer(artifact), report = {bundle: expected, artifact: __layout.map(path.resolve(artifact)), physicalHeadsetTested: false,
    publication:{files:verified.files, scenes:verified.manifest.scenes, bytes:verified.bytes}, sessions: []};
  try {
    report.privateProbes = await Promise.all(['/api/auth/me','/editor','/data/private.sqlite','/apps/workspace/index.html'].map(route => probe(fixture.origin, route)));
    report.privateProbes.push(await probe(fixture.origin, '/api/projects', 'POST'));
    assert(report.privateProbes.every(value => value.status >= 400 && value.bytes === 0), 'The static public site must expose neither private data nor writable API routes.');
    await withBrowser(fixture.origin, async b => {
      report.sessions.push(b.report);
      await b.send('Page.navigate', {url: fixture.origin + '/webxr-simulator/'});
      await b.until(() => b.evaluate('!!window.smartTwinGallery&&!document.getElementById("welcome").hidden&&document.getElementById("scene-grid").getAttribute("aria-busy")==="false"'), 'The welcome screen did not appear.');
      report.welcome=await b.call(()=>({screen:smartTwinGallery.getStats().screen,canvas:document.querySelectorAll('#viewer canvas').length,galleryHidden:document.getElementById('gallery').hidden,loadingHidden:document.getElementById('loading').hidden,title:document.getElementById('welcome-title').textContent}));
      report.welcome.entries = await b.call(() => Array.from(document.querySelectorAll('.welcome-entry')).map(element => ({id:element.id, label:element.querySelector('strong')?.textContent,
        icon:!!element.querySelector('svg'), width:element.getBoundingClientRect().width, height:element.getBoundingClientRect().height})));
      assert.equal(report.welcome.screen,'welcome');assert.equal(report.welcome.canvas,0);assert.equal(report.welcome.galleryHidden,true);assert.equal(report.welcome.loadingHidden,true);assert(report.welcome.title.includes('SMART-TWIN'));
      assert.deepEqual(report.welcome.entries.map(value => value.id), ['explore-demo','explore-scenes','editor-access']);
      assert(report.welcome.entries.every(value => value.icon && value.width >= 44 && value.height >= 44), 'All three entry choices have a visible icon and usable hit area.');
      assert(!fixture.requests.some(value=>/projects\/.*\.json$/.test(value.path)),'The welcome screen must not load a 3D scene.');await b.screenshot('public-welcome-desktop');
      for(const width of [390,320]){await b.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await b.until(()=>b.evaluate('innerWidth==='+width),'Welcome mobile dimensions did not apply.');assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'),false);assert(await b.evaluate('(()=>{const r=document.getElementById("explore-demo").getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight;})()'),'The public demo action must be visible on mobile.');await b.screenshot('public-welcome-mobile-'+width);}
      await b.send('Emulation.clearDeviceMetricsOverride'); await clickVisible(b, '#editor-access');
      assert(await b.evaluate('document.getElementById("workspace-access").open'), 'Editor access requires a private workspace; the public site explains how to sign in.');
      assert.equal(await b.evaluate('document.querySelectorAll("#viewer canvas").length'), 0);
      await clickVisible(b, '#workspace-access button');
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
      await b.call(() => document.getElementById('home-link').click());
      await b.until(() => b.evaluate('smartTwinGallery.getStats().screen==="welcome"'), 'Home did not return to the entry choices.');
      await clickVisible(b, '#explore-demo');
      await b.until(async () => {if (b.report.exceptions.length) throw new Error(b.report.exceptions[0]); const value = await b.evaluate('({ready:!!window.smartTwinViewer,failed:document.querySelector("#loading.failed")?.innerText})'); if (value.failed) throw new Error(value.failed); return value.ready;}, 'Public app did not initialize.');
      const initial = await b.call(async () => {
        const api = smartTwinViewer, bytes = await fetch('viewer.js').then(value => value.arrayBuffer()), hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
        return {hash, stats: api.getStats(), editor: !!api.context.editor, studio: !!api.context.studio, canvas: {width: api.context.renderer.domElement.width, height: api.context.renderer.domElement.height}, login: document.getElementById('workspace-link').href, title: document.title};
      });
      assert.equal(initial.hash, expected); assert(!initial.editor && !initial.studio); assert(initial.canvas.width > 300 && initial.canvas.height > 300); report.initial = initial;
      assert(!new URL(await b.evaluate('location.href')).pathname.includes('login'), 'The demo launches anonymously without redirecting to login.');
      await b.until(() => b.evaluate('smartTwinViewer.context.demo.monitors.entries.size===2&&Array.from(smartTwinViewer.context.demo.monitors.entries.values()).every(entry=>entry.model?.live&&entry.model?.analytics)'), 'Both native monitor screens did not build their live telemetry.');
      report.installation = await b.call(() => {
        const api=smartTwinViewer, demo=api.context.demo, records=Array.from(demo.simulation.records.values()), rack=records.find(value=>value.components.palletQueue?.rack);
        return {robots:records.filter(value=>value.components.robot).map(value=>({id:value.id,enabled:value.components.robot.config.enabled,powered:value.components.robot.config.powered})),
          conveyors:records.filter(value=>value.components.conveyor).length, rack:rack?{id:rack.id,slots:rack.components.palletQueue.rack.layout.cells.length,stock:rack.components.palletQueue.queue.length}:null,
          monitors:Array.from(demo.monitors?.entries?.values()||[]).map(entry=>({id:entry.owner.userData.editorId,live:entry.model?.live,machines:entry.model?.records.map(record=>record.id),analytics:!!entry.model?.analytics,draws:demo.monitors.stats.draws}))};
      });
      assert.equal(report.installation.robots.length,2); assert(report.installation.robots.every(value=>value.enabled&&value.powered));
      assert(report.installation.conveyors>=3); assert(report.installation.rack?.slots>=4&&report.installation.rack.stock>0);
      assert.equal(report.installation.monitors.length,2); assert(report.installation.monitors.every(monitor=>monitor.live&&monitor.analytics&&monitor.machines.length>0&&monitor.draws>0),
        'Both real screens must render measured telemetry, not static screen images.');
      for (const robot of report.installation.robots) assert(report.installation.monitors.some(monitor=>monitor.machines.includes(robot.id)), 'Both robots must appear in the live monitor views.');
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
          // A fixture session has no native XRFrame poses. Mark both grips as
          // tracked explicitly; r112 normally does this when applying poses.
          ctx.controllers.forEach(controller => {controller.visible = true;});
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
      const liveBefore = await b.evaluate('smartTwinViewer.getStats().simulation.time');
      await b.until(() => b.evaluate('smartTwinViewer.getStats().simulation.time>' + (liveBefore + .1)), 'The real animation loop must resume the simulation after pause.');
      report.flowClockFixture = await b.call(async () => {
        // SwiftShader may render only a few frames per wall-clock second.
        // After proving real RAF progress, advance the SAME native runtime in
        // fixed steps. Do not fabricate counters, custody or product poses.
        const ctx=smartTwinViewer.context, simulation=ctx.demo.simulation, before=ctx.demo.stats(), start=performance.now();
        let frames=0, peak=simulation.products.size;
        const ready=()=>ctx.demo.stats().robots.every(robot=>robot.completed>=1)&&ctx.demo.stats().belt.packages===1;
        while(!ready()&&frames<90*60) {
          for(let n=0;n<180&&!ready()&&frames<90*60;n++,frames++) {
            ctx.scene.updateMatrixWorld(true);ctx.demo.step(1/60);peak=Math.max(peak,simulation.products.size);
            const fault=Array.from(simulation.records.values()).find(record=>record.components.robot?.fault);
            if(fault)throw Error(fault.id+': '+fault.components.robot.fault);
          }
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        return {fixtureOnly:true,nativeFixedStep:1/60,frames,before,after:ctx.demo.stats(),peak,wallSeconds:(performance.now()-start)/1000};
      });
      assert(report.flowClockFixture.after.robots.length===2&&report.flowClockFixture.after.robots.every(robot=>robot.completed>=1)&&report.flowClockFixture.after.belt.packages===1,
        'Both actual robots must complete a cycle while the pallet reaches the manual collection conveyor: '+JSON.stringify(report.flowClockFixture));
      report.flow = await b.call(() => {
        const s = smartTwinViewer.context.demo.simulation, products = Array.from(s.products.values()), records=Array.from(s.records.values());
        return {stats: smartTwinViewer.getStats(), robots:records.filter(record=>record.components.robot).map(record=>({id:record.id,completed:record.components.robot.completed,fault:record.components.robot.fault})),
          sources:records.filter(record=>record.components.source).map(record=>({id:record.id,generated:record.components.source.generated,limit:record.components.source.config.totalLimit})),
          products: products.map(product => ({metadata: s.productMetadata(product), id: product.id, pockets: !!s.vehicleRuntime.productPockets(product)}))};
      });
      assert(report.flow.robots.every(robot=>robot.completed>=1&&!robot.fault));
      assert(report.flow.sources.every(source=>source.limit>0&&source.generated<=source.limit)); assert(report.flow.products.length<=20);
      assert(report.flow.products.some(value => value.metadata.units === 4 && value.metadata.mass === 33 && value.pockets));
      await b.screenshot('public-viewer-two-robots-rack-monitor');
      // A reviewable capture of the exact live installation, independent from
      // its runtime walk spawn. Restore every pose/visibility immediately.
      report.preview = await b.call(() => {
        const {context:ctx,document:doc,THREE:T}=smartTwinViewer, camera=ctx.camera,
          saved={position:camera.position.clone(),quaternion:camera.quaternion.clone(),fov:camera.fov}, hidden=[];
        try {
          camera.position.set(-7.4,4.6,7.8);camera.lookAt(3,1,-2.8);camera.updateProjectionMatrix();ctx.scene.updateMatrixWorld(true);
          ctx.renderer.render(ctx.scene,camera);
          const overview=ctx.renderer.domElement.toDataURL('image/png');
          for(const entry of doc.additions.values()) if (/CEDI.*(?:pared|cubierta|viga|luminaria)/i.test(entry.object.name)||/guía de la práctica/i.test(entry.object.name)) {
            hidden.push({object:entry.object,visible:entry.object.visible});entry.object.visible=false;
          }
          camera.fov=46;camera.position.set(-13,11,17);camera.lookAt(2,1,-3);camera.updateProjectionMatrix();ctx.scene.updateMatrixWorld(true);
          ctx.renderer.render(ctx.scene,camera);
          return {overview,thumbnail:ctx.renderer.domElement.toDataURL('image/png'),source:'exact packaged public scene, temporary presentation camera and cutaway only'};
        } finally {
          hidden.forEach(value=>{value.object.visible=value.visible;});camera.position.copy(saved.position);camera.quaternion.copy(saved.quaternion);camera.fov=saved.fov;camera.updateProjectionMatrix();
          ctx.scene.updateMatrixWorld(true);ctx.renderer.render(ctx.scene,camera);
        }
      });
      for(const name of ['overview','thumbnail']) {
        const file=path.join(OUTPUT,'public-demo-'+name+'.png');fs.writeFileSync(file,Buffer.from(report.preview[name].split(',')[1],'base64'));report.preview[name]=file;
      }
      report.vehicleApproachFixture = await b.call(async () => {
        const ctx=smartTwinViewer.context,T=smartTwinViewer.THREE,simulation=ctx.demo.simulation,
          record=Array.from(simulation.records.values()).find(record=>record.components.vehicle),v=record.components.vehicle,
          belt=simulation.records.get(v.config.sourceId),api=simulation.vehicleRuntime;
        for(let frame=0;frame<30*60&&belt.components.conveyor.actualSpeed;frame++) {ctx.scene.updateMatrixWorld(true);ctx.demo.step(1/60);if(frame%180===0)await new Promise(resolve=>setTimeout(resolve,0));}
        const product=belt.components.conveyor.packages[0]?.product,direction=new T.Vector3(0,0,1).applyQuaternion(record.object.quaternion),
          yaw=Math.atan2(direction.x,direction.z),dock=product&&api.pickupDock(record,{yaw,targetId:belt.id},product);
        if(!dock)throw Error('The native forklift source has no collectable pallet.');
        const before=record.object.position.toArray();
        if(!api.applyPose(record,{...v.pose,lift:dock.toolY-v.originWorld.y-v.config.forkBaseHeight},true))throw Error('Native lift adjustment failed.');
        api.command(record,'parkingBrake',false);
        let frames=0;
        while(dock.position.clone().sub(record.object.position).dot(direction)>.015&&frames<40*60) {
          api.setInput(record,{throttle:.08});ctx.scene.updateMatrixWorld(true);simulation.execute(1/60);frames++;
          if(frames%180===0)await new Promise(resolve=>setTimeout(resolve,0));
        }
        for(let frame=0;frame<90;frame++){api.setInput(record,{brake:1});ctx.scene.updateMatrixWorld(true);simulation.execute(1/60);}
        api.setInput(record,{});api.command(record,'parkingBrake',true);
        // Place only the observer near the cab, then use the visible UI to
        // mount. Vehicle travel above used native acceleration/collisions.
        ctx.input.reset();ctx.desktopLook.unlock();ctx.cameraRig.position.set(0,0,0);ctx.cameraRig.quaternion.set(0,0,0,1);
        ctx.camera.position.copy(record.object.position).add(new T.Vector3(1.5,1.65,1.5));ctx.camera.lookAt(record.object.position);ctx.scene.updateMatrixWorld(true);
        return {fixtureOnly:true,frames,before,after:record.object.position.toArray(),dockingReady:api.getDockingState(record).ready,warning:v.warning};
      });
      assert(report.vehicleApproachFixture.dockingReady,'The native forklift must physically reach its pickup dock: '+JSON.stringify(report.vehicleApproachFixture));
      await clickVisible(b,'#viewer-menu-toggle');await clickVisible(b,'#drive');
      await b.until(() => b.evaluate('!!smartTwinViewer.context.drivingVehicle'), 'The public drive action did not mount the real truck.');
      await b.until(() => b.evaluate('smartTwinViewer.context.demo.driving.docking.forkCamera.hasCurrentFrame()&&!!smartTwinViewer.context.demo.driving.docking.forkCamera.target'), 'The real front camera did not initialize near the native pallet.');
      report.cab = await b.call(() => ({stats: smartTwinViewer.getStats(), front: smartTwinViewer.context.demo.driving.docking.forkCamera.getStats(), hud: !document.querySelector('.vehicle-driving-hud').hidden}));
      assert(report.cab.hud&&report.cab.front.targetAllocated&&!report.cab.front.mirrorTargetAllocated);
      await b.screenshot('public-viewer-driving-front');
      await clickVisible(b,'[data-vehicle-rear-view-toggle]');
      await b.until(()=>b.evaluate('smartTwinViewer.context.demo.driving.docking.forkCamera.selectedFeed==="mirror"&&smartTwinViewer.context.demo.driving.docking.forkCamera.hasCurrentFrame()'),'The real rear camera did not initialize after its visible toggle.');
      report.cab.mirror=await b.call(()=>smartTwinViewer.context.demo.driving.docking.forkCamera.getStats());
      assert(report.cab.mirror.mirrorTargetAllocated&&!report.cab.mirror.targetAllocated,'Only the selected camera allocates a render target.');
      await b.screenshot('public-viewer-driving-mirror');
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
      assert(!report.resources.some(value => /\/api\//.test(new URL(value.url).pathname)), 'Anonymous demo interactions must not request private APIs.');
      assert(!fixture.requests.some(value => value.status<400 && /\.gl(?:b|tf)$|\.(?:mp3|ogg|wav)$/.test(value.path)), 'The single example must use its authored geometry without additional model or audio downloads.');
      assert.equal(fixture.requests.filter(value => /projects\/.*\.json$/.test(value.path)).length, 1, 'Exactly one selected project snapshot must be fetched.');
      report.final = await b.call(() => {const ctx = smartTwinViewer.context; return {stats: smartTwinViewer.getStats(), gl: ctx.renderer.getContext().getError()};});
      assert.equal(report.final.gl, 0); assert.equal(report.final.stats.frameCount, report.final.stats.primaryRenders);
      report.cleanup = await b.call(async () => {const disposedViewer = smartTwinViewer, monitors=disposedViewer.context.demo.monitors; await disposedViewer.dispose(); return {canvas: document.querySelectorAll('#viewer canvas').length, touch: document.querySelectorAll('.xr-browser-touch').length, driving: !!disposedViewer.context.vehicleDriving, targets: disposedViewer.context.performanceRenderTargets.size, root: !!disposedViewer.document.root.parent, monitors:monitors.entries.size};});
      assert.deepEqual(report.cleanup, {canvas: 0, touch: 0, driving: false, targets: 0, root: false, monitors:0});
      assert.equal(await b.evaluate('window.smartTwinViewer'),null,'The disposed viewer facade must be cleared.');
      await b.call(() => document.getElementById('back-scenes').click());
      await b.until(() => b.evaluate('!document.getElementById("gallery").hidden&&!window.smartTwinViewer'), 'Returning to the catalogue failed.');
      assert.equal(await b.evaluate('document.querySelectorAll("#viewer canvas").length'),0);
      await b.call(() => document.querySelector('.scene-open[data-scene-id="vr-robot-dispatch"]').click());
      await b.until(() => b.evaluate('!!window.smartTwinViewer&&smartTwinViewer.getStats().frameCount>3'), 'The selected scenario could not reopen after returning to the catalogue.');
      report.gallery.reentry = await b.call(() => ({canvas:document.querySelectorAll('#viewer canvas').length,sceneId:smartTwinViewer.getStats().sceneId,galleryHidden:document.getElementById('gallery').hidden}));
      assert.equal(report.gallery.reentry.canvas,1);assert.equal(report.gallery.reentry.galleryHidden,true);await b.evaluate('smartTwinViewer.dispose()');
      await b.call(()=>document.getElementById('home-link').click());await b.until(()=>b.evaluate('smartTwinGallery.getStats().screen==="welcome"&&!window.smartTwinViewer'),'Home must restore welcome.');assert.equal(await b.evaluate('document.querySelectorAll("#viewer canvas").length'),0);
      assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.consoleErrors, []); assert.deepEqual(b.report.apiFailures, []); assert.deepEqual(b.report.writes, []);
    });
    report.requests = fixture.requests; report.passed = true;
  } catch (error) {report.failure = error.stack; throw error;}
  finally {report.requests = fixture.requests; fs.writeFileSync(__layout.map(path.join(OUTPUT, 'public-viewer-browser.json')), JSON.stringify(report, null, 2)); await fixture.close();}
  console.log(JSON.stringify({passed: true, bundle: expected, report: __layout.map(path.join(OUTPUT, 'public-viewer-browser.json'))}));
}
module.exports = {staticServer};
if (require.main === module) run().catch(error => {console.error(error); process.exitCode = 1;});
