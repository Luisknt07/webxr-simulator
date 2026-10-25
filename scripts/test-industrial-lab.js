'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors');
const {validateDocument} = require('../server/validation');
const text = fs.readFileSync(path.join(__dirname, 'test-industrial-lab-lines.js'), 'utf8');
const boundary = text.indexOf('\nasync function run()') + 1;
const {fixture, buildIndustrialLabLines, releaseGeometry} = new Function('require', '__dirname', text.slice(0, boundary) + '\nreturn {fixture,buildIndustrialLabLines,releaseGeometry};')(require, __dirname);
const buildIndustrialLab = require('./load-industrial-lab')(THREE, schema, buildIndustrialLabLines);
function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }
function panelAndStockRefresh() {
  const f = fixture();
  ['source', 'processor', 'palletQueue'].forEach(kind => {
    const object = f.document.addPrefab('hall', kind), nodes = [];
    object.traverse(node => { if (node.userData.editorId) nodes.push([node.userData.editorId, node]); });
    const patch = changes => f.document.setBehaviors(object, f.document.getBehaviors(object).map(config => config.type === kind ? Object.assign({}, config, changes) : config));
    let panel; object.traverse(node => { if (!panel && node.userData.industrialDisplay) panel = node; }); assert(panel);
    patch({withPanel: false}); assert(!visible(panel), kind + ' hides its physical panel when only withPanel changes.');
    patch({withPanel: true}); assert(visible(panel), kind + ' restores the same physical panel without rebuilding controls.');
    nodes.forEach(([id, node]) => assert(f.document.getObject(id) === node, 'Panel flag changes preserve every editable actor and control ID.'));
    if (kind === 'palletQueue') {
      patch({palletCapacity: 4, columns: 1, rows: 1, layers: 1, capacity: 4});
      assert.equal(object.children[0].userData.industrialPalletQueue.layout.pallets.length, 4, 'Changing only stock capacity creates all four physical pallet bays.');
    }
  });
  releaseGeometry(f);
}
async function run() {
  panelAndStockRefresh();
  const f = fixture();
  const spawn = f.document.addPrimitive('hall', 'cylinder'), camera = f.document.addPrimitive('hall', 'box');
  f.document.setTransform(spawn, {scale: [.45, .03, .45]});
  f.document.setTransform(camera, {scale: [.2, .14, .28]});
  f.document.setStudio({spawns: [{roomId: 'hall', objectId: spawn.userData.editorId}], entities: [{id: 'lab-camera', roomId: 'hall', type: 'camera', objectId: camera.userData.editorId}]});
  const before = await f.document.serialize(), depth = f.document.undoStack.length;
  const lab = buildIndustrialLab(f.document, 'hall', {scene: f.scene});
  assert.equal(lab.cells.length, 9); assert.equal(lab.signs.length, lab.cells.length + 1); assert.equal(lab.markings.length, 1);
  assert.equal(lab.monitors.length, lab.cells.length);
  assert(lab.monitorLayout && lab.monitorLayout.changed); assert.deepEqual(lab.monitorLayout.warnings, []); assert.equal(lab.monitorLayout.affectedObjectIds.length, lab.monitors.length); assert.equal(lab.monitorLayout.supports.length, lab.monitors.length * 3);
  assert(lab.finishes.objects.length >= lab.cells.length && lab.finishes.assignments > 0 && lab.finishes.wearLayers > 0,
    'The complete lab uses the real persisted per-part material and wear pass.');
  lab.cells.forEach(cell => {
    const monitor = f.document.getBehaviors(cell.monitor).find(config => config.type === 'lineMonitor');
    assert(monitor && monitor.targetId === cell.controller.userData.editorId && monitor.scope === 'line');
    assert(f.document.studio.groups.some(group => group.members.includes(cell.monitor.userData.editorId) && group.members.includes(cell.controller.userData.editorId)),
      'The monitor belongs to the same copyable group as its physical line controller.');
    const displays = new Set();
    cell.objects.forEach(object => object.traverse(node => { if (node.userData.industrialDisplay && visible(node)) displays.add(node); }));
    assert.equal(displays.size, 1, cell.id + ' has exactly one physically visible PLC panel.');
  });
  f.scene.updateMatrixWorld(true);
  const presentation = lab.floorPresentation;
  assert(presentation && presentation.plan.walkways.length && presentation.plan.zones.length && presentation.plan.bays.length && presentation.plan.signs.length,
    'The lab receives real walkways, production boundaries, loading bays and vertical signs.');
  assert(presentation.removedLegacyIds.length > 100, 'The generated legacy patches are replaced once instead of covering the new presentation.');
  const derived = require('./load-industrial-floor')(THREE, schema).deriveIndustrialFloorPresentation(f.document, 'hall');
  const overlap = (a, b) => a[0] < b[2] - 1e-6 && a[2] > b[0] + 1e-6 && a[1] < b[3] - 1e-6 && a[3] > b[1] + 1e-6;
  presentation.plan.walkways.forEach(walkway => derived.obstacles.forEach(obstacle => assert(!overlap(walkway, obstacle), 'Pedestrian lanes avoid machinery and ground fixtures.')));
  assert(lab.objects.every(object => f.document.getObject(object.userData.editorId) === object), 'Returned example objects exclude replaced legacy paint.');
  lab.markings[0].traverse(node => { if (node.isMesh) assert(node.material.isMeshBasicMaterial || node.material.roughness >= .8 && node.material.metalness <= .12, 'Paint and supports remain matte; lettering uses an unlit atlas.'); });
  assert.deepEqual(lab.floor.scale.toArray(), [72, .12, 120]); assert.equal(lab.floor.position.z, -15);
  const floorBehaviors = f.document.getBehaviors(lab.floor);
  assert(floorBehaviors.some(item => item.type === 'collision') && floorBehaviors.some(item => item.type === 'teleport'));
  assert(floorBehaviors.some(item => item.type === 'surfaceMaterial' && item.roughness >= .95 && item.metalness === 0), 'Concrete remains matte and suitable for the walking surface.');
  assert.deepEqual(spawn.position.toArray(), [0, .02, 34]); assert.equal(f.document.studio.startRoomId, 'hall');
  assert.equal(f.document.studio.groups.length, lab.cells.length);
  assert(lab.signs.every(sign => f.document.getBehaviors(sign).some(item => item.type === 'info' && item.title.length && item.text.length)), 'Every zone and the entrance have persisted readable instructions.');
  assert(lab.signs.every(sign => Math.abs(sign.scale.x / sign.scale.y - 1.6) < 1e-6), 'Compact contextual signs match their readable 16:10 canvas.');
  const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);
  const collisionCode = fs.readFileSync(path.join(__dirname, '../src/lib/CollisionWorld.js'), 'utf8').replace(/^import .*$/gm, '').replace('export default class CollisionWorld', 'class CollisionWorld');
  const CollisionWorld = new Function('THREE', 'getGeometryTree', collisionCode + '\nreturn CollisionWorld;')(THREE, getGeometryTree);
  const collisions = new CollisionWorld(f.ctx, f.document); collisions.setRoom('hall');
  assert(collisions.canOccupyCapsule(new THREE.Vector3(0, 1.62, 34)), 'The visitor starts on a free floor position.');
  assert(collisions.canOccupyCapsule(new THREE.Vector3(0, 1.62, 31)), 'The overhead entrance sign leaves the central walkway clear.');
  const landing = lab.cells.find(cell => cell.id === 'elevator').receiver.position;
  assert(collisions.canOccupyCapsule(new THREE.Vector3(landing.x + 2.1, 3.6, landing.z + 1.5)), 'The upper receiver has a physically accessible standing area.');
  assert.equal(f.document.undoStack.length, depth + 1, 'Complete example floor is one reversible action.');
  const saved = validateDocument(await f.document.serialize(), value => value);
  f.document.undo(); assert.deepEqual(await f.document.serialize(), before);
  f.document.redo(); assert.equal(f.document.studio.groups.length, lab.cells.length);
  const reopened = fixture(); await reopened.document.load(saved);
  assert.equal(reopened.document.getObjects('hall').filter(object => object.name.startsWith('Rótulo ·')).length, lab.cells.length + 1);
  assert.equal(reopened.document.studio.environments[0].sky, 'color');
  assert.equal(reopened.document.studio.environments[0].sunIntensity, .85);
  assert.equal(reopened.document.studio.environments[0].ambientIntensity, .15);
  assert.equal(reopened.document.studio.environments[0].exposure, .9);
  assert.equal(reopened.document.studio.environments[0].renderQuality, 'high');
  assert.equal(reopened.document.studio.environments[0].shadows, true);
  const restoredLights = reopened.document.studio.entities.filter(entity => entity.type === 'pointLight' && entity.roomId === 'hall');
  assert.equal(restoredLights.length, 8);
  assert(restoredLights.every(entity => entity.intensity === .65), 'The saved warehouse retains the visually verified light budget alongside its directional contact-shadow key.');
  assert(lab.building.roof && lab.building.walls.length > 4 && lab.building.fixtures.length > 0, 'The saved lab is a closed, internally lit warehouse.');
  assert(lab.signs.every(sign => sign.scale.x <= 2.4), 'Wayfinding is compact and no longer covers the equipment.');
  assert.equal(lab.cells[0].id, 'transfer-l');
  assert.equal(reopened.document.getObjects('hall').filter(object => reopened.document.getBehaviors(object).some(config => config.type === 'lineMonitor')).length, lab.cells.length,
    'All line monitors and their typed targets survive server validation and reopening.');
  releaseGeometry(f); releaseGeometry(reopened);
  console.log('Industrial lab floor: nine automatic cells/real PLCs/typed monitors, expanded 120 m workshop, part finishes, matte non-overlapping markings, readable signs, teleport, camera/spawn, copyable groups, validation, undo and reopen passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
