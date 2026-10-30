'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const h=require('./test-vehicle-runtime.js'),{THREE,fixture,step}=h;
const DIR=path.resolve(__dirname,'../../modules/logistica-industrial/functions/montacargas/runtime');
const read=name=>fs.readFileSync(path.join(DIR,name),'utf8').replace(/^import .*;\r?\n/gm,'');
const names=['buildGuidanceTargets','guidanceTargetReady','guidanceForkBox','guidanceApproach','guidanceVisible','guidanceTraining','guidanceRoute','GUIDANCE_LIMIT','GUIDANCE_ROUTE_ARROWS'];
const planner=new Function('THREE',read('VehicleGuidancePlanner.js').replace(/^export /gm,'')+';return {'+names.join(',')+'};')(THREE);
const Guide=new Function('THREE',...names,read('VehicleHolographicGuide.js').replace('export default class VehicleHolographicGuide','return class VehicleHolographicGuide'))(THREE,...names.map(name=>planner[name]));
function driving(f){return {ctx:f.ctx,simulation:f.runtime,id:f.record.id,record:()=>f.record,blocked:()=>false,document:null};}
function custody(f,product){return {pose:JSON.stringify(f.v.pose),entry:f.v.entry,parent:product.object.parent,world:product.object.matrixWorld.toArray(),population:f.runtime.products.size,entries:f.runtime.sourceRuntime.entries.size,counts:[f.v.received,f.v.delivered,f.v.receivedUnits,f.v.deliveredUnits],owner:product.vehicleOwnerId,reserved:product.vehicleReservedBy,warning:f.v.warning};}

const f=fixture(),product=f.runtime.products.get(f.pallet),operator=driving(f);f.ctx.camera=new THREE.PerspectiveCamera();f.ctx.camera.position.set(3,2,8);f.ctx.camera.updateMatrixWorld(true);
const camera=f.ctx.camera.matrixWorld.toArray(),snapshot=f.api.getDockingState(f.record),before=custody(f,product),guide=new Guide(operator);
guide.mount();assert.equal(guide.getState().phase,'pickup');assert.equal(guide.getTargets().length,1);assert(guide.getTargets()[0].allowed);assert(guide.getState().ready,snapshot.reason);
assert.equal(guide.getState().routeVerified,false);assert(/no es una ruta/i.test(guide.getState().routeNote));
for(let query=0;query<12;query++)guide.update(true,snapshot);
assert.deepEqual(custody(f,product),before,'Guidance planning leaves pose, parent, counters, reservation and custody unchanged.');assert.deepEqual(f.ctx.camera.matrixWorld.toArray(),camera,'Tracked/main camera is never overwritten.');
assert.equal(guide.stats.allocations,1);assert(guide.stats.targets<=8);assert(guide.stats.geometries<=4);assert(guide.stats.materials<=9);
guide.root.traverse(node=>{assert(node.userData.editorRuntimeHelper);assert.equal(node.raycast(),undefined);});
const updates=guide.stats.updates;for(let i=0;i<200;i++)guide.update();assert.equal(guide.stats.updates,updates,'Frame calls share the bounded 5Hz planning cache.');
const originalMass=f.v.config.payloadKg;f.v.config.payloadKg=1;guide.update(true,snapshot);assert(!guide.getTargets()[0].allowed);assert(!guide.getState().ready);assert.equal(guide.getState().severity,'blocked');f.v.config.payloadKg=originalMass;
product.robotReservedBy='robot-other';guide.update(true,snapshot);assert(!guide.getTargets()[0].allowed);assert(/robot/.test(guide.getTargets()[0].reason));delete product.robotReservedBy;
guide.update(true,snapshot);assert(guide.getTargets()[0].allowed);assert.equal(guide.setTarget('unknown-private-target'),false);assert(guide.setTarget(''));assert(guide.nextTarget());
const realEntry=f.v.entry;assert(f.api.pickup(f.record),f.v.warning);assert.equal(realEntry,null);const retained=f.v.entry;
guide.update(true,f.api.getDockingState(f.record));assert.equal(guide.getState().phase,'drop','A loose pallet on open floor does not force a reverse manoeuvre before transport.');assert(!guide.getState().ready);assert.equal(f.v.entry,retained);
step(f,2,{throttle:-.4});step(f,1,{brake:1});guide.update(true,f.api.getDockingState(f.record));assert.equal(guide.getState().phase,'drop');assert.equal(guide.getTargets().length,0,'A physically supportable floor is not invented as an authorized destination.');
step(f,1,{lift:-1});assert(f.api.release(f.record),f.v.warning);guide.update(true,f.api.getDockingState(f.record));assert.equal(guide.getState().phase,'withdraw');assert(!guide.getState().ready);assert.equal(guide.getTargets().length,0,'Do not offer to pick the same just-deposited pallet while the forks remain inserted.');
step(f,4,{throttle:-.4});step(f,1,{brake:1});guide.update(true,f.api.getDockingState(f.record));assert.equal(guide.getState().phase,'pickup');assert.equal(product.sourceEntry,retained);assert.equal(f.runtime.products.size,before.population);
guide.setEnabled(false);assert.equal(guide.root.visible,false);guide.setEnabled(true);assert.equal(guide.root.visible,true);
operator.blocked=()=>true;guide.update(true);assert.equal(guide.root.visible,false);operator.blocked=()=>false;
const resources=[...guide.geometries,...guide.materials],released=new Set();resources.forEach(resource=>resource.addEventListener('dispose',()=>released.add(resource)));
guide.unmount();assert.equal(released.size,resources.length);assert.equal(guide.root,null);assert.equal(guide.getTargets().length,0);guide.mount();assert.equal(guide.stats.allocations,2);guide.dispose();f.runtime.stop();

