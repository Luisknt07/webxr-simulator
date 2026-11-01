/* Anatomy projection + SmartTwin canonical meshes. MIT upstream notice: vendor/anatomy/LICENSE. */
import * as K from '../vendor/anatomy/kit/iso-kit.mjs';
import { lightOf, dot3, cross3, sub3, unit3 } from '../vendor/anatomy/kit/lathe.mjs';
import { compileModel } from './geometry.mjs';
import { toAnatomyPoint, loadFeature } from './toolkit.mjs';

export const DIAGRAM_LIMITS = Object.freeze({ triangles: 60000, interactiveTriangles: 24000, width: 4096, height: 4096, parts: 256 });
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const finite = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const keyOf = p => p.map(v => Math.round(v * 1e7)).join(',');
const edgeKey = (a, b) => { const x = keyOf(a), y = keyOf(b); return x < y ? x + '|' + y : y + '|' + x; };
const boundsOf = points => { const bounds = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]]; for (const point of points) for (let i = 0; i < 3; i++) { bounds[0][i] = Math.min(bounds[0][i], point[i]); bounds[1][i] = Math.max(bounds[1][i], point[i]); } return points.length ? bounds : [[0, 0, 0], [0, 0, 0]]; };

function viewOptions(value = {}) {
  const preset = value.projection === 'front' ? [90, 0] : value.projection === 'side' ? [0, 0] : value.projection === 'top' ? [90, 90] : [45, 30];
  return { mode: value.mode === '2d' ? '2d' : '3d', theme: value.theme === 'light' ? 'light' : 'dark', projection: value.projection || 'isometric', width: finite(value.width, 900, 200, 4096), height: finite(value.height, 620, 160, 4096), azimuth: finite(value.azimuth, preset[0], -7200, 7200), elevation: finite(value.elevation, preset[1], -90, 90), explode: finite(value.explode, 0, 0, 2), transparent: Boolean(value.transparent), wireframe: Boolean(value.wireframe), zoom: finite(value.zoom, 1, 0.4, 3), selectedPartId: typeof value.selectedPartId === 'string' ? value.selectedPartId : null, showLabels: value.showLabels !== false };
}
const modelOptions = (compiled, value) => ({ ...compiled.model.view, transparent: compiled.model.view.mode === 'transparent', wireframe: compiled.model.view.mode === 'wireframe', ...value });

/** Intrinsic XYZ Euler rotation, identical to the canonical Three.js adapter. */
export function transformPoint(point, part, explode = 0) {
  const [a, b, c] = part.rotation || [0, 0, 0];
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  const [x, y, z] = point;
  const p = part.position || [0, 0, 0], e = part.explode || [0, 0, 0];
  return [cb * cc * x - cb * sc * y + sb * z + p[0] + e[0] * explode,
    (sa * sb * cc + ca * sc) * x + (-sa * sb * sc + ca * cc) * y - sa * cb * z + p[1] + e[1] * explode,
    (-ca * sb * cc + sa * sc) * x + (ca * sb * sc + sa * cc) * y + ca * cb * z + p[2] + e[2] * explode];
}

function geometry(compiled, options) {
  if (!compiled || !Array.isArray(compiled.parts) || compiled.parts.length > DIAGRAM_LIMITS.parts) throw new RangeError('Demasiadas piezas para el diagrama');
  let triangles = 0;
  const points = [], world = [], faces = [], parts = [];
  for (const part of compiled.parts) {
    if (part.visible === false) continue;
    if (!Array.isArray(part.positions) || part.positions.length % 9 !== 0) throw new TypeError('Triángulos no válidos');
    triangles += part.positions.length / 9;
    if (triangles > DIAGRAM_LIMITS.triangles) throw new RangeError('El diagrama admite hasta ' + DIAGRAM_LIMITS.triangles + ' triángulos; reduce segmentos del objeto');
    const partPoints = [], partFaces = [], edges = new Map();
    for (let i = 0; i < part.positions.length; i += 9) {
      const triangle = [];
      for (let j = 0; j < 9; j += 3) {
        const local = part.positions.slice(i + j, i + j + 3);
        if (!local.every(Number.isFinite)) throw new TypeError('Vértice no finito');
        const actual = transformPoint(local, part, options.explode), projected = toAnatomyPoint(actual);
        world.push(actual); points.push(projected); partPoints.push(projected); triangle.push(projected);
      }
      const normal = unit3(cross3(sub3(triangle[1], triangle[0]), sub3(triangle[2], triangle[0])));
      const face = { points: triangle, normal, part, edgeKeys: triangle.map((p, j) => edgeKey(p, triangle[(j + 1) % 3])) };
      partFaces.push(face); faces.push(face);
      for (const edge of face.edgeKeys) { if (!edges.has(edge)) edges.set(edge, []); edges.get(edge).push(normal); }
    }
    for (const face of partFaces) face.drawEdges = face.edgeKeys.map(key => { const adjacent = edges.get(key); return adjacent.length !== 2 || dot3(adjacent[0], adjacent[1]) < 0.88; });
    parts.push({ part, points: partPoints, faces: partFaces, bounds: boundsOf(partPoints) });
  }
  return { points, world, faces, parts, triangles, bounds: boundsOf(world) };
}

