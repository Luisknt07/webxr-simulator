const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/AcceleratedMeshRaycast.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export function installMeshRaycast', 'function installMeshRaycast');
const installMeshRaycast = new Function('THREE', source + '\nreturn installMeshRaycast;')(THREE);
const compactSource = fs.readFileSync(path.join(__dirname, '../src/lib/CompactTriangleTree.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class CompactTriangleTree', 'return class CompactTriangleTree');
const CompactTriangleTree = new Function('THREE', compactSource)(THREE);
const original = THREE.Mesh.prototype.raycast;
const v = (x, y, z) => new THREE.Vector3(x, y, z);

// Reverse traversal deliberately differs from Three's face order, as a BVH
// does. Its only job here is to supply exact original triangle coordinates.
function tree(geometry) {
  return {queryRay(ray, callback) {
    const position = geometry.attributes.position, index = geometry.index, triangle = new THREE.Triangle();
    for (let offset = (index ? index.count : position.count) - 3; offset >= 0; offset -= 3) {
      triangle.a.fromBufferAttribute(position, index ? index.getX(offset) : offset);
      triangle.b.fromBufferAttribute(position, index ? index.getX(offset + 1) : offset + 1);
      triangle.c.fromBufferAttribute(position, index ? index.getX(offset + 2) : offset + 2);
      if (callback(triangle, offset)) return true;
    }
    return false;
  }};
}

function plain(hit) {
  return {distance: hit.distance, point: hit.point.toArray(), object: hit.object,
    uv: hit.uv && hit.uv.toArray(), uv2: hit.uv2 && hit.uv2.toArray(), faceIndex: hit.faceIndex,
    face: {a: hit.face.a, b: hit.face.b, c: hit.face.c, normal: hit.face.normal.toArray(), materialIndex: hit.face.materialIndex}};
}

function compare(mesh, rays, label, getTree = tree) {
  mesh.updateMatrixWorld(true);
  const expected = rays.map(raycaster => {
    const hits = []; original.call(mesh, raycaster, hits); return hits.map(plain);
  });
  assert(installMeshRaycast(mesh, getTree), label + ': static mesh can be accelerated.');
  rays.forEach((raycaster, index) => {
    const hits = []; mesh.raycast(raycaster, hits);
    assert.deepEqual(hits.map(plain), expected[index], label + ': hit fields and ordering match the original Mesh.raycast.');
  });
  assert.equal(THREE.Mesh.prototype.raycast, original, 'Acceleration never changes the global Mesh prototype.');
}

function material(side = THREE.DoubleSide) { return new THREE.MeshBasicMaterial({side}); }
function ray(origin, direction, near = 0, far = Infinity) { return new THREE.Raycaster(origin, direction.clone().normalize(), near, far); }
const rays = [ray(v(0.13, 0.17, 4), v(0, 0, -1)), ray(v(0, 0, 4), v(0, 0, -1)),
  ray(v(0, 0, 0), v(0, 0, 1)), ray(v(4, 0.15, 0.2), v(-1, 0, 0)), ray(v(0.1, 0.2, 4), v(0, 0, -1), 4, 6),
  ray(v(0.1, 0.2, 4), v(0, 0, -1), 0, 2), ray(v(5, 5, 5), v(0, 0, -1))];

for (const indexed of [true, false]) for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) {
  let geometry = new THREE.BoxBufferGeometry(2, 2, 2);
  if (!indexed) geometry = geometry.toNonIndexed();
  const uv2 = geometry.attributes.uv.clone(); uv2.array = uv2.array.map(value => value * 0.7 + 0.1);
  geometry.setAttribute('uv2', uv2);
  compare(new THREE.Mesh(geometry, material(side)), rays, (indexed ? 'Indexed' : 'Nonindexed') + '/side ' + side);
}

{
  const geometry = new THREE.BoxBufferGeometry(2, 2, 2), materials = [material(THREE.FrontSide), material(), material(THREE.BackSide)];
  geometry.clearGroups(); geometry.addGroup(0, 36, 0); geometry.addGroup(0, 36, 1); geometry.addGroup(6, 24, 2);
  geometry.setDrawRange(3, 30);
  compare(new THREE.Mesh(geometry, materials), rays, 'Overlapping material groups and clipped draw range');
  geometry.setDrawRange(0, Infinity);
  compare(new THREE.Mesh(geometry, material()), rays, 'Single material ignores geometry groups');
}

