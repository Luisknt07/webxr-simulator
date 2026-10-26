'use strict';
// Browser QA uses only a disposable API/database and disposable Chrome profile.
// Immersive mode and controllers are simulated; this is not a headset benchmark.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {spawn} = require('node:child_process'), {createHash, X509Certificate, randomUUID} = require('node:crypto'), WebSocket = require('ws');
const helper = require('./qa-project-workspace-browser');
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'data/qa-studio'), PREFIX = 'hello-admin-vr-browser-';
const PASSWORD = 'Disposable-immersive-fixture-2026!';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pem = () => fs.readFileSync(path.join(ROOT, 'node_modules/webpack-dev-server/ssl/server.pem'));
function cleanup(directory) { const value = path.resolve(directory); assert.equal(path.dirname(value), path.resolve(os.tmpdir())); assert(path.basename(value).startsWith(PREFIX)); fs.rmSync(value, {recursive: true, force: true, maxRetries: 30, retryDelay: 250}); }
const browserSource = helper.withBrowser.toString().replace(/'workspace-'/g, "'admin-vr-'").replace(/'project-workspace-browser\.json'/g, "'admin-vr-menu-browser.json'");
const withBrowser = new Function('assert', 'fs', 'path', 'os', 'spawn', 'createHash', 'X509Certificate', 'WebSocket', 'OUTPUT', 'PREFIX', 'pem', 'delay', 'cleanup', 'return (' + browserSource + ');')
  (assert, fs, path, os, spawn, createHash, X509Certificate, WebSocket, OUTPUT, PREFIX, pem, delay, cleanup);

