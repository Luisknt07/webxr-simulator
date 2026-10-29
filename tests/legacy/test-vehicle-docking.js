'use strict';
// Real meshes, CollisionWorld and inventory. The monitor must never promise a
// transfer which the command refuses, nor manufacture a pallet or a support.
const assert = require('node:assert/strict');
const h = require('./test-vehicle-runtime.js'), {THREE, fixture, step, vehicles} = h;
const schema = require('../../modules/logistica-industrial/contracts/behaviors.js'), products = require('../../modules/logistica-industrial/functions/flujo-materiales/schema/product-equipment.js');
const factory = require('../support/load-product-prefabs.js')(THREE);
const near = (a, b, eps = 1e-6) => assert(Math.abs(a - b) < eps, `${a} != ${b}`);
function cargoFixture(variant, yaw = 0) {
  const f = fixture('forklift-electric-4w', true, false), object = factory.createProduct(variant);
  object.name = products.getDefinition(variant).name; object.rotation.y = yaw;
  object.position.set(0, 0, vehicles.getDimensions(f.config).forkHeelZ + (Math.abs(Math.sin(yaw)) > .5 ? .70 : .55)); f.root.add(object); f.scene.updateMatrixWorld(true);
  const product = f.runtime.registerProduct(object); f.ctx.collisionWorld.invalidate(object);
  const pockets = f.api.productPockets(product), side = Math.abs(Math.sin(yaw)) > .5;
  f.v.config.forkSpread = side ? Math.abs(pockets.centersZ[1] - pockets.centersZ[0]) : Math.abs(pockets.centersX[1] - pockets.centersX[0]);
  const top = pockets.maxY - .004; f.api.applyPose(f.record, Object.assign({}, f.v.pose, {lift: top - f.config.forkBaseHeight}), false);
  return Object.assign(f, {product, cargo: object});
}
function noFloor(f) { f.root.children.filter(object => object.geometry && object.geometry.parameters && object.geometry.parameters.width === 100).forEach(object => { f.root.remove(object); f.ctx.collisionWorld.invalidate(object); }); }
function slab(f, width, depth, top, x, z) {
  const object = new THREE.Mesh(new THREE.BoxBufferGeometry(width, .08, depth), new THREE.MeshBasicMaterial());
  object.name = 'Apoyo real'; object.position.set(x, top - .04, z); f.root.add(object); f.ctx.collisionWorld.invalidate(object); return object;
}
function snapshot(f, product) {
  f.scene.updateMatrixWorld(true);
  return {pose: JSON.stringify(f.v.pose), entry: f.v.entry, parent: product.object.parent, matrix: product.object.matrixWorld.toArray(),
    entries: Array.from(f.runtime.sourceRuntime.entries), counts: [f.v.received, f.v.delivered, f.v.receivedUnits, f.v.deliveredUnits],
    flags: [product.vehicleOwnerId, product.robotOwnerId, product.vehicleReservedBy, product.processorLocked, f.v.warning, f.v.blocked],
    nodes: f.v.visualRoot.children.map(node => node.matrixWorld.toArray())};
}

// Euro, industrial, plastic and full loads: both actual approach axes and two
// distinct slots, with real thickness/width clearance and supported load centre.
for (const variant of ['pallet-euro', 'pallet-industrial', 'pallet-plastic', 'pallet-loaded', 'cage']) for (const yaw of [0, Math.PI / 2]) {
  const f = cargoFixture(variant, yaw), metadata = f.runtime.productMetadata(f.product), before = snapshot(f, f.product), pose = f.v.pose;
  const state = f.api.getDockingState(f.record);
  assert(state.ready, `${variant}/${yaw}: ${state.reason}`); assert.equal(state.severity, 'ready'); assert(state.insertion.supported);
  assert(state.clearances.forkGapM >= 0 && state.clearances.verticalM > 0);
  assert.equal(state.geometry.chassis.length, 4); assert.equal(state.geometry.forks.length, 2); assert.equal(state.geometry.pockets.length, 2);
  assert.equal(state.geometry.target.length, 4); state.geometry.forks.flat().forEach(point => assert.equal(point.length, 3));
  for (let query = 0; query < 12; query++) assert(f.api.getDockingState(f.record).ready);
  assert.equal(f.v.pose, pose); assert.deepEqual(snapshot(f, f.product), before, 'A fresh docking query changes no live pose, transforms or inventory.');
  assert(f.api.pickup(f.record), f.v.warning); const entry = f.v.entry;
  assert.equal(entry.product, f.product); near(f.runtime.productMetadata(f.product).mass, metadata.mass); assert.equal(entry.units, metadata.units);
  assert(f.api.getDockingState(f.record).stability.kinematicCoupling);
  assert(f.api.release(f.record), f.v.warning); assert.equal(f.product.sourceEntry, entry); assert.equal(f.v.entry, null);
  near(f.product.bounds.clone().applyMatrix4(f.product.object.matrixWorld).min.y, .003);
  f.runtime.stop();
}
for(const definition of vehicles.VARIANTS.filter(definition=>vehicles.supports(definition.preset).forks)){const f=fixture(definition.id,true,true);assert(f.api.getDockingState(f.record).ready,definition.id);assert(f.api.pickup(f.record),f.v.warning);const state=f.api.getDockingState(f.record);assert(state.ready,definition.id+': '+state.reason);assert(f.api.release(f.record),f.v.warning);f.runtime.stop();}