// A same-phase monitor result from before a manoeuvre must never overwrite
// newer physical alignment. Both ready->not-ready and its inverse matter.
const moving=fixture(),movingDrive=driving(moving),movingGuide=new Guide(movingDrive),initialPosition=moving.record.object.position.clone();movingGuide.mount();
const aligned=moving.api.getDockingState(moving.record);assert(aligned.ready);movingDrive.docking={snapshot:aligned};
moving.record.object.position.x+=.5;moving.record.object.updateMatrixWorld(true);
const misaligned=moving.api.getDockingState(moving.record);assert(!misaligned.ready);assert.equal(misaligned.phase,aligned.phase);
movingGuide.lastUpdate=-Infinity;movingGuide.update();assert.equal(movingGuide.getState().ready,misaligned.ready,'A cached ready monitor cannot hide movement out of alignment.');
movingDrive.docking.snapshot=misaligned;moving.record.object.position.copy(initialPosition);moving.record.object.updateMatrixWorld(true);
const realigned=moving.api.getDockingState(moving.record);assert(realigned.ready);movingGuide.lastUpdate=-Infinity;movingGuide.update();
assert.equal(movingGuide.getState().ready,realigned.ready,'A stale same-phase monitor cannot undo current physical readiness after realignment.');
const tickCount=movingGuide.stats.updates;for(let frame=0;frame<100;frame++)movingGuide.update();assert.equal(movingGuide.stats.updates,tickCount,'Fresh geometry is still read only at the bounded 5Hz planning rate.');
movingGuide.dispose();moving.runtime.stop();

