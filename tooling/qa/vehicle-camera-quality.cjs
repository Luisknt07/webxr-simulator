'use strict';
// Isolated real GPU check of the production camera material/target owner.
// Pixel reads are test-only; the application never reads a camera frame to CPU.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {run:isolatedRenderer}=require('./qa-three-r112-instancing-browser');
const ROOT=path.resolve(__dirname,'../..'),OUTPUT=path.join(ROOT,'data/qa-studio');
async function run(){
 const bytes=fs.readFileSync(path.join(ROOT,'modules/logistica-industrial/functions/montacargas/runtime/VehicleForkCamera.js')),sourceSha256=createHash('sha256').update(bytes).digest('hex');
 const source=bytes.toString('utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class VehicleForkCamera','return class VehicleForkCamera');
 let result;
 const report=await isolatedRenderer(async browser=>{
  result=await browser.call(code=>{
   const T=window.__three,Camera=new Function('THREE',code)(T),results=[];
   const check=(ok,message)=>{if(!ok)throw Error(message);};
   for(const mode of ['webgl','webgl2']){
    const canvas=document.createElement('canvas'),gl=canvas.getContext(mode,{antialias:false,preserveDrawingBuffer:true});check(gl,'Missing '+mode+' fixture context.');
    const renderer=new T.WebGLRenderer({canvas,context:gl,antialias:false,preserveDrawingBuffer:true});renderer.setSize(256,144);renderer.outputEncoding=T.sRGBEncoding;renderer.setClearColor(0x000000);document.body.appendChild(canvas);
    const scene=new T.Scene(),view=new T.OrthographicCamera(-1,1,.5625,-.5625,.01,10);view.position.z=2;
    const shape=new T.Mesh(new T.PlaneBufferGeometry(1.4,.65),new T.MeshBasicMaterial({color:0xffffff,toneMapped:false}));shape.rotation.z=.37;scene.add(shape);
    const parent=new T.Group(),driving={ctx:{renderer,graphics:{getLimits:()=>({tier:'balanced'})},performanceRenderTargets:new Set()},record:()=>null};
    const owner=new Camera(driving);owner.mount({parent});const profile=owner.profile();profile.width=96;profile.height=54;profile.mirrorWidth=48;profile.mirrorHeight=27;owner.resources(profile);
    const target=owner.target;renderer.setRenderTarget(target);renderer.render(scene,view);renderer.setRenderTarget(null);
    const pixels=()=>{const values=new Uint8Array(256*144*4);gl.readPixels(0,0,256,144,gl.RGBA,gl.UNSIGNED_BYTE,values);return values;};
    const draw=enabled=>{owner.overlay.material.userData.vehicleCameraFilter.enabled.value=enabled;renderer.render(owner.overlayScene,owner.overlayCamera);return pixels();};
    const unfiltered=draw(0),filtered=draw(mode==='webgl'?1:0);let changed=0,difference=0,edgeBefore=0,edgeAfter=0,lit=0;
    for(let index=0;index<filtered.length;index+=4){if(Math.abs(unfiltered[index]-filtered[index])>2)changed++;difference+=Math.abs(unfiltered[index]-filtered[index]);if(unfiltered[index]>8&&unfiltered[index]<247)edgeBefore++;if(filtered[index]>8&&filtered[index]<247)edgeAfter++;if(filtered[index]>32)lit++;}
    check(lit>5000,'The camera texture must render actual geometry.');check(gl.getError()===0,'Camera shader/target generated a GL error.');
    if(mode==='webgl'){check(changed>250,'FXAA must affect diagonal edges rather than silently compile as a no-op.');check(difference/(256*144)<5,'Antialiasing must preserve overall image luminance.');check(edgeAfter>edgeBefore,'FXAA must soften diagonal transitions.');}
    check(!!target.isWebGLMultisampleRenderTarget===(mode==='webgl2'),'MSAA target selection must match the actual context.');
    target.texture.repeat.x=-1;target.texture.offset.x=1;target.texture.updateMatrix();const mirrored=draw(mode==='webgl'?1:0);let mirrorError=0;
    for(let y=0;y<144;y++)for(let x=0;x<256;x++)mirrorError+=Math.abs(filtered[(y*256+x)*4]-mirrored[(y*256+255-x)*4]);
    check(mirrorError/(256*144)<1.5,'Filtering must retain the rear-view texture transform.');
    const allocated=driving.ctx.performanceRenderTargets.size;owner.dispose();check(driving.ctx.performanceRenderTargets.size===0,'Target ownership must release on dispose.');shape.geometry.dispose();shape.material.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();
    results.push({mode,antialias:mode==='webgl2'?'msaa':'fxaa',samples:target.samples||0,changed,edgeBefore,edgeAfter,luminanceError:difference/(256*144),mirrorError:mirrorError/(256*144),registeredTargets:allocated,glError:0});
   }
   return results;
  },source);
  assert.equal(result.length,2);assert.deepEqual(browser.report.exceptions,[]);assert.deepEqual(browser.report.consoleErrors,[]);
 });
 fs.mkdirSync(OUTPUT,{recursive:true});fs.writeFileSync(path.join(OUTPUT,'vehicle-camera-quality.json'),JSON.stringify({passed:true,sourceSha256,results:result,browser:report},null,2));console.log(JSON.stringify({passed:true,sourceSha256,results:result}));
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
