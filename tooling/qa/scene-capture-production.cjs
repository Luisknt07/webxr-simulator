'use strict';
// Reviewed compiled applications, actual WebGL pixels/native MediaRecorder and
// an isolated Chrome/HTTPS database. No actor transforms or mission state edits.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/scene-capture-production');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const PHOTO='.public-scene-tools .scene-capture-button[aria-label="Guardar foto del escenario"]';
const RECORD='.public-scene-tools .scene-capture-button[aria-label="Grabar vídeo del escenario"]';
const STOP='.public-scene-tools .scene-capture-button[aria-label="Detener grabación del escenario"]';

function reviewed(app,file,expected){
 assert.match(expected||'',/^[a-f0-9]{64}$/,'Pass both reviewed --expected-public-sha256 and --expected-workspace-sha256.');
 const folder=path.join(ROOT,'artifacts',app),manifest=JSON.parse(fs.readFileSync(path.join(folder,'publication.json'),'utf8'));
 assert.equal(hash(fs.readFileSync(path.join(folder,file))),expected,app+' artifact changed after review.');assert.equal(manifest.bundleSha256,expected,app+' publication receipt is stale.');
 const css='packages/scene-capture/scene-capture.css',entry=manifest.files.find(row=>row.path===css);assert(entry,app+' did not package the shared capture CSS.');
 assert.equal(hash(fs.readFileSync(path.join(folder,css))),entry.sha256);assert.equal(hash(fs.readFileSync(path.join(ROOT,css))),entry.sha256,'Capture CSS source/receipt mismatch.');
 return{bundleSha256:expected,captureCSS:entry.sha256};
}

const instrument=`(()=>{
 const qa=window.__sceneCaptureQA={captures:[],streams:[],createdURLs:[],revokedURLs:[],mediaRequests:[],trustedClicks:[],touchEvents:[],nativeRecorder:window.MediaRecorder};
 if(navigator.mediaDevices)for(const name of ['getUserMedia','getDisplayMedia'])if(typeof navigator.mediaDevices[name]==='function'){
  navigator.mediaDevices[name]=function(){qa.mediaRequests.push(name);return Promise.reject(new Error('Hardware/screen permissions are forbidden in scene-capture QA.'));};
 }
 const stream=HTMLCanvasElement.prototype.captureStream;
 if(stream)HTMLCanvasElement.prototype.captureStream=function(fps){const value=stream.call(this,fps);qa.streams.push({fps,stream:value,width:this.width,height:this.height});return value;};
 const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL=function(blob){const url=create(blob);qa.createdURLs.push({url,size:blob.size,type:blob.type});return url;};
 URL.revokeObjectURL=function(url){qa.revokedURLs.push(String(url));return revoke(url);};
 document.addEventListener('click',event=>{const button=event.target.closest&&event.target.closest('.scene-capture-button,[data-camera-mode]');if(button)qa.trustedClicks.push({label:button.getAttribute('aria-label')||button.textContent.trim(),trusted:event.isTrusted});},true);
 for(const type of ['pointerdown','pointerup','pointercancel'])document.addEventListener(type,event=>{const button=event.target.closest&&event.target.closest('[data-flight-axis]');if(button)qa.touchEvents.push({type,axis:button.dataset.flightAxis,pointerType:event.pointerType,trusted:event.isTrusted});},true);
})();`;

async function inspectPNG(browser,index){
 return browser.call(async index=>{
  const capture=__sceneCaptureQA.captures[index],image=await createImageBitmap(capture.blob),canvas=document.createElement('canvas');
  canvas.width=96;canvas.height=64;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,96,64);
  const data=ctx.getImageData(0,0,96,64).data,colors=new Set();let min=255,max=0,sum=0,squared=0,visible=0;
  for(let i=0;i<data.length;i+=4){const luma=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];min=Math.min(min,luma);max=Math.max(max,luma);sum+=luma;squared+=luma*luma;if(luma>8&&data[i+3]>0)visible++;colors.add((data[i]>>3)+','+(data[i+1]>>3)+','+(data[i+2]>>3));}
  const count=data.length/4,mean=sum/count,header=Array.from(new Uint8Array(await capture.blob.slice(0,8).arrayBuffer()));
  const result={width:image.width,height:image.height,bytes:capture.blob.size,mime:capture.blob.type,header,colors:colors.size,min,max,mean,stddev:Math.sqrt(squared/count-mean*mean),visibleRatio:visible/count,source:capture.source};
  image.close();canvas.width=canvas.height=1;return result;
 },index);
}

