'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {THREE, fixture: vehicleFixture} = require('./test-vehicle-runtime.js');
const schema = require('../../modules/logistica-industrial/functions/montacargas/schema/vehicle-training.js');
const source = fs.readFileSync(path.resolve(__dirname, '../../modules/logistica-industrial/functions/montacargas/runtime/VehicleTrainingRuntime.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class', 'return class');
const Training = new Function('THREE', 'trainingSchema', source)(THREE, schema);
const clone = value => JSON.parse(JSON.stringify(value));
const checkpointSource = fs.readFileSync(path.resolve(__dirname, '../../modules/logistica-industrial/runtime/SimulationCheckpoint.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const checkpoint = new Function('THREE', 'createProductVisual', 'createSourceProductVisual', checkpointSource + '\nreturn {captureSimulation,restoreSimulation};')(THREE, () => new THREE.Group(), () => new THREE.Group());

function lessonFixture(count = 1) {
  const root = new THREE.Group(), object = new THREE.Group(), forks = new THREE.Group(), load = new THREE.Group(); root.add(object, load); object.add(forks);
  const task = {id: 'lesson-1', name: 'Pallet exacto', productId: 'PALLET-01', sourceId: 'source', destinationId: 'destination', destinationSlot: 0, scoring: true, pickupRoute: [{x: 0, z: 1}], route: [{x: 0, z: 2}]};
  const tasks = Array.from({length: count}, (_, index) => ({...task, id: 'lesson-' + (index + 1), productId: 'PALLET-0' + (index + 1), pickupRoute: [{x: 0, z: 1 + index * 3}], route: [{x: 0, z: 2 + index * 3}]}));
  const record = {id: 'truck', object, components: {vehicle: {distance: 0, config: {trainingTasksJson: JSON.stringify(tasks), speed: 1.35, reverseSpeed: .85, forkSpread: .48, forkWidth: .1, forkLength: 1.1, forkThickness: .04}, training: {index: 0, completed: [], scoring: schema.score.create(schema.parse(JSON.stringify(tasks)))}}}};
  const product = {id: task.productId, object: load, bounds: new THREE.Box3(new THREE.Vector3(-.6, 0, -.4), new THREE.Vector3(.6, .4, .4)), item: {palletOwnerId: task.sourceId}, sourceEntry: {ownerId: task.sourceId}};
  const events = [], runtime = {roomId: 'hall', document: {getRoot: () => root}, records: new Map([[record.id, record]]), products: new Map([[load, product]]), palletQueueRuntime: {palletIdentity: p => p.id}, vehicleRuntime: {rig: () => ({forks})}, event: (id, type, message) => events.push({id, type, message})};
  const api = new Training(runtime); api.beginRoute(record, 'pickup');
  const move = z => {const before = object.position.z; object.position.z = z; record.components.vehicle.distance += Math.abs(z - before); root.updateMatrixWorld(true); api.step(1 / 60);};
  const drive = z => {while (Math.abs(z - object.position.z) > .000001) move(object.position.z + Math.sign(z - object.position.z) * Math.min(.01, Math.abs(z - object.position.z)));};
  const pickup = () => {drive(1); record.components.vehicle.entry = {product}; api.onPickup(record);};
  const deposit = () => {drive(2); product.sourceEntry.ownerId = task.destinationId; product.item.palletOwnerId = task.destinationId; product.item.palletIndex = task.destinationSlot; product.object.position.set(0, 0, 2); record.components.vehicle.entry = null; root.updateMatrixWorld(true); api.onDrop(record, product, {kind: 'stock', targetId: task.destinationId, placement: {palletIndex: 0}});};
  return {root, record, product, task, tasks, api, events, drive, pickup, deposit, state: () => record.components.vehicle.training};
}
function attachLesson(f, withProduct = true) {
  const product = withProduct && f.runtime.products.get(f.pallet), identity = product ? f.runtime.palletQueueRuntime.palletIdentity(product) : 'absent-pallet';
  const tasks = [{id: 'physical-lesson', name: 'Práctica real', productId: identity, sourceId: 'training-source', destinationId: 'training-destination', destinationSlot: 0, pickupRoute: [], route: [], scoring: true}];
  f.v.config.trainingTasksJson = JSON.stringify(tasks);
  f.v.training = {index: 0, completed: [], scoring: schema.score.create(schema.parse(JSON.stringify(tasks)))};
  if (product) {const entry = f.runtime.sourceRuntime.entryForProduct(f.record, product); entry.ownerId = tasks[0].sourceId; product.item.palletOwnerId = tasks[0].sourceId;}
  const api = f.runtime.vehicleTraining = new Training(f.runtime); api.beginRoute(f.record, 'pickup');
  return api;
}
function simulate(f, training, seconds, input) {
  for (let time = 0; time < seconds - 1e-9; time += 1 / 60) {
    f.api.setInput(f.record, input); f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.beginFrame(); f.runtime.time += 1 / 60; f.api.step(1 / 60); training.step(1 / 60); f.ctx.collisionWorld.endFrame();
  }
}
function run() {
  assert.throws(() => schema.parse(JSON.stringify([{id: 'bad', name: 'x', productId: 'p', sourceId: 's', destinationId: 'd', destinationSlot: 0, scoring: 'true'}])));
  const f = lessonFixture(2), {api: a, record: r} = f;
  assert.equal(a.guidance(r).stage, 'approach'); assert.equal(a.guidance(r).score, 0); assert.equal(a.guidance(r).scoreMax, 330);
  assert.equal(a.variables(r).warehouseFeedback, '', 'An empty feedback readout is a string rather than a null/object value.');
  assert.deepEqual(a.guidance(r).stages.map(stage => stage.status), ['active', 'locked', 'locked', 'locked', 'locked', 'locked']);
  assert(a.validatePickup(r, {...f.product, id: 'PALLET-02'}));
  f.drive(1); assert.equal(a.guidance(r).stage, 'pickup'); assert.equal(a.guidance(r).score, 0, 'Approach markers alone earn no pickup points.');
  r.components.vehicle.entry = {product: f.product}; a.onPickup(r);
  assert.equal(a.guidance(r).stage, 'transport'); assert.equal(a.guidance(r).score, 20);
  assert.equal(typeof a.variables(r).warehouseFeedback, 'string'); assert.equal(a.variables(r).warehouseFeedback, a.guidance(r).feedback.text); assert.equal(typeof a.guidance(r).feedback, 'object', 'The mission coach retains structured feedback while variable readouts receive readable text.');
  const pickupState = clone(f.state()); a.onPickup(r); assert.equal(a.guidance(r).score, 20, 'Duplicate pickup hook earns nothing.');
  assert(a.validateState(r)); r.components.vehicle.training = pickupState; assert(a.validateState(r)); a.onPickup(r); assert.equal(a.guidance(r).score, 20, 'Restored pickup reward remains consumed.');
  f.drive(2); assert.equal(a.guidance(r).score, 40); assert.equal(a.guidance(r).stage, 'align');
  a.runtime.vehicleRuntime.releasePlan = () => ({ready: true}); a.destination = () => ({kind: 'stock'});
  assert.equal(a.guidance(r).stage, 'drop', 'Only physical release readiness unlocks deposit instruction.'); delete a.runtime.vehicleRuntime.releasePlan;
  const beforeRead = clone(f.state()); for (let index = 0; index < 20; index++) {a.guidance(r); a.variables(r); a.validateDrop(r, {kind: 'stock', targetId: f.task.destinationId, placement: {palletIndex: 1}});} assert.deepEqual(f.state(), beforeRead, 'Guidance and validation polling never penalize a learner.');
  f.deposit(); assert.equal(a.guidance(r).stage, 'withdraw'); assert.equal(a.guidance(r).score, 40); a.step(1 / 60); assert.equal(a.guidance(r).completed, 0);
  f.drive(.3); assert.equal(a.guidance(r).completed, 1); assert.equal(a.guidance(r).taskId, 'lesson-2'); assert.equal(a.guidance(r).score, 165); assert.equal(a.guidance(r).stage, 'approach');
  assert.equal(a.guidance(r).rewards.length, 4); assert.equal(a.guidance(r).badges.length, 1); assert(a.validateState(r));
  const saved = clone(f.state()); a.onDrop(r, f.product, {kind: 'stock', targetId: f.task.destinationId}); assert.equal(a.guidance(r).score, 165);
  for (const corrupt of [state => {state.scoring.score++;}, state => {state.scoring.rewardKeys.push(state.scoring.rewardKeys[0]);}, state => {state.scoring.rewardKeys.pop();}, state => {state.scoring.program = 'another';}, state => {state.scoring.ledger.push(state.scoring.feedback);}, state => {state.scoring.missionErrors[1] = -1;}, state => {state.scoring.cooldowns.collision = Infinity;}]) {r.components.vehicle.training = clone(saved); corrupt(f.state()); assert.equal(a.validateState(r), false);}
  r.components.vehicle.training = saved; assert(a.validateState(r));

  const clean = lessonFixture(); clean.pickup(); clean.deposit(); clean.drive(.3); assert.equal(clean.api.guidance(clean.record).score, 165); assert.equal(clean.api.guidance(clean.record).stage, 'complete'); assert(clean.api.validateState(clean.record));
  const terminal = clone(clean.state()); for (let i = 0; i < 10; i++) {clean.api.onPickup(clean.record); clean.api.step(1 / 60); clean.api.onAttemptFailed(clean.record, 'pickup', {reason: 'retry'});} assert.deepEqual(clean.state(), terminal, 'Completed state cannot replay rewards or receive post-completion penalties.');
  const dirty = lessonFixture(); dirty.pickup(); dirty.api.onAttemptFailed(dirty.record, 'drop', {kind: 'stock', targetId: 'wrong', reason: 'Destino incorrecto.'}); assert.equal(dirty.api.guidance(dirty.record).score, 10); assert.equal(dirty.api.guidance(dirty.record).feedback.points, -10);
  const errorCount = dirty.api.guidance(dirty.record).errorCount; dirty.api.onAttemptFailed(dirty.record, 'drop', {kind: 'stock', targetId: 'wrong', reason: 'Destino incorrecto.'}); assert.equal(dirty.api.guidance(dirty.record).errorCount, errorCount);
  dirty.deposit(); dirty.drive(.3); assert.equal(dirty.api.guidance(dirty.record).score, 130); assert(!dirty.api.guidance(dirty.record).badges.some(badge => badge.id.startsWith('clean:'))); assert(dirty.api.validateState(dirty.record));
  const honestDirty = clone(dirty.state()); dirty.state().scoring.deducted = 0; dirty.state().scoring.score = dirty.state().scoring.earned; dirty.state().scoring.feedback.score = dirty.state().scoring.score; dirty.state().scoring.ledger[dirty.state().scoring.ledger.length - 1].score = dirty.state().scoring.score; assert.equal(dirty.api.validateState(dirty.record), false, 'A checkpoint cannot erase deductions while retaining the real debit history.'); dirty.record.components.vehicle.training = honestDirty;
  dirty.state().scoring.feedback.cycle = dirty.state().scoring.feedback; assert.doesNotThrow(() => assert.equal(dirty.api.validateState(dirty.record), false), 'Malformed cyclic feedback is rejected without a JSON stringify exception.');
  const newMission = lessonFixture(2); newMission.pickup(); newMission.deposit(); newMission.api.onCollision(newMission.record); newMission.drive(.3); assert.equal(newMission.state().index, 1); newMission.api.onCollision(newMission.record); assert.equal(newMission.api.guidance(newMission.record).errorCount, 2, 'Cooldowns for an earlier mission cannot suppress the new mission’s first error.'); assert(newMission.api.validateState(newMission.record));
  const unsafe = lessonFixture(); unsafe.pickup(); unsafe.api.onAttemptFailed(unsafe.record, 'drop', {kind: 'stock', targetId: unsafe.task.destinationId, placement: {palletIndex: 0}, reason: 'Baja y nivela la carga.'}); assert.equal(unsafe.api.guidance(unsafe.record).score, 15); assert.equal(unsafe.api.guidance(unsafe.record).feedback.points, -5); unsafe.api.onCollision(unsafe.record); assert.equal(unsafe.api.guidance(unsafe.record).score, 0); assert.equal(unsafe.api.guidance(unsafe.record).feedback.points, -15); assert(unsafe.api.validateState(unsafe.record));
  const cachedStage = lessonFixture(); cachedStage.pickup(); cachedStage.drive(2); cachedStage.api.runtime.time = 10;
  let stageProbes = 0, dropReady = false; cachedStage.api.runtime.vehicleRuntime.releasePlan = () => {stageProbes++; return {ready: dropReady};};
  const stageScore = clone(cachedStage.state().scoring);
  for (let index = 0; index < 100; index++) assert.equal(cachedStage.api.variables(cachedStage.record).warehouseStage, 'align');
  assert.equal(stageProbes, 0, 'Per-frame variable reads never probe release geometry.');
  assert.equal(cachedStage.api.stage(cachedStage.record), 'align'); assert.equal(stageProbes, 1);
  for (let index = 0; index < 100; index++) {cachedStage.api.variables(cachedStage.record); cachedStage.api.guidance(cachedStage.record);}
  assert.equal(stageProbes, 1, 'Guidance shares a read-only stage probe for 200 ms.');
  dropReady = true; cachedStage.api.runtime.time += .19; assert.equal(cachedStage.api.stage(cachedStage.record), 'align'); assert.equal(stageProbes, 1);
  cachedStage.api.runtime.time += .02; assert.equal(cachedStage.api.stage(cachedStage.record), 'drop'); assert.equal(stageProbes, 2);
  for (let index = 0; index < 100; index++) assert.equal(cachedStage.api.variables(cachedStage.record).warehouseStage, 'drop');
  assert.equal(stageProbes, 2, 'Cached drop readiness never adds probes during variable refresh.');
  cachedStage.state().phase = 'withdraw'; assert.equal(cachedStage.api.stage(cachedStage.record), 'withdraw'); assert.equal(stageProbes, 2, 'A custody phase change is visible immediately without a readiness probe.');
  cachedStage.state().phase = 'drop'; assert.equal(cachedStage.api.variables(cachedStage.record).warehouseStage, 'align', 'Changing phase invalidates stale docking readiness.'); assert.equal(stageProbes, 2);
  assert.deepEqual(cachedStage.state().scoring, stageScore, 'Transient stage caching never changes score, rewards or checkpoint state.');
  const bounded = lessonFixture(); for (let i = 0; i < 90; i++) {bounded.state().scoring.clock += 3.01; bounded.api.onAttemptFailed(bounded.record, 'pickup', {reason: 'Alinea las horquillas.'});}
  assert.equal(bounded.api.guidance(bounded.record).score, 0); assert.equal(bounded.state().scoring.ledger.length, schema.score.LEDGER_LIMIT); assert.equal(bounded.api.guidance(bounded.record).errorCount, 90); assert(bounded.api.validateState(bounded.record));
  const feedback = bounded.api.guidance(bounded.record).feedback; feedback.score = 999; assert.equal(bounded.api.guidance(bounded.record).score, 0, 'Consumers receive detached feedback.');

  const real = vehicleFixture(); const realTraining = attachLesson(real); const product = real.runtime.products.get(real.pallet); real.pallet.position.x = .4; real.scene.updateMatrixWorld(true);
  for (let i = 0; i < 12; i++) {real.api.pickupPlan(real.record); real.api.getDockingState(real.record); realTraining.guidance(real.record);} assert.equal(real.v.training.scoring.errorCount, 0);
  assert.equal(real.api.pickup(real.record), false); assert.equal(real.v.training.scoring.errorCount, 0, 'Automatic/internal attempts are not learner errors.');
  assert.equal(real.api.command(real.record, 'pickup'), false); assert.equal(real.v.training.scoring.errorCount, 1); assert.equal(real.v.training.scoring.feedback.code, 'unsafe-pickup');
  real.api.command(real.record, 'pickup'); assert.equal(real.v.training.scoring.errorCount, 1, 'Held/repeated user action is debounced.');
  real.pallet.position.x = 0; real.scene.updateMatrixWorld(true); assert(real.api.command(real.record, 'pickup')); assert.equal(real.v.training.scoring.score, 20); assert.equal(real.v.entry.product, product);
  const noPoll = clone(real.v.training); for (let i = 0; i < 12; i++) {real.api.releasePlan(real.record); real.api.getDockingState(real.record); realTraining.guidance(real.record);} assert.deepEqual(real.v.training, noPoll);
  real.api.command(real.record, 'pause'); real.api.command(real.record, 'pause'); assert.equal(real.v.training.scoring.errorCount, 1);
  const savedPhysical = clone(checkpoint.captureSimulation(real.runtime));
  assert.equal(real.api.command(real.record, 'release'), false); assert.equal(real.v.training.scoring.score, 10); assert.equal(real.v.training.scoring.feedback.code, 'wrong-destination'); assert(realTraining.validateState(real.record));
  checkpoint.restoreSimulation(real.runtime, savedPhysical, {reuse: true}); real.record = real.runtime.records.get(real.object.userData.editorId); real.v = real.record.components.vehicle;
  assert.equal(real.v.training.scoring.score, 20); assert.equal(real.v.training.scoring.errorCount, 1); assert(realTraining.validateState(real.record)); realTraining.onPickup(real.record); assert.equal(real.v.training.scoring.score, 20, 'Actual shared checkpoint restores consumed rewards with physical custody.');
  const forgedPhysical = clone(savedPhysical), scoreNode = forgedPhysical.graph.nodes.find(node => node.t === 'object' && node.v.program && Object.prototype.hasOwnProperty.call(node.v, 'rewardKeys')); assert(scoreNode); scoreNode.v.score = 999; assert.throws(() => checkpoint.restoreSimulation(real.runtime, forgedPhysical, {reuse: true}), /práctica de almacén/); real.runtime.stop();

  const collision = vehicleFixture('forklift-electric-4w', true, false), collisionTraining = attachLesson(collision, false), wall = new THREE.Mesh(new THREE.BoxBufferGeometry(.16, .16, .04), new THREE.MeshBasicMaterial()); wall.position.set(collision.config.forkSpread / 2, .08, collision.config.length / 2 + collision.config.forkLength + .10); collision.root.add(wall); collision.ctx.collisionWorld.invalidate(wall);
  simulate(collision, collisionTraining, 5, {throttle: 1}); assert(collision.v.blocked); assert.equal(collision.v.training.scoring.errorCount, 1, 'Continuous physical contact is one collision edge.'); assert.equal(collision.v.training.scoring.feedback.penalty, 15); assert.equal(collision.v.training.scoring.score, 0);
  simulate(collision, collisionTraining, 1.5, {throttle: -1}); assert(!collision.v.blocked); simulate(collision, collisionTraining, 4, {throttle: 1}); assert.equal(collision.v.training.scoring.errorCount, 2, 'A new contact after withdrawal and cooldown is a new error.'); assert(collisionTraining.validateState(collision.record)); collision.runtime.stop();
  const automatic = vehicleFixture('forklift-electric-4w', true, false), autoTraining = attachLesson(automatic, false), autoWall = wall.clone(); automatic.root.add(autoWall); automatic.ctx.collisionWorld.invalidate(autoWall); automatic.v.config.mode = 'automatic'; automatic.api.automatic = () => ({throttle: 1, steer: 0, brake: 0, lift: 0, tilt: 0, reach: 0, sideShift: 0, turret: 0}); simulate(automatic, autoTraining, 5, {}); assert(automatic.v.blocked); assert.equal(automatic.v.training.scoring.errorCount, 0, 'An automatic collision does not penalize the learner.'); automatic.runtime.stop();
  const empty = vehicleFixture('forklift-electric-4w', true, false), emptyEvents = empty.runtime.events.length, emptyWarning = empty.v.warning; assert.equal(empty.api.command(empty.record, 'release'), false); assert.equal(empty.runtime.events.length, emptyEvents); assert.equal(empty.v.warning, emptyWarning, 'A vehicle without training retains its original empty-release behavior.'); empty.runtime.stop();
  const legacy = lessonFixture(); const rows = JSON.parse(legacy.record.components.vehicle.config.trainingTasksJson); delete rows[0].scoring; legacy.record.components.vehicle.config.trainingTasksJson = JSON.stringify(rows); delete legacy.state().scoring; assert.equal(legacy.api.guidance(legacy.record).scoreMax, 0); assert(legacy.api.validateState(legacy.record));
  const structured = f.events.filter(event => event.type === 'warehouse-score-reward').map(event => JSON.parse(event.message)); assert.deepEqual(structured.map(event => event.points), [20, 20, 100, 25]); assert(structured.every(event => event.text.includes('puntos') && event.taskId === 'lesson-1'));
  console.log('Warehouse score: verified staged progression, once-only rewards, clean badges, explicit penalties, polling isolation, physical collision edges, bounded JSON checkpoints and replay rejection passed.');
}
module.exports = {run, lessonFixture, Training}; if (require.main === module) run();
