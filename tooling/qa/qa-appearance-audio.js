const __layout = require("../layout.cjs");
'use strict';
// Real compiled Chrome/UI/WebGL/WebAudio; every edit stays in this disposable
// document. No saved project, identity, asset upload or revision is written.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createRequire} = require('node:module');
const helperFile = __layout.map(path.join(__layout.oldDir("scripts/qa-appearance-audio.js"), 'upgrade-cedi-examples.js')), helperSource = fs.readFileSync(helperFile, 'utf8');
const {request, hash} = require('../maintenance/upgrade-cedi-examples');
const PROJECT = '194c1284-1c6e-4f2a-b089-9c540ed6e32b', ORIGINAL = 'ce14b39b-5d77-45ea-a85e-1d7e0d76e872';
const OUTPUT = __layout.map(path.resolve(__layout.oldDir("scripts/qa-appearance-audio.js"), '../data/qa-studio'));
const PUBLIC_CURRENT = process.argv.includes('--public-current');
function readOnlySession() {
  const fetchOriginal = window.fetch.bind(window); window.__qaBlockedWrites = [];
  window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href), method = String(options.method || input.method || 'GET').toUpperCase();
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(method)) { window.__qaBlockedWrites.push({url: url.href, method}); return Promise.reject(new Error('QA read-only: API writes are disabled.')); }
    if (url.pathname === '/api/studio/me') return Promise.resolve(new Response(JSON.stringify({user: null, configured: false, capabilities: {accounts: true, rooms: true}}), {status: 200, headers: {'Content-Type': 'application/json'}}));
    return fetchOriginal(input, options);
  };
}
// Reuse withBrowser's isolated profile, HTTPS certificate pin and error audit;
// this local adapter only exposes its CDP sender and installs the read-only
// browser session before navigation. No autoplay-policy override is added.
let prefix = helperSource.slice(0, helperSource.indexOf('// Production runtime/CollisionWorld'))
  .replace('await send(\'Page.navigate\',', 'await send("Page.addScriptToEvaluateOnNewDocument", {source: ' + JSON.stringify('(' + readOnlySession.toString() + ')()') + '});\n    await send(\'Page.navigate\',')
  .replace('action({evaluate, screenshot, until, writes, exceptions, consoleErrors, transport, shots})', 'action({send, evaluate, screenshot, until, writes, exceptions, consoleErrors, transport, shots})');
if (PUBLIC_CURRENT) prefix = prefix.replace("'https://localhost:8080/editor?project=' + projectId", "'https://localhost:8080/?project=' + projectId + '&room=sound'")
  .replace('window.context?.editor?.active&&!context.editor.initializing', 'window.context?.editor&&!context.editor.active&&!context.editor.initializing');
assert(prefix.includes('action({send, evaluate')); assert(prefix.includes('Page.addScriptToEvaluateOnNewDocument'));
const {withBrowser} = new Function('require', '__dirname', prefix + '\nreturn {withBrowser};')(createRequire(helperFile), __dirname);

