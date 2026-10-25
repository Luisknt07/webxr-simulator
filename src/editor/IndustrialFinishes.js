import * as THREE from 'three';
import materialSchema from '../../shared/materials.js';
import wearSchema from '../../shared/wear.js';

const EQUIPMENT = new Set(['conveyor', 'source', 'processor', 'palletQueue']);
const GROUPS = [
  ['Bastidor', 'paintedMetal', '#355567'], ['Bastidor de la plataforma', 'paintedMetal', '#355567'],
  ['Soportes telescópicos', 'paintedMetal', '#4b606b'], ['Rodillos', 'steel', '#d2dce1'],
  ['Motor eléctrico', 'aluminum', '#aebec6'], ['Reductor angular', 'paintedMetal', '#285991'],
  ['Montaje y transmisión', 'steel', '#a3b4bf'], ['Bastidor / FIFO', 'paintedMetal', '#476676'],
  ['Soportes del generador', 'paintedMetal', '#526774'], ['Celda de proceso', 'paintedMetal', '#416574'],
  ['Apoyos de la máquina de proceso', 'paintedMetal', '#4b606b'], ['Cabezal móvil de proceso', 'steel', '#bbc9d2'],
  ['Tablas y herrajes de la estiba', 'wood', '#b49361'], ['Mesa de unión / lengüeta central', 'steel', '#c2cbd0'],
  ['Placa de empalme', 'steel', '#b8c6ce'], ['Rodamientos de unión', 'steel', '#b8c6ce'],
  ['Carro de elevación', 'paintedMetal', '#355567'], ['Armario y pedestal Processor', 'paintedMetal', '#69716d']
];
const MATERIAL_KEYS = ['surfaceMaterial', 'surfaceWear'];
function materials(mesh) { return Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []; }
function protectedSurface(mesh, owner) {
  if (!mesh.isMesh || !mesh.geometry || mesh.userData.editorGeometryReplaced) return true;
  for (let node = mesh; node; node = node.parent) {
    const data = node.userData || {};
    if (data.editorHelper || data.editorRuntimeHelper || data.editorVisualOwnerId || data.industrialButton || data.industrialDisplay ||
      data.industrialTower || data.industrialSensorLamp || data.industrialSensorVolume ||
      node !== owner && ['control', 'sensor', 'plc'].includes(data.editorPrefabKey) ||
      /rótulo|etiqueta|leyenda|pantalla|baliza|piloto|código|identificación/i.test(node.name || '')) return true;
    if (node === owner) break;
  }
  return false;
}
function customized(object) {
  let found = false;
  object.traverse(node => {
    const data = node.userData || {};
    if (data.editorColor || data.editorVisualOwnerId || (data.editorBehaviors || []).some(value => MATERIAL_KEYS.includes(value.type))) found = true;
  });
  return found;
}
function finish(slot, preset, color, wear, seed) {
  const config = Object.assign({type: 'surfaceMaterial', enabled: true}, materialSchema.getPreset(preset), {slot, color, seed,
    name: 'Industrial · ' + materialSchema.getPreset(preset).name, wear: ['steel', 'aluminum', 'paintedMetal'].includes(preset) ? wear : 0,
    wearType: 'scratches', wearScale: 1.5});
  if (preset === 'paintedMetal') Object.assign(config, {metalness: .28, roughness: .56, clearcoat: .14, clearcoatRoughness: .45});
  if (preset === 'steel') Object.assign(config, {metalness: .86, roughness: .36});
  if (preset === 'aluminum') Object.assign(config, {metalness: .85, roughness: .42});
  if (preset === 'rubber') config.roughness = .95;
  if (preset === 'wood') config.roughness = .86;
  return config;
}
function exception(name, original) {
  if (/reductor de tornillo sin fin/i.test(name)) return null;
  if (/resguardo.*transparente|vidrio/i.test(name)) return ['glass', '#d8eef1'];
  if (/antideslizante|antivibr|pie nivelador|cojinete|pomo|junta|retén|cable|prensaestopas|rejilla|retorno.*cinta|superficie de la cinta/i.test(name)) return ['rubber', '#303b42'];
  if (/modular.*polímero|banda modular/i.test(name)) return ['plastic', '#497b92'];
  if (/mesa de próxima carga/i.test(name)) return ['steel', '#c4d0d7', {roughness: .72, repeatX: 3, repeatY: 8}];
  if (/mesa de proceso inoxidable/i.test(name)) return ['steel', '#a9aaa0', {roughness: .58, repeatX: 3, repeatY: 8}];
  if (/perfil.*resguardo|travesaño.*pórtico|larguero de aluminio/i.test(name)) return ['aluminum', '#a4aaa4', {roughness: .46}];
  if (/tornillo|tuerca|perno|arandela|husillo|rosca|clavo|brida|vástago|tirador|fijación|inoxidable|aluminio|acero.*rodillo|rodamiento|placa de empalme|guía lineal|casquillo/i.test(name)) return ['steel', '#c4d0d7'];
  if (/precaución|amarilla|seguridad/i.test(name)) return ['paintedMetal', original.color ? '#' + original.color.getHexString() : '#e3b935'];
  return null;
}

