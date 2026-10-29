'use strict';

// Parametric storage geometry only. Layout/custody lives in warehouseRacks and
// PalletQueueRuntime. THREE is explicit for browser and headless authoring.
const racks = require('./warehouseRacks');
const FLOOR = -1;
const ROLES = {
  frame: ['Bastidores de estantería', '#346483', .55, .56],
  beam: ['Largueros y brazos pintados', '#d88335', .3, .58],
  steel: ['Acero de guías y rodillos', '#a4b1b5', .82, .4],
  deck: ['Entrepaños y bandejas metálicas', '#8e9b9e', .55, .65],
  guard: ['Protecciones de seguridad', '#c5aa3f', .18, .7],
  dark: ['Carriles y mecanismos', '#35454d', .55, .68]
};
const color = (config, role) => role === 'frame' ? config.rackFrameColor || ROLES[role][1] : role === 'beam' ? config.rackBeamColor || ROLES[role][1] : ROLES[role][1];
const position = (cell, closed) => (closed && cell.closedPosition || cell.position || [cell.x, cell.y, cell.z]).slice();
const key = value => Math.round(value * 1e6) / 1e6;
const distinct = values => Array.from(new Set(values.map(key))).sort((a, b) => a - b);

function bounds(cells, closed) {
  const b = {minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity};
  cells.forEach(cell => {
    const p = position(cell, closed), w = cell.width || 1.2, d = cell.depth || .8;
    b.minX = Math.min(b.minX, p[0] - w / 2); b.maxX = Math.max(b.maxX, p[0] + w / 2);
    b.minZ = Math.min(b.minZ, p[2] - d / 2); b.maxZ = Math.max(b.maxZ, p[2] + d / 2);
    b.minY = Math.min(b.minY, p[1]); b.maxY = Math.max(b.maxY, p[1] + (cell.clearHeight || 1));
  });
  if (!cells.length) return {minX: -1, maxX: 1, minZ: -.6, maxZ: .6, minY: -.75, maxY: 2};
  return b;
}

function createBuilder(THREE, config) {
  const unitBox = new THREE.BoxBufferGeometry(1, 1, 1), cylinders = new Map(), banks = new Map(), materials = new Map(), motionBanks = [];
  const unit = (radius, segments) => {
    const k = segments || 8; if (!cylinders.has(k)) cylinders.set(k, new THREE.CylinderBufferGeometry(1, 1, 1, k));
    return cylinders.get(k);
  };
  const material = role => {
    if (!materials.has(role)) {
      const entry = ROLES[role], m = new THREE.MeshStandardMaterial({color: color(config, role), metalness: entry[2], roughness: entry[3]});
      m.color.convertSRGBToLinear(); m.name = entry[0];
      Object.assign(m.userData, {studioColorSpace: 'linear', industrialMaterialRole: role === 'steel' || role === 'deck' ? 'steel' : role === 'dark' ? 'metal' : 'frame'});
      materials.set(role, m);
    }
    return materials.get(role);
  };
  const append = (parent, role, geometry, p, size, quaternion, mover) => {
    if (size.some(v => !Number.isFinite(v) || v <= 0)) return;
    if (!banks.has(parent)) banks.set(parent, new Map());
    const groups = banks.get(parent); if (!groups.has(role)) groups.set(role, {p: [], n: [], uv: [], i: [], motions: []});
    const batch = groups.get(role), matrix = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(p), quaternion || new THREE.Quaternion(), new THREE.Vector3().fromArray(size));
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix), vertex = new THREE.Vector3(), normal = new THREE.Vector3(), start = batch.p.length / 3;
    const positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix); normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
      batch.p.push(vertex.x, vertex.y, vertex.z); batch.n.push(normal.x, normal.y, normal.z); batch.uv.push(uv.getX(i), uv.getY(i));
    }
    const index = geometry.index, count = index ? index.count : positions.count;
    for (let i = 0; i < count; i++) batch.i.push(start + (index ? index.getX(i) : i));
    if (mover) batch.motions.push({object: mover, start, count: positions.count, home: mover.position.clone()});
  };
  const box = (parent, role, p, size, q, mover) => append(parent, role, unitBox, p, size, q, mover);
  const rod = (parent, role, a, b, radius) => {
    const p = new THREE.Vector3().fromArray(a), end = new THREE.Vector3().fromArray(b), direction = end.clone().sub(p), length = direction.length();
    if (length < .0001) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    append(parent, role, unit(radius, 6), p.add(end).multiplyScalar(.5).toArray(), [radius, length, radius], q);
  };
  const roller = (parent, p, length, radius = .035) => append(parent, 'steel', unit(radius, 8), p, [radius, length, radius], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
  const finish = () => {
    banks.forEach((roles, parent) => roles.forEach((b, role) => {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geometry.setIndex(b.i); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material(role)); mesh.name = ROLES[role][0]; mesh.castShadow = mesh.receiveShadow = true;
      Object.assign(mesh.userData, {warehouseRackStructure: true, industrialMaterialPart: role, materialPart: role, materialPartLabel: ROLES[role][0], industrialMaterialRole: role === 'steel' || role === 'deck' ? 'steel' : 'frame'});
      parent.add(mesh);
      if (b.motions.length) motionBanks.push({geometry, rest: geometry.attributes.position.array.slice(), motions: b.motions, previous: ''});
    }));
    unitBox.dispose(); cylinders.forEach(g => g.dispose());
  };
  const syncMotion = () => {
    motionBanks.forEach(bank => {
      const signature = bank.motions.map(m => m.object.position.toArray().join(',')).join('|'); if (signature === bank.previous) return; bank.previous = signature;
      const a = bank.geometry.attributes.position.array;
      bank.motions.forEach(m => {const d = m.object.position.clone().sub(m.home); for (let i = m.start; i < m.start + m.count; i++) {a[i * 3] = bank.rest[i * 3] + d.x; a[i * 3 + 1] = bank.rest[i * 3 + 1] + d.y; a[i * 3 + 2] = bank.rest[i * 3 + 2] + d.z;}});
      bank.geometry.attributes.position.needsUpdate = true; bank.geometry.computeBoundingBox(); bank.geometry.computeBoundingSphere();
    });
  };
  return {box, rod, roller, finish, syncMotion};
}

