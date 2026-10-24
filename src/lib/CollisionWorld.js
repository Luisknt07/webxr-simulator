import * as THREE from 'three';
import {getGeometryTree} from './GeometryAcceleration.js';

const SKIN = 0.002;
const EPSILON = 1e-9;
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const geometryTrees = new WeakMap();
const geometryBounds = new WeakMap();

function geometryState(geometry) {
  const position = geometry.attributes && geometry.attributes.position, index = geometry.index;
  return {geometry, position, index, positionArray: position && position.array, indexArray: index && index.array,
    positionVersion: position && position.version, indexVersion: index && index.version,
    positionData: position && position.data, indexData: index && index.data,
    positionDataArray: position && position.data && position.data.array, indexDataArray: index && index.data && index.data.array,
    positionDataVersion: position && position.data && position.data.version, indexDataVersion: index && index.data && index.data.version,
    positionCount: position && position.count, indexCount: index && index.count,
    drawStart: geometry.drawRange && geometry.drawRange.start, drawCount: geometry.drawRange && geometry.drawRange.count,
    vertices: geometry.vertices, faces: geometry.faces, verticesCount: geometry.vertices && geometry.vertices.length,
    facesCount: geometry.faces && geometry.faces.length, dynamic: Boolean(geometry.verticesNeedUpdate || geometry.elementsNeedUpdate)};
}

function sameGeometry(a, b) {
  return Boolean(a && b && !a.dynamic && !b.dynamic && Object.keys(a).every(key => a[key] === b[key]));
}

function sameValues(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }

function ancestry(object) {
  const parents = [];
  for (let parent = object.parent; parent; parent = parent.parent) parents.push(parent);
  return parents;
}

function queryOptions(options) {
  return {radius: options.radius, height: options.height, eyeHeight: options.eyeHeight,
    ignore: (options.ignore || []).slice(), hasExtraBoxes: Boolean(options.extraBoxes),
    extraBoxes: (options.extraBoxes || []).reduce((values, box) => values.concat(box.min.toArray(), box.max.toArray()), [])};
}

function sameOptions(a, b) {
  return a.radius === b.radius && a.height === b.height && a.eyeHeight === b.eyeHeight &&
    a.hasExtraBoxes === b.hasExtraBoxes && sameValues(a.ignore, b.ignore) && sameValues(a.extraBoxes, b.extraBoxes);
}

function within(object, ancestor) {
  for (let node = object; node; node = node.parent) if (node === ancestor) return true;
  return false;
}

function boundsOfTriangles(triangles) {
  const box = new THREE.Box3();
  triangles.forEach(item => box.union(item.box));
  return box;
}

function buildTree(triangles) {
  const box = boundsOfTriangles(triangles);
  if (triangles.length <= 16) return {box, triangles};
  const size = box.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  triangles.sort((a, b) => a.center[axis] - b.center[axis]);
  const middle = Math.floor(triangles.length / 2);
  return {box, left: buildTree(triangles.slice(0, middle)), right: buildTree(triangles.slice(middle))};
}

