// Local geometry, document history and SQLite validation; no browser/WebGL needed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors');
const {validateDocument} = require('../server/validation');

const prefabSource = fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialPrefabs.js'), 'utf8')
  .replace("import * as THREE from 'three';", '')
  .replace("import behaviorSchema from '../../shared/behaviors.js';", '')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ');
const {industrialPrefabs, createIndustrialPrefab, createProductVisual} = new Function('THREE', 'behaviorSchema', prefabSource + '\nreturn {industrialPrefabs, createIndustrialPrefab, createProductVisual};')(THREE, behaviorSchema);
const documentSource = fs.readFileSync(path.join(__dirname, '../src/editor/SceneDocument.js'), 'utf8')
  .replace("import * as THREE from 'three';", '')
  .replace("import behaviorSchema from '../../shared/behaviors.js';", '')
  .replace("import {createIndustrialPrefab} from './IndustrialPrefabs.js';", '')
  .replace('export default class SceneDocument', 'return class SceneDocument');
const SceneDocument = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', documentSource)(THREE, behaviorSchema, createIndustrialPrefab);

function makeDocument() {
  const document = new SceneDocument({});
  document.registerRoom('hall', new THREE.Group());
  return document;
}

function behavior(document, object, type) {
  return document.getBehaviors(object).find(item => item.type === type);
}

