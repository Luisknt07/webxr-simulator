/* SmartTwin adapters for Anatomy, MIT © 2026 Ryan. See vendor/anatomy/LICENSE. */
import * as iso from '../vendor/anatomy/kit/iso-kit.mjs';

export { iso };
export const UPSTREAM = Object.freeze({ name: 'Anatomy', commit: '1482e8469b0a9e0d8cc18ea2740a01423d29ae80', repository: 'https://github.com/wheresryan22/anatomy', license: 'MIT', copyright: 'Copyright (c) 2026 Ryan' });
export const FEATURES = Object.freeze({
  projection: Object.freeze({ runtime: 'native-esm', module: 'iso-kit.mjs', description: 'Proyección, prismas, detalles, SVG y temas' }),
  lathe: Object.freeze({ runtime: 'native-esm', module: 'lathe.mjs', description: 'Perfiles de revolución y detalles en cualquier eje' }),
  tube: Object.freeze({ runtime: 'native-esm', module: 'tube.mjs', description: 'Tubos, mangueras y cables segmentados' }),
  audit: Object.freeze({ runtime: 'authoring', module: 'audit.mjs', description: 'Auditoría geométrica y estados de despiece' }),
  turning: Object.freeze({ runtime: 'native-esm-beta', module: 'turn.mjs', description: 'Grupos articulados y proyección de piezas móviles' }),
  builder: Object.freeze({ runtime: 'authoring-beta', module: 'turn-build.mjs', description: 'Constructor de grupos y piezas; adaptador base64 para navegador' }),
  orbitAudit: Object.freeze({ runtime: 'authoring', module: 'turn-audit.mjs', description: 'Auditoría de órbitas y continuidad' }),
  fixed: Object.freeze({ runtime: 'native-esm-beta', module: 'turn-fixed.mjs', description: 'Runtime numérico para Canvas' }),
  canvas: Object.freeze({ runtime: 'native-esm-beta', module: 'canvas-painter.mjs', description: 'Canvas2D incremental, zoom y exportación SVG' }),
  gl: Object.freeze({ runtime: 'native-esm', module: 'gl.mjs', description: 'Cámara y efectos WebGL1' }),
  glShared: Object.freeze({ runtime: 'native-esm', module: 'gl-shared.mjs', description: 'Efectos en lienzos con transformaciones CSS' }),
  pdf: Object.freeze({ runtime: 'native-esm', module: 'pdf-button.mjs', description: 'Enlace a documentos imprimibles' }),
  react: Object.freeze({ runtime: 'optional-source', module: 'react/draw.tsx', description: 'Componentes React/Next y hooks de movimiento; requieren React18 y compilación TSX' }),
  print: Object.freeze({ runtime: 'offline-node', module: '../scripts/print.mjs', description: 'Composición de hojas PDF A4 y Letter' }),
  developerTools: Object.freeze({ runtime: 'offline-node', module: '../scripts/', description: 'Captura, líneas, sesiones, fidelidad y pruebas; no son endpoints web' })
});

const loaders = {
  projection: () => Promise.resolve(iso),
  lathe: () => import('../vendor/anatomy/kit/lathe.mjs'),
  tube: () => import('../vendor/anatomy/kit/tube.mjs'),
  audit: () => import('../vendor/anatomy/kit/audit.mjs'),
  turning: () => import('../vendor/anatomy/kit/turn.mjs'),
  builder: () => import('./turn-build.browser.mjs'),
  orbitAudit: () => import('../vendor/anatomy/kit/turn-audit.mjs'),
  fixed: () => import('../vendor/anatomy/kit/turn-fixed.mjs'),
  canvas: () => import('./canvas-painter.browser.mjs'),
  gl: () => import('../vendor/anatomy/kit/gl.mjs'),
  glShared: () => import('../vendor/anatomy/kit/gl-shared.mjs'),
  pdf: () => import('../vendor/anatomy/kit/pdf-button.mjs')
};
export async function loadFeature(name) {
  if (!Object.hasOwn(loaders, name)) throw new TypeError('Función de Anatomy no disponible en el navegador: ' + String(name));
  return loaders[name]();
}

export const GALLERY = Object.freeze([
  ['dial-indicator', 'Comparador de carátula', 'SVG'],
  ['desk-computer', 'Computadora interactiva', 'SVG'],
  ['arcade-cabinet', 'Máquina arcade', 'SVG'],
  ['push-button', 'Pulsador', 'SVG'],
  ['raptor-engine', 'Motor Raptor y despiece', 'SVG + WebGL'],
  ['ripple-tank', 'Tanque de ondas', 'SVG + WebGL'],
  ['turning-dial', 'Dial articulado', '3D beta']
].map(([id, title, mode]) => Object.freeze({ id, title, mode, path: '../vendor/anatomy/examples/' + id + '/' + id + '-light.html', requires: 'iframe sandbox="allow-scripts" sin allow-same-origin; CSP local sin red' })));

export function toAnatomyPoint(point, scale = 100) {
  if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite) || !Number.isFinite(scale) || scale <= 0 || scale > 10000) throw new TypeError('Coordenada o escala no válida');
  return [point[0] * scale, -point[2] * scale, point[1] * scale];
}
export function fromAnatomyPoint(point, scale = 100) {
  if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite) || !Number.isFinite(scale) || scale <= 0 || scale > 10000) throw new TypeError('Coordenada o escala no válida');
  return [point[0] / scale, point[2] / scale, -point[1] / scale];
}

