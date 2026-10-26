'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const {prepare, safeOutput} = require('./prepare-pages-site');
const publicScenes = require('../shared/public-scenes');
const sourceRoot = path.resolve(__dirname, '..');
const decoders = ['basis_transcoder.js', 'basis_transcoder.wasm', 'draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'];
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webxr-pages-package-'));
function write(file, content = 'fixture') { const target = path.join(temporaryRoot, file); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, content); }
try {
  for (const file of ['index.html', 'bundle.js', 'mesh-optimizer-worker.js', 'collision-worker.js', '.nojekyll', 'LICENSE', 'src/lib/StartupStatus.js', 'src/editor/editor.css', 'assets/materials/ai-industrial-concrete-v1-512.jpg', 'assets/ai/native-texture-ai-worker.js', 'assets/model.glb', 'res/favicon.png']) write(file);
  // Real decoder binaries must remain at the paths requested by Three.js'
  // BasisTextureLoader and DRACOLoader, not merely exist in the repository.
  for (const file of decoders.concat('meshoptimizer.LICENSE.md')) write('src/vendor/' + file, fs.readFileSync(path.join(sourceRoot, 'src/vendor', file)));
  const document = {format: 'hello-webxr-editor', version: 1, rooms: {hall: {additions: [], overrides: []}, sound: {additions: [], overrides: []}}, studio: {scenes: [{id: 'hall'}, {id: 'sound'}]}, imports: []};
  for (const scene of publicScenes.SCENES) write('assets/public-scenes/' + scene.id + '.json', JSON.stringify({project: publicScenes.project(document, scene)}));
  write('assets/public-scenes/catalog.json', JSON.stringify({scenes: publicScenes.SCENES}));
  write('index.html', '<base href="./"><script src="src/lib/StartupStatus.js"></script><script src="bundle.js"></script><link href="src/editor/editor.css">');
  for (const file of ['data/projects.sqlite', 'data/users/u1/private.json', 'server/account.js', '.git/config', '.env', 'node_modules/private.key', 'examples/private.json', 'bundle.js.map', 'src/studio/StudioClient.js']) write(file, 'private fixture must remain outside artifact');
  const revision = 'a'.repeat(40), result = prepare({root: temporaryRoot, revision});
  assert.equal(result.output, path.join(temporaryRoot, 'data/pages-site'));
  for (const file of ['index.html', 'bundle.js', 'mesh-optimizer-worker.js', 'collision-worker.js', '.nojekyll', 'LICENSE', 'src/lib/StartupStatus.js', 'src/editor/editor.css', 'assets/model.glb', 'assets/ai/native-texture-ai-worker.js', 'assets/materials/ai-industrial-concrete-v1-512.jpg', 'assets/public-scenes/l-transfer.json', 'assets/public-scenes/inspection-sorting.json', 'res/favicon.png']) assert(fs.existsSync(path.join(result.output, file)), file);
  for (const file of decoders) {
    const packaged = fs.readFileSync(path.join(result.output, 'src/vendor', file)), original = fs.readFileSync(path.join(sourceRoot, 'src/vendor', file));
    assert(packaged.equals(original), 'A deployed decoder must be the actual runtime: ' + file);
    if (file.endsWith('.wasm')) { assert.equal(packaged.subarray(0, 4).toString('hex'), '0061736d'); assert(WebAssembly.validate(packaged), 'Published WASM must compile: ' + file); }
  }
  for (const file of ['src/lib/assetManager.js', 'src/editor/AssetLibrary.js']) assert(fs.readFileSync(path.join(sourceRoot, file), 'utf8').includes("'src/vendor/'"), 'Keep deployment checks aligned with decoder runtime paths.');
  for (const file of ['data', 'server', '.git', '.env', 'node_modules', 'examples', 'bundle.js.map', 'src/studio/StudioClient.js']) assert(!fs.existsSync(path.join(result.output, file)), file + ' must never be published');
  assert.equal(result.publication.revision, revision); assert.equal(result.publication.bundleSha256, crypto.createHash('sha256').update('fixture').digest('hex'));
  assert.deepEqual(result.publication.scenes, ['l-transfer', 'inspection-sorting']);
  write('data/pages-site/stale.js'); prepare({root: temporaryRoot}); assert(!fs.existsSync(path.join(result.output, 'stale.js')));
  assert.equal(fs.readFileSync(path.join(temporaryRoot, 'data/projects.sqlite'), 'utf8'), 'private fixture must remain outside artifact');
  for (const target of [temporaryRoot, path.dirname(temporaryRoot), path.join(temporaryRoot, 'data'), path.join(temporaryRoot, 'data/elsewhere')]) assert.throws(() => safeOutput(temporaryRoot, target), /sólo puede/);
  write('assets/private.pem'); assert.throws(() => prepare({root: temporaryRoot}), /no publicable/); fs.unlinkSync(path.join(temporaryRoot, 'assets/private.pem'));
  fs.renameSync(path.join(temporaryRoot, 'src/vendor/basis_transcoder.wasm'), path.join(temporaryRoot, 'src/vendor/basis_transcoder.wasm.missing'));
  assert.throws(() => prepare({root: temporaryRoot}), /Falta un recurso necesario.*basis_transcoder.wasm/);
  fs.renameSync(path.join(temporaryRoot, 'src/vendor/basis_transcoder.wasm.missing'), path.join(temporaryRoot, 'src/vendor/basis_transcoder.wasm'));
  write('assets/public-scenes/private.json'); assert.throws(() => prepare({root: temporaryRoot}), /dos escenarios públicos/); fs.unlinkSync(path.join(temporaryRoot, 'assets/public-scenes/private.json'));
  write('index.html', '<script src="/bundle.js"></script>'); assert.throws(() => prepare({root: temporaryRoot}), /fuera de la publicación/); write('index.html', 'fixture');
  // Directory junctions work without elevated symlink permission on Windows.
  const linked = path.join(temporaryRoot, 'assets/external'); fs.symlinkSync(path.join(temporaryRoot, 'server'), linked, 'junction');
  assert.throws(() => prepare({root: temporaryRoot}), /enlaces simbólicos/); fs.unlinkSync(linked);
  const danglingRoot = path.join(temporaryRoot, 'dangling-root'); fs.mkdirSync(danglingRoot);
  fs.symlinkSync(path.join(temporaryRoot, 'missing-directory'), path.join(danglingRoot, 'data'), 'junction');
  assert.throws(() => safeOutput(danglingRoot), /directorio real/); fs.unlinkSync(path.join(danglingRoot, 'data'));
  const workflow = fs.readFileSync(path.join(sourceRoot, '.github/workflows/pages.yml'), 'utf8');
  assert.match(workflow, /branches: \[main\]/); assert.match(workflow, /workflow_dispatch:/);
  for (const action of ['configure-pages@v5', 'upload-pages-artifact@v4', 'deploy-pages@v4']) assert(workflow.includes(action));
  assert(workflow.includes('path: data/pages-site')); assert(!workflow.includes('path: .\n'));
  console.log('Pages package: allowlisted runtime with real Basis/Draco decoder JS/WASM, both public projections, workers/materials/styles, source revision/hash, no private files, bounded replacement and symlink rejection passed.');
} finally {
  // The generated fixture is an inspected mkdtemp child of the OS temp root.
  const resolved = path.resolve(temporaryRoot), parent = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('webxr-pages-package-')) throw new Error('Unexpected fixture path.');
  fs.rmSync(resolved, {recursive: true, force: true});
}
