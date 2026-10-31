import * as THREE from 'three';
import productEquipment from '../schema/product-equipment.js';
import productSources from '../schema/productSources.js';

// Private resources per handling unit; no downloaded CAD, external images or
// actor identity on decorative children. Repeated cargo is merged by material.
function surfaceTexture(kind, sku = '') {
  const size = 64, data = new Uint8Array(size * size * 4); let seed = 71;
  for (let i = 0; i < sku.length; i++) seed = (seed * 31 + sku.charCodeAt(i)) >>> 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = ((x * 17 + y * 29 + seed) % 19) - 9;
    let value = kind === 'cloth' ? 208 + ((x % 3 === 0 || y % 3 === 0) ? -24 : 5) + grain : kind === 'wood' ? 212 + Math.sin(y * .8 + Math.sin(x * .15)) * 18 + grain : 224 + grain;
    if (kind === 'label') value = y > 18 && y < 47 && ((x * 7 + Math.floor(x / 3) + seed) % 13 < 6) ? 28 : 235;
    const n = (y * size + x) * 4; data[n] = data[n + 1] = data[n + 2] = value; data[n + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat); texture.encoding = THREE.sRGBEncoding; texture.needsUpdate = true; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.userData = {productTextureKind: kind, productTextureSku: sku}; return texture;
}
function builder(config) {
  const materials = new Map(), textures = new Map();
  const mat = (role, color, metalness = 0, roughness = .65, texture, opacity = 1) => {
    const key = [role, color, metalness, roughness, texture, opacity].join('|');
    if (!materials.has(key)) {
      if (texture && !textures.has(texture)) textures.set(texture, surfaceTexture(texture, config.sku));
      const value = new THREE.MeshStandardMaterial({color, metalness, roughness, map: texture ? textures.get(texture) : null, transparent: opacity < 1, opacity});
      value.name = role; value.userData.industrialMaterialRole = role; materials.set(key, value);
    }
    return materials.get(key);
  };
  const put = (parent, name, geometry, material, p = [0, 0, 0], rotation) => {
    const object = new THREE.Mesh(geometry, material); object.name = name; object.position.fromArray(p); if (rotation) object.rotation.set(...rotation);
    object.castShadow = true; object.receiveShadow = true; object.userData.industrialPart = name; object.userData.industrialMaterialRole = material.name; parent.add(object); return object;
  };
  const box = (parent, name, size, material, p, rotation) => {
    let geometry;
    if (/^(Caja de cartón|Caja del paquete|Depósito de garrafa|Hombro superior|Asa |Borde \/|Pared larga|Pared corta|Fondo rígido)/.test(name)) {
      const [w, h, d] = size, edge = Math.min(.008, Math.min(w, h, d) * .12), shape = new THREE.Shape();
      shape.moveTo(-w / 2 + edge, -h / 2 + edge); shape.lineTo(w / 2 - edge, -h / 2 + edge); shape.lineTo(w / 2 - edge, h / 2 - edge); shape.lineTo(-w / 2 + edge, h / 2 - edge); shape.closePath();
      geometry = new THREE.ExtrudeBufferGeometry(shape, {depth: d - 2 * edge, steps: 1, bevelEnabled: true, bevelThickness: edge, bevelSize: edge, bevelSegments: 1, curveSegments: 1}); geometry.translate(0, 0, -d / 2 + edge);
    } else geometry = new THREE.BoxBufferGeometry(...size);
    return put(parent, name, geometry, material, p, rotation);
  };
  const cylinder = (parent, name, radius, height, material, p, rotation, segments = 20, top = radius) => put(parent, name, new THREE.CylinderBufferGeometry(top, radius, height, segments), material, p, rotation);
  const lathe = (parent, name, profile, material, p, segments = 24) => put(parent, name, new THREE.LatheBufferGeometry(profile.map(point => new THREE.Vector2(...point)), segments), material, p);
  return {mat, put, box, cylinder, lathe};
}
function unit(config, variant) {
  const root = new THREE.Group(), b = builder(config), body = b.mat('Cuerpo', config.color, ['drum', 'cylinder', 'cage'].includes(variant) ? .65 : 0, variant === 'bottle' ? .22 : .68,
    ['box-small', 'box-medium', 'box-large', 'carton-bundle'].includes(variant) ? 'cardboard' : variant === 'sack' ? 'cloth' : null);
  const dark = b.mat('Cierre y protecciones', config.capColor, .05, .5), metal = b.mat('Acero satinado', '#a2aeb3', .85, .36), label = b.mat('Etiqueta / trazabilidad', config.labelColor, 0, .92, 'label');
  const sticker = (parent = root, position = [.22, .5, .504]) => b.box(parent, 'Etiqueta de producto / SKU', [.35, .19, .004], label, position);
  if (['crate', 'tote'].includes(variant)) {
    b.box(root, 'Fondo rígido', [1, .08, 1], body, [0, .04, 0]);
    for (const side of [-1, 1]) {
      if (variant === 'tote') {
        b.box(root, 'Pared larga / abertura superior', [.95, .88, .055], body, [0, .52, side * .472]);
        b.box(root, 'Pared corta / abertura superior', [.055, .88, .9], body, [side * .472, .52, 0]);
      } else for (let n = 0; n < 7; n++) {
        const p = -.44 + n * .146;
        b.box(root, 'Nervio de caja calada', [.045, .86, .055], body, [p, .5, side * .47]);
        b.box(root, 'Nervio lateral', [.055, .86, .045], body, [side * .47, .5, p]);
      }
      for (const y of variant === 'tote' ? [.95] : [.25, .53, .95]) {
        b.box(root, 'Borde / refuerzo largo', [1, .055, .065], body, [0, y, side * .47]);
        b.box(root, 'Borde / refuerzo corto', [.065, .055, .9], body, [side * .47, y, 0]);
      }
      b.box(root, 'Asa reforzada', [.32, .07, .075], dark, [0, .85, side * .49]);
    } sticker();
  } else if (variant === 'bottle') {
    const glass = b.mat('Polímero de botella', config.color, 0, .18, null, .7);
    b.lathe(root, 'Envase moldeado / pie hombro y cuello', [[0, 0], [.39, 0], [.45, .025], [.46, .07], [.46, .62], [.44, .68], [.31, .76], [.19, .81], [.19, .93], [0, .93]], glass, [0, 0, 0]);
    b.cylinder(root, 'Tapón estriado', .23, .1, dark, [0, .97, 0]);
    for (const y of [.931, .957, .987]) b.cylinder(root, 'Aro de precinto del tapón', .236, .008, dark, [0, y, 0], null, 24);
    b.cylinder(root, 'Etiqueta envolvente', .466, .27, label, [0, .38, 0], null, 24);
  } else if (variant === 'jerrycan') {
    b.box(root, 'Depósito de garrafa', [.92, .77, .9], body, [0, .385, 0]);
    b.box(root, 'Hombro superior', [.8, .08, .84], body, [0, .81, 0]);
    b.box(root, 'Asa · puente', [.52, .055, .16], body, [.12, .97, 0]);
    for (const side of [-1, 1]) b.box(root, 'Asa · soporte', [.065, .16, .16], body, [.12 + side * .23, .88, 0]);
    b.cylinder(root, 'Tapón roscado', .1, .095, dark, [-.28, .9, 0]);
    for (const side of [-1, 1]) for (const x of [-.25, .25]) b.box(root, 'Nervio del depósito', [.055, .6, .02], body, [x, .38, side * .46]); sticker();
  } else if (['drum', 'cylinder'].includes(variant)) {
    const tall = variant === 'cylinder'; b.cylinder(root, tall ? 'Recipiente presurizado' : 'Cuerpo del tambor', .46, tall ? .82 : .94, body, [0, tall ? .43 : .49, 0], null, 24);
    for (const y of tall ? [.04, .83] : [.04, .28, .7, .96]) b.cylinder(root, 'Aro / refuerzo', .49, .035, metal, [0, y, 0], null, 24);
    b.cylinder(root, 'Tapa', .46, .025, metal, [0, tall ? .85 : .984, 0], null, 24);
    if (tall) {
      b.cylinder(root, 'Cuello y válvula', .1, .1, metal, [0, .91, 0]);
      b.box(root, 'Maneral de válvula', [.24, .025, .08], dark, [0, .98, 0]);
      for (const side of [-1, 1]) b.box(root, 'Protección de válvula', [.045, .12, .17], body, [side * .23, .91, 0]);
    } else b.cylinder(root, 'Tapón de llenado', .07, .022, dark, [.22, 1, 0]); sticker(root, [0, .55, .469]);
  } else if (variant === 'reel') {
    const wood = b.mat('Bridas de madera', config.color, 0, .87, 'wood');
    for (const side of [-1, 1]) b.cylinder(root, 'Disco lateral de bobina', .5, .06, wood, [0, .5, side * .46], [Math.PI / 2, 0, 0], 28);
    b.cylinder(root, 'Cable enrollado', .35, .86, dark, [0, .5, 0], [Math.PI / 2, 0, 0], 24);
    for (let n = 0; n < 13; n++) b.cylinder(root, 'Vuelta de cable', .36, .025, dark, [0, .5, -.4 + n * .066], [Math.PI / 2, 0, 0], 20);
    b.cylinder(root, 'Eje central', .08, 1, metal, [0, .5, 0], [Math.PI / 2, 0, 0], 16);
  } else if (variant === 'sack') {
    const geometry = new THREE.SphereBufferGeometry(.5, 20, 12), positions = geometry.attributes.position;
    for (let n = 0; n < positions.count; n++) { const y = positions.getY(n), ripple = 1 + Math.sin(positions.getX(n) * 23 + positions.getZ(n) * 15) * .035; positions.setXYZ(n, positions.getX(n) * ripple, y * .9, positions.getZ(n) * ripple); }
    geometry.computeVertexNormals(); b.put(root, 'Saco tejido flexible', geometry, body, [0, .47, 0]);
    for (const side of [-1, 1]) b.box(root, 'Costura del saco', [.74, .025, .025], dark, [0, .5, side * .42]); sticker(root, [0, .68, .36]);
  } else {
    const bundle = variant === 'carton-bundle';
    if (bundle) for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) b.box(root, 'Caja del paquete', [.322, .486, .98], body, [(col - 1) * .334, .25 + row * .5, 0]);
    else b.box(root, 'Caja de cartón', [1, 1, 1], body, [0, .5, 0]);
    const tape = b.mat('Cinta de cierre', bundle ? config.capColor : '#c3aa77', 0, .44);
    for (const side of bundle ? [-1, 1] : [0]) {
      const x = side * .27; b.box(root, bundle ? 'Fleje superior' : 'Cinta superior', [bundle ? .035 : .17, .004, 1.004], tape, [x, 1.002, 0]);
      for (const face of [-1, 1]) b.box(root, 'Cierre frontal', [bundle ? .035 : .17, .9, .004], tape, [x, .55, face * .502]);
    } sticker();
  }
  return root;
}
function fit(root, dimensions) {
  root.updateMatrixWorld(true); const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const group = new THREE.Group(); group.add(root); root.scale.set(dimensions.width / size.x, dimensions.height / size.y, dimensions.depth / size.z);
  root.position.set(-center.x * root.scale.x, -bounds.min.y * root.scale.y, -center.z * root.scale.z); return group;
}
function pallet(config, height = .144) {
  const root = new THREE.Group(), b = builder(config), plastic = config.palletMaterial === 'plastic';
  const material = b.mat(plastic ? 'Pallet plástico' : 'Pallet madera', plastic ? config.color : '#b29463', 0, plastic ? .68 : .92, plastic ? null : 'wood');
  const w = config.width, d = config.depth, top = height * .74, bottom = height * .22;
  for (const z of [-1, 0, 1]) {
    b.box(root, 'Patín inferior', [w, bottom, d * .16], material, [0, bottom / 2, z * d * .39]);
    for (const x of [-1, 0, 1]) b.box(root, 'Taco de apoyo / abertura horquillas', [w * .15, top - bottom, d * .16], material, [x * w * .4, (top + bottom) / 2, z * d * .39]);
  }
  const count = plastic ? 9 : 7;
  const boardDepth = d / count * .86;
  for (let n = 0; n < count; n++) b.box(root, 'Tabla de cubierta / nervio', [w, height - top, boardDepth], material, [0, (height + top) / 2, (n / (count - 1) - .5) * (d - boardDepth)]);
  // Entries describe the actual clear spaces between the nine support blocks.
  // Their centers are asymmetric to the edge, rather than simply quarter-width.
  const pockets = Object.assign(productEquipment.forkPockets(height), {minY: bottom, maxY: top, centersX: [-w * .2, w * .2], centersZ: [-d * .195, d * .195], widthX: w * .25, widthZ: d * .23, approachAxes: ['x', 'z']});
  palletEntryContrast(root, b, {w, d, height, top, bottom, count, boardDepth, pockets});
  root.userData.forkPockets = pockets; return root;
}
/** Paint on the existing support/deck faces makes the actual gaps readable.
 * There is deliberately no backing quad, virtual opening or frame across a
 * clear entry. These two material batches are decorative, not collision walls. */
