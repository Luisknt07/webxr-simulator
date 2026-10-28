'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const behaviorSchema = require('../shared/behaviors.js');
const code = fs.readFileSync(path.join(__dirname, '../src/editor/LineMonitorSystem.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class LineMonitorSystem', 'class LineMonitorSystem');
const {LineMonitorSystem, machineName, operation} = new Function('THREE', 'behaviorSchema', 'DynamicDisplayResolution', code + '\nreturn {LineMonitorSystem,machineName,operation};')(THREE, behaviorSchema, require('./load-dynamic-display-resolution')(THREE));
const scene = new THREE.Scene(), objects = [], byId = new Map();
function add(id, config, position) { const object = new THREE.Group(); object.name = id; object.userData.editorId = id; object.userData.editorBehaviors = [config]; object.position.fromArray(position || [0, 0, 0]); scene.add(object); objects.push(object); byId.set(id, object); return object; }
const source = add('source', Object.assign(behaviorSchema.defaultBehavior('source'), {delivery: 'manual'}), [1, 1, 1]);
const robotConfig = Object.assign(behaviorSchema.defaultBehavior('robot'), {sourceId: 'source', outputId: 'belt'});
const robot = add('robot', robotConfig), belt = add('belt', Object.assign(behaviorSchema.defaultBehavior('conveyor'), {outputId: 'stock'}), [3, 1, -1]);
const stock = add('stock', behaviorSchema.defaultBehavior('palletQueue'), [6, 1, -1]);
add('unrelated', behaviorSchema.defaultBehavior('source'), [100, 1, 100]);
const board = add('monitor', {type: 'lineMonitor', targetId: 'robot', scope: 'line'});
const document = {getObjects: () => objects, getObject: id => byId.get(id), getBehaviors: object => object.userData.editorBehaviors};
const simulation = {running: false, products: new Set(), events: []};
const monitor = new LineMonitorSystem({}, document, simulation), entry = {owner: board, config: board.userData.editorBehaviors[0], editing: true};
scene.updateMatrixWorld(true);
let model = monitor.layout(entry, 'hall');
assert.deepEqual(new Set(model.records.map(item => item.id)), new Set(['source', 'robot', 'belt', 'stock']), 'sourceId is a real reverse flow edge even without source.outputId.');
assert.equal(model.robots.length, 1); assert(model.robots[0].segments[0].length >= 4);
assert(model.decks.some(deck => deck.type === 'robot')); assert.equal(model.links.length, 3);
assert(model.robots[0].tcp.toArray().every(Number.isFinite));
assert.equal(machineName(robotConfig), 'Articulado de manipulación'); assert(operation(robotConfig).includes('conserva la carga'));
simulation.running = true; entry.editing = false;
simulation.records = new Map([source, robot, belt, stock].map(object => [object.userData.editorId, {id: object.userData.editorId, object,
  variables: {running: true, powered: true, phaseText: 'Trasladando'}, components: object === robot ? {robot: {config: robotConfig, pose: behaviorSchema.robotKinematics.homePose(robotConfig), visualRoot: robot}} : {}}]));
simulation.getPanelSnapshot = () => ({memberIds: ['source', 'robot', 'belt', 'stock'], variables: {}});
const productObject = new THREE.Mesh(new THREE.BoxBufferGeometry(.3, .2, .4), new THREE.MeshBasicMaterial()); productObject.position.set(.8, 1.2, -.3); scene.add(productObject);
const product = {object: productObject, bounds: new THREE.Box3(new THREE.Vector3(-.15, -.1, -.2), new THREE.Vector3(.15, .1, .2)), robotOwnerId: 'robot',
  sourceEntry: {id: 'load-1', originId: 'unrelated', ownerId: 'robot', units: 3, spec: {color: '#aabbcc'}}, classification: {productType: 'box'}};
simulation.products.add(product); scene.updateMatrixWorld(true); model = monitor.layout(entry, 'hall');
assert.equal(model.products.length, 1); assert.equal(model.products[0].ownerId, 'robot'); assert.equal(model.products[0].units, 3);
assert.equal(model.products[0].stage, 'transport'); assert.equal(model.products[0].contour.length, 4);
assert(Math.abs(model.products[0].size.width - .3) < 1e-6);
product.robotOwnerId = 'unrelated'; model = monitor.layout(entry, 'hall'); assert.equal(model.products.length, 0, 'A load moved to another line cannot stay in its original monitor.');
productObject.geometry.dispose(); productObject.material.dispose();
console.log('Robot monitor: source-pull topology, true kinematic segments/TCP, physical load outline and current custody passed.');
