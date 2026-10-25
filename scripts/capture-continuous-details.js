'use strict';
// Read-only visual evidence for an already reviewed, physically verified candidate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {withBrowser, request, hash, bytesHash, requestRaw} = require('./upgrade-cedi-examples');
const {verifyContinuousArtifact, guardContinuousCandidate, PROJECT, ORIGINAL, BASE_HASH, ORIGINAL_HASH} = require('./upgrade-continuous-examples');
const {installContinuousQA} = require('./continuous-inventory-qa');
const schema = require('../shared/behaviors');
const OUTPUT = path.resolve(__dirname, '../data/qa-studio');
const prefabSource = fs.readFileSync(path.resolve(__dirname, '../src/editor/IndustrialPrefabs.js'), 'utf8');
const statsMarker = 'createIndustrialPrefab.stats = ';
const statsSource = prefabSource.slice(prefabSource.indexOf(statsMarker) + statsMarker.length).trim().replace(/;$/, '');
assert(statsSource.startsWith('object => {') && statsSource.endsWith('}'));

function frameDetail(id, kind) {
  const e = context.editor, r = e.simulation, record = r.records.get(id), object = record.object;
  const v = context.camera.position.clone(), q = context.camera.quaternion.clone();
  const config = r.machineComponent(record).config;
  let center, size;
  if (kind === 'pallet') {
    const visible = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };
    const product = [...r.products.values()].find(value => value.sourceEntry?.originId === id && visible(value.object));
    if (!product) throw new Error('The real Source pallet is not visible.');
    // Runtime helpers intentionally do not participate in authored mesh bounds.
    // Use the same transformed canonical product bounds as collision admission.
    product.object.updateWorldMatrix(true, true);
    const box = product.bounds.clone().applyMatrix4(product.object.matrixWorld);
    if (box.isEmpty() || !box.min.toArray().concat(box.max.toArray()).every(Number.isFinite)) throw new Error('Invalid real pallet collision bounds.');
    center = box.getCenter(v.clone()); size = box.getSize(v.clone());
  } else {
    center = object.localToWorld(v.clone().set(0, .05, 0));
    const scale = object.getWorldScale(v.clone());
    size = v.clone().set(config.length * scale.x, .8 * scale.y, Math.max(config.width, config.length / 2) * scale.z);
  }
  const direction = v.clone().set(1, .9, 1).normalize().applyQuaternion(object.getWorldQuaternion(q));
  const distance = Math.max(2.8, size.length() * 1.1);
  const eye = center.clone().addScaledVector(direction, distance);
  const current = context.camera.getWorldPosition(v.clone());
  context.cameraRig.position.add(eye.clone().sub(current)); context.cameraRig.updateMatrixWorld(true);
  context.camera.lookAt(center); context.camera.updateMatrixWorld(true);
  e.performance.update(context.camera, 0); e.industrialVisuals.sync(e.roomId, .1, false);
  return {id, kind, name: object.name, eye: eye.toArray(), center: center.toArray(), size: size.toArray(), mechanism: config.mechanism,
    runtimeState: record.variables.mechanismPhase || record.variables.status, actuatorPosition: record.variables.actuatorPosition || 0, poseBasis: 'Real fresh runtime; constructive detail at rest, without forced actuation.'};
}

function compareActiveMatrices() {
  const e = context.editor, values = [];
  e.root.updateMatrixWorld(true);
  e.root.traverse(node => values.push([node, node.matrixWorld.elements.slice()]));
  e.hooks.renderScene.updateMatrixWorld(true);
  let maxDifference = 0;
  values.forEach(([node, before]) => before.forEach((value, index) => { maxDifference = Math.max(maxDifference, Math.abs(value - node.matrixWorld.elements[index])); }));
  return {nodes: values.length, maxDifference};
}

