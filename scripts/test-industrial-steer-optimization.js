'use strict';
// Real indexed geometry/rays, persistent actors and production kinematics.
// The measured counts below are resources, not inferred hardware FPS.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const THREE = require('three'), schema = require('../shared/behaviors');
const read = name => fs.readFileSync(path.join(__dirname, '../src/editor', name), 'utf8').replace(/^import .*;\r?\n/gm, '');
const {createIndustrialPrefab: factory, batchDetails} = new Function('THREE', 'behaviorSchema', read('IndustrialPrefabs.js')
  .replace(/export const /g, 'const ').replace(/export function /g, 'function ') + '\nreturn {createIndustrialPrefab,batchDetails};')(THREE, schema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', read('SceneDocument.js')
  .replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, schema, factory);
const IndustrialVisuals = new Function('THREE', read('IndustrialVisuals.js').replace('export default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE);
const near = (a, b, epsilon = 1e-5) => assert(Math.abs(a - b) <= epsilon, a + ' != ' + b);
function expanded(geometry, name) {
  const attribute = geometry.attributes[name], result = [], index = geometry.index;
  for (let vertex = 0; vertex < (index ? index.count : attribute.count); vertex++) {
    const at = index ? index.getX(vertex) : vertex;
    for (let component = 0; component < attribute.itemSize; component++) result.push(attribute.array[at * attribute.itemSize + component]);
  }
  return result;
}
function collect(root, predicate) { const result = []; root.traverse(node => { if (predicate(node)) result.push(node); }); return result; }
function dispose(root) {
  const resources = new Set(); root.traverse(node => {
    if (node.geometry) resources.add(node.geometry);
    (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => {
      resources.add(material); Object.keys(material).forEach(key => { if (material[key] && material[key].isTexture) resources.add(material[key]); });
    });
  }); resources.forEach(resource => resource.dispose());
}

async function run() {
  // Every triangle/normal/UV survives indexing, including seams and cap faces.
  const group = new THREE.Group(); group.name = 'Indexed test';
  const surface = new THREE.MeshStandardMaterial({name: 'Independent surface'});
  [new THREE.BoxBufferGeometry(.7, .2, .8), new THREE.CylinderBufferGeometry(.15, .08, .6, 16)].forEach((geometry, index) => {
    const mesh = new THREE.Mesh(geometry, surface); mesh.position.set(index, .3, -.2); mesh.rotation.set(.2, .4, .6); group.add(mesh);
  });
  const expected = {position: [], normal: [], uv: []};
  group.children.forEach(mesh => {
    mesh.updateMatrix(); const geometry = mesh.geometry.clone(); geometry.applyMatrix(mesh.matrix);
    Object.keys(expected).forEach(name => expected[name].push(...expanded(geometry, name))); geometry.dispose();
  });
  batchDetails(group); assert.equal(group.children.length, 1); assert(group.children[0].geometry.index);
  Object.keys(expected).forEach(name => assert.deepEqual(expanded(group.children[0].geometry, name), expected[name], 'Indexing preserves exact expanded ' + name));
  assert(group.children[0].geometry.attributes.position.count < expected.position.length / 3);
  assert.notEqual(group.children[0].material, surface, 'Batch materials retain independent editing ownership.');
  dispose(group);

  // Historical complete-model costs measured before indexed fitting batches.
  // Steer/distributor intentionally gain previously missing physical supports.
  const beforeBytes = [1416176,688496,1416176,707696,1014512,590192,590192,688496,689336,688496,1225400,1338296,1021496,632888,1178168,631408,1505264,694000,1424768,790400,981176,599480,507008,877040,877040];
  const beforeTris = [15468,7888,10968,8088,11284,6864,6864,7888,8008,7888,13784,14960,11648,7600,13280,9080,16684,10116,15636,9028,10976,7000,1504,9852,9852];
  // Deliberate fabricated detail: hollow sections, folded edges and real
  // supports for clipped bearings. No existing transport surface was removed.
  const fabricatedTris = [15736,8156,11168,8356,11552,7132,7132,8156,8276,8156,14052,15228,11756,7708,13648,13892,17364,15616,15904,9296,11084,7108,1704,10120,10120];
  const metrics = [];
  schema.conveyorEquipment.listEquipment().forEach((definition, index) => {
    const root = factory('conveyor', definition.variant), stats = factory.stats(root), steer = ['steer','distributor'].includes(definition.preset.mechanism);
    assert(stats.meshes < 150 && stats.triangles < 30000);
    if (!steer) {
      assert.equal(stats.triangles, fabricatedTris[index], definition.variant + ' retains all manufactured detail triangles.');
      assert(stats.triangles >= beforeTris[index], 'Index compaction never deletes a visible triangle.');
      assert(stats.bufferBytes < beforeBytes[index] * .76, definition.variant + ' reduces typed-buffer allocation by at least24%.');
    } else assert(stats.draws < (definition.variant === 'steer' ? 126 : 132), 'More complete physical equipment still uses fewer draws.');
    metrics.push({id: definition.id, ...stats}); dispose(root);
  });
  assert.equal(metrics.length, 25);

  for (const variant of ['steer', 'distributor']) for (const width of [.3, 1, 2]) {
    const root = factory('conveyor', variant, {width, length: Math.max(2.4, width * 2)}); root.updateMatrixWorld(true);
    const wheels = collect(root, node => node.userData.industrialConveyorMechanism && node.userData.industrialConveyorMechanism.kind === 'steer');
    const banks = collect(root, node => node.userData.industrialSteerBank);
    assert(wheels.length >= 2); assert.equal(banks.length, 3, 'All wheels use three independently editable banks.');
    assert(banks.every(bank => bank.geometry.index && bank.geometry.userData.industrialSteerRest));
    const frameMaterials = collect(root.children[0], node => node.isMesh).map(node => node.material.name);
    assert(frameMaterials.some(name => /Cubierta mate/.test(name))); assert(frameMaterials.some(name => /Bandeja inferior/.test(name)));
    assert(frameMaterials.some(name => /Cartucho portante/.test(name)));
    wheels.forEach(wheel => {
      const ray = new THREE.Raycaster(new THREE.Vector3(wheel.position.x, .3, wheel.position.z), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObject(root.children[2], true); assert(hits.length); near(hits[0].point.y, 0);
      // The moving assembly is connected to a fixed cartridge and closed pan.
      const support = ray.intersectObject(root.children[0], true);
      assert(support.some(hit => hit.point.y > -.25 && hit.point.y < -.1), 'Every wheel has an actual load-bearing cartridge below its axle.');
    });
    const gapRay = new THREE.Raycaster(new THREE.Vector3(-.01, .3, width / 2 - .02), new THREE.Vector3(0, -1, 0));
    const support = gapRay.intersectObject(root.children[0], true);
    assert(support.length && support[0].point.y > -.26, 'The view through the bed ends at a cover/pan rather than the distant floor.');
    const tire = banks.find(bank => bank.userData.industrialRoller); assert(tire.material.roughness >= .8 && tire.material.metalness <= .1, 'Steering tires are matte polymer, not chrome.');
    dispose(root);
  }

  for (const branchSide of ['left', 'right']) {
    const document = new SceneDocument({}), root = new THREE.Group(); document.registerRoom('hall', root);
    const owner = document.addPrefab('hall', 'conveyor', 'distributor');
    document.setBehaviors(owner, document.getBehaviors(owner).map(config => config.type === 'conveyor' ? Object.assign({}, config, {branchSide}) : config));
    const before = await document.serialize(), ids = [...document.additions.get(owner.userData.editorId).nodes].map(([key, node]) => [key,node.userData.editorId]);
    const variables = {enabled:true,powered:true,running:true,actualSpeed:.4,actuatorPosition:0,actuatorAngle:0};
    const tireMesh = collect(owner, node => node.userData.industrialSteerBank && node.userData.industrialRoller)[0];
    const wearHook = () => {}; tireMesh.material.onBeforeCompile = wearHook; tireMesh.material.defines = {PERSISTENT_WEAR_FIXTURE:1};
    const runtime = {running:true,records:new Map([[owner.userData.editorId,{variables}]])};
    const visuals = new IndustrialVisuals({}, document, runtime); root.updateMatrixWorld(true); visuals.sync('hall', 0, false);
    assert.equal(visuals.steerBanks.size, 3);
    const banks = [...visuals.steerBanks.values()], rest = banks.map(entry => entry.object.geometry.attributes.position.array.slice());
    const references = banks.map(entry => entry.object.geometry.attributes.position.array);
    variables.actuatorPosition = .5; visuals.sync('hall', .1, false);
    assert.equal(tireMesh.material.onBeforeCompile, wearHook); assert.equal(tireMesh.material.defines.PERSISTENT_WEAR_FIXTURE, 1,
      'The moving tire material preserves authored wear shader hooks.');
    banks.forEach((entry,index) => {
      near(entry.angle, (branchSide === 'left' ? 1 : -1) * Math.PI / 4);
      assert.notDeepEqual(entry.object.geometry.attributes.position.array, rest[index], 'Progress from the real sequence variable rotates physical vertices.');
      assert.equal(entry.object.geometry.attributes.position.array, references[index], 'Moving a bank reuses its allocated buffers.');
      assert(Number.isFinite(entry.object.geometry.boundingSphere.radius));
    });
    const angle = banks[0].angle, tireBank = banks.find(entry => entry.object.userData.industrialRoller), pivot = tireBank.object.geometry.userData.industrialSteerRest.ranges[0].pivot;
    const probe = new THREE.Vector3(pivot[0] + Math.sin(angle) * .065, .3, pivot[2] + Math.cos(angle) * .065);
    tireBank.object.updateWorldMatrix(true, false);
    const ray = new THREE.Raycaster(tireBank.object.localToWorld(probe), new THREE.Vector3(0,-1,0).transformDirection(tireBank.object.matrixWorld));
    const rotatedHits = ray.intersectObject(tireBank.object, true); assert(rotatedHits.length, 'The actual rotated bank remains pickable.');
    near(tireBank.object.worldToLocal(rotatedHits[0].point.clone()).y, 0, .001);
    const versions = banks.map(entry => entry.object.geometry.attributes.position.version);
    visuals.sync('hall', .1, false); assert.deepEqual(banks.map(entry => entry.object.geometry.attributes.position.version), versions, 'An unchanged angle does not upload geometry again.');
    visuals.sync('hall', .1, true);
    const restHits = ray.intersectObject(tireBank.object, true); assert(restHits.length);
    assert(tireBank.object.worldToLocal(restHits[0].point.clone()).y < -.015, 'Ray hits read current/restored vertices rather than a stale instancing proxy.');
    banks.forEach((entry,index) => assert.deepEqual(entry.object.geometry.attributes.position.array, rest[index], 'Editor mode restores exact base vertices.'));
    assert.deepEqual(await document.serialize(), before, 'Dynamic bank geometry/pivots never enter saved transforms.');
    assert.deepEqual([...document.additions.get(owner.userData.editorId).nodes].map(([key,node]) => [key,node.userData.editorId]), ids);
    const copy = await document.duplicate(owner), originalBank = banks[0].object.geometry;
    assert(!collect(copy, node => node.geometry).some(node => node.geometry === originalBank), 'Copies never share mutable bank buffers.');
    const saved = await document.serialize(), reopened = new SceneDocument({}); reopened.registerRoom('hall', new THREE.Group()); await reopened.load(saved);
    assert.equal(collect(reopened.rooms.get('hall').root, node => node.userData.industrialSteerBank).length, 6, 'Reopening reconstructs both optimized wheel banks.');
    visuals.dispose(); assert.equal(visuals.steerBanks.size, 0); dispose(root); dispose(reopened.rooms.get('hall').root);
  }
  {
    const root = new THREE.Group(), native = factory('conveyor','distributor'); root.add(native);
    native.traverse(node => {
      if (node.userData.editorDefaultBehaviors) node.userData.editorDefaultBehaviors = JSON.parse(JSON.stringify(node.userData.editorDefaultBehaviors).replace(/"@root"/g,'"native:hall:root.0"'));
    });
    // Imported/native template graphs use nativeId rather than the procedural
    // prefab reconstruction path, and therefore initially share static meshes.
    delete native.userData.editorPrefabKey; delete native.userData.editorPrefabVariant;
    const document = new SceneDocument({}); document.registerRoom('hall',root);
    const copy = await document.duplicate(native), baseBanks = collect(native,node => node.geometry && node.geometry.userData.industrialSteerRest);
    const copiedBanks = collect(copy,node => node.geometry && node.geometry.userData.industrialSteerRest);
    assert.equal(baseBanks.length,3); assert.equal(copiedBanks.length,3);
    assert.equal(baseBanks[0].geometry,copiedBanks[0].geometry,'The native template genuinely starts with shared immutable geometry.');
    const shared = baseBanks.map(node => node.geometry), rest = shared.map(geometry => geometry.attributes.position.array.slice());
    const variables = {enabled:true,powered:true,running:true,actualSpeed:.4,actuatorPosition:.5,actuatorAngle:0};
    const simulation = {running:true,records:new Map([[native.userData.editorId,{variables}],
      [copy.userData.editorId,{variables:Object.assign({},variables,{actuatorPosition:0})}]])};
    const visuals = new IndustrialVisuals({},document,simulation); root.updateMatrixWorld(true); visuals.sync('hall',.1,false);
    assert.equal(visuals.steerBanks.size,6,'Native copies recover bank ownership from geometry metadata.');
    baseBanks.forEach((bank,index) => {
      assert.notEqual(bank.geometry,copiedBanks[index].geometry,'Native source/copy own separate mutable buffers in play.');
      assert.notEqual(bank.geometry,shared[index]);
      assert.deepEqual(shared[index].attributes.position.array,rest[index],'The shared immutable template never changes.');
      assert.deepEqual(copiedBanks[index].geometry.attributes.position.array,rest[index],'Animating the native source never moves its copy.');
    });
    let released=0; [...visuals.steerBanks.values()].forEach(entry => entry.installed.addEventListener('dispose',()=>released++));
    visuals.dispose(); assert.equal(released,6,'All native-specific animation buffers are released.');
    baseBanks.forEach((bank,index) => { assert.equal(bank.geometry,shared[index]); assert.equal(copiedBanks[index].geometry,shared[index]); });
    dispose(root);
  }
  // The production runtime sets steer actuatorPosition while actuatorAngle is
  // zero. Exercise that real sequence, not only a test-injected yaw variable.
  const mechanismFixture = fs.readFileSync(path.join(__dirname, 'test-conveyor-mechanisms.js'), 'utf8');
  const harness = new Function('require', '__dirname', mechanismFixture.slice(0, mechanismFixture.indexOf('function canonical(f)')) + '\nreturn {setup,add,link,product,advance,belt};')(require, __dirname);
  for (const variant of ['steer','distributor']) {
    const f = harness.setup(), head = harness.add(f, variant, {routing:'branch'}), receiver = harness.add(f, 'roller-motor');
    harness.link(f, head, receiver, 'branch'); harness.product(f, head); f.runtime.start('hall');
    const visuals = new IndustrialVisuals({}, f.document, f.runtime); let sawActuation = false;
    for (let frame = 0; frame < 600; frame++) {
      harness.advance(f, 1/60); visuals.sync('hall', 1/60, false);
      const state = harness.belt(f, head);
      if (state.actuatorPosition > .1 && state.actuatorPosition < .9) {
        assert.equal(state.actuatorAngle, 0);
        const bank = [...visuals.steerBanks.values()].find(entry => entry.conveyor.id === head.userData.editorId);
        assert(bank); near(bank.angle, state.actuatorPosition * Math.PI / 2); sawActuation = true;
      }
    }
    assert(sawActuation, variant + ' drives its supported physical wheel bank from the actual transfer sequence.');
    assert(harness.belt(f, receiver).packages.length, 'The real product completes the visible transfer.');
    visuals.dispose(); f.runtime.stop(); dispose(f.scene);
  }
  fs.mkdirSync(path.join(__dirname, '../data/qa-studio'), {recursive:true});
  fs.writeFileSync(path.join(__dirname, '../data/qa-studio/industrial-optimized-resources.json'), JSON.stringify({units:'allocated typed-buffer bytes; visible base-pass draws; triangles', metrics}, null, 2));
  console.log('Industrial optimization: exact indexed triangles/UV/normals,25 bounded variants, supported matte steer decks, physical yaw banks, no repeated uploads, actor/copy/reopen isolation and measured resources passed.');
}
run().catch(error => {console.error(error);process.exitCode=1;});
