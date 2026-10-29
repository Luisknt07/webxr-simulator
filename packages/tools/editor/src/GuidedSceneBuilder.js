import * as THREE from 'three';
import schema from '../../../../modules/logistica-industrial/contracts/behaviors.js';
import guidePlan from '../../../project-model/shared/guided-scene-plan.js';
import ConveyorAssembly from '../../../../modules/logistica-industrial/functions/bandas/runtime/ConveyorAssembly.js';
import {createLineMonitor} from './MonitorWidgetTools.js';
import {buildCediEnvironment} from '../../../../modules/logistica-industrial/scenarios/IndustrialCediEnvironment.js';
import {applyIndustrialFloorPresentation} from '../../../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialFloorPresentation.js';

const TYPES = ['source', 'conveyor', 'processor', 'palletQueue'];
const config = (document, object) => document.getBehaviors(object).find(value => TYPES.includes(value.type));
const patch = (document, object, values) => document.setBehaviors(object, document.getBehaviors(object).map(value => TYPES.includes(value.type) ? Object.assign({}, value, values) : value));
function profiles(plan) {
  const colors = ['#b78b53', '#527fbd', '#64a582', '#b77998', '#d2af53', '#7884b5', '#c38359', '#5f9f9c'];
  return Array.from({length: plan.productCount}, (_, index) => ({id: 'perfil-' + (index + 1), name: 'Producto ' + (index + 1),
    type: plan.productKinds[index % plan.productKinds.length], width: .22 + (index % 3) * .06, depth: .28 + (index % 3) * .06,
    height: .20 + (index % 3) * .06, mass: 1 + index * .5, base: 'rigid', color: colors[index],
    quality: index % 3 === 2 ? 'defective' : 'good', defect: index % 3 === 2 ? 'damaged' : 'none'}));
}
function bounds(root, objects) {
  root.updateWorldMatrix(true, true); const inverse = new THREE.Matrix4().getInverse(root.matrixWorld), result = new THREE.Box3();
  const visit = object => { if (!object.visible || object.userData.editorHelper || object.userData.editorRuntimeHelper || object.userData.industrialSensorVolume) return; if (object.geometry) { if (!object.geometry.boundingBox) object.geometry.computeBoundingBox(); if (object.geometry.boundingBox) result.union(object.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld))); } object.children.forEach(visit); };
  objects.forEach(visit); return result;
}
/** Parameter-based construction uses real catalogue actors and measured ports.
 * It never evaluates generated code or modifies a pre-existing flow graph. */
