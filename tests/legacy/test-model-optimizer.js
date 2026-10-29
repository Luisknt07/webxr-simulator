const __layout = require("../../tooling/layout.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');

const sourceRoot = __layout.map(path.join(__layout.oldDir("scripts/test-model-optimizer.js"), '..'));
const coreSource = fs.readFileSync(__layout.map(path.join(sourceRoot, "packages/render-three/src/MeshIndexOptimizer.js")), 'utf8').replace(/^export /gm, '');
const {optimizeIndexRanges, cacheMisses} = new Function(coreSource + '\nreturn {optimizeIndexRanges, cacheMisses};')();
const optimizerSource = fs.readFileSync(__layout.map(path.join(sourceRoot, "packages/render-three/src/ModelOptimizer.js")), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

function triangleMultiset(indices, start = 0, count = indices.length) {
  const result = new Map();
  for (let i = start; i < start + count; i += 3) {
    // The ordered tuple, rather than sorted vertices, verifies winding and the
    // provoking vertex as well as duplicate triangles.
    const key = indices[i] + ',' + indices[i + 1] + ',' + indices[i + 2];
    result.set(key, (result.get(key) || 0) + 1);
  }
  return result;
}

function shuffledGeometry() {
  const geometry = new THREE.PlaneBufferGeometry(5, 5, 240, 240);
  const indices = geometry.index.array;
  let seed = 27691;
  for (let i = indices.length / 3 - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const other = seed % (i + 1);
    for (let c = 0; c < 3; c++) {
      const value = indices[i * 3 + c];
      indices[i * 3 + c] = indices[other * 3 + c];
      indices[other * 3 + c] = value;
    }
  }
  return geometry;
}

function snapshotAttributes(geometry) {
  const result = {};
  Object.keys(geometry.attributes).forEach(key => {
    const attribute = geometry.attributes[key];
    const array = attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;
    result[key] = {attribute, array, bytes: Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('hex')};
  });
  return result;
}

async function run() {
  const {MeshoptEncoder} = await import('meshoptimizer/encoder');
  await MeshoptEncoder.ready;
  const geometry = shuffledGeometry();
  const indices = geometry.index.array;
  const original = indices.slice();
  const count = indices.length;
  const ranges = [{start: 3, count: count / 2 - 3}, {start: count / 2, count: count / 2 - 3}];
  const result = optimizeIndexRanges(MeshoptEncoder, indices, ranges, geometry.attributes.position.count);
  assert.equal(result.changed, true);
  assert(result.afterMisses < result.beforeMisses * 0.65, 'A scrambled mesh should reuse significantly more vertices.');
  assert.deepEqual(indices, original, 'Worker preparation must preserve the input copy.');
  assert.deepEqual(result.indices.slice(0, 3), original.slice(0, 3));
  assert.deepEqual(result.indices.slice(-3), original.slice(-3));
  ranges.forEach(range => assert.deepEqual(triangleMultiset(result.indices, range.start, range.count), triangleMultiset(original, range.start, range.count)));
  assert.throws(() => optimizeIndexRanges(MeshoptEncoder, indices, [{start: 1, count: 3}], geometry.attributes.position.count));
  assert.throws(() => optimizeIndexRanges(MeshoptEncoder, new Uint32Array([0, 1, 999]), [{start: 0, count: 3}], 3));
  const typed32 = optimizeIndexRanges(MeshoptEncoder, new Uint32Array(original), [{start: 0, count}], geometry.attributes.position.count);
  assert(typed32.indices instanceof Uint32Array);
  assert.deepEqual(triangleMultiset(typed32.indices), triangleMultiset(original));

  // Exercise the actual worker message handler in a separate JS/WASM thread.
  // Main-thread timers must continue while its heavy loop prepares geometry.
  const {Worker: NodeWorker} = require('node:worker_threads');
  const {pathToFileURL} = require('node:url');
  const encoderURL = pathToFileURL(__layout.map(path.join(sourceRoot, 'node_modules/meshoptimizer/meshopt_encoder.js'))).href;
  const workerSource = fs.readFileSync(__layout.map(path.join(sourceRoot, "packages/render-three/workers/MeshOptimizerWorker.js")), 'utf8').replace(/^import .*;\r?\n/gm, '');
  const threadedSource = 'const {parentPort} = require("node:worker_threads");' +
    'const self = {postMessage: (data, transfers) => parentPort.postMessage(data, transfers)};' + coreSource +
    '\nimport(' + JSON.stringify(encoderURL) + ').then(({MeshoptEncoder}) => {' + workerSource +
    '\nparentPort.on("message", data => self.onmessage({data}));});';
  const actualWorker = new NodeWorker(threadedSource, {eval: true});
  let ticks = 0;
  const tick = setInterval(() => ticks++, 1);
  try {
    const returned = new Promise((resolve, reject) => { actualWorker.once('message', resolve); actualWorker.once('error', reject); });
    const transferred = original.slice();
    actualWorker.postMessage({id: 42, indices: transferred, ranges, vertexCount: geometry.attributes.position.count}, [transferred.buffer]);
    assert.equal(transferred.buffer.byteLength, 0);
    const message = await returned;
    assert.equal(message.id, 42);
    assert.equal(message.error, undefined);
    assert.deepEqual(message.indices, result.indices);
    assert(ticks > 0, 'The main event loop must remain responsive during optimization.');
    assert.deepEqual(indices, original);
  } finally {
    clearInterval(tick);
    await actualWorker.terminate();
  }

  let posted = 0;
  let terminated = 0;
  let alive = 0;
  let maxAlive = 0;
  let fail = false;
  let gate = null;
  class Worker {
    constructor(url) {
      assert.equal(url, 'https://localhost:8080/mesh-optimizer-worker.js');
      alive++;
      maxAlive = Math.max(alive, maxAlive);
    }
    postMessage(job, transfers) {
      posted++;
      // A real worker transfer detaches its input. Verify that the original
      // BufferAttribute still owns a non-detached buffer after that transfer.
      const received = structuredClone(job, {transfer: transfers});
      const complete = () => {
        if (fail) return this.onerror(new Error('Worker failed.'));
        const optimized = optimizeIndexRanges(MeshoptEncoder, received.indices, received.ranges, received.vertexCount);
        this.onmessage({data: Object.assign({id: received.id}, optimized)});
      };
      if (gate) gate.push(complete);
      else Promise.resolve().then(complete);
    }
    terminate() { terminated++; alive--; }
  }
  const {optimizeModel} = new Function('THREE', 'Worker', 'document', optimizerSource + '\nreturn {optimizeModel};')(THREE, Worker, {baseURI: 'https://localhost:8080/'});
  const root = new THREE.Group();
  const texture = new THREE.Texture({width: 8, height: 8});
  const material = new THREE.MeshStandardMaterial({map: texture});
  const mesh = new THREE.Mesh(geometry, material);
  root.add(mesh);
  geometry.addGroup(0, count / 2, 0);
  geometry.addGroup(count / 2, count / 2, 0);
  geometry.setDrawRange(3, count - 6);
  geometry.setAttribute('custom', new THREE.BufferAttribute(new Int16Array(geometry.attributes.position.count * 2), 2, true));
  const interleaved = new THREE.InterleavedBuffer(new Float32Array(geometry.attributes.position.count * 4), 4);
  geometry.setAttribute('interleaved', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
  const attributes = snapshotAttributes(geometry);
  const groups = JSON.stringify(geometry.groups);
  const drawRange = JSON.stringify(geometry.drawRange);
  const attribute = geometry.index;
  const geometryID = geometry.uuid;
  const sourceFile = Buffer.from(original.buffer).toString('hex');
  const stats = await optimizeModel(root);
  assert.equal(stats.optimizedGeometries, 1);
  assert.equal(geometry.uuid, geometryID);
  assert.equal(mesh.geometry, geometry);
  assert.equal(geometry.index, attribute);
  assert.equal(geometry.index.array, indices);
  assert.equal(indices.length, original.length, 'No triangle or vertex may be removed.');
  assert.equal(mesh.material, material);
  assert.equal(material.map, texture);
  assert.equal(mesh.parent, root);
  assert.equal(JSON.stringify(geometry.groups), groups);
  assert.equal(JSON.stringify(geometry.drawRange), drawRange);
  Object.keys(attributes).forEach(key => {
    const before = attributes[key];
    assert.equal(geometry.attributes[key], before.attribute);
    assert.equal(before.array.byteLength > 0, true);
    assert.equal(Buffer.from(before.array.buffer, before.array.byteOffset, before.array.byteLength).toString('hex'), before.bytes);
  });
  assert.equal(Buffer.from(original.buffer).toString('hex'), sourceFile, 'The source bytes remain unchanged.');
  ranges.forEach(range => assert.deepEqual(triangleMultiset(indices, range.start, range.count), triangleMultiset(original, range.start, range.count)));
  assert.equal(terminated, 1);
  await optimizeModel(root);
  assert.equal(posted, 1, 'Each geometry is prepared only once.');

  const skip = async change => {
    const object = new THREE.Mesh(shuffledGeometry(), new THREE.MeshStandardMaterial());
    change(object);
    const before = posted;
    const result = await optimizeModel(object);
    assert.equal(result.optimizedGeometries, 0);
    assert.equal(posted, before);
  };
  await skip(object => { object.material.transparent = true; });
  await skip(object => { object.material.opacity = 0.5; });
  await skip(object => { object.material.flatShading = true; });
  await skip(object => { object.material = new THREE.ShaderMaterial(); });
  await skip(object => { object.material.onBeforeCompile = () => {}; });
  await skip(object => { object.isSkinnedMesh = true; });
  await skip(object => { object.animations = [{}]; });
  await skip(object => { object.geometry.morphAttributes.position = [object.geometry.attributes.position]; });
  await skip(object => { object.geometry.groups = [{start: 0, count: 12, materialIndex: 0}, {start: 3, count: 12, materialIndex: 0}]; });
  await skip(object => { object.geometry = new THREE.BoxBufferGeometry(); });
  const sharedRoot = new THREE.Group();
  const shared = shuffledGeometry();
  sharedRoot.add(new THREE.Mesh(shared, new THREE.MeshStandardMaterial()), new THREE.Mesh(shared, new THREE.MeshBasicMaterial({transparent: true})));
  const beforeShared = posted;
  await optimizeModel(sharedRoot);
  assert.equal(posted, beforeShared, 'A transparent mesh must protect its shared geometry.');

  gate = [];
  const first = new THREE.Mesh(shuffledGeometry(), new THREE.MeshStandardMaterial());
  const second = new THREE.Mesh(shuffledGeometry(), new THREE.MeshStandardMaterial());
  const firstBytes = first.geometry.index.array.slice();
  const pendingFirst = optimizeModel(first);
  const pendingSecond = optimizeModel(second);
  assert.equal(gate.length, 1, 'Heavy models must be optimized sequentially by one worker.');
  first.geometry.index.needsUpdate = true;
  gate.shift()();
  await pendingFirst;
  assert.deepEqual(first.geometry.index.array, firstBytes, 'A model edited during preparation must reject stale worker output.');
  await Promise.resolve();
  assert.equal(gate.length, 1);
  gate.shift()();
  await pendingSecond;
  assert.equal(maxAlive, 1);
  assert.equal(alive, 0);
  gate = null;
  fail = true;
  const failed = new THREE.Mesh(shuffledGeometry(), new THREE.MeshStandardMaterial());
  const failureBytes = failed.geometry.index.array.slice();
  const failedStats = await optimizeModel(failed);
  assert.equal(failedStats.optimizedGeometries, 0);
  assert.deepEqual(failed.geometry.index.array, failureBytes, 'A worker failure must leave the original geometry usable.');
  assert(failed.geometry.index.array.buffer.byteLength > 0);
  assert.equal(alive, 0);
  const unavailableModel = new THREE.Mesh(shuffledGeometry(), new THREE.MeshStandardMaterial());
  const callsAfterFailure = posted;
  await optimizeModel(unavailableModel);
  assert.equal(posted, callsAfterFailure, 'A broken worker endpoint is not repeatedly requested.');
  const noWorkerOptimizer = new Function('THREE', 'Worker', 'document', optimizerSource + '\nreturn optimizeModel;')(THREE, undefined, {baseURI: 'https://localhost:8080/'});
  assert.equal((await noWorkerOptimizer(unavailableModel)).optimizedGeometries, 0);
  console.log('PASS model optimizer: exact triangles/winding, vertex bytes/materials/identity, groups/drawRange, cache reuse, sequential worker, stale/failure fallback.');
  console.log('Scrambled fixture: FIFO32 misses ' + result.beforeMisses + ' -> ' + result.afterMisses + ' (' + (100 * (1 - result.afterMisses / result.beforeMisses)).toFixed(1) + '% fewer).');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
