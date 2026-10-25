'use strict';
// Real Chrome comparison of the old un-decoded colour input against the
// corrected linear PBR input. Only private GPU material copies are toggled.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {withBrowser, request, requestRaw, hash} = require('./upgrade-cedi-examples');
const ROOM_IDS = require('../shared/studio-document').ROOM_IDS;
const OUTPUT = path.resolve(__dirname, '../data/qa-studio');
const PROJECTS = [{id: '194c1284-1c6e-4f2a-b089-9c540ed6e32b', roomId: 'sound', label: 'lab'}, {id: '05397448-a767-4f3b-8371-2aeb7ed18ae0', roomId: 'sound', label: 'advanced-packing', public: true}];

function toggleLegacyColours(legacy) {
  const e = context.editor;
  if (!window.__colourEvidence) {
    const colours = new Map();
    e.root.traverse(node => (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean).forEach(material => {
      if (material.color && material.userData.surfaceMaterialBinding && !colours.has(material)) colours.set(material, material.color.clone());
    }));
    window.__colourEvidence = colours;
  }
  __colourEvidence.forEach((colour, material) => { material.color.copy(colour); if (legacy) material.color.convertLinearToSRGB(); });
  e.entities.sync();
  if (e.active) e.render(0); else { e.root.updateMatrixWorld(true); context.renderer.render(e.hooks.renderScene, context.camera); }
  return {materials: __colourEvidence.size, legacy};
}

function imageEvidence() {
  const e = context.editor, renderer = context.renderer;
  e.entities.sync();
  if (e.active) e.render(0); else { e.root.updateMatrixWorld(true); renderer.render(e.hooks.renderScene, context.camera); }
  const gl = renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const controllerRay = context.controllers && context.controllers.find(controller => controller.raycaster)?.raycaster;
  if (!controllerRay) throw new Error('A real Three raycaster is required to sample only the visible floor.');
  const ray = new controllerRay.constructor(), point = e.camera.position.clone(), values = [], samples = [];
  for (let y = 0; y < 7; y++) for (let x = 0; x < 12; x++) {
    const u = (x + .5) / 12, v = (y + .5) / 7;
    ray.setFromCamera(point.set(u * 2 - 1, v * 2 - 1, 0), e.active ? e.camera : context.camera);
    const hit = ray.intersectObject(e.root, true).find(hit => e.decals.isSurface(hit.object));
    if (!hit || Math.abs(hit.point.y) > .15 || !hit.face || Math.abs(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y) < .9) continue;
    const offset = (Math.min(height - 1, Math.floor(v * height)) * width + Math.min(width - 1, Math.floor(u * width))) * 4;
    const rgb = Array.from(pixels.slice(offset, offset + 3), value => value / 255), saturation = Math.max(...rgb) - Math.min(...rgb);
    if (saturation > .14) continue;
    const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; values.push(luminance); samples.push({u, v, rgb, luminance});
  }
  values.sort((a, b) => a - b);
  const colour = Array.from(e.materials.states.values()).flatMap(state => state.groups).find(group => group.config.preset === 'concrete');
  const floorMaterial = colour && Array.from(colour.materials)[0], env = e.entities.environment;
  const actualCamera = e.active ? e.camera : context.camera, eye = actualCamera.getWorldPosition(point.clone()), forward = actualCamera.getWorldDirection(point.clone());
  const actors = e.document.getObjects(e.roomId).filter(object => ['conveyor', 'source', 'processor', 'palletQueue'].includes(object.userData.editorPrefabKey)).map(object => {
    const position = object.getWorldPosition(point.clone()), delta = position.clone().sub(eye), distance = delta.length();
    let visible = true; for (let node = object; node; node = node.parent) if (!node.visible) visible = false;
    return {id: object.userData.editorId, name: object.name, visible, position: position.toArray(), distance, alignment: distance ? delta.dot(forward) / distance : 0};
  });
  return {width, height, floor: {samples: values.length, median: values[Math.floor(values.length / 2)], min: values[0], max: values[values.length - 1], points: samples},
    concrete: floorMaterial && {input: colour.config.color, linear: floorMaterial.color.toArray(), roughness: floorMaterial.roughness, bump: !!floorMaterial.bumpMap},
    rendering: {toneMapping: renderer.toneMapping, outputEncoding: renderer.outputEncoding, exposure: renderer.toneMappingExposure, quality: Object.assign({}, env.stats), shadowActors: {cached: env.shadowActors.length, actual: actors}, gl: gl.getError(), programs: renderer.info.programs.map(program => ({name: program.name, runnable: program.diagnostics ? program.diagnostics.runnable : null}))}};
}

