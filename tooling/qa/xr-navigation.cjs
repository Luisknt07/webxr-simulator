'use strict';
// Actual compiled public/private menus, native RayControl and GPU canvases.
// Only XR hardware/session poses are emulated; this is not a headset trial.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/xr-navigation');
async function run(){
 fs.mkdirSync(OUT,{recursive:true});const password='Disposable-XR-menu-'+randomBytes(16).toString('hex'),f=await startFixture(password,{voice:{enabled:false,key:''}});f.renderBackend='d3d11';
 const report={physicalHeadsetTest:false,emulatedBoundary:'XR poses and session, monoscopic GPU render; manual frame advancement for menu inspection',temporaryAccounts:true,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};
 try{await withBrowser(f,report,async b=>{
  const shot=async name=>{const png=await b.call(()=>{const q=__xrNav;q.c.renderer.render(q.c.scene,q.c.camera);return q.c.renderer.domElement.toDataURL('image/png');}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(png.split(',')[1],'base64'));report.screenshots.push(file);};
  const install=async isPublic=>b.call(isPublic=>{
   const c=isPublic?smartTwinViewer.context:context,menu=isPublic?c.xrSceneMenu:c.studio.immersiveMenu,ray=c.raycontrol,xr=c.renderer.xr;
   const V=c.camera.position.constructor,M=c.camera.matrixWorld.constructor,Q=c.camera.quaternion.constructor;
   c.renderer.setAnimationLoop(null);const session={visibilityState:'visible',inputSources:[],ended:0,async end(){this.ended++;c.vrMode=false;menu.close();if(menu.setVR)menu.setVR(false);}};
   xr.getSession=()=>session;xr.getCamera=()=>{c.cameraRig.updateWorldMatrix(true,true);return c.camera;};c.vrMode=true;if(menu.setVR)menu.setVR(true);c.publicDialogOpen=false;
   const controllers=isPublic?c.input.controllers:c.controllers;
   const controls=controllers.map((controller,index)=>{const old=ray.controllers.find(d=>d.controller===controller);if(old)ray.removeController(controller);const source={handedness:index?'right':'left',targetRayMode:'tracked-pointer',gamepad:{mapping:'xr-standard',buttons:Array.from({length:6},()=>({pressed:false,value:0})),axes:[0,0,0,0]}};session.inputSources.push(source);controller.visible=true;controller.userData.grabbing=null;delete controller.userData.xrRaySuppressed;const data=ray.addController(controller,source);data.grip=controller.userData.gripObject;return{controller,source,data};});
   const tick=()=>{menu.tick(.016);c.cameraRig.updateWorldMatrix(true,true);c.scene.updateMatrixWorld(true);ray.execute(c,.016,1);c.renderer.render(c.scene,c.camera);};
   const button=(side,index,value)=>{controls[side].source.gamepad.buttons[index]={pressed:value,value:Number(value)};tick();};
   const plane=()=>menu.mesh||menu.panel;
   const point=(mesh,u=.5,v=.5)=>mesh.localToWorld(new V((u-.5)*mesh.geometry.parameters.width,(v-.5)*mesh.geometry.parameters.height,0));
   const aim=(side,mesh,u=.5,v=.5)=>{const p=point(mesh,u,v),n=new V(0,0,1).transformDirection(mesh.matrixWorld),origin=p.clone().addScaledVector(n,.4),controller=controls[side].controller,parent=controller.parent;controller.position.copy(parent.worldToLocal(origin.clone()));const world=new Q().setFromRotationMatrix(new M().lookAt(origin,p,new V(0,1,0)));controller.quaternion.copy(parent.getWorldQuaternion(new Q()).inverse().multiply(world));controller.updateMatrix();c.cameraRig.updateWorldMatrix(true,true);};
   const click=key=>{tick();const r=menu.regions.find(r=>r.key===key);if(!r)throw Error('Missing actual XR region '+key);const w=r.w===undefined?r.width:r.w,h=r.h===undefined?r.height:r.h;aim(1,plane(),(r.x+w/2)/1024,1-(r.y+h/2)/960);tick();if(controls[1].data.currentIntersection?.state!==menu.state)throw Error('Actual ray missed '+key);ray.onSelectStart({target:controls[1].controller});ray.onSelectEnd({target:controls[1].controller});tick();};
   const hands=()=>{const eye=c.camera.getWorldPosition(new V()),base=c.cameraRig.worldToLocal(eye);for(const [i,row]of controls.entries()){delete row.source.gamepad;row.source.hand=new Map();row.controller.userData.xrHandContact={valid:true,pokeValid:true,pinching:false,indexRadius:.007,wrist:base.clone().add(new V(i?.22:-.22,-.35,-.45)),indexTip:base.clone().add(new V(i?.22:-.22,-.35,-.55)),indexDistal:base.clone().add(new V(i?.22:-.22,-.35,-.52))};}tick();};
   const finger=(side,mesh,gap)=>{const p=point(mesh),n=new V(0,0,1).transformDirection(mesh.matrixWorld),tip=p.addScaledVector(n,gap),contact=controls[side].controller.userData.xrHandContact,parent=controls[side].controller.parent;Object.assign(contact,{indexTip:parent.worldToLocal(tip.clone()),indexDistal:parent.worldToLocal(tip.clone().addScaledVector(n,.025)),wrist:parent.worldToLocal(tip.clone().addScaledVector(n,.12))});tick();};
   tick();window.__xrNav={c,menu,ray,session,controls,tick,button,click,hands,finger,plane};return{menu:menu.constructor.name};
  },isPublic);
  const review=async(isPublic,name)=>{
   await install(isPublic);
   const result=await b.call(()=>{const q=__xrNav;q.button(1,4,true);const opened=q.menu.opened&&q.c.studioMenuOpen;q.click('controls');const text=q.menu.canvas;const regions=q.menu.regions.length;q.click(q.menu.regions.some(r=>r.key==='back')?'back':'home');q.click('close');const closed=!q.menu.opened&&!q.c.studioMenuOpen;return{opened,closed,regions,canvas:[text.width,text.height]};});assert(result.opened&&result.closed);assert.deepEqual(result.canvas,[1024,960]);
   await b.call(()=>{const q=__xrNav;q.button(1,4,false);q.button(1,4,true);});await shot(name+'-controller-menu');
   await b.call(()=>{const q=__xrNav;q.click('controls');});await shot(name+'-controls');
   if(isPublic){const navigation=await b.call(()=>{const q=__xrNav;q.click('back');q.click('navigation');q.click('hand');q.click('movement');return{hand:q.c.handedness,desktop:q.c.desktopControllerData.inputSource.handedness,locomotion:q.c.studioLocomotion};});assert.deepEqual(navigation,{hand:'left',desktop:'left',locomotion:'teleport'});report.preferences=navigation;}
   await b.call(()=>__xrNav.menu.close());
   await b.call(()=>{const q=__xrNav;q.hands();});
   const launcher=await b.evaluate('!!(__xrNav.menu.launcher||__xrNav.menu.handLauncher).mesh?.visible');assert(launcher,'Visible measured-hand menu entry missing.');await shot(name+'-hand-entry');
   await b.call(()=>{const q=__xrNav,l=q.menu.launcher||q.menu.handLauncher;q.finger(1,l.mesh,.12);q.finger(1,l.mesh,.004);q.tick();});assert(await b.evaluate('__xrNav.menu.opened&&__xrNav.c.studioMenuOpen'),'Measured finger did not open the real menu.');await shot(name+'-hand-menu');
   // A measured index can also close the native canvas panel, without a ray.
   const closedByFinger=await b.call(()=>{const q=__xrNav,r=q.menu.regions.find(r=>r.key==='close'),mesh=q.plane(),w=r.w===undefined?r.width:r.w,h=r.h===undefined?r.height:r.h,geometry=mesh.geometry.parameters,V=q.c.camera.position.constructor;
    const center=mesh.localToWorld(new V(((r.x+w/2)/1024-.5)*geometry.width,(.5-(r.y+h/2)/960)*geometry.height,0)),normal=new V(0,0,1).transformDirection(mesh.matrixWorld),contact=q.controls[1].controller.userData.xrHandContact,parent=q.controls[1].controller.parent;
    for(const gap of [.12,.004]){const tip=center.clone().addScaledVector(normal,gap);Object.assign(contact,{indexTip:parent.worldToLocal(tip.clone()),indexDistal:parent.worldToLocal(tip.clone().addScaledVector(normal,.025)),wrist:parent.worldToLocal(tip.clone().addScaledVector(normal,.12))});q.tick();}return!q.menu.opened&&!q.c.studioMenuOpen;});assert(closedByFinger);
   await b.call(()=>{const q=__xrNav;delete q.controls[0].controller.userData.xrHandContact;delete q.controls[1].controller.userData.xrHandContact;q.tick();});assert(await b.evaluate('!(__xrNav.menu.launcher||__xrNav.menu.handLauncher).mesh.visible'));
   await b.call(()=>{const q=__xrNav;q.menu.open();q.session.visibilityState='visible-blurred';q.tick();});assert(await b.evaluate('!__xrNav.menu.opened&&!__xrNav.c.studioMenuOpen'));
   await b.call(()=>{const q=__xrNav;q.session.visibilityState='visible';q.hands();q.menu.open();q.click(q.menu.regions.some(r=>r.key==='exit')?'exit':'exit-vr');});await b.until(()=>b.evaluate('!__xrNav.c.vrMode&&__xrNav.session.ended===1'),'Actual XR exit button failed.',5000);
   report[name]={...result,measuredEntry:true,indexMenu:true,indexClose:true,trackingLoss:true,visibilityCancel:true,exit:true};
  };
  await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await b.send('Page.navigate',{url:f.origin+'/'});await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Welcome unavailable.');await b.evaluate('document.querySelector("#explore-demo").click()');await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo'),'Public demo unavailable.',90000);await review(true,'public');
  await b.send('Page.navigate',{url:f.origin+'/editor?libraryScene=original-hall'});await b.until(()=>b.evaluate('!!document.getElementById("login")'),'Login unavailable.');await b.call(password=>{const form=document.getElementById('login');form.elements.username.value='qa_production_owner';form.elements.password.value=password;form.requestSubmit();},password);await b.until(()=>b.evaluate('!!window.context?.studio&&!context.editor.initializing&&!context.editor.loadingProject'),'Private tour unavailable.',150000);await b.evaluate('context.studio.ready');if(await b.evaluate('context.editor.active'))await b.evaluate('context.editor.leave()');await review(false,'private');
  assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(f.errors,[]);report.passed=true;
 });return report;}catch(error){report.failure=error.stack;throw error;}finally{fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await f.close();console.log(JSON.stringify({passed:!!report.passed,report:path.join(OUT,'report.json')}));}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});module.exports={run};
