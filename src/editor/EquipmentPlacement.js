import * as THREE from 'three';

const CLEARANCE = 0.16;
const CONTACT = 0.003;
const SUPPORT_TOLERANCE = 0.012;

function within(object, ancestor) {
  for (let node = object; node; node = node.parent) if (node === ancestor) return true;
  return false;
}

function visibleMesh(object, root) {
  if (!object.isMesh || !object.geometry || object.userData.editorGeometryReplaced) return false;
  for (let node = object; node; node = node.parent) {
    const data = node.userData || {};
    if (!node.visible || data.editorHelper || data.editorRuntimeHelper || data.industrialSensorVolume) return false;
    if (node === root) break;
  }
  if (/^(sky|clouds|textMesh|foxr|mozillamr)$/i.test(object.name)) return false;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  if (materials.every(material => !material || material.visible === false || material.opacity <= 0.08)) return false;
  if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
  const box = object.geometry.boundingBox;
  return Boolean(box && !box.isEmpty() && Number.isFinite(box.min.lengthSq() + box.max.lengthSq()));
}

function behaviors(object) {
  const data = object.userData || {};
  return data.editorBehaviors || data.editorDefaultBehaviors || [];
}

function actorRoot(object, room) {
  let result = object;
  for (let node = object; node && node !== room; node = node.parent) {
    if (node.userData.editorDescriptor) result = node;
  }
  return result;
}

function maySupport(entry, room) {
  const object = entry.object;
  let explicit = false, native = false;
  for (let node = object; node && node !== room; node = node.parent) {
    const data = node.userData || {}, list = behaviors(node);
    if (data.editorPrefabKey || list.some(config => ['conveyor', 'product', 'sensor', 'automation', 'control'].includes(config.type))) return false;
    if (/\b(floor|ground|suelo|piso|terrain|terreno|hall|room|sala)\b/i.test(node.name)) explicit = true;
    if (list.some(config => config.type === 'teleport' && config.enabled !== false)) explicit = true;
    if (data.editorNative === true) native = true;
  }
  const size = entry.box.getSize(new THREE.Vector3());
  // Large native room meshes can contain both walls and the actual floor. The
  // upward-triangle test below keeps their room-sized bounding box hollow.
  return explicit || native && (size.x >= 5 || size.z >= 5) || size.y < 0.04 && Math.min(size.x, size.z) >= 1;
}

function worldBounds(object, room) {
  const box = new THREE.Box3(), parts = [];
  object.traverse(mesh => {
    if (!visibleMesh(mesh, room)) return;
    const part = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    box.union(part); parts.push(part);
  });
  return {box, parts};
}

function supportPoints(box, parts) {
  const result = [], keys = new Set();
  const add = (x, z) => {
    const key = Math.round(x * 100) + ':' + Math.round(z * 100);
    if (!keys.has(key)) { result.push(new THREE.Vector3(x, box.min.y, z)); keys.add(key); }
  };
  // Verify a support area, not just one point that could leave a long machine
  // straddling a hole or sticking out over the edge of the authored floor.
  [0.04, 0.5, 0.96].forEach(x => [0.04, 0.5, 0.96].forEach(z => {
    add(THREE.Math.lerp(box.min.x, box.max.x, x), THREE.Math.lerp(box.min.z, box.max.z, z));
  }));
  parts.filter(part => part.min.y < box.min.y + 0.045).forEach(part => {
    const center = part.getCenter(new THREE.Vector3()); add(center.x, center.z);
    [0.1, 0.9].forEach(x => [0.1, 0.9].forEach(z => {
      add(THREE.Math.lerp(part.min.x, part.max.x, x), THREE.Math.lerp(part.min.z, part.max.z, z));
    }));
  });
  // Dense imported models may contain many parts; retain the broad support
  // grid and a bounded, evenly distributed sample of the lowest parts.
  if (result.length <= 49) return result;
  return result.slice(0, 9).concat(Array.from({length: 40}, (_, index) => result[9 + Math.floor(index * (result.length - 9) / 40)]));
}

/** Safe initial placement, performed inside the editor's creation transaction. */
export default class EquipmentPlacement {
  constructor(editor) { this.editor = editor; }