function initializeQA() {
  const e = context.editor; e.projectSync.stop(); e.keepCurrentProject = async () => false;
  e.saveProject = async () => { throw new Error('QA read-only: saving is disabled.'); };
  window.__appearanceQA = {roomId: 'photogrammetry', reports: {}, phase: 'initial', geometryErrors: []};
  const error = console.error.bind(console); console.error = (...args) => {
    if (String(args[0]).includes('computeBoundingSphere')) {
      const geometry = args.find(value => value && value.isBufferGeometry), positions = geometry && geometry.attributes.position && [...geometry.attributes.position.array], badBounds = [];
      e.box.object?.traverse(node => { const box = node.geometry && node.geometry.boundingBox, count = node.geometry && node.geometry.attributes.position && node.geometry.attributes.position.count; if (box && !box.min.toArray().concat(box.max.toArray()).every(Number.isFinite) || node.matrixWorld.elements.some(value => !Number.isFinite(value)) || count === 0) badBounds.push({name: node.name, type: node.type, count, visible: node.visible, bbox: box && {min: box.min.toArray(), max: box.max.toArray()}, matrix: node.matrixWorld.toArray(), replaced: node.userData.editorGeometryReplaced, helper: node.userData.editorHelper}); });
      __appearanceQA.geometryErrors.push({phase: __appearanceQA.phase, stack: new Error().stack, pending: e.pendingEdits, loading: e.loadingProject || e.document.loading, selected: e.selected?.userData.editorId, boxObject: e.box.object?.userData.editorId, badBounds: badBounds.slice(0, 20), count: positions && positions.length, invalid: positions && positions.map((value, index) => Number.isFinite(value) ? null : index).filter(value => value !== null).slice(0, 20)});
    }
    error(...args);
  };
  return {project: e.currentProject, ownAudioActivated: e.industrialAudio.activated, ownVoices: e.industrialAudio.voices.size};
}
async function selectActor() {
  const e = context.editor; e.industrialVisuals.dispose(); e.materials.dispose(); e.materials.invalidate(); await e.materials.sync(e.roomId);
  const candidates = e.document.getObjects(e.roomId).filter(object => {
    const config = e.conveyorConfig(object); return config && config.layout === 'straight' && config.mechanism === 'transport' && config.drive === 'motor' && config.surface === 'rollers' && e.materials.getSlots(object).filter(slot => slot.value.startsWith('mesh:')).length > 3;
  });
  const actor = candidates[0]; if (!actor) throw new Error('No actual straight roller conveyor in the Laboratory level.');
  const id = actor.userData.editorId, slots = e.materials.getSlots(actor).filter(slot => slot.value.startsWith('mesh:'));
  const qa = __appearanceQA; qa.id = id; qa.slots = slots.slice(0, 3).map(slot => slot.value); qa.functions = JSON.stringify(e.document.getBehaviors(actor).filter(value => value.type !== 'surfaceMaterial'));
  qa.slotMaterial = (object, slot) => { const split = slot.lastIndexOf(':'), index = Number(slot.slice(split + 1)), indices = slot.slice(5, split); let mesh = object; if (indices !== 'root') indices.split('.').forEach(value => { mesh = mesh.children[Number(value)]; }); return (Array.isArray(mesh.material) ? mesh.material : [mesh.material])[index]; };
  qa.originalThirdColor = qa.slotMaterial(actor, qa.slots[2]).color.getHexString();
  e.select(actor); const panel = e.inspectorContent.querySelector('[data-appearance-inspector]'); if (panel.parentElement.tagName === 'DETAILS') panel.parentElement.open = true;
  qa.change = async (label, value) => { const control = [...e.inspectorContent.querySelectorAll('input,select')].find(node => node.getAttribute('aria-label') === label); if (!control) throw new Error('Missing control ' + label); control.value = value; control.dispatchEvent(new Event('change', {bubbles: true})); while (e.pendingEdits) await new Promise(resolve => setTimeout(resolve, 10)); await e.materials.sync(e.roomId); };
  const center = actor.getWorldPosition(e.camera.position.clone()); center.y += .3;
  e.safeCameraPosition = e.safeOrbitTarget = null; e.camera.position.copy(center).add(e.camera.position.clone().set(3.5, 2.3, 5)); e.orbit.target.copy(center); e.orbit.update();
  return {id, name: actor.name, slots: slots.slice(0, 3), sections: [...e.inspectorContent.children].slice(0, 3).map(node => node.querySelector('h3')?.textContent)};
}
async function editParts() {
  const e = context.editor, qa = __appearanceQA, actor = e.document.getObject(qa.id);
  qa.phase = 'parts';
  await qa.change('Parte o material a editar', qa.slots[0]); await qa.change('Color base', '#d95c37');
  await qa.change('Parte o material a editar', qa.slots[1]); await qa.change('Color base', '#368fc9');
  const colors = qa.slots.map(slot => qa.slotMaterial(actor, slot).color.getHexString());
  if (JSON.stringify(e.document.getBehaviors(actor).filter(value => value.type !== 'surfaceMaterial')) !== qa.functions) throw new Error('Material edits changed machine behavior.');
  qa.colors = colors; qa.localPartSnapshot = await e.document.serialize();
  const panel = e.inspectorContent.querySelector('[data-appearance-inspector]'); panel.parentElement.open = true; panel.scrollIntoView({block: 'start'}); e.inspector.scrollTop = Math.max(0, e.inspector.scrollTop - 130); e.render(0);
  return {colors, thirdBefore: qa.originalThirdColor, assignments: e.materialInspector.assignments(actor).map(value => ({slot: value.slot, color: value.color})), functionCount: e.document.getBehaviors(actor).length, gl: context.renderer.getContext().getError()};
}
async function technologyAndOwnModel() {
  const e = context.editor, qa = __appearanceQA, actor = e.document.getObject(qa.id);
  qa.phase = 'technology';
  const actorIds = e.document.getObjects(e.roomId).filter(node => { for (let p = node.parent; p; p = p.parent) if (p === actor) return true; return false; }).map(node => node.userData.editorId);
  const before = JSON.stringify(e.document.getBehaviors(actor)), oldSurface = e.conveyorConfig(actor).surface;
  await qa.change('Tecnología de transporte', 'belt');
  const technology = {surface: e.conveyorConfig(actor).surface, actorsPreserved: actorIds.every(id => e.document.getObject(id)), materialCount: e.materialInspector.assignments(actor).length, links: e.assembly.edges().map(edge => ({source: edge.source.userData.editorId, target: edge.target.userData.editorId, gap: e.assembly.assessConnection(edge.source, edge.sourcePort, edge.target, edge.targetPort).gap}))};
  if (technology.surface !== 'belt') throw new Error('Technology selector did not apply a functional belt variant.');
  await e.perform(() => e.historyStep('undo')); await e.materials.sync(e.roomId);
  if (JSON.stringify(e.document.getBehaviors(actor)) !== before || e.conveyorConfig(actor).surface !== oldSurface) throw new Error('Technology undo did not restore behavior and finishes.');
  const response = await fetch("modules/turismo/assets/sound_door.glb"), bytes = await response.arrayBuffer(); if (!response.ok || bytes.byteLength < 1000) throw new Error('Real local GLB unavailable.');
  qa.phase = 'real-glb-import';
  const file = new File([bytes], 'qa-own-machine.glb', {type: 'model/gltf-binary'}), stored = e.storageAvailable, health = e.checkStorageHealth;
  e.storageAvailable = false; e.checkStorageHealth = async () => { throw new Error('QA local import: upload intentionally disabled.'); };
  try { await e.importVisualModel(actor, [file]); } finally { e.storageAvailable = stored; e.checkStorageHealth = health; }
  const descriptor = e.document.getVisualDescriptor(actor), imported = e.library.exportImports().find(row => row.id === descriptor.importId);
  if (!imported || !imported.dataUrl || e.document.getBehaviors(actor).length < 1) throw new Error('Real local model import lost its asset or behavior.');
  const controls = actorIds.map(id => e.document.getObject(id)).filter(node => e.document.getBehaviors(node).some(value => value.type === 'control'));
  const controlVisibility = controls.map(node => { let masked = false; node.traverse(mesh => { if (mesh.userData.editorGeometryReplaced) masked = true; }); return {id: node.userData.editorId, visible: node.visible, masked}; });
  qa.importSnapshot = await e.document.serialize();
  return {technology, imported: {id: imported.id, size: imported.size, extension: imported.extension, portableBytes: !!imported.dataUrl}, descriptor, actorsPreserved: actorIds.every(id => e.document.getObject(id)), controlVisibility, selectedTarget: e.materialInspector.target(actor), colorEditable: !e.inspectorContent.querySelector('[aria-label="Color base"]').disabled, gl: context.renderer.getContext().getError()};
}
async function reopenLocal() {
  const e = context.editor, qa = __appearanceQA, metadata = e.currentProject, snapshot = qa.importSnapshot;
  qa.phase = 'local-reopen';
  await e.applyServerProject({id: metadata.id, name: e.projectName, revision: metadata.revision, document: snapshot}, {roomId: qa.roomId});
  const actual = await e.document.serialize(), actor = e.document.getObject(qa.id); e.select(actor);
  const differences = [], compare = (before, after, path = '') => { if (before === after) return; if (before && after && typeof before === 'object' && typeof after === 'object') [...new Set(Object.keys(before).concat(Object.keys(after)))].forEach(key => compare(before[key], after[key], path + '/' + key)); else differences.push({path, before, after}); }; compare(snapshot, actual);
  const same = differences.length === 0;
  const count = e.materialInspector.assignments(actor).length;
  await e.perform(() => { e.document.resetAsset(actor); e.materialInspector.resetTarget(actor); }); await e.materials.sync(e.roomId);
  const restoredColors = qa.slots.map(slot => qa.slotMaterial(actor, slot).color.getHexString());
  return {same, propertyOrderOnly: same && JSON.stringify(actual) !== JSON.stringify(snapshot), differences: differences.slice(0, 20), materialCount: count, restoredColors, expectedColors: qa.colors, importedVisualBeforeRestore: snapshot.rooms[qa.roomId].additions.find(row => row.id === qa.id).visual, gl: context.renderer.getContext().getError()};
}
function openCatalog() {
  __appearanceQA.phase = 'catalog';
  const e = context.editor; e.shell.openSceneCatalog(); const browser = e.shell.sceneCatalog, thumbnails = browser.thumbnails;
  const getRenderer = thumbnails._getRenderer.bind(thumbnails); window.__qaCatalogRenderers = new Set(); window.__qaCatalogDisposes = 0;
  thumbnails._getRenderer = function () { const result = getRenderer(); if (!__qaCatalogRenderers.has(result)) { __qaCatalogRenderers.add(result); const dispose = result.dispose.bind(result); result.dispose = () => { __qaCatalogDisposes++; dispose(); }; } return result; };
  return {cards: browser.grid.children.length, currentProject: e.currentProject.id, dialog: browser.dialog.open};
}
function prepareSoundClick() {
  __appearanceQA.phase = 'sound-activation';
  const e = context.editor, qa = __appearanceQA; e.shell.sceneCatalog.close();
  const actor = e.document.getObject(qa.id);
  e.document.setBehaviors(actor, e.document.getBehaviors(actor).filter(value => value.type !== 'machineAudio').concat([{type: 'machineAudio', preset: 'auto', volume: .55}]));
  const configs = (e.document.studio.environments || []).map(value => value.roomId === e.roomId ? Object.assign({}, value, {machineSounds: false, machineVolume: .6, ambientPreset: 'off', ambientSound: ''}) : value);
  e.document.setStudio({environments: configs});
  const toggle = [...e.toolbar.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === 'Activar o silenciar sonido industrial');
  if (!toggle) throw new Error('No visible editor activation control.');
  toggle.addEventListener('click', event => { window.__qaAudioTrusted = event.isTrusted; }, {once: true});
  const rect = toggle.getBoundingClientRect();
  return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, visible: !!rect.width && !!rect.height, active: e.industrialAudio.activated, voices: e.industrialAudio.voices.size, state: context.audioListener.context.state};
}
function startAudioRuntime() {
  __appearanceQA.phase = 'sound-runtime';
  const e = context.editor, qa = __appearanceQA, actor = e.document.getObject(qa.id);
  e.leave(); const point = actor.getWorldPosition(context.cameraRig.position.clone()); point.z += 2; point.y = 0;
  context.cameraRig.position.copy(point); context.cameraRig.quaternion.set(0, 0, 0, 1); context.camera.position.set(0, 1.6, 0); context.camera.updateWorldMatrix(true, false);
  if (context.resetCollisionPose) context.resetCollisionPose();
  e.simulation.command(qa.id, 'powerOn'); e.simulation.command(qa.id, 'start'); e.simulation.setVariable(qa.id, 'speed', .4);
  const analyser = context.audioListener.context.createAnalyser(); analyser.fftSize = 512; e.industrialAudio.master.connect(analyser); window.__qaAudioAnalyser = analyser;
  return {trusted: __qaAudioTrusted, ownActivated: e.industrialAudio.activated, contextState: context.audioListener.context.state};
}
function audioReport() {
  const e = context.editor, qa = __appearanceQA, record = e.simulation.records.get(qa.id), voice = e.industrialAudio.voices.get('loop:' + qa.id);
  const samples = new Float32Array(__qaAudioAnalyser.fftSize); __qaAudioAnalyser.getFloatTimeDomainData(samples);
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  return {actualSpeed: record.components.conveyor.actualSpeed, rate: voice && voice.source.playbackRate.value, positional: !!(voice && voice.panner), position: voice && [voice.panner.positionX.value, voice.panner.positionY.value, voice.panner.positionZ.value], voices: e.industrialAudio.voices.size, stats: Object.assign({}, e.industrialAudio.stats), rms, paused: e.simulationPaused, contextState: context.audioListener.context.state, gl: context.renderer.getContext().getError()};
}

