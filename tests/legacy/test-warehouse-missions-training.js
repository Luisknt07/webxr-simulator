'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/functions/montacargas/schema/vehicle-training.js');
const source = fs.readFileSync(path.resolve(__dirname, '../../modules/logistica-industrial/functions/montacargas/runtime/VehicleTrainingRuntime.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class', 'return class');
const Training = new Function('THREE', 'trainingSchema', source)(THREE, schema);
function fixture() {
  const root = new THREE.Group(), object = new THREE.Group(), forks = new THREE.Group(), load = new THREE.Group(); root.add(object, load); object.add(forks);
  const task = {id:'task-1',name:'Move exact pallet',productId:'PALLET-01',sourceId:'rack-1',sourceLocationCode:'A01-R01-N02-P01',destinationId:'rack-2',locationCode:'A02-R01-N01-P01',pickupRoute:[{x:0,z:1}],route:[{x:0,z:2}]};
  const record = {id:'truck',object,components:{vehicle:{distance:0,config:{trainingTasksJson:JSON.stringify([task]),speed:1.35,reverseSpeed:.85,forkSpread:.48,forkWidth:.1,forkLength:1.1,forkThickness:.04},training:{index:0,completed:[]}}}};
  const product = {id:'PALLET-01',object:load,bounds:new THREE.Box3(new THREE.Vector3(-.6,0,-.4),new THREE.Vector3(.6,.4,.4)),item:{palletOwnerId:task.sourceId},sourceEntry:{ownerId:task.sourceId}};
  load.userData.sourceRackLocationCode=task.sourceLocationCode;
  const events=[], runtime={roomId:'hall',document:{getRoot:()=>root},records:new Map([[record.id,record]]),products:new Map([[load,product]]),palletQueueRuntime:{palletIdentity:p=>p.id},vehicleRuntime:{rig:()=>({forks})},event:(id,type,message)=>events.push({id,type,message})};
  const api=new Training(runtime); api.beginRoute(record,'pickup');
  const move=(z,odometer=true)=>{const from=object.position.z;object.position.z=z;if(odometer)record.components.vehicle.distance+=Math.abs(z-from);root.updateMatrixWorld(true);api.step(1/60);};
  const drive=z=>{while(Math.abs(z-object.position.z)>.00001)move(object.position.z+Math.sign(z-object.position.z)*Math.min(.01,Math.abs(z-object.position.z)));};
  return {root,record,product,task,api,events,move,drive};
}
function run(){
  for(const row of [{id:'bad',name:'x',productId:'p',sourceId:'s',destinationId:'d',route:[{x:Infinity,z:0}]},{id:'bad',name:'x',productId:'p',sourceId:'s',destinationId:'d',destinationSlot:-1}])assert.throws(()=>schema.parse(JSON.stringify([row])));
  const f=fixture(),{record:r,product:p,api:a,task:t}=f;
  assert(a.validatePickup(r,p),'Approach route is mandatory.');
  f.drive(1);assert.equal(a.guidance(r).routeComplete,true);
  assert(a.validatePickup(r,{...p,id:'PALLET-OTHER'}),'Another pallet cannot satisfy the task.');
  const owner=p.sourceEntry.ownerId;p.sourceEntry.ownerId='wrong-rack';assert(a.validatePickup(r,p));p.sourceEntry.ownerId=owner;
  p.object.userData.sourceRackLocationCode='wrong-slot';assert(a.validatePickup(r,p));p.object.userData.sourceRackLocationCode=t.sourceLocationCode;
  assert.equal(a.validatePickup(r,p),'');r.components.vehicle.entry={product:p};a.onPickup(r,p);
  const destination={kind:'stock',targetId:t.destinationId,placement:{locationCode:t.locationCode,palletIndex:0}};
  assert(a.validateDrop(r,destination),'Delivery route is mandatory.');
  assert(a.validateDrop(r,{...destination,targetId:'wrong-rack'}));assert(a.validateDrop(r,{...destination,placement:{locationCode:'wrong-slot',palletIndex:0}}));
  f.move(2);assert.equal(a.guidance(r).routeComplete,false,'Teleport to the next waypoint must not receive route credit.');assert(r.components.vehicle.training.routeFault);
  f.move(1);assert(!r.components.vehicle.training.routeFault);f.drive(2);assert.equal(a.validateDrop(r,destination),'');
  p.sourceEntry.ownerId=t.destinationId;p.item.palletOwnerId=t.destinationId;p.object.userData.sourceRackLocationCode=t.locationCode;p.object.position.set(0,0,2);r.components.vehicle.entry=null;f.root.updateMatrixWorld(true);a.onDrop(r,p,destination);
  assert.equal(a.guidance(r).phase,'withdraw');a.step(1/60);assert.equal(a.guidance(r).completed,0,'Deposit alone cannot count while tines remain in the pallet.');
  f.drive(.3);assert.equal(a.guidance(r).phase,'complete');assert.equal(a.guidance(r).completed,1);assert.equal(f.events.filter(e=>e.type==='warehouse-task-completed').length,1);a.step(1/60);assert.equal(f.events.filter(e=>e.type==='warehouse-task-completed').length,1,'Completed tasks do not emit twice.');
  const saved=JSON.parse(JSON.stringify(r.components.vehicle.training));r.components.vehicle.training=saved;assert(a.validateState(r),'Checkpoint-safe plain state validates after JSON roundtrip.');saved.completed[0]='forged';assert.equal(a.validateState(r),false);
  saved.completed[0]=t.id;const finalPhase=saved.phase,awards=f.events.length;a.onPickup(r,p);a.onDrop(r,p,destination);assert.equal(saved.phase,finalPhase);assert.equal(f.events.length,awards,'Replaying old custody hooks cannot award or restart a completed task.');
  const malformed=fixture();malformed.record.components.vehicle.training.waypointIndex=2;assert.equal(malformed.api.validateState(malformed.record),false,'A restored checkpoint cannot claim points beyond the actual route length.');
  const odometer=fixture();odometer.move(.75,false);assert.equal(odometer.api.guidance(odometer.record).routeComplete,false,'Moving a transform without driven distance must not complete an approach.');
  const wrongSlot=fixture();wrongSlot.drive(1);wrongSlot.record.components.vehicle.entry={product:wrongSlot.product};wrongSlot.api.onPickup(wrongSlot.record,wrongSlot.product);wrongSlot.drive(2);wrongSlot.product.sourceEntry.ownerId=wrongSlot.task.destinationId;wrongSlot.product.item.palletOwnerId=wrongSlot.task.destinationId;wrongSlot.product.object.userData.sourceRackLocationCode='wrong-slot';wrongSlot.api.onDrop(wrongSlot.record,wrongSlot.product,{kind:'stock',targetId:wrongSlot.task.destinationId,placement:{locationCode:'wrong-slot'}});assert.equal(wrongSlot.api.guidance(wrongSlot.record).phase,'drop');assert.equal(wrongSlot.events.filter(e=>e.type==='warehouse-task-completed').length,0);
  const replay=fixture();replay.drive(1);replay.record.components.vehicle.entry={product:replay.product};replay.api.onPickup(replay.record);replay.drive(2);const routeIndex=replay.record.components.vehicle.training.waypointIndex,picked=replay.events.length;replay.api.onPickup(replay.record);assert.equal(replay.record.components.vehicle.training.waypointIndex,routeIndex);assert.equal(replay.events.length,picked,'A duplicate pickup hook cannot erase route progress or add an event.');replay.api.onDrop(replay.record,replay.product,destination);assert.equal(replay.api.guidance(replay.record).phase,'drop','A receiver hook while the truck still owns the pallet cannot advance its task.');
  const floor=fixture();floor.drive(1);floor.record.components.vehicle.entry={product:floor.product};floor.api.onPickup(floor.record);floor.drive(2);const program=JSON.parse(floor.record.components.vehicle.config.trainingTasksJson);delete program[0].locationCode;program[0].destinationSlot=1;floor.record.components.vehicle.config.trainingTasksJson=JSON.stringify(program);const bays=[new THREE.Group(),new THREE.Group()];bays[1].position.set(4,0,3);floor.root.add(...bays);floor.root.updateMatrixWorld(true);floor.api.runtime.records.set(floor.task.destinationId,{id:floor.task.destinationId,components:{palletQueue:{pallets:bays.map(object=>({object}))}}});floor.api.runtime.palletQueueRuntime.operational=()=>true;let requested;floor.api.runtime.palletQueueRuntime.placement=(record,product,ignore,preferred)=>{requested=preferred.clone();return {palletIndex:1,matrix:new THREE.Matrix4().makeTranslation(preferred.x,preferred.y,preferred.z)};};const exactFloor=floor.api.destination(floor.record);assert.deepEqual(requested.toArray(),[4,0,3],'Nonzero floor-bay index must select its own world position.');assert.equal(exactFloor.placement.palletIndex,1);assert.equal(floor.api.validateDrop(floor.record,exactFloor),'');assert(floor.api.validateDrop(floor.record,{...exactFloor,placement:{...exactFloor.placement,palletIndex:0}}),'Another floor bay must not satisfy an exact nonzero destination slot.');
  console.log('Warehouse missions: strict schema, exact identity/custody/slot, driven route and teleport rejection, withdrawal-only completion, no duplicate awards and checkpoint state passed.');
}
module.exports={run};if(require.main===module)run();
