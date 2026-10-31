'use strict';
// Real prefab/document/vehicle/receiver APIs; DOM and training instructions are
// test ports. Hiding the 3D helper must not hide or freeze logical navigation.
const assert=require('node:assert/strict');
const {THREE,fixture}=require('./test-vehicle-runtime.js');
const {setup}=require('./test-vehicle-storage.js'),{Runtime}=require('./test-robot-runtime.js');
const {Element,Driving}=require('./test-vehicle-driving.js');
const VehicleRuntime=require('../support/load-vehicle-runtime.js')(THREE);
const Guide=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleHolographicGuide.js').default;
const Facility=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleFacilityLayout.js').default;
const operatingState=(runtime,record,product)=>({time:runtime.time,distance:record.components.vehicle.distance,pose:JSON.stringify(record.components.vehicle.pose),config:JSON.stringify(record.components.vehicle.config),training:JSON.stringify(record.components.vehicle.training),entry:record.components.vehicle.entry,parent:product.object.parent,world:product.object.matrixWorld.toArray(),owner:product.vehicleOwnerId,reserved:product.vehicleReservedBy,count:runtime.products.size,entries:runtime.sourceRuntime.entries.size,warning:record.components.vehicle.warning});

async function freePlay(){
 const document=setup(),root=document.getRoot('hall'),scene=new THREE.Scene();scene.add(root);
 const truck=document.addPrefab('hall','vehicle','forklift-electric-4w'),pallet=document.addPrefab('hall','product','pallet-loaded'),stock=document.addPrefab('hall','palletQueue');
 document.setBehaviors(truck,document.getBehaviors(truck).map(c=>c.type==='vehicle'?{...c,parkingBrake:false,outputId:stock.userData.editorId}:c));
 document.setBehaviors(pallet,document.getBehaviors(pallet).map(c=>c.type==='product'?{...c,mass:33,units:4}:c));
 document.setBehaviors(stock,document.getBehaviors(stock).map(c=>c.type==='palletQueue'?{...c,withPanel:false,acceptsPallets:true,width:1.6,depth:1.4,palletCapacity:2,capacity:2,running:true}:c));
 truck.position.set(0,0,0);stock.position.set(0,0,9);pallet.position.set(0,0,1.7);
 const floor=new THREE.Mesh(new THREE.BoxBufferGeometry(100,.05,100),new THREE.MeshBasicMaterial());floor.position.y=-.025;root.add(floor);
 const dom=new Element('document'),window=new Element('window');dom.body=new Element('body');dom.createElement=tag=>new Element(tag);dom.defaultView=window;
 const cameraRig=new THREE.Group(),camera=new THREE.PerspectiveCamera(70,1,.05,100);camera.position.y=1.6;cameraRig.add(camera);scene.add(cameraRig);
 const ctx={scene,camera,cameraRig,document:dom,editor:{active:false},renderer:{xr:{getSession:()=>null,getCamera:()=>camera}},raycontrol:{states:{},addState(name,state){this.states[name]=state;},activateState(){},deactivateState(){},removeState(name){delete this.states[name];}}};
 const runtime=new Runtime(ctx,document);runtime.vehicleRuntime=new VehicleRuntime(runtime);scene.updateMatrixWorld(true);runtime.start('hall');
 const record=runtime.records.get(truck.userData.editorId),v=record.components.vehicle,product=runtime.products.get(pallet),api=runtime.vehicleRuntime,dock=api.pickupDock(record,{targetId:pallet.userData.editorId},product);
 assert(dock);truck.position.copy(dock.position);truck.rotation.y=dock.yaw;scene.updateMatrixWorld(true);api.applyPose(record,{...v.pose,lift:dock.toolY-v.originWorld.y-v.config.forkBaseHeight},false);
 const driving=new Driving(ctx,runtime,{document:dom,window});assert(driving.mount(record.id));const guide=driving.holographicGuide,monitor=driving.docking;
 const refresh=()=>{monitor.forceLayout=true;monitor.facilityLayout.liveAt=-Infinity;monitor.update(true);return monitor.facilityLayout.model;};
 try{
  guide.setEnabled(false);let model=refresh();assert(model.mission&&model.mission.phase==='pickup','The real monitor retains a pickup target when only the hologram is hidden.');assert(!guide.root.visible);
  assert(api.pickup(record),JSON.stringify(api.getDockingState(record)));const held=v.entry;
  // Entry changes bypass the 5Hz cache even while the spatial layer is OFF.
  guide.update();assert.equal(guide.getState().phase,'drop');assert.equal(v.entry,held);assert.equal(held.product,product);
  const target='drop:'+stock.userData.editorId;assert(guide.setTarget(target));model=refresh();
  assert(model.mission&&model.mission.manual&&model.mission.phase==='drop','A carried pallet keeps its selected real receiver in the monitor.');
  assert(model.mission.destination&&model.mission.target);assert.equal(model.mission.verified,false);assert.equal(model.mission.route.length,0);assert.equal(model.mission.plannedRoute.length,0,'Free play must never turn a local bearing into an invented route.');
  assert.match(monitor.summary.textContent,/Llevar a:/);assert.match(monitor.summary.textContent,/sin itinerario validado/);assert.equal(monitor.targetSelect.value,target);
  const before=operatingState(runtime,record,product),saved=await document.serialize(),updates=guide.stats.updates,allocations=guide.stats.allocations;
  for(let frame=0;frame<40;frame++)guide.update();assert.equal(guide.stats.updates,updates,'Hidden logical navigation retains the bounded 5Hz cache.');
  for(let query=0;query<8;query++){guide.update(true);refresh();}
  assert.deepEqual(operatingState(runtime,record,product),before);assert.deepEqual(await document.serialize(),saved);assert.equal(guide.stats.allocations,allocations);assert.equal(guide.root.visible,false);
  // An adapter first mounted with the spatial layer OFF still supplies logical
  // navigation, and creates no Three.js helper resources until requested.
  const cold=new Guide(driving);cold.setEnabled(false);cold.mount(record);
  assert.equal(cold.getState().phase,'drop');assert(cold.getState().targets.some(t=>t.id===target));assert.equal(cold.root,null);assert.equal(cold.stats.allocations,0);
  cold.setEnabled(true);assert(cold.root&&cold.root.visible);assert.equal(cold.stats.allocations,1);cold.setEnabled(false);assert.equal(cold.root.visible,false);cold.dispose();
  // Current receiver availability is recomputed while OFF, not frozen in an
  // old green target. This is a declared stock fixture, never a guide mutation.
  const receiver=runtime.records.get(stock.userData.editorId).components.palletQueue;
  receiver.queue.push({id:'occupied-1'},{id:'occupied-2'});guide.update(true);model=refresh();
  assert.equal(guide.getTargets().find(t=>t.id===target).allowed,false);assert(model.mission&&model.mission.unavailable);assert.equal(model.mission.verified,false);assert.equal(model.mission.route.length,0);assert.equal(v.entry,held);
 }finally{driving.dispose();runtime.stop();}
}

