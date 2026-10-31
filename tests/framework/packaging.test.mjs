import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {packageApps, FORMAT} = require('../../tooling/build/package-apps.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const compiled = {'public-viewer': ['viewer.js'], 'core-empty': ['core-empty.js'], workspace: ['bundle.js', 'mesh-optimizer-worker.js', 'collision-worker.js', 'cad-worker.js']};
function write(root, filename, bytes = filename) { const output = path.join(root, filename); fs.mkdirSync(path.dirname(output), {recursive: true}); fs.writeFileSync(output, bytes); }
function walk(directory, prefix = '') { return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name), prefix + entry.name + '/') : [prefix + entry.name]).sort(); }
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smarttwin-packaging-')));
  t.after(() => { const resolved = fs.realpathSync(root), parent = fs.realpathSync(os.tmpdir()); assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('smarttwin-packaging-')); fs.rmSync(resolved, {recursive: true}); });
  for (const [profile, files] of Object.entries(compiled)) for (const filename of files) { write(root, `artifacts/${profile}/${filename}`, 'compiled ' + profile + filename); write(root, `artifacts/${profile}/${filename}.map`, 'DO NOT PUBLISH SOURCEMAPS'); }
  write(root, 'apps/public-viewer/index.html', '<link rel="stylesheet" href="viewer.css"><script src="config.js"></script><script defer src="viewer.js"></script>');
  write(root, 'apps/public-viewer/viewer.css', '.viewer{background:#123}'); write(root, 'apps/public-viewer/config.js', 'window.CONFIG={sceneURL:"projects/smarttwin/scenes/vr-robot-dispatch.json"};');
  write(root, 'modules/turismo/assets/smart-twin-cover.jpg', 'approved public cover');
  write(root, 'packages/voice-assistant/voice-assistant.css', '.voice-assistant{}');
  for (const id of ['welcome','pickup','route','deposit','completed','safety']) write(root, 'packages/voice-assistant/assets/'+id+'.wav', 'approved test audio '+id);
  write(root, 'apps/core-empty/index.html', '<link rel="stylesheet" href="core.css"><script defer src="core-empty.js"></script>'); write(root, 'apps/core-empty/core.css', 'body{margin:0}');
  write(root, 'apps/workspace/index.html', '<base href="/workspace/"><link rel="stylesheet" href="packages/render-three/src/workspace.css"><link rel="icon" href="projects/smarttwin/branding/icon.png"><script src="packages/render-three/src/StartupStatus.js"></script><script src="bundle.js"></script>');
  write(root, 'packages/render-three/src/workspace.css', '.world{background:url("../../../modules/turismo/assets/texture.png")}'); write(root, 'modules/logistica-industrial/functions/bandas/runtime/belt.css', '.belt{}'); write(root, 'apps/workspace/studio/studio.css', '.studio{}');
  write(root, 'packages/render-three/src/StartupStatus.js', 'window.startupReady=true;');
  for (const filename of ['basis_transcoder.js', 'basis_transcoder.wasm', 'draco_decoder.js', 'draco_wasm_wrapper.js', 'draco_decoder.wasm']) write(root, 'packages/render-three/vendor/' + filename);
  write(root, 'modules/turismo/assets/texture.png'); write(root, 'modules/logistica-industrial/assets/material.jpg'); write(root, 'modules/logistica-industrial/assets/design.blend');
  write(root, 'packages/tools/ai/assets/model.onnx'); write(root, 'packages/tools/ai/assets/native-texture-ai-worker.js'); write(root, 'packages/tools/ai/assets/onnxruntime-1.30.0/ort.wasm.min.js'); write(root, 'packages/tools/ai/assets/onnxruntime-1.30.0/ort-wasm-simd-threaded.mjs'); write(root, 'packages/tools/ai/assets/LICENSE'); write(root, 'packages/tools/editor/assets/editor.png');
  write(root, 'projects/smarttwin/branding/icon.png'); write(root, 'projects/smarttwin/previews/vr-robot-dispatch.png');
  write(root, 'projects/smarttwin/scenes/vr-robot-dispatch.json', JSON.stringify({project: {publicSceneId: 'vr-robot-dispatch', document: {rooms: {hall: {}}}}}));
  write(root, 'projects/smarttwin/scenes/private-training.json', JSON.stringify({project: {publicSceneId: 'private-training', document: {private: true}}}));
  write(root, 'projects/smarttwin/scenes/catalog.json', JSON.stringify({scenes: [{id: 'vr-robot-dispatch', public: true, revision: 1, name: 'Compact demo', unexpectedSecret: 'catalog-extra'}, {id: 'private-training', public: true}], privateAdminField: 'not public'}));
  // Sensitive siblings and unapproved code must never become static files.
  for (const name of ['server/secret.js', 'apps/api/server/secret.js', 'data/studio.sqlite', 'tests/private.css', 'packages/render-three/tests/test.css', '.env', 'notes.txt', 'packages/render-three/src/Secret.js', 'packages/tools/ai/assets/unapproved-source.js', 'modules/turismo/assets/texture.png.map', 'modules/turismo/assets/data/private.json']) write(root, name, 'SENSITIVE ' + name);
  return root;
}

