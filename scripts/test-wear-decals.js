// Production clipping/BVH, procedural pixels and private PBR resources. No
// renderer, image files or hardware are needed for this geometry contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const {authoredHex} = require('./material-test-colors');
const wearSchema = require('../shared/wear.js');
const behaviorSchema = require('../shared/behaviors.js');
const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);
const decalSource = fs.readFileSync(path.join(__dirname, '../node_modules/three/examples/jsm/geometries/DecalGeometry.js'), 'utf8')
  .replace(/import \{[\s\S]*?\} from "[^"]+";/, '').replace('export { DecalGeometry, DecalVertex };', 'return DecalGeometry;');
const DecalGeometry = new Function('BufferGeometry', 'Float32BufferAttribute', 'Matrix4', 'Vector3', decalSource)(THREE.BufferGeometry, THREE.Float32BufferAttribute, THREE.Matrix4, THREE.Vector3);
const source = fs.readFileSync(path.join(__dirname, '../src/editor/DecalSystem.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class DecalSystem', 'return class DecalSystem');
const DecalSystem = new Function('THREE', 'DecalGeometry', 'getGeometryTree', 'wearSchema', source)(THREE, DecalGeometry, getGeometryTree, wearSchema);
const tick = () => new Promise(resolve => setImmediate(resolve));
const stamp = (x = 0, y = 0, z = 0) => ({position: [x, y, z], quaternion: [0, 0, 0, 1], scale: [1, 1, 1]});
const config = overrides => Object.assign({type: 'decal', enabled: true, pattern: 'rust', asset: '', targetId: 'machine', width: 0.6, height: 0.6, depth: 0.2,
  opacity: 0.8, color: '#ffffff', seed: 27, wearDensity: 0.65, roughness: 0.85, metalness: 0.08, stamps: '[]'}, overrides);
function fixture(geometry = new THREE.PlaneBufferGeometry(4, 4)) {
  const root = new THREE.Group(), machine = new THREE.Group(), owner = new THREE.Group(); root.add(machine); machine.add(owner);
  machine.userData.editorId = 'machine'; owner.userData.editorId = 'stroke'; owner.userData.editorRuntimeHelper = true;
  owner.userData.editorBehaviors = [config()];
  const surface = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); machine.add(surface);
  const document = {getRoot: room => room === 'hall' ? root : null, getObjects: () => [owner], getObject: id => id === 'machine' ? machine : null,
    getBehaviors: object => object.userData.editorBehaviors};
  const loads = [], errors = [];
  const library = {getEntry: asset => ({kind: 'image', path: asset}), instantiate: descriptor => {loads.push(descriptor); throw new Error('Procedural wear must never load a file.');}};
  const system = new DecalSystem({}, document, library, error => errors.push(error));
  return {root, machine, owner, surface, document, library, loads, errors, system, config: owner.userData.editorBehaviors[0]};
}
function vertices(state) {
  state.mesh.updateWorldMatrix(true, false);
  const attribute = state.mesh.geometry.attributes.position;
  return Array.from({length: attribute.count}, (_, index) => new THREE.Vector3().fromBufferAttribute(attribute, index).applyMatrix4(state.mesh.matrixWorld));
}
function image() {
  const texture = new THREE.Texture({width: 8, height: 8}), resource = new THREE.Mesh(new THREE.PlaneBufferGeometry(), new THREE.MeshBasicMaterial({map: texture}));
  const released = {texture: 0, material: 0, geometry: 0};
  texture.addEventListener('dispose', () => released.texture++); resource.material.addEventListener('dispose', () => released.material++); resource.geometry.addEventListener('dispose', () => released.geometry++);
  return {resource, released};
}
function alphaSum(data) { let total = 0; for (let index = 3; index < data.length; index += 4) total += data[index]; return total; }