async function run() {
  const argument = process.argv.indexOf('--expected-bundle-sha256'), expected = argument < 0 ? null : process.argv[argument + 1];
  assert(expected && /^[a-f0-9]{64}$/.test(expected), 'Pass the reviewed compiled bundle hash.');
  const actual = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'bundle.js'))).digest('hex'); assert.equal(actual, expected);
  fs.mkdirSync(OUTPUT, {recursive: true}); const fixture = await helper.startTemporaryServer();
  try {
    const result = await fixture.request('/api/studio/register', 'POST', {username: 'qa_immersive_admin', displayName: 'Administración temporal', password: PASSWORD}); assert.equal(result.status, 201); const owner = result.body.user;
    const student = await fixture.request('/api/studio/register', 'POST', {username: 'qa_immersive_student', displayName: 'Alumno de prueba', password: PASSWORD}); assert.equal(student.status, 201);
    const project = await fixture.request('/api/projects', 'POST', {name: 'Práctica privada del alumno', document: {format:'hello-webxr-editor',version:1,imports:[],rooms:{hall:{overrides:[],additions:[]}}}}, student.cookie); assert.equal(project.status, 201);
    // Directory load is real HTTP; extra accounts are display-only fixtures with
    // no usable session/password, created exclusively in the temporary database.
    const original = fixture.api.studio.db.prepare('SELECT * FROM studio_users WHERE id=?').get(student.body.user.id);
    const insert = fixture.api.studio.db.prepare('INSERT INTO studio_users(id,username,salt,password_hash,display_name,avatar,image,preferences,role,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
    fixture.api.studio.db.exec('BEGIN IMMEDIATE');
    try { for (let index = 0; index < 130; index++) insert.run(randomUUID(), 'qa_directory_' + String(index).padStart(3, '0'), original.salt, original.password_hash, 'Participante ' + String(index).padStart(3, '0'), original.avatar, null, original.preferences, index % 4 === 0 ? 'viewer' : 'creator', Date.now() - index * 60000); fixture.api.studio.db.exec('COMMIT'); }
    catch (error) { fixture.api.studio.db.exec('ROLLBACK'); throw error; }
    console.log('Admin/VR QA isolated origin:', fixture.origin, 'build:', actual);
    const report = await withBrowser(fixture.origin, async b => {
      const step = message => console.log('Admin/VR Chrome:', message);
      await b.navigate('/');
      step('authenticate only through the real temporary service');
      await b.call(async (username, password) => { await context.studio.client.login(username, password); await context.studio.client.me(); await context.studio.authenticated(); }, 'qa_immersive_admin', PASSWORD);
      assert.equal(await b.evaluate('context.studio.client.user.id'), owner.id);
      step('large administrator directory in a two-column modal');
      await b.evaluate('context.studio.open("users")');
      await b.until(() => b.evaluate('Boolean(context.studio.administration.userDirectory?.rows?.querySelector("tr[data-user-id]"))'), 'Administration directory did not load.');
      const admin = await b.evaluate('(()=>{const a=context.studio.administration,d=a.userDirectory,m=a.modal.querySelector(".studio-admin-modal").getBoundingClientRect(),l=d.rows.getBoundingClientRect(),r=d.detail.getBoundingClientRect();return {modal:{left:m.left,top:m.top,width:m.width,height:m.height},list:{left:l.left,width:l.width},detail:{left:r.left,width:r.width},rows:d.rows.querySelectorAll("tr[data-user-id]").length,users:a.users.length,selected:a.selectedUserId,drawerHidden:context.studio.drawer.hidden}})()');
      assert(admin.users >= 132); assert(admin.rows <= 25); assert(admin.modal.width > 1000); assert(admin.detail.left > admin.list.left); assert(admin.drawerHidden); b.report.admin = admin; await b.screenshot('modal-directory');
      const chrome = await b.evaluate('(()=>{const a=context.studio.administration,m=a.modal.querySelector(".studio-admin-modal").getBoundingClientRect(),header=a.modal.querySelector("header"),footer=a.modal.querySelector("footer"),h=header.getBoundingClientRect(),f=footer.getBoundingClientRect(),t=a.modal.querySelector(".studio-admin-tabs").getBoundingClientRect(),c=a.closeButton.getBoundingClientRect();return {headerPosition:getComputedStyle(header).position,footerPosition:getComputedStyle(footer).position,headerInside:h.left>=m.left&&h.right<=m.right,footerInside:f.bottom<=m.bottom,closeInside:c.right<=m.right&&c.left>=m.left,tabsBelowHeader:t.top>=h.bottom-.5}})()');
      assert.equal(chrome.headerPosition,'static');assert.equal(chrome.footerPosition,'static');assert(chrome.headerInside&&chrome.footerInside&&chrome.closeInside&&chrome.tabsBelowHeader,JSON.stringify(chrome));b.report.modalChrome=chrome;
      await b.call(() => { const d=context.studio.administration.userDirectory; d.search.value='qa_directory_129'; d.search.oninput(); });
      const search = await b.evaluate('(()=>{const d=context.studio.administration.userDirectory;return {rows:d.rows.querySelectorAll("tr[data-user-id]").length,text:d.rows.textContent}})()'); assert.equal(search.rows, 1); assert(search.text.includes('qa_directory_129')); b.report.search = search;
      await b.evaluate('context.studio.administration.userDirectory.rows.querySelector(".studio-admin-user-name").click()');
      await b.until(() => b.evaluate('context.studio.administration.userDirectory.detail.textContent.includes("qa_directory_129")'), 'User detail selection did not update.'); await b.screenshot('selected-user');
      await b.call(() => { const d=context.studio.administration.userDirectory; d.search.value=''; d.search.oninput(); d.next.click(); });
      const page = await b.evaluate('(()=>{const d=context.studio.administration.userDirectory;return {rows:d.rows.querySelectorAll("tr[data-user-id]").length,status:d.status.textContent}})()'); assert(page.rows <= 25); b.report.pagination = page;
      await b.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
      await b.until(() => b.evaluate('!document.querySelector(".studio-admin-modal-overlay")'), 'Escape did not dismiss the administrator modal.');
      step('immersive mode suppresses every desktop overlay');
      await b.call(async () => {
        // The headset boundary is simulated, but the real VRButton factory owns
        // session start/end. Exiting through the native menu must drive that
        // lifecycle instead of a test directly clearing vrMode or the menu.
        const {VRButton}=await import(new URL('src/lib/VRButton.js',document.baseURI).href);
        window.__qaXR = {getCamera:context.renderer.xr.getCamera,getSession:context.renderer.xr.getSession,navigatorOwn:Object.getOwnPropertyDescriptor(navigator,'xr'),events:[]};
        const session=new EventTarget();session.visibilityState='visible';session.endCalls=0;
        session.requestReferenceSpace=async type=>({type});
        session.end=async()=>{session.endCalls++;session.dispatchEvent(new Event('end'));};
        const adapter=new EventTarget();adapter.isPresenting=false;adapter.getSession=()=>adapter.session;
        adapter.setReferenceSpaceType=()=>{};
        adapter.setSession=value=>{adapter.session=value;adapter.isPresenting=true;value.addEventListener('end',()=>{adapter.session=null;adapter.isPresenting=false;},{once:true});adapter.dispatchEvent(new Event('sessionstart'));};
        Object.defineProperty(navigator,'xr',{configurable:true,value:{isSessionSupported:async()=>true,requestSession:async()=>session}});
        __qaXR.session=session;
        context.renderer.xr.getCamera = () => context.camera;
        context.renderer.xr.getSession = () => adapter.getSession();
        __qaXR.button=VRButton.createButton({xr:adapter},status=>{
          __qaXR.events.push(status);
          const active=status==='sessionStarted';context.vrMode=active;document.body.classList.toggle('vr-mode',active);context.editor.onVRChange(active);context.studio.onVRChange(active);
          if(!active){context.renderer.xr.getCamera=__qaXR.getCamera;context.renderer.xr.getSession=__qaXR.getSession;if(__qaXR.navigatorOwn)Object.defineProperty(navigator,'xr',__qaXR.navigatorOwn);else delete navigator.xr;}
        });
        await Promise.resolve();await Promise.resolve();
        if(typeof __qaXR.button.onclick!=='function')throw Error('The real VRButton did not expose the simulated supported session.');
        await __qaXR.button.onclick();
        if(!context.vrMode||__qaXR.events.join(',')!=='sessionStarted')throw Error('The real VRButton session-start callback did not enter immersive mode.');
        const menu=context.studio.immersiveMenu;
        menu.tick(.016);
        if(menu.opened||context.studioMenuOpen||[menu.panel,menu.launcher].some(mesh=>mesh&&mesh.visible))throw Error('Entering VR must leave every menu surface hidden.');
        window.__qaInputs=context.controllers.map((controller,index)=>{
          controller.visible=true;
          const source={handedness:index?'right':'left',targetRayMode:'tracked-pointer',gamepad:{mapping:'xr-standard',buttons:Array.from({length:6},()=>({pressed:false,value:0})),axes:[0,0,0,0]}};
          const data=context.raycontrol.addController(controller,source);return {controller,source,data};
        });
        menu.tick(.016);
        __qaInputs[0].source.gamepad.buttons[4]={pressed:true,value:1};menu.tick(.016);
        __qaInputs[0].source.gamepad.buttons[4]={pressed:false,value:0};menu.tick(.016);
        if(!menu.opened)throw Error('The left controller X button must open the hidden VR menu.');
        __qaInputs[1].source.gamepad.buttons[4]={pressed:true,value:1};menu.tick(.016);
        __qaInputs[1].source.gamepad.buttons[4]={pressed:false,value:0};menu.tick(.016);
        if(menu.opened||context.studioMenuOpen||[menu.panel,menu.launcher].some(mesh=>mesh&&mesh.visible))throw Error('The right controller A button must close the menu without leaving a floating label.');
        __qaInputs[0].source.gamepad.buttons[4]={pressed:true,value:1};menu.tick(.016);
        __qaInputs[0].source.gamepad.buttons[4]={pressed:false,value:0};menu.tick(.016);
        if(!menu.opened)throw Error('The assigned controller button must reopen the menu.');
      });
      await b.until(() => b.evaluate('Boolean(context.studio.immersiveMenu&&context.studioMenuOpen)'), 'Immersive menu did not open with its assigned controller button.');
      const desktopHidden = await b.evaluate('(()=>{const selectors=[".studio-header",".studio-drawer",".studio-shade",".studio-notice",".studio-context",".studio-controls",".ed-share-project",".ed-project-overlay",".simulation-panel",".ed-preview-controls",".studio-admin-modal-overlay"];return selectors.flatMap(selector=>[...document.querySelectorAll(selector)].map(element=>({selector,visible:!!(element.getBoundingClientRect().width&&element.getBoundingClientRect().height)&&getComputedStyle(element).display!=="none"&&getComputedStyle(element).visibility!=="hidden"})));})()');
      assert(desktopHidden.every(row => !row.visible), JSON.stringify(desktopHidden)); b.report.desktopHidden = desktopHidden;
      await b.evaluate('context.studio.immersiveMenu.open("home")'); await delay(200); await b.screenshot('immersive-home');
      b.report.syntheticVR = {hardwareSession: false, actualWebGLRenderer: true};
      await immersiveChecks(b, project.body.project.id);
      step('exit through the native menu drives real VRButton session-end cleanup');
      await b.evaluate('__qaMenuRay("exit-vr",1)');
      await b.until(() => b.evaluate('!context.vrMode&&!context.studioMenuOpen&&!context.studio.header.hidden'), 'The native exit button did not restore desktop presentation.');
      const exit=await b.evaluate('({endCalls:__qaXR.session.endCalls,events:__qaXR.events,buttonText:__qaXR.button.textContent,menuActive:context.studio.immersiveMenu.active,resourcesReleased:context.studio.immersiveMenu.group===null,passwordEmpty:context.studio.immersiveMenu.fields.password==="",bodyVR:document.body.classList.contains("vr-mode")})');
      assert.equal(exit.endCalls,1);assert.deepEqual(exit.events,['sessionStarted','sessionEnded']);assert.equal(exit.buttonText,'Entrar en VR');assert(!exit.menuActive&&exit.resourcesReleased&&exit.passwordEmpty&&!exit.bodyVR);b.report.exitVR=exit;
      b.report.finish = await b.evaluate('({gl:context.renderer.getContext().getError(),menuOpen:context.studioMenuOpen,user:context.studio.client.user&&context.studio.client.user.username})'); assert.equal(b.report.finish.gl, 0);
      step('responsive administrator modal on a narrow mobile viewport');
      await b.call(async (username,password)=>{await context.studio.client.login(username,password);await context.studio.client.me();await context.studio.authenticated();},'qa_immersive_admin',PASSWORD);
      await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await b.navigate('/');await b.evaluate('context.studio.open("users")');
      await b.until(()=>b.evaluate('Boolean(context.studio.administration.userDirectory?.rows?.querySelector("tr[data-user-id]"))'),'Mobile administration did not load.');
      const mobile=await b.evaluate('(()=>{const a=context.studio.administration,m=a.modal.querySelector(".studio-admin-modal").getBoundingClientRect(),d=a.userDirectory.detail.getBoundingClientRect(),l=a.userDirectory.list.getBoundingClientRect();return{viewport:innerWidth,modal:{left:m.left,right:m.right,width:m.width},detailBelowList:d.top>=l.top,bodyOverflow:document.body.scrollWidth>innerWidth}})()');assert.equal(mobile.viewport,390);assert(mobile.modal.left>=0&&mobile.modal.right<=390&&!mobile.bodyOverflow,JSON.stringify(mobile));b.report.mobile=mobile;await b.screenshot('mobile-administration');
      assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.consoleErrors, []); assert.deepEqual(b.report.apiFailures, []); b.report.buildHash = actual; b.report.temporaryDatabaseOnly = true;
    });
    assert.deepEqual(fixture.errors, []); console.log('Admin/VR browser QA passed:', JSON.stringify({shots:report.shots.length,exceptions:report.exceptions.length,apiFailures:report.apiFailures.length,build:actual}));
  } finally { await fixture.close(); }
}