test('three artifacts contain exact allowlisted files, SHA receipts and only one public scenario', t => {
  const root = fixture(t), outputs = packageApps({root, revision: 'fixture-r1'}); assert.equal(outputs.length, 3);
  for (const output of outputs) {
    const manifest = JSON.parse(fs.readFileSync(path.join(output.directory, 'publication.json'), 'utf8')); assert.equal(manifest.format, FORMAT); assert.equal(manifest.version, 1); assert.equal(manifest.revision, 'fixture-r1');
    assert.deepEqual(walk(output.directory), manifest.files.map(file => file.path).concat('publication.json').sort());
    for (const file of manifest.files) { assert.equal(file.sha256, sha(fs.readFileSync(path.join(output.directory, file.path)))); assert.doesNotMatch(file.path, /(?:^|\/)(?:server|data|tests)(?:\/|$)|\.map$|\.sqlite$|\.env$/); }
    assert.equal(manifest.bundleSha256, manifest.files.find(file => file.path === compiled[output.application][0]).sha256);
  }
  const publicBuild = outputs.find(output => output.application === 'public-viewer'); assert.deepEqual(publicBuild.manifest.scenes, ['vr-robot-dispatch']);
  assert.deepEqual(publicBuild.manifest.files.map(file => file.path), ['config.js', 'cover.jpg', 'index.html', 'projects/smarttwin/previews/vr-robot-dispatch.png', 'projects/smarttwin/scenes/catalog.json', 'projects/smarttwin/scenes/vr-robot-dispatch.json', 'viewer.css', 'viewer.js','packages/voice-assistant/voice-assistant.css',...['welcome','pickup','route','deposit','completed','safety'].map(id=>'packages/voice-assistant/assets/'+id+'.wav')].sort());
  const catalog = JSON.parse(fs.readFileSync(path.join(publicBuild.directory, 'projects/smarttwin/scenes/catalog.json'))); assert.equal(catalog.scenes.length, 1); assert.equal(catalog.scenes[0].unexpectedSecret, undefined); assert.equal(catalog.privateAdminField, undefined); assert.equal(catalog.maxActive, 1);
  const empty = outputs.find(output => output.application === 'core-empty'); assert.deepEqual(empty.manifest.files.map(file => file.path), ['core-empty.js', 'core.css', 'index.html']); assert.deepEqual(empty.manifest.scenes, []);
  const workspace = outputs.find(output => output.application === 'workspace'); assert.deepEqual(workspace.manifest.scenes, ['private-training', 'vr-robot-dispatch']); const names = workspace.manifest.files.map(file => file.path);
  assert.ok(names.includes('packages/tools/ai/assets/native-texture-ai-worker.js')); assert.ok(names.includes('modules/logistica-industrial/assets/design.blend')); assert.ok(names.includes('packages/render-three/src/StartupStatus.js')); assert.equal(names.includes('packages/tools/ai/assets/unapproved-source.js'), false); assert.equal(names.includes('packages/render-three/src/Secret.js'), false);
  assert.equal(names.includes('apps/public-viewer/viewer.css'), false, 'Workspace must not collect another application and its relative media.');
});