function palletEntryContrast(root, b, {w, d, height, top, bottom, count, boardDepth, pockets}) {
  const shade = b.mat('Interior de entradas del pallet', '#3d342a', 0, 1);
  const rim = b.mat('Contorno de entrada del pallet', '#def0e8', .05, .72);
  [shade, rim].forEach(material => {
    material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
    material.userData.palletEntryMarking = true;
  });
  rim.emissive.set('#55776c'); rim.emissiveIntensity = .12;
  const paint = (name, width, h, material, p, rotation) => {
    if (width <= 0 || h <= 0) return;
    const mesh = b.put(root, name, new THREE.PlaneBufferGeometry(width, h), material, p, rotation);
    mesh.castShadow = false; mesh.receiveShadow = true;
  };
  const openingHeight = top - bottom, midY = (top + bottom) / 2;
  const tx = Math.min(.008, w * .008), tz = Math.min(.008, d * .01), ty = Math.min(.006, height * .04);
  for (const center of pockets.centersX) {
    const left = center - pockets.widthX / 2, right = center + pockets.widthX / 2;
    // Recessed side walls remain real support-block faces; the tunnel stays open.
    for (const z of [-d * .39, 0, d * .39]) {
      paint('Pared interior de entrada Z', d * .16, openingHeight, shade, [left, midY, z], [0, Math.PI / 2, 0]);
      paint('Pared interior de entrada Z', d * .16, openingHeight, shade, [right, midY, z], [0, -Math.PI / 2, 0]);
    }
    for (const side of [-1, 1]) {
      const rotation = [0, side < 0 ? Math.PI : 0, 0];
      paint('Marca lateral de entrada Z', tx, openingHeight, rim, [left - tx / 2, midY, side * d * .47], rotation);
      paint('Marca lateral de entrada Z', tx, openingHeight, rim, [right + tx / 2, midY, side * d * .47], rotation);
      paint('Marca inferior de entrada Z', pockets.widthX + tx * 2, ty, rim, [center, bottom - ty / 2, side * d * .47], rotation);
      paint('Marca superior de entrada Z', pockets.widthX + tx * 2, ty, rim, [center, top + ty / 2, side * d / 2], rotation);
    }
  }
  for (const center of pockets.centersZ) {
    const near = center - pockets.widthZ / 2, far = center + pockets.widthZ / 2;
    for (const x of [-w * .4, 0, w * .4]) {
      paint('Pared interior de entrada X', w * .15, openingHeight, shade, [x, midY, near], [0, 0, 0]);
      paint('Pared interior de entrada X', w * .15, openingHeight, shade, [x, midY, far], [0, Math.PI, 0]);
    }
    for (const side of [-1, 1]) {
      const rotation = [0, side * Math.PI / 2, 0];
      paint('Marca lateral de entrada X', tz, openingHeight, rim, [side * w * .475, midY, near - tz / 2], rotation);
      paint('Marca lateral de entrada X', tz, openingHeight, rim, [side * w * .475, midY, far + tz / 2], rotation);
      // Side entries have no continuous lower runner. Only paint the existing
      // ends of the upper deck boards, never bridge the spaces between boards.
      for (let n = 0; n < count; n++) {
        const z = (n / (count - 1) - .5) * (d - boardDepth), a = Math.max(near, z - boardDepth / 2), end = Math.min(far, z + boardDepth / 2);
        if (end > a) paint('Marca superior de entrada X', end - a, ty, rim, [side * w / 2, top + ty / 2, (a + end) / 2], rotation);
      }
    }
  }
}
function merge(root) {
  root.updateMatrixWorld(true); const inverse = new THREE.Matrix4().getInverse(root.matrixWorld), groups = new Map(), discarded = new Set(), oldMaterials = new Set();
  root.traverse(mesh => {
    if (!mesh.isMesh) return; discarded.add(mesh.geometry);
    const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld), normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const source = mesh.geometry, p = source.attributes.position, normals = source.attributes.normal, uv = source.attributes.uv;
    const material = mesh.material, key = [material.name, material.color.getHexString(), material.metalness, material.roughness, material.opacity,
      material.map && JSON.stringify(material.map.userData)].join('|'); oldMaterials.add(material);
    let target = groups.get(key); if (!target) { target = {material, positions: [], normals: [], uv: []}; groups.set(key, target); }
    for (let i = 0; i < (source.index ? source.index.count : p.count); i++) {
      const index = source.index ? source.index.array[i] : i, point = new THREE.Vector3().fromBufferAttribute(p, index).applyMatrix4(matrix);
      const normal = normals ? new THREE.Vector3().fromBufferAttribute(normals, index).applyMatrix3(normalMatrix).normalize() : new THREE.Vector3(0, 1, 0);
      target.positions.push(point.x, point.y, point.z); target.normals.push(normal.x, normal.y, normal.z); target.uv.push(uv ? uv.getX(index) : 0, uv ? uv.getY(index) : 0);
    }
  });
  root.children.slice().forEach(child => root.remove(child));
  // Existing physical mesh paths remain stable in authored projects and saved
  // executions. Decorative batches are appended after every original role.
  const ordered = [...groups.values()].filter(data => !data.material.userData.palletEntryMarking).concat([...groups.values()].filter(data => data.material.userData.palletEntryMarking));
  ordered.forEach(data => {
    const material = data.material;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2)); geometry.computeBoundingBox();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = material.name; mesh.castShadow = mesh.receiveShadow = true; mesh.userData.industrialPart = material.name; mesh.userData.industrialMaterialRole = material.name; root.add(mesh);
    if (material.userData.palletEntryMarking) { mesh.userData.palletEntryMarking = true; mesh.userData.editorRuntimeHelper = true; mesh.userData.editorCollisionDisabled = true; mesh.castShadow = false; }
  }); discarded.forEach(geometry => geometry.dispose());
  const used = new Set(Array.from(groups.values(), value => value.material)), usedMaps = new Set(Array.from(used, material => material.map).filter(Boolean));
  oldMaterials.forEach(material => { if (!used.has(material)) { if (material.map && !usedMaps.has(material.map) && !(material.map.userData && material.map.userData.sharedIndustrialTexture)) material.map.dispose(); material.dispose(); } });
  return root;
}
function cargo(config, variant, placements, singleSpec) {
  const root = new THREE.Group(), loaded = variant === 'pallet-loaded', empty = variant.startsWith('pallet-') && !loaded, cage = variant === 'cage';
  if (loaded || empty || cage) {
    const standardHeight = config.palletMaterial === 'plastic' ? .16 : config.palletType === 'euro-1200x800' ? .144 : .15;
    const baseHeight = empty ? config.height : config.palletHeight || Math.min(standardHeight, config.height * .2), base = pallet(config, baseHeight); root.add(base); root.userData.forkPockets = base.userData.forkPockets;
    if (loaded) {
      if (placements && singleSpec) placements.forEach(placement => { const object = fit(unit(singleSpec, singleSpec.variant || ({crate: 'crate', bottle: 'bottle'}[singleSpec.type] || 'box-medium')), {width: singleSpec.width, height: singleSpec.height, depth: singleSpec.depth}); object.position.set(placement.x + placement.width / 2 - config.width / 2, baseHeight + placement.y, placement.z + placement.depth / 2 - config.depth / 2); object.rotation.y = placement.rotated ? Math.PI / 2 : 0; root.add(object); });
      else {
        const layers = Math.min(5, Math.max(1, Math.ceil(config.units / 8))), perLayer = Math.ceil(config.units / layers), columns = Math.max(1, Math.ceil(Math.sqrt(perLayer * config.width / config.depth))), rows = Math.ceil(perLayer / columns);
        const spec = Object.assign({}, config, {productType: config.contents === 'crates' ? 'crate' : config.contents === 'bottles' ? 'bottle' : 'box', variant: config.contents === 'crates' ? 'crate' : config.contents === 'bottles' ? 'bottle' : 'box-medium'});
        for (let n = 0; n < config.units; n++) { const layer = Math.floor(n / perLayer), cell = n % perLayer, col = cell % columns, row = Math.floor(cell / columns);
          const object = fit(unit(spec, spec.variant), {width: config.width / columns * .96, height: (config.height - baseHeight) / layers, depth: config.depth / rows * .96}); object.position.set((col - (columns - 1) / 2) * config.width / columns, baseHeight + layer * (config.height - baseHeight) / layers, (row - (rows - 1) / 2) * config.depth / rows); root.add(object); }
      }
      root.updateMatrixWorld(true);
      root.userData.palletIdentificationAnchors = root.children.filter(child => child !== base).map(child => {
        const bounds = new THREE.Box3().setFromObject(child), size = bounds.getSize(new THREE.Vector3());
        return {centerX: (bounds.min.x + bounds.max.x) / 2, frontZ: bounds.max.z, minY: bounds.min.y, maxY: bounds.max.y, width: size.x};
      });
    } else if (cage) {
      const b = builder(config), mat = b.mat('Jaula de acero galvanizado', config.color, .8, .4), h = config.height - baseHeight;
      for (const side of [-1, 1]) {
        for (let n = 0; n < 9; n++) { const x = (n / 8 - .5) * config.width; b.box(root, 'Barra de jaula', [.012, h, .012], mat, [x, baseHeight + h / 2, side * config.depth / 2]); }
        for (let n = 0; n < 7; n++) { const z = (n / 6 - .5) * config.depth; b.box(root, 'Barra lateral de jaula', [.012, h, .012], mat, [side * config.width / 2, baseHeight + h / 2, z]); }
        for (const y of [baseHeight, baseHeight + h * .5, config.height]) { b.box(root, 'Marco de jaula', [config.width, .02, .02], mat, [0, y, side * config.depth / 2]); b.box(root, 'Marco lateral de jaula', [.02, .02, config.depth], mat, [side * config.width / 2, y, 0]); }
      }
    }
  } else root.add(fit(unit(config, variant), config));
  return merge(root);
}
export function createProduct(variant, value = {}) {
  const config = productEquipment.normalize(value, variant), visual = cargo(config, config.variant || variant), root = fit(visual, config);
  if (visual.userData.forkPockets) {
    root.userData.forkPockets = Object.assign({}, visual.userData.forkPockets);
    ['bottom', 'top', 'deck', 'minY', 'maxY'].forEach(key => { root.userData.forkPockets[key] *= visual.scale.y; });
    root.userData.forkPockets.centersX = root.userData.forkPockets.centersX.map(value => value * visual.scale.x);
    root.userData.forkPockets.centersZ = root.userData.forkPockets.centersZ.map(value => value * visual.scale.z);
    root.userData.forkPockets.widthX *= visual.scale.x; root.userData.forkPockets.widthZ *= visual.scale.z;
  }
  if (visual.userData.palletIdentificationAnchors) root.userData.palletIdentificationAnchors = visual.userData.palletIdentificationAnchors.map(anchor => ({
    centerX: anchor.centerX * visual.scale.x + visual.position.x, frontZ: anchor.frontZ * visual.scale.z + visual.position.z,
    minY: anchor.minY * visual.scale.y + visual.position.y, maxY: anchor.maxY * visual.scale.y + visual.position.y, width: anchor.width * visual.scale.x
  }));
  root.name = (productEquipment.getDefinition(config.variant) || {}).name || 'Producto';
  root.userData.editorPrefabKey = 'product'; root.userData.editorPrefabVariant = config.variant;
  root.userData.editorDefaultBehaviors = [Object.assign({type: 'product', enabled: true, sourceId: '', initialVelocity: 0}, config)];
  root.userData.productUnits = config.units;
  root.userData.industrialStickerAnchors = [
    {id: 'shipping', position: [-config.width * .19, config.height * .62, config.depth / 2], normal: [0, 0, 1], size: [Math.min(.18, config.width * .3), Math.min(.12, config.height * .22)]},
    {id: 'fragile', position: [config.width / 2, config.height * .58, 0], normal: [1, 0, 0], size: [Math.min(.11, config.depth * .32), Math.min(.11, config.height * .22)]}
  ];
  root.userData.sourceProduct = Object.assign({id: config.sku, sku: config.sku, label: root.name, type: config.productType, productWidth: config.width, productHeight: config.height, productDepth: config.depth}, config,
    {forkPockets: root.userData.forkPockets, massIsTotal: true, productWidth: config.width, productHeight: config.height, productDepth: config.depth});
  return root;
}
export function createCargoVisual(spec = {}, load = {}) {
  const fallback = {box: 'box-medium', crate: 'crate', tote: 'tote', bottle: 'bottle', jerrycan: 'jerrycan', drum: 'drum', sack: 'sack', cylinder: 'cylinder', reel: 'reel', pallet: 'pallet-euro', cage: 'cage'};
  // Source inventory stores mass per contained unit, which may be below the
  // direct-actor minimum after splitting a very light authored package.
  const variant = spec.variant || fallback[spec.type] || 'box-medium', config = productEquipment.normalize(Object.assign({}, productEquipment.defaults(variant), spec,
    {variant, sku: spec.id || 'product', productType: spec.type || 'box', mass: Number.isFinite(spec.mass) ? Math.max(.01, Math.min(3000, spec.mass)) : productEquipment.defaults(variant).mass}));
  if (load.loadMode !== 'pallet') {
    const root = createProduct(variant, config); root.userData.sourceProduct.massIsTotal = false; root.userData.sourceProduct.mass = Number.isFinite(spec.mass) ? spec.mass : 1;
    root.userData.sourceProduct.units = productSources.unitsFor(load, spec); root.userData.productUnits = root.userData.sourceProduct.units;
    return root;
  }
  const plan = productSources.palletPlan(spec, load), base = productSources.pallets.dimensions(load, true);
  const placements = plan.placements || Array.from({length: plan.units}, (_, i) => ({x: (i % load.palletColumns) * (spec.width + .02) + (plan.width - load.palletColumns * (spec.width + .02) + .02) / 2,
    z: (Math.floor(i / load.palletColumns) % load.palletRows) * (spec.depth + .02) + (plan.depth - load.palletRows * (spec.depth + .02) + .02) / 2, y: Math.floor(i / (load.palletColumns * load.palletRows)) * spec.height, width: spec.width, depth: spec.depth}));
  const values = Object.assign({}, config, {variant: 'pallet-loaded', width: plan.width, depth: plan.depth, height: plan.height, palletHeight: base.height, units: plan.units, loadMode: 'pallet', palletMaterial: base.material});
  const root = cargo(values, 'pallet-loaded', placements, config);
  root.userData.industrialStickerAnchors = [{id: 'shipping', position: [0, base.height * .12, plan.depth / 2], normal: [0, 0, 1], size: [Math.min(.18, plan.width * .2), base.height * .18]}];
  root.userData.sourceProduct = Object.assign({}, config, {id: spec.id || 'product', sku: spec.id || 'product', label: spec.name || 'Producto', type: spec.type || 'box', width: plan.width, depth: plan.depth, height: plan.height,
    units: productSources.unitsFor(load, spec), loadMode: 'pallet', palletType: load.palletType || 'custom', palletMaterial: base.material, palletTare: base.tare, base: 'runners', mass: Number.isFinite(spec.mass) ? spec.mass : 1, massIsTotal: false,
    productWidth: spec.width, productHeight: spec.height, productDepth: spec.depth, palletColumns: load.palletColumns || 2, palletRows: load.palletRows || 2, palletLayers: load.palletLayers || 1, palletPacking: load.palletPacking || 'grid', forkPockets: root.userData.forkPockets}); root.userData.productUnits = productSources.unitsFor(load, spec); return root;
}
