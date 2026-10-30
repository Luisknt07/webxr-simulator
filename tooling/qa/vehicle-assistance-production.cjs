'use strict';
// Reviewed production bundle, temporary HTTPS/SQLite fixture and disposable Chrome.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), {randomBytes, createHash} = require('node:crypto');
const {startFixture, withBrowser} = require('./workspace-production.cjs');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(ROOT, 'data/qa-studio/workspace-production');
async function run() {
  fs.mkdirSync(OUT, {recursive: true});
  const hash=file=>createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
  const report = {startedAt: new Date().toISOString(), bundleSha256: hash('artifacts/public-viewer/viewer.js'), workspaceSha256: hash('artifacts/workspace/bundle.js'), exceptions: [], consoleErrors: [], failedRequests: [], responses: [], screenshots: [], temporaryDatabaseOnly: true};
  assert.equal(report.bundleSha256,JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/publication.json'),'utf8')).bundleSha256,'Public packaging must finish before launching QA');
  assert.equal(report.workspaceSha256,JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/workspace/publication.json'),'utf8')).bundleSha256,'Workspace packaging must finish before launching QA');
  const password = 'Disposable-Forklift-' + randomBytes(16).toString('hex'), fixture = await startFixture(password);
  try {
    await withBrowser(fixture, report, async b => {
      await b.send('Emulation.setDeviceMetricsOverride', {width:1600,height:1000,deviceScaleFactor:1,mobile:false});
      await b.send('Page.navigate', {url: fixture.origin + '/#escenarios'});
      await b.until(() => b.evaluate('!!window.smartTwinGallery && smartTwinGallery.getStats().screen === "gallery"'), 'Gallery unavailable');
      await b.call(() => document.querySelector('.scene-open[data-scene-id="vr-robot-dispatch"]').click());
      await b.until(() => b.evaluate('!!window.smartTwinViewer'), 'Viewer unavailable');
      report.sceneUI=await b.call(()=>{
        const r=document.getElementById('reticle').getBoundingClientRect();
        return {reticle:{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height},center:[innerWidth/2,innerHeight/2],customFooter:!!document.querySelector('.lesson-footer'),menuOpen:document.getElementById('viewer-menu').open,helpVisible:!!document.querySelector('.lesson-intro').getClientRects().length};
      });assert(report.sceneUI.reticle.width>=12);assert.deepEqual([report.sceneUI.reticle.x,report.sceneUI.reticle.y],report.sceneUI.center);assert(!report.sceneUI.customFooter);assert(!report.sceneUI.menuOpen&&!report.sceneUI.helpVisible);
      await b.screenshot('forklift-public-scene-entry');
      await b.call(()=>document.getElementById('viewer-menu-toggle').click());
      assert(await b.evaluate('document.getElementById("viewer-menu").open && smartTwinViewer.context.publicDialogOpen'));
      const menuTime=await b.evaluate('smartTwinViewer.context.demo.simulation.time');await b.send('Runtime.evaluate',{expression:'void 0'});
      await b.screenshot('forklift-public-scene-menu');assert.equal(await b.evaluate('smartTwinViewer.context.demo.simulation.time'),menuTime);
      await b.call(()=>document.getElementById('viewer-menu-close').click());await b.until(()=>b.evaluate('!document.getElementById("viewer-menu").open && !smartTwinViewer.context.publicDialogOpen'),'Closing the scene menu must restore interaction');
      console.log('Production forklift: real robot cycle');
      report.setup = await b.call(() => {
        const api=smartTwinViewer, ctx=api.context, sim=ctx.demo.simulation, T=api.THREE;
        const vehicle=[...sim.records.values()].find(r=>r.components.vehicle), belt=sim.records.get(vehicle.components.vehicle.config.sourceId);
        ctx.demo.setPaused(true);
        for(let i=0;i<3600 && !belt.components.conveyor.packages.length;i++){ctx.scene.updateMatrixWorld(true);sim.execute(1/60);}
        for(let i=0;i<1800 && belt.components.conveyor.actualSpeed;i++){ctx.scene.updateMatrixWorld(true);sim.execute(1/60);}
        const product=belt.components.conveyor.packages[0]?.product;
        if(!product) throw Error('Robot did not supply pallet');
        const v=vehicle.components.vehicle, yaw=Math.atan2(new T.Vector3(0,0,1).applyQuaternion(vehicle.object.quaternion).x,new T.Vector3(0,0,1).applyQuaternion(vehicle.object.quaternion).z);
        const dock=sim.vehicleRuntime.pickupDock(vehicle,{yaw,targetId:belt.id},product);
        vehicle.object.position.copy(dock.position).addScaledVector(new T.Vector3(Math.sin(dock.yaw),0,Math.cos(dock.yaw)),-.8);
        vehicle.object.rotation.y=dock.yaw; vehicle.object.updateMatrixWorld(true);
        sim.vehicleRuntime.applyPose(vehicle,{...v.pose,lift:dock.toolY-v.originWorld.y-v.config.forkBaseHeight},false);
        const d=ctx.demo.driving; d.mount(vehicle.id); d.command('power',true);d.command('start',true);d.command('parkingBrake',false);d.follow();d.holographicGuide.update(true);d.docking.update(true);
        window.__forkQA={vehicle,belt,product,dock};
        return {id:vehicle.id,belt:belt.id,units:sim.productMetadata(product).units,guide:d.holographicGuide.getState(),dock:{position:dock.position.toArray(),yaw:dock.yaw}};
      });
      await b.until(() => b.evaluate('smartTwinViewer.context.demo.driving.docking.forkCamera.getStats().frontFrames > 1'), 'Inspection camera did not render');
      const inspect=async()=>b.call(()=>{
        const ctx=smartTwinViewer.context,d=ctx.demo.driving,c=ctx.renderer.domElement;
        const rect=selector=>{const el=document.querySelector(selector),r=el?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,visible:!!(r.width&&r.height)&&getComputedStyle(el).display!=='none'}:null;};
        const hud=document.querySelector('.vehicle-driving-hud');
        const heels=[];d.visualRoot.traverse(n=>{if(n.isMesh&&n.userData.vehicleForkTine&&!n.userData.vehicleForkBlade)for(const m of Array.isArray(n.material)?n.material:[n.material])heels.push({name:n.name,opacity:m.opacity,transparent:m.transparent});});
        return {viewport:[innerWidth,innerHeight],drawingBuffer:[c.width,c.height],dpr:devicePixelRatio,front:rect('.vehicle-fork-camera-viewport'),plan:rect('.vehicle-docking-plan'),metrics:rect('.vehicle-docking-metrics'),objectives:rect('.vehicle-guidance-panel'),separateObjectives:!d.docking.element.contains(d.docking.guidanceBar),heels,hud:rect('.vehicle-driving-hud'),hudScrollWidth:hud.scrollWidth,hudClientWidth:hud.clientWidth,hudScrollHeight:hud.scrollHeight,hudClientHeight:hud.clientHeight,monitor:rect('.vehicle-docking-monitor'),camera:d.docking.forkCamera.getStats(),gl:ctx.renderer.getContext().getError(),guide:d.holographicGuide.getState(),scrollWidth:document.documentElement.scrollWidth};
      });
      report.desktop=await inspect(); assert.equal(report.desktop.gl,0);assert.equal(report.desktop.camera.antialias,'fxaa');assert.equal(report.desktop.camera.mode,'isometric');assert(report.desktop.camera.width>=512);assert(report.desktop.plan.visible&&report.desktop.metrics.visible&&report.desktop.separateObjectives);assert(report.desktop.heels.length&&report.desktop.heels.every(m=>m.transparent&&m.opacity<.1),'Upright fork heels must remain translucent in the real production scene');assert(report.desktop.hudScrollHeight<=report.desktop.hudClientHeight+1,'All desktop controls must fit without an accordion or scrolling');await b.screenshot('forklift-desktop-camera');
      await b.call(()=>smartTwinViewer.context.demo.driving.docking.toggleRearView());
      await b.until(()=>b.evaluate('smartTwinViewer.context.demo.driving.docking.forkCamera.getStats().mirrorFrames > 1'),'Toggled rear camera did not render');
      report.mirror=await inspect();assert(report.mirror.plan.visible&&report.mirror.metrics.visible);await b.screenshot('forklift-toggle-rear');
      await b.call(()=>smartTwinViewer.context.demo.driving.docking.toggleRearView());
      report.visibility=await b.call(()=>{
        const d=smartTwinViewer.context.demo.driving,ghost=d.frontVisibility;
        if(!ghost)throw Error('Missing mounted front-visibility adapter');
        const on=ghost.getStats();d.command('holographicGuide');const off=ghost.getStats();d.command('holographicGuide');const restored=ghost.getStats();
        return {on,off,restored};
      });assert(report.visibility.on.active&&!report.visibility.off.active&&report.visibility.restored.active);
      await b.screenshot('forklift-desktop-plan');report.desktopPlan=await inspect();assert(report.desktopPlan.front.visible&&report.desktopPlan.plan.visible&&report.desktopPlan.metrics.visible);
      for(const [name,width,height] of [['mobile',390,844],['landscape',844,390]]){
        await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await b.call(()=>{const d=smartTwinViewer.context.demo.driving;d.follow();d.docking.update(true);});
        await b.screenshot('forklift-'+name+'-plan');report[name]=await inspect();assert(report[name].front.visible&&report[name].plan.visible&&report[name].metrics.visible);assert(Math.abs(report[name].front.width/report[name].front.height-16/9)<.03,'The camera opening must preserve the optical aspect ratio');assert(report[name].scrollWidth<=width+1);assert(report[name].hudScrollWidth<=report[name].hudClientWidth+1,'Controls must fit the HUD width');
      }
      await b.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
      // Exact physical docking fixture: preserve the real product and use normal pickup command.
      report.pickup=await b.call(()=>{
        const api=smartTwinViewer,ctx=api.context,sim=ctx.demo.simulation,d=ctx.demo.driving,{vehicle,product,dock}=__forkQA,v=vehicle.components.vehicle;
        vehicle.object.position.copy(dock.position);vehicle.object.rotation.y=dock.yaw;vehicle.object.updateMatrixWorld(true);
        sim.vehicleRuntime.applyPose(vehicle,{...v.pose,lift:dock.toolY-v.originWorld.y-v.config.forkBaseHeight},false);
        d.follow();d.docking.update(true); const ready=sim.vehicleRuntime.getDockingState(vehicle);
        if(!ready.ready)throw Error('Physical pickup fixture: '+ready.reason);
        d.command('pickup');sim.execute(1/60);d.holographicGuide.update(true);d.docking.update(true);
        return {carrying:!!v.entry,sameProduct:v.entry?.product===product,units:sim.productMetadata(product).units,guide:d.holographicGuide.getState()};
      }); assert(report.pickup.carrying&&report.pickup.sameProduct);assert.equal(report.pickup.units,4);
      const previousFrames=await b.call(()=>{const d=smartTwinViewer.context.demo.driving;d.command('forkCameraMode');return d.docking.forkCamera.getStats().frontFrames;});
      await b.until(()=>b.call(n=>smartTwinViewer.context.demo.driving.docking.forkCamera.getStats().frontFrames>n,previousFrames),'Close frontal view did not refresh');
      report.closeFrontal=await inspect();assert.equal(report.closeFrontal.camera.mode,'entry');assert.equal(report.closeFrontal.gl,0);await b.screenshot('forklift-close-frontal');
      await b.call(()=>{const d=smartTwinViewer.context.demo.driving;d.command('forkCameraMode');d.command('forkCameraMode');});
      report.loaded=await b.call(()=>{
        const api=smartTwinViewer,ctx=api.context,sim=ctx.demo.simulation,d=ctx.demo.driving,{vehicle}=__forkQA,v=vehicle.components.vehicle,T=api.THREE;
        vehicle.object.position.addScaledVector(new T.Vector3(Math.sin(vehicle.object.rotation.y),0,Math.cos(vehicle.object.rotation.y)),-1.6);vehicle.object.updateMatrixWorld(true);
        sim.vehicleRuntime.applyPose(vehicle,{...v.pose,lift:Math.max(v.pose.lift,v.config.carryHeight)},false);
        d.cycleView();d.follow();d.holographicGuide.update(true);d.updateHUD();d.docking.update(true);
        return {guide:d.holographicGuide.getState(),targets:d.holographicGuide.getTargets().map(t=>({id:t.id,name:t.name,allowed:t.allowed,reason:t.reason,distanceM:t.distanceM}))};
      });assert(report.loaded.targets.some(t=>t.allowed));await b.screenshot('forklift-hologram-delivery');
      report.hologram=await b.call(()=>{
        const api=smartTwinViewer,ctx=api.context,d=ctx.demo.driving,T=api.THREE,g=d.holographicGuide,target=g.currentTarget;
        const center=target.bounds.getCenter(new T.Vector3()).applyMatrix4(target.matrix), truck=__forkQA.vehicle.object.getWorldPosition(new T.Vector3()), middle=center.clone().add(truck).multiplyScalar(.5);
        d.docking.visible=false;d.docking.update(true);
        ctx.cameraRig.position.copy(middle).add(new T.Vector3(6,4,-6));ctx.cameraRig.quaternion.set(0,0,0,1);ctx.camera.position.set(0,0,0);ctx.cameraRig.updateMatrixWorld(true);ctx.camera.lookAt(middle);ctx.cameraRig.updateMatrixWorld(true);g.update(true);
        return {target:center.toArray(),visible:g.root.visible,ghost:g.selected.visible,arrows:g.arrows.visible,geometries:g.stats.geometries,materials:g.stats.materials};
      });assert(report.hologram.visible&&report.hologram.ghost);await b.screenshot('forklift-hologram-overview');
      report.delivery=await b.call(()=>{
        const api=smartTwinViewer,ctx=api.context,sim=ctx.demo.simulation,d=ctx.demo.driving,{vehicle,product}=__forkQA,v=vehicle.components.vehicle,target=d.holographicGuide.currentTarget;
        const dock=sim.vehicleRuntime.dropDock(vehicle,{targetId:target.targetId},target.destination);
        vehicle.object.position.copy(dock.position);vehicle.object.rotation.y=dock.yaw;vehicle.object.updateMatrixWorld(true);
        sim.vehicleRuntime.applyPose(vehicle,{...v.pose,lift:dock.toolY-v.originWorld.y-v.config.forkBaseHeight},false);
        ctx.camera.position.set(0,0,0);ctx.camera.quaternion.set(0,0,0,1);d.docking.visible=true;d.follow();d.holographicGuide.update(true);d.updateHUD();d.docking.update(true);
        const state=sim.vehicleRuntime.getDockingState(vehicle);
        if(!state.ready)throw Error('Physical delivery fixture: '+state.reason);
        const green=d.holographicGuide.getState();if(!green.ready)throw Error('Chosen destination did not match physical receiver: '+JSON.stringify({guide:green,physical:state}));
        d.command('release');d.holographicGuide.update(true);d.updateHUD();d.docking.update(true);
        return {released:!v.entry,units:sim.productMetadata(product).units,guide:d.holographicGuide.getState(),green,monitorSeverity:d.docking.severity,summary:d.docking.summary.textContent};
      });assert(report.delivery.released);assert.equal(report.delivery.units,4);assert.equal(report.delivery.guide.phase,'withdraw');assert.notEqual(report.delivery.monitorSeverity,'ready');assert.match(report.delivery.summary,/retir|Retrocede/i);await b.screenshot('forklift-hologram-withdraw');
      report.walking=await b.call(()=>{
        const ctx=smartTwinViewer.context,d=ctx.demo.driving;ctx.input.drag={id:777,x:0,y:0,distance:0};
        if(!d.unmount())throw Error('Could not leave the stopped forklift');
        const before=ctx.camera.quaternion.toArray(),canvas=ctx.renderer.domElement;
        canvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:777,buttons:0,clientX:350,clientY:280,bubbles:true}));
        return {unmounted:!d.id,unlocked:document.pointerLockElement!==canvas,dragCleared:ctx.input.drag===null,freeMouseDidNotRotate:before.every((v,i)=>v===ctx.camera.quaternion.toArray()[i])};
      });assert(Object.values(report.walking).every(Boolean));
      console.log('Production lighting: private compact scenes and industrial room');
      await b.send('Page.navigate',{url:fixture.origin+'/login?next='+encodeURIComponent('/editor?libraryScene=vr-robot-turn')});
      await b.until(()=>b.evaluate('!!document.getElementById("login")'),'Login unavailable');
      await b.call((password)=>{const form=document.getElementById('login');form.elements.username.value='qa_production_owner';form.elements.password.value=password;form.requestSubmit();},password);
      report.privateScenes=[];
      for(const id of ['vr-robot-turn','vr-robot-transfer','lab-rectangle','original-hall']){
        if(id!=='vr-robot-turn')await b.send('Page.navigate',{url:fixture.origin+'/editor?libraryScene='+id});
        await b.until(()=>b.call(id=>!!window.context&&context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&context.editor.currentProject?.librarySceneId===id,id),'Private scene unavailable: '+id);
        await b.call(()=>{if(context.editor.active)context.editor.leave();});
        if(id!=='original-hall')await b.until(()=>b.evaluate('!!context.editor.hooks.renderScene.environment && context.editor.entities.environment.stats.indoorLightingProfile === "industrial-neutral"'),'Interior presentation did not settle: '+id);
        const state=await b.call(id=>{
          const ctx=context,e=ctx.editor,scene=e.hooks.renderScene;
          const root=e.document.getRoot('hall');root.updateWorldMatrix(true,true);
          if(id!=='original-hall'){
            const eye=root.localToWorld(ctx.camera.position.clone().set(id==='lab-rectangle'?11:9,3.1,7)),target=root.localToWorld(ctx.camera.position.clone().set(2,1.1,0));ctx.camera.parent.updateWorldMatrix(true,true);ctx.camera.position.copy(ctx.camera.parent.worldToLocal(eye));ctx.camera.lookAt(target);ctx.camera.updateWorldMatrix(true,true);
          }
          const lights=[];scene.traverse(n=>{if(!n.isLight)return;for(let p=n;p;p=p.parent)if(!p.visible)return;lights.push({type:n.type,intensity:n.intensity,shadow:n.castShadow});});
          return {id,environment:!!scene.environment,exposure:ctx.renderer.toneMappingExposure,lighting:{...e.entities.environment.stats},lights,gl:ctx.renderer.getContext().getError()};
        },id);assert.equal(state.gl,0);if(id!=='original-hall'){assert(state.environment,'Industrial reflection environment missing');assert(state.exposure>=1);assert(state.lights.some(l=>l.type==='HemisphereLight'&&l.intensity>=.5));}
        report.privateScenes.push(state);await b.screenshot('lighting-'+id);
      }
      assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);assert.deepEqual(fixture.errors,[]);
    });
    report.passed=true;console.log(JSON.stringify({passed:true,bundle:report.bundleSha256,desktop:report.desktop.camera,mobile:report.mobile.viewport,loaded:report.loaded.guide.phase}));
  }catch(error){report.passed=false;report.failure=error.stack;throw error;}
  finally{report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'forklift-precision-report.json'),JSON.stringify(report,null,2));await fixture.close();}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
