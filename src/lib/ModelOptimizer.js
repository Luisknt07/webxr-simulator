import * as THREE from 'three';

const MIN_TRIANGLES = 50000;
const optimized = new WeakSet();
const queue = [];
let worker = null;
let active = null;
let nextId = 0;
let unavailable = false;

function closeWorker() {
  if (worker) worker.terminate();
  worker = null;
}

function finish(result) {
  if (!active) return;
  const job = active;
  active = null;
  clearTimeout(job.timeout);
  job.resolve(result);
  if (queue.length) startNext();
  else closeWorker(); // Release the WASM heap when no model needs preparation.
}

function failWorker() {
  unavailable = true;
  closeWorker();
  finish(null);
}

function startNext() {
  if (active || !queue.length) return;
  active = queue.shift();
  if (unavailable || typeof Worker === 'undefined') { finish(null); return; }
  try {
    if (!worker) {
      worker = new Worker(new URL('mesh-optimizer-worker.js', document.baseURI).href);
      worker.onmessage = event => {
        if (!active || !event.data || event.data.id !== active.id) return;
        finish(event.data.error ? null : event.data);
      };
      worker.onerror = failWorker;
      worker.onmessageerror = failWorker;
    }
    const job = active;
    // Transfer a private copy; a failed worker can never detach the live mesh.
    const indices = job.indices.slice();
    job.timeout = setTimeout(failWorker, 60000);
    worker.postMessage({id: job.id, indices, ranges: job.ranges, vertexCount: job.vertexCount}, [indices.buffer]);
  } catch (error) {
    failWorker();
  }
}

function prepareIndices(indices, ranges, vertexCount) {
  return new Promise(resolve => {
    queue.push({id: ++nextId, indices, ranges, vertexCount, resolve});
    startNext();
  });
}

function materialIsSafe(material) {
  return material && !material.transparent && material.opacity === 1 && !material.flatShading &&
    material.depthTest && material.depthWrite && material.colorWrite && !material.stencilWrite &&
    material.blending === THREE.NormalBlending && !material.isShaderMaterial && !material.isRawShaderMaterial &&
    material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile;
}

function meshIsSafe(mesh) {
  const geometry = mesh.geometry;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mesh.isMesh && !mesh.isSkinnedMesh && !mesh.isInstancedMesh && !mesh.morphTargetInfluences &&
    geometry && geometry.isBufferGeometry && !Object.keys(geometry.morphAttributes || {}).length &&
    materials.length > 0 && materials.every(materialIsSafe);
}

function rangesFor(geometry) {
  const count = geometry.index.count;
  const draw = geometry.drawRange;
  const start = draw ? draw.start : 0;
  const end = draw ? Math.min(count, start + draw.count) : count;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start ||
      start % 3 || end % 3 || count % 3) return null;
  const groups = geometry.groups.slice().sort((a, b) => a.start - b.start);
  let previousEnd = 0;
  const boundaries = [start, end];
  for (const group of groups) {
    const groupEnd = Math.min(count, group.start + group.count);
    if (!Number.isSafeInteger(group.start) || !Number.isSafeInteger(groupEnd) || group.start < previousEnd ||
        group.start % 3 || groupEnd % 3 || groupEnd < group.start) return null;
    previousEnd = groupEnd;
    if (group.start > start && group.start < end) boundaries.push(group.start);
    if (groupEnd > start && groupEnd < end) boundaries.push(groupEnd);
  }
  boundaries.sort((a, b) => a - b);
  const result = [];
  for (let i = 1; i < boundaries.length; i++) {
    if (boundaries[i] > boundaries[i - 1]) result.push({start: boundaries[i - 1], count: boundaries[i] - boundaries[i - 1]});
  }
  return result;
}

// This does not reduce model detail or change the saved source file. The model
// can be used unchanged when workers/WASM are unavailable or optimization fails.
export async function optimizeModel(root) {
  const stats = {optimizedGeometries: 0, triangles: 0, beforeMisses: 0, afterMisses: 0};
  const geometries = new Map();
  let animated = false;
  root.traverse(object => {
    if (object.animations && object.animations.length) animated = true;
    if (object.geometry) {
      if (!geometries.has(object.geometry)) geometries.set(object.geometry, []);
      geometries.get(object.geometry).push(object);
    }
  });
  if (animated) return stats;
  for (const [geometry, meshes] of geometries) {
    const index = geometry.index;
    const position = geometry.attributes && geometry.attributes.position;
    if (optimized.has(geometry) || !index || index.isInterleavedBufferAttribute || !position ||
        !(index.array instanceof Uint16Array || index.array instanceof Uint32Array) ||
        index.itemSize !== 1 || index.count < MIN_TRIANGLES * 3 || !meshes.every(meshIsSafe)) continue;
    const ranges = rangesFor(geometry);
    if (!ranges || !ranges.length) continue;
    const array = index.array;
    const version = index.version;
    const positionState = [position, position.array, position.data, position.version,
      position.data && position.data.version, position.count];
    const drawState = JSON.stringify([geometry.drawRange, geometry.groups]);
    const result = await prepareIndices(array, ranges, position.count);
    if (!result || geometry.index !== index || index.array !== array || index.version !== version ||
        geometry.attributes.position !== positionState[0] || position.array !== positionState[1] ||
        position.data !== positionState[2] || position.version !== positionState[3] ||
        (position.data && position.data.version) !== positionState[4] || position.count !== positionState[5] ||
        JSON.stringify([geometry.drawRange, geometry.groups]) !== drawState ||
        !meshes.every(meshIsSafe) || !result.indices || result.indices.constructor !== array.constructor ||
        result.indices.length !== array.length) continue;
    if (result.changed) {
      // Keep the BufferAttribute, UUID, geometry and all vertex streams intact.
      array.set(result.indices);
      index.needsUpdate = true;
      stats.optimizedGeometries++;
      stats.triangles += index.count / 3;
    }
    optimized.add(geometry);
    stats.beforeMisses += result.beforeMisses;
    stats.afterMisses += result.afterMisses;
  }
  return stats;
}