// Find a real broad side triangle, rather than projecting at an AABB corner
// that may lie in empty air on a curved or inclined piece of equipment.
function scratchLayer(object, wear, seed) {
  const structure = ['Bastidor', 'Bastidor / FIFO', 'Celda de proceso', 'Tablas y herrajes de la estiba']
    .map(name => object.getObjectByName(name)).find(Boolean);
  if (!structure) return null;
  object.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().getInverse(object.matrixWorld);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), edge = new THREE.Vector3(), normal = new THREE.Vector3();
  let chosen = null, largest = 0;
  structure.traverse(mesh => {
    if (protectedSurface(mesh, object)) return;
    const geometry = mesh.geometry, positions = geometry.attributes && geometry.attributes.position, indices = geometry.index;
    if (!positions) return;
    const relative = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    const count = Math.min(indices ? indices.count : positions.count, 120000);
    for (let index = 0; index + 2 < count; index += 3) {
      a.fromBufferAttribute(positions, indices ? indices.getX(index) : index).applyMatrix4(relative);
      b.fromBufferAttribute(positions, indices ? indices.getX(index + 1) : index + 1).applyMatrix4(relative);
      c.fromBufferAttribute(positions, indices ? indices.getX(index + 2) : index + 2).applyMatrix4(relative);
      normal.copy(b).sub(a).cross(edge.copy(c).sub(a));
      const area = normal.length();
      if (area <= largest || area < .005 || !Number.isFinite(area)) continue;
      normal.divideScalar(area);
      if (Math.abs(normal.y) > .45) continue;
      largest = area; chosen = {point: a.clone().add(b).add(c).divideScalar(3), normal: normal.clone()};
    }
  });
  if (!chosen) return null;
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), chosen.normal);
  const matrix = new THREE.Matrix4().compose(chosen.point.addScaledVector(chosen.normal, .001), quaternion, new THREE.Vector3(1, 1, 1));
  const wood = object.userData.editorPrefabKey === 'palletQueue';
  return {id: 'industrial-light-scratches', pattern: 'scratches', color: wood ? '#d5bf97' : '#ffffff', width: .30, height: .065, depth: .025,
    opacity: Math.min(.38, wear * 2), density: .38, roughness: wood ? .85 : .48, metalness: wood ? 0 : .6, seed, matrix: matrix.toArray(), stamps: []};
}

/** Persist editable part finishes on explicitly supplied new equipment. The
 * ordinary surface/wear engines own all derived GPU resources and cleanup. */
export function applyIndustrialFinishes(document, roomId, objects, options = {}) {
  const result = {objects: [], assignments: 0, wearLayers: 0, decals: 0, skipped: []};
  const wear = Number.isFinite(options.wear) ? Math.max(0, Math.min(.5, options.wear)) : .12;
  const seed = Number.isInteger(options.seed) ? Math.max(0, Math.min(65535, options.seed)) : 19;
  const available = new Set(document.getObjects(roomId));
  const candidates = Array.from(new Set(objects || available)).filter(object => object && EQUIPMENT.has(object.userData.editorPrefabKey));
  const own = !document.transaction;
  if (own) document.begin();
  try {
    candidates.forEach(object => {
      if (!available.has(object) || options.preserveCustom !== false && customized(object)) { result.skipped.push(object); return; }
      const assignments = [], seen = new Set();
      const add = (slot, preset, color, extra) => {
        if (seen.has(slot) || assignments.length >= materialSchema.MAX_ASSIGNMENTS || slot.length > 220) return;
        seen.add(slot); assignments.push(Object.assign(finish(slot, preset, color, wear, seed), extra || {}));
      };
      GROUPS.forEach(([name, preset, color]) => { if (object.getObjectByName(name)) add('part:' + name, preset, color); });
      object.traverse(mesh => {
        if (protectedSurface(mesh, object)) return;
        materials(mesh).forEach(original => {
          if (!original.name || original.isShaderMaterial || original.isRawShaderMaterial) return;
          const profile = exception(original.name, original);
          if (profile) add('name:' + original.name, profile[0], profile[1], profile[2]);
        });
      });
      if (!assignments.length) { result.skipped.push(object); return; }
      const behaviors = document.getBehaviors(object).filter(value => value.type !== 'surfaceMaterial');
      behaviors.push(materialSchema.fromAssignments(assignments));
      if (wear > 0 && options.decals !== false && !behaviors.some(value => value.type === 'surfaceWear')) {
        const layer = scratchLayer(object, wear, seed);
        if (layer) { behaviors.push({type: 'surfaceWear', enabled: true, layers: wearSchema.normalizeLayerJSON([layer])}); result.wearLayers++; result.decals++; }
      }
      document.setBehaviors(object, behaviors);
      result.objects.push(object); result.assignments += assignments.length;
    });
    if (own) document.commit();
    return result;
  } catch (error) { if (own) document.cancel(); throw error; }
}
