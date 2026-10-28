// Real WebXR ray/UV events on a private CanvasTexture HMI. GPU presentation
// and a physical headset remain outside this deterministic integration check.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const behaviorSchema = require('../shared/behaviors');
const text = fs.readFileSync(path.join(__dirname, 'test-industrial-xr.js'), 'utf8');
const h = new Function('require', '__dirname', text.slice(0, text.indexOf('async function run()')) + '\nreturn {setup,advance,aim,away,select,vars,wall,removeWall};')(require, __dirname);
const source = fs.readFileSync(path.join(__dirname, '../src/editor/LineMonitorSystem.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class LineMonitorSystem', 'return class LineMonitorSystem');
const Monitor = new Function('THREE', 'behaviorSchema', 'DynamicDisplayResolution', source)(THREE, behaviorSchema, require('./load-dynamic-display-resolution')(THREE));
function drawing() {
  const canvas = {width: 0, height: 0, text: []};
  const context = {fillRect(x, y, width, height) { if (!x && !y && width === canvas.width && height === canvas.height) canvas.text = []; },
    fillText(text) { canvas.text.push(String(text)); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, closePath() {}, fill() {}, save() {}, restore() {}, rect() {}, clip() {}, strokeRect() {}, setLineDash() {}};
  canvas.getContext = () => context; return canvas;
}
function step(f, seconds = 1 / 60, editing = false) { h.advance(f, seconds); f.monitor.sync('hall', seconds, editing); }
function regionPoint(f, key, rear = false) {
  const region = f.entry.regions.find(value => value.key === key); assert(region, 'Missing real monitor region ' + key);
  const face = rear ? f.entry.backPlane : f.entry.plane; face.updateWorldMatrix(true, false);
  return new THREE.Vector3(((region.x + region.width / 2) / 1024 - .5) * .98,
    (.5 - (region.y + region.height / 2) / 576) * .98, 0).applyMatrix4(face.matrixWorld);
}
function aimRegion(f, hand, key, distance = .7, rear = false) {
  if (['start', 'stop', 'pause', 'powerOn', 'powerOff', 'emergency', 'resetEmergency', 'speedDown', 'speedUp'].includes(key) && f.entry.page !== 'control') click(f, 'control', hand);
  h.aim(f, hand, regionPoint(f, key, rear), new THREE.Vector3(0, 0, rear ? -1 : 1), distance); f.monitor.sync('hall', 0);
}
function click(f, key, hand = f.right) {
  if ((['start', 'stop', 'pause', 'powerOn', 'powerOff', 'emergency', 'resetEmergency', 'speedDown', 'speedUp'].includes(key) || key.startsWith('equipment-action-')) && f.entry.page !== 'control') click(f, 'control', hand);
  if ((key.startsWith('node:') || key.startsWith('shape:') || key.startsWith('product:') || key === 'view') && f.entry.page !== 'diagram') click(f, 'diagram', hand);
  aimRegion(f, hand, key); h.select(f, hand, 'selectstart'); step(f);
  h.away(f, hand); h.select(f, hand, 'selectend'); step(f);
}
function countDispose(value) { let count = 0; value.addEventListener('dispose', () => count++); return () => count; }

async function denseCaptions() {
  const f = h.setup();
  f.document.setTransform(f.unrelated, {position: [40, 1.02, 0]});
  f.document.setBehaviors(f.tail, f.document.getBehaviors(f.tail).map(config => config.type === 'conveyor' ? Object.assign({}, config, {outputId: f.unrelated.userData.editorId}) : config));
  f.board = f.document.addPrimitive('hall', 'box');
  f.document.setBehaviors(f.board, [{type: 'lineMonitor', targetId: f.head.userData.editorId, scope: 'line'}]);
  f.ctx.document = {createElement: () => {
    const canvas = drawing(); canvas.getContext().measureText = text => ({width: String(text).length * 8.1}); return canvas;
  }};
  f.monitor = new Monitor(f.ctx, f.document, f.runtime); f.monitor.sync('hall', 0, true); f.entry = f.monitor.entries.get(f.board);
  const first = f.entry.captionRects.find(label => label.id === f.head.userData.editorId), second = f.entry.captionRects.find(label => label.id === f.tail.userData.editorId);
  assert(first && second, 'Both densely adjacent modules keep a caption.');
  assert(first.width >= first.text.length * 8.1 && second.width >= second.text.length * 8.1, 'Caption planning uses the measured font width.');
  assert(first.x + first.width + 6 <= second.x || second.x + second.width + 6 <= first.x || first.y + first.height + 4 <= second.y || second.y + second.height + 4 <= first.y,
    'Adjacent captions leave a visible gap, including when the line view compresses module centers.');
  assert.notEqual(first.y, second.y, 'Nearby modules stagger their captions above and below the real deck.');
  assert(f.entry.captionRects.every(label => label.text.length <= 12 && label.x >= 24 && label.x + label.width <= 676 && label.y >= 119 && label.y + label.height <= 477));
  const path = f.entry.model.paths.find(item => item.id === f.head.userData.editorId), hit = f.entry.regions.find(region => region.key === 'shape:' + f.head.userData.editorId);
  assert.deepEqual(hit.polygon, path.contour.map(point => { const p = f.entry.model.project(point); return {x: p.x, z: p.y}; }), 'Caption placement never replaces the complete physical contour hit region.');
  f.monitor.dispose(); f.visuals.dispose();
}

async function currentProductCustody() {
  const f = h.setup(); f.document.remove(f.tail); f.document.remove(f.unrelated);
  f.document.setBehaviors(f.head, f.document.getBehaviors(f.head).map(config => config.type === 'conveyor' ? Object.assign({}, config, {outputId: '', autoSpawn: false}) : config));
  const source = f.document.addPrefab('hall', 'source'); f.document.setTransform(source, {position: [-8, 1.02, -4]});
  f.document.setBehaviors(source, f.document.getBehaviors(source).map(config => config.type === 'source' ? Object.assign({}, config, {outputId: '', autoGenerate: false, initialCount: 1, delivery: 'manual'}) : config));
  const boards = [source, f.head].map(target => {
    const board = f.document.addPrimitive('hall', 'box');
    f.document.setBehaviors(board, [{type: 'lineMonitor', targetId: target.userData.editorId, scope: 'line'}]); return board;
  });
  f.ctx.document = {createElement: drawing}; f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate();
  const authored = JSON.stringify(await f.document.serialize());
  f.monitor = new Monitor(f.ctx, f.document, f.runtime); f.runtime.start('hall'); f.monitor.sync('hall');
  const sourcePanel = f.monitor.entries.get(boards[0]), beltPanel = f.monitor.entries.get(boards[1]);
  const product = f.runtime.records.get(source.userData.editorId).components.source.queue[0].product;
  assert.equal(sourcePanel.model.products.length, 1); assert.equal(beltPanel.model.products.length, 0);
  assert(f.runtime.pickupProduct(product, f.left)); f.monitor.sync('hall', .25);
  assert.equal(sourcePanel.model.products[0].stage, 'held', 'An origin-traced load identifies that it is currently held, rather than in a queue or on a belt.');
  const record = f.runtime.records.get(f.head.userData.editorId), belt = record.components.conveyor;
  const surface = f.runtime.pathSurface(record, belt, f.runtime.pathPoint(belt.config, .5));
  const pose = product.holdMatrix.clone(); pose.setPosition(surface.add(new THREE.Vector3(0, -product.bounds.min.y * product.scale.y + .012, 0)));
  f.runtime.setProductMatrix(product, pose);
  assert(f.runtime.findProductBelt(product), 'The Source load physically reaches the separate receiving conveyor.');
  assert(f.runtime.releaseProduct(product));
  assert.equal(product.item.beltId, record.id); assert.equal(product.sourceEntry.originId, source.userData.editorId);
  f.monitor.sync('hall', .25);
  assert.equal(sourcePanel.model.products.length, 0, 'Line A no longer draws a product that is now owned by independent line B.');
  assert.equal(beltPanel.model.products.length, 1); assert.equal(beltPanel.model.products[0].ownerId, record.id);
  f.monitor.dispose(); f.visuals.dispose(); f.runtime.stop();
  assert.equal(JSON.stringify(await f.document.serialize()), authored);
}

async function detailedGeometry() {
  const f = h.setup('roller-curve');
  f.document.setTransform(f.head, {rotation: [0, .35, 0], scale: [1.3, 1, .8]});
  f.document.setTransform(f.cartons[0], {scale: [2, 1, .5], rotation: [.15, .7, -.1]});
  f.document.setBehaviors(f.cartons[0], f.document.getBehaviors(f.cartons[0]).map(config => config.type === 'product' ? Object.assign({}, config, {sourceId: f.head.userData.editorId}) : config));
  f.board = f.document.addPrimitive('hall', 'box');
  f.document.setTransform(f.board, {position: [0, 2.2, 4], rotation: [.1, .35, .05], scale: [3.6, 2.025, .12]});
  f.document.setBehaviors(f.board, [{type: 'lineMonitor', targetId: f.head.userData.editorId, scope: 'line'}]);
  f.ctx.document = {createElement: drawing}; f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate();
  f.monitor = new Monitor(f.ctx, f.document, f.runtime); f.runtime.start('hall'); step(f); f.entry = f.monitor.entries.get(f.board);
  const path = f.entry.model.paths.find(path => path.id === f.head.userData.editorId), config = f.runtime.records.get(f.head.userData.editorId).components.conveyor.config;
  assert(path.contour.length >= 48 && path.rollers.length > 2, 'The curved deck has two real edges and actual transverse roller positions.');
  const point = behaviorSchema.conveyorLayout.pathPoint(config, 0);
  const expected = new THREE.Vector3(point.x - point.tz * config.width / 2, point.y || 0, point.z + point.tx * config.width / 2).applyMatrix4(f.head.matrixWorld);
  assert(path.left[0].distanceTo(expected) < 1e-8, 'Deck width respects the real world rotation and nonuniform equipment scale.');
  const first = path.rollers[0][1].clone().sub(path.rollers[0][0]).normalize(), last = path.rollers.at(-1)[1].clone().sub(path.rollers.at(-1)[0]).normalize();
  assert(Math.abs(first.dot(last)) < .95, 'Curved rollers change their transverse orientation along the actual radius.');
  const product = f.runtime.products.get(f.cartons[0]), drawn = f.entry.model.products.find(item => item.id === product.record.id);
  assert(drawn && drawn.contour.length >= 4);
  const bounds = product.bounds.clone().applyMatrix4(product.object.matrixWorld), actual = new THREE.Box3().setFromPoints(drawn.contour);
  assert(Math.abs(bounds.min.x - actual.min.x) < 1e-8 && Math.abs(bounds.max.z - actual.max.z) < 1e-8,
    'Product glyphs are the true projected oriented bounds rather than a fixed-size dot.');
  assert(drawn.contour.some((point, index) => { const next = drawn.contour[(index + 1) % drawn.contour.length]; return Math.abs(point.x - next.x) > .01 && Math.abs(point.z - next.z) > .01; }));
  const scale = f.entry.model.scale, members = f.entry.model.records.map(record => record.id), scope = f.entry.moduleOnly;
  click(f, 'view', f.left);
  assert(f.entry.focused && f.entry.model.scale > scale, 'Focusing the selected curve enlarges its real footprint.');
  assert.deepEqual(f.entry.model.records.map(record => record.id), members, 'A diagram zoom never changes the connected line or command scope.');
  assert.equal(f.entry.moduleOnly, scope);
  assert(f.entry.regions.every(region => region.x >= 0 && region.y >= 0 && region.x + region.width <= 1024 && region.y + region.height <= 576),
    'Zoomed off-screen geometry cannot create clickable hit regions outside the screen.');
  click(f, 'view', f.right); assert(!f.entry.focused && Math.abs(f.entry.model.scale - scale) < 1e-8);
  click(f, 'powerOff'); assert.equal(h.vars(f).powered, false);
  aimRegion(f, f.left, 'powerOn', .7, true); h.select(f, f.left, 'selectstart'); step(f); h.select(f, f.left, 'selectend'); step(f);
  assert.equal(h.vars(f).powered, true, 'The rotated and nonuniformly scaled rear face preserves the same readable UV command.');
  f.monitor.dispose(); f.visuals.dispose(); f.runtime.stop();
}

async function analyticsAndEquipment() {
  const f = h.setup();
  assert.equal(typeof f.runtime.getAnalyticsSnapshot, 'function', 'Production runtime provides real analytics to the monitor.');
  f.board = f.document.addPrimitive('hall', 'box');
  f.document.setTransform(f.board, {position: [0, 2.2, 4], scale: [3.6, 2.025, .12]});
  f.document.setBehaviors(f.board, [{type: 'lineMonitor', targetId: f.head.userData.editorId, scope: 'line', refreshHz: 4}]);
  f.ctx.document = {createElement: drawing}; f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate();
  const authored = JSON.stringify(await f.document.serialize());
  f.monitor = new Monitor(f.ctx, f.document, f.runtime); f.runtime.start('hall'); step(f); f.entry = f.monitor.entries.get(f.board);
  click(f, 'analytics'); assert(f.entry.model.analytics && f.entry.canvas.text.includes('Utilización útil'));
  click(f, 'analysis-2'); assert(f.entry.canvas.text.some(text => text.includes('Calentando:')));
  click(f, 'powerOn', f.left); click(f, 'start', f.right);
  f.runtime.command(f.head.userData.editorId, 'insertBox');
  step(f, 4); click(f, 'pause', f.left); step(f, 1); click(f, 'start', f.right); step(f, 26);
  click(f, 'analytics'); click(f, 'analysis-2');
  f.monitor.sync('hall', .25);
  const analytics = f.entry.model.analytics;
  assert(analytics.history.length >= 20 && analytics.control.ready);
  assert(analytics.history.every((sample, index, values) => !index || sample.time > values[index - 1].time));
  assert(f.entry.canvas.text.some(text => text.includes('Centro ')) && f.entry.canvas.text.some(text => text.includes('límites estadísticos')));
  click(f, 'analysis-1'); assert(f.entry.canvas.text.includes('Flujo de unidades / minuto') && f.entry.canvas.text.includes('Carga y utilización (%)'));
  click(f, 'analysis-0'); assert(f.entry.canvas.text.some(text => text.includes('Preparación:')) && f.entry.canvas.text.some(text => text.includes('Ocio:')));
  const before = JSON.stringify(f.runtime.getAnalyticsSnapshot(f.head.userData.editorId, 'line'));
  f.monitor.invalidate(); f.monitor.sync('hall', 0);
  assert.equal(JSON.stringify(f.runtime.getAnalyticsSnapshot(f.head.userData.editorId, 'line')), before, 'Drawing charts cannot alter statistics or advance simulation time.');
  click(f, 'equipment'); assert.equal(f.entry.page, 'equipment');
  click(f, 'equipment-2'); assert(f.entry.canvas.text.some(text => text.includes('Bastidor') || text.includes('Superficie')));
  click(f, 'equipment-3'); assert(/Los\s+sensores\s+de\s+presencia/.test(f.entry.canvas.text.join(' ')));
  click(f, 'equipment-1'); assert(f.entry.canvas.text.some(text => text.includes('Sin cargas') || text.includes(' u · ')));
  click(f, 'machine-next'); assert.equal(f.entry.selectedId, f.tail.userData.editorId);
  click(f, 'equipment-0'); assert(f.entry.canvas.text.includes('Límite de cargas'));
  assert(f.entry.regions.every(region => region.x >= 0 && region.y >= 0 && region.x + region.width <= 1024 && region.y + region.height <= 576),
    'Every new analytics/equipment control stays inside the physical screen.');
  f.monitor.dispose(); f.visuals.dispose(); f.runtime.stop();
  assert.equal(JSON.stringify(await f.document.serialize()), authored);
}

async function mixedLine() {
  const f = h.setup(); f.document.remove(f.tail); f.document.remove(f.unrelated);
  const source = f.document.addPrefab('hall', 'source'), fifo = f.document.addPrefab('hall', 'source', 'queue');
  const processor = f.document.addPrefab('hall', 'processor'), stock = f.document.addPrefab('hall', 'palletQueue');
  const machines = [source, fifo, f.head, processor, stock];
  machines.forEach((object, index) => {
    f.document.setBehaviors(object, f.document.getBehaviors(object).map(config => {
      if (!['source', 'conveyor', 'processor', 'palletQueue'].includes(config.type)) return config;
      const changes = {outputId: machines[index + 1] ? machines[index + 1].userData.editorId : ''};
      if (config.type === 'source') Object.assign(changes, {autoGenerate: false, initialCount: index ? 0 : 1, delivery: 'manual'});
      if (config.type === 'palletQueue') Object.assign(changes, {palletCapacity: 4, capacity: 4, columns: 1, rows: 1, layers: 1, delivery: 'manual'});
      return Object.assign({}, config, changes);
    }));
    f.document.setTransform(object, {position: [-10 + index * 4, 1.02, -4]});
  });
  f.board = f.document.addPrimitive('hall', 'box', '#182f40');
  f.document.setTransform(f.board, {position: [0, 2.2, 4], scale: [3.6, 2.025, .12]});
  f.document.setBehaviors(f.board, [{type: 'lineMonitor', targetId: source.userData.editorId, scope: 'line', title: 'SOURCE / FIFO / PROCESO / 4 ESTIBAS', refreshHz: 4}]);
  f.ctx.document = {createElement: drawing}; f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate();
  const authored = JSON.stringify(await f.document.serialize());
  f.monitor = new Monitor(f.ctx, f.document, f.runtime); f.runtime.start('hall'); step(f); f.entry = f.monitor.entries.get(f.board);
  assert.equal(f.entry.model.records.length, 5, 'A Source-anchored monitor includes every connected machine type.');
  assert.equal(f.entry.model.pallets.length, 4, 'The diagram represents the four real pallet positions of one stock system.');
  assert.equal(f.entry.model.products.length, 1, 'The real Source front load appears at its actual world position.');
  assert.equal(f.entry.model.snapshot.variables.entryCount, 1);
  const diagramProduct = f.entry.model.products[0], sourceProduct = f.runtime.records.get(source.userData.editorId).components.source.queue[0].product;
  click(f, 'product:' + diagramProduct.id, f.left);
  assert.equal(f.entry.selectedProductId, diagramProduct.id);
  assert(f.entry.canvas.text.some(text => text.startsWith('Producto · ')) && f.entry.canvas.text.some(text => text.includes('SKU ') && text.includes(' m · ')), 'The shared overview retains the selected product identity and measured dimensions.');
  assert.equal(sourceProduct.heldBy, null, 'Selecting a monitor footprint only inspects metadata; it never grabs the real load.');
  assert(Math.abs(diagramProduct.size.width - f.runtime.productMetadata(sourceProduct).width) < 1e-8);
  click(f, 'powerOn', f.left); click(f, 'start', f.right);
  assert(machines.every(object => f.runtime.records.get(object.userData.editorId).variables.running));
  click(f, 'pause', f.left); assert(machines.every(object => f.runtime.records.get(object.userData.editorId).variables.paused));
  click(f, 'start', f.right); assert(machines.every(object => !f.runtime.records.get(object.userData.editorId).variables.paused));
  click(f, 'emergency', f.left); assert(machines.every(object => !f.runtime.records.get(object.userData.editorId).variables.running));
  click(f, 'resetEmergency', f.right); click(f, 'start', f.left);
  click(f, 'node:' + processor.userData.editorId, f.left); click(f, 'scope', f.right); click(f, 'powerOff', f.left);
  assert.equal(f.runtime.records.get(processor.userData.editorId).variables.powered, false);
  click(f, 'scope', f.right); click(f, 'stop', f.left); click(f, 'start', f.right);
  assert(machines.every(object => !f.runtime.records.get(object.userData.editorId).variables.running),
    'An unpowered processor blocks the whole start before any Source, FIFO, conveyor or stock changes state.');
  assert(f.entry.notice.includes('Enciende'));
  click(f, 'powerOn', f.left); click(f, 'start', f.right);
  assert(machines.every(object => f.runtime.records.get(object.userData.editorId).variables.running));
  const sourceState = f.runtime.records.get(source.userData.editorId).components.source, product = sourceState.queue[0].product;
  assert(f.runtime.pickupProduct(product, f.left));
  const stockRecord = f.runtime.records.get(stock.userData.editorId), placement = f.runtime.palletQueueRuntime.placement(stockRecord, product);
  assert(placement); f.runtime.setProductMatrix(product, placement.matrix); assert(f.runtime.releaseProduct(product));
  f.monitor.sync('hall', .25);
  assert.equal(f.entry.model.pallets.reduce((sum, pallet) => sum + pallet.units, 0), 1, 'Per-pallet units come from the accepted runtime stock load.');
  assert.equal(f.entry.model.snapshot.variables.storedUnits, 1);
  click(f, 'node:' + source.userData.editorId, f.left); click(f, 'scope', f.right);
  click(f, 'control');
  assert(f.entry.regions.find(region => region.key === 'speedUp').disabled, 'A Source module does not expose fictitious transport-speed commands.');
  f.visuals.dispose(); f.runtime.stop(); f.monitor.dispose();
  assert.equal(JSON.stringify(await f.document.serialize()), authored);
}

async function authoringReferences() {
  const fixture = fs.readFileSync(path.join(__dirname, 'test-studio-authoring.js'), 'utf8');
  const {harness} = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('\nasync function run()')) + '\nreturn {harness};')(require, __dirname);
  const f = harness(), source = f.document.addPrefab('hall', 'source'), belt = f.document.addPrefab('hall', 'conveyor', 'roller-middle');
  f.document.setBehaviors(source, f.document.getBehaviors(source).map(config => config.type === 'source' ? Object.assign({}, config, {outputId: belt.userData.editorId}) : config));
  const board = f.document.addPrimitive('hall', 'box');
  const external = f.document.addPrimitive('hall', 'box');
  const internalRule = {sourceId: source.userData.editorId, variable: 'running', operator: 'eq', value: true, targetId: belt.userData.editorId, targetVariable: 'running', set: true, edge: 'rising'};
  f.document.setBehaviors(board, [{type: 'lineMonitor', targetId: source.userData.editorId, scope: 'line', title: 'Plantilla de monitor', refreshHz: 4}, {type: 'automation', rules: JSON.stringify([internalRule, Object.assign({}, internalRule, {targetId: external.userData.editorId})])}]);
  f.document.setInteraction(board, {type: 'toggle', targetId: belt.userData.editorId});
  f.tools.selection = new Set([source, belt, board]);
  const template = await f.tools.saveTemplate();
  const onlyPanel = await f.document.duplicate(board);
  assert.equal(f.document.getBehaviors(onlyPanel).find(value => value.type === 'lineMonitor').targetId, source.userData.editorId,
    'Copying a panel alone deliberately keeps its external machine binding.');
  const copied = await f.tools.placeTemplate(template, {preservePosition: true});
  assert.equal(f.document.getBehaviors(copied[2]).find(value => value.type === 'lineMonitor').targetId, copied[0].userData.editorId,
    'Copying the whole group binds its HMI to the copied Source.');
  assert.equal(f.document.getBehaviors(copied[0]).find(value => value.type === 'source').outputId, copied[1].userData.editorId);
  assert.equal(f.document.getBehaviors(board).find(value => value.type === 'lineMonitor').targetId, source.userData.editorId);
  f.editor.ctx.room = 1;
  const crossRoom = await f.tools.placeTemplate(template, {preservePosition: true}), target = crossRoom[0].userData.editorId;
  assert.equal(f.document.getBehaviors(crossRoom[2]).find(value => value.type === 'lineMonitor').targetId, target,
    'Pasting into another level remaps object IDs inside the new level.');
  assert.equal(crossRoom[2].userData.editorInteraction.targetId, crossRoom[1].userData.editorId, 'Batch copies remap interactions between independently copied members.');
  const crossRules = JSON.parse(f.document.getBehaviors(crossRoom[2]).find(value => value.type === 'automation').rules); assert.equal(crossRules.length, 1, 'Batch copy clears rules that would control another level.'); assert.equal(crossRules[0].sourceId, target); assert.equal(crossRules[0].targetId, crossRoom[1].userData.editorId);
  f.document.undo(); assert(!f.document.getObject(target)); f.document.redo(); assert(f.document.getObject(target));
  const saved = await f.document.serialize(), reopened = harness(); await reopened.document.load(saved, {activeRoomId: 'sound'});
  const owner = reopened.document.getObject(crossRoom[2].userData.editorId);
  const simulation = {running: false, records: new Map(), products: new Map(), events: []};
  const monitor = new Monitor({document: {createElement: drawing}}, reopened.document, simulation);
  monitor.sync('sound', 0, true);
  assert.deepEqual(monitor.entries.get(owner).model.records.map(record => record.id).sort(), [crossRoom[0], crossRoom[1]].map(object => object.userData.editorId).sort());
  const afterHelpers = await reopened.document.serialize();
  assert(!JSON.stringify(afterHelpers).includes('pantalla privada'), 'Private canvases and hit planes never enter scene exports or clipboard records.');
  const clipboard = reopened.document.captureObject(owner); assert.equal(clipboard.record.behaviors.find(value => value.type === 'lineMonitor').targetId, target);
  monitor.dispose();
  // The generic object selector offers self/blank, as with physical controls.
  reopened.document.setBehaviors(reopened.document.getObject(target), reopened.document.getBehaviors(reopened.document.getObject(target)).concat({type: 'lineMonitor', targetId: 'self', scope: 'module'}));
  monitor.sync('sound', 0, true);
  const self = monitor.entries.get(reopened.document.getObject(target));
  assert.deepEqual(self.model.records.map(record => record.id), [target], 'A self-bound monitor resolves its actual copied owner.');
  monitor.dispose();
}

