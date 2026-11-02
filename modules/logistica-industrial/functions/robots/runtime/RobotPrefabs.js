import * as THREE from 'three';
import robotSchema from '../schema/robots.js';
import kinematics from '../schema/robot-kinematics.js';

const UP = new THREE.Vector3(0, 1, 0);
const RIG = new WeakMap();
const LABELS = {frame: 'Carcasa y bastidor', accent: 'Protecciones y juntas', metal: 'Acero mecanizado', aluminum: 'Aluminio', rubber: 'Caucho', tool: 'Herramienta', light: 'Indicadores'};

// These small, deterministic maps belong to an independently editable actor.
// No downloaded maps, full CAD tessellation or global GPU cache is required.
function surfaceMap(wear, seed, brushed) {
  const size = 64, data = new Uint8Array(size * size * 4);
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = random(), line = brushed ? .012 * Math.sin(y * 2.6) : 0;
    // Paint is a coating, not a height field of chipped cast iron. The former
    // dark flecks doubled as deep bump pits, even on a nearly new robot.
    const dirt = Math.max(0, Math.sin(x * .17 + Math.cos(y * .23)) - .91) * wear * wear * .16;
    const chip = wear > .5 && n > 1 - (wear - .5) * .006 ? .84 + random() * .08 : 1;
    const value = Math.round(255 * Math.max(.78, (.984 + .016 * n - line - dirt) * chip));
    const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  // Sparse longitudinal tool marks read close up, without additional polygons.
  for (let i = 0; i < Math.floor(wear * wear * 9); i++) {
    const row = Math.floor(random() * size), start = Math.floor(random() * size), length = 3 + Math.floor(random() * 18);
    for (let x = start; x < Math.min(size, start + length); x++) {
      const index = (row * size + x) * 4; data[index] = data[index + 1] = data[index + 2] = 220 + Math.floor(random() * 18);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

// Imported/extruded CAD surfaces often contain independent triangle vertices.
// Smooth only coincident corners inside the manufacturing crease, weighting
// by the corner angle rather than triangle area. The actual positions, index,
// caps and triangle budget remain unchanged; large planar edges stay crisp.
function machinedNormals(geometry, crease = Math.PI * 55 / 180) {
  const position = geometry.attributes.position, index = geometry.index;
  if (!position || index) return;
  const groups = new Map(), corners = [], threshold = Math.cos(crease), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let first = 0; first + 2 < position.count; first += 3) {
    a.fromBufferAttribute(position, first); b.fromBufferAttribute(position, first + 1); c.fromBufferAttribute(position, first + 2);
    const points = [a.clone(), b.clone(), c.clone()], normal = b.clone().sub(a).cross(c.clone().sub(a));
    if (normal.lengthSq() < 1e-20) continue; normal.normalize();
    points.forEach((point, corner) => {
      const u = points[(corner + 1) % 3].clone().sub(point).normalize(), v = points[(corner + 2) % 3].clone().sub(point).normalize();
      const weight = Math.acos(Math.max(-1, Math.min(1, u.dot(v))));
      const key = [point.x, point.y, point.z].map(value => Math.round(value * 1e6)).join(':');
      const value = {index: first + corner, normal, weight, key}; corners.push(value);
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(value);
    });
  }
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const normal = geometry.attributes.normal, sum = new THREE.Vector3();
  corners.forEach(corner => {sum.set(0, 0, 0); groups.get(corner.key).forEach(other => {if (corner.normal.dot(other.normal) >= threshold) sum.addScaledVector(other.normal, other.weight);}); sum.normalize();normal.setXYZ(corner.index, sum.x, sum.y, sum.z);});
  normal.needsUpdate = true; geometry.userData.industrialCreaseAngle = crease;
}

// Rotational symmetry is known exactly. Area-weighted triangle normals put a
// diagonal ripple through shiny circular covers at low tessellation. Derive
// normals from the profile while preserving every existing vertex and face.
function turnedNormals(geometry, profile, segments) {
  const normal = geometry.attributes.normal, count = profile.length;
  for (let row = 0; row < count; row++) {
    const at = profile[row], before = profile[Math.max(0, row - 1)], after = profile[Math.min(count - 1, row + 1)];
    const left = new THREE.Vector2(at[1] - before[1], before[0] - at[0]).normalize();
    const right = new THREE.Vector2(after[1] - at[1], at[0] - after[0]).normalize();
    const n = left.add(right).normalize();
    if (Math.abs(at[0]) < 1e-9) n.set(0, row < count / 2 ? -1 : 1);
    for (let side = 0; side <= segments; side++) {const angle = side / segments * Math.PI * 2;normal.setXYZ(side * count + row, Math.sin(angle) * n.x, n.y, Math.cos(angle) * n.x);}
  }
  normal.needsUpdate = true; geometry.userData.industrialNormalModel = 'turned-profile';
}

function roundedShape(w, h, radius) {
  const shape = new THREE.Shape(), x = -w / 2, y = -h / 2, r = Math.min(radius, w / 2, h / 2);
  shape.moveTo(x + r, y); shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y); return shape;
}

// Tangent, curved castings replace box-shaped links. The long axis is X and
// its two bearing centres remain exactly 0 and length; contour changes never
// move a joint or the mathematical TCP. The smaller distal end also tapers in
// depth, as a manufactured arm housing does around its wrist drive.
function castingShape(length, proximal, distal) {
  const shape = new THREE.Shape();
  shape.moveTo(-proximal, 0);
  shape.bezierCurveTo(-proximal, -proximal * .58, -proximal * .58, -proximal, 0, -proximal);
  shape.bezierCurveTo(length * .26, -proximal * .97, length * .72, -distal * .94, length, -distal);
  shape.bezierCurveTo(length + distal * .58, -distal, length + distal, -distal * .58, length + distal, 0);
  shape.bezierCurveTo(length + distal, distal * .58, length + distal * .58, distal, length, distal);
  shape.bezierCurveTo(length * .68, distal * .96, length * .25, proximal, 0, proximal);
  shape.bezierCurveTo(-proximal * .58, proximal, -proximal, proximal * .58, -proximal, 0);
  return shape;
}

function housingDepth(length, depth, x) { return depth * (1 - .28 * Math.max(0, Math.min(1, x / Math.max(.001, length)))); }

function volumeSections(length, proximal, distal, depth) {
  // x, half-height, half-depth, vertical centre, lateral centre. Curved front
  // and rear faces are essential: a bevel around a flat extrusion still reads
  // as an excavator plate when seen from a working cell.
  return [
    [-proximal, 0, 0, 0, 0], [-proximal * .86, proximal * .50, depth * .25, 0, 0],
    [-proximal * .50, proximal * .84, depth * .43, 0, 0], [0, proximal, depth * .50, 0, 0],
    [length * .14, proximal * .88, depth * .56, proximal * .035, depth * .035],
    [length * .38, proximal * .68 + distal * .07, depth * .52, proximal * .065, depth * .08],
    [length * .68, proximal * .44 + distal * .30, depth * .43, proximal * .045, depth * .09],
    [length * .90, distal * .98, depth * .37, distal * .025, depth * .025],
    [length, distal, depth * .36, 0, 0], [length + distal * .55, distal * .82, depth * .28, 0, 0],
    [length + distal * .86, distal * .48, depth * .15, 0, 0], [length + distal, 0, 0, 0, 0]
  ];
}

function volumeSurface(sections, x, y, side, exponent = .8) {
  const index = Math.max(0, Math.min(sections.length - 2, sections.findIndex((section, i) => i + 1 < sections.length && sections[i + 1][0] >= x)));
  const a = sections[index], b = sections[index + 1], t = Math.max(0, Math.min(1, (x - a[0]) / Math.max(.0001, b[0] - a[0])));
  const at = i => a[i] + (b[i] - a[i]) * t;
  const fraction = Math.min(.999, Math.abs((y - at(3)) / Math.max(.0001, at(1))));
  const power = 2 / exponent;
  return at(4) + side * at(2) * Math.pow(1 - Math.pow(fraction, power), 1 / power);
}

function builder(config) {
  const geometries = new Map(), surfaces = new Map();
  const segments = config.detail === 'low' ? 10 : config.detail === 'high' ? 22 : 16;
  const steelFinish = config.finish === 'steel' || config.finish === 'aluminum';
  const material = role => {
    if (!surfaces.has(role)) {
      const color = role === 'frame' ? config.frameColor : role === 'accent' ? config.accentColor : role === 'tool' ? config.toolColor : role === 'rubber' ? '#252b2e' : role === 'light' ? '#4ff2a6' : role === 'aluminum' ? '#b5c0c7' : '#909ba2';
      const metal = role === 'metal' || role === 'aluminum' || role === 'tool' || role === 'frame' && steelFinish;
      const surface = new THREE.MeshStandardMaterial({color, roughness: role === 'rubber' ? .84 : metal ? .25 + config.wear * .16 : role === 'accent' ? .39 + config.wear * .08 : .30 + config.wear * .12,
        metalness: role === 'rubber' || role === 'light' ? 0 : metal ? .86 : config.finish === 'polymer' ? .03 : role === 'accent' ? .22 : .12});
      surface.name = 'Robot · ' + LABELS[role]; surface.userData.industrialSurfaceName = surface.name;
      surface.color.convertSRGBToLinear(); surface.userData.studioColorSpace = 'linear';
      surface.userData.industrialMaterialRole = role;
      surface.userData.industrialManufacturedFinish = true;
      surface.userData.industrialPaintWear = config.wear;
      if (role !== 'light' && role !== 'rubber') {
        surface.map = surfaceMap(config.wear, role.length * 617 + 41, metal); surface.bumpMap = surface.map;
        surface.bumpScale = metal ? .00022 : .00010 + config.wear * .00015;
      }
      if (role === 'light') { surface.emissive.set(color); surface.emissiveIntensity = .6; }
      surfaces.set(role, surface);
    }
    return surfaces.get(role);
  };
  const geometry = (type, args) => {
    const key = type + JSON.stringify(args);
    if (!geometries.has(key)) {
      let result;
      if (type === 'box') result = new THREE.BoxBufferGeometry(...args);
      if (type === 'cylinder') result = new THREE.CylinderBufferGeometry(args[0], args[1], args[2], args[3] || segments);
      if (type === 'lathe') {result = new THREE.LatheBufferGeometry(args[0].map(p => new THREE.Vector2(p[0], p[1])), args[1] || segments);turnedNormals(result, args[0], args[1] || segments);}
      if (type === 'casting') {
        const [length, proximal, distal, depth] = args;
        const bevel = Math.min(Math.max(config.filletRadius * .38, config.chamferSize), depth * .18, distal * .30);
        result = new THREE.ExtrudeBufferGeometry(castingShape(length, proximal - bevel, distal - bevel), {
          depth: Math.max(.001, depth - 2 * bevel), steps: 1, curveSegments: config.detail === 'low' ? 3 : config.detail === 'high' ? 6 : 4,
          bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: config.detail === 'high' ? 2 : 1
        });
        result.translate(0, 0, -depth / 2 + bevel);
        const position = result.attributes.position;
        for (let index = 0; index < position.count; index++) position.setZ(index, position.getZ(index) * housingDepth(length, 1, position.getX(index)));
        result.computeVertexNormals();
        result.userData = {robotCasting: {length, proximal, distal, depth, bevel}};
        machinedNormals(result);
      }
      if (type === 'volume') {
        const [length, proximal, distal, depth] = args, sections = volumeSections(length, proximal, distal, depth);
        const around = config.detail === 'low' ? 12 : config.detail === 'high' ? 24 : 18;
        const vertices = [], uv = [], indices = [];
        const exponent = Math.max(.6, Math.min(1, .6 + config.filletRadius / Math.max(.02, Math.min(proximal, depth / 2)) * .9));
        sections.forEach((section, ring) => {
          for (let side = 0; side <= around; side++) {
            const angle = side / around * Math.PI * 2, sine = Math.sin(angle), cosine = Math.cos(angle);
            vertices.push(section[0], section[3] + section[1] * Math.sign(sine) * Math.pow(Math.abs(sine), exponent),
              section[4] + section[2] * Math.sign(cosine) * Math.pow(Math.abs(cosine), exponent));
            uv.push((section[0] + proximal) / (length + proximal + distal), side / around);
            if (ring && side < around) {
              const current = ring * (around + 1) + side, previous = current - around - 1;
              // Avoid coincident-pole triangles while closing the cast ends.
              if (ring > 1) indices.push(previous, current, previous + 1);
              if (ring < sections.length - 1) indices.push(previous + 1, current, current + 1);
            }
          }
        });
        result = new THREE.BufferGeometry(); result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        result.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); result.setIndex(indices); result.computeVertexNormals();
        // A continuous section gradient removes the diagonal shading facets
        // caused by triangle-area averaging. This changes only the lighting
        // field: all collision vertices and manufacturing dimensions remain.
        const normal = result.attributes.normal;
        sections.forEach((section, ring) => {
          const a = ring * (around + 1), b = a + around;
          if (ring === 0 || ring === sections.length - 1) {
            for (let side = 0; side <= around; side++) normal.setXYZ(a + side, ring === 0 ? -1 : 1, 0, 0);
            return;
          }
          const before = sections[ring - 1], after = sections[ring + 1], slope = key => ((section[key] - before[key]) / (section[0] - before[0]) + (after[key] - section[key]) / (after[0] - section[0])) / 2;
          const hy = slope(1), hz = slope(2), cy = slope(3), cz = slope(4), power = 2 / exponent;
          for (let side = 0; side <= around; side++) {
            const angle = side / around * Math.PI * 2, sine = Math.abs(Math.sin(angle)) < 1e-10 ? 0 : Math.sin(angle), cosine = Math.abs(Math.cos(angle)) < 1e-10 ? 0 : Math.cos(angle);
            const y = Math.sign(sine) * Math.pow(Math.abs(sine), exponent), z = Math.sign(cosine) * Math.pow(Math.abs(cosine), exponent);
            const ny = Math.sign(y) * Math.pow(Math.abs(y), power - 1) / section[1], nz = Math.sign(z) * Math.pow(Math.abs(z), power - 1) / section[2];
            const n = new THREE.Vector3(-ny * (cy + hy * y) - nz * (cz + hz * z), ny, nz).normalize();
            normal.setXYZ(a + side, n.x, n.y, n.z);
          }
        });
        normal.needsUpdate = true;
        result.userData = {robotCasting: {length, proximal, distal, depth, bevel: Math.min(config.filletRadius, depth * .18), exponent, volumetric: true, sections}, industrialNormalModel: 'manufactured-section-gradient'};
      }
      if (type === 'footprint') {
        const [length, width, height, radius] = args, bevel = Math.min(config.chamferSize, height * .15);
        result = new THREE.ExtrudeBufferGeometry(roundedShape(length - bevel * 2, width - bevel * 2, radius), {
          depth: height - bevel * 2, steps: 1, curveSegments: config.detail === 'low' ? 3 : 5,
          bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: config.detail === 'high' ? 2 : 1
        });
        result.translate(0, 0, -height / 2 + bevel); result.rotateX(Math.PI / 2);
        machinedNormals(result);
      }
      if (type === 'round') {
        const [w, h, depth] = args, bevel = Math.min(config.chamferSize, Math.min(w, h, depth) * .16);
        const radius = Math.min(config.filletRadius, Math.min(w, h) * .45);
        result = new THREE.ExtrudeBufferGeometry(roundedShape(w - 2 * bevel, h - 2 * bevel, radius), {depth: Math.max(.001, depth - 2 * bevel), steps: 1,
          curveSegments: config.detail === 'high' ? 4 : 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: config.detail === 'high' ? 2 : 1});
        result.translate(0, 0, -depth / 2 + bevel);
        machinedNormals(result);
      }
      geometries.set(key, result);
    }
    return geometries.get(key);
  };
  const mesh = (name, shape, role, parent, position, rotation) => {
    const object = new THREE.Mesh(shape, material(role)); object.name = name;
    object.userData.industrialPart = name; object.userData.industrialMaterialRole = role;
    object.castShadow = object.receiveShadow = true;
    if (position) object.position.fromArray(position); if (rotation) object.rotation.set(...rotation);
    if (parent) parent.add(object); return object;
  };
  const box = (name, size, role, parent, position, round = false) => mesh(name, geometry(round ? 'round' : 'box', size), role, parent, position);
  const casting = (name, dimensions, role, parent, position) => {
    const object = mesh(name, geometry('casting', dimensions), role, parent, position);
    object.userData.robotContouredHousing = true; return object;
  };
  const housing = (name, dimensions, role, parent, position) => {
    const object = mesh(name, geometry('volume', dimensions), role, parent, position);
    object.userData.robotContouredHousing = true; return object;
  };
  const cylinder = (name, radius, length, role, parent, position, rotation, topRadius) => mesh(name, geometry('cylinder', [topRadius === undefined ? radius : topRadius, radius, length, segments]), role, parent, position, rotation);
  const rod = (name, a, b, radius, role, parent) => {
    const start = new THREE.Vector3().fromArray(a), end = new THREE.Vector3().fromArray(b), direction = end.clone().sub(start);
    const object = cylinder(name, radius, direction.length(), role, parent, start.add(end).multiplyScalar(.5).toArray());
    object.quaternion.setFromUnitVectors(UP, direction.normalize()); return object;
  };
  const bolts = (parent, points, radius = .014, along = 'z') => {
    if (!points.length || config.detail === 'low') return;
    const object = new THREE.InstancedMesh(geometry('cylinder', [radius, radius, radius * .7, 6]), material('metal'), points.length);
    object.name = 'Tornillos hexagonales · ' + parent.name; object.userData.industrialCosmeticDetail = true; object.userData.robotHardware = true;
    object.userData.industrialMaterialRole = 'metal'; object.castShadow = true; object.receiveShadow = true;
    const dummy = new THREE.Object3D();
    points.forEach((p, i) => { dummy.position.fromArray(p); dummy.rotation.set(along === 'z' ? Math.PI / 2 : 0, 0, along === 'x' ? -Math.PI / 2 : 0); dummy.updateMatrix(); object.setMatrixAt(i, dummy.matrix); });
    object.instanceMatrix.needsUpdate = true; parent.add(object); return object;
  };
  const boltRing = (parent, r, z, count = 6) => bolts(parent, Array.from({length: count}, (_, i) => [Math.cos(i / count * Math.PI * 2) * r, Math.sin(i / count * Math.PI * 2) * r, z]), Math.max(.006, Math.min(.016, r * .1)));
  const cable = (parent, points, radius = .013, name = 'Manguera de servicio') => {
    if (config.detail === 'low') return;
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3().fromArray(p)));
    const object = mesh(name, new THREE.TubeBufferGeometry(path, config.detail === 'high' ? 16 : 10, radius, 5, false), 'rubber', parent);
    object.userData.industrialCosmeticDetail = true; return object;
  };
  return {config, segments, geometry, material, mesh, box, casting, housing, cylinder, rod, bolts, boltRing, cable};
}

