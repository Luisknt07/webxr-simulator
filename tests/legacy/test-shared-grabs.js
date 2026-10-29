const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../../modules/logistica-industrial/contracts/behaviors');
const automationSchema = require('../../modules/logistica-industrial/functions/flujo-materiales/schema/automation');
const ObjectPlacement = require('../support/load-object-placement')(THREE);
const {getGeometryTree} = require('../support/load-geometry-acceleration')(THREE);
function source(file) { return fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-shared-grabs.js"), '..', file)), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''); }
const prefabs = new Function('THREE', 'behaviorSchema', source("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js") + '\nreturn {createIndustrialPrefab,createProductVisual,createSourceProductVisual};')(THREE, behaviorSchema);
const Document = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source("packages/project-model/src/SceneDocument.js").replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, prefabs.createIndustrialPrefab);
const Feedback = new Function('THREE', source("modules/logistica-industrial/functions/flujo-materiales/runtime/ProductFeedback.js").replace('default class ProductFeedback', 'return class ProductFeedback'))(THREE);
const Source = require('../support/load-product-source-runtime')(THREE, behaviorSchema);
const PalletQueue = require('../support/load-pallet-queue-runtime')(THREE, behaviorSchema);
const Processor = require('../support/load-processor-runtime')(THREE, behaviorSchema);
const Runtime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', source("modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js").replace('default class SimulationRuntime', 'return class SimulationRuntime'))(THREE, behaviorSchema, automationSchema, prefabs.createProductVisual, Feedback, ObjectPlacement, Source, Processor, PalletQueue);
const CollisionWorld = new Function('THREE', 'getGeometryTree', source("packages/render-three/src/CollisionWorld.js").replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const {captureSimulation, restoreSimulation, productIdentity} = new Function('THREE', 'createProductVisual', 'createSourceProductVisual', source("modules/logistica-industrial/runtime/SimulationCheckpoint.js") + '\nreturn {captureSimulation,restoreSimulation,productIdentity};')(THREE, prefabs.createProductVisual, prefabs.createSourceProductVisual);
let now = 0;
const SharedGrabs = new Function('THREE', 'productIdentity', 'performance', source("packages/tools/collaboration/src/SharedGrabs.js").replace('default class SharedGrabs', 'return class SharedGrabs'))(THREE, productIdentity, {now: () => now});

function setup() {
  const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(30, .05, 30), new THREE.MeshBasicMaterial()); floor.position.y = -.025; root.add(floor);
  const document = new Document({}); document.registerRoom('hall', root);
  const ctx = {scene, editor: {active: false}, raycontrol: {states: {}, addState(name, state) { this.states[name] = state; }, activateState() {}, deactivateState() {}}};
  ctx.collisionWorld = new CollisionWorld(ctx, document);
  const runtime = new Runtime(ctx, document);
  return {scene, root, document, ctx, runtime};
}
async function settle() { for (let index = 0; index < 8; index++) await Promise.resolve(); }