function group(THREE, parent, name) { const g = new THREE.Group(); g.name = name; parent.add(g); return g; }
function support(b, parent, cell, closed, mode, config) {
  const p = position(cell, closed), w = cell.width, d = cell.depth, top = p[1];
  if (mode === 'shelf') {
    b.box(parent, 'deck', [p[0], top - .018, p[2]], [w + .025, .036, d + .025]);
    for (const z of [-1, 1]) b.box(parent, 'beam', [p[0], top - .065, p[2] + z * d * .44], [w + .04, .09, .045]);
  } else if (mode === 'rail') {
    for (const x of [-1, 1]) {
      b.box(parent, 'steel', [p[0] + x * w * .41, top - .04, p[2]], [.1, .08, d + .06]);
      b.box(parent, 'beam', [p[0] + x * w * .46, top - .12, p[2]], [.06, .1, d + .06]);
    }
  } else if (mode === 'roller') {
    // Three broad rollers per load position retain a real open support plane
    // without a mesh per roller or a solid collision slab through the pallet.
    for (const fraction of [-.36, 0, .36]) b.roller(parent, [p[0], top - .035, p[2] + d * fraction], Math.max(.2, w - .1));
    for (const x of [-1, 1]) b.box(parent, 'beam', [p[0] + x * (w / 2 + .025), top - .07, p[2]], [.045, .12, d + .08]);
  } else {
    for (const z of [-1, 1]) b.box(parent, 'beam', [p[0], top - .065, p[2] + z * d * .34], [w + .05, .13, .11]);
  }
}