function authoredRoute(){
 const f=fixture(),product=f.runtime.products.get(f.pallet);product.object.position.set(8,0,10);f.scene.updateMatrixWorld(true);f.ctx.collisionWorld.invalidate(product.object);
 const lesson={taskId:'off-route',title:'Pallet exacto',phase:'pickup',productId:product.record.id,sourceId:product.record.id,route:[{x:0,z:8},{x:8,z:8}],waypointIndex:0,routeComplete:false,completed:0,total:1};
 f.runtime.vehicleTraining={guidance:()=>lesson,validatePickup:()=>'',validateDrop:()=>''};
 const driving={ctx:f.ctx,simulation:f.runtime,id:f.record.id,record:()=>f.record,blocked:()=>false,document:null},guide=new Guide(driving);driving.holographicGuide=guide;guide.setEnabled(false);guide.mount();
 let time=0;const map=new Facility(driving,{now:()=>time}),state=operatingState(f.runtime,f.record,product),read=()=>{time+=250;return map.update(f.record);};
 try{
  assert.equal(guide.stats.allocations,0);assert(guide.route.clear);assert.equal(guide.getState().phase,'pickup');
  let model=read();assert(model.mission.verified);assert.deepEqual(model.mission.route,[[0,0],[0,8],[8,8]],'The hidden spatial helper retains the collision-verified authored corner.');
  const wall=new THREE.Mesh(new THREE.BoxBufferGeometry(6,2.5,.015),new THREE.MeshBasicMaterial());wall.position.set(0,1.25,4);f.root.add(wall);f.scene.updateMatrixWorld(true);f.ctx.collisionWorld.invalidate(wall);
  guide.update(true);model=read();assert(guide.route.blocked&&!guide.route.clear);assert(model.mission.verified&&model.mission.blocked);assert.equal(model.mission.route.length,1,'A newly blocked path cannot keep stale safe arrows beyond the obstacle.');assert(model.mission.stop);assert.equal(guide.stats.allocations,0);
  f.root.remove(wall);f.ctx.collisionWorld.invalidate(wall);const world=f.ctx.collisionWorld;f.ctx.collisionWorld=null;guide.update(true);model=read();assert.equal(model.mission.verified,false,'No physical checker means no verified route even with the hologram hidden.');assert.equal(guide.getState().routePath.points.length,0);f.ctx.collisionWorld=world;
  assert.deepEqual(operatingState(f.runtime,f.record,product),state,'Hidden route inspection never changes custody, pose, progress, configuration or simulation time.');
 }finally{map.dispose();guide.dispose();f.runtime.vehicleTraining=null;f.runtime.stop();}
}

async function run(){await freePlay();authoredRoute();console.log('Hidden hologram navigation: real carried-pallet target/monitor retained, no invented free-play path, immediate custody phase change, current receiver availability, bounded logical cache/cold allocations and collision-validated authored route preserved without machine writes passed.');}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
