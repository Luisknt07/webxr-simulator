import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),h=require('../legacy/test-vehicle-driving.js'),CollisionWorld=require('../../packages/render-three/src/CollisionWorld.js').default;
function fixture(warm=false){
 const f=h.setup(true,true);f.ctx.graphics={hints:{standaloneXR:true},getLimits:()=>({tier:'balanced'})};
 if(warm){f.driving.dispose();f.driving=new h.Driving(f.ctx,f.runtime,{document:f.dom,window:f.window,keepCabWarm:true});}
 return{...f,close(){f.driving.dispose();f.runtime.stop();}};
}

test('Quest boarding keeps real pickup guidance but never sweeps an advisory itinerary',()=>{
 const f=fixture();let sweeps=0,physicalSweeps=0;const world=f.ctx.collisionWorld=new CollisionWorld(f.ctx,f.document);world.setRoom('hall');const sweep=world.sweepBox.bind(world);world.sweepBox=(...args)=>{if(/guidanceRoute/.test(new Error().stack)){sweeps++;throw Error('Optional itinerary planning cannot run while boarding Quest.');}physicalSweeps++;return sweep(...args);};
 try{
  assert(f.driving.mount(f.record.id));assert.equal(sweeps,0);const guide=f.driving.holographicGuide;
  guide.update(true);assert.equal(sweeps,0);assert(guide.getTargets().length);assert.equal(guide.getState().routeVerified,false);assert.equal(guide.route,null);
  assert(f.api.getDockingState(f.record).ready);const product=f.runtime.products.get(f.pallet);assert(f.driving.command('pickup'),f.notices.at(-1));assert.equal(f.v.entry.product,product);assert(physicalSweeps>0,'Real pickup collision checks remain active.');
 }finally{f.close();}
});

test('Quest keeps a schematic and direct views without allocating auxiliary targets or exposing heavy camera actions',()=>{
 const f=fixture();try{
  assert(f.driving.mount(f.record.id));const monitor=f.driving.docking,camera=monitor.forkCamera;
  assert.equal(monitor.cameraEnabled,false);assert.equal(camera.active(),false);assert.equal(camera.facility,null);assert.equal(camera.target,undefined);
  for(let i=0;i<20;i++)assert.equal(camera.renderBefore(f.scene,.1),false);
  assert.equal(camera.stats.allocations,0);
  assert.equal(monitor.toggleRearView(),false);assert.equal(monitor.toggleCamera(),false);assert.equal(camera.active(),false);assert.equal(camera.selectedFeed,'front');assert.equal(monitor.mode,'layout');assert.equal(camera.facility,null);
  assert(!f.driving.definitions().some(value=>['forkCamera','rearView'].includes(value.action)));camera.setEnabled(true);assert.equal(camera.active(),false);
 }finally{f.close();}
});

test('prepared cab labels and contact states are reused across Quest boarding cycles and fully retired on dispose',()=>{
 const f=fixture(true);let atlas;try{
  assert(f.driving.prepareCab(f.record));atlas=f.driving.cab.labels.texture;assert(atlas);const count=f.driving.cab.controls.length,states=f.driving.cab.touchStates.map(s=>s.state);
  for(let i=0;i<3;i++){
   assert(f.driving.mount(f.record.id));assert.equal(f.driving.cab.labels.texture,atlas);assert.equal(f.driving.cab.controls.length,count);assert.deepEqual(f.driving.cab.touchStates.map(s=>s.state),states);
   assert.equal(f.driving.frontVisibility.wire,null);assert.equal(f.driving.frontVisibility.getWireStats().segments,0);assert.equal(f.driving.docking.forkCamera.active(),false);
   assert(f.driving.unmount(true));assert(f.driving.cab.controls.every(c=>!c.owner));assert.equal(f.driving.cab.labels.texture,atlas);
  }
  let disposed=0;atlas.addEventListener('dispose',()=>disposed++);f.driving.dispose();assert.equal(disposed,1);assert.equal(f.driving.cab.controls.length,0);assert.equal(f.driving.cab.labels.texture,null);assert.equal(f.driving.worldPanel,null);assert.equal(f.driving.docking.element,null);assert.equal(f.driving.docking.preparedSeat,null);
 }finally{f.close();}
});

test('the optional mast wire is built on demand while physical fork geometry and control meshes stay original',()=>{
 const f=fixture();try{
  assert(f.driving.mount(f.record.id));const visibility=f.driving.frontVisibility,rig=f.api.rig(f.record),fork=rig.forks,controls=rig.controls.levers.map(l=>l.object);
  assert.equal(visibility.wire,null);f.driving.docking.applyHologramState(true);assert(visibility.wire);assert(visibility.getWireStats().segments>0);assert.equal(rig.forks,fork);assert.deepEqual(rig.controls.levers.map(l=>l.object),controls);
  f.driving.docking.applyHologramState(false);assert.equal(visibility.wire.visible,false);
 }finally{f.close();}
});
