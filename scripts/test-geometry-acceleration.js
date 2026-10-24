const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Worker: NodeWorker} = require('node:worker_threads');
const THREE = require('three');
const loadGeometryAcceleration = require('./load-geometry-acceleration.js');

const sourceRoot = path.join(__dirname, '..');
const vector = (x, y, z) => new THREE.Vector3(x, y, z);
const strip = source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export default /gm, '').replace(/^export /gm, '');
const compactSource = strip(fs.readFileSync(path.join(sourceRoot, 'src/lib/CompactTriangleTree.js'), 'utf8'));
const collisionSource = strip(fs.readFileSync(path.join(sourceRoot, 'src/workers/CollisionWorker.js'), 'utf8'));
const threadedSource = 'const {parentPort} = require("node:worker_threads"); const THREE = require(' +
  JSON.stringify(require.resolve('three')) + '); const self = {postMessage: (data, transfers) => parentPort.postMessage(data, transfers)};' +
  compactSource + '\n' + collisionSource + '\nparentPort.on("message", data => self.onmessage({data}));';

function heavyMesh() {
  return new THREE.Mesh(new THREE.BoxBufferGeometry(2, 2, 2, 70, 70, 70), new THREE.MeshBasicMaterial());
}

function bufferBytes(attribute) {
  const data = attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('hex');
}

