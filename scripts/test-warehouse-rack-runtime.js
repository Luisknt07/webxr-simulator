'use strict';
const assert=require('node:assert/strict'),h=require('./test-processor-runtime'),stock=require('./test-pallet-queue-runtime');
const {THREE,behaviorSchema:schema,setup,add,record,inventory,advance}=h,racks=schema.warehouseRacks;
function fixture(system='selective',values={},load={},options={}) {
  const f=(options.setup||setup)(),definition=racks.definition(system),pallet=definition.acceptedLoad==='pallet'||definition.acceptedLoad==='long';
  f.source=add(f,'source',Object.assign({initialCount:4,autoGenerate:false,generationMode:'sequence',delivery:'manual',loadMode:pallet?'pallet':'individual',palletType:'euro-1200x800',palletColumns:2,palletRows:2,palletLayers:1,
    catalog:JSON.stringify([{id:'rack-test',name:'Carga de prueba',type:'box',variant:'box-small',width:.3,depth:.3,height:.2,mass:2,base:'flat',quality:'good',defect:'none',color:'#b98d53'}])},load),[-14,1,0]);
  f.rack=stock.addQueue(f,Object.assign({},racks.defaults(system),{delivery:'manual',withPanel:false,rackBays:1,rackColumns:1,rackLevels:1},values),[0,1,0]);
  if(options.beforeStart)options.beforeStart(f);
  f.runtime.start('hall');f.rackRecord=record(f,f.rack);f.stock=f.rackRecord.components.palletQueue;f.sourceRecord=record(f,f.source);return f;
}
function offer(f,manual=true,placement) {
  const entry=inventory(f,f.source).queue[0];if(!entry)return null;const product=f.runtime.sourceRuntime.materialize(f.sourceRecord),target=placement||f.runtime.palletQueueRuntime.placement(f.rackRecord,product);
  if(!target)return null;
  assert(f.runtime.sourceRuntime.remove(f.sourceRecord,entry,'prueba'));
  assert(f.runtime.palletQueueRuntime.receive(f.rackRecord,entry,manual,target),'Rack must accept its validated physical seat.');
  f.runtime.sourceRuntime.materialize(f.sourceRecord);return entry;
}
function settle(f,seconds=30) {advance(f,seconds);return f;}
function cell(f,product){return f.stock.rack.layout.cells[product.item.palletIndex];}
function physicalForklift(){
  const VehicleRuntime=require('./load-vehicle-runtime')(THREE);
  const fs=require('node:fs'),path=require('node:path'),code=fs.readFileSync(path.join(__dirname,'test-conveyor-mechanisms.js'),'utf8'),real=new Function('require','__dirname',code.slice(0,code.indexOf('async function run()'))+'\nreturn {setup};')(require,__dirname);
  const f=fixture('selective',{rackBaseHeight:.25},{initialCount:1},{setup:real.setup,beforeStart(f){const o=f.document.addPrefab('hall','vehicle','forklift-electric-3w'),base=f.document.getBehaviors(o).find(c=>c.type==='vehicle');f.document.setBehaviors(o,[Object.assign({},base,{mode:'manual',running:true,powered:true,parkingBrake:true,forkSpread:.312,sourceId:f.rack.userData.editorId,outputId:f.rack.userData.editorId})]);f.document.setTransform(o,{position:[0,0,4],rotation:[0,Math.PI,0]});f.vehicle=o;f.runtime.vehicleRuntime=new VehicleRuntime(f.runtime);}});
  const entry=offer(f),product=entry.product,mesh=product.object,api=f.runtime.vehicleRuntime,vr=record(f,f.vehicle),v=vr.components.vehicle;
  const tick=input=>{api.setInput(vr,input);f.scene.updateMatrixWorld(true);f.runtime.execute(1/60);},until=(condition,input,seconds=40)=>{for(let i=0;i<seconds*60&&!condition();i++)tick(input);assert(condition(),'Physical rack docking timeout: '+JSON.stringify({position:vr.object.position.toArray(),warning:v.warning,blocked:v.blocked,plan:api.getDockingState(vr)}));};
  const dock=api.pickupDock(vr,{yaw:Math.PI,targetId:f.rack.userData.editorId},product);assert(dock);assert(api.applyPose(vr,Object.assign({},v.pose,{lift:dock.toolY-v.config.forkBaseHeight}),true));api.command(vr,'parkingBrake',false);
  const forward=new THREE.Vector3(0,0,-1);until(()=>dock.position.clone().sub(vr.object.position).dot(forward)<.012,{throttle:.1});for(let i=0;i<90;i++)tick({brake:1});
  assert(api.getDockingState(vr).ready,api.getDockingState(vr).reason);assert(api.pickup(vr,product),v.warning);assert.equal(v.entry,entry);assert.equal(f.stock.queue.length,0);assert.equal(product.object,mesh);
  for(let i=0;i<30;i++)tick({brake:1,lift:1});const withdrawn=vr.object.position.clone();until(()=>vr.object.position.distanceTo(withdrawn)>1.1,{throttle:-.12});for(let i=0;i<90;i++)tick({brake:1});
  const destination=api.missionDestination(vr,{targetId:f.rack.userData.editorId}),drop=api.dropDock(vr,{},destination);assert(destination);
  until(()=>drop.position.clone().sub(vr.object.position).dot(forward)<.006,{throttle:.06});for(let i=0;i<90;i++)tick({brake:1});
  until(()=>api.releasePlan(vr).ready,{brake:1,lift:-1},20);assert.equal(api.releasePlan(vr).kind,'stock');assert(api.release(vr),v.warning);assert.equal(f.stock.queue[0],entry);assert.equal(entry.product.object,mesh);assert.equal(entry.units,4);assert.equal(f.runtime.productMetadata(product).mass,33);f.runtime.stop();
  console.log('Physical warehouse forklift: real rack beams, both pallet pockets, driven approach/withdrawal/return, same 4-unit/33kg entry and mesh deposited back into rack.');
}
async function run(){
  for(const definition of racks.SYSTEMS){const f=fixture(definition.id),before=await f.document.serialize(),entry=offer(f);assert(entry,definition.id+': default compatible load must fit a physical seat.');const object=entry.product.object;
    settle(f,20);assert.equal(entry.ownerId,f.rack.userData.editorId);assert.equal(entry.product.object,object);assert.equal(f.stock.receivedUnits,entry.units);assert(!f.stock.rack.blocked,definition.id+': '+f.stock.rack.status);
    assert(!f.stock.rack.jobs.length,definition.id+': mechanism should settle.');
    if(['vertical-lift','miniload'].includes(definition.id)){assert(!f.runtime.palletQueueRuntime.canPickup(entry.product));assert(f.runtime.command(f.rack.userData.editorId,'requestRetrieval',entry.product.item.palletIndex));settle(f,30);assert(f.runtime.palletQueueRuntime.canPickup(entry.product),definition.id+': window must present the same load.');}
    const units=entry.units,mass=f.runtime.productMetadata(entry.product).mass;assert.equal(f.stock.queue[0],entry);assert.equal(entry.units,units);assert.equal(f.runtime.productMetadata(entry.product).mass,mass);f.runtime.stop();assert.deepEqual(await f.document.serialize(),before);console.log('Rack runtime '+definition.id+': same entry/mesh, physical seat, bounded mechanism and exact stop restoration.');
  }
  const double=fixture('double-deep');const rear=offer(double),front=offer(double);assert(rear&&front);assert.equal(cell(double,rear.product).depthIndex,1);assert.equal(cell(double,front.product).depthIndex,0);assert(!double.runtime.palletQueueRuntime.canPickup(rear.product));assert(double.runtime.palletQueueRuntime.canPickup(front.product));double.runtime.stop();
  const overload=fixture('selective',{rackMaxLoadKg:10});assert.equal(offer(overload),null);assert.equal(overload.stock.received,0);overload.runtime.stop();
  const level=fixture('selective',{rackColumns:2,rackLevelLoadKg:40});assert(offer(level));assert.equal(offer(level),null,'Two individually valid loads must still respect the shared bay/level rating.');assert.equal(level.stock.queue.length,1);level.runtime.stop();
  const tall=fixture('selective',{rackLevelHeight:.4});assert.equal(offer(tall),null,'A complete pallet must fit the actual vertical clearance.');tall.runtime.stop();
  const shelf=fixture('light-duty',{}, {loadMode:'pallet'});assert.equal(offer(shelf),null,'A manual shelf cannot silently accept a complete pallet.');shelf.runtime.stop();
  const terminal=fixture('selective',{autoRelease:true});const retained=offer(terminal),live=terminal.runtime.sourceRuntime.liveLoads();assert.equal(terminal.stock.config.autoRelease,false);assert.equal(terminal.runtime.palletQueueRuntime.releasePallet(terminal.rackRecord,0),false);settle(terminal,5);assert.equal(terminal.stock.queue[0],retained);assert.equal(terminal.runtime.sourceRuntime.liveLoads(),live,'A rack dispatch cannot retire a physical pallet as terminal accounting.');terminal.runtime.stop();
  physicalForklift();
  console.log('Warehouse rack runtime: all systems, same physical custody, accessible LIFO, mass and load-kind rejection passed.');
}
module.exports={fixture,offer,settle,cell,physicalForklift,THREE,schema,h,stock};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
