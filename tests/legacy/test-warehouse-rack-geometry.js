'use strict';
// Real indexed surfaces and ray/triangle intersections, not catalog labels.
const assert = require('node:assert/strict'), THREE = require('three');
const racks = require('../../modules/logistica-industrial/functions/almacenamiento/schema/warehouseRacks'), visual = require('../../modules/logistica-industrial/functions/almacenamiento/schema/warehouseRackVisual');
const close = (a, b, message) => assert(Math.abs(a - b) < 2e-5, (message || 'Values differ') + ': ' + a + ' / ' + b);
function meshes(root) {const out = []; root.traverse(n => {if (n.isMesh) out.push(n);}); return out;}
function ray(root, origin, direction, far = 100) {root.updateWorldMatrix(true, true); return new THREE.Raycaster(new THREE.Vector3().fromArray(origin), new THREE.Vector3().fromArray(direction).normalize(), 0, far).intersectObjects(meshes(root), false);}
function blocked(root, box) {
  root.updateWorldMatrix(true, true); const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), tri = new THREE.Triangle(a, b, c);
  for (const mesh of meshes(root)) {
    if (!box.intersectsBox(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld))) continue;
    const g = mesh.geometry, p = g.attributes.position, index = g.index;
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(p, index.getX(i)).applyMatrix4(mesh.matrixWorld); b.fromBufferAttribute(p, index.getX(i + 1)).applyMatrix4(mesh.matrixWorld); c.fromBufferAttribute(p, index.getX(i + 2)).applyMatrix4(mesh.matrixWorld);
      if (box.intersectsTriangle(tri)) return mesh.name;
    }
  }
  return '';
}
function inspect(root, id, drawLimit = 24) {
  const stats = visual.stats(root), box = new THREE.Box3().setFromObject(root);
  assert(stats.meshes > 0 && stats.draws <= drawLimit, id + ': bounded material banks'); assert(stats.triangles > 100 && stats.triangles < 100000, id + ': bounded real geometry'); close(box.min.y, -1, id + ': geometry rests on its stock floor');
  for (const mesh of meshes(root)) {
    const g = mesh.geometry, p = g.attributes.position; assert(g.index && g.attributes.normal && g.attributes.uv); assert(mesh.userData.industrialMaterialPart); assert(!mesh.userData.industrialCosmeticDetail, 'Structural members cannot disappear as cosmetic LOD.');
    assert(p.array.every(Number.isFinite)); for (let i = 0; i < g.index.count; i++) assert(g.index.getX(i) < p.count);
  }
  assert.doesNotThrow(() => root.clone(true), 'Runtime rig references stay non-enumerable so r112 cloning is safe.');
  return stats;
}

const summary = [];
for (const system of racks.SYSTEMS) {
  const config = racks.defaults(system.id), layout = racks.layout(config), root = visual.createVisual(THREE, config, layout), rig = root.userData.warehouseRackRig;
  assert(rig && rig.pallets.length === layout.cells.length); summary.push(Object.assign({system: system.id}, inspect(root, system.id)));
  // Every cell's usable volume remains hollow above its true support plane.
  for (const cell of layout.cells) {
    const p = cell.position, h = Math.min(.3, cell.clearHeight * .6), box = new THREE.Box3(new THREE.Vector3(p[0] - cell.width * .35, p[1] + .008, p[2] - cell.depth * .35), new THREE.Vector3(p[0] + cell.width * .35, p[1] + .008 + h, p[2] + cell.depth * .35));
    assert.equal(blocked(root, box), '', system.id + ': real load envelope must be free in cell ' + cell.index);
    const point = p.slice();
    if (['selective', 'double-deep', 'push-back', 'mobile'].includes(system.id)) point[2] += cell.depth * .34;
    else if (['drive-in', 'drive-through'].includes(system.id)) point[0] += cell.width * .41;
    else if (system.id === 'cantilever') point[0] += cell.width * .3;
    const support = ray(root, [point[0], p[1] + .06, point[2]], [0, -1, 0], .12);
    assert(support.length, system.id + ': actual solid support below cell ' + cell.index); close(support[0].point.y, p[1], system.id + ': support top matches the shared layout');
  }
  if (system.id === 'drive-in' || system.id === 'drive-through') {
    const cell = layout.cells.find(c => c.level === 0 && c.depthIndex === 0), y = -.1, start = layout.frontZ + .8, hits = ray(root, [cell.position[0], y, start], [0, 0, -1], start - layout.backZ + .8);
    if (system.id === 'drive-through') assert.equal(hits.length, 0, 'Drive-Through has a real through opening, not an invisible filled collision box.');
    else {assert(hits.length); assert(hits[0].point.z < layout.backZ + .2, 'Drive-In rear stops close the back without sealing the entry lane.');}
  }
  if (system.id === 'vertical-lift') {
    const w = rig.window, p = layout.accessPosition;
    assert.equal(ray(root, [0, p[1] + .2, w.frontZ + .4], [0, 0, -1], w.frontZ - layout.shaftPosition[1] + .2).length, 0, 'VLM window and internal shaft have an actual clear transfer opening.');
  }
  if (system.id === 'vertical-lift' || system.id === 'miniload') {
    const before = new THREE.Box3().setFromObject(rig.carriage), old = rig.carriage.position.clone(); rig.carriage.position.y += .4; root.updateWorldMatrix(true, true);
    close(new THREE.Box3().setFromObject(rig.carriage).min.y - before.min.y, .4, 'The actual carrier deck follows its lift pivot'); rig.carriage.position.copy(old);
  }
  const twin = visual.createVisual(THREE, config, layout); assert.notEqual(meshes(root)[0].material, meshes(twin)[0].material, 'Independently editable racks do not share material lifetime.'); visual.disposeVisual(twin); visual.disposeVisual(root);
}

