'use strict';
// Real compiled Workspace + authored warehouse + disposable HTTPS/SQLite/Chrome.
// The only fixture edit is the declared cold initial truck pose from the shared
// physical helper. Routes, missions, stock, pallet pockets and custody stay real.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const {prepare}=require('./fork-entry-assistance.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/forklift-wide-production');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));

function verify(state){
 const {width,height,rects}=state;
 assert.equal(state.viewport,'wide');assert.equal(state.expanded,true);assert.equal(state.minimized,false);
 assert.deepEqual(state.groups.map(group=>group.name),['drive','cargo','view','safety']);
 assert(state.groups.every(group=>group.buttons>0&&group.headingVisible),'Every supported control category must be open and labelled.');
 assert(state.buttons.length>=30,'The mounted truck must expose its complete supported controls.');
 assert.deepEqual(state.clippedLabels,[],'Control labels must fit their buttons without ellipsis.');
 assert.deepEqual(state.hiddenControls,[],'Supported controls must remain visible inside the full desktop console.');
 assert.deepEqual(state.unsupportedDisplayed,[],'Unsupported controls marked hidden must not consume console space.');
 assert(state.hudScrollHeight<=state.hudClientHeight+1,'All wide desktop controls must fit without scrolling.');
 assert(state.hudScrollWidth<=state.hudClientWidth+1,'Control content must fit horizontally.');
 assert.equal(state.centerBlocked,false,'The central driving view must remain free.');
 assert.equal(state.pageOverflow,false);assert.equal(state.mode,'inspection');
 assert.equal(state.gl,0);assert.equal(state.camera.failures,0);assert(state.camera.frontFrames>1&&state.camera.targetAllocated,'The real inspection feed must render frames.');
 assert.equal(state.camera.mode,'isometric');assert.equal(state.camera.selectedFeed,'front');
 assert(state.separateObjectives,'Mission objectives must remain outside the camera panel.');
 for(const name of ['hud','guidance','monitor','plan','feed','metrics']){
  const r=rects[name];assert(r&&r.width>0&&r.height>0,name+' must be visible.');
  assert(r.left>=-1&&r.top>=-1&&r.right<=width+1&&r.bottom<=height+1,name+' must fit '+width+'x'+height);
 }
 assert.equal(overlap(rects.hud,rects.guidance),0,'Mission and control panels must not overlap.');
 assert.equal(overlap(rects.plan,rects.feed),0,'The insertion plan must have its own column beside the video.');
 assert(Math.abs(rects.feed.width/rects.feed.height-16/9)<.02,'The camera opening must preserve its optical aspect ratio.');
 assert(state.camera.width>=rects.feed.width,'The enlarged camera must receive enough rendered pixels for its displayed width.');
 assert(rects.plan.width>=165);assert(rects.hud.width>=500);
 assert(rects.monitor.width>=(width>=2560?940:width>=1920?700:550));
 assert(rects.feed.width>=(width>=2560?680:width>=1920?500:350),'The wide camera must be larger than the former compact feed.');
 assert(state.stock.sameEntry&&state.stock.samePockets&&!state.stock.truckHasLoad,'UI verification must retain original pallet custody.');
}

