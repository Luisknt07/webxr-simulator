'use strict';
// Short, isolated production check. A private authored initial docking pose
// avoids a long route-driving harness and never rewrites live route state.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto'),{createRequire}=require('node:module');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/fork-entry-assistance');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const readCode=file=>fs.readFileSync(path.join(ROOT,file),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');

async function prepare(file){
  const bytes=fs.readFileSync(path.resolve(file)),input=JSON.parse(bytes),document=JSON.parse(JSON.stringify(input.document||input));
  assert.equal(document.format,'hello-webxr-editor');assert(!(document.imports||[]).length,'This local fixture does not copy private imported assets.');
  let chosen;
  for(const [roomId,room]of Object.entries(document.rooms))for(const actor of room.additions){
    const vehicle=actor.behaviors.find(c=>c.type==='vehicle'&&JSON.parse(c.trainingTasksJson||'[]').length===3);
    if(vehicle&&!chosen)chosen={roomId,actor,vehicle};
  }
  assert(chosen,'Pass a project with one three-task warehouse truck.');
  const configurationFixtures=[];
  for(const actor of document.rooms[chosen.roomId].additions)for(const c of actor.behaviors){
    if(!['source','robot','conveyor','processor'].includes(c.type))continue;
    configurationFixtures.push({objectId:actor.id,type:c.type,running:c.running,paused:c.paused,autoGenerate:c.autoGenerate,initialCount:c.initialCount});
    c.running=false;c.paused=true;if(c.type==='source'){c.autoGenerate=false;c.initialCount=0;}
  }
  const localRequire=createRequire(path.join(ROOT,'tests/legacy/test-conveyor-mechanisms.js')),THREE=localRequire('three');
  const code=fs.readFileSync(path.join(ROOT,'tests/legacy/test-conveyor-mechanisms.js'),'utf8');
  const {setup}=new Function('require','__dirname',code.slice(0,code.indexOf('async function run()'))+'\nreturn {setup};')(localRequire,path.join(ROOT,'tests/legacy'));
  const f=setup(),d=f.document;
  try{
    for(const roomId of Object.keys(document.rooms))if(!d.getRoot(roomId)){const root=new THREE.Group();f.scene.add(root);d.registerRoom(roomId,root);}
    const draft=JSON.parse(JSON.stringify(document));for(const room of Object.values(draft.rooms))room.overrides=room.overrides.filter(o=>d.native.has(o.id));await d.load(draft);
    f.runtime.vehicleRuntime=new (localRequire('../support/load-vehicle-runtime')(THREE))(f.runtime);
    const Training=new Function('THREE','trainingSchema',readCode('modules/logistica-industrial/functions/montacargas/runtime/VehicleTrainingRuntime.js').replace('default class VehicleTrainingRuntime','return class VehicleTrainingRuntime'))(THREE,localRequire('../../modules/logistica-industrial/functions/montacargas/schema/vehicle-training'));
    f.runtime.vehicleTraining=new Training(f.runtime);f.scene.updateMatrixWorld(true);f.runtime.start(chosen.roomId);
    const truck=f.runtime.records.get(chosen.actor.id),v=truck.components.vehicle,task=f.runtime.vehicleTraining.tasks(truck)[0],product=f.runtime.vehicleTraining.product(task.productId);
    assert(product&&product.sourceEntry.ownerId===task.sourceId);
    const dock=f.runtime.vehicleRuntime.pickupDock(truck,{yaw:Math.PI,targetId:task.sourceId},product);assert(dock);
    const lateralM=-.067,yawOffsetRad=Math.PI/180,world=dock.position.clone().add(new THREE.Vector3(Math.cos(dock.yaw),0,-Math.sin(dock.yaw)).multiplyScalar(lateralM));
    // Start outside the stored pallet so normal stock seeding sees a clear
    // rack. The short final insertion is then driven by the real truck.
    const startWorld=world.clone().addScaledVector(new THREE.Vector3(Math.sin(dock.yaw),0,Math.cos(dock.yaw)),-1.25);
    const parent=truck.object.parent;parent.updateWorldMatrix(true,false);
    const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),dock.yaw+yawOffsetRad).premultiply(parent.getWorldQuaternion(new THREE.Quaternion()).inverse());
    chosen.actor.position=parent.worldToLocal(startWorld.clone()).toArray();chosen.actor.quaternion=rotation.toArray();
    Object.assign(chosen.vehicle,{powered:true,running:true,paused:false,parkingBrake:false,emergency:false,initialLift:dock.toolY-world.y-v.config.forkBaseHeight});
    assert(chosen.vehicle.initialLift>=0&&chosen.vehicle.initialLift<=v.config.maxLift);
    return {document,roomId:chosen.roomId,truckId:chosen.actor.id,taskId:task.id,productId:task.productId,sourceId:task.sourceId,
      evidence:{inputSha256:hash(bytes),inputFile:path.resolve(file),configurationFixtures,initialPoseFixture:{kind:'authored-cold-initial-standoff',position:chosen.actor.position,quaternion:chosen.actor.quaternion,initialLift:chosen.vehicle.initialLift,lateralM,yawOffsetRad,drivenApproachM:1.25},pockets:JSON.parse(JSON.stringify(f.runtime.vehicleRuntime.productPockets(product))),originalInputUnchanged:true}};
  }finally{
    f.runtime.stop();const geometries=new Set(),materials=new Set();f.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).filter(Boolean).forEach(m=>materials.add(m));});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  }
}