function frame(THREE, b, parent, cells, config, options = {}) {
  const closed = !!options.closed, a = bounds(cells, closed), top = a.maxY + .12, thickness = options.light ? .045 : .075;
  const byBay = new Map();
  cells.forEach(cell => {const id = cell.bay || 0; if (!byBay.has(id)) byBay.set(id, []); byBay.get(id).push(cell);});
  const postXs = distinct(Array.from(byBay.values()).reduce((values, rows) => {const box = bounds(rows, closed); values.push(box.minX - .08, box.maxX + .08); return values;}, []));
  const postZs = [a.minZ - .075, a.maxZ + .075];
  postXs.forEach(x => postZs.forEach(z => {
    b.box(parent, 'frame', [x, (FLOOR + top) / 2, z], [thickness, top - FLOOR, thickness]);
    b.box(parent, 'steel', [x, FLOOR + .018, z], [.17, .036, .17]);
    b.box(parent, 'guard', [x, FLOOR + .2, z], [.1, .36, .1]);
  }));
  // Bracing stays on the sides/back, never across a front pick opening.
  [a.minX - .08, a.maxX + .08].forEach(x => {
    for (let y = FLOOR + .35; y < top - .3; y += 1.4) {
      const y2 = Math.min(top - .15, y + 1.25); b.rod(parent, 'steel', [x, y, postZs[0]], [x, y2, postZs[1]], .018);
      b.rod(parent, 'steel', [x, y, postZs[1]], [x, y2, postZs[0]], .018);
    }
  });
  byBay.forEach(rows => {
    const r = bounds(rows, closed), centerX = (r.minX + r.maxX) / 2;
    b.box(parent, 'frame', [centerX, top - .04, a.minZ - .075], [r.maxX - r.minX + .2, .08, .075]);
    if (options.drive) b.box(parent, 'frame', [centerX, top - .04, a.maxZ + .075], [r.maxX - r.minX + .2, .08, .075]);
  });
  cells.forEach(cell => support(b, parent, cell, closed, options.support || 'beam', config));
  return a;
}

function cantilever(THREE, b, parent, cells, config) {
  const a = bounds(cells), top = a.maxY + .12, posts = distinct(cells.reduce((xs, cell) => {xs.push(cell.position[0] - cell.width * .3, cell.position[0] + cell.width * .3); return xs;}, [])), rear = a.minZ - .06;
  for (const x of posts) {
    b.box(parent, 'frame', [x, (FLOOR + top) / 2, rear], [.11, top - FLOOR, .12]);
    b.box(parent, 'frame', [x, FLOOR + .09, (a.minZ + a.maxZ) / 2], [.16, .18, a.maxZ - a.minZ + .35]);
    distinct(cells.map(c => c.position[1])).forEach(y => {
      b.box(parent, 'beam', [x, y - .06, (a.minZ + a.maxZ) / 2], [.11, .12, a.maxZ - a.minZ + .1]);
      b.box(parent, 'guard', [x, y + .025, a.maxZ + .025], [.11, .12, .045]);
    });
  }
  for (let i = 0; i < posts.length - 1; i++) {
    const x1 = posts[i], x2 = posts[i + 1];
    b.rod(parent, 'steel', [x1, FLOOR + .2, rear], [x2, top - .2, rear], .022);
  }
}