// A centre beyond the tine tips is rejected even if the old minimum overlap
// check would have accepted the rear portion of an oversized pallet.
const long = cargoFixture('pallet-industrial'); long.cargo.scale.z = 2.4; long.cargo.position.z = vehicles.getDimensions(long.config).forkHeelZ + 1.2;
long.scene.updateMatrixWorld(true); long.ctx.collisionWorld.invalidate(long.cargo);
const longState = long.api.getDockingState(long.record); assert(!longState.ready); assert(longState.insertion.actualM > longState.insertion.requiredM);
assert(!longState.insertion.supported); assert(!long.api.pickup(long.record)); assert.equal(long.product.sourceEntry, undefined); long.runtime.stop();

const invalid = cargoFixture('pallet-euro'); invalid.cargo.position.x += .35; invalid.scene.updateMatrixWorld(true);
assert(!invalid.api.getDockingState(invalid.record).ready); assert(!invalid.api.pickup(invalid.record)); invalid.cargo.position.x -= .35;
invalid.cargo.position.z += .65; invalid.scene.updateMatrixWorld(true); assert(!invalid.api.getDockingState(invalid.record).ready); assert(!invalid.api.pickup(invalid.record)); invalid.runtime.stop();

// Rated mass and physical engagement collisions are the same red interlock in
// the monitor and command. Preview never creates phantom source entries.
const heavy = cargoFixture('pallet-loaded'); heavy.v.config.payloadKg = 50;
assert.equal(heavy.api.getDockingState(heavy.record).severity, 'blocked'); assert(!heavy.api.pickup(heavy.record)); assert.equal(heavy.product.sourceEntry, undefined); heavy.runtime.stop();
const obstruction = cargoFixture('pallet-loaded'), mast = obstruction.api.rig(obstruction.record).mast;
const plate = new THREE.Mesh(new THREE.BoxBufferGeometry(.08, .006, .04), new THREE.MeshBasicMaterial());
plate.position.set(0, obstruction.config.mastHeight + obstruction.v.pose.lift + .001, 0).applyMatrix4(mast.matrixWorld); obstruction.root.add(plate); obstruction.ctx.collisionWorld.invalidate(plate);
const beforeBlocked = snapshot(obstruction, obstruction.product); assert(!obstruction.api.getDockingState(obstruction.record).ready); assert.deepEqual(snapshot(obstruction, obstruction.product), beforeBlocked);
assert(!obstruction.api.pickup(obstruction.record)); assert.equal(obstruction.v.entry, null); obstruction.runtime.stop();

// A single supported corner, empty air and a surface9cm below are not stable
// deposits. A full nearby slab accepts the exact same load without sideways snap.
const support = cargoFixture('pallet-loaded'); assert(support.api.pickup(support.record));
assert(support.api.applyPose(support.record, Object.assign({}, support.v.pose, {lift: .35}), true));
const held = support.v.entry; noFloor(support); const heldBox = support.product.bounds.clone().applyMatrix4(support.product.object.matrixWorld), center = heldBox.getCenter(new THREE.Vector3());
const corner = slab(support, .18, .18, heldBox.min.y - .04, heldBox.min.x + .05, heldBox.min.z + .05);
assert(!support.api.getDockingState(support.record).ready); const cornerPose = support.product.object.matrixWorld.clone(); assert(!support.api.release(support.record)); assert.equal(support.v.entry, held); assert(support.product.object.matrixWorld.equals(cornerPose));
support.root.remove(corner); support.ctx.collisionWorld.invalidate(corner);
const far = slab(support, 2, 2, heldBox.min.y - .09, center.x, center.z); assert(!support.api.getDockingState(support.record).ready); assert(!support.api.release(support.record)); support.root.remove(far); support.ctx.collisionWorld.invalidate(far);
const intrusive=slab(support,2,2,heldBox.min.y-.04,center.x,center.z);const priorHydraulics=Object.assign({},support.v.pose);assert(!support.api.getDockingState(support.record).ready,'An apparent cargo support which crosses the real mast remains an obstruction.');assert(!support.api.release(support.record));assert.deepEqual(support.v.pose,priorHydraulics);support.root.remove(intrusive);support.ctx.collisionWorld.invalidate(intrusive);
const full = slab(support, 1.4, .9, heldBox.min.y - .04, center.x, center.z), previous = support.product.object.getWorldPosition(new THREE.Vector3()), rotation = support.product.object.getWorldQuaternion(new THREE.Quaternion());
const supported = support.api.getDockingState(support.record); assert(supported.ready, supported.reason); assert.equal(supported.support.samples.length, 4); near(supported.support.gapM, .037);
assert(support.api.release(support.record), support.v.warning); assert.equal(support.product.sourceEntry, held); const final = support.product.object.getWorldPosition(new THREE.Vector3()); near(final.x, previous.x); near(final.z, previous.z); near(previous.y - final.y, .037);
near(support.product.object.getWorldQuaternion(new THREE.Quaternion()).angleTo(rotation), 0); assert(!support.ctx.collisionWorld.testBox(support.product.bounds.clone().applyMatrix4(support.product.object.matrixWorld), {ignore: [support.object, support.product.object]})); support.runtime.stop();

