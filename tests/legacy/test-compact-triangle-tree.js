const __layout = require("../../tooling/layout.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');

const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-compact-triangle-tree.js"), '../src/lib/CompactTriangleTree.js')), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class CompactTriangleTree', 'class CompactTriangleTree');
const CompactTriangleTree = new Function('THREE', source + '\nreturn CompactTriangleTree;')(THREE);
const v = (x, y, z) => new THREE.Vector3(x, y, z);
function each(geometry, callback) {
  const position = geometry.attributes.position, index = geometry.index;
  const start = geometry.drawRange.start, end = Math.min(index ? index.count : position.count, start + geometry.drawRange.count);
  for (let offset = start; offset + 2 < end; offset += 3) {
    const triangle = new THREE.Triangle(...[0, 1, 2].map(corner =>
      new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(offset + corner) : offset + corner)));
    if (Number.isFinite(triangle.a.lengthSq() + triangle.b.lengthSq() + triangle.c.lengthSq())) callback(triangle, offset);
  }
}
function close(actual, expected, label) {
  assert(actual && expected && actual.distanceTo(expected) < 1e-8, label + ': ' + actual.toArray() + ' / ' + expected.toArray());
}
function nearest(geometry, point, matrix, minArea = 0) {
  let best = Infinity, result = null;
  each(geometry, triangle => {
    if (triangle.getArea() < minArea) return;
    [triangle.a, triangle.b, triangle.c].forEach(vertex => vertex.applyMatrix4(matrix));
    const candidate = triangle.closestPointToPoint(point, new THREE.Vector3()), distance = candidate.distanceToSquared(point);
    if (distance < best) { best = distance; result = candidate; }
  });
  return result;
}
let seed = 39561;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; }
function randomGeometry(count) {
  const positions = [], indices = [];
  for (let i = 0; i < count; i++) {
    const center = v(random() * 30 - 15, random() * 30 - 15, random() * 30 - 15);
    for (let corner = 0; corner < 3; corner++) {
      positions.push(center.x + random() * 2 - 1, center.y + random() * 2 - 1, center.z + random() * 2 - 1);
      indices.push(indices.length);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float64Array(positions), 3));
  geometry.setIndex(indices);
  return geometry;
}

{
  const geometry = randomGeometry(1107), positions = geometry.attributes.position.array.slice(), indices = geometry.index.array.slice();
  const tree = new CompactTriangleTree(geometry);
  assert.equal(tree.triangleCount, 1107);
  assert(tree.nodeCount > 1);
  assert(tree.byteLength < 1107 * 32, 'The retained tree stores packed nodes and original triangle offsets, not triangle objects.');
  assert.deepEqual(geometry.attributes.position.array, positions);
  assert.deepEqual(geometry.index.array, indices, 'Building a tree must not reorder rendering indices or change face IDs.');
  const all = new Map();
  tree.forEachTriangle((triangle, offset) => all.set(offset, triangle.clone()));
  assert.equal(all.size, 1107, 'For-each traversal ignores callback return values.');
  each(geometry, (triangle, offset) => assert(all.get(offset).equals(triangle)));
  for (let i = 0; i < 80; i++) {
    const center = v(random() * 36 - 18, random() * 36 - 18, random() * 36 - 18);
    const box = new THREE.Box3().setFromCenterAndSize(center, v(random() * 8, random() * 8, random() * 8));
    const expected = [], actual = [];
    each(geometry, (triangle, offset) => {
      if (new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]).intersectsBox(box)) expected.push(offset);
    });
    assert.equal(tree.query(box, (triangle, offset) => { actual.push(offset); return false; }), false);
    assert.deepEqual(actual.sort((a, b) => a - b), expected, 'Packed AABB candidates exactly match brute-force triangle bounds.');
  }
  let visited = 0;
  assert(tree.query(new THREE.Box3(v(-100, -100, -100), v(100, 100, 100)), () => { visited++; return true; }));
  assert.equal(visited, 1, 'A positive callback terminates traversal immediately.');
  const rays = [new THREE.Ray(v(0, 0, 0), v(0, 1, 0)), new THREE.Ray(v(-20, 0, 0), v(1, 0, 0)),
    new THREE.Ray(v(0, 0, 20), v(0, 0, -1))];
  for (let i = 0; i < 60; i++) rays.push(new THREE.Ray(v(random() * 40 - 20, random() * 40 - 20, 30),
    v(random() - 0.5, random() - 0.5, -1).normalize()));
  for (const ray of rays) {
    const expected = [], point = new THREE.Vector3();
    each(geometry, triangle => { if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, point)) expected.push(point.clone()); });
    const actual = tree.rayIntersections(ray);
    const sort = points => points.sort((a, b) => a.distanceToSquared(ray.origin) - b.distanceToSquared(ray.origin));
    assert.equal(actual.length, expected.length, 'Both faces and all ray crossings must survive acceleration.');
    sort(actual); sort(expected); actual.forEach((point, i) => close(point, expected[i], 'Ray hit'));
  }
  const transforms = [new THREE.Matrix4(), new THREE.Matrix4().compose(v(4, -2, 7),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.7, -0.5)), v(0.2, 7, -2)),
  new THREE.Matrix4().set(2, 3, -1, 11, 0, 0.2, 1.5, 4, 0.7, 0.4, 0.5, -7, 0, 0, 0, 1)];
  for (const matrix of transforms) for (let i = 0; i < 35; i++) {
    const point = v(random() * 70 - 35, random() * 70 - 35, random() * 70 - 35);
    close(tree.closestPoint(point, matrix), nearest(geometry, point, matrix), 'Nearest point under nonuniform/reflected/sheared world transform');
  }
  const serialized = structuredClone(tree.serialize());
  const restored = CompactTriangleTree.fromSerialized(serialized, geometry);
  assert.equal(restored.position, geometry.attributes.position);
  assert.equal(restored.index, geometry.index);
  assert.equal(restored.triangleCount, tree.triangleCount);
  close(restored.closestPoint(v(25, 26, 27)), tree.closestPoint(v(25, 26, 27)), 'Transferred tree');
  assert.throws(() => CompactTriangleTree.fromSerialized(serialized, randomGeometry(5)), /does not match/);
}

