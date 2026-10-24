// Surface identity on real industrial geometry: no browser, rendering or user data.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');
function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    .replace(/^import .*$/mg, '').replace(/export const /g, 'const ').replace(/export function /g, 'function ');
}
const {createIndustrialPrefab} = new Function('THREE', 'behaviorSchema', source('src/editor/IndustrialPrefabs.js') + '\nreturn {createIndustrialPrefab};')(THREE, behaviorSchema);
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', source('src/editor/SceneDocument.js').replace('export default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, createIndustrialPrefab);
function surfaces(root) {
  const result = new Map();
  root.traverse(node => {
    if (!node.isMesh) return;
    (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => {
      if (material.name) result.set(material.name, material);
    });
  });
  return result;
}
function surface(root, name) {
  const result = surfaces(root).get(name);
  assert(result, 'Missing independently editable surface: ' + name);
  return result;
}
function count(root) {
  let meshes = 0, triangles = 0;
  root.traverse(node => {
    if (!node.isMesh) return;
    meshes++;
    triangles += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3;
  });
  return {meshes, triangles};
}

async function run() {
  // Exact pre-customization budgets, rather than a looser new geometry budget.
  // Naming/editability must not unbatch bolts or add any render geometry.
  const budgets = {
    conveyor: [123, 14792], source: [31, 1806], processor: [63, 4012],
    palletQueue: [20, 1546], product: [5, 86], sensor: [8, 288], plc: [44, 2456],
    'belt-start': [97, 7872], 'roller-curve-left': [95, 10028], 'belt-tee-split': [99, 10040]
  };
  Object.entries(budgets).forEach(([kind, [meshes, triangles]]) => {
    const conveyorVariant = kind.includes('-');
    const root = createIndustrialPrefab(conveyorVariant ? 'conveyor' : kind, conveyorVariant ? kind : undefined);
    assert.deepEqual(count(root), {meshes, triangles}, kind + ' must retain its existing draws and triangle count.');
  });

  const root = createIndustrialPrefab('conveyor');
  const partNames = [
    'Bastidor / Larguero de acero',
    'Bastidor / Ala superior del perfil',
    'Bastidor / Cojinete sellado',
    'Soportes telescópicos / Tubo exterior de pata',
    'Soportes telescópicos / Pie antivibratorio',
    'Rodillos / Acero de los rodillos',
    'Motor eléctrico / Carcasa del motor eléctrico',
    'Motor eléctrico / Aleta longitudinal de refrigeración',
    'Reductor angular / Reductor de tornillo sin fin',
    'Montaje y transmisión / Ménsula compacta del motor',
    'Armario',
    'Armario y pedestal / Frente de puerta',
    'Armario y pedestal / Pedestal del tablero'
  ];
  const parts = partNames.map(name => surface(root, name));
  assert.equal(new Set(parts).size, parts.length, 'Different physical surfaces must not share an editable material instance.');
  const motor = surface(root, 'Motor eléctrico / Carcasa del motor eléctrico');
  const reducer = surface(root, 'Reductor angular / Reductor de tornillo sin fin');
  const reducerColor = reducer.color.getHex();
  const panelColor = surface(root, 'Armario').color.getHex();
  motor.color.set('#bd3828'); motor.roughness = 0.7; motor.metalness = 0.45;
  assert.equal(reducer.color.getHex(), reducerColor);
  assert.equal(surface(root, 'Armario').color.getHex(), panelColor);

  // A builder may reuse an equal base color across these two groups. The
  // actual editable batches still need distinct materials and correct names.
  const reducerCover = surface(root, 'Reductor angular / Tapa del eje de salida');
  const mountingFlange = surface(root, 'Montaje y transmisión / Brida de acoplamiento al rodillo');
  assert.notEqual(reducerCover, mountingFlange);
  assert.equal(reducerCover.color.getHex(), mountingFlange.color.getHex());
  reducerCover.color.set('#efefef');
  assert.notEqual(reducerCover.color.getHex(), mountingFlange.color.getHex());

  const other = createIndustrialPrefab('conveyor');
  partNames.forEach(name => assert.notEqual(surface(root, name), surface(other, name), 'A new machine owns its surfaces: ' + name));
  assert.equal(surface(other, 'Motor eléctrico / Carcasa del motor eléctrico').color.getHexString(), 'a7b3b9');
  assert.notEqual(surface(root, 'Rodillos / Acero de los rodillos').map, surface(other, 'Rodillos / Acero de los rodillos').map);
  assert.equal(surface(root, 'Rodillos / Acero de los rodillos').map.wrapS, THREE.RepeatWrapping);
  assert.equal(surface(root, 'Rodillos / Acero de los rodillos').metalness, 0.87);

  const config = root.userData.editorDefaultBehaviors.find(value => value.type === 'conveyor');
  const sensors = root.children.slice(4, 6), panel = root.children[6], controls = panel.children.filter(node => node.userData.editorPrefabKey === 'control');
  const ids = [root, ...sensors, panel, ...controls].map((node, index) => {
    node.userData.editorId = 'test-stable-' + index;
    return {node, uuid: node.uuid, id: node.userData.editorId};
  });
  const stablePartNames = partNames.filter(name => !name.includes('Aleta longitudinal'));
  [
    {length: 6.2, width: 1.4},
    {layout: 'curveLeft', radius: 2.1, curveAngle: 90},
    {layout: 'tee', branchLength: 2.2, branchSide: 'right'},
    {surface: 'belt'},
    {surface: 'rollers', layout: 'straight', length: 3.2}
  ].forEach(change => {
    Object.assign(config, change); createIndustrialPrefab.refresh(root, config);
    stablePartNames.forEach(name => surface(root, name));
    ids.forEach(({node, uuid, id}) => {
      assert.equal(node.uuid, uuid); assert.equal(node.userData.editorId, id);
      assert(node === root || node.parent, 'Geometry changes must keep the original editable actor nodes.');
    });
    if (config.surface === 'belt') {
      assert(surface(root, 'Superficie de la cinta').map);
      assert(surface(root, 'Bastidor / Retorno de la cinta'));
    }
  });
  assert.equal(surface(root, 'Motor eléctrico / Carcasa del motor eléctrico'), motor, 'Dimension changes preserve unchanged motor material identity.');
  const protectedNodes = [];
  root.traverse(node => {
    if (node.userData.industrialDisplay || node.userData.industrialButton || node.userData.industrialSensorLamp || node.userData.industrialTower) protectedNodes.push(node);
  });
  assert.equal(protectedNodes.length, 16, 'HMI, 9 buttons, 2 sensor indicators and 4 tower lights retain their runtime tags.');
  assert.equal(root.children[3].children[0].name, 'Motor eléctrico');
  root.children[3].traverse(node => {
    if (node.isMesh) assert.equal(node.name, 'Herrajes / Motorreductor', 'Keep existing persisted mechanical selectors intact.');
  });

  const sourceRoot = createIndustrialPrefab('source');
  ['Bastidor / FIFO / Mesa de próxima carga', 'Bastidor / FIFO / Superficie antideslizante', 'Soportes del generador / Pata de acero', 'Armario Source'].forEach(name => surface(sourceRoot, name));
  const processor = createIndustrialPrefab('processor');
  ['Celda de proceso / Mesa de proceso inoxidable', 'Celda de proceso / Bancada de la máquina', 'Celda de proceso / Resguardo posterior transparente', 'Apoyos de la máquina de proceso / Pie antivibración', 'Armario y pedestal Processor / Puerta Processor'].forEach(name => surface(processor, name));
  const queue = createIndustrialPrefab('palletQueue');
  const wood = surface(queue, 'Pallet de salida / Tablas de madera');
  assert(wood.map && wood.metalness === 0 && wood.roughness > 0.9);

  const document = new SceneDocument({}); document.registerRoom('hall', new THREE.Group());
  const authored = document.addPrefab('hall', 'conveyor'), id = authored.userData.editorId;
  const originalPaths = [...document.additions.get(id).nodes].map(([partPath, node]) => [partPath, node.userData.editorId]);
  const copied = await document.duplicate(authored);
  assert.notEqual(copied.userData.editorId, id);
  partNames.forEach(name => assert.notEqual(surface(authored, name), surface(copied, name), 'Duplicating creates independent editable surfaces.'));
  assert.deepEqual([...document.additions.get(id).nodes].map(([partPath, node]) => [partPath, node.userData.editorId]), originalPaths);
  assert.equal(document.additions.get(id).nodes.get('6.2').name, 'Arranque');
  assert.equal(document.additions.get(id).nodes.get('6.4').name, 'Emergencia / rearme');
  console.log('Industrial material parts: semantic surfaces, independent materials, stable actor paths and unchanged WebXR geometry budgets passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