// Real document and receiving runtime: far targets remain selectable, while a
// full stock or a product incompatible with a belt never becomes a green bay.
const {setup}=require('./test-vehicle-storage.js'),{Runtime}=require('./test-robot-runtime.js'),doc=setup(),root=doc.getRoot('hall'),scene=new THREE.Scene();scene.add(root);
const truck=doc.addPrefab('hall','vehicle','forklift-electric-4w'),pallet=doc.addPrefab('hall','product','pallet-loaded'),stock=doc.addPrefab('hall','palletQueue');
doc.setBehaviors(truck,doc.getBehaviors(truck).map(c=>c.type==='vehicle'?Object.assign({},c,{parkingBrake:false,outputId:stock.userData.editorId}):c));
doc.setBehaviors(stock,doc.getBehaviors(stock).map(c=>c.type==='palletQueue'?Object.assign({},c,{acceptsPallets:true,width:1.6,depth:1.4,palletCapacity:2,capacity:2,running:true}):c));
truck.position.set(0,0,0);stock.position.set(0,0,9);pallet.position.set(0,0,h.vehicles.getDimensions(doc.getBehaviors(truck).find(c=>c.type==='vehicle')).forkHeelZ+.48);scene.updateMatrixWorld(true);
const ctx={scene,editor:{active:false}},runtime=new Runtime(ctx,doc);runtime.vehicleRuntime=new h.VehicleRuntime(runtime);runtime.start('hall');scene.updateMatrixWorld(true);
const record=runtime.records.get(truck.userData.editorId),v=record.components.vehicle,load=runtime.products.get(pallet),dock=runtime.vehicleRuntime.pickupDock(record,{targetId:pallet.userData.editorId},load);assert(dock);truck.position.copy(dock.position);truck.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),dock.yaw);scene.updateMatrixWorld(true);runtime.vehicleRuntime.applyPose(record,Object.assign({},v.pose,{lift:dock.toolY-v.originWorld.y-v.config.forkBaseHeight}),false);assert(runtime.vehicleRuntime.pickup(record),v.warning);
const drive={ctx,simulation:runtime,id:record.id,record:()=>record,blocked:()=>false,document:null},g=new Guide(drive);g.mount();const targets=g.getTargets();assert(targets.some(target=>target.kind==='drop'&&target.allowed&&target.distanceM>5),'Compatible far receivers must be selectable before alignment.');
const id='drop:'+stock.userData.editorId;assert(g.setTarget(id));assert(!g.getState().ready,'A distant compatible bay is not ready for release.');
// Direction always follows the actual chassis +Z, regardless of where the
// tracked camera is looking. Positive bearings mean the operator's right.
const targetCenter=g.currentTarget.bounds.getCenter(new THREE.Vector3()).applyMatrix4(g.currentTarget.matrix),truckCenter=truck.getWorldPosition(new THREE.Vector3()),targetYaw=Math.atan2(targetCenter.x-truckCenter.x,targetCenter.z-truckCenter.z),savedQuaternion=truck.quaternion.clone(),yAxis=new THREE.Vector3(0,1,0),bearingEntry=v.entry;
for(const [yaw,expectedDeg,expectedText] of [[targetYaw,0,'Al frente'],[targetYaw+Math.PI/2,-90,'A tu izquierda'],[targetYaw-Math.PI/2,90,'A tu derecha'],[targetYaw+Math.PI,180,'Detrás del vehículo']]){
  truck.quaternion.setFromAxisAngle(yAxis,yaw);scene.updateMatrixWorld(true);g.update(true);
  assert(Math.abs(Math.abs(g.getState().bearingDeg)-Math.abs(expectedDeg))<1e-6,'Bearing uses world vehicle orientation and target center.');
  if(Math.abs(expectedDeg)===90)assert.equal(Math.sign(g.getState().bearingDeg),Math.sign(expectedDeg));
  assert.equal(g.getState().bearingText,expectedText);assert.equal(v.entry,bearingEntry);
}
truck.quaternion.copy(savedQuaternion);scene.updateMatrixWorld(true);g.update(true);
const receiver=runtime.records.get(stock.userData.editorId).components.palletQueue,queueBefore=receiver.queue.slice(),held=v.entry;
receiver.queue.push({id:'occupied-1'},{id:'occupied-2'});g.update(true);assert(!g.getTargets().find(target=>target.id===id).allowed);assert.equal(v.entry,held);assert.equal(load.vehicleOwnerId,record.id);assert.equal(receiver.queue.length,queueBefore.length+2);
receiver.queue.splice(queueBefore.length);g.update(true);assert(g.getTargets().find(target=>target.id===id).allowed);assert.equal(v.entry,held);
g.dispose();runtime.stop();

// The existing physical chain fixture supplies an actual occupied source,
// including two-pocket docking, its station ownership and a collision world.
const beltSource=fs.readFileSync(path.join(__dirname,'test-vehicle-belt-docking.js'),'utf8');
const b=new Function('require','__dirname',beltSource.slice(0,beltSource.indexOf('const ready='))+';return {scene,root,ctx,runtime,record,v,api,product,truck,receiver};')(require,__dirname);
const bg=new Guide({ctx:b.ctx,simulation:b.runtime,id:b.record.id,record:()=>b.record,blocked:()=>false,document:null});bg.mount();assert(bg.getState().ready,bg.getState().instruction);
const originMatrix=bg.currentTarget.matrix.clone();assert(b.api.pickup(b.record),b.v.warning);bg.update(true,b.api.getDockingState(b.record));
assert.equal(bg.getState().phase,'withdraw-source','A real chain station keeps its withdrawal guidance after pickup.');assert(bg.depart);assert(bg.depart.matrix.equals(originMatrix),'The withdrawal hologram remains at the actual origin rather than jumping to a delivery bay.');
assert(!bg.getState().ready);bg.dispose();b.runtime.stop();
console.log('Holographic guidance: real pickup/destination eligibility, far bay selection, full-stock rejection, source/drop withdrawal, unchanged cargo/camera, bounded cache/resources and complete cleanup passed.');
