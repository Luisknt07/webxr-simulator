'use strict';
// Real Chrome against a disposable static server: no live account/database writes.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https');
const {createHash} = require('node:crypto');
const {withBrowser: sharedBrowser} = require('./qa-project-workspace-browser');
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'data/qa-studio');
async function withBrowser(origin, action) {
  let completed = false, result;
  try { return await sharedBrowser(origin, async browser => { result = await action(browser); completed = true; return result; }); }
  catch (error) {
    // Chrome can release its disposable Windows profile after the helper's
    // first cleanup attempts. Retry only that verified task-owned temp path.
    let target = error.path || ''; if (target.startsWith('\\\\?\\')) target = target.slice(4);
    target = path.resolve(target);
    if (!completed || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code) || path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('hello-workspace-browser-chrome-')) throw error;
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try { fs.rmSync(target, {recursive: true, force: true, maxRetries: 2, retryDelay: 250}); return result; }
      catch (failure) { if (attempt === 11) throw failure; }
    }
  }
}

async function startStaticServer() {
  const requests = [], certificate = fs.readFileSync(path.join(ROOT, 'node_modules/webpack-dev-server/ssl/server.pem'));
  const mime = {'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ogg':'audio/ogg','.mp3':'audio/mpeg','.wav':'audio/wav','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.wasm':'application/wasm','.woff2':'font/woff2'};
  const server = https.createServer({key:certificate,cert:certificate}, (req,res) => {
    const pathname = new URL(req.url, 'https://localhost').pathname, entry = {path:pathname,method:req.method}; requests.push(entry);
    const end = status => {entry.status=status;res.writeHead(status, {'Content-Type':'application/json'});res.end(JSON.stringify({error:'Not available on a static host'}));};
    if (!['GET','HEAD'].includes(req.method)) return end(405);
    let relative; try {relative=decodeURIComponent(pathname).replace(/^\/webxr-simulator\//,'/').replace(/^\/+/, '');} catch (_) {return end(400);}
    if (!relative || relative === 'editor' || relative === 'editor/') relative='index.html';
    if (/^api(?:\/|$)/.test(relative)) return end(404);
    const allowed=['assets/','res/','src/','shared/','examples/'].some(prefix=>relative.startsWith(prefix)) || /^(?:index\.html|bundle\.js(?:\.map)?|collision-worker\.js(?:\.map)?|mesh-optimizer-worker\.js(?:\.map)?)$/.test(relative);
    const file=path.resolve(ROOT,relative); if(!allowed||!file.startsWith(ROOT+path.sep)) return end(404);
    fs.stat(file,(error,stat)=>{if(error||!stat.isFile())return end(404);entry.status=200;res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin:'https://localhost:'+server.address().port,requests,close:()=>new Promise(resolve=>server.close(resolve))};
}

async function verify(origin, base, expected, local) {
  return withBrowser(origin, async b => {
    const ready=()=>b.until(()=>b.evaluate('Boolean(window.context?.editor&&!context.editor.initializing&&!context.editor.loadingProject&&context.studio?.ready)'), 'Public application did not initialize.', 180000);
    const state=()=>b.evaluate('(()=>{const e=context.editor;return {static:e.staticPublic,canEdit:e.canEditDocument(),room:e.roomId,allowed:e.currentProject?.allowedRoomIds,scene:e.currentProject?.publicSceneId,active:e.active,failed:e.accessLoadFailed,online:context.studio.online,loading:getComputedStyle(document.getElementById("loading")).display,triangles:context.renderer.info.render.triangles,gl:context.renderer.getContext().getError(),base:document.baseURI,entries:e.getSceneEntries().map(s=>s.id||s.roomId)}})()');
    console.log('Public Chrome:', origin + base);
    await b.send('Page.navigate',{url:origin+base}); await ready(); await b.evaluate('context.studio.ready');
    let first=await state(); assert.equal(first.static,true);assert.equal(first.canEdit,false);assert.equal(first.active,false);assert.equal(first.failed,false);assert.equal(first.online,false);assert.equal(first.loading,'none');assert.equal(first.gl,0);assert(first.triangles>0);assert.equal(first.scene,'l-transfer');assert.deepEqual(first.allowed,['hall']);assert.equal(first.entries.length,1);b.report.initial=first;
    await b.screenshot('public-initial');
    await b.evaluate('context.studio.open("scenes")');await b.until(()=>b.evaluate('context.studio.content.querySelectorAll(".studio-card").length===2'), 'Static gallery did not show exactly two public examples.');
    b.report.gallery=await b.evaluate('[...context.studio.content.querySelectorAll(".studio-card strong")].map(e=>e.textContent)');await b.screenshot('public-gallery');
    await b.evaluate('context.studio.content.querySelectorAll(".studio-card button")[1].click()');
    await b.until(()=>b.evaluate('context.editor.currentProject?.publicSceneId==="inspection-sorting"&&!context.editor.loadingProject&&!context.studio.busy'), 'Second public example did not open.');
    const second=await state();assert.equal(second.scene,'inspection-sorting');assert.equal(second.room,'sound');assert.deepEqual(second.allowed,['sound']);assert.equal(second.entries.length,1);assert(second.triangles>0);assert.equal(second.gl,0);b.report.second=second;await b.screenshot('public-second');
    await b.evaluate('context.studio.open("account")');
    assert.equal(await b.evaluate('context.studio.content.querySelectorAll("input[type=password]").length'),0);
    assert(await b.evaluate('context.studio.content.textContent.includes("servidor")'));b.report.staticAccountNotice=true;
    await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    // Load with mobile metrics already in place. Switching an existing desktop
    // canvas into mobile emulation can retain Chrome's previous layout viewport.
    await b.send('Page.navigate',{url:origin+base+'?scene=inspection-sorting&qa-mobile=1'});await ready();await b.evaluate('context.studio.ready');
    await b.evaluate('context.studio.open("scenes")');await b.until(()=>b.evaluate('context.studio.content.querySelectorAll(".studio-card").length===2'), 'Mobile gallery did not open.');
    const mobile=await b.evaluate('(()=>{const r=context.studio.drawer.getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,controls:!!context.mobileNavigation,scene:context.editor.currentProject?.publicSceneId}})()');assert.equal(mobile.width,390);assert(mobile.scrollWidth<=391);assert(mobile.left>=-1&&mobile.right<=391);assert(mobile.controls);assert.equal(mobile.scene,'inspection-sorting');b.report.mobile=mobile;await b.screenshot('public-mobile');
    const resources=await b.evaluate('performance.getEntriesByType("resource").map(e=>e.name).filter(u=>new URL(u).origin===location.origin)');
    if(base!=='/')for(const url of resources.filter(u=>/\/(?:assets|res|src)\//.test(u)))assert(new URL(url).pathname.startsWith(base),url);
    assert.deepEqual(b.report.exceptions,[]);assert.deepEqual(b.report.consoleErrors,[]);assert.deepEqual(b.report.writes,[]);
    assert(b.report.apiFailures.every(v=>v.status===404&&new URL(v.url).pathname==='/api/health'),JSON.stringify(b.report.apiFailures));
    if(local){assert(local.requests.every(r=>['GET','HEAD'].includes(r.method)));assert(local.requests.filter(r=>r.status>=400).every(r=>r.path==='/api/health'||r.path==='/favicon.ico'),JSON.stringify(local.requests.filter(r=>r.status>=400)));}
    b.report.buildHash=expected;b.report.basePath=base;b.report.readOnly=true;
    fs.writeFileSync(path.join(OUTPUT,base==='/'?'public-root-browser.json':'public-subdirectory-browser.json'),JSON.stringify(b.report,null,2));
    console.log('Public Chrome passed:',JSON.stringify({base,scene:second.scene,triangles:second.triangles,screenshots:b.report.shots.length,exceptions:b.report.exceptions.length}));
  });
}

async function run(){
  const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];},expected=arg('--expected-bundle-sha256');
  assert(expected&&/^[a-f0-9]{64}$/.test(expected),'Pass the reviewed --expected-bundle-sha256.');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,'bundle.js'))).digest('hex'),expected);
  fs.mkdirSync(OUTPUT,{recursive:true});const external=arg('--origin'),serverOrigin=arg('--server-origin');
  if(serverOrigin){const url=new URL(serverOrigin);assert.equal(url.protocol,'https:');await withBrowser(url.origin,async b=>{
    await b.send('Page.navigate',{url:url.href});
    if(url.hostname.endsWith('.devtunnels.ms')){
      await b.until(()=>b.evaluate('Boolean(window.context?.editor)||/Continuar|Continue/.test(document.body?.innerText||"")'), 'The tunnel did not return the application or its one-time notice.');
      b.report.tunnelNotice=await b.evaluate('(()=>{if(window.context?.editor)return false;const button=[...document.querySelectorAll("a,button,input[type=submit]")].find(e=>/^(Continuar|Continue)$/i.test((e.textContent||e.value||"").trim()));if(!button)return false;button.click();return true;})()');
    }
    await b.until(()=>b.evaluate('Boolean(window.context?.editor&&!context.editor.initializing&&!context.editor.loadingProject&&context.studio?.ready)'), 'Public tunnel application did not initialize.');await b.evaluate('context.studio.ready');
    const state=await b.evaluate('({static:!!context.editor.staticPublic,online:context.studio.online,canEdit:context.editor.canEditDocument(),user:context.studio.client.user,scene:context.editor.currentProject?.publicSceneId,room:context.editor.roomId,triangles:context.renderer.info.render.triangles,loading:getComputedStyle(document.getElementById("loading")).display,gl:context.renderer.getContext().getError()})');
    assert.equal(state.static,false);assert.equal(state.online,true);assert.equal(state.canEdit,false);assert.equal(state.user,null);assert(state.scene);assert(state.triangles>0);assert.equal(state.loading,'none');assert.equal(state.gl,0);b.report.publicTunnel=state;await b.screenshot('public-tunnel');
    await b.evaluate('context.studio.open("scenes")');await b.until(()=>b.evaluate('context.studio.content.querySelectorAll(".studio-card").length===2'), 'Public tunnel gallery must show exactly two examples.');
    b.report.gallery=await b.evaluate('[...context.studio.content.querySelectorAll(".studio-card strong")].map(e=>e.textContent)');await b.screenshot('public-tunnel-gallery');
    assert.deepEqual(b.report.exceptions,[]);assert.deepEqual(b.report.consoleErrors,[]);assert.deepEqual(b.report.writes,[]);assert.deepEqual(b.report.apiFailures,[]);
    fs.writeFileSync(path.join(OUTPUT,'public-tunnel-browser.json'),JSON.stringify(b.report,null,2));console.log('Public tunnel Chrome passed:',JSON.stringify({origin:url.origin,scene:state.scene,triangles:state.triangles,exceptions:0,writes:0}));
  });return;}
  if(external){const url=new URL(external);assert.equal(url.protocol,'https:');await verify(url.origin,url.pathname.endsWith('/')?url.pathname:url.pathname+'/',expected);return;}
  const fixture=await startStaticServer();try{if(!arg('--base')||arg('--base')==='/')await verify(fixture.origin,'/',expected,fixture);fixture.requests.length=0;if(!arg('--base')||arg('--base')==='/webxr-simulator/')await verify(fixture.origin,'/webxr-simulator/',expected,fixture);}finally{await fixture.close();}
}
module.exports={startStaticServer,verify};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