export function buildGuidedScene(document, roomId, input, options = {}) {
  const plan = guidePlan.normalizePlan(input), root = document.getRoot(roomId);
  if (!root || document.loading || document.transaction) throw new Error('Termina la operación actual antes de construir la propuesta.');
  if (!plan.understood) throw new Error('Describe una línea del catálogo o selecciona manualmente sus parámetros.');
  const previousMachines = document.getObjects(roomId).filter(object => config(document, object));
  if (options.environment && previousMachines.some(object => { for (let node = object; node && node !== root; node = node.parent) if (!node.visible) return false; return true; })) throw new Error('El entorno completo se prepara en un nivel vacío. Desmarca esa opción para añadir sólo la línea.');
  const scene = options.scene || root, assembly = new ConveyorAssembly({document, roomId, root, ctx: {scene}, hooks: {renderScene: scene}, assemblyMessage() {}});
  const machines = [], objects = [], links = [], conveyors = [], sources = [], receivers = [], catalogue = profiles(plan), origin = options.position || [0, 1, 0];
  const add = (kind, variant, name, values = {}) => {
    const object = document.addPrefab(roomId, kind, variant); document.setProperty(object, 'name', name);
    const defaults = kind === 'conveyor' ? {powered: true, running: true, autoSpawn: false, withPanel: false, withSensors: false, speed: plan.speed, length: plan.length, width: plan.width, rollerPitch: .06} :
      kind === 'source' ? {running: true, autoGenerate: plan.automatic, withPanel: false, generationMode: 'sequence', catalog: JSON.stringify(catalogue), initialCount: plan.automatic ? 1 : 0, totalLimit: plan.quantity, capacity: 8, interval: 2.5, outputInterval: .6, delivery: plan.automatic ? 'automatic' : 'manual'} :
        kind === 'processor' ? {powered: true, running: true, withPanel: false, processTime: plan.processTime, setupTime: plan.setupTime, requiresOperator: false, delivery: 'automatic', length: plan.length, capacity: 8, outputCapacity: 8} :
          {running: true, withPanel: false, delivery: 'manual', palletCapacity: 4, palletType: 'euro-1200x800', layoutMode: 'fit', maxStackHeight: 1.8, columns: 4, rows: 3, layers: 5, capacity: 200, autoRelease: plan.quantity === 0, releaseInterval: 4};
    patch(document, object, Object.assign(defaults, values)); document.setTransform(object, {position: origin}); machines.push(object); objects.push(object);
    if (kind === 'conveyor') conveyors.push(object); if (kind === 'source') sources.push(object); if (kind === 'palletQueue') receivers.push(object); return object;
  };
  const straight = name => add('conveyor', plan.technology === 'belt' ? 'belt' : 'roller-motor', name);
  const connect = (from, to, output = 'output', inputPort = 'input') => {
    if (!assembly.align(from, output, to, inputPort)) throw new Error('La propuesta contiene puertos que no se pueden alinear.');
    const assessment = assembly.assessConnection(from, output, to, inputPort);
    if (!assessment.ready) throw new Error(assessment.reasons.map(value => value.message).join(' '));
    if (!assembly.connect(assembly.pair(to, inputPort, from, output))) throw new Error('No se pudo conectar la propuesta.');
    links.push({source: from.userData.editorId, sourcePort: output, target: to.userData.editorId, targetPort: inputPort});
  };
  document.begin();
  try {
    const source = add('source', undefined, 'Source · ' + plan.productCount + ' perfiles'), first = straight('Transportador 01'); connect(source, first);
    let last = first, controller = first;
    if (plan.shape === 'straight') {
      for (let index = 1; index < plan.conveyorCount; index++) { const next = straight('Transportador ' + String(index + 1).padStart(2, '0')); connect(last, next); last = next; }
    } else if (plan.shape === 'l') {
      const before = Math.ceil((plan.conveyorCount - 1) / 2), after = plan.conveyorCount - before - 1;
      for (let index = 1; index < before; index++) { const next = straight('Recta de entrada ' + (index + 1)); connect(last, next); last = next; }
      const turn = add('conveyor', plan.turn === 'curve' ? plan.technology === 'belt' ? 'belt-curve' : 'roller-curve' : 'popup-belt', plan.turn === 'curve' ? 'Curva a 90°' : 'Transferencia rectangular a 90°', {length: plan.turn === 'curve' ? Math.max(plan.length, plan.width * 2) : plan.width, routing: plan.turn === 'curve' ? 'primary' : 'branch', branchSide: 'left', withSensors: plan.turn !== 'curve'}); connect(last, turn); last = turn;
      for (let index = 0; index < after; index++) { const next = straight('Recta de salida ' + (index + 1)); connect(last, next, last === turn && plan.turn !== 'curve' ? 'branch' : 'output'); last = next; }
    } else if (plan.shape === 't') {
      const value = plan.routing === 'percentage' || plan.routing === 'alternate' ? plan.routing : 'rules';
      const field = plan.routing === 'quality' ? 'quality' : plan.routing === 'productType' ? 'productType' : 'color', targetValue = field === 'quality' ? 'defective' : field === 'productType' ? catalogue[0].type : catalogue[0].color;
      const junction = add('conveyor', 'distributor', 'Clasificador · ' + plan.routing, {routing: value, withSensors: true, branchPercentage: 50, routingDefault: 'main', routingRules: JSON.stringify([{field, operator: 'eq', value: targetValue, route: 'branch'}])}); connect(last, junction);
      const main = straight('Salida principal'), branch = straight('Salida clasificada'); connect(junction, main); connect(junction, branch, 'branch'); last = main;
      const branchQueue = add('palletQueue', undefined, 'Almacén · ramal clasificado'); connect(branch, branchQueue);
      for (let index = 4; index < plan.conveyorCount; index++) { const next = straight('Recta principal ' + (index - 2)); connect(last, next); last = next; }
      controller = junction;
    } else {
      const merge = add('conveyor', 'merge-angle', 'Unión coordinada en Y', {mergeAngle: 45, withSensors: true}), second = straight('Segunda entrada'), output = straight('Salida común'); connect(first, merge); connect(merge, output);
      if (!assembly.align(merge, 'branch', second, 'output') || !assembly.connect(assembly.pair(second, 'output', merge, 'branch'))) throw new Error('No se pudo alinear la segunda entrada de la Y.');
      links.push({source: second.userData.editorId, sourcePort: 'output', target: merge.userData.editorId, targetPort: 'branch'});
      const secondQuantity = plan.quantity ? Math.floor(plan.quantity / 2) : 0;
      const secondSource = add('source', undefined, 'Source · segunda entrada', {totalLimit: plan.quantity && !secondQuantity ? 1 : secondQuantity, autoGenerate: plan.automatic && (plan.quantity === 0 || secondQuantity > 0), initialCount: plan.automatic && (plan.quantity === 0 || secondQuantity > 0) ? 1 : 0});
      patch(document, source, {totalLimit: plan.quantity ? Math.ceil(plan.quantity / 2) : 0});
      if (!assembly.align(second, 'input', secondSource, 'output')) throw new Error('No se pudo alinear el segundo Source.');
      if (!assembly.connect(assembly.pair(second, 'input', secondSource, 'output'))) throw new Error('No se pudo conectar el segundo Source.');
      links.push({source: secondSource.userData.editorId, sourcePort: 'output', target: second.userData.editorId, targetPort: 'input'}); last = output; controller = merge;
      for (let index = 4; index < plan.conveyorCount; index++) { const next = straight('Recta común ' + (index - 2)); connect(last, next); last = next; }
    }
    if (plan.processor) { const processor = add('processor', plan.processor === 'process' ? undefined : plan.processor, 'Proceso · ' + plan.processor); connect(last, processor); last = processor; }
    const receiver = add('palletQueue', undefined, 'Almacén final · cuatro estibas'); connect(last, receiver);
    patch(document, plan.automatic ? controller : source, {withPanel: true});
    if (!plan.automatic) controller = source;
    controller.traverse(node => { const values = document.getBehaviors(node); if (values.some(value => value.type === 'control')) document.setBehaviors(node, values.map(value => value.type === 'control' ? Object.assign({}, value, {scope: 'line'}) : value)); });
    if (options.environment) {
      const center = bounds(root, machines).getCenter(new THREE.Vector3()); machines.forEach(object => document.setTransform(object, {position: object.position.clone().sub(new THREE.Vector3(center.x, 0, center.z)).toArray()}));
    }
    const area = bounds(root, machines);
    let monitor = null;
    if (plan.monitor) { monitor = createLineMonitor(document, roomId, controller, {title: plan.title, position: [area.min.x - 2, 2, area.max.z + 2]}); objects.push(monitor); }
    const studio = document.studio || {}, group = {id: 'guided-' + source.userData.editorId, roomId, name: plan.title, members: objects.map(object => object.userData.editorId)};
    document.setStudio({groups: (studio.groups || []).concat(group)});
    let environment = null;
    if (options.environment) {
      document.getObjects(roomId).filter(object => !document.isNative(object) && object.name === 'Suelo del nivel').forEach(object => document.remove(object));
      const allBounds = bounds(root, objects);
      environment = buildCediEnvironment(document, roomId, {width: Math.max(24, Math.ceil((Math.max(Math.abs(allBounds.min.x), Math.abs(allBounds.max.x)) * 2 + 10) / 4) * 4), depth: Math.max(24, Math.ceil((Math.max(Math.abs(allBounds.min.z), Math.abs(allBounds.max.z)) * 2 + 10) / 4) * 4), floor: true});
      applyIndustrialFloorPresentation(document, roomId, {floorObject: environment.floor}); objects.push(...environment.objects);
      const originalStudio = document.studio || {}; document.setStudio({groups: (originalStudio.groups || []).concat({id: 'guided-environment-' + source.userData.editorId, roomId, name: 'Entorno · ' + plan.title, members: environment.objects.map(object => object.userData.editorId)})});
    }
    // Every persisted edge is checked after the complete graph is assembled.
    links.forEach(link => { const from = document.getObject(link.source), to = document.getObject(link.target), result = assembly.assessConnection(from, link.sourcePort, to, link.targetPort); if (!result.ready) throw new Error('La propuesta no conserva una conexión física válida.'); });
    document.commit(); return {plan, objects, machines, conveyors, sources, receivers, monitor, controller, links, environment, group};
  } catch (error) { document.cancel(); throw error; } finally { assembly.clear(); }
}