test('publication manifests are accepted by the actual API artifact reader without opening a server', t => {
  const root = fixture(t), outputs = packageApps({root, revision: 'fixture-api'});
  const {artifact} = require('../../apps/api/index.cjs');
  for (const output of outputs) { const build = artifact(output.directory, output.application === 'public-viewer'); assert.equal(build.files.has('index.html'), true); assert.equal(build.manifest.bundleSha256, output.manifest.bundleSha256); }
});

test('repackaging is deterministic and removes only owned generated maps, never source/sibling files', t => {
  const root = fixture(t); const first = packageApps({root, revision: 'fixture-stable'}), second = packageApps({root, revision: 'fixture-stable'});
  assert.deepEqual(first.map(value => value.manifest), second.map(value => value.manifest)); assert.deepEqual(fs.readdirSync(path.join(root, 'artifacts')).sort(), ['core-empty', 'public-viewer', 'workspace']); assert.match(fs.readFileSync(path.join(root, 'data/studio.sqlite'), 'utf8'), /^SENSITIVE/); assert.match(fs.readFileSync(path.join(root, 'apps/api/server/secret.js'), 'utf8'), /^SENSITIVE/); assert.equal(fs.existsSync(path.join(root, 'artifacts/workspace/bundle.js.map')), false);
});

test('missing required StartupStatus or referenced HTML/CSS resources fails before modifying any output', t => {
  const root = fixture(t), original = fs.readFileSync(path.join(root, 'artifacts/workspace/bundle.js'));
  fs.unlinkSync(path.join(root, 'packages/render-three/src/StartupStatus.js')); assert.throws(() => packageApps({root, revision: 'fixture'}), {code: 'missing_input'}); assert.deepEqual(fs.readFileSync(path.join(root, 'artifacts/workspace/bundle.js')), original);
  write(root, 'packages/render-three/src/StartupStatus.js'); fs.unlinkSync(path.join(root, 'packages/render-three/src/workspace.css')); assert.throws(() => packageApps({root, revision: 'fixture'}), {code: 'missing_startup'}); assert.equal(fs.existsSync(path.join(root, 'artifacts/public-viewer/publication.json')), false);
  write(root, 'packages/render-three/src/workspace.css', '.missing{background:url("missing.png")}'); assert.throws(() => packageApps({root, revision: 'fixture'}), {code: 'missing_startup'});
});

test('wrong root URLs and external startup scripts cannot silently produce a broken/private artifact', t => {
  const root = fixture(t); write(root, 'apps/workspace/index.html', '<base href="/workspace/"><script src="/bundle.js"></script>'); assert.throws(() => packageApps({root, revision: 'fixture'}), {code: 'startup_mount'});
  write(root, 'apps/workspace/index.html', '<base href="./"><script src="bundle.js"></script>'); assert.throws(() => packageApps({root, revision: 'fixture'}), {code: 'startup_mount'});
  write(root, 'apps/workspace/index.html', '<script src="https://tracking.invalid/collect.js"></script>'); assert.throws(() => packageApps({root, revision: 'fixture'}), {code: 'external_startup'});
});

test('a symlink or junction in a declared input cannot publish files from another tree', t => {
  const root = fixture(t), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'smarttwin-packaging-outside-')), link = path.join(root, 'modules/turismo/assets/escaped');
  fs.writeFileSync(path.join(outside, 'secret.json'), 'PRIVATE OUTSIDE'); fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.throws(() => packageApps({root, revision: 'fixture'}), {code: 'symlink_input'}); assert.equal(fs.readFileSync(path.join(outside, 'secret.json'), 'utf8'), 'PRIVATE OUTSIDE'); }
  finally { fs.unlinkSync(link); const resolved = fs.realpathSync(outside); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('smarttwin-packaging-outside-')); fs.rmSync(resolved, {recursive: true}); }
});