function group(parent, name, position) {
  const object = new THREE.Group(); object.name = name; if (position) object.position.fromArray(position); parent.add(object); return object;
}
function joint(parent, id, position, rig) {
  const object = group(parent, id + ' · articulación', position); object.userData.robotJoint = id; rig.joints.push(object); return object;
}

function componentIdentity(rig) {
  const names = {'robot.base': 'Base y alimentación', 'robot.shoulder': 'Giro y apoyo del hombro', 'robot.upper-arm': 'Brazo superior', 'robot.elbow': 'Codo', 'robot.forearm': 'Antebrazo', 'robot.wrist': 'Muñeca orientable', 'robot.tool': 'Herramienta y TCP', 'robot.carriage': 'Guías y accionamiento lineal', 'robot.bearings':'Tornillería y rodamientos', 'robot.harness':'Arnés de potencia y encoder', 'robot.tool-services':'Suministro de herramienta', 'robot.base-services':'Alimentación desde consola'};
  const groups = new Map();
  rig.visual.traverse(object => {
    if (!object.isMesh) return;
    let node = object, jointId = '', inTool = false, inBase = false;
    for (; node && node !== rig.visual; node = node.parent) {
      if (node === rig.toolAssembly) inTool = true;
      if (node.name === 'Base anclada al piso') inBase = true;
      if (!jointId && node.userData.robotJoint) jointId = node.userData.robotJoint;
    }
    let id = object.userData.robotComponentId || (inTool ? 'robot.tool' : inBase ? 'robot.base' : jointId === 'J1' ? 'robot.shoulder' : jointId === 'J2' ? 'robot.upper-arm' : jointId === 'J3' ? 'robot.forearm' : /^J[456]$/.test(jointId) ? 'robot.wrist' : 'robot.carriage');
    if (/Eje pasante|Oreja de apoyo/.test(object.name)) id = 'robot.shoulder';
    if (/Reductor|Tapa mecanizada|Servomotor/.test(object.name) && jointId === 'J3') id = 'robot.elbow';
    object.userData.equipmentComponentId = id;
    object.userData.robotJointId = jointId;
    object.userData.equipmentSubsystem = object.userData.equipmentSubsystem || (/encoder|Conector|conexiones|prensaestopas|Indicador/i.test(object.name) ? 'electronics' : /Manguera|racor/.test(object.name) ? 'services' : 'mechanical');
    if (!groups.has(id)) groups.set(id, {id, name: names[id], jointIds: [], objects: []});
    const entry = groups.get(id); entry.objects.push(object);
    if (jointId && !entry.jointIds.includes(jointId)) entry.jointIds.push(jointId);
  });
  rig.components = Array.from(groups.values());
}
function hinge(b, parent, radius, length, axis = 'z', painted = false) {
  const rotation = axis === 'z' ? [Math.PI / 2, 0, 0] : axis === 'x' ? [0, 0, Math.PI / 2] : [0, 0, 0];
  const edge = Math.min(.012, length * .12), profile = [[0, -length / 2], [radius * .83, -length / 2], [radius, -length / 2 + edge], [radius, length / 2 - edge], [radius * .83, length / 2], [0, length / 2]];
  b.mesh('Reductor de precisión', b.geometry('lathe', [profile]), painted ? 'frame' : 'accent', parent, [0, 0, 0], rotation);
  b.cylinder('Tapa mecanizada del reductor', radius * (painted ? .68 : .80), .022, painted ? 'accent' : 'metal', parent,
    axis === 'z' ? [0, 0, length / 2 + .006] : axis === 'x' ? [length / 2 + .006, 0, 0] : [0, length / 2 + .006, 0], rotation);
  if (axis === 'z') {
    b.boltRing(parent, radius * .62, length / 2 + .022);
    const motorLength = radius * .95;
    const motorProfile = [[0, -motorLength / 2], [radius * .43, -motorLength / 2], [radius * .60, -motorLength * .31],
      [radius * .68, -motorLength * .06], [radius * .67, motorLength * .23], [radius * .52, motorLength / 2], [0, motorLength / 2]];
    b.mesh('Servomotor y freno integrado', b.geometry('lathe', [motorProfile]), painted ? 'frame' : 'accent', parent, [0, 0, -length / 2 - radius * .35], rotation);
    if (b.config.detail !== 'low') {
      const fins = new THREE.InstancedMesh(b.geometry('cylinder', [radius * .69, radius * .69, .007, b.segments]), b.material('metal'), 5);
      fins.name = 'Aletas de refrigeración del servomotor'; fins.userData.industrialCosmeticDetail = true; fins.userData.industrialMaterialRole = 'metal';
      const dummy = new THREE.Object3D(); dummy.rotation.x = Math.PI / 2;
      for (let i = 0; i < 5; i++) { dummy.position.set(0, 0, -length / 2 - radius * (.12 + i * .13)); dummy.updateMatrix(); fins.setMatrixAt(i, dummy.matrix); }
      fins.castShadow = fins.receiveShadow = true; parent.add(fins);
      b.box('Conector industrial del encoder', [radius * .48, radius * .25, radius * .35], 'rubber', parent, [0, -radius * .65, -length / 2 - radius * .6], true);
    }
  }
}
function pedestal(b, rig, d) {
  const collaborative = b.config.variant === 'collaborative';
  const radius = Math.max(.10, Math.min(.34, d.reach * (collaborative ? .075 : .13))), mount = b.config.family === 'mobileManipulator' ? b.config.height + .025 : 0, height = Math.max(.08, d.baseHeight - mount);
  const base = group(rig.visual, 'Base anclada al piso');
  base.position.y = mount;
  const plate = b.box('Placa base achaflanada', [radius * 2.8, .05, radius * 2.8], 'metal', base, [0, .025, 0], true);
  // Four actual mounting apertures are cut only in this small, selected CAD
  // piece. Ordinary fittings use economical primitives and bolt instances.
  if (b.config.mountingHoles && b.config.detail !== 'low') {
    const shape = roundedShape(radius * 2.8, radius * 2.8, Math.min(.035, b.config.filletRadius));
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const hole = new THREE.Path(); hole.absarc(x * radius, z * radius, .018, 0, Math.PI * 2, true); shape.holes.push(hole);
    }
    const old = plate.geometry; plate.geometry = new THREE.ExtrudeBufferGeometry(shape, {depth: .05, bevelEnabled: false, curveSegments: 6});
    plate.geometry.rotateX(Math.PI / 2); plate.geometry.translate(0, .025, 0);
    old.dispose();
  }
  const castingHeight = Math.max(.04, height - .05), profile = [
    [0, 0], [radius * 1.17, 0], [radius * 1.21, castingHeight * .08], [radius * 1.18, castingHeight * .27],
    [radius * 1.07, castingHeight * .68], [radius * .96, castingHeight * .85], [radius * .83, castingHeight * .96], [radius * .78, castingHeight], [0, castingHeight]
  ];
  const support = b.mesh('Zócalo perfilado de fundición', b.geometry('lathe', [profile]), 'frame', base, [0, .05, 0]);
  support.userData.robotContouredHousing = true;
  b.cylinder('Corona de giro J1', radius * .81, .07, 'metal', base, [0, height, 0]);
  b.bolts(base, [-1, 1].flatMap(x => [-1, 1].map(z => [x * radius, .057, z * radius])), .024, 'y');
  b.box('Caja de conexiones y prensaestopas', [radius * 1.2, height * .3, radius * .38], 'accent', base, [0, height * .43, -radius], true);
  base.userData.industrialStickerAnchors = [
    {id: 'equipment-id', position: [0, .025, radius * 1.4], normal: [0, 0, 1], size: [radius * 1.7, .031]},
    {id: 'electrical', position: [0, height * .43, -radius * 1.19], normal: [0, 0, -1], size: [Math.min(.10, radius * .6), Math.min(.10, height * .21)]}
  ];
  return radius;
}
function link(b, parent, length, thickness, name, distal = false) {
  const proximal = thickness * (distal ? .78 : .94), tip = thickness * (distal ? .42 : .66), depth = thickness * (distal ? 1.35 : 1.62);
  const shell = b.housing(name + ' · carcasa perfilada de fundición', [length, proximal, tip, depth], 'frame', parent);
  const sections = shell.geometry.userData.robotCasting.sections, exponent = shell.geometry.userData.robotCasting.exponent;
  const surface = (x, y, side) => volumeSurface(sections, x, y, side, exponent), back = (x, y = 0) => surface(x, y, -1);
  // A service cover follows the same tapered back surface rather than lying
  // in a constant-Z plane and separating from the housing at its narrow end.
  const coverLength = length * .42, coverStart = length * .25;
  const cover = b.casting(name + ' · tapa de servicio conformada', [coverLength, thickness * .20, thickness * .14, .012], 'accent', parent, [coverStart, 0, 0]);
  const vertices = cover.geometry.attributes.position;
  // The builder owns one independently disposable casting geometry per shape.
  for (let index = 0; index < vertices.count; index++) vertices.setZ(index, vertices.getZ(index) + back(vertices.getX(index) + coverStart, vertices.getY(index)) - .001);
  cover.geometry.computeVertexNormals(); machinedNormals(cover.geometry);
  b.bolts(parent, [.20, .72].flatMap(x => [-1, 1].map(y => [length * x, thickness * .36 * y, surface(length * x, thickness * .36 * y, 1) + .004])), thickness * .046);
  const start = length * .12, end = length * .86;
  for (const x of [start, end]) b.cylinder(name + ' · racor sellado de cable', thickness * .105, thickness * .14, 'metal', parent, [x, 0, back(x) - thickness * .035], [Math.PI / 2, 0, 0]);
  b.cable(parent, [[start, 0, back(start) - thickness * .11], [length * .28, thickness * .35, back(length * .28) - thickness * .16],
    [length * .67, thickness * .29, back(length * .67) - thickness * .16], [end, 0, back(end) - thickness * .11]], thickness * .055, name + ' · manguera guiada');
  shell.userData.industrialStickerAnchors = [
    {id: distal ? 'equipment-id' : 'warning-pinch', position: [length * .40, 0, surface(length * .40, 0, 1)], normal: [0, 0, 1], size: [Math.min(length * .22, .15), Math.min(thickness * .56, .075)]}
  ];
  return shell;
}