{
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    9, 9, 9, 10, 9, 9, 9, 10, 9,
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 2, 1e-7, 0, 2, 0, 1e-7, 2,
    0, 0, 4, 0, 0, 4, 0, 0, 4,
    NaN, 0, 6, 1, 0, 6, 0, 1, 6], 3));
  geometry.setDrawRange(3, 12);
  const tree = new CompactTriangleTree(geometry);
  const offsets = [];
  tree.forEachTriangle((triangle, offset) => { offsets.push(offset); });
  assert.deepEqual(offsets.sort((a, b) => a - b), [3, 6, 9], 'Draw ranges retain finite tiny and degenerate faces and omit non-finite data.');
  const ray = new THREE.Ray(v(2e-8, 2e-8, 10), v(0, 0, -1));
  assert.equal(tree.rayIntersections(ray).length, 2, 'Picking does not inherit the collision area cutoff.');
  assert.equal(tree.closestPoint(v(0, 0, 4)).z, 4);
  assert.equal(tree.closestPoint(v(0, 0, 4), new THREE.Matrix4(), 1e-12).z, 0, 'Physics callers can retain their area tolerance.');
  const fromAttributes = new CompactTriangleTree(geometry.attributes.position, null, geometry.drawRange);
  assert.deepEqual(fromAttributes.triangleOffsets, tree.triangleOffsets);
  const empty = new THREE.BufferGeometry(); empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  const emptyTree = new CompactTriangleTree(empty);
  assert.equal(emptyTree.query(new THREE.Box3(v(-1, -1, -1), v(1, 1, 1)), () => true), false);
  assert.deepEqual(emptyTree.rayIntersections(ray), []);
  assert.equal(emptyTree.closestPoint(v(0, 0, 0)), null);
  assert(CompactTriangleTree.fromSerialized(structuredClone(emptyTree.serialize()), empty).box.isEmpty());
}

