'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {run:isolatedRenderer}=require('./qa-three-r112-instancing-browser');
const ROOT=path.resolve(__dirname,'../..');
async function run(){
 const source=fs.readFileSync(path.join(ROOT,'packages/render-three/schema/industrial-surfaces.js'),'utf8'),sourceSha256=createHash('sha256').update(source).digest('hex');let results;
 const report=await isolatedRenderer(async browser=>{
  results=await browser.call(code=>{
   const T=window.__three,library=new Function('module',code+'\nreturn module.exports;')({exports:{}}),rows=[];
   for(const type of ['webgl','webgl2']){
    const canvas=document.createElement('canvas'),gl=canvas.getContext(type,{preserveDrawingBuffer:true,antialias:false});if(!gl)throw Error('Missing '+type);const renderer=new T.WebGLRenderer({canvas,context:gl});renderer.setSize(480,320);renderer.outputEncoding=T.sRGBEncoding;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.setClearColor(0x72808a);document.body.appendChild(canvas);
    const scene=new T.Scene(),camera=new T.PerspectiveCamera(48,1.5,.1,30);camera.position.set(4,3.6,6);camera.lookAt(0,1,0);
    const fill=new T.HemisphereLight(0xffffff,0x555555,.8),sun=new T.DirectionalLight(0xffffff,.8);sun.position.set(2,6,4);scene.add(fill,sun);
    const material=new T.MeshStandardMaterial({color:0x8b8b84,roughness:.96}),floorMaterial=material.clone(),floor=new T.Mesh(new T.BoxBufferGeometry(8,.1,8),floorMaterial),wallGeometry=new T.BoxBufferGeometry(4,3,.12),wall=new T.InstancedMesh(wallGeometry,material,2);floor.position.y=-.05;
    wall.setMatrixAt(0,new T.Matrix4().makeTranslation(-2,1.5,-2));wall.setMatrixAt(1,new T.Matrix4().makeTranslation(2,1.5,-2));scene.add(floor,wall);scene.updateMatrixWorld(true);
    const pixels=()=>{renderer.render(scene,camera);const p=new Uint8Array(480*320*4);gl.readPixels(0,0,480,320,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
    const bare=pixels(),detail=new library.Detail(T);detail.install(material,'wall',0);detail.install(floorMaterial,'floor',0);const textured=pixels();let changed=0,error=0;
    for(let i=0;i<bare.length;i+=4){const d=Math.abs(textured[i]-bare[i]);if(d>3)changed++;error+=d;}
    if(gl.getError()!==0)throw Error('Surface shader generated a GL error');if(changed<15000)throw Error('The surface maps did not visibly affect floor and both instanced walls');
    rows.push({type,changed,lumaDifference:error/(480*320),textures:detail.stats.textures,bytes:detail.stats.bytes,glError:0});
    detail.dispose();material.dispose();floorMaterial.dispose();floor.geometry.dispose();wallGeometry.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();
   }return rows;
  },source);
  assert.deepEqual(browser.report.exceptions,[]);assert.deepEqual(browser.report.consoleErrors,[]);
 });
 const out=path.join(ROOT,'data/qa-studio');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'industrial-surface-detail.json'),JSON.stringify({passed:true,sourceSha256,results,browser:report},null,2));console.log(JSON.stringify({passed:true,sourceSha256,results}));
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