function mezzanine(THREE, b, parent, cells, config, rig) {
  const a = bounds(cells), levels = distinct(cells.map(c => c.position[1])), highest = levels[levels.length - 1], width = a.maxX - a.minX + .35, depth = a.maxZ - a.minZ + .35;
  const centerX = (a.minX + a.maxX) / 2, centerZ = (a.minZ + a.maxZ) / 2, stairWidth = 1.05, run = .28, stairX = a.minX - .1 + stairWidth / 2, lastZ = a.maxZ + .17;
  const returnWidth = 1.05, returnX = stairX + stairWidth + .1, flights = [];
  for (const x of [a.minX - .1, a.maxX + .1]) for (const z of [a.minZ - .1, a.maxZ + .1]) {
    b.box(parent, 'frame', [x, (FLOOR + highest) / 2, z], [.13, highest - FLOOR, .13]);
    b.box(parent, 'steel', [x, FLOOR + .02, z], [.3, .04, .3]);
  }
  levels.forEach((top, level) => {
    const base = level ? levels[level - 1] : FLOOR, count = Math.ceil((top - base) / .18), rise = (top - base) / count, firstZ = lastZ + count * run;
    // Every authored floor has a genuine solid deck and its own stair flight.
    b.box(parent, 'deck', [centerX, top - .06, centerZ], [width, .12, depth]);
    for (let i = 0; i < count; i++) {
      const h = rise * (i + 1), z = lastZ + (count - i - .5) * run;
      b.box(parent, 'deck', [stairX, base + h / 2, z], [stairWidth, h, run + .012]);
    }
    for (const side of [-1, 1]) {
      const x = stairX + side * (stairWidth / 2 + .025);
      b.rod(parent, 'guard', [x, base + .95, firstZ], [x, top + .95, lastZ], .024);
      for (let i = 0; i <= count; i += 3) b.box(parent, 'guard', [x, base + rise * i + .47, firstZ - run * i], [.035, .94, .035]);
    }
    if (level > 0) {
      // The previous floor's adjacent return walk reaches this flight's base.
      // It does not seal the stair opening or create a low ceiling over it.
      b.box(parent, 'deck', [returnX, base - .045, (lastZ + firstZ + .35) / 2], [returnWidth, .09, firstZ - lastZ + .35]);
      b.box(parent, 'deck', [(stairX + returnX) / 2, base - .045, firstZ + .18], [returnX - stairX + stairWidth, .09, .36]);
      for (const h of [.55, 1.05]) {
        b.box(parent, 'guard', [returnX + returnWidth / 2, base + h, (lastZ + firstZ + .35) / 2], [.04, .04, firstZ - lastZ + .35]);
        b.box(parent, 'guard', [(stairX + returnX) / 2, base + h, firstZ + .36], [returnX - stairX + stairWidth, .04, .04]);
      }
      for (let z = lastZ; z <= firstZ + .35; z += 1.25) b.box(parent, 'guard', [returnX + returnWidth / 2, base + .53, z], [.04, 1.06, .04]);
    }
    const nextFlight = level < levels.length - 1, openingEnd = nextFlight ? returnX + returnWidth / 2 + .08 : stairX + stairWidth / 2 + .08;
    for (const z of [a.minZ - .15, a.maxZ + .15]) {
      const start = z > centerZ ? openingEnd : a.minX - .15, end = a.maxX + .15;
      if (end > start) for (const h of [.55, 1.05]) b.box(parent, 'guard', [(start + end) / 2, top + h, z], [end - start, .04, .04]);
      for (let x = start; x <= end + .01; x += 1.4) b.box(parent, 'guard', [x, top + .53, z], [.04, 1.06, .04]);
    }
    for (const x of [a.minX - .15, a.maxX + .15]) {
      for (const h of [.55, 1.05]) b.box(parent, 'guard', [x, top + h, centerZ], [.04, .04, depth]);
      for (let z = a.minZ; z <= a.maxZ + .01; z += 1.4) b.box(parent, 'guard', [x, top + .53, z], [.04, 1.06, .04]);
    }
    flights.push({base, deckTop: top, stairCount: count, stairRise: rise, stairRun: run, stairWidth, stairX, firstZ, lastZ});
  });
  rig.mezzanine = Object.assign({levels, flights}, flights[0]);
  // Low pick dividers on top do not enclose a warehouse-sized solid block.
  cells.forEach(cell => {const p = position(cell); b.box(parent, 'steel', [p[0], p[1] + .015, p[2] - cell.depth / 2], [cell.width, .03, .035]);});
}

