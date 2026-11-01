'use strict';
// Reuse the real driving/runtime fixture without running its unrelated input
// cases. Only DOM and headset tracking are ports; load custody is production.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'test-vehicle-driving.js'), 'utf8');
const {setup} = new Function('require', '__dirname', source.slice(0, source.indexOf('\nconst desktop = setup();')) + '\nreturn {setup};')(require, __dirname);
const {step, THREE} = require('./test-vehicle-runtime.js');
const materials = value => Array.isArray(value) ? value : [value];
const inside = (node, root) => {for (; node; node = node.parent) if (node === root) return true; return false;};

for (const vr of [false, true]) for (const pickupBeforeMount of [false, true]) {
  const f = setup(vr, true), product = f.runtime.products.get(f.pallet), object = product.object;
  const originals = [];
  object.traverse(mesh => {
    if (!mesh.isMesh) return;
    originals.push({mesh, material: mesh.material, geometry: mesh.geometry, castShadow: mesh.castShadow,
      visible: mesh.visible, layerMask: mesh.layers.mask,
      values: materials(mesh.material).map(material => ({material, opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite, map: material.map}))});
  });
  const checkMaterials = label => {
    for (const row of originals) {
      assert.equal(row.mesh.material, row.material, label + ': cargo retains its authored material, not a mast ghost');
      assert.equal(row.mesh.geometry, row.geometry); assert.equal(row.mesh.castShadow, row.castShadow);
      assert.equal(row.mesh.visible, row.visible); assert.equal(row.mesh.layers.mask, row.layerMask);
      for (const value of row.values) {
        assert.equal(value.material.opacity, value.opacity); assert.equal(value.material.transparent, value.transparent);
        assert.equal(value.material.depthWrite, value.depthWrite); assert.equal(value.material.map, value.map);
      }
    }
  };
  try {
    if (pickupBeforeMount) assert(f.api.pickup(f.record), f.v.warning);
    assert(f.driving.mount(f.record.id));
    f.driving.holographicGuide.enabled = true; f.driving.frontVisibility.update();
    checkMaterials('first mount');
    if (!pickupBeforeMount) assert(f.driving.command('pickup'), f.v.warning);
    step(f, .5, {lift: 1}); f.driving.follow();
    const entry = f.v.entry, forks = f.api.rig(f.record).forks, parent = object.parent;
    assert.equal(parent, forks); assert.equal(entry.product, product); assert(f.v.pose.lift > .1);
    const world = object.matrixWorld.clone(), local = object.matrix.clone(), loadMatrix = f.v.loadMatrix.clone();
    const pose = Object.assign({}, f.v.pose), mass = f.runtime.productMetadata(product).mass, count = f.runtime.products.size;
    const checkCargo = label => {
      f.scene.updateMatrixWorld(true); checkMaterials(label);
      assert.equal(f.v.entry, entry); assert.equal(entry.product, product); assert.equal(product.object, object);
      assert.equal(object.parent, parent); assert.equal(product.vehicleOwnerId, f.record.id);
      assert.equal(object.userData.vehicleOwnerId, f.record.id); assert.equal(product.processorOwnerId, f.record.id);
      assert.equal(product.processorLocked, true); assert.equal(f.runtime.products.get(object), product);
      assert.equal(f.runtime.products.size, count); assert.equal(f.runtime.productMetadata(product).mass, mass);
      assert.deepEqual(object.matrixWorld.toArray(), world.toArray()); assert.deepEqual(object.matrix.toArray(), local.toArray());
      assert.deepEqual(f.v.loadMatrix.toArray(), loadMatrix.toArray()); assert.deepEqual(f.v.pose, pose);
      assert.equal(parent.children.filter(child => child === object).length, 1);
      assert(!f.driving.frontVisibility.entries.some(row => inside(row.mesh, object)), label + ': a carried product is not vehicle front structure');
      assert(!(f.driving.frontVisibility.wireSources || []).some(row => inside(row.mesh, object)), label + ': cargo contributes no vehicle hologram edges');
    };
    checkCargo('pickup while occupied');
    for (let cycle = 0; cycle < 4; cycle++) {
      const headPosition = f.camera.position.clone(), headRotation = f.camera.quaternion.clone();
      assert(f.driving.unmount()); checkCargo('exit ' + cycle);
      assert(f.driving.mount(f.record.id));
      f.driving.holographicGuide.enabled = true; f.driving.frontVisibility.update(); checkCargo('remount ' + cycle);
      for (const enabled of [false, true]) {
        f.driving.holographicGuide.enabled = enabled; f.driving.frontVisibility.update(); checkCargo('guide ' + enabled);
      }
      if (vr) {assert(f.camera.position.equals(headPosition)); assert(f.camera.quaternion.equals(headRotation));}
    }
    // The actual auxiliary camera's isolation pass also keeps this cargo;
    // hiding the mast cannot conceal a product nested below the forks.
    const camera = f.driving.docking.forkCamera;
    camera.hideHelpers('front');
    try {
      assert(!camera.hidden.some(([node]) => inside(node, object)));
      checkCargo('auxiliary inspection camera');
    } finally {
      camera.hidden.forEach(([node, visible]) => {node.visible = visible;}); camera.hidden = null;
    }
    assert(object.getWorldPosition(new THREE.Vector3()).y > 0);
  } finally {f.driving.dispose(); f.runtime.stop();}
}
console.log('Forklift cargo remount: real pickup before/after boarding, four desktop/XR exit/remount cycles and guide toggles preserve original cargo materials, geometry, pose, custody, mass and identity.');