function closedSurface(tree) {
  if (tree.closedSurface) return tree.closedSurface();
  if (tree.closed !== undefined) return tree.closed;
  const pointKey = point => [point.x, point.y, point.z].map(value => Math.round(value * 100000)).join(',');
  const count = node => node.triangles ? node.triangles.length : count(node.left) + count(node.right);
  const indices = new Uint32Array(count(tree) * 3), points = new Map();
  let offset = 0;
  const canonical = point => {
    const key = pointKey(point);
    let id = points.get(key);
    if (id === undefined) { id = points.size; points.set(key, id); }
    indices[offset++] = id;
  };
  const visit = node => {
    if (!node.triangles) { visit(node.left); visit(node.right); return; }
    node.triangles.forEach(({triangle}) => { canonical(triangle.a); canonical(triangle.b); canonical(triangle.c); });
  };
  visit(tree);
  // Pack canonical endpoint IDs into exact integer doubles. Sorted edge runs
  // retain the previous parity test and 1e-5 weld tolerance without millions of
  // allocated edge strings/Map entries for dense imported models.
  const base = Math.max(1, points.size);
  points.clear();
  // Extremely large meshes can exceed double precision's exact integer range.
  // Keep parity exact there as well instead of letting endpoint pairs collide.
  if (base * base > Number.MAX_SAFE_INTEGER) {
    const counts = new Map();
    for (let i = 0; i < indices.length; i += 3) for (let j = 0; j < 3; j++) {
      const a = indices[i + j], b = indices[i + (j + 1) % 3], key = Math.min(a, b) + ',' + Math.max(a, b);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    tree.closed = Array.from(counts.values()).every(count => count % 2 === 0);
    return tree.closed;
  }
  const edges = new Float64Array(indices.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    edges[i] = Math.min(a, b) * base + Math.max(a, b);
    edges[i + 1] = Math.min(b, c) * base + Math.max(b, c);
    edges[i + 2] = Math.min(c, a) * base + Math.max(c, a);
  }
  edges.sort();
  tree.closed = true;
  for (let start = 0; start < edges.length;) {
    let end = start + 1;
    while (end < edges.length && edges[end] === edges[start]) end++;
    if ((end - start) % 2) { tree.closed = false; break; }
    start = end;
  }
  return tree.closed;
}

function treeFor(geometry) {
  if (geometry.isBufferGeometry) return getGeometryTree(geometry);
  let buffer = geometry;
  if (!geometry.isBufferGeometry) buffer = new THREE.BufferGeometry().fromGeometry(geometry);
  const position = buffer.attributes.position, index = buffer.index;
  if (!position) return null;
  const version = geometryState(geometry);
  const cached = geometryTrees.get(geometry);
  if (cached && sameGeometry(cached.version, version)) return cached.tree;
  const triangles = [], count = index ? index.count : position.count;
  const first = Math.max(0, buffer.drawRange.start || 0);
  const end = Math.min(count, first + buffer.drawRange.count);
  for (let i = first; i + 2 < end; i += 3) {
    const vertex = offset => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i + offset) : i + offset);
    const triangle = new THREE.Triangle(vertex(0), vertex(1), vertex(2));
    if (!Number.isFinite(triangle.a.lengthSq() + triangle.b.lengthSq() + triangle.c.lengthSq()) || triangle.getArea() < 1e-12) continue;
    const box = new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]);
    triangles.push({triangle, box, center: box.getCenter(new THREE.Vector3())});
  }
  const tree = triangles.length ? buildTree(triangles) : null;
  geometryTrees.set(geometry, {version, tree});
  return tree;
}

function queryTree(node, box, callback) {
  if (node && node.query) return node.query(box, triangle => triangle.getArea() >= 1e-12 && callback(triangle));
  if (!node || !node.box.intersectsBox(box)) return false;
  if (node.triangles) {
    for (const item of node.triangles) if (item.box.intersectsBox(box) && callback(item.triangle)) return true;
    return false;
  }
  return queryTree(node.left, box, callback) || queryTree(node.right, box, callback);
}

// Closest points of two finite segments (including parallel/degenerate ones).
function closestSegments(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.lengthSq(), e = d2.lengthSq(), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= EPSILON && e <= EPSILON) return [p1.clone(), p2.clone()];
  if (a <= EPSILON) t = THREE.Math.clamp(f / e, 0, 1);
  else {
    const c = d1.dot(r);
    if (e <= EPSILON) s = THREE.Math.clamp(-c / a, 0, 1);
    else {
      const b = d1.dot(d2), denominator = a * e - b * b;
      if (Math.abs(denominator) > EPSILON) s = THREE.Math.clamp((b * f - c * e) / denominator, 0, 1);
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.Math.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.Math.clamp((b - c) / a, 0, 1); }
    }
  }
  return [p1.clone().addScaledVector(d1, s), p2.clone().addScaledVector(d2, t)];
}

