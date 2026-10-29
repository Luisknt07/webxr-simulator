import * as THREE from 'three';
import materialSchema from '../../../../../packages/render-three/schema/materials.js';
import wearSchema from '../../../../../packages/render-three/schema/wear.js';
import {applyIndustrialFinishes} from './IndustrialFinishes.js';

const AGING_PREFIX = 'industrial-aging-v1-';
const AGING_TYPES = new Set(['conveyor', 'source', 'processor', 'palletQueue']);
const ROUND_AGING = values => values.map(value => Math.round(value * 1e8) / 1e8);
function generatedFinish(config) { return /^Industrial · /u.test(config.name || ''); }
function agingSeed(object, options) {
  if (Number.isInteger(options.seed)) return 71 + Math.abs(options.seed) % 64000;
  const key = object.userData.editorId || object.name || object.userData.editorPrefabKey; let value = 2166136261;
  for (let index = 0; index < key.length; index++) value = Math.imul(value ^ key.charCodeAt(index), 16777619);
  return 71 + (value >>> 0) % 64000;
}
function agingProtected(mesh, owner) {
  if (!mesh.isMesh || !mesh.geometry || mesh.userData.editorGeometryReplaced) return true;
  for (let node = mesh; node; node = node.parent) {
    const data = node.userData || {};
    if (data.editorHelper || data.editorRuntimeHelper || data.editorDecal || data.editorVisualOwnerId || data.industrialDisplay || data.industrialButton || data.industrialTower || data.industrialSensorLamp || data.industrialSensorVolume) return true;
    if (/rótulo|etiqueta|pantalla|baliza|identificación/i.test(node.name || '')) return true;
    if (node === owner) break;
  }
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return list.every(material => !material || material.isShaderMaterial || material.transparent && material.opacity < .85);
}
function agingGroup(owner, names) { return names.map(name => owner.getObjectByName(name)).find(Boolean); }
// Pick actual triangles on constructive parts. Projection never assumes that
// an actor AABB corner contains steel, and never touches protected controls.
function agingFaces(owner, group, top = false) {
  if (!group) return [];
  owner.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().getInverse(owner.matrixWorld), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), edge = new THREE.Vector3(), normal = new THREE.Vector3();
  const faces = []; let budget = 24000;
  group.traverse(mesh => {
    if (agingProtected(mesh, owner) || budget <= 0) return;
    const position = mesh.geometry.attributes && mesh.geometry.attributes.position, index = mesh.geometry.index; if (!position) return;
    const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld), count = Math.min(index ? index.count : position.count, budget * 3);
    for (let at = 0; at + 2 < count; at += 3) {
      budget--;
      a.fromBufferAttribute(position, index ? index.getX(at) : at).applyMatrix4(matrix); b.fromBufferAttribute(position, index ? index.getX(at + 1) : at + 1).applyMatrix4(matrix); c.fromBufferAttribute(position, index ? index.getX(at + 2) : at + 2).applyMatrix4(matrix);
      normal.copy(b).sub(a).cross(edge.copy(c).sub(a)); const area = normal.length(); if (area < .001 || !Number.isFinite(area)) continue; normal.divideScalar(area);
      if (top ? normal.y < .85 : normal.z < .8 || Math.abs(normal.y) > .35) continue;
      const center = a.clone().add(b).add(c).divideScalar(3), vertices = [a.clone(), b.clone(), c.clone()];
      const edges = [[0, 1], [1, 2], [2, 0]].map(([i, j]) => ({a: vertices[i], b: vertices[j], length: vertices[i].distanceTo(vertices[j]), y: (vertices[i].y + vertices[j].y) / 2}));
      const longest = Math.max(...edges.map(row => row.length)), broad = edges.filter(row => row.length >= longest * .55);
      faces.push({center, normal: normal.clone(), area, score: area * (1 + Math.max(0, center.z) * .12), upper: broad.slice().sort((x, y) => y.y - x.y)[0], lower: broad.slice().sort((x, y) => x.y - y.y)[0]});
    }
  });
  return faces.sort((a, b) => b.score - a.score);
}
function agingPose(point, normal) { return new THREE.Matrix4().compose(point.clone().addScaledVector(normal, .0015), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal), new THREE.Vector3(1, 1, 1)); }
function agingLayer(id, pattern, poses, options) {
  if (!poses.length) return null;
  const base = poses[0], inverse = new THREE.Matrix4().getInverse(base);
  const stamps = poses.length === 1 ? [] : poses.map(pose => {
    const local = new THREE.Matrix4().multiplyMatrices(inverse, pose), p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3(); local.decompose(p, q, scale);
    return {position: ROUND_AGING(p.toArray()), quaternion: ROUND_AGING(q.normalize().toArray()), scale: [1, 1, 1]};
  });
  const matrix = ROUND_AGING(base.toArray()); matrix[3] = matrix[7] = matrix[11] = 0; matrix[15] = 1;
  return Object.assign({id: AGING_PREFIX + id, pattern, color: '#ffffff', width: .5, height: .2, depth: .035, opacity: .78, density: .78, roughness: .8, metalness: .02, seed: 71, matrix, stamps}, options);
}
function agingLayers(owner, seed) {
  const frame = agingGroup(owner, ['Bastidor', 'Bastidor / FIFO', 'Celda de proceso', 'Bastidor de la plataforma', 'Tablas y herrajes de la estiba']);
  const legs = agingGroup(owner, ['Soportes telescópicos', 'Apoyos de la máquina de proceso', 'Soportes del generador', 'Bastidor / FIFO', 'Tablas y herrajes de la estiba']);
  const cabinet = agingGroup(owner, ['Armario y pedestal Processor']);
  const side = agingFaces(owner, frame)[0], cabinetSide = agingFaces(owner, cabinet)[0], lower = agingFaces(owner, legs), result = [];
  const add = layer => { if (layer) result.push(layer); };
  const edgePoses = [];
  for (const face of [side, cabinetSide].filter(Boolean)) for (const fraction of [.18, .79]) edgePoses.push(agingPose(face.upper.a.clone().lerp(face.upper.b, fraction).add(new THREE.Vector3(0, -.008, 0)), face.normal));
  const wood = owner.userData.editorPrefabKey === 'palletQueue';
  add(agingLayer('edge-chips', 'chipped', edgePoses.slice(0, 4), {color: wood ? '#c8b88e' : '#ffffff', width: .52, height: .085, opacity: .92, density: .84, roughness: wood ? .86 : .49, metalness: wood ? 0 : .72, seed}));
  const dirtPoses = [], used = [];
  lower.forEach(face => { if (dirtPoses.length >= 2 || used.some(point => Math.abs(point.x - face.center.x) < .3)) return; used.push(face.center); dirtPoses.push(agingPose(face.lower.a.clone().lerp(face.lower.b, .5).add(new THREE.Vector3(0, .11, 0)), face.normal)); });
  add(agingLayer('lower-frame-dirt', 'grime', dirtPoses, {color: '#b4a28b', width: .20, height: .32, depth: .055, opacity: .86, density: .92, roughness: .94, seed: seed + 1}));
  const panel = cabinetSide || side;
  if (panel) {
    add(agingLayer('panel-runoff', 'grime', [agingPose(panel.center, panel.normal)], {color: '#b5a893', width: .32, height: cabinetSide ? .52 : .22, opacity: .72, density: .72, roughness: .78, seed: seed + 2}));
    if (!wood) add(agingLayer('joint-oxidation', 'rust', [agingPose(panel.upper.a.clone().lerp(panel.upper.b, .12).add(new THREE.Vector3(0, -.035, 0)), panel.normal)], {width: .105, height: .085, opacity: .56, density: .72, roughness: .95, metalness: 0, seed: seed + 3}));
  }
  const motor = agingGroup(owner, ['Motor eléctrico', 'Reductor angular', 'Montaje y transmisión']), motorFace = agingFaces(owner, motor)[0];
  if (motorFace) add(agingLayer('drive-grease', 'grime', [agingPose(motorFace.center, motorFace.normal)], {color: '#8d8069', width: .24, height: .18, depth: .07, opacity: .88, density: .9, roughness: .30, metalness: .12, seed: seed + 4}));
  if (owner.userData.editorPrefabKey === 'source' || owner.userData.editorPrefabKey === 'processor') {
    const tops = agingFaces(owner, frame, true).filter(face => Math.abs(face.center.y) < .12), top = tops[0];
    if (top) add(agingLayer('worktop-rubbing', 'scratches', [agingPose(top.center, top.normal)], {width: .72, height: .28, opacity: .76, density: .86, roughness: .26, metalness: .82, seed: seed + 5}));
  }
  return result;
}

