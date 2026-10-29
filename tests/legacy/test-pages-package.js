const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const {prepare, safeOutput} = require('../../tooling/assets/prepare-pages-site');
const publicScenes = require('../../projects/smarttwin/public-scenes');
const sourceRoot = __layout.map(path.resolve(__layout.oldDir("scripts/test-pages-package.js"), '..'));
const decoders = ['basis_transcoder.js', 'basis_transcoder.wasm', 'draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'];
const temporaryRoot = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'webxr-pages-package-')));
// Fixture inputs mirror canonical source folders; the legacy artifact still has
// root index/bundle URLs. layout.map intentionally does not rewrite temp paths.
function write(file, content = 'fixture') { const source = file === 'index.html' ? 'apps/workspace/index.html' : /^(?:bundle|mesh-optimizer-worker|collision-worker|cad-worker)\.js$/.test(file) ? 'artifacts/workspace/' + file : file; const target = path.join(temporaryRoot, source); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, content); }
try {
  for (const file of ["index.html", "bundle.js", "mesh-optimizer-worker.js", "collision-worker.js", "cad-worker.js", '.nojekyll', 'LICENSE', "packages/render-three/src/StartupStatus.js", "packages/tools/editor/src/editor.css", 'packages/tools/editor/assets/editor.png', "modules/logistica-industrial/assets/materials/ai-industrial-concrete-v1-512.jpg", "packages/tools/ai/assets/native-texture-ai-worker.js", "modules/turismo/assets/model.glb", "projects/smarttwin/branding/favicon.png"]) write(file);
  // Real decoder binaries must remain at the paths requested by Three.js'
  // BasisTextureLoader and DRACOLoader, not merely exist in the repository.
  for (const file of decoders.concat('meshoptimizer.LICENSE.md')) write("packages/render-three/vendor/" + file, fs.readFileSync(__layout.map(path.join(sourceRoot, "src/vendor", file))));
  const document = {format: 'hello-webxr-editor', version: 1, rooms: {hall: {additions: [], overrides: []}, sound: {additions: [], overrides: []}}, studio: {scenes: [{id: 'hall'}, {id: 'sound'}]}, imports: []};
  for (const scene of publicScenes.SCENES) write("projects/smarttwin/scenes/" + scene.id + '.json', JSON.stringify({project: publicScenes.project(document, scene)}));
  write("projects/smarttwin/scenes/catalog.json", JSON.stringify({scenes: publicScenes.SCENES}));
  write("index.html", "<base href=\"./\"><script src=\"packages/render-three/src/StartupStatus.js\"></script><script src=\"bundle.js\"></script><link href=\"packages/tools/editor/src/editor.css\">");
  for (const file of ['data/projects.sqlite', 'data/users/u1/private.json', 'server/account.js', '.git/config', '.env', 'node_modules/private.key', "projects/smarttwin/examples/private.json", 'bundle.js.map', "apps/workspace/studio/StudioClient.js"]) write(file, 'private fixture must remain outside artifact');
  const revision = 'a'.repeat(40), result = prepare({root: temporaryRoot, revision});
  assert.equal(result.output, __layout.map(path.join(temporaryRoot, 'data/pages-site')));
  for (const file of ["index.html", "bundle.js", "mesh-optimizer-worker.js", "collision-worker.js", "cad-worker.js", '.nojekyll', 'LICENSE', "packages/render-three/src/StartupStatus.js", "packages/tools/editor/src/editor.css", "modules/turismo/assets/model.glb", "packages/tools/ai/assets/native-texture-ai-worker.js", "modules/logistica-industrial/assets/materials/ai-industrial-concrete-v1-512.jpg", "projects/smarttwin/scenes/l-transfer.json", "projects/smarttwin/scenes/inspection-sorting.json", "projects/smarttwin/branding/favicon.png"]) assert(fs.existsSync(__layout.map(path.join(result.output, file))), file);
  for (const file of decoders) {
    const packaged = fs.readFileSync(path.join(result.output, 'packages/render-three/vendor', file)), original = fs.readFileSync(path.join(sourceRoot, 'packages/render-three/vendor', file));
    assert(packaged.equals(original), 'A deployed decoder must be the actual runtime: ' + file);
    if (file.endsWith('.wasm')) { assert.equal(packaged.subarray(0, 4).toString('hex'), '0061736d'); assert(WebAssembly.validate(packaged), 'Published WASM must compile: ' + file); }
  }
  for (const file of ["packages/render-three/src/assetManager.js", "packages/tools/editor/src/AssetLibrary.js"]) assert.match(fs.readFileSync(path.join(sourceRoot, file), 'utf8'), /['"]packages\/render-three\/vendor\/['"]/, 'Keep deployment checks aligned with decoder runtime paths.');
  for (const file of ['data', 'server', '.git', '.env', 'node_modules', "examples", 'bundle.js.map', "apps/workspace/studio/StudioClient.js"]) assert(!fs.existsSync(__layout.map(path.join(result.output, file))), file + ' must never be published');
  assert.equal(result.publication.revision, revision); assert.equal(result.publication.bundleSha256, crypto.createHash('sha256').update('fixture').digest('hex'));
  assert.deepEqual(result.publication.scenes, ['l-transfer', 'inspection-sorting']);
  for (const scene of publicScenes.SCENES) assert.equal(result.publication.projectionSha256[scene.id], crypto.createHash('sha256').update(fs.readFileSync(path.join(temporaryRoot, 'projects/smarttwin/scenes', scene.id + '.json'))).digest('hex'), 'The release identifies the exact reviewed projection bytes.');
  assert.equal(result.publication.catalogSha256, crypto.createHash('sha256').update(fs.readFileSync(__layout.map(path.join(temporaryRoot, "projects/smarttwin/scenes/catalog.json")))).digest('hex'));
  write('data/pages-site/stale.js'); prepare({root: temporaryRoot}); assert(!fs.existsSync(__layout.map(path.join(result.output, 'stale.js'))));
  assert.equal(fs.readFileSync(__layout.map(path.join(temporaryRoot, 'data/projects.sqlite')), 'utf8'), 'private fixture must remain outside artifact');
  for (const target of [temporaryRoot, path.dirname(temporaryRoot), __layout.map(path.join(temporaryRoot, 'data')), __layout.map(path.join(temporaryRoot, 'data/elsewhere'))]) assert.throws(() => safeOutput(temporaryRoot, target), /sólo puede/);
  write("modules/turismo/assets/private.pem"); assert.throws(() => prepare({root: temporaryRoot}), /no publicable/); fs.unlinkSync(__layout.map(path.join(temporaryRoot, "modules/turismo/assets/private.pem")));
  fs.renameSync(__layout.map(path.join(temporaryRoot, "packages/render-three/vendor/basis_transcoder.wasm")), __layout.map(path.join(temporaryRoot, "packages/render-three/vendor/basis_transcoder.wasm.missing")));
  assert.throws(() => prepare({root: temporaryRoot}), /Falta un recurso necesario.*basis_transcoder.wasm/);
  fs.renameSync(__layout.map(path.join(temporaryRoot, "packages/render-three/vendor/basis_transcoder.wasm.missing")), __layout.map(path.join(temporaryRoot, "packages/render-three/vendor/basis_transcoder.wasm")));
  write("projects/smarttwin/scenes/private.json"); assert.throws(() => prepare({root: temporaryRoot}), /escenarios públicos declarados/); fs.unlinkSync(__layout.map(path.join(temporaryRoot, "projects/smarttwin/scenes/private.json")));
  write("index.html", '<script src="/bundle.js"></script>'); assert.throws(() => prepare({root: temporaryRoot}), /fuera de la publicación/); write("index.html", 'fixture');
  // Directory junctions work without elevated symlink permission on Windows.
  const linked = __layout.map(path.join(temporaryRoot, "modules/turismo/assets/external")); fs.symlinkSync(__layout.map(path.join(temporaryRoot, 'server')), linked, 'junction');
  assert.throws(() => prepare({root: temporaryRoot}), /enlaces simbólicos/); fs.unlinkSync(linked);
  const danglingRoot = __layout.map(path.join(temporaryRoot, 'dangling-root')); fs.mkdirSync(danglingRoot);
  fs.symlinkSync(__layout.map(path.join(temporaryRoot, 'missing-directory')), __layout.map(path.join(danglingRoot, 'data')), 'junction');
  assert.throws(() => safeOutput(danglingRoot), /directorio real/); fs.unlinkSync(__layout.map(path.join(danglingRoot, 'data')));
  const workflow = fs.readFileSync(__layout.map(path.join(sourceRoot, '.github/workflows/pages.yml')), 'utf8');
  assert.match(workflow, /branches: \[main\]/); assert.match(workflow, /workflow_dispatch:/);
  for (const action of ['configure-pages@v5', 'upload-pages-artifact@v4', 'deploy-pages@v4']) assert(workflow.includes(action));
  assert(workflow.includes('path: data/pages-site')); assert(!workflow.includes('path: .\n'));
  assert(workflow.includes('run: node tooling/deploy/verify-public.cjs')); assert(workflow.includes('run: node tooling/deploy/prepare-pages.cjs')); assert(!workflow.includes('run: node tooling/assets/prepare-pages-site.js'), 'Production deploys the single-scene artifact, not the explicit legacy preview profile.'); assert(!workflow.includes("run: node tooling/assets/generate-public-scenes.js"), 'Packaging cannot run a generator whose dependencies are deliberately absent.');
  const isolated = require('node:child_process').spawnSync(process.execPath, ['-e', "const M=require('node:module'),p=require('node:path'),load=M._load;M._load=function(id,parent,main){if(!id.startsWith('.')&&!p.isAbsolute(id)&&!M.isBuiltin(id))throw new Error('Unexpected npm dependency: '+id);return load.call(this,id,parent,main)};require('./tooling/assets/validate-public-scenes').validate();"], {cwd: sourceRoot, encoding: 'utf8'});
  assert.equal(isolated.status, 0, 'A clean CI checkout must validate without node_modules: ' + isolated.stderr);
  // The temporary all-example preview is a separate contract from the normal
  // two-scene regression above. Its inventory follows the real framework
  // recipes; adding an example cannot silently omit it from Pages.
  const previewIds = require('../../tooling/assets/validate-scene-thumbnails').expectedIds(sourceRoot);
  const previewScenes = previewIds.map(id => ({id, name: id, roomId: id.startsWith('original-') ? id.slice(9) : publicScenes.SCENES.find(scene => scene.id === id)?.roomId || 'hall', public: true, included: true}));
  write("projects/smarttwin/scenes/catalog.json", JSON.stringify({previewAllExamples: true, requiresLogin: false, includedCount: previewScenes.length, scenes: previewScenes}));
  const thumbnailBytes = new Map();
  for (const scene of previewScenes) {
    const projectedDocument = {format: 'hello-webxr-editor', version: 1, rooms: {[scene.roomId]: {additions: [], overrides: []}}, studio: {scenes: [{id: scene.roomId}]}, imports: []};
    write("projects/smarttwin/scenes/" + scene.id + '.json', JSON.stringify({project: publicScenes.project(projectedDocument, scene)}));
    const bytes = Buffer.from('offline-thumbnail-fixture:' + scene.id); thumbnailBytes.set(scene.id, bytes); write("projects/smarttwin/previews/" + scene.id + '.png', bytes);
  }
  write("projects/smarttwin/previews/manifest.json", JSON.stringify({format: 'thumbnail-package-fixture', scenes: previewIds}));
  const preview = prepare({root: temporaryRoot, revision});
  assert.equal(preview.publication.previewAllExamples, true);
  assert.deepEqual(preview.publication.scenes.slice().sort(), previewIds.slice().sort());
  assert.equal(preview.publication.scenes.length, require('../../tooling/assets/validate-public-scenes').inventory(sourceRoot).includedCount);
  assert.deepEqual(fs.readdirSync(path.join(preview.output, 'projects/smarttwin/previews')).sort(), ['manifest.json'].concat(previewIds.map(id => id + '.png')).sort());
  for (const [id, bytes] of thumbnailBytes) assert(fs.readFileSync(path.join(preview.output, 'projects/smarttwin/previews', id + '.png')).equals(bytes), 'Pages must copy the offline preview unchanged: ' + id);
  for (const file of ['data', 'server', '.git', '.env', 'node_modules', "examples"]) assert(!fs.existsSync(__layout.map(path.join(preview.output, file))), 'All-example publication still excludes private storage: ' + file);
  console.log('Pages package: restricted publication and all ' + previewIds.length + ' framework examples with static preview assets, real Basis/Draco decoders, source hashes, no private files, bounded replacement and symlink rejection passed.');
} finally {
  // The generated fixture is an inspected mkdtemp child of the OS temp root.
  const resolved = __layout.map(path.resolve(temporaryRoot)), parent = __layout.map(path.resolve(os.tmpdir()));
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('webxr-pages-package-')) throw new Error('Unexpected fixture path.');
  fs.rmSync(resolved, {recursive: true, force: true});
}
