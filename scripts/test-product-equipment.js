'use strict';
const assert = require('node:assert/strict'), THREE = require('three');
const schema = require('../shared/product-equipment.js'), sources = require('../shared/productSources.js'), routing = require('../shared/conveyorRouting.js');
const prefabs = require('./load-product-prefabs.js')(THREE);
const dispose = object => { const g = new Set(), m = new Set(), t = new Set(); object.traverse(node => { if (node.geometry) g.add(node.geometry); if (node.material) { m.add(node.material); if (node.material.map) t.add(node.material.map); } }); t.forEach(x => x.dispose()); m.forEach(x => x.dispose()); g.forEach(x => x.dispose()); };
function verifyForkOpenings(object, dimensions, label) {
  const p = object.userData.forkPockets; if (!p) return;
  object.updateMatrixWorld(true); const triangle = new THREE.Triangle();
  for (const axis of p.approachAxes) for (const center of axis === 'z' ? p.centersX : p.centersZ) {
    const width = axis === 'z' ? p.widthX : p.widthZ, across = axis === 'z' ? 'x' : 'z';
    const aperture = new THREE.Box3(new THREE.Vector3(-dimensions.width, p.minY + .001, -dimensions.depth), new THREE.Vector3(dimensions.width, p.maxY - .001, dimensions.depth));
    aperture.min[across] = center - width / 2 + .001; aperture.max[across] = center + width / 2 - .001;
    object.traverse(mesh => { if (!mesh.isMesh) return; const geometry = mesh.geometry, positions = geometry.attributes.position;
      for (let index = 0; index < (geometry.index ? geometry.index.count : positions.count); index += 3) {
        [triangle.a, triangle.b, triangle.c].forEach((point, offset) => point.fromBufferAttribute(positions, geometry.index ? geometry.index.array[index + offset] : index + offset).applyMatrix4(mesh.matrixWorld));
        assert(!aperture.intersectsTriangle(triangle), label + ': declared ' + axis + ' fork opening intersects actual support geometry');
      }
    });
  }
}
for (const definition of schema.VARIANTS) {
  const config = schema.normalize(definition.preset), object = prefabs.createProduct(definition.id, config); object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object), size = bounds.getSize(new THREE.Vector3());
  assert(Math.abs(bounds.min.y) < 1e-6, definition.id + ': floor placed');
  ['width', 'height', 'depth'].forEach((key, index) => assert(Math.abs(size[['x', 'y', 'z'][index]] - config[key]) < 2e-6, definition.id + ': exact ' + key));
  let triangles = 0, meshes = 0; object.traverse(node => { if (!node.isMesh) return; meshes++; triangles += node.geometry.attributes.position.count / 3; assert(node.material.isMeshStandardMaterial); });
  assert(meshes <= 8, definition.id + ': bounded material batches'); assert(triangles < 10000, definition.id + ': bounded triangle cost');
  assert.equal(object.userData.productUnits, config.units); assert.equal(object.userData.editorDefaultBehaviors[0].type, 'product');
  if (config.loadMode === 'pallet') { assert(object.userData.forkPockets.minY > 0); assert(object.userData.forkPockets.maxY > object.userData.forkPockets.minY); assert.deepEqual(object.userData.forkPockets.approachAxes, ['x', 'z']); verifyForkOpenings(object, config, definition.id); }
  dispose(object);
}
assert.throws(() => schema.normalize({variant: 'bottle', units: 1.5})); assert.throws(() => schema.normalize({mass: NaN}));
assert.throws(() => schema.normalize({variant: 'unknown'})); assert.throws(() => schema.normalize({color: 'red'}));
assert.throws(() => prefabs.createProduct('unknown'));
assert.throws(() => schema.normalize(JSON.parse('{"__proto__":{}}')));
for (const type of ['tote', 'jerrycan', 'sack', 'cylinder', 'reel', 'pallet', 'cage']) {
  const spec = {id: type, name: type, type, width: .3, height: .25, depth: .4, mass: 2, color: '#7799aa', quality: 'good', defect: 'none'};
  assert.equal(sources.normalizeCatalog([spec])[0].type, type);
  assert.equal(routing.matches({field: 'productType', operator: 'eq', value: type}, {productType: type}), true);
  const visual = prefabs.createCargoVisual(spec, {}); assert.equal(visual.userData.sourceProduct.type, type); dispose(visual);
}
const spec = {id: 'source-crates', name: 'Cajas', type: 'crate', variant: 'crate', width: .3, height: .25, depth: .4, mass: 2, color: '#7799aa'};
const load = {loadMode: 'pallet', palletType: 'euro-1200x800', palletMaterial: 'wood', palletPacking: 'fit', palletLayers: 2};
const loaded = prefabs.createCargoVisual(spec, load), plan = sources.palletPlan(spec, load);
assert.equal(loaded.userData.productUnits, plan.units); assert.equal(loaded.userData.sourceProduct.loadMode, 'pallet');
verifyForkOpenings(loaded, plan, 'Source pallet');
assert(Math.abs(new THREE.Box3().setFromObject(loaded).getSize(new THREE.Vector3()).y - plan.height) < 1e-6); dispose(loaded);
assert.equal(sources.unitsFor({}, Object.assign({}, spec, {units: 6})), 6);
assert.equal(sources.unitsFor(load, Object.assign({}, spec, {units: 6})), plan.units * 6);
const bundled = prefabs.createCargoVisual(Object.assign({}, spec, {units: 6}), load); assert.equal(bundled.userData.productUnits, plan.units * 6); dispose(bundled);
const euroLoad = prefabs.createProduct('pallet-loaded'); assert(Math.abs(euroLoad.userData.forkPockets.maxY - .144 * .74) < 1e-6); dispose(euroLoad);
for (const mass of [0, .01 / 64]) { const fraction = prefabs.createCargoVisual(Object.assign({}, spec, {mass, units: 1}), {}); assert.equal(fraction.userData.sourceProduct.mass, mass); dispose(fraction); }
const behaviors = require('../shared/behaviors.js');
for (const productType of ['pallet', 'cage']) assert.throws(() => behaviors.normalizeBehaviors([Object.assign(behaviors.defaultBehavior('source'), {productType, loadMode: 'pallet'})]), /ya es una carga paletizada/);
assert.throws(() => behaviors.normalizeBehaviors([Object.assign(behaviors.defaultBehavior('source'), {productType: 'box', productVariant: 'bottle'})]), /no coincide/);
assert.doesNotThrow(() => behaviors.normalizeBehaviors([Object.assign(behaviors.defaultBehavior('source'), {productType: 'pallet', productVariant: 'pallet-loaded', loadMode: 'individual', width: 1.2, height: 1.1, depth: .8, mass: 145 / 24, units: 24})]));
const catalog = require('../shared/resourceCatalog.js');
assert.equal(catalog.productResources().length, 17); assert.equal(catalog.vehicleResources().length, 13);
assert.equal(new Set(catalog.RESOURCES.map(item => item.id)).size, catalog.RESOURCES.length);
for (const id of ['vehicle.forklift', 'vehicle.pallet-truck', 'vehicle.cart', 'vehicle.cylindrical', 'vehicle.polar', 'vehicle.mobile-manipulator', 'vehicle.sorter']) assert.equal(catalog.RESOURCES.find(item => item.id === 'library:' + id).status, 'functional');
console.log('Products: 17 distinct PBR models, exact floor/envelopes, bounded batches/triangles, fork pockets, source types and routing passed.');
