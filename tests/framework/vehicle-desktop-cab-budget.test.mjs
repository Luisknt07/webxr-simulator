import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),h=require('../legacy/test-vehicle-driving.js'),CollisionWorld=require('../../packages/render-three/src/CollisionWorld.js').default;
function fixture(){
 const f=h.setup(false,true);f.driving.dispose();f.ctx.graphics={hints:{standaloneXR:false},getLimits:()=>({tier:'balanced'})};
 f.driving=new h.Driving(f.ctx,f.runtime,{document:f.dom,window:f.window,keepCabWarm:true,lightweightCab:true});
 return{...f,close(){f.driving.dispose();f.runtime.stop();}};
}

test('desktop public cab boards with a native 2D map, no auxiliary world render and reusable labels',()=>{
 const f=fixture();try{
  f.driving.prepareCab(f.record);const atlas=f.driving.cab.labels.texture;
  for(let cycle=0;cycle<3;cycle++){
   assert(f.driving.boardAndStart(f.record.id));const monitor=f.driving.docking,camera=monitor.forkCamera;
   assert.equal(f.driving.cab.labels.texture,atlas);assert.equal(monitor.mode,'layout');assert.equal(monitor.plan.dataset.renderMode,'schematic');assert.equal(camera.facility,null);assert.equal(camera.enabled,false);assert.equal(camera.active(),false);
   for(let i=0;i<10;i++)assert.equal(camera.renderBefore(f.scene,.1),false);assert.equal(camera.stats.allocations,0);assert.equal(camera.target,undefined);
   assert(f.driving.definitions().some(action=>action.action==='forkCamera'),'Desktop retains explicitly requested inspection.');
   assert(f.driving.unmount(true));
  }
 }finally{f.close();}
});

test('desktop lightweight guidance skips advisory sweeps while real pickup, driving and collision checks stay active',()=>{
 const f=fixture();let physical=0,advisory=0;const world=f.ctx.collisionWorld=new CollisionWorld(f.ctx,f.document);world.setRoom('hall');const sweep=world.sweepBox.bind(world);world.sweepBox=(...args)=>{if(/guidanceRoute/.test(new Error().stack)){advisory++;throw Error('Public boarding must not sweep an optional itinerary.');}physical++;return sweep(...args);};
 try{
  assert(f.driving.boardAndStart(f.record.id));assert.equal(advisory,0);assert(f.driving.holographicGuide.getTargets().length);assert.equal(f.driving.holographicGuide.getState().routeVerified,false);
  const product=f.runtime.products.get(f.pallet);assert(f.driving.command('pickup'));assert.equal(f.v.entry.product,product);assert(physical>0);
  h.key(f,'KeyW');f.driving.beforeStep();assert.equal(f.v.input.throttle,1);h.key(f,'KeyW',false);f.driving.beforeStep();assert.equal(f.v.input.throttle,0);
  assert(f.driving.command('rearView'));assert.equal(f.driving.docking.forkCamera.enabled,true);assert.equal(f.driving.docking.mode,'rear');assert.equal(f.driving.docking.forkCamera.active(),true);
  assert(f.driving.command('forkCamera'));assert.equal(f.driving.docking.forkCamera.enabled,false);assert.equal(f.driving.docking.mode,'layout');assert.equal(f.driving.docking.forkCamera.facility,null);assert.equal(f.driving.docking.forkCamera.active(),false);
 }finally{f.close();}
});