{
  const config = racks.defaults('push-back'), root = visual.createVisual(THREE, config), rig = root.userData.warehouseRackRig, before = meshes(root).map(m => m.geometry.attributes.position.array.slice());
  rig.syncMotion(); const cart = rig.carts[0], original = cart.position.clone(); cart.position.z -= .23; rig.syncMotion(); let changed = 0;
  meshes(root).forEach((m, n) => m.geometry.attributes.position.array.forEach((v, i) => {if (Math.abs(v - before[n][i]) > .001) changed++;})); assert(changed > 50, 'Push-back motion moves actual shared cart vertices.'); assert(visual.stats(root).draws <= 5);
  cart.position.copy(original); rig.syncMotion(); meshes(root).forEach((m, n) => m.geometry.attributes.position.array.forEach((v, i) => close(v, before[n][i], 'Cart reset restores real geometry'))); visual.disposeVisual(root);
}
{
  const config = racks.defaults('mobile'), layout = racks.layout(config), root = visual.createVisual(THREE, config), rig = root.userData.warehouseRackRig, bank = rig.banks[0], old = bank.position.clone(), box = new THREE.Box3().setFromObject(bank);
  bank.position.fromArray(racks.mobileOffset(config, 0, config.rackBanks - 1)); root.updateWorldMatrix(true, true);
  close(new THREE.Box3().setFromObject(bank).min.z - box.min.z, config.rackAisleWidth, 'Mobile base moves its true posts, beams and seat markers.');
  const cell = layout.cells.find(c => c.bank === 0), marker = rig.pallets[cell.index].object.getWorldPosition(new THREE.Vector3()); close(marker.z, cell.closedPosition[2]); bank.position.copy(old); visual.disposeVisual(root);
}
{
  const config = Object.assign(racks.defaults('mezzanine'), {rackLevels: 3}), layout = racks.layout(config), root = visual.createVisual(THREE, config, layout), rig = root.userData.warehouseRackRig;
  assert.equal(rig.mezzanine.flights.length, 3); assert.equal(visual.stats(root).draws, 4);
  for (const f of rig.mezzanine.flights) {
    assert(f.stairRise <= .18); for (let i = 0; i < f.stairCount; i++) {
      const y = f.base + (i + 1) * f.stairRise, z = f.lastZ + (f.stairCount - i - .5) * f.stairRun;
      const hit = ray(root, [f.stairX, y + .05, z], [0, -1, 0], .1); assert(hit.length, 'Every step is real walkable geometry'); close(hit[0].point.y, y);
    }
    const hit = ray(root, [0, f.deckTop + .05, 0], [0, -1, 0], .1); assert(hit.length); close(hit[0].point.y, f.deckTop, 'Every mezzanine floor is solid');
  }
  visual.disposeVisual(root);
}
for (const id of ['selective', 'push-back', 'carton-flow', 'mobile']) {
  const config = Object.assign(racks.defaults(id), id === 'mobile' ? {rackBays: 4, rackLevels: 4, rackColumns: 2, rackBanks: 4} : id === 'selective' ? {rackBays: 8, rackLevels: 4, rackColumns: 3} : {rackBays: 8, rackLevels: 4, rackColumns: 1, rackDepthSlots: 4});
  const root = visual.createVisual(THREE, config); inspect(root, id + ' large', 24); visual.disposeVisual(root);
}
console.log(JSON.stringify(summary));
console.log('Warehouse rack geometry: 14 distinct configurable systems, actual hollow load envelopes/supports/through lanes, moving banks/carriers/cart buffers, multilevel walkable decks and steps, clone-safe rigs and bounded indexed material banks passed.');
