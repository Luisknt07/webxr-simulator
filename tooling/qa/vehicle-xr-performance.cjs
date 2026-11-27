'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/vehicle-xr-performance'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(expected,baseline=false){
 assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))).digest('hex'),expected);
 fs.mkdirSync(OUT,{recursive:true});const report={hash:expected,baseline,physicalHeadset:false,exceptions:[],consoleErrors:[],failedRequests:[],responses:[]};
 const fixture=await startFixture('Disposable-XR-Cab-Perf-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});fixture.renderBackend='d3d11';
 try{await withBrowser(fixture,report,async b=>{
  await b.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 OculusBrowser/40.0 Chrome/136.0 Mobile VR Safari/537.36'});
  await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:true});await b.send('Page.navigate',{url:fixture.origin+'/'});
  await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Welcome unavailable.');await b.evaluate('document.querySelector("#explore-demo").click()');await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo&&smartTwinViewer.getStats().frameCount>12'),'Demo unavailable.',90000);
  await b.call(()=>{
   const a=smartTwinViewer,c=a.context,d=c.demo,dr=d.driving,original={session:c.renderer.xr.getSession,camera:c.renderer.xr.getCamera},session=new EventTarget();session.visibilityState='visible';session.inputSources=[];session.frameRate=72;
   c.renderer.xr.getSession=()=>session;c.renderer.xr.getCamera=()=>c.camera;c.vrMode=true;
   const timings={},wrap=(object,key,name)=>{const method=object[key];if(typeof method!=='function')return;object[key]=function(...args){const start=performance.now();try{return method.apply(this,args);}finally{const values=timings[name]||(timings[name]=[]);if(values.length<1500)values.push(performance.now()-start);}};};
   for(const [o,k,n]of [[dr,'mount','mount'],[dr,'beforeStep','driving'],[dr,'follow','follow'],[dr,'updateHUD','hud'],[dr.holographicGuide,'update','hologram'],[dr.frontVisibility,'mount','frontMount'],[dr.docking,'mount','dockingMount'],[dr.cab,'mount','cabMount'],[dr.docking,'update','docking'],[dr.docking.forkCamera,'renderBefore','auxCamera'],[dr.docking.facilityLayout,'update','layout'],[d.simulation,'execute','simulation'],[d.simulation,'syncNativePresentation','banks'],[c.input,'step','input']])if(o)wrap(o,k,n);
   const renders=[];c.renderer.render=(function(original){return function(scene,camera){const start=performance.now(),offscreen=!!this.getRenderTarget();try{return original.apply(this,arguments);}finally{if(renders.length<2000)renders.push({ms:performance.now()-start,offscreen,world:scene===c.scene,calls:this.info.render.calls});}};})(c.renderer.render);
   window.__cabPerf={a,c,d,dr,session,original,timings,renders,summary(){const out={};for(const [name,values]of Object.entries(timings)){const sorted=values.slice().sort((a,b)=>a-b);out[name]={calls:values.length,totalMs:values.reduce((a,b)=>a+b,0),mean:values.reduce((a,b)=>a+b,0)/values.length,p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)};}return{timings:out,renders:renders.slice(),frames:a.getStats().frameCount,camera:dr.docking.forkCamera.getStats(),banks:d.simulation.nativeRenderBanks.getStats(),memory:{...c.renderer.info.memory},failure:a.getStats().frameError,guide:dr.holographicGuide.getStats?.(),mounted:!!dr.id};},reset(){for(const k of Object.keys(timings))delete timings[k];renders.length=0;}};
  });
  await delay(1200);report.walking=await b.call(()=>__cabPerf.summary());
  report.board=await b.call(()=>{const q=__cabPerf;q.reset();if(!q.dr.mount(q.d.stats().vehicle.id))throw Error('Boarding failed.');return q.summary();});
  await delay(3500);report.occupied=await b.call(()=>__cabPerf.summary());
  await b.call(()=>{const q=__cabPerf;q.reset();q.c.camera.lookAt(q.dr.docking.plane.getWorldPosition(new q.a.THREE.Vector3()));q.c.camera.updateMatrixWorld(true);});await delay(1500);report.lookingAtMap=await b.call(()=>__cabPerf.summary());
  const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(OUT,baseline?'before-cab.png':'after-cab.png'),Buffer.from(shot.data,'base64'));
  assert.equal(report.occupied.failure,null);assert(report.occupied.mounted);
  if(!baseline){
   const before=JSON.parse(fs.readFileSync(path.join(OUT,'baseline.json')));assert(report.board.timings.mount.max<before.board.timings.mount.max*.5,'Quest boarding must remove the measured long synchronous entry stall.');
   assert(!report.lookingAtMap.renders.some(r=>r.offscreen&&r.world),'The restored Quest map must never render the full world.');
   assert(report.lookingAtMap.renders.some(r=>!r.offscreen));assert(report.lookingAtMap.renders.some(r=>r.offscreen&&!r.world),'The map must display the native lightweight view.');assert(report.lookingAtMap.camera.estimatedGpuBytes<=12*1024*1024);assert.equal(report.lookingAtMap.camera.samples,0);assert(report.lookingAtMap.camera.maxFPS<=1);
   assert.equal(await b.call(()=>{const q=__cabPerf;q.reset();return q.dr.docking.toggleRearView();}),false);
   await delay(500);report.requestedCamera=await b.call(()=>__cabPerf.summary());assert(!report.requestedCamera.renders.some(r=>r.offscreen&&r.world));assert.equal(report.requestedCamera.camera.mirrorTargetAllocated,false);
   report.cycles=[];for(let i=0;i<3;i++){
    const state=await b.call(()=>{const q=__cabPerf,atlas=q.dr.cab.labels.texture.uuid,start=performance.now();q.dr.unmount(true);q.dr.mount(q.d.stats().vehicle.id);return{ms:performance.now()-start,sameAtlas:q.dr.cab.labels.texture.uuid===atlas,camera:q.dr.docking.forkCamera.getStats(),wire:q.dr.frontVisibility.getWireStats()};});
    assert(state.sameAtlas);assert.equal(state.camera.mirrorTargetAllocated,false);assert(state.camera.estimatedGpuBytes<=12*1024*1024);assert.equal(state.wire.segments,0);report.cycles.push(state);await delay(300);
   }
   assert.equal(await b.call(()=>__cabPerf.c.renderer.getContext().getError()),0);
  }
 });assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);report.passed=true;
 }catch(error){report.failure=error.stack;throw error;}finally{fs.writeFileSync(path.join(OUT,baseline?'baseline.json':'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,path:OUT}));}
}
module.exports={run};if(require.main===module)run(process.argv[2],process.argv.includes('--baseline')).catch(error=>{console.error(error);process.exitCode=1;});
