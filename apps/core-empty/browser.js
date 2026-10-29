import * as THREE from 'three';
import {createHost} from '../../packages/core/index.js';
import {createBrowserHost} from '../../packages/render-three/BrowserHost.js';

// Browser proof of the reusable renderer adapter. No sector or project loader
// is installed; the floor and cube are application-owned generic primitives.
const host = createHost({worldId: 'core-empty.browser'});
const browser = createBrowserHost({container: document.getElementById('scene'), label: 'Núcleo WebXR: suelo y cubo'});
const ctx = browser.context, {scene, camera} = ctx;
scene.background = new THREE.Color('#203b44'); scene.fog = new THREE.Fog('#203b44', 14, 35);
const floor = new THREE.Mesh(new THREE.PlaneBufferGeometry(30, 30), new THREE.MeshStandardMaterial({color: '#3f5b60', roughness: 1}));
floor.rotation.x = -Math.PI / 2;
const cube = new THREE.Mesh(new THREE.BoxBufferGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({color: '#91e6bd', roughness: .4, metalness: .12})); cube.position.y = .6;
const light = new THREE.DirectionalLight('#fff7e4', .9); light.position.set(4, 7, 5);
scene.add(floor, cube, light, new THREE.HemisphereLight('#deefff', '#425a4c', 1));
let paused = false;
function resetView() {
  ctx.input.reset(); ctx.cameraRig.position.set(0, 0, 0); ctx.cameraRig.quaternion.set(0, 0, 0, 1);
  if (ctx.vrMode) ctx.cameraRig.position.set(0, ctx.xrReferenceSpaceType === 'local' ? 1.65 : 0, 4);
  else {camera.position.set(3, 2.2, 5); camera.lookAt(0, .6, 0);}
}
resetView();
const reset = document.getElementById('reset'), pause = document.getElementById('pause');
const resetHandler = () => resetView(), pauseHandler = () => {paused = !paused; pause.textContent = paused ? 'Continuar cubo' : 'Pausar cubo';};
reset.addEventListener('click', resetHandler); pause.addEventListener('click', pauseHandler);
browser.mountXR(document.getElementById('xr'), {spawn: [0, 0, 4], afterChange: active => document.body.classList.toggle('immersive', active)});
browser.setFrameHandler({before({delta}) {host.step(delta); if (!paused) cube.rotation.y += delta * .3;}});
browser.onDispose(async () => {
  reset.removeEventListener('click', resetHandler); pause.removeEventListener('click', pauseHandler); await host.dispose();
  floor.geometry.dispose(); floor.material.dispose(); cube.geometry.dispose(); cube.material.dispose();
});
window.smartTwinCore = Object.freeze({context: ctx, THREE, browser, host, dispose: () => browser.dispose(),
  getStats: () => ({application: 'core-empty', ...browser.stats(), core: host.status(), render: {...ctx.renderer.info.render}, memory: {...ctx.renderer.info.memory}})});
browser.start(); document.body.classList.add('ready');
