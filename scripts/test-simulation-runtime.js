// Real Three.js geometry and world transforms; no renderer or physical PLC needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const ObjectPlacement = require('./load-object-placement')(THREE);
const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);
const behaviorSchema = require('../shared/behaviors.js');
const automationSchema = require('../shared/automation.js');
const PalletQueueRuntime = require('./load-pallet-queue-runtime.js')(THREE, behaviorSchema);
const ProcessorRuntime = require('./load-processor-runtime.js')(THREE, behaviorSchema);
const ProductSourceRuntime = require('./load-product-source-runtime')(THREE, behaviorSchema);
const {normalizeBehaviors, defaultBehavior, simulationTypes} = behaviorSchema;
const prefabSource = fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialPrefabs.js'), 'utf8')
  .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const {createProductVisual} = new Function('THREE', 'behaviorSchema', prefabSource + '\nreturn {createProductVisual};')(THREE, behaviorSchema);
const source = fs.readFileSync(path.join(__dirname, '../src/editor/SimulationRuntime.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class SimulationRuntime', 'return class SimulationRuntime');
const productFeedbackSource = fs.readFileSync(path.join(__dirname, '../src/editor/ProductFeedback.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class ProductFeedback', 'return class ProductFeedback');
const ProductFeedback = new Function('THREE', productFeedbackSource)(THREE);
const SimulationRuntime = new Function('THREE', 'behaviorSchema', 'automationSchema', 'createProductVisual', 'ProductFeedback', 'ObjectPlacement', 'ProductSourceRuntime', 'ProcessorRuntime', 'PalletQueueRuntime', source)(THREE, behaviorSchema, automationSchema, createProductVisual, ProductFeedback, ObjectPlacement, ProductSourceRuntime, ProcessorRuntime, PalletQueueRuntime);
const collisionSource = fs.readFileSync(path.join(__dirname, '../src/lib/CollisionWorld.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class CollisionWorld', 'return class CollisionWorld');
const CollisionWorld = new Function('THREE', 'getGeometryTree', collisionSource)(THREE, getGeometryTree);

function actor(id, behaviors, mesh) {
  const object = new THREE.Group(); object.name = id;
  object.userData.editorId = id; object.userData.editorBehaviors = behaviors;
  if (mesh) object.add(mesh);
  return object;
}
function box(x, y, z) { return new THREE.Mesh(new THREE.BoxBufferGeometry(x, y, z), new THREE.MeshBasicMaterial()); }
function harness(objects, root, collisions = false) {
  const scene = root || new THREE.Scene();
  objects.forEach(object => { if (!object.parent) scene.add(object); });
  const notices = [];
  const nativeState = {};
  const ctx = {scene, editor: {active: false}, raycontrol: {
    states: {native: nativeState}, addState(name, state) { this.states[name] = state; },
    activateState() {}, deactivateState() {}
  }};
  const document = {getObjects: () => objects, getRoot: () => scene, getBehaviors: object => object.userData.editorBehaviors};
  if (collisions) ctx.collisionWorld = new CollisionWorld(ctx, document);
  const runtime = new SimulationRuntime(ctx, document, message => notices.push(message));
  runtime.start('hall');
  return {runtime, ctx, notices, scene, nativeState};
}
function advance(runtime, seconds, step = 1 / 60) { for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) runtime.execute(Math.min(step, seconds - elapsed)); }
function row(runtime, id) { return runtime.getSnapshot().objects.find(object => object.id === id); }
function close(actual, expected, label) { assert(Math.abs(actual - expected) < 1e-7, label || `${actual} != ${expected}`); }
const clickController = new THREE.Group();
function click(state) {
  const hit = {distance: 1};
  state.onSelectStart(hit, clickController);
  state.onSelectEnd(hit, clickController);
}

for (const type of simulationTypes) {
  assert.deepEqual(normalizeBehaviors([{type}]), [defaultBehavior(type)]);
}
assert.throws(() => normalizeBehaviors([{type: 'conveyor', maxPackages: 1.5}]), /entero/);
assert.throws(() => normalizeBehaviors([{type: 'sensor', sourceId: '__proto__'}]), /Referencia/);
assert.throws(() => normalizeBehaviors([{type: 'control', variable: 'speed', mode: 'toggle'}]), /velocidad/);
assert.throws(() => normalizeBehaviors([{type: 'automation', rules: 'eval("anything")'}]), /JSON/);
const rule = {sourceId: 'sensor', variable: 'active', operator: 'eq', value: true, targetId: 'belt', targetVariable: 'running', set: false, edge: 'rising'};
assert.deepEqual(automationSchema.normalizeRules(JSON.stringify([rule])), [rule]);
assert.throws(() => automationSchema.normalizeRules([Object.assign({}, rule, {script: 'code'})]), /desconocidos/);
assert.throws(() => automationSchema.normalizeRules([Object.assign({}, rule, {value: 1})]), /tipo/);
assert.throws(() => automationSchema.normalizeRules([Object.assign({}, rule, {operator: 'gt'})]), /tipo/);
assert.throws(() => automationSchema.normalizeRules([Object.assign({}, rule, {targetVariable: 'speed', set: Infinity})]), /valor/);
assert.throws(() => automationSchema.normalizeRules([Object.assign({}, rule, {targetVariable: 'speed', set: 21})]), /rango/);
assert.throws(() => automationSchema.normalizeRules(Array(65).fill(rule)), /64/);
assert.throws(() => normalizeBehaviors([{type: 'motion', speed: NaN}]), /rango/);
assert.deepEqual(normalizeBehaviors([{type: 'collision'}]), [{type: 'collision', enabled: true, mode: 'solid'}]);
assert.equal(normalizeBehaviors([{type: 'collision', mode: 'trigger', enabled: false}])[0].mode, 'trigger');
assert.throws(() => normalizeBehaviors([{type: 'collision', mode: 'rigid-body'}]), /inválida/);

// A scaled/rotated belt keeps its travel measured in world meters. A sensor can
// be nested under it and still receives packages at the transformed location.
const belt = actor('belt', [{type: 'conveyor', speed: 1, spawnInterval: 120}, {type: 'analytics', interval: 0.2}], box(4, 0.1, 1));
belt.userData.editorConveyorTop = 0;
belt.position.set(2, 1, -3); belt.rotation.y = Math.PI / 3; belt.scale.set(2, 0.5, 1.5);
const sensor = actor('sensor', [{type: 'sensor', sourceId: 'belt'}], box(0.06, 1, 0.8));
sensor.position.set(0.775, 0.3, 0); belt.add(sensor);
const h = harness([belt, sensor]);
assert.equal(h.runtime.getSnapshot().events[0].objectId, 'simulation', 'Global events have a nonempty telemetry reference');
advance(h.runtime, 0.5);
let beltRow = row(h.runtime, 'belt');
assert.equal(beltRow.variables.entryCount, 1); assert.equal(beltRow.variables.inFlight, 1);
assert.equal(beltRow.analyticsInterval, 0.2); assert.equal(beltRow.analytics.enabled, true);
assert(beltRow.writable.some(field => field.key === 'speed' && field.type === 'number'));
const packageState = h.runtime.records.get('belt').components.conveyor.packages[0];
const worldOffset = packageState.mesh.getWorldPosition(new THREE.Vector3()).sub(belt.getWorldPosition(new THREE.Vector3()));
const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(belt.getWorldQuaternion(new THREE.Quaternion()));
close(worldOffset.dot(forward), -1.5, 'Scale must not multiply conveyor speed');
h.runtime.setVariable('belt', 'emergency', true);
assert.equal(row(h.runtime, 'belt').variables.actualSpeed, 0);
assert.equal(row(h.runtime, 'belt').variables.running, false, 'Emergency latches the stopped state');
assert.throws(() => h.runtime.setVariable('belt', 'running', true), /emergencia antes de arrancar/);
const heldOffset = packageState.offset; advance(h.runtime, 0.5); close(packageState.offset, heldOffset);
h.runtime.setVariable('belt', 'emergency', false);
advance(h.runtime, 0.5); close(packageState.offset, heldOffset, 'Releasing emergency keeps a stopped belt stopped');
h.runtime.setVariable('belt', 'running', true);
advance(h.runtime, 3.3);
assert.equal(row(h.runtime, 'sensor').variables.count, 1, 'Transformed sensor counts a passing package once');
advance(h.runtime, 1);
assert.equal(row(h.runtime, 'belt').variables.exitCount, 0); assert.equal(row(h.runtime, 'belt').variables.inFlight, 1, 'An unconnected outlet retains its load.');
assert.equal(row(h.runtime, 'sensor').variables.active, true, 'The retained carton still occupies the outlet sensor volume.');
assert(h.runtime.getSnapshot().events.some(event => event.type === 'sensor-edge'));
assert.throws(() => h.runtime.setVariable('belt', 'speed', NaN), /inválido/);
assert.throws(() => h.runtime.setVariable('belt', 'speed', 21), /inválido/);
assert.throws(() => h.runtime.setVariable('belt', 'running', 1), /inválido/);
assert.throws(() => h.runtime.setVariable('belt', 'exitCount', 1), /lectura/);
assert.throws(() => h.runtime.setVariable('missing', 'speed', 1), /objeto/);
assert.doesNotThrow(() => JSON.stringify(h.runtime.getSnapshot()));
assert(h.runtime.getSnapshot().objects.every(object => Object.entries(object.variables).every(([key, value]) =>
  key === 'supplyMode' ? ['external', 'internal', 'manual'].includes(value) : typeof value === 'boolean' || Number.isFinite(value))));
h.runtime.stop(); assert.equal(belt.children.some(child => child.userData.editorRuntimeHelper), false);
assert.equal(h.runtime.packageCount, 0); assert.equal(h.runtime.records.size, 0);
assert.deepEqual(belt.position.toArray(), [2, 1, -3]);

// A thin sensor must see a package that crosses entirely between render frames.
const fastBelt = actor('fast', [{type: 'conveyor', speed: 20, spawnInterval: 120}], box(4, 0.1, 1)); fastBelt.userData.editorConveyorTop = 0;
const thinSensor = actor('thin', [{type: 'sensor', sourceId: 'fast'}], box(0.001, 1, 1)); thinSensor.position.set(1.5, 0.2, 0);
const fast = harness([fastBelt, thinSensor]); fast.runtime.execute(0.25);
assert.equal(row(fast.runtime, 'thin').variables.count, 1, 'Swept bounds prevent high-speed sensor tunnelling');
assert.equal(row(fast.runtime, 'fast').variables.exitCount, 0); assert.equal(row(fast.runtime, 'fast').variables.inFlight, 1);
fast.runtime.execute(10); close(fast.runtime.getSnapshot().droppedSeconds, 9.75);
assert(fast.runtime.getSnapshot().time <= 0.5 + 1e-8, 'Suspended tabs do not run unbounded catch-up work');
fast.runtime.stop();

// Rules consume snapshots at fixed simulation steps and do not recurse. Rising
// edges trigger once; a level rule keeps enforcing its output each step.
const ruleBelt = actor('rule-belt', [{type: 'conveyor', speed: 1, spawnInterval: 120}], box(4, 0.1, 1)); ruleBelt.userData.editorConveyorTop = 0;
const ruleSensor = actor('rule-sensor', [{type: 'sensor', sourceId: 'rule-belt'}], box(0.1, 1, 1)); ruleSensor.position.set(-1.5, 0.2, 0);
const controller = actor('plc', [{type: 'automation', rules: JSON.stringify([Object.assign({}, rule, {sourceId: 'rule-sensor', targetId: 'rule-belt'})])}]);
const auto = harness([ruleBelt, ruleSensor, controller]); advance(auto.runtime, 1);
assert.equal(row(auto.runtime, 'rule-belt').variables.running, false);
assert.equal(row(auto.runtime, 'rule-sensor').variables.active, true);
auto.runtime.setVariable('rule-belt', 'running', true); advance(auto.runtime, 0.05);
assert.equal(row(auto.runtime, 'rule-belt').variables.running, true, 'Rising edge does not retrigger while occupied');
auto.runtime.stop();
controller.userData.editorBehaviors[0].rules = JSON.stringify([Object.assign({}, rule, {sourceId: 'rule-sensor', targetId: 'rule-belt', edge: 'level'})]);
auto.runtime.start('hall'); advance(auto.runtime, 1);
auto.runtime.setVariable('rule-belt', 'running', true); advance(auto.runtime, 1 / 60);
assert.equal(row(auto.runtime, 'rule-belt').variables.running, false, 'Level rule enforces a maintained interlock');
auto.runtime.stop();

// Motion and copies own their poses. A disabled editor or invisible actor cannot
// advance the simulation, and leaving play restores every authored transform.
const moving = actor('moving', [{type: 'motion', mode: 'linear', axis: 'x', speed: 2}]);
moving.position.set(1, 2, 3); moving.rotation.y = Math.PI / 2;
const copy = actor('copy', [{type: 'motion', mode: 'rotation', axis: 'y', speed: 1}]);
const motion = harness([moving, copy]); advance(motion.runtime, 0.5);
close(moving.position.x, 1); close(moving.position.z, 2); close(row(motion.runtime, 'copy').variables.position, 0.5);
motion.runtime.setVariable('moving', 'speed', -1); motion.runtime.setVariable('copy', 'enabled', false);
advance(motion.runtime, 0.5); close(moving.position.z, 2.5); close(row(motion.runtime, 'copy').variables.position, 0.5);
motion.ctx.editor.active = true; const pausedTime = motion.runtime.time; motion.runtime.execute(0.25); close(motion.runtime.time, pausedTime);
motion.ctx.editor.active = false; moving.visible = false; const pausedPosition = moving.position.clone(); advance(motion.runtime, 0.5); assert(moving.position.equals(pausedPosition));
motion.runtime.stop(); assert.deepEqual(moving.position.toArray(), [1, 2, 3]); close(copy.quaternion.angleTo(new THREE.Quaternion()), 0);

// Physical start/stop and emergency controls use the existing merged ray input
// path, so the same component works with desktop selection and XR controllers.
const controlledBelt = actor('controlled-belt', [{type: 'conveyor', running: false}], box(4, 0.1, 1));
const start = actor('start', [{type: 'control', targetId: 'controlled-belt', variable: 'running', mode: 'set', value: 1}]);
const emergency = actor('emergency', [{type: 'control', targetId: 'controlled-belt', variable: 'emergency', mode: 'toggle', value: 1}]);
const controls = harness([controlledBelt, start, emergency]);
assert.equal(controls.runtime.states.length, 2);
const startState = controls.runtime.states.find(entry => entry.state.colliderMesh === start).state;
const emergencyState = controls.runtime.states.find(entry => entry.state.colliderMesh === emergency).state;
assert(startState.mergeSelection && startState.consumeSelect); click(startState);
assert.equal(row(controls.runtime, 'controlled-belt').variables.running, true);
click(emergencyState); assert.equal(row(controls.runtime, 'controlled-belt').variables.emergency, true);
assert.equal(row(controls.runtime, 'controlled-belt').variables.running, false);
click(startState);
assert.equal(row(controls.runtime, 'controlled-belt').variables.running, false, 'Physical Start is blocked while emergency is latched');
assert(controls.notices.some(message => message.includes('emergencia antes de arrancar')));
click(emergencyState); assert.equal(row(controls.runtime, 'controlled-belt').variables.emergency, false);
assert.equal(row(controls.runtime, 'controlled-belt').variables.running, false, 'Emergency reset never restarts the belt');
click(startState); assert.equal(row(controls.runtime, 'controlled-belt').variables.running, true);
controls.ctx.editor.active = true; click(emergencyState); assert.equal(row(controls.runtime, 'controlled-belt').variables.emergency, false);
controls.ctx.editor.active = false;
for (let i = 0; i < 300; i++) click(emergencyState);
assert.equal(controls.runtime.events.length, 200, 'Event memory is bounded');
controls.runtime.stop(); assert.deepEqual(Object.keys(controls.ctx.raycontrol.states), ['native']); assert.equal(controls.ctx.raycontrol.states.native, controls.nativeState);

// Actual shared collision geometry blocks fast motion continuously. Once the
// obstacle is removed, motion resumes at its configured speed, with no stored
// displacement from the time it spent blocked.
const collisionActor = actor('collision-actor', [{type: 'motion', mode: 'linear', axis: 'x', speed: 20}], box(0.25, 0.5, 0.25));
collisionActor.position.y = 0.5;
const collisionWall = actor('collision-wall', [], box(0.05, 3, 3)); collisionWall.position.x = 1;
const colliding = harness([collisionActor, collisionWall], undefined, true);
advance(colliding.runtime, 0.5);
assert(collisionActor.position.x > 0.8 && collisionActor.position.x < 0.86, 'High-speed actor stops before a thin wall');
const contact = collisionActor.position.x;
advance(colliding.runtime, 0.5); close(collisionActor.position.x, contact);
collisionWall.visible = false;
advance(colliding.runtime, 1 / 60);
close(collisionActor.position.x - contact, 20 / 60, 'Removing an obstacle cannot release accumulated motion');
colliding.runtime.stop(); close(collisionActor.position.x, 0);
collisionWall.visible = true;
collisionActor.userData.editorBehaviors.push({type: 'collision', enabled: true, mode: 'trigger'});
colliding.runtime.start('hall'); advance(colliding.runtime, 0.25);
close(collisionActor.position.x, 5, 'An explicitly configured trigger does not behave as a solid moving actor');
colliding.runtime.stop();

// Intermediate orientation checks also stop a rotating beam. A final pose test
// alone would allow it to complete the turn through this obstacle.
const beam = actor('beam', [{type: 'motion', mode: 'rotation', axis: 'y', speed: 20}], box(2, 0.2, 0.2));
const beamStop = actor('beam-stop', [], box(0.1, 1, 0.1)); beamStop.position.set(0.8, 0, -0.55);
const rotationCollision = harness([beam, beamStop], undefined, true);
advance(rotationCollision.runtime, 0.25);
const stoppedAngle = row(rotationCollision.runtime, 'beam').variables.position;
assert(stoppedAngle > 0 && stoppedAngle < 0.9, 'A rotating actor stops at an intermediate contact');
advance(rotationCollision.runtime, 0.25); close(row(rotationCollision.runtime, 'beam').variables.position, stoppedAngle);
rotationCollision.runtime.setVariable('beam', 'speed', -20);
advance(rotationCollision.runtime, 1 / 60);
assert(row(rotationCollision.runtime, 'beam').variables.position < stoppedAngle, 'Reversing motion frees a stopped actor');
rotationCollision.runtime.stop(); close(beam.quaternion.angleTo(new THREE.Quaternion()), 0);

// Generated packages share physical collision with the scene and form a queue
// instead of overlapping. The sensor remains a trigger along the same path.
const queueBelt = actor('queue-belt', [{type: 'conveyor', speed: 4, spawnInterval: 0.1, maxPackages: 30}], box(4, 0.1, 1));
queueBelt.userData.editorConveyorTop = 0;
const queueSensor = actor('queue-sensor', [{type: 'sensor', sourceId: 'queue-belt'}], box(0.01, 1, 0.8));
queueSensor.position.set(-1.4, 0.2, 0);
const queueStop = actor('queue-stop', [], box(0.05, 1, 1)); queueStop.position.set(0, 0.4, 0);
const queue = harness([queueBelt, queueSensor, queueStop], undefined, true);
advance(queue.runtime, 2);
const queued = queue.runtime.records.get('queue-belt').components.conveyor.packages;
assert(queued.length > 2 && queued.length < 9, 'Blocked flow fills the available space and stops spawning at an occupied entry');
assert.equal(row(queue.runtime, 'queue-belt').variables.exitCount, 0);
assert(row(queue.runtime, 'queue-sensor').variables.count > 0, 'Sensors detect passing physical packages without blocking them');
assert(queued.every(item => item.mesh.userData.editorCollisionBody === true && item.box.max.x <= -0.02), 'Packages remain before the wall and are camera collision bodies');
for (let i = 0; i < queued.length; i++) for (let j = i + 1; j < queued.length; j++) {
  assert(!queued[i].box.clone().expandByScalar(-0.005).intersectsBox(queued[j].box.clone().expandByScalar(-0.005)), 'Queued packages cannot overlap');
}
const queueCount = row(queue.runtime, 'queue-belt').variables.entryCount;
advance(queue.runtime, 0.5); assert.equal(row(queue.runtime, 'queue-belt').variables.entryCount, queueCount);
queueStop.visible = false; advance(queue.runtime, 2);
assert(queued.some(item => item.offset > 0.5), 'Removing the obstruction releases packages toward the unconnected outlet without deleting them');
queue.runtime.stop(); assert.equal(queueBelt.children.some(child => child.userData.editorRuntimeHelper), false);

// Multiple fixed steps and all packages share the enclosing render snapshot.
// Looking away must not pause production, sensors or PLC state.
const batchedBelt = actor('batched-belt', [{type: 'conveyor', speed: 4, spawnInterval: 0.1, maxPackages: 30}], box(4, 0.1, 1));
batchedBelt.userData.editorConveyorTop = 0;
const batchedSensor = actor('batched-sensor', [{type: 'sensor', sourceId: 'batched-belt'}], box(0.01, 1, 0.8));
batchedSensor.position.set(-1.6, 0.2, 0);
const batched = harness([batchedBelt, batchedSensor], undefined, true);
batched.ctx.performanceVisibility = {isVisible: () => false};
const idle = box(1, 1, 1); idle.position.set(100, 100, 100); batched.scene.add(idle);
let idleUpdates = 0;
const updateIdle = idle.updateWorldMatrix.bind(idle);
idle.updateWorldMatrix = (...args) => { idleUpdates++; return updateIdle(...args); };
const world = batched.ctx.collisionWorld;
let refreshes = world.stats.refreshes;
world.beginFrame();
batched.runtime.execute(0.25);
assert(world.frameActive, 'A simulation must not end the render loop own collision frame.');
assert.equal(world.stats.refreshes, refreshes + 1, 'Fifteen simulation steps share one full scene collision traversal.');
assert.equal(idleUpdates, 1, 'Fixed substeps do not repeatedly update unrelated static scenery.');
assert(row(batched.runtime, 'batched-belt').variables.entryCount > 1, 'Offscreen production continues.');
assert(row(batched.runtime, 'batched-sensor').variables.count > 0, 'Offscreen sensors continue counting.');
const batchedPackages = batched.runtime.records.get('batched-belt').components.conveyor.packages;
assert(batchedPackages.length > 1);
batchedPackages.forEach(item => {
  const entry = world.entries.find(entry => entry.object === item.mesh);
  assert(entry && entry.box.equals(item.box), 'New packages expose their latest pose to camera collisions within the same render frame.');
});
world.endFrame();
refreshes = world.stats.refreshes;
batched.runtime.execute(0.25);
assert.equal(world.stats.refreshes, refreshes + 1, 'Standalone simulation calls also batch their package queries.');
assert.equal(world.frameActive, false, 'A simulation releases only the frame it opened.');
world.beginFrame(); world.refresh();
batched.runtime.stop();
assert(!world.entries.some(entry => entry.object.userData.editorCollisionBody), 'Stopping removes every package collision entry immediately.');
world.endFrame();

// New machines separate electrical power, start/stop, pause and manual supply.
// Existing scenes keep their former powered/automatic behavior by default.
assert.equal(defaultBehavior('conveyor').powered, true);
assert.equal(defaultBehavior('conveyor').autoSpawn, true);
assert.throws(() => normalizeBehaviors([{type: 'conveyor', powered: 1}]), /inválido/);
assert.throws(() => normalizeBehaviors([{type: 'product', sourceId: '../belt'}]), /Referencia/);
const manualBeltMesh = box(4, 0.1, 1); manualBeltMesh.position.y = -0.05;
const manualBelt = actor('manual-belt', [{type: 'conveyor', powered: false, running: false, autoSpawn: false, speed: 1}], manualBeltMesh);
manualBelt.userData.editorConveyorTop = 0;
const power = harness([manualBelt], undefined, true);
assert.throws(() => power.runtime.command('manual-belt', 'start'), /alimentación/);
power.runtime.command('manual-belt', 'powerOn');
assert.equal(row(power.runtime, 'manual-belt').variables.running, false, 'Power alone cannot start machinery.');
power.runtime.command('manual-belt', 'start');
power.runtime.execute(0.25);
assert.equal(row(power.runtime, 'manual-belt').variables.entryCount, 0, 'Manual supply never spawns automatically.');
assert(power.runtime.insertProduct('manual-belt'));
power.runtime.execute(1 / 60);
let manualPackages = power.runtime.records.get('manual-belt').components.conveyor.packages;
assert.equal(manualPackages.length, 1);
assert(manualPackages[0].mesh.children.length > 0, 'Runtime boxes use the detailed carton visual.');
const firstManualOffset = manualPackages[0].offset;
power.runtime.command('manual-belt', 'pause'); advance(power.runtime, 0.5);
close(manualPackages[0].offset, firstManualOffset);
assert.equal(row(power.runtime, 'manual-belt').variables.paused, true);
assert.equal(row(power.runtime, 'manual-belt').variables.actualSpeed, 0);
power.runtime.command('manual-belt', 'start');
power.runtime.command('manual-belt', 'speedUp', 0.25);
close(row(power.runtime, 'manual-belt').variables.speed, 1.25);
advance(power.runtime, 0.2);
assert(manualPackages[0].offset > firstManualOffset);
power.runtime.command('manual-belt', 'powerOff');
assert.equal(row(power.runtime, 'manual-belt').variables.running, false);
assert.equal(row(power.runtime, 'manual-belt').variables.paused, false);
power.runtime.command('manual-belt', 'powerOn');
assert.equal(row(power.runtime, 'manual-belt').variables.actualSpeed, 0, 'Power cycling never restarts machinery.');
power.runtime.command('manual-belt', 'speedDown', 30);
assert.equal(row(power.runtime, 'manual-belt').variables.speed, -20, 'Speed controls clamp to the supported range.');
power.runtime.command('manual-belt', 'speedUp', 50);
assert.equal(row(power.runtime, 'manual-belt').variables.speed, 20);
power.runtime.command('manual-belt', 'stop');
assert.throws(() => power.runtime.command('manual-belt', 'untrusted-code'), /compatible/);
power.runtime.stop();

// Supply mode is a writable, strictly boolean runtime variable. Switching back
// to manual suppresses new automatic entries while existing cartons keep moving.
const supplyBelt = actor('supply-belt', [{type: 'conveyor', autoSpawn: false, speed: 4, spawnInterval: 0.1}], box(4, 0.1, 1));
supplyBelt.userData.editorConveyorTop = 0;
const supplyToggle = actor('supply-toggle', [{type: 'control', targetId: 'supply-belt', variable: 'autoSpawn', mode: 'toggle'}]);
const supply = harness([supplyBelt, supplyToggle]);
advance(supply.runtime, 0.25); assert.equal(row(supply.runtime, 'supply-belt').variables.entryCount, 0);
assert(row(supply.runtime, 'supply-belt').writable.some(field => field.key === 'autoSpawn' && field.type === 'boolean'));
assert.throws(() => supply.runtime.setVariable('supply-belt', 'autoSpawn', 1), /inválido/);
supply.runtime.setVariable('supply-belt', 'autoSpawn', true); advance(supply.runtime, 0.25);
const automaticEntries = row(supply.runtime, 'supply-belt').variables.entryCount;
assert(automaticEntries >= 2, 'Enabling automatic supply generates timed entries.');
const supplyState = supply.runtime.states.find(entry => entry.state.colliderMesh === supplyToggle).state;
click(supplyState); assert.equal(row(supply.runtime, 'supply-belt').variables.autoSpawn, false);
const traveling = supply.runtime.records.get('supply-belt').components.conveyor.packages[0], travelingOffset = traveling.offset;
advance(supply.runtime, 0.2);
assert.equal(row(supply.runtime, 'supply-belt').variables.entryCount, automaticEntries, 'Returning to manual creates no automatic cartons.');
assert(traveling.offset > travelingOffset, 'Changing supply mode does not stop the conveyor or its existing products.');
assert(supply.runtime.insertProduct('supply-belt')); advance(supply.runtime, 1 / 60);
assert.equal(row(supply.runtime, 'supply-belt').variables.entryCount, automaticEntries + 1, 'Manual insertion remains available after returning to manual.');
supply.runtime.stop();

// Safe declarative PLC rules use the same typed autoSpawn write as the panel.
const supplyRuleBelt = actor('supply-rule-belt', [{type: 'conveyor', autoSpawn: false, speed: 4, spawnInterval: 0.1}], box(4, 0.1, 1));
supplyRuleBelt.userData.editorConveyorTop = 0;
const supplyDriver = actor('supply-driver', [{type: 'motion', speed: 0}]);
const supplyRules = [true, false].map(value => ({sourceId: 'supply-driver', variable: 'enabled', operator: 'eq', value,
  targetId: 'supply-rule-belt', targetVariable: 'autoSpawn', set: value, edge: 'level'}));
assert.deepEqual(automationSchema.normalizeRules(supplyRules), supplyRules);
assert.throws(() => automationSchema.normalizeRules([Object.assign({}, supplyRules[0], {set: 1})]), /tipo/);
const supplyPLC = actor('supply-plc', [{type: 'automation', rules: JSON.stringify(supplyRules)}]);
const ruleSupply = harness([supplyRuleBelt, supplyDriver, supplyPLC]);
advance(ruleSupply.runtime, 0.25);
assert.equal(row(ruleSupply.runtime, 'supply-rule-belt').variables.autoSpawn, true);
assert(row(ruleSupply.runtime, 'supply-rule-belt').variables.entryCount > 0);
ruleSupply.runtime.setVariable('supply-driver', 'enabled', false); advance(ruleSupply.runtime, 1 / 60);
assert.equal(row(ruleSupply.runtime, 'supply-rule-belt').variables.autoSpawn, false);
const disabledRuleEntries = row(ruleSupply.runtime, 'supply-rule-belt').variables.entryCount;
advance(ruleSupply.runtime, 0.3);
assert.equal(row(ruleSupply.runtime, 'supply-rule-belt').variables.entryCount, disabledRuleEntries, 'PLC disabling automatic supply holds the entry counter stable.');
ruleSupply.runtime.setVariable('supply-driver', 'enabled', true); advance(ruleSupply.runtime, 0.25);
assert(row(ruleSupply.runtime, 'supply-rule-belt').variables.entryCount > disabledRuleEntries, 'PLC can re-enable automatic supply without restarting play.');
ruleSupply.runtime.stop();

// A staged, authored product can be picked up by the same input path used on
// desktop and XR, placed on a rotated/scaled belt, and picked up again without
// generating a duplicate entry. Leaving play restores its exact parent/pose.
const handlingBeltMesh = box(4, 0.1, 1); handlingBeltMesh.position.y = -0.05;
const handlingBelt = actor('handling-belt', [{type: 'conveyor', running: false, autoSpawn: false, speed: -1}], handlingBeltMesh);
handlingBelt.userData.editorConveyorTop = 0;
handlingBelt.position.set(2, 1, -3); handlingBelt.rotation.y = Math.PI / 3; handlingBelt.scale.set(1.2, 0.8, 1.3);
const carton = actor('carton', [{type: 'product', sourceId: 'handling-belt'}], createProductVisual());
carton.position.set(5, 1.2, -3);
const authoredParent = new THREE.Group(); authoredParent.add(carton);
const handlingScene = new THREE.Scene(); handlingScene.add(authoredParent);
const handling = harness([handlingBelt, carton], handlingScene, true);
const originalCartonPose = carton.position.clone(), originalCartonMatrixAutoUpdate = carton.matrixAutoUpdate;
const hand = new THREE.Group(); handling.scene.add(hand);
const handlingProduct = handling.runtime.products.get(carton);
assert(handlingProduct);
const input = handling.ctx.raycontrol;
const originalSelect = () => { throw new Error('A held-product release must consume the input before another interaction.'); };
input.onSelectStart = originalSelect;
handling.runtime.installProductInput();
assert(handling.runtime.pickupProduct(handlingProduct, hand));
assert.equal(carton.industrialHeld, true);
assert.equal(Object.keys(carton).includes('industrialHeld'), false, 'Held controller state never enters serialized Object3D data.');
const beltRotation = handlingBelt.getWorldQuaternion(new THREE.Quaternion());
const target = new THREE.Vector3(1.4, 0.14, 0).applyQuaternion(beltRotation).add(handlingBelt.getWorldPosition(new THREE.Vector3()));
hand.quaternion.copy(beltRotation);
hand.position.copy(target).sub(new THREE.Vector3(0, -0.025, -0.35).applyQuaternion(beltRotation));
// Position the held object near the entry before moving its hand, avoiding the
// conveyor frame on the initial reach from the external staging table.
handling.runtime.setProductMatrix(handlingProduct, new THREE.Matrix4().compose(target, beltRotation, new THREE.Vector3(1, 1, 1)));
advance(handling.runtime, 1 / 60);
input.onSelectStart({target: hand});
assert.equal(handling.runtime.held.size, 0);
assert.equal(carton.industrialHeld, undefined);
assert.equal(row(handling.runtime, 'handling-belt').variables.entryCount, 1);
assert.equal(row(handling.runtime, 'handling-belt').variables.inFlight, 1);
assert.equal(row(handling.runtime, 'carton').variables.onConveyor, true);
const captured = handling.runtime.records.get('handling-belt').components.conveyor.packages[0];
assert.equal(captured.mesh, carton, 'Capture transports the original product; it never substitutes a generated box.');
assert(handling.runtime.pickupProduct(handlingProduct, hand));
assert.equal(handling.runtime.packageCount, 0);
assert(handling.runtime.releaseProduct(handlingProduct));
assert.equal(row(handling.runtime, 'handling-belt').variables.entryCount, 1, 'Repositioning the same product does not duplicate its entry.');
handling.runtime.command('handling-belt', 'start');
const capturedOffset = captured.offset; advance(handling.runtime, 0.2);
assert(captured.offset < capturedOffset, 'Manual products obey a reversed conveyor in world units.');
handling.runtime.stop();
assert.equal(carton.parent, authoredParent);
assert(carton.position.equals(originalCartonPose));
assert.equal(carton.matrixAutoUpdate, originalCartonMatrixAutoUpdate);
assert.equal(input.onSelectStart, originalSelect, 'Stopping restores the preexisting input handler.');
assert.equal(handling.runtime.products.size, 0);

// Sensor frames, posts and lamps never enlarge the detection zone. Only its
// tagged optical volume contributes to detection, with occupancy exposed even
// when the configured contact is normally closed.
const opticalBelt = actor('optical-belt', [{type: 'conveyor', speed: 1, spawnInterval: 120}], box(4, 0.1, 1));
opticalBelt.userData.editorConveyorTop = 0;
const opticalSensor = actor('optical-sensor', [{type: 'sensor', sourceId: 'optical-belt', normallyClosed: true}], box(8, 2, 2));
const opticalVolume = box(0.02, 0.5, 0.9); opticalVolume.position.set(1, 0.2, 0); opticalVolume.userData.industrialSensorVolume = true;
opticalSensor.add(opticalVolume);
const optical = harness([opticalBelt, opticalSensor]);
advance(optical.runtime, 0.5);
assert.equal(row(optical.runtime, 'optical-sensor').variables.count, 0, 'A large decorative sensor frame cannot detect distant products.');
assert.equal(row(optical.runtime, 'optical-sensor').variables.occupied, false);
assert.equal(row(optical.runtime, 'optical-sensor').variables.active, true);
advance(optical.runtime, 2.5);
assert.equal(row(optical.runtime, 'optical-sensor').variables.count, 1);
assert.equal(row(optical.runtime, 'optical-sensor').variables.occupied, true);
assert.equal(row(optical.runtime, 'optical-sensor').variables.active, false);
optical.runtime.stop();

console.log('Industrial simulation: strict safe rules, transformed conveyors, speed/stop/emergency, swept sensors, automation edges, independent motion, continuous actor/package collisions, rotation rollback, non-overlapping queues, bounded telemetry, VR controls, shared frame batching, offscreen production and complete play cleanup passed.');
