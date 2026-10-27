'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);
const load = source => new Function('THREE', 'getGeometryTree', source.replace(/^import .*;\r?\n/gm, '').replace('export default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
const World = load(fs.readFileSync(path.join(__dirname, '../src/lib/CollisionWorld.js'), 'utf8'));
// A linear broadphase is an independent reference for the spatial index. Both
// retain the exact existing triangle/closed-solid narrowphase.
class Baseline extends World { _candidates(box) {return this.entries.filter(entry => entry.box.intersectsBox(box)).sort((a,b)=>a.order-b.order);} }
const root = new THREE.Group(), geometry = new THREE.BoxBufferGeometry(1, 2, 1), material = new THREE.MeshBasicMaterial(), objects = [];
for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) {
  const object = new THREE.Mesh(geometry, material); object.position.set(x * 8, 1, z * 8); root.add(object); objects.push(object);
}
// Large enclosing floor bypasses bounded grid cells, retaining exact occupancy.
const floor = new THREE.Mesh(new THREE.BoxBufferGeometry(300, .05, 300), material); floor.position.y = -.1; root.add(floor);
const document = {getRoot: () => root}, world = new World({}, document), baseline = new Baseline({}, document);
world.setRoom('hall'); baseline.setRoom('hall'); world.beginFrame(); baseline.beginFrame();
let random = 71; const sample = () => {random = (random * 1664525 + 1013904223) >>> 0; return random / 4294967296;};
const queries = [];
for (let i = 0; i < 350; i++) {
  const center = new THREE.Vector3((sample() - .5) * 165, sample() * 3, (sample() - .5) * 165), size = sample() * 3 + .1;
  queries.push({box: new THREE.Box3(center.clone().addScalar(-size / 2), center.clone().addScalar(size / 2)), movement: new THREE.Vector3((sample()-.5)*18,0,(sample()-.5)*18)});
}
function compare() {
  for (const {box, movement} of queries) {
    const candidates = world._candidates(box);
    assert.deepEqual(candidates.map(entry => entry.object), world.entries.filter(entry => entry.box.intersectsBox(box)).sort((a,b) => a.order-b.order).map(entry => entry.object));
    assert.equal(world.testBox(box), baseline.testBox(box));
    assert(Math.abs(world.sweepBox(box, movement).fraction-baseline.sweepBox(box, movement).fraction)<1e-12);
  }
}
compare();
// Within-frame replacement, reparenting, deletion and a new actor must update
// cells immediately, including negative coordinates and exact cell boundaries.
for (let index=0;index<20;index++) {objects[index].position.set(4,1,-4); world.invalidate(objects[index]); baseline.invalidate(objects[index]);}
const group = new THREE.Group(); root.add(group); for (let index=20;index<40;index++) group.add(objects[index]);
group.position.set(10,0,-9); world.invalidate(group); baseline.invalidate(group);
const removed = objects[40]; root.remove(removed); world.invalidate(removed); baseline.invalidate(removed);
const fresh = new THREE.Mesh(geometry, material); fresh.position.set(-4,1,4); root.add(fresh); world.invalidate(fresh); baseline.invalidate(fresh);
compare();
assert.equal(world.entries.length, baseline.entries.length);
assert(!world.entries.some(entry=>entry.object===removed)); assert(world.entries.some(entry=>entry.object===fresh));
const iterations=4000, empty = new THREE.Box3(new THREE.Vector3(2,.2,2),new THREE.Vector3(3,.8,3));
const timing = target => {const start=performance.now(); for(let index=0;index<iterations;index++) target.testBox(empty); return performance.now()-start;};
// Timings are informational; semantic equivalence and bounded candidate work
// are deterministic checks independent of other CPU-heavy integration tests.
const before=timing(baseline), after=timing(world);
assert(world.stats.broadphaseCandidates < world.stats.broadphasePossible * .025);
console.log('Collision broadphase: exact linear-reference agreement for 700 occupancy/sweeps, negative boundaries, moved/reparented/removed/spawned colliders, bounded candidates passed; 4000 empty queries linear '+before.toFixed(1)+'ms/indexed '+after.toFixed(1)+'ms.');
world.endFrame(); baseline.endFrame(); geometry.dispose(); floor.geometry.dispose(); material.dispose();