async function catalogQA(b) {
  const catalog = await b.evaluate('(' + openCatalog.toString() + ')()'); assert.equal(catalog.cards, 15); assert(catalog.dialog);
  for (let index = 0; index < 15; index++) {
    await b.evaluate('context.editor.shell.sceneCatalog.grid.children[' + index + '].scrollIntoView({block:"center"});true');
    await b.until(() => b.evaluate('(()=>{const p=context.editor.shell.sceneCatalog.grid.children[' + index + '].querySelector(".ed-scene-catalog-thumbnail");return p.dataset.thumbnailState==="ready"&&!!p.querySelector("img")})()'), 'Scene thumbnail did not render: ' + index);
  }
  const thumbnails = await b.evaluate('({ready:document.querySelectorAll(".ed-scene-catalog-thumbnail[data-thumbnail-state=ready]").length,renderers:__qaCatalogRenderers.size,cache:context.editor.shell.sceneCatalog.thumbnails.cache.size,gl:context.editor.shell.sceneCatalog.thumbnails.renderer.getContext().getError()})');
  assert.equal(thumbnails.ready, 15); assert.equal(thumbnails.renderers, 1); assert.equal(thumbnails.gl, 0);
  await b.evaluate('context.editor.shell.sceneCatalog.grid.scrollTop=0;true');
  const layout = await b.evaluate('(()=>{const b=context.editor.shell.sceneCatalog,c=b.grid.children[0],box=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {tag:n.tagName,className:n.className,height:r.height,top:r.top,bottom:r.bottom,display:s.display,position:s.position,overflow:s.overflow}};return {header:box(b.dialog.querySelector(".ed-scene-catalog-header")),filters:box(b.dialog.querySelector(".ed-scene-catalog-filters")),grid:Object.assign(box(b.grid),{rows:getComputedStyle(b.grid).gridTemplateRows,autoRows:getComputedStyle(b.grid).gridAutoRows,scrollHeight:b.grid.scrollHeight}),card:box(c),children:[...c.children].map(box),title:box(c.querySelector("h3")),description:box(c.querySelector(".ed-scene-catalog-card-body>p")),action:box(c.querySelector(".ed-scene-catalog-actions button"))}})()');
  await b.screenshot('scene-catalog-fifteen');
  console.log('Catalog layout:', JSON.stringify(layout));
  assert(layout.title.height > 10 && layout.description.height > 10 && layout.action.height > 20, 'Scene cards must show titles, descriptions and functional creation actions.');
  assert(layout.header.bottom <= layout.filters.top + 1, 'Catalog header cannot overlap its filters.');
  return Object.assign(catalog, thumbnails, {layout});
}

