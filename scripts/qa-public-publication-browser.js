'use strict';
// Real Chrome against a disposable static server: no live account/database writes.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https');
const {createHash} = require('node:crypto');
const {withBrowser: sharedBrowser} = require('./qa-project-workspace-browser');
const {prepare} = require('./prepare-pages-site');
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'data/qa-studio');
async function withBrowser(origin, action) {
  let completed = false, result;
  try { return await sharedBrowser(origin, async browser => {
    try { result = await action(browser); completed = true; return result; }
    catch (error) { browser.report.resources = await browser.evaluate('performance.getEntriesByType("resource").map(e=>({url:e.name,status:e.responseStatus,bytes:e.transferSize}))').catch(()=>[]); throw error; }
  }); }
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
  // Exercise the exact allowlisted Pages artifact, never the larger checkout.
  // Otherwise undeployed files can make a broken publication appear healthy.
  const artifact = prepare(), siteRoot = fs.realpathSync(artifact.output);
  const requests = [], certificate = fs.readFileSync(path.join(ROOT, 'node_modules/webpack-dev-server/ssl/server.pem'));
  const mime = {'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ogg':'audio/ogg','.mp3':'audio/mpeg','.wav':'audio/wav','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.wasm':'application/wasm','.woff2':'font/woff2'};
  const server = https.createServer({key:certificate,cert:certificate}, (req,res) => {
    const pathname = new URL(req.url, 'https://localhost').pathname, entry = {path:pathname,method:req.method}; requests.push(entry);
    const end = status => {entry.status=status;res.writeHead(status, {'Content-Type':'application/json'});res.end(JSON.stringify({error:'Not available on a static host'}));};
    if (!['GET','HEAD'].includes(req.method)) return end(405);
    let relative; try {relative=decodeURIComponent(pathname).replace(/^\/webxr-simulator\//,'/').replace(/^\/+/, '');} catch (_) {return end(400);}
    if (!relative || relative === 'editor' || relative === 'editor/') relative='index.html';
    if (/^api(?:\/|$)/.test(relative)) return end(404);
    const allowed=['assets/','res/','src/'].some(prefix=>relative.startsWith(prefix)) || /^(?:index\.html|publication\.json|bundle\.js|collision-worker\.js|mesh-optimizer-worker\.js)$/.test(relative);
    const file=path.resolve(siteRoot,relative); if(!allowed||!file.startsWith(siteRoot+path.sep)) return end(404);
    fs.stat(file,(error,stat)=>{if(error||!stat.isFile())return end(404);entry.status=200;res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin:'https://localhost:'+server.address().port,requests,publication:artifact.publication,close:()=>new Promise(resolve=>server.close(resolve))};
}

async function waitForApplication(browser, message) {
  await browser.until(async()=>{
    const state=await browser.evaluate('({ready:Boolean(window.context?.editor&&!context.editor.initializing&&!context.editor.loadingProject&&context.studio?.ready),failed:!!document.querySelector("#loading.loading-failed"),error:document.getElementById("loading-error")?.textContent})');
    if(state.failed)throw new Error('Published startup failed: '+state.error);
    return state.ready;
  },message,180000);
  await browser.evaluate('context.studio.ready');
}

// The publication policy can temporarily expose the entire included catalog.
// Its metadata, rather than a fixed DOM count or particular scene IDs, is the
// contract for both that preview and the normal two-scene publication.
function validateCatalog(catalog) {
  assert(catalog && Array.isArray(catalog.scenes), 'Public catalog is missing its scenes.');
  assert(catalog.scenes.length >= 2 && catalog.scenes.length <= 64, 'Public QA requires at least two bounded examples.');
  assert.equal(new Set(catalog.scenes.map(scene => scene.id)).size, catalog.scenes.length, 'Duplicate public scene IDs.');
  for (const scene of catalog.scenes) {
    assert(/^[a-z0-9-]{1,80}$/.test(scene.id), 'Invalid public scene ID.');
    assert(typeof scene.roomId === 'string' && scene.roomId.length, 'Public scene has no room ID.');
    assert(typeof scene.name === 'string' && scene.name.length, 'Public scene has no display name.');
    assert.notEqual(scene.public, false, 'The anonymous catalog contains a non-public entry.');
  }
  if (catalog.previewAllExamples === true) {
    assert.equal(catalog.requiresLogin, false, 'The included preview must be accessible without login.');
    assert.equal(catalog.includedCount, catalog.scenes.length, 'Preview is missing included examples.');
  } else {
    assert.equal(catalog.requiresLogin, true, 'Restricted publication must explain access to further examples.');
    assert.equal(catalog.maxActive, 2);
    assert.equal(catalog.scenes.length, 2, 'Restricted publication must expose its two configured scenes.');
  }
  return catalog;
}

function validatePublicProjection(value, scene, preview) {
  assert.equal(value.status, 200, 'Anonymous example is unavailable: ' + scene.id);
  assert.equal(value.scene, scene.id);
  assert.equal(value.projectId, scene.projectId || 'public-' + scene.id);
  assert.deepEqual(value.rooms, [scene.roomId], 'Public example leaks or omits room data: ' + scene.id);
  assert.deepEqual(value.allowed, [scene.roomId]);
  assert.deepEqual(value.access, {role: 'public', canEdit: false, canShare: false});
  assert.equal(value.privateResources, false, 'Public example exposes a private resource browser: ' + scene.id);
  if (preview) assert.equal(value.imports, 0, 'Included example must not depend on private uploads: ' + scene.id);
}

async function readCatalog(browser, staticPublic) {
  const result = await browser.call(async isStatic => {
    const url = new URL(isStatic ? 'assets/public-scenes/catalog.json' : '/api/public/scenes', isStatic ? document.baseURI : location.origin);
    const response = await fetch(url.href, {credentials: 'omit', cache: 'no-store'});
    return {status: response.status, catalog: await response.json()};
  }, staticPublic);
  assert.equal(result.status, 200, 'Anonymous public catalog is unavailable.');
  const catalog = validateCatalog(result.catalog);
  browser.report.catalog = {previewAllExamples: !!catalog.previewAllExamples, requiresLogin: catalog.requiresLogin, count: catalog.scenes.length, ids: catalog.scenes.map(scene => scene.id)};
  return catalog;
}

async function verifyAnonymousExamples(browser, catalog, staticPublic) {
  // Read each projection sequentially, without constructing every world or
  // retaining the large JSON documents behind the metadata-only gallery.
  const projections = await browser.call(async (scenes, isStatic) => {
    const summaries = [];
    for (const scene of scenes) {
      const url = new URL(isStatic ? 'assets/public-scenes/' + encodeURIComponent(scene.id) + '.json' : '/api/public/scenes/' + encodeURIComponent(scene.id), isStatic ? document.baseURI : location.origin);
      const response = await fetch(url.href, {credentials: 'omit', cache: 'no-store'}), result = await response.json(), project = result && result.project;
      const documentValue = project && project.document, studio = documentValue && documentValue.studio;
      summaries.push({status: response.status, scene: project && project.publicSceneId, projectId: project && project.id,
        rooms: Object.keys(documentValue && documentValue.rooms || {}), allowed: project && project.allowedRoomIds, access: project && project.access,
        imports: (documentValue && documentValue.imports || []).length, privateResources: !!(studio && (studio.resources || studio.folders))});
    }
    return summaries;
  }, catalog.scenes, staticPublic);
  assert.equal(projections.length, catalog.scenes.length);
  projections.forEach((value, index) => validatePublicProjection(value, catalog.scenes[index], catalog.previewAllExamples));
  browser.report.anonymousExamples = projections;
}

async function openGallery(browser, catalog) {
  await browser.evaluate('context.studio.open("scenes")');
  await browser.until(() => browser.call(count => context.studio.content.querySelectorAll('.studio-card').length === count && !context.studio.busy, catalog.scenes.length), 'Public gallery does not match its catalog (' + catalog.scenes.length + ' examples).');
  const cards = await browser.evaluate('[...context.studio.content.querySelectorAll(".studio-card")].map(e=>({id:e.dataset.sceneId,name:e.querySelector("strong")?.textContent,visible:!e.hidden}))');
  assert.deepEqual(cards.map(card=>card.id).sort(),catalog.scenes.map(scene=>scene.id).sort(),'Grouped public gallery differs from its authorized metadata.');
  cards.forEach(card=>{assert.equal(card.name,catalog.scenes.find(scene=>scene.id===card.id)?.name);assert(card.visible);});
  return cards.map(card=>card.name);
}

async function openGalleryScene(browser, catalog, index) {
  const scene = catalog.scenes[index];
  assert(await browser.call((id, name) => {
    const card = [...context.studio.content.querySelectorAll('.studio-card')].find(node=>node.dataset.sceneId===id&&!node.hidden);
    if (!card || card.querySelector('strong')?.textContent !== name || !card.querySelector('button')) return false;
    card.querySelector('button').click(); return true;
  }, scene.id, scene.name), 'Public gallery has no matching action: ' + scene.id);
  await browser.until(() => browser.call(id => context.editor.currentProject?.publicSceneId === id && !context.editor.loadingProject && !context.studio.busy && context.studio.drawer.hidden, scene.id), 'Public example did not open: ' + scene.id);
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  return scene;
}

async function verifyGalleryUX(browser,catalog) {
  const original=await browserState(browser);await openGallery(browser,catalog);
  const before=await browser.call(()=>{
    const library=context.editor.accessView.sceneLibrary,drawer=context.studio.drawer,rect=drawer.getBoundingClientRect();
    window.__qaVisitorLibrary=library;window.__qaVisitorCards=library.cards.map(value=>value.card);
    return {modal:drawer.classList.contains('studio-scene-library-modal'),role:drawer.getAttribute('role'),ariaModal:drawer.getAttribute('aria-modal'),width:rect.width,viewport:innerWidth,
      groups:[...context.studio.content.querySelectorAll('.studio-scene-category-title')].map(node=>node.textContent),canvases:context.studio.content.querySelectorAll('canvas').length,
      actions:[...context.studio.content.querySelectorAll('.studio-scene-card button')].map(node=>node.textContent),images:library.images.map(image=>({loading:image.loading,decoding:image.decoding,url:image.src}))};
  });
  assert(before.modal&&before.role==='dialog'&&before.ariaModal==='true');if(before.viewport>=900)assert(before.width>before.viewport*.6,'The visitor library must be a wide modal.');
  assert.equal(before.canvases,0,'Opening the gallery must not construct 3D preview canvases.');assert(before.actions.every(label=>/^(Explorar escenario|Continuar en este escenario)$/.test(label)));
  before.images.forEach(image=>{assert.equal(image.loading,'lazy');assert.equal(image.decoding,'async');assert(new URL(image.url).pathname.includes('/assets/scene-thumbnails/'));});
  if(before.images.length)await browser.until(()=>browser.call(()=>{
    const host=context.editor.accessView.sceneLibrary.results.getBoundingClientRect();
    const visible=[...context.studio.content.querySelectorAll('.studio-scene-card:not([hidden]) img')].filter(image=>{const r=image.getBoundingClientRect();return r.bottom>host.top&&r.top<host.bottom;});
    return visible.length>0&&visible.every(image=>image.complete&&image.naturalWidth>0);
  }),'Visible offline scene images did not load.',30000);
  const target=catalog.scenes.find(scene=>scene.id==='forklift-training')||catalog.scenes[0];
  await browser.call(()=>context.editor.accessView.sceneLibrary.search.focus());await browser.send('Input.insertText',{text:target.name});
  const filtered=await browser.call(()=>({ids:context.editor.accessView.sceneLibrary.cards.filter(value=>!value.card.hidden).map(value=>value.entry.id),sameNodes:context.editor.accessView.sceneLibrary.cards.every((value,index)=>value.card===__qaVisitorCards[index]),canvases:context.studio.content.querySelectorAll('canvas').length}));
  assert(filtered.ids.includes(target.id));if(catalog.scenes.length>1)assert(filtered.ids.length<catalog.scenes.length);assert(filtered.sameNodes);assert.equal(filtered.canvases,0);
  await browser.call(()=>{const library=context.editor.accessView.sceneLibrary;library.search.value='';library.search.dispatchEvent(new Event('input',{bubbles:true}));library.categorySelect.value=library.entries[library.entries.length-1].category;library.categorySelect.dispatchEvent(new Event('change',{bubbles:true}));});
  const grouped=await browser.call(()=>{const library=context.editor.accessView.sceneLibrary;return {category:library.category,shown:library.cards.filter(value=>!value.card.hidden).map(value=>({id:value.entry.id,category:value.entry.category})),headings:[...library.results.querySelectorAll('.studio-scene-category')].filter(node=>!node.hidden).length};});
  assert(grouped.shown.length>0);assert(grouped.shown.every(value=>value.category===grouped.category));assert.equal(grouped.headings,1);
  await browser.screenshot('public-library-filtered');
  for(const type of ['keyDown','keyUp'])await browser.send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
  await browser.until(()=>browser.evaluate('context.studio.drawer.hidden'),'Escape did not close the visitor library.');
  const closed=await browser.evaluate('({disposed:__qaVisitorLibrary.disposed,images:__qaVisitorLibrary.images.length,listeners:__qaVisitorLibrary.listeners.length+__qaVisitorLibrary.cardListeners.length,content:!!document.querySelector(".studio-scene-library")})');
  assert.deepEqual(closed,{disposed:true,images:0,listeners:0,content:false});
  await openGallery(browser,catalog);assert.equal(await browser.evaluate('context.editor.accessView.sceneLibrary.search.value'),'');
  assert.equal((await browserState(browser)).scene,original.scene,'Filtering and reopening never load another world.');
  await browser.evaluate('delete window.__qaVisitorLibrary;delete window.__qaVisitorCards');
  browser.report.libraryUX={before,filtered,grouped,closed,readOnly:true};return browser.report.libraryUX;
}

function validateLoadedScene(state, scene) {
  assert.equal(state.scene, scene.id); assert.equal(state.room, scene.roomId);
  assert.deepEqual(state.allowed, [scene.roomId]); assert.deepEqual(state.entries, [scene.roomId]);
  assert.equal(state.canEdit, false); assert.equal(state.active, false); assert.equal(state.failed, false);
  assert.equal(state.loading, 'none'); assert(state.triangles > 0); assert.equal(state.gl, 0);
}

function browserState(browser) {
  return browser.evaluate('(()=>{const e=context.editor;return {static:e.staticPublic,canEdit:e.canEditDocument(),room:e.roomId,allowed:e.currentProject?.allowedRoomIds,scene:e.currentProject?.publicSceneId,active:e.active,failed:e.accessLoadFailed,online:context.studio.online,loading:getComputedStyle(document.getElementById("loading")).display,triangles:context.renderer.info.render.triangles,gl:context.renderer.getContext().getError(),base:document.baseURI,entries:e.getSceneEntries().map(s=>s.id||s.roomId)}})()');
}

async function verifyMobile(browser, url, catalog) {
  await browser.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
  await browser.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
  // Reload with mobile metrics to avoid retaining Chrome's desktop viewport.
  const destination = new URL(url); destination.searchParams.set('scene', catalog.scenes[1].id); destination.searchParams.set('qa-mobile', '1');
  destination.searchParams.delete('project'); destination.searchParams.delete('room'); destination.searchParams.delete('libraryScene');
  await browser.send('Page.navigate', {url: destination.href});
  await waitForApplication(browser, 'Mobile public example did not initialize.');
  validateLoadedScene(await browserState(browser), catalog.scenes[1]);
  await openGallery(browser, catalog);
  const mobile = await browser.evaluate('(()=>{const r=context.studio.drawer.getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,controls:!!context.mobileNavigation,scene:context.editor.currentProject?.publicSceneId}})()');
  assert.equal(mobile.width, 390); assert(mobile.scrollWidth <= 391); assert(mobile.left >= -1 && mobile.right <= 391); assert(mobile.controls); assert.equal(mobile.scene, catalog.scenes[1].id);
  browser.report.mobile = mobile; await browser.screenshot('public-mobile');
  await openGalleryScene(browser, catalog, 0);
  validateLoadedScene(await browserState(browser), catalog.scenes[0]);
  browser.report.mobileNavigation = {from: catalog.scenes[1].id, to: catalog.scenes[0].id};
  await browser.screenshot('public-mobile-first');
}

async function verify(origin, base, expected, local) {
  return withBrowser(origin, async b => {
    const ready=()=>waitForApplication(b,'Public application did not initialize.');
    console.log('Public Chrome:', origin + base);
    await b.send('Page.navigate',{url:origin+base}); await ready(); await b.evaluate('context.studio.ready');
    const catalog=await readCatalog(b,true),first=await browserState(b);validateLoadedScene(first,catalog.scenes[0]);assert.equal(first.static,true);assert.equal(first.online,false);b.report.initial=first;
    await b.screenshot('public-initial');
    b.report.gallery=await openGallery(b,catalog);await b.screenshot('public-gallery');await verifyGalleryUX(b,catalog);
    await openGalleryScene(b,catalog,1);
    const second=await browserState(b);validateLoadedScene(second,catalog.scenes[1]);b.report.second=second;await b.screenshot('public-second');
    await verifyAnonymousExamples(b,catalog,true);
    await b.evaluate('context.studio.open("account")');
    assert.equal(await b.evaluate('context.studio.content.querySelectorAll("input[type=password]").length'),0);
    assert(await b.evaluate('context.studio.content.textContent.includes("servidor")'));b.report.staticAccountNotice=true;
    await verifyMobile(b,origin+base,catalog);
    const resources=await b.evaluate('performance.getEntriesByType("resource").map(e=>e.name).filter(u=>new URL(u).origin===location.origin)');
    if(base!=='/')for(const url of resources.filter(u=>/\/(?:assets|res|src)\//.test(u)))assert(new URL(url).pathname.startsWith(base),url);
    assert.deepEqual(b.report.exceptions,[]);assert.deepEqual(b.report.consoleErrors,[]);assert.deepEqual(b.report.writes,[]);
    assert(b.report.apiFailures.every(v=>v.status===404&&new URL(v.url).pathname==='/api/health'),JSON.stringify(b.report.apiFailures));
    if(local){assert(local.requests.every(r=>['GET','HEAD'].includes(r.method)));assert(local.requests.filter(r=>r.status>=400).every(r=>r.path==='/api/health'||r.path==='/favicon.ico'),JSON.stringify(local.requests.filter(r=>r.status>=400)));}
    if(local){assert.equal(local.publication.bundleSha256,expected);b.report.artifact=local.publication;}
    b.report.buildHash=expected;b.report.basePath=base;b.report.readOnly=true;
    fs.writeFileSync(path.join(OUTPUT,base==='/'?'public-root-browser.json':'public-subdirectory-browser.json'),JSON.stringify(b.report,null,2));
    console.log('Public Chrome passed:',JSON.stringify({base,scene:second.scene,examples:catalog.scenes.length,preview:!!catalog.previewAllExamples,triangles:second.triangles,screenshots:b.report.shots.length,exceptions:b.report.exceptions.length}));
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
    await waitForApplication(b,'Public tunnel application did not initialize.');
    const catalog=await readCatalog(b,false),state=await browserState(b),initialScene=catalog.scenes.find(scene=>scene.id===state.scene);
    assert(initialScene,'Server opened a scene outside its anonymous catalog.');validateLoadedScene(state,initialScene);
    assert.equal(state.static,false);assert.equal(state.online,true);assert.equal(await b.evaluate('context.studio.client.user'),null);b.report.publicTunnel=state;await b.screenshot('public-tunnel');
    b.report.gallery=await openGallery(b,catalog);await b.screenshot('public-tunnel-gallery');await verifyGalleryUX(b,catalog);
    await openGalleryScene(b,catalog,1);const second=await browserState(b);validateLoadedScene(second,catalog.scenes[1]);b.report.second=second;await b.screenshot('public-tunnel-second');
    await verifyAnonymousExamples(b,catalog,false);
    await verifyMobile(b,url.href,catalog);
    assert.deepEqual(b.report.exceptions,[]);assert.deepEqual(b.report.consoleErrors,[]);assert.deepEqual(b.report.writes,[]);assert.deepEqual(b.report.apiFailures,[]);
    b.report.buildHash=expected;b.report.readOnly=true;
    fs.writeFileSync(path.join(OUTPUT,'public-tunnel-browser.json'),JSON.stringify(b.report,null,2));console.log('Public tunnel Chrome passed:',JSON.stringify({origin:url.origin,scene:second.scene,examples:catalog.scenes.length,preview:!!catalog.previewAllExamples,triangles:second.triangles,exceptions:0,writes:0}));
  });return;}
  if(external){const url=new URL(external);assert.equal(url.protocol,'https:');await verify(url.origin,url.pathname.endsWith('/')?url.pathname:url.pathname+'/',expected);return;}
  const fixture=await startStaticServer();try{if(!arg('--base')||arg('--base')==='/')await verify(fixture.origin,'/',expected,fixture);fixture.requests.length=0;if(!arg('--base')||arg('--base')==='/webxr-simulator/')await verify(fixture.origin,'/webxr-simulator/',expected,fixture);}finally{await fixture.close();}
}
module.exports={startStaticServer,verify,withBrowser,validateCatalog,validatePublicProjection,validateLoadedScene,readCatalog,verifyAnonymousExamples,openGallery,openGalleryScene,verifyGalleryUX,verifyMobile};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