function closestCapsuleTriangle(start, end, triangle) {
  const direction = end.clone().sub(start), length = direction.length();
  if (length > EPSILON) {
    const hit = new THREE.Ray(start, direction.clone().divideScalar(length)).intersectTriangle(triangle.a, triangle.b, triangle.c, false, new THREE.Vector3());
    if (hit && hit.distanceToSquared(start) <= length * length) return [hit.clone(), hit];
  }
  let result = [start.clone(), triangle.closestPointToPoint(start, new THREE.Vector3())];
  let distance = result[0].distanceToSquared(result[1]);
  const candidate = [end.clone(), triangle.closestPointToPoint(end, new THREE.Vector3())];
  if (candidate[0].distanceToSquared(candidate[1]) < distance) { result = candidate; distance = candidate[0].distanceToSquared(candidate[1]); }
  [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]].forEach(edge => {
    const points = closestSegments(start, end, edge[0], edge[1]);
    const next = points[0].distanceToSquared(points[1]);
    if (next < distance) { result = points; distance = next; }
  });
  return result;
}

function capsuleSegment(eye, options) {
  const radius = options.radius === undefined ? 0.25 : options.radius;
  const height = Math.max(radius * 2, options.height === undefined ? 1.6 : options.height);
  const eyeHeight = options.eyeHeight === undefined ? height : options.eyeHeight;
  const bottom = eye.clone(); bottom.y += radius - eyeHeight;
  const top = eye.clone(); top.y += height - radius - eyeHeight;
  return {start: bottom, end: top, radius};
}

function capsuleBounds(capsule) {
  return new THREE.Box3().setFromPoints([capsule.start, capsule.end]).expandByScalar(capsule.radius + SKIN);
}

function shrinkBox(box) {
  const size = box.getSize(new THREE.Vector3());
  const result = box.clone();
  AXES.forEach((axis, index) => {
    const key = ['x', 'y', 'z'][index], inset = Math.min(SKIN, size[key] * 0.1);
    result.min[key] += inset; result.max[key] -= inset;
  });
  return result;
}

// Continuous separating-axis test for a translating AABB against one triangle.
// Surface geometry keeps hollow rooms hollow and handles thin walls at speed.
function sweepTriangle(box, movement, triangle) {
  const center = box.getCenter(new THREE.Vector3()), half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const edges = [triangle.b.clone().sub(triangle.a), triangle.c.clone().sub(triangle.b), triangle.a.clone().sub(triangle.c)];
  const axes = AXES.concat([triangle.getNormal(new THREE.Vector3())]);
  edges.forEach(edge => AXES.forEach(axis => axes.push(new THREE.Vector3().crossVectors(edge, axis))));
  let enter = -Infinity, exit = Infinity;
  for (const axis of axes) {
    if (axis.lengthSq() < 1e-14) continue;
    const a = triangle.a.dot(axis), b = triangle.b.dot(axis), c = triangle.c.dot(axis);
    const low = Math.min(a, b, c), high = Math.max(a, b, c);
    const origin = center.dot(axis), speed = movement.dot(axis);
    const radius = half.x * Math.abs(axis.x) + half.y * Math.abs(axis.y) + half.z * Math.abs(axis.z);
    if (Math.abs(speed) < EPSILON) {
      if (origin + radius < low || origin - radius > high) return null;
    } else {
      const first = (low - radius - origin) / speed, last = (high + radius - origin) / speed;
      enter = Math.max(enter, Math.min(first, last)); exit = Math.min(exit, Math.max(first, last));
      if (enter > exit) return null;
    }
  }
  if (exit < 0 || enter > 1) return null;
  // Existing contact may move out of penetration; never trap an authored actor.
  if (enter < -1e-7) return null;
  return Math.max(0, enter);
}

function sweepOtherBox(box, movement, other) {
  const center = box.getCenter(new THREE.Vector3()), half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const expanded = other.clone().expandByVector(half);
  if (expanded.containsPoint(center)) return null;
  let enter = -Infinity, exit = Infinity;
  for (const key of ['x', 'y', 'z']) {
    if (Math.abs(movement[key]) < EPSILON) {
      if (center[key] < expanded.min[key] || center[key] > expanded.max[key]) return null;
    } else {
      const first = (expanded.min[key] - center[key]) / movement[key], last = (expanded.max[key] - center[key]) / movement[key];
      enter = Math.max(enter, Math.min(first, last)); exit = Math.min(exit, Math.max(first, last));
      if (enter > exit) return null;
    }
  }
  return exit >= 0 && enter <= 1 ? Math.max(0, enter) : null;
}

