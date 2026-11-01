import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPart, normalizeModel } from '../../packages/tools/anatomy/shared/model.mjs';
import { compileModel, transformPoint as canonicalTransform } from '../../packages/tools/anatomy/shared/geometry.mjs';
import { renderDiagram, renderSVG, createDiagram, transformPoint, buildTurningDiagram, auditDiagram } from '../../packages/tools/anatomy/shared/render.mjs';
import { toAnatomyPoint, fromAnatomyPoint, loadFeature, auditShapes, createWebGLEffect, FEATURES, GALLERY } from '../../packages/tools/anatomy/shared/toolkit.mjs';
import { encodeBytesBase64 } from '../../packages/tools/anatomy/shared/base64.mjs';

const model = (parts, view = {}) => normalizeModel({ name: 'Diseño & "precisión"', parts, view });
const box = options => createPart('box', { id: 'base', ...options });
const close = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} != ${b}`));

test('Anatomy axis conversion preserves handedness and the actual Three XYZ transform', () => {
  close(toAnatomyPoint([1, 2, 3]), [100, -300, 200]);
  close(fromAnatomyPoint(toAnatomyPoint([-2.5, .04, 3.5])), [-2.5, .04, 3.5]);
  const part = box({ position: [.2, 1.5, -.4], rotation: [.3, -.6, .8], explode: [.5, .1, -.2] });
  close(transformPoint([.12, .4, -.13], part), canonicalTransform([.12, .4, -.13], part.position, part.rotation));
  close(transformPoint([.12, .4, -.13], part, .7), canonicalTransform([.12, .4, -.13], part.position.map((v, i) => v + part.explode[i] * .7), part.rotation));
  assert.throws(() => toAnatomyPoint([NaN, 0, 0]));
  assert.throws(() => toAnatomyPoint([1, 2, 3], -1));
});

test('Actual shared geometry renders all mesh faces without mutating the model, and orthographic views agree', () => {
  const source = model([box({ position: [1, 2, 3] })]);
  const before = JSON.stringify(source), compiled = compileModel(source);
  const iso = renderDiagram(source, { mode: '2d' });
  assert.equal(iso.stats.triangles, compiled.stats.triangles);
  assert.equal(iso.stats.parts, 1);
  assert.equal(iso.stats.visibleTriangles, 6);
  assert.deepEqual(iso.bounds, compiled.stats.bounds);
  assert.ok(iso.svg.includes('Diseño &amp; &quot;precisión&quot;'));
  assert.ok(!/NaN|Infinity|<script|foreignObject|https?:\/\/(?!www.w3.org)/.test(iso.svg));
  const front = renderDiagram(source, { projection: 'front' }), top = renderDiagram(source, { projection: 'top' });
  assert.equal(front.stats.visibleTriangles, 2);
  assert.equal(top.stats.visibleTriangles, 2);
  assert.notEqual(front.svg, top.svg);
  assert.equal(JSON.stringify(source), before);
  assert.equal(renderSVG(source), renderDiagram(source).svg);
});

test('Curved, concave and tube primitives use their real compiler triangles; explode and material modes stay finite', () => {
  const source = model([
    createPart('lathe', { id: 'turned', position: [-.8, .3, 0], explode: [-.5, .2, 0] }),
    createPart('tube', { id: 'hose', position: [.3, .1, .2], explode: [.4, 0, 0] }),
    createPart('extrude', { id: 'bracket', parameters: { profile: [[0, 0], [.4, 0], [.4, .1], [.1, .1], [.1, .4], [0, .4]], height: .15 }, position: [0, .1, -.5] })
  ]);
  const rest = renderDiagram(source), apart = renderDiagram(source, { explode: 1, transparent: true }), wire = renderSVG(source, { wireframe: true, theme: 'light' });
  assert.equal(rest.stats.triangles, compileModel(source).stats.triangles);
  assert.deepEqual(apart.stats.triangles, rest.stats.triangles);
  assert.ok(apart.bounds[0][0] < rest.bounds[0][0]);
  assert.ok(apart.svg.includes('fill-opacity="0.300"'));
  assert.ok(!apart.svg.includes('stroke-width=".35"'), 'Transparent faces must not gain overlapping opaque seams');
  assert.ok(rest.svg.includes('stroke-width=".35"') && rest.svg.includes('vector-effect="non-scaling-stroke"'), 'Opaque faces seal their subpixel triangulation gaps');
  assert.ok(wire.includes('fill="#edf2f1"'));
  assert.ok(wire.includes('fill="none"'));
  assert.ok(!wire.includes('stroke-width=".35"'));
  assert.equal(apart.stats.physicsValidated, false);
});

test('Topology audit distinguishes a closed object, a missing face and duplicated geometry without certifying physics', () => {
  const closed = auditDiagram(model([box()]));
  assert.equal(closed.closedParts, 1); assert.equal(closed.openEdges, 0); assert.equal(closed.certificate, false);
  const positions = compileModel(model([box()])).parts[0].positions;
  const open = auditDiagram(model([createPart('mesh', { id: 'open', parameters: { positions: positions.slice(9) } })]));
  assert.equal(open.closedParts, 0); assert.equal(open.openEdges, 3); assert.equal(open.warnings.length, 1);
  const doubled = auditDiagram(model([createPart('mesh', { id: 'doubled', parameters: { positions: positions.concat(positions.slice(0, 9)) } })]));
  assert.ok(doubled.nonManifoldEdges > 0); assert.equal(doubled.closedParts, 0);
});

test('Dense designs export every triangle above the drag budget and advertise their static interaction', () => {
  const triangle = [0, 0, 0, 0, 1, 0, 1, 0, 0], positions = [];
  for (let i = 0; i < 24001; i++) positions.push(...triangle);
  const source = model([createPart('mesh', { id: 'dense', parameters: { positions } })]);
  const preview = createDiagram(source, { document: null });
  assert.equal(preview.stats().triangles, 24001);
  assert.equal(preview.stats().visibleTriangles, 24001);
  assert.equal(preview.stats().interactive, false);
  assert.ok(preview.stats().performanceHint.includes('conserva toda la geometría'));
  assert.ok(preview.exportSvg().length > 24001);
  preview.dispose();
});

test('Untrusted markup is rejected at model boundary and labels cannot inject SVG or code', () => {
  assert.throws(() => renderSVG({ name: '<script>alert(1)</script>', parts: [box()] }));
  assert.throws(() => renderSVG({ name: 'A', parts: [{ ...box(), svg: '<image href="https://evil.invalid"/>' }] }));
  assert.throws(() => renderSVG({ name: 'A', parts: [box()], script: 'globalThis.pwned=true' }));
  const svg = renderSVG(model([box()]), { width: Infinity, height: -100, theme: '"/><script>' });
  assert.ok(!svg.includes('NaN') && !svg.includes('<script>'));
  assert.ok(svg.includes('viewBox="0 0 900 160"'));
});

test('DOM orbit has one lifecycle, supports keyboard and never leaves listeners after dispose', () => {
  class Element {
    constructor() { this.handlers = new Map(); this.style = {}; this.attributes = {}; this.innerHTML = ''; this.captured = null; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn); }
    removeEventListener(name, fn) { this.handlers.get(name).delete(fn); }
    setPointerCapture(id) { this.captured = id; }
    hasPointerCapture(id) { return this.captured === id; }
    releasePointerCapture() { this.captured = null; }
    replaceChildren() { this.innerHTML = ''; }
    event(name, values) { for (const fn of this.handlers.get(name) || []) fn(values); }
  }
  const updates = [], handle = createDiagram(model([box()]), { document: { createElement: () => new Element() }, mode: '3d', onChange: view => updates.push(view) });
  const original = handle.svg;
  handle.element.event('pointerdown', { button: 0, pointerId: 2, clientX: 20, clientY: 20 });
  handle.element.event('pointermove', { pointerId: 2, clientX: 100, clientY: 50 });
  assert.notEqual(handle.svg, original);
  assert.equal(updates.length, 1);
  let prevented = false;
  handle.element.event('keydown', { key: 'Home', preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(handle.view.azimuth, 45);
  handle.dispose(); handle.dispose();
  assert.equal(handle.element.innerHTML, '');
  assert.ok([...handle.element.handlers.values()].every(handlers => handlers.size === 0));
  assert.equal(handle.element.captured, null);
});

test('Every browser SDK feature loads its actual upstream namespace; offline/react capabilities are honest', async () => {
  const expected = { projection: 'fitProjection', lathe: 'lathe', tube: 'tubePieces', audit: 'audit', turning: 'TURN', builder: 'turning', orbitAudit: 'orbit', fixed: 'TURN', canvas: 'CANVAS2D', gl: 'glLayer', glShared: 'glLayer', pdf: 'pdfButton' };
  for (const [name, member] of Object.entries(expected)) assert.ok((await loadFeature(name))[member], name + ' ' + member);
  await assert.rejects(loadFeature('constructor'));
  await assert.rejects(loadFeature('react'));
  assert.equal(FEATURES.react.runtime, 'optional-source');
  assert.equal(FEATURES.print.runtime, 'offline-node');
  assert.equal(GALLERY.length, 7);
  assert.ok(GALLERY.every(example => /^\.\.\/vendor\/anatomy\/examples\/[a-z-]+\/[a-z-]+-light\.html$/.test(example.path)));
});

test('Isolated browser base64 and TURN builder work without a global Buffer', async () => {
  for (let length = 0; length < 50; length++) { const bytes = Uint8Array.from({ length }, (_, i) => i * 71 & 255); assert.equal(encodeBytesBase64(bytes), Buffer.from(bytes).toString('base64')); }
  const { turning } = await loadFeature('builder');
  const T = turning({ origin: [200, 150], scale: 3 });
  const layer = T.layer('machine'); T.stack(['machine']);
  T.prism({ name: 'body', layer, plan: { x: 0, y: 0, w: 20, d: 12, r: 1 }, z: 0, h: 8 });
  T.prism({ name: 'foot', layer, plan: { x: 35, y: 0, w: 8, d: 8, r: 0 }, z: 0, h: 4 });
  const saved = globalThis.Buffer;
  let built;
  try { globalThis.Buffer = undefined; built = T.build({ strict: true }); } finally { globalThis.Buffer = saved; }
  assert.equal(built.report.parts, 2);
  assert.ok(built.layerSvg('machine', { width: 400, height: 300 }).includes('<svg'));
  const adapted = await buildTurningDiagram(model([box({ explode: [0, .25, 0] })]));
  assert.equal(adapted.report.parts, 1);
  assert.equal(adapted.movements.length, 1);
  assert.ok(adapted.movements[0].travel > 0);
  const source = await readFile(new URL('../../packages/tools/anatomy/shared/turn-build.browser.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes('Buffer.from('));
});

test('Bounded shape diagnostics do not mutate inputs or imply manufacturing certification', async () => {
  const A = await loadFeature('audit'), shape = A.box([0, 0, 0], [2, 3, 4]), before = JSON.stringify(shape);
  const result = await auditShapes([shape]);
  assert.equal(result.finite, true);
  assert.equal(result.certificate, false);
  assert.deepEqual(result.bounds[0], { min: [0, 0, 0], max: [2, 3, 4] });
  assert.equal(JSON.stringify(shape), before);
  await assert.rejects(auditShapes(Array(129).fill(shape)));
  await assert.rejects(auditShapes([{ ...shape, origin: [Infinity, 0, 0] }]));
});

test('Fixed WebGL effects release all resources on success, shader failure and context loss', async () => {
  const { iso } = await import('../../packages/tools/anatomy/shared/toolkit.mjs');
  const projection = iso.fitProjection([[0, 0, 0], [10, 10, 10]], 400, 300);
  function fakeCanvas(fail = false) {
    const created = [], deleted = [], listeners = new Map();
    const gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ACTIVE_UNIFORMS: 5, ARRAY_BUFFER: 6, STATIC_DRAW: 7, FLOAT: 8, TRIANGLES: 9, COLOR_BUFFER_BIT: 10,
      createShader: () => { const id = {}; created.push(id); return id; }, createProgram: () => { const id = {}; created.push(id); return id; }, createBuffer: () => { const id = {}; created.push(id); return id; },
      deleteShader: item => deleted.push(item), deleteProgram: item => deleted.push(item), deleteBuffer: item => deleted.push(item),
      getShaderParameter: () => !fail, getShaderInfoLog: () => 'failed', getProgramParameter: (p, flag) => flag === 5 ? 0 : true,
      getAttribLocation: () => 0, getUniformLocation: () => null, getExtension: () => null };
    for (const method of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'useProgram', 'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'viewport', 'drawArrays', 'clearColor', 'clear']) gl[method] = () => {};
    return { created, deleted, listeners, getContext: () => gl, getBoundingClientRect: () => ({ width: 400, height: 300 }), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  }
  const saved = globalThis.window;
  globalThis.window = { devicePixelRatio: 2 };
  try {
    const canvas = fakeCanvas(), layer = await createWebGLEffect(canvas, { projection, view: [400, 300] });
    assert.equal(layer.supported, true); assert.equal(layer.draw(1), true);
    assert.ok(canvas.width <= 2048);
    layer.dispose(); layer.dispose();
    assert.equal(canvas.deleted.length, canvas.created.length);
    assert.equal(canvas.listeners.size, 0);
    assert.equal(layer.draw(2), false);
    const broken = fakeCanvas(true), failed = await createWebGLEffect(broken, { projection, view: [400, 300] });
    assert.equal(failed.supported, false);
    assert.equal(broken.created.length, broken.deleted.length);
    const lost = fakeCanvas(), active = await createWebGLEffect(lost, { projection });
    lost.listeners.get('webglcontextlost')();
    assert.equal(lost.created.length, lost.deleted.length);
    assert.equal(active.draw(0), false);
    await assert.rejects(createWebGLEffect(fakeCanvas(), { projection, preset: 'void main(){}' }));
  } finally { if (saved === undefined) delete globalThis.window; else globalThis.window = saved; }
});