async function run() {
  const file = path.resolve(process.argv[2] || path.join(OUTPUT, 'continuous-candidate.json'));
  assert(file.startsWith(OUTPUT + path.sep));
  const artifact = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = (await request('/api/projects/' + PROJECT)).project, original = (await request('/api/projects/' + ORIGINAL)).project;
  assert.equal(before.revision, 13); assert.equal(hash(before.document), BASE_HASH);
  assert.equal(original.revision, 9); assert.equal(hash(original.document), ORIGINAL_HASH);
  verifyContinuousArtifact(artifact, before.document);
  assert.equal(bytesHash(await requestRaw('/bundle.js')), artifact.bundleHash);
  return withBrowser(PROJECT, async browser => {
    await browser.evaluate('(async()=>{const e=context.editor;await e.applyServerProject(' + JSON.stringify({...before, document: artifact.document}) + ',{roomId:"photogrammetry"});return true})()');
    const views = [], matrices = [], geometry = [];
    for (const scene of artifact.manifest.scenarios) {
      await browser.evaluate('(async()=>{const e=context.editor;if(!e.active)e.enter();await e.hooks.gotoRoom(' + schema.studio.ROOM_IDS.indexOf(scene.roomId) + ');e.entities.sync();e.home();e.leave();e.simulationPaused=true;return true})()');
      await browser.evaluate('(' + installContinuousQA.toString() + ')(' + JSON.stringify(scene) + ')');
      matrices.push({roomId: scene.roomId, ...await browser.evaluate('(' + compareActiveMatrices.toString() + ')()')});
      const ids = await browser.evaluate('(()=>{const r=context.editor.simulation,records=[...r.records.values()];return ["steer","distributor"].map(mechanism=>records.find(record=>record.components.conveyor?.config.mechanism===mechanism)?.id).filter(Boolean)})()');
      for (const id of ids) {
        geometry.push({roomId: scene.roomId, id, ...await browser.evaluate('(' + statsSource + ')(context.editor.simulation.records.get(' + JSON.stringify(id) + ').object)')});
        const view = await browser.evaluate('(' + frameDetail.toString() + ')(' + JSON.stringify(id) + ',"mechanism")');
        views.push({roomId: scene.roomId, ...view}); await browser.screenshot('continuous-' + scene.roomId + '-detail-' + view.mechanism);
      }
      const sourceId = await browser.evaluate('[...context.editor.simulation.records.values()].find(record=>record.components.source?.config.loadMode==="pallet")?.id');
      if (sourceId) {
        const view = await browser.evaluate('(' + frameDetail.toString() + ')(' + JSON.stringify(sourceId) + ',"pallet")');
        views.push({roomId: scene.roomId, ...view}); await browser.screenshot('continuous-' + scene.roomId + '-pallet-fit-detail');
      }
      await browser.evaluate('__continuousQA.restore();context.editor.enter();true');
    }
    matrices.forEach(value => assert(value.maxDifference < 1e-12));
    const unchanged = guardContinuousCandidate(before.document, await browser.evaluate('(async()=>context.editor.document.serialize())()'));
    assert.equal(unchanged.reviewedPayloadHash, artifact.reviewedPayloadHash, 'Visual QA changed an authored value.');
    assert.deepEqual(browser.writes, []); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
    const saved = (await request('/api/projects/' + PROJECT)).project; assert.equal(saved.revision, 13); assert.equal(hash(saved.document), BASE_HASH);
    fs.writeFileSync(path.join(OUTPUT, 'continuous-details.json'), JSON.stringify({readOnly: true, authoredUnchanged: true, candidateHash: bytesHash(fs.readFileSync(file)), views, matrices, geometry, geometryBasis: 'Exact unique geometry/animation ArrayBuffers; excludes textures, materials and JS overhead; no FPS estimate.', shots: browser.shots, writes: [], errors: []}, null, 2));
    console.log(JSON.stringify({readOnly: true, views: views.length, matrices, shots: browser.shots}));
  });
}
module.exports = {frameDetail, compareActiveMatrices};
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
