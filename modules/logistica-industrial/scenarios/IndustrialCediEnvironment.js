import * as THREE from 'three';
import schema from '../contracts/behaviors.js';

/** Persisted warehouse shell shared by the teaching lab and complete lines.
 * Dimensions are metres; fixtures emit visually, while at most eight real
 * unshadowed point lights provide the room's bounded interior illumination. */
export function buildCediEnvironment(document, roomId, specification = {}, options = {}) {
  const positive = (value, fallback, minimum, maximum) => Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
  const width = positive(specification.width, 72, 16, 240), depth = positive(specification.depth, 120, 20, 240);
  const centerZ = Number.isFinite(specification.centerZ) ? specification.centerZ : 0, height = 8;
  const objects = [], walls = [], fixtures = [], lights = [], lightEntities = [], structure = [];
  const own = !document.transaction; if (own) document.begin();
  const solid = schema.defaultBehavior('collision');
  const finish = (color, values = {}) => Object.assign(schema.defaultBehavior('surfaceMaterial'), {color, colorMapMode: 'none', metalness: 0, roughness: .9, clearcoat: 0}, values);
  function part(name, color, position, scale, material, collision = false) {
    const object = document.addPrimitive(roomId, 'box', color);
    document.setProperty(object, 'name', 'CEDI · ' + name); document.setTransform(object, {position, scale});
    document.setBehaviors(object, (collision ? [solid] : []).concat(material ? [material] : [])); objects.push(object); return object;
  }
  function wear(object, layers) {
    document.setBehaviors(object, document.getBehaviors(object).filter(value => value.type !== 'surfaceWear').concat({type: 'surfaceWear', enabled: true, layers: JSON.stringify(layers)}));
  }
  function projector(object, point, normal) {
    object.updateWorldMatrix(true, false);
    const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const world = new THREE.Matrix4().compose(point, orientation, new THREE.Vector3(1, 1, 1));
    const values = new THREE.Matrix4().getInverse(object.matrixWorld).multiply(world).toArray();
    values[3] = 0; values[7] = 0; values[11] = 0; values[15] = 1; return values;
  }
  try {
    let floor = specification.floor === false ? options.floorObject || null : part('Piso de hormigón mate', '#777c76', [0, -.06, centerZ], [width, .12, depth],
      finish('#777c76', {preset: 'concrete', roughness: .97, colorMapMode: 'preserve', repeatX: width / 4, repeatY: depth / 4}), true);
    if (floor && specification.floor !== false) document.setBehaviors(floor, document.getBehaviors(floor).concat(schema.defaultBehavior('teleport')));
    if (floor) {
      const stamps = [];
      for (const lane of [-1, 1]) for (const segment of [-.28, 0, .28]) for (const tire of [-1, 1]) stamps.push({position: [lane * width * .24 + tire * .22, -depth * segment, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1]});
      wear(floor, [{id: 'cedi-floor-tire-wear', pattern: 'grime', color: '#39403c', width: .14, height: 4.8, depth: .025,
        opacity: .19, density: .55, roughness: .98, metalness: 0, seed: 432,
        matrix: projector(floor, new THREE.Vector3(0, .003, centerZ), new THREE.Vector3(0, 1, 0)), stamps}]);
    }
    const wallColor = '#858981', wallMaterial = finish(wallColor, {preset: 'concrete', colorMapMode: 'preserve', repeatX: depth / 4, repeatY: 2, wear: .08, wearType: 'dirt'});
    const steel = finish('#48514f', {metalness: .35, roughness: .78, wear: .1});
    const bays = Math.max(2, Math.min(7, Math.ceil(depth / 20))), bayLength = depth / bays, windowLength = Math.min(6, bayLength * .45);
    for (const side of [-1, 1]) {
      const x = side * width / 2;
      const base = part('Muro lateral interior', wallColor, [x, 2.9, centerZ], [.2, 5.8, depth], wallMaterial, true); walls.push(base);
      walls.push(part('Franja superior cerrada', wallColor, [x, 7.4, centerZ], [.2, 1.2, depth], wallMaterial, true));
      for (let index = 0; index < bays; index++) {
        const z = centerZ - depth / 2 + bayLength * (index + .5), infill = (bayLength - windowLength) / 2;
        for (const edge of [-1, 1]) walls.push(part('Paño de cerramiento entre ventanas', wallColor, [x, 6.3, z + edge * (windowLength + infill) / 2], [.2, 1, infill], wallMaterial, true));
        walls.push(part('Ventana alta translúcida', '#a8b7b1', [x, 6.3, z], [.055, 1, windowLength], finish('#a8b7b1', {preset: 'glass', opacity: .32, roughness: .55}), true));
        structure.push(part('Montante de ventana', '#48514f', [x - side * .12, 6.3, z - windowLength / 2], [.045, 1.08, .055], steel));
      }
      structure.push(part('Perfil de antepecho', '#48514f', [x - side * .12, 5.8, centerZ], [.06, .08, depth], steel));
      wear(base, [{id: 'cedi-wall-contact-wear', pattern: 'grime', color: '#4d554c', width: 4, height: 1.3, depth: .04, opacity: .18, density: .35, roughness: .98, metalness: 0, seed: side + 91,
        matrix: projector(base, new THREE.Vector3(x - side * .101, 1.15, centerZ), new THREE.Vector3(-side, 0, 0)),
        stamps: [-.33, 0, .33].map(fraction => ({position: [depth * fraction, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1]}))}]);
    }
    for (const side of [-1, 1]) walls.push(part(side > 0 ? 'Muro de acceso y muelles' : 'Muro posterior', wallColor, [0, 4, centerZ + side * depth / 2], [width, 8, .2], wallMaterial, true));
    // Closed loading docks are architectural details, outside the production
    // graph. Shallow panels and a few ribs suggest shutters without dense mesh.
    for (const side of [-1, 1]) {
      const x = side * width * .30, z = centerZ + depth / 2 - .125;
      structure.push(part('Marco de muelle de carga', '#35423f', [x, 2.25, z], [5.6, 4.5, .10], finish('#35423f', {roughness: .94})));
      structure.push(part('Portón cerrado del muelle', '#667570', [x, 2.2, z - .065], [5.1, 4.1, .035], finish('#667570', {metalness: .18, roughness: .88, wear: .15, wearType: 'dirt'})));
      for (let row = 0; row < 5; row++) structure.push(part('Nervadura del portón', '#53615c', [x, .55 + row * .75, z - .09], [5.05, .025, .025], steel));
      structure.push(part('Protección amarilla de muelle', '#d1ad39', [x - 2.95, .65, z - .12], [.15, 1.3, .15], finish('#d1ad39', {roughness: .94, wear: .18, wearType: 'chips'}), true));
    }
    const rows = Math.max(2, Math.min(4, Math.ceil(depth / 30))), rowSpacing = depth / rows;
    for (let row = 0; row < rows; row++) {
      const z = centerZ - depth / 2 + rowSpacing * (row + .5);
      structure.push(part('Viga transversal de cubierta', '#48514f', [0, 7.65, z], [width, .30, .18], steel));
      for (const side of [-1, 1]) structure.push(part('Columna perimetral', '#48514f', [side * (width / 2 - .25), 3.9, z], [.20, 7.8, .20], steel, true));
      for (const fraction of [-.30, 0, .30]) {
        const x = width * fraction;
        fixtures.push(part('Luminaria LED · carcasa', '#444d49', [x, 7.22, z], [3.4, .16, .55], steel));
        fixtures.push(part('Luminaria LED · difusor luminoso', '#fff0d2', [x, 7.12, z], [3.18, .035, .42],
          finish('#fff0d2', {roughness: .85, emissiveMode: 'custom', emissive: '#fff0d2', emissiveIntensity: 1.1})));
        fixtures.push(part('Suspensión de luminaria', '#48514f', [x, 7.43, z], [.025, .28, .025], steel));
      }
    }
    for (const fraction of [-.3, 0, .3]) structure.push(part('Correa longitudinal de cubierta', '#48514f', [width * fraction, 7.80, centerZ], [.09, .16, depth], steel));
    const roof = part('Cubierta interior cerrada', '#656c65', [0, height, centerZ], [width + .25, .16, depth + .25], finish('#656c65', {metalness: .08, roughness: .94}), true);
    const studio = document.studio || {}, retained = studio.entities || [], existingLights = retained.filter(entity => entity.roomId === roomId && entity.type === 'pointLight').length;
    const budget = Math.max(0, 8 - existingLights);
    for (let row = 0; row < rows; row++) for (const side of [-1, 1]) {
      if (lightEntities.length >= budget) continue;
      const marker = part('Luz interior cálida ' + (lightEntities.length + 1), '#fff0d2', [side * width * .30, 6.94, centerZ - depth / 2 + rowSpacing * (row + .5)], [.04, .04, .04], null);
      lights.push(marker); lightEntities.push({id: 'cedi-light-' + roomId + '-' + marker.userData.editorId, objectId: marker.userData.editorId, roomId, type: 'pointLight', color: '#fff0dc', intensity: .65, range: Math.min(70, Math.max(28, Math.hypot(width * .48, rowSpacing)))});
    }
    const environment = Object.assign(schema.studio.defaultEnvironment(roomId), {sky: 'color', skyColor: '#17201e', horizonColor: '#c5c0b3', groundColor: '#555b52', sunColor: '#fff0d8', sunIntensity: .85, ambientIntensity: .15,
      renderQuality: 'high', shadows: true, exposure: .9});
    document.setStudio({environments: (studio.environments || []).filter(value => value.roomId !== roomId).concat(environment), entities: retained.concat(lightEntities)});
    if (own) document.commit();
    return {objects, floor, fixtures, lights, lightEntities, roof, walls, structure, environment,
      bounds: {width, depth, height, centerZ, min: [-width / 2, 0, centerZ - depth / 2], max: [width / 2, height, centerZ + depth / 2]}, preferredCamera: specification.preferredCamera || null};
  } catch (error) { if (own) document.cancel(); throw error; }
}