function attachCatalogueTool(b,assembly,rig,dimensions){
  if(!b.config.catalogueToolId)return false;
  const catalog=require('../../equipamiento/schema/equipmentCatalog.cjs'),definition=catalog.definition(b.config.catalogueToolId);
  if(!definition||definition.operationLevel!=='attachment')throw new Error('La seleccion no es una herramienta acoplable.');
  rig.catalogueTool={id:definition.id,mechanism:definition.mechanism,style:b.config.tool==='fork'?'support':b.config.tool};
  // Native fork geometry already matches its actual support plane, pallet
  // depth/rear clearance and structural adapter. A tiny generic EOAT fork
  // cannot replace this operational support just to change its silhouette.
  if(b.config.tool==='fork')return false;
  const cfg=catalog.normalize(definition.id,{frameColor:b.config.accentColor,accentColor:b.config.frameColor,wear:b.config.wear,detail:b.config.detail}),layout=catalog.layout(definition.id,cfg);
  const visual=require('../../equipamiento/runtime/EquipmentGeometry.cjs').createEquipmentGeometry(definition,cfg,{THREE,layout}),frame=visual&&visual.userData.robotCatalogueToolFrame;
  if(!visual||!frame||!frame.contact||frame.contact[1]>=-.001)throw new Error('La herramienta necesita marcos reales de brida y contacto.');
  const flangeX=(rig.pilotFlangeEnd||.015)-dimensions.toolLength,depth=-frame.contact[1],approachLength=-flangeX;
  // Catalogue coordinates: -Y approaches the load, X spans the jaws. Native
  // coordinates: +X approaches the load and Z spans the jaws. This rigid frame
  // conversion leaves the robot's real TCP and every joint transform intact.
  visual.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2));
  visual.scale.set(1,approachLength/depth,1);visual.position.set(flangeX,frame.contact[2],-frame.contact[0]);
  visual.name='Herramienta nativa de catalogo · '+definition.title;visual.userData.robotCatalogueAttachment=true;assembly.add(visual);
  const fingers=[],guides=[];visual.traverse(node=>{
    if(node.userData.catalogueFinger)fingers.push(node);
    if(node.userData.catalogueJawGuide)guides.push(node);
    if(!node.isMesh)return;node.userData.catalogueToolComponentId=node.userData.equipmentComponentId;
    if(node.userData.equipmentPartRole==='surface'||node.parent&&['surface','contact-pad'].includes(node.parent.userData.equipmentPartRole)){
      node.userData.robotContactSurface=b.config.tool==='vacuum'?'vacuum':b.config.tool==='process'?'process':'jaw';rig.toolContactSurfaces.push(node);
    }
  });
  rig.fingers=fingers;rig.catalogueTool.geometry=visual;rig.catalogueTool.mount=[flangeX,0,0];rig.catalogueTool.contact=[0,0,0];rig.catalogueTool.style=frame.style;
  rig.catalogueToolSync=(span,opening)=>{const radius=span/2+.014+opening*.055;fingers.forEach(finger=>{const data=finger.userData.catalogueFinger,delta=radius-(data.radius*.86-data.padHalf);finger.position.set(data.direction[0]*delta,0,data.direction[1]*delta);});guides.forEach(guide=>{guide.scale.x=guide.userData.catalogueJawGuide==='radial'?radius+.11:radius*2+.15;});};
  return true;
}

function tool(b, parent, rig) {
  // The local +X axis is the tool approach axis. Vacuum lips and finger tips
  // end at TCP x=0; the parallel gripper grips with side pads behind its tips.
  const dimensions=kinematics.getDimensions(b.config),assembly = group(parent, 'Efector final · ' + b.config.tool, dimensions.toolOffset||[dimensions.toolLength,0,0]); rig.toolAssembly = assembly;
  assembly.userData.robotToolAssembly = true;
  assembly.userData.robotToolMount={offset:dimensions.toolOffset||[dimensions.toolLength,0,0],support:dimensions.toolSupport};
  const contact = (mesh, kind) => {mesh.userData.robotContactSurface = kind; rig.toolContactSurfaces.push(mesh); return mesh;};
  rig.tool = group(assembly, 'TCP · punto de contacto'); rig.tool.userData.robotToolAnchor = true;
  if(attachCatalogueTool(b,assembly,rig,dimensions))return assembly;
  if (b.config.tool === 'platform') {
    const supported=dimensions.toolSupport,long = supported?supported.depth+.10:Math.min(b.config.length * .78, 1.3), wide = supported?supported.width+.10:Math.min(b.config.width * .82, 1.1);
    contact(b.box('Cubierta antideslizante de transferencia', [.045, long, wide], 'rubber', assembly, [.026, 0, 0], true), 'support');
    b.bolts(assembly, [-1, 1].flatMap(y => [-1, 1].map(z => [.003, y * long * .4, z * wide * .4])), .011, 'x');
    if(supported){
      const back=dimensions.toolOffset[1],start=(rig.pilotFlangeEnd||.055)-dimensions.toolLength,end=.0965;
      b.box('Adaptador posterior de plataforma',[end-start,.072,.09],'metal',assembly,[(start+end)/2,-back,0],true);
      b.box('Travesaño bajo plataforma',[.048,back+.04,.12],'tool',assembly,[.0725,-back/2,0],true);
      b.box('Placa inferior de plataforma',[.018,long*.82,wide*.78],'metal',assembly,[.0575,0,0],true);
    }
  } else if (b.config.tool === 'fork') {
    // Tool +X points down in a transport posture. Both horizontal tines have
    // their upper support faces at the TCP plane x=0, below the load.
    const supported=dimensions.toolSupport,back=supported?dimensions.toolOffset[1]:.28,spread=supported?Math.min(.32,supported.width*.24):.18,front=supported?supported.depth/2+.04:.33;
    b.box('Portahorquillas', [.34, .075, supported?spread*2+.13:.55], 'tool', assembly, [.14, -back, 0], true);
    for (const z of [-spread, spread]) {
      b.box('Talón de horquilla', [.24, .07, .065], 'metal', assembly, [.12, -back+.04, z]);
      contact(b.box('Horquilla mecanizada', [.035, supported?back+front:.62, .065], 'metal', assembly, [.0175, supported?(front-back)/2:.02, z], true), 'support');
    }
    if(supported){const start=(rig.pilotFlangeEnd||.055)-dimensions.toolLength,end=-.03;b.box('Adaptador estructural de horquillas',[end-start,.07,.11],'metal',assembly,[(start+end)/2,-back,0],true);}
  } else if (b.config.tool === 'vacuum') {
    // The adapter meets the ISO flange, collector and suction stems; no
    // floating manifold. Flexible cup lips terminate on the mathematical TCP.
    b.cylinder('Adaptador de brida del colector', .041, .07, 'metal', assembly, [-.18, 0, 0], [0, 0, Math.PI / 2]);
    b.box('Colector de vacío', [.065, .26, .26], 'tool', assembly, [-.14, 0, 0], true);
    for (const y of [-.08, .08]) for (const z of [-.08, .08]) {
      b.cylinder('Vástago de ventosa', .012, .07, 'metal', assembly, [-.075, y, z], [0, 0, Math.PI / 2]);
      const bellows = [[0, -.04], [.019, -.04], [.025, -.034], [.02, -.028], [.029, -.022], [.023, -.016], [.034, -.008], [.034, 0], [.027, 0], [.012, -.026]];
      contact(b.mesh('Fuelle de ventosa', b.geometry('lathe', [bellows]), 'rubber', assembly, [0, y, z], [0, 0, -Math.PI / 2]), 'vacuum');
    }
    b.cable(assembly, [[-.17, .13, 0], [-.24, .17, .05], [-.24, -.02, .09]], .008, 'Tubo neumático de vacío');
  } else if (b.config.tool === 'process') {
    b.cylinder('Carcasa de husillo / proceso', .055, .17, 'tool', assembly, [-.13, 0, 0], [0, 0, Math.PI / 2]);
    contact(b.cylinder('Boquilla de proceso', .012, .045, 'metal', assembly, [-.0225, 0, 0], [0, 0, Math.PI / 2], .004), 'process');
    b.cable(assembly, [[-.19, .045, 0], [-.27, .12, 0], [-.32, .02, 0]], .012);
  } else {
    b.box('Actuador de pinza paralela', [.11, .16, .16], 'tool', assembly, [-.15, 0, 0], true);
    rig.gripperRail = b.box('Guía telescópica de las mordazas', [.055, .065, 1], 'metal', assembly, [-.13, 0, 0], true);
    rig.fingers = [-1, 1].map(sign => {
      const finger = group(assembly, 'Mordaza ' + (sign < 0 ? 'izquierda' : 'derecha'), [0, 0, sign * .065]);
      finger.userData.robotFingerSign = sign;
      b.box('Dedo de agarre mecanizado', [.12, .045, .026], 'metal', finger, [-.06, 0, 0], true);
      contact(b.box('Superficie de contacto', [.055, .044, .012], 'rubber', finger, [-.028, 0, -sign * .015]), 'jaw');
      return finger;
    });
  }
  return assembly;
}

