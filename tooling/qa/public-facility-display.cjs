'use strict';
// Exact public artifact, native RAF and real GPU images. A declared vehicle
// pose fixture frames an existing pallet; cargo and readiness stay native.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/public-facility-display');
const hash=b=>createHash('sha256').update(b).digest('hex'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(expected){
 assert.match(expected||'',/^[a-f0-9]{64}$/);assert.equal(hash(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))),expected);
 assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/publication.json'))).bundleSha256,expected);
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const report={publicSha256:expected,normalRAF:true,manualPhysicsTicks:0,physicalHeadsetTest:false,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],layouts:[]};
 const fixture=await startFixture('Disposable-Facility-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});fixture.renderBackend='d3d11';
 try{
  assert.equal((await request(fixture.origin,'/viewer.js')).sha256,expected);
  await withBrowser(fixture,report,async b=>{
   const shot=async name=>{await delay(250);const png=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(png.data,'base64'));report.screenshots.push(file);};
   const viewport=async(width,height)=>{await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(350);};
   const live=()=>b.until(()=>b.evaluate('!!smartTwinViewer.context.demo.driving.docking.forkCamera.facility&&smartTwinViewer.context.demo.driving.docking.forkCamera.hasCurrentFrame()'),'Real facility image unavailable.',20000);
   const capture=()=>b.call(()=>{const c=smartTwinViewer.context,m=c.demo.driving.docking,f=m.forkCamera,rect=e=>{if(!e||e.hidden)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};return{mode:m.mode,expanded:m.expanded,renderMode:m.plan.dataset.renderMode,monitor:rect(m.element),operator:rect(m.operatorColumn),plan:rect(m.plan),feed:rect(m.feedViewport),body:rect(m.body),canvas:[m.canvas.width,m.canvas.height],frameError:smartTwinViewer.getStats().frameError,camera:{...f.stats},hasTarget:!!f.target,live:f.hasCurrentFrame(),projection:m.facilityLayout.projection&&{rotation:m.facilityLayout.projection.rotation,plot:m.facilityLayout.projection.plot},viewport:{width:innerWidth,height:innerHeight}};});
   await viewport(1600,1000);await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});await b.send('Page.navigate',{url:fixture.origin+'/'});
   await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Welcome unavailable.',60000);await b.evaluate('document.querySelector("#explore-demo").click()');await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo'),'Demo unavailable.',90000);
   await b.call(()=>{const d=smartTwinViewer.context.demo;if(!d.driving.mount(d.stats().vehicle.id))throw Error('Boarding failed');d.driving.docking.forceLayout=true;d.driving.docking.update(true);});
   await live();await b.until(()=>b.evaluate('smartTwinViewer.context.demo.driving.docking.plan.dataset.renderMode==="live"'),'Map overlay not ready.');
   report.layouts.push(await capture());await shot('facility-live');
   await b.call(()=>smartTwinViewer.context.demo.driving.docking.setExpanded(true));await live();await shot('facility-expanded');report.layouts.push(await capture());
   report.pixels=await b.call(()=>{const c=smartTwinViewer.context,f=c.demo.driving.docking.forkCamera,t=f.target,p=new Uint8Array(t.width*t.height*4);c.renderer.readRenderTargetPixels(t,0,0,t.width,t.height,p);const colors=new Set();let gray=0,yellow=0,blue=0;for(let i=0;i<p.length;i+=16){const r=p[i],g=p[i+1],b=p[i+2];colors.add([r>>3,g>>3,b>>3].join(':'));if(r>35&&Math.max(r,g,b)-Math.min(r,g,b)<40)gray++;if(r>70&&g>50&&b<g*.7)yellow++;if(b>r*1.12&&b>40)blue++;}return{colors:colors.size,gray,yellow,blue,pixels:p.length/4,width:t.width,height:t.height};});
   assert(report.pixels.colors>40&&report.pixels.gray>100&&report.pixels.yellow>10,'Native floor, marking and machine colours must be present.');
   for(const [width,height]of [[1280,720],[900,700],[640,360],[390,844]]){await viewport(width,height);await live();const state=await capture();assert.equal(state.frameError,null);assert(state.monitor.x>=-1&&state.monitor.right<=width+1&&state.monitor.bottom<=height+1);report.layouts.push(state);await shot('facility-'+width);}
   await viewport(1600,1000);
   report.initialPoseFixture=await b.call(()=>{
    const a=smartTwinViewer,T=a.THREE,c=a.context,d=c.demo,dr=d.driving,r=dr.record(),v=r.components.vehicle,api=d.simulation.vehicleRuntime;
    const candidates=[...d.simulation.products.values()].filter(p=>api.productPockets(p)&&!p.vehicleOwnerId&&!p.robotOwnerId&&!p.robotReservedBy);
    let chosen=null;
    for(const product of candidates){const dock=api.pickupDock(r,{targetId:product.sourceEntry&&product.sourceEntry.ownerId||v.config.sourceId},product);if(dock){chosen={product,dock};break;}}
    if(!chosen)throw Error('No physical pallet for inspection fixture');
    const {product,dock}=chosen;dr.resetInput();r.object.position.copy(r.object.parent.worldToLocal(dock.position.clone()));r.object.quaternion.copy(r.object.parent.getWorldQuaternion(new T.Quaternion()).inverse().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),dock.yaw)));
    v.pose.lift=Math.max(0,Math.min(v.config.maxLift,dock.toolY-dock.position.y-v.config.forkBaseHeight));v.actualSpeed=0;v.parkingBrake=true;c.scene.updateMatrixWorld(true);c.collisionWorld.invalidate(r.object);dr.follow();dr.docking.forceLayout=false;dr.docking.inspectionMode.reset();dr.holographicGuide.update(true);dr.docking.update(true);
    return{kind:'QA vehicle pose framing an unchanged native pallet',product:product.object.name,position:r.object.position.toArray(),yaw:dock.yaw,lift:v.pose.lift,population:d.simulation.products.size};
   });
   await b.until(()=>b.evaluate('smartTwinViewer.context.demo.driving.docking.mode==="inspection"&&smartTwinViewer.context.demo.driving.docking.forkCamera.hasCurrentFrame()'),'Real inspection image unavailable.',20000);
   const inspection=await capture();report.inspection=inspection;assert(inspection.plan.width>=inspection.body.width*.35);assert(inspection.plan.height>=inspection.feed.height*.9);assert(inspection.plan.right<=inspection.feed.x+1);assert(inspection.monitor.x>=inspection.operator.right+8,'Expanded inspection must leave the driving controls accessible.');await shot('insertion-expanded');
   await b.call(()=>smartTwinViewer.context.demo.driving.docking.setExpanded(false));await delay(350);report.compact=await capture();await shot('insertion-compact');
   report.inspectionViewports=[];
   for(const [width,height]of [[900,700],[780,390],[390,844]]){await viewport(width,height);await b.call(()=>smartTwinViewer.context.demo.driving.docking.setExpanded(true));await delay(350);const view=await capture();assert.equal(view.mode,'inspection');assert.equal(view.frameError,null);assert(view.monitor.x>=-1&&view.monitor.right<=width+1&&view.monitor.bottom<=height+1);report.inspectionViewports.push(view);await shot('insertion-'+width);}
   await viewport(1600,1000);
   await b.call(()=>{const m=smartTwinViewer.context.demo.driving.docking;m.forceLayout=true;m.update(true);});await live();await delay(400);
   const before=await capture();await delay(25000);const after=await capture();assert(after.camera.frames>before.camera.frames);assert.equal(after.camera.allocations,before.camera.allocations,'A stationary map must reuse its render target.');assert.equal(after.frameError,null);assert(after.camera.estimatedGpuBytes<=after.camera.gpuBudgetBytes);report.sustainedMap={seconds:25,before:before.camera,after:after.camera};
  });
  assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(fixture.errors,[]);report.passed=true;
 }catch(error){report.failure=error.stack||String(error);throw error;}
 finally{report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,report:path.join(OUT,'report.json')}));}
 return report;
}
module.exports={run};if(require.main===module)run(process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
