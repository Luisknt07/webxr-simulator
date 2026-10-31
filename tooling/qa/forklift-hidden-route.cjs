'use strict';
// Real compiled Workspace, stock authored warehouse, disposable HTTPS/SQLite
// and Chrome. Only the shared cold initial pose fixture is applied; no live
// route progress, task, score, stock ownership or pallet custody is rewritten.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const {prepare}=require('./vehicle-navigation.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/forklift-hidden-route');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

async function run(){
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const sourceFile=path.join(ROOT,'projects/smarttwin/scenes/vr-warehouse-missions.json'),source=fs.readFileSync(sourceFile),sourceSha256=hash(source),stock=JSON.parse(source);
 const input=path.join(OUT,'authored-fixture.json');fs.writeFileSync(input,JSON.stringify({document:stock.project.document}));
 const prepared=await prepare(input),workspaceSha256=hash(fs.readFileSync(path.join(ROOT,'artifacts/workspace/bundle.js')));
 assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/workspace/publication.json'))).bundleSha256,workspaceSha256,'Package the final reviewed artifact before launching QA.');
 const report={startedAt:new Date().toISOString(),workspaceSha256,sourceSha256,temporaryDatabaseOnly:true,fixture:prepared.evidence,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};
 const password='Disposable-Hidden-Route-'+randomBytes(16).toString('hex'),fixture=await startFixture(password);
 try{
  await withBrowser(fixture,report,async b=>{
   const until=(callback,message)=>b.until(callback,message,60000),shot=async name=>{const image=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(image.data,'base64'));report.screenshots.push(file);};
   await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
   await b.send('Page.navigate',{url:fixture.origin+'/editor'});await until(()=>b.evaluate('!!document.getElementById("login")'),'The disposable login did not open.');
   await b.call(password=>{const form=document.getElementById('login');form.elements.username.value='qa_production_owner';form.elements.password.value=password;form.requestSubmit();},password);
   await until(()=>b.evaluate('!!window.context&&!!context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&!!context.studio'),'Workspace did not boot.');await b.evaluate('context.studio.ready');
   const projectId=await b.call(async document=>(await context.editor.projectClient.createProject('QA hidden hologram route',document)).id,prepared.document);
   await b.send('Page.navigate',{url:fixture.origin+'/editor?project='+encodeURIComponent(projectId)+'&room='+encodeURIComponent(prepared.roomId)});
   await until(()=>b.call(room=>!!window.context&&!!context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&context.editor.roomId===room,prepared.roomId),'The authored warehouse did not open.');await b.evaluate('context.studio.ready');
   await b.call(ids=>{
    const e=context.editor;e.projectSync.stop();if(e.active)e.leave();e.simulationPaused=false;
    const s=e.simulation,d=e.vehicleDriving,record=s.records.get(ids.truckId),product=s.vehicleTraining.product(ids.productId);
    if(!d.mount(record.id))throw Error('Cannot mount the cold-authored warehouse truck.');
    const q=window.__hiddenRoute={e,s,d,record,product,execute:s.execute.bind(s)};
    // Freeze stepping only, retaining real geometry/planning and live rendering.
    // This makes before/after custody/progress comparisons exact, with no fake
    // pickup or task progress and no simulation-time effects between captures.
    s.execute=()=>{};d.holographicGuide.setEnabled(true);d.follow();d.docking.forceLayout=true;
    q.capture=async()=>{
     const g=d.holographicGuide,m=d.docking;g.update(true);m.facilityLayout.liveAt=-Infinity;m.update(true);d.updateHUD();
     const model=m.facilityLayout.model,canvasText=[],fillText=m.context.fillText;
     try{m.context.fillText=function(text,...args){canvasText.push(String(text));return fillText.call(this,text,...args);};m.paintLayout(model);}finally{m.context.fillText=fillText;}
     const state=g.getState(),v=record.components.vehicle,rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
     return {enabled:g.enabled,rootVisible:!!g.root&&g.root.visible,stats:g.getStats?g.getStats():{...g.stats},phase:state.phase,targetId:state.targetId,guidePath:state.routePath,mode:m.mode,mission:model.mission,canvasText,summary:m.summary.textContent,button:m.hologramButton.textContent,selected:m.targetSelect.value,monitor:rect(m.element),canvas:rect(m.canvas),width:innerWidth,height:innerHeight,centerBlocked:!!document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('#vehicle-operation-panels'),gl:context.renderer.getContext().getError(),document:await e.document.serialize(),physical:{time:s.time,truck:record.object.matrixWorld.toArray(),pose:JSON.stringify(v.pose),distance:v.distance,training:JSON.stringify(v.training),entry:v.entry&&v.entry.id||null,products:[...s.products.values()].map(p=>({id:p.record&&p.record.id||p.object.uuid,parent:p.object.parent&&p.object.parent.uuid,world:p.object.matrixWorld.toArray(),owner:p.vehicleOwnerId||'',reserved:p.vehicleReservedBy||'',entry:p.sourceEntry&&{id:p.sourceEntry.id,ownerId:p.sourceEntry.ownerId,location:p.sourceEntry.rackLocationCode}}))}};
    };
   },{truckId:prepared.truckId,productId:prepared.productId});
   report.on=await b.call(()=>__hiddenRoute.capture());
   assert.equal(report.on.mode,'layout');assert(report.on.enabled&&report.on.rootVisible);assert(report.on.mission&&report.on.mission.verified&&report.on.mission.route.length>=1,'The authored fixture must begin with a physically checked route or stop prefix.');
   if(report.on.mission.blocked)assert(report.on.mission.stop,'A blocked authored leg must retain its real stop marker.');else assert(report.on.mission.route.length>=2,'A clear checked route must contain a real segment.');assert(report.on.mission.pickup&&report.on.mission.destination&&report.on.mission.target);
   await shot('authored-route-hologram-on');
   await b.call(()=>{const q=__hiddenRoute;if(!q.d.command('holographicGuide'))throw Error('The actual hologram command was refused.');});
   report.off=await b.call(()=>__hiddenRoute.capture());await shot('authored-route-hologram-off');
   assert.equal(report.off.enabled,false);assert.equal(report.off.rootVisible,false);assert.equal(report.off.stats.visible,false);assert.equal(report.off.mode,'layout');assert.match(report.off.button,/OFF/);
   assert.deepEqual(report.off.mission,report.on.mission,'Hiding the spatial presentation must retain the same validated route, source and destination.');
   assert.deepEqual(report.off.guidePath,report.on.guidePath);assert.equal(report.off.targetId,report.on.targetId);assert.equal(report.off.selected,report.on.selected);
   assert(report.off.canvasText.some(text=>text==='R')&&report.off.canvasText.some(text=>text==='E'),'Pickup and delivery markers must still be painted on the real layout.');
   assert(report.off.canvasText.some(text=>(report.off.mission.blocked?/Ruta bloqueada/:/Sigue la ruta marcada/).test(text)),'The real layout footer must still explain the checked route or its actual obstruction.');
   assert(!report.off.canvasText.some(text=>/selecciona una carga/i.test(text)),'A current mission must not regress to the empty-layout prompt.');
   assert.match(report.off.summary,/Recoger:/);assert.deepEqual(report.off.physical,report.on.physical,'Presentation changes must not mutate custody, pose, simulation time, score or progress.');assert.deepEqual(report.off.document,report.on.document);
   assert.equal(report.off.gl,0);assert.equal(report.off.centerBlocked,false);assert(report.off.monitor.width>=600&&report.off.monitor.width<=780);assert(report.off.monitor.top>=0&&report.off.monitor.bottom<=report.off.height+1);assert(report.off.canvas.width>=report.off.monitor.width*.9);
   // Report compact evidence, not a duplicated full project document.
   delete report.on.document;delete report.off.document;
   await b.call(()=>{const q=__hiddenRoute;q.s.execute=q.execute;});
   report.environmentalFontRequests=report.failedRequests.filter(row=>{try{const u=new URL(row.url);return u.hostname==='code.cdn.mozilla.net'&&u.pathname.startsWith('/fonts/');}catch(_){return false;}});
   assert.deepEqual(report.failedRequests.filter(row=>!report.environmentalFontRequests.includes(row)),[]);assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin+'/')&&row.status>=400),[]);assert.deepEqual(fixture.errors,[]);
  });
  assert.equal(hash(fs.readFileSync(sourceFile)),sourceSha256,'The stock source scene changed.');assert.equal(hash(fs.readFileSync(path.join(ROOT,'artifacts/workspace/bundle.js'))),workspaceSha256,'The reviewed artifact changed during QA.');report.passed=true;return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,workspaceSha256,report:path.join(OUT,'report.json')}));}
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
