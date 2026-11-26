'use strict';
// Actual native cab, study snapshots and measured XR joints. Only the headset
// boundary is emulated; the controls, ownership and hydraulic runtime are real.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/vehicle-lever-grasp');
async function run(expected,baseline=false){
 assert.match(expected||'',/^[a-f0-9]{64}$/);assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))).digest('hex'),expected);
 fs.mkdirSync(OUT,{recursive:true});const report={publicSha256:expected,baseline,physicalHeadsetTest:false,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};
 const fixture=await startFixture('Disposable-Lever-Grasp-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});fixture.renderBackend='d3d11';
 try{await withBrowser(fixture,report,async b=>{
  const shot=async name=>{const png=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,(baseline?'before-':'after-')+name+'.png');fs.writeFileSync(file,Buffer.from(png.data,'base64'));report.screenshots.push(file);};
  await b.send('Page.navigate',{url:fixture.origin+'/'});await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Welcome unavailable.');
  await b.evaluate('document.querySelector("#explore-demo").click()');await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo'),'Public cab unavailable.',90000);
  report.geometry=await b.call(()=>{
   const a=smartTwinViewer,c=a.context,T=a.THREE,d=c.demo,r=d.simulation.records.get(d.stats().vehicle.id);let rig;r.object.traverse(n=>{if(n.userData.vehicleRig)rig=n.userData.vehicleRig;});
   c.renderer.setAnimationLoop(null);d.setPaused(true);c.input.reset();c.cameraRig.position.set(0,0,0);c.cameraRig.quaternion.set(0,0,0,1);c.scene.updateMatrixWorld(true);
   const view=(eye,target)=>{c.camera.position.copy(rig.cabin.localToWorld(new T.Vector3(...eye)));c.camera.lookAt(rig.cabin.localToWorld(new T.Vector3(...target)));c.scene.updateMatrixWorld(true);c.renderer.render(c.scene,c.camera);};
   window.__leverQA={a,c,T,d,r,rig,view};view([.25,1.65,-.18],[-.35,1.19,.14]);
   const controls=rig.controls.levers;return{bank:rig.hydraulicBank,knobs:controls.map(l=>({id:l.id,point:rig.cabin.worldToLocal(l.grip.getWorldPosition(new T.Vector3())).toArray()})),gaps:controls.slice(1).map((l,i)=>l.grip.getWorldPosition(new T.Vector3()).distanceTo(controls[i].grip.getWorldPosition(new T.Vector3())))};
  });await shot('lever-bank');
  report.study=await b.call(()=>{const q=__leverQA,s=q.d.equipmentStudy;if(!s.open(q.r.object))throw Error('Actual vehicle study unavailable.');s.showTab('parts');s.render(true);return{parts:s.parts.map(p=>p.id),meshes:s.previewMeshes.length};});await shot('study-assembled');
  await b.call(()=>{const s=__leverQA.d.equipmentStudy;s.selectedPart=s.parts.findIndex(p=>p.id==='cab');s.isolated=true;s.applySelection();s.render(true);});await shot('study-cab-isolated');
  await b.call(()=>{const s=__leverQA.d.equipmentStudy;s.explode.value='30';s.explodePreview();s.render(true);});await shot('study-cab-exploded');
  await b.call(()=>__leverQA.d.equipmentStudy.close());
  if(!baseline){
   assert(report.geometry.gaps.every(value=>value>=.094));
   report.measuredGrasps=await b.call(()=>{
    const {c,T,d,r,rig}=__leverQA;d.setPaused(false);if(!d.driving.mount(r.id))throw Error('Cannot mount real forklift.');
    const xr=c.renderer.xr,original={session:xr.getSession,reference:xr.getReferenceSpace,camera:xr.getCamera};
    const session=new EventTarget();session.visibilityState='visible';const joints=new Map(['wrist','thumb-tip','index-finger-tip'].map(name=>[name,{}])),poses=new Map();
    const source={handedness:'right',targetRayMode:'tracked-pointer',hand:joints};session.inputSources=[source];
    xr.getSession=()=>session;xr.getReferenceSpace=()=>({});xr.getCamera=()=>c.camera;c.vrMode=true;
    const controller=c.input.controllers[0],frame={getJointPose:joint=>poses.get(joint)},cab=d.driving.cab;
    const center=control=>{c.scene.updateMatrixWorld(true);return control.descriptor.grip.getWorldPosition(new T.Vector3());};
    const place=(point,gap)=>{
     const lateral=new T.Vector3(1,0,0).transformDirection(rig.cabin.matrixWorld),points={'thumb-tip':point.clone().addScaledVector(lateral,gap/2),'index-finger-tip':point.clone().addScaledVector(lateral,-gap/2),wrist:point.clone().add(new T.Vector3(0,0,-.12))};
     for(const [name,joint]of joints){const p=c.cameraRig.worldToLocal(points[name]);poses.set(joint,{radius:.007,transform:{matrix:new T.Matrix4().makeTranslation(p.x,p.y,p.z).toArray()}});}
     controller.visible=true;c.input.step(.016,frame);d.driving.beforeStep();
    };
    const results=[];
    try{
     for(const id of ['lift','tilt','sideShift']){
      const control=cab.controls.find(v=>v.channel===id),point=center(control);
      // Let native session/connection cancellation finish while the measured
      // hand is open, as it would during a real approach to the console.
      for(let i=0;i<6;i++)place(point,.11);place(point,.056);
      const state=cab.hands.get(controller),held=state?.control?.channel,globalPinch=controller.userData.xrHandContact.pinching;
      const axis=control.axis.clone().transformDirection(control.frame);place(point.clone().addScaledVector(axis,-control.descriptor.travel*.6),.056);
      const vehicle=d.driving.record().components.vehicle,inputs={...vehicle.input},before=vehicle.pose.lift;d.simulation.execute(.1);
      const liftChange=vehicle.pose.lift-before;place(center(control),.11);
      results.push({id,held,globalPinch,inputs,liftChange,released:!control.owner,neutral:vehicle.input[id]===0});
     }
    }finally{session.dispatchEvent(new Event('end'));c.vrMode=false;xr.getSession=original.session;xr.getReferenceSpace=original.reference;xr.getCamera=original.camera;d.driving.unmount(true);}
    return results;
   });
   for(const result of report.measuredGrasps){assert.equal(result.held,result.id);assert.equal(result.globalPinch,false);assert(Math.abs(result.inputs[result.id])>.5);assert(result.released&&result.neutral);for(const id of ['lift','tilt','sideShift'].filter(id=>id!==result.id))assert.equal(result.inputs[id],0);}
   assert(report.measuredGrasps[0].liftChange>0);
  }
 });assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(fixture.errors,[]);report.passed=true;
 }catch(error){report.failure=error.stack||String(error);throw error;}
 finally{fs.writeFileSync(path.join(OUT,baseline?'baseline.json':'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,report:path.join(OUT,baseline?'baseline.json':'report.json')}));}
 return report;
}
module.exports={run};if(require.main===module)run(process.argv[2],process.argv.includes('--baseline')).catch(error=>{console.error(error);process.exitCode=1;});