async function run(file){
  assert(file,'Use --document <three-task-project.json>.');fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
  const prepared=await prepare(file),workspaceSha256=hash(fs.readFileSync(path.join(ROOT,'artifacts/workspace/bundle.js')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/workspace/publication.json'))).bundleSha256,workspaceSha256,'Package the final compiled artifact first.');
  const report={startedAt:new Date().toISOString(),workspaceSha256,temporaryDatabaseOnly:true,fixture:prepared.evidence,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};
  const password='Disposable-Fork-Entry-'+randomBytes(16).toString('hex'),fixture=await startFixture(password);
  try{
    assert.equal((await request(fixture.origin,'/workspace/bundle.js')).status,401);
    await withBrowser(fixture,report,async b=>{
      const until=(callback,message)=>b.until(callback,message,60000);
      const shot=async name=>{const image=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(image.data,'base64'));report.screenshots.push(file);};
      await b.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1050,deviceScaleFactor:1,mobile:false});await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
      await b.send('Page.navigate',{url:fixture.origin+'/editor'});await until(()=>b.evaluate('!!document.getElementById("login")'),'The disposable login did not open.');
      await b.call(password=>{const f=document.getElementById('login');f.elements.username.value='qa_production_owner';f.elements.password.value=password;f.requestSubmit();},password);
      await until(()=>b.evaluate('!!window.context&&!!context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&!!context.studio'),'Workspace did not boot.');await b.evaluate('context.studio.ready');
      const projectId=await b.call(async document=>(await context.editor.projectClient.createProject('QA fork entry assistance',document)).id,prepared.document);
      await b.send('Page.navigate',{url:fixture.origin+'/editor?project='+encodeURIComponent(projectId)+'&room='+encodeURIComponent(prepared.roomId)});
      await until(()=>b.call(room=>!!window.context&&!!context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&context.editor.roomId===room,prepared.roomId),'The prepared warehouse did not open.');await b.evaluate('context.studio.ready');
      report.before=await b.call(ids=>{
        const e=context.editor;e.projectSync.stop();if(e.active)e.leave();e.simulationPaused=false;
        const s=e.simulation,d=e.vehicleDriving,record=s.records.get(ids.truckId),v=record.components.vehicle,product=s.vehicleTraining.product(ids.productId),V=e.camera.position.constructor;
        if(!d.mount(record.id))throw Error('Cannot enter the cold-authored truck.');
        if(!d.docking.cameraEnabled)d.docking.toggleCamera();d.holographicGuide.setEnabled(true);d.follow();d.frontVisibility.update();d.docking.forkCamera.setMode('isometric');d.docking.update(true);d.updateHUD();
        window.__forkEntryQA={e,s,d,record,v,product,entry:product.sourceEntry,initialPosition:record.object.position.toArray(),pockets:JSON.stringify(s.vehicleRuntime.productPockets(product))};
        const lesson=s.vehicleTraining.guidance(record),physical=s.vehicleRuntime.getDockingState(record),paint=[],tines=[];
        product.object.traverse(mesh=>{if(mesh.userData.palletEntryMarking)paint.push({name:mesh.name,opacity:mesh.material.opacity,depthTest:mesh.material.depthTest,collisionDisabled:!!mesh.userData.editorCollisionDisabled});});
        d.visualRoot.traverse(mesh=>{if(mesh.isMesh&&mesh.userData.vehicleForkBlade)tines.push({name:mesh.name,opacity:mesh.material.opacity,transparent:mesh.material.transparent,color:mesh.material.color.getHexString(),contour:!!mesh.userData.vehicleForkContour});});
        const labels=s.palletQueueRuntime.identificationLabels.get(product.object);
        return {lesson,physical,distance:v.distance,trainingLastPosition:v.training.lastPosition,initialPosition:record.object.position.toArray(),pockets:s.vehicleRuntime.productPockets(product),paint,tines,labels:{position:labels?.root.position.toArray(),aboveEntries:!!labels?.root.userData.palletIdentificationAboveEntries},hologram:!!d.frontVisibility.active,gl:context.renderer.getContext().getError()};
      },{truckId:prepared.truckId,productId:prepared.productId});
      assert.equal(report.before.lesson.phase,'pickup');assert.equal(report.before.lesson.routeComplete,false);assert.equal(report.before.lesson.routeFault,false);assert.equal(report.before.distance,0);
      assert.deepEqual(report.before.pockets,prepared.evidence.pockets);assert.equal(report.before.paint.length,2);assert(report.before.paint.every(m=>m.opacity===1&&m.depthTest&&m.collisionDisabled));assert(report.before.tines.length>=2&&report.before.tines.every(m=>m.opacity===1&&!m.transparent));assert(report.before.labels.aboveEntries);assert(report.before.hologram);assert.equal(report.before.gl,0);
      report.start=report.before;
      await b.call(()=>{const q=__forkEntryQA;q.execute=q.s.execute.bind(q.s);q.s.execute=()=>{};q.approachTicks=0;q.motion=()=>{const world=context.collisionWorld,own=world&&world.beginFrame&&world.endFrame&&!world.frameActive;if(own)world.beginFrame();try{q.s.time+=1/60;q.s.vehicleRuntime.step(1/60);q.s.vehicleTraining.step(1/60);}finally{if(own)world.endFrame();}};});
      let approach;
      for(let chunk=0;chunk<45;chunk++){
        approach=await b.call(()=>{const q=__forkEntryQA;for(let i=0;i<45;i++){const moved=q.v.distance;if(moved>=1.22&&Math.abs(q.v.actualSpeed)<.001)break;q.s.vehicleRuntime.setInput(q.record,moved>=1.22?{brake:1}:{throttle:.18});q.motion();q.approachTicks++;if(q.v.blocked)throw Error('The short insertion met a real obstacle.');}q.d.follow();q.d.docking.update(true);q.d.updateHUD();return {distance:q.v.distance,speed:q.v.actualSpeed,ticks:q.approachTicks,complete:q.v.distance>=1.22&&Math.abs(q.v.actualSpeed)<.001,physical:q.s.vehicleRuntime.getDockingState(q.record),lesson:q.s.vehicleTraining.guidance(q.record)};});
        if(approach.complete)break;
      }
      assert(approach.complete,'The short real driven insertion did not finish.');assert(approach.physical.ready,approach.physical.reason);assert.equal(approach.lesson.routeComplete,false);assert.equal(approach.lesson.routeFault,false);
      report.approach=approach;report.before={...report.start,physical:approach.physical,lesson:approach.lesson,distance:approach.distance};
      await b.call(()=>{const q=__forkEntryQA;q.s.execute=q.execute;q.preKeyPosition=q.record.object.position.toArray();});
      await until(()=>b.evaluate('__forkEntryQA.d.docking.forkCamera.getStats().frontFrames>0'),'The real auxiliary camera did not render.');await shot('fork-entry-main-isometric');
      report.isometric=await b.call(()=>{const q=__forkEntryQA,c=q.d.docking.forkCamera;return {stats:c.getStats(),eyeLocal:c.framing.eyeLocal.toArray(),aimLocal:c.framing.aimLocal.toArray()};});
      let frame=report.isometric.stats.frontFrames;
      await b.call(()=>{const d=__forkEntryQA.d;d.docking.forkCamera.setMode('entry');d.docking.update(true);});
      await until(()=>b.call(frame=>__forkEntryQA.d.docking.forkCamera.getStats().frontFrames>frame,frame),'The frontal feed did not render.');await shot('fork-entry-frontal');
      report.frontal=await b.call(()=>__forkEntryQA.d.docking.forkCamera.getStats());frame=report.frontal.frontFrames;
      await b.call(()=>{const d=__forkEntryQA.d;d.docking.forkCamera.setMode('isometric');d.docking.forkCamera.switchSide();d.docking.update(true);});
      await until(()=>b.call(frame=>__forkEntryQA.d.docking.forkCamera.getStats().frontFrames>frame,frame),'The opposite isometric feed did not render.');await shot('fork-entry-isometric-opposite');
      report.preKey=await b.call(()=>{const q=__forkEntryQA;context.renderer.domElement.focus();return {waypointIndex:q.v.training.waypointIndex,routeComplete:q.s.vehicleTraining.routeComplete(q.record),routeFault:!!q.v.training.routeFault,physical:q.s.vehicleRuntime.getDockingState(q.record),distance:q.v.distance};});
      assert.equal(report.preKey.routeComplete,false);assert(report.preKey.distance>1.2);assert(report.preKey.physical.ready,report.preKey.physical.reason);
      await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'g',code:'KeyG',windowsVirtualKeyCode:71});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'g',code:'KeyG',windowsVirtualKeyCode:71});
      await until(()=>b.evaluate('!!__forkEntryQA.v.entry'),'A real G command did not take the physical pallet.');
      report.after=await b.call(()=>{const q=__forkEntryQA;q.d.follow();q.d.docking.update(true);q.d.updateHUD();const g=q.s.vehicleTraining.guidance(q.record);return {guidance:g,sameEntry:q.v.entry===q.entry,sameProduct:q.v.entry.product===q.product,owner:q.product.sourceEntry.ownerId,truck:q.record.id,pocketsUnchanged:JSON.stringify(q.s.vehicleRuntime.productPockets(q.product))===q.pockets,chassisNotSnapped:q.preKeyPosition.every((v,i)=>Math.abs(v-q.record.object.position.toArray()[i])<.000001),stateValid:q.s.vehicleTraining.validateState(q.record),gl:context.renderer.getContext().getError()};});
      assert.equal(report.after.guidance.phase,'drop');assert.equal(report.after.guidance.score,20);assert(report.after.sameEntry&&report.after.sameProduct&&report.after.owner===report.after.truck&&report.after.pocketsUnchanged&&report.after.chassisNotSnapped&&report.after.stateValid);assert.equal(report.after.gl,0);await shot('fork-entry-after-real-G');
      report.environmentalFontRequests=report.failedRequests.filter(row=>{try{const u=new URL(row.url);return u.hostname==='code.cdn.mozilla.net'&&u.pathname.startsWith('/fonts/');}catch(_){return false;}});
      const unexpected=report.failedRequests.filter(row=>!report.environmentalFontRequests.includes(row));assert.deepEqual(unexpected,[]);assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin+'/')&&row.status>=400),[]);assert.deepEqual(fixture.errors,[]);
      report.passed=true;
    });
    assert.equal(hash(fs.readFileSync(path.resolve(file))),prepared.evidence.inputSha256,'The source project file changed.');
    return report;
  }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
  finally{report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,report:path.join(OUT,'report.json'),screenshots:report.screenshots.length}));}
}
module.exports={prepare,run};if(require.main===module){const arg=process.argv.indexOf('--document');run(arg>=0?process.argv[arg+1]:undefined).catch(error=>{console.error(error);process.exitCode=1;});}
