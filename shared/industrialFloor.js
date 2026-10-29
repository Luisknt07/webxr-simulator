'use strict';

const VERSION = 1;
const LABELS = ['PRODUCCIÓN', 'CARGA', 'DESCARGA', 'INSPECCIÓN', 'PEATONES', 'ACOPIO', 'PRECAUCIÓN', 'MANTENER LIBRE'];
const LIMITS = {walkways: 32, zones: 64, bays: 16, arrows: 96, labels: 48, signs: 16, crossings: 8};
const point = (value, length) => {
  if (!Array.isArray(value) || value.length !== length || value.some(number => !Number.isFinite(number) || Math.abs(number) > 10000)) throw new Error('Coordenadas de señalización del piso inválidas.');
  return value.map(number => Object.is(number, -0) ? 0 : number);
};
function rectangle(value) { const result = point(value, 4); if (result[2] <= result[0] || result[3] <= result[1] || result[2] - result[0] > 500 || result[3] - result[1] > 500) throw new Error('Dimensiones de zona de piso inválidas.'); return result; }
function normalize(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'industrialFloor' || value.version !== VERSION || Object.keys(value).some(key => !['type', 'version', 'bounds', 'floorY', 'texts'].concat(Object.keys(LIMITS)).includes(key))) throw new Error('Presentación de piso no compatible.');
  if (!Number.isFinite(value.floorY) || Math.abs(value.floorY) > 1000) throw new Error('Altura del piso inválida.');
  const result = {type: 'industrialFloor', version: VERSION, bounds: rectangle(value.bounds), floorY: value.floorY};
  const texts = value.texts === undefined ? [] : value.texts;
  if (!Array.isArray(texts) || texts.length > 24 || texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 64 || /[\u0000-\u001f\u007f]/.test(text))) throw new Error('Usa hasta 24 textos de piso, de 1 a 64 caracteres cada uno.');
  if (texts.length) result.texts = texts.map(text => text.trim());
  const labels = LABELS.concat(texts);
  Object.keys(LIMITS).forEach(key => {
    const entries = value[key] || []; if (!Array.isArray(entries) || entries.length > LIMITS[key]) throw new Error('Demasiadas marcas de piso: ' + key + '.');
    result[key] = entries.map(entry => {
      if (['walkways', 'zones', 'bays', 'crossings'].includes(key)) return rectangle(entry);
      const tuple = point(entry, key === 'arrows' ? 3 : key === 'labels' ? 6 : 5);
      const label = key === 'labels' ? tuple[5] : tuple[4];
      if (key !== 'arrows' && (!Number.isInteger(label) || !labels[label])) throw new Error('Rótulo de piso desconocido.');
      if (key === 'labels' && (tuple[3] < .25 || tuple[3] > 8 || tuple[4] < .12 || tuple[4] > 3)) throw new Error('Tamaño del rótulo de piso inválido.');
      if (key === 'signs' && (!Number.isInteger(tuple[3]) || tuple[3] < 0 || tuple[3] > 2)) throw new Error('Tipo de señal vertical inválido.');
      return tuple;
    });
  });
  return result;
}

/** One private atlas and eight indexed material batches. THREE is explicit so
 * server validation remains geometry-free and Node authoring uses the same
 * factory without loading a browser renderer or constructing an AudioContext. */
