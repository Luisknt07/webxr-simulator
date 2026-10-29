'use strict';
const assert = require('node:assert/strict'), cad = require('../../packages/tools/cad/schema/cad'), engine = require('../../packages/tools/cad/schema/cad-engine');
const step = (id, op, params = {}, inputs = []) => ({id, op, params, inputs});
const compile = steps => engine.compile({version: 1, steps, output: steps.at(-1).id});
const close = (a, b, epsilon = 1e-7) => assert(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function topology(mesh) {
  // CSG polygons can have T junctions after cuts. Split collinear edges at all
  // existing vertices before testing watertightness; do not hide open edges.
  const key = p => p.map(v => Math.round(v * 1e7)).join(','), vertices = new Map(), edges = new Map(), p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) { const v = p.slice(i, i + 3); vertices.set(key(v), v); }
  const rows = [...vertices.values()];
  for (let i = 0; i < p.length; i += 9) for (let n = 0; n < 3; n++) {
    const a = p.slice(i + n * 3, i + n * 3 + 3), b = p.slice(i + (n + 1) % 3 * 3, i + (n + 1) % 3 * 3 + 3), d = b.map((v, j) => v - a[j]), length2 = d.reduce((s, v) => s + v * v, 0), cuts = [{t: 0, p: a}, {t: 1, p: b}];
    if (length2 < 1e-15) continue;
    rows.forEach(v => { const t = v.reduce((s, q, j) => s + (q - a[j]) * d[j], 0) / length2; if (t <= 1e-7 || t >= 1 - 1e-7) return; if (Math.hypot(...v.map((q, j) => q - a[j] - t * d[j])) < 1e-7) cuts.push({t, p: v}); }); cuts.sort((a, b) => a.t - b.t);
    for (let j = 1; j < cuts.length; j++) { const x = key(cuts[j - 1].p), y = key(cuts[j].p); if (x === y) continue; const k = [x, y].sort().join('/'), row = edges.get(k) || {count: 0, signed: 0}; row.count++; row.signed += x < y ? 1 : -1; edges.set(k, row); }
  }
  return [...edges.entries()].filter(([, row]) => row.count !== 2 || row.signed !== 0);
}
for (const preset of cad.presets) {
  const result = engine.compile(cad.preset(preset.id)); assert(result.stats.volume > 0 && result.stats.triangles < 10000, preset.id); assert(result.mesh.positions.every(Number.isFinite)); assert.deepEqual(topology(result.mesh), [], preset.id + ' is an oriented, closed solid.');
  const normals = cad.vertexNormals(result.mesh.positions, 45); assert.equal(normals.length, result.mesh.positions.length); for (let n = 0; n < normals.length; n += 3) close(Math.hypot(...normals.slice(n, n + 3)), 1, 1e-5);
}
const beveled = compile([step('s1', 'solid.box', {width: .4, depth: .3, height: .2, bevel: .015})]); assert(beveled.stats.volume > .02 && beveled.stats.volume < .024); assert.deepEqual(beveled.stats.dimensions, [.4, .2, .3]); assert.deepEqual(topology(beveled.mesh), []);
assert.throws(() => compile([step('s1', 'solid.box', {width: .1, depth: .1, height: .1, bevel: .1})]), /chaflán/);
const outline = [[-.3, -.2], [.3, -.2], [.3, .2], [-.3, .2]], hole = [[-.08, -.06], [.08, -.06], [.08, .06], [-.08, .06]];
const profileSteps = [step('s1', 'profile.points', {points: outline, loops: [hole], fillet: .01, segments: 32}), step('s2', 'extrude.linear', {height: .06}, ['s1'])];
const rounded = compile(profileSteps); assert(rounded.stats.volume > .012 && rounded.stats.volume < .014); assert.deepEqual(topology(rounded.mesh), []);
assert.throws(() => compile([step('s1', 'profile.points', {points: [[0, 0], [.3, .3], [.3, 0], [0, .3]]})]), /contorno/);
assert.throws(() => compile([step('s1', 'profile.points', {points: outline, loops: [hole.map(p => [p[0] + 1, p[1]])]})]), /dentro/);
assert.throws(() => compile([step('s1', 'profile.points', {points: outline, loops: [hole, hole]})]), /solaparse/);
assert.throws(() => compile([step('s1', 'profile.points', {points: outline, fillet: .4})]), /radio/);
const straight = compile([step('s1', 'profile.ring', {radius: .03, radius2: .02, segments: 48}), step('s2', 'extrude.sweep', {points: [[0, 0, 0], [0, 0, .6]]}, ['s1'])]); close(straight.stats.volume, 48 / 2 * Math.sin(2 * Math.PI / 48) * (.03 ** 2 - .02 ** 2) * .6, 2e-7); assert.deepEqual(topology(straight.mesh), []);
const path = [[0, 0, 0], [.1, .02, .2], [.15, .15, .4], [.03, .3, .6]], sampled = engine.samplePath(path, true, 64), frames = engine.transportFrames(sampled);
assert(sampled.length > 50); assert.deepEqual(sampled[0], path[0]); sampled.at(-1).forEach((v, i) => close(v, path.at(-1)[i])); frames.forEach((f, i) => { [f.u, f.v, f.tangent].forEach(axis => close(Math.hypot(...axis), 1)); close(f.u.reduce((s, v, n) => s + v * f.tangent[n], 0), 0); if (i) assert(f.u.reduce((s, v, n) => s + v * frames[i - 1].u[n], 0) > .9, 'Parallel transport keeps a continuous frame.'); });
const curved = compile([step('s1', 'profile.ring', {radius: .015, radius2: .01, segments: 24}), step('s2', 'extrude.sweep', {points: path, smoothPath: true, pathSegments: 64, twist: 15, scale: .8}, ['s1'])]); assert(curved.stats.volume > 0); assert.deepEqual(topology(curved.mesh), []);
assert.throws(() => compile([step('s1', 'profile.circle'), step('s2', 'extrude.sweep', {points: [[0, 0, 0], [0, 0, .3], [0, 0, 0]]}, ['s1'])]), /tangente|invertir/);
const loft = compile([step('s1', 'profile.rectangle', {width: .2, depth: .12}), step('s2', 'profile.rectangle', {width: .2, depth: .12}), step('s3', 'profile.rectangle', {width: .2, depth: .12}), step('s4', 'extrude.loft', {sections: [{position: [0, 0, 0]}, {position: [.05, 0, .2], rotation: [0, 15, 20], scale: [1.4, .7]}, {position: [.1, 0, .5], rotation: [0, 0, 40], scale: [.6, 1.2]}]}, ['s1', 's2', 's3'])]); assert(loft.stats.volume > .008); assert.deepEqual(topology(loft.mesh), []);
assert.throws(() => cad.normalizeRecipe({steps: [step('s1', 'profile.circle'), step('s2', 'extrude.loft', {sections: [{position: [0, 0, 0]}, {position: [0, 0, .2]}]}, ['s1'])]}), /Cada perfil/);
for (const sections of [[{position: [0, 0, 0]}, {position: [0, 0, 0]}], [{position: [0, 0, 0]}, {position: [0, 0, .2], rotation: [0, 180, 0]}]]) assert.throws(() => compile([step('s1', 'profile.rectangle'), step('s2', 'profile.rectangle'), step('s3', 'extrude.loft', {sections}, ['s1', 's2'])]), /volumen válido/, 'Coincident or inverted sections must not save zero-volume geometry or NaN centers.');
const basic = compile([step('s1', 'solid.box', {width: .4, depth: .3, height: .2})]);
const side = compile([step('s1', 'solid.box', {width: .4, depth: .3, height: .2}), step('s2', 'boolean.drill', {radius: .025, x: 0, y: 0, segments: 48, plane: {origin: [.2, 0, 0], normal: [1, 0, 0], xAxis: [0, 1, 0]}}, ['s1'])]); close(basic.stats.volume - side.stats.volume, Math.PI * .025 ** 2 * .4, .000003); assert.deepEqual(topology(side.mesh), []);
const sideShifted = compile([step('s1', 'solid.box', {width: .4, depth: .3, height: .2}), step('s2', 'boolean.drill', {radius: .025, x: .06, y: .03, segments: 48, plane: {origin: [.2, 0, 0], normal: [1, 0, 0], xAxis: [0, 1, 0]}}, ['s1'])]); close(side.stats.volume, sideShifted.stats.volume);
assert.throws(() => compile([step('s1', 'solid.box'), step('s2', 'boolean.drill', {plane: {origin: [0, 0, 0], normal: [0, 0, 0], xAxis: [1, 0, 0]}}, ['s1'])]), /unitarios/);
const cubeNormals = cad.vertexNormals(basic.mesh.positions, 45); for (let n = 0; n < cubeNormals.length; n += 3) assert.equal([...cubeNormals.slice(n, n + 3)].filter(x => Math.abs(x) > .01).length, 1, 'Mechanical 90 degree edges stay sharp.');
const cylinder = compile([step('s1', 'solid.cylinder', {radius: .1, height: .2, segments: 24})]), smooth = cad.vertexNormals(cylinder.mesh.positions, 45), flat = cad.vertexNormals(cylinder.mesh.positions, 0); assert(smooth.some((v, i) => Math.abs(v - flat[i]) > .01), 'Normals smooth the cylinder without adding triangles.');
const descriptor = cad.normalizeDescriptor({type: 'cad', recipe: loft.recipe, mesh: loft.mesh, color: '#abcdef', smoothingAngle: 38}); assert.equal(descriptor.smoothingAngle, 38); assert.throws(() => cad.normalizeDescriptor({...descriptor, smoothingAngle: 180}), /suavizado/);
assert.throws(() => cad.normalizeRecipe({steps: [step('s1', 'part.hose', {pathSegments: 4.5})]}), /rango/);
console.log('Advanced CAD: five reconstructed industrial presets, closed oriented surfaces, continuous parallel-transport hollow sweeps, framed multi-profile loft, rounded cutout sketches, constructive chamfers, side-face machining and crease-preserving normals passed.');
