'use strict';
const assert = require('node:assert/strict');
const {THREE, fixture, step} = require('./test-vehicle-runtime');
const {guidanceRoute, guidanceTargetReady, GUIDANCE_ROUTE_ARROWS} = require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleGuidancePlanner.js');
const Guide = require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleHolographicGuide.js').default;
const operator = f => ({ctx: f.ctx, simulation: f.runtime});
const task = route => ({phase: 'drop', route, waypointIndex: 0});
const obstacle = (f, size, at) => {
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(...size), new THREE.MeshBasicMaterial()); mesh.position.fromArray(at); f.root.add(mesh); f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate(mesh); return mesh;
};

const f = fixture('forklift-electric-4w', true, false), pose = f.object.matrixWorld.toArray(), route = task([{x: 0, z: 10}, {x: 8, z: 10}]);
let plan = guidanceRoute(operator(f), f.record, route);
assert(plan.clear && !plan.blocked); assert(plan.arrows.length > 10 && plan.arrows.length <= GUIDANCE_ROUTE_ARROWS);
assert(Math.abs(plan.distanceM - 18) < 1e-6); assert(plan.arrows.every(value => Math.abs(value.position.y - .035) < 1e-6));
assert(plan.arrows.some(value => value.position.x > 2 && value.position.z === 10), 'Arrows follow the authored corner instead of a diagonal shortcut.');
assert.deepEqual(f.object.matrixWorld.toArray(), pose, 'Route inspection never drives or teleports the chassis.');
const wall = obstacle(f, [6, 2.5, .015], [0, 1.25, 5]);
plan = guidanceRoute(operator(f), f.record, route); assert(plan.blocked && !plan.clear); assert.equal(plan.arrows.length, 0, 'A real thin wall suppresses the blocked leg and all following arrows.');
f.root.remove(wall); f.ctx.collisionWorld.invalidate(wall);
const corner = obstacle(f, [1, 2.5, 1], [7, 1.25, 10]);
plan = guidanceRoute(operator(f), f.record, route); assert(plan.blocked); assert(plan.arrows.every(value => value.position.x === 0), 'Clear incoming leg remains visible but no arrows cross the obstructed outgoing leg.');
f.root.remove(corner); f.ctx.collisionWorld.invalidate(corner);
assert(guidanceRoute(operator(f), f.record, task([{x: NaN, z: 1}])).blocked);
assert.equal(guidanceRoute(operator(f), f.record, {phase: 'withdraw', route: [{x: 0, z: 2}]}), null);
assert(guidanceRoute(operator(f), f.record, task([{x: 0, z: 90}])).arrows.length <= GUIDANCE_ROUTE_ARROWS);
f.runtime.stop();

const load = fixture(); assert(load.api.pickup(load.record)); step(load, 4, {lift: 1});
const cargo = load.v.entry.product, cargoTop = cargo.item.box.max.y;
const overhead = obstacle(load, [.3, .12, .02], [0, cargoTop - .04, 5]);
plan = guidanceRoute(operator(load), load.record, task([{x: 0, z: 9}]));
assert(plan.blocked, 'The route checks the real raised payload, not only a ground ray or cab height.');
assert.equal(load.v.entry.product, cargo); load.root.remove(overhead); load.ctx.collisionWorld.invalidate(overhead); load.runtime.stop();

// Two different cells share a rack receiver ID; only the exact physical slot
// can light up green. IDs/tags alone cannot claim a pallet is supported.
const target = {kind: 'drop', allowed: true, targetId: 'rack', locationCode: 'A01-R01-B01-M01-N02-P01-F01', slotIndex: 4,
  product: {record: {id: 'pallet-a'}, object: {uuid: 'test'}}, bounds: new THREE.Box3(new THREE.Vector3(-.5, 0, -.5), new THREE.Vector3(.5, .8, .5)), matrix: new THREE.Matrix4().makeTranslation(2, 1.7, -5)};
const corners = (x, y, z) => [[x - .5, y, z - .5], [x + .5, y, z - .5], [x + .5, y, z + .5], [x - .5, y, z + .5]];
const snapshot = {ready: true, phase: 'drop', productId: 'pallet-a', destination: {id: 'rack', palletIndex: 4, locationCode: target.locationCode}, geometry: {target: corners(2, 1.7, -5)}};
assert(guidanceTargetReady(snapshot, target));
assert(!guidanceTargetReady({...snapshot, geometry: {target: corners(2, .3, -5)}}, target), 'Same rack, wrong level is not ready.');
assert(!guidanceTargetReady({...snapshot, destination: {...snapshot.destination, palletIndex: 3}}, target));
assert(!guidanceTargetReady({...snapshot, productId: 'pallet-b'}, target));

// Fault recovery/error text must remain truthful even when an empty route or
// parking brake would otherwise replace it with generic driving advice.
const labelText = [], context = {clearRect() {}, fillRect() {}, fillText(value) {labelText.push(value);}};
const fault = fixture(), faultProduct = fault.runtime.products.get(fault.pallet), faultDriving = {...operator(fault), record: () => fault.record, blocked: () => false, document: {createElement: () => ({getContext: () => context})}};
fault.ctx.vrMode = true; fault.ctx.camera = new THREE.PerspectiveCamera(); fault.ctx.camera.position.set(0, 1.6, 0); fault.ctx.camera.updateMatrixWorld(true); const tracked = fault.ctx.camera.matrixWorld.toArray();
const lesson = {taskId: 'fault-test', title: 'Pallet exacto', phase: 'pickup', productId: faultProduct.record.id, route: [], waypointIndex: 0, routeComplete: false, routeFault: true, completed: 0, total: 1, status: 'Vuelve al último punto válido.'};
fault.runtime.vehicleTraining = {guidance: () => lesson, validatePickup: () => '', validateDrop: () => ''}; fault.v.parkingBrake = true;
const guide = new Guide(faultDriving); guide.mount();
assert(guide.getState().routeBlocked); assert(!guide.getState().ready); assert(!guide.arrows.visible); assert.equal(guide.getState().instruction, lesson.status);
lesson.phase = 'error'; lesson.routeFault = false; lesson.status = 'La ubicación asignada no existe.'; guide.update(true);
assert.equal(guide.getState().phase, 'error'); assert.equal(guide.getState().instruction, lesson.status); assert.equal(guide.getTargets().length, 0);
assert(guide.label.visible && !guide.selected.visible, 'XR errors use the existing information label without a false pallet marker.');
lesson.phase = 'complete'; lesson.completed = 1; lesson.taskId = ''; lesson.status = 'Todas las misiones verificadas.'; guide.update(true);
assert(guide.label.visible && !guide.selected.visible); assert(labelText.includes('1 / 1 misiones verificadas')); assert.deepEqual(fault.ctx.camera.matrixWorld.toArray(), tracked);
assert(guide.stats.geometries <= 4 && guide.stats.materials <= 9, 'The terminal status reuses the existing spatial canvas and geometry.');
guide.dispose(); fault.runtime.vehicleTraining = null; fault.runtime.stop();
console.log('Guided warehouse routes: real thin-wall/corner/load clearance, bounded world arrows, read-only planning and exact rack-slot/product readiness passed.');