function createVisual(THREE, input, canvasFactory) {
  const plan = normalize(input), root = new THREE.Group(), batches = new Map(); root.name = 'Señalización industrial del piso';
  const labels = LABELS.concat(plan.texts || []), atlasHeight = Math.pow(2, Math.ceil(Math.log2(Math.max(256, Math.ceil(labels.length / 4) * 128))));
  // Paint is never an occupied room-sized volume. Keep only each real sign's
  // small upright footprint available to the editor's placement search.
  root.userData.industrialFloorObstacleBounds = plan.signs.map(([x, z, yaw]) => {
    const hx = .48 * Math.abs(Math.cos(yaw)) + .16 * Math.abs(Math.sin(yaw));
    const hz = .48 * Math.abs(Math.sin(yaw)) + .16 * Math.abs(Math.cos(yaw));
    return [x - hx, plan.floorY, z - hz, x + hx, plan.floorY + 2.04, z + hz];
  });
  const palette = {joint: '#515a54', walkway: '#385d50', yellow: '#cfb044', white: '#e2e7df', metal: '#394844', blue: '#286477', atlasWhite: '#edf0e8', atlasDark: '#202b24'};
  const canvas = canvasFactory ? canvasFactory() : typeof document !== 'undefined' && document.createElement ? document.createElement('canvas') : null;
  let atlas = null;
  if (canvas && canvas.getContext) {
    canvas.width = 1024; canvas.height = atlasHeight; const drawing = canvas.getContext('2d');
    if (drawing && drawing.fillText) {
      drawing.clearRect(0, 0, 1024, atlasHeight); drawing.textAlign = 'center'; drawing.textBaseline = 'middle'; drawing.font = 'bold 38px Arial, sans-serif'; drawing.fillStyle = '#ffffff';
      labels.forEach((label, index) => drawing.fillText(label, (index % 4) * 256 + 128, Math.floor(index / 4) * 128 + 64, 238));
      atlas = new THREE.CanvasTexture(canvas); atlas.encoding = THREE.sRGBEncoding; atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter; atlas.generateMipmaps = true; atlas.needsUpdate = true;
      atlas.anisotropy = 4; atlas.userData = {industrialFloorAtlas: true};
    }
  }
  const get = key => { if (!batches.has(key)) batches.set(key, {positions: [], normals: [], uv: [], index: []}); return batches.get(key); };
  const polygon = (key, vertices, normal = [0, 1, 0], uv) => {
    const batch = get(key), start = batch.positions.length / 3;
    vertices.forEach((vertex, index) => { batch.positions.push(...vertex); batch.normals.push(...normal); batch.uv.push(...(uv ? uv[index] : [index > 1 ? 1 : 0, index === 1 || index === 2 ? 1 : 0])); });
    for (let index = 1; index + 1 < vertices.length; index++) batch.index.push(start, start + index, start + index + 1);
  };
  const quad = (key, x, z, width, depth, y, yaw = 0, uv) => {
    const cosine = Math.cos(yaw), sine = Math.sin(yaw), rotate = (dx, dz) => [x + dx * cosine + dz * sine, y, z - dx * sine + dz * cosine];
    polygon(key, [rotate(-width / 2, -depth / 2), rotate(-width / 2, depth / 2), rotate(width / 2, depth / 2), rotate(width / 2, -depth / 2)], [0, 1, 0], uv);
  };
  const rect = (key, box, y) => quad(key, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2, box[2] - box[0], box[3] - box[1], y);
  const border = (box, key, y, thickness = .08) => {
    const width = box[2] - box[0], depth = box[3] - box[1], x = (box[0] + box[2]) / 2, z = (box[1] + box[3]) / 2;
    for (const side of [-1, 1]) { quad(key, x + side * (width - thickness) / 2, z, thickness, depth, y); quad(key, x, z + side * (depth - thickness) / 2, width - thickness * 2, thickness, y); }
  };
  const [left, back, right, front] = plan.bounds, y = plan.floorY;
  // Real slab joints are deliberately narrow/dark, without a glossy coating.
  for (let x = Math.ceil(left / 4) * 4; x < right; x += 4) quad('joint', x, (back + front) / 2, .018, front - back, y + .003);
  for (let z = Math.ceil(back / 4) * 4; z < front; z += 4) quad('joint', (left + right) / 2, z, right - left, .018, y + .003);
  plan.walkways.forEach(box => { rect('walkway', box, y + .006); border(box, 'white', y + .010, .055); });
  plan.zones.forEach(box => border(box, 'yellow', y + .012, .085));
  plan.bays.forEach(box => { border(box, 'yellow', y + .013, .085); const w = box[2] - box[0], d = box[3] - box[1]; for (const side of [-1, 1]) quad('yellow', (box[0] + box[2]) / 2 + side * w * .25, (box[1] + box[3]) / 2, .045, d - .2, y + .013); });
  plan.crossings.forEach(box => { const width = box[2] - box[0], depth = box[3] - box[1], count = Math.max(3, Math.floor(width / .5)); for (let index = 0; index < count; index++) quad('white', box[0] + width * (index + .5) / count, (box[1] + box[3]) / 2, Math.min(.28, width / count * .58), depth, y + .016); });
  plan.arrows.forEach(([x, z, yaw]) => {
    quad('white', x + .12 * Math.sin(yaw), z + .12 * Math.cos(yaw), .14, .72, y + .019, yaw);
    const cosine = Math.cos(yaw), sine = Math.sin(yaw), rotate = (dx, dz) => [x + dx * cosine + dz * sine, y + .019, z - dx * sine + dz * cosine];
    polygon('white', [rotate(-.34, -.20), rotate(.34, -.20), rotate(0, -.70)]);
  });
  const atlasUV = index => { const x = index % 4 / 4, top = Math.floor(index / 4) * 128 / atlasHeight, height = 128 / atlasHeight; return [[x, 1 - top], [x, 1 - top - height], [x + .25, 1 - top - height], [x + .25, 1 - top]]; };
  plan.labels.forEach(([x, z, yaw, width, depth, label]) => quad('atlasWhite', x, z, width, depth, y + .023, yaw, atlasUV(label)));
  const box = (x, z, width, height, depth, base) => {
    const xa = x - width / 2, xb = x + width / 2, za = z - depth / 2, zb = z + depth / 2, ya = base, yb = base + height;
    polygon('metal', [[xa, yb, za], [xa, yb, zb], [xb, yb, zb], [xb, yb, za]]);
    polygon('metal', [[xa, ya, zb], [xb, ya, zb], [xb, yb, zb], [xa, yb, zb]], [0, 0, 1]);
    polygon('metal', [[xb, ya, za], [xa, ya, za], [xa, yb, za], [xb, yb, za]], [0, 0, -1]);
    polygon('metal', [[xb, ya, zb], [xb, ya, za], [xb, yb, za], [xb, yb, zb]], [1, 0, 0]);
    polygon('metal', [[xa, ya, za], [xa, ya, zb], [xa, yb, zb], [xa, yb, za]], [-1, 0, 0]);
  };
  plan.signs.forEach(([x, z, yaw, kind, label]) => {
    // The support meets the lower edge; it never crosses either reading face.
    box(x, z, .055, 1.47, .055, y); box(x, z, .32, .035, .32, y + .001);
    const cosine = Math.cos(yaw), sine = Math.sin(yaw), vertices = offset => [[-.48, -.28], [.48, -.28], [.48, .28], [-.48, .28]].map(([dx, dy]) => [x + dx * cosine + offset * sine, y + 1.75 + dy, z - dx * sine + offset * cosine]);
    const normal = [sine, 0, cosine]; polygon(kind === 0 ? 'blue' : 'yellow', vertices(0), normal);
    // Reverse the back face's vertices, keeping its own left-to-right UVs.
    // DoubleSide alone would mirror the letters viewed from behind.
    const tile = atlasUV(label), uv = [tile[1], tile[2], tile[3], tile[0]];
    polygon(kind === 0 ? 'atlasWhite' : 'atlasDark', vertices(.004), normal, uv);
    const back = vertices(-.004); polygon(kind === 0 ? 'atlasWhite' : 'atlasDark', [back[1], back[0], back[3], back[2]], [-normal[0], 0, -normal[2]], uv);
  });
  const names = {joint: 'Juntas de las losas', walkway: 'Ruta peatonal verde mate', yellow: 'Pintura de seguridad amarilla', white: 'Cebras y flechas blancas', metal: 'Soportes de señalética', blue: 'Señales peatonales', atlasWhite: 'Rótulos de piso y peatones', atlasDark: 'Rótulos de precaución y carga'};
  batches.forEach((batch, key) => {
    if (!batch.positions.length) return;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uv, 2)); geometry.setIndex(batch.index); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const lettering = key.startsWith('atlas'), settings = {color: palette[key], side: lettering ? THREE.FrontSide : THREE.DoubleSide, transparent: lettering, alphaTest: lettering ? .05 : 0, depthWrite: !lettering};
    const material = lettering ? new THREE.MeshBasicMaterial(settings) : new THREE.MeshStandardMaterial(Object.assign(settings, {roughness: key === 'metal' ? .82 : .98, metalness: key === 'metal' ? .12 : 0}));
    if (lettering) material.toneMapped = false;
    material.color.convertSRGBToLinear(); material.userData.studioColorSpace = 'linear'; material.name = names[key]; if (lettering) { material.map = atlas; material.visible = !!atlas; }
    material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = lettering ? -5 : key === 'white' ? -4 : key === 'yellow' ? -3 : key === 'walkway' ? -2 : -1;
    const mesh = new THREE.Mesh(geometry, material); mesh.name = names[key]; mesh.receiveShadow = !lettering; mesh.castShadow = false; mesh.userData.industrialFloorMarking = true; root.add(mesh);
  });
  root.userData.editorDefaultBehaviors = [{type: 'collision', enabled: false, mode: 'solid'}]; return root;
}

module.exports = {VERSION, LABELS, LIMITS, normalize, createVisual};
