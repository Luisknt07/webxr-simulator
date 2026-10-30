'use strict';
// Real packaged apps, disposable HTTPS/SQLite fixture, real Chrome mouse input.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {randomBytes, createHash} = require('node:crypto');
const {startFixture, withBrowser, request} = require('./workspace-production.cjs');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(ROOT, 'data/qa-studio/workspace-production');
const hash = file => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');

async function run() {
  fs.mkdirSync(OUT, {recursive: true});
  const report = {startedAt: new Date().toISOString(), bundleSha256: hash('artifacts/public-viewer/viewer.js'), workspaceSha256: hash('artifacts/workspace/bundle.js'), browserMode: 'headless', temporaryDatabaseOnly: true, exceptions: [], consoleErrors: [], failedRequests: [], responses: [], screenshots: []};
  for (const app of ['public-viewer', 'workspace']) assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts', app, 'publication.json'))).bundleSha256, app === 'workspace' ? report.workspaceSha256 : report.bundleSha256, 'Packaging must finish before browser QA.');
  const password = 'Disposable-Entry-' + randomBytes(16).toString('hex'), fixture = await startFixture(password);
  try {
    const publicList = await request(fixture.origin, '/api/public/scenes');
    assert.deepEqual(publicList.json.scenes.map(scene => scene.id), ['vr-robot-dispatch']);
    assert.equal((await request(fixture.origin, '/workspace/bundle.js')).status, 401);
    assert.equal((await request(fixture.origin, '/api/library/scenes')).status, 401);
    assert.equal((await request(fixture.origin, '/data/studio.sqlite')).status, 404);
    report.anonymousAccess = {publicScenes: 1, workspaceBundle: 401, library: 401, database: 404};
    await withBrowser(fixture, report, async b => {
      await b.send('Emulation.setFocusEmulationEnabled', {enabled: true});
      const until = (callback,message,timeout=45000) => b.until(callback,message,timeout);
      const key = async (code, key, windowsVirtualKeyCode) => {
        await b.send('Input.dispatchKeyEvent', {type: 'keyDown', code, key, windowsVirtualKeyCode});
        await b.send('Input.dispatchKeyEvent', {type: 'keyUp', code, key, windowsVirtualKeyCode});
      };
      const click = async (x = 800, y = 500) => {
        await b.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y});
        await b.send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1});
        await b.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1});
      };
      const drag = async (x,y,dx,dy) => {
        const previous=await b.evaluate('smartTwinViewer.context.camera.quaternion.toArray()');
        await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',buttons:0});
        await b.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
        try {
          await until(()=>b.evaluate('!!smartTwinViewer.context.input.drag'),'Real held press was not received.',5000);
          await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+dx,y:y+dy,button:'left',buttons:1});
          await until(()=>b.call(previous=>previous.some((n,i)=>Math.abs(n-smartTwinViewer.context.camera.quaternion.toArray()[i])>1e-8),previous),'Real held movement did not turn the camera.',5000);
        }catch(error){report.dragDiagnostic=await b.evaluate('__entryQA.inputEvents');throw new Error(error.message+' '+JSON.stringify(report.dragDiagnostic));}
        finally {await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+dx,y:y+dy,button:'left',buttons:0,clickCount:1});}
      };
      await b.send('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false});
      await b.send('Page.navigate', {url: fixture.origin + '/#escenarios'});
      await until(() => b.evaluate('!!window.smartTwinGallery && smartTwinGallery.getStats().screen === "gallery"'), 'Public gallery unavailable.');
      await b.call(() => document.querySelector('.scene-open[data-scene-id="vr-robot-dispatch"]').click());
      await until(() => b.evaluate('!!window.smartTwinViewer && smartTwinViewer.getStats().frameCount > 2'), 'Public scene unavailable.');
      report.publicEntry = await b.call(() => {
        const c = smartTwinViewer.context, r = document.getElementById('reticle').getBoundingClientRect();
        return {position: c.camera.getWorldPosition(new smartTwinViewer.THREE.Vector3()).toArray(), reticleCenter: [r.x + r.width / 2, r.y + r.height / 2], viewportCenter: [innerWidth / 2, innerHeight / 2], noTestFooter: !document.querySelector('.lesson-footer,.viewer-scene-caption,[data-stage]'), menuOpen: document.getElementById('viewer-menu').open, conveyors: [...c.demo.simulation.records.values()].filter(v => v.components.conveyor).length, gl: c.renderer.getContext().getError()};
      });
      assert.deepEqual(report.publicEntry.position, [4, 1.65, 8]); assert.deepEqual(report.publicEntry.reticleCenter, report.publicEntry.viewportCenter); assert(report.publicEntry.noTestFooter); assert.equal(report.publicEntry.menuOpen, false); assert.equal(report.publicEntry.conveyors, 2); assert.equal(report.publicEntry.gl, 0);
      console.log('Standard entry: initial walking view and clean UI passed.');
      await b.screenshot('standard-entry-public-walking');
      await b.call(() => {
        const api = smartTwinViewer, c = api.context, T = api.THREE;
        const target = new T.Mesh(new T.SphereBufferGeometry(.35, 16, 12), new T.MeshBasicMaterial({color: '#44ffcc'}));
        target.position.copy(c.camera.getWorldPosition(new T.Vector3())).addScaledVector(c.camera.getWorldDirection(new T.Vector3()), 2); c.scene.add(target); c.scene.updateMatrixWorld(true);
        window.__entryQA = {target, selected: 0};
        c.raycontrol.addState('qa-center-pointer', {colliderMesh: target, onSelectStart: () => __entryQA.selected++}, true);
        const canvas = c.renderer.domElement, lock = canvas.requestPointerLock.bind(canvas);
        __entryQA.lockEvents = [];
        __entryQA.inputEvents = [];
        canvas.requestPointerLock = function () {__entryQA.lockEvents.push({kind:'request',activation:navigator.userActivation.isActive});const result=lock();if(result&&result.catch)result.catch(error=>__entryQA.lockEvents.push({kind:'reject',name:error.name,message:error.message}));return result;};
        canvas.addEventListener('pointerdown', event => __entryQA.lockEvents.push({kind:'pointerdown',trusted:event.isTrusted,type:event.pointerType}),{capture:true});
        for(const name of ['pointerdown','pointermove','pointerup','gotpointercapture','lostpointercapture'])canvas.addEventListener(name,event=>__entryQA.inputEvents.push({time:performance.now(),name,buttons:event.buttons,x:event.clientX,y:event.clientY,drag:c.input.drag&&{...c.input.drag},q:c.camera.quaternion.toArray()}));
        document.addEventListener('pointerlockerror',()=>__entryQA.inputEvents.push({time:performance.now(),name:'pointerlockerror',drag:c.input.drag&&{...c.input.drag}}));
      });
      // A first real click captures look and never activates the object beneath the reticle.
      await click(720, 460);
      try {await until(() => b.evaluate('document.pointerLockElement === smartTwinViewer.context.renderer.domElement || smartTwinViewer.context.input.pointerLockUnavailable'), 'Scene click neither captured look nor enabled the supported fallback.', 20000);}
      catch(error){report.lockDiagnostics=await b.evaluate('__entryQA.lockEvents');throw new Error(error.message+' '+JSON.stringify(report.lockDiagnostics));}
      const nativeCapture = await b.evaluate('document.pointerLockElement === smartTwinViewer.context.renderer.domElement');
      report.nativePointerLock = {verified:nativeCapture, fallbackRequired:!nativeCapture, events:await b.evaluate('__entryQA.lockEvents')};
      if (!nativeCapture) assert(report.nativePointerLock.events.some(event=>event.kind==='reject'&&event.name==='WrongDocumentError'),'Only the documented headless limitation may substitute the real fallback gesture.');
      assert.equal(await b.evaluate('__entryQA.selected'), 0);
      const before = await b.evaluate('smartTwinViewer.context.camera.quaternion.toArray()');
      if (!nativeCapture) await drag(720,460,30,10);
      else await b.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 750, y: 470});
      report.dragDiagnostic=await b.evaluate('__entryQA.inputEvents');
      assert(await b.call(previous => previous.some((n, i) => Math.abs(n - smartTwinViewer.context.camera.quaternion.toArray()[i]) > 1e-8), before),'Real look gesture did not turn the camera: '+JSON.stringify(report.dragDiagnostic));
      report.centerRay = await b.call(() => {
        const c = smartTwinViewer.context, T = smartTwinViewer.THREE;
        c.scene.updateMatrixWorld(true); const hits = c.raycontrol.getIntersections(c.desktopController, __entryQA.target);
        const direction = c.camera.getWorldDirection(new T.Vector3()), origin = c.camera.getWorldPosition(new T.Vector3());
        return {directionError: c.raycontrol.raycaster.ray.direction.distanceTo(direction), originError: c.raycontrol.raycaster.ray.origin.distanceTo(origin), hits: hits.length, captured: c.desktopLook.isLocked};
      });
      assert(report.centerRay.directionError < 1e-7 && report.centerRay.originError < 1e-7 && report.centerRay.hits);
      await click(750, 470); assert.equal(await b.evaluate('__entryQA.selected'), 1, 'The second click must use the center ray.');
      await key('Escape', 'Escape', 27);
      await until(() => b.evaluate('!document.pointerLockElement'), 'Escape did not release the mouse.');
      const released = await b.evaluate('smartTwinViewer.context.camera.quaternion.toArray()');
      await b.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 1000, y: 650});
      assert.deepEqual(await b.evaluate('smartTwinViewer.context.camera.quaternion.toArray()'), released, 'A free mouse must not rotate the walking view.');
      await b.call(() => {const c = smartTwinViewer.context; c.raycontrol.deactivateState('qa-center-pointer'); c.scene.remove(__entryQA.target); __entryQA.target.geometry.dispose(); __entryQA.target.material.dispose();});
      report.mouse = {firstCaptureAttemptDoesNotSelect: true, explicitLookGestureChangesLook: true, centerClickSelects: true, escapeReleases: true, freeMouseDoesNotRotate: true, dragFallbackVerified:!nativeCapture};
      console.log('Standard entry: real mouse and center ray passed; native capture=' + nativeCapture + ', fallback=' + !nativeCapture + '.');
      await b.call(() => document.getElementById('viewer-menu-toggle').click());
      assert(await b.evaluate('document.getElementById("viewer-menu").open && smartTwinViewer.context.publicDialogOpen && !document.pointerLockElement'));
      await b.call(() => document.getElementById('drive').click());
      assert.equal(await b.evaluate('!!smartTwinViewer.context.demo.driving.id'), false, 'The public menu must not remotely teleport the operator into the truck.');
      await b.call(() => document.getElementById('viewer-menu-close').click());
      await until(() => b.evaluate('!smartTwinViewer.context.publicDialogOpen'), 'Closing the menu must restore interaction.');
      await b.call(() => {
        const c = smartTwinViewer.context, T = smartTwinViewer.THREE, truck = [...c.demo.simulation.records.values()].find(r => r.components.vehicle);
        c.cameraRig.position.set(0, 0, 0); c.cameraRig.quaternion.set(0, 0, 0, 1);
        c.camera.position.copy(truck.object.getWorldPosition(new T.Vector3())).add(new T.Vector3(0, 1.65, 2)); c.camera.lookAt(truck.object.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, 1, 0))); c.scene.updateMatrixWorld(true);
      });
      await key('KeyF', 'f', 70); await until(() => b.evaluate('!!smartTwinViewer.context.demo.driving.id'), 'F must mount a nearby forklift.');
      await b.screenshot('standard-entry-forklift-controls');
      await key('KeyF', 'f', 70); await until(() => b.evaluate('!smartTwinViewer.context.demo.driving.id && !document.pointerLockElement'), 'F must leave a stopped forklift and release look.');
      const afterExit = await b.evaluate('smartTwinViewer.context.camera.quaternion.toArray()');
      await b.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 1100, y: 620});
      assert.deepEqual(await b.evaluate('smartTwinViewer.context.camera.quaternion.toArray()'), afterExit);
      await click(800, 500);
      if (nativeCapture) await until(() => b.evaluate('!!document.pointerLockElement'), 'A new scene click must restore walking look.',20000);
      else {
        const previous=await b.evaluate('smartTwinViewer.context.camera.quaternion.toArray()');
        await drag(800,500,20,5);
        assert(await b.call(previous=>previous.some((n,i)=>Math.abs(n-smartTwinViewer.context.camera.quaternion.toArray()[i])>1e-8),previous),'After leaving the vehicle, an explicit fallback drag must restore look.');
      }
      await b.call(() => document.getElementById('viewer-menu-toggle').click());
      await until(() => b.evaluate('!document.pointerLockElement && smartTwinViewer.context.publicDialogOpen'), 'Opening a menu must release captured look.');
      report.vehicleNavigation = {nearbyFMount: true, stoppedFUnmount: true, afterExitFreeMouseStable: true, explicitClickResumes: true, menuReleasesLook: true};
      await b.call(() => document.getElementById('viewer-menu-close').click());
      await b.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
      report.mobile = await b.call(() => ({width:innerWidth, scrollWidth:document.documentElement.scrollWidth, noTestFooter:!document.querySelector('.lesson-footer'), header: (() => {const r=document.querySelector('.viewer-header').getBoundingClientRect();return {width:r.width,height:r.height};})()}));
      assert(report.mobile.scrollWidth <= report.mobile.width + 1); assert(report.mobile.noTestFooter); await b.screenshot('standard-entry-mobile-walking');
      await b.send('Emulation.setDeviceMetricsOverride', {width:1600,height:1000,deviceScaleFactor:1,mobile:false});
      console.log('Standard entry: truck exit, free mouse, menu and mobile layout passed.');

      // Log in only to the disposable QA account, then open the actual library card.
      await b.send('Page.navigate', {url: fixture.origin + '/login?next=' + encodeURIComponent('/#escenarios')});
      await until(() => b.evaluate('!!document.getElementById("login")'), 'Login unavailable.');
      await b.call(password => {const form = document.getElementById('login'); form.elements.username.value = 'qa_production_owner'; form.elements.password.value = password; form.requestSubmit();}, password);
      await until(() => b.evaluate('!!window.smartTwinGallery && smartTwinGallery.getStats().authenticated'), 'Signed-in gallery unavailable.');
      await b.call(() => document.getElementById('explore-scenes').click());
      await until(() => b.evaluate('smartTwinGallery.getStats().screen === "gallery"'), 'The signed-in catalogue did not open.');
      report.authenticatedGallery = await b.call(() => ({ids: smartTwinGallery.getStats().sceneIds, duplicateDemo: !!document.querySelector('.scene-open[data-scene-id="vr-robot-dispatch"]'), href: document.querySelector('.scene-open[data-scene-id="vr-robot-transfer"]').href}));
      assert.equal(report.authenticatedGallery.duplicateDemo, false); assert.equal(new URL(report.authenticatedGallery.href).pathname, '/editor'); assert.equal(new URL(report.authenticatedGallery.href).searchParams.get('libraryScene'), 'vr-robot-transfer');
      await b.call(() => document.querySelector('.scene-open[data-scene-id="vr-robot-transfer"]').click());
      await until(() => b.evaluate('!!window.context && context.editor && !context.editor.initializing && !context.editor.loadingProject && context.editor.currentProject?.librarySceneId === "vr-robot-transfer"'), 'The normal library scene did not load.');
      await b.call(() => {if (context.editor.active) context.editor.leave();});
      report.normalScene = await b.call(() => ({id: context.editor.currentProject.librarySceneId, publicViewerPresent: !!window.smartTwinViewer, noTestFooter: !document.querySelector('.lesson-footer,.viewer-scene-caption'), camera: context.camera.position.toArray(), gl: context.renderer.getContext().getError()}));
      assert.equal(report.normalScene.id, 'vr-robot-transfer'); assert.equal(report.normalScene.publicViewerPresent, false); assert(report.normalScene.noTestFooter); assert.equal(report.normalScene.gl, 0);
      await b.screenshot('standard-entry-normal-library-scene');
      assert.deepEqual(report.exceptions, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.failedRequests, []); assert.deepEqual(fixture.errors, []);
    });
    report.passed = true; console.log(JSON.stringify({passed: true, bundleSha256: report.bundleSha256, workspaceSha256: report.workspaceSha256, centerRay: report.centerRay, authenticatedCards: report.authenticatedGallery.ids.length}));
  } catch (error) {report.passed = false; report.failure = error.stack; throw error;}
  finally {report.completedAt = new Date().toISOString(); fs.writeFileSync(path.join(OUT, 'standard-entry-report.json'), JSON.stringify(report, null, 2)); await fixture.close();}
  return report;
}
module.exports = {run};
if (require.main === module) run().catch(error => {console.error(error); process.exitCode = 1;});
