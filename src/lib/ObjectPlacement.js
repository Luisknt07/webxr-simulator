import * as THREE from 'three';

const GAP = 0.003;
const MAX_TRIANGLES = 4096;
const MAX_CANDIDATES = 20;
const UP = new THREE.Vector3(0, 1, 0);

function within(object, ancestor) {
  for (let node = object; node; node = node.parent) if (node === ancestor) return true;
  return false;
}

function matches(object, targets) { return !targets || targets.some(target => within(object, target)); }

function usable(mesh, root) {
  if (!mesh.isMesh || !mesh.geometry || mesh.userData.editorGeometryReplaced) return false;
  const body = mesh.userData.editorCollisionBody === true;
  for (let node = mesh; node; node = node.parent) {
    const data = node.userData || {};
    if (!node.visible || !body && (data.editorHelper || data.editorRuntimeHelper) || /^(SensorVolume|textMesh)$/i.test(node.name)) return false;
    if (node === root) break;
  }
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return !materials.every(material => !material || material.visible === false || material.opacity === 0);
}

function boundsOf(object) {
  object.updateWorldMatrix(true, true);
  if (Math.abs(object.matrixWorld.determinant()) < 1e-12) return null;
  const inverse = new THREE.Matrix4().getInverse(object.matrixWorld), bounds = new THREE.Box3();
  object.traverse(mesh => {
    if (!usable(mesh, object)) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(
      new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)));
  });
  return bounds.isEmpty() ? null : bounds;
}

function sideEligible(mesh, explicit) {
  for (let node = mesh; node; node = node.parent) {
    const data = node.userData || {}, descriptor = data.editorDescriptor;
    if (descriptor && descriptor.nativeId) return false;
    if (descriptor && (descriptor.type === 'box' || descriptor.prefab === 'product' || descriptor.importId || descriptor.path)) return true;
    if (data.editorPrefabKey === 'product') return true;
    const behaviors = data.editorBehaviors || data.editorDefaultBehaviors || [];
    if (behaviors.some(item => item.type === 'product')) return true;
  }
  // An explicitly supplied simple box is useful to callers outside the editor.
  // Combined native room geometry can never become an imaginary solid AABB.
  return explicit && /^(BoxGeometry|BoxBufferGeometry)$/.test(mesh.geometry.type);
}

function translated(matrix, delta) {
  const result = matrix.clone();
  result.elements[12] += delta.x; result.elements[13] += delta.y; result.elements[14] += delta.z;
  return result;
}

function probes(box) {
  const center = box.getCenter(new THREE.Vector3()), half = box.getSize(new THREE.Vector3()).multiplyScalar(0.36);
  const result = [];
  [-1, 0, 1].forEach(x => [-1, 0, 1].forEach(z => result.push(new THREE.Vector3(center.x + x * half.x, 0, center.z + z * half.z))));
  return result;
}

// A footprint must have support on both sides of its center. Small bounded ray
// offsets bridge roller gaps and pallet slat gaps without accepting a table edge.
function supportAt(box, level, triangles) {
  const points = probes(box), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const radius = Math.min(0.026, size.x * 0.08, size.z * 0.08), offsets = [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]];
  const ray = new THREE.Ray(), hit = new THREE.Vector3(), supported = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index]; let found = false;
    for (const offset of offsets) {
      ray.origin.set(point.x + offset[0], level + 0.045, point.z + offset[1]); ray.direction.set(0, -1, 0);
      for (const item of triangles) {
        const bounds = item.bounds;
        if (item.normal.y < 0.78 || bounds.max.y < level - 0.045 || bounds.min.y > level + 0.002 ||
          ray.origin.x < bounds.min.x - 1e-7 || ray.origin.x > bounds.max.x + 1e-7 || ray.origin.z < bounds.min.z - 1e-7 || ray.origin.z > bounds.max.z + 1e-7) continue;
        if (ray.intersectTriangle(item.triangle.a, item.triangle.b, item.triangle.c, false, hit) && hit.y >= level - 0.045 && hit.y <= level + 0.002) {
          found = true; break;
        }
      }
      if (found) break;
    }
    if (found) supported.push(index);
  }
  if (supported.length < 5) return false;
  return supported.some(index => points[index].x < center.x - size.x * 0.1) && supported.some(index => points[index].x > center.x + size.x * 0.1) &&
    supported.some(index => points[index].z < center.z - size.z * 0.1) && supported.some(index => points[index].z > center.z + size.z * 0.1);
}

