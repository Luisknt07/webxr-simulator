'use strict';
// Regression for the near-aligned rack placement reported from mission 2.
// Reuse the real prefab/document/fork custody fixture; no mocked fit geometry.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixtureSource=fs.readFileSync(path.join(__dirname,'test-vehicle-drop-placement.js'),'utf8');
const {THREE,fixture,custody,dockAt,close}=new Function('require','__dirname',fixtureSource.slice(0,fixtureSource.indexOf('const bay=fixture()'))+'\nreturn {THREE,fixture,custody,dockAt,close};')(require,__dirname);
const collisionSource=fs.readFileSync(path.resolve(__dirname,'../../packages/render-three/src/CollisionWorld.js'),'utf8').replace(/^import .*;\r?\n/gm,'');
const CollisionWorld=new Function('THREE','getGeometryTree',collisionSource.replace('export default class CollisionWorld','return class CollisionWorld'))(THREE,require('../support/load-geometry-acceleration.js')(THREE).getGeometryTree);
const UP=new THREE.Vector3(0,1,0);
function loadedRack(){
 const f=fixture(true);f.v.config.mode='manual';
 const targets=f.guide.getTargets().filter(target=>target.allowed),upper=targets.find(target=>f.guide.targets.find(raw=>raw.id===target.id).matrix.elements[13]>1.5);
 assert(upper,'A real upper rack cell is available.');assert(f.guide.setTarget(upper.id));dockAt(f,f.guide.currentTarget);
 const floor=new THREE.Mesh(new THREE.BoxBufferGeometry(100,.05,100),new THREE.MeshBasicMaterial());floor.position.y=-.025;f.root.add(floor);
 f.ctx.collisionWorld=new CollisionWorld(f.ctx,f.document);f.ctx.collisionWorld.setRoom('hall');
 return f;
}
function offset(f,lateral,depth,height,yaw=0){
 const matrix=f.guide.currentTarget.matrix,wanted=new THREE.Vector3().setFromMatrixPosition(matrix)
  .addScaledVector(new THREE.Vector3(1,0,0).transformDirection(matrix),lateral)
  .addScaledVector(new THREE.Vector3(0,0,1).transformDirection(matrix),depth);wanted.y+=height;
 f.truck.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(UP,yaw));f.scene.updateMatrixWorld(true);f.api.carry(f.record,false);
 const delta=wanted.sub(f.product.object.getWorldPosition(new THREE.Vector3()));f.truck.position.x+=delta.x;f.truck.position.z+=delta.z;f.scene.updateMatrixWorld(true);
 assert(f.api.applyPose(f.record,Object.assign({},f.v.pose,{lift:f.v.pose.lift+delta.y}),false));f.scene.updateMatrixWorld(true);
 return f.api.releasePlan(f.record,f.guide.currentTarget.destination);
}

const screenshot=loadedRack(),beforeOffset=screenshot.v.entry;
let plan=offset(screenshot,-.008,-.003,-.007,.1*Math.PI/180);
assert(plan.ready,JSON.stringify({reason:plan.reason,errors:plan.errors}));
assert.equal(plan.tolerances.positionM,.06,'Existing manual help already accepts practical clearance, without exact-coordinate docking.');
const before=custody(screenshot);
// The displayed route refusal used to run before these physical checks. It is
// not evidence that a well-seated pallet needs more positional precision.
screenshot.runtime.vehicleTraining={validateDrop:()=> 'Completa la ruta señalada antes de confirmar el depósito.'};
const gate=screenshot.api.releasePlan(screenshot.record,screenshot.guide.currentTarget.destination);
assert(!gate.ready&&gate.trainingRejected);assert.match(gate.reason,/ruta señalada/);
assert.deepEqual(custody(screenshot),before);delete screenshot.runtime.vehicleTraining;
for(let i=0;i<10;i++)assert(screenshot.api.releasePlan(screenshot.record,screenshot.guide.currentTarget.destination).ready);
assert.deepEqual(custody(screenshot),before,'Physical fit previews preserve held pallet, mass, transform and stock custody.');
const metadata=screenshot.runtime.productMetadata(screenshot.product),units=beforeOffset.units;
assert(screenshot.api.release(screenshot.record,screenshot.guide.currentTarget.destination),screenshot.v.warning);
assert.equal(screenshot.stock.queue[0],beforeOffset);assert.equal(beforeOffset.product,screenshot.product);
assert.equal(screenshot.product.item.palletIndex,screenshot.guide.currentTarget.slotIndex);
assert.equal(beforeOffset.units,units);assert.equal(screenshot.runtime.productMetadata(screenshot.product).mass,metadata.mass);
close(screenshot);

for(const [lateral,depth,height,yaw] of [[.035,.015,.02,2],[-.035,-.015,.015,-2]]){
 const f=loadedRack(),held=f.v.entry;plan=offset(f,lateral,depth,height,yaw*Math.PI/180);
 assert(plan.ready,JSON.stringify({offset:[lateral,depth,height,yaw],reason:plan.reason,errors:plan.errors}));
 assert(plan.assistance,'A modest manual adjustment is admitted only after real fork and receiver fit.');
 assert(f.api.release(f.record,f.guide.currentTarget.destination),f.v.warning);
 assert.equal(f.stock.queue[0],held);assert.equal(f.stock.queue.length,1);assert.equal(f.v.entry,null);
 close(f);
}

const blocked=loadedRack(),destination=blocked.guide.currentTarget.destination;
offset(blocked,.035,.015,.02,0);const held=blocked.v.entry;
blocked.v.actualSpeed=.2;assert(!blocked.api.releasePlan(blocked.record,destination).ready,'An aligned moving load still has to stop.');blocked.v.actualSpeed=0;
blocked.stock.items.push({palletIndex:destination.placement.palletIndex,palletSlot:destination.placement.slot});
blocked.stock.queue.push({id:'existing-occupant'});
assert(!blocked.api.releasePlan(blocked.record,destination).ready,'Manual help cannot overwrite an occupied cell.');
assert(!blocked.api.release(blocked.record,destination));assert.equal(blocked.v.entry,held);
blocked.stock.items.pop();blocked.stock.queue.pop();
const obstacle=new THREE.Mesh(new THREE.BoxBufferGeometry(.08,.12,.12),new THREE.MeshBasicMaterial());
obstacle.position.copy(blocked.product.bounds.clone().applyMatrix4(destination.matrix).getCenter(new THREE.Vector3()));blocked.root.add(obstacle);blocked.scene.updateMatrixWorld(true);blocked.ctx.collisionWorld.invalidate(obstacle);
assert(!blocked.api.releasePlan(blocked.record,destination).ready,'A real obstacle prevents assisted seating.');
assert(!blocked.api.release(blocked.record,destination));assert.equal(blocked.v.entry,held);
close(blocked);

for(const [lateral,depth,height,yaw] of [[.08,0,0,0],[0,.15,0,0],[0,0,.09,0],[0,0,0,10]]){
 const f=loadedRack(),held=f.v.entry;plan=offset(f,lateral,depth,height,yaw*Math.PI/180);
 assert(!plan.ready,'The help envelope must not teleport a badly aligned or unsupported load.');
 assert(!f.api.release(f.record,f.guide.currentTarget.destination));assert.equal(f.v.entry,held);assert.equal(f.stock.queue.length,0);close(f);
}
console.log('Upper-rack unload: screenshot and practical manual offsets accepted; same custody/mass, bounded assistance, stop, occupancy and collision guards preserved.');
