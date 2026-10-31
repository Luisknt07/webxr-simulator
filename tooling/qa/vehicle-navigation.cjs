'use strict';
// Production artifacts, private project copy and disposable HTTPS/API/Chrome.
// Only a declared cold initial truck pose changes; stock, routes and custody
// are never rewritten. All approach/withdrawal uses real collision stepping.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const {prepare:prepareDock}=require('./fork-entry-assistance.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/vehicle-navigation');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

async function prepare(file){
  const prepared=await prepareDock(file),THREE=require('three'),actor=prepared.document.rooms[prepared.roomId].additions.find(a=>a.id===prepared.truckId);
  assert(actor);const extraStandOffM=1.25,offset=new THREE.Vector3(0,0,-extraStandOffM).applyQuaternion(new THREE.Quaternion().fromArray(actor.quaternion));
  actor.position=actor.position.map((value,index)=>value+offset.toArray()[index]);
  prepared.evidence.initialPoseFixture={...prepared.evidence.initialPoseFixture,position:actor.position,kind:'authored-cold-initial-navigation-standoff',extraStandOffM,drivenApproachM:2.5};
  return prepared;
}

function assertLayout(model,expected){
  assert(model&&model.vehicle&&model.floors.length&&model.actors.length&&model.products.length,'The live layout must include the facility, equipment, cargo and truck.');
  assert(model.mission&&model.mission.pickup&&model.mission.destination&&model.mission.target,'The layout must identify real source, receiving position and current target.');
  assert.equal(model.mission.phase,expected);assert(model.mission.plannedRoute.length>1,'The task route must be present.');
  const {bounds}=model,inside=p=>p[0]>=bounds.minX&&p[0]<=bounds.maxX&&p[1]>=bounds.minZ&&p[1]<=bounds.maxZ;
  assert([bounds.minX,bounds.minZ,bounds.maxX,bounds.maxZ].every(Number.isFinite));assert(bounds.maxX>bounds.minX&&bounds.maxZ>bounds.minZ);
  assert([model.vehicle.position,model.mission.pickup,model.mission.destination,...model.mission.plannedRoute,...model.actors.flatMap(a=>a.points)].every(inside),'Map bounds must cover the entire installation and mission.');
  assert.deepEqual(model.mission.target,expected==='pickup'?model.mission.pickup:model.mission.destination);
  if(model.mission.verified)assert(model.mission.route.length&&inside(model.mission.route[0]));
}
function assertRects(state){
  const {plan,feed,metrics,monitor,viewport}=state.rects;
  const contains=(outer,inner)=>!!(inner&&inner.width>0&&inner.height>0&&inner.left>=outer.left-1&&inner.right<=outer.right+1&&inner.top>=outer.top-1&&inner.bottom<=outer.bottom+1);
  assert(monitor&&monitor.width>0&&monitor.height>0);assert(contains({left:0,top:0,right:viewport.width,bottom:viewport.height},monitor),'The entire navigation panel must fit the viewport horizontally and vertically.');
  if(plan)assert(contains(monitor,plan),'The visible plan must remain inside the monitor.');
  if(state.mode==='inspection'){
    assert(plan&&feed&&plan.width>0&&feed.width>0,'Inspection must retain both the physical alignment plan and real camera.');
    assert(contains(monitor,feed),'The camera viewport must remain inside the monitor.');
    assert(contains(monitor,metrics),'The physical alignment measurements must remain visible inside the monitor.');
    assert(Math.abs(feed.width/feed.height-16/9)<.03,'The real camera viewport must retain its optical 16:9 aspect ratio.');
    const overlap=Math.max(0,Math.min(plan.right,feed.right)-Math.max(plan.left,feed.left))*Math.max(0,Math.min(plan.bottom,feed.bottom)-Math.max(plan.top,feed.top));
    assert(overlap<=1,'The physical plan must never cover the camera image.');
  }
}

