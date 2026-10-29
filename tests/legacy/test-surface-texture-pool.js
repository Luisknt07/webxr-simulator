const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const materialSchema = require('../../packages/render-three/schema/materials');
const load = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-surface-texture-pool.js"), '../src/editor', file + '.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class ' + file, 'return class ' + file);
const Surface = new Function('THREE', 'materialSchema', load('SurfaceMaterialSystem'))(THREE, materialSchema);
const Architecture = new Function('THREE', load('StaticArchitectureBatches'))(THREE);
const root = new THREE.Group(), owners = [];
function create(seed = 1) {
  const owner = new THREE.Group(); owner.name = 'CEDI \u00b7 wall'; owner.userData.editorDescriptor = {type: 'box'};
  owner.userData.editorBehaviors = [materialSchema.normalizeMaterial({preset: 'paintedMetal', seed, wear: .35, wearType: 'scratches'})];
  owner.add(new THREE.Mesh(new THREE.BoxBufferGeometry(), new THREE.MeshStandardMaterial()));
  root.add(owner); owners.push(owner); return owner;
}
const doc = {getRoot: () => root, getObjects: () => owners.filter(owner => owner.parent), getBehaviors: owner => owner.userData.editorBehaviors || []};
const first = create(), second = create(), different = create(2);
const system = new Surface({}, doc, {});
(async () => {
  await system.sync('hall');
  const a = first.children[0].material, b = second.children[0].material, c = different.children[0].material;
  assert.notEqual(a, b, 'Editable PBR materials stay independent.');
  for (const field of ['map', 'roughnessMap', 'surfaceWearMap']) {
    assert.equal(a[field], b[field], 'Exact immutable recipes share ' + field);
    assert.notEqual(a[field], c[field], 'Different wear/texture seeds stay independent.');
  }
  assert.equal(system.proceduralPool.size, 6); assert.equal(system.stats.proceduralReferences, 9);
  const batches = new Architecture(doc);
  assert.equal(batches.materialKey(a), batches.materialKey(b), 'Known shader uniforms permit equal architectural batches.');
  assert.notEqual(batches.materialKey(a), batches.materialKey(c));
  assert.equal(a.staticInstanceBatchShader, a.onBeforeCompile);
  let releases = 0; a.map.addEventListener('dispose', () => releases++);
  const pixels = a.map.image.data.slice();
  first.userData.editorBehaviors = []; system.invalidate(); await system.sync('hall');
  assert.equal(releases, 0, 'Removing one owner must not dispose a shared GPU texture.');
  assert.deepEqual(b.map.image.data, pixels);
  assert.equal(system.stats.proceduralReferences, 6);
  second.userData.editorBehaviors = []; system.invalidate(); await system.sync('hall');
  assert.equal(releases, 1, 'The last owner releases its texture exactly once.');
  assert.equal(system.proceduralPool.size, 3);
  system.dispose(); assert.equal(system.proceduralPool.size, 0); assert.equal(system.stats.proceduralReferences, 0);
  system.dispose(); assert.equal(releases, 1);
  console.log('Surface texture pool: equal pixels shared, edits isolated, known shaders batch safely, final references released.');
})().catch(error => { console.error(error); process.exitCode = 1; });