function automatic(THREE, b, parent, cells, config, layout, rig, system) {
  const a = frame(THREE, b, parent, cells, config, {support: 'shelf', light: true}), access = layout.accessPosition || [0, 0, a.maxZ + 1.1];
  const shaft = layout.shaftPosition || [0, a.maxZ + .6], shaftZ = shaft.length === 3 ? shaft[2] : shaft[1], top = Math.max(a.maxY + .22, access[1] + ((cells[0] && cells[0].clearHeight) || .8) + .3);
  const carrier = rig.carriage = group(THREE, parent, system === 'vertical-lift' ? 'Bandeja del elevador vertical' : 'Carro del transelevador miniload');
  carrier.position.fromArray(access); Object.assign(carrier.userData, {warehouseRackMovingGeometry: system, homePosition: access.slice(), supportTop: 0});
  rig.lift = carrier; rig.shuttle = carrier;
  const cell = cells[0] || {width: 1, depth: .7}, cw = Math.max(.5, cell.width), cd = Math.max(.4, cell.depth);
  b.box(carrier, 'deck', [0, -.035, 0], [cw + .08, .07, cd + .08]);
  for (const x of [-1, 1]) b.box(carrier, 'guard', [x * (cw / 2 + .035), .045, 0], [.035, .09, cd + .08]);
  // Twin columns leave the full load envelope and the insertion trajectory free.
  const shaftWidth = Math.max(cw + .35, .95);
  for (const x of [-1, 1]) b.box(parent, 'dark', [x * shaftWidth / 2, (FLOOR + top) / 2, shaftZ + cd / 2 + .12], [.1, top - FLOOR, .1]);
  b.box(parent, 'dark', [0, FLOOR + .04, shaftZ + cd / 2 + .12], [Math.max(shaftWidth, a.maxX - a.minX), .08, .12]);
  if (system === 'vertical-lift') {
    const minX = a.minX - .16, maxX = a.maxX + .16, minZ = a.minZ - .16, front = access[2] + cd / 2 + .16;
    const middleY = (FLOOR + top) / 2, height = top - FLOOR, midZ = (minZ + front) / 2;
    b.box(parent, 'frame', [minX, middleY, midZ], [.055, height, front - minZ]);
    b.box(parent, 'frame', [maxX, middleY, midZ], [.055, height, front - minZ]);
    b.box(parent, 'frame', [(minX + maxX) / 2, middleY, minZ], [maxX - minX, height, .055]);
    b.box(parent, 'frame', [(minX + maxX) / 2, top + .025, midZ], [maxX - minX, .05, front - minZ]);
    const windowBottom = Math.max(FLOOR + .12, access[1] - .1), windowTop = Math.min(top - .1, access[1] + (cell.clearHeight || .8) + .18), windowHalf = Math.min((maxX - minX) / 2 - .08, cw / 2 + .13);
    if (windowBottom > FLOOR) b.box(parent, 'frame', [(minX + maxX) / 2, (FLOOR + windowBottom) / 2, front], [maxX - minX, windowBottom - FLOOR, .055]);
    if (top > windowTop) b.box(parent, 'frame', [(minX + maxX) / 2, (windowTop + top) / 2, front], [maxX - minX, top - windowTop, .055]);
    for (const side of [-1, 1]) {const edge = side < 0 ? minX : maxX, inside = side * windowHalf; if (Math.abs(edge - inside) > .02) b.box(parent, 'frame', [(edge + inside) / 2, (windowBottom + windowTop) / 2, front], [Math.abs(edge - inside), windowTop - windowBottom, .055]);}
    rig.window = {frontZ: front, minX: -windowHalf, maxX: windowHalf, bottom: windowBottom, top: windowTop};
  } else {
    // A miniload is an open rack plus travelling mast, not a closed cupboard.
    for (const z of [shaftZ - .15, shaftZ + .15]) b.box(parent, 'steel', [(a.minX + a.maxX) / 2, FLOOR + .025, z], [a.maxX - a.minX + .5, .05, .055]);
  }
}

