'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'test-vehicle-docking.js'),'utf8');
const {cargoFixture,slab,snapshot,THREE,schema}=new Function('require','__dirname',src.slice(0,src.indexOf('// Euro, industrial'))+'\nreturn {cargoFixture,slab,snapshot,THREE,schema};')(require,__dirname);
function receiving(offset,mode='manual'){
 const f=cargoFixture('pallet-loaded');f.v.config.mode=mode;assert(f.api.pickup(f.record));
 const object=new THREE.Group();object.name='Destino de ayuda';object.position.set(10,1,10);f.root.add(object);
 const config={...schema.defaultBehavior('palletQueue'),acceptsPallets:true,palletCapacity:1,capacity:1,autoRelease:false,delivery:'manual'},record={id:'assist-stock',object,components:{palletQueue:{config}},writable:[],position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone(),matrix:object.matrix.clone(),matrixAutoUpdate:true,parent:object.parent,siblingIndex:object.parent.children.indexOf(object)};
 f.runtime.records.set(record.id,record);f.runtime.palletQueueRuntime.attach(record,record.components.palletQueue);f.scene.updateMatrixWorld(true);
 const p=f.runtime.palletQueueRuntime.placement(record,f.product);assert(p);object.position.add(f.product.object.getWorldPosition(new THREE.Vector3()).sub(new THREE.Vector3().setFromMatrixPosition(p.matrix)).setY(0));object.position.x+=offset;f.scene.updateMatrixWorld(true);f.ctx.collisionWorld.invalidate(object);
 return {...f,receiver:record};
}
const f=receiving(.045),entry=f.v.entry,old=snapshot(f,f.product),plan=f.api.releasePlan(f.record);
assert(plan.ready,plan.reason);assert(plan.assistance&&Math.abs(plan.assistance.translationM-.045)<1e-6);assert.equal(plan.tolerances.positionM,.06);
for(let i=0;i<20;i++)assert(f.api.releasePlan(f.record).ready);assert.deepEqual(snapshot(f,f.product),old,'Help preview never moves cargo, forks, stock or counters.');
assert(f.api.release(f.record));assert.equal(f.receiver.components.palletQueue.queue[0],entry);assert.equal(entry.product,f.product);assert.equal(f.runtime.productMetadata(f.product).mass,145);assert.equal(entry.units,24);f.runtime.stop();
for(const [offset,mode]of [[.061,'manual'],[.045,'automatic']]){const x=receiving(offset,mode),held=x.v.entry;assert(!x.api.releasePlan(x.record).ready);assert(!x.api.release(x.record));assert.equal(x.v.entry,held);x.runtime.stop();}
const blocked=receiving(.045),box=blocked.product.bounds.clone().applyMatrix4(blocked.product.object.matrixWorld),obstacle=new THREE.Mesh(new THREE.BoxBufferGeometry(.02,.12,.12),new THREE.MeshBasicMaterial());obstacle.position.copy(box.getCenter(new THREE.Vector3())).add(new THREE.Vector3(.02,0,0));blocked.root.add(obstacle);blocked.scene.updateMatrixWorld(true);blocked.ctx.collisionWorld.invalidate(obstacle);assert(!blocked.api.releasePlan(blocked.record).ready,'The aid cannot pass cargo through a real obstruction.');assert(!blocked.api.release(blocked.record));blocked.runtime.stop();

// Manual yaw help has a bounded envelope; real pocket clearance and receiver
// compatibility can still reject a combined translation/yaw inside that limit.
for(const [yaw,mode,expected]of [[.11,'manual',true],[.121,'manual',false],[.09,'automatic',false],[.07,'automatic',true]]){
 const x=receiving(0,mode),held=x.v.entry;x.receiver.object.rotation.y=yaw;x.scene.updateMatrixWorld(true);x.ctx.collisionWorld.invalidate(x.receiver.object);
 const old=snapshot(x,x.product),plan=x.api.releasePlan(x.record);assert.equal(plan.ready,expected,mode+'/'+yaw+': '+plan.reason);assert.equal(plan.tolerances.yawRad,mode==='manual'?.12:.08);
 for(let read=0;read<12;read++)x.api.releasePlan(x.record);assert.deepEqual(snapshot(x,x.product),old,'Yaw help preview leaves live pose, geometry, reservations and custody unchanged.');
 if(expected){const wanted=new THREE.Quaternion();plan.matrix.decompose(new THREE.Vector3(),wanted,new THREE.Vector3());assert(x.api.release(x.record),x.v.warning);assert.equal(x.receiver.components.palletQueue.queue[0],held);assert.equal(held.product,x.product);assert(x.product.object.getWorldQuaternion(new THREE.Quaternion()).angleTo(wanted)<1e-6);}
 else{assert(!x.api.release(x.record));assert.equal(x.v.entry,held);}
 x.runtime.stop();
}
const limited=receiving(.059);limited.receiver.object.rotation.y=.119;limited.scene.updateMatrixWorld(true);limited.ctx.collisionWorld.invalidate(limited.receiver.object);assert(!limited.api.releasePlan(limited.record).ready,'Being numerically inside the help envelope does not bypass actual pocket/receiver fit.');limited.runtime.stop();

// A wider authored pallet legitimately admits a larger lateral offset. Narrow
// holes keep their true limit; removing a fixed centre cutoff never widens them.
const wide=cargoFixture('pallet-euro');wide.cargo.scale.x=1.5;wide.cargo.position.x=.14;wide.v.config.forkSpread*=1.5;wide.api.applyPose(wide.record,{...wide.v.pose},false);wide.scene.updateMatrixWorld(true);
assert(wide.api.pickupPlan(wide.record).ready);assert(wide.api.command(wide.record,'pickup'));wide.runtime.stop();
const narrow=cargoFixture('pallet-euro');narrow.cargo.position.x=.14;narrow.scene.updateMatrixWorld(true);assert(!narrow.api.pickupPlan(narrow.record).ready);assert(!narrow.api.command(narrow.record,'pickup'));narrow.runtime.stop();
for(const gap of [.01,.004]){const x=cargoFixture('pallet-euro'),tool=x.api.rig(x.record).forks;x.scene.updateMatrixWorld(true);const local=x.product.bounds.clone().applyMatrix4(new THREE.Matrix4().getInverse(tool.matrixWorld).multiply(x.cargo.matrixWorld));x.cargo.position.z+=gap-local.min.z;x.scene.updateMatrixWorld(true);const plan=x.api.pickupPlan(x.record);assert.equal(!!plan.candidate,gap>=.005);assert(!plan.ready,'The real carriage still prevents grabbing through wood near the heel.');x.runtime.stop();}
console.log('Manual docking assistance: bounded 6cm/6.9-degree help, automatic precision, readonly previews, actual pockets/receiver/sweeps, exact custody/mass and carriage/obstacle rejection passed.');