/** Reversible actor-owned coatings only. Typed mechanical recipes, custom PBR
 * assignments, existing brush strokes, geometry and native UI are preserved. */
export function applyIndustrialAging(document, roomId, objects, options = {}) {
  const candidates = Array.from(new Set(objects || document.getObjects(roomId))).filter(object => AGING_TYPES.has(object.userData.editorPrefabKey));
  const report = {objects: 0, layers: 0, stamps: 0, finishes: 0, skippedCustom: 0}, own = !document.transaction;
  if (own) document.begin();
  try {
    candidates.forEach(object => {
      let behaviors = document.getBehaviors(object), material = behaviors.find(value => value.type === 'surfaceMaterial'), wear = behaviors.find(value => value.type === 'surfaceWear');
      if (object.userData.editorColor || object.userData.editorVisualOwnerId || material && (!material.enabled || materialSchema.assignments(material).some(row => !generatedFinish(row))) || wear && (!wear.enabled || !material && wearSchema.normalizeLayers(wear.layers).some(layer => !layer.id.startsWith(AGING_PREFIX)))) { report.skippedCustom++; return; }
      if (!material) {
        const result = applyIndustrialFinishes(document, roomId, [object], {decals: false}); report.finishes += result.assignments;
        behaviors = document.getBehaviors(object); material = behaviors.find(value => value.type === 'surfaceMaterial');
      }
      if (!material) return;
      const seed = agingSeed(object, options);
      const assignments = materialSchema.assignments(material).map(row => {
        const next = Object.assign({}, row, {seed, wear: ['paintedMetal', 'steel', 'aluminum'].includes(row.preset) ? row.preset === 'paintedMetal' ? .30 : .24 : row.wear, wearType: row.preset === 'paintedMetal' ? 'chips' : row.wearType});
        if (/^name:Mesa de (?:proceso inoxidable|próxima carga)/u.test(row.slot)) { next.repeatX = 3; next.repeatY = 8; }
        return next;
      });
      // Older generated finishes did not include the Processor cabinet at all.
      if (object.getObjectByName('Armario y pedestal Processor') && !assignments.some(row => row.slot === 'part:Armario y pedestal Processor') && assignments.length < materialSchema.MAX_ASSIGNMENTS) assignments.push(Object.assign({type: 'surfaceMaterial', enabled: true}, materialSchema.getPreset('paintedMetal'), {slot: 'part:Armario y pedestal Processor', name: 'Industrial · Armario usado', color: '#69716d', roughness: .68, metalness: .24, clearcoat: .06, wear: .30, wearType: 'chips', seed}));
      const layers = wearSchema.normalizeLayers(agingLayers(object, seed)), previous = wear ? JSON.parse(wear.layers).filter(layer => !layer.id.startsWith(AGING_PREFIX)) : [];
      if (previous.length + layers.length > wearSchema.MAX_LAYERS || previous.concat(layers).reduce((sum, layer) => sum + Math.max(1, layer.stamps.length), 0) > wearSchema.MAX_LAYER_STAMPS) { report.skippedCustom++; return; }
      const next = behaviors.filter(value => !['surfaceMaterial', 'surfaceWear'].includes(value.type)).concat(materialSchema.fromAssignments(assignments), {type: 'surfaceWear', enabled: true, layers: JSON.stringify(previous.concat(layers))});
      if (JSON.stringify(next) !== JSON.stringify(behaviors)) document.setBehaviors(object, next);
      report.objects++; report.layers += layers.length; report.stamps += layers.reduce((sum, layer) => sum + Math.max(1, layer.stamps.length), 0);
    });
    if (own) document.commit(); return report;
  } catch (error) { if (own) document.cancel(); throw error; }
}