function colour(value, brightness) {
  const source = /^#[\da-f]{6}$/i.test(value || '') ? value : '#9ba8b6';
  return '#' + [1, 3, 5].map(at => Math.min(255, Math.max(0, Math.round(parseInt(source.slice(at, at + 2), 16) * brightness))).toString(16).padStart(2, '0')).join('');
}

function project(data, options, modelName, projection = null) {
  const P = projection || (data.points.length ? K.fitProjection(data.points, options.width, options.height, { pad: 46, headroom: 24, azimuth: options.azimuth, elevation: options.elevation }) : { origin: [options.width / 2, options.height / 2], scale: 1, azimuth: options.azimuth, elevation: options.elevation });
  P.scale *= options.zoom;
  const camera = K.cameraOf(P), view = [camera.cosA * camera.cosE, camera.sinA * camera.cosE, camera.sinE], light = lightOf(P);
  const visible = data.faces.filter(face => dot3(face.normal, view) > 0.000001);
  visible.sort((a, b) => K.depthOf(a.points.reduce((p, q) => p.map((v, i) => v + q[i] / 3), [0, 0, 0]), P) - K.depthOf(b.points.reduce((p, q) => p.map((v, i) => v + q[i] / 3), [0, 0, 0]), P));
  const body = [];
  let pending = null;
  const flush = () => {
    if (pending) {
      const seam = pending.fill !== 'none' && Number(pending.alpha) >= .999 ? ' stroke="' + pending.fill + '" stroke-width=".35" stroke-linejoin="round" vector-effect="non-scaling-stroke"' : ' stroke="none"';
      body.push('<path d="' + pending.path + '" fill="' + pending.fill + '" fill-opacity="' + pending.alpha + '"' + seam + ' data-part-id="' + pending.part + '"/>');
    }
    pending = null;
  };
  for (const face of visible) {
    const path = K.pathOf(face.points.map(p => K.iso(p, P)), true);
    const material = face.part.material || {}, brightness = 0.62 + Math.round(Math.max(0, dot3(face.normal, light)) * 16) / 16 * 0.48;
    const fill = colour(material.color, brightness), alpha = options.transparent ? Math.min(0.3, material.opacity ?? 1) : material.opacity ?? 1;
    const actualFill = options.wireframe ? 'none' : fill, actualAlpha = finite(alpha, 1, 0.05, 1).toFixed(3), partId = esc(face.part.id), batchKey = [actualFill, actualAlpha, partId].join('|');
    if (pending && pending.key !== batchKey) flush();
    if (!pending) pending = { key: batchKey, fill: actualFill, alpha: actualAlpha, part: partId, path: '' };
    pending.path += path;
    const outline = face.points.flatMap((p, i) => face.drawEdges[i] ? [K.pathOf([K.iso(p, P), K.iso(face.points[(i + 1) % 3], P)])] : []).join('');
    if (outline) { flush(); body.push('<path d="' + outline + '" fill="none" stroke="' + (face.part.id === options.selectedPartId ? '#52ddbd' : colour(material.color, options.wireframe ? 1.25 : 0.42)) + '" stroke-width="' + (face.part.id === options.selectedPartId ? '1.6' : '.55') + '" stroke-linejoin="round" pointer-events="none"/>'); }
  }
  flush();
  if (!data.points.length) body.push('<text x="' + options.width / 2 + '" y="' + options.height / 2 + '" text-anchor="middle" fill="#8ca4b2">El modelo no tiene piezas visibles</text>');
  const statText = data.parts.length + ' piezas · ' + data.triangles + ' triángulos · metros';
  const labels = options.showLabels ? '<text x="22" y="' + (options.height - 18) + '" font-family="system-ui,sans-serif" font-size="12" fill="' + (options.theme === 'light' ? '#415d6d' : '#9db6c4') + '">' + esc(statText) + '</text>' : '';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + options.width + ' ' + options.height + '" width="' + options.width + '" height="' + options.height + '" style="display:block;width:100%;height:100%" role="img" aria-label="' + esc(modelName || 'Diseño de objeto') + '" data-anatomy-diagram="' + options.mode + '"><title>' + esc(modelName || 'Diseño de objeto') + '</title><rect width="100%" height="100%" fill="' + (options.theme === 'light' ? '#edf2f1' : '#14212b') + '"/>' + body.join('') + labels + '</svg>';
  return { svg, projection: P, bounds: data.bounds, stats: { parts: data.parts.length, triangles: data.triangles, visibleTriangles: visible.length, vertices: data.triangles * 3, mode: options.mode, finite: true, bounds: data.bounds, units: 'm', projection: 'Anatomy', physicsValidated: false, interactive: data.triangles <= DIAGRAM_LIMITS.interactiveTriangles, performanceHint: data.triangles > DIAGRAM_LIMITS.interactiveTriangles ? 'Vista estática por complejidad: usa los controles de ángulo para actualizar; la exportación conserva toda la geometría.' : '' } };
}