/** Geometry based placement shared by the editor and desktop/WebXR grabbing.
 * find only proposes a world matrix: it never reparents or mutates an actor.
 * bounds is object-local, matrix is world-space; the complete linear matrix
 * (including frozen rotation, nonuniform scale and shear) remains unchanged.
 */
export default class ObjectPlacement {
  constructor(world) { this.world = world; }

  find(object, options = {}) {
    const world = this.world;
    if (!object || !world || !Array.isArray(world.entries) || typeof world.triangles !== 'function' || typeof world.testBox !== 'function' || typeof world.sweepBox !== 'function') return null;
    if (typeof world._ensureFresh === 'function') world._ensureFresh();
    const local = options.bounds ? options.bounds.clone() : boundsOf(object);
    if (!local || local.isEmpty()) return null;
    if (!options.matrix) object.updateWorldMatrix(true, true);
    const matrix = (options.matrix || object.matrixWorld).clone();
    if (!matrix.elements.every(Number.isFinite) || Math.abs(matrix.determinant()) < 1e-12) return null;
    const box = local.clone().applyMatrix4(matrix), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    if (Math.min(size.x, size.y, size.z) < 0.00001) return null;
    const surfaceDistance = options.surfaceDistance === undefined ? 0.25 : Math.max(0, options.surfaceDistance);
    const sideDistance = options.sideDistance === undefined ? 0.16 : Math.max(0, options.sideDistance);
    const previewDistance = Math.min(2, Math.max(surfaceDistance, sideDistance, options.previewDistance === undefined ? 0.7 : options.previewDistance));
    const ignore = (options.ignore || []).concat(object), targets = options.targets;
    const collision = {ignore};
    // CollisionWorld treats extraBoxes as an authoritative replacement for its
    // generated package bodies. Preserve that contract only when explicitly
    // supplied; discovery always needs the real package surface triangles.
    if (options.extraBoxes) collision.extraBoxes = options.extraBoxes;
    const root = options.root || world.root;
    const query = box.clone().expandByScalar(previewDistance + 0.03), triangles = [];
    query.max.y = Math.min(query.max.y, center.y + 0.04);
    let overflow = false, visited = 0;
    const orientation = new Map();
    world.triangles(query, {ignore}, (triangle, mesh) => {
      if (root && !within(mesh, root) || !usable(mesh, root)) return false;
      if (++visited > MAX_TRIANGLES) { overflow = true; return true; }
      const normal = triangle.getNormal(new THREE.Vector3());
      if (!orientation.has(mesh)) orientation.set(mesh, mesh.matrixWorld.determinant() < 0 ? -1 : 1);
      normal.multiplyScalar(orientation.get(mesh));
      if (normal.y > 0.78 || options.allowSides !== false && Math.abs(normal.y) < 0.06 && matches(mesh, targets) && sideEligible(mesh, Boolean(targets))) {
        triangles.push({triangle: triangle.clone(), normal, mesh, bounds: new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c])});
      }
      return false;
    });
    // Refuse a saturated local query rather than making an unsafe proposal from
    // an arbitrary subset of a dense imported object.
    if (overflow || !triangles.length) return null;
    const candidates = [];
    const add = (delta, target, kind, normal, point) => {
      const distance = delta.length(), threshold = kind === 'top' ? surfaceDistance : sideDistance;
      if (distance > previewDistance + 1e-6) return;
      const bounds = box.clone().translate(delta);
      if (world.testBox(bounds, collision)) return;
      if (distance > 0.00001) {
        const sweep = world.sweepBox(box, delta, collision);
        if (sweep.blocked && sweep.movement.distanceTo(delta) > GAP + 0.0005) return;
      }
      candidates.push({matrix: translated(matrix, delta), bounds, target, contactTarget: target, kind, distance, delta: delta.clone(), normal: normal.clone(), point: point.clone(), snapped: distance <= threshold + 1e-6});
    };
    const levels = [];
    const footprint = box.clone().expandByScalar(0.026);
    footprint.min.y = box.min.y - previewDistance; footprint.max.y = Math.min(center.y, box.min.y + surfaceDistance);
    triangles.forEach(item => {
      if (item.normal.y < 0.78 || !matches(item.mesh, targets)) return;
      const triangleBox = item.bounds;
      if (!triangleBox.intersectsBox(footprint)) return;
      const level = triangleBox.max.y;
      if (level > box.min.y + surfaceDistance || level < box.min.y - previewDistance || level > center.y) return;
      if (!levels.some(value => Math.abs(value.level - level) < 0.008)) levels.push({level, mesh: item.mesh});
    });
    levels.sort((a, b) => Math.abs(a.level + GAP - box.min.y) - Math.abs(b.level + GAP - box.min.y));
    levels.slice(0, MAX_CANDIDATES).forEach(({level, mesh}) => {
      if (supportAt(box, level, triangles)) add(new THREE.Vector3(0, level + GAP - box.min.y, 0), mesh, 'top', UP, new THREE.Vector3(center.x, level, center.z));
    });
    if (options.allowSides !== false) {
      const planes = [];
      triangles.forEach(item => {
        if (Math.abs(item.normal.y) >= 0.06) return;
        const normal = item.normal.clone(); normal.y = 0; normal.normalize();
        const plane = item.triangle.a.dot(normal), half = (size.x * Math.abs(normal.x) + size.z * Math.abs(normal.z)) / 2;
        const gap = center.dot(normal) - half - plane;
        if (gap < -Math.min(sideDistance, 0.035) || gap > previewDistance) return;
        if (planes.some(value => value.mesh === item.mesh && value.normal.dot(normal) > 0.999 && Math.abs(value.plane - plane) < 0.008)) return;
        planes.push({mesh: item.mesh, normal, plane, gap});
      });
      planes.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
      planes.slice(0, MAX_CANDIDATES).forEach(({mesh, normal, plane, gap}) => {
        const delta = normal.clone().multiplyScalar(GAP - gap), moved = box.clone().translate(delta);
        const contact = moved.getCenter(new THREE.Vector3()).addScaledVector(normal, -(size.x * Math.abs(normal.x) + size.z * Math.abs(normal.z)) / 2);
        // Require actual side-face coverage at the contact height, rather than
        // the enclosing bounds of a hollow/concave imported model.
        const tangent = new THREE.Vector3(-normal.z, 0, normal.x), span = (size.x * Math.abs(tangent.x) + size.z * Math.abs(tangent.z)) * 0.24;
        const ray = new THREE.Ray(), hit = new THREE.Vector3(); let count = 0;
        [-1, 0, 1].forEach(offset => {
          const point = contact.clone().addScaledVector(tangent, offset * span).addScaledVector(normal, 0.025);
          ray.origin.copy(point); ray.direction.copy(normal).negate();
          if (triangles.some(item => item.mesh === mesh && item.normal.dot(normal) > 0.98 && ray.intersectTriangle(item.triangle.a, item.triangle.b, item.triangle.c, false, hit) && hit.distanceTo(point) < 0.03)) count++;
        });
        if (count < 3) return;
        const bottom = moved.min.y;
        // Side magnets do not suspend boxes in midair.
        if (!supportAt(moved, bottom, triangles)) return;
        add(delta, mesh, 'side', normal, contact.addScaledVector(normal, -GAP));
      });
    }
    // Prefer a usable side joint over an already resting floor contact, while
    // otherwise choosing the smallest correction within the snap thresholds.
    candidates.sort((a, b) =>
      ((a.kind === 'side' && b.kind === 'top' && b.distance < 0.015) ? -1 : (b.kind === 'side' && a.kind === 'top' && a.distance < 0.015) ? 1 :
        Number(b.snapped) - Number(a.snapped) || a.distance - b.distance));
    return candidates[0] || null;
  }
}