async function run() {
  const host = setup(), belt = host.document.addPrefab('hall', 'conveyor'), productObject = host.document.addPrefab('hall', 'product');
  const beltId = belt.userData.editorId, productId = productObject.userData.editorId;
  host.document.setTransform(belt, {position: [0, 1.02, 0]});
  const beltConfig = host.document.getBehaviors(belt).find(config => config.type === 'conveyor');
  host.document.setBehaviors(belt, [Object.assign({}, beltConfig, {autoSpawn: false, powered: true, running: false, withPanel: false, withSensors: false, withPallet: false})]);
  host.document.setTransform(productObject, {position: [0, .6, 2]});
  const authored = await host.document.serialize(), participant = setup(); await participant.document.load(authored);
  host.runtime.start('hall'); participant.runtime.start('hall');
  restoreSimulation(participant.runtime, JSON.parse(JSON.stringify(captureSimulation(host.runtime))));
  const hostProduct = host.runtime.products.get(productObject), participantProduct = Array.from(participant.runtime.products.values()).find(product => product.record && product.record.id === productId);
  assert.equal(productIdentity(hostProduct), productIdentity(participantProduct));
  const key = productIdentity(hostProduct), events = [], locks = new Map(), messages = [];
  const people = [{id: 'host', online: true, pose: {position: [0, 1.6, 3], quaternion: [0, 0, 0, 1]}},
    {id: 'guest', online: true, pose: {position: [0, 1.6, 3], quaternion: [0, 0, 0, 1]}}];
  const room = role => ({id: 'room-1', hostId: 'host', role, participants: people,
    get locks() { return Array.from(locks, ([objectId, userId]) => ({objectId, userId})); }});
  const action = async (userId, payload) => {
    const owner = locks.get(payload.objectId);
    if (payload.type === 'grab') { if (owner && owner !== userId) throw new Error('object_locked'); locks.set(payload.objectId, userId); }
    else if (payload.type === 'pose-object') { if (owner !== userId) throw new Error('lock_required'); }
    else if (payload.type === 'release') { if (!owner || owner !== userId && userId !== 'host') throw new Error('lock_required'); payload = Object.assign({}, payload, {ownerId: owner}); locks.delete(payload.objectId); }
    const sequence = events.length + 1; events.push({sequence, userId, type: 'action', payload}); return {sequence, accepted: true};
  };
  function experience(fixture, userId, role) {
    return {editor: {simulation: fixture.runtime}, client: {user: {id: userId}}, room: room(role),
      connection: {action: payload => action(userId, payload)}, message: value => messages.push(value)};
  }
  const hostExperience = experience(host, 'host', 'host'), guestExperience = experience(participant, 'guest', 'participant');
  const hostGrabs = new SharedGrabs(hostExperience), guestGrabs = new SharedGrabs(guestExperience);
  let cursor = 0;
  const flush = async () => {
    await settle();
    while (cursor < events.length) {
      const event = events[cursor++]; await hostGrabs.applyEvent(event, hostExperience.room); await guestGrabs.applyEvent(event, guestExperience.room); await settle();
    }
    hostGrabs.receiveRoom(hostExperience.room); guestGrabs.receiveRoom(guestExperience.room);
  };
  const hand = new THREE.Group(); hand.position.set(0, 1.4, 2.7); participant.scene.add(hand);
  assert(participant.runtime.pickupProduct(participantProduct, hand));
  assert(guestGrabs.holding, 'pending lease defers peer snapshots before a local preview exists');
  await flush();
  assert.equal(locks.get(key), 'guest');
  assert.equal(guestGrabs.local.size, 1); assert.equal(hostGrabs.remote.size, 1);
  assert(participant.runtime.held.has(hand)); assert(hostProduct.heldBy && hostProduct.heldBy.userData.editorRuntimeHelper);
  const beltRecord = host.runtime.records.get(beltId), beltState = beltRecord.components.conveyor;
  const target = host.runtime.packageMatrix(beltRecord, beltState, 0, {route: 'main', bounds: hostProduct.bounds, scale: hostProduct.scale});
  const desired = new THREE.Vector3().setFromMatrixPosition(target);
  for (const point of [new THREE.Vector3(0, 1.55, 2), new THREE.Vector3(0, 1.55, 0), desired]) {
    hand.position.copy(point).sub(new THREE.Vector3(0, -.025, -.35)); hand.updateWorldMatrix(true, false);
    now += 200; guestGrabs.tick(); await flush();
  }
  assert(hostProduct.object.getWorldPosition(new THREE.Vector3()).distanceTo(desired) < 1e-7, 'host moves remote held product through the native collision sweep: ' + hostProduct.object.getWorldPosition(new THREE.Vector3()).toArray() + ' expected ' + desired.toArray() + ' messages ' + messages.join('|'));
  assert(participant.runtime.releaseProduct(participantProduct)); await flush();
  assert.equal(locks.size, 0); assert.equal(guestGrabs.holding, false); assert.equal(hostGrabs.remote.size, 0);
  assert.equal(host.runtime.records.get(beltId).components.conveyor.packages.length, 1, 'authoritative release admits the same box to the belt');
  assert.equal(participant.runtime.records.get(beltId).components.conveyor.packages.length, 1);
  const sameMesh = participantProduct.object;
  restoreSimulation(participant.runtime, JSON.parse(JSON.stringify(captureSimulation(host.runtime))), {reuse: true});
  assert.equal(Array.from(participant.runtime.products.keys()).find(object => object.userData.editorId === productId), sameMesh);

  // A simultaneous local host request loses to the existing guest lease.
  const hostHand = new THREE.Group(); hostHand.position.set(0, 1.4, 2.7); host.scene.add(hostHand);
  const guestCurrent = participant.runtime.products.get(sameMesh);
  assert(participant.runtime.pickupProduct(guestCurrent, hand)); assert(host.runtime.pickupProduct(hostProduct, hostHand)); await flush();
  assert.equal(locks.get(key), 'guest'); assert.equal(hostGrabs.local.size, 0); assert.equal(hostGrabs.remote.size, 1);
  assert(messages.some(message => message.includes('object_locked')));
  assert(participant.runtime.releaseProduct(guestCurrent, true)); await flush();

  // Host reach validation rejects a forged remote grab and releases its lease.
  people[1].pose.position = [20, 1.6, 20];
  assert(participant.runtime.pickupProduct(guestCurrent, hand)); await flush();
  assert.equal(locks.size, 0); assert.equal(guestGrabs.local.size, 0); assert.equal(hostGrabs.remote.size, 0);
  assert(messages.some(message => message.includes('fuera de alcance')));
  people[1].pose.position = [0, 1.6, 3];

  guestExperience.room.role = 'observer';
  assert.equal(participant.runtime.pickupProduct(guestCurrent, hand), false); guestExperience.room.role = 'participant';
  assert(participant.runtime.pickupProduct(guestCurrent, hand)); await flush();
  people[1].online = false; locks.clear(); now += 2000;
  hostGrabs.receiveRoom(hostExperience.room); guestGrabs.receiveRoom(guestExperience.room);
  assert.equal(host.runtime.held.size, 0); assert.equal(participant.runtime.held.size, 0);
  assert.equal(hostGrabs.remote.size, 0); assert.equal(guestGrabs.holding, false);
  hostExperience.editor.simulationPaused = true;
  assert(host.runtime.pickupProduct(hostProduct, hostHand)); await flush();
  const pausedPose = hostProduct.object.getWorldPosition(new THREE.Vector3());
  hostHand.position.y += .4; now += 200; hostGrabs.tick(); await flush();
  assert(hostProduct.object.getWorldPosition(new THREE.Vector3()).distanceTo(pausedPose) > .1, 'local host hand continues moving while the machine clock is paused');
  assert(host.runtime.releaseProduct(hostProduct, true)); await flush();
  // Grip input owns a load until physical grip-up, including asynchronous
  // reservation acknowledgement. A late lease must never pick a box after
  // the operator has released the controller or left immersive interaction.
  people[1].online = true;
  hostExperience.editor.simulationPaused = false;
  const grip = {down: true}; participant.runtime.productGripInputs.set(hand, grip);
  assert(participant.runtime.pickupProduct(guestCurrent, hand, 'squeeze')); await flush();
  assert.equal(guestCurrent.holdInput, 'squeeze', 'The reservation preserves the production input mode when the local grab starts.');
  grip.down = false; participant.runtime.releaseHeldProducts(hand, 'squeeze'); await flush();
  assert.equal(guestCurrent.heldBy, null); assert.equal(locks.size, 0);

  // Release before the presence/request microtask has even asked for a lease.
  grip.down = true;
  assert(participant.runtime.pickupProduct(guestCurrent, hand, 'squeeze'));
  grip.down = false; participant.runtime.releaseHeldProducts(hand, 'squeeze'); await flush();
  assert.equal(guestGrabs.pending.size, 0); assert.equal(guestCurrent.heldBy, null); assert.equal(locks.size, 0);

  const connection = guestExperience.connection;
  let acknowledge;
  guestExperience.connection = {action(payload) {
    if (payload.type !== 'grab') return connection.action(payload);
    return connection.action(payload).then(result => new Promise(resolve => { acknowledge = () => resolve(result); }));
  }};
  grip.down = true;
  assert(participant.runtime.pickupProduct(guestCurrent, hand, 'squeeze')); await settle();
  assert.equal(typeof acknowledge, 'function'); assert.equal(locks.get(key), 'guest');
  grip.down = false; participant.runtime.releaseHeldProducts(hand, 'squeeze');
  acknowledge(); await flush();
  assert.equal(guestCurrent.heldBy, null); assert.equal(hostProduct.heldBy, null);
  assert.equal(guestGrabs.pending.size, 0); assert.equal(hostGrabs.remote.size, 0); assert.equal(locks.size, 0,
    'A lease that arrives after grip-up is released, including its authoritative remote preview.');

  acknowledge = null; grip.down = true;
  assert(participant.runtime.pickupProduct(guestCurrent, hand, 'squeeze')); await settle();
  participant.runtime.onInputModeChange();
  assert.equal(grip.down, false); assert.equal(guestGrabs.pending.size, 0);
  acknowledge(); await flush();
  assert.equal(guestCurrent.heldBy, null); assert.equal(locks.size, 0, 'Exiting XR also cancels a reservation still in flight.');

  guestExperience.connection = connection;
  assert(participant.runtime.pickupProduct(guestCurrent, hand));
  participant.runtime.releaseHeldProducts(hand, 'squeeze'); await flush();
  assert.equal(guestCurrent.heldBy, hand); assert.equal(guestCurrent.holdInput, 'select', 'Grip-up never cancels a pending trigger-toggle grab.');
  assert(participant.runtime.releaseProduct(guestCurrent, true)); await flush();
  hostGrabs.dispose(); guestGrabs.dispose(); host.runtime.stop(); participant.runtime.stop();
  assert.equal(Object.keys(host.ctx.raycontrol.states).length, 0);
  assert.equal(Object.keys(participant.ctx.raycontrol.states).length, 0);
  console.log('Agarrar compartido: dos simuladores reales, reserva exclusiva, autoridad, movimiento, depósito en banda, alcance, observador, agarre VR asíncrono y desconexión OK.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
