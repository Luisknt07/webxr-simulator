'use strict';
// Actual warehouse lesson, prefabs, seeded custody and geometric collision
// world: a printed code must not become a wall in front of the rack beams.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixtureSource=fs.readFileSync(path.join(__dirname,'test-warehouse-mission-enhancement.js'),'utf8');
const {THREE,setup,addWarehouseMissionExperience,VehicleRuntime,Training}=new Function('require','__dirname',fixtureSource.slice(0,fixtureSource.indexOf('function dispose('))+'\nreturn {THREE,setup,addWarehouseMissionExperience,VehicleRuntime,Training};')(require,__dirname);
function fixture(taskIndex){
 const f=setup(),d=f.document,truck=d.addPrefab('hall','vehicle','forklift-electric-4w');
 d.setBehaviors(truck,d.getBehaviors(truck).map(config=>config.type==='vehicle'?Object.assign({},config,{mode:'manual',trainingTasksJson:'[]'}):config));
 const built=addWarehouseMissionExperience(d,'hall',{usableBounds:[-14.6,-14.6,14.6,14.6],floorY:0});
 f.runtime.vehicleRuntime=new VehicleRuntime(f.runtime);f.runtime.vehicleTraining=new Training(f.runtime);f.scene.updateMatrixWorld(true);f.runtime.start('hall');f.ctx.collisionWorld.setRoom('hall');
 const record=f.runtime.records.get(built.vehicleId),v=record.components.vehicle,api=f.runtime.vehicleRuntime,task=built.tasks[taskIndex],product=f.runtime.vehicleTraining.product(task.productId),source=f.runtime.records.get(task.sourceId);
 // Exercise physical clearance independently from the lesson route gate.
 f.runtime.vehicleTraining=null;v.parkingBrake=false;v.actualSpeed=0;
 const dock=api.pickupDock(record,{yaw:Math.PI,targetId:task.sourceId},product);assert(dock);
 truck.position.copy(dock.position);truck.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),dock.yaw);truck.updateWorldMatrix(true,true);
 assert(api.applyPose(record,Object.assign({},v.pose,{lift:dock.toolY-v.originWorld.y-v.config.forkBaseHeight}),false));f.scene.updateMatrixWorld(true);
 return Object.assign(f,{truck,record,v,api,task,product,source,dock});
}
for(const taskIndex of [0,2]){
 const f=fixture(taskIndex),world=f.ctx.collisionWorld,labels=[],structure=[];
 f.source.object.traverse(mesh=>{if(!mesh.isMesh)return;if(mesh.userData.warehouseRackLocationLabels)labels.push(mesh);else if(mesh.userData.warehouseRackStructure)structure.push(mesh);});
 assert(labels.length&&structure.length);assert(labels.every(mesh=>world.isSolid(mesh)===false&&world.physicalMesh(mesh)===false),'Location ink and plates remain visual/pickable but cannot block mast or forks.');
 assert(structure.every(mesh=>world.isSolid(mesh)),'Uprights, bracing and real support beams remain solid.');
 const mast=f.api.mechanismBoxes(f.record).mast;
 assert(labels.some(mesh=>mast.intersectsBox(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld))),'The real precision-dock mast crosses the merged label geometry bounds.');
 const entry=f.product.sourceEntry,units=entry.units,mass=f.runtime.productMetadata(f.product).mass,count=f.runtime.products.size;
 const plan=f.api.pickupPlan(f.record,f.product);assert(plan.ready,plan.reason);
 assert(f.api.pickup(f.record,f.product),f.v.warning);assert.equal(f.v.entry,entry);assert.equal(entry.product,f.product);
 assert(!f.source.components.palletQueue.queue.includes(entry));assert.equal(entry.units,units);assert.equal(f.runtime.productMetadata(f.product).mass,mass);assert.equal(f.runtime.products.size,count);
 assert.equal(f.api.rig(f.record).forks===f.product.object.parent,true,'The same seeded pallet is carried on the actual fork attachment.');
 f.runtime.stop();
}
const blocked=fixture(0);blocked.truck.position.z-=.25;blocked.truck.updateWorldMatrix(true,true);blocked.api.applyPose(blocked.record,blocked.v.pose,false);blocked.scene.updateMatrixWorld(true);
assert.equal(blocked.api.mechanismClear(blocked.record,null),false,'Advancing the mast into real rack structure is still rejected.');
assert.equal(blocked.api.pickup(blocked.record,blocked.product),false);assert.equal(blocked.v.entry,null);blocked.runtime.stop();
console.log('Warehouse rack labels: actual upper/lower lesson pickups clear printed identifiers; real structure collision, same pallet, identity, units and mass retained.');