async function run(){
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const sourceFile=path.join(ROOT,'projects/smarttwin/scenes/vr-warehouse-missions.json'),sourceBytes=fs.readFileSync(sourceFile),sourceHash=hash(sourceBytes),source=JSON.parse(sourceBytes);
 const fixtureDocument=path.join(OUT,'authored-fixture.json');fs.writeFileSync(fixtureDocument,JSON.stringify({document:source.project.document}));
 const prepared=await prepare(fixtureDocument),workspaceSha256=hash(fs.readFileSync(path.join(ROOT,'artifacts/workspace/bundle.js'))),publicSha256=hash(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js')));
 assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/workspace/publication.json'))).bundleSha256,workspaceSha256,'Compile the reviewed Workspace before running QA.');
 assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/publication.json'))).bundleSha256,publicSha256);
 const report={startedAt:new Date().toISOString(),workspaceSha256,publicSha256,temporaryDatabaseOnly:true,sourceSha256:sourceHash,fixture:prepared.evidence,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],viewports:[]};
 const password='Disposable-Wide-Forklift-'+randomBytes(16).toString('hex'),fixture=await startFixture(password);
 try{
  await withBrowser(fixture,report,async b=>{
   const until=(callback,message)=>b.until(callback,message,60000),shot=async name=>{const image=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(image.data,'base64'));report.screenshots.push(file);};
   await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
   await b.send('Page.navigate',{url:fixture.origin+'/editor'});await until(()=>b.evaluate('!!document.getElementById("login")'),'The disposable login did not open.');
   await b.call(password=>{const form=document.getElementById('login');form.elements.username.value='qa_production_owner';form.elements.password.value=password;form.requestSubmit();},password);
   await until(()=>b.evaluate('!!window.context&&!!context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&!!context.studio'),'Workspace did not boot.');await b.evaluate('context.studio.ready');
   const projectId=await b.call(async document=>(await context.editor.projectClient.createProject('QA wide desktop forklift',document)).id,prepared.document);
   for(const [width,height]of [[1920,1080],[2560,1440],[1440,900]]){
    console.log('Wide production forklift: '+width+'x'+height);
    await b.send('Page.navigate',{url:'about:blank'});await until(()=>b.evaluate('location.href==="about:blank"'),'The previous renderer did not unload.');
    await b.send('Emulation.clearDeviceMetricsOverride');await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await b.send('Page.navigate',{url:fixture.origin+'/editor?project='+encodeURIComponent(projectId)+'&room='+encodeURIComponent(prepared.roomId)});
    await until(()=>b.call(room=>!!window.context&&!!context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&context.editor.roomId===room,prepared.roomId),'The prepared warehouse did not open.');await b.evaluate('context.studio.ready');
    await b.call(ids=>{
     const e=context.editor;e.projectSync.stop();if(e.active)e.leave();e.simulationPaused=false;
     const s=e.simulation,d=e.vehicleDriving,record=s.records.get(ids.truckId),v=record.components.vehicle,product=s.vehicleTraining.product(ids.productId);
     if(!d.mount(record.id))throw Error('Cannot mount the cold-authored warehouse truck.');
     d.holographicGuide.setEnabled(true);d.follow();d.frontVisibility.update();d.docking.forkCamera.setMode('isometric');d.docking.update(true);d.updateHUD();
     const q=window.__wideForklift={e,s,d,record,v,product,entry:product.sourceEntry,pockets:JSON.stringify(s.vehicleRuntime.productPockets(product)),execute:s.execute.bind(s)};
     // Existing deterministic collision stepping, with no direct mission writes.
     s.execute=()=>{};q.motion=()=>{const w=context.collisionWorld,own=w&&w.beginFrame&&w.endFrame&&!w.frameActive;if(own)w.beginFrame();try{s.time+=1/60;s.vehicleRuntime.step(1/60);s.vehicleTraining.step(1/60);}finally{if(own)w.endFrame();}};
    },{truckId:prepared.truckId,productId:prepared.productId});
    let approach;
    for(let chunk=0;chunk<45;chunk++){
     approach=await b.call(()=>{const q=__wideForklift;for(let i=0;i<45;i++){if(q.v.distance>=1.22&&Math.abs(q.v.actualSpeed)<.001)break;q.s.vehicleRuntime.setInput(q.record,q.v.distance>=1.22?{brake:1}:{throttle:.18});q.motion();if(q.v.blocked)throw Error('The real short approach met an obstacle: '+q.v.warning);}q.d.follow();q.d.docking.update(true);q.d.updateHUD();return {distance:q.v.distance,speed:q.v.actualSpeed,complete:q.v.distance>=1.22&&Math.abs(q.v.actualSpeed)<.001};});
     if(approach.complete)break;
    }
    assert(approach.complete,'The physical approach did not finish.');
    await b.call(()=>{const q=__wideForklift;q.s.execute=q.execute;q.d.follow();q.d.docking.update(true);q.d.updateHUD();});
    await until(()=>b.evaluate('__wideForklift.d.docking.forkCamera.getStats().frontFrames>1'),'The actual auxiliary camera did not render.');
    const state=await b.call(()=>{
     const q=__wideForklift,{d,s,v}=q,m=d.docking,rect=node=>{if(!node||node.hidden||!node.getClientRects().length)return null;const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};},hud=rect(d.hud),clippedLabels=[],hiddenControls=[],unsupportedDisplayed=[],buttons=[];
     for(const [name,button]of d.controlButtons){if(button.hidden){if(button.getClientRects().length&&getComputedStyle(button).display!=='none')unsupportedDisplayed.push(name);continue;}const r=rect(button),label=button.controlLabel,c=label&&getComputedStyle(label);buttons.push(name);if(!r||r.top<hud.top-1||r.bottom>hud.bottom+1)hiddenControls.push(name);if(label&&(label.scrollWidth>label.clientWidth+1||label.scrollHeight>label.clientHeight+1||c.textOverflow==='ellipsis'))clippedLabels.push(name);}
     const center=document.elementFromPoint(innerWidth/2,innerHeight/2);
     return {width:innerWidth,height:innerHeight,viewport:d.hud.dataset.viewport,expanded:d.controlsExpanded,minimized:d.controlsMinimized,mode:m.mode,camera:m.forkCamera.getStats(),groups:d.controlGroups.filter(g=>!g.hidden&&getComputedStyle(g).display!=='none').map(g=>({name:g.dataset.group,buttons:g.controls.filter(b=>!b.hidden).length,headingVisible:getComputedStyle(g.heading).display!=='none'})),buttons,clippedLabels,hiddenControls,unsupportedDisplayed,hudScrollHeight:d.hud.scrollHeight,hudClientHeight:d.hud.clientHeight,hudScrollWidth:d.hud.scrollWidth,hudClientWidth:d.hud.clientWidth,centerBlocked:!!(center&&center.closest('#vehicle-operation-panels')),centerElement:center&&center.className,pageOverflow:document.documentElement.scrollWidth>innerWidth,separateObjectives:!m.element.contains(m.guidancePanel),rects:{hud,guidance:rect(m.guidancePanel),monitor:rect(m.element),plan:rect(m.plan),feed:rect(m.feedViewport),metrics:rect(m.metrics)},stock:{sameEntry:q.product.sourceEntry===q.entry,samePockets:JSON.stringify(s.vehicleRuntime.productPockets(q.product))===q.pockets,truckHasLoad:!!v.entry},lesson:s.vehicleTraining.guidance(q.record),gl:context.renderer.getContext().getError()};
    });
    state.approach=approach;report.viewports.push(state);await shot('wide-driving-'+width+'x'+height);verify(state);
   }
   report.environmentalFontRequests=report.failedRequests.filter(row=>{try{const u=new URL(row.url);return u.hostname==='code.cdn.mozilla.net'&&u.pathname.startsWith('/fonts/');}catch(_){return false;}});
   assert.deepEqual(report.failedRequests.filter(row=>!report.environmentalFontRequests.includes(row)),[]);assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin+'/')&&row.status>=400),[]);assert.deepEqual(fixture.errors,[]);
  });
  assert.equal(hash(fs.readFileSync(sourceFile)),sourceHash,'The original stock warehouse scene must remain unchanged.');
  assert.equal(hash(fs.readFileSync(path.join(ROOT,'artifacts/workspace/bundle.js'))),workspaceSha256,'The reviewed Workspace artifact changed during QA.');
  assert.equal(hash(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))),publicSha256,'The reviewed public artifact changed during QA.');report.passed=true;return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,workspaceSha256,viewports:report.viewports.length,report:path.join(OUT,'report.json')}));}
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