async function publicInitialize() {
  const e = context.editor, r = e.simulation, env = (e.document.studio.environments || []).find(value => value.roomId === 'sound');
  if (e.active || e.roomId !== 'sound') throw new Error('The public sound level did not open.');
  e.projectSync.stop();
  window.__publicQA = {before: JSON.stringify(await e.document.serialize())};
  const config = (e.document.studio.entities || []).find(value => value.roomId === 'sound' && value.type === 'camera'), marker = config && e.document.getObject(config.objectId);
  if (!marker) throw new Error('No authored camera in the published Laboratory.');
  if (context.studio && context.studio.setDesktopFlight) context.studio.setDesktopFlight(true);
  context.cameraRig.quaternion.set(0, 0, 0, 1); marker.getWorldPosition(context.cameraRig.position); context.camera.position.set(0, 0, 0); marker.getWorldQuaternion(context.camera.quaternion); context.camera.fov = config.fov; context.camera.updateProjectionMatrix(); context.camera.updateWorldMatrix(true, false); if (context.desktopLook) context.desktopLook.reset(); if (context.resetCollisionPose) context.resetCollisionPose();
  const candidates = [...r.records.values()].filter(row => row.components.conveyor && row.components.conveyor.config.drive === 'motor' && row.components.conveyor.config.withPanel && row.components.conveyor.config.mechanism === 'transport' && row.object.visible);
  const actor = candidates.find(row => row.components.conveyor.actualSpeed > 0) || candidates[0]; if (!actor) throw new Error('No actual demo conveyor with its control panel.');
  __publicQA.id = actor.id;
  const pause = [...r.records.values()].find(row => row.components.control && row.components.control.config.command === 'pause' && row.components.control.config.targetId === actor.id);
  if (!pause) throw new Error('No existing pause control bound to this demo conveyor.'); __publicQA.pauseId = pause.id;
  const toggle = context.studio.header.querySelector('[aria-label="Activar o silenciar sonido industrial"]'); if (!toggle) throw new Error('No public activation button.');
  toggle.addEventListener('click', event => { __publicQA.trusted = event.isTrusted; }, {once: true}); const rect = toggle.getBoundingClientRect();
  return {route: location.pathname + location.search, project: e.currentProject, activeEditor: e.active, environment: env, rendering: Object.assign({}, e.entities.environment.stats), authoredCamera: {id: config.id, eye: context.camera.getWorldPosition(context.camera.position.clone()).toArray()}, actor: {id: actor.id, name: actor.object.name, actualSpeed: actor.components.conveyor.actualSpeed, powered: actor.components.conveyor.powered, running: actor.components.conveyor.running}, pause: {id: pause.id, config: pause.components.control.config}, activation: {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, active: e.industrialAudio.activated, voices: e.industrialAudio.voices.size, contextState: context.audioListener.context.state}, gl: context.renderer.getContext().getError()};
}
function publicNearMachine() {
  const e = context.editor, actor = e.document.getObject(__publicQA.id), center = actor.getWorldPosition(context.camera.position.clone()); center.y += .25;
  const eye = center.clone().add(center.clone().set(2.5, 1.7, 3.8).applyQuaternion(actor.getWorldQuaternion(context.camera.quaternion.clone())));
  context.cameraRig.quaternion.set(0, 0, 0, 1); context.cameraRig.position.copy(eye); context.camera.position.set(0, 0, 0); context.camera.lookAt(center); context.camera.updateWorldMatrix(true, false); if (context.desktopLook) context.desktopLook.reset(); if (context.resetCollisionPose) context.resetCollisionPose();
  const analyser = context.audioListener.context.createAnalyser(); analyser.fftSize = 512; e.industrialAudio.master.connect(analyser); __publicQA.analyser = analyser;
  return {eye: eye.toArray(), center: center.toArray(), trusted: __publicQA.trusted, active: e.industrialAudio.activated, contextState: context.audioListener.context.state};
}
function publicAudioReport() {
  const e = context.editor, row = e.simulation.records.get(__publicQA.id), voice = e.industrialAudio.voices.get('loop:' + __publicQA.id), samples = new Float32Array(__publicQA.analyser.fftSize); __publicQA.analyser.getFloatTimeDomainData(samples);
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  return {actualSpeed: row.components.conveyor.actualSpeed, running: row.components.conveyor.running, paused: row.components.conveyor.paused, globalPaused: e.simulationPaused, positional: !!(voice && voice.panner), voice: !!voice, rate: voice && voice.source.playbackRate.value, voices: e.industrialAudio.voices.size, ambientVoice: e.industrialAudio.voices.has('loop:ambient:sound'), rms, stats: Object.assign({}, e.industrialAudio.stats), contextState: context.audioListener.context.state, gl: context.renderer.getContext().getError()};
}
function publicPauseControl() {
  const e = context.editor, r = e.simulation, control = r.records.get(__publicQA.pauseId), config = control.components.control.config;
  const entry = r.states.find(value => value.state.colliderMesh === control.object && value.state.onSelectStart); if (!entry) throw new Error('The real pause control has no registered runtime handler.');
  const before = r.getControlFeedback(control.id).sequence; entry.state.onSelectStart(null, null); if (entry.state.onSelectEnd) entry.state.onSelectEnd(null, null);
  return {controlId: control.id, command: config.command, scope: config.scope, target: config.targetId, sequenceBefore: before, sequenceAfter: r.getControlFeedback(control.id).sequence};
}
async function publicCurrentQA(b) {
  await b.until(() => b.evaluate('Boolean(context.studio?.header&&context.editor.entities?.environment?.stats&&context.editor.roomId==="sound")'), 'Public viewer did not initialize.');
  const initial = await b.evaluate('(' + publicInitialize.toString() + ')()');
  assert.equal(initial.project.revision, 15); assert.equal(initial.activeEditor, false); assert.equal(initial.environment.renderQuality, 'high'); assert.equal(initial.environment.shadows, true); assert.equal(initial.environment.exposure, .9); assert.equal(initial.environment.sunIntensity, .85); assert.equal(initial.environment.ambientIntensity, .15); assert.equal(initial.environment.machineSounds, true); assert.equal(initial.environment.ambientPreset, 'warehouse'); assert.equal(initial.environment.ambientVolume, .12); assert.equal(initial.activation.active, false); assert.equal(initial.activation.voices, 0); assert.equal(initial.gl, 0);
  await b.screenshot('public-lab15-authored-interior');
  await b.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: initial.activation.x, y: initial.activation.y, button: 'left', clickCount: 1}); await b.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: initial.activation.x, y: initial.activation.y, button: 'left', clickCount: 1});
  await b.until(() => b.evaluate('context.editor.industrialAudio.activated&&context.audioListener.context.state==="running"'), 'The public trusted click did not resume the shared AudioContext.');
  const frame = await b.evaluate('(' + publicNearMachine.toString() + ')()'); assert(frame.trusted);
  const running = await b.until(() => b.evaluate('(()=>{const value=(' + publicAudioReport.toString() + ')();return value.voice&&value.actualSpeed>0&&value.rms>0.00001?value:null})()'), 'Actual published demo did not produce positional motor audio.');
  assert(running.ambientVoice); assert(running.stats.peakVoices <= 12); assert.equal(running.gl, 0); await b.screenshot('public-lab15-machine-audio');
  const pause = await b.evaluate('(' + publicPauseControl.toString() + ')()'); assert.equal(pause.sequenceAfter, pause.sequenceBefore + 1);
  const paused = await b.until(() => b.evaluate('(()=>{const value=(' + publicAudioReport.toString() + ')();return value.paused&&value.actualSpeed===0&&!value.voice?value:null})()'), 'The actual HMI pause binding did not stop its transport audio.');
  assert.equal(paused.globalPaused, false); assert(paused.ambientVoice); assert.equal(paused.contextState, 'running'); assert.equal(paused.gl, 0);
  const finish = await b.evaluate('(async()=>{const e=context.editor,unchanged=JSON.stringify(await e.document.serialize())===__publicQA.before;e.industrialAudio.master.disconnect(__publicQA.analyser);__publicQA.analyser.disconnect();return {authoredUnchanged:unchanged,buttonClickAudio:e.industrialAudio.buffers.has("procedural:button:shot"),blockedWrites:__qaBlockedWrites,gl:context.renderer.getContext().getError()}})()');
  assert(finish.authoredUnchanged); assert(finish.buttonClickAudio); assert.deepEqual(finish.blockedWrites, []); assert.equal(finish.gl, 0); assert.deepEqual(b.writes, []); assert.deepEqual(b.exceptions, []); assert.deepEqual(b.consoleErrors, []);
  return {readOnly: true, publicCurrent: true, projectId: PROJECT, revision: 15, initial, frame, running, pause, paused, finish, shots: b.shots, writes: b.writes, exceptions: b.exceptions, consoleErrors: b.consoleErrors};
}

