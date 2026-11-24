'use strict';
// Exact compiled viewer, real Chrome/GPU and native application RAF. Only the
// XR session boundary and measured joint samples are emulated, not the controls.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/public-xr-hands');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(expected){
 assert.match(expected||'',/^[a-f0-9]{64}$/);assert.equal(hash(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))),expected);
 assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/publication.json'))).bundleSha256,expected);
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const report={publicSha256:expected,physicalHeadsetTest:false,emulatedBoundary:'XR session and joint poses only',nativeRAF:true,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};
 const fixture=await startFixture('Disposable-XR-Hands-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});fixture.renderBackend='d3d11';
 try{
  assert.equal((await request(fixture.origin,'/viewer.js')).sha256,expected);
  await withBrowser(fixture,report,async b=>{
   const shot=async name=>{await delay(180);const png=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(png.data,'base64'));report.screenshots.push(file);};
   await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});await b.send('Page.navigate',{url:fixture.origin+'/'});
   await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Welcome unavailable.',60000);
   await b.evaluate('document.querySelector("#explore-demo").click()');await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo'),'Demo unavailable.',90000);
   await b.call(()=>{
    const a=smartTwinViewer,c=a.context,T=a.THREE,d=c.demo;d.driving.mount(d.stats().vehicle.id);
    const v=d.driving.record();let rig;v.object.traverse(n=>{if(n.userData.vehicleRig)rig=n.userData.vehicleRig;});
    c.input.reset();d.driving.follow();c.scene.updateMatrixWorld(true);
    const eye=rig.cabin.localToWorld(new T.Vector3(.55,1.57,-.25));c.camera.position.copy(c.cameraRig.worldToLocal(eye));c.camera.lookAt(rig.cabin.localToWorld(new T.Vector3(-.10,1.02,.20)));c.camera.updateMatrixWorld(true);
    const xr=c.renderer.xr,session=new EventTarget();session.visibilityState='visible';session.inputSources=[];
    const poses=new Map(),reference={},frame={getJointPose:joint=>poses.get(joint),getPose:()=>null};
    const original={session:xr.getSession,reference:xr.getReferenceSpace,camera:xr.getCamera,step:c.input.step};
    xr.getSession=()=>session;xr.getReferenceSpace=()=>reference;xr.getCamera=()=>{c.camera.updateMatrixWorld(true);return c.camera;};
    const hands=c.input.controllers.map((controller,index)=>{
     controller.visible=true;const grip=controller.userData.gripObject,side=index?'right':'left';
     grip.xrInputVisual.update({handedness:side,gamepad:{buttons:[]}},null,reference,controller);
     const skin=grip.xrInputVisual.skin,hand=new Map([...skin.bind.keys()].map(name=>[name,{}])),source={handedness:side,targetRayMode:'tracked-pointer',hand,profiles:['generic-hand-select']};session.inputSources.push(source);
     return{controller,grip,skin,hand,source};
    });
    c.vrMode=true;c.input.step=function(delta,xrFrame){return original.step.call(this,delta,xrFrame||frame);};
    const place=(index,id,gap)=>{
     const h=hands[index],control=d.driving.cab.controls.find(x=>x.channel===id);c.scene.updateMatrixWorld(true);
     const normal=new T.Vector3().fromArray(control.descriptor.pressAxis||[0,0,1]).negate().transformDirection(control.object.matrixWorld);
     const tip=control.object.getWorldPosition(new T.Vector3()).addScaledVector(normal,.006+gap),rotation=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,-1),normal.clone().negate());
     const bindTip=new T.Vector3().setFromMatrixPosition(h.skin.bind.get('index-finger-tip')).applyQuaternion(rotation),origin=tip.clone().sub(bindTip);
     const world=new T.Matrix4().compose(origin,rotation,new T.Vector3(1,1,1)),inverse=new T.Matrix4().getInverse(c.cameraRig.matrixWorld);
     for(const [name,joint]of h.hand){const matrix=new T.Matrix4().multiplyMatrices(inverse,world).multiply(h.skin.bind.get(name));poses.set(joint,{radius:.007,transform:{matrix:matrix.toArray()}});}
     h.controller.matrix.multiplyMatrices(inverse,world);h.controller.matrix.decompose(h.controller.position,h.controller.quaternion,h.controller.scale);h.controller.visible=true;
    };
    window.__handQA={a,c,d,rig,v,hands,poses,place,original,session};place(0,'horn',.15);place(1,'lights',.15);
   });
   await b.until(()=>b.evaluate('__handQA.hands.every(h=>h.skin.root.visible&&h.skin.mesh.isSkinnedMesh&&h.controller.userData.xrHandContact?.pokeValid)'),'Measured hand skins unavailable.');
   await shot('continuous-tracked-hands');
   const set=async(index,id,gap)=>{await b.call(({index,id,gap})=>__handQA.place(index,id,gap),{index,id,gap});await delay(220);};
   const state=()=>b.evaluate('({lights:__handQA.v.components.vehicle.lights,horn:__handQA.v.components.vehicle.hornCount,emergency:__handQA.v.components.vehicle.emergency,running:__handQA.v.components.vehicle.running,contacts:__handQA.hands.map(h=>{const x=__handQA.c.raycontrol.controllers.find(d=>d.controller===h.controller);return x?.handTouch?.entry?.state.name||null;}),frameError:smartTwinViewer.getStats().frameError})');
   const before=await state();await set(1,'lights',.003);const pressed=await state();assert.equal(pressed.lights,!before.lights);await shot('index-pressed-lights');
   await delay(350);assert.equal((await state()).lights,pressed.lights,'Resting index cannot repeatedly toggle.');
   await set(0,'horn',.003);const sounding=await state();await delay(450);assert((await state()).horn>sounding.horn);await shot('bilateral-button-contact');
   await b.call(()=>{const h=__handQA.hands[0];__handQA.poses.delete(h.hand.get('index-finger-phalanx-distal'));});await delay(220);const lost=await state();await delay(400);assert.equal((await state()).horn,lost.horn);assert.equal(lost.contacts[0],null);
   await set(1,'lights',.15);await set(1,'emergency',.15);await set(1,'emergency',.003);assert((await state()).emergency);await shot('finger-emergency');
   report.controls={before,pressed,sounding,lost,final:await state()};
   report.hands=await b.call(()=>__handQA.hands.map(h=>({side:h.source.handedness,mode:h.controller.userData.xrHandVisualMode,visible:h.skin.root.visible,joints:h.skin.skeleton.bones.length,triangles:h.skin.geometry.index.count/3,material:h.skin.material.type,pokeValid:h.controller.userData.xrHandContact.pokeValid})));
   assert.equal(report.controls.final.frameError,null);assert(report.hands.every(h=>h.joints===25&&h.triangles===2314));
   await b.call(()=>{const q=__handQA;q.session.visibilityState='visible-blurred';q.session.dispatchEvent(new Event('visibilitychange'));q.c.vrMode=false;q.c.input.step=q.original.step;q.c.renderer.xr.getSession=q.original.session;q.c.renderer.xr.getReferenceSpace=q.original.reference;q.c.renderer.xr.getCamera=q.original.camera;q.d.driving.unmount(true);});
  });
  assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(fixture.errors,[]);report.passed=true;
 }catch(error){report.failure=error.stack||String(error);throw error;}
 finally{report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,report:path.join(OUT,'report.json')}));}
 return report;
}
module.exports={run};if(require.main===module)run(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