/** JSON migration adapter. The caller supplies the real prefab constructed
 * from the same saved mechanical configuration, and owns its disposal. */
export function ageIndustrialRecord(record, object, options = {}) {
  const copy = JSON.parse(JSON.stringify(record));
  object.userData.editorId = record.id; object.userData.editorBehaviors = copy.behaviors || [];
  const document = {transaction: {}, getObjects: () => [object], getBehaviors: item => item.userData.editorBehaviors || [], setBehaviors: (item, values) => { item.userData.editorBehaviors = values; }};
  const report = applyIndustrialAging(document, options.roomId || 'hall', [object], options);
  copy.behaviors = JSON.parse(JSON.stringify(object.userData.editorBehaviors)); return {record: copy, report};
}

export function ageIndustrialFloorRecord(record) {
  const copy = JSON.parse(JSON.stringify(record)); let changed = false;
  (copy.behaviors || []).filter(value => value.type === 'surfaceWear' && value.enabled !== false).forEach(value => {
    const layers = JSON.parse(value.layers).map(layer => {
      if (!layer.id.startsWith('industrial-floor-v1-')) return layer;
      const key = layer.id.slice('industrial-floor-v1-'.length), values = {
        'motor-oil': {width: .70, height: .45, opacity: .64, density: .8, roughness: .36},
        'station-scratches': {width: 1.35, height: .32, opacity: .50, density: .78},
        'wheel-traces': {width: .19, height: 2.4, opacity: .46, density: .78},
        'border-dirt': {width: .48, height: 3.6, opacity: .48, density: .76}
      }[key];
      if (!values) return layer; changed = true; return Object.assign({}, layer, values);
    });
    if (changed) { wearSchema.normalizeLayers(layers); value.layers = JSON.stringify(layers); }
  });
  return {record: copy, changed};
}