// Custody remains a secure kinematic attachment through acceleration, turns,
// tilted mast, pause and emergency; only a supported explicit release detaches.
const stable = cargoFixture('pallet-loaded'); assert(stable.api.pickup(stable.record)); const same = stable.v.entry, relative = stable.v.loadMatrix.clone();
step(stable, 2, {lift: 1, throttle: 1, steer: .8}); step(stable, 2, {throttle: -1, steer: -.7, tilt: -.5}); step(stable, 1, {brake: 1});
assert.equal(stable.v.entry, same); assert.equal(stable.product.vehicleOwnerId, stable.record.id); assert(stable.v.loadMatrix.equals(relative));
const expected = stable.api.rig(stable.record).forks.matrixWorld.clone().multiply(relative); expected.elements.forEach((value, i) => near(stable.product.object.matrixWorld.elements[i], value));
stable.api.command(stable.record, 'pause'); assert.equal(stable.api.getDockingState(stable.record).severity, 'blocked'); const frozen = stable.product.object.matrixWorld.clone(); step(stable, 1, {throttle: 1, lift: 1}); assert(stable.product.object.matrixWorld.equals(frozen)); assert(!stable.api.release(stable.record));
stable.api.command(stable.record, 'emergency'); assert.equal(stable.api.getDockingState(stable.record).severity, 'blocked'); assert.equal(stable.v.entry, same); stable.runtime.stop();

// The truck and load rotate together: use the load's real oriented frame for
// its own mast, not an inflated world AABB. Actual self-penetration still blocks.
const turning=cargoFixture('pallet-loaded',Math.PI/2);assert(turning.api.pickup(turning.record));assert(turning.api.applyPose(turning.record,Object.assign({},turning.v.pose,{lift:1}),true));
for(let index=0;index<24;index++){turning.object.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),index*Math.PI/12);turning.object.updateMatrix();turning.scene.updateMatrixWorld(true);turning.ctx.collisionWorld.invalidate(turning.object);assert(turning.api.carry(turning.record,true),'A rigid relative pose cannot invent a mast collision while turning.');}
const intrusiveBody=new THREE.Mesh(new THREE.BoxBufferGeometry(.06,.06,.06),new THREE.MeshBasicMaterial());intrusiveBody.name='Obstáculo propio real';turning.record.object.add(intrusiveBody);intrusiveBody.position.copy(turning.record.object.worldToLocal(turning.product.object.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.3,0))));turning.scene.updateMatrixWorld(true);turning.ctx.collisionWorld.invalidate(intrusiveBody);assert(!turning.api.carry(turning.record,true),'The own-body narrow phase does not ignore a real penetrating chassis part.');assert.equal(turning.v.entry.product,turning.product);turning.runtime.stop();

