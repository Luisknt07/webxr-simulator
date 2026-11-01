'use strict';
// One maintained model preview from the actual loaded scene document, rendered
// by the production editor. Template aliases are not reliable provenance: the
// public demo can deliberately use a different vehicle/profile than its seed.
// Its HTTPS server, owner account, SQLite database and Chrome profile are
// disposable. No live account, project or publication is opened or changed.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createHash, randomBytes} = require('node:crypto');
const {startFixture, withBrowser} = require('../qa/workspace-production.cjs');
const ROOT = path.resolve(__dirname, '../..'), WIDTH = 480, HEIGHT = 320, RECIPE_VERSION = 2;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function generate(options = {}) {
  assert.match(options.id || '', /^[a-z0-9-]{1,80}$/, 'Pass one --scene ID.');
  assert.match(options.expected || '', /^[a-f0-9]{64}$/, 'Pass the reviewed --expected-workspace-sha256.');
  const bundleSha256 = digest(fs.readFileSync(path.join(ROOT, 'artifacts/workspace/bundle.js')));
  assert.equal(bundleSha256, options.expected, 'The production bundle must match the reviewed build.');
  const catalogFile = path.join(ROOT, 'projects/smarttwin/scenes/catalog.json'), catalogBytes = fs.readFileSync(catalogFile);
  const catalog = JSON.parse(catalogBytes), definition = catalog.scenes.find(scene => scene.id === options.id);
  assert(definition && definition.templateId, 'The selected scene needs a maintained model factory.');
  const sceneBytes=fs.readFileSync(path.join(ROOT,'projects/smarttwin/scenes',options.id+'.json')),documentModel=JSON.parse(sceneBytes).project.document;
  const machineTypes=new Set(['conveyor','source','processor','palletQueue','robot','vehicle']);
  const machines=(documentModel.rooms[definition.roomId].additions||[]).flatMap(object=>{const config=(object.behaviors||[]).find(value=>machineTypes.has(value.type));return config?[{id:object.id,type:config.type,variant:config.variant||'',visualModel:config.visualModel||''}]:[];});
  assert(machines.length>0&&machines.length<=100,'The maintained room needs a bounded set of native equipment.');
  const directory = path.join(ROOT, 'projects/smarttwin/previews'), manifestFile = path.join(directory, 'manifest.json');
  const previous = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(previous.recipeVersion, RECIPE_VERSION);
  const report = {temporaryDatabaseOnly: true, scene: options.id, workspaceSha256: bundleSha256, exceptions: [], consoleErrors: [], failedRequests: [], responses: [], screenshots: []};
  const password = 'Disposable-model-preview-' + randomBytes(18).toString('hex'), fixture = await startFixture(password);
  let rendered;
  try {
    rendered = await withBrowser(fixture, report, async browser => {
      await browser.send('Page.navigate', {url: fixture.origin + '/editor?libraryScene=' + encodeURIComponent(options.id)});
      await browser.until(() => browser.evaluate('Boolean(document.getElementById("login"))'), 'The private editor did not request the disposable login.', 30000);
      await browser.call((username, secret) => { const form = document.getElementById('login'); form.elements.username.value = username; form.elements.password.value = secret; form.requestSubmit(); }, 'qa_production_owner', password);
      await browser.until(() => browser.evaluate('Boolean(window.context&&context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&context.studio&&context.studio.ready)'), 'The production editor did not initialize.', 60000);
      await browser.until(()=>browser.call(expected=>{const editor=context.editor;return editor.roomId===expected.roomId&&expected.machines.every(row=>{const object=editor.document.getObject(row.id),config=object&&editor.document.getBehaviors(object).find(value=>value.type===row.type);return config&&(!row.variant||config.variant===row.variant)&&(!row.visualModel||config.visualModel===row.visualModel);});},{roomId:definition.roomId,machines}),'The actual maintained scene equipment/profile did not load.',60000);
      const result = await browser.call(async expected => {
        const editor = context.editor; editor.simulationPaused = true; context.studio.close();
        if(editor.projectSync)editor.projectSync.stop();
        const objects=expected.machines.map(row=>editor.document.getObject(row.id));
        const actualModels=objects.map((object,index)=>{const row=expected.machines[index];let rig;object.traverse(node=>{if(!rig)rig=node.userData.vehicleRig||node.userData.robotRig;});const actual=Object.assign({},row,{renderedVariant:rig&&rig.config&&rig.config.variant||row.variant,renderedVisualModel:rig&&(rig.visualModel||rig.design&&rig.design.visualModel)||''});if(row.visualModel==='reference-pilot'&&actual.renderedVisualModel!=='reference-pilot')throw Error('The actual equipment is not rendering its declared reference pilot: '+row.id);return actual;});
        const fingerprint=()=>JSON.stringify(objects.map(object=>{object.updateWorldMatrix(true,true);const rows=[];object.traverse(node=>rows.push([node.uuid,node.parent&&node.parent.uuid,node.matrix.toArray(),node.geometry&&node.geometry.uuid,(Array.isArray(node.material)?node.material:[node.material]).filter(Boolean).map(material=>[material.uuid,material.opacity,material.color&&material.color.toArray()])]));return rows;})),before=fingerprint();
        editor.shell.openSceneCatalog('included'); const thumbnails = editor.shell.sceneCatalog.thumbnails;
        thumbnails.reset(); const renderer = thumbnails._getRenderer(); renderer.setSize(480, 320, false);
        const instantiate=thumbnails.library.instantiate,resources={geometries:new Map(),materials:new Map(),textures:new Map()};
        const cloneTexture=texture=>{if(!resources.textures.has(texture)){const copy=texture.clone();copy.needsUpdate=true;resources.textures.set(texture,copy);}return resources.textures.get(texture);};
        const cloneMaterial=material=>{if(!resources.materials.has(material)){const copy=material.clone();copy.onBeforeCompile=material.onBeforeCompile;if(material.defines)copy.defines=Object.assign({},material.defines);for(const key of Object.keys(material))if(material[key]&&material[key].isTexture)copy[key]=cloneTexture(material[key]);resources.materials.set(material,copy);}return resources.materials.get(material);};
        const copyNode=(source,actor=false)=>{
          if(!source.visible||source.userData.editorHelper||source.userData.editorRuntimeHelper&&!source.userData.industrialFinishOverlay)return null;
          let copy;
          if(source.isMesh||source.isLine){if(!resources.geometries.has(source.geometry))resources.geometries.set(source.geometry,source.geometry.clone());const geometry=resources.geometries.get(source.geometry),material=Array.isArray(source.material)?source.material.map(cloneMaterial):cloneMaterial(source.material);copy=source.isInstancedMesh?new source.constructor(geometry,material,source.count):new source.constructor(geometry,material);if(source.isInstancedMesh){copy.instanceMatrix.copy(source.instanceMatrix);if(source.instanceColor)copy.instanceColor=source.instanceColor.clone();}}
          else if(source.isGroup||source.type==='Object3D')copy=new source.constructor();else return null;
          copy.name=source.name;copy.matrixAutoUpdate=false;copy.matrix.copy(actor?source.matrixWorld:source.matrix);copy.visible=true;copy.renderOrder=source.renderOrder;copy.frustumCulled=source.frustumCulled;copy.castShadow=source.castShadow;copy.receiveShadow=source.receiveShadow;copy.userData={};for(const child of source.children){const next=copyNode(child);if(next)copy.add(next);}return copy;
        };
        // Private buffers/materials/textures let _model dispose the complete
        // thumbnail without touching the scene's operational rigs/resources.
        thumbnails.library.instantiate=async()=>{const root=editor.document.getRoot(expected.roomId),group=new root.constructor();group.name='Actual maintained scene '+expected.id;for(const object of objects){const copy=copyNode(object,true);if(copy)group.add(copy);}if(!group.children.length)throw Error('The loaded scene has no visible equipment.');return group;};
        const render = renderer.render.bind(renderer);
        renderer.render = (scene, camera) => { camera.aspect = 480 / 320; camera.zoom = 1.6; camera.updateProjectionMatrix(); return render(scene, camera); };
        try {
          const image = await thumbnails._model({path: 'actual-current-scene:' + expected.id, kind: 'model', extension: '3d'}, thumbnails.generation);
          if (!image.src || !image.src.startsWith('data:image/png;base64,')) throw Error('The real model factory did not return a PNG.');
          const source = image.src, probe = new Image(); probe.src = source; await probe.decode();
          const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
          const drawing = canvas.getContext('2d'); drawing.drawImage(probe, 0, 0, 32, 24);
          const pixels = drawing.getImageData(0, 0, 32, 24).data; let total = 0, squared = 0, min = 255, max = 0;
          for (let index = 0; index < pixels.length; index += 4) { const value = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3; total += value; squared += value * value; min = Math.min(min, value); max = Math.max(max, value); }
          const count = pixels.length / 4, mean = total / count;
          if(fingerprint()!==before)throw Error('Thumbnail generation changed the source equipment.');
          return {data: source.slice('data:image/png;base64,'.length),sourceUnchanged:true,models:actualModels,quality: {width: probe.naturalWidth, height: probe.naturalHeight, mean, variance: squared / count - mean * mean, min, max},
            resources: {geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures}};
        } finally { renderer.render = render;thumbnails.library.instantiate=instantiate;editor.shell.sceneCatalog.close(); }
      }, {id:options.id,roomId:definition.roomId,machines});
      return result;
    });
    assert.deepEqual(report.exceptions, [], 'The production preview raised an exception.');
    assert.deepEqual(fixture.errors, [], 'The disposable production server failed.');
  } finally { await fixture.close(); }
  const bytes = Buffer.from(rendered.data, 'base64');
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR'); assert.equal(bytes.readUInt32BE(16), WIDTH); assert.equal(bytes.readUInt32BE(20), HEIGHT);
  assert(bytes.length > 1000 && bytes.length < 750000); assert(rendered.quality.max - rendered.quality.min > 8 && rendered.quality.variance > 3);
  assert(rendered.resources.geometries <= 2 && rendered.resources.textures <= 2, 'The detached model preview must release its GPU resources.');
  assert.equal(rendered.sourceUnchanged,true);assert.deepEqual(rendered.models.map(({renderedVariant,renderedVisualModel,...machine})=>machine),machines);
  const ids = new Set(catalog.scenes.map(scene => scene.id)), rows = new Map(previous.scenes.filter(row => ids.has(row.id)).map(row => [row.id, row]));
  rows.set(options.id, {id: options.id, title: definition.name, file: options.id + '.png', method: 'actual-study-factory', recipeVersion: RECIPE_VERSION, width: WIDTH, height: HEIGHT,
    source:'loaded-scene-document',models:rendered.models,sourceUnchanged:true,bytes: bytes.length, sha256: digest(bytes), bundleSha256, sceneSha256: digest(sceneBytes), quality: rendered.quality});
  const scenes = catalog.scenes.map(scene => rows.get(scene.id)).filter(Boolean), totalBytes = scenes.reduce((sum, row) => sum + row.bytes, 0);
  assert(totalBytes <= 8 * 1024 * 1024);
  const manifest = {format: 'hello-webxr-scene-thumbnails', version: 1, recipeVersion: RECIPE_VERSION, width: WIDTH, height: HEIGHT, bundleSha256,
    catalogSha256: digest(catalogBytes), complete: scenes.length === catalog.scenes.length, bytes: totalBytes, scenes};
  fs.writeFileSync(path.join(directory, options.id + '.png'), bytes); fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return {id: options.id, bytes: bytes.length, sha256: digest(bytes), bundleSha256, sceneSha256: rows.get(options.id).sceneSha256, quality: rendered.quality,
    models:rendered.models,sourceUnchanged:rendered.sourceUnchanged,resources: rendered.resources, complete: manifest.complete, scenes: manifest.scenes.length};
}
module.exports = {generate};
if (require.main === module) { const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  generate({id: argument('--scene'), expected: argument('--expected-workspace-sha256')}).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; }); }
