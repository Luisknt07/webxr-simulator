import * as THREE from 'three';

export const DEFAULT_AVATAR = {version: 1, base: 'capsule', bodyColor: '#5cead5', accentColor: '#26364b', skinColor: '#d4a77e'};
export function createAvatar(config = DEFAULT_AVATAR) {
  const group = new THREE.Group(); group.userData.editorRuntimeHelper = true;
  const body = new THREE.MeshStandardMaterial({color: config.bodyColor, roughness: 0.65, metalness: config.base === 'robot' ? 0.5 : 0.05});
  const accent = new THREE.MeshStandardMaterial({color: config.accentColor, roughness: 0.7});
  const skin = new THREE.MeshStandardMaterial({color: config.skinColor, roughness: 0.85});
  const add = (geometry, material, position) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.fromArray(position); group.add(mesh); return mesh; };
  add(config.base === 'robot' ? new THREE.BoxBufferGeometry(0.36, 0.48, 0.23) : new THREE.CylinderBufferGeometry(0.16, 0.19, 0.5, 12), body, [0, -0.52, 0]);
  add(new THREE.SphereBufferGeometry(0.15, 16, 10), config.base === 'explorer' ? skin : body, [0, -0.15, 0]);
  add(new THREE.BoxBufferGeometry(0.23, 0.065, 0.06), accent, [0, -0.14, -0.13]);
  [-1, 1].forEach(side => { const arm = add(new THREE.CylinderBufferGeometry(0.045, 0.045, 0.32, 8), body, [side * 0.25, -0.5, 0]); arm.rotation.z = side * 0.15; add(new THREE.CylinderBufferGeometry(0.065, 0.065, 0.32, 8), accent, [side * 0.1, -0.95, 0]); });
  if (config.base === 'explorer') add(new THREE.CylinderBufferGeometry(0.2, 0.2, 0.05, 14), accent, [0, -0.04, 0]);
  group.userData.dispose = () => { group.traverse(mesh => { if (mesh.geometry) mesh.geometry.dispose(); }); [body, accent, skin].forEach(material => material.dispose()); };
  return group;
}
export function avatarBadge(config = DEFAULT_AVATAR) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('aria-hidden', 'true');
  [['circle', {cx: 32, cy: 32, r: 31, fill: config.accentColor}], ['circle', {cx: 32, cy: 23, r: 12, fill: config.skinColor}], ['path', {d: 'M12 56V49Q12 36 32 36Q52 36 52 49V56Z', fill: config.bodyColor}]].forEach(([tag, attributes]) => { const element = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(attributes).forEach(key => element.setAttribute(key, attributes[key])); svg.appendChild(element); }); return svg;
}