async function contextualManualCommands() {
  const f = h.setup(); [f.head, f.tail, f.unrelated].forEach(object => f.document.remove(object));
  const source = f.document.addPrefab('hall', 'source'), station = f.document.addPrefab('hall', 'conveyor', 'manual-station');
  const change = (object, type, patch) => f.document.setBehaviors(object, f.document.getBehaviors(object).map(config => config.type === type ? Object.assign({}, config, patch) : config));
  change(source, 'source', {autoGenerate: false, initialCount: 0, delivery: 'manual', totalLimit: 4, outputId: station.userData.editorId});
  change(station, 'conveyor', {length: 2.4, withPanel: false, powered: true, running: true, autoSpawn: false, loadingMode: 'manual', requiresOperator: true, operatorAvailable: false});
  f.document.setTransform(source, {position: [-3, 1.02, -4]});
  f.document.setTransform(station, {position: [-.95, 1.02, -4]});
  f.board = f.document.addPrimitive('hall', 'box'); f.document.setTransform(f.board, {position: [0, 2.2, 4], scale: [3.6, 2.025, .12]});
  f.document.setBehaviors(f.board, [{type: 'lineMonitor', targetId: source.userData.editorId, scope: 'line', title: 'Manual'}]);
  f.ctx.document = {createElement: drawing}; f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate();
  const authored = JSON.stringify(await f.document.serialize());
  f.monitor = new Monitor(f.ctx, f.document, f.runtime); f.runtime.start('hall'); step(f); f.entry = f.monitor.entries.get(f.board);
  click(f, 'equipment'); assert(!f.entry.regions.some(region => region.action), 'The equipment dossier leaves operation commands in their dedicated Control page.');
  click(f, 'control');
  assert(f.entry.regions.find(region => region.key === 'equipment-action-generate' && region.targetId === source.userData.editorId));
  click(f, 'equipment-action-generate', f.left);
  const sourceRecord = f.runtime.records.get(source.userData.editorId), stationRecord = f.runtime.records.get(station.userData.editorId);
  assert.equal(sourceRecord.variables.generated, 1); assert.equal(sourceRecord.variables.queued, 1);
  click(f, 'equipment-action-dispatch', f.right);
  assert.equal(sourceRecord.variables.delivered, 1, 'The contextual dispatch button targets the selected Source module.');
  click(f, 'machine-next'); assert.equal(f.entry.selectedId, station.userData.editorId);
  assert(f.entry.regions.find(region => region.key === 'equipment-action-operator'));
  assert(f.entry.regions.find(region => region.key === 'equipment-action-dispatch'));
  click(f, 'equipment-action-operator', f.left);
  assert.equal(stationRecord.components.conveyor.operatorAvailable, true);
  click(f, 'equipment-action-dispatch', f.right);
  assert(stationRecord.components.conveyor.manualRelease, 'The station receives a real manual-cycle request, without starting another module.');
  assert.equal(f.entry.notice, '');
  assert(f.entry.regions.every(region => region.y + region.height <= 576));
  f.visuals.dispose(); f.runtime.stop(); f.monitor.dispose();
  assert.equal(JSON.stringify(await f.document.serialize()), authored);
}