  place(object, desiredWorld) {
    if (!object || !object.isObject3D) return null;
    const editor = this.editor, root = editor.root, world = editor.collisionWorld;
    const desired = (desiredWorld || editor.orbit.target).clone();
    const original = object.position.clone();
    root.updateWorldMatrix(true, true);
    const originalWorld = object.getWorldPosition(new THREE.Vector3());
    const measured = worldBounds(object, root), bounds = measured.box;
    if (bounds.isEmpty()) {
      object.position.copy(object.parent ? object.parent.worldToLocal(desired.clone()) : desired);
      object.updateWorldMatrix(true, true);
      return {position: object.position.clone(), floorY: desired.y, attempts: 1};
    }
    world.refresh();
    const entries = world.entries.filter(entry => !within(entry.object, object));
    const supporters = new Set(entries.filter(entry => maySupport(entry, root)).map(entry => entry.object));
    const occupied = new Map();
    let hasRoomGeometry = false;
    root.traverse(mesh => {
      if (within(mesh, object) || !visibleMesh(mesh, root)) return;
      hasRoomGeometry = true;
      const actor = actorRoot(mesh, root);
      // Floors are support geometry; the hall's walls are still checked using
      // exact triangles below rather than treating the whole room as occupied.
      if (supporters.has(mesh) && actor === mesh) return;
      if (supporters.has(mesh) && !actor.userData.editorDescriptor) return;
      if (maySupport({object: mesh, box: mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld)}, root)) return;
      const part = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      if (!occupied.has(actor)) occupied.set(actor, new THREE.Box3());
      occupied.get(actor).union(part);
    });
    const obstacles = Array.from(occupied.values());
    const emptyRoom = entries.length === 0 && !hasRoomGeometry;
    const points = supportPoints(bounds, measured.parts);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const step = Math.max(0.65, Math.min(1.8, Math.min(size.x, size.z) * 0.55 + CLEARANCE));
    const heading = editor.camera ? editor.camera.getWorldPosition(new THREE.Vector3()).sub(desired) : new THREE.Vector3(0, 0, 1);
    const angle = Math.atan2(heading.z, heading.x);
    const offsets = [new THREE.Vector3()];
    for (let ring = 1; ring <= 8; ring++) for (let index = 0; index < 16; index++) {
      const direction = angle + index * Math.PI / 8;
      offsets.push(new THREE.Vector3(Math.cos(direction) * ring * step, 0, Math.sin(direction) * ring * step));
    }
    let attempts = 0;
    const upward = new THREE.Vector3(), rayPoint = new THREE.Vector3();
    let bottom = desired.y - 4;
    entries.forEach(entry => { bottom = Math.min(bottom, entry.box.min.y - 0.1); });
    const floorAt = (x, z) => {
      const top = desired.y + 0.25;
      const ray = new THREE.Ray(new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0));
      const column = new THREE.Box3(new THREE.Vector3(x - 0.0001, bottom, z - 0.0001), new THREE.Vector3(x + 0.0001, top, z + 0.0001));
      let height = null;
      world.triangles(column, {ignore: [object]}, (triangle, mesh) => {
        if (!supporters.has(mesh) || triangle.getNormal(upward).y < 0.85) return false;
        if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, rayPoint) && rayPoint.y <= top &&
          (height === null || rayPoint.y > height)) height = rayPoint.y;
        return false;
      });
      return height;
    };
    try {
      for (const offset of offsets) {
        attempts++;
        const delta = new THREE.Vector3(desired.x + offset.x - center.x, 0, desired.z + offset.z - center.z);
        const heights = [];
        for (const point of points) {
          const height = emptyRoom ? root.getWorldPosition(new THREE.Vector3()).y : floorAt(point.x + delta.x, point.z + delta.z);
          if (height === null) break;
          heights.push(height);
        }
        if (heights.length !== points.length || Math.max(...heights) - Math.min(...heights) > SUPPORT_TOLERANCE) continue;
        const floorY = Math.max(...heights);
        delta.y = floorY - bounds.min.y;
        const candidate = bounds.clone().translate(delta);
        const clearance = candidate.clone(); clearance.min.x -= CLEARANCE; clearance.max.x += CLEARANCE;
        clearance.min.z -= CLEARANCE; clearance.max.z += CLEARANCE;
        clearance.min.y += CONTACT;
        if (obstacles.some(box => clearance.intersectsBox(box))) continue;
        // Ignore only contact with the support plane. Walls and a higher floor
        // or ceiling inside this volume prevent the placement.
        const blocked = world.triangles(clearance, {ignore: [object]}, triangle => clearance.intersectsTriangle(triangle));
        if (blocked) continue;
        const position = originalWorld.clone().add(delta);
        object.position.copy(object.parent ? object.parent.worldToLocal(position) : position);
        object.updateWorldMatrix(true, true);
        world.invalidate(object);
        return {position: object.position.clone(), floorY, attempts};
      }
      throw new Error('No hay espacio libre sobre el suelo cerca de la vista. Enfoca una zona despejada para añadir el equipo.');
    } catch (error) {
      object.position.copy(original); object.updateWorldMatrix(true, true);
      throw error;
    }
  }
}
