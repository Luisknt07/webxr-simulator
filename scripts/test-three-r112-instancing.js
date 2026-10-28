'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const {transform} = require('./loaders/three-r112-instancing');
const original = fs.readFileSync(require.resolve('three'), 'utf8'), patched = transform(original);
assert.throws(() => transform(original.replace("REVISION = '112'", "REVISION = '113'")), /pinned revision/);
assert.throws(() => transform(patched), /applied twice/);
assert.throws(() => transform(original.replace('function initMaterial(', 'function changedInitMaterial(')), /matched 0 times/);
assert.doesNotThrow(() => new Function(patched));
for (const argument of ['program', 'shader', 'glVertexShader', 'glFragmentShader']) {
  const method = argument === 'program' ? 'getProgramInfoLog' : 'getShaderInfoLog', safeLog = '( gl.' + method + '( ' + argument + ' ) || \'\' ).trim()';
  assert(patched.includes(safeLog)); const readLog = new Function('gl', argument, 'return ' + safeLog);
  assert.equal(readLog({[method]: () => null}, {}), '', 'A lost context has no compiler diagnostic.');
  assert.equal(readLog({[method]: () => '  actual shader message  '}, {}), 'actual shader message');
}
const moduleSource = fs.readFileSync(path.join(path.dirname(require.resolve('three')), 'three.module.js'), 'utf8'); assert(transform(moduleSource).includes('__webxrInstancingVariants'));
// Use the actual transformed renderer's ownership helpers, not a replacement
// material class. No material clones or shared-resource mutation is involved.
const begin = patched.indexOf('function getMaterialVariantProperties('), end = patched.indexOf('// Buffer rendering', begin);
const stores = new WeakMap(), releases = [], properties = {get(material) {let state = stores.get(material); if (!state) {state = {}; stores.set(material, state);} return state;}};
const helpers = new Function('properties', 'programCache', patched.slice(begin, end) + '\nreturn {getMaterialVariantProperties,releaseMaterialProgramReference};')(properties, {releaseProgram(program) {releases.push(program);}});
const material = new THREE.MeshStandardMaterial(), ordinary = helpers.getMaterialVariantProperties(material, new THREE.Mesh()), instanced = helpers.getMaterialVariantProperties(material, new THREE.InstancedMesh(undefined, undefined, 1));
assert.notEqual(ordinary, instanced); assert.equal(helpers.getMaterialVariantProperties(material, new THREE.Mesh()), ordinary);
ordinary.program = {id: 'plain'}; instanced.program = {id: 'instances'}; ordinary.shader = {uniforms: {x: {value: 3}}}; instanced.shader = {uniforms: {x: {value: 7}}};
for (let frame = 0; frame < 100; frame++) {assert.equal(helpers.getMaterialVariantProperties(material, {isInstancedMesh: frame % 2 === 0}), frame % 2 === 0 ? instanced : ordinary);}
helpers.releaseMaterialProgramReference(material, instanced); assert.deepEqual(releases.map(p => p.id), ['instances']); assert.equal(ordinary.program.id, 'plain'); assert.equal(ordinary.shader.uniforms.x.value, 3);
instanced.program = {id: 'new-instance'}; helpers.releaseMaterialProgramReference(material); assert.deepEqual(releases.map(p => p.id), ['instances', 'plain', 'new-instance']);
assert.equal(material.program, undefined); helpers.releaseMaterialProgramReference(material); assert.equal(releases.length, 3);

function functionBlock(text, marker) {
  const start = text.indexOf(marker); assert(start >= 0); const open = text.indexOf('{', start); let depth = 0, quoted = '', line = false, block = false;
  for (let index = open; index < text.length; index++) {const c = text[index], n = text[index + 1];
    if (line) {if (c === '\n') line = false; continue;} if (block) {if (c === '*' && n === '/') {block = false; index++;} continue;}
    if (quoted) {if (c === '\\') index++; else if (c === quoted) quoted = ''; continue;}
    if (c === '/' && n === '/') {line = true; index++; continue;} if (c === '/' && n === '*') {block = true; index++; continue;}
    if (c === '"' || c === "'") {quoted = c; continue;} if (c === '{') depth++; if (c === '}' && --depth === 0) return text.slice(start, index + 1);
  } throw Error('Unterminated function');
}
const Objects = new Function('return ' + functionBlock(patched, 'function WebGLObjects('))();
function gpuFixture() {const removed = [], updated = [], objects = Objects({}, {get: (object, geometry) => geometry, update() {}}, {update(attribute) {updated.push(attribute);}, remove(attribute) {removed.push(attribute);}}, {render: {frame: 0}}); return {objects, removed, updated};}
const gpu = gpuFixture(), geometry = new THREE.BoxBufferGeometry(), a = new THREE.InstancedMesh(geometry, material, 2), b = new THREE.InstancedMesh(geometry, material, 2);
gpu.objects.update(a); gpu.objects.update(b); gpu.objects.update(a); geometry.dispose(); assert.deepEqual(gpu.removed, [a.instanceMatrix, b.instanceMatrix]); geometry.dispose(); assert.equal(gpu.removed.length, 2);
const shared = gpuFixture(), first = new THREE.BoxBufferGeometry(), second = new THREE.BoxBufferGeometry(), c = new THREE.InstancedMesh(first, material, 1), d = new THREE.InstancedMesh(second, material, 1); d.instanceMatrix = c.instanceMatrix;
shared.objects.update(c); shared.objects.update(d); first.dispose(); assert.equal(shared.removed.length, 0); second.dispose(); assert.deepEqual(shared.removed, [c.instanceMatrix]);
const otherContext = gpuFixture(), finalGeometry = new THREE.BoxBufferGeometry(), e = new THREE.InstancedMesh(finalGeometry, material, 1); shared.objects.update(e); otherContext.objects.update(e); finalGeometry.dispose(); assert(shared.removed.includes(e.instanceMatrix)); assert(otherContext.removed.includes(e.instanceMatrix));
assert(patched.includes('_currentGeometryProgram.instanceMatrix !== object.instanceMatrix'), 'Two batches sharing one geometry must rebind their own instance attribute.');
console.log('Pinned Three r112 compatibility: actual source transforms, two independent material program/uniform variants, exact disposal, per-instance vertex binding and shared/multi-context instance buffer cleanup passed.');