function framePublicEquipment() {
  const e = context.editor, camera = context.camera;
  const object = e.document.getObjects(e.roomId).find(object => object.userData.editorPrefabKey === 'conveyor' && e.document.getBehaviors(object).some(config => config.type === 'conveyor' && !config.withPanel && config.layout === 'straight'));
  if (!object) throw new Error('The public study needs a real conveyor detail view.');
  object.updateWorldMatrix(true, true);
  const center = object.getWorldPosition(camera.position.clone()); center.y = .65;
  const eye = center.clone().add(camera.position.clone().set(.8, 1.35, 3.6).applyQuaternion(object.getWorldQuaternion(camera.quaternion.clone())));
  context.cameraRig.position.add(eye.clone().sub(camera.getWorldPosition(center.clone()))); context.cameraRig.updateMatrixWorld(true); camera.lookAt(center); camera.updateMatrixWorld(true);
  e.entities.sync(); context.renderer.render(e.hooks.renderScene, camera);
  return {id: object.userData.editorId, name: object.name, eye: eye.toArray(), target: center.toArray(), gl: context.renderer.getContext().getError()};
}

async function run() {
  assert((await requestRaw('/bundle.js')).includes(Buffer.from('Decode once here')), 'The running bundle must include the colour correction.');
  const selectedProjects = process.argv.includes('--packing-only') ? PROJECTS.filter(item => item.public) : PROJECTS;
  const before = await Promise.all(selectedProjects.map(async item => Object.assign({}, item, {project: (await request('/api/projects/' + item.id)).project}))), reports = [];
  for (const item of before) {
    console.log('Chrome colour management:', item.label, item.project.revision);
    await withBrowser(item.id, async browser => {
      if (item.public) {
        await browser.evaluate('setTimeout(()=>location.href=' + JSON.stringify('/?project=' + item.id + '&room=' + item.roomId) + ',200);true');
        await browser.until(() => browser.evaluate('Boolean(window.context?.editor&&!context.editor.active&&!context.editor.initializing&&!context.editor.loadingProject&&context.editor.roomId===' + JSON.stringify(item.roomId) + '&&context.editor.currentProject?.id===' + JSON.stringify(item.id) + ')').catch(() => false), 'The real public packing scenario must finish loading.');
        await browser.evaluate('context.editor.simulationPaused=true;true');
      } else await browser.evaluate('(async()=>{const e=context.editor;await e.hooks.gotoRoom(' + ROOM_IDS.indexOf(item.roomId) + ');e.select(null);e.simulationPaused=true;e.home();e.entities.sync();e.render(0);return true})()');
      const authored = await browser.evaluate('(async()=>context.editor.document.serialize())()');
      const savedPose = await browser.evaluate('(()=>{const c=context.editor.active?context.editor.camera:context.camera;return {position:c.position.toArray(),quaternion:c.quaternion.toArray()}})()');
      await browser.evaluate('(' + toggleLegacyColours.toString() + ')(true)');
      const legacy = await browser.evaluate('(' + imageEvidence.toString() + ')()'); await browser.screenshot('colour-' + item.label + '-legacy');
      await browser.evaluate('(' + toggleLegacyColours.toString() + ')(false)');
      const corrected = await browser.evaluate('(' + imageEvidence.toString() + ')()'); await browser.screenshot('colour-' + item.label + '-corrected');
      assert.equal(legacy.rendering.gl, 0); assert.equal(corrected.rendering.gl, 0); assert(!corrected.rendering.programs.some(program => program.runnable === false));
      assert(corrected.floor.samples >= 3, 'Visible floor samples must be selected by real scene raycasts.');
      assert(corrected.floor.median < legacy.floor.median - .08, 'Decoding the authored colour must materially reduce the washed-out floor at identical lights and camera.');
      assert.equal(corrected.rendering.quality.shadowMaps, 1); assert.equal(corrected.rendering.quality.reflectionBuilds, 1);
      assert.equal(hash(await browser.evaluate('(async()=>context.editor.document.serialize())()')), hash(authored));
      const finalPose = await browser.evaluate('(()=>{const c=context.editor.active?context.editor.camera:context.camera;return {position:c.position.toArray(),quaternion:c.quaternion.toArray()}})()');
      for (const key of ['position', 'quaternion']) finalPose[key].forEach((value, index) => assert(Math.abs(value - savedPose[key][index]) < 1e-9, 'Both screenshots retain the same authored camera pose.'));
      let detail;
      if (item.public) { detail = await browser.evaluate('(' + framePublicEquipment.toString() + ')()'); assert.equal(detail.gl, 0); await browser.screenshot('colour-' + item.label + '-detail-corrected'); }
      assert.deepEqual(browser.writes, []); assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.consoleErrors, []);
      reports.push({projectId: item.id, revision: item.project.revision, label: item.label, roomId: item.roomId, legacy, corrected, detail, shots: browser.shots, writes: [], exceptions: [], consoleErrors: []});
    });
  }
  for (const item of before) { const after = (await request('/api/projects/' + item.id)).project; assert.equal(after.revision, item.project.revision); assert.equal(hash(after.document), hash(item.project.document)); }
  fs.writeFileSync(path.join(OUTPUT, process.argv.includes('--packing-only') ? 'surface-colour-packing-browser.json' : 'surface-colour-browser.json'), JSON.stringify({readOnly: true, unchangedLightingAndCamera: true, reports}, null, 2));
  console.log(JSON.stringify(reports.map(item => ({label: item.label, legacyFloorMedian: item.legacy.floor.median, correctedFloorMedian: item.corrected.floor.median, samples: item.corrected.floor.samples, gl: item.corrected.rendering.gl, shots: item.shots}))));
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
