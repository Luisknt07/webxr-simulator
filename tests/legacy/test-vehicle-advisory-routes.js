'use strict';
// Public scene factories, actual generated pallet, stock receiver and swept
// collision world. Advisory inspection never executes waypoint actions.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const schema=require('../../modules/logistica-industrial/contracts/behaviors.js');
const {Document}=require('./test-vehicle-storage.js'),{Runtime}=require('./test-robot-runtime.js');
const VehicleRuntime=require('../support/load-vehicle-runtime.js')(THREE);
const ProductSourceRuntime=require('../support/load-product-source-runtime.js')(THREE,schema);
const {getGeometryTree}=require('../support/load-geometry-acceleration.js')(THREE);
const collisionSource=fs.readFileSync(path.resolve(__dirname,'../../packages/render-three/src/CollisionWorld.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class CollisionWorld','return class CollisionWorld');
const CollisionWorld=new Function('THREE','getGeometryTree',collisionSource)(THREE,getGeometryTree);
const {guidanceRoute,guidanceAdvisoryRoute,buildGuidanceTargets}=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleGuidancePlanner.js');
const {authorPublicAdvisoryRoute}=require('../../tooling/assets/generate-public-scenes.js');
const sourcePath=path.resolve(__dirname,'../../projects/smarttwin/scenes/vr-robot-dispatch.json');
const rounded=point=>[point.x,point.z].map(value=>Math.round(value*1000)/1000);

async function run(){
 const payload=JSON.parse(fs.readFileSync(sourcePath,'utf8')),authored=payload.project.document,rows=authored.rooms.hall.additions;
 const truckRow=rows.find(row=>row.behaviors.some(c=>c.type==='vehicle')),config=truckRow.behaviors.find(c=>c.type==='vehicle');
 const before=JSON.parse(JSON.stringify(authored));before.rooms.hall.additions.find(row=>row.id===truckRow.id).behaviors.find(c=>c.type==='vehicle').waypointsJson='[]';
 const untouched=JSON.parse(JSON.stringify(before)),authoredVehicle=authorPublicAdvisoryRoute(before,'hall');
 assert.deepEqual(before,authored,'The generator recreates exactly the checked-in advisory route.');
 untouched.rooms.hall.additions.find(row=>row.id===truckRow.id).behaviors.find(c=>c.type==='vehicle').waypointsJson=authoredVehicle.waypointsJson;
 assert.deepEqual(before,untouched,'The public recipe changes only vehicle waypoints, preserving robot, bands, inventories and metadata.');
 assert.equal(config.mode,'manual');assert.equal(config.trainingTasksJson||'[]','[]');
 assert.deepEqual(schema.vehicles.parseWaypoints(config).filter(p=>['pickup','drop'].includes(p.action)).map(p=>[p.action,p.targetId]),[['pickup',config.sourceId],['drop',config.outputId]]);
 const document=new Document({}),nativeRoot=new THREE.Group();nativeRoot.add(new THREE.Group());document.registerRoom('hall',nativeRoot);document.registerRoom('sound',new THREE.Group());await document.load(authored);const root=document.getRoot('hall'),scene=new THREE.Scene();scene.add(root);
 const ctx={scene,editor:{active:false},raycontrol:{states:{},addState(id,state){this.states[id]=state;},activateState(){},deactivateState(){}}};
 const runtime=new Runtime(ctx,document);runtime.sourceRuntime=new ProductSourceRuntime(runtime);runtime.vehicleRuntime=new VehicleRuntime(runtime);scene.updateMatrixWorld(true);runtime.start('hall');
 ctx.collisionWorld=new CollisionWorld(ctx,document);ctx.collisionWorld.setRoom('hall');
 const record=runtime.records.get(truckRow.id),v=record.components.vehicle,api=runtime.vehicleRuntime,driving={ctx,simulation:runtime};
 const snapshot=()=>({matrix:record.object.matrixWorld.toArray(),entry:v.entry,routeIndex:v.routeIndex,training:v.training,distance:v.distance,scoreEvents:runtime.events.filter(e=>/^warehouse-score/.test(e.type)).length,warning:v.warning,config:JSON.stringify(v.config),route:v.route.map(p=>({position:p.position.toArray(),action:p.action,targetId:p.targetId})),owners:[...runtime.products.values()].map(p=>[p.object.uuid,p.vehicleOwnerId,p.sourceEntry&&p.sourceEntry.ownerId])});
 try{
  assert(!v.training,'Dynamic robot/belt pallets must not be enrolled into startup-stock training.');
  const start=snapshot(),pickup=guidanceRoute(driving,record,null,{kind:'pickup',targetId:config.sourceId,allowed:true});
  assert(pickup&&pickup.advisory&&pickup.clear,JSON.stringify(pickup));assert.deepEqual(pickup.points.map(rounded),[[9.4,0],[8.4,0]]);assert(pickup.arrows.length>0);
  assert.deepEqual(snapshot(),start,'Inspecting the pickup corridor does not move, reserve, score or advance the vehicle.');
  assert.equal(guidanceAdvisoryRoute(driving,record,{kind:'pickup',targetId:'unrelated',allowed:true}),null);
  assert.equal(guidanceAdvisoryRoute(driving,record,{kind:'drop',targetId:config.outputId,allowed:true}),null);
  assert.equal(guidanceAdvisoryRoute(driving,record,{kind:'pickup',targetId:config.sourceId,allowed:false}),null);
  assert.equal(guidanceRoute(driving,record,null,null),null);
  v.config.mode='automatic';assert.equal(guidanceRoute(driving,record,null,{kind:'pickup',targetId:config.sourceId,allowed:true}),null);v.config.mode='manual';
  // Run the unchanged source/robot/bands until their real terminal belt stops.
  let product=null;
  for(let tick=0;tick<2400&&!product;tick++){
   scene.updateMatrixWorld(true);ctx.collisionWorld.beginFrame();runtime.execute(1/30);ctx.collisionWorld.endFrame();
   product=[...runtime.products.values()].find(p=>p.item&&p.item.beltId===config.sourceId&&Math.abs(runtime.records.get(config.sourceId).components.conveyor.actualSpeed)<.025&&!p.robotOwnerId&&!p.robotReservedBy);
  }
  assert(product,'The public robot and two bands deliver a real stopped pallet.');assert.equal(runtime.productMetadata(product).mass,33);
  const selected=buildGuidanceTargets(driving,record).find(t=>t.product===product);assert(selected&&selected.allowed,selected&&selected.reason);
  const dock=api.pickupDock(record,{targetId:config.sourceId,yaw:-Math.PI/2},product);assert(dock);
  record.object.position.copy(dock.position);record.object.rotation.y=dock.yaw;scene.updateMatrixWorld(true);
  api.applyPose(record,{...v.pose,lift:dock.toolY-v.originWorld.y-v.config.forkBaseHeight},false);v.parkingBrake=false;
  assert(api.pickup(record,product),JSON.stringify(api.getDockingState(record)));assert.equal(v.entry.product,product);
  // Fixture setup withdraws the actual held pallet into the authored corridor;
  // route inspection itself never supplies input, changes pose or transfers it.
  record.object.position.set(8.6,0,0);record.object.rotation.y=-Math.PI/2;scene.updateMatrixWorld(true);api.applyPose(record,{...v.pose,lift:.25},false);api.carry(record,false);scene.updateMatrixWorld(true);ctx.collisionWorld.invalidate(product.object);
  const receiver=buildGuidanceTargets(driving,record).find(t=>t.targetId===config.outputId);assert(receiver&&receiver.allowed,receiver&&receiver.reason);
  const held=snapshot(),savedBeforePlanning=await document.serialize(),drop=guidanceRoute(driving,record,null,receiver);assert(drop&&drop.advisory&&drop.clear,JSON.stringify(drop));assert(drop.arrows.length>0);
  assert.deepEqual(drop.points.map(rounded),[[8.6,0],[9.4,0],[9.4,1.5]],'The loaded route reverses into clear turning space before approaching the receiver.');
  for(let query=0;query<20;query++)guidanceRoute(driving,record,null,receiver);
  assert.deepEqual(snapshot(),held,'The advisory path preserves load custody, score, pose, program and runtime indices.');
  assert.deepEqual(await document.serialize(),savedBeforePlanning,'Presentation leaves authoring data unchanged.');
  const obstacle=new THREE.Mesh(new THREE.BoxBufferGeometry(.1,2.5,2),new THREE.MeshBasicMaterial());obstacle.position.set(9.0,1.25,0);root.add(obstacle);scene.updateMatrixWorld(true);ctx.collisionWorld.invalidate(obstacle);
  const blocked=guidanceRoute(driving,record,null,receiver);assert(blocked.blocked&&!blocked.clear&&blocked.blockedAt);assert.equal(blocked.points.length,1,'No loaded route continues through an obstacle.');root.remove(obstacle);ctx.collisionWorld.invalidate(obstacle);
  const world=ctx.collisionWorld;ctx.collisionWorld=null;const unchecked=guidanceRoute(driving,record,null,receiver);assert(!unchecked.clear&&unchecked.points.length===0&&unchecked.arrows.length===0);ctx.collisionWorld=world;
  record.object.position.set(9.4,0,.7);record.object.rotation.y=0;scene.updateMatrixWorld(true);api.carry(record,false);const progressed=guidanceRoute(driving,record,null,receiver);
  assert(progressed.clear);assert.deepEqual(progressed.points.map(rounded),[[9.4,.7],[9.4,1.5]],'A later segment does not send a manual driver back through an already passed corner.');
  const stationary=record.object.position.clone(),received=v.received,delivered=v.delivered;for(let tick=0;tick<30;tick++)api.step(1/60);
  assert(record.object.position.equals(stationary),'Authored manual waypoints never engage autopilot.');assert.equal(v.received,received);assert.equal(v.delivered,delivered);assert(!v.training);assert.equal(runtime.events.filter(e=>/^warehouse-score/.test(e.type)).length,0);
 }finally{runtime.stop();}
 console.log('Public advisory route: unchanged robot/two-band transfer, real33kg pallet pickup, clear loaded chassis/fork/payload sweeps and turn, exact selected-leg matching, read-only projection, obstacle/no-checker clipping and no autopilot/custody/score writes passed.');
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
