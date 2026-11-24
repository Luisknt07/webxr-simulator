import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three'),text=fs.readFileSync('tests/legacy/test-vehicle-fork-camera.js','utf8');
const {setup,renderer,baseline}=new Function('require','__dirname',text.slice(0,text.indexOf('\nconst desktop = setup('))+'\nreturn{setup,renderer,baseline};')(createRequire(require('node:path').resolve('tests/legacy/test-vehicle-fork-camera.js')),require('node:path').resolve('tests/legacy'));
const drawing=()=>new Proxy({measureText:s=>({width:String(s).length*8})},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});

test('the insertion drawing follows a wide slot without stretching either metric axis',()=>{
 const f=setup(false,true);renderer(f);assert(f.driving.mount(f.record.id));
 try{const m=f.driving.docking;m.context=drawing();m.canvas.rect={left:0,top:0,width:800,height:250};m.update(true);assert.equal(m.mode,'inspection');assert.equal(m.canvas.width,768);assert.equal(m.canvas.height,240);assert(Math.abs(800/m.canvas.width-250/m.canvas.height)<1e-8);assert(m.projection.scale>0);}finally{f.driving.dispose();f.runtime.stop();}
});

test('real scene plan shares one bounded GPU pass, matches the metric overlay and restores ceiling, materials and main view',()=>{
 const f=setup(false,true),r=renderer(f);assert(f.driving.mount(f.record.id));
 const monitor=f.driving.docking,feed=monitor.forkCamera;monitor.context=drawing();monitor.canvas.rect={left:800,top:170,width:600,height:500};
 const roof=new THREE.Mesh(new THREE.BoxBufferGeometry(20,.1,20),new THREE.MeshBasicMaterial({color:0x263f47}));roof.name='Cubierta industrial';roof.userData.editorId='qa-roof';roof.position.y=6;f.root.add(roof);
 const fog=f.scene.fog=new THREE.Fog(0x718580,5,100),material=roof.material;
 monitor.forceLayout=true;monitor.update(true);assert.equal(monitor.mode,'layout');assert(feed.facility);assert.equal(feed.element,monitor.canvas);
 const before=baseline(f,r),saved=r.api.render;let passes=0;
 r.api.render=(scene,camera)=>{if(r.state.target){passes++;assert.equal(roof.visible,false);assert.equal(scene.fog,null);assert.equal(roof.material,material);assert.equal(f.driving.visualRoot.visible,true);}return saved(scene,camera);};
 try{
  assert(monitor.renderBefore(f.scene,.2));assert.equal(roof.visible,true);assert.equal(f.scene.fog,fog);assert.deepEqual(baseline(f,r),before);
  assert.equal(f.ctx.performanceRenderTargets.size,1);assert(feed.stats.estimatedGpuBytes<=feed.stats.gpuBudgetBytes);assert(feed.stats.maxFPS<=6);
  const {model,projection}=feed.facility,camera=feed.camera;
  for(const point of [[model.bounds.minX,model.bounds.minZ],[model.bounds.maxX,model.bounds.maxZ],model.vehicle.position]){
   const screen=projection.screen(point),p=new THREE.Vector3(point[0],0,point[1]).project(camera);
   assert(Math.abs(screen[0]-(p.x+1)*projection.plot.width/2)<1e-5);assert(Math.abs(screen[1]-(1-p.y)*projection.plot.height/2)<1e-5);
  }
  assert(monitor.postRender());assert.equal(monitor.liveMapPainted,true);assert.equal(monitor.plan.dataset.renderMode,'live');
  const frames=feed.stats.frames;for(let i=0;i<120;i++)monitor.renderBefore(f.scene,1/120);assert(feed.stats.frames-frames<=6);assert(passes<=7);
  monitor.toggleRearView();assert.equal(feed.facility,null);assert.equal(feed.element,monitor.feedViewport);
  monitor.forceLayout=true;monitor.update(true);r.api.render=()=>{throw Error('device frame failure');};assert.equal(monitor.renderBefore(f.scene,.2),false);
  assert.equal(roof.visible,true);assert.equal(f.scene.fog,fog);assert.deepEqual(baseline(f,r),before);assert.equal(f.ctx.performanceRenderTargets.size,0);
 }finally{r.api.render=saved;f.driving.dispose();f.runtime.stop();}
});