async function inspectVideo(browser,index){
 return browser.call(async index=>{
  const capture=__sceneCaptureQA.captures[index],video=document.createElement('video'),url=URL.createObjectURL(capture.blob),canvas=document.createElement('canvas');
  video.muted=true;video.playsInline=true;video.preload='auto';canvas.width=96;canvas.height=64;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const frames=[];let completed=false,rvfc=null,timer=null,first=null,maxMeanDifference=0,maxChangedRatio=0;
  try{
   await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Native video decoder timed out loading the real recorded Blob.')),15000);video.onloadeddata=()=>{clearTimeout(timeout);resolve();};video.onerror=()=>{clearTimeout(timeout);reject(Error('Native video decoder rejected the recorded '+capture.blob.type+' Blob.'));};video.src=url;video.load();});
   const width=video.videoWidth,height=video.videoHeight;
   await new Promise((resolve,reject)=>{
    const sample=(_,metadata)=>{
     if(completed)return;
     try{
      ctx.drawImage(video,0,0,96,64);const pixels=ctx.getImageData(0,0,96,64).data;
      if(!first)first=new Uint8ClampedArray(pixels);let difference=0,changed=0,visible=0,lumaSum=0,lumaSquared=0;
      for(let i=0;i<pixels.length;i+=4){let delta=0;for(let c=0;c<3;c++){const d=Math.abs(pixels[i+c]-first[i+c]);delta+=d;difference+=d;}if(delta>24)changed++;if(pixels[i]+pixels[i+1]+pixels[i+2]>24)visible++;const luma=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];lumaSum+=luma;lumaSquared+=luma*luma;}
      const mean=difference/(pixels.length/4*3),ratio=changed/(pixels.length/4);maxMeanDifference=Math.max(maxMeanDifference,mean);maxChangedRatio=Math.max(maxChangedRatio,ratio);
      const frameMean=lumaSum/(pixels.length/4),stddev=Math.sqrt(Math.max(0,lumaSquared/(pixels.length/4)-frameMean*frameMean));
      if(frames.length<180)frames.push({mediaTime:metadata&&metadata.mediaTime||video.currentTime,meanDifference:mean,changedRatio:ratio,visibleRatio:visible/(pixels.length/4),stddev});
      if(video.requestVideoFrameCallback)rvfc=video.requestVideoFrameCallback(sample);
     }catch(error){completed=true;clearTimeout(timer);reject(error);}
    };
    video.onended=()=>{completed=true;clearTimeout(timer);resolve();};video.onerror=()=>{completed=true;clearTimeout(timer);reject(Error('Native decoder failed while playing the recording.'));};
    timer=setTimeout(()=>{completed=true;reject(Error('The real video did not finish playing within its bounded duration.'));},Math.min(20000,Math.max(8000,(capture.durationMs||4000)+6000)));
    if(video.requestVideoFrameCallback)rvfc=video.requestVideoFrameCallback(sample);else video.ontimeupdate=()=>sample(0,{mediaTime:video.currentTime});
    video.play().catch(error=>{completed=true;clearTimeout(timer);reject(error);});
   });
   const header=Array.from(new Uint8Array(await capture.blob.slice(0,12).arrayBuffer()));
   return{width,height,bytes:capture.blob.size,mime:capture.blob.type,header,durationMs:capture.durationMs,reportedFrames:capture.frames,decodedFrames:frames.length,mediaTimes:[...new Set(frames.map(row=>row.mediaTime))],maxMeanDifference,maxChangedRatio,minVisibleRatio:Math.min(...frames.map(row=>row.visibleRatio)),minFrameStddev:Math.min(...frames.map(row=>row.stddev)),firstFrames:frames.slice(0,3),lastFrames:frames.slice(-3),nativeRecorder:window.MediaRecorder===__sceneCaptureQA.nativeRecorder};
  }finally{completed=true;clearTimeout(timer);if(rvfc!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(rvfc);video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);canvas.width=canvas.height=1;}
 },index);
}

