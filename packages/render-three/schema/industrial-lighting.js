'use strict';

// One interior presentation profile is shared by authoring and the public
// viewer. This is derived state; native galleries and authored records stay
// intact. Earlier industrial defaults used a low outdoor key and a fill from
// below, while the visible LED meshes did not illuminate anything themselves.
const SHELL = /\b(?:CEDI|RV)\b.*(?:cubierta|muro|pared|piso|suelo|ventana|franja|cerramiento|luminaria|techo)/i;
const close = (a, b) => Math.abs(a - b) < .00001;
function isShell(object) {
  for (let node = object; node; node = node.parent) if ((node.userData || {}).editorIndustrialShell || SHELL.test(node.name || '')) return true;
  return false;
}
function isIndustrialInterior(document, roomId) {
  if (!document || !document.additions || !document.additions.forEach) return false;
  let found = false;
  document.additions.forEach(entry => {
    if (found || entry.roomId && entry.roomId !== roomId || !entry.object || !isShell(entry.object)) return;
    for (let node = entry.object; node; node = node.parent) if (!node.visible) return;
    found = true;
  });
  return found;
}
function profile(config, indoor) {
  if (!config || !indoor) return config;
  const legacy = close(config.sunIntensity, .6) && close(config.ambientIntensity, .25) && close(config.exposure, .87) ||
    close(config.sunIntensity, .85) && close(config.ambientIntensity, .15) && close(config.exposure, .9);
  return Object.assign({}, config, legacy ? {sunIntensity: 1.10, ambientIntensity: .55, exposure: 1,
    horizonColor: '#f2f3ef', groundColor: '#919c9f', sunColor: '#fff8ed'} : {},
  {industrialInterior: true, indoorLightingProfile: legacy ? 'industrial-neutral' : 'industrial-authored'});
}

// A small room proxy supplies stable ceiling reflections to metal. Only this
// proxy is rendered once into PMREM; it never captures the simulation scene.
function reflectionRoom(THREE, industrial = false) {
  const scene = new THREE.Scene(), geometry = new THREE.BoxBufferGeometry(), materials = [];
  const box = (color, position, scale, inside, power = 1) => {
    const material = new THREE.MeshBasicMaterial({color, side: inside ? THREE.BackSide : THREE.FrontSide});
    material.color.convertSRGBToLinear().multiplyScalar(power); materials.push(material);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.fromArray(position); mesh.scale.fromArray(scale); scene.add(mesh);
  };
  box(industrial ? '#596369' : '#414743', [0, 2, 0], [20, 12, 24], true);
  box(industrial ? '#3f4b52' : '#272d29', [0, -3.85, 0], [19.8, .1, 23.8]);
  for (const x of [-5, 0, 5]) for (const z of [-7, 5]) box(industrial ? '#f3f7fa' : '#fff4e2', [x, 7.6, z], [2.4, .12, 6], false, industrial ? 1.8 : 1.6);
  box(industrial ? '#a1aeb8' : '#9aa8b0', [-9.8, 3, 0], [.12, 3.2, 17], false, industrial ? 1 : .85);
  return {scene, dispose() {geometry.dispose(); materials.forEach(material => material.dispose());}};
}

module.exports = {isShell, isIndustrialInterior, profile, reflectionRoom};