async function run() {
  fs.mkdirSync(OUTPUT, {recursive: true}); const before = (await request('/api/projects/' + PROJECT)).project, original = (await request('/api/projects/' + ORIGINAL)).project;
  assert.equal(before.revision, PUBLIC_CURRENT ? 15 : 14); assert.equal(original.revision, 9);
  const report = await withBrowser(PROJECT, async b => {
    if (PUBLIC_CURRENT) return publicCurrentQA(b);
    const initial = await b.evaluate('(' + initializeQA.toString() + ')()'); assert.equal(initial.ownAudioActivated, false); assert.equal(initial.ownVoices, 0);
    if (process.argv.includes('--catalog-only')) return {readOnly: true, catalogOnly: true, catalog: await catalogQA(b), shots: b.shots, writes: b.writes, exceptions: b.exceptions, consoleErrors: b.consoleErrors};
    await b.evaluate('(async()=>{await context.editor.hooks.gotoRoom(2);return true})()');
    const actor = await b.evaluate('(' + selectActor.toString() + ')()'); console.log('Appearance actor:', actor.name);
    if (process.argv.includes('--bounds-only')) {
      const model = await b.evaluate('(' + technologyAndOwnModel.toString() + ')()');
      return {readOnly: true, diagnostic: true, actor, model, geometryErrors: await b.evaluate('__appearanceQA.geometryErrors'), writes: b.writes, exceptions: b.exceptions, consoleErrors: b.consoleErrors};
    }
    assert(actor.sections[1].startsWith('TRANSFORMACI')); assert.equal(actor.sections[2], 'CONFIGURACIÓN DEL EQUIPO');
    const parts = await b.evaluate('(' + editParts.toString() + ')()'); assert.deepEqual(parts.colors, ['d95c37', '368fc9', parts.thirdBefore]); assert.equal(parts.gl, 0); await b.screenshot('appearance-two-parts');
    const model = await b.evaluate('(' + technologyAndOwnModel.toString() + ')()'); assert(model.actorsPreserved); assert(model.technology.actorsPreserved); assert(model.colorEditable); assert(model.controlVisibility.every(value => value.visible && !value.masked)); assert(model.technology.links.every(value => value.gap < .001)); assert.equal(model.gl, 0); console.log('Real GLB local import and functional technology: passed');
    const reopen = await b.evaluate('(' + reopenLocal.toString() + ')()'); assert(reopen.same, JSON.stringify(reopen)); assert.deepEqual(reopen.restoredColors, reopen.expectedColors); assert.equal(reopen.gl, 0); console.log('Local applyServerProject reopening: passed');
    const catalog = await catalogQA(b);
    const click = await b.evaluate('(' + prepareSoundClick.toString() + ')()'); assert(click.visible); assert.equal(click.active, false); assert.equal(click.voices, 0);
    await b.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: click.x, y: click.y, button: 'left', clickCount: 1}); await b.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: click.x, y: click.y, button: 'left', clickCount: 1});
    await b.until(() => b.evaluate('context.editor.industrialAudio.activated&&context.audioListener.context.state==="running"'), 'Real trusted click did not activate the shared AudioContext.');
    const started = await b.evaluate('(' + startAudioRuntime.toString() + ')()'); assert(started.trusted); assert(started.ownActivated);
    const audio = await b.until(() => b.evaluate('(()=>{const value=(' + audioReport.toString() + ')();return value.rms>0.00001?value:null})()'), 'Real WebAudio output remained silent.');
    assert(audio.actualSpeed > 0); assert(audio.positional); assert(audio.stats.peakVoices <= 12); assert.equal(audio.gl, 0);
    await b.evaluate('context.editor.simulation.setVariable(__appearanceQA.id,"speed",.8);true');
    const faster = await b.until(() => b.evaluate('(()=>{const value=(' + audioReport.toString() + ')();return value.rate>' + audio.rate + '&&value.rms>0.00001?value:null})()'), 'Speed change did not update the live source rate and audio output.');
    await b.evaluate('context.editor.simulationPaused=true;true'); await b.until(() => b.evaluate('!context.editor.industrialAudio.voices.has("loop:"+__appearanceQA.id)'), 'Paused machine retained its looping source.'); const paused = await b.evaluate('(' + audioReport.toString() + ')()'); assert.equal(paused.contextState, 'running');
    await b.evaluate('context.editor.simulationPaused=false;context.cameraRig.position.x+=2000;if(context.resetCollisionPose)context.resetCollisionPose();true'); await b.until(() => b.evaluate('!context.editor.industrialAudio.voices.has("loop:"+__appearanceQA.id)'), 'Distant machine retained its source.'); const distant = await b.evaluate('(' + audioReport.toString() + ')()');
    await b.evaluate('context.editor.industrialAudio.master.disconnect(__qaAudioAnalyser);__qaAudioAnalyser.disconnect();context.editor.enter();true');
    assert.equal(await b.evaluate('__qaCatalogDisposes'), 1); assert.deepEqual(await b.evaluate('__qaBlockedWrites'), []); assert.deepEqual(b.writes, []); assert.deepEqual(b.exceptions, []);
    return {readOnly: true, projectId: PROJECT, revision: before.revision, initial, actor, parts, model, reopen, catalog, audio: {click, started, running: audio, faster, paused, distant}, shots: b.shots, writes: b.writes, exceptions: b.exceptions, consoleErrors: b.consoleErrors, geometryErrors: await b.evaluate('__appearanceQA.geometryErrors')};
  });
  const after = (await request('/api/projects/' + PROJECT)).project, untouched = (await request('/api/projects/' + ORIGINAL)).project;
  assert.equal(after.revision, before.revision); assert.equal(hash(after.document), hash(before.document)); assert.equal(untouched.revision, original.revision); assert.equal(hash(untouched.document), hash(original.document));
  fs.writeFileSync(__layout.map(path.join(OUTPUT, report.publicCurrent ? 'public-lab15-audio-browser.json' : report.diagnostic ? 'appearance-bounds-diagnostic.json' : report.catalogOnly ? 'scene-catalog-browser.json' : 'appearance-audio-browser.json')), JSON.stringify(report, null, 2));
  if (report.publicCurrent) { console.log(JSON.stringify({passed: true, public: true, revision: report.revision, rms: report.running.rms, voices: report.running.voices, pauseActualSpeed: report.paused.actualSpeed, ambientContinues: report.paused.ambientVoice, writes: report.writes, shots: report.shots})); return; }
  if (report.diagnostic) { console.log(JSON.stringify(report.geometryErrors)); return; }
  if (report.catalogOnly) { assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.exceptions, []); assert.deepEqual(report.writes, []); console.log('Catalog Chrome: 15 thumbnails, one renderer, visible content/actions, no overlap or errors.'); return; }
  assert.deepEqual(report.consoleErrors, [], JSON.stringify(report.geometryErrors)); console.log(JSON.stringify({passed: true, readOnly: true, parts: report.parts.colors, thumbnails: report.catalog.ready, audioRMS: report.audio.running.rms, shots: report.shots}));
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