test('unknown user files in an output directory are preserved and block replacement', t => {
  const root = fixture(t); write(root, 'artifacts/workspace/user-notes.txt', 'USER CONTENT'); assert.throws(() => packageApps({root, revision: 'fixture'}), {code: 'unsafe_output'}); assert.equal(fs.readFileSync(path.join(root, 'artifacts/workspace/user-notes.txt'), 'utf8'), 'USER CONTENT'); assert.equal(fs.existsSync(path.join(root, 'artifacts/public-viewer/publication.json')), false);
});

test('a symlinked output is rejected without deleting or changing its destination', t => {
  const root = fixture(t), output = path.join(root, 'artifacts/public-viewer'), original = path.join(root, 'compiled-public'); fs.renameSync(output, original); fs.symlinkSync(original, output, process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.throws(() => packageApps({root, revision: 'fixture'}), {code: 'symlink_input'}); assert.equal(fs.existsSync(path.join(original, 'viewer.js')), true); }
  finally { fs.unlinkSync(output); }
});

test('workspace chunks require exact successful compiler attestation and retain origin/SHA in publication', t => {
  const root = fixture(t), chunk = '1.bundle.js'; write(root, 'artifacts/workspace/' + chunk, 'compiled selected storage chunk');
  // Without stats, even a plausible chunk filename remains an unknown user file.
  assert.throws(() => packageApps({root, revision: 'fixture-chunks'}), {code: 'unsafe_output'});
  const stats = {errors: [], children: [{name: 'public-viewer', hash: '00000000000000000000', errors: [], assets: [{name: 'public-extra.js', size: 12}]}, {name: 'workspace', hash: '1234567890abcdef1234', errors: [], assets: ['bundle.js', chunk].map(name => ({name, size: fs.statSync(path.join(root, 'artifacts/workspace', name)).size}))}]};
  const statsBytes = JSON.stringify(stats); write(root, 'data/build/webpack-stats.json', statsBytes);
  const outputs = packageApps({root, revision: 'fixture-chunks'}), workspace = outputs.find(value => value.application === 'workspace'), entry = workspace.manifest.files.find(value => value.path === chunk);
  assert.equal(entry.sha256, sha(fs.readFileSync(path.join(workspace.directory, chunk)))); assert.equal(workspace.manifest.compilation.compiler, 'workspace'); assert.equal(workspace.manifest.compilation.statsSha256, sha(statsBytes)); assert.equal(workspace.manifest.compilation.hash, stats.children[1].hash); assert.equal(outputs[0].manifest.files.some(value => value.path === chunk || value.path === 'public-extra.js'), false);
  const {artifact} = require('../../apps/api/index.cjs'); assert.equal(artifact(workspace.directory, false).files.get(chunk), entry.sha256);
  write(root, 'artifacts/workspace/2.bundle.js', 'next successful lazy chunk'); stats.children[1].assets.push({name: '2.bundle.js', size: fs.statSync(path.join(root, 'artifacts/workspace/2.bundle.js')).size}); write(root, 'data/build/webpack-stats.json', JSON.stringify(stats));
  const rebuilt = packageApps({root, revision: 'fixture-next'}).find(value => value.application === 'workspace'); assert.ok(rebuilt.manifest.files.some(value => value.path === '2.bundle.js'));
  // No wildcard escape, cross-compiler inheritance or stale-size attestation.
  const before = fs.readFileSync(path.join(workspace.directory, 'publication.json'));
  stats.children[1].assets[1].size++; write(root, 'data/build/webpack-stats.json', JSON.stringify(stats)); assert.throws(() => packageApps({root, revision: 'fixture-chunks'}), {code: 'compiled_size_mismatch'});
  stats.children[1].assets[1].name = '../secret.js'; write(root, 'data/build/webpack-stats.json', JSON.stringify(stats)); assert.throws(() => packageApps({root, revision: 'fixture-chunks'}), {code: 'invalid_compiled_asset'}); assert.deepEqual(fs.readFileSync(path.join(workspace.directory, 'publication.json')), before);
});
