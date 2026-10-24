// Runs in a worker. Vertex attributes are deliberately never reordered,
// quantized or simplified: only complete, oriented triangles change order.
export function cacheMisses(indices, vertexCount, cacheSize = 32) {
  const stamps = new Int32Array(vertexCount);
  let clock = cacheSize;
  let misses = 0;
  for (let i = 0; i < indices.length; i++) {
    const vertex = indices[i];
    if (stamps[vertex] <= clock - cacheSize) {
      stamps[vertex] = ++clock;
      misses++;
    }
  }
  return misses;
}

export function optimizeIndexRanges(encoder, indices, ranges, vertexCount) {
  if (!(indices instanceof Uint16Array || indices instanceof Uint32Array) ||
      !Number.isSafeInteger(vertexCount) || vertexCount < 1) throw new Error('Invalid mesh indices.');
  const output = indices.slice();
  let beforeMisses = 0;
  let afterMisses = 0;
  let changed = false;
  let lastEnd = 0;
  for (const range of ranges) {
    const start = range.start;
    const count = range.count;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < lastEnd ||
        start % 3 || count % 3 || count < 3 || start + count > indices.length) throw new Error('Invalid mesh range.');
    lastEnd = start + count;
    const original = indices.subarray(start, lastEnd);
    for (let i = 0; i < original.length; i++) {
      if (original[i] >= vertexCount) throw new Error('Invalid mesh vertex.');
    }
    const ordered = new Uint32Array(original);
    const before = cacheMisses(original, vertexCount);
    // The public JS API also remaps vertex IDs. Undo that remapping so every
    // original attribute, including custom/interleaved attributes, stays exact.
    const [remap, unique] = encoder.reorderMesh(ordered, true, false);
    const inverse = new Uint32Array(unique);
    for (let old = 0; old < remap.length; old++) {
      if (remap[old] !== 0xffffffff) inverse[remap[old]] = old;
    }
    for (let i = 0; i < ordered.length; i++) ordered[i] = inverse[ordered[i]];
    const after = cacheMisses(ordered, vertexCount);
    beforeMisses += before;
    // Already cache-friendly assets must not receive a worse ordering.
    if (after < before) {
      output.set(ordered, start);
      afterMisses += after;
      changed = true;
    } else {
      afterMisses += before;
    }
  }
  return {indices: output, changed, beforeMisses, afterMisses};
}