async function saveCapture(browser,index,name){
 const encoded=await browser.call(async index=>{const bytes=new Uint8Array(await __sceneCaptureQA.captures[index].blob.arrayBuffer());let text='';for(let offset=0;offset<bytes.length;offset+=16384)text+=String.fromCharCode(...bytes.subarray(offset,offset+16384));return btoa(text);},index);
 const bytes=Buffer.from(encoded,'base64'),file=path.join(OUT,name);fs.writeFileSync(file,bytes);return{file,bytes:bytes.length,sha256:hash(bytes)};
}

async function run({expectedPublicSha256,expectedWorkspaceSha256}={}){
 const artifacts={public:reviewed('public-viewer','viewer.js',expectedPublicSha256),workspace:reviewed('workspace','bundle.js',expectedWorkspaceSha256)};
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const password='Disposable-Capture-'+randomBytes(18).toString('hex'),fixture=await startFixture(password,{voice:{enabled:false,key:''},voiceFetch:async()=>{throw Error('Capture QA must never contact external voice/AI services.');}});
 const report={startedAt:new Date().toISOString(),artifacts,temporaryDatabaseOnly:true,realCompiledApplication:true,nativeMediaRecorder:true,externalUpload:false,physicalQuestTest:false,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],viewports:[]};
 try{
  await withBrowser(fixture,report,async b=>{
   const mark=stage=>{report.stage=stage;console.log('Scene capture QA: '+stage);};
   const until=(callback,message)=>b.until(callback,message,120000);
   const downloadPath=path.join(fixture.application.api.store.dataDir,'qa-captures');assert(downloadPath.startsWith(path.resolve(fixture.application.api.store.dataDir)+path.sep));fs.mkdirSync(downloadPath,{recursive:true});
   await b.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath});
   const size=async(width,height,mobile=false)=>{await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await b.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:mobile?5:1});await delay(300);};
   const click=async selector=>{const point=await b.call(selector=>{const node=document.querySelector(selector);if(!node||node.disabled)throw Error('Unavailable real scene control: '+selector);node.scrollIntoView({block:'center',inline:'nearest'});const box=node.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2,hit=document.elementFromPoint(x,y);if(!hit||!(node===hit||node.contains(hit)))throw Error('A scene control is covered: '+selector);return{x,y};},selector);await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});};
   const shot=async name=>{await delay(150);const result=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(result.data,'base64'));report.screenshots.push(file);};
   const ready=()=>until(()=>b.evaluate('!!window.smartTwinViewer&&!!smartTwinViewer.context.sceneCapture&&smartTwinViewer.getStats().frameCount>8&&!!document.querySelector(".public-scene-tools .scene-capture-toolbar")'),'The compiled public scene/capture toolbar did not initialize.');
   const openDemo=async()=>{await b.send('Page.navigate',{url:fixture.origin+'/#escenarios'});await until(()=>b.evaluate('!!document.querySelector("#scene-grid .scene-open")'),'The public catalogue did not present its explicit demo action.');await click('#scene-grid .scene-open');await ready();};
   const bind=()=>b.call(()=>{
    const qa=__sceneCaptureQA,ctx=smartTwinViewer.context;qa.controller=ctx.sceneCapture;qa.context=ctx;
    qa.unsubscribe=ctx.sceneCapture.onCapture(result=>qa.captures.push({...result,source:{width:ctx.renderer.domElement.width,height:ctx.renderer.domElement.height,preserveDrawingBuffer:ctx.renderer.getContext().getContextAttributes().preserveDrawingBuffer}}));
    return{phase:ctx.sceneCapture.getState().phase,recordingSupported:ctx.sceneCapture.getState().canRecord,videoReason:ctx.sceneCapture.getState().recordingReason,renderer:ctx.renderer.getContext().getContextAttributes(),triangles:ctx.renderer.info.render.triangles};
   });
   const surface=async label=>b.call(label=>{
    const root=document.querySelector('.public-scene-tools'),toolbar=root&&root.querySelector('.scene-capture-toolbar'),canvas=smartTwinViewer.context.renderer.domElement;
    const box=node=>{const rect=node.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height,right:rect.right,bottom:rect.bottom};};
    return{label,width:innerWidth,height:innerHeight,coarse:matchMedia('(pointer:coarse)').matches,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,root:root&&box(root),toolbar:toolbar&&box(toolbar),canvas:box(canvas),source:{width:canvas.width,height:canvas.height},buttons:[...root.querySelectorAll('button')].filter(node=>!node.hidden&&getComputedStyle(node).display!=='none').map(node=>{const r=box(node),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{label:node.getAttribute('aria-label')||node.textContent.trim(),...r,disabled:node.disabled,reachable:!!hit&&(hit===node||node.contains(hit))};})};
   },label);
   const checkSurface=value=>{
    assert(!value.overflow,value.label+' has horizontal page overflow.');assert(value.toolbar&&value.root,'Missing visible scene tools.');
    for(const [name,box]of [['scene-tools',value.root],['capture-toolbar',value.toolbar]]){assert(box.x>=-1&&box.right<=value.width+1,name+' falls outside '+value.label);assert(box.y>=-1&&box.bottom<=value.height+1,name+' is below/above the viewport.');}
    for(const button of value.buttons){assert(button.reachable,button.label+' is covered at '+value.label);assert(button.width>=38&&button.height>=(value.coarse||value.width<=650?44:38),button.label+' is too small for the active pointer.');}
   };
   const touchState=()=>b.call(()=>{const ctx=smartTwinViewer.context;return{y:ctx.camera.getWorldPosition(new smartTwinViewer.THREE.Vector3()).y,axis:ctx.input.axes.z,pointers:ctx.input.flightPointers.size,frame:smartTwinViewer.getStats().frameCount};});
   const touchSurface=()=>b.call(()=>{
    const selectors=['.xr-browser-touch .touch-use','.xr-browser-touch [data-flight-axis="up"]','.xr-browser-touch [data-flight-axis="down"]'];
    return selectors.map(selector=>{const node=document.querySelector(selector),r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{selector,label:node.getAttribute('aria-label')||node.textContent,x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,reachable:!!hit&&(hit===node||node.contains(hit)),hidden:!r.width||!r.height||getComputedStyle(node).display==='none'};});
   });
   const testTouchAltitude=async view=>{
    await click('.public-scene-tools [data-camera-mode="drone"]');
    await b.until(()=>b.evaluate('smartTwinViewer.context.desktopFlight&&!smartTwinViewer.context.input.flightTouch.hidden'),'Actual touch altitude controls did not become available.',10000);
    const geometry=await touchSurface();for(const control of geometry){assert(!control.hidden&&control.reachable,control.label+' is covered or unavailable at '+view.width+'x'+view.height);assert(control.x>=0&&control.right<=view.width+1&&control.y>=0&&control.bottom<=view.height+1);assert(control.width>=44&&control.height>=44);}
    const actions=[];
    for(const axis of ['up','down']){
     const selector='.xr-browser-touch [data-flight-axis="'+axis+'"]',point=await b.call(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},selector),before=await touchState();
     await b.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:7,x:point.x,y:point.y,radiusX:2,radiusY:2,force:1}]});
     try{await b.until(()=>b.call(({before,axis})=>{const ctx=smartTwinViewer.context,y=ctx.camera.getWorldPosition(new smartTwinViewer.THREE.Vector3()).y;return ctx.input.flightPointers.size>0&&(axis==='up'?y>before+.05:y<before-.05);},{before:before.y,axis}),'Holding native touch '+axis+' did not change the actual camera altitude.',10000);}
     finally{await b.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
     await b.until(()=>b.evaluate('smartTwinViewer.context.input.axes.z===0&&smartTwinViewer.context.input.flightPointers.size===0'),'Touch altitude remained latched after finger release.',10000);
     const released=await touchState();await b.until(()=>b.call(frame=>smartTwinViewer.getStats().frameCount>=frame+2,released.frame),'The scene did not render after touch release.',10000);const settled=await touchState();assert(Math.abs(settled.y-released.y)<1e-6,'Drone altitude keeps moving after finger release.');actions.push({axis,before:before.y,released:released.y,settled:settled.y,axisAfter:settled.axis,pointersAfter:settled.pointers});
    }
    await shot('drone-touch-'+view.width+'x'+view.height);
    await click('.public-scene-tools [data-camera-mode="walk"]');await b.until(()=>b.evaluate('!smartTwinViewer.context.desktopFlight&&smartTwinViewer.context.input.flightTouch.hidden'),'Returning to walking did not hide/release altitude controls.',10000);
    const use=await b.call(()=>{const node=document.querySelector('.xr-browser-touch .touch-use'),r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{x:r.x,y:r.y,width:r.width,height:r.height,reachable:!!hit&&(hit===node||node.contains(hit))};});assert(use.reachable&&use.width>=44&&use.height>=44,'Usar is obscured by the study shortcut after returning to walking.');
    return{width:view.width,height:view.height,geometry,actions,use};
   };
   await b.send('Page.addScriptToEvaluateOnNewDocument',{source:instrument});await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});await size(1600,1000);
   mark('native PNG from the current WebGL render');await openDemo();report.initial=await bind();assert(report.initial.recordingSupported,report.initial.videoReason);assert.equal(report.initial.renderer.preserveDrawingBuffer,false);assert(report.initial.triangles>100);
   await click(PHOTO);await until(()=>b.evaluate('__sceneCaptureQA.captures.length===1'),'Trusted Foto click did not produce a real PNG.');
   report.photo=await inspectPNG(b,0);assert.deepEqual(report.photo.header,[137,80,78,71,13,10,26,10]);assert.equal(report.photo.mime,'image/png');assert.equal(report.photo.width,report.photo.source.width);assert.equal(report.photo.height,report.photo.source.height);assert.equal(report.photo.source.preserveDrawingBuffer,false);assert(report.photo.colors>40&&report.photo.stddev>10&&report.photo.visibleRatio>.15,'The captured PNG is blank/flat or only a cleared drawing buffer.');
   report.photoFile=await saveCapture(b,0,'captured-scene.png');await until(()=>Promise.resolve(fs.readdirSync(downloadPath).some(name=>name.endsWith('.png'))),'The toolbar did not download its PNG locally.');
   report.viewports.push(await surface('desktop-1600'));checkSurface(report.viewports[0]);await shot('capture-desktop-1600');
   mark('native MediaRecorder; real camera controls and a resize during recording');await click('.public-scene-tools [data-camera-mode="drone"]');
   report.beforeMotion=await b.evaluate('({position:smartTwinViewer.context.cameraRig.position.toArray(),camera:smartTwinViewer.context.camera.position.toArray()})');
   await click(RECORD);await until(()=>b.evaluate('smartTwinViewer.context.sceneCapture.getState().recording'),'Trusted Grabar click did not start native recording.');
   report.recorder=await b.evaluate('({native:smartTwinViewer.context.sceneCapture.record.recorder instanceof __sceneCaptureQA.nativeRecorder,dimensions:{width:smartTwinViewer.context.sceneCapture.record.width,height:smartTwinViewer.context.sceneCapture.record.height},mime:smartTwinViewer.context.sceneCapture.record.recorder.mimeType,tracks:smartTwinViewer.context.sceneCapture.record.stream.getTracks().map(track=>track.kind)})');assert(report.recorder.native);assert.deepEqual(report.recorder.tracks,['video']);
   // The recorder button intentionally isolates keyboard shortcuts. Focus the
   // actual viewport before sending real movement keys; no pose is assigned.
   await b.call(()=>smartTwinViewer.context.renderer.domElement.focus());
   await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',text:'w',windowsVirtualKeyCode:87,nativeVirtualKeyCode:87});await delay(1300);await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87,nativeVirtualKeyCode:87});
   report.afterMotion=await b.evaluate('({position:smartTwinViewer.context.cameraRig.position.toArray(),camera:smartTwinViewer.context.camera.position.toArray()})');
   assert.notDeepEqual(report.afterMotion,report.beforeMotion,'The actual public drone input did not move the existing camera.');
   await size(390,844,true);await delay(1400);report.recordingMobile=await surface('recording-mobile-390');checkSurface(report.recordingMobile);await shot('recording-mobile-390');
   await click(STOP);await until(()=>b.evaluate('__sceneCaptureQA.captures.length===2&&smartTwinViewer.context.sceneCapture.getState().phase==="idle"'),'Trusted Detener click did not finalize the real video.');
   report.video=await inspectVideo(b,1);assert.equal(report.video.nativeRecorder,true);assert.equal(report.video.width,report.recorder.dimensions.width);assert.equal(report.video.height,report.recorder.dimensions.height);assert(report.video.decodedFrames>=3&&report.video.mediaTimes.length>=3,'The native video decoder did not receive multiple real frames.');assert(report.video.maxMeanDifference>.5&&report.video.maxChangedRatio>.01,'The recorded scene has no observable motion/resize frames.');assert(report.video.minVisibleRatio>.03&&report.video.minFrameStddev>5,'Video contains black/flat/cleared frames.');assert(report.video.bytes>5000);assert(report.video.durationMs>=1500&&report.video.durationMs<=120000);
   if(/^video\/webm/.test(report.video.mime))assert.deepEqual(report.video.header.slice(0,4),[26,69,223,163]);else{assert.match(report.video.mime,/^video\/mp4/);assert.equal(Buffer.from(report.video.header.slice(4,8)).toString('ascii'),'ftyp');}
   report.videoFile=await saveCapture(b,1,/^video\/mp4/.test(report.video.mime)?'captured-scene.mp4':'captured-scene.webm');await until(()=>Promise.resolve(fs.readdirSync(downloadPath).some(name=>/\.(?:webm|mp4)$/.test(name))),'The toolbar did not download its actual video container locally.');
   mark('responsive controls and lifecycle disposal');await click('.public-scene-tools [data-camera-mode="walk"]');
   report.touchCases=[];
   for(const view of [{width:390,height:844,mobile:true},{width:854,height:480,mobile:true},{width:1600,height:1000,mobile:false}]){await size(view.width,view.height,view.mobile);const value=await surface('idle-'+view.width+'x'+view.height);checkSurface(value);report.viewports.push(value);if(view.mobile)report.touchCases.push(await testTouchAltitude(view));await shot('capture-'+view.width+'x'+view.height);}
   report.touchEvents=await b.evaluate('__sceneCaptureQA.touchEvents');assert.equal(report.touchEvents.filter(row=>row.type==='pointerdown').length,4);assert(report.touchEvents.every(row=>row.trusted&&row.pointerType==='touch'),'Altitude QA must use native trusted touch input.');
   report.resources=await b.call(()=>({streams:__sceneCaptureQA.streams.map(row=>({fps:row.fps,width:row.width,height:row.height,tracks:row.stream.getTracks().map(track=>({kind:track.kind,state:track.readyState}))})),mediaRequests:__sceneCaptureQA.mediaRequests,clicks:__sceneCaptureQA.trustedClicks,downloads:__sceneCaptureQA.createdURLs.filter(row=>row.type==='image/png'||/^video\//.test(row.type)),revoked:__sceneCaptureQA.revokedURLs,gl:smartTwinViewer.context.renderer.getContext().getError(),frameError:smartTwinViewer.getStats().frameError}));
   assert.deepEqual(report.resources.mediaRequests,[]);assert(report.resources.clicks.length>=4&&report.resources.clicks.every(row=>row.trusted));assert(report.resources.streams.length>0&&report.resources.streams.every(row=>row.tracks.every(track=>track.kind==='video'&&track.state==='ended')));assert.equal(report.resources.gl,0);assert.equal(report.resources.frameError,null);
   const beforeCancel=await b.evaluate('__sceneCaptureQA.captures.length');await click(RECORD);await until(()=>b.evaluate('smartTwinViewer.context.sceneCapture.getState().recording'),'Lifecycle test did not start recording.');await click('#home-link');
   await until(()=>b.evaluate('!window.smartTwinViewer&&!!document.getElementById("welcome")&&!document.getElementById("welcome").hidden'),'Home did not dispose the rendered scene.');await delay(400);
   report.lifecycle=await b.call(()=>({phase:__sceneCaptureQA.controller.getState().phase,captures:__sceneCaptureQA.captures.length,liveTracks:__sceneCaptureQA.streams.flatMap(row=>row.stream.getTracks()).filter(track=>track.readyState!=='ended').length,remainingToolbars:document.querySelectorAll('.scene-capture-toolbar').length,downloadURLs:__sceneCaptureQA.createdURLs.filter(row=>/^image\/|^video\//.test(row.type)).every(row=>__sceneCaptureQA.revokedURLs.includes(row.url)),canvas:document.querySelectorAll('#viewer canvas').length}));
   assert.equal(report.lifecycle.phase,'disposed');assert.equal(report.lifecycle.captures,beforeCancel,'A cancelled scene generated a late private/download result.');assert.equal(report.lifecycle.liveTracks,0);assert.equal(report.lifecycle.remainingToolbars,0);assert.equal(report.lifecycle.downloadURLs,true);assert.equal(report.lifecycle.canvas,0);
   await openDemo();report.reopened=await b.evaluate('({toolbars:document.querySelectorAll(".public-scene-tools .scene-capture-toolbar").length,phase:smartTwinViewer.context.sceneCapture.getState().phase,canPhoto:smartTwinViewer.context.sceneCapture.getState().canPhoto,canRecord:smartTwinViewer.context.sceneCapture.getState().canRecord})');assert.deepEqual(report.reopened,{toolbars:1,phase:'idle',canPhoto:true,canRecord:true});
   report.localDownloads=fs.readdirSync(downloadPath).filter(name=>/\.(?:png|webm|mp4)$/.test(name)).map(name=>{const bytes=fs.readFileSync(path.join(downloadPath,name));return{name,bytes:bytes.length,sha256:hash(bytes)};});assert(report.localDownloads.some(row=>row.sha256===report.photoFile.sha256));assert(report.localDownloads.some(row=>row.sha256===report.videoFile.sha256));
   assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin+'/')&&row.status>=400),[]);assert.deepEqual(report.responses.filter(row=>/^https?:/.test(row.url)&&!row.url.startsWith(fixture.origin+'/')),[]);assert.deepEqual(fixture.errors,[]);
  });
  reviewed('public-viewer','viewer.js',expectedPublicSha256);reviewed('workspace','bundle.js',expectedWorkspaceSha256);report.passed=true;return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,stage:report.stage,report:path.join(OUT,'report.json'),photo:report.photo&&{width:report.photo.width,height:report.photo.height,colors:report.photo.colors},video:report.video&&{mime:report.video.mime,decodedFrames:report.video.decodedFrames,maxMeanDifference:report.video.maxMeanDifference},screenshots:report.screenshots.length}));}
}
// A final workspace-only rebuild need not encode the identical public JS again.
// Keep original evidence immutable and record the new guards/changed CSS/UI in
// a separate receipt rather than relabelling an earlier browser run's hashes.
async function reviewFinalPublication({expectedPublicSha256,expectedWorkspaceSha256}={}){
 const evidenceFile=path.join(OUT,'report.json'),evidenceBytes=fs.readFileSync(evidenceFile),baseline=JSON.parse(evidenceBytes.toString('utf8'));
 assert(baseline.passed&&baseline.video&&baseline.photo&&baseline.touchCases.length===2,'A complete real-media/touch baseline must pass first.');
 assert.equal(baseline.artifacts.public.bundleSha256,expectedPublicSha256,'Changed public JS requires the full media suite.');
 const artifacts={public:reviewed('public-viewer','viewer.js',expectedPublicSha256),workspace:reviewed('workspace','bundle.js',expectedWorkspaceSha256)},manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/publication.json'),'utf8')),css=manifest.files.find(row=>row.path==='viewer.css');
 assert(css);assert.equal(hash(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.css'))),css.sha256);assert.equal(hash(fs.readFileSync(path.join(ROOT,'apps/public-viewer/viewer.css'))),css.sha256);
 const report={startedAt:new Date().toISOString(),artifacts,publicCSS:css.sha256,scope:'Final receipt and mobile notice/interaction geometry only; native PNG/video evidence remains the unchanged public-JS baseline.',mediaEvidence:{report:evidenceFile,sha256:hash(evidenceBytes),publicBundle:expectedPublicSha256,photo:baseline.photoFile,video:baseline.videoFile,fullBrowserPass:true},temporaryDatabaseOnly:true,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]},fixture=await startFixture('Disposable-Capture-Review-'+randomBytes(18).toString('hex'),{voice:{enabled:false,key:''}});
 try{
  await withBrowser(fixture,report,async b=>{
   await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
   const click=async selector=>{const point=await b.call(selector=>{const node=document.querySelector(selector);node.scrollIntoView({block:'center',inline:'nearest'});const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(node.disabled||!(hit===node||node.contains(hit)))throw Error('Final control is covered: '+selector);return{x,y};},selector);await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});};
   await b.send('Page.navigate',{url:fixture.origin+'/#escenarios'});await b.until(()=>b.evaluate('!!document.querySelector("#scene-grid .scene-open")'),'Final public catalogue did not open.');await click('#scene-grid .scene-open');await b.until(()=>b.evaluate('!!window.smartTwinViewer&&!!smartTwinViewer.context.sceneCapture&&smartTwinViewer.getStats().frameCount>5'),'Final reviewed public scene did not initialize.');
   await click('.public-scene-tools [data-camera-mode="drone"]');await b.until(()=>b.evaluate('smartTwinViewer.context.desktopFlight&&!smartTwinViewer.context.input.flightTouch.hidden'),'Final mobile drone tools did not appear.');
   report.mobile=await b.call(()=>{
    const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},use=document.querySelector('.xr-browser-touch .touch-use'),notice=document.getElementById('viewer-notice'),a=rect(use),n=rect(notice),hit=document.elementFromPoint(a.x+a.width/2,a.y+a.height/2);
    return{width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,use:a,useReachable:hit===use||use.contains(hit),notice:n,noticeVisible:notice.classList.contains('visible'),noticeText:notice.textContent,overlapArea:Math.max(0,Math.min(a.right,n.right)-Math.max(a.x,n.x))*Math.max(0,Math.min(a.bottom,n.bottom)-Math.max(a.y,n.y)),touch:[...document.querySelectorAll('[data-flight-axis]')].map(node=>{const r=rect(node),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{axis:node.dataset.flightAxis,...r,reachable:h===node||node.contains(h)};}),capturePhase:smartTwinViewer.context.sceneCapture.getState().phase,gl:smartTwinViewer.context.renderer.getContext().getError()};
   });
   assert(report.mobile.noticeVisible&&/Dron/.test(report.mobile.noticeText),'The actual transient notice must be visible during the overlap check.');assert(!report.mobile.overflow);assert(report.mobile.useReachable&&report.mobile.use.height>=44);assert.equal(report.mobile.overlapArea,0,'The transient drone notice covers Usar.');assert(report.mobile.touch.every(row=>row.reachable&&row.height>=44&&row.width>=44));assert.equal(report.mobile.gl,0);
   const image=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,'final-notice-390x844.png');fs.writeFileSync(file,Buffer.from(image.data,'base64'));report.screenshots.push(file);
   assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin+'/')&&row.status>=400),[]);assert.deepEqual(fixture.errors,[]);
  });report.passed=true;return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUT,'final-publication-review.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,scope:'final-publication-review',workspace:expectedWorkspaceSha256,public:expectedPublicSha256,noticeOverlap:report.mobile&&report.mobile.overlapArea,report:path.join(OUT,'final-publication-review.json')}));}
}
module.exports={run,reviewFinalPublication,reviewed,inspectPNG,inspectVideo};
if(require.main===module){const flag=key=>{const at=process.argv.indexOf(key);return at<0?undefined:process.argv[at+1];};const action=process.argv.includes('--review-final-publication')?reviewFinalPublication:run;action({expectedPublicSha256:flag('--expected-public-sha256'),expectedWorkspaceSha256:flag('--expected-workspace-sha256')}).catch(error=>{console.error(error);process.exitCode=1;});}
