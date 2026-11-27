'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/desktop-running');
async function run(expected){
 assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))).digest('hex'),expected);
 fs.mkdirSync(OUT,{recursive:true});const report={hash:expected,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]},fixture=await startFixture('Disposable-Running-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});fixture.renderBackend='d3d11';
 try{await withBrowser(fixture,report,async b=>{
  await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});await b.send('Page.navigate',{url:fixture.origin+'/'});await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Welcome unavailable.');await b.evaluate('document.querySelector("#explore-demo").click()');await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo&&smartTwinViewer.getStats().frameCount>10'),'Scene unavailable.',90000);
  await b.call(()=>{const a=smartTwinViewer,c=a.context;c.renderer.setAnimationLoop(null);c.input.reset();c.cameraRig.position.set(-6.8,0,4);c.cameraRig.quaternion.set(0,0,0,1);c.camera.position.set(0,1.65,0);c.camera.quaternion.set(0,0,0,1);c.scene.updateMatrixWorld(true);window.__runQA={a,c};});
  const key=(code,name,vk,down=true,modifiers=0)=>b.send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:name,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,modifiers});
  const step=()=>b.call(()=>{const {a,c}=__runQA,from=c.camera.getWorldPosition(new a.THREE.Vector3());c.collisionWorld.beginFrame();c.input.step(.1);c.collisionWorld.endFrame();const to=c.camera.getWorldPosition(new a.THREE.Vector3());return Math.hypot(to.x-from.x,to.z-from.z);});
  const near=(actual,value)=>assert(Math.abs(actual-value)<.002,actual+' != '+value);
  await key('KeyW','w',87);report.walk=await step();near(report.walk,.2);
  await key('ShiftLeft','Shift',16,true,8);report.left=await step();near(report.left,.4);await key('ShiftLeft','Shift',16,false);report.released=await step();near(report.released,.2);
  await key('ShiftRight','Shift',16,true,8);report.right=await step();near(report.right,.4);await key('KeyD','D',68,true,8);report.diagonal=await step();near(report.diagonal,.4);await key('KeyD','d',68,false,8);await key('KeyW','w',87,false,8);await key('ShiftRight','Shift',16,false);report.stopped=await step();near(report.stopped,0);
  report.health=await b.call(()=>{const {a,c}=__runQA;c.renderer.render(c.scene,c.camera);return{webgl:c.renderer.getContext().getError(),frameError:a.getStats().frameError,hint:document.querySelector('#navigation-hint').textContent};});assert.equal(report.health.webgl,0);assert.equal(report.health.frameError,null);assert(report.health.hint.includes('Shift'));
 });assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);report.passed=true;
 }catch(error){report.failure=error.stack;throw error;}finally{fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,path:OUT}));}
}
module.exports={run};if(require.main===module)run(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
