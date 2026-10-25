'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
let now = 0;
const source = fs.readFileSync(path.join(__dirname, '../src/studio/RemotePresentation.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class RemotePresentation', 'return class RemotePresentation');
const RemotePresentation = new Function('THREE', 'productIdentity', 'performance', source)(THREE, product => product.id, {now: () => now});
const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
const material = new THREE.MeshStandardMaterial(), geometry = new THREE.BoxBufferGeometry(.3, .3, .3);
const mesh = new THREE.Mesh(geometry, material); root.add(mesh); mesh.position.set(0, 1, 0);
const product = {id: 'source:a:1', object: mesh, heldBy: null};
let disposed = 0; material.addEventListener('dispose', () => { disposed++; }); geometry.addEventListener('dispose', () => { disposed++; });
const runtime = {products: new Map([[mesh, product]]), time: 12,
  setProductMatrix(value, matrix) {
    value.object.parent.updateWorldMatrix(true, false);
    value.object.matrix.copy(new THREE.Matrix4().getInverse(value.object.parent.matrixWorld)).multiply(matrix);
    value.object.matrixAutoUpdate = false; value.object.matrix.decompose(value.object.position, value.object.quaternion, value.object.scale);
    value.object.updateWorldMatrix(true, false);
  }};
const smoothing = new RemotePresentation(750);
smoothing.before(runtime);
const target = new THREE.Matrix4().compose(new THREE.Vector3(1, 1, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(1, 1, 1));
runtime.setProductMatrix(product, target); smoothing.after(runtime);
assert.equal(mesh.getWorldPosition(new THREE.Vector3()).x, 0, 'checkpoint starts at currently displayed position');
now = 375; smoothing.tick(runtime);
assert(Math.abs(mesh.getWorldPosition(new THREE.Vector3()).x - .5) < 1e-12);
assert(Math.abs(mesh.quaternion.y - Math.sin(Math.PI / 8)) < 1e-12);
assert.equal(runtime.time, 12, 'presentation does not advance physics clock');
assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material); assert.equal(disposed, 0);
now = 750; smoothing.tick(runtime);
assert.deepEqual(mesh.matrixWorld.toArray(), target.toArray()); assert.equal(smoothing.blends.size, 0);

// The next checkpoint blends from the displayed intermediate pose, avoiding
// jumps even when responses arrive earlier than the previous interpolation.
smoothing.before(runtime);
const second = target.clone().setPosition(new THREE.Vector3(2, 1, 0)); runtime.setProductMatrix(product, second); smoothing.after(runtime);
now = 1000; smoothing.tick(runtime); const middle = mesh.getWorldPosition(new THREE.Vector3()).x;
smoothing.before(runtime); runtime.setProductMatrix(product, second.clone().setPosition(new THREE.Vector3(2.5, 1, 0))); smoothing.after(runtime);
assert(Math.abs(mesh.getWorldPosition(new THREE.Vector3()).x - middle) < 1e-12);
product.heldBy = new THREE.Group(); smoothing.tick(runtime);
assert.equal(smoothing.blends.size, 0, 'a real grab takes immediate ownership of the displayed pose');
product.heldBy = null;

// Long transfers and hidden process transitions do not animate through walls.
smoothing.before(runtime); runtime.setProductMatrix(product, target.clone().setPosition(new THREE.Vector3(20, 1, 0))); smoothing.after(runtime);
assert.equal(smoothing.blends.size, 0); assert.equal(mesh.getWorldPosition(new THREE.Vector3()).x, 20);
mesh.visible = false; smoothing.before(runtime); mesh.visible = true; runtime.setProductMatrix(product, target.clone().setPosition(new THREE.Vector3(21, 1, 0))); smoothing.after(runtime);
assert.equal(smoothing.blends.size, 0);
smoothing.before(runtime); runtime.setProductMatrix(product, target.clone().setPosition(new THREE.Vector3(22, 1, 0))); smoothing.after(runtime); smoothing.clear();
assert.equal(mesh.getWorldPosition(new THREE.Vector3()).x, 22, 'leaving resolves pending interpolation to last authoritative pose');
assert.equal(smoothing.blends.size, 0); assert.equal(smoothing.previous.size, 0); assert.equal(disposed, 0);
assert.equal(mesh.material, material); assert.equal(mesh.geometry, geometry);
mesh.matrixAutoUpdate = true; smoothing.before(runtime); mesh.position.x += 1; mesh.updateWorldMatrix(true, false); smoothing.after(runtime); smoothing.clear();
assert.equal(mesh.matrixAutoUpdate, true, 'presentation preserves authored automatic transform updates');
console.log('Vista remota: interpolación de posición/orientación, reloj intacto, agarres prioritarios y recursos GPU reutilizados OK.');