async function run() {
  for (const pattern of wearSchema.patterns.filter(value => value !== 'image')) {
    const a = wearSchema.generateWear(pattern, 46, 0.7, 64), b = wearSchema.generateWear(pattern, 46, 0.7, 64), different = wearSchema.generateWear(pattern, 47, 0.7, 64);
    assert.deepEqual(a, b, 'A saved seed must reproduce the same visual pixels.');
    assert.notDeepEqual(a.data, different.data);
    const alpha = Array.from({length: a.width * a.height}, (_, index) => a.data[index * 4 + 3]);
    assert(alpha.some(value => value === 0) && alpha.some(value => value > 60) && alpha.some(value => value > 0 && value < 255), pattern + ' has feathered irregular alpha instead of an opaque square.');
    for (let coordinate = 0; coordinate < a.width; coordinate++) {
      assert.equal(a.data[(coordinate * a.width) * 4 + 3], 0); assert.equal(a.data[(coordinate * a.width + a.width - 1) * 4 + 3], 0);
      assert.equal(a.data[coordinate * 4 + 3], 0); assert.equal(a.data[((a.width - 1) * a.width + coordinate) * 4 + 3], 0);
    }
    assert.equal(alphaSum(wearSchema.generateWear(pattern, 46, 0, 64).data), 0);
    assert(alphaSum(wearSchema.generateWear(pattern, 46, 0.9, 64).data) >= alphaSum(wearSchema.generateWear(pattern, 46, 0.2, 64).data));
    assert(a.materialData.some((value, index) => index % 4 === 1 && value > 0), 'Packed PBR properties include roughness data.');
  }
  assert.throws(() => wearSchema.generateWear('image'), /Patrón/);
  assert.throws(() => wearSchema.generateWear('rust', Infinity), /Semilla/);
  assert.throws(() => wearSchema.generateWear('rust', 1, 0.5, 1024), /Resolución/);
  assert.equal(wearSchema.normalizeStampJSON([stamp()]), wearSchema.normalizeStampJSON(JSON.stringify([stamp()])));
  assert.throws(() => wearSchema.normalizeStamps(Array(257).fill(stamp())), /256/);
  assert.throws(() => wearSchema.normalizeStamps([{position: [0, 0, 0], quaternion: [0, 0, 0, 0]}]), /normalizado/);
  assert.throws(() => wearSchema.normalizeStamps([Object.assign(stamp(), {scale: [-1, 1, 1]})]), /escala/);
  assert.throws(() => wearSchema.normalizeStamps([Object.assign(stamp(), {script: 'run'})]), /inválida/);
  assert.throws(() => wearSchema.normalizeStamps('no JSON'), /JSON/);
  const layer = wearSchema.normalizeLayers([{id: 'rust-1', pattern: 'rust', stamps: [stamp()], ignored: true}])[0];
  assert.equal(layer.ignored, undefined); assert.equal(layer.matrix.length, 16); assert.equal(layer.density, 0.65);
  assert.equal(wearSchema.normalizeLayerJSON([layer]), wearSchema.normalizeLayerJSON(JSON.stringify([layer])));
  assert.throws(() => wearSchema.normalizeLayers([{id: 'same'}, {id: 'same'}]), /duplicado/);
  assert.throws(() => wearSchema.normalizeLayers([{pattern: 'image'}]), /Patrón/);
  assert.throws(() => wearSchema.normalizeLayers([{matrix: Array(16).fill(0)}]), /afín/);
  assert.throws(() => wearSchema.normalizeLayers([{matrix: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]}]), /invertible/);
  assert.throws(() => wearSchema.normalizeLayers(Array.from({length: 9}, (_, index) => ({id: 'stroke-' + index, stamps: Array(256).fill(stamp())}))), /2048/);
  assert.throws(() => wearSchema.normalizeLayers(Array.from({length: 65}, (_, index) => ({id: 'stroke-' + index}))), /64/);
  assert.throws(() => wearSchema.normalizeLayers(' '.repeat(512001)), /tamaño/);
  assert.equal(behaviorSchema.normalizeBehaviors([{type: 'surfaceWear', layers: JSON.stringify([layer])}])[0].layers, wearSchema.normalizeLayerJSON([layer]));

  {
    const f = fixture(); f.config.stamps = JSON.stringify([stamp(-0.45, 0, 0), stamp(0.45, 0.15, 0)]);
    const unrelated = new THREE.Mesh(new THREE.PlaneBufferGeometry(4, 4), new THREE.MeshBasicMaterial()); unrelated.position.z = 0.04; f.root.add(unrelated);
    f.system.sync('hall'); const state = f.system.states.get(f.owner);
    assert(state.material.isMeshStandardMaterial && state.mesh.visible && state.material.map.isDataTexture);
    assert.equal(state.material.map.encoding, THREE.sRGBEncoding); assert.equal(f.loads.length, 0);
    assert.equal(state.material.roughnessMap, state.material.metalnessMap); assert.equal(state.material.bumpMap, state.material.roughnessMap);
    assert.equal(state.proceduralTextures.length, 2); assert.equal(state.material.roughness, 0.85); assert.equal(state.material.metalness, 0.08);
    assert.equal(state.mesh.parent, f.owner); assert.equal(state.mesh.geometry.groups.length, 0); assert(!Array.isArray(state.mesh.material));
    assert.equal(f.owner.children.filter(child => child.isMesh).length, 1, 'Every saved stroke is one mesh/material draw, including multiple clipped stamps.');
    assert(state.mesh.geometry.attributes.position.count > 6);
    assert(vertices(state).every(point => Math.abs(point.z) < 1e-7), 'Target filtering excludes a separate overlapping object.');
    assert(vertices(state).every(point => point.x >= -0.75001 && point.x <= 0.75001 && point.y >= -0.30001 && point.y <= 0.45001));
    const initial = Object.assign({}, f.system.stats), geometry = state.mesh.geometry, map = state.material.map;
    for (let index = 0; index < 12; index++) f.system.sync('hall');
    assert.equal(f.system.stats.inputTriangles, initial.inputTriangles); assert.equal(f.system.stats.projections, initial.projections); assert.equal(f.system.stats.textureBuilds, initial.textureBuilds);
    f.config.opacity = 0.4; f.config.color = '#aa8844'; f.config.roughness = 0.5; f.config.metalness = 0.3; f.system.sync('hall');
    assert.equal(state.mesh.geometry, geometry); assert.equal(state.material.map, map); assert.equal(authoredHex(state.material.color), 'aa8844');
    assert.equal(state.material.roughness, 0.5); assert.equal(state.material.metalness, 0.3); assert.equal(state.material.opacity, 0.4);
    let oldReleases = 0; state.proceduralTextures.forEach(texture => texture.addEventListener('dispose', () => oldReleases++));
    f.config.seed++; f.system.sync('hall'); assert.notEqual(state.material.map, map); assert.equal(oldReleases, 2); assert.equal(state.mesh.geometry, geometry);
    // The owner and target move rigidly together; their local clipping stays
    // valid, while the rendered layer follows the machine automatically.
    const beforeMove = f.system.stats.projections;
    f.machine.position.set(3, 2, -1); f.machine.rotation.set(0.2, -0.7, 0.1); f.machine.scale.set(2, 0.75, 1.4); f.system.sync('hall');
    assert.equal(f.system.stats.projections, beforeMove); assert.equal(state.mesh.geometry, geometry);
    const inverse = new THREE.Matrix4().getInverse(f.machine.matrixWorld);
    assert(vertices(state).every(point => Math.abs(point.clone().applyMatrix4(inverse).z) < 1e-6));
    f.surface.position.x = 8; f.system.sync('hall'); assert.equal(state.mesh.geometry.attributes.position.count, 0, 'Independent target movement still invalidates clipping.');
    assert.equal(state.mesh.parent, null, 'Unmatched wear stays editable without leaving an empty mesh in machine bounds.');
    const releases = {textures: 0, material: 0, geometry: 0};
    state.proceduralTextures.forEach(texture => texture.addEventListener('dispose', () => releases.textures++));
    state.material.addEventListener('dispose', () => releases.material++); state.mesh.geometry.addEventListener('dispose', () => releases.geometry++);
    f.system.dispose(); f.system.dispose(); assert.deepEqual(releases, {textures: 2, material: 1, geometry: 1}); assert.equal(f.owner.children.length, 0);
  }
  {
    const f = fixture(); f.surface.name = 'Armario de control'; f.config.width = 2; f.config.height = 2;
    const protectedPieces = [];
    const addProtected = (name, metadata, parentMetadata = false) => {
      const parent = new THREE.Group(), mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(0.4, 0.4), new THREE.MeshStandardMaterial({color: '#38bccc'}));
      parent.name = parentMetadata ? name : ''; mesh.name = parentMetadata ? 'Pieza interna' : name;
      Object.assign((parentMetadata ? parent : mesh).userData, metadata);
      mesh.position.z = 0.01 + protectedPieces.length * 0.006; parent.add(mesh); f.machine.add(parent);
      protectedPieces.push({mesh, material: mesh.material, geometry: mesh.geometry, color: mesh.material.color.getHex()});
    };
    addProtected('HMI', {industrialDisplay: true});
    addProtected('Pulsador', {industrialButton: true}, true);
    addProtected('LED', {industrialSensorLamp: true});
    addProtected('Luz', {industrialTower: 'running'});
    addProtected('Sensor', {industrialSensorVolume: true});
    addProtected('Rótulo del control', {});
    addProtected('Etiqueta de seguridad', {});
    addProtected('Identificación del tablero', {}, true);
    addProtected('Pantalla', {});
    f.system.sync('hall'); const state = f.system.states.get(f.owner);
    assert(vertices(state).length > 0 && vertices(state).every(point => Math.abs(point.z) < 1e-7), 'A wide wear stamp paints the cabinet while excluding overlapping HMI, button, sensor, tower and labels inside the same brush volume.');
    protectedPieces.forEach(piece => {
      assert.equal(piece.mesh.material, piece.material); assert.equal(piece.mesh.geometry, piece.geometry); assert.equal(piece.material.color.getHex(), piece.color);
    });
    f.config.pattern = 'image'; f.system.sync('hall');
    assert(vertices(state).some(point => point.z > 0.05), 'Legacy image decals retain free projection onto functional surfaces and labels.');
    f.system.dispose();
  }
  {
    const f = fixture(new THREE.BoxBufferGeometry(2, 2, 0.02)); f.surface.position.z = -0.01; f.config.depth = 0.08;
    f.system.sync('hall'); const state = f.system.states.get(f.owner);
    assert(vertices(state).length > 0 && vertices(state).every(point => Math.abs(point.z) < 1e-7), 'A standard-depth wear stamp cannot perforate a thin cabinet door and paint its opposite face.');
    assert(Array.from({length: state.mesh.geometry.attributes.normal.count}, (_, index) => state.mesh.geometry.attributes.normal.getZ(index)).every(value => value > 0.9));
    f.config.pattern = 'image'; f.system.sync('hall');
    assert(vertices(state).some(point => point.z < -0.019), 'Image decal back-face projection keeps its existing behavior.');
    f.config.pattern = 'rust'; f.owner.position.z = -0.02; f.owner.rotation.y = Math.PI; f.system.sync('hall');
    assert(vertices(state).length > 0 && vertices(state).every(point => Math.abs(point.z + 0.02) < 1e-7), 'Painting from the other side respects the rotated projector normal.');
    f.system.dispose();
  }
  {
    const f = fixture(new THREE.CylinderBufferGeometry(1, 1, 2, 48));
    f.owner.position.set(0, 0, 1.02); f.config.width = 0.7; f.config.height = 0.6; f.config.depth = 0.3; f.config.pattern = 'chipped';
    f.system.sync('hall'); const state = f.system.states.get(f.owner), points = vertices(state), normals = state.mesh.geometry.attributes.normal;
    assert(points.length > 6 && points.every(point => point.z > 0.8 && Math.abs(Math.sqrt(point.x * point.x + point.z * point.z) - 1) < 0.01), 'Wear follows real curved facets rather than a floating flat quad.');
    assert(Array.from({length: normals.count}, (_, index) => normals.getX(index)).some(value => value < -0.05));
    assert(Array.from({length: normals.count}, (_, index) => normals.getX(index)).some(value => value > 0.05));
    assert(Array.from(state.mesh.geometry.attributes.uv.array).every(value => value >= -0.00001 && value <= 1.00001));
    f.system.dispose();
  }
  {
    const f = fixture(new THREE.PlaneBufferGeometry(40, 40, 300, 300));
    f.config.width = 0.5; f.config.height = 0.5; f.config.stamps = JSON.stringify([stamp(-1), stamp(0), stamp(1)]);
    f.system.sync('hall'); assert(f.system.states.get(f.owner).mesh.geometry.attributes.position.count > 0);
    assert(f.system.stats.inputTriangles < 1500, 'A tiny brush on a 180,000-triangle mesh queries nearby BVH leaves, not every mesh triangle per stamp.');
    const count = f.system.stats.inputTriangles; f.system.sync('hall'); assert.equal(f.system.stats.inputTriangles, count); f.system.dispose();
  }
  {
    const f = fixture(new THREE.PlaneBufferGeometry(2, 2, 300, 300)); f.config.width = 2; f.config.height = 2;
    f.system.sync('hall'); const state = f.system.states.get(f.owner);
    assert.equal(state.mesh.geometry.attributes.position.count, 0); assert.equal(f.errors.length, 1); assert.match(f.errors[0], /límite de geometría/);
    assert(f.system.stats.inputTriangles <= 100000); const work = f.system.stats.inputTriangles;
    f.system.sync('hall'); assert.equal(f.errors.length, 1); assert.equal(f.system.stats.inputTriangles, work, 'Over-budget strokes are cached and never retry heavy work every frame.');
    f.system.dispose();
  }
  {
    const f = fixture(); let complete;
    f.library.instantiate = descriptor => {f.loads.push(descriptor); return new Promise(resolve => {complete = resolve;});};
    f.config.pattern = 'image'; f.config.asset = 'mark.png'; f.system.sync('hall'); await tick();
    f.config.pattern = 'grime'; f.config.asset = ''; f.system.sync('hall');
    const state = f.system.states.get(f.owner), map = state.material.map, stale = image();
    complete(stale.resource); await tick(); assert.equal(state.material.map, map); assert(state.material.isMeshStandardMaterial);
    assert.deepEqual(stale.released, {texture: 1, material: 1, geometry: 1}, 'An obsolete image load cannot replace procedural wear or leak resources.');
    f.system.dispose();
  }
  console.log('Wear decals: seeded irregular alpha/PBR maps, strict stamp/layer validation, real curved clipping, one batched mesh per stroke, relative-pose caching, spatial BVH bounds, hard budgets, image compatibility and private cleanup passed.');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