async function run() {
  const synchronous = loadGeometryAcceleration(THREE);
  const geometry = new THREE.BoxBufferGeometry(2, 2, 2);
  let previous = synchronous.getGeometryTree(geometry);
  assert.equal(previous, synchronous.getGeometryTree(geometry), 'Repeated picking/collision queries share one cached hierarchy.');
  assert.equal(previous.closedSurface(), true);
  const invalidate = mutation => {
    mutation();
    const next = synchronous.getGeometryTree(geometry);
    assert.notEqual(previous, next, 'Changed geometry must not reuse a stale hierarchy.');
    assert.equal(next, synchronous.getGeometryTree(geometry));
    previous = next;
  };
  invalidate(() => { geometry.attributes.position.needsUpdate = true; });
  invalidate(() => { geometry.index.needsUpdate = true; });
  invalidate(() => { geometry.setAttribute('position', geometry.attributes.position.clone()); });
  invalidate(() => { geometry.attributes.position.array = geometry.attributes.position.array.slice(); });
  invalidate(() => { geometry.setIndex(geometry.index.clone()); });
  invalidate(() => { geometry.index.array = geometry.index.array.slice(); });
  invalidate(() => { geometry.setDrawRange(3, geometry.index.count - 6); });
  assert.equal(previous.triangleCount, geometry.index.count / 3 - 2);
  assert.equal(previous.closedSurface(), false, 'A partial draw range must not reuse closed occupancy from the full mesh.');
  const interleaved = new THREE.BufferGeometry();
  const data = new THREE.InterleavedBuffer(new Float32Array([0, 0, 0, 9, 1, 0, 0, 9, 0, 1, 0, 9]), 4);
  interleaved.setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 0));
  const interleavedTree = synchronous.getGeometryTree(interleaved);
  data.needsUpdate = true;
  assert.notEqual(synchronous.getGeometryTree(interleaved), interleavedTree, 'Interleaved data versions participate in invalidation.');
  const countGeometry = new THREE.BufferGeometry();
  const countPosition = new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], 3);
  countGeometry.setAttribute('position', countPosition);
  const countTree = synchronous.getGeometryTree(countGeometry);
  countPosition.count = 3;
  assert.notEqual(synchronous.getGeometryTree(countGeometry), countTree, 'A changed attribute count invalidates the cache.');

  let active = 0;
  let created = 0;
  let terminated = 0;
  let maximumActive = 0;
  let failNext = false;
  let hold = false;
  const deliveries = [];
  const posted = [];
  const warnings = [];
  class Worker {
    constructor(url) {
      assert.equal(url, 'https://localhost:8080/collision-worker.js');
      created++; active++; maximumActive = Math.max(maximumActive, active);
      this.thread = new NodeWorker(threadedSource, {eval: true});
      this.thread.on('message', message => {
        const deliver = () => {
          if (failNext) { failNext = false; this.onerror(new Error('Test worker failure.')); }
          else this.onmessage({data: message});
        };
        if (hold) deliveries.push(deliver); else deliver();
      });
      this.thread.on('error', error => { if (this.onerror) this.onerror(error); });
    }
    postMessage(message, transfer) {
      posted.push({positions: message.positions, indices: message.indices});
      this.thread.postMessage(message, transfer);
      assert.equal(message.positions.buffer.byteLength, 0, 'Only a copied transferable buffer goes to the worker.');
      if (message.indices) assert.equal(message.indices.buffer.byteLength, 0);
    }
    terminate() {
      active--; terminated++;
      this.thread.terminate();
    }
  }
  const manager = loadGeometryAcceleration(THREE, {Worker, document: {baseURI: 'https://localhost:8080/'}, console: {warn: (...args) => warnings.push(args)}});
  const mesh = heavyMesh();
  const position = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;
  const positionBefore = bufferBytes(position);
  const indexBefore = bufferBytes(index);
  let ticks = 0;
  const ticker = setInterval(() => ticks++, 1);
  try {
    await Promise.all([manager.prepareModelAcceleration(mesh), manager.prepareModelAcceleration(mesh)]);
  } finally { clearInterval(ticker); }
  assert(ticks > 0, 'Building the tree and closure in a worker must keep the main event loop responsive.');
  assert.equal(created, 1, 'Concurrent requests for a shared geometry reuse one worker preparation.');
  assert.equal(terminated, 1);
  assert.equal(active, 0);
  const prepared = manager.getGeometryTree(mesh.geometry);
  assert.equal(prepared.closed, true, 'Worker serialization hands off the computed closure without recalculating it on the main thread.');
  assert.equal(prepared.closedSurface(), true);
  assert.equal(prepared.position, position);
  assert.equal(prepared.index, index);
  assert.equal(bufferBytes(position), positionBefore);
  assert.equal(bufferBytes(index), indexBefore);
  assert.equal(position.array.buffer.byteLength > 0, true);
  assert.equal(index.array.buffer.byteLength > 0, true);
  assert.equal(prepared.triangleCount, index.count / 3);
  assert.equal(prepared, manager.getGeometryTree(mesh.geometry));
  await manager.prepareModelAcceleration(mesh);
  assert.equal(created, 1, 'A finalized hierarchy must not be rebuilt for repeated preparations.');
  const point = prepared.closestPoint(vector(0, 0, 3));
  assert(point && point.distanceTo(vector(0, 0, 1)) < 1e-10);
  const hits = prepared.rayIntersections(new THREE.Ray(vector(0.023, 0.041, 3), vector(0, 0, -1)));
  assert.equal(hits.length, 2);

  // Separate heavy geometries are queued, so peak construction memory is
  // bounded by one worker rather than all imported models at once.
  const first = heavyMesh();
  const second = heavyMesh();
  await Promise.all([manager.prepareModelAcceleration(first), manager.prepareModelAcceleration(second)]);
  assert.equal(maximumActive, 1);
  assert.equal(active, 0);

  hold = true;
  const stale = heavyMesh();
  const pending = manager.prepareModelAcceleration(stale);
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const poll = () => {
      if (deliveries.length) return resolve();
      if (Date.now() > deadline) return reject(new Error('Worker delivery timed out.'));
      setTimeout(poll, 5);
    };
    poll();
  });
  stale.geometry.attributes.position.setX(0, 7);
  stale.geometry.attributes.position.needsUpdate = true;
  hold = false;
  deliveries.shift()();
  await pending;
  const fresh = manager.getGeometryTree(stale.geometry);
  assert.equal(fresh.box.max.x, 7, 'A stale worker response must be discarded after an attribute edit.');
  assert.equal(fresh.position, stale.geometry.attributes.position);

  failNext = true;
  const retry = heavyMesh();
  const beforeFailure = bufferBytes(retry.geometry.attributes.position);
  await manager.prepareModelAcceleration(retry);
  assert.equal(warnings.length, 1);
  assert.equal(bufferBytes(retry.geometry.attributes.position), beforeFailure, 'A failed worker keeps the source model usable.');
  const afterFailure = created;
  await manager.prepareModelAcceleration(retry);
  assert.equal(created, afterFailure + 1, 'Worker failure does not poison future preparation attempts.');
  assert.equal(manager.getGeometryTree(retry.geometry).closed, true);
  assert.equal(active, 0);
  assert.equal(terminated, created);

  const fallback = loadGeometryAcceleration(THREE, {Worker: undefined, document: undefined});
  const noWorker = heavyMesh();
  await fallback.prepareModelAcceleration(noWorker);
  assert.equal(fallback.getGeometryTree(noWorker.geometry).closedSurface(), true);
  console.log('PASS geometry acceleration: cache invalidation, real worker transfer/closure handoff, responsive main thread, sequential preparation, stale response and failure retry.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
