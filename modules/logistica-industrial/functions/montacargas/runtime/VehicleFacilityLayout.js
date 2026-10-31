import * as THREE from 'three';

const MACHINE_TYPES = ['conveyor', 'source', 'processor', 'palletQueue', 'robot', 'vehicle'];
const LIMIT = 200, MESH_LIMIT = 600, POINT_LIMIT = 128, LOCATION_LIMIT = 256;
const C = {background: '#10232e', floor: '#193441', grid: '#274854', wall: '#52717b', text: '#ecf6f7', muted: '#a7c0c7',
  conveyor: '#55a1bd', source: '#58ab8a', processor: '#869eae', palletQueue: '#547eac', robot: '#e39d58', vehicle: '#bdcbd0',
  walkway: '#27534f', bay: '#2c4145',
  product: '#d7c59a', pickup: '#39d9ed', drop: '#ffc34d', ready: '#70e3b1', blocked: '#f17f87', outline: '#10252e'};
const TYPE_LABELS = {conveyor: 'Banda', source: 'Carga', processor: 'Proceso', palletQueue: 'Almacén', robot: 'Robot', vehicle: 'Vehículo', bay: 'Pallet a piso'};
const shown = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return !!object; };
const helper = object => !!(object && object.userData && (object.userData.editorHelper || object.userData.editorRuntimeHelper || object.userData.editorDecal || object.userData.editorGeometryReplaced || object.userData.industrialSensorVolume));
const within = (object, root) => { for (let node = object; node; node = node.parent) if (node === root) return true; return false; };
const finite = value => Number.isFinite(value) && Math.abs(value) < 100000;
const text = (value, size = 64) => String(value || '').replace(/\s+/g, ' ').slice(0, size);
const freezePoints = values => Object.freeze(values.map(value => Object.freeze(value)));
const worldPoint = value => Array.isArray(value) && value.length >= 3 && finite(value[0]) && finite(value[2]) ? [value[0], value[2]] : value && finite(value.x) && finite(value.z) ? [value.x, value.z] : null;
const frozenWorldPoint = value => { const point = worldPoint(value); return point && Object.freeze(point); };
const centroid = points => points.length ? points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length], [0, 0]) : null;
const polygonBounds = points => points.reduce((box, p) => ({minX: Math.min(box.minX, p[0]), minZ: Math.min(box.minZ, p[1]), maxX: Math.max(box.maxX, p[0]), maxZ: Math.max(box.maxZ, p[1])}), {minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity});
const hull = points => {
  const sorted = points.filter(p => finite(p[0]) && finite(p[1])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = values => { const result = []; values.forEach(point => { while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], point) <= 1e-8) result.pop(); result.push(point); }); return result; };
  return half(sorted).slice(0, -1).concat(half(sorted.slice().reverse()).slice(0, -1));
};
const footprintWidth = points => {
  let area = 0, length = 0;
  points.forEach((point, index) => { const next = points[(index + 1) % points.length]; area += point[0] * next[1] - point[1] * next[0]; for (const other of points) length = Math.max(length, Math.hypot(other[0] - point[0], other[1] - point[1])); });
  return length > 0 ? Math.abs(area) / (2 * length) : 0;
};
function corners(bounds, matrix, out, scratch) {
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    scratch.set(x, y, z).applyMatrix4(matrix); if (finite(scratch.x) && finite(scratch.z)) out.push([scratch.x, scratch.z]);
  }
}

/** A bounded CPU canvas projection of the current installation. It owns no
 * world mesh, camera, command, reservation, route progress or inventory. */
