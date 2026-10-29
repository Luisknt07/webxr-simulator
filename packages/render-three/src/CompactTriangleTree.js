import * as THREE from 'three';

const LEAF_SIZE = 16;
const EMPTY_VERTEX = 0xffffffff;

function source(value, index, drawRange) {
  const geometry = value && value.isBufferGeometry ? value : null;
  const position = geometry ? geometry.attributes.position : value;
  const indices = geometry ? geometry.index : index;
  if (!position || !Number.isInteger(position.count) || position.itemSize < 3) {
    throw new Error('A triangle tree requires a position BufferAttribute.');
  }
  const range = (geometry ? geometry.drawRange : drawRange) || {};
  const available = indices ? indices.count : position.count;
  const start = Math.min(available, Math.max(0, Math.floor(range.start || 0)));
  const count = range.count === undefined ? Infinity : Math.max(0, range.count);
  return {position, index: indices || null, start, end: Math.min(available, start + count)};
}

function readTriangle(position, index, offset, triangle) {
  triangle.a.fromBufferAttribute(position, index ? index.getX(offset) : offset);
  triangle.b.fromBufferAttribute(position, index ? index.getX(offset + 1) : offset + 1);
  triangle.c.fromBufferAttribute(position, index ? index.getX(offset + 2) : offset + 2);
  return triangle;
}

function intersects(bounds, node, box) {
  const p = node * 6;
  return bounds[p + 3] >= box.min.x && bounds[p] <= box.max.x &&
    bounds[p + 4] >= box.min.y && bounds[p + 1] <= box.max.y &&
    bounds[p + 5] >= box.min.z && bounds[p + 2] <= box.max.z;
}

function triangleIntersectsBox(triangle, box) {
  const {a, b, c} = triangle;
  return Math.max(a.x, b.x, c.x) >= box.min.x && Math.min(a.x, b.x, c.x) <= box.max.x &&
    Math.max(a.y, b.y, c.y) >= box.min.y && Math.min(a.y, b.y, c.y) <= box.max.y &&
    Math.max(a.z, b.z, c.z) >= box.min.z && Math.min(a.z, b.z, c.z) <= box.max.z;
}

function rayIntersects(bounds, node, ray) {
  const p = node * 6;
  let near = 0, far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const key = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
    const origin = ray.origin[key], direction = ray.direction[key];
    if (direction === 0) {
      if (origin < bounds[p + axis] || origin > bounds[p + axis + 3]) return false;
    } else {
      const first = (bounds[p + axis] - origin) / direction;
      const last = (bounds[p + axis + 3] - origin) / direction;
      near = Math.max(near, Math.min(first, last));
      far = Math.min(far, Math.max(first, last));
      if (near > far) return false;
    }
  }
  return true;
}

// Transform a node's bounds to a conservative world AABB. Its distance is a
// lower bound even under nonuniform scale, reflection and shear. Comparing
// distances in local coordinates would choose the wrong nearest triangle.
function worldBoundsDistance(bounds, node, point, matrix) {
  const p = node * 6, m = matrix.elements;
  const cx = (bounds[p] + bounds[p + 3]) * 0.5;
  const cy = (bounds[p + 1] + bounds[p + 4]) * 0.5;
  const cz = (bounds[p + 2] + bounds[p + 5]) * 0.5;
  const hx = (bounds[p + 3] - bounds[p]) * 0.5;
  const hy = (bounds[p + 4] - bounds[p + 1]) * 0.5;
  const hz = (bounds[p + 5] - bounds[p + 2]) * 0.5;
  const x = m[0] * cx + m[4] * cy + m[8] * cz + m[12];
  const y = m[1] * cx + m[5] * cy + m[9] * cz + m[13];
  const z = m[2] * cx + m[6] * cy + m[10] * cz + m[14];
  const ex = Math.abs(m[0]) * hx + Math.abs(m[4]) * hy + Math.abs(m[8]) * hz;
  const ey = Math.abs(m[1]) * hx + Math.abs(m[5]) * hy + Math.abs(m[9]) * hz;
  const ez = Math.abs(m[2]) * hx + Math.abs(m[6]) * hy + Math.abs(m[10]) * hz;
  const margin = 1e-12 * Math.max(1, Math.abs(x), Math.abs(y), Math.abs(z), ex, ey, ez);
  const dx = Math.max(0, Math.abs(point.x - x) - ex - margin);
  const dy = Math.max(0, Math.abs(point.y - y) - ey - margin);
  const dz = Math.max(0, Math.abs(point.z - z) - ez - margin);
  return dx * dx + dy * dy + dz * dz;
}