async function immersiveChecks(b, privateProjectId) {
  await b.call(() => {
    const ctx=context, menu=ctx.studio.immersiveMenu, ray=ctx.raycontrol;
    window.__qaRayHits=[];
    window.__qaMenuRay=(key,hand=0)=>{
      menu.tick(.016);
      const row=__qaInputs[hand],controller=row.controller,mesh=menu.panel,region=menu.regions.find(value=>value.key===key);
      if(!mesh||!region)throw Error('Missing 3D menu region '+key);
      const u=(region.x+region.width/2)/1024,v=1-(region.y+region.height/2)/960;
      mesh.updateWorldMatrix(true,false);const size=mesh.geometry.parameters;
      const point=mesh.localToWorld(menu.position.clone().set((u-.5)*size.width,(v-.5)*size.height,0));
      const normal=menu.forward.clone().set(0,0,1).applyQuaternion(mesh.getWorldQuaternion(menu.headQuaternion.clone()));
      const origin=point.clone().addScaledVector(normal,.6),rotation=menu.rotation.clone().lookAt(origin,point,menu.forward.clone().set(0,1,0));
      const quaternion=menu.headQuaternion.clone().setFromRotationMatrix(rotation),parent=controller.parent;
      controller.position.copy(parent?parent.worldToLocal(origin.clone()):origin);
      if(parent)quaternion.premultiply(parent.getWorldQuaternion(menu.headQuaternion.clone()).inverse());controller.quaternion.copy(quaternion);controller.updateMatrix();controller.updateWorldMatrix(true,true);
      ctx.scene.updateMatrixWorld(true);ray.execute(ctx,.016,performance.now()/1000);
      if(!row.data.currentIntersection||row.data.currentIntersection.state!==menu.state||menu.regionAt(row.data.currentIntersection.intersection)?.key!==key)throw Error('3D ray did not reach '+key+' with '+row.source.handedness+'; hit '+JSON.stringify({state:row.data.currentIntersection?.state?.name,key:menu.regionAt(row.data.currentIntersection?.intersection)?.key,uv:row.data.currentIntersection?.intersection?.uv,enabled:row.data.enabled,menuOpen:menu.opened,rayEnabled:ray.enabled,states:ray.currentStates.map(v=>[v.name,v.xrMenu]),origin:ray.raycaster.ray.origin.toArray(),direction:ray.raycaster.ray.direction.toArray(),point:point.toArray(),normal:normal.toArray(),matrix:controller.matrixWorld.elements,raw:ray.getIntersections(controller,mesh).map(v=>({distance:v.distance,uv:v.uv}))}));
      __qaRayHits.push({key,hand:row.source.handedness});controller.dispatchEvent({type:'selectstart'});controller.dispatchEvent({type:'selectend'});menu.tick(.016);
    };
    window.__qaToggleMenu=(hand=0)=>{
      const input=__qaInputs[hand].source.gamepad;
      input.buttons[4]={pressed:false,value:0};menu.tick(.016);
      input.buttons[4]={pressed:true,value:1};menu.tick(.016);
      input.buttons[4]={pressed:false,value:0};menu.tick(.016);
    };
    window.__qaText=[];const text=menu.drawing.fillText.bind(menu.drawing);menu.drawing.fillText=(value,...args)=>{if(__qaText.length<10000)__qaText.push(String(value));return text(value,...args);};
  });
  console.log('Admin/VR Chrome: actual 3D controller rays and modal machine isolation');
  await b.evaluate('__qaMenuRay("controls",0);__qaMenuRay("recenter",1)');
  const hands=await b.evaluate('[...new Set(__qaRayHits.map(value=>value.hand))]');assert.deepEqual(hands.sort(),['left','right']);
  await b.evaluate('__qaMenuRay("home",1);__qaMenuRay("settings",0);__qaMenuRay("volume-down",1)');await b.screenshot('immersive-settings');
  await b.evaluate('__qaMenuRay("home",0);__qaMenuRay("logout",1)');
  await b.until(()=>b.evaluate('!context.studio.client.user&&!context.studio.immersiveMenu.busy'), 'VR logout did not complete.');
  console.log('Admin/VR Chrome: reconnect a temporarily unavailable same-origin account service');
  await b.call(()=>{
    context.editor.staticPublic=true;context.studio.client.configured=false;context.studio.online=false;
    context.studio.immersiveMenu.close();__qaToggleMenu(0);__qaMenuRay('account',0);
    if(!context.studio.immersiveMenu.regions.some(region=>region.key==='reconnect-account'))throw Error('The VR account page must offer connection retry after an unavailable initial health check.');
  });
  const writesBeforeReconnect=b.report.writes.length;
  await b.evaluate('__qaMenuRay("reconnect-account",1)');
  await b.until(()=>b.evaluate('!context.editor.staticPublic&&context.studio.online&&!context.studio.immersiveMenu.busy&&context.studio.immersiveMenu.page==="account"&&context.studio.immersiveMenu.keyboardField==="username"'), 'VR account retry did not recover the real temporary service.');
  assert.equal(b.report.writes.length,writesBeforeReconnect,'Retry must probe health/identity with GET, never submit authentication or passwords.');
  const reconnect=await b.evaluate('({online:context.studio.online,staticPublic:context.editor.staticPublic,user:context.studio.client.user,page:context.studio.immersiveMenu.page,keyboardField:context.studio.immersiveMenu.keyboardField,passwordEmpty:context.studio.immersiveMenu.fields.password===""})');
  assert.equal(reconnect.user,null);assert.equal(reconnect.passwordEmpty,true);b.report.accountReconnect=reconnect;
  await b.evaluate('__qaMenuRay("field:username",1)');
  console.log('Admin/VR Chrome: login using the world-space keyboard');
  await b.call((username,password)=>{
    const menu=context.studio.immersiveMenu;
    const type=value=>{for(const char of value){const lower=char.toLowerCase(),letters=['1234567890','qwertyuiop','asdfghjkl','zxcvbnm-_'],symbols=['!@#$%^&*()','[]{}<>+=/'+String.fromCharCode(92),'.,:;?~`|"',"'_ -"];
      const mode=letters.some(row=>row.includes(lower))?'letters':'symbols';if(menu.keyboardMode!==mode)__qaMenuRay('key:symbols',1);
      const shifted=char!==lower;if(menu.shift!==shifted)__qaMenuRay('key:shift',0);
      const rows=mode==='letters'?letters:symbols;let found=false;rows.forEach((row,index)=>{const at=row.indexOf(lower);if(at>=0&&!found){__qaMenuRay('key:'+index+':'+at,index%2);found=true;}});if(!found)throw Error('Fixture character unavailable on keyboard');
    }};
    type(username);__qaMenuRay('field:password',1);type(password);
    window.__qaLoginPose={project:context.editor.currentProject.id,position:context.cameraRig.position.toArray(),quaternion:context.cameraRig.quaternion.toArray(),passwordLength:menu.fields.password.length};
  },'qa_immersive_student',PASSWORD);
  await b.screenshot('immersive-login-keyboard');
  assert(await b.call(password=>!__qaText.some(value=>value.includes(password)),PASSWORD),'Password must be masked on the native canvas.');
  await b.evaluate('__qaMenuRay("authenticate",1)');
  await b.until(()=>b.evaluate('context.studio.client.user?.username==="qa_immersive_student"&&!context.studio.immersiveMenu.busy'), 'Native VR keyboard login did not authenticate.');
  const authentication=await b.evaluate('({user:context.studio.client.user.username,sameProject:context.editor.currentProject.id===__qaLoginPose.project,pose:context.cameraRig.position.toArray(),previousPose:__qaLoginPose.position,passwordCleared:context.studio.immersiveMenu.fields.password==="",codeCleared:context.studio.immersiveMenu.fields.code===""})');
  assert(authentication.sameProject&&authentication.passwordCleared&&authentication.codeCleared);assert(authentication.pose.every((value,index)=>Math.abs(value-authentication.previousPose[index])<1e-6));b.report.authentication=authentication;await b.screenshot('immersive-authenticated');
  console.log('Admin/VR Chrome: authorized private projects from inside the headset UI');
  await b.evaluate('__qaMenuRay("projects",0)');await b.until(()=>b.evaluate('!context.studio.immersiveMenu.loading&&context.studio.immersiveMenu.items.length===1'),'VR project library did not load the authorized project.');
  await b.call(id=>__qaMenuRay('item:'+id,1),privateProjectId);
  await b.until(()=>b.call(id=>context.editor.currentProject.id===id&&!context.editor.loadingProject&&!context.studioMenuOpen,privateProjectId),'The private project did not open in the immersive viewer.');
  const loaded=await b.evaluate('({id:context.editor.currentProject.id,user:context.studio.client.user.username,editing:context.editor.active})');assert.equal(loaded.id,privateProjectId);assert.equal(loaded.editing,false);b.report.privateProject=loaded;
  await b.call(()=>{const input=__qaInputs[0].source.gamepad;input.buttons[4]={pressed:false,value:0};context.studio.immersiveMenu.tick(.016);input.buttons[4]={pressed:true,value:1};context.studio.immersiveMenu.tick(.016);});
  assert(await b.evaluate('context.studioMenuOpen'),'X face button should reopen the immersive menu.');
  await b.evaluate('__qaMenuRay("logout",1)');await b.until(()=>b.evaluate('!context.studio.client.user&&!context.studio.immersiveMenu.busy&&context.editor.currentProject.access.role==="public"'),'Logout must remove private scene access.');
  b.report.immersiveState=await b.evaluate('({active:context.studio.immersiveMenu.active,opened:context.studio.immersiveMenu.opened,rays:__qaRayHits.length,hands:[...new Set(__qaRayHits.map(value=>value.hand))],passwordMasked:true,passwordCleared:context.studio.immersiveMenu.fields.password===""})');
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {run};
