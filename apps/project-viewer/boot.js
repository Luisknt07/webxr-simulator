import * as THREE from 'three';
import {createBrowserHost} from '../../packages/render-three/BrowserHost.js';
import {renderPanel} from './models.mjs';

/** A local-project browser shell, not a sector simulator. Its reference cube
 * and declarative command panels work without importing any sector catalog. */
export async function mountProject({createComposedHost, project, missing = []}) {
  const browser = createBrowserHost({container: document.getElementById('scene'), label: 'Vista 3D de referencia'}), ctx = browser.context;
  const floor = new THREE.Mesh(new THREE.PlaneBufferGeometry(24, 24), new THREE.MeshStandardMaterial({color: '#3c555a', roughness: 1})); floor.rotation.x = -Math.PI / 2;
  const cube = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), new THREE.MeshStandardMaterial({color: '#75d7ae', roughness: .5})); cube.position.y = .5;
  const sun = new THREE.DirectionalLight('#fff7df', .8); sun.position.set(3, 6, 4);
  ctx.scene.background = new THREE.Color('#203b44'); ctx.scene.add(floor, cube, sun, new THREE.HemisphereLight('#dbefff', '#344c40', .8));
  let host, closed = false; const cleanup = [];
  browser.onDispose(async () => {closed = true; cleanup.forEach(off => off()); if (host) await host.dispose({force: true}); floor.geometry.dispose(); floor.material.dispose(); cube.geometry.dispose(); cube.material.dispose();});
  try {
    host = await createComposedHost({grants: ['platform.scene'], ports: {'platform.scene': ctx}});
    if (closed) {await host.dispose({force: true}); return null;}
    document.getElementById('title').textContent = typeof project.title === 'string' ? project.title.slice(0, 160) : project.worldId;
    document.getElementById('functions').textContent = host.status().functions.map(value => value.id).join(' · ') || 'Sin funciones sectoriales';
    if (missing.length) document.getElementById('missing').textContent = 'Hay funciones opcionales no disponibles. Sus datos se conservan en el proyecto.';
    const resetView = () => {ctx.input.reset(); ctx.cameraRig.position.set(0, 0, 0); ctx.cameraRig.quaternion.set(0, 0, 0, 1);
      if (ctx.vrMode) ctx.cameraRig.position.set(0, ctx.xrReferenceSpaceType === 'local' ? 1.65 : 0, 4);
      else {ctx.camera.position.set(3, 2.1, 5); ctx.camera.lookAt(0, .5, 0);}};
    resetView(); const reset = document.getElementById('reset'); reset.addEventListener('click', resetView); cleanup.push(() => reset.removeEventListener('click', resetView));
    const panels = document.getElementById('panels'), commands = host.registry('commands');
    host.registry('ui').forEach(registration => cleanup.push(renderPanel({document, parent: panels, registration, commands, project, dispatch: (key, payload) => host.dispatch(key, payload), isCurrent: () => !closed})));
    if (!panels.children.length) panels.textContent = 'Este proyecto no registra formularios de módulo.';
    const details = document.getElementById('components');
    for (const entry of host.inspectProject(project).components) {
      const item = document.createElement('details'), heading = document.createElement('summary'), data = document.createElement('pre');
      heading.textContent = entry.entityId + ' · ' + entry.component.type + ' · ' + entry.status;
      data.textContent = JSON.stringify(entry.component.data, null, 2); item.append(heading, data); details.appendChild(item); cleanup.push(() => item.remove());
    }
    browser.mountXR(document.getElementById('xr'), {spawn: [0, 0, 4], afterChange: active => document.body.classList.toggle('immersive', active)});
    browser.setFrameHandler({before({delta}) {host.step(delta); cube.rotation.y += delta * .15;}}); browser.start();
    document.body.classList.add('ready'); document.getElementById('status').textContent = 'Datos locales de esta sesión · vista 3D de referencia';
    const api = Object.freeze({host, browser, context: ctx, project, dispose: () => browser.dispose(), getStats: () => ({...browser.stats(), core: host.status(), render: {...ctx.renderer.info.render}})});
    window.smartTwinProject = api; return api;
  } catch (error) {await browser.dispose(); throw error;}
}
