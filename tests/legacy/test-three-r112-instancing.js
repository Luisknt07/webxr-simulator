const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const {transform} = require('../../tooling/build/loaders/three-r112-instancing');
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
const moduleSource = fs.readFileSync(__layout.map(path.join(path.dirname(require.resolve('three')), 'three.module.js')), 'utf8'); assert(transform(moduleSource).includes('__webxrInstancingVariants'));
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

// Execute the real shadow traversal, geometry/object/attribute caches and
// indexed-buffer binding across the real onContextRestore function. A stub GL
// allocates opaque buffers; it does not replace the cache or shadow algorithm.
const Attributes = new Function('return ' + functionBlock(patched, 'function WebGLAttributes('))();
const Geometries = new Function('BufferGeometry', 'Uint32BufferAttribute', 'Uint16BufferAttribute', 'arrayMax', 'return ' + functionBlock(patched, 'function WebGLGeometries('))
  (THREE.BufferGeometry, THREE.Uint32BufferAttribute, THREE.Uint16BufferAttribute, values => Math.max(...values));
const Indexed = new Function('return ' + functionBlock(patched, 'function WebGLIndexedBufferRenderer('))();
const shadowNames = ['FrontSide','BackSide','DoubleSide','RGBAFormat','NearestFilter','LinearFilter','PCFShadowMap','VSMShadowMap','RGBADepthPacking','NoBlending','WebGLRenderTarget','MeshDepthMaterial','MeshDistanceMaterial','ShaderMaterial','BufferAttribute','BufferGeometry','Mesh','Vector4','Vector2','Frustum','vsm_frag','vsm_vert'];
const Shadow = new Function(...shadowNames, 'return ' + functionBlock(patched, 'function WebGLShadowMap('))(...shadowNames.map(name => name.startsWith('vsm_') ? '' : THREE[name]));
function shadowRestoreFixture(rendererSource) {
  const body = `
    var objects, attributes, indexed, info, geometries, nextBuffer=0, draws=0, _isContextLost=true, capabilities={maxTextureSize:2048};
    var gl={FLOAT:5126,UNSIGNED_SHORT:5123,SHORT:5122,UNSIGNED_INT:5125,INT:5124,BYTE:5120,UNSIGNED_BYTE:5121,ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,
      createBuffer(){return {id:++nextBuffer};},bindBuffer(){},bufferData(){},bufferSubData(){},deleteBuffer(){}};
    var renderer={state:{setBlending(){},setScissorTest(){},viewport(){},buffers:{color:{setClear(){}},depth:{setTest(){}}}},
      getRenderTarget(){return null;},getActiveCubeFace(){return 0;},getActiveMipmapLevel(){return 0;},setRenderTarget(){},clear(){},
      renderBufferDirect(camera,scene,geometry){indexed.setIndex(attributes.get(geometry.index));draws++;}};
    var _this=renderer;
    function initGLContext(){info={render:{frame:0},memory:{geometries:0}};attributes=Attributes(gl);geometries=Geometries(gl,attributes,info);objects=Objects(gl,geometries,attributes,info);indexed=new Indexed(gl,{},info,{isWebGL2:false});}
    initGLContext();var shadowMap=new Shadow(renderer,objects,capabilities.maxTextureSize);renderer.shadowMap=shadowMap;shadowMap.enabled=true;
    ${functionBlock(rendererSource, 'function onContextRestore(')}
    var scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),mesh=new THREE.Mesh(new THREE.BoxBufferGeometry(),new THREE.MeshStandardMaterial()),light=new THREE.DirectionalLight();
    mesh.castShadow=true;mesh.frustumCulled=false;scene.add(mesh);light.position.set(2,5,2);scene.add(light,light.target);scene.updateMatrixWorld(true);
    return {renderer,restore:onContextRestore,render(){shadowMap.needsUpdate=true;shadowMap.render([light],scene,camera);return draws;},dispose(){mesh.geometry.dispose();mesh.material.dispose();if(light.shadow.map)light.shadow.map.dispose();}};
  `;
  return new Function('THREE','Objects','Geometries','Attributes','Indexed','Shadow','WebGLShadowMap',body)(THREE,Objects,Geometries,Attributes,Indexed,Shadow,Shadow);
}
const oldShadows = shadowRestoreFixture(original); assert.equal(oldShadows.render(), 1); oldShadows.restore();
assert.throws(() => oldShadows.render(), /type/, 'Unpatched r112 uploads shadow indices into its obsolete attribute cache.'); oldShadows.dispose();
const restoredShadows = shadowRestoreFixture(patched); assert.equal(restoredShadows.render(), 1);
const previousShadowMap = restoredShadows.renderer.shadowMap;
Object.assign(previousShadowMap, {enabled:true,autoUpdate:false,needsUpdate:true,type:THREE.PCFSoftShadowMap});
restoredShadows.restore(); assert.notEqual(restoredShadows.renderer.shadowMap, previousShadowMap);
for (const key of ['enabled','autoUpdate','needsUpdate','type']) assert.equal(restoredShadows.renderer.shadowMap[key], previousShadowMap[key], key + ' must survive context restoration.');
assert.equal(restoredShadows.render(), 2, 'The first restored shadow draw must bind the new index buffer.');
assert.equal(restoredShadows.renderer.shadowMap.needsUpdate, false);
restoredShadows.restore(); assert.equal(restoredShadows.renderer.shadowMap.autoUpdate, false); assert.equal(restoredShadows.renderer.shadowMap.needsUpdate, true, 'Static shadow GPU contents must be regenerated once without enabling automatic updates.');
assert.equal(restoredShadows.render(), 3, 'Repeated context restoration must not reuse the prior cache.'); restoredShadows.dispose();
assert.throws(() => transform(original.replace('function onContextRestore(', 'function upstreamChangedRestore(')), /restored shadow cache.*matched 0 times/);
console.log('Pinned Three r112 compatibility: program variants, exact shared/instance buffer ownership, binding and real shadow-cache restoration with preserved render settings passed.');