function pilotAccessories(b,rig,d,skins,parents,cross) {
  const c=b.config;
  const hose=(parent,points,radius,name)=>{
    if(c.detail!=='low')return b.cable(parent,points,radius,name);
    const curve=new THREE.CatmullRomCurve3(points.map(point=>new THREE.Vector3().fromArray(point)));
    return b.mesh(name,new THREE.TubeBufferGeometry(curve,8,radius,4,false),'rubber',parent);
  };
  const meshes=link=>(skins[link]||[]),hit=(link,x,y,side=-1)=>{
    const ray=new THREE.Raycaster(new THREE.Vector3(x,y,side*2*cross),new THREE.Vector3(0,0,-side),0,4*cross);
    // Before posing, skins are in their own native link coordinates. A small
    // temporary mesh avoids applying the parent articulation twice to a ray.
    const targets=meshes(link).map(skin=>{skin.updateMatrix();const target=new THREE.Mesh(skin.geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));target.matrixAutoUpdate=false;target.matrix.copy(skin.matrix);return target;});
    targets.forEach(o=>o.updateMatrixWorld(true));const value=ray.intersectObjects(targets,false)[0];targets.forEach(o=>o.material.dispose());
    if(value)value.point.robotSurface=meshes(link)[targets.indexOf(value.object)];return value&&value.point;
  };
  // Material groups cover the actual CAD triangles, never a duplicate shell.
  // Coaxial covers and drive housings remain distinct from painted castings.
  for(const [link,rows] of Object.entries(skins))for(const mesh of rows){
    if(mesh.material.userData.industrialMaterialRole!=='frame')continue;
    const geometry=mesh.geometry,p=geometry.attributes.position,n=geometry.attributes.normal;
    const role=mesh.userData.robotAssemblyPart?mesh.material.userData.industrialMaterialRole:/neutral fitted service cover/.test(geometry.userData.sourcePart||'')?'accent':link==='link_3'||link==='link_5'?'accent':'frame';
    // Colouring a curved cap by a face-normal threshold leaves a saw-tooth
    // boundary. Keep connected castings coherent; real perimeter seals and
    // fitted fasteners provide joint contrast without cutting painted faces.
    mesh.material=b.material(role);mesh.userData.industrialMaterialRole=role;
    // Worn edges use the existing native PBR material and wear control. The
    // small vertex tint is concentrated at exposed lips/covers, not giant
    // random black islands or a second coplanar painted surface.
    const colors=new Float32Array(p.count*3);
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),edge=Math.pow(Math.max(Math.abs(n.getX(i)),Math.abs(n.getY(i))),8);
      const grain=(Math.sin(x*713+y*419+z*971)*43758.5453)%1,wear=c.wear*edge*(grain>.50?.22:.035),shade=1-wear;
      colors.set([shade,shade,shade],i*3);
    }
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));mesh.material.vertexColors=true;mesh.material.userData.industrialPaintWear=c.wear;
    mesh.userData.robotSurfaceRole=role;
  }
  const attachLabel=(link,x,y,side,id,width,height)=>{const at=hit(link,x,y,side);if(!at)return;const host=at.robotSurface;if(!host)return;
    const inverse=new THREE.Matrix4().getInverse(host.matrix),point=at.clone().applyMatrix4(inverse),normal=new THREE.Vector3(0,0,side).transformDirection(inverse);
    (host.userData.industrialStickerAnchors||(host.userData.industrialStickerAnchors=[])).push({id,position:point.toArray(),normal:normal.toArray(),size:[width,height]});};
  if(c.identificationLabels){
    attachLabel('link_2',d.upperArm*.43,0,1,'equipment-id',Math.min(.18,d.upperArm*.28),.045*cross);
    attachLabel('link_2',d.upperArm*.20,-.018*cross,1,'warning-pinch',.055*cross,.05*cross);
    attachLabel('link_4',-d.forearm*.18,.008*cross,-1,'electrical',.045*cross,.045*cross);
    attachLabel('base_link',-.18*cross,.11,-1,'electrical',.045*cross,.055);
  }
  const tag=(object,id,subsystem)=>{if(!object)return;object.userData.robotComponentId=id;object.userData.robotAccessory=true;object.userData.equipmentSubsystem=subsystem;object.userData.industrialCosmeticDetail=true;};
  if(c.jointCovers&&c.detail!=='low')for(const row of [{link:'link_2',parent:parents.shoulder,x:0,r:.055*cross},{link:'link_2',parent:parents.shoulder,x:d.upperArm,r:.041*cross},{link:'link_3',parent:parents.elbow,x:0,r:.046*cross}]){
    const points=[];for(let i=0;i<8;i++){const angle=i*Math.PI/4,at=hit(row.link,row.x+Math.cos(angle)*row.r,Math.sin(angle)*row.r,1);if(at){at.z+=.0025*cross;points.push(at.toArray());}}
    const bolts=b.bolts(row.parent,points,.0037*cross);if(bolts){bolts.name='Tornillería de tapa y reductor · '+row.link;tag(bolts,'robot.bearings','mechanical');}
    const seal=[];for(let i=0;i<=24;i++){const angle=i/24*Math.PI*2,at=hit(row.link,row.x+Math.cos(angle)*row.r*1.16,Math.sin(angle)*row.r*1.16,1);if(at){at.z+=.0016*cross;seal.push(at.toArray());}}
    if(seal.length===25){const ring=hose(row.parent,seal,.0018*cross,'Sello perimetral ajustado · '+row.link);tag(ring,'robot.bearings','mechanical');}
  }
  rig.serviceSockets=[];rig.serviceCables=[];
  const socket=(parent,link,x,y,name,id='robot.harness')=>{
    const at=hit(link,x,y,-1);if(!at)return null;
    const port=group(parent,name,at.toArray()),length=.020*cross;
    const fitting=b.cylinder('Prensaestopas · '+name,.012*cross,length,'metal',port,[0,0,-length/2],[Math.PI/2,0,0]);tag(fitting,id,'services');
    const seal=b.cylinder('Sello · '+name,.014*cross,.005*cross,'rubber',port,[0,0,-.002*cross],[Math.PI/2,0,0]);tag(seal,id,'services');
    port.userData.robotServiceSocket=true;port.userData.robotComponentId=id;rig.serviceSockets.push(port);
    return {object:port,point:new THREE.Vector3(0,0,-length)};
  };
  const run=(link,parent,start,end,name,id)=>{
    const points=[];for(let i=0;i<=8;i++){const x=start+(end-start)*i/8,at=hit(link,x,0,-1);if(!at)return null;points.push([x,0,at.z-.027*cross]);}
    const ports=[socket(parent,link,start,0,name+' · entrada',id),socket(parent,link,end,0,name+' · salida',id)];if(ports.some(v=>!v))return null;
    const cable=hose(parent,points,.008*cross,name);tag(cable,id,'services');
    // Saddle feet terminate on measured skin, the band supports the hose at
    // a defined 27 mm offset, not a cylinder suspended alongside the arm.
    for(const fraction of [.2,.5,.8]){const x=start+(end-start)*fraction,at=hit(link,x,0,-1);if(!at)continue;
      const clamp=b.box('Abrazadera anclada · '+name,[.021*cross,.022*cross,.032*cross],'metal',parent,[x,0,at.z-.014*cross],true);tag(clamp,id,'services');}
    return ports;
  };
  const flexible=(a,z,name,id)=>{
    if(!a||!z)return;
    const radius=.008*cross,segments=c.detail==='high'?20:12,around=5;
    const geometry=new THREE.TubeBufferGeometry(new THREE.LineCurve3(new THREE.Vector3(),new THREE.Vector3(0,.1,0)),segments,radius,around,false);
    const mesh=b.mesh(name,geometry,'rubber',rig.visual);tag(mesh,id,'services');mesh.frustumCulled=false;
    rig.serviceCables.push({mesh,a,z,radius,segments,around,clearance:(robotSchema.assemblies.resolve(c).parts.shoulderAssembly==='reinforced-yoke'?.10:.070)*cross,points:[]});
  };
  if(c.serviceHarness){
    const upper=run('link_2',parents.shoulder,.14*cross,d.upperArm-.11*cross,'Arnés de potencia y encoder J2–J3','robot.harness');
    const forearm=run('link_3',parents.elbow,.075*cross,.17*cross,'Distribuidor de servicios del codo','robot.harness');
    const customShoulder=robotSchema.assemblies.resolve(c).parts.shoulderAssembly!=='cast-offset';
    const basePort=socket(parents.yaw,'link_1',customShoulder?0:-.055*cross,customShoulder?0:-.09*baseYFor(d),'Salida de potencia de columna');
    if(upper){flexible(basePort,upper[0],'Lazo articulado de hombro J2','robot.harness');if(forearm)flexible(upper[1],forearm[0],'Lazo articulado de codo J3','robot.harness');}
  }
  if(c.servicePackage!=='none'&&['vacuum','gripper','process'].includes(c.tool)){
    const prefix=c.servicePackage==='pneumatic'?'Manguera neumática':'Cable eléctrico de herramienta';
    const nativeForearm=robotSchema.assemblies.resolve(c).parts.forearmAssembly!=='hollow-drive';
    const tail=nativeForearm?run('link_3',parents.elbow,d.forearm*.35,d.forearm*.83,prefix+' · tramo antebrazo','robot.tool-services'):run('link_4',parents.roll,-d.forearm*.36,-.055*cross,prefix+' · tramo antebrazo','robot.tool-services');
    // The articulated wrist uses its hollow shaft internally; a short hose
    // follows J6 rigidly to the actual native end effector connector.
    const endX=d.toolLength-(c.tool==='vacuum'?.14:c.tool==='process'?.13:.15),endY=c.tool==='vacuum'?.13:c.tool==='process'?.055:.08;
    const fitting=b.cylinder('Racor de servicio del efector',.009,.014,'metal',parents.spin,[endX,endY+.007,0]);tag(fitting,'robot.tool-services','services');
    const h=hose(parents.spin,[[.015,0,-.043*cross],[.025,endY+.045,-.055*cross],[endX,endY+.04,-.015],[endX,endY+.014,0]],.0055*cross,prefix+' · conexión al efector');tag(h,'robot.tool-services','services');
    if(tail)rig.internalServiceRoute={from:tail[1].object.name,to:'Efector final',through:['J4','J5','J6'],kind:c.servicePackage};
  }
  // Root's side-panel placement owns the other endpoint of this floor cable.
  // This stable, real base socket is exposed in the robot actor's local frame.
  const floorX=robotSchema.assemblies.resolve(c).parts.baseAssembly==='compact-pedestal'?-(rig.assemblyBase&&rig.assemblyBase.radius||.1)*.55:-.28*cross;
  const floor=socket(parents.base,'base_link',floorX,.052,'Conector de alimentación desde consola','robot.base-services');
  if(floor)rig.panelServiceSocket={object:floor.object,point:floor.point.clone(),radius:.010*cross,minimumFloorHeight:.018};
}
function baseYFor(d){return Math.max(.1,d.baseHeight/.4);}
function updatePilotServices(root,rig){
  if(!rig.serviceCables||!rig.serviceCables.length)return;
  const values=rig.pose&&rig.pose.joints||[];
  if(rig.serviceLastJoints&&values.slice(0,3).every((value,index)=>Math.abs(value-rig.serviceLastJoints[index])<1e-7))return;
  rig.serviceLastJoints=values.slice(0,3);
  const inverse=new THREE.Matrix4().getInverse(rig.visual.matrixWorld),zaxis=new THREE.Vector3(0,0,-1);
  for(const line of rig.serviceCables){
    const a=line.a.point.clone().applyMatrix4(line.a.object.matrixWorld).applyMatrix4(inverse),z=line.z.point.clone().applyMatrix4(line.z.object.matrixWorld).applyMatrix4(inverse);
    // Both sockets' outward normals define the rear service plane, even when
    // the whole actor is placed/rotated in a saved scene. No world-axis cable.
    const qa=line.a.object.getWorldQuaternion(new THREE.Quaternion()),qz=line.z.object.getWorldQuaternion(new THREE.Quaternion()),qroot=rig.visual.getWorldQuaternion(new THREE.Quaternion()).inverse();
    const na=zaxis.clone().applyQuaternion(qa).applyQuaternion(qroot),nz=zaxis.clone().applyQuaternion(qz).applyQuaternion(qroot);
    const away=na.clone().add(nz);if(away.lengthSq()<.1)away.copy(na);away.normalize();
    const slack=Math.max(line.clearance*2.2,a.distanceTo(z)*.40),points=[a,a.clone().addScaledVector(na,line.clearance),a.clone().lerp(z,.5).addScaledVector(away,slack),z.clone().addScaledVector(nz,line.clearance),z];
    const curve=new THREE.CatmullRomCurve3(points),frames=curve.computeFrenetFrames(line.segments,false),p=line.mesh.geometry.attributes.position,n=line.mesh.geometry.attributes.normal;
    for(let i=0;i<=line.segments;i++){const center=curve.getPointAt(i/line.segments);for(let j=0;j<=line.around;j++){const angle=j/line.around*Math.PI*2,normal=frames.normals[i].clone().multiplyScalar(-Math.cos(angle)).addScaledVector(frames.binormals[i],Math.sin(angle)),at=i*(line.around+1)+j;p.setXYZ(at,center.x+line.radius*normal.x,center.y+line.radius*normal.y,center.z+line.radius*normal.z);n.setXYZ(at,normal.x,normal.y,normal.z);}}
    p.needsUpdate=n.needsUpdate=true;line.points=Array.from({length:line.segments+1},(_,i)=>curve.getPointAt(i/line.segments));
    line.mesh.geometry.computeBoundingSphere();line.mesh.userData.robotCableEndpoints=[a.toArray(),z.toArray()];
  }
}

