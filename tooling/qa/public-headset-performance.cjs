'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/public-headset-performance');
async function run(expected,baseline=false){
 assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))).digest('hex'),expected);
 fs.mkdirSync(OUT,{recursive:true});const report={hash:expected,baseline,physicalHeadset:false,exceptions:[],consoleErrors:[],failedRequests:[],responses:[]};
 const fixture=await startFixture('Disposable-Headset-Perf-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});fixture.renderBackend='d3d11';
 try{await withBrowser(fixture,report,async b=>{
  await b.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 OculusBrowser/40.0 Chrome/136.0 Mobile VR Safari/537.36'});
  await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:true});
  await b.send('Page.navigate',{url:fixture.origin+'/'});await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Welcome unavailable.');
  await b.evaluate('document.querySelector("#explore-demo").click()');await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo'),'Demo unavailable.',90000);
  report.initial=await b.call(()=>{
   const a=smartTwinViewer,c=a.context,T=a.THREE,d=c.demo;c.renderer.setAnimationLoop(null);d.setPaused(true);
   c.cameraRig.position.set(0,0,0);c.cameraRig.quaternion.set(0,0,0,1);c.camera.position.set(-7.4,4.6,7.8);c.camera.lookAt(3,1,-2.8);c.scene.updateMatrixWorld(true);
   const inventory=()=>{const textures=new Set(),geometries=new Set(),materials=new Set(),groups=[];let meshes=0,triangles=0,bytes=0;
    c.scene.traverse(n=>{if(!n.isMesh)return;meshes++;geometries.add(n.geometry);triangles+=(n.geometry.index?n.geometry.index.count:n.geometry.attributes.position.count)/3;for(const m of Array.isArray(n.material)?n.material:[n.material]){materials.add(m);for(const k of Object.keys(m))if(m[k]?.isTexture)textures.add(m[k]);}});
    for(const t of textures){const i=t.image;if(i?.width&&i?.height)bytes+=i.width*i.height*4*(t.generateMipmaps?4/3:1);}
    for(const r of d.simulation.records.values()){let count=0;r.object.traverse(n=>{if(n.isMesh)count++;});groups.push({name:r.object.name,meshes:count});}
    return{meshes,triangles,geometries:geometries.size,materials:materials.size,textures:textures.size,estimatedTextureBytes:bytes,groups:groups.sort((a,b)=>b.meshes-a.meshes).slice(0,12)};
   };
   const render=()=>{c.renderer.render(c.scene,c.camera);return{...c.renderer.info.render};};
   const shadowed=render(),saved=c.renderer.shadowMap.enabled;c.renderer.shadowMap.enabled=false;const unshadowed=render();c.renderer.shadowMap.enabled=saved;
   const start=performance.now();for(let i=0;i<10;i++)d.simulation.syncNativePresentation();const bankCheckMs=(performance.now()-start)/10;
   window.__headsetQA={a,c,d,T,inventory,render};return{graphics:c.graphics.getStats(),inventory:inventory(),shadowed,unshadowed,memory:{...c.renderer.info.memory},frameError:a.getStats().frameError,renderBudget:a.getStats().renderBudget,bankFailure:d.simulation.nativePresentationFailure,bankCheckMs};
  });
  const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(OUT,baseline?'before.png':'after.png'),Buffer.from(shot.data,'base64'));
  if(!baseline){
   const before=JSON.parse(fs.readFileSync(path.join(OUT,'baseline.json'))).initial;
   assert(report.initial.unshadowed.calls<before.unshadowed.calls*.8,'The same general view must reduce draw submissions by at least 20%.');
   assert(!report.initial.bankFailure);assert.equal(report.initial.graphics.ceiling,'balanced');
   await b.send('Page.reload',{ignoreCache:true});await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Reload unavailable.');await b.evaluate('document.querySelector("#explore-demo").click()');await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo&&smartTwinViewer.getStats().frameCount>12'),'Native loop unavailable.',90000);
   report.recovery=[];
   for(let cycle=0;cycle<3;cycle++){
    await b.call(()=>{const c=smartTwinViewer.context,xr=c.renderer.xr,original=xr.getSession,session=new EventTarget();session.visibilityState='visible';session.inputSources=[];session.end=()=>{window.__endedLossSession=(window.__endedLossSession||0)+1;xr.getSession=original;c.vrMode=false;session.dispatchEvent(new Event('end'));return Promise.resolve();};xr.getSession=()=>session;c.vrMode=true;window.__lossExtension=c.renderer.getContext().getExtension('WEBGL_lose_context');if(!__lossExtension)throw Error('Cannot exercise real WebGL context loss.');__lossExtension.loseContext();});
    await b.until(()=>b.evaluate('smartTwinViewer.getStats().contextLost'),'Context loss was not detected.');
    const stopped=await b.call(()=>({frames:smartTwinViewer.getStats().frameCount,time:smartTwinViewer.context.demo.simulation.time}));
    await new Promise(resolve=>setTimeout(resolve,100));const held=await b.call(()=>({frames:smartTwinViewer.getStats().frameCount,time:smartTwinViewer.context.demo.simulation.time}));assert.deepEqual(held,stopped);
    await b.evaluate('__lossExtension.restoreContext()');await b.until(()=>b.evaluate('!smartTwinViewer.getStats().contextLost&&smartTwinViewer.getStats().frameCount>'+stopped.frames+'+10'),'Rendering failed to recover.',90000);
    const state=await b.call(()=>({memory:{...smartTwinViewer.context.renderer.info.memory},error:smartTwinViewer.context.renderer.getContext().getError(),losses:smartTwinViewer.getStats().contextRecovery.losses,frameError:smartTwinViewer.getStats().frameError,ended:__endedLossSession}));
    assert.equal(state.error,0);assert.equal(state.frameError,null);assert.equal(state.losses,cycle+1);assert.equal(state.ended,cycle+1);assert(state.memory.textures>0&&state.memory.geometries>0);report.recovery.push(state);
   }
   assert(report.recovery.at(-1).memory.textures<=report.recovery[0].memory.textures+8,'Repeated restoration must not accumulate stale texture handles.');
  }
 });assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);report.passed=true;
 }catch(error){report.failure=error.stack;throw error;}finally{fs.writeFileSync(path.join(OUT,baseline?'baseline.json':'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,path:OUT}));}
}
module.exports={run};if(require.main===module)run(process.argv[2],process.argv.includes('--baseline')).catch(error=>{console.error(error);process.exitCode=1;});
