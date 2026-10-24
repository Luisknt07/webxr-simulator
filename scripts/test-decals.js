const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const wearSchema = require('../shared/wear.js');
const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE);

const decalSource = fs.readFileSync(path.join(__dirname, '../node_modules/three/examples/jsm/geometries/DecalGeometry.js'), 'utf8')
  .replace(/import \{[\s\S]*?\} from "[^"]+";/, '')
  .replace('export { DecalGeometry, DecalVertex };', 'return DecalGeometry;');
const DecalGeometry = new Function('BufferGeometry', 'Float32BufferAttribute', 'Matrix4', 'Vector3', decalSource)(
  THREE.BufferGeometry, THREE.Float32BufferAttribute, THREE.Matrix4, THREE.Vector3);
const source = fs.readFileSync(path.join(__dirname, '../src/editor/DecalSystem.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class DecalSystem', 'return class DecalSystem');
const DecalSystem = new Function('THREE', 'DecalGeometry', 'getGeometryTree', 'wearSchema', source)(THREE, DecalGeometry, getGeometryTree, wearSchema);
const tick = () => new Promise(resolve => setImmediate(resolve));
const config = overrides => Object.assign({
  type: 'decal', enabled: true, asset: 'mark.png', targetId: '', width: 1, height: 1,
  depth: 0.2, opacity: 1, color: '#ffffff'
}, overrides);

function imageResource() {
  const texture = new THREE.Texture({width: 8, height: 8});
  const resource = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), new THREE.MeshBasicMaterial({map: texture}));
  const disposed = {geometry: 0, material: 0, texture: 0};
  resource.geometry.addEventListener('dispose', () => disposed.geometry++);
  resource.material.addEventListener('dispose', () => disposed.material++);
  texture.addEventListener('dispose', () => disposed.texture++);
  return {resource, texture, disposed};
}

function fixture(loader) {
  const root = new THREE.Group(), objects = [], errors = [], loads = [];
  const document = {
    getRoot: room => room === 'hall' ? root : null,
    getObjects: () => objects,
    getObject: id => objects.find(object => object.userData.editorId === id),
    getBehaviors: object => object.userData.editorBehaviors || []
  };
  const library = {
    getEntry: asset => ({path: asset, kind: asset.endsWith('.glb') ? 'model' : 'image'}),
    instantiate: descriptor => {
      loads.push(descriptor);
      return loader ? loader(descriptor) : Promise.resolve(imageResource().resource);
    }
  };
  const system = new DecalSystem({}, document, library, error => errors.push(error));
  function object(node, id) { node.userData.editorId = id; root.add(node); objects.push(node); return node; }
  function anchor(id = 'decal', settings = {}) {
    const node = object(new THREE.Group(), id);
    node.userData.editorDescriptor = {type: 'decal'};
    node.userData.editorBehaviors = [config(settings)];
    return node;
  }
  function surface(id = 'wall', size = 4) {
    return object(new THREE.Mesh(new THREE.PlaneBufferGeometry(size, size), new THREE.MeshBasicMaterial({side: THREE.DoubleSide})), id);
  }
  return {root, objects, document, library, errors, loads, system, anchor, surface};
}

function worldVertices(mesh) {
  mesh.updateWorldMatrix(true, false);
  const attribute = mesh.geometry.attributes.position;
  return Array.from({length: attribute.count}, (_, i) => new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld));
}