function assemblyComponents(b,rig,d,parents,skins,assembly,cross){
  const selected=assembly.parts,t=.10*cross,add=(link,mesh,id)=>{mesh.userData.robotAssemblyPart=selected[({base_link:'baseAssembly',link_1:'shoulderAssembly',link_2:'upperArmAssembly',link_3:'forearmAssembly',link_4:'forearmAssembly',link_5:'wristAssembly'})[link]];mesh.geometry.userData.sourceLink=link;if(id)mesh.userData.robotComponentId=id;(skins[link]||(skins[link]=[])).push(mesh);return mesh;};
  const surfaceStrip=(host,parent,name,size,position,side,role)=>{
    const profile=host.geometry.userData.robotCasting,geometry=new THREE.BoxBufferGeometry(size[0],size[1],size[2],b.config.detail==='low'?3:6,1,1),p=geometry.attributes.position;
    for(let i=0;i<p.count;i++){const x=p.getX(i)+position[0]-host.position.x,y=p.getY(i)+position[1]-host.position.y,z=volumeSurface(profile.sections,x,y,side,profile.exponent);p.setZ(i,p.getZ(i)+z);}
    geometry.computeVertexNormals();const mesh=b.mesh(name,geometry,role,parent,[position[0],position[1],host.position.z]);mesh.userData.robotConformedCover=true;return mesh;
  };
  const baseTop=Math.max(.055,d.baseHeight*.55),wide=selected.baseAssembly==='wide-floor',compact=selected.baseAssembly==='compact-pedestal',footWidth=(wide?.66:compact?.40:.49)*cross,footDepth=(wide?.60:compact?.38:.49)*cross,drum=(wide?.185:compact?.125:.155)*cross;
  const base=parents.base;
  add('base_link',b.mesh('Placa de anclaje · '+assembly.effectivePartNames.baseAssembly,b.geometry('footprint',[footWidth,footDepth,.028,Math.min(.035,footWidth*.08)]),'metal',base,[0,.014,0]),'robot.base');
  if(compact){
    add('base_link',b.box('Pedestal compacto de bancada',[drum*1.65,Math.max(.02,baseTop-.052),drum*1.7],'accent',base,[0,(baseTop+.028)/2,0],true),'robot.base');
    add('base_link',b.box('Caja de conexiones compacta',[.13*cross,.075*cross,.055*cross],'accent',base,[-drum*.72,baseTop*.55,-drum*.77],true),'robot.base');
  }else{
    const height=Math.max(.025,baseTop-.028),profile=[[0,0],[drum*1.05,0],[drum*1.10,.025],[drum*.94,height*.32],[drum*.91,height*.84],[drum*.87,height],[0,height]];
    add('base_link',b.mesh('Zócalo estructural de fundición',b.geometry('lathe',[profile]),'accent',base,[0,.028,0]),'robot.base');
    if(wide)for(const side of[-1,1]){const rib=b.box('Nervio de anclaje al zócalo',[.045*cross,baseTop*.66,drum*.75],'frame',base,[side*drum*.94,.028+baseTop*.33,0],true);rib.rotation.z=side*.14;add('base_link',rib,'robot.base');}
  }
  add('base_link',b.cylinder('Corona de apoyo J1 mecanizada',drum*.93,.022,'metal',base,[0,baseTop+.004,0]),'robot.base');
  b.bolts(base,[-1,1].flatMap(x=>[-1,1].map(z=>[x*footWidth*.39,.033,z*footDepth*.39])),.010*cross,'y');
  rig.assemblyBase={width:footWidth,depth:footDepth,radius:drum,top:baseTop};
  const shoulder=selected.shoulderAssembly;
  if(shoulder!=='cast-offset'){
    const parent=parents.yaw,reinforced=shoulder==='reinforced-yoke',r=(reinforced?.105:.079)*cross,zRear=-.085*cross,lower=baseTop-d.baseHeight;
    add('link_1',b.cylinder('Cuerpo giratorio J1',drum*.80,Math.max(.022,-lower-.055*cross),'frame',parent,[0,(lower-.055*cross)/2,0]),'robot.shoulder');
    const cheek=b.casting(reinforced?'Doble apoyo del hombro · fundición reforzada':'Yugo compacto del hombro',[.075*cross,r*.85,r, .045*cross],'frame',parent,[0,-.045*cross,zRear]);cheek.rotation.z=Math.PI/2;add('link_1',cheek,'robot.shoulder');
    add('link_1',b.cylinder('Eje de apoyo transversal J2',r*.61,.21*cross,'metal',parent,[0,0,.018*cross],[Math.PI/2,0,0]),'robot.shoulder');
    add('link_1',b.cylinder('Servorreductor lateral J2',r*.82,.075*cross,'accent',parent,[0,0,-.15*cross],[Math.PI/2,0,0]),'robot.shoulder');
    if(reinforced)add('link_1',b.box('Puente inferior del yugo reforzado',[r*1.65,.055*cross,.23*cross],'frame',parent,[0,-r*.9,.005*cross],true),'robot.shoulder');
  }
  const bearing=(parent,x,r,z,id)=>{
    const depth=selected.upperArmAssembly==='heavy-box'?.19:selected.upperArmAssembly==='slim-tube'?.08:.13;
    const shaft=b.cylinder('Cubo de rodamiento del brazo',r*.48,(depth+.016)*cross,'metal',parent,[x,0,z],[Math.PI/2,0,0]);shaft.userData.robotComponentId=id;
    const disk=b.cylinder('Alojamiento de rodamiento · '+id,r*.78,.022*cross,'accent',parent,[x,0,z+(depth/2+.011)*cross],[Math.PI/2,0,0]);disk.userData.robotComponentId=id;return disk;
  };
  const upper=selected.upperArmAssembly;
  if(upper!=='industrial-cast'){
    const parent=parents.shoulder,L=d.upperArm,z=.091*cross,heavy=upper==='heavy-box',tube=upper==='slim-tube',r=(heavy?.108:upper==='compact-cast'?.072:.086)*cross;
    bearing(parent,0,r,z,'robot.upper-arm');bearing(parent,L,r*.74,z,'robot.upper-arm');
    if(tube){
      add('link_2',b.box('Perfil cerrado rectangular del brazo',[Math.max(.04,L-r*1.35),.080*cross,.080*cross],'frame',parent,[L/2,0,z],true),'robot.upper-arm');
      add('link_2',b.box('Tapa longitudinal del perfil del brazo',[Math.max(.03,L-r*2),.048*cross,.008*cross],'accent',parent,[L/2,0,z-.044*cross],true),'robot.upper-arm');
    }else{
      const shell=add('link_2',b.housing(heavy?'Carcasa de brazo reforzada con transición':'Carcasa compacta de brazo',[L,r,r*.72,heavy?.19*cross:.13*cross],'frame',parent,[0,0,z]),'robot.upper-arm');
      if(upper==='ribbed-cast'||heavy)for(const side of[-1,1])add('link_2',surfaceStrip(shell,parent,'Nervio longitudinal conformado del brazo',[L*.68,.014*cross,.020*cross],[L*.49,side*r*.45,z],1,'accent'),'robot.upper-arm');
      add('link_2',surfaceStrip(shell,parent,'Tapa de mantenimiento conformada del brazo',[L*.46,r*.56,.008*cross],[L*.43,r*.18,z],-1,'accent'),'robot.upper-arm');
    }
    if(b.config.jointCovers)for(const x of[0,L]){const mount=group(parent,'Tornillería de apoyo del brazo',[x,0,0]);mount.userData.robotComponentId='robot.bearings';b.boltRing(mount,r*.55,z+((heavy?.19:tube?.08:.13)/2+.025)*cross,6);}
  }
  const forearm=selected.forearmAssembly;
  if(forearm!=='hollow-drive'){
    const parent=parents.elbow,L=d.forearm,heavy=forearm==='heavy-drive',tube=forearm==='slim-tube',r=(heavy?.083:forearm==='compact-drive'?.060:.072)*cross;
    add('link_3',b.cylinder('Reductor J3 con eje lateral',r,.17*cross,'accent',parent,[0,0,.026*cross],[Math.PI/2,0,0]),'robot.elbow');
    add('link_3',b.box('Servomotor protegido del codo',[.14*cross,.09*cross,.10*cross],'accent',parent,[.055*cross,0,-.065*cross],true),'robot.elbow');
    const start=.11*cross,span=Math.max(.04,L-start-.025*cross),center=start+span/2;
    if(tube)add('link_3',b.box('Perfil cerrado del antebrazo',[span,.066*cross,.070*cross],'frame',parent,[center,0,0],true),'robot.forearm');
    else{
      const shell=add('link_3',b.housing(heavy?'Antebrazo de carga · cuerpo reforzado':'Antebrazo con cubierta de accionamiento',[span,r*.75,r*.40,(heavy?.13:.105)*cross],'frame',parent,[start,0,0]),'robot.forearm');
      add('link_3',surfaceStrip(shell,parent,'Cubierta de transmisión conformada',[span*.68,r*.40,.009*cross],[center,0,0],-1,'accent'),'robot.forearm');
      if(heavy)for(const y of[-1,1])add('link_3',surfaceStrip(shell,parent,'Nervio conformado del antebrazo',[span*.7,.011*cross,.018*cross],[center,y*r*.30,0],1,'metal'),'robot.forearm');
    }
    add('link_4',b.cylinder('Portaeje hueco J4',r*.57,.10*cross,'accent',parents.roll,[-.040*cross,0,0],[0,0,Math.PI/2]),'robot.forearm');
  }
  if(selected.wristAssembly!=='service-wrist'){
    const strong=selected.wristAssembly==='reinforced-inline',r=(strong?.055:.039)*cross;
    add('link_5',b.cylinder('Carcasa articulada J5',r,.085*cross,'frame',parents.bend,[0,0,.015*cross],[Math.PI/2,0,0]),'robot.wrist');
    add('link_5',b.cylinder('Tapa y sello del cabeceo J5',r*.78,.012*cross,'accent',parents.bend,[0,0,.063*cross],[Math.PI/2,0,0]),'robot.wrist');
    if(strong)add('link_5',b.box('Puente de muñeca reforzada',[.070*cross,.045*cross,.065*cross],'frame',parents.roll,[-.035*cross,-r*.6,.015*cross],true),'robot.wrist');
  }
  return {baseTop,baseRadius:drum,upperCenterZ:.091*cross,upperNative:upper==='industrial-cast',forearmNative:forearm==='hollow-drive'};
}