/** Kinematic surface collisions shared by authoring, desktop, WebXR and equipment. */
export default class CollisionWorld {
  constructor(ctx, document) {
    this.ctx = ctx;
    this.document = document;
    this.roomId = null;
    this.root = null;
    this.entries = [];
    this.frameActive = false;
    this.dirty = true;
    this.snapshot = [];
    this.snapshotRoot = null;
    this.snapshotStale = false;
    this.snapshotVersion = 0;
    this.restingQuery = null;
    this.stats = {refreshes: 0, subtreeRefreshes: 0, matrixInversions: 0, queries: 0, restingCacheHits: 0};
  }

  // Input, teleports and all conveyor packages share one room snapshot per
  // frame. Standalone callers retain the original always-fresh query API.
  beginFrame() { this.frameActive = true; this.dirty = true; }

  endFrame() { this.frameActive = false; }

  invalidate(object) {
    if (!object || !this.frameActive || this.dirty) { this.dirty = true; return; }
    // Simulation knows which actor changed. Update only that actor, including
    // newly spawned packages and detached helpers, instead of traversing a
    // potentially very large room for every package's collision query.
    this.entries = this.entries.filter(entry => !within(entry.object, object));
    if (within(object, this.root)) {
      object.updateWorldMatrix(true, true);
      object.traverse(node => this._addEntry(node));
    }
    this.snapshotVersion++;
    this.snapshotStale = true;
    this.restingQuery = null;
    this.stats.subtreeRefreshes++;
  }

  _ensureFresh() {
    this.stats.queries++;
    if (!this.frameActive || this.dirty) this.refresh();
  }