// A store is a real receiving inventory, not a magnet. The full pallet may be
// delivered only after its complete envelope is aligned to a free pallet bay.
const stock = cargoFixture('pallet-loaded'); assert(stock.api.pickup(stock.record));
const storeObject = new THREE.Group(); storeObject.name = 'Almacén de pallets completos'; storeObject.position.set(10, 1, 10); stock.root.add(storeObject);
const storeConfig = Object.assign(schema.defaultBehavior('palletQueue'), {acceptsPallets: true, palletCapacity: 1, capacity: 1, autoRelease: false, delivery: 'manual'});
const store = {id: 'docking-stock', object: storeObject, components: {palletQueue: {config: storeConfig}}, writable: [],position:storeObject.position.clone(),quaternion:storeObject.quaternion.clone(),scale:storeObject.scale.clone(),matrix:storeObject.matrix.clone(),matrixAutoUpdate:true,parent:storeObject.parent,siblingIndex:storeObject.parent.children.indexOf(storeObject)}; stock.runtime.records.set(store.id, store); stock.runtime.palletQueueRuntime.attach(store, store.components.palletQueue); stock.scene.updateMatrixWorld(true);
let placement = stock.runtime.palletQueueRuntime.placement(store, stock.product); assert(placement);
const loadPosition = stock.product.object.getWorldPosition(new THREE.Vector3()), bayPosition = new THREE.Vector3().setFromMatrixPosition(placement.matrix);
storeObject.position.add(loadPosition.clone().sub(bayPosition).setY(0)); storeObject.position.x += .18; stock.scene.updateMatrixWorld(true); stock.ctx.collisionWorld.invalidate(storeObject);
assert(!stock.api.getDockingState(stock.record).ready, 'A bay18cm aside cannot pull the pallet off its forks.'); const retained = stock.v.entry; assert(!stock.api.release(stock.record)); assert.equal(stock.v.entry, retained);
storeObject.position.x -= .18; stock.scene.updateMatrixWorld(true); stock.ctx.collisionWorld.invalidate(storeObject);
const storeState = stock.api.getDockingState(stock.record); assert(storeState.ready, storeState.reason); assert.equal(storeState.destination.id, store.id);
store.components.palletQueue.queue.push({id:'occupied'});const fullState=stock.api.getDockingState(stock.record);assert(!fullState.ready);assert.equal(fullState.severity,'blocked');assert(!stock.api.release(stock.record));assert.equal(stock.v.entry,retained);store.components.palletQueue.queue.length=0;
assert(stock.api.release(stock.record), stock.v.warning); assert.equal(store.components.palletQueue.queue[0], retained); assert.equal(retained.product, stock.product); assert.equal(store.components.palletQueue.receivedUnits, 24); near(stock.runtime.productMetadata(stock.product).mass, 145); stock.runtime.stop();

// An intake1cm below the carried pallet previously collided with the carrier's
// own tines during discovery. The real receiving slab stays solid while only
// the valid physical fork pockets admit the secured tines.
const process = cargoFixture('pallet-loaded'); assert(process.api.pickup(process.record));
assert(process.api.applyPose(process.record,Object.assign({},process.v.pose,{lift:.5}),true));
const processObject=new THREE.Group();processObject.position.set(10,1,10);processObject.name='Mesa de proceso';process.root.add(processObject);
const processConfig=Object.assign(schema.defaultBehavior('processor'),{length:3,width:2,capacity:1}),processor={id:'docking-processor',object:processObject,components:{processor:{config:processConfig}},writable:[],position:processObject.position.clone(),quaternion:processObject.quaternion.clone(),scale:processObject.scale.clone(),matrix:processObject.matrix.clone(),matrixAutoUpdate:true,parent:processObject.parent,siblingIndex:processObject.parent.children.indexOf(processObject)};
process.runtime.records.set(processor.id,processor);process.runtime.processorRuntime.attach(processor,processor.components.processor);process.scene.updateMatrixWorld(true);
const intake=process.runtime.sourceRuntime.frontMatrix(processor,process.product.bounds,process.product.scale,processor.components.processor.input.position),desired=process.product.object.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,-.01,0));processObject.position.add(desired.clone().sub(new THREE.Vector3().setFromMatrixPosition(intake)));process.scene.updateMatrixWorld(true);
const intakeBox=process.product.bounds.clone().applyMatrix4(process.runtime.sourceRuntime.frontMatrix(processor,process.product.bounds,process.product.scale,processor.components.processor.input.position)),top=intakeBox.min.y-.005,intakeCenter=intakeBox.getCenter(new THREE.Vector3());
const table=slab(process,1.4,.9,top,intakeCenter.x,intakeCenter.z);table.updateMatrixWorld(true);processObject.attach(table);process.ctx.collisionWorld.invalidate(processObject);
const processEntry=process.v.entry,processState=process.api.getDockingState(process.record);assert(processState.ready,processState.reason);assert.equal(processState.destination.kind,'processor');
assert(process.api.release(process.record),process.v.warning);assert.equal(processor.components.processor.input.queue[0],processEntry);assert.equal(processEntry.product,process.product);near(process.runtime.productMetadata(process.product).mass,145);process.runtime.stop();

console.log('Vehicle docking: real Euro/industrial/plastic/full pallet slots on both axes, readonly exact OBB guidance, supported centre, capacity/collision parity, stable four-sector support, bounded vertical seating and secure cargo identity passed.');