export function renderDiagram(model, value = {}) {
  const compiled = compileModel(model), options = viewOptions(modelOptions(compiled, value));
  return project(geometry(compiled, options), options, compiled.model.name);
}
export function renderSVG(model, options = {}) { return renderDiagram(model, options).svg; }

/** Local DOM only. Project/AI payloads are normalized models, never markup or code. */
export function createDiagram(model, value = {}) {
  const compiled = compileModel(model), doc = value.document || globalThis.document;
  let options = viewOptions(modelOptions(compiled, value)), data = geometry(compiled, options), result = project(data, options, compiled.model.name), disposed = false;
  const element = doc && typeof doc.createElement === 'function' ? doc.createElement('div') : null;
  let pointer = null;
  const listeners = [];
  let cachedExplode = options.explode;
  const repaint = () => { if (cachedExplode !== options.explode) { data = geometry(compiled, options); cachedExplode = options.explode; } result = project(data, options, compiled.model.name); if (element) element.innerHTML = result.svg; };
  const notify = () => { if (typeof value.onChange === 'function') value.onChange({ ...options }); };
  const setView = values => { if (disposed) return; const next = { ...options, ...values }; if (values.projection && values.projection !== options.projection) { if (values.azimuth === undefined) delete next.azimuth; if (values.elevation === undefined) delete next.elevation; } options = viewOptions(next); repaint(); notify(); };
  if (element) {
    element.className = 'anatomy-diagram'; element.tabIndex = 0;
    element.setAttribute('aria-label', 'Vista del objeto; arrastra o usa las flechas para girar');
    element.style.cssText = 'width:100%;height:100%;overflow:hidden;touch-action:pan-y;';
    element.innerHTML = result.svg;
    const on = (name, callback, settings) => { element.addEventListener(name, callback, settings); listeners.push([name, callback, settings]); };
    on('pointerdown', event => { if (options.mode !== '3d' || !result.stats.interactive || event.button > 0) return; pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, azimuth: options.azimuth, elevation: options.elevation }; if (element.setPointerCapture) element.setPointerCapture(event.pointerId); element.style.touchAction = 'none'; });
    on('pointermove', event => { if (!pointer || event.pointerId !== pointer.id) return; setView({ azimuth: pointer.azimuth - (event.clientX - pointer.x) * 0.35, elevation: pointer.elevation + (event.clientY - pointer.y) * 0.25 }); });
    const release = () => { if (pointer && element.hasPointerCapture && element.hasPointerCapture(pointer.id)) element.releasePointerCapture(pointer.id); pointer = null; element.style.touchAction = 'pan-y'; };
    on('pointerup', release); on('pointercancel', release); on('lostpointercapture', () => { pointer = null; element.style.touchAction = 'pan-y'; });
    on('keydown', event => { if (options.mode !== '3d') return; const changes = { ArrowLeft: { azimuth: options.azimuth - 5 }, ArrowRight: { azimuth: options.azimuth + 5 }, ArrowUp: { elevation: options.elevation + 5 }, ArrowDown: { elevation: options.elevation - 5 }, Home: { azimuth: 45, elevation: 30, zoom: 1 } }; if (Object.hasOwn(changes, event.key)) { event.preventDefault(); setView(changes[event.key]); } });
  }
  return { element, get svg() { return result.svg; }, stats: () => ({ ...result.stats }), get view() { return { ...options }; }, setView, exportSvg: () => result.svg, dispose() { if (disposed) return; disposed = true; for (const [name, callback, settings] of listeners) element.removeEventListener(name, callback, settings); if (pointer && element.hasPointerCapture && element.hasPointerCapture(pointer.id)) element.releasePointerCapture(pointer.id); pointer = null; if (element) element.replaceChildren(); } };
}