async function run(file,options={}){
  assert(file,'Use --document <private-three-task-project.json>.');fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
  const prepared=await prepare(file),workspaceSha256=hash(fs.readFileSync(path.join(ROOT,'artifacts/workspace/bundle.js')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/workspace/publication.json'))).bundleSha256,workspaceSha256,'Package the final compiled artifact first.');
  const report={startedAt:new Date().toISOString(),workspaceSha256,mobileOnly:!!options.mobileOnly,temporaryDatabaseOnly:true,fixture:prepared.evidence,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],viewports:[]};
  const password='Disposable-Navigation-'+randomBytes(16).toString('hex'),fixture=await startFixture(password);
  try{
    assert.equal((await request(fixture.origin,'/workspace/bundle.js')).status,401);
    await withBrowser(fixture,report,async b=>{
      const until=(callback,message)=>b.until(callback,message,60000);
      const shot=async name=>{const image=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(image.data,'base64'));report.screenshots.push(file);};
      const metrics=async(width,height,mobile)=>{await b.send('Emulation.clearDeviceMetricsOverride');await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});};
      await metrics(options.mobileOnly?390:1440,options.mobileOnly?844:900,!!options.mobileOnly);await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
      await b.send('Page.navigate',{url:fixture.origin+'/editor'});await until(()=>b.evaluate('!!document.getElementById("login")'),'The disposable login did not open.');
      await b.call(password=>{const form=document.getElementById('login');form.elements.username.value='qa_production_owner';form.elements.password.value=password;form.requestSubmit();},password);
      await until(()=>b.evaluate('!!window.context&&!!context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&!!context.studio'),'Workspace did not boot.');await b.evaluate('context.studio.ready');
      const projectId=await b.call(async document=>(await context.editor.projectClient.createProject('QA vehicle navigation',document)).id,prepared.document);
      const mount=async(width,height,mobile)=>{
        // Dispose the previous canvas before changing mobile viewport metrics.
        // A desktop-sized live WebGL canvas can otherwise feed Chrome's mobile
        // layout viewport scaling; this tests actual cold mobile startup.
        await b.send('Page.navigate',{url:'about:blank'});await until(()=>b.evaluate('location.href==="about:blank"'),'The previous renderer did not unload.');
        await metrics(width,height,mobile);
        await b.send('Page.navigate',{url:fixture.origin+'/editor?project='+encodeURIComponent(projectId)+'&room='+encodeURIComponent(prepared.roomId)});
        await until(()=>b.call(room=>!!window.context&&!!context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&context.editor.roomId===room,prepared.roomId),'The prepared warehouse did not open.');await b.evaluate('context.studio.ready');
        await b.call(ids=>{
        const e=context.editor;e.projectSync.stop();if(e.active)e.leave();e.simulationPaused=false;
        const s=e.simulation,d=e.vehicleDriving,record=s.records.get(ids.truckId),v=record.components.vehicle,product=s.vehicleTraining.product(ids.productId);
        if(!d.mount(record.id))throw Error('Cannot enter the cold-authored truck.');
        d.holographicGuide.setEnabled(true);d.follow();d.frontVisibility.update();d.docking.forkCamera.setMode('isometric');d.docking.update(true);d.updateHUD();
        const q=window.__navigationQA={e,s,d,record,v,product,entry:product.sourceEntry,pockets:JSON.stringify(s.vehicleRuntime.productPockets(product)),execute:s.execute.bind(s)};
        // Deterministic short manual stepping, retaining the actual collision
        // world, vehicle physics and training observers for every 1/60s tick.
        s.execute=()=>{};q.motion=()=>{const w=context.collisionWorld,own=w&&w.beginFrame&&w.endFrame&&!w.frameActive;if(own)w.beginFrame();try{s.time+=1/60;s.vehicleRuntime.step(1/60);s.vehicleTraining.step(1/60);}finally{if(own)w.endFrame();}};
        q.capture=()=>{
          d.follow();d.frontVisibility.update();d.holographicGuide.update(true);d.docking.update(true);d.updateHUD();
          const m=d.docking,c=m.forkCamera,rect=node=>{if(!node||node.hidden||!node.getClientRects().length)return null;const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
          return {mode:m.mode,camera:c.getStats(),hasTarget:!!c.target,hasMirrorTarget:!!c.mirrorTarget,selectedFeed:c.selectedFeed,forceLayout:m.forceLayout,layout:m.facilityLayout&&m.facilityLayout.model,guide:d.holographicGuide.getState(),wire:d.frontVisibility.getWireStats(),wireAllocations:d.frontVisibility.allocations,physical:s.vehicleRuntime.getDockingState(record),lesson:s.vehicleTraining.guidance(record),distance:v.distance,custody:v.entry&&v.entry.id||null,
            rects:{monitor:rect(m.element),plan:rect(m.plan),feed:rect(m.feedViewport),metrics:rect(m.metrics),viewport:{width:innerWidth,height:innerHeight}},gl:context.renderer.getContext().getError()};
        };
        },{truckId:prepared.truckId,productId:prepared.productId});
      };
      const drive=async(metres,direction)=>{
        const start=await b.evaluate('__navigationQA.v.distance');let result;
        for(let chunk=0;chunk<100;chunk++){
          result=await b.call((start,metres,direction)=>{const q=__navigationQA;for(let tick=0;tick<45;tick++){const done=q.v.distance-start>=metres;if(done&&Math.abs(q.v.actualSpeed)<.002)break;q.s.vehicleRuntime.setInput(q.record,done?{brake:1}:{throttle:direction*.18});q.motion();if(q.v.blocked)throw Error('The declared short approach/withdrawal met a real obstacle: '+q.v.warning);}q.d.follow();q.d.docking.update(true);return {distance:q.v.distance-start,speed:q.v.actualSpeed,done:q.v.distance-start>=metres&&Math.abs(q.v.actualSpeed)<.002,mode:q.d.docking.mode};},start,metres,direction);
          if(result.done)return result;
        }throw Error('The short physical movement did not stop within its bounded tick budget.');
      };
      if(!options.mobileOnly){
      await mount(1440,900,false);
      report.far=await b.call(()=>__navigationQA.capture());assert.equal(report.far.mode,'layout');assert(!report.far.hasTarget&&!report.far.hasMirrorTarget);assert.equal(report.far.camera.estimatedGpuBytes,0);assertLayout(report.far.layout,'pickup');assertRects(report.far);await shot('desktop-far-live-layout');
      report.approach=await drive(2.47,1);report.near=await b.call(()=>__navigationQA.capture());assert.equal(report.near.mode,'inspection');assert(report.near.physical.ready,report.near.physical.reason);
      await until(()=>b.evaluate('__navigationQA.d.docking.forkCamera.getStats().frontFrames>0'),'The near inspection camera did not render.');report.near=await b.call(()=>__navigationQA.capture());assertRects(report.near);await shot('desktop-near-isometric-and-plan');
      report.auxIsolation=await b.call(()=>{
        const q=__navigationQA,c=q.d.docking.forkCamera,r=context.renderer,g=q.d.holographicGuide,body=[],blades=[];q.d.visualRoot.traverse(node=>{if(node.isMesh||node.isLineSegments)(node.userData.vehicleForkBlade?blades:body).push(node);});
        const watched=[...body,g.root].filter(Boolean),before=watched.map(node=>node.visible),old=r.render;let during=null,rendered=false;
        try{r.render=function(scene,camera){if(r.getRenderTarget()===c.target&&camera===c.camera)during={bodyHidden:body.every(node=>!node.visible),guideHidden:!g.root.visible,bladesVisible:blades.length>0&&blades.every(node=>node.visible)};return old.call(this,scene,camera);};c.elapsed=Infinity;rendered=c.renderBefore(q.e.hooks.renderScene||context.scene,.25);}finally{r.render=old;}
        return {rendered,during,restored:watched.every((node,index)=>node.visible===before[index]),wire:q.d.frontVisibility.wire&&q.d.frontVisibility.wire.visible};
      });
      assert(report.auxIsolation.rendered&&report.auxIsolation.during&&report.auxIsolation.during.bodyHidden&&report.auxIsolation.during.guideHidden&&report.auxIsolation.during.bladesVisible&&report.auxIsolation.restored&&report.auxIsolation.wire,'Auxiliary hiding must preserve the opaque entry blades and restore the main world.');
      const frame=report.near.camera.mirrorFrames;await b.call(()=>__navigationQA.d.docking.toggleRearView());
      await until(()=>b.call(frame=>__navigationQA.d.docking.forkCamera.getStats().mirrorFrames>frame,frame),'Explicit rear camera did not render.');report.rear=await b.call(()=>__navigationQA.capture());assert.equal(report.rear.mode,'rear');assert(!report.rear.hasTarget&&report.rear.hasMirrorTarget);await shot('desktop-explicit-rear');
      await b.call(()=>{const m=__navigationQA.d.docking;m.toggleRearView();m.toggleCamera();});report.cameraOff=await b.call(()=>__navigationQA.capture());assert.equal(report.cameraOff.mode,'layout');assert(!report.cameraOff.hasTarget&&!report.cameraOff.hasMirrorTarget);await shot('desktop-camera-off-layout');
      await b.call(()=>{const m=__navigationQA.d.docking;m.toggleCamera();m.planButton.click();});report.forcedPlan=await b.call(()=>__navigationQA.capture());assert.equal(report.forcedPlan.mode,'layout');assert(report.forcedPlan.forceLayout);assert(!report.forcedPlan.hasTarget&&!report.forcedPlan.hasMirrorTarget);await shot('desktop-forced-layout');
      await b.call(()=>__navigationQA.d.docking.planButton.click());
      report.wireIdle=await b.call(()=>{const q=__navigationQA,a=q.d.frontVisibility.getWireStats(),allocations=q.d.frontVisibility.allocations,geometry=q.d.frontVisibility.wireGeometry;for(let tick=0;tick<120;tick++)q.d.frontVisibility.update();return {before:a,after:q.d.frontVisibility.getWireStats(),allocationsBefore:allocations,allocationsAfter:q.d.frontVisibility.allocations,sameGeometry:geometry===q.d.frontVisibility.wireGeometry};});
      assert.equal(report.wireIdle.before.updates,report.wireIdle.after.updates);assert.equal(report.wireIdle.allocationsBefore,report.wireIdle.allocationsAfter);assert(report.wireIdle.sameGeometry);assert(report.wireIdle.after.segments<=report.wireIdle.after.limit);
      await b.call(()=>context.renderer.domElement.focus());await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'g',code:'KeyG',windowsVirtualKeyCode:71});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'g',code:'KeyG',windowsVirtualKeyCode:71});await until(()=>b.evaluate('!!__navigationQA.v.entry'),'The real G command did not pick up the physical pallet.');
      report.loadedWithdrawal=await drive(3.1,-1);report.loadedFar=await b.call(()=>{const q=__navigationQA,value=q.capture();return {...value,sameProduct:q.v.entry.product===q.product,sameEntry:q.v.entry===q.entry,pocketsUnchanged:JSON.stringify(q.s.vehicleRuntime.productPockets(q.product))===q.pockets,stateValid:q.s.vehicleTraining.validateState(q.record),inspectionDistance:q.d.docking.inspectionMode.target&&Math.hypot(...[0,2].map(i=>q.d.visualRoot.userData.vehicleRig.forks.getWorldPosition(q.e.camera.position.clone()).toArray()[i]-q.d.docking.inspectionMode.target.position[i]))};});
      assert.equal(report.loadedFar.mode,'layout','A carried pallet must never keep the camera on during the trip.');assert(report.loadedFar.camera.enabled&&!report.loadedFar.forceLayout&&report.loadedFar.inspectionDistance>2.8,'The loaded trip must be an automatic far-target layout, not a forced or disabled camera.');assert.equal(report.loadedFar.lesson.phase,'drop');assert(report.loadedFar.sameProduct&&report.loadedFar.sameEntry&&report.loadedFar.pocketsUnchanged&&report.loadedFar.stateValid);assert(!report.loadedFar.hasTarget&&!report.loadedFar.hasMirrorTarget);assertLayout(report.loadedFar.layout,'drop');await shot('desktop-loaded-travel-layout');
      assert.equal(report.loadedFar.gl,0);assert.equal(report.loadedFar.camera.failures,0);
      }
      // Every mobile case cold-starts the unchanged private authored document;
      // desktop pickup/carry evidence is complete before these fresh runtimes.
      for(const [width,height,mobile,name]of [[390,844,true,'mobile-portrait'],[780,390,true,'mobile-landscape']]){
        await mount(width,height,mobile);const far=await b.call(()=>__navigationQA.capture());assert.equal(far.rects.viewport.width,width);assert.equal(far.rects.viewport.height,height);assert.equal(far.mode,'layout');assertLayout(far.layout,'pickup');assertRects(far);assert(!far.hasTarget&&!far.hasMirrorTarget);await shot(name+'-far-layout');
        const approach=await drive(2.47,1);await until(()=>b.evaluate('__navigationQA.d.docking.forkCamera.getStats().frontFrames>0'),'The mobile near inspection camera did not render.');const near=await b.call(()=>__navigationQA.capture());assert.equal(near.rects.viewport.width,width);assert.equal(near.rects.viewport.height,height);assert.equal(near.mode,'inspection');assert(near.physical.ready,near.physical.reason);assertRects(near);await shot(name+'-inspection');
        await b.call(()=>__navigationQA.d.docking.planButton.click());const map=await b.call(()=>__navigationQA.capture());assert.equal(map.mode,'layout');assertLayout(map.layout,'pickup');assertRects(map);assert(!map.hasTarget&&!map.hasMirrorTarget);assert.equal(map.gl,0);assert.equal(map.camera.failures,0);await shot(name+'-forced-layout');report.viewports.push({width,height,freshNavigation:true,far,approach,inspection:near,layout:map});
      }
      report.environmentalFontRequests=report.failedRequests.filter(row=>{try{const u=new URL(row.url);return u.hostname==='code.cdn.mozilla.net'&&u.pathname.startsWith('/fonts/');}catch(_){return false;}});
      assert.deepEqual(report.failedRequests.filter(row=>!report.environmentalFontRequests.includes(row)),[]);assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin+'/')&&row.status>=400),[]);assert.deepEqual(fixture.errors,[]);report.passed=true;
    });
    assert.equal(hash(fs.readFileSync(path.resolve(file))),prepared.evidence.inputSha256,'The original private project must remain unchanged.');return report;
  }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
  finally{report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,report:path.join(OUT,'report.json'),screenshots:report.screenshots.length}));}
}
module.exports={prepare,run};if(require.main===module){const flag=process.argv.indexOf('--document');run(flag<0?undefined:process.argv[flag+1],{mobileOnly:process.argv.includes('--mobile-only')}).catch(error=>{console.error(error);process.exitCode=1;});}