async function main() {
  {
    const f = fixture();
    for (let i = 0; i < 250; i++) f.surface('ordinary-' + i);
    let matrixUpdates = 0;
    const update = f.root.updateWorldMatrix.bind(f.root);
    f.root.updateWorldMatrix = (...args) => { matrixUpdates++; return update(...args); };
    f.document.getBehaviors = () => { throw new Error('Ordinary models have no decal component to normalize'); };
    for (let i = 0; i < 10; i++) f.system.sync('hall');
    assert.equal(matrixUpdates, 0, 'A room without decals does not walk its world matrices for the decal system.');
    assert.equal(f.system.stats.surfacePasses, 0);
    assert.equal(f.system.stats.behaviorReads, 0);
  }

  {
    const f = fixture();
    for (let i = 0; i < 20; i++) f.surface('wall-' + i).position.x = i * 5;
    const owners = [f.anchor('one'), f.anchor('two'), f.anchor('three')];
    f.system.sync('hall'); await tick();
    assert.equal(f.system.stats.behaviorReads, 3, 'Only actual decal components are normalized.');
    assert.equal(f.system.stats.boundsBuilds, 20, 'Surface bounds are shared between all projectors.');
    const initial = Object.assign({}, f.system.stats);
    for (let i = 0; i < 10; i++) f.system.sync('hall');
    assert.equal(f.system.stats.behaviorReads, initial.behaviorReads, 'Unchanged frames reuse normalized decal settings.');
    assert.equal(f.system.stats.boundsBuilds, initial.boundsBuilds, 'Static surfaces reuse their world bounds across frames.');
    assert.equal(f.system.stats.projections, initial.projections, 'Static scenes do not regenerate clipped geometry.');
    owners[0].userData.editorBehaviors[0].opacity = 0.2;
    f.system.sync('hall');
    assert.equal(f.system.stats.behaviorReads, initial.behaviorReads + 1, 'A property edit invalidates only its owner configuration.');
    assert.equal(f.system.stats.projections, initial.projections, 'Appearance edits keep the existing projection.');
    f.system.dispose();
  }

  {
    const resources = [];
    const f = fixture(() => { const image = imageResource(); resources.push(image); return Promise.resolve(image.resource); });
    const wall = f.surface(), owner = f.anchor('mark', {width: 1.4, height: 0.7, opacity: 0.6, color: '#66ccff'});
    f.system.sync('hall'); await tick();
    const state = f.system.states.get(owner), mesh = state.mesh;
    assert(mesh.geometry.attributes.position.count > 0, 'The decal is clipped against real target triangles.');
    assert.equal(mesh.parent, owner);
    assert(mesh.userData.editorRuntimeHelper && mesh.userData.editorDecal);
    assert.equal(mesh.userData.editorVisualOwnerId, 'mark');
    assert.equal(mesh.material.side, THREE.DoubleSide);
    assert(mesh.material.transparent && !mesh.material.depthWrite && mesh.material.polygonOffset);
    assert.equal(mesh.material.alphaTest, 0.01);
    assert.equal(mesh.material.opacity, 0.6);
    assert.equal(mesh.material.color.getHexString(), '66ccff');
    assert.equal(mesh.material.map.encoding, THREE.sRGBEncoding);
    const vertices = worldVertices(mesh);
    assert(vertices.every(point => Math.abs(point.z) < 1e-7 && Math.abs(point.x) <= 0.70001 && Math.abs(point.y) <= 0.35001), 'Projection dimensions bound the clipped world vertices.');
    const uv = mesh.geometry.attributes.uv.array;
    assert(Array.from(uv).every(value => value >= -0.00001 && value <= 1.00001), 'Projected UVs preserve the image including alpha.');
    const geometry = mesh.geometry;
    f.system.sync('hall');
    assert.equal(mesh.geometry, geometry, 'Unchanged frames reuse the generated geometry.');
    owner.userData.editorBehaviors[0].opacity = 0.3;
    f.system.sync('hall');
    assert.equal(mesh.geometry, geometry, 'Appearance-only edits do not reclamp geometry.');
    assert.equal(mesh.material.opacity, 0.3);
    assert.equal(f.loads.length, 1, 'Ordinary frames do not reload image files.');
    assert(!f.system.isSurface(mesh), 'Generated decals cannot become their own targets or placement hits.');
    assert(f.system.isSurface(wall));
    owner.userData.editorBehaviors[0].enabled = false;
    f.system.sync('hall');
    assert.equal(f.system.states.size, 0);
    assert.equal(mesh.parent, null);
    assert.deepEqual(resources[0].disposed, {geometry: 1, material: 1, texture: 1}, 'Disabling a decal releases its private loaded resources.');
  }

  {
    const f = fixture(), wall = f.surface(), owner = f.anchor();
    const parent = new THREE.Group();
    parent.position.set(3, 2, -4); parent.rotation.set(0.2, 0.8, -0.15); parent.scale.set(2, 0.5, 1.5);
    f.root.add(parent); parent.add(wall, owner);
    owner.position.set(0.25, 0, 0.02);
    owner.userData.editorBehaviors[0].width = 0.6;
    owner.userData.editorBehaviors[0].height = 0.8;
    f.system.sync('hall'); await tick();
    const mesh = f.system.states.get(owner).mesh;
    assert(mesh.geometry.attributes.position.count > 0, 'Translated, rotated, nonuniformly scaled targets accept a projected decal.');
    const inverseTarget = new THREE.Matrix4().getInverse(wall.matrixWorld);
    assert(worldVertices(mesh).every(point => Math.abs(point.clone().applyMatrix4(inverseTarget).z) < 0.00001), 'Projected geometry stays on the transformed target instead of an axis-aligned substitute.');
    const previous = mesh.geometry;
    wall.position.z = 2;
    f.system.sync('hall');
    assert.notEqual(mesh.geometry, previous, 'Target motion invalidates the projection.');
    assert.equal(mesh.geometry.attributes.position.count, 0, 'A target moved beyond projection depth is no longer painted.');
    wall.position.z = 0;
    owner.position.x = 0.6;
    f.system.sync('hall');
    assert(mesh.geometry.attributes.position.count > 0, 'Moving the projector clips again at its new pose.');
    f.system.dispose();
  }

  {
    const f = fixture(), owner = f.anchor('source', {targetId: 'self'});
    const backing = new THREE.Mesh(new THREE.PlaneBufferGeometry(4, 4), new THREE.MeshBasicMaterial());
    owner.add(backing);
    const originalMaterial = backing.material;
    f.system.sync('hall'); await tick();
    assert(f.system.states.get(owner).mesh.geometry.attributes.position.count > 0, 'A component on an existing object can project onto self.');
    assert.equal(backing.material, originalMaterial);
    assert.equal(backing.material.visible, true, 'Existing object materials are never hidden or altered.');
    owner.userData.editorBehaviors[0].targetId = '';
    f.system.sync('hall');
    assert.equal(f.system.states.get(owner).mesh.geometry.attributes.position.count, 0, 'Automatic targets exclude the projector own subtree.');
    owner.userData.editorBehaviors[0].targetId = 'deleted-target';
    f.system.sync('hall');
    assert.equal(f.system.states.get(owner).mesh.geometry.attributes.position.count, 0, 'Missing explicit targets produce no projection.');
    f.system.dispose();
  }

  {
    const f = fixture(), wall = f.surface(), farther = f.surface('other'), owner = f.anchor('mark', {targetId: 'wall'});
    farther.position.z = 0.04;
    f.system.sync('hall'); await tick();
    const state = f.system.states.get(owner);
    assert(worldVertices(state.mesh).every(point => Math.abs(point.z) < 1e-7), 'An explicit target excludes overlapping surfaces from other objects.');
    wall.visible = false;
    f.system.sync('hall');
    assert.equal(state.mesh.geometry.attributes.position.count, 0, 'Hidden surfaces are excluded.');
    wall.visible = true; wall.userData.editorGeometryReplaced = true;
    f.system.sync('hall');
    assert.equal(state.mesh.geometry.attributes.position.count, 0, 'Replaced original geometry is excluded.');
    wall.userData.editorGeometryReplaced = false; wall.material.visible = false;
    assert(!f.system.isSurface(wall));
    wall.material.visible = true; wall.name = 'textMesh';
    assert(!f.system.isSurface(wall), 'Generated SDF glyphs are not decal targets.');
    wall.name = 'sky'; assert(!f.system.isSurface(wall));
    wall.name = 'wall'; wall.userData.editorHelper = true; assert(!f.system.isSurface(wall));
    f.system.dispose();
  }

  {
    const f = fixture(), wall = f.surface(), owner = f.anchor();
    wall.geometry.deleteAttribute('normal');
    f.system.sync('hall'); await tick();
    const state = f.system.states.get(owner);
    assert(state.mesh.geometry.attributes.position.count > 0, 'Imported triangle geometry without normals can still receive decals.');
    assert(!wall.geometry.attributes.normal, 'Generating missing projection normals does not mutate shared source geometry.');
    const previous = state.mesh.geometry, positions = wall.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setZ(i, 2);
    positions.needsUpdate = true;
    f.system.sync('hall');
    assert.notEqual(state.mesh.geometry, previous);
    assert.equal(state.mesh.geometry.attributes.position.count, 0, 'Position attribute edits invalidate cached bounds and projection.');
    f.system.dispose();
  }

  {
    const resources = [];
    const f = fixture(() => { const image = imageResource(); resources.push(image); return Promise.resolve(image.resource); });
    f.surface();
    const a = f.anchor('a'), b = f.anchor('b', {color: '#ff0000'}); b.position.x = 0.4;
    f.system.sync('hall'); await tick();
    const first = f.system.states.get(a), second = f.system.states.get(b);
    assert.notEqual(first.material, second.material);
    assert.notEqual(first.material.map, second.material.map, 'Copied objects own independent texture lifetimes.');
    a.userData.editorBehaviors = [];
    f.system.sync('hall');
    assert.deepEqual(resources[0].disposed, {geometry: 1, material: 1, texture: 1});
    assert.deepEqual(resources[1].disposed, {geometry: 0, material: 0, texture: 0}, 'Removing one copy preserves the other copy resources.');
    assert(second.mesh.visible && second.mesh.material.map);
    f.system.sync('missing-room');
    assert.equal(f.system.states.size, 0);
    assert.deepEqual(resources[1].disposed, {geometry: 1, material: 1, texture: 1}, 'Room changes release decals.');
  }

  {
    const pending = [], resources = [];
    const f = fixture(() => new Promise(resolve => pending.push(resolve)));
    f.surface(); const owner = f.anchor();
    f.system.sync('hall'); await tick();
    owner.userData.editorBehaviors[0].asset = 'second.png';
    f.system.sync('hall'); await tick();
    const obsolete = imageResource(); resources.push(obsolete); pending[0](obsolete.resource); await tick();
    assert.deepEqual(obsolete.disposed, {geometry: 1, material: 1, texture: 1}, 'A late obsolete load is disposed instead of replacing the latest image.');
    assert(!f.system.states.get(owner).mesh.visible);
    f.system.dispose();
    const canceled = imageResource(); pending[1](canceled.resource); await tick();
    assert.deepEqual(canceled.disposed, {geometry: 1, material: 1, texture: 1}, 'Loads finishing after disposal cannot resurrect stale decals.');
    assert.equal(owner.children.length, 0);
    assert.equal(f.errors.length, 0);
  }

  {
    const f = fixture(() => Promise.reject(new Error('Missing image')));
    f.surface(); const owner = f.anchor();
    f.system.sync('hall'); await tick(); f.system.sync('hall'); await tick();
    assert.equal(f.errors.length, 1, 'A bad image reports one actionable failure instead of flooding each frame.');
    assert.equal(f.loads.length, 1);
    owner.userData.editorBehaviors[0].asset = '';
    f.system.sync('hall'); await tick();
    assert(!f.system.states.get(owner).mesh.visible, 'An empty asset remains a harmless unpainted projector.');
    assert.equal(f.errors.length, 1);
    owner.userData.editorBehaviors[0].asset = 'mesh.glb';
    f.system.sync('hall'); await tick();
    assert.equal(f.errors.length, 2);
    assert.equal(f.loads.length, 1, 'Nonimage assets are rejected before loading a 3D model.');
    f.system.dispose();
  }

  console.log('Decals: real clipped projection, transformed targets, caching, alpha, owned textures, target filters, copies, loading cancellation and cleanup passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