/** Topological diagnostics of the exact canonical triangles, including hidden parts. */
export function auditDiagram(model) {
  const compiled = compileModel(model), details = [];
  let openEdges = 0, nonManifoldEdges = 0, inconsistentEdges = 0, closedParts = 0;
  for (const part of compiled.parts) {
    const edges = new Map();
    for (let i = 0; i < part.positions.length; i += 9) {
      const triangle = [0, 3, 6].map(j => part.positions.slice(i + j, i + j + 3));
      for (let j = 0; j < 3; j++) { const a = keyOf(triangle[j]), b = keyOf(triangle[(j + 1) % 3]); if (a === b) continue; const key = a < b ? a + '|' + b : b + '|' + a; const edge = edges.get(key) || { count: 0, orientation: 0 }; edge.count++; edge.orientation += a < b ? 1 : -1; edges.set(key, edge); }
    }
    const boundary = [...edges.values()].filter(edge => edge.count === 1).length;
    const multiple = [...edges.values()].filter(edge => edge.count > 2).length;
    const reversed = [...edges.values()].filter(edge => edge.count === 2 && edge.orientation !== 0).length;
    const closed = boundary === 0 && multiple === 0 && reversed === 0;
    if (closed) closedParts++;
    openEdges += boundary; nonManifoldEdges += multiple; inconsistentEdges += reversed;
    details.push({ id: part.id, name: part.name, closed, openEdges: boundary, nonManifoldEdges: multiple, inconsistentEdges: reversed });
  }
  return { finite: true, closedParts, totalParts: compiled.parts.length, triangles: compiled.stats.triangles, openEdges, nonManifoldEdges, inconsistentEdges, bounds: compiled.stats.bounds, warnings: details.filter(part => !part.closed).map(part => part.name + ': ' + part.openEdges + ' bordes abiertos, ' + part.nonManifoldEdges + ' no manifold, ' + part.inconsistentEdges + ' orientaciones inconsistentes'), parts: details, certificate: false, scope: 'Cierre topológico y datos finitos; no certifica fabricación, resistencia, colisiones ni ausencia de auto-intersecciones.' };
}

/** Real upstream TURN fixed-part adapter for bounded translational exploded views. */
export async function buildTurningDiagram(model, value = {}) {
  const compiled = compileModel(model), options = viewOptions(modelOptions(compiled, value)), data = geometry(compiled, { ...options, explode: 0 });
  if (!data.parts.length) throw new RangeError('La vista articulada necesita una pieza visible');
  if (data.parts.length > 48 || data.triangles > 6000) throw new RangeError('La vista articulada admite 48 piezas y 6000 triángulos; utiliza el diagrama de malla para diseños mayores');
  const fitting = data.parts.flatMap(item => item.points.flatMap(p => [p, p.map((v, i) => v + toAnatomyPoint(item.part.explode || [0, 0, 0])[i])]));
  const P = K.fitProjection(fitting, options.width, options.height, { pad: 60, azimuth: options.azimuth, elevation: options.elevation });
  const { turning } = await loadFeature('builder');
  const A = await loadFeature('audit');
  const T = turning(P); const layer = T.layer('model'); T.stack(['model']);
  for (const item of data.parts) {
    const part = item.part, displacement = toAnatomyPoint(part.explode || [0, 0, 0]), distance = Math.hypot(...displacement), group = distance > 0 ? T.group('explode-' + part.id, { slide: { direction: displacement, travel: distance } }) : null;
    const points = item.points.map(p => K.iso(p, P));
    const isolated = project({ ...data, parts: [item], faces: item.faces }, { ...options, zoom: 1, showLabels: false }, part.name, { ...P });
    const svg = isolated.svg.slice(isolated.svg.indexOf('/>') + 2, isolated.svg.lastIndexOf('</svg>'));
    T.fixed({ name: part.id, group, layer, anchor: item.points[0], hull: points, svg, shapes: [A.box(item.bounds[0], item.bounds[1], { name: part.id, envelopeOnly: true })] });
  }
  const built = T.build({ poses: [Object.fromEntries(T.groups.map(g => [g.name, 0]))], strict: false });
  return { ...built, projection: P, view: options, movements: T.groups.map(g => ({ name: g.name, travel: g.travel })), scope: 'Vista de despiece; contornos visuales, no colisiones físicas certificadas' };
}

