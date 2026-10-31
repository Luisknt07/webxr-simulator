'use strict';
// Compiled public viewer, real robot/pallet/receiver physics, disposable HTTPS
// server and Chrome. Pose changes below are isolated QA fixtures, not controls.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/drop-placement-production');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function run({expectedPublicSha256}={}){
 assert.match(expectedPublicSha256||'',/^[a-f0-9]{64}$/,'Pass --expected-public-sha256 for the compiled public viewer.');
 const bundle=path.join(ROOT,'artifacts/public-viewer/viewer.js');assert.equal(hash(fs.readFileSync(bundle)),expectedPublicSha256);
 assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/publication.json'))).bundleSha256,expectedPublicSha256);
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const report={startedAt:new Date().toISOString(),bundleSha256:expectedPublicSha256,temporaryDatabaseOnly:true,externalServicesUsed:false,poseFixturesOnly:true,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],viewports:[]};
 const fixture=await startFixture('Disposable-Placement-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});
 try{
  await withBrowser(fixture,report,async b=>{
   const until=(callback,message)=>b.until(callback,message,60000),shot=async name=>{const image=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(image.data,'base64'));report.screenshots.push(file);};
   await b.send('Network.setBlockedURLs',{urls:['https://code.cdn.mozilla.net/*','https://fonts.googleapis.com/*','https://fonts.gstatic.com/*']});
   await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`new MutationObserver(function(_,observer){if(!document.documentElement)return;const style=document.createElement('style');style.textContent='*{font-family:system-ui,sans-serif!important}';document.documentElement.appendChild(style);observer.disconnect();}).observe(document,{childList:true,subtree:true});`});
   await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
   await b.send('Page.navigate',{url:fixture.origin+'/#escenarios'});
   await until(()=>b.evaluate('!!window.smartTwinGallery&&smartTwinGallery.getStats().screen==="gallery"'),'The public scene gallery did not open.');
   await b.call(()=>document.querySelector('.scene-open[data-scene-id="vr-robot-dispatch"]').click());
   await until(()=>b.evaluate('!!window.smartTwinViewer&&!!smartTwinViewer.context.demo&&!!smartTwinViewer.context.demo.simulation'),'The compiled public demonstration did not open.');
   report.pickup=await b.call(()=>{
    const api=smartTwinViewer,ctx=api.context,s=ctx.demo.simulation,T=api.THREE,record=[...s.records.values()].find(r=>r.components.vehicle),v=record.components.vehicle,belt=s.records.get(v.config.sourceId);
    ctx.demo.setPaused(true);if(ctx.voiceAssistant)ctx.voiceAssistant.setAutomatic(false);
    for(let i=0;i<3600&&!belt.components.conveyor.packages.length;i++){ctx.scene.updateMatrixWorld(true);s.execute(1/60);}
    for(let i=0;i<1800&&belt.components.conveyor.actualSpeed;i++){ctx.scene.updateMatrixWorld(true);s.execute(1/60);}
    const product=belt.components.conveyor.packages[0]&&belt.components.conveyor.packages[0].product;if(!product)throw Error('The real robot did not supply a pallet.');
    const direction=new T.Vector3(0,0,1).applyQuaternion(record.object.quaternion),dock=s.vehicleRuntime.pickupDock(record,{yaw:Math.atan2(direction.x,direction.z),targetId:belt.id},product);
    if(!dock)throw Error('The real pickup dock was not available.');
    record.object.position.copy(dock.position);record.object.rotation.y=dock.yaw;record.object.updateMatrixWorld(true);s.vehicleRuntime.applyPose(record,{...v.pose,lift:dock.toolY-v.originWorld.y-v.config.forkBaseHeight},false);
    const d=ctx.demo.driving;if(!d.mount(record.id))throw Error('The truck could not be mounted.');d.command('power',true);d.command('start',true);d.command('parkingBrake',false);d.follow();d.holographicGuide.update(true);d.docking.update(true);
    const physical=s.vehicleRuntime.getDockingState(record);if(!physical.ready)throw Error('Physical pickup: '+physical.reason);d.command('pickup');s.execute(1/60);
    if(!v.entry||v.entry.product!==product)throw Error('Pickup did not retain the actual pallet.');
    record.object.position.addScaledVector(new T.Vector3(Math.sin(dock.yaw),0,Math.cos(dock.yaw)),-1.6);record.object.updateMatrixWorld(true);s.vehicleRuntime.applyPose(record,{...v.pose,lift:Math.max(v.pose.lift,v.config.carryHeight)},false);
    d.holographicGuide.update(true);const target=d.holographicGuide.currentTarget;if(!target||!target.allowed||!target.destination)throw Error('No real receiving position was available.');
    const drop=s.vehicleRuntime.dropDock(record,{targetId:target.targetId},target.destination);if(!drop)throw Error('No real unload dock.');
    d.holographicGuide.setTarget(target.id);
    window.__dropQA={api,ctx,s,T,d,record,v,product,entry:v.entry,targetId:target.id,destinationId:target.targetId,drop,metadata:JSON.stringify(s.productMetadata(product)),targetFootprint:null};
    window.__dropQA.place=function(lateral,longitudinal,height,yaw){const q=this,side=new T.Vector3(Math.cos(drop.yaw),0,-Math.sin(drop.yaw)),forward=new T.Vector3(Math.sin(drop.yaw),0,Math.cos(drop.yaw));record.object.position.copy(drop.position).addScaledVector(side,lateral).addScaledVector(forward,longitudinal);record.object.rotation.y=drop.yaw+yaw;record.object.updateMatrixWorld(true);s.vehicleRuntime.applyPose(record,{...v.pose,lift:drop.toolY-v.originWorld.y-v.config.forkBaseHeight+height},false);d.follow();d.holographicGuide.update(true);d.updateHUD();d.docking.update(true);};
    __dropQA.place(.16,-.25,.24,.04);return {sameProduct:v.entry.product===product,units:s.productMetadata(product).units,mass:s.productMetadata(product).mass,target:target.id};
   });assert(report.pickup.sameProduct);assert.equal(report.pickup.units,4);assert.equal(report.pickup.mass,33);
   const inspect=()=>b.call(()=>{
    const q=__dropQA,d=q.d,c=d.docking.forkCamera,g=d.holographicGuide,m=g.getDropPlacement(),rect=node=>{const r=node&&node.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,visible:!!(r.width&&r.height)&&getComputedStyle(node).display!=='none'}:null;};
    const projected=c.framing&&c.framing.visible.map(p=>p.clone().project(c.camera).toArray());
    return {mode:d.docking.mode,phase:g.getState().phase,drop:m&&{id:m.id,selectionKey:m.selectionKey,valid:m.valid,admissible:m.admissible,ready:m.ready,reason:m.reason,errors:m.errors,targetFootprint:m.targetFootprint,actualFootprint:m.actualFootprint,support:m.support},physical:q.s.vehicleRuntime.getDockingState(q.record),camera:c.getStats(),framing:c.framing&&{mode:c.framing.mode,projected},plan:rect(d.docking.plan),feed:rect(d.docking.feedViewport),monitor:rect(d.docking.element),navHeader:rect(d.docking.navigationHeader),compositeClear:[d.docking.element,d.docking.body,d.docking.feed,d.docking.feedViewport].every(node=>getComputedStyle(node).backgroundColor==='rgba(0, 0, 0, 0)'),objectives:rect(d.docking.guidancePanel),expandHit:(()=>{const node=d.docking.expandButton,r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===node||node.contains(hit);})(),summary:d.docking.summary.textContent,metrics:d.docking.metrics.textContent,canvasLabel:d.docking.canvas.getAttribute('aria-label'),custody:q.v.entry===q.entry&&q.v.entry.product===q.product,metadataUnchanged:JSON.stringify(q.s.productMetadata(q.product))===q.metadata,gl:q.ctx.renderer.getContext().getError(),viewport:[innerWidth,innerHeight],scrollWidth:document.documentElement.scrollWidth};
   });
   const settleCamera=async()=>{const previous=await b.evaluate('__dropQA.d.docking.forkCamera.getStats().frontFrames');try{await b.until(()=>b.call(previous=>{const c=__dropQA.d.docking.forkCamera.getStats();return c.frontFrames>previous&&c.hasCurrentFrame&&c.framePhase==='drop';},previous),'A current unload camera frame did not render.',20000);}catch(error){report.cameraFailure=await inspect();throw error;}};
   report.beforeCamera=await inspect();
   await settleCamera();
   report.adjust=await inspect();assert.equal(report.adjust.phase,'drop');assert(report.adjust.drop&&report.adjust.drop.valid);assert.equal(report.adjust.drop.ready,false);assert(report.adjust.drop.errors.verticalM>.15);assert(report.adjust.plan.visible&&report.adjust.feed.visible);assert(report.adjust.custody&&report.adjust.metadataUnchanged);assert.equal(report.adjust.gl,0);assert.equal(report.adjust.camera.failures,0);
   assert(report.adjust.framing&&report.adjust.framing.projected.length>=8);assert(report.adjust.framing.projected.every(p=>p.every(Number.isFinite)&&Math.abs(p[0])<=1.001&&Math.abs(p[1])<=1.001&&Math.abs(p[2])<=1.001),'Both load and actual destination must fit the optical frame.');await shot('drop-position-adjust');
   const target=report.adjust.drop.targetFootprint;
   await b.call(()=>{const q=__dropQA;q.d.holographicGuide.setEnabled(false);q.place(.10,-.13,.12,.02);});
   await settleCamera();report.hiddenHologram=await inspect();assert.deepEqual(report.hiddenHologram.drop.targetFootprint,target,'Target must stay fixed while the pallet moves and world hologram is hidden.');assert(report.hiddenHologram.plan.visible&&report.hiddenHologram.feed.visible);assert.equal(report.hiddenHologram.drop.ready,false);await shot('drop-hologram-off-detail');
   await b.call(()=>{const q=__dropQA;q.d.holographicGuide.setEnabled(true);q.place(0,0,.15,0);});
   await settleCamera();report.above=await inspect();assert.equal(report.above.drop.ready,false);assert(report.above.drop.errors.verticalM>.10);assert(report.above.custody);await shot('drop-above-support');
   for(const [width,height]of [[390,844],[844,390],[1920,1080]]){
    await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await b.call(()=>{const q=__dropQA;q.d.follow();q.d.holographicGuide.update(true);q.d.docking.update(true);});
    await settleCamera();const state=await inspect();assert(state.plan.visible&&state.feed.visible);assert(state.scrollWidth<=width+1);assert.equal(state.gl,0);assert.equal(state.camera.failures,0);report.viewports.push(state);await shot('drop-detail-'+width+'x'+height);
    if(width<900){const a=state.navHeader,o=state.objectives,overlap=Math.max(0,Math.min(a.x+a.width,o.x+o.width)-Math.max(a.x,o.x))*Math.max(0,Math.min(a.y+a.height,o.y+o.height)-Math.max(a.y,o.y));assert(overlap<1,'Objectives must not cover inspection actions.');assert(state.expandHit,'The detail expand control must be reachable.');await b.call(()=>__dropQA.d.docking.expandButton.click());await settleCamera();const expanded=await inspect();assert(expanded.feed.visible&&expanded.feed.width>=200&&expanded.plan.visible);assert(expanded.compositeClear,'DOM backgrounds must not darken the composited camera.');assert(expanded.scrollWidth<=width+1);await shot('drop-expanded-'+width+'x'+height);await b.call(()=>__dropQA.d.docking.expandButton.click());await settleCamera();}
   }
   await b.call(()=>__dropQA.place(0,0,0,0));
   await settleCamera();report.ready=await inspect();assert(report.ready.physical.ready,report.ready.physical.reason);assert(report.ready.drop.ready,report.ready.drop.reason);assert(report.ready.custody);await shot('drop-ready-exact-position');
   await b.call(()=>__dropQA.d.docking.expandButton.click());await settleCamera();report.desktopExpanded=await inspect();assert(report.desktopExpanded.compositeClear&&report.desktopExpanded.feed.width>=300);await shot('drop-expanded-desktop');await b.call(()=>__dropQA.d.docking.expandButton.click());await settleCamera();
   report.release=await b.call(()=>{const q=__dropQA;q.d.command('release');q.d.holographicGuide.update(true);q.d.docking.update(true);const receiver=q.s.records.get(q.destinationId),queue=receiver&&receiver.components.palletQueue;return {released:!q.v.entry,receiverOwnsSameEntry:!!queue&&queue.queue.includes(q.entry),sameProduct:q.entry.product===q.product,metadataUnchanged:JSON.stringify(q.s.productMetadata(q.product))===q.metadata,guidePhase:q.d.holographicGuide.getState().phase,gl:q.ctx.renderer.getContext().getError()};});
   assert(report.release.released&&report.release.receiverOwnsSameEntry&&report.release.sameProduct&&report.release.metadataUnchanged);assert.equal(report.release.guidePhase,'withdraw');assert.equal(report.release.gl,0);await shot('drop-released-withdraw');
   report.blockedExternalFonts=report.failedRequests.filter(row=>/^https:\/\/(?:code\.cdn\.mozilla\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(row.url||''));assert.deepEqual(report.failedRequests.filter(row=>!report.blockedExternalFonts.includes(row)),[]);assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin+'/')&&row.status>=400),[]);assert.deepEqual(report.responses.filter(row=>/^https?:/.test(row.url)&&!row.url.startsWith(fixture.origin+'/')),[]);assert.deepEqual(fixture.errors,[]);
  });assert.equal(hash(fs.readFileSync(bundle)),expectedPublicSha256);report.passed=true;return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,bundleSha256:expectedPublicSha256,viewports:report.viewports.length,screenshots:report.screenshots.length,report:path.join(OUT,'report.json')}));}
}
module.exports={run};if(require.main===module){const at=process.argv.indexOf('--expected-public-sha256');run({expectedPublicSha256:at<0?undefined:process.argv[at+1]}).catch(error=>{console.error(error);process.exitCode=1;});}
