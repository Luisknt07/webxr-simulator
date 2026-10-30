'use strict';
// The actual camera owner, actual targets and BasicMaterial shader hook. A
// recording renderer isolates pixel sizing/AA/resources from vehicle physics.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const code=fs.readFileSync(path.join(__dirname,'../../modules/logistica-industrial/functions/montacargas/runtime/VehicleForkCamera.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class VehicleForkCamera','return class VehicleForkCamera');
const Camera=new Function('THREE',code)(THREE);
function fixture({webgl2=false,samples=4,dpr=1.5,tier='balanced',xr=false,width=400,mirrorWidth=200}={}){
 const root=new THREE.Group(),forks=new THREE.Group(),rig=new THREE.Group(),camera=new THREE.PerspectiveCamera();rig.add(camera);root.add(rig,forks);root.userData.vehicleRig={forks};
 const record={object:root,components:{vehicle:{config:{forkSpread:.4,forkWidth:.12,forkLength:1.05,forkThickness:.04,height:2.2,length:2.7}}}},calls=[],events=new Map();
 const canvas={width:2400,height:1600,getBoundingClientRect:()=>({left:0,top:0,width:1200,height:800}),addEventListener(name,handler){events.set(name,handler);},removeEventListener(name){events.delete(name);}};
 const state={target:null,viewport:new THREE.Vector4(3,4,500,300),scissor:new THREE.Vector4(7,8,100,200),test:true};
 const renderer={capabilities:{isWebGL2:webgl2,maxSamples:samples,maxTextureSize:4096},domElement:canvas,xr:{enabled:true,isPresenting:xr,getSession:()=>({visibilityState:'visible'})},shadowMap:{enabled:true,autoUpdate:true,needsUpdate:true},autoClear:false,info:{autoReset:true,render:{calls:3,triangles:6}},
  getPixelRatio:()=>dpr,getContext:()=>({isContextLost:()=>false}),getRenderTarget:()=>state.target,getViewport:out=>out.copy(state.viewport),getScissor:out=>out.copy(state.scissor),getScissorTest:()=>state.test,
  setRenderTarget(target){state.target=target;},setViewport(x,y,w,h){state.viewport.copy(x&&x.isVector4?x:new THREE.Vector4(x,y,w,h));},setScissor(x,y,w,h){state.scissor.copy(x&&x.isVector4?x:new THREE.Vector4(x,y,w,h));},setScissorTest(value){state.test=value;},
  render(scene,view){calls.push({scene,view,target:state.target});if(renderer.failNext){renderer.failNext=false;throw Error('Synthetic GPU failure');}}
 };
 const ctx={renderer,camera,cameraRig:rig,vrMode:xr,graphics:{getLimits:()=>({tier})},performanceRenderTargets:new Set()},driving={ctx,id:'truck',record:()=>record,document:{hidden:false},visualRoot:root,simulation:{products:new Map()},docking:{snapshot:null}};
 const element={hidden:false,style:{},getBoundingClientRect:()=>({left:500,top:100,width,height:width*9/16})},mirror={hidden:false,style:{},getBoundingClientRect:()=>({left:500,top:30,width:mirrorWidth,height:mirrorWidth*9/16})};
 const feed=new Camera(driving);feed.mount({element,mirrorElement:mirror,parent:root});feed.visibleFeeds=()=>[feed.selectedFeed];return {feed,ctx,renderer,record,calls,state,events,root,camera,element,mirror};
}
function both(f){assert(f.feed.renderBefore(f.root,.2));assert(f.feed.renderBefore(f.root,.2));}
let scenarios=0;
for(const webgl2 of [false,true])for(const xr of [false,true]){
 const f=fixture({webgl2,xr,tier:'high',dpr:2,width:650}),feed=f.feed;
 const cameraBefore=f.camera.matrixWorld.toArray(),view=f.state.viewport.toArray(),scissor=f.state.scissor.toArray();both(f);
 assert(feed.target.width>=512&&feed.target.width<=1280);assert.equal(feed.target.height,feed.target.width*9/16);assert(!feed.mirrorTarget);
 assert.equal(feed.stats.antialias,webgl2?'msaa':'fxaa');assert.equal(!!feed.target.isWebGLMultisampleRenderTarget,webgl2);assert.equal(feed.target.texture.encoding,THREE.LinearEncoding);assert.equal(feed.target.texture.repeat.x,1);
 const measured=feed.target.width*feed.target.height*8*(webgl2?feed.target.samples+1:1);assert.equal(feed.stats.estimatedGpuBytes,measured);assert(measured<=(xr?12:32)*1024*1024);assert.equal(f.ctx.performanceRenderTargets.size,1);
 for(const material of [feed.plane.material,feed.overlay.material]){
  const shader={uniforms:{},fragmentShader:THREE.ShaderLib.basic.fragmentShader};material.onBeforeCompile(shader);assert.equal(shader.uniforms.cameraFxaaEnabled.value,webgl2?0:1);assert(shader.fragmentShader.includes('cameraFxaa(map, vUv)'));assert(shader.fragmentShader.includes('mapTexelToLinear(texelColor)'));assert(shader.fragmentShader.includes('#include <encodings_fragment>'));assert.equal(material.toneMapped,false);
 }
 assert.deepEqual(f.camera.matrixWorld.toArray(),cameraBefore);assert.deepEqual(f.state.viewport.toArray(),view);assert.deepEqual(f.state.scissor.toArray(),scissor);assert.equal(f.renderer.xr.enabled,true);assert.equal(f.renderer.shadowMap.autoUpdate,true);
 assert.equal(f.calls.length,2,'AA adds no world pass.');if(!xr){assert(feed.postRender());assert.equal(f.calls.length,3,'Only the selected camera is composed.');}
 let released=0;feed.target.addEventListener('dispose',()=>released++);feed.toggleRearView();assert.equal(released,1);assert.equal(f.ctx.performanceRenderTargets.size,0);both(f);
 assert(!feed.target&&feed.mirrorTarget);assert.equal(feed.mirrorTarget.width,feed.profile().width,'Rear view uses the same full display pixel budget.');assert.equal(feed.mirrorTarget.texture.repeat.x,-1);assert.equal(feed.mirrorTarget.texture.offset.x,1);assert.equal(f.ctx.performanceRenderTargets.size,1);assert.equal(feed.plane.material.map,feed.mirrorTarget.texture);
 feed.mirrorTarget.addEventListener('dispose',()=>released++);feed.setEnabled(false);assert.equal(released,2);assert.equal(f.ctx.performanceRenderTargets.size,0);feed.setEnabled(true);both(f);feed.onLost();assert.equal(f.ctx.performanceRenderTargets.size,0);feed.onRestored();both(f);feed.dispose();assert.equal(f.ctx.performanceRenderTargets.size,0);assert.equal(f.events.size,0);scenarios++;
}
{
 const small=fixture({dpr:1,width:420}),large=fixture({dpr:2,width:420});const a=small.feed.profile(),b=large.feed.profile();assert(b.width>a.width);assert(a.width>=768);assert(b.width>=420*2);small.feed.dispose();large.feed.dispose();
 const economy=fixture({tier:'economy'});assert(economy.feed.profile().width>=512);assert.equal(economy.feed.profile().fps,8);economy.feed.dispose();
 const unsupported=fixture({webgl2:true,samples:1});assert.equal(unsupported.feed.profile().antialias,'fxaa');unsupported.feed.dispose();
 const partial=fixture({webgl2:true,samples:3});assert.equal(partial.feed.profile().samples,2);partial.feed.dispose();
}
{
 const f=fixture({dpr:1,width:400});both(f);const source=[f.feed.target.width,f.feed.target.height],allocations=f.feed.stats.allocations,planeTexel=f.feed.plane.material.userData.vehicleCameraFilter.texel.value.clone();
 f.renderer.domElement.width=600;f.renderer.domElement.height=400;assert(f.feed.postRender());const front=f.feed.overlay.material.userData.vehicleCameraFilter.texel.value;
 assert.equal(front.x,1/200);assert.equal(front.y,1/112);assert(f.feed.plane.material.userData.vehicleCameraFilter.texel.value.equals(planeTexel));assert.deepEqual([f.feed.target.width,f.feed.target.height],source);assert.equal(f.feed.stats.allocations,allocations);assert.equal(f.ctx.performanceRenderTargets.size,1);
 f.renderer.domElement.width=2400;f.renderer.domElement.height=1600;assert(f.feed.postRender());assert.equal(front.x,1/source[0]);assert.equal(front.y,1/source[1]);assert.equal(f.renderer.getPixelRatio(),1);f.feed.dispose();
 const xr=fixture({xr:true});both(xr);const before=xr.feed.plane.material.userData.vehicleCameraFilter.texel.value.clone();xr.renderer.domElement.width=600;assert.equal(xr.feed.postRender(),false);assert(xr.feed.plane.material.userData.vehicleCameraFilter.texel.value.equals(before));xr.feed.dispose();
}
console.log('Vehicle camera quality: native pixel sizing, full-size alternating rear image, one live target, original FXAA/MSAA/UV/encoding, adaptive composition sampling, 32/12 MiB budgets and complete cleanup passed ('+scenarios+' profiles).');
