'use strict';
// Exact production canvas text, near/distant/oblique desktop views, and a
// stereo projection boundary. No other scene/render-quality settings change.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/contextual-message-clarity');
async function run(expected,baseline=false){
 assert.match(expected||'',/^[a-f0-9]{64}$/);assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))).digest('hex'),expected);
 fs.mkdirSync(OUT,{recursive:true});const report={publicSha256:expected,baseline,physicalHeadsetTest:false,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};
 const fixture=await startFixture('Disposable-Text-Clarity-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});fixture.renderBackend='d3d11';
 try{await withBrowser(fixture,report,async b=>{
  const shot=async name=>{const png=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,(baseline?'before-':'after-')+name+'.png');fs.writeFileSync(file,Buffer.from(png.data,'base64'));report.screenshots.push(file);};
  await b.send('Emulation.setDeviceMetricsOverride',{width:2312,height:1296,deviceScaleFactor:1,mobile:false});
  await b.send('Page.navigate',{url:fixture.origin+'/'});await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Welcome unavailable.');
  await b.evaluate('document.querySelector("#explore-demo").click()');await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo?.interactions'),'Messages unavailable.',90000);
  await b.call(()=>{
   const a=smartTwinViewer,c=a.context,d=c.demo;c.renderer.setAnimationLoop(null);d.setPaused(true);
   c.renderer.setPixelRatio(1);c.renderer.setSize(2312,1296,false);c.camera.aspect=2312/1296;c.camera.updateProjectionMatrix();
   const tick=()=>{c.scene.updateMatrixWorld(true);c.collisionWorld.beginFrame();try{for(let i=0;i<22;i++)d.interactions.execute(.1,d.simulation.time);}finally{c.collisionWorld.endFrame();}};
   const info=()=>{const x=d.interactions.contextualActive;if(!x?.card)throw Error('Visible card missing.');return{width:x.texture.image.width,height:x.texture.image.height,
    title:x.config.title,generateMipmaps:x.texture.generateMipmaps,minFilter:x.texture.minFilter,anisotropy:x.texture.anisotropy,
    canvases:d.interactions.contextualStats.canvases,bytes:d.interactions.contextualStats.textureBytes,redraws:d.interactions.contextualStats.redraws,
    textures:c.renderer.info.memory.textures,webgl2:c.renderer.capabilities.isWebGL2,buffer:[c.renderer.domElement.width,c.renderer.domElement.height]};};
   window.__messageClarity={a,c,d,tick,info,view(position){c.camera.position.fromArray(position);c.camera.lookAt(-4.7,1.6,-3.1);tick();c.renderer.render(c.scene,c.camera);return info();}};
  });
  report.distant=await b.call(()=>__messageClarity.view([-4.7,1.6,-.1]));await shot('reading-distance');
  report.near=await b.call(()=>__messageClarity.view([-4.66,1.6,-2.42]));await shot('close-reading');
  report.stable=await b.call(()=>{const q=__messageClarity,before=q.info();q.tick();q.c.renderer.render(q.c.scene,q.c.camera);return{before,after:q.info()};});
  report.oblique=await b.call(()=>__messageClarity.view([-4.1,2.15,-2.05]));await shot('oblique-reading');
  report.stereo=await b.call(()=>{
   const q=__messageClarity,T=q.a.THREE,xr=q.c.renderer.xr,original=xr.getCamera;
   const eyes=[new T.PerspectiveCamera(75,1,.01,20),new T.PerspectiveCamera(75,1,.01,20)];
   eyes.forEach((eye,index)=>{eye.position.set(-4.7+(index?.032:-.032),1.6,-2.42);eye.lookAt(-4.7,1.6,-3.1);eye.viewport=new T.Vector4(index*1440,0,1440,1600);eye.updateMatrixWorld(true);});
   const measured=eyes.map(eye=>eye.matrixWorld.clone()),stereo=new T.ArrayCamera(eyes);stereo.position.set(-4.7,1.6,-2.42);stereo.lookAt(-4.7,1.6,-3.1);stereo.updateMatrixWorld(true);
   try{q.c.vrMode=true;xr.getCamera=()=>stereo;q.tick();const info=q.info();return{...info,eyesUnchanged:eyes.every((eye,index)=>eye.matrixWorld.equals(measured[index]))};}
   finally{q.c.vrMode=false;xr.getCamera=original;}
  });
  if(!baseline){
   assert.equal(report.near.title,'Cajas de banda en banda');assert(report.near.width>=2048);assert(report.distant.width>=1024);
   assert.equal(report.near.generateMipmaps,false);assert.equal(report.near.minFilter,require('three').LinearFilter);
   assert.equal(report.stable.before.redraws,report.stable.after.redraws);assert.equal(report.stable.before.textures,report.stable.after.textures);
   assert(report.stereo.eyesUnchanged&&report.stereo.width<=2048&&report.stereo.bytes<=20*1024*1024);
  }
  report.cleanup=await b.call(()=>{const q=__messageClarity;q.d.interactions.stop();return{canvases:q.d.interactions.contextualStats.canvases,bytes:q.d.interactions.contextualStats.textureBytes};});
  assert.equal(report.cleanup.canvases,0);if(!baseline)assert.equal(report.cleanup.bytes,0);
 });assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(fixture.errors,[]);report.passed=true;
 }catch(error){report.failure=error.stack||String(error);throw error;}
 finally{fs.writeFileSync(path.join(OUT,baseline?'baseline.json':'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,report:path.join(OUT,baseline?'baseline.json':'report.json')}));}
 return report;
}
module.exports={run};if(require.main===module)run(process.argv[2],process.argv.includes('--baseline')).catch(error=>{console.error(error);process.exitCode=1;});