async function run() {
  const f = h.setup();
  f.ctx.document = {createElement: tag => { assert.equal(tag, 'canvas'); return drawing(); }};
  f.board = f.document.addPrimitive('hall', 'box', '#182f40');
  f.document.setTransform(f.board, {position: [0, 2.2, 4], scale: [3.6, 2.025, .12]});
  f.document.setBehaviors(f.board, [{type: 'lineMonitor', enabled: true, targetId: f.head.userData.editorId, scope: 'line', title: 'LÍNEA QA EN VIVO', refreshHz: 4}]);
  f.scene.updateMatrixWorld(true); f.ctx.collisionWorld.invalidate();
  const authored = JSON.stringify(await f.document.serialize());
  f.monitor = new Monitor(f.ctx, f.document, f.runtime);
  f.monitor.sync('hall', 0, true); f.entry = f.monitor.entries.get(f.board); assert(f.entry);
  assert.equal(f.entry.canvas.width, 1024); assert.equal(f.entry.canvas.height, 576);
  assert.equal(f.entry.plane.parent, f.board); assert.equal(f.entry.plane.userData.editorRuntimeHelper, true);
  assert.equal(f.entry.plane.userData.editorNonCollidable, true); assert.equal(f.entry.active, false);
  assert.equal(f.entry.backPlane.parent, f.board); assert.equal(f.entry.backPlane.geometry, f.entry.plane.geometry); assert.equal(f.entry.backPlane.material, f.entry.plane.material);
  assert.equal(f.entry.state.colliderMesh.length, 2, 'Both outward-facing displays share one canvas, material and interaction state.');
  assert(new THREE.Vector3(0, 0, 1).applyQuaternion(f.entry.backPlane.quaternion).z < -.99999, 'The rear surface faces outward instead of showing mirrored front-face pixels.');
  assert(f.entry.canvas.text.some(value => value.includes('EDITAR')));
  assert.equal(f.entry.model.records.length, 2, 'Static authoring preview follows the actual saved output graph.');
  assert(f.entry.model.records.every(record => record.variables.entryCount === 0));
  f.runtime.start('hall'); step(f);
  assert.equal(f.entry.active, true);
  assert(f.entry.canvas.text.some(value => value.includes('EN VIVO')));
  assert.deepEqual(f.entry.model.records.map(record => record.id).sort(), [f.head, f.tail].map(object => object.userData.editorId).sort());
  const path = f.entry.model.paths.find(path => path.id === f.head.userData.editorId), record = f.runtime.records.get(f.head.userData.editorId);
  const actual = behaviorSchema.conveyorLayout.pathPoint(record.components.conveyor.config, 0);
  assert(path.points[0].distanceTo(new THREE.Vector3(actual.x, actual.y || 0, actual.z).applyMatrix4(f.head.matrixWorld)) < 1e-8,
    'Diagram paths use the same world-transformed production layout as the physical conveyor.');
  const geometry = f.entry.plane.geometry, material = f.entry.plane.material, texture = f.entry.texture;
  const disposals = [geometry, material, texture].map(countDispose);
  click(f, 'powerOn', f.left); assert(h.vars(f).powered && h.vars(f, f.tail).powered); assert.equal(h.vars(f, f.unrelated).powered, false);
  click(f, 'start', f.right); assert(h.vars(f).running && h.vars(f, f.tail).running);
  aimRegion(f, f.left, 'pause'); aimRegion(f, f.right, 'pause', .7, true);
  h.select(f, f.left, 'selectstart'); h.select(f, f.right, 'selectstart'); step(f);
  assert(h.vars(f).paused && h.vars(f, f.tail).paused, 'Two real controller rays on opposite faces produce one virtual pause toggle.');
  assert.equal(f.entry.presses.size, 2);
  h.select(f, f.left, 'selectend'); step(f); assert.equal(f.entry.presses.size, 1);
  h.select(f, f.right, 'selectend'); step(f); assert.equal(f.entry.presses.size, 0);
  click(f, 'start'); assert(!h.vars(f).paused && h.vars(f).running);
  click(f, 'emergency', f.left); assert(h.vars(f).emergency && !h.vars(f).running);
  click(f, 'emergency', f.right); assert(h.vars(f).emergency, 'A dedicated virtual emergency button can only latch the stop.');
  click(f, 'start'); assert(!h.vars(f).running);
  click(f, 'resetEmergency'); assert(!h.vars(f).emergency && !h.vars(f).running);
  click(f, 'start');
  const speed = h.vars(f).speed; click(f, 'speedUp', f.left); assert(Math.abs(h.vars(f).speed - speed - .1) < 1e-8);
  // A diagram hit selects its module; scope change isolates subsequent commands.
  click(f, 'node:' + f.tail.userData.editorId, f.left); assert.equal(f.entry.selectedId, f.tail.userData.editorId);
  click(f, 'scope'); assert(f.entry.moduleOnly);
  click(f, 'powerOff'); assert(!h.vars(f, f.tail).powered && h.vars(f).powered);
  click(f, 'details'); assert.equal(f.entry.page, 'details');
  assert(f.entry.canvas.text.some(value => value.includes('Página 1/')));
  click(f, 'next'); assert.equal(f.entry.detailPage, 1);
  click(f, 'previous'); assert.equal(f.entry.detailPage, 0);
  click(f, 'events'); assert(f.entry.model.events.length > 0);
  assert(f.entry.model.events.every(event => [f.head.userData.editorId, f.tail.userData.editorId].includes(event.objectId)));
  click(f, 'diagram');
  const tailPowered = h.vars(f, f.tail).powered;
  aimRegion(f, f.right, 'powerOn', 6.5); h.select(f, f.right, 'selectstart'); h.select(f, f.right, 'selectend'); step(f);
  assert.equal(h.vars(f, f.tail).powered, tailPowered, 'Distant monitor hits cannot operate machinery.');
  aimRegion(f, f.right, 'powerOn', .7, true); h.select(f, f.right, 'selectstart'); h.select(f, f.right, 'selectend'); step(f);
  assert.equal(h.vars(f, f.tail).powered, true, 'The rear display operates the same target through its own readable UV coordinates.');
  const rearPowered = h.vars(f, f.tail).powered;
  aimRegion(f, f.right, 'powerOn');
  const obstacle = h.wall(f, regionPoint(f, 'powerOn').add(new THREE.Vector3(0, 0, .35))); h.advance(f);
  h.select(f, f.right, 'selectstart'); h.select(f, f.right, 'selectend'); step(f);
  assert.equal(h.vars(f, f.tail).powered, rearPowered, 'A real collision wall blocks the world HMI.'); h.removeWall(f, obstacle);
  aimRegion(f, f.left, 'pause'); h.select(f, f.left, 'selectstart'); step(f); assert.equal(f.entry.presses.size, 1);
  f.ctx.raycontrol.disable(); step(f); assert.equal(f.entry.presses.size, 0, 'Input cancellation releases captured virtual buttons.'); f.ctx.raycontrol.enable();
  let shown = false; f.ctx.performanceVisibility = {isVisible: () => shown};
  const draws = f.monitor.stats.draws; f.monitor.sync('hall', 1); assert.equal(f.monitor.stats.draws, draws);
  shown = true; f.monitor.sync('hall', 0); assert(f.monitor.stats.draws > draws);
  assert.equal(f.entry.plane.geometry, geometry); assert.equal(f.entry.texture, texture);
  const beforeDraws = f.monitor.stats.draws;
  for (let index = 0; index < 60; index++) step(f);
  assert(f.monitor.stats.draws - beforeDraws <= 4, 'Visible live telemetry redraws at the configured 4 Hz.');
  f.monitor.sync('hall', 0, true); assert.equal(f.entry.active, false); assert(f.entry.model.records.every(record => record.variables.entryCount === 0));
  f.visuals.dispose(); f.runtime.stop(); f.monitor.dispose();
  assert.equal(f.monitor.entries.size, 0); assert.equal(f.entry.plane.parent, null);
  assert(!Object.keys(f.ctx.raycontrol.states).some(key => key.startsWith(f.monitor.prefix)));
  disposals.forEach(count => assert.equal(count(), 1));
  assert.equal(JSON.stringify(await f.document.serialize()), authored, 'Real monitor use never mutates the saved equipment, graph or authored controls.');
  await mixedLine();
  await authoringReferences();
  await denseCaptions();
  await currentProductCustody();
  await detailedGeometry();
  await analyticsAndEquipment();
  await contextualManualCommands();
  console.log('Line monitor: real deck/product footprints, independent 2D zoom and metadata inspection, live analytics/I-MR and machine information pages, bilateral ray UV commands, module/line scope, latching emergency, obstruction/reach/front checks, static preview, frustum/4Hz resource reuse, cancellation and exact disposal/restoration passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