function referenceArticulated(b, rig, d) {
  // Apache-2.0 visual derivative, revision pinned in the asset and NOTICE.
  // Native joints/limits/TCP stay authoritative. This is not an OEM controller
  // or calibrated replica: skin offsets and link proportions are adapted.
  const source=robotSchema.referencePilotGeometry(),parts=source.lods[b.config.detail],assembly=robotSchema.assemblies.resolve(b.config);
  // Capacity is a runtime constraint, not a casting diameter. Scaling an 80 kg
  // teaching cell by payload used to triple the KR10-derived skin thickness.
  // Preserve its bearing circles; stretch only the clear link between them.
  const cross=Math.min(1.5,Math.sqrt(d.reach/1.1),d.upperArm/.26,d.forearm/.27)*b.config.housingScale*(assembly.id==='compact-training'?.80:assembly.id==='heavy-handling'?1.10:assembly.id==='long-reach'?.92:1),t=.10*cross,baseY=d.baseHeight/.4;
  const base=group(rig.visual,'Base anclada al piso'),yaw=joint(rig.visual,'J1',[0,d.baseHeight,0],rig);
  const shoulder=joint(yaw,'J2',[0,0,0],rig),elbow=joint(shoulder,'J3',[d.upperArm,0,0],rig);
  const roll=joint(elbow,'J4',[d.forearm,0,0],rig),bend=joint(roll,'J5',[0,0,0],rig),spin=joint(bend,'J6',[0,0,0],rig);
  const parents={base_link:base,link_1:yaw,link_2:shoulder,link_3:elbow,link_4:roll,link_5:bend,link_6:spin};
  const names={base_link:'Base · fundición, conectores y cableado de potencia',link_1:'Hombro · columna giratoria y alojamiento de servomotor',link_2:'Brazo superior · fundición y tapa del reductor J2',link_3:'Reductor J3 · codo asimétrico y servomotor',link_4:'Antebrazo · transmisión hueca y alojamiento J4',link_5:'Muñeca · horquilla y mecanismo de cabeceo J5',link_6:'Brida ISO de herramienta · eje J6'};
  const decode=(value,Type)=>{const text=atob(value),bytes=new Uint8Array(text.length);for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);return new Type(bytes.buffer);};
  rig.castingShells=[];rig.shoulderCheeks=[];const skins={};
  parts.forEach(part=>{
    // The source visual includes two short, cut cable tails at its base.
    // Replace those disconnected OEM fragments with the native floor socket
    // and the actor-owned connection to its actual side console.
    if(part.link==='base_link'&&/^base_link \/ Mesh[78]$/.test(part.name))return;
    if(part.link==='base_link'&&(assembly.parts.baseAssembly==='compact-pedestal'||part.name==='base_link / Mesh1.006'))return;
    if(part.link==='link_1'&&assembly.parts.shoulderAssembly!=='cast-offset')return;
    if(part.link==='link_2'&&assembly.parts.upperArmAssembly!=='industrial-cast')return;
    if((part.link==='link_3'||part.link==='link_4')&&assembly.parts.forearmAssembly!=='hollow-drive')return;
    if(part.link==='link_5'&&assembly.parts.wristAssembly!=='service-wrist')return;
    const q=decode(part.position,Int16Array),encoded=decode(part.normal,Int8Array),positions=new Float32Array(q.length),normals=new Float32Array(q.length),uv=new Float32Array(q.length/3*2);
    let scale=[cross,cross,cross],shift=[0,0,0];
    if(part.link==='base_link')scale=[cross,Math.max(.1,baseY),cross];
    if(part.link==='link_1')scale=[cross,Math.max(.1,baseY),cross];
    if(part.link==='link_2')scale[0]=d.upperArm/.455;
    if(part.link==='link_3'||part.link==='link_4')scale[0]=d.forearm/.42;
    if(part.link==='link_4')shift[0]=-d.forearm;
    if(part.link==='link_5')scale[0]=.60*t/.15;
    if(part.link==='link_6'){scale[0]=1.90*t/.15;shift[0]=.006;}
    for(let i=0;i<q.length;i+=3){
      const v=[0,1,2].map(axis=>part.center[axis]+q[i+axis]*part.scale[axis]);
      if(part.link==='base_link'){v[0]+=.025;v[1]+=.4;v[2]-=.0907;}
      for(let axis=0;axis<3;axis++)positions[i+axis]=v[axis]*scale[axis]+shift[axis];
      let dx=scale[0];
      if(part.link==='link_2'||part.link==='link_3'||part.link==='link_4'){
        const upper=part.link==='link_2',length=upper?d.upperArm:d.forearm,reference=upper?.455:.42,left=upper?.105:.12,right=upper?.375:.33;
        const middle=(length-(reference-right)*cross-left*cross)/(right-left);
        positions[i]=(v[0]<=left?v[0]*cross:v[0]>=right?length+(v[0]-reference)*cross:left*cross+(v[0]-left)*middle)+shift[0];
        dx=v[0]<=left||v[0]>=right?cross:middle;
      }
      const normal=new THREE.Vector3(encoded[i]/dx,encoded[i+1]/scale[1],encoded[i+2]/scale[2]).normalize();normals.set([normal.x,normal.y,normal.z],i);
      uv[i/3*2]=positions[i]*3;uv[i/3*2+1]=(Math.abs(normal.y)>.7?positions[i+2]:positions[i+1])*3;
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setIndex(new THREE.BufferAttribute(decode(part.index,part.indexType==='H'?Uint16Array:Uint32Array),1));
    geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.userData={robotReferenceCAD:true,sourceLink:part.link,sourcePart:part.name,sourceRevision:source.revision,sourceLOD:b.config.detail};
    const mesh=b.mesh(names[part.link],geometry,part.role,parents[part.link]);mesh.userData.robotReferenceCAD=true;mesh.userData.robotContouredHousing=true;
    if(!skins[part.link])skins[part.link]=[];skins[part.link].push(mesh);
    mesh.userData.industrialSourceLicense='Apache-2.0';mesh.userData.industrialSourceRevision=source.revision;
    if(part.link==='link_3')mesh.userData.robotComponentId='robot.elbow';
    if(part.link==='link_4')mesh.userData.robotComponentId='robot.forearm';
    if(part.role==='frame')rig.castingShells.push(mesh);
  });
  const mechanical=assemblyComponents(b,rig,d,{base,yaw,shoulder,elbow,roll,bend,spin},skins,assembly,cross);
  // The native contact-critical end effector remains identical; the source
  // CAD flange is only its visual mounting face, never a substitute TCP.
  rig.pilotFlangeEnd=.006+.0285*(1.90*t/.15);tool(b,spin,rig);
  pilotAccessories(b,rig,d,skins,{base,yaw,shoulder,elbow,roll,bend,spin},cross);
  const radius=Math.max(.10,Math.min(.34,d.reach*.13)),pedestalTop=Math.max(.11,d.baseHeight-t*1.4);
  const upperStart=t*1.08,upperEnd=Math.max(t*1.09,d.upperArm-t*1.55),upperCenterZ=x=>(.0907-.0042*x/d.upperArm)*cross;
  rig.design={style:'reference-industrial-pilot',visualModel:'reference-pilot',revision:4,assembly,section:t,sectionScale:cross,capacityAffectsAppearance:false,manufacturerReplica:false,source:source.source,sourceRevision:source.revision,sourceLicense:source.license,
    adaptation:'CAD visual skins rebased and proportioned to native J1–J6; original OEM offsets removed; native motion and tool are retained.',
    accessories:{harness:b.config.serviceHarness,covers:b.config.jointCovers,labels:b.config.identificationLabels,toolSupply:['vacuum','gripper','process'].includes(b.config.tool)?b.config.servicePackage:'none'},
    upperStructuralCenterline:{startZ:upperCenterZ(upperStart),endZ:upperCenterZ(upperEnd),centerY:.008*cross,radius:t*.24,reference:'Offset CAD cantilever casting; verified by native local Y/Z surface rays at five sections in every LOD.'}};
  rig.selfCollisionCores={
    upper:{object:shoulder,start:[upperStart,mechanical.upperNative?.008*cross:0,mechanical.upperNative?upperCenterZ(upperStart):mechanical.upperCenterZ],end:[upperEnd,mechanical.upperNative?.008*cross:0,mechanical.upperNative?upperCenterZ(upperEnd):mechanical.upperCenterZ],radius:t*.24},
    forearm:{object:elbow,start:[t*1.55,0,0],end:[Math.max(t*1.56,d.forearm-t*.8),0,0],radius:t*.3},
    pedestal:{object:rig.visual,start:[0,.06,0],end:[0,Math.max(.07,mechanical.baseTop-.035),0],radius:mechanical.baseRadius*.65}
  };
}

function articulated(b, rig, d) {
  const collaborative = b.config.variant === 'collaborative';
  const payload = Math.max(.86, Math.min(1.18, Math.pow(b.config.payloadKg / 16, .09)));
  const t = Math.max(.085, Math.min(.30, d.reach * (collaborative ? .074 : .112) * payload));
  // J2 is the bearing centre, not the upper surface of a solid pedestal.
  // Separate its fixed yoke from the moving arm instead of occupying the
  // same space with a pedestal, saddle, crown and swinging casting.
  const clearance = t * 1.40, pedestalTop = Math.max(b.config.family === 'mobileManipulator' ? b.config.height + .11 : .11, d.baseHeight - clearance);
  const radius = pedestal(b, rig, Object.assign({}, d, {baseHeight: pedestalTop}));
  rig.castingShells = [];
  const yaw = joint(rig.visual, 'J1', [0, d.baseHeight, 0], rig);
  const bearingOffset = pedestalTop - d.baseHeight;
  const turntable = group(yaw, 'J1 · rodamiento de giro y sellado', [0, bearingOffset, 0]);
  hinge(b, turntable, radius * .79, .06, 'y', true);
  const waist = [[0, bearingOffset + .025], [radius * .76, bearingOffset + .025],
    [radius * .88, bearingOffset + .05], [radius * .80, -t * 1.06], [radius * .62, -t * .99], [0, -t * .99]];
  const waistMesh = b.mesh('Cintura anular del hombro', b.geometry('lathe', [waist]), 'frame', yaw);
  waistMesh.userData.robotContouredHousing = true; rig.castingShells.push(waistMesh);
  rig.shoulderCheeks = [];
  for (const side of [-1, 1]) {
    const cheek = b.casting('Oreja de apoyo del eje del hombro', [t * .65, t * .52, t * .80, t * .24], 'frame', yaw, [0, -t * .65, side * t * 1.135]);
    cheek.rotation.z = Math.PI / 2;
    cheek.userData.robotBearingSupport = true; rig.shoulderCheeks.push(cheek); rig.castingShells.push(cheek);
  }
  b.cylinder('Eje pasante de apoyo J2', t * .29, t * 2.56, 'metal', yaw, [0, 0, 0], [Math.PI / 2, 0, 0]);
  const shoulder = joint(yaw, 'J2', [0, 0, 0], rig);
  // Its service cap is outboard of the fixed cheeks, not coplanar with them.
  hinge(b, shoulder, t * .97, t * 2.56, 'z', true);
  rig.castingShells.push(link(b, shoulder, d.upperArm, t, 'Brazo superior'));
  const elbow = joint(shoulder, 'J3', [d.upperArm, 0, 0], rig); hinge(b, elbow, t * .72, t * 1.42, 'z', true);
  rig.castingShells.push(link(b, elbow, d.forearm - t * .48, t * .78, 'Antebrazo', true));
  if (b.config.family === 'palletizer') {
    // The working wrist is levelled independently; the pair of connecting rods
    // is recomputed from the same joint positions, preserving a parallelogram.
    rig.palletWrist = joint(rig.visual, 'J4', [0, 0, 0], rig); hinge(b, rig.palletWrist, t * .46, t * .8, 'x');
    rig.parallelRods = [0, 1, 2, 3].map(() => b.cylinder('Biela del paralelogramo de nivelación', t * .065, 1, 'metal', rig.visual));
    rig.parallelOffset = t * .62; rig.parallelSide = t * .91;
    rig.parallelMounts = [0, 1, 2, 3, 4, 5].map(() => ({
      axle: b.cylinder('Eje de anclaje del paralelogramo', t * .085, 1, 'metal', rig.visual),
      bridge: b.cylinder('Puente de apoyo del paralelogramo', t * .11, 1, 'frame', rig.visual),
      pin: b.cylinder('Pasador de biela del paralelogramo', t * .13, t * .33, 'metal', rig.visual)
    }));
    rig.castingShells.push(b.casting('Cabezal perfilado de paletizado', [t * .36, t * .45, t * .32, t * .83], 'frame', rig.palletWrist, [-t * .24, 0, 0]));
    tool(b, rig.palletWrist, rig);
  } else {
    const roll = joint(elbow, 'J4', [d.forearm, 0, 0], rig);
    const wrist = b.housing('Carcasa estrechada de muñeca J4', [t * .50, t * .38, t * .29, t * .87], 'frame', roll, [-t * .51, 0, 0]);
    rig.castingShells.push(wrist); hinge(b, roll, t * .34, t * .65, 'x');
    const bend = joint(roll, 'J5', [0, 0, 0], rig); hinge(b, bend, t * .28, t * .65);
    const spin = joint(bend, 'J6', [0, 0, 0], rig);
    b.cylinder('Brida ISO de herramienta', t * .27, .055, 'metal', spin, [.034, 0, 0], [0, 0, Math.PI / 2]);
    b.cylinder('Guardapolvo del eje de herramienta', t * .30, .018, 'rubber', spin, [.006, 0, 0], [0, 0, Math.PI / 2]);
    tool(b, spin, rig);
  }
  // Manufacturer-independent identity for material/geometry audits. These
  // shapes are authored castings, not a claim of production CAD dimensions.
  rig.design = {style: collaborative ? 'compact-collaborative' : b.config.family === 'palletizer' ? 'reinforced-palletizer' : 'compact-industrial', section: t,
    shoulderBearingHeight: d.baseHeight, pedestalTop, fixedCheekInnerZ: t * 1.015, coverOuterZ: t * 1.28,
    manufacturerReplica: false};
  // Inscribed central bodies distinguish a folded arm conflict from intended
  // contact inside its coaxial bearings. They are teaching motion guards, not
  // a manufacturer's complete self-collision model or certified safety data.
  rig.selfCollisionCores = {
    upper: {object: shoulder, start: [t * .6, 0, 0], end: [Math.max(t * .61, d.upperArm - t * 1.55), 0, 0], radius: t * .4},
    forearm: {object: elbow, start: [t * 1.55, 0, 0], end: [Math.max(t * 1.56, d.forearm - t * .8), 0, 0], radius: t * .3},
    pedestal: {object: rig.visual, start: [0, b.config.family === 'mobileManipulator' ? b.config.height + .06 : .06, 0], end: [0, Math.max(.07, pedestalTop - .035), 0], radius: radius * .65}
  };
}