/** Exact triangle BVH with packed nodes and no retained per-triangle objects.
 * Callbacks receive a reused local-space Triangle and the original first
 * corner's offset in the index/position attribute. Clone it to retain it.
 */
export default class CompactTriangleTree {
  constructor(geometryOrPosition, index, drawRange) {
    const input = source(geometryOrPosition, index, drawRange);
    this.position = input.position;
    this.index = input.index;
    this.drawStart = input.start;
    this.drawEnd = input.end;
    this.closed = undefined;
    const possible = Math.floor((input.end - input.start) / 3);
    let offsets = new Uint32Array(possible);
    // Construction scratch is released before returning. Float64 bounds avoid
    // shrinking triangles when callers supply Float64 or interleaved data.
    const triangleBounds = new Float64Array(possible * 6);
    const triangle = new THREE.Triangle();
    let triangleCount = 0;
    for (let ordinal = 0; ordinal < possible; ordinal++) {
      const offset = input.start + ordinal * 3;
      readTriangle(this.position, this.index, offset, triangle);
      const {a, b, c} = triangle;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z) ||
        !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z) ||
        !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) continue;
      offsets[triangleCount++] = offset;
      const p = ordinal * 6;
      triangleBounds[p] = Math.min(a.x, b.x, c.x);
      triangleBounds[p + 1] = Math.min(a.y, b.y, c.y);
      triangleBounds[p + 2] = Math.min(a.z, b.z, c.z);
      triangleBounds[p + 3] = Math.max(a.x, b.x, c.x);
      triangleBounds[p + 4] = Math.max(a.y, b.y, c.y);
      triangleBounds[p + 5] = Math.max(a.z, b.z, c.z);
    }
    if (triangleCount !== possible) offsets = offsets.slice(0, triangleCount);
    this.triangleOffsets = offsets;
    this.triangleCount = triangleCount;
    const leaves = triangleCount ? Math.pow(2, Math.max(0, Math.ceil(Math.log2(triangleCount / LEAF_SIZE)))) : 0;
    const capacity = leaves ? leaves * 2 - 1 : 0;
    const bounds = new Float64Array(capacity * 6);
    // Leaves: [first triangle, triangle count]. Branches: [right child, 0].
    // Depth-first layout makes a branch's left child its next node.
    const ranges = new Uint32Array(capacity * 2);
    let nodeCount = 0;
    const boundOffset = offset => ((offset - input.start) / 3) * 6;
    const centroid = (offset, axis) => {
      const p = boundOffset(offset) + axis;
      return (triangleBounds[p] + triangleBounds[p + 3]) * 0.5;
    };
    const swap = (a, b) => { const value = offsets[a]; offsets[a] = offsets[b]; offsets[b] = value; };
    const select = (start, end, middle, axis) => {
      let left = start, right = end - 1;
      while (left < right) {
        const pivot = offsets[(left + right) >>> 1], center = centroid(pivot, axis);
        let low = left, high = right;
        while (low <= high) {
          while (centroid(offsets[low], axis) < center ||
            (centroid(offsets[low], axis) === center && offsets[low] < pivot)) low++;
          while (centroid(offsets[high], axis) > center ||
            (centroid(offsets[high], axis) === center && offsets[high] > pivot)) high--;
          if (low <= high) { swap(low++, high--); }
        }
        if (middle <= high) right = high;
        else if (middle >= low) left = low;
        else return;
      }
    };
    const build = (start, count) => {
      const node = nodeCount++, p = node * 6;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let centerMinX = Infinity, centerMinY = Infinity, centerMinZ = Infinity;
      let centerMaxX = -Infinity, centerMaxY = -Infinity, centerMaxZ = -Infinity;
      for (let i = start, end = start + count; i < end; i++) {
        const t = boundOffset(offsets[i]);
        const x = triangleBounds[t], y = triangleBounds[t + 1], z = triangleBounds[t + 2];
        const xx = triangleBounds[t + 3], yy = triangleBounds[t + 4], zz = triangleBounds[t + 5];
        minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, xx); maxY = Math.max(maxY, yy); maxZ = Math.max(maxZ, zz);
        const cx = (x + xx) * 0.5, cy = (y + yy) * 0.5, cz = (z + zz) * 0.5;
        centerMinX = Math.min(centerMinX, cx); centerMinY = Math.min(centerMinY, cy); centerMinZ = Math.min(centerMinZ, cz);
        centerMaxX = Math.max(centerMaxX, cx); centerMaxY = Math.max(centerMaxY, cy); centerMaxZ = Math.max(centerMaxZ, cz);
      }
      bounds[p] = minX; bounds[p + 1] = minY; bounds[p + 2] = minZ;
      bounds[p + 3] = maxX; bounds[p + 4] = maxY; bounds[p + 5] = maxZ;
      if (count <= LEAF_SIZE) {
        ranges[node * 2] = start;
        ranges[node * 2 + 1] = count;
      } else {
        const sizes = [centerMaxX - centerMinX, centerMaxY - centerMinY, centerMaxZ - centerMinZ];
        const axis = sizes[0] >= sizes[1] && sizes[0] >= sizes[2] ? 0 : sizes[1] >= sizes[2] ? 1 : 2;
        const firstCount = Math.floor(count / 2);
        if (sizes[axis] > 0) select(start, start + count, start + firstCount, axis);
        build(start, firstCount);
        ranges[node * 2] = build(start + firstCount, count - firstCount);
      }
      return node;
    };
    if (triangleCount) build(0, triangleCount);
    this.nodeCount = nodeCount;
    this.bounds = nodeCount === capacity ? bounds : bounds.slice(0, nodeCount * 6);
    this.ranges = nodeCount === capacity ? ranges : ranges.slice(0, nodeCount * 2);
    this._setBox();
  }

  _setBox() {
    this.box = new THREE.Box3();
    if (this.nodeCount) {
      this.box.min.fromArray(this.bounds, 0);
      this.box.max.fromArray(this.bounds, 3);
    }
  }

  get byteLength() { return this.bounds.byteLength + this.ranges.byteLength + this.triangleOffsets.byteLength; }

  query(box, callback) {
    if (!this.nodeCount) return false;
    const stack = [0], triangle = new THREE.Triangle();
    while (stack.length) {
      const node = stack.pop();
      if (!intersects(this.bounds, node, box)) continue;
      const start = this.ranges[node * 2], count = this.ranges[node * 2 + 1];
      if (!count) { stack.push(start, node + 1); continue; }
      for (let i = start, end = start + count; i < end; i++) {
        const offset = this.triangleOffsets[i];
        readTriangle(this.position, this.index, offset, triangle);
        if (triangleIntersectsBox(triangle, box) && callback(triangle, offset)) return true;
      }
    }
    return false;
  }

  forEachTriangle(callback) {
    const triangle = new THREE.Triangle();
    for (let i = 0; i < this.triangleOffsets.length; i++) {
      const offset = this.triangleOffsets[i];
      callback(readTriangle(this.position, this.index, offset, triangle), offset);
    }
  }

  queryRay(ray, callback) {
    if (!this.nodeCount) return false;
    const stack = [0], triangle = new THREE.Triangle(), bounds = new Float64Array(6);
    while (stack.length) {
      const node = stack.pop();
      if (!rayIntersects(this.bounds, node, ray)) continue;
      const start = this.ranges[node * 2], count = this.ranges[node * 2 + 1];
      if (!count) { stack.push(start, node + 1); continue; }
      for (let i = start, end = start + count; i < end; i++) {
        const offset = this.triangleOffsets[i];
        readTriangle(this.position, this.index, offset, triangle);
        const {a, b, c} = triangle;
        bounds[0] = Math.min(a.x, b.x, c.x); bounds[1] = Math.min(a.y, b.y, c.y); bounds[2] = Math.min(a.z, b.z, c.z);
        bounds[3] = Math.max(a.x, b.x, c.x); bounds[4] = Math.max(a.y, b.y, c.y); bounds[5] = Math.max(a.z, b.z, c.z);
        if (rayIntersects(bounds, 0, ray) && callback(triangle, offset)) return true;
      }
    }
    return false;
  }

  rayIntersections(ray) {
    const point = new THREE.Vector3(), result = [];
    this.queryRay(ray, triangle => {
      if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, point)) result.push(point.clone());
      return false;
    });
    return result;
  }

  closestPoint(point, matrix = new THREE.Matrix4(), minArea = 0) {
    if (!this.nodeCount) return null;
    const stack = [0], triangle = new THREE.Triangle(), candidate = new THREE.Vector3();
    const result = new THREE.Vector3();
    let best = Infinity;
    while (stack.length) {
      const node = stack.pop();
      if (worldBoundsDistance(this.bounds, node, point, matrix) > best) continue;
      const start = this.ranges[node * 2], count = this.ranges[node * 2 + 1];
      if (!count) {
        const left = node + 1, right = start;
        const a = worldBoundsDistance(this.bounds, left, point, matrix);
        const b = worldBoundsDistance(this.bounds, right, point, matrix);
        if (a < b) { if (b <= best) stack.push(right); if (a <= best) stack.push(left); }
        else { if (a <= best) stack.push(left); if (b <= best) stack.push(right); }
        continue;
      }
      for (let i = start, end = start + count; i < end; i++) {
        readTriangle(this.position, this.index, this.triangleOffsets[i], triangle);
        if (minArea > 0 && triangle.getArea() < minArea) continue;
        triangle.a.applyMatrix4(matrix); triangle.b.applyMatrix4(matrix); triangle.c.applyMatrix4(matrix);
        triangle.closestPointToPoint(point, candidate);
        const distance = point.distanceToSquared(candidate);
        if (distance < best) { best = distance; result.copy(candidate); }
      }
    }
    return Number.isFinite(best) ? result : null;
  }

  closedSurface() {
    if (this.closed !== undefined) return this.closed;
    if (!this.triangleCount) return (this.closed = true);
    const canonical = new Uint32Array(this.position.count).fill(EMPTY_VERTEX);
    const included = new Uint8Array(this.triangleCount), triangle = new THREE.Triangle();
    let includedCount = 0;
    let points = new Map(), pointCount = 0;
    const identify = vertex => {
      if (canonical[vertex] !== EMPTY_VERTEX) return;
      const key = Math.round(this.position.getX(vertex) * 100000) + ',' +
        Math.round(this.position.getY(vertex) * 100000) + ',' + Math.round(this.position.getZ(vertex) * 100000);
      let id = points.get(key);
      if (id === undefined) { id = pointCount++; points.set(key, id); }
      canonical[vertex] = id;
    };
    for (let i = 0; i < this.triangleOffsets.length; i++) {
      const offset = this.triangleOffsets[i];
      readTriangle(this.position, this.index, offset, triangle);
      // Closure is used by collision occupancy and retains its previous area
      // tolerance. Picking and ordinary tree queries still include tiny faces.
      if (triangle.getArea() < 1e-12) continue;
      included[i] = 1; includedCount++;
      for (let corner = 0; corner < 3; corner++) identify(this.index ? this.index.getX(offset + corner) : offset + corner);
    }
    // Drop the large string map before allocating sortable packed edge keys.
    points.clear(); points = null;
    const wide = pointCount * pointCount > Number.MAX_SAFE_INTEGER;
    const edges = wide ? new BigUint64Array(includedCount * 3) : new Float64Array(includedCount * 3);
    const base = wide ? BigInt(pointCount) : pointCount;
    const vertices = new Uint32Array(3);
    let edge = 0;
    for (let i = 0; i < this.triangleOffsets.length; i++) {
      if (!included[i]) continue;
      const offset = this.triangleOffsets[i];
      for (let corner = 0; corner < 3; corner++) {
        vertices[corner] = canonical[this.index ? this.index.getX(offset + corner) : offset + corner];
      }
      for (let corner = 0; corner < 3; corner++) {
        const a = vertices[corner], b = vertices[(corner + 1) % 3];
        const low = Math.min(a, b), high = Math.max(a, b);
        edges[edge++] = wide ? BigInt(low) * base + BigInt(high) : low * base + high;
      }
    }
    edges.sort();
    for (let i = 0; i < edges.length;) {
      const first = i, key = edges[i++];
      while (i < edges.length && edges[i] === key) i++;
      if ((i - first) % 2) return (this.closed = false);
    }
    return (this.closed = true);
  }

  serialize() {
    return {version: 1, bounds: this.bounds, ranges: this.ranges, triangleOffsets: this.triangleOffsets,
      positionCount: this.position.count, indexCount: this.index ? this.index.count : null,
      drawStart: this.drawStart, drawEnd: this.drawEnd, closed: this.closed};
  }

  static fromSerialized(data, geometry) {
    const input = source(geometry);
    if (!data || data.version !== 1 || !(data.bounds instanceof Float64Array) ||
      !(data.ranges instanceof Uint32Array) || !(data.triangleOffsets instanceof Uint32Array) ||
      data.bounds.length % 6 || data.ranges.length !== data.bounds.length / 3 ||
      data.positionCount !== input.position.count || data.indexCount !== (input.index ? input.index.count : null) ||
      data.drawStart !== input.start || data.drawEnd !== input.end) {
      throw new Error('The serialized triangle tree does not match its geometry.');
    }
    const tree = Object.create(CompactTriangleTree.prototype);
    tree.position = input.position; tree.index = input.index;
    tree.drawStart = input.start; tree.drawEnd = input.end;
    tree.bounds = data.bounds; tree.ranges = data.ranges; tree.triangleOffsets = data.triangleOffsets;
    tree.triangleCount = data.triangleOffsets.length; tree.nodeCount = data.bounds.length / 6;
    tree.closed = typeof data.closed === 'boolean' ? data.closed : undefined;
    tree._setBox();
    return tree;
  }
}