const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Lightweight proposal diagram; all actual transforms are solved at build. */
export function guidedPlanDiagram(value) {
  const p = guidePlan.normalizePlan(value), n = p.conveyorCount, nodes = [], edges = [], h = 48, pad = 28, row = 78;
  const before = Math.ceil((n - 1) / 2), after = n - before - 1;
  const columns = p.shape === 'l' ? before + 2 : n + 2 + (p.processor ? 1 : 0) - (p.shape === 't' || p.shape === 'y' ? 1 : 0);
  const width = Math.max(640, Math.min(1040, columns * 110 + (columns - 1) * 26 + pad * 2));
  const w = Math.min(110, (width - pad * 2 - (columns - 1) * 22) / columns), step = (width - pad * 2 - w) / (columns - 1);
  const upper = 108, mainY = p.shape === 'l' ? upper + (after + 1 + (p.processor ? 1 : 0)) * row : 114;
  const height = p.shape === 'l' ? mainY + h + 70 : p.shape === 't' ? 114 + row * 2 + h + 70 : p.shape === 'y' ? 114 + row + h + 70 : 114 + h + 70;
  const colors = {source: '#536346', conveyor: '#245363', transfer: '#41615e', junction: '#586047', processor: '#655375', queue: '#74603b'};
  const add = (id, kind, column, y, title, subtitle) => { const node = {id, kind, x: pad + column * step, y, w, h, title, subtitle}; nodes.push(node); return node; };
  const join = (from, to) => { edges.push({from, to}); return to; };
  const transport = (index, column, y, kind = 'conveyor', label) => add('transport-' + index, kind, column, y, String(index).padStart(2, '0'), label || (p.technology === 'belt' ? 'Banda' : 'Rodillos'));
  let last = add('source-a', 'source', 0, mainY, 'Source A', p.productCount + ' perfiles');
  let lastColumn, lastY;
  if (p.shape === 'l') {
    for (let index = 1; index <= before; index++) last = join(last, transport(index, index, mainY));
    last = join(last, transport(before + 1, before + 1, mainY, 'transfer', p.turn === 'curve' ? 'Curva 90°' : 'Transf. 90°'));
    for (let index = 1; index <= after; index++) last = join(last, transport(before + 1 + index, before + 1, mainY - index * row));
    lastColumn = before + 1; lastY = last.y - row;
  } else if (p.shape === 't' || p.shape === 'y') {
    last = join(last, transport(1, 1, mainY));
    const junction = join(last, transport(2, 2, mainY, 'junction', p.shape === 't' ? 'Desvío T' : 'Unión Y'));
    if (p.shape === 't') {
      const branch = join(junction, transport(4, 2, mainY + row));
      join(branch, add('queue-b', 'queue', 2, mainY + row * 2, 'Almacén B', '4 estibas'));
    } else {
      const secondSource = add('source-b', 'source', 0, mainY + row, 'Source B', p.productCount + ' perfiles');
      const branch = join(secondSource, transport(3, 1, mainY + row)); join(branch, junction);
    }
    last = join(junction, transport(p.shape === 't' ? 3 : 4, 3, mainY));
    for (let index = 5; index <= n; index++) last = join(last, transport(index, index - 1, mainY));
    lastColumn = n; lastY = mainY;
  } else {
    for (let index = 1; index <= n; index++) last = join(last, transport(index, index, mainY));
    lastColumn = n + 1; lastY = mainY;
  }
  if (p.processor) {
    last = join(last, add('processor', 'processor', lastColumn, lastY, p.processor === 'combiner' ? 'Combiner' : p.processor === 'separator' ? 'Separador' : 'Proceso', p.processTime + ' s'));
    if (p.shape === 'l') lastY -= row; else lastColumn++;
  }
  join(last, add('queue-a', 'queue', lastColumn, lastY, p.shape === 't' ? 'Almacén A' : 'Almacén', '4 estibas'));
  // Clip each directed connection to both real node borders. The arrowhead
  // reaches its receiver; no floating stubs or edges hidden beneath boxes.
  const endpoint = (a, b) => { const dx = b.x + b.w / 2 - a.x - a.w / 2, dy = b.y + b.h / 2 - a.y - a.h / 2, t = Math.min(dx ? a.w / 2 / Math.abs(dx) : Infinity, dy ? a.h / 2 / Math.abs(dy) : Infinity); return [a.x + a.w / 2 + dx * t, a.y + a.h / 2 + dy * t]; };
  const paths = edges.map(edge => { const a = endpoint(edge.from, edge.to), b = endpoint(edge.to, edge.from); return '<path data-from="' + edge.from.id + '" data-to="' + edge.to.id + '" d="M' + a.join(',') + 'L' + b.join(',') + '" fill="none" stroke="#7be4cc" stroke-width="2.5" marker-end="url(#guided-flow-arrow)"/>'; }).join('');
  const boxes = nodes.map(node => {
    const font = Math.min(13, (node.w - 10) / (Math.max(node.title.length, node.subtitle.length) * .6));
    return '<g data-node="' + node.id + '" data-kind="' + node.kind + '"><title>' + escape(node.title + ' · ' + node.subtitle) + '</title><rect x="' + node.x + '" y="' + node.y + '" width="' + node.w + '" height="' + node.h + '" rx="6" fill="' + colors[node.kind] + '" stroke="#8299a5" stroke-width="1"/><text x="' + (node.x + node.w / 2) + '" y="' + (node.y + 20) + '" text-anchor="middle" fill="#f3fbff" font-size="' + font + '" font-weight="600">' + escape(node.title) + '</text><text x="' + (node.x + node.w / 2) + '" y="' + (node.y + 37) + '" text-anchor="middle" fill="#c8dce6" font-size="' + font + '">' + escape(node.subtitle) + '</text></g>';
  }).join('');
  const subtitle = p.shape === 'l' ? p.turn === 'curve' ? 'L con curva continua a 90°' : 'L rectangular con transferencia a 90°' : guidePlan.SHAPES[p.shape];
  const title = p.title.length > 60 ? p.title.slice(0, 59) + '…' : p.title;
  const monitor = p.monitor ? '<rect x="' + (width - 180) + '" y="57" width="152" height="25" rx="12" fill="#314c65"/><text x="' + (width - 104) + '" y="74" text-anchor="middle" fill="#bfeee2" font-size="12">Monitor · toda la línea</text>' : '';
  const footer = p.productCount + ' perfiles · ' + (p.quantity ? p.quantity + ' cargas' : 'Generación continua') + ' · ' + (p.automatic ? 'Flujo automático' : 'Carga manual');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escape('Esquema de ' + subtitle) + '"><title>' + escape(p.title) + '</title><desc>Las flechas conectan cada equipo desde Source hasta su almacén. Esquema funcional; las dimensiones se resuelven al construir.</desc><defs><marker id="guided-flow-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0L7,3.5L0,7Z" fill="#7be4cc"/></marker></defs><rect width="' + width + '" height="' + height + '" rx="10" fill="#14232f"/><text x="28" y="31" fill="#e4f3fa" font-size="17" font-weight="600">' + escape(title) + '</text><text x="28" y="76" fill="#a8c8d7" font-size="13">' + escape(subtitle) + '</text>' + monitor + paths + boxes + '<text x="28" y="' + (height - 25) + '" fill="#b7d2df" font-size="12">' + escape(footer) + '</text></svg>';
}