/** The real TURN controller, scoped to this diagram instead of a global debugging hook. */
export async function createTurningPreview(model, options = {}) {
  const built = await buildTurningDiagram(model, options), view = built.view, doc = options.document || globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') throw new TypeError('La vista articulada necesita un documento');
  const element = doc.createElement('div');
  element.className = 'iso anatomy-turning';
  element.setAttribute('data-theme', view.theme);
  element.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;';
  element.innerHTML = '<style>' + K.ISO_CSS + built.css + '</style>' + built.layerSvg('model', { width: view.width, height: view.height });
  const { TURN } = await loadFeature('turning');
  const previous = typeof window === 'undefined' ? undefined : window.__isoTurn;
  const controller = TURN.mount(element, built.data);
  if (typeof window !== 'undefined' && window.__isoTurn && window.__isoTurn.controller === controller) { if (previous === undefined) delete window.__isoTurn; else window.__isoTurn = previous; }
  let disposed = false;
  return { element, controller, data: built.data, stats: () => ({ ...controller.stats(), parts: built.report.parts }), setExplode(value) { if (!disposed) controller.set(Object.fromEntries(built.movements.map(move => [move.name, move.travel * finite(value, 0, 0, 1)]))); }, dispose() { if (disposed) return; disposed = true; controller.destroy(); element.replaceChildren(); } };
}

/** Actual upstream numeric TURN + Canvas2D, bounded and with owned cleanup/export. */
export async function createCanvasPreview(model, options = {}) {
  const built = await buildTurningDiagram(model, options), view = built.view, doc = options.document || globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') throw new TypeError('La vista Canvas necesita un documento');
  const element = doc.createElement('div');
  element.className = 'iso anatomy-canvas'; element.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;';
  element.setAttribute('data-theme', view.theme);
  element.innerHTML = '<style>' + K.ISO_CSS + built.css + '</style>' + built.layerSvg('model', { width: view.width, height: view.height });
  const [{ TURN }, { CANVAS2D }] = await Promise.all([loadFeature('fixed'), loadFeature('canvas')]);
  const previous = typeof window === 'undefined' ? undefined : window.__isoTurn;
  let painter = null, controller = null, disposed = false, temporary = null;
  try {
    if (options.container && options.container.isConnected && typeof options.container.append === 'function') options.container.append(element);
    else {
      if (!doc.body) throw new TypeError('La vista Canvas necesita un documento listo o un contenedor conectado');
      temporary = doc.createElement('div');
      temporary.setAttribute('aria-hidden', 'true');
      temporary.style.cssText = 'position:fixed;left:-100000px;top:0;width:' + view.width + 'px;height:' + view.height + 'px;overflow:hidden;pointer-events:none;';
      doc.body.append(temporary); temporary.append(element);
    }
    controller = TURN.mount(element, built.data, { painter: 'canvas', numeric: true });
    painter = CANVAS2D.mount(element, controller, { keepSvg: true });
    painter.paint();
  } catch (error) { if (painter) painter.destroy(); if (controller) controller.destroy(); element.replaceChildren(); throw error; }
  finally { if (temporary) { element.remove(); temporary.remove(); } if (typeof window !== 'undefined' && window.__isoTurn && window.__isoTurn.controller === controller) { if (previous === undefined) delete window.__isoTurn; else window.__isoTurn = previous; } }
  return { element, controller, supported: painter.unsupported.length === 0, unsupported: painter.unsupported.slice(), stats: () => ({ ...painter.stats(), parts: built.report.parts, operations: painter.ops }), setExplode(value) { if (!disposed) { controller.set(Object.fromEntries(built.movements.map(move => [move.name, move.travel * finite(value, 0, 0, 1)]))); painter.paint(); } }, exportSvg() { return disposed ? '' : painter.exportSvg({ gl: false }); }, dispose() { if (disposed) return; disposed = true; painter.destroy(); controller.destroy(); element.replaceChildren(); } };
}