const PRESETS = Object.freeze({
  pulse: 'uniform vec3 uPoint;uniform float uRadius;void main(){vec2 q=viewOf(gl_FragCoord.xy);float d=length(q-project(uPoint));float r=max(1.,uRadius*uK);float a=(1.-smoothstep(r*.15,r,d))*.22*(.65+.35*sin(uTime*2.));gl_FragColor=vec4(vec3(.18,.72,.58)*a,a);}',
  flow: 'uniform vec3 uPoint;uniform float uRadius;void main(){vec2 q=viewOf(gl_FragCoord.xy)-project(uPoint);float r=max(1.,uRadius*uK);float a=(1.-smoothstep(r*.7,r,length(q)))*(.5+.5*sin(q.x*.12-uTime*3.))*.16;gl_FragColor=vec4(vec3(.2,.65,1.)*a,a);}'
});

/** Fixed local effects only. Each returned layer owns and releases its GPU objects. */
export async function createWebGLEffect(canvas, options = {}) {
  const preset = options.preset || 'pulse';
  if (!Object.hasOwn(PRESETS, preset)) throw new TypeError('Efecto WebGL no permitido');
  const projection = options.projection;
  if (!projection || !Array.isArray(projection.origin) || projection.origin.length !== 2 || !projection.origin.every(Number.isFinite) || !Number.isFinite(projection.scale) || projection.scale <= 0 || projection.scale > 10000 || (projection.azimuth !== undefined && !Number.isFinite(projection.azimuth)) || (projection.elevation !== undefined && !Number.isFinite(projection.elevation))) throw new TypeError('Proyección no válida');
  const view = options.view || [900, 620];
  if (!Array.isArray(view) || view.length !== 2 || !view.every(v => Number.isFinite(v) && v > 0 && v <= 4096)) throw new TypeError('Tamaño de efecto no válido');
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('Se necesita un lienzo');
  const { glLayer, glCamera } = await loadFeature('gl');
  const owned = { shaders: [], programs: [], buffers: [] };
  let context = null, layer = null, disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    if (context) {
      for (const item of owned.buffers) context.deleteBuffer(item);
      for (const item of owned.programs) context.deleteProgram(item);
      for (const item of owned.shaders) context.deleteShader(item);
    }
    if (typeof canvas.removeEventListener === 'function') canvas.removeEventListener('webglcontextlost', lost);
  };
  const lost = () => cleanup();
  const wrapped = new Proxy(canvas, { get(target, key) {
    if (key === 'getContext') return (name, attributes) => {
      context = target.getContext(name, attributes);
      if (!context) return null;
      return new Proxy(context, { get(gl, property) {
        const member = Reflect.get(gl, property, gl);
        if (typeof member !== 'function') return member;
        const collection = property === 'createShader' ? owned.shaders : property === 'createProgram' ? owned.programs : property === 'createBuffer' ? owned.buffers : null;
        return (...args) => { const result = member.apply(gl, args); if (collection && result) collection.push(result); return result; };
      } });
    };
    if (key === 'getBoundingClientRect') return () => { const b = target.getBoundingClientRect(); const factor = Math.min(1, 1365 / Math.max(b.width, b.height, 1)); return { width: b.width * factor, height: b.height * factor }; };
    return Reflect.get(target, key, target);
  }, set(target, key, value) { return Reflect.set(target, key, value, target); } });
  try {
    layer = glLayer({ canvas: wrapped, fragment: PRESETS[preset], view, camera: glCamera(projection), uniforms: ['uPoint', 'uRadius'], maxRatio: Math.max(1, Math.min(1.5, Number(options.maxRatio) || 1.5)), onError: () => {} });
    if (!layer) { cleanup(); return { supported: false, draw() {}, dispose: cleanup }; }
    if (typeof canvas.addEventListener === 'function') canvas.addEventListener('webglcontextlost', lost);
    return { supported: true, draw(time = 0, point = [0, 0, 0], radius = 12) {
      if (disposed) return false;
      if (!Number.isFinite(time) || !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite) || !Number.isFinite(radius)) return false;
      layer.draw({ uPoint: point, uRadius: Math.max(0.1, Math.min(1000, radius)) }, time);
      return true;
    }, dispose() { if (!disposed) layer.clear(); cleanup(); } };
  } catch (error) { cleanup(); throw error; }
}

/** A bounded diagnostic of trusted shape records. This is not a manufacturing certificate. */
export async function auditShapes(shapes) {
  if (!Array.isArray(shapes) || shapes.length > 128) throw new RangeError('Máximo 128 formas por auditoría');
  let count = 0;
  const checked = (value, depth = 0) => {
    if (++count > 16384 || depth > 14) throw new RangeError('La auditoría excede su presupuesto de datos');
    if (typeof value === 'number') { if (!Number.isFinite(value) || Math.abs(value) > 1e6) throw new TypeError('Medida no finita o demasiado grande'); return value; }
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (Array.isArray(value)) { if (value.length > 4096) throw new RangeError('Demasiadas muestras'); return value.map(item => checked(item, depth + 1)); }
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Solo se permiten registros geométricos');
    const out = Object.create(null);
    for (const [key, item] of Object.entries(value)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError('Campo no válido'); out[key] = checked(item, depth + 1); }
    return out;
  };
  const records = checked(shapes);
  if (records.some(shape => !['box', 'ball', 'prism', 'body', 'tube'].includes(shape.kind))) throw new TypeError('Tipo de forma no válido');
  const A = await loadFeature('audit');
  const boxes = records.map(shape => A.boundsOf(shape));
  const finite = boxes.every(box => box && Array.isArray(box.min) && Array.isArray(box.max) && [...box.min, ...box.max].every(Number.isFinite));
  return { finite, shapes: shapes.length, bounds: boxes, certificate: false, scope: 'Geometría declarada; no modifica colisiones ni valida resistencia estructural' };
}