function radialRobot(b, rig, d) {
  const radius = pedestal(b, rig, d), yaw = joint(rig.visual, 'J1', [0, d.baseHeight, 0], rig);
  hinge(b, yaw, radius * .78, .10, 'y');
  let carriage;
  if (b.config.family === 'cylindrical') {
    b.box('Columna vertical del eje prismático', [.17, d.height + .15, .2], 'frame', yaw, [0, d.height / 2, 0], true);
    for (const z of [-.14, .14]) b.cylinder('Guía vertical rectificada', .022, d.height + .08, 'metal', yaw, [.10, d.height / 2, z]);
    carriage = joint(yaw, 'J2', [0, 0, 0], rig);
    b.box('Carro de elevación RPP', [.28, .19, .39], 'accent', carriage, [.02, 0, 0], true);
    b.cable(yaw, [[-.12, .05, -.18], [-.18, d.height * .5, -.2], [-.12, d.height, -.18]], .018, 'Cadena portacables vertical');
  } else {
    carriage = joint(yaw, 'J2', [0, 0, 0], rig); hinge(b, carriage, radius * .65, radius * 1.45);
  }
  b.box('Camisa exterior del brazo telescópico', [d.reach * .34, .17, .19], 'frame', carriage, [d.reach * .17, 0, 0], true);
  b.box('Tapa del servo lineal', [.19, .12, .21], 'accent', carriage, [d.reach * .14, -.09, 0], true);
  rig.radialTube = b.box('Corredera radial extensible', [1, .105, .12], 'aluminum', carriage, [.5, 0, 0]);
  rig.radialPiston = b.cylinder('Husillo y guía de extensión', .018, 1, 'metal', carriage, [.5, -.09, 0], [0, 0, Math.PI / 2]);
  const radial = joint(carriage, 'J3', [0, 0, 0], rig);
  b.box('Cabezal del eje radial', [.09, .15, .19], 'accent', radial, [0, 0, 0], true);
  rig.downTool = group(radial, 'Brida RPP / RRP'); rig.downTool.rotation.z = -Math.PI / 2;
  tool(b, rig.downTool, rig);
}

function scara(b, rig, d) {
  const radius = pedestal(b, rig, d), t = Math.max(.09, d.reach * .12);
  const first = joint(rig.visual, 'J1', [0, d.baseHeight, 0], rig); hinge(b, first, radius * .85, .14, 'y');
  b.box('Brazo horizontal J1', [d.upperArm, t * .9, t * 1.7], 'frame', first, [d.upperArm / 2, 0, 0], true);
  const second = joint(first, 'J2', [d.upperArm, 0, 0], rig); hinge(b, second, t * .8, t * .95, 'y');
  b.box('Brazo horizontal J2', [d.forearm, t * .78, t * 1.35], 'frame', second, [d.forearm / 2, 0, 0], true);
  b.cable(second, [[0, t * .6, 0], [d.forearm * .35, t * 1.1, -.06], [d.forearm, t * .9, 0]], .012);
  b.cylinder('Casquillo de guía lineal', .055, .11, 'accent', second, [d.forearm, 0, 0]);
  const vertical = joint(second, 'J3', [d.forearm, 0, 0], rig);
  b.cylinder('Husillo vertical estriado', .025, b.config.height + .15, 'metal', vertical, [0, b.config.height / 2, 0]);
  const wrist = joint(vertical, 'J4', [0, 0, 0], rig); rig.downTool = group(wrist, 'Brida vertical de herramienta'); rig.downTool.rotation.z = -Math.PI / 2;
  tool(b, rig.downTool, rig);
}

function gantry(b, rig, d) {
  const top = d.baseHeight + d.height + .3, x = d.length / 2 + .18, z = d.width / 2 + .18;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('Columna de pórtico de aluminio', [.12, top, .12], 'aluminum', rig.visual, [sx * x, top / 2, sz * z]);
    b.box('Placa niveladora del pórtico', [.28, .045, .28], 'metal', rig.visual, [sx * x, .0225, sz * z], true);
  }
  for (const sz of [-1, 1]) {
    b.box('Travesaño longitudinal del pórtico', [d.length + .5, .14, .14], 'frame', rig.visual, [0, top, sz * z]);
    b.box('Guía lineal X rectificada', [d.length + .35, .025, .035], 'metal', rig.visual, [0, top + .084, sz * z]);
  }
  const carriageX = joint(rig.visual, 'J1', [0, top + .13, 0], rig);
  b.box('Puente transversal móvil X', [.16, .15, d.width + .55], 'frame', carriageX, [0, 0, 0], true);
  for (const sz of [-1, 1]) b.box('Patín de recirculación de bolas X', [.25, .05, .16], 'metal', carriageX, [0, -.07, sz * z], true);
  b.box('Guía lineal Z rectificada', [.036, .026, d.width + .3], 'metal', carriageX, [.1, .09, 0]);
  const carriageZ = joint(carriageX, 'J2', [0, 0, 0], rig); b.box('Carro Z de eje vertical', [.27, .18, .26], 'accent', carriageZ, [0, 0, 0], true);
  const carriageY = joint(carriageZ, 'J3', [0, 0, 0], rig); rig.linearMast = b.box('Mástil vertical extensible', [.075, 1, .075], 'aluminum', carriageY, [0, 0, 0]);
  rig.gantryTop = top + .13; rig.gantryTool = group(rig.visual, 'Herramienta XYZ'); rig.gantryTool.rotation.z = -Math.PI / 2;
  tool(b, rig.gantryTool, rig);
  b.cable(carriageX, [[-.12, .15, -z], [-.14, .3, -z + .2], [-.16, .34, z * .25], [-.10, .13, z * .5]], .027, 'Cadena portacables X');
}

function delta(b, rig, d) {
  const top = d.deltaTop;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('Columna estructural del Delta', [.09, top + .10, .09], 'aluminum', rig.visual, [sx * b.config.length / 2, (top + .10) / 2, sz * b.config.width / 2]);
    b.box('Anclaje de columna', [.22, .04, .22], 'metal', rig.visual, [sx * b.config.length / 2, .02, sz * b.config.width / 2], true);
  }
  for (const sz of [-1, 1]) b.box('Viga superior Delta', [b.config.length + .12, .12, .1], 'frame', rig.visual, [0, top + .12, sz * b.config.width / 2]);
  for (const sx of [-1, 1]) b.box('Viga transversal Delta', [.1, .12, b.config.width + .1], 'frame', rig.visual, [sx * b.config.length / 2, top + .12, 0]);
  b.cylinder('Placa superior de mecanismo paralelo', d.deltaRadius + .14, .07, 'frame', rig.visual, [0, top + .06, 0]);
  b.box('Puente estructural de placa Delta X', [b.config.length + .12, .05, .10], 'metal', rig.visual, [0, top + .075, 0]);
  b.box('Puente estructural de placa Delta Z', [.10, .05, b.config.width + .1], 'metal', rig.visual, [0, top + .075, 0]);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3, p = [Math.cos(a) * d.deltaRadius, top, Math.sin(a) * d.deltaRadius];
    const mount = joint(rig.visual, 'J' + (i + 1), p, rig); mount.rotation.y = -a;
    hinge(b, mount, .075, .15, 'z');
    const upper = b.cylinder('Brazo superior Delta', .035, d.deltaUpper, 'frame', rig.visual);
    const lowers = [-1, 1].map(() => b.cylinder('Biela paralela de fibra de carbono', .012, d.deltaLower, 'accent', rig.visual));
    const balls = [0, 1].map(() => b.cylinder('Rótula del paralelogramo Delta', .025, .075, 'metal', rig.visual, undefined, [Math.PI / 2, 0, 0]));
    if (!rig.deltaLegs) rig.deltaLegs = []; rig.deltaLegs.push({upper, lowers, balls});
  }
  rig.deltaPlatform = group(rig.visual, 'Plataforma paralela móvil');
  b.cylinder('Placa de efector Delta', d.deltaEffector * 1.5, .045, 'aluminum', rig.deltaPlatform);
  const wrist = joint(rig.deltaPlatform, 'J4', [0, 0, 0], rig); rig.downTool = group(wrist, 'Brida Delta orientada'); rig.downTool.rotation.z = -Math.PI / 2;
  tool(b, rig.downTool, rig);
}

function mobile(b, rig, d) {
  const isRail = b.config.family === 'shuttle', long = isRail ? Math.min(1.25, d.length * .65) : d.length, width = d.width;
  if (isRail) {
    for (const z of [-width * .37, width * .37]) {
      b.box('Carril de acero del shuttle', [d.length, .08, .06], 'metal', rig.visual, [0, .14, z]);
      b.box('Bancada del carril', [d.length, .10, .15], 'frame', rig.visual, [0, .05, z]);
    }
    for (const x of [-1, 1]) b.box('Tope amortiguado de carril', [.08, .26, width], 'accent', rig.visual, [x * d.length * .48, .18, 0], true);
  }
  const chassis = isRail ? joint(rig.visual, 'J1', [0, 0, 0], rig) : group(rig.visual, 'Chasis móvil'); rig.chassis = chassis;
  const bottom = isRail ? .2 : .08, bodyHeight = isRail ? Math.max(.18, d.baseHeight + .15 - bottom) : Math.max(.18, d.height - bottom);
  const roundedBase = b.config.family === 'mobileManipulator';
  const chassisPart = (name, size, role, position) => roundedBase ? b.mesh(name, b.geometry('footprint', [size[0], size[2], size[1], Math.min(size[0], size[2]) * .17]), role, chassis, position) : b.box(name, size, role, chassis, position, true);
  chassisPart('Carrocería modular de transporte', [long, bodyHeight, width], 'frame', [0, bottom + bodyHeight / 2, 0]);
  chassisPart('Protector perimetral elastómero', [long + .025, .075, width + .025], 'rubber', [0, bottom + .055, 0]);
  chassisPart('Cubierta superior desmontable', [long * .89, .024, width * .88], 'metal', [0, bottom + bodyHeight + .012, 0]);
  chassis.userData.industrialStickerAnchors = [
    {id: 'equipment-id', position: [0, bottom + bodyHeight * .55, width / 2], normal: [0, 0, 1], size: [Math.min(.24, long * .3), Math.min(.095, bodyHeight * .24)]},
    {id: 'capacity', position: [0, bottom + bodyHeight + .024, -width * .23], normal: [0, 1, 0], size: [Math.min(.22, long * .24), Math.min(.12, width * .2)]}
  ];
  for (const z of [-1, 1]) for (const x of [-1, 1]) {
    const wheel = b.cylinder('Rueda motriz / rodadura', .09, .055, 'rubber', chassis, [x * long * .3, .10 + (isRail ? .10 : 0), z * (width / 2 - .025)], [Math.PI / 2, 0, 0]);
    const hub = b.cylinder('Buje de rueda', .042, .057, 'metal', wheel); hub.rotation.set(0, 0, 0);
    if (!rig.wheels) rig.wheels = []; rig.wheels.push(wheel);
  }
  b.bolts(chassis, [-1, 1].flatMap(x => [-1, 1].map(z => [x * long * .38, bottom + bodyHeight + .035, z * width * .35])), .011, 'y');
  if (!isRail) {
    b.cylinder(b.config.family === 'amr' ? 'Láser de navegación SLAM' : 'Baliza de guiado AGV', .055, .055, 'accent', chassis, [long * .33, bottom + bodyHeight + .05, 0]);
    b.cylinder('Ventana óptica del sensor de navegación', .056, .018, 'light', chassis, [long * .33, bottom + bodyHeight + .055, 0]);
    for (const sign of [-1, 1]) b.box('Indicador de estado frontal', [.015, .024, width * .36], 'light', chassis, [sign * (long / 2 + .002), bottom + bodyHeight * .65, 0]);
    b.box('Pulsador de emergencia móvil', [.045, .025, .045], 'accent', chassis, [-long * .37, bottom + bodyHeight + .035, width * .25], true);
  }
  if (!['mobileManipulator', 'mobileSorter'].includes(b.config.family)) {
    rig.mobileTool = group(chassis, 'Soporte de carga móvil'); rig.mobileTool.rotation.z = -Math.PI / 2;
    tool(b, rig.mobileTool, rig);
  }
}