function createVisual(THREE, value, suppliedLayout) {
  const config = racks.normalize ? racks.normalize(value) : value, layout = suppliedLayout || racks.layout(config), cells = layout.cells || layout.pallets || [];
  const root = new THREE.Group(); root.name = 'Estantería · ' + (config.rackSystem || 'selective');
  const system = config.rackSystem, b = createBuilder(THREE, config), rig = {system, pallets: [], banks: [], supports: [], carriage: null, lift: null, shuttle: null};
  Object.defineProperty(root.userData, 'warehouseRackRig', {value: rig, writable: true, configurable: true, enumerable: false});
  if (system === 'mobile') {
    const bankIds = distinct(cells.map(c => c.bank || 0));
    bankIds.forEach(bank => {
      const next = group(THREE, root, 'Base móvil · bloque ' + (bank + 1)), rows = cells.filter(c => (c.bank || 0) === bank);
      const offset = racks.mobileOffset ? racks.mobileOffset(config, bank, config.rackOpenAisle) : [0, 0, 0]; next.position.fromArray(offset);
      Object.assign(next.userData, {warehouseRackBank: bank, homePosition: offset.slice(), basePosition: [0, 0, 0]}); rig.banks[bank] = next;
      const a = frame(THREE, b, next, rows, config, {closed: true});
      b.box(next, 'dark', [(a.minX + a.maxX) / 2, FLOOR + .07, (a.minZ + a.maxZ) / 2], [a.maxX - a.minX + .3, .14, a.maxZ - a.minZ + .25]);
      for (const x of [a.minX, a.maxX]) for (const z of [a.minZ - .07, a.maxZ + .07]) b.roller(next, [x, FLOOR + .07, z], .14, .07);
    });
    const a = bounds(cells, true), back = a.minZ - (config.rackAisleWidth || 2) - .2, front = a.maxZ + .2;
    for (const x of [a.minX, a.maxX]) b.box(root, 'steel', [x, FLOOR + .008, (back + front) / 2], [.07, .016, front - back]);
  } else if (system === 'cantilever') cantilever(THREE, b, root, cells, config);
  else if (system === 'mezzanine') mezzanine(THREE, b, root, cells, config, rig);
  else if (system === 'vertical-lift' || system === 'miniload') automatic(THREE, b, root, cells, config, layout, rig, system);
  else {
    const mode = system === 'light-duty' || system === 'medium-duty' ? 'shelf' : system === 'pallet-flow' || system === 'carton-flow' ? 'roller' : system === 'drive-in' || system === 'drive-through' ? 'rail' : 'beam';
    frame(THREE, b, root, cells, config, {support: mode, light: system === 'light-duty' || system === 'carton-flow', drive: system === 'drive-in' || system === 'drive-through'});
    if (system === 'drive-in') {
      const a = bounds(cells);
      for (const h of [.35, .9]) b.box(root, 'guard', [(a.minX + a.maxX) / 2, FLOOR + h, a.minZ - .13], [a.maxX - a.minX + .18, .07, .06]);
    }
    if (system === 'push-back') {
      const lanes = new Map(); cells.forEach(cell => {const id = cell.lane || [cell.bay, cell.column, cell.level].join(':'); if (!lanes.has(id)) lanes.set(id, []); lanes.get(id).push(cell);});
      rig.carts = [];
      lanes.forEach((rows, lane) => rows.forEach(cell => {
        const p = position(cell), cart = group(THREE, root, 'Carro push-back · ' + lane + '/' + cell.depthIndex); cart.position.fromArray(p);
        Object.assign(cart.userData, {warehouseRackMovingGeometry: 'push-back', warehouseRackCell: cell.index, homePosition: p.slice()}); rig.carts.push(cart);
        for (const x of [-1, 1]) b.box(root, 'steel', [p[0] + x * cell.width * .4, p[1] - .035, p[2]], [.065, .07, cell.depth * .92], undefined, cart);
        for (const z of [-1, 1]) b.box(root, 'dark', [p[0], p[1] - .06, p[2] + z * cell.depth * .38], [cell.width * .8, .05, .065], undefined, cart);
      }));
    }
  }
  cells.forEach(cell => {
    const bank = system === 'mobile' ? rig.banks[cell.bank || 0] : root, p = position(cell, system === 'mobile'), marker = group(THREE, bank || root, 'Apoyo de carga ' + (cell.index + 1)); marker.position.fromArray(p);
    marker.userData.warehouseRackCell = cell.index; marker.userData.editorNonCollidable = true;
    const entry = {object: marker, config: {width: cell.width, depth: cell.depth, top: 0}, items: [], cell}; rig.pallets[cell.index] = entry;
    rig.supports.push({index: cell.index, position: (cell.position || p).slice(), width: cell.width, depth: cell.depth});
  });
  b.finish(); rig.syncMotion = b.syncMotion; root.updateMatrixWorld(true); return root;
}

function disposeVisual(root) {
  if (!root) return;
  const geometries = new Set(), materials = new Set(); root.traverse(node => {if (node.geometry) geometries.add(node.geometry); (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(m => materials.add(m));});
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
function stats(root) {
  let meshes = 0, triangles = 0, vertices = 0; const materials = new Set(); root.traverse(n => {if (!n.isMesh) return; meshes++; vertices += n.geometry.attributes.position.count; triangles += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3; materials.add(n.material);});
  return {meshes, draws: meshes, triangles, vertices, materials: materials.size};
}

module.exports = {createVisual, disposeVisual, stats};
