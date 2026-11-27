'use strict';
// Production scene and trusted Chrome touch events. Viewport/touch emulation
// exercises the actual app; it does not certify Safari or physical mobile GPUs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/scenario-touch-devices');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(expected){
 const actual=createHash('sha256').update(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))).digest('hex');
 assert.equal(actual,expected);fs.mkdirSync(OUT,{recursive:true});
 const fixture=await startFixture('Disposable-Touch-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});fixture.renderBackend='d3d11';
 const reports=[];
 try{for(const profile of [{id:'phone',width:390,height:844},{id:'tablet',width:768,height:1024}]){
  const report={profile,hash:expected,physicalDeviceTest:false,engine:'Chrome',exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};reports.push(report);
  await withBrowser(fixture,report,async b=>{
   const touch=(type,points=[])=>b.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,id:p.id||1,radiusX:3,radiusY:3,force:1}))});
   const point=selector=>b.call(selector=>{
    const node=document.querySelector(selector);if(!node||node.disabled)throw Error('Unavailable touch control: '+selector);
    node.scrollIntoView({block:'nearest',inline:'nearest'});const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
    if(!r.width||!r.height||!(node===hit||node.contains(hit)))throw Error('Covered touch control: '+selector+' '+JSON.stringify({x,y,hit:hit?.outerHTML.slice(0,180)}));
    return{x,y};
   },selector);
   const tap=async selector=>{await touch('touchStart',[await point(selector)]);await touch('touchEnd');};
   const shot=async name=>{const png=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,profile.id+'-'+name+'.png');fs.writeFileSync(file,Buffer.from(png.data,'base64'));report.screenshots.push(file);};
   const state=()=>b.call(()=>{
    const c=smartTwinViewer.context,d=c.demo.driving,v=d.record()?.components.vehicle,rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    return{viewport:[innerWidth,innerHeight],coarse:matchMedia('(pointer:coarse)').matches,bodyWidth:document.documentElement.scrollWidth,frames:smartTwinViewer.getStats().frameCount,error:smartTwinViewer.getStats().frameError,pointers:c.input.pointers.size,axes:{...c.input.axes},touches:d.touches.size,input:v?.input,distance:v?.distance,speed:v?.actualSpeed,parking:v?.parkingBrake,driver:!!d.id,dialog:c.publicDialogOpen,camera:c.camera.getWorldPosition(new smartTwinViewer.THREE.Vector3()).toArray(),hud:d.hud&&!d.hud.hidden?rect(d.hud):null,map:d.docking.element&&!d.docking.element.hidden?rect(d.docking.element):null,webgl:c.renderer.getContext().getError()};
   });
   await b.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36'});
   await b.send('Emulation.setDeviceMetricsOverride',{width:profile.width,height:profile.height,deviceScaleFactor:2,mobile:true});await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
   // Observe before the vehicle's capture listener consumes driving keys.
   await b.send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__trustedSceneKeys=[];window.addEventListener('keydown',event=>__trustedSceneKeys.push(event.isTrusted),true);"});
   await b.send('Page.navigate',{url:fixture.origin+'/'});await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Welcome unavailable.');await tap('#explore-demo');
   await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo&&smartTwinViewer.getStats().frameCount>10'),'Scene unavailable.',90000);
   await b.call(()=>{window.__trustedSceneTouches=[];document.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')__trustedSceneTouches.push(e.isTrusted);},true);});
   report.initial=await state();assert(report.initial.coarse);assert(report.initial.bodyWidth<=profile.width+1);await shot('walking');
   await point('.xr-browser-touch .touch-pad:nth-child(2)');await point('.xr-browser-touch .touch-use');
   const pad=await point('.xr-browser-touch .touch-pad');await touch('touchStart',[pad]);await touch('touchMove',[{x:pad.x,y:pad.y-35}]);
   await b.until(()=>b.call(before=>{const p=smartTwinViewer.context.camera.getWorldPosition(new smartTwinViewer.THREE.Vector3()).toArray();return Math.hypot(...p.map((v,i)=>v-before[i]))>.05;},report.initial.camera),'Touch walking did not move the real camera.');
   report.walking=await state();await touch('touchEnd');report.released=await state();assert.equal(report.released.pointers,0);assert.equal(report.released.axes.y,0);
   await tap('[data-tour-tool="dashboard"]');
   report.dashboard=await b.call(()=>{const p=document.querySelector('.demo-operations'),r=p.getBoundingClientRect();return{open:p.open,x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:p.clientWidth,scrollWidth:p.scrollWidth,kpis:p.querySelectorAll('.demo-operations-kpis strong').length,frames:smartTwinViewer.getStats().frameCount};});
   assert(report.dashboard.open);assert.equal(report.dashboard.kpis,12);assert(report.dashboard.right<=profile.width+1&&report.dashboard.x>=-1);assert(report.dashboard.scrollWidth<=report.dashboard.width+2,'Dashboard must not scroll horizontally.');await shot('dashboard');
   await b.call(()=>{const input=document.querySelector('[data-receiving=quantity]');input.value=2;input.dispatchEvent(new Event('input',{bubbles:true}));});await tap('[data-receiving=prepare]');await tap('[data-receiving=authorize]');
   report.order=await b.call(()=>{const order=smartTwinViewer.context.demo.operations.orders.at(-1);return{quantity:order.quantity,authorized:order.authorized};});assert.equal(report.order.quantity,2);assert(report.order.authorized);
   await b.until(()=>b.call(before=>smartTwinViewer.getStats().frameCount>before+2,report.dashboard.frames),'Dashboard froze the renderer.');await tap('.demo-operations-header button');assert(!(await state()).dialog);
   await tap('[data-tour-tool="controls"]');report.help=await b.call(()=>{const help=document.querySelector('#viewer-menu-controls .viewer-help');return{open:document.querySelector('#viewer-menu').open,visible:getComputedStyle(help).display!=='none'&&help.getBoundingClientRect().height>100,text:help.innerText};});assert(report.help.open&&report.help.visible&&report.help.text.includes('horquillas'));await shot('help');await tap('#viewer-menu-close');assert(!(await state()).dialog);
   // Only the entry fixture uses an application API. Driving and braking below
   // use the real visible buttons and native RAF/fixed-step vehicle physics.
   await b.call(()=>{const d=smartTwinViewer.context.demo.driving,r=[...d.simulation.records.values()].find(r=>r.components.vehicle);if(!d.boardAndStart(r.id))throw Error('Boarding failed.');});await delay(250);report.cab=await state();assert(report.cab.driver&&!report.cab.parking);await shot('cab');
   for(const [width,height]of [[profile.width,profile.height],[profile.height,profile.width]]){
    await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});await delay(300);
    for(const action of ['driveForward','driveReverse','steerLeft','steerRight','brake'])await point('[data-vehicle-action="'+action+'"]');
    const before=await state(),button=await point('[data-vehicle-action="driveForward"]');await touch('touchStart',[button]);
    await b.until(()=>b.call(distance=>{const v=smartTwinViewer.context.demo.driving.record().components.vehicle;return v.input.throttle>0&&v.distance>distance+.02;},before.distance),'Touch throttle did not move the vehicle.');
    const moving=await state();await touch('touchCancel');await b.until(()=>b.evaluate('smartTwinViewer.context.demo.driving.record().components.vehicle.input.throttle===0'),'Cancelled touch left the accelerator held.');
    await touch('touchStart',[await point('[data-vehicle-action="brake"]')]);await b.until(()=>b.evaluate('Math.abs(smartTwinViewer.context.demo.driving.record().components.vehicle.actualSpeed)<.01'),'Touch brake did not stop the vehicle.');await touch('touchEnd');
    const stopped=await state();assert.equal(stopped.touches,0);assert.equal(stopped.webgl,0);assert.equal(stopped.error,null);assert(stopped.bodyWidth<=width+1);
    if(!report.driving)report.driving=[];report.driving.push({moving,stopped});await shot('cab-'+width);
   }
   if(profile.id==='phone'){
    // A narrow desktop window must retain accessible controls too; switching
    // to a fine pointer also exercises the CSS outside coarse-touch media.
    await b.send('Emulation.setTouchEmulationEnabled',{enabled:false});report.desktop=[];
    const key=(code,name,vk,down=true)=>b.send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:name,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});
    for(const [width,height]of [[640,360],[1280,720]]){
     await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(300);
     for(const action of ['driveForward','driveReverse','steerLeft','steerRight','brake'])await point('[data-vehicle-action="'+action+'"]');
     const before=await state();assert.equal(before.coarse,false);await key('KeyW','w',87);
     await b.until(()=>b.call(distance=>{const v=smartTwinViewer.context.demo.driving.record().components.vehicle;return v.input.throttle>0&&v.distance>distance+.02;},before.distance),'Desktop keyboard failed after changing pointer/orientation.');
     await key('KeyW','w',87,false);await key('Space',' ',32);await b.until(()=>b.evaluate('Math.abs(smartTwinViewer.context.demo.driving.record().components.vehicle.actualSpeed)<.01'),'Desktop brake failed.');await key('Space',' ',32,false);
     const stopped=await state();assert.equal(stopped.error,null);assert.equal(stopped.webgl,0);report.desktop.push(stopped);await shot('desktop-'+width);
    }
    report.keyboardTrusted=await b.evaluate('__trustedSceneKeys');assert(report.keyboardTrusted.length>2&&report.keyboardTrusted.every(Boolean));
   }
   report.trusted=await b.evaluate('__trustedSceneTouches');assert(report.trusted.length>8&&report.trusted.every(Boolean));
   assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);report.passed=true;
  });
 }}catch(error){reports.at(-1).failure=error.stack;throw error;}finally{fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(reports,null,2));await fixture.close();console.log(JSON.stringify(reports.map(r=>({profile:r.profile.id,passed:!!r.passed,failure:r.failure}))));}
 return reports;
}
module.exports={run};if(require.main===module)run(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