{
  const box = new THREE.BoxBufferGeometry(2, 2, 2);
  const original = new CompactTriangleTree(box);
  assert(original.closedSurface(), 'UV and hard-normal seams are canonicalized by position.');
  const serialized = structuredClone(original.serialize());
  assert.equal(serialized.closed, true);
  assert.equal(CompactTriangleTree.fromSerialized(serialized, box).closed, true, 'Closure travels with a worker-built tree.');
  const x = box.attributes.position.getX(0);
  box.attributes.position.setX(0, x + 1e-6);
  assert(new CompactTriangleTree(box).closedSurface(), 'Closure retains 1e-5 position quantization.');
  box.attributes.position.setX(0, x + 3e-5);
  assert(!new CompactTriangleTree(box).closedSurface(), 'Real openings remain open.');
  assert(!new CompactTriangleTree(new THREE.PlaneBufferGeometry(2, 2)).closedSurface());
  assert(new CompactTriangleTree(new THREE.SphereBufferGeometry(1, 64, 32)).closedSurface());
  const repeated = new THREE.BufferGeometry();
  const triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  for (const copies of [2, 3, 4]) {
    repeated.setAttribute('position', new THREE.Float32BufferAttribute(Array(copies).fill(triangle).flat(), 3));
    assert.equal(new CompactTriangleTree(repeated).closedSurface(), copies % 2 === 0,
      'Even non-manifold multiplicity preserves the collision occupancy parity definition.');
  }
  const tiny = new THREE.BufferGeometry();
  tiny.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1e-7, 0, 0, 0, 1e-7, 0], 3));
  assert(new CompactTriangleTree(tiny).closedSurface(), 'Collision closure ignores faces below its existing area cutoff.');
}

// Optional read-only benchmark of the actual imported owl. It is deliberately
// excluded from routine tests and never opens or changes project storage.
if (process.env.HELLO_WEBXR_BENCHMARK_OWL) {
  const filename = __layout.map(path.resolve(process.env.HELLO_WEBXR_BENCHMARK_OWL)), bytes = fs.readFileSync(filename);
  let json, binary;
  for (let p = 12; p < bytes.length;) {
    const size = bytes.readUInt32LE(p), type = bytes.readUInt32LE(p + 4);
    if (type === 0x4e4f534a) json = JSON.parse(bytes.toString('utf8', p + 8, p + 8 + size));
    else if (type === 0x004e4942) binary = bytes.subarray(p + 8, p + 8 + size);
    p += size + 8;
  }
  const primitive = json.meshes[0].primitives[0];
  const attribute = (number, itemSize) => {
    const a = json.accessors[number], view = json.bufferViews[a.bufferView];
    const Type = a.componentType === 5126 ? Float32Array : a.componentType === 5125 ? Uint32Array : Uint16Array;
    return new THREE.BufferAttribute(new Type(binary.buffer,
      binary.byteOffset + (view.byteOffset || 0) + (a.byteOffset || 0), a.count * itemSize), itemSize);
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', attribute(primitive.attributes.POSITION, 3));
  geometry.setIndex(attribute(primitive.indices, 1));
  const started = performance.now(), tree = new CompactTriangleTree(geometry), built = performance.now();
  const closed = tree.closedSurface(), finished = performance.now();
  assert.equal(tree.triangleCount, geometry.index.count / 3);
  assert(closed);
  assert(tree.byteLength < tree.triangleCount * 20, 'Millions of exact faces need compact retained storage.');
  const center = tree.box.getCenter(new THREE.Vector3()), size = tree.box.getSize(new THREE.Vector3());
  let crossings = 0;
  for (let i = 0; i < 100; i++) {
    const origin = center.clone().add(v((i % 10 - 4.5) * size.x / 15, (Math.floor(i / 10) - 4.5) * size.y / 15, size.z * 3));
    crossings += tree.rayIntersections(new THREE.Ray(origin, center.clone().sub(origin).normalize())).length;
  }
  const raysFinished = performance.now();
  for (let i = 0; i < 100; i++) {
    const point = center.clone().add(v(size.x * 2, (i / 100 - 0.5) * size.y, size.z * 2));
    assert(tree.closestPoint(point));
  }
  const nearestFinished = performance.now();
  console.log(JSON.stringify({benchmark: 'owl packed exact BVH', triangles: tree.triangleCount, nodes: tree.nodeCount,
    buildMs: Math.round(built - started), closureMs: Math.round(finished - built),
    ray100Ms: Math.round(raysFinished - finished), rayCrossings: crossings, nearest100Ms: Math.round(nearestFinished - raysFinished),
    retainedMiB: Number((tree.byteLength / 1048576).toFixed(2)), rssMiB: Math.round(process.memoryUsage().rss / 1048576)}));
}

console.log('Compact triangle tree: exact AABB/ray queries, world-metric nearest points, original face offsets, draw ranges, tiny faces, packed transfer and closure parity passed.');
