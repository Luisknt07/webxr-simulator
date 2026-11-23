'use strict';
// Exact compiled artifacts, native RAF, disposable browser/data. XR entry
// support/request boundaries may be emulated; this is not a headset test.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/public-xr-cab');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function run({publicSha256,workspaceSha256,baseline=false}={}){
 for(const [app,file,expected]of [['public-viewer','viewer.js',publicSha256],['workspace','bundle.js',workspaceSha256]]){
  assert.match(expected||'',/^[a-f0-9]{64}$/);assert.equal(hash(fs.readFileSync(path.join(ROOT,'artifacts',app,file))),expected);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts',app,'publication.json'))).bundleSha256,expected);
 }
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const report={publicSha256,workspaceSha256,normalRAF:true,manualPhysicsTicks:0,cameraOnlyViews:true,physicalHeadsetTest:false,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],viewports:[]};
 const fixture=await startFixture('Disposable-XR-Cab-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});fixture.renderBackend='d3d11';
 try{
  const served=await request(fixture.origin,'/viewer.js');assert.equal(served.sha256,publicSha256);
  await withBrowser(fixture,report,async b=>{
   const shot=async name=>{await delay(180);const png=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(png.data,'base64'));report.screenshots.push(file);};
   const click=async selector=>{const rect=await b.call(selector=>{const el=document.querySelector(selector);if(!el||el.disabled)throw Error('Missing/disabled '+selector);el.scrollIntoView({block:'nearest',inline:'nearest'});const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)throw Error('Hidden '+selector);return{x:r.left+r.width/2,y:r.top+r.height/2};},selector);await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});};
   const boot=async url=>{await b.send('Page.navigate',{url});await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Public welcome unavailable.',60000);await click('#explore-demo');await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo'),'Public demo unavailable.',90000);};
   const modelView=async name=>{
    for(const [view,eye,target]of [['side',[.60,1.60,-.12],[-.12,1.03,.18]],['operator',[0,1.65,-.20],[-.12,.97,.36]]]){
    await b.call(({eye,target})=>{
     const a=smartTwinViewer,c=a.context,T=a.THREE,d=c.demo,r=d.simulation.records.get(d.stats().vehicle.id);let rig;r.object.traverse(n=>{if(n.userData.vehicleRig)rig=n.userData.vehicleRig;});
     window.__cabQA={r,rig};c.input.reset();c.desktopFlight=true;c.cameraRig.position.set(0,0,0);c.cameraRig.quaternion.set(0,0,0,1);
     c.camera.position.copy(rig.cabin.localToWorld(new T.Vector3(...eye)));c.camera.lookAt(rig.cabin.localToWorld(new T.Vector3(...target)));c.cameraRig.updateWorldMatrix(true,true);
    },{eye,target});await shot(name+'-'+view);
    }
   };
   await b.send('Network.setBlockedURLs',{urls:['https://code.cdn.mozilla.net/*','https://fonts.googleapis.com/*','https://fonts.gstatic.com/*']});
   await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});await b.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
   if(baseline){await boot('https://luisknt07.github.io/webxr-simulator/');await modelView('before-native-cab');}
   await boot(fixture.origin+'/');
   await b.until(()=>b.evaluate('!!document.querySelector("#xr-action [data-xr-state=unavailable]")'),'No-headset availability state missing.',15000);
   for(const [width,height]of [[1600,1000],[1280,720],[640,360],[390,844]]){
    await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(400);
    const layout=await b.call(()=>{
     const button=document.querySelector('#xr-action button'),r=button.getBoundingClientRect(),tools=document.querySelector('.public-scene-tools').getBoundingClientRect(),header=document.querySelector('.viewer-header').getBoundingClientRect();
     const items=[...document.querySelectorAll('.header-actions button,.header-actions>a')].map(el=>({id:el.id||el.className,rect:el.getBoundingClientRect()})).filter(v=>v.rect.width>0);
     const overlaps=[];for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i].rect,b=items[j].rect;if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push([items[i].id,items[j].id]);}
     return{width:innerWidth,height:innerHeight,label:button.textContent,visible:r.width>0&&r.height>0,x:r.x,right:r.right,bottom:r.bottom,headerBottom:header.bottom,toolsTop:tools.top,overlaps};
    });report.viewports.push(layout);assert.equal(layout.label,'Realidad virtual');assert(layout.visible&&layout.x>=0&&layout.right<=width&&layout.bottom<=height);assert.deepEqual(layout.overlaps,[]);assert(layout.toolsTop>=layout.headerBottom-1);await shot('header-'+width);
   }
   await b.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await delay(200);await click('#xr-action button');
   await b.until(()=>b.evaluate('!!document.querySelector(".viewer-xr-help[open]")'),'VR compatibility action did not open.');
   assert(await b.evaluate('smartTwinViewer.context.publicDialogOpen'));await shot('vr-compatibility-instructions');await click('.viewer-xr-help button');
   await b.until(()=>b.evaluate('!!document.querySelector(".viewer-xr-status").textContent'),'Missing recheck result.');
   await b.evaluate('document.querySelector(".viewer-xr-help").close()');await b.until(()=>b.evaluate('!smartTwinViewer.context.publicDialogOpen&&!document.querySelector(".viewer-xr-help")'),'VR help left input blocked.');
   await modelView('after-native-cab');
   report.controls=await b.call(()=>{const {r,rig}=__cabQA;return{bank:rig.hydraulicBank,seat:rig.driverSeat.position.toArray(),wheel:rig.controls.wheel.object.position.toArray(),levers:rig.controls.levers.map(v=>({id:v.id,pivot:v.object.position.toArray(),grip:rig.cabin.worldToLocal(v.grip.getWorldPosition(new smartTwinViewer.THREE.Vector3())).toArray(),travel:v.travel})),components:[...new Set(rig.controls.levers.flatMap(v=>v.object.children.map(o=>o.userData.equipmentComponentId)))]};});
   assert.equal(report.controls.bank.layout,'front-right');assert(report.controls.levers.every(l=>l.grip[0]<0&&l.grip[2]>.05&&l.grip[2]<.35));
   await b.call(()=>{const d=smartTwinViewer.context.demo;if(!d.driving.mount(d.stats().vehicle.id))throw Error('Native cab boarding failed.');const p=d.driving.cab.pointer,reset=p.reset;window.__cabQAResets=[];window.__cabQAEvents=[];p.reset=function(){if(p.states.size)__cabQAResets.push(String(new Error('Capture reset').stack).slice(0,1400));return reset.apply(this,arguments);};for(const method of ['move','up']){const original=p[method];p[method]=function(e){if(p.states.size&&__cabQAEvents.length<100)__cabQAEvents.push({method,type:e.type,id:e.pointerId,buttons:e.buttons,pointerType:e.pointerType});return original.apply(this,arguments);};}});
   const aim=async id=>{
    await b.call(id=>{const a=smartTwinViewer,c=a.context,control=c.demo.driving.cab.controls.find(v=>v.channel===id);c.camera.lookAt(control.descriptor.grip.getWorldPosition(new a.THREE.Vector3()));c.camera.updateMatrixWorld(true);},id);await delay(180);
    return b.call(id=>{const c=smartTwinViewer.context.demo.driving.cab,control=c.controls.find(v=>v.channel===id);return c.pointer.project(control.descriptor.grip.getWorldPosition(new smartTwinViewer.THREE.Vector3()));},id);
   };
   const sample=()=>b.call(()=>{const d=smartTwinViewer.context.demo,v=d.driving.record().components.vehicle;return{input:{...v.input},pose:{...v.pose},powered:v.powered,running:v.running,emergency:v.emergency,lights:v.lights,parkingBrake:v.parkingBrake,horn:v.hornCount,captures:d.driving.cab.pointer.states.size,locked:!!document.pointerLockElement,resets:window.__cabQAResets,events:window.__cabQAEvents};});
   report.physicalDrags=[];
   for(const [id,amount]of [['lift',-.7],['tilt',.6],['sideShift',.6]]){
    const point=await aim(id),before=await sample();await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x:point.x,y:point.y});
    await b.until(()=>b.evaluate('smartTwinViewer.context.demo.driving.cab.pointer.states.size===1'),'Visible '+id+' knob did not capture a real mouse pointer.',5000);
    const drag=await b.call(()=>{const s=[...smartTwinViewer.context.demo.driving.cab.pointer.states.values()][0];return{x:s.startX,y:s.startY,axis:s.axis,travel:s.travel,id:s.control.channel};});assert.equal(drag.id,id);
    const end={x:drag.x+drag.axis.x*drag.travel*amount,y:drag.y+drag.axis.y*drag.travel*amount};await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,...end});await delay(400);const held=await sample();
    report.physicalDrags.push({id,before,held,drag,end});assert(held.input[id]>.02,'Native mouse drag never reached '+id+' input: '+JSON.stringify(held));if(id==='lift')assert(held.pose.lift>before.pose.lift+.005,'Actual forks never moved: '+JSON.stringify({before,held}));assert.equal(held.locked,false,'A knob drag must not lock or turn the camera.');
    await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...end});await delay(100);const released=await sample();assert.equal(released.input[id],0);assert.equal(released.captures,0);report.physicalDrags[report.physicalDrags.length-1].released=released;
   }
   await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});await delay(200);const touchPoint=await aim('sideShift');
   await b.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchPoint.x,y:touchPoint.y,id:1}]});
   await b.until(()=>b.evaluate('smartTwinViewer.context.demo.driving.cab.pointer.states.size===1'),'A native touch could not capture the knob.',5000);
   const touch=await b.call(()=>{const s=[...smartTwinViewer.context.demo.driving.cab.pointer.states.values()][0];return{x:s.startX,y:s.startY,axis:s.axis,travel:s.travel};});
   await b.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x+touch.axis.x*touch.travel*.6,y:touch.y+touch.axis.y*touch.travel*.6,id:1}]});await delay(300);report.physicalTouch=await sample();assert(report.physicalTouch.input.sideShift>.02);
   await b.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(100);assert.equal((await sample()).input.sideShift,0);await b.send('Emulation.setTouchEmulationEnabled',{enabled:false});
   const physicalButton=async id=>{const p=await aim(id);await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x:p.x,y:p.y});await delay(60);await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:p.x,y:p.y});await delay(100);return sample();};
   const initialButtons=await sample();report.physicalButtons={};
   report.physicalButtons.horn=await physicalButton('horn');assert(report.physicalButtons.horn.horn>initialButtons.horn);
   report.physicalButtons.lights=await physicalButton('lights');assert.equal(report.physicalButtons.lights.lights,!initialButtons.lights);
   report.physicalButtons.parking=await physicalButton('parkingBrake');assert.equal(report.physicalButtons.parking.parkingBrake,!initialButtons.parkingBrake);
   report.physicalButtons.emergency=await physicalButton('emergency');assert(report.physicalButtons.emergency.emergency&&!report.physicalButtons.emergency.running);
   report.physicalButtons.reset=await physicalButton('resetEmergency');assert(!report.physicalButtons.reset.emergency&&!report.physicalButtons.reset.running,'Reset must not restart the forklift.');
   report.physicalButtons.started=await physicalButton('ignition');assert(report.physicalButtons.started.running);
   report.physicalButtons.off=await physicalButton('ignition');assert(!report.physicalButtons.off.powered&&!report.physicalButtons.off.running);
   report.physicalButtons.restarted=await physicalButton('ignition');assert(report.physicalButtons.restarted.powered&&report.physicalButtons.restarted.running);
   await b.call(()=>{const a=smartTwinViewer,c=a.context;c.camera.lookAt(__cabQA.rig.cabin.localToWorld(new a.THREE.Vector3(-.10,1.05,.32)));c.camera.updateMatrixWorld(true);});await shot('physical-cab-labelled-and-functional');
   await b.call(()=>smartTwinViewer.context.demo.driving.unmount(true));
   // Inspect snapshots of this same operational machine; never replace it
   // with a stand-in model or write an exploded pose into the simulation.
   assert(await b.call(()=>smartTwinViewer.context.demo.equipmentStudy.open(__cabQA.r.object)));
   await shot('study-assembled');
   await b.call(()=>{const v=smartTwinViewer.context.demo.equipmentStudy;v.selectedPart=v.parts.findIndex(p=>p.id==='cab');v.isolated=true;v.applySelection();v.frame();v.render(true);});await shot('study-isolated-controls');
   await b.call(()=>{const v=smartTwinViewer.context.demo.equipmentStudy;v.isolated=false;v.selectedPart=-1;v.applySelection();v.explode.value='65';v.explode.dispatchEvent(new Event('input',{bubbles:true}));v.frame();v.render(true);});await shot('study-exploded');
   await b.call(()=>smartTwinViewer.context.demo.equipmentStudy.close());await b.until(()=>b.evaluate('!smartTwinViewer.context.publicDialogOpen'),'Study left input blocked.');
   report.final=await b.evaluate('smartTwinViewer.getStats()');assert.equal(report.final.frameError,null);assert.deepEqual(report.final.displayErrors,[]);assert.equal(await b.evaluate('smartTwinViewer.context.renderer.getContext().getError()'),0);
   assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);
  });
  // The supported path invokes the real production button handler under an
  // emulated support boundary and a deliberate permission rejection.
  await withBrowser(fixture,report,async b=>{
   await b.send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(navigator,'xr',{configurable:true,value:{isSessionSupported:()=>Promise.resolve(true),requestSession:(type,options)=>{window.__xrRequests=(window.__xrRequests||[]).concat([{type,options,active:navigator.userActivation.isActive}]);return Promise.reject(new DOMException('QA permission rejection','NotAllowedError'));}}});"});
   await b.send('Page.navigate',{url:fixture.origin+'/'});await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Welcome missing.');await b.evaluate('document.getElementById("explore-demo").click()');await b.until(()=>b.evaluate('!!document.querySelector("#xr-action [data-xr-state=ready]")'),'Supported VR entry missing.');
   const r=await b.evaluate('(()=>{const r=document.querySelector("#xr-action button").getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()');
   await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...r});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...r});
   await b.until(()=>b.evaluate('document.querySelector("#xr-action button").textContent==="Reintentar RV"'),'Rejected permission did not restore the entry action.');
   report.supportedPath=await b.evaluate('({requests:__xrRequests,disabled:document.querySelector("#xr-action button").disabled,frameError:smartTwinViewer.getStats().frameError,dialog:!!smartTwinViewer.context.publicDialogOpen})');
   assert.equal(report.supportedPath.requests.length,1);assert.equal(report.supportedPath.requests[0].type,'immersive-vr');assert.equal(report.supportedPath.requests[0].active,true);assert.equal(report.supportedPath.disabled,false);assert.equal(report.supportedPath.dialog,false);assert.equal(report.supportedPath.frameError,null);
  });
  assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(fixture.errors,[]);
  report.passed=true;return report;
 }catch(error){report.failure=error.stack||String(error);throw error;}
 finally{report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,viewports:report.viewports.length,screenshots:report.screenshots.length,report:path.join(OUT,'report.json')}));}
}
module.exports={run};
if(require.main===module){const arg=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];};run({publicSha256:arg('--public-sha256'),workspaceSha256:arg('--workspace-sha256'),baseline:process.argv.includes('--baseline')}).catch(error=>{console.error(error);process.exitCode=1;});}
