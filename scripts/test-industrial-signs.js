'use strict';
const assert = require('node:assert/strict'), THREE = require('three'), factory = require('../shared/industrialFloor');
for (const yaw of [0, .7, -Math.PI / 2]) {
  const plan = {type: 'industrialFloor', version: 1, bounds: [-5, -5, 5, 5], floorY: 0, signs: [[0, 0, yaw, 0, 4], [2, 0, yaw, 1, 3]]};
  const visual = factory.createVisual(THREE, plan, () => ({getContext: () => ({clearRect() {}, fillText() {}})}));
  const metal = visual.children.find(mesh => mesh.name === 'Soportes de señalética'); assert(metal.geometry.boundingBox.max.y <= 1.470001, 'The support stops at the lower panel edge and cannot cross its text.');
  const lettering = visual.children.filter(mesh => /^Rótulos/.test(mesh.name)); assert.equal(lettering.length, 2);
  const maps = new Set(lettering.map(mesh => mesh.material.map)); assert.equal(maps.size, 1, 'Both reading faces use the same single atlas and material batch.');
  lettering.forEach(mesh => {
    const {position, normal, uv} = mesh.geometry.attributes; assert.equal(position.count, 8, 'Each sign has exactly two reading quads.');
    assert(mesh.material.isMeshBasicMaterial); assert.equal(mesh.material.side, THREE.FrontSide); assert.equal(mesh.material.toneMapped, false); assert.equal(mesh.receiveShadow, false);
    const frontNormal = new THREE.Vector3().fromBufferAttribute(normal, 0), backNormal = new THREE.Vector3().fromBufferAttribute(normal, 4); assert(frontNormal.dot(backNormal) < -.99999);
    const frontRight = new THREE.Vector3().fromBufferAttribute(position, 1).sub(new THREE.Vector3().fromBufferAttribute(position, 0));
    const backRight = new THREE.Vector3().fromBufferAttribute(position, 5).sub(new THREE.Vector3().fromBufferAttribute(position, 4)); assert(frontRight.dot(backRight) < -.9, 'The reverse face has its own left-to-right baseline rather than mirrored lettering.');
    for (let index = 0; index < 4; index++) { assert.equal(uv.getX(index), uv.getX(index + 4)); assert.equal(uv.getY(index), uv.getY(index + 4)); }
    assert(uv.getX(1) > uv.getX(0)); assert(uv.getY(3) > uv.getY(0));
    for (const offset of [0, 4]) { const a = new THREE.Vector3().fromBufferAttribute(position, offset), b = new THREE.Vector3().fromBufferAttribute(position, offset + 1), c = new THREE.Vector3().fromBufferAttribute(position, offset + 2); assert(b.sub(a).cross(c.sub(a)).normalize().dot(new THREE.Vector3().fromBufferAttribute(normal, offset)) > .9999, 'Each reading quad faces outward with consistent winding.'); }
  });
  assert(visual.children.length <= 8);
}
console.log('Industrial signs: two independent outward reading faces, unmirrored UVs, no support through the panel, unlit readable shared atlas and bounded batches passed.');