async function run() {
  assert.deepStrictEqual(industrialPrefabs.slice(0, 4).map(item => item.id), ['conveyor', 'sensor', 'plc', 'product']);
  assert.deepStrictEqual(industrialPrefabs.filter(item => item.prefab === 'conveyor').map(item => item.variant), behaviorSchema.conveyorLayout.presetVariants);
  assert(industrialPrefabs.some(item => item.id === 'source') && industrialPrefabs.some(item => item.id === 'queue'));
  assert.throws(() => createIndustrialPrefab('unknown'), /compatible/);
  const visual = createIndustrialPrefab('conveyor');
  assert.deepStrictEqual(visual.children.slice(0, 7).map(child => child.name), ['Bastidor', 'Soportes telescópicos', 'Rodillos', 'Motorreductor', 'Sensor de entrada', 'Sensor de salida', 'PLC simulado / panel de mando'], 'Existing component indices must survive the new visual design.');
  visual.children.slice(7, 10).forEach(anchor => {
    assert.equal(anchor.userData.industrialRetiredSupply, true);
    assert.equal(anchor.visible, false);
    assert.equal(anchor.children.length, 0);
    assert(!anchor.userData.editorPrefabNode && !anchor.userData.editorPrefabKey && !anchor.userData.editorDefaultBehaviors,
      'Retired supply anchors reserve saved paths without creating product actors or editor components.');
  });
  const inputBounds = new THREE.Box3().setFromObject(visual);
  assert(inputBounds.min.x >= -2.10, 'The conveyor input must have no protruding preparation table or included carton.');
  assert(!visual.getObjectByName('Pallet de salida'), 'Built-in conveyor outlet pallets are replaced by explicit Pallet Queue equipment.');
  assert(new THREE.Box3().setFromObject(visual.children[9]).isEmpty(), 'The reserved pallet path has no render or collision geometry.');
  const visualPLC = visual.children[6];
  assert.deepStrictEqual(visualPLC.children.slice(0, 5).map(child => child.name), ['Armario', 'Pantalla', 'Arranque', 'Parada', 'Emergencia / rearme']);
  assert.equal(visualPLC.children[1].userData.industrialDisplay, true);
  const conveyorDefaults = visual.userData.editorDefaultBehaviors.find(item => item.type === 'conveyor');
  assert.equal(conveyorDefaults.running, false); assert.equal(conveyorDefaults.powered, false); assert.equal(conveyorDefaults.autoSpawn, false);
  const visualRollers = visual.children[2].children;
  assert.equal(visualRollers.length, 26);
  assert.equal(new Set(visualRollers.map(roller => roller.geometry)).size, 1, 'All rollers share one cylinder geometry.');
  assert.equal(new Set(visualRollers.map(roller => roller.material)).size, 1);
  visualRollers.forEach(roller => {
    assert.equal(roller.userData.industrialRoller.axis, 'y'); assert.equal(roller.userData.industrialRoller.radius, 0.065);
    assert.equal(roller.userData.industrialRoller.texture, true);
    assert.equal(roller.material.map.wrapS, THREE.RepeatWrapping);
  });
  const sensorVolume = visual.children[4].children.find(child => child.userData.industrialSensorVolume);
  assert(sensorVolume && sensorVolume.geometry.parameters.width === 0.1, 'Detection uses a narrow beam, independently of the mounting posts.');
  const entryLamp = visual.children[4].children.find(child => child.userData.industrialSensorLamp);
  const exitLamp = visual.children[5].children.find(child => child.userData.industrialSensorLamp);
  assert.notStrictEqual(entryLamp.material, exitLamp.material, 'Sensors must be able to illuminate independently.');
  let triangleCount = 0, meshCount = 0;
  visual.traverse(object => {
    if (!object.isMesh) return;
    meshCount++; triangleCount += (object.geometry.index ? object.geometry.index.count : object.geometry.attributes.position.count) / 3;
  });
  assert(triangleCount < 20000, 'Industrial detail must retain a small WebXR triangle budget.');
  assert(meshCount < 140, 'Static fasteners must be merged instead of introducing hundreds of draw calls.');
  const otherVisual = createIndustrialPrefab('conveyor');
  assert.notStrictEqual(visualRollers[0].material.map, otherVisual.children[2].children[0].material.map, 'Independent conveyors own their texture lifecycle.');
  const queueWood = createIndustrialPrefab('palletQueue').children[0].children[0].children.find(mesh => mesh.material.map);
  const otherQueueWood = createIndustrialPrefab('palletQueue').children[0].children[0].children.find(mesh => mesh.material.map);
  assert(queueWood && queueWood.material.roughness > 0.8);
  assert.notStrictEqual(queueWood.material.map, otherQueueWood.material.map, 'Each independent Pallet Queue owns its wood texture.');
  const productVisual = createProductVisual(0.4);
  assert(productVisual.isMesh && productVisual.children.length > 1);
  assert(Math.abs(productVisual.geometry.boundingBox.max.x - 0.2) < 1e-6);
  assert(productVisual.material.map && productVisual.getObjectByName('Etiqueta de envío y código de barras').material.map);
  const independentProduct = createProductVisual(0.4);
  assert.notStrictEqual(productVisual.geometry, independentProduct.geometry);
  assert.notStrictEqual(productVisual.material.map, independentProduct.material.map);
  ['pause', 'powerOff', 'powerOn', 'speedUp', 'speedDown', 'insertBox', 'resetEmergency'].forEach(variant => {
    const button = createIndustrialPrefab('control', variant);
    const config = button.userData.editorDefaultBehaviors[0];
    assert.equal(config.mode, 'command'); assert.equal(config.command, variant);
    assert.equal(button.children[1].userData.industrialButton, true);
  });
  assert.throws(() => createIndustrialPrefab('control', 'unknown'), /compatible/);
  const document = makeDocument();
  const belt = document.addPrefab('hall', 'conveyor');
  const id = belt.userData.editorId;
  const entry = document.additions.get(id);
  assert.equal(entry.nodes.size, 12, 'Only sensors, PLC and physical controls are separately editable conveyor components.');
  assert.equal(document.getObjects('hall').length, 13);
  assert.equal(belt.userData.editorConveyorTop, 0);
  assert(!belt.getObjectByName('Pallet de salida'));
  const rollers = belt.getObjectByName('Rodillos');
  rollers.updateWorldMatrix(true, true);
  const rollerBounds = new THREE.Box3().setFromObject(rollers);
  assert(Math.abs(rollerBounds.max.y - 1) < 1e-6, 'Packages must travel at the actual roller surface, independently of the cabinet height.');
  const sensors = Array.from(entry.nodes.values()).filter(object => behavior(document, object, 'sensor'));
  assert.equal(sensors.length, 2);
  sensors.forEach(sensor => {
    assert.equal(behavior(document, sensor, 'sensor').sourceId, id);
    assert.equal(document.getEditableObject(sensor.children[0]), sensor);
  });
  const controls = Array.from(entry.nodes.values()).filter(object => behavior(document, object, 'control'));
  assert.equal(controls.length, 9);
  controls.forEach(control => assert.equal(behavior(document, control, 'control').targetId, id));
  assert.equal(controls.filter(control => behavior(document, control, 'control').variable === 'emergency').length, 1);
  assert.equal(entry.nodes.has('7'), false);
  assert.equal(entry.nodes.has('8'), false);
  assert(!document.getObjects('hall').some(object => behavior(document, object, 'product')), 'A newly inserted conveyor never includes a product actor.');
  assert.equal(entry.nodes.get('6.2').name, 'Arranque');
  assert.equal(entry.nodes.get('6.3').name, 'Parada');
  assert.equal(entry.nodes.get('6.4').name, 'Emergencia / rearme');
  document.undo(); assert.equal(document.additions.size, 0);
  document.redo(); assert.equal(document.additions.get(id), entry);

  const external = document.addPrimitive('hall', 'box');
  document.setBehaviors(external, [behaviorSchema.defaultBehavior('conveyor')]);
  const plc = Array.from(entry.nodes.values()).find(object => behavior(document, object, 'automation'));
  const sensor = sensors[0];
  const rules = [
    {sourceId: sensor.userData.editorId, variable: 'active', operator: 'eq', value: true, targetId: id, targetVariable: 'running', set: false, edge: 'rising'},
    {sourceId: sensor.userData.editorId, variable: 'active', operator: 'eq', value: false, targetId: external.userData.editorId, targetVariable: 'running', set: true, edge: 'falling'}
  ];
  document.setBehaviors(plc, [Object.assign(behaviorSchema.defaultBehavior('automation'), {rules: JSON.stringify(rules)})]);
  document.setTransform(sensor, {position: [-1.25, 0.2, 0]});
  const sourceStart = controls.find(control => control.name === 'Arranque');
  document.setBehaviors(sourceStart, [Object.assign(behavior(document, sourceStart, 'control'), {variable: 'speed', value: 0.8})]);
  const sourceIdentity = id;
  await document.replaceAsset(belt, {type: 'box', color: '#778899'});
  assert.equal(belt.userData.editorId, sourceIdentity);
  assert.equal(behavior(document, sensor, 'sensor').sourceId, sourceIdentity);
  assert.equal(rollers.children[0].material.visible, false);
  assert.equal(sensor.children[0].material.visible, true, 'Replacing the mechanical model must preserve independently placed sensor handles.');
  assert.equal(sourceStart.children[0].material.visible, true, 'Replacing the model must leave physical VR controls visible and selectable.');

  const copy = await document.duplicate(belt);
  const copied = document.additions.get(copy.userData.editorId);
  const copySensor = copied.nodes.get(Array.from(entry.nodes).find(pair => pair[1] === sensor)[0]);
  const copyPLC = copied.nodes.get(Array.from(entry.nodes).find(pair => pair[1] === plc)[0]);
  assert.equal(copySensor.position.x, -1.25);
  assert.equal(behavior(document, copySensor, 'sensor').sourceId, copy.userData.editorId);
  const copiedRules = JSON.parse(behavior(document, copyPLC, 'automation').rules);
  assert.equal(copied.nodes.has('7'), false, 'Copying a conveyor must keep its inlet free of legacy attached products.');
  assert.equal(copiedRules[0].sourceId, copySensor.userData.editorId);
  assert.equal(copiedRules[0].targetId, copy.userData.editorId);
  assert.equal(copiedRules[1].targetId, external.userData.editorId, 'References outside the duplicated subtree must remain external.');
  assert.deepStrictEqual(document.getVisualDescriptor(copy), {type: 'box', color: '#778899'});
  copied.nodes.forEach(node => {
    const control = behavior(document, node, 'control');
    if (control) assert.equal(control.targetId, copy.userData.editorId);
  });
  assert.equal(behavior(document, sensor, 'sensor').sourceId, sourceIdentity, 'Duplicating must not mutate the source links.');
  assert.equal(document.getVisualDescriptor(sensor).prefab, 'sensor');

  const plcCopy = await document.duplicate(plc);
  const plcCopyEntry = document.additions.get(plcCopy.userData.editorId);
  assert.equal(plcCopyEntry.nodes.size, 9);
  const plcCopyStart = Array.from(plcCopyEntry.nodes.values()).find(node => node.name === 'Arranque');
  assert.equal(behavior(document, plcCopyStart, 'control').variable, 'speed');
  assert.equal(behavior(document, plcCopyStart, 'control').value, 0.8);
  assert.equal(behavior(document, plcCopyStart, 'control').targetId, id, 'A controller copied alone keeps its existing external conveyor link.');
  const buttonCopy = await document.duplicate(sourceStart);
  assert.equal(document.getVisualDescriptor(buttonCopy).prefab, 'control');
  assert.equal(behavior(document, buttonCopy, 'control').value, 0.8);
  const stop = controls.find(control => control.name === 'Parada');
  const stopCopy = await document.duplicate(stop);
  assert.equal(stopCopy.children[0].children[1].material.color.getHexString(), stop.children[1].material.color.getHexString(), 'A duplicated stop control must retain its visible red button.');
  const sensorCopy = await document.duplicate(sensor);
  assert.equal(behavior(document, sensorCopy, 'sensor').sourceId, id);

  const saved = await document.serialize();
  assert.deepStrictEqual(validateDocument(saved, value => value), saved, 'SQLite API and browser must preserve prefab configuration identically.');
  const reopened = makeDocument();
  await reopened.load(JSON.parse(JSON.stringify(saved)));
  assert.deepStrictEqual(await reopened.serialize(), saved);
  const manual = document.addPrefab('hall', 'product');
  assert.equal(behavior(document, manual, 'product').sourceId, '', 'Standalone products can be placed on any conveyor.');
  const manualCopy = await document.duplicate(manual);
  assert.equal(behavior(document, manualCopy, 'product').sourceId, '');
  const legacyDocument = makeDocument();
  const legacy = JSON.parse(JSON.stringify(saved));
  const legacyBelt = legacy.rooms.hall.additions[0];
  // Simulate documents created before new controls and staged products existed.
  Object.keys(legacyBelt.nodes).forEach(key => { if (key === '7' || /^6\.(5|6|7|8|9|10)$/.test(key)) delete legacyBelt.nodes[key]; });
  await legacyDocument.load(legacy);
  const legacyEntry = legacyDocument.additions.get(legacyBelt.id);
  assert.equal(behavior(legacyDocument, legacyEntry.nodes.get('6.2'), 'control').value, 0.8, 'Existing button edits must remain on the original persisted component path.');
  assert.equal(behavior(legacyDocument, legacyEntry.nodes.get('6.3'), 'control').value, 0);
  assert.equal(behavior(legacyDocument, legacyEntry.nodes.get('4'), 'sensor').sourceId, legacyBelt.id);
  const retired = JSON.parse(JSON.stringify(saved)), retiredRecord = retired.rooms.hall.additions[0];
  const retiredState = Object.assign({}, retiredRecord.nodes['4'], {name: 'Caja manual antigua', visible: true,
    behaviors: [Object.assign(behaviorSchema.defaultBehavior('product'), {sourceId: retiredRecord.id})], visual: {type: 'box', color: '#667788'}});
  ['7', '7.0', '8', '8.0', '9', '9.0', '10', '10.0'].forEach(path => { retiredRecord.nodes[path] = JSON.parse(JSON.stringify(retiredState)); });
  retiredRecord.behaviors.forEach(config => { if (config.type === 'conveyor') config.withPallet = true; });
  const retiredDocument = makeDocument(); await retiredDocument.load(retired);
  const migrated = retiredDocument.additions.get(retiredRecord.id), migratedVisual = migrated.object.children[0];
  assert(!migrated.nodes.has('7') && !migrated.nodes.has('8'));
  migratedVisual.children.slice(7, 10).forEach(anchor => {
    assert.equal(anchor.children.length, 0, 'Legacy saved asset replacements cannot restore the retired supply geometry.');
    assert.equal(anchor.visible, false);
  });
  assert(!retiredDocument.getObjects('hall').some(object => behavior(retiredDocument, object, 'product')));
  assert.deepStrictEqual(await retiredDocument.serialize(), saved, 'Legacy retired supply state is discarded while every remaining component and visual stays unchanged.');
  const badNode = JSON.parse(JSON.stringify(saved));
  badNode.rooms.hall.additions[0].nodes['999'] = badNode.rooms.hall.additions[0].nodes['4'];
  await assert.rejects(reopened.load(badNode), /descendiente/);
  assert.deepStrictEqual(await reopened.serialize(), saved, 'An invalid prefab node must leave the current project intact.');
  const unknown = JSON.parse(JSON.stringify(saved));
  unknown.rooms.hall.additions[0].descriptor.prefab = 'unknown';
  await assert.rejects(reopened.load(unknown), /compatible/);
  assert.throws(() => validateDocument(unknown, value => value), /compatible/);
  console.log('Industrial prefabs: geometry, editable sensors/PLC/VR controls, internal copy links, asset replacement, history and SQLite roundtrip passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
