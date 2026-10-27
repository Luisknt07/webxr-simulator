import * as THREE from 'three';
import robotSchema from '../../shared/robots.js';
import kinematics from '../../shared/robot-kinematics.js';

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
    const n = random(), line = brushed ? .035 * Math.sin(y * 2.6) : 0;
    const dirt = Math.max(0, Math.sin(x * .17 + Math.cos(y * .23)) - .76) * wear;
    const chip = n > 1 - wear * .028 ? .30 + random() * .3 : 1;
    const value = Math.round(255 * Math.max(.28, (.94 + .06 * n - line - dirt) * chip));
    const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  // Sparse longitudinal tool marks read close up, without additional polygons.
  for (let i = 0; i < Math.ceil(wear * 23); i++) {
    const row = Math.floor(random() * size), start = Math.floor(random() * size), length = 3 + Math.floor(random() * 18);
    for (let x = start; x < Math.min(size, start + length); x++) {
      const index = (row * size + x) * 4; data[index] = data[index + 1] = data[index + 2] = 120 + Math.floor(random() * 55);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

function roundedShape(w, h, radius) {
  const shape = new THREE.Shape(), x = -w / 2, y = -h / 2, r = Math.min(radius, w / 2, h / 2);
  shape.moveTo(x + r, y); shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y); return shape;
}

function builder(config) {
  const geometries = new Map(), surfaces = new Map();
  const segments = config.detail === 'low' ? 10 : config.detail === 'high' ? 22 : 16;
  const steelFinish = config.finish === 'steel' || config.finish === 'aluminum';
  const material = role => {
    if (!surfaces.has(role)) {
      const color = role === 'frame' ? config.frameColor : role === 'accent' ? config.accentColor : role === 'tool' ? config.toolColor : role === 'rubber' ? '#252b2e' : role === 'light' ? '#4ff2a6' : role === 'aluminum' ? '#b5c0c7' : '#909ba2';
      const metal = role === 'metal' || role === 'aluminum' || role === 'tool' || role === 'frame' && steelFinish;
      const surface = new THREE.MeshStandardMaterial({color, roughness: role === 'rubber' ? .88 : metal ? .32 + config.wear * .22 : .44 + config.wear * .15,
        metalness: role === 'rubber' || role === 'light' ? 0 : metal ? .87 : config.finish === 'polymer' ? .04 : .32});
      surface.name = 'Robot · ' + LABELS[role]; surface.userData.industrialSurfaceName = surface.name;
      surface.color.convertSRGBToLinear(); surface.userData.studioColorSpace = 'linear';
      surface.userData.industrialMaterialRole = role;
      if (role !== 'light' && role !== 'rubber') {
        surface.map = surfaceMap(config.wear, role.length * 617 + 41, metal); surface.bumpMap = surface.map;
        surface.bumpScale = metal ? .0009 : .0005;
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
      if (type === 'lathe') result = new THREE.LatheBufferGeometry(args[0].map(p => new THREE.Vector2(p[0], p[1])), args[1] || segments);
      if (type === 'round') {
        const [w, h, depth] = args, bevel = Math.min(config.chamferSize, Math.min(w, h, depth) * .16);
        const radius = Math.min(config.filletRadius, Math.min(w, h) * .45);
        result = new THREE.ExtrudeBufferGeometry(roundedShape(w - 2 * bevel, h - 2 * bevel, radius), {depth: Math.max(.001, depth - 2 * bevel), steps: 1,
          curveSegments: config.detail === 'high' ? 4 : 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: config.detail === 'high' ? 2 : 1});
        result.translate(0, 0, -depth / 2 + bevel);
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
  return {config, segments, geometry, material, mesh, box, cylinder, rod, bolts, boltRing, cable};
}

function group(parent, name, position) {
  const object = new THREE.Group(); object.name = name; if (position) object.position.fromArray(position); parent.add(object); return object;
}
function joint(parent, id, position, rig) {
  const object = group(parent, id + ' · articulación', position); object.userData.robotJoint = id; rig.joints.push(object); return object;
}
function hinge(b, parent, radius, length, axis = 'z') {
  const rotation = axis === 'z' ? [Math.PI / 2, 0, 0] : axis === 'x' ? [0, 0, Math.PI / 2] : [0, 0, 0];
  const edge = Math.min(.012, length * .12), profile = [[0, -length / 2], [radius * .83, -length / 2], [radius, -length / 2 + edge], [radius, length / 2 - edge], [radius * .83, length / 2], [0, length / 2]];
  b.mesh('Reductor de precisión', b.geometry('lathe', [profile]), 'accent', parent, [0, 0, 0], rotation);
  b.cylinder('Tapa mecanizada del reductor', radius * .80, .022, 'metal', parent,
    axis === 'z' ? [0, 0, length / 2 + .006] : axis === 'x' ? [length / 2 + .006, 0, 0] : [0, length / 2 + .006, 0], rotation);
  if (axis === 'z') {
    b.boltRing(parent, radius * .62, length / 2 + .022);
    b.cylinder('Servomotor y freno integrado', radius * .62, radius * .95, 'accent', parent, [0, 0, -length / 2 - radius * .35], rotation);
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
  const radius = Math.max(.13, Math.min(.34, d.reach * .13)), mount = b.config.family === 'mobileManipulator' ? b.config.height + .025 : 0, height = Math.max(.08, d.baseHeight - mount);
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
  b.cylinder('Zócalo cónico de fundición', radius, Math.max(.04, height - .05), 'frame', base, [0, .05 + Math.max(.04, height - .05) / 2, 0], undefined, radius * .76);
  b.cylinder('Corona de giro J1', radius * .81, .07, 'metal', base, [0, height, 0]);
  b.bolts(base, [-1, 1].flatMap(x => [-1, 1].map(z => [x * radius, .057, z * radius])), .024, 'y');
  b.box('Caja de conexiones y prensaestopas', [radius * 1.2, height * .3, radius * .38], 'accent', base, [0, height * .43, -radius], true);
  base.userData.industrialStickerAnchors = [
    {id: 'equipment-id', position: [0, .025, radius * 1.4], normal: [0, 0, 1], size: [radius * 1.7, .031]},
    {id: 'electrical', position: [0, height * .43, -radius * 1.19], normal: [0, 0, -1], size: [Math.min(.10, radius * .6), Math.min(.10, height * .21)]}
  ];
  return radius;
}
function link(b, parent, length, thickness, name, opposite = false) {
  b.box(name + ' · carcasa de fundición', [length, thickness, thickness * .83], 'frame', parent, [length / 2, 0, 0], true);
  b.box(name + ' · tapa de servicio', [length * .61, thickness * .62, .018], 'accent', parent, [length * .5, 0, -thickness * .43], true);
  b.bolts(parent, [0.22, .78].flatMap(x => [-1, 1].map(y => [length * x, thickness * .21 * y, thickness * .42])), thickness * .047);
  const side = opposite ? -1 : 1;
  b.cable(parent, [[.03, thickness * .48, -thickness * .5], [length * .25, thickness * .75, -thickness * .55], [length * .7, thickness * .65, -thickness * .55], [length * .96, thickness * .48, -thickness * .5]], thickness * .065 * side * side);
}

function tool(b, parent, rig) {
  // The local +X axis is the tool approach axis; the mathematical TCP and the
  // visible finger/ventosa contact plane are exactly x=0.
  const assembly = group(parent, 'Efector final · ' + b.config.tool, [kinematics.getDimensions(b.config).toolLength, 0, 0]); rig.toolAssembly = assembly;
  rig.tool = group(assembly, 'TCP · punto de contacto'); rig.tool.userData.robotToolAnchor = true;
  if (b.config.tool === 'platform') {
    const long = Math.min(b.config.length * .78, 1.3), wide = Math.min(b.config.width * .82, 1.1);
    b.box('Cubierta antideslizante de transferencia', [.045, long, wide], 'rubber', assembly, [.026, 0, 0], true);
    b.bolts(assembly, [-1, 1].flatMap(y => [-1, 1].map(z => [.003, y * long * .4, z * wide * .4])), .011, 'x');
  } else if (b.config.tool === 'fork') {
    // Tool +X points down in a transport posture. Both horizontal tines have
    // their upper support faces at the TCP plane x=0, below the load.
    b.box('Portahorquillas', [.34, .075, .55], 'tool', assembly, [.14, -.28, 0], true);
    for (const z of [-.18, .18]) {
      b.box('Talón de horquilla', [.24, .07, .065], 'metal', assembly, [.12, -.24, z]);
      b.box('Horquilla mecanizada', [.035, .62, .065], 'metal', assembly, [.0175, .02, z], true);
    }
  } else if (b.config.tool === 'vacuum') {
    // The adapter meets the ISO flange, collector and suction stems; no
    // floating manifold. Flexible cup lips terminate on the mathematical TCP.
    b.cylinder('Adaptador de brida del colector', .041, .07, 'metal', assembly, [-.18, 0, 0], [0, 0, Math.PI / 2]);
    b.box('Colector de vacío', [.065, .26, .26], 'tool', assembly, [-.14, 0, 0], true);
    for (const y of [-.08, .08]) for (const z of [-.08, .08]) {
      b.cylinder('Vástago de ventosa', .012, .07, 'metal', assembly, [-.075, y, z], [0, 0, Math.PI / 2]);
      const bellows = [[0, -.04], [.019, -.04], [.025, -.034], [.02, -.028], [.029, -.022], [.023, -.016], [.034, -.008], [.034, 0], [.027, 0], [.012, -.026]];
      b.mesh('Fuelle de ventosa', b.geometry('lathe', [bellows]), 'rubber', assembly, [0, y, z], [0, 0, -Math.PI / 2]);
    }
    b.cable(assembly, [[-.17, .13, 0], [-.24, .17, .05], [-.24, -.02, .09]], .008, 'Tubo neumático de vacío');
  } else if (b.config.tool === 'process') {
    b.cylinder('Carcasa de husillo / proceso', .055, .17, 'tool', assembly, [-.13, 0, 0], [0, 0, Math.PI / 2]);
    b.cylinder('Boquilla de proceso', .012, .045, 'metal', assembly, [-.0225, 0, 0], [0, 0, Math.PI / 2], .004);
    b.cable(assembly, [[-.19, .045, 0], [-.27, .12, 0], [-.32, .02, 0]], .012);
  } else {
    b.box('Actuador de pinza paralela', [.11, .16, .16], 'tool', assembly, [-.15, 0, 0], true);
    rig.gripperRail = b.box('Guía telescópica de las mordazas', [.055, .065, 1], 'metal', assembly, [-.13, 0, 0], true);
    rig.fingers = [-1, 1].map(sign => {
      const finger = group(assembly, 'Mordaza ' + (sign < 0 ? 'izquierda' : 'derecha'), [0, 0, sign * .065]);
      finger.userData.robotFingerSign = sign;
      b.box('Dedo de agarre mecanizado', [.12, .045, .026], 'metal', finger, [-.06, 0, 0], true);
      b.box('Superficie de contacto', [.055, .044, .012], 'rubber', finger, [-.028, 0, -sign * .015]);
      return finger;
    });
  }
  return assembly;
}

function articulated(b, rig, d) {
  const radius = pedestal(b, rig, d), t = Math.max(.09, Math.min(.25, d.reach * .105));
  const yaw = joint(rig.visual, 'J1', [0, d.baseHeight, 0], rig); hinge(b, yaw, radius * .8, .10, 'y');
  b.box('Horquilla del hombro', [t * 1.5, t * 1.45, t * .75], 'frame', yaw, [0, 0, -t * .42], true);
  const shoulder = joint(yaw, 'J2', [0, 0, 0], rig); hinge(b, shoulder, t * .76, t * 1.5); link(b, shoulder, d.upperArm, t, 'Brazo superior');
  shoulder.userData.industrialStickerAnchors = [{id: 'warning-pinch', position: [d.upperArm * .5, 0, t * .415], normal: [0, 0, 1], size: [Math.min(.11, d.upperArm * .2), t * .48]}];
  const elbow = joint(shoulder, 'J3', [d.upperArm, 0, 0], rig); hinge(b, elbow, t * .65, t * 1.22); link(b, elbow, d.forearm, t * .77, 'Antebrazo', true);
  if (b.config.family === 'palletizer') {
    // The working wrist is levelled independently; the pair of connecting rods
    // is recomputed from the same joint positions, preserving a parallelogram.
    rig.palletWrist = joint(rig.visual, 'J4', [0, 0, 0], rig); hinge(b, rig.palletWrist, t * .46, t * .8, 'x');
    rig.parallelRods = [0, 1, 2, 3].map(() => b.cylinder('Biela del paralelogramo de nivelación', t * .065, 1, 'metal', rig.visual));
    tool(b, rig.palletWrist, rig);
  } else {
    const roll = joint(elbow, 'J4', [d.forearm, 0, 0], rig); hinge(b, roll, t * .43, t * .78, 'x');
    const bend = joint(roll, 'J5', [0, 0, 0], rig); hinge(b, bend, t * .34, t * .75);
    const spin = joint(bend, 'J6', [0, 0, 0], rig); b.cylinder('Brida ISO de herramienta', t * .28, .035, 'metal', spin, [0, 0, 0], [0, 0, Math.PI / 2]);
    tool(b, spin, rig);
  }
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
  b.box('Carrocería modular de transporte', [long, bodyHeight, width], 'frame', chassis, [0, bottom + bodyHeight / 2, 0], true);
  b.box('Protector perimetral elastómero', [long + .025, .075, width + .025], 'rubber', chassis, [0, bottom + .055, 0], true);
  b.box('Cubierta superior desmontable', [long * .89, .024, width * .88], 'metal', chassis, [0, bottom + bodyHeight + .012, 0], true);
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
  root.userData.robotGeometryVersion = 1; root.userData.robotFamily = config.family;
  refreshRobotGeometry(root, config, options); return root;
}

export function refreshRobotGeometry(root, value = {}, options = {}) {
  const config = robotSchema.normalize(value), existing = RIG.get(root), prior = existing && existing.visual || root.children.find(child => child.userData.robotVisual);
  if (prior) { root.remove(prior); disposeVisual(prior); }
  const visual = new THREE.Group(); visual.name = 'Robot · conjunto mecánico'; visual.userData.robotVisual = true;
  root.add(visual); root.children.splice(root.children.indexOf(visual), 1); root.children.unshift(visual);
  const rig = {visual, config, joints: [], tool: null, fingers: []}, b = builder(config), d = kinematics.getDimensions(config);
  if (config.family === 'articulated' || config.family === 'palletizer') articulated(b, rig, d);
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
  root.userData.robotFamily = config.family; root.userData.editorPrefabVariant = config.variant;
  expose(root, rig); updateRobotPose(root, kinematics.homePose(config));
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
      const offset = new THREE.Vector3(0, .12, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), -j[1]).applyAxisAngle(UP, j[0]).toArray();
      [-1, 1].forEach((sign, index) => {
        const shift = [Math.sin(j[0]) * sign * .09, 0, Math.cos(j[0]) * sign * .09];
        const a = shoulder.map((v, i) => v + shift[i] + offset[i]), b = elbow.map((v, i) => v + shift[i] + offset[i]), end = tcp.map((v, i) => v + shift[i] + offset[i]);
        setRod(rig.parallelRods[index * 2], a, b); setRod(rig.parallelRods[index * 2 + 1], b, end);
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
  rig.fingers.forEach(finger => { finger.position.z = finger.userData.robotFingerSign * jawOffset; });
  if (rig.gripperRail) rig.gripperRail.scale.z = Math.max(.23, jawOffset * 2 + .07);
  rig.pose = solved; root.updateMatrixWorld(true); return solved;
}

export function getRobotToolTransform(root) {
  const rig = RIG.get(root) || root.userData.robotRig;
  if (!rig || !rig.tool) return null;
  root.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4().getInverse(root.matrixWorld).multiply(rig.tool.matrixWorld);
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(); matrix.decompose(position, quaternion, scale);
  return {position, quaternion, tool: rig.tool};
}