export default class VehicleFacilityLayout {
  constructor(driving, options = {}) {
    this.driving = driving; this.now = options.now || (() => typeof performance === 'undefined' ? Date.now() : performance.now());
    this.staticAt = this.liveAt = -Infinity; this.scratch = new THREE.Vector3(); this.direction = new THREE.Vector3();
    this.actors = []; this.floors = []; this.model = null; this.stats = {geometryReads: 0, staticUpdates: 0, liveUpdates: 0, actors: 0, products: 0, truncated: false};
  }
  reset() { this.actors = []; this.floors = []; this.model = null; this.staticAt = this.liveAt = -Infinity; }
  boundsOf(object, budget) {
    const points = []; let meshes = 0;
    object.updateWorldMatrix(true, true);
    const visit = node => {
      if (!shown(node) || helper(node) || budget.value <= 0 || points.length >= POINT_LIMIT) return;
      // A carried pallet is an independent live symbol, not truck bodywork.
      if (node !== object && node.userData && (node.userData.vehicleOwnerId || node.userData.sourceProduct)) return;
      if (node.geometry && meshes < 16) {
        const geometry = node.geometry; if (!geometry.boundingBox) geometry.computeBoundingBox();
        if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) { corners(geometry.boundingBox, node.matrixWorld, points, this.scratch); meshes++; budget.value--; this.stats.geometryReads++; }
      }
      node.children.forEach(visit);
    };
    visit(object); return hull(points);
  }
  scan(simulation, document, root) {
    this.stats.staticUpdates++; this.stats.truncated = false;
    const actors = [], floorCandidates = [], excluded = new Set(), budget = {value: MESH_LIMIT}; let locations = 0;
    const records = simulation.records ? Array.from(simulation.records.values()) : [];
    for (const record of records) {
      if (actors.length >= LIMIT) { this.stats.truncated = true; break; }
      if (!record || !record.object || !shown(record.object) || !within(record.object, root)) continue;
      const type = MACHINE_TYPES.find(key => record.components && record.components[key]);
      if (!type) continue; excluded.add(record.object);
      if (type === 'vehicle') continue;
      const points = this.boundsOf(record.object, budget); if (points.length < 3) continue;
      const component = record.components[type], config = component.config || {}, name = record.object.name || record.id;
      let rack = null;
      if (type === 'palletQueue' && component.rack && component.rack.layout) {
        const columns = new Map(), cells = component.rack.layout.cells || [], queue = simulation.palletQueueRuntime;
        for (const cell of cells) {
          const key = [cell.bank, cell.bay, cell.column, cell.depthIndex].join(':'); let column = columns.get(key);
          if (!column) {
            if (locations >= LOCATION_LIMIT) { this.stats.truncated = true; continue; }
            const position = queue && queue.rackPoint ? queue.rackPoint(component, cell) : cell.position;
            if (!Array.isArray(position) || !position.every(finite)) continue;
            const outline = [[-1,-1],[1,-1],[1,1],[-1,1]].map(sign => {this.scratch.set(position[0]+sign[0]*cell.width/2,position[1],position[2]+sign[1]*cell.depth/2).applyMatrix4(record.object.matrixWorld);return [this.scratch.x,this.scratch.z];});
            column = {key, bay:cell.bay, column:cell.column, points:freezePoints(outline), cells:[]};columns.set(key,column);locations++;
          }
          column.cells.push(Object.freeze({index:cell.index,code:cell.code,level:cell.level}));
        }
        rack=Object.freeze({aisle:text(config.rackAisleCode,16),row:text(config.rackRowCode,16),levels:config.rackLevels||1,
          columns:Object.freeze(Array.from(columns.values(),column=>Object.freeze({...column,cells:Object.freeze(column.cells)})))});
      }
      actors.push(Object.freeze({id: record.id, type, name: text(name), points: freezePoints(points), configType: config.rackSystem || config.rackType || '', rack, state: ''}));
    }
    if (simulation.products) simulation.products.forEach(product => { if (product && product.object) excluded.add(product.object); });
    const visit = node => {
      if (!node || !shown(node) || helper(node) || excluded.has(node) || budget.value <= 0 || actors.length >= LIMIT) return;
      const descriptor = node.userData && node.userData.editorDescriptor;
      if (descriptor && descriptor.type === 'industrialFloor') {
        for (const [key, type] of [['walkways', 'walkway'], ['bays', 'bay']]) for (const [index, row] of (descriptor[key] || []).slice(0, 80).entries()) {
          if (actors.length >= LIMIT) break;
          if (!Array.isArray(row) || row.length < 4 || !row.slice(0, 4).every(finite)) continue;
          const points = [[row[0], row[1]], [row[2], row[1]], [row[2], row[3]], [row[0], row[3]]].map(point => { this.scratch.set(point[0], descriptor.floorY || 0, point[1]).applyMatrix4(node.matrixWorld); return [this.scratch.x, this.scratch.z]; });
          actors.push(Object.freeze({id: (node.userData.editorId || node.uuid) + ':' + type + ':' + index, type, name: type === 'walkway' ? 'Pasillo peatonal' : 'Demarcación de pallet', points: freezePoints(points), state: ''}));
        }
      }
      if (node.geometry) {
        const geometry = node.geometry; if (!geometry.boundingBox) geometry.computeBoundingBox();
        if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) {
          const box = geometry.boundingBox.clone().applyMatrix4(node.matrixWorld), size = box.getSize(this.scratch), points = [];
          budget.value--; this.stats.geometryReads++; corners(geometry.boundingBox, node.matrixWorld, points, this.direction);
          const outline = hull(points); let identified = node;
          while (identified.parent && identified.parent !== root && !(identified.userData && identified.userData.editorId)) identified = identified.parent;
          const nativeId = identified.userData && identified.userData.editorId;
          // A roof or a distant panorama cannot enlarge the facility map.
          if (size.x >= 6 && size.z >= 6 && size.y <= .55) {
            let parent = node, authored = false;
            while (parent && parent !== root) { if (parent.userData && /^custom-/.test(parent.userData.editorId || '')) authored = true; parent = parent.parent; }
            floorCandidates.push({points: outline, area: size.x * size.z, y: box.max.y, authored});
          } else if (size.y >= .4 && footprintWidth(outline) < .7) {
            actors.push(Object.freeze({id: nativeId || node.uuid, type: 'wall', name: text(identified.name || node.name), points: freezePoints(outline), state: ''}));
          }
        }
      }
      node.children.forEach(visit);
    };
    root.updateWorldMatrix(true, true); visit(root);
    const preferred = floorCandidates.some(floor => floor.authored) ? floorCandidates.filter(floor => floor.authored) : floorCandidates;
    const lowest = preferred.length ? Math.min(...preferred.map(floor => floor.y)) : 0;
    const ground = preferred.filter(floor => floor.y <= lowest + .55).sort((a, b) => b.area - a.area);
    const floor = ground[0];
    this.floors = floor ? [Object.freeze({points: freezePoints(floor.points), y: floor.y, authored:floor.authored})] : [];
    this.actors = actors; this.stats.actors = actors.length;
    if (budget.value <= 0 || actors.length >= LIMIT) this.stats.truncated = true;
  }
  position(object) { if (!object || !shown(object)) return null; object.updateWorldMatrix(true, false); object.getWorldPosition(this.scratch); return [this.scratch.x, this.scratch.z]; }
  product(simulation, id) {
    const training = simulation.vehicleTraining;
    if (training && typeof training.product === 'function') return training.product(id);
    let found = null; if (simulation.products) simulation.products.forEach(value => { if (!found && value && (value.record && value.record.id === id || value.object.userData.sourcePalletId === id)) found = value; }); return found;
  }
  location(simulation, id, product, code, slot) {
    const record = simulation.records && simulation.records.get(id); if (!record || !record.object || !shown(record.object)) return null;
    const stock = record.components && record.components.palletQueue, queue = simulation.palletQueueRuntime;
    if (stock && stock.rack && queue) {
      const cells = stock.rack.layout && stock.rack.layout.cells || [], cell = cells.find(value => code ? value.code === code : Number.isInteger(slot) && value.index === slot);
      if (cell && product && product.bounds && queue.rackMatrix && queue.rackPoint) {
        const matrix = queue.rackMatrix(record, product, queue.rackPoint(stock, cell));
        product.bounds.getCenter(this.scratch).applyMatrix4(matrix); return [this.scratch.x, this.scratch.z];
      }
    }
    if (stock && stock.pallets && Number.isInteger(slot) && stock.pallets[slot] && stock.pallets[slot].object) return this.position(stock.pallets[slot].object);
    return this.position(record.object);
  }
  update(record, supplied = {}) {
    if (this.disposed) return null;
    const driving = this.driving, simulation = driving && driving.simulation, document = simulation && simulation.document || driving && driving.ctx && driving.ctx.editor && driving.ctx.editor.document;
    const roomId = simulation && simulation.roomId, root = document && document.getRoot && document.getRoot(roomId);
    if (!record || !root || !simulation || !shown(record.object) || !within(record.object, root)) { this.reset(); return null; }
    const session = [roomId, simulation.runSequence || ''].join(':');
    if (simulation !== this.simulation || root !== this.root || session !== this.session) { this.reset(); this.simulation = simulation; this.root = root; this.session = session; }
    const now = this.now();
    if (!supplied.force && now - this.liveAt < 200 && this.model) return this.model;
    if (supplied.force || now - this.staticAt >= 500) { this.scan(simulation, document, root); this.staticAt = now; }
    this.liveAt = now; this.stats.liveUpdates++;
    const vehicleComponent = record.components.vehicle, vehiclePosition = this.position(record.object);
    const config = vehicleComponent.config || {}, width = config.width || 1.1, length = config.length || 2;
    const vehiclePoints = [];
    for (const x of [-width / 2, width / 2]) for (const z of [-length / 2, length / 2]) { this.scratch.set(x, 0, z).applyMatrix4(record.object.matrixWorld); vehiclePoints.push([this.scratch.x, this.scratch.z]); }
    this.direction.set(0, 0, 1).transformDirection(record.object.matrixWorld);
    const bodyColor = config.frameColor || config.color;
    const vehicle = Object.freeze({id: record.id, name: text(record.object.name), position: Object.freeze(vehiclePosition), points: freezePoints(hull(vehiclePoints)), heading: Math.atan2(this.direction.x, this.direction.z), color: /^#[a-f\d]{6}$/i.test(bodyColor || '') ? bodyColor : '#ffc34d'});
    const products = [], allPoints = [];
    if (simulation.products) simulation.products.forEach(product => {
      if (products.length >= LIMIT || !product || !product.object || !product.bounds || !shown(product.object) || !within(product.object, root)) return;
      product.object.updateWorldMatrix(true, false); const points = []; corners(product.bounds, product.object.matrixWorld, points, this.scratch);
      const id = product.record && product.record.id || product.object.userData.sourcePalletId || product.sourceEntry && product.sourceEntry.id || product.object.uuid;
      products.push(Object.freeze({id, type: 'product', name: text(product.object.name), points: freezePoints(hull(points)), carried: product.vehicleOwnerId === record.id}));
    });
    const lesson = supplied.lesson === undefined ? simulation.vehicleTraining && simulation.vehicleTraining.guidance(record) : supplied.lesson;
    const guide = supplied.guide === undefined ? driving.holographicGuide && driving.holographicGuide.getState && driving.holographicGuide.getState() : supplied.guide;
    let mission = null;
    if (lesson) {
      const product = this.product(simulation, lesson.productId), pickup = lesson.phase === 'pickup' && product ? this.position(product.object) : this.location(simulation, lesson.sourceId, product, lesson.sourceLocationCode), destination = this.location(simulation, lesson.destinationId, product, lesson.locationCode, lesson.destinationSlot);
      const raw = Array.isArray(lesson.route) ? lesson.route.slice(Math.max(0, lesson.waypointIndex || 0)).map(worldPoint).filter(Boolean) : [];
      const path = guide && (!guide.taskId || guide.taskId === lesson.taskId) && guide.routePath;
      // An empty path means that no collision checker verified the corridor.
      const verified = !!(path && Array.isArray(path.points) && (path.points.length >= 2 || path.blocked && path.points.length));
      const route = verified ? path.points.map(worldPoint).filter(Boolean).slice(0, 64) : [vehiclePosition].concat(raw).slice(0, 64);
      mission = Object.freeze({taskId: lesson.taskId || '', phase: lesson.phase, title: text(lesson.title, 100), locationCode: lesson.phase === 'pickup' ? lesson.sourceLocationCode || '' : lesson.locationCode || '',
        pickup: pickup && Object.freeze(pickup), destination: destination && Object.freeze(destination), target: lesson.phase === 'pickup' ? pickup : destination,
        route: freezePoints(route), plannedRoute: freezePoints([vehiclePosition].concat(raw).slice(0, 64)), verified, blocked: !!(lesson.routeFault || path && path.blocked), stop: path && frozenWorldPoint(path.stop),
        index: lesson.waypointIndex || 0, total: Array.isArray(lesson.route) ? lesson.route.length : 0, completed: lesson.completed || 0, missionTotal: lesson.total || 0});
    } else if (guide && ['pickup', 'drop'].includes(guide.phase)) {
      // Reuse the guide's already chosen physical target. Do not call the
      // placement/collision planners again or turn a bearing into a route.
      const liveGuide = driving.holographicGuide;
      const current = guide.currentTarget || liveGuide && liveGuide.enabled && liveGuide.currentTarget || (guide.targets || []).find(target => target.id === guide.targetId && target.matrix && target.bounds);
      const owner = current && (current.record && current.record.object || current.product && current.product.object);
      if (current && (!owner || within(owner, root)) && current.kind === guide.phase && (!guide.targetId || current.id === guide.targetId)) {
        let target = null;
        if (current.matrix && current.bounds) { current.bounds.getCenter(this.scratch).applyMatrix4(current.matrix); if (finite(this.scratch.x) && finite(this.scratch.z)) target = [this.scratch.x, this.scratch.z]; }
        if (!target && current.kind === 'pickup' && current.product && current.product.object) target = this.position(current.product.object);
        if (!target && current.kind === 'drop') target = this.location(simulation, current.targetId, current.product, current.locationCode, current.slotIndex);
        if (target) {
          Object.freeze(target); const path = guide.routePath, verified = !!(path && Array.isArray(path.points) && (path.points.length >= 2 || path.blocked && path.points.length));
          mission = Object.freeze({taskId: '', manual: true, phase: current.kind, title: text(current.name || guide.targetName || guide.title, 100), locationCode: current.locationCode || '',
            pickup: current.kind === 'pickup' ? target : null, destination: current.kind === 'drop' ? target : null, target,
            route: freezePoints(verified ? path.points.map(worldPoint).filter(Boolean).slice(0, 64) : []), plannedRoute: Object.freeze([]), verified,
            blocked: !!(path && path.blocked), unavailable: current.allowed === false, stop: path && frozenWorldPoint(path.stop), index: 0, total: 0, completed: 0, missionTotal: 0});
        }
      }
    }
    const actors = this.actors.map(actor => {
      const current = simulation.records && simulation.records.get(actor.id), component = current && current.components && current.components[actor.type], variables = current && current.variables || {};
      const state = !component ? '' : variables.emergency || variables.blocked || component.emergency || component.blocked ? 'blocked' : variables.paused || component.paused ? 'paused' : variables.powered === false || component.powered === false || component.enabled === false ? 'off' : variables.running === false || component.running === false ? 'paused' : 'active';
      let rack=actor.rack;
      if(rack&&component&&component.rack){
        const occupied=new Set((component.items||[]).map(item=>item.palletIndex)),reserved=new Set((component.rack.assignments||[]).map(row=>row.locationCode));
        rack=Object.freeze({...rack,columns:Object.freeze(rack.columns.map(column=>Object.freeze({...column,
          occupied:column.cells.filter(cell=>occupied.has(cell.index)).length,reserved:column.cells.filter(cell=>!occupied.has(cell.index)&&reserved.has(cell.code)).length})))});
      }
      return Object.freeze(Object.assign({}, actor, {state,rack}));
    });
    if (simulation.records) simulation.records.forEach(other => {
      if (actors.length >= LIMIT || other === record || !other.object || !within(other.object, root) || !shown(other.object) || !other.components || !other.components.vehicle) return;
      const c = other.components.vehicle.config || {}, points = [];
      other.object.updateWorldMatrix(true, false);
      for (const x of [-(c.width || 1) / 2, (c.width || 1) / 2]) for (const z of [-(c.length || 2) / 2, (c.length || 2) / 2]) { this.scratch.set(x, 0, z).applyMatrix4(other.object.matrixWorld); points.push([this.scratch.x, this.scratch.z]); }
      actors.push(Object.freeze({id: other.id, type: 'vehicle', name: text(other.object.name), points: freezePoints(hull(points)), state: other.components.vehicle.emergency || other.components.vehicle.blocked ? 'blocked' : Math.abs(other.components.vehicle.actualSpeed || 0) > .01 ? 'active' : 'paused'}));
    });
    // A generic 100 m engine floor is a backdrop, not the working installation.
    // Keep the actual floor/walls in the drawing, but fit them only when their
    // extent is proportionate to the equipment, paths and live work targets.
    actors.filter(actor=>actor.type!=='wall').forEach(actor=>{allPoints.push(...actor.points);if(actor.rack)actor.rack.columns.forEach(column=>allPoints.push(...column.points));});products.forEach(product=>allPoints.push(...product.points));allPoints.push(...vehicle.points);
    if (mission) { if (mission.pickup) allPoints.push(mission.pickup); if (mission.destination) allPoints.push(mission.destination); allPoints.push(...mission.plannedRoute, ...mission.route); }
    const focus=polygonBounds(allPoints),focusX=Math.max(6,focus.maxX-focus.minX),focusZ=Math.max(6,focus.maxZ-focus.minZ);
    const fits=points=>{const box=polygonBounds(points);return box.maxX-box.minX<=focusX*1.8&&box.maxZ-box.minZ<=focusZ*1.8&&box.minX>=focus.minX-focusX*.8&&box.maxX<=focus.maxX+focusX*.8&&box.minZ>=focus.minZ-focusZ*.8&&box.maxZ<=focus.maxZ+focusZ*.8;};
    this.floors.forEach(floor=>{if(floor.authored||fits(floor.points))allPoints.push(...floor.points);});actors.filter(actor=>actor.type==='wall'&&fits(actor.points)).forEach(actor=>allPoints.push(...actor.points));
    const bounds = polygonBounds(allPoints);
    if (![bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ].every(finite)) Object.assign(bounds, {minX: -10, minZ: -10, maxX: 10, maxZ: 10});
    const margin = Math.max(.45, Math.min(2, Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * .025));
    bounds.minX -= margin; bounds.minZ -= margin; bounds.maxX += margin; bounds.maxZ += margin;
    this.stats.actors = actors.length; this.stats.products = products.length;
    this.model = Object.freeze({roomId, bounds: Object.freeze(bounds), floors: Object.freeze(this.floors.slice()), actors: Object.freeze(actors), products: Object.freeze(products), vehicle, mission, stats: Object.freeze(Object.assign({}, this.stats))});
    return this.model;
  }
  paint(ctx, width, height, model = this.model) {
    if (!ctx || !model || width < 100 || height < 100 || typeof ctx.save !== 'function' || typeof ctx.beginPath !== 'function') return false;
    ctx.save(); ctx.clearRect(0, 0, width, height); ctx.fillStyle = C.background; ctx.fillRect(0, 0, width, height);
    const font = Math.max(12, Math.min(16, width / 52)), header = font * 1.9, footer = font * 3.8;
    ctx.fillStyle = C.text; ctx.font = 'bold ' + font + 'px sans-serif'; ctx.fillText('PLANO DE LA INSTALACIÓN · EN VIVO', 10, font * 1.3);
    const {bounds, mission, vehicle} = model, box = {x: 8, y: header, width: width - 16, height: Math.max(60, height - header - footer)};
    const rangeX = Math.max(1, bounds.maxX - bounds.minX), rangeZ = Math.max(1, bounds.maxZ - bounds.minZ), centerX=(bounds.minX+bounds.maxX)/2,centerZ=(bounds.minZ+bounds.maxZ)/2;
    const direct=Math.min(box.width/rangeX,box.height/rangeZ),turned=Math.min(box.width/rangeZ,box.height/rangeX),rotate=turned>direct*1.08;
    const scale=rotate?turned:direct,local=point=>rotate?[point[1]-centerZ,centerX-point[0]]:[point[0]-centerX,point[1]-centerZ];
    const xy=point=>{const p=local(point);return [box.x+box.width/2+p[0]*scale,box.y+box.height/2+p[1]*scale];};
    this.projection={screen:xy,scale,rotation:rotate?Math.PI/2:0,plot:{...box},bounds};
    const polygon = (points, fill, stroke, lineWidth = 1) => { if (points.length < 2) return; ctx.beginPath(); points.forEach((p, i) => { const v = xy(p); i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1]); }); ctx.closePath(); if (fill) {ctx.fillStyle = fill; ctx.fill();} if (stroke) {ctx.lineWidth = lineWidth; ctx.strokeStyle = stroke; ctx.stroke();} };
    const line = (points, color, lineWidth, dashed = false) => { if (points.length < 2) return; ctx.beginPath(); ctx.setLineDash(dashed ? [7, 5] : []); points.forEach((p, i) => { const v = xy(p); i ? ctx.lineTo(...v) : ctx.moveTo(...v); }); ctx.lineWidth = lineWidth; ctx.strokeStyle = color; ctx.stroke(); ctx.setLineDash([]); };
    const labels=[],fitText=(value,maxWidth)=>{let valueText=String(value);while(valueText.length>1&&(ctx.measureText?ctx.measureText(valueText).width:valueText.length*font*.55)>maxWidth)valueText=valueText.slice(0,-2);return valueText;};
    const label=(value,point,{color=C.text,size=font*.8,above=false,force=false}={})=>{
      const p=xy(point);if(p[0]<box.x||p[0]>box.x+box.width||p[1]<box.y||p[1]>box.y+box.height)return;
      ctx.font='600 '+size+'px sans-serif';const valueText=fitText(text(value,45),Math.min(box.width*.44,210));if(!valueText)return;
      const w=(ctx.measureText?ctx.measureText(valueText).width:valueText.length*size*.6)+9,h=size+7,x=Math.min(box.x+box.width-w,Math.max(box.x,p[0]-w/2)),y=Math.min(box.y+box.height-h,Math.max(box.y,p[1]+(above?-h-5:5)));
      if(!force&&labels.some(r=>x<r.x+r.w+4&&x+w+4>r.x&&y<r.y+r.h+3&&y+h+3>r.y))return;
      labels.push({x,y,w,h});ctx.fillStyle='#10232ee8';ctx.fillRect(x,y,w,h);ctx.fillStyle=color;ctx.fillText(valueText,x+4,y+size+1);
    };
    // Crop native backdrop geometry while keeping a single metric scale. Only
    // the 2D projection may quarter-turn to use a wide slot; the north marker
    // and vehicle heading rotate with it, never with a second world camera.
    ctx.save();if(ctx.rect&&ctx.clip){ctx.beginPath();ctx.rect(box.x,box.y,box.width,box.height);ctx.clip();}
    model.floors.forEach(floor => polygon(floor.points, C.floor, C.wall));
    ctx.strokeStyle = C.grid; ctx.lineWidth = .6; ctx.beginPath();
    const grid = rangeX > 80 || rangeZ > 80 ? 10 : 2;
    for (let x = Math.ceil(bounds.minX / grid) * grid, i = 0; x < bounds.maxX && i++ < 80; x += grid) { const a = xy([x, bounds.minZ]), b = xy([x, bounds.maxZ]); ctx.moveTo(...a); ctx.lineTo(...b); }
    for (let z = Math.ceil(bounds.minZ / grid) * grid, i = 0; z < bounds.maxZ && i++ < 80; z += grid) { const a = xy([bounds.minX, z]), b = xy([bounds.maxX, z]); ctx.moveTo(...a); ctx.lineTo(...b); } ctx.stroke();
    const paintActor = actor => {
      polygon(actor.points, C[actor.type] || C.wall, actor.state === 'blocked' ? C.blocked : actor.type === 'wall' ? '#78929a' : actor.type === 'bay' ? '#c7ad55' : actor.type === 'walkway' ? '#5a9b87' : '#a5c9d0', actor.state === 'blocked' ? 2 : actor.type === 'wall' ? 1 : .9);
      if(actor.type==='conveyor'&&actor.points.length===4){const points=actor.points;for(let i=1;i<6;i++){const a=[points[0][0]+(points[1][0]-points[0][0])*i/6,points[0][1]+(points[1][1]-points[0][1])*i/6],b=[points[3][0]+(points[2][0]-points[3][0])*i/6,points[3][1]+(points[2][1]-points[3][1])*i/6];line([a,b],'#a6d0da',.6);}}
      if(actor.rack){for(const column of actor.rack.columns){const active=!!(mission&&mission.locationCode&&column.cells.some(cell=>cell.code===mission.locationCode));polygon(column.points,active?'#317c83':column.occupied?'#8f8258':column.reserved?'#326478':'#294857',active?C.pickup:'#b5c8cd',active?2:1);for(const corner of column.points){const p=xy(corner);ctx.fillStyle='#d7e4e5';ctx.fillRect(p[0]-1.4,p[1]-1.4,2.8,2.8);}const bb=polygonBounds(column.points);if(Math.min(bb.maxX-bb.minX,bb.maxZ-bb.minZ)*scale>23)label((column.bay+1)+'.'+(column.column+1)+' · '+column.occupied+'/'+column.cells.length,centroid(column.points),{size:Math.max(9,font*.65),color:active?C.pickup:C.text});}}
      if (actor.state && actor.points.length) { const p = xy(centroid(actor.points)); ctx.beginPath(); ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2); ctx.fillStyle = actor.state === 'active' ? C.ready : actor.state === 'blocked' ? C.blocked : C.muted; ctx.fill(); }
    };
    model.actors.filter(actor => ['walkway', 'bay'].includes(actor.type)).forEach(paintActor);
    model.actors.filter(actor => !['walkway', 'bay'].includes(actor.type)).forEach(paintActor);
    model.products.forEach(product => polygon(product.points, product.carried ? C.drop : C.product, '#fff2cf', 1.1));
    if (mission) {
      const color = mission.phase === 'pickup' ? C.pickup : C.drop;
      if (!mission.verified || mission.blocked) line(mission.plannedRoute, '#81949b', 2, true);
      if (mission.verified) { line(mission.route, C.outline, 8); line(mission.route, color, 4); }
      if (mission.verified) for (let segment = 1, arrows = 0; segment < mission.route.length && arrows < 40; segment++) {
        const a = xy(mission.route[segment - 1]), b = xy(mission.route[segment]), dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy); if (length < 14) continue;
        for (let d = 20; d < length && arrows < 40; d += 42) { const x = a[0] + dx * d / length, y = a[1] + dy * d / length, ux = dx / length, uy = dy / length; ctx.beginPath(); ctx.moveTo(x - ux * 7 - uy * 5, y - uy * 7 + ux * 5); ctx.lineTo(x + ux * 3, y + uy * 3); ctx.lineTo(x - ux * 7 + uy * 5, y - uy * 7 - ux * 5); ctx.strokeStyle = '#f3fcff'; ctx.lineWidth = 2; ctx.stroke(); arrows++; }
      }
      const marker = (point, letter, color, active) => { if (!point) return; const p = xy(point), radius = active ? 10 : 8; ctx.beginPath(); ctx.arc(p[0], p[1], radius, 0, Math.PI * 2); ctx.fillStyle = C.outline; ctx.fill(); ctx.lineWidth = active ? 3 : 2; ctx.strokeStyle = color; ctx.stroke(); ctx.font = 'bold ' + Math.max(11, font * .7) + 'px sans-serif'; ctx.fillStyle = color; ctx.fillText(letter, p[0] - 4, p[1] + 4); };
      marker(mission.pickup, 'R', C.pickup, mission.phase === 'pickup'); marker(mission.destination, 'E', C.drop, mission.phase !== 'pickup');
      if (mission.blocked && mission.stop) marker(mission.stop, '!', C.blocked, true);
    }
    let labelCount=0;
    for(const actor of model.actors){
      if(labelCount>=22||['wall','walkway'].includes(actor.type))continue;
      const bounds=polygonBounds(actor.points),size=Math.max(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ)*scale;
      if(size<25)continue;
      const caption=actor.rack?[actor.rack.aisle,actor.rack.row].filter(Boolean).join(' / '):TYPE_LABELS[actor.type]||actor.name;
      label(caption,centroid(actor.points),{above:true,color:actor.rack?'#d7e2ff':C.text});labelCount++;
    }
    polygon(vehicle.points, vehicle.color, C.outline, 2);
    const at = xy(vehicle.position), yaw = vehicle.heading, facing=xy([vehicle.position[0]+Math.sin(yaw),vehicle.position[1]+Math.cos(yaw)]),forward=[(facing[0]-at[0])/scale,(facing[1]-at[1])/scale],lateral=[forward[1],-forward[0]];
    ctx.beginPath(); ctx.moveTo(at[0] + forward[0] * 12, at[1] + forward[1] * 12); ctx.lineTo(at[0] - forward[0] * 7 + lateral[0] * 7, at[1] - forward[1] * 7 + lateral[1] * 7); ctx.lineTo(at[0] - forward[0] * 7 - lateral[0] * 7, at[1] - forward[1] * 7 - lateral[1] * 7); ctx.closePath(); ctx.fillStyle = '#fff6cd'; ctx.fill(); ctx.strokeStyle = C.outline; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
    const north=rotate?[-1,0]:[0,-1],northX=width-26,northY=header+24;
    ctx.fillStyle='#10232ee8';ctx.fillRect(northX-20,northY-23,40,43);ctx.strokeStyle=C.muted;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(northX-north[0]*10,northY-north[1]*10);ctx.lineTo(northX+north[0]*9,northY+north[1]*9);ctx.stroke();ctx.font='bold 10px sans-serif';ctx.fillStyle=C.text;ctx.fillText('N',northX+north[0]*13-3,northY+north[1]*13+3);
    const metres = [.5, 1, 2, 5, 10, 20, 50].filter(value => value * scale <= box.width * .18).pop() || .5, ruler = metres * scale, rulerY = box.y + box.height - 7;
    ctx.fillStyle = '#10232eee'; ctx.fillRect(box.x, rulerY - 23, ruler + 14, 29); ctx.strokeStyle = C.text; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(box.x + 7, rulerY - 4); ctx.lineTo(box.x + 7, rulerY); ctx.lineTo(box.x + 7 + ruler, rulerY); ctx.lineTo(box.x + 7 + ruler, rulerY - 4); ctx.stroke(); ctx.font = Math.max(10, font * .65) + 'px sans-serif'; ctx.fillStyle = C.text; ctx.fillText(metres + ' m', box.x + 7, rulerY - 8);
    const y = height - footer + font;
    ctx.font = 'bold ' + font * .78 + 'px sans-serif'; ctx.fillStyle = C.pickup; ctx.fillText('R · Recogida', 14, y); ctx.fillStyle = C.drop; ctx.fillText('E · Entrega', width * .29, y); ctx.fillStyle = '#fff6cd'; ctx.fillText('▲ Tu montacargas', width * .57, y);
    ctx.font = font * .78 + 'px sans-serif'; ctx.fillStyle = mission && mission.blocked ? C.blocked : C.text;
    const status = !mission ? 'Explora la instalación y selecciona una carga.' : mission.phase === 'complete' ? 'Práctica completada · todas las entregas verificadas.' : mission.blocked ? 'Ruta bloqueada · detente. Gris: referencia sin validar.' : mission.unavailable ? 'Objetivo no disponible · revisa la guía.' : mission.verified ? 'Sigue la ruta marcada hasta el objetivo activo.' : mission.manual ? 'Objetivo local · comprueba el acceso antes de acercarte.' : 'Ruta prevista sin validar · comprueba el pasillo.';
    ctx.fillText(fitText(status,width-28), 14, y + font * 1.25);
    ctx.fillStyle = C.muted; ctx.fillText(fitText(text(mission && (mission.locationCode || mission.title) || '', 100),width-28), 14, y + font * 2.5);
    ctx.restore(); return true;
  }
  dispose() { this.reset(); this.driving = this.simulation = this.root = null; this.disposed = true; }
}
