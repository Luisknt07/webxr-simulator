import * as THREE from 'three';
import {createBrowserHost} from '../../packages/render-three/BrowserHost.js';
import {renderPanel} from './models.mjs';
import {renderModuleManager, mountProjectTransfer} from './modules.mjs';

/** A local-project browser shell, not a sector simulator. Its reference cube
 * and declarative command panels work without importing any sector catalog. */
export async function mountProject({createComposedHost, createComposedSession, project, missing = []}) {
  let session;
  const browser = createBrowserHost({container: document.getElementById('scene'), label: 'Vista 3D de referencia', inputBlocked: () => !!(session && session.busy)}), ctx = browser.context;
  const floor = new THREE.Mesh(new THREE.PlaneBufferGeometry(24, 24), new THREE.MeshStandardMaterial({color: '#3c555a', roughness: 1})); floor.rotation.x = -Math.PI / 2;
  const cube = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), new THREE.MeshStandardMaterial({color: '#75d7ae', roughness: .5})); cube.position.y = .5;
  const sun = new THREE.DirectionalLight('#fff7df', .8); sun.position.set(3, 6, 4);
  ctx.scene.background = new THREE.Color('#203b44'); ctx.scene.add(floor, cube, sun, new THREE.HemisphereLight('#dbefff', '#344c40', .8));
  let host, closed = false, panelRevision = 0; const cleanup = [], panelCleanup = [];
  const clearPanels = () => {panelRevision++; panelCleanup.splice(0).forEach(off => off());};
  browser.onDispose(async () => {
    closed = true; const errors = [];
    try {clearPanels();} catch (error) {errors.push(error);}
    for (const off of cleanup) try {off();} catch (error) {errors.push(error);}
    try {if (session) await session.dispose({force: true}); else if (host) await host.dispose({force: true});} catch (error) {errors.push(error);}
    for (const resource of [floor.geometry,floor.material,cube.geometry,cube.material]) try {resource.dispose();} catch (error) {errors.push(error);}
    if (errors.length) throw new AggregateError(errors, 'Project shell cleanup failed.');
  });
  try {
    const options = {grants: ['platform.scene'], ports: {'platform.scene': ctx}};
    if (createComposedSession) {session = await createComposedSession(options); host = session.host;} else host = await createComposedHost(options);
    if (closed) {await (session || host).dispose({force: true}); return null;}
    const report = error => {document.getElementById('status').textContent = error.message || 'No se pudo cambiar la configuración.';};
    const resetView = () => {ctx.input.reset(); ctx.cameraRig.position.set(0, 0, 0); ctx.cameraRig.quaternion.set(0, 0, 0, 1);
      if (ctx.vrMode) ctx.cameraRig.position.set(0, ctx.xrReferenceSpaceType === 'local' ? 1.65 : 0, 4);
      else {ctx.camera.position.set(3, 2.1, 5); ctx.camera.lookAt(0, .5, 0);}};
    resetView(); const reset = document.getElementById('reset'); reset.addEventListener('click', resetView); cleanup.push(() => reset.removeEventListener('click', resetView));
    const refresh = state => {
      if (closed) return;
      host = session ? session.host : host;
      const currentProject = session ? session.project : project, unavailable = state ? state.missing : missing;
      document.getElementById('title').textContent = currentProject && (typeof currentProject.title === 'string' ? currentProject.title.slice(0, 160) : currentProject.worldId) || 'Sin proyecto';
      document.getElementById('functions').textContent = host && host.status().functions.map(value => value.id + (value.status === 'paused' ? ' (en pausa)' : '')).join(' · ') || 'Sin funciones sectoriales';
      document.getElementById('missing').textContent = unavailable.length ? 'Hay funciones opcionales no disponibles. Sus datos se conservan en el proyecto.' : '';
      if (state && state.busy) {ctx.input.reset(); return;}
      clearPanels(); const generation = panelRevision;
      const panels = document.getElementById('panels'), details = document.getElementById('components');
      panels.textContent = ''; details.textContent = '';
      if (!host || !currentProject) return;
      const commands = host.registry('commands'), activeIds = new Set(host.status().functions.filter(value => value.status === 'active').map(value => value.id));
      host.registry('ui').filter(value => activeIds.has(value.functionId)).forEach(registration => panelCleanup.push(renderPanel({document, parent: panels, registration, commands, project: currentProject, dispatch: (key, payload) => session ? session.dispatch(key, payload) : host.dispatch(key, payload), isCurrent: () => !closed && generation === panelRevision && !(session && session.busy)})));
      if (!panels.children.length) panels.textContent = 'No hay formularios activos. Activa o continúa un módulo para usar sus funciones.';
      for (const entry of host.inspectProject(currentProject).components) {
        const item = document.createElement('details'), heading = document.createElement('summary'), data = document.createElement('pre');
        heading.textContent = entry.entityId + ' · ' + entry.component.type + ' · ' + entry.status;
        data.textContent = JSON.stringify(entry.component.data, null, 2); item.append(heading, data); details.appendChild(item); panelCleanup.push(() => item.remove());
      }
      document.getElementById('status').textContent = 'Datos en memoria · descarga el proyecto y su estado para conservarlos';
    };
    if (session) {
      cleanup.push(renderModuleManager({document, parent: document.getElementById('modules'), session, onError: report}));
      cleanup.push(mountProjectTransfer({document, window, parent: document.getElementById('transfer'), session, onError: report}));
      cleanup.push(session.subscribe(refresh));
    } else refresh();
    browser.mountXR(document.getElementById('xr'), {spawn: [0, 0, 4], afterChange: active => document.body.classList.toggle('immersive', active)});
    browser.setFrameHandler({before({delta}) {if (session) session.step(delta); else if (host) host.step(delta); cube.rotation.y += delta * .15;}}); browser.start();
    document.body.classList.add('ready');
    const api = Object.freeze({get host() {return session ? session.host : host;}, get project() {return session ? session.project : project;}, session, browser, context: ctx, dispose: () => browser.dispose(), getStats: () => ({...browser.stats(), core: session ? session.status().core : host.status(), render: {...ctx.renderer.info.render}})});
    window.smartTwinProject = api; return api;
  } catch (error) {await browser.dispose(); throw error;}
}
