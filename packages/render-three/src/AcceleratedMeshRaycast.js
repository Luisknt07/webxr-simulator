import * as THREE from 'three';

const installed = new WeakMap();

function aligned(value, infinite = false) {
  return infinite && value === Infinity || Number.isSafeInteger(value) && value >= 0 && value % 3 === 0;
}

function supported(mesh) {
  const geometry = mesh.geometry;
  if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || !geometry || !geometry.isBufferGeometry ||
    !geometry.attributes.position || !aligned(geometry.index ? geometry.index.count : geometry.attributes.position.count)) return false;
  if (Object.keys(geometry.morphAttributes || {}).some(key => geometry.morphAttributes[key].length)) return false;
  const range = geometry.drawRange, count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
  if (!range || !aligned(range.start) || !aligned(range.count, true) || range.start > count) return false;
  if (Array.isArray(mesh.material) && geometry.groups.some(group => !aligned(group.start) || !aligned(group.count, true) ||
    !Number.isInteger(group.materialIndex) || !mesh.material[group.materialIndex])) return false;
  return true;
}

/** Accelerate ordinary static meshes without changing Three's global prototype. */
export function installMeshRaycast(mesh, getTree) {
  if (!mesh || typeof getTree !== 'function') return false;
  const previous = installed.get(mesh);
  if (previous && mesh.raycast === previous.raycast) { previous.getTree = getTree; return supported(mesh); }
  if (mesh.raycast !== THREE.Mesh.prototype.raycast || !supported(mesh)) return false;
  const state = {original: mesh.raycast, getTree, raycast: null};
  state.raycast = function acceleratedRaycast(raycaster, intersects) {
    if (!supported(this)) return state.original.call(this, raycaster, intersects);
    const geometry = this.geometry, material = this.material;
    if (material === undefined) return;
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere.clone().applyMatrix4(this.matrixWorld);
    if (!raycaster.ray.intersectsSphere(sphere)) return;
    const inverse = new THREE.Matrix4().getInverse(this.matrixWorld);
    const ray = raycaster.ray.clone().applyMatrix4(inverse);
    if (geometry.boundingBox !== null && !ray.intersectsBox(geometry.boundingBox)) return;
    const draw = geometry.drawRange, sourceCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;
    const end = Math.min(sourceCount, draw.start + draw.count);
    const index = geometry.index, uv = geometry.attributes.uv, uv2 = geometry.attributes.uv2;
    const point = new THREE.Vector3(), uvA = new THREE.Vector2(), uvB = new THREE.Vector2(), uvC = new THREE.Vector2();
    const hits = [];
    const check = (triangle, offset, selectedMaterial, groupIndex, materialIndex) => {
      const {a, b, c} = triangle;
      const hit = selectedMaterial.side === THREE.BackSide ? ray.intersectTriangle(c, b, a, true, point) :
        ray.intersectTriangle(a, b, c, selectedMaterial.side !== THREE.DoubleSide, point);
      if (!hit) return;
      const worldPoint = point.clone().applyMatrix4(this.matrixWorld), distance = raycaster.ray.origin.distanceTo(worldPoint);
      if (distance < raycaster.near || distance > raycaster.far) return;
      const first = index ? index.getX(offset) : offset;
      const second = index ? index.getX(offset + 1) : offset + 1;
      const third = index ? index.getX(offset + 2) : offset + 2;
      const intersection = {distance, point: worldPoint, object: this};
      const readUV = attribute => {
        uvA.fromBufferAttribute(attribute, first); uvB.fromBufferAttribute(attribute, second); uvC.fromBufferAttribute(attribute, third);
        return THREE.Triangle.getUV(point, a, b, c, uvA, uvB, uvC, new THREE.Vector2());
      };
      if (uv) intersection.uv = readUV(uv);
      if (uv2) intersection.uv2 = readUV(uv2);
      intersection.face = new THREE.Face3(first, second, third);
      THREE.Triangle.getNormal(a, b, c, intersection.face.normal);
      if (materialIndex !== undefined) intersection.face.materialIndex = materialIndex;
      intersection.faceIndex = Math.floor(offset / 3);
      hits.push({intersection, groupIndex, offset});
    };
    try {
      const tree = state.getTree(geometry);
      if (!tree || typeof tree.queryRay !== 'function') return state.original.call(this, raycaster, intersects);
      tree.queryRay(ray, (triangle, offset) => {
        if (offset < draw.start || offset >= end) return false;
        if (Array.isArray(material)) {
          geometry.groups.forEach((group, groupIndex) => {
            if (offset >= Math.max(group.start, draw.start) && offset < Math.min(group.start + group.count, draw.start + draw.count)) {
              check(triangle, offset, material[group.materialIndex], groupIndex, group.materialIndex);
            }
          });
        } else check(triangle, offset, material, 0);
        return false;
      });
    } catch (error) {
      return state.original.call(this, raycaster, intersects);
    }
    // Three's outer Raycaster sorts by distance. Preserve the original face and
    // group order first, including overlapping groups and equal-distance hits.
    hits.sort((a, b) => a.groupIndex - b.groupIndex || a.offset - b.offset);
    hits.forEach(hit => intersects.push(hit.intersection));
  };
  mesh.raycast = state.raycast;
  installed.set(mesh, state);
  return true;
}
