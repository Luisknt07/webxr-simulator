import * as THREE from 'three';
import CompactTriangleTree from '../src/CompactTriangleTree.js';

self.onmessage = event => {
  try {
    const {positions, indices, drawRange} = event.data;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (indices) geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setDrawRange(drawRange.start, drawRange.count);
    const tree = new CompactTriangleTree(geometry);
    tree.closedSurface();
    const serialized = tree.serialize();
    const buffers = new Set();
    const scan = value => {
      if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
      else if (value instanceof ArrayBuffer) buffers.add(value);
      else if (value && typeof value === 'object') Object.keys(value).forEach(key => scan(value[key]));
    };
    scan(serialized);
    self.postMessage({tree: serialized}, Array.from(buffers));
  } catch (error) { self.postMessage({error: error.message || String(error)}); }
};
