'use strict';
// Render the exact compiled skin and controller pose solver in disposable Chrome.
// The contact board is diagnostic geometry, separate from authored user scenes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/xr-adaptive-hands');
async function run(expected){
 assert.match(expected||'',/^[a-f0-9]{64}$/);assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))).digest('hex'),expected);
 fs.mkdirSync(OUT,{recursive:true});
 const report={publicSha256:expected,physicalHeadsetTest:false,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};
 const fixture=await startFixture('Disposable-Hand-Poses-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});fixture.renderBackend='d3d11';
 try{await withBrowser(fixture,report,async b=>{
  const shot=async name=>{const png=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(png.data,'base64'));report.screenshots.push(file);};
  await b.send('Emulation.setDeviceMetricsOverride',{width:1500,height:1080,deviceScaleFactor:1,mobile:false});
  await b.send('Page.navigate',{url:fixture.origin+'/'});await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Welcome unavailable.');
  await b.evaluate('document.querySelector("#explore-demo").click()');await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo'),'Compiled viewer unavailable.',90000);
  report.poses=await b.call(()=>{
   const {context:c,THREE:T}=smartTwinViewer;c.renderer.setAnimationLoop(null);
   const controller=c.input.controllers[0],visual=controller.userData.gripObject.xrInputVisual;
   controller.visible=true;visual.update({handedness:'right',gamepad:{buttons:[]}},null,null,controller);
   const Hand=visual.skin.constructor,scene=new T.Scene();scene.background=new T.Color('#182635');
   const light=new T.HemisphereLight(0xe9f7ff,0x506070,1.1);scene.add(light);const key=new T.DirectionalLight(0xffffff,2);key.position.set(-1,2,3);scene.add(key);
   const camera=new T.OrthographicCamera(-.59,.59,.425,-.425,.01,10);camera.position.set(0,0,2);camera.lookAt(0,0,0);
   c.renderer.setSize(1500,1080);c.renderer.setPixelRatio(1);c.renderer.domElement.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:1000';
   document.querySelectorAll('body > *').forEach(n=>{if(n!==c.renderer.domElement)n.style.display='none';});document.body.appendChild(c.renderer.domElement);
   const names=['generic','controller','pinch','pingpong','bowling','drawer','joystick','plate','pole','relax','stick','flat','tweak','knob','clip'],hands=[];
   const label=(text,x,y)=>{const div=document.createElement('div');div.textContent=text;div.style.cssText=`position:fixed;left:${x}%;top:${y}%;color:#e6f3ff;font:600 18px system-ui;z-index:1002;transform:translateX(-50%)`;document.body.appendChild(div);};
   label('POSTURAS DE AGARRE · MODELO REAL DEL VISOR',50,2);
   names.forEach((profile,index)=>{
    const hand=new Hand('right'),mount=new T.Group();mount.position.set((index%5-2)*.23,.29-Math.floor(index/5)*.27,0);mount.rotation.set(-Math.PI*.38,.35,Math.PI-.20,'ZYX');scene.add(mount);mount.add(hand.root);
    const target=new T.Mesh(new T.SphereBufferGeometry(.02),new T.MeshBasicMaterial());target.position.set(0,0,-10);scene.add(target);
    const input={interaction:{object:target,profile,held:true}};for(let i=0;i<60;i++)hand.controller(1,1,input,1/72);hands.push(hand);label(profile,index%5*20+10,31+Math.floor(index/5)*32);
   });
   scene.updateMatrixWorld(true);c.renderer.render(scene,camera);
   window.__adaptiveHandQA={c,T,Hand,scene,camera,hands,label};
   return hands.map(h=>({pose:h.root.userData.handGrabPose,joints:h.bones.size,triangles:h.geometry.index.count/3}));
  });
  assert.equal(new Set(report.poses.map(row=>row.pose)).size,15);await shot('grab-poses');
  report.contacts=await b.call(()=>{
   const q=__adaptiveHandQA,{T,c,Hand}=q,scene=new T.Scene();scene.background=new T.Color('#182635');scene.add(new T.HemisphereLight(0xe9f7ff,0x506070,1.3));const key=new T.DirectionalLight(0xffffff,2);key.position.set(-1,2,3);scene.add(key);
   document.querySelectorAll('body > div').forEach(n=>{n.style.display='none';});q.label('CONTACTO POR DEDO · AMBAS MANOS',50,3);
   const camera=new T.OrthographicCamera(-.36,.36,.26,-.26,.01,10);camera.position.set(0,-.38,.7);camera.lookAt(0,0,0);
   const results=[];
   ['left','right'].forEach((side,col)=>[.018,.036].forEach((radius,row)=>{
    const mount=new T.Group();mount.position.set((col-.5)*.34,(.5-row)*.23,0);scene.add(mount);
    const hand=new Hand(side);mount.add(hand.root);const target=new T.Mesh(new T.SphereBufferGeometry(radius,32,24),new T.MeshStandardMaterial({color:0xd99c43,roughness:.35}));mount.add(target);
    for(let i=0;i<90;i++)hand.controller(1,1,{interaction:{object:target,profile:'knob',held:true}},1/72);
    results.push({side,radius,limits:hand.pose.limits.slice(),triangles:hand.geometry.index.count/3});
    q.label(`${side==='left'?'Izquierda':'Derecha'} · Ø ${radius*2000} mm`,col*50+25,row?90:44);
   }));
   scene.updateMatrixWorld(true);c.renderer.render(scene,camera);return{hands:results,gl:c.renderer.getContext().getError(),calls:c.renderer.info.render.calls};
  });
  await shot('adaptive-contact');assert.equal(report.contacts.gl,0);assert.equal(report.contacts.hands.length,4);
 });assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(fixture.errors,[]);report.passed=true;
 }catch(error){report.failure=error.stack||String(error);throw error;}
 finally{fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,report:path.join(OUT,'report.json')}));}
 return report;
}
module.exports={run};if(require.main===module)run(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
