'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const wear = require('../shared/wear'), {getGeometryTree} = require('./load-geometry-acceleration')(THREE);
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\r?\n/gm, '');
const clipping = read('node_modules/three/examples/jsm/geometries/DecalGeometry.js').replace(/import \{[\s\S]*?\} from "[^"]+";/, '').replace('export { DecalGeometry, DecalVertex };', 'return DecalGeometry;');
const DecalGeometry = new Function('BufferGeometry', 'Float32BufferAttribute', 'Matrix4', 'Vector3', clipping)(THREE.BufferGeometry, THREE.Float32BufferAttribute, THREE.Matrix4, THREE.Vector3);
const Decals = new Function('THREE', 'DecalGeometry', 'getGeometryTree', 'wearSchema', read('src/editor/DecalSystem.js').replace('export default class DecalSystem', 'return class DecalSystem'))(THREE, DecalGeometry, getGeometryTree, wear);
const Paint = new Function('THREE', 'DecalSystem', 'wearSchema', read('src/editor/WearPaintSystem.js').replace('export default class WearPaintSystem', 'return class WearPaintSystem'))(THREE, Decals, wear);
function fixture(globalReference) {
  const root = new THREE.Group(), objects = [], material = new THREE.MeshStandardMaterial(), geometry = new THREE.BoxBufferGeometry(.4, .7, .2);
  for (let machine = 0; machine < 24; machine++) {
    const owner = new THREE.Group(); owner.position.x = machine * 5; owner.userData.editorId = 'machine-' + machine;
    for (let index = 0; index < 8; index++) {const mesh = new THREE.Mesh(geometry, material); mesh.position.set((index - 3.5) * .45, 0, 0); owner.add(mesh);}
    const matrix = new THREE.Matrix4().makeTranslation(0, 0, .11).toArray();
    owner.userData.editorBehaviors = [{type: 'surfaceWear', enabled: true, layers: wear.normalizeLayerJSON([{id: 'dirt', pattern: 'grime', width: 3.8, height: .7, depth: .15, matrix}, {id: 'scratch', pattern: 'scratches', seed: 8, width: 2.8, height: .5, depth: .15, matrix}])}];
    root.add(owner); objects.push(owner);
  }
  const document = {getRoot: () => root, getObjects: () => objects, getObject: id => objects.find(object => object.userData.editorId === id)};
  const system = new Paint({}, document, {}, error => {throw Error(error);});
  if (globalReference) {const collect = system.engine._surfaces; system.engine._surfaces = function (target, lists) {return collect.call(this, root, lists);};}
  const start = performance.now(); system.sync('hall'); const initialMs = performance.now() - start;
  return {system, root, objects, initialMs};
}
const reference = fixture(true), optimized = fixture(false);
const states = system => [...system.engine.states.values()];
const referenceStates = states(reference.system), optimizedStates = states(optimized.system);
assert.equal(optimizedStates.length, 48); assert.equal(referenceStates.length, optimizedStates.length);
optimizedStates.forEach((state, index) => {
  assert.deepEqual(Array.from(state.mesh.geometry.attributes.position.array), Array.from(referenceStates[index].mesh.geometry.attributes.position.array));
  assert.deepEqual(Array.from(state.material.map.image.data), Array.from(referenceStates[index].material.map.image.data));
});
const baseline = reference.system.engine.stats.candidateVisits, current = optimized.system.engine.stats.candidateVisits;
assert(current < baseline * .06, 'Targeted machine wear must never search every mesh of the whole warehouse for every layer.');
let serializations = 0; const stringify = JSON.stringify, geometries = optimizedStates.map(state => state.mesh.geometry), projections = optimized.system.engine.stats.projections;
JSON.stringify = function (...args) {serializations++; return stringify.apply(this, args);};
try {for (let frame = 0; frame < 30; frame++) optimized.system.sync('hall');} finally {JSON.stringify = stringify;}
assert.equal(serializations, 0, 'Unchanged private normalized layers need no JSON serialization at frame rate.');
assert.equal(optimized.system.engine.stats.projections, projections); states(optimized.system).forEach((state, index) => assert.equal(state.mesh.geometry, geometries[index]));
const first = optimized.objects[0], config = first.userData.editorBehaviors[0], layers = wear.normalizeLayers(config.layers); layers[0].opacity = .36; config.layers = wear.normalizeLayerJSON(layers); optimized.system.sync('hall');
assert.equal(states(optimized.system)[0].material.opacity, .36); assert.equal(optimized.system.engine.stats.projections, projections, 'Appearance edits preserve clipped triangles.');
// Target transforms still update derived meshes, while an actor and its own
// brush move together without rebuilding unchanged relative projections.
first.position.z = 3; optimized.system.sync('hall'); assert.equal(optimized.system.engine.stats.projections, projections);
optimized.root.remove(first); optimized.objects.shift(); optimized.system.sync('hall'); assert.equal(optimized.system.engine.states.size, 46);
reference.system.dispose(); optimized.system.dispose(); assert.equal(optimized.system.entries.size, 0); assert.equal(optimized.system.engine.states.size, 0);
console.log('Decal work budget: exact clipping/PBR pixels, 24-machine targeted inventories, unchanged-frame zero layer JSON, live appearance/pose/delete and cleanup passed.');
console.log(stringify({referenceCandidateVisits: baseline, targetedCandidateVisits: current, reduction: 1 - current / baseline, unchangedLayerSerializations: serializations, initialMs: {reference: reference.initialMs, targeted: optimized.initialMs}}));
