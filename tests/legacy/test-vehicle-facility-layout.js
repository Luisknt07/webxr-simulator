'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors');
const trainingSchema = require('../../modules/logistica-industrial/functions/montacargas/schema/vehicle-training.js');
const fixtureSource = fs.readFileSync(path.resolve(__dirname, 'test-conveyor-mechanisms.js'), 'utf8');
const {setup} = new Function('require', '__dirname', fixtureSource.slice(0, fixtureSource.indexOf('async function run()')) + '\nreturn {setup};')(require, __dirname);
const load = file => fs.readFileSync(path.resolve(__dirname, '../../', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const Facility = new Function('THREE', load('modules/logistica-industrial/functions/montacargas/runtime/VehicleFacilityLayout.js').replace('default class VehicleFacilityLayout', 'return class VehicleFacilityLayout'))(THREE);
const Training = new Function('THREE', 'trainingSchema', load('modules/logistica-industrial/functions/montacargas/runtime/VehicleTrainingRuntime.js').replace('default class VehicleTrainingRuntime', 'return class VehicleTrainingRuntime'))(THREE, trainingSchema);
const VehicleRuntime = require('../support/load-vehicle-runtime')(THREE);
const enhance = new Function('THREE', 'schema', load('modules/logistica-industrial/scenarios/WarehouseMissionEnhancement.js') + '\nreturn addWarehouseMissionExperience;')(THREE, schema);
const center = points => points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length], [0, 0]);
const near = (a, b, note) => { assert.equal(a.length, b.length); a.forEach((value, i) => assert(Math.abs(value - b[i]) < 1e-6, note + ': ' + a + ' vs ' + b)); };
const world = object => { const p = object.getWorldPosition(new THREE.Vector3()); return [p.x, p.z]; };
const identity = runtime => JSON.stringify({time: runtime.time, products: Array.from(runtime.products.values(), p => ({id: p.record && p.record.id, matrix: p.object.matrixWorld.toArray(), owner: p.vehicleOwnerId, entry: p.sourceEntry && {ownerId: p.sourceEntry.ownerId, code: p.sourceEntry.rackLocationCode}})), variables: Array.from(runtime.records.values(), r => ({id: r.id, variables: r.variables, config: Object.fromEntries(Object.entries(r.components).map(([type, c]) => [type, c.config]))}))});
function canvas() {
  const calls = [], context = {calls, save() {}, restore() {}, beginPath() {}, closePath() {}, stroke() {}, fill() {}, setLineDash(value) { calls.push(['dash', value.slice()]); }, clearRect() {}, fillRect() {}, fillText(value, x, y) { assert(Number.isFinite(x) && Number.isFinite(y)); calls.push(['text', value]); }, moveTo(x, y) { assert(Number.isFinite(x) && Number.isFinite(y)); }, lineTo(x, y) { assert(Number.isFinite(x) && Number.isFinite(y)); }, arc(x, y, r) { assert(Number.isFinite(x) && Number.isFinite(y) && r > 0); }};
  return context;
}
function dispose(f) { f.runtime.stop(); const geometry = new Set(), material = new Set(); f.scene.traverse(object => { if (object.geometry) geometry.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).forEach(value => material.add(value)); }); geometry.forEach(value => value.dispose()); material.forEach(value => value.dispose()); }
function boundedInstallation() {
  const root = new THREE.Group(), geometry = new THREE.BoxBufferGeometry(1, 1, 1), material = new THREE.MeshBasicMaterial(), truck = new THREE.Group(); root.add(truck);
  const record = {id: 'active-truck', object: truck, components: {vehicle: {config: {width: 1, length: 2}}}}, records = new Map([[record.id, record]]), products = new Map();
  for (let i = 0; i < 240; i++) {
    const object = new THREE.Mesh(geometry, material); object.position.set(i % 20, 0, Math.floor(i / 20)); root.add(object); records.set('belt-' + i, {id: 'belt-' + i, object, components: {conveyor: {config: {}}}, variables: {}});
    const product = new THREE.Group(); product.position.set(i % 20, 1, Math.floor(i / 20)); root.add(product); products.set(product, {object: product, bounds: new THREE.Box3(new THREE.Vector3(-.2, 0, -.2), new THREE.Vector3(.2, .4, .2))});
  }
  const crowded = records.get('belt-0').object; for (let i = 0; i < 200; i++) crowded.add(new THREE.Mesh(geometry, material));
  const simulation = {roomId: 'bounded', document: {getRoot: () => root}, records, products}, map = new Facility({simulation});
  const model = map.update(record, {lesson: null, guide: null});
  assert(model.stats.truncated && model.actors.length <= 200 && model.products.length <= 200, 'Large installations retain fixed actor/product limits.');
  assert(model.stats.geometryReads <= 600 && model.actors.every(actor => actor.points.length <= 128), 'A highly detailed prefab cannot exceed global mesh or per-actor vertex budgets.');
  assert.equal(model.mission, null); assert(map.paint(canvas(), 480, 320)); map.dispose(); geometry.dispose(); material.dispose();
}
function tightProjection(){
  const root=new THREE.Group(),truck=new THREE.Group(),material=new THREE.MeshBasicMaterial(),floor=new THREE.Mesh(new THREE.BoxBufferGeometry(100,.1,100),material),belt=new THREE.Mesh(new THREE.BoxBufferGeometry(3,1,24),material);
  root.add(floor,belt,truck);floor.position.y=-.1;truck.position.z=15;const record={id:'truck',object:truck,components:{vehicle:{config:{width:1,length:2}}}},conveyor={id:'belt',object:belt,components:{conveyor:{config:{}}}},simulation={roomId:'long',document:{getRoot:()=>root},records:new Map([['truck',record],['belt',conveyor]]),products:new Map()};
  const map=new Facility({simulation}),model=map.update(record,{lesson:null,guide:null});
  assert(model.bounds.maxX-model.bounds.minX<10&&model.bounds.maxZ-model.bounds.minZ<35,'A generic 100m engine backdrop cannot shrink the actual work area.');
  assert(map.paint(canvas(),1000,480,model));const projection=map.projection;
  assert.equal(projection.rotation,Math.PI/2,'A long installation can quarter-turn as a metric plan to use a wide navigation container.');
  const origin=projection.screen([0,0]),x=projection.screen([1,0]),z=projection.screen([0,1]);near([Math.hypot(x[0]-origin[0],x[1]-origin[1])],[Math.hypot(z[0]-origin[0],z[1]-origin[1])],'Equal world distances retain equal scale after fit/rotation');
  const front=projection.screen([0,model.bounds.minZ]),back=projection.screen([0,model.bounds.maxZ]);assert(Math.abs(back[0]-front[0])>projection.plot.width*.95,'The installation fills almost the full usable plot width.');
  assert(x[1]<origin[1]&&z[0]>origin[0],'The quarter-turn applies the same orientation to metric coordinates, grid and moving actors.');
  floor.userData.editorId='custom-authored-floor';const authored=map.update(record,{lesson:null,guide:null,force:true});assert(authored.floors[0].authored&&authored.bounds.maxX-authored.bounds.minX>=100,'An explicitly authored installation floor remains visible in full, even if it has few machines.');
  map.dispose();floor.geometry.dispose();belt.geometry.dispose();material.dispose();
}
async function run() {
  const f = setup(), d = f.document;
  const built = enhance(d, 'hall'), belt = d.addPrefab('hall', 'conveyor', 'pallet-chain'), robot = d.addPrefab('hall', 'robot');
  d.setTransform(belt, {position: [-9, 1, 9]}); d.setTransform(robot, {position: [-11, 0, 9]});
  const hidden = new THREE.Mesh(new THREE.BoxBufferGeometry(400, 1, 400), new THREE.MeshBasicMaterial()); hidden.visible = false; f.root.add(hidden);
  const helper = hidden.clone(); helper.visible = true; helper.userData.editorHelper = true; helper.position.x = 200; f.root.add(helper);
  const otherRoot = new THREE.Group(); f.scene.add(otherRoot); d.registerRoom('other', otherRoot); const otherBelt = d.addPrefab('other', 'conveyor', 'pallet-chain'); d.setTransform(otherBelt, {position: [200, 1, 200]});
  f.scene.updateMatrixWorld(true);
  f.runtime.vehicleRuntime = new VehicleRuntime(f.runtime); f.runtime.vehicleTraining = new Training(f.runtime); f.runtime.start('hall');
  const record = f.runtime.records.get(built.vehicleId), lesson = f.runtime.vehicleTraining.guidance(record);
  assert(record && lesson.phase === 'pickup', JSON.stringify(lesson));
  const floor = d.addPrimitive('hall', 'plane'), wall = d.addPrimitive('hall', 'box');
  d.setTransform(floor, {position: [0, -.01, 0], rotation: [-Math.PI / 2, 0, 0], scale: [14, 11, 1]});
  d.setTransform(wall, {position: [0, 3, -11], scale: [28, 6, .18]});
  d.addIndustrialFloorPresentation('hall', {type: 'industrialFloor', version: 1, bounds: [-14, -11, 14, 11], floorY: .001, walkways: [[-13, -10, -11, 10]], bays: [[9, 6, 10.5, 7.2]]});
  // Move the complete live room after custody initialization: the monitor must
  // project every authored/runtime actor through the same non-identity root.
  f.root.position.set(15, 0, -6); f.root.rotation.y = .43; f.scene.updateMatrixWorld(true);
  // Defensive room filtering still applies if a host keeps records for several rooms.
  f.runtime.records.set('foreign-record', {id: 'foreign-record', object: otherBelt, components: {conveyor: {config: {}}}, variables: {}});
  const before = await d.serialize(); f.scene.updateMatrixWorld(true); const custody = identity(f.runtime);
  let time = 0; const map = new Facility({simulation: f.runtime}, {now: () => time}), at = record.object.getWorldPosition(new THREE.Vector3());
  const guide = {taskId: lesson.taskId, routePath: {points: [at.toArray(), [at.x + 2, at.y, at.z + 1]], blocked: false, stop: null}};
  let model = map.update(record, {lesson, guide});
  assert(Object.isFrozen(model) && Object.isFrozen(model.actors) && Object.isFrozen(model.vehicle.points[0]), 'The canvas receives an immutable read model.');
  assert.equal(model.floors.length, 1); assert(model.bounds.maxX - model.bounds.minX < 60, 'The native 100 m floor, hidden helpers and foreign room do not zoom out the authored installation.');
  assert(model.actors.some(actor => actor.id === belt.userData.editorId && actor.type === 'conveyor'));
  assert(model.actors.some(actor => actor.id === robot.userData.editorId && actor.type === 'robot'));
  assert(model.actors.some(actor => actor.id === built.rack.userData.editorId && actor.type === 'palletQueue'));
  const rackPlan=model.actors.find(actor=>actor.id===built.rack.userData.editorId).rack;assert(rackPlan&&rackPlan.columns.length,'Rack plan contains real physical storage columns.');assert(rackPlan.aisle&&rackPlan.row,'Real rack aisle and row identifiers appear in the plan.');assert(rackPlan.columns.some(column=>column.occupied>0),'Rack occupancy is derived from the live physical inventory.');assert(rackPlan.columns.every(column=>Object.isFrozen(column)&&Object.isFrozen(column.cells)));
  assert(model.actors.some(actor => actor.id === wall.userData.editorId && actor.type === 'wall'), 'A room rotated in world space preserves wall footprints.');
  const walkway = model.actors.find(actor => actor.type === 'walkway'), expectedWalkway = new THREE.Vector3(-12, .001, 0).applyMatrix4(f.root.matrixWorld);
  assert(walkway && model.actors.some(actor => actor.type === 'bay')); near(center(walkway.points), [expectedWalkway.x, expectedWalkway.z], 'Authored walkways and pallet demarcations use room transforms');
  assert(!model.actors.some(actor => actor.id === 'foreign-record'));
  assert.equal(model.products.length, 3); near(model.vehicle.position, world(record.object), 'Truck coordinates use the transformed room root');
  assert.equal(model.vehicle.color, record.components.vehicle.config.frameColor, 'The active truck keeps its configured body colour.');
  const product = f.runtime.vehicleTraining.product(lesson.productId); near(model.mission.pickup, world(product.object), 'Pickup marker follows the actual pallet');
  assert.equal(model.mission.verified, true); near(model.mission.route[1], [at.x + 2, at.z + 1], 'Collision-validated route stays in world coordinates');
  const rackTask = built.tasks.find(task => task.locationCode || task.destinationLocationCode || task.destinationId === built.rack.userData.editorId);
  assert(rackTask, 'The real warehouse fixture contains an exact rack destination.');
  const rackRecord = f.runtime.records.get(built.rack.userData.editorId), destinationCode = built.destinationSlot.code, targetCell = rackRecord.components.palletQueue.rack.layout.cells.find(cell => cell.code === destinationCode);
  const targetMatrix = f.runtime.palletQueueRuntime.rackMatrix(rackRecord, product, f.runtime.palletQueueRuntime.rackPoint(rackRecord.components.palletQueue, targetCell));
  const targetCenter = product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(targetMatrix);
  const dropLesson = Object.assign({}, lesson, {phase: 'drop', destinationId: rackRecord.id, locationCode: destinationCode, destinationSlot: targetCell.index});
  time = 200; model = map.update(record, {lesson: dropLesson, guide}); near(model.mission.destination, [targetCenter.x, targetCenter.z], 'Delivery uses the assigned rack cell rather than the rack centre'); assert.equal(model.mission.locationCode, destinationCode);
  assert.deepEqual(await d.serialize(), before); assert.equal(identity(f.runtime), custody, 'Initial layout reads preserve the document and runtime custody.');
  const geometryReads = model.stats.geometryReads, staticUpdates = model.stats.staticUpdates, oldPosition = model.vehicle.position;
  record.object.position.x += .4; const oldProduct = model.products.find(value => value.id === lesson.productId); product.object.matrix.premultiply(new THREE.Matrix4().makeTranslation(0, 0, .3)); product.object.matrix.decompose(product.object.position, product.object.quaternion, product.object.scale); f.scene.updateMatrixWorld(true);
  time = 250; assert.equal(map.update(record, {lesson, guide}), model, 'Live state is cached inside the 5 Hz interval.');
  time = 400; model = map.update(record, {lesson, guide}); assert.equal(model.stats.geometryReads, geometryReads); assert.equal(model.stats.staticUpdates, staticUpdates, 'Moving trucks and products do not rescan physical meshes at 5 Hz.');
  assert.notDeepEqual(model.vehicle.position, oldPosition); if (oldProduct) assert.notDeepEqual(model.products.find(value => value.id === lesson.productId).points, oldProduct.points);
  time = 600; model = map.update(record, {lesson, guide}); assert.equal(model.stats.staticUpdates, staticUpdates + 1, 'Physical installation footprints refresh at 2 Hz.');
  const afterMovement = await d.serialize(), movingCustody = identity(f.runtime);
  const blockedGuide = {taskId: lesson.taskId, routePath: {points: [[at.x, at.y, at.z]], blocked: true, stop: [at.x, at.y, at.z]}};
  time = 800; model = map.update(record, {lesson, guide: blockedGuide}); assert(model.mission.blocked && model.mission.verified); assert.equal(model.mission.route.length, 1, 'A blocked path cannot draw an unchecked continuation as the safe route.');
  const context = canvas(); assert.equal(map.paint(context, 900, 450), true); assert(context.calls.some(call => call[0] === 'text' && /Ruta bloqueada/.test(call[1]))); assert(context.calls.some(call => call[0] === 'text' && /PLANO DE LA INSTALACIÓN/.test(call[1]))); assert(context.calls.some(call => call[0] === 'dash' && call[1].length), 'Unverified planned remainder has its own dashed style.');
  time = 1000; model = map.update(record, {lesson: dropLesson, guide: {routePath: {points: [], blocked: false}}}); assert.equal(model.mission.verified, false, 'No collision checker means no verified corridor.');
  const referenceCanvas = canvas(); map.paint(referenceCanvas, 480, 320); assert(referenceCanvas.calls.some(call => call[0] === 'text' && /Ruta prevista/.test(call[1]))); assert(referenceCanvas.calls.some(call => call[0] === 'text' && call[1].includes(destinationCode)));
  assert.equal(map.paint({}, 480, 320), false, 'A minimal legacy canvas host degrades without throwing.');
  time = 1200; model = map.update(record, {lesson, guide: {taskId: 'old-task', routePath: guide.routePath}}); assert.equal(model.mission.verified, false, 'A stale guide from another task cannot validate the current route.');
  const selectedPickup = {id: 'pickup:selected', kind: 'pickup', name: 'Pallet elegido', product, matrix: product.object.matrixWorld.clone(), bounds: product.bounds.clone(), allowed: true};
  map.driving.holographicGuide = {enabled: true, currentTarget: selectedPickup};
  const selectedGuide = {phase: 'pickup', targetId: selectedPickup.id, routePath: {points: [], blocked: false}};
  time = 1400; model = map.update(record, {lesson: null, guide: selectedGuide}); assert(model.mission.manual && !model.mission.verified); assert.equal(model.mission.plannedRoute.length, 0, 'A local bearing never invents a navigable free-play route.');
  const pickupCenter = product.bounds.getCenter(new THREE.Vector3()).applyMatrix4(product.object.matrixWorld); near(model.mission.pickup, [pickupCenter.x, pickupCenter.z], 'Free play follows the guide-selected actual pallet');
  time = 1600; model = map.update(record, {lesson: dropLesson, guide: selectedGuide}); assert(!model.mission.manual && model.mission.destination, 'A training mission always takes precedence over free-play suggestions.');
  map.driving.holographicGuide.currentTarget = {id: 'drop:selected', kind: 'drop', name: 'Posición elegida', record: rackRecord, product, matrix: targetMatrix, bounds: product.bounds, locationCode: destinationCode, allowed: true};
  time = 1800; model = map.update(record, {lesson: null, guide: {phase: 'drop', targetId: 'drop:selected', routePath: guide.routePath}}); near(model.mission.destination, [targetCenter.x, targetCenter.z], 'Free-play delivery retains the selected exact rack position'); assert(model.mission.verified);
  time = 2000; model = map.update(record, {lesson: null, guide: null}); assert.equal(model.mission, null, 'Disabling the guide removes free-play targets even if its old rich target remains cached.');
  assert.deepEqual(await d.serialize(), afterMovement, 'Repeated monitor updates and painting never change the project document.');
  assert.equal(identity(f.runtime), movingCustody, 'The layout does not change custody, parameters, simulation time or training progress.');
  map.dispose(); assert.equal(map.update(record, {lesson}), null); assert.equal(map.model, null); f.runtime.records.delete('foreign-record'); dispose(f);
  boundedInstallation();tightProjection();
  console.log('Vehicle facility layout: transformed real room/rack targets, hidden/foreign exclusion, 2/5 Hz bounded read model, live pallets/truck, validated route stop and canvas rendering passed.');
}
module.exports = {run}; if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
