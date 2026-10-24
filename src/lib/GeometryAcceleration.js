import CompactTriangleTree from './CompactTriangleTree.js';
import {installMeshRaycast} from './AcceleratedMeshRaycast.js';

const trees = new WeakMap();
const pending = new WeakMap();
let queue = Promise.resolve();

function signature(geometry) {
  const position = geometry.attributes && geometry.attributes.position;
  const index = geometry.index;
  return {position, index, positionArray: position && (position.array || position.data && position.data.array),
    indexArray: index && (index.array || index.data && index.data.array),
    version: [position && position.version, position && position.count, position && position.data && position.data.version,
      position && position.itemSize, position && position.normalized, position && position.offset,
      position && position.data && position.data.stride,
      index && index.version, index && index.count, index && index.data && index.data.version,
      geometry.drawRange.start, geometry.drawRange.count].join(':')};
}

function matches(a, b) {
  return a && a.position === b.position && a.index === b.index && a.positionArray === b.positionArray &&
    a.indexArray === b.indexArray && a.version === b.version;
}

// The render geometry and its attribute arrays remain owned by the model.
// Both collision queries and picking can share this exact, compact hierarchy.
export function getGeometryTree(geometry) {
  if (!geometry.attributes || !geometry.attributes.position) return null;
  const key = signature(geometry);
  const cached = trees.get(geometry);
  if (cached && matches(cached.key, key)) return cached.tree;
  const tree = new CompactTriangleTree(geometry);
  trees.set(geometry, {key, tree});
  return tree;
}

function buildInWorker(geometry) {
  return new Promise((resolve, reject) => {
    let worker, timer;
    const finish = (error, result) => {
      clearTimeout(timer);
      if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
      if (error) reject(error); else resolve(result);
    };
    try {
      const position = geometry.attributes.position;
      // Clone transferable data. Never detach the model's rendering buffers.
      const PositionArray = position.array instanceof Float32Array ? Float32Array : Float64Array;
      const packed = !position.isInterleavedBufferAttribute && position.itemSize === 3 && position.array instanceof Float32Array;
      const positions = packed ? position.array.slice(0, position.count * 3) : new PositionArray(position.count * 3);
      if (!packed) for (let i = 0; i < position.count; i++) {
        positions[i * 3] = position.getX(i); positions[i * 3 + 1] = position.getY(i); positions[i * 3 + 2] = position.getZ(i);
      }
      const index = geometry.index;
      const packedIndex = index && !index.isInterleavedBufferAttribute && index.itemSize === 1 &&
        (index.array instanceof Uint16Array || index.array instanceof Uint32Array);
      const indices = index ? packedIndex ? new Uint32Array(index.array.subarray(0, index.count)) : new Uint32Array(index.count) : null;
      if (indices && !packedIndex) for (let i = 0; i < indices.length; i++) indices[i] = index.getX(i);
      worker = new Worker(new URL('collision-worker.js', document.baseURI).href);
      worker.onmessage = event => {
        if (!event.data || event.data.error) finish(new Error(event.data && event.data.error || 'Respuesta de colisiones inválida.'));
        else finish(null, event.data.tree);
      };
      worker.onerror = () => finish(new Error('No se pudo preparar la aceleración de colisiones.'));
      worker.onmessageerror = () => finish(new Error('No se pudo recibir la aceleración de colisiones.'));
      timer = setTimeout(() => finish(new Error('Tiempo de preparación de colisiones agotado.')), 120000);
      worker.postMessage({positions, indices, drawRange: geometry.drawRange},
        indices ? [positions.buffer, indices.buffer] : [positions.buffer]);
    } catch (error) { finish(error); }
  });
}

async function prepareGeometry(geometry) {
  const key = signature(geometry);
  if (matches(trees.get(geometry) && trees.get(geometry).key, key)) return;
  if (pending.has(geometry)) return pending.get(geometry);
  const task = queue.catch(() => {}).then(async () => {
    if (typeof Worker === 'undefined' || typeof document === 'undefined') return;
    const serialized = await buildInWorker(geometry);
    if (matches(key, signature(geometry))) trees.set(geometry, {key, tree: CompactTriangleTree.fromSerialized(serialized, geometry)});
  }).catch(error => {
    // Preserve a usable original model if worker support is unavailable. The
    // same exact hierarchy can still be built on demand by collision queries.
    console.warn('Preparación de colisiones diferida:', error.message);
  }).finally(() => pending.delete(geometry));
  pending.set(geometry, task);
  queue = task;
  return task;
}

export async function prepareModelAcceleration(root) {
  const geometries = new Set();
  const meshes = [];
  root.traverse(object => {
    if (!object.isMesh || object.isSkinnedMesh || !object.geometry || !object.geometry.isBufferGeometry) return;
    const geometry = object.geometry, position = geometry.attributes.position;
    if (position && (geometry.index ? geometry.index.count : position.count) >= 150000) {
      geometries.add(geometry);
      meshes.push(object);
    }
  });
  for (const geometry of geometries) await prepareGeometry(geometry);
  meshes.forEach(mesh => {
    const cached = trees.get(mesh.geometry);
    if (cached && matches(cached.key, signature(mesh.geometry))) installMeshRaycast(mesh, getGeometryTree);
  });
}