{
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(2, 2, 2), material());
  mesh.position.set(1.1, 0.6, -0.7); mesh.scale.set(-1.7, 0.65, 2.4); mesh.rotation.set(0.3, 0.5, -0.1);
  compare(mesh, [ray(v(1.2, 0.7, 8), v(-0.1, 0, -1)), ray(v(1.1, 0.6, -0.7), v(0, 1, 0)),
    ray(v(8, 0.8, -0.4), v(-1, 0, 0), 0.1, 12)], 'Nonuniform negative scale and rotation');
}

{
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1e-7, -1e-7, 0, 1e-7, -1e-7, 0, 0, 1e-7, 0], 3));
  compare(new THREE.Mesh(geometry, material()), [ray(v(0, 0, 1), v(0, 0, -1))], 'Tiny finite triangles remain selectable');
  compare(new THREE.Mesh(geometry, material()), [ray(v(0, 0, 1), v(0, 0, -1))], 'Compact tree preserves tiny finite triangles', geometry => new CompactTriangleTree(geometry));
}

{
  const geometry = new THREE.SphereBufferGeometry(1, 80, 40), mesh = new THREE.Mesh(geometry, material());
  const compact = new CompactTriangleTree(geometry), randomRays = [];
  let seed = 1841;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 120; i++) {
    const origin = v(random() * 6 - 3, random() * 6 - 3, random() * 6 - 3);
    randomRays.push(ray(origin, origin.clone().negate().add(v(random() - 0.5, random() - 0.5, random() - 0.5))));
  }
  compare(mesh, randomRays.concat(rays), 'Actual compact hierarchy and deterministic random rays', () => compact);
  const grouped = new THREE.BoxBufferGeometry(2, 2, 2);
  grouped.clearGroups(); grouped.addGroup(0, 36, 1); grouped.addGroup(0, 36, 0); grouped.setDrawRange(3, 30);
  const groupTree = new CompactTriangleTree(grouped);
  compare(new THREE.Mesh(grouped, [material(), material(THREE.BackSide)]), rays,
    'Actual compact hierarchy preserves overlapping groups and draw clipping', () => groupTree);
}

{
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(2, 2, 2), material());
  mesh.raycast = () => {};
  assert(!installMeshRaycast(mesh, tree), 'Custom raycast implementations remain owned by their feature.');
  const skinned = new THREE.SkinnedMesh(new THREE.BoxBufferGeometry(), material());
  assert(!installMeshRaycast(skinned, tree));
  const instanced = new THREE.Mesh(new THREE.BoxBufferGeometry(), material()); instanced.isInstancedMesh = true;
  assert(!installMeshRaycast(instanced, tree));
  const legacy = new THREE.Mesh(new THREE.BoxGeometry(), material()); assert(!installMeshRaycast(legacy, tree));
  const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial()); assert(!installMeshRaycast(line, tree));
  const morphed = new THREE.Mesh(new THREE.BoxBufferGeometry(), material());
  morphed.geometry.morphAttributes.position = [morphed.geometry.attributes.position.clone()];
  assert(!installMeshRaycast(morphed, tree), 'Morph geometry stays on the original path.');
  const misaligned = new THREE.Mesh(new THREE.BoxBufferGeometry(), material()); misaligned.geometry.setDrawRange(1, 5);
  assert(!installMeshRaycast(misaligned, tree), 'Draw ranges that do not describe original triangle offsets use Three.');
}

{
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(2, 2, 2), material());
  let calls = 0;
  assert(installMeshRaycast(mesh, geometry => { calls++; return tree(geometry); }));
  mesh.geometry.morphAttributes.position = [mesh.geometry.attributes.position.clone()];
  const actual = [], expected = [], r = rays[0];
  original.call(mesh, r, expected); mesh.raycast(r, actual);
  assert.deepEqual(actual.map(plain), expected.map(plain));
  assert.equal(calls, 0, 'Later morph edits fall back without querying a stale static tree.');
  mesh.geometry.morphAttributes.position = [];
  assert(installMeshRaycast(mesh, () => { throw new Error('Worker tree unavailable'); }));
  const fallback = []; mesh.raycast(r, fallback);
  assert.deepEqual(fallback.map(plain), expected.map(plain), 'Unavailable acceleration preserves original selection.');
}

console.log('AcceleratedMeshRaycast: exact Three hit fields/order, indexed/nonindexed UVs, material groups/sides, draw ranges, transforms, tiny triangles and unsupported/custom fallbacks passed.');