function mobileSorter(b, rig, d) {
  mobile(b, rig, d);
  const pivot = group(rig.visual, 'J2 · pivote de la bandeja', [0, d.baseHeight + d.height + .025, 0]); pivot.userData.robotJoint = 'J2';
  const payload = joint(pivot, 'J1', [0, 0, 0], rig); rig.joints.push(pivot); rig.sorterPivot = pivot;
  rig.toolAssembly = group(payload, 'Plano de carga y descarga'); rig.toolAssembly.rotation.z = -Math.PI / 2;
  rig.tool = group(rig.toolAssembly, 'TCP · apoyo del producto'); rig.tool.userData.robotToolAnchor = true;
  const long = d.length * .92, width = d.width * .90;
  b.box('Bastidor de transferencia transversal', [long + .05, .085, width + .06], 'accent', pivot, [0, -.065, 0], true);
  if (b.config.sorterMode === 'tilttray') {
    b.box('Bandeja inclinable de aluminio', [long, .025, width], 'aluminum', pivot, [0, -.014, 0], true);
    for (const sign of [-1, 1]) b.box('Reborde de retención de bandeja', [long, .055, .022], 'frame', pivot, [0, .01, sign * width / 2], true);
    hinge(b, pivot, .075, width * .4, 'z');
    b.cylinder('Actuador de inclinación', .035, .22, 'metal', rig.chassis, [long * .28, d.height - .12, 0]);
  } else {
    const belt = b.box('Cinta transversal de clasificación', [long, .028, width], 'rubber', pivot, [0, -.015, 0]);
    belt.material = belt.material.clone(); belt.material.name = 'Robot · Cinta de clasificación';
    belt.material.map = surfaceMap(b.config.wear, 239, false); rig.sorterBelt = belt;
    rig.sorterRollers = [-1, 1].map(sign => b.cylinder('Rodillo motriz de cinta transversal', .05, width, 'metal', pivot, [sign * long / 2, -.035, 0], [Math.PI / 2, 0, 0]));
    b.box('Motorreductor de la cinta transversal', [.15, .13, .10], 'frame', pivot, [long * .4, -.12, width * .48], true);
  }
  for (const sign of [-1, 1]) b.box('Lector de carga de clasificación', [.055, .04, .055], 'accent', pivot, [0, .015, sign * (width / 2 + .025)], true);
}

function setRod(object, a, b) {
  const start = new THREE.Vector3().fromArray(a), end = new THREE.Vector3().fromArray(b), direction = end.clone().sub(start);
  object.position.copy(start.add(end).multiplyScalar(.5)); object.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
  const length = object.geometry.parameters.height; object.scale.y = direction.length() / length;
}
function expose(root, rig) {
  RIG.set(root, rig);
  Object.defineProperty(root.userData, 'robotRig', {value: rig, configurable: true, enumerable: false});
}
function collisionBodies(rig) {
  // Cache rigid-part bounds once, in the actual mesh's coordinates. Long
  // diagonal links keep an oriented envelope rather than a large world AABB
  // full of empty corners. Moving jaws, rail scales and parallel rods retain
  // their own transforms. Runtime can broadphase these small cached bounds
  // and narrowphase `meshes` only when necessary; no new renderable is added.
  const bodies = [], groups = new Map(), boundaries = new Set([rig.visual, ...rig.joints, rig.toolAssembly, ...rig.fingers].filter(Boolean));
  rig.visual.traverse(object => {
    if (!object.isMesh || !object.geometry || object.userData.industrialCosmeticDetail) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    const bounds = object.geometry.boundingBox;
    if (!bounds || bounds.isEmpty()) return;
    let parent = object, owner = rig.visual, inTool = false;
    while (parent && parent !== rig.visual) {if (parent === rig.toolAssembly) inTool = true; if (owner === rig.visual && boundaries.has(parent)) owner = parent; parent = parent.parent;}
    const body = {object, bounds: bounds.clone(), meshes: [object], role: object.userData.robotContactSurface ? 'contact' : inTool ? 'tool' : 'link', owner};
    bodies.push(body); if (!groups.has(owner)) groups.set(owner, []); groups.get(owner).push(body);
  });
  rig.collisionBodies = bodies;
  rig.collisionGroups = Array.from(groups, ([object, bodies]) => ({object, bodies}));
}
function disposeVisual(visual) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  visual.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => { materials.add(material); ['map', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach(key => { if (material[key]) textures.add(material[key]); }); });
  });
  textures.forEach(value => { if (!value.userData || !value.userData.sharedIndustrialTexture) value.dispose(); }); geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
}

export function createRobot(value = {}, options = {}) {
  const config = robotSchema.normalize(value), root = new THREE.Group();
  root.name = (robotSchema.getDefinition(config.variant) || {}).name || 'Robot';
  root.userData.editorPrefabKey = 'robot'; root.userData.editorPrefabVariant = config.variant;
  root.userData.robotGeometryVersion = 3; root.userData.robotFamily = config.family;
  refreshRobotGeometry(root, config, options); return root;
}

export function refreshRobotGeometry(root, value = {}, options = {}) {
  const config = robotSchema.normalize(value), existing = RIG.get(root), prior = existing && existing.visual || root.children.find(child => child.userData.robotVisual);
  if (prior) { root.remove(prior); disposeVisual(prior); }
  const visual = new THREE.Group(); visual.name = 'Robot · conjunto mecánico'; visual.userData.robotVisual = true;
  root.add(visual); root.children.splice(root.children.indexOf(visual), 1); root.children.unshift(visual);
  const rig = {visual, config, joints: [], tool: null, fingers: [], toolContactSurfaces: []}, b = builder(config), d = kinematics.getDimensions(config);
  const model=robotSchema.visualModel(config);
  if (model === 'reference-pilot') referenceArticulated(b, rig, d);
  else if (config.family === 'articulated' || config.family === 'palletizer') articulated(b, rig, d);
  else if (config.family === 'mobileManipulator') { mobile(b, rig, d); articulated(b, rig, d); }
  else if (config.family === 'cylindrical' || config.family === 'polar') radialRobot(b, rig, d);
  else if (config.family === 'mobileSorter') mobileSorter(b, rig, d);
  else if (config.family === 'scara') scara(b, rig, d);
  else if (config.family === 'cartesian') gantry(b, rig, d);
  else if (config.family === 'delta') delta(b, rig, d);
  else mobile(b, rig, d);
  let hasAnchors = false;
  visual.traverse(node => { if (node.userData.industrialStickerAnchors) hasAnchors = true; });
  if (!hasAnchors) {
    // Cartesian/parallel/radial frames can put their identity plate directly
    // on a flat manufactured part, following that part if it moves.
    let host, area = 0;
    visual.traverse(node => {
      if (!node.isMesh || !/Perfil|Brazo horizontal|Columna|Carcasa|Placa base/.test(node.name)) return;
      node.geometry.computeBoundingBox(); const bounds = node.geometry.boundingBox, size = bounds.getSize(new THREE.Vector3());
      if (size.x * size.y > area) { host = node; area = size.x * size.y; }
    });
    if (host) {
      const bounds = host.geometry.boundingBox, size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      host.userData.industrialStickerAnchors = [{id: 'equipment-id', position: [center.x, center.y, bounds.max.z], normal: [0, 0, 1], size: [Math.min(.21, size.x * .65), Math.min(.08, size.y * .5)]}];
    }
  }
  visual.userData.robotParametricDesign = {filletRadius: config.filletRadius, chamferSize: config.chamferSize, mountingHoles: config.mountingHoles, detail: config.detail};
  root.userData.robotGeometryVersion = model === 'reference-pilot' ? 4 : 3; root.userData.robotVisualModel = model; root.userData.robotFamily = config.family; root.userData.editorPrefabVariant = config.variant;
  componentIdentity(rig);
  expose(root, rig); updateRobotPose(root, kinematics.homePose(config)); collisionBodies(rig);
  return root;
}

export function updateRobotPose(root, pose = {}) {
  let rig = RIG.get(root) || root.userData.robotRig;
  if (!rig) return null;
  const c = rig.config, d = kinematics.getDimensions(c), input = Array.isArray(pose) ? pose : pose.joints;
  const solved = input ? kinematics.forward(c, input) : pose.toolPosition || pose.tcp ? kinematics.inverse(c, pose.toolPosition || pose.tcp) : kinematics.homePose(c);
  const j = solved.joints;
  if (c.family === 'articulated' || c.family === 'palletizer' || c.family === 'mobileManipulator') {
    rig.joints[0].rotation.y = j[0]; rig.joints[1].rotation.z = j[1]; rig.joints[2].rotation.z = j[2];
    if (c.family === 'articulated' || c.family === 'mobileManipulator') { rig.joints[3].rotation.x = j[3]; rig.joints[4].rotation.z = j[4]; rig.joints[5].rotation.x = j[5]; }
    else {
      rig.palletWrist.position.fromArray(solved.frames[3].position); rig.palletWrist.quaternion.fromArray(solved.quaternion);
      const shoulder = solved.frames[1].position, elbow = solved.frames[2].position, tcp = solved.frames[3].position;
      const offset = [0, rig.parallelOffset, 0];
      [-1, 1].forEach((sign, index) => {
        const shift = [Math.sin(j[0]) * sign * rig.parallelSide, 0, Math.cos(j[0]) * sign * rig.parallelSide];
        const a = shoulder.map((v, i) => v + shift[i] + offset[i]), b = elbow.map((v, i) => v + shift[i] + offset[i]), end = tcp.map((v, i) => v + shift[i] + offset[i]);
        setRod(rig.parallelRods[index * 2], a, b); setRod(rig.parallelRods[index * 2 + 1], b, end);
        [shoulder, elbow, tcp].forEach((pivot, point) => {
          const mount = rig.parallelMounts[index * 3 + point], inner = pivot.map((v, i) => v + shift[i]), outer = inner.map((v, i) => v + offset[i]);
          setRod(mount.axle, pivot, inner); setRod(mount.bridge, inner, outer); mount.pin.position.fromArray(outer);
          mount.pin.quaternion.setFromUnitVectors(UP, new THREE.Vector3(Math.sin(j[0]), 0, Math.cos(j[0])));
        });
      });
    }
  } else if (c.family === 'cylindrical' || c.family === 'polar') {
    rig.joints[0].rotation.y = j[0];
    if (c.family === 'cylindrical') rig.joints[1].position.y = j[1]; else rig.joints[1].rotation.z = j[1];
    rig.joints[2].position.x = j[2]; rig.radialTube.scale.x = j[2]; rig.radialTube.position.x = j[2] / 2;
    rig.radialPiston.scale.y = j[2]; rig.radialPiston.position.x = j[2] / 2;
  } else if (c.family === 'scara') {
    rig.joints[0].rotation.y = j[0]; rig.joints[1].rotation.y = j[1]; rig.joints[2].position.y = -j[2]; rig.joints[3].rotation.y = j[3];
  } else if (c.family === 'cartesian') {
    rig.joints[0].position.x = j[0]; rig.joints[1].position.z = j[1];
    const bottom = d.baseHeight + j[2] + d.toolLength, travel = Math.max(.035, rig.gantryTop - bottom);
    rig.joints[2].position.y = -travel; rig.linearMast.scale.y = travel; rig.linearMast.position.y = travel / 2;
    rig.gantryTool.position.set(solved.tcp.x, solved.tcp.y + d.toolLength, solved.tcp.z);
  } else if (c.family === 'delta') {
    solved.deltaElbows.forEach((leg, index) => {
      const parts = rig.deltaLegs[index], angle = index * Math.PI * 2 / 3, tangent = [-Math.sin(angle), 0, Math.cos(angle)];
      setRod(parts.upper, leg.base, leg.elbow);
      [-1, 1].forEach((sign, side) => {
        const shift = tangent.map(v => v * sign * .033), end = solved.deltaPlatform.map((v, i) => v + leg.radial[i] * d.deltaEffector);
        setRod(parts.lowers[side], leg.elbow.map((v, i) => v + shift[i]), end.map((v, i) => v + shift[i]));
      });
      parts.balls[0].position.fromArray(leg.elbow); parts.balls[1].position.fromArray(solved.deltaPlatform.map((v, i) => v + leg.radial[i] * d.deltaEffector));
    });
    rig.deltaPlatform.position.fromArray(solved.deltaPlatform); rig.joints[3].rotation.y = j[3] || 0;
  } else if (c.family === 'mobileSorter') {
    rig.sorterPivot.rotation.z = j[1]; rig.joints[0].position.x = j[0];
    if (rig.sorterBelt) rig.sorterBelt.material.map.offset.x = -j[0] * 2;
    (rig.sorterRollers || []).forEach(roller => { roller.rotation.y = j[0] / .05; });
  } else {
    if (c.family === 'shuttle') rig.joints[0].position.x = j[0];
    rig.mobileTool.position.set(0, solved.tcp.y, 0);
  }
  const opening = Math.max(0, Math.min(1, pose.open === undefined ? 1 : pose.open));
  const maximumSpan = Math.hypot(c.maxProductWidth, c.maxProductDepth, c.maxProductHeight);
  const gripSpan = Math.max(.02, Math.min(maximumSpan, Number.isFinite(pose.gripSpan) ? pose.gripSpan : .12));
  const jawOffset = gripSpan / 2 + .021 + opening * .06;
  if(rig.catalogueToolSync)rig.catalogueToolSync(gripSpan,opening);
  else rig.fingers.forEach(finger => { finger.position.z = finger.userData.robotFingerSign * jawOffset; });
  if (rig.gripperRail) rig.gripperRail.scale.z = Math.max(.23, jawOffset * 2 + .07);
  rig.pose = solved; root.updateMatrixWorld(true); updatePilotServices(root,rig); return solved;
}

export function getRobotToolTransform(root) {
  const rig = RIG.get(root) || root.userData.robotRig;
  if (!rig || !rig.tool) return null;
  root.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4().getInverse(root.matrixWorld).multiply(rig.tool.matrixWorld);
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(); matrix.decompose(position, quaternion, scale);
  return {position, quaternion, tool: rig.tool};
}