  _addEntry(object) {
    if (!this.physicalMesh(object) || Math.abs(object.matrixWorld.determinant()) < 1e-12) return;
    this.entries.push({object, box: object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld), inverse: null});
  }

  _inverse(entry) {
    if (!entry.inverse) {
      entry.inverse = new THREE.Matrix4().getInverse(entry.object.matrixWorld);
      this.stats.matrixInversions++;
    }
    return entry.inverse;
  }

  setRoom(roomId) {
    this.roomId = String(roomId);
    this.root = this.document.getRoot(this.roomId);
    this.refresh();
  }

  configuration(object) {
    let sensor = false;
    for (let node = object; node; node = node.parent) {
      const data = node.userData || {};
      const list = Array.isArray(data.editorBehaviors) ? data.editorBehaviors :
        Array.isArray(data.editorDefaultBehaviors) ? data.editorDefaultBehaviors : [];
      const config = list.find(item => item && item.type === 'collision');
      if (config) return config;
      if (list.some(item => item && item.type === 'sensor')) sensor = true;
      if (node === this.root) break;
    }
    return {enabled: true, mode: sensor ? 'trigger' : 'solid'};
  }

  isSolid(object) {
    const config = this.configuration(object);
    return config.enabled !== false && config.mode !== 'trigger';
  }

  physicalMesh(object) {
    if (!object.isMesh || !object.geometry || !this.isSolid(object)) return false;
    if (object.userData.editorGeometryReplaced) return false;
    const body = object.userData.editorCollisionBody === true;
    for (let node = object; node; node = node.parent) {
      if (node.industrialHeld === true) return false;
      if (!node.visible) return false;
      if (!body && (node.userData.editorHelper || node.userData.editorRuntimeHelper)) return false;
      if (node === this.root) break;
    }
    if (/^(sky|clouds|textMesh|foxr|mozillamr)$/i.test(object.name)) return false;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.every(material => !material || material.visible === false || material.opacity === 0)) return false;
    const state = geometryState(object.geometry), previous = geometryBounds.get(object.geometry);
    const changed = previous && !sameGeometry(previous, state);
    if (!object.geometry.boundingBox || changed) object.geometry.computeBoundingBox();
    if (!object.geometry.boundingSphere || changed) object.geometry.computeBoundingSphere();
    geometryBounds.set(object.geometry, state);
    // Original immersive panorama spheres are backgrounds, rather than walls.
    if (object.geometry.boundingSphere && object.geometry.boundingSphere.radius >= 100 && materials.some(material => material && material.side === THREE.BackSide)) return false;
    return true;
  }

  refresh() {
    this.stats.refreshes++;
    this.dirty = false;
    this.entries = [];
    this.root = this.document.getRoot(this.roomId);
    if (this.root) {
      this.root.updateWorldMatrix(true, true);
      this.root.traverse(object => this._addEntry(object));
    }
    // A frame still checks all collider transforms/visibility, so a moving wall
    // can push a stationary camera. Only unchanged snapshots reuse narrow phase.
    const snapshot = this.entries.map(entry => ({object: entry.object, geometry: geometryState(entry.object.geometry),
      matrix: entry.object.matrixWorld.elements.slice(), parents: ancestry(entry.object),
      bounds: entry.box.min.toArray().concat(entry.box.max.toArray()), collisionBody: entry.object.userData.editorCollisionBody}));
    const changed = this.snapshotStale || this.root !== this.snapshotRoot || snapshot.length !== this.snapshot.length || snapshot.some((entry, index) => {
      const previous = this.snapshot[index];
      return entry.object !== previous.object || entry.collisionBody !== previous.collisionBody ||
        !sameGeometry(entry.geometry, previous.geometry) || !sameValues(entry.matrix, previous.matrix) ||
        !sameValues(entry.bounds, previous.bounds) || !sameValues(entry.parents, previous.parents);
    });
    if (changed) { this.snapshotVersion++; this.restingQuery = null; }
    this.snapshot = snapshot;
    this.snapshotRoot = this.root;
    this.snapshotStale = false;
  }

  triangles(box, options, callback) {
    const ignored = options.ignore || [];
    const triangle = new THREE.Triangle();
    for (const entry of this.entries) {
      if (!entry.box.intersectsBox(box) || ignored.some(object => within(entry.object, object))) continue;
      if (options.extraBoxes && entry.object.userData.editorCollisionBody) continue;
      const inverse = this._inverse(entry);
      const localBox = box.clone().applyMatrix4(inverse);
      const tree = treeFor(entry.object.geometry);
      if (queryTree(tree, localBox, local => {
        triangle.a.copy(local.a).applyMatrix4(entry.object.matrixWorld);
        triangle.b.copy(local.b).applyMatrix4(entry.object.matrixWorld);
        triangle.c.copy(local.c).applyMatrix4(entry.object.matrixWorld);
        return callback(triangle, entry.object);
      })) return true;
    }
    return false;
  }

  rayBlocked(start, end, options = {}) {
    this._ensureFresh();
    const direction = end.clone().sub(start), length = direction.length();
    if (length < 0.0001) return false;
    const ray = new THREE.Ray(start, direction.divideScalar(length)), point = new THREE.Vector3();
    const bounds = new THREE.Box3().setFromPoints([start, end]).expandByScalar(0.0001);
    // Use the same accelerated solid geometry as movement. The endpoint itself
    // is contact with the selected object, rather than an obstruction.
    return this.triangles(bounds, options, triangle => {
      const hit = ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, point);
      return !!hit && hit.distanceTo(start) < length - 0.005;
    });
  }

  moveSphere(start, desired, radius = 0.18, options = {}) {
    return this.moveCapsule(start, desired, Object.assign({}, options, {radius, height: radius * 2, eyeHeight: radius}));
  }

  moveCapsule(start, desired, options = {}) {
    this._ensureFresh();
    const position = start.clone(), total = desired.clone().sub(start);
    const resting = total.lengthSq() === 0, signature = resting ? queryOptions(options) : null;
    const cached = this.restingQuery;
    if (resting && cached && cached.version === this.snapshotVersion && cached.start.equals(start) && sameOptions(cached.options, signature)) {
      this.stats.restingCacheHits++;
      return cached.result.clone();
    }
    const finish = result => {
      if (resting) this.restingQuery = {version: this.snapshotVersion, start: start.clone(), options: signature, result: result.clone()};
      return result;
    };
    if (!this.entries.length) return finish(desired.clone());
    const radius = options.radius === undefined ? 0.25 : options.radius;
    // An authored object can be placed over a spawn point before Play. Recover
    // from a closed solid instead of trapping the visitor inside its surfaces.
    for (let attempt = 0; attempt < 3; attempt++) {
      const capsule = capsuleSegment(position, options);
      const samples = capsule.start.equals(capsule.end) ? [capsule.start] :
        [capsule.start.clone().lerp(capsule.end, 0.5), capsule.start, capsule.end];
      let occupied = null, sample = null;
      for (const point of samples) {
        occupied = this.insideEntry(point, options);
        if (occupied) { sample = point; break; }
      }
      if (!occupied) break;
      const surface = this.nearestSurface(occupied, sample);
      if (!surface) break;
      const normal = surface.clone().sub(sample).normalize();
      if (normal.lengthSq() < EPSILON) break;
      const depth = radius + SKIN - Math.min(capsule.start.clone().sub(surface).dot(normal), capsule.end.clone().sub(surface).dot(normal));
      position.addScaledVector(normal, Math.max(0, depth));
    }
    const steps = Math.max(1, Math.ceil(total.length() / Math.max(0.02, radius * 0.45)));
    const movement = total.clone().divideScalar(steps);
    for (let step = 0; step < steps; step++) {
      const previous = position.clone(); position.add(movement);
      for (let iteration = 0; iteration < 5; iteration++) {
        const capsule = capsuleSegment(position, options), bounds = capsuleBounds(capsule);
        let deepest = 0, correction = null;
        this.triangles(bounds, options, triangle => {
          const points = closestCapsuleTriangle(capsule.start, capsule.end, triangle);
          const distance = points[0].distanceTo(points[1]), depth = radius + SKIN - distance;
          if (depth <= deepest + 1e-8) return false;
          let normal = points[0].clone().sub(points[1]);
          if (distance > 1e-8) normal.divideScalar(distance);
          else {
            normal = triangle.getNormal(new THREE.Vector3());
            const oldSegment = capsuleSegment(previous, options);
            const side = oldSegment.start.clone().add(oldSegment.end).multiplyScalar(0.5).sub(triangle.a).dot(normal);
            if (side < 0 || Math.abs(side) < 1e-8 && normal.dot(movement) > 0) normal.negate();
          }
          deepest = depth; correction = normal.multiplyScalar(depth);
          return false;
        });
        if (!correction) break;
        position.add(correction);
      }
      if (position.distanceToSquared(previous) < 1e-14 && movement.lengthSq() > 0) break;
    }
    return finish(position);
  }

  canOccupyCapsule(eye, options = {}) {
    this._ensureFresh();
    const capsule = capsuleSegment(eye, options);
    const touching = this.triangles(capsuleBounds(capsule), options, triangle => {
      const points = closestCapsuleTriangle(capsule.start, capsule.end, triangle);
      return points[0].distanceToSquared(points[1]) < Math.pow(Math.max(0, capsule.radius - SKIN), 2);
    });
    return !touching && ![capsule.start, capsule.end, capsule.start.clone().lerp(capsule.end, 0.5)].some(point => this.insideSolid(point, options));
  }

  insideSolid(point, options = {}) { return Boolean(this.insideEntry(point, options)); }

  insideEntry(point, options = {}) {
    const ignored = options.ignore || [];
    for (const entry of this.entries) {
      if (!entry.box.containsPoint(point) || ignored.some(object => within(entry.object, object)) ||
        options.extraBoxes && entry.object.userData.editorCollisionBody) continue;
      const tree = treeFor(entry.object.geometry);
      if (!tree || !closedSurface(tree)) continue;
      const inverse = this._inverse(entry);
      const localPoint = point.clone().applyMatrix4(inverse);
      const direction = new THREE.Vector3(0.81231, 0.23457, 0.53129).normalize();
      const ray = new THREE.Ray(localPoint, direction), hits = [];
      const intersect = triangle => {
        if (triangle.getArea() < 1e-12) return false;
        const hit = ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, new THREE.Vector3());
        if (hit && hit.distanceTo(localPoint) > SKIN) hits.push(hit.distanceTo(localPoint));
        return false;
      };
      const visit = node => {
        if (!ray.intersectsBox(node.box)) return;
        if (!node.triangles) { visit(node.left); visit(node.right); return; }
        node.triangles.forEach(({triangle}) => intersect(triangle));
      };
      if (tree.queryRay) tree.queryRay(ray, intersect); else visit(tree);
      hits.sort((a, b) => a - b);
      const crossings = hits.filter((distance, index) => !index || distance - hits[index - 1] > 1e-6);
      if (crossings.length % 2) return entry;
    }
    return null;
  }

  nearestSurface(entry, point) {
    const tree = treeFor(entry.object.geometry);
    if (!tree) return null;
    if (tree.closestPoint) return tree.closestPoint(point, entry.object.matrixWorld, 1e-12);
    const inverse = this._inverse(entry);
    const localPoint = point.clone().applyMatrix4(inverse);
    const elements = entry.object.matrixWorld.elements;
    const minimumScale = Math.min(Math.hypot(elements[0], elements[1], elements[2]),
      Math.hypot(elements[4], elements[5], elements[6]), Math.hypot(elements[8], elements[9], elements[10]));
    let nearest = null, distance = Infinity;
    const visit = node => {
      if (node.box.distanceToPoint(localPoint) * minimumScale > distance) return;
      if (!node.triangles) {
        const children = [node.left, node.right].sort((a, b) => a.box.distanceToPoint(localPoint) - b.box.distanceToPoint(localPoint));
        children.forEach(visit); return;
      }
      node.triangles.forEach(({triangle}) => {
        const world = new THREE.Triangle(triangle.a.clone().applyMatrix4(entry.object.matrixWorld),
          triangle.b.clone().applyMatrix4(entry.object.matrixWorld), triangle.c.clone().applyMatrix4(entry.object.matrixWorld));
        const closest = world.closestPointToPoint(point, new THREE.Vector3());
        const next = closest.distanceTo(point);
        if (next < distance) { nearest = closest; distance = next; }
      });
    };
    visit(tree); return nearest;
  }

  objectBounds(object) {
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    object.traverse(mesh => {
      if (this.physicalMesh(mesh)) box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    });
    return box;
  }

  testBox(box, options = {}) {
    this._ensureFresh();
    const inner = shrinkBox(box);
    if (inner.isEmpty()) return false;
    if ((options.extraBoxes || []).some(other => inner.intersectsBox(shrinkBox(other)))) return true;
    return this.triangles(inner, options, triangle => inner.intersectsTriangle(triangle)) || this.insideSolid(inner.getCenter(new THREE.Vector3()), options);
  }

  sweepBox(box, movement, options = {}) {
    this._ensureFresh();
    const inner = shrinkBox(box), broad = box.clone().union(box.clone().translate(movement));
    let fraction = 1;
    this.triangles(broad, options, triangle => {
      const hit = sweepTriangle(inner, movement, triangle);
      if (hit !== null) fraction = Math.min(fraction, hit);
      return false;
    });
    (options.extraBoxes || []).forEach(other => {
      const hit = sweepOtherBox(inner, movement, shrinkBox(other));
      if (hit !== null) fraction = Math.min(fraction, hit);
    });
    if (fraction < 1 && movement.length() > EPSILON) fraction = Math.max(0, fraction - SKIN / movement.length());
    return {fraction, blocked: fraction < 1, movement: movement.clone().multiplyScalar(fraction)};
  }

  moveObject(object, desiredLocalPosition, options = {}) {
    object.updateWorldMatrix(true, true);
    const from = object.getWorldPosition(new THREE.Vector3());
    const desired = object.parent ? object.parent.localToWorld(desiredLocalPosition.clone()) : desiredLocalPosition.clone();
    const movement = desired.sub(from);
    if (!this.isSolid(object)) return {position: desiredLocalPosition.clone(), movement, fraction: 1, blocked: false};
    const box = this.objectBounds(object);
    const result = box.isEmpty() ? {movement, fraction: 1, blocked: false} : this.sweepBox(box, movement,
      Object.assign({}, options, {ignore: (options.ignore || []).concat(object)}));
    const position = from.add(result.movement);
    if (object.parent) object.parent.worldToLocal(position);
    return Object.assign({}, result, {position});
  }

  canPlaceObject(object, options = {}) {
    if (!this.isSolid(object)) return true;
    const box = this.objectBounds(object);
    return box.isEmpty() || !this.testBox(box, Object.assign({}, options, {ignore: (options.ignore || []).concat(object)}));
  }
}
