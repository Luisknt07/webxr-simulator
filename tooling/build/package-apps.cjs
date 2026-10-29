'use strict';
// Production publication is an explicit file plan, never a copy of the repo.
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const FORMAT = 'smarttwin.publication', PUBLIC_SCENE = 'vr-robot-dispatch';
const PROFILES = ['public-viewer', 'core-empty', 'workspace'];
const ASSET_ROOTS = ['modules/turismo/assets', 'modules/logistica-industrial/assets', 'packages/tools/ai/assets', 'packages/tools/editor/assets', 'projects/smarttwin/branding', 'projects/smarttwin/scenes', 'projects/smarttwin/previews'];
const VENDOR_FILES = ['basis_transcoder.js', 'basis_transcoder.wasm', 'draco_decoder.js', 'draco_wasm_wrapper.js', 'draco_decoder.wasm'].map(file => 'packages/render-three/vendor/' + file);
const ASSET_CODE = new Set(['packages/tools/ai/assets/native-texture-ai-worker.js', 'packages/tools/ai/assets/onnxruntime-1.30.0/ort.wasm.min.js', 'packages/tools/ai/assets/onnxruntime-1.30.0/ort-wasm-simd-threaded.mjs']);
const COMPILED = {'public-viewer': ['viewer.js'], 'core-empty': ['core-empty.js'], workspace: ['bundle.js', 'mesh-optimizer-worker.js', 'collision-worker.js', 'cad-worker.js']};
const PRIVATE_SEGMENTS = new Set(['server', 'data', 'tests', 'test', 'node_modules', '.git', '.codex', '.agents']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const posix = value => value.split(path.sep).join('/');
const within = (base, target) => target !== base && !path.relative(base, target).startsWith('..') && !path.isAbsolute(path.relative(base, target));
function error(code, message) { const value = new Error(message); value.code = code; throw value; }
function relative(value) { if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.includes('%') || value.includes('\0') || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) error('unsafe_path', 'Invalid publication path: ' + value); return value; }
function safePath(root, name, required = true) {
  relative(name); let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part); let stat;
    try { stat = fs.lstatSync(current); } catch (failure) { if (!required && failure.code === 'ENOENT') return null; error('missing_input', 'Required publication input is missing: ' + name); }
    if (stat.isSymbolicLink()) error('symlink_input', 'Publication inputs and outputs cannot contain links: ' + name);
  }
  const resolved = fs.realpathSync(current); if (!within(root, resolved)) error('unsafe_path', 'Publication input escapes its root: ' + name); return resolved;
}
function read(root, name) { const filename = safePath(root, name), stat = fs.statSync(filename); if (!stat.isFile() || stat.size > 512 * 1024 * 1024) error('invalid_input', 'Publication input must be a bounded regular file: ' + name); return fs.readFileSync(filename); }
function allowedAsset(name) {
  const parts = name.split('/'); if (parts.some(part => part.startsWith('.') || PRIVATE_SEGMENTS.has(part.toLowerCase()))) return false;
  if (/\.map(?:\.|$)/i.test(name) || /\.(?:sqlite\d*|db|pem|key|pfx|p12)(?:-|$)/i.test(name)) return false;
  if (/\.(?:js|mjs|cjs)$/i.test(name)) return ASSET_CODE.has(name);
  return true;
}
function walk(root, folder, callback, {skipPrivate = false} = {}) {
  const directory = safePath(root, folder); if (!fs.statSync(directory).isDirectory()) error('invalid_input', 'Expected an asset directory: ' + folder);
  for (const name of fs.readdirSync(directory).sort()) {
    if (skipPrivate && (name.startsWith('.') || PRIVATE_SEGMENTS.has(name.toLowerCase()))) continue;
    const local = folder + '/' + name, filename = safePath(root, local), stat = fs.statSync(filename);
    if (stat.isDirectory()) walk(root, local, callback, {skipPrivate}); else if (stat.isFile()) callback(local, stat); else error('invalid_input', 'Unsupported publication file: ' + local);
  }
}
function workspaceCompilation(root) {
  const filename = 'data/build/webpack-stats.json'; if (!safePath(root, filename, false)) return null;
  const bytes = read(root, filename); if (bytes.length > 40 * 1024 * 1024) error('invalid_stats', 'Webpack stats exceed the build metadata limit.');
  let stats; try { stats = JSON.parse(bytes); } catch (_) { error('invalid_stats', 'Webpack stats must be valid JSON.'); }
  if (!stats || !Array.isArray(stats.children) || stats.children.length > 16 || !Array.isArray(stats.errors) || stats.errors.length) error('invalid_stats', 'Use successful multi-compiler webpack stats.');
  const matches = stats.children.filter(child => child && child.name === 'workspace');
  if (matches.length !== 1 || !Array.isArray(matches[0].errors) || matches[0].errors.length || !Array.isArray(matches[0].assets) || matches[0].assets.length > 1024 || !/^[a-f0-9]{8,128}$/i.test(matches[0].hash || '')) error('invalid_stats', 'Webpack stats must identify one successful workspace compiler.');
  const compilation = matches[0], names = new Set(), assets = [];
  for (const asset of compilation.assets) {
    if (!asset || typeof asset.name !== 'string') error('invalid_stats', 'Invalid webpack asset metadata.');
    if (!asset.name.endsWith('.js')) continue;
    // Only exact basenames attested by this compiler may expand the JS allowlist.
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}\.js$/.test(asset.name) || asset.name.includes('..') || names.has(asset.name) || !Number.isSafeInteger(asset.size) || asset.size < 0) error('invalid_compiled_asset', 'Webpack assets must be distinct bounded JS basenames.');
    names.add(asset.name); const source = 'artifacts/workspace/' + asset.name, resolved = safePath(root, source), stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size !== asset.size) error('compiled_size_mismatch', 'A compiled asset differs from its webpack size: ' + asset.name);
    assets.push({path: asset.name, size: asset.size});
  }
  if (!names.has('bundle.js')) error('invalid_stats', 'Workspace stats must attest its primary bundle.');
  return {compiler: 'workspace', hash: compilation.hash, statsSha256: digest(bytes), assets: assets.sort((a, b) => a.path.localeCompare(b.path))};
}
function makePlan(root, application, compilation) {
  const files = new Map(), add = (output, source, bytes) => {
    relative(output); if (files.has(output)) { if (files.get(output).source !== source) error('duplicate_output', 'Conflicting publication output: ' + output); return; }
    if (bytes === undefined) { const filename = safePath(root, source); if (!fs.statSync(filename).isFile()) error('invalid_input', 'Missing publication file: ' + source); }
    files.set(output, {source, bytes});
  };
  COMPILED[application].forEach(name => add(name, 'artifacts/' + application + '/' + name));
  if (application === 'workspace' && compilation) compilation.assets.forEach(asset => add(asset.path, 'artifacts/workspace/' + asset.path));
  add('index.html', 'apps/' + application + '/index.html');
  let scenes = [];
  if (application === 'public-viewer') {
    add('viewer.css', 'apps/public-viewer/viewer.css'); add('config.js', 'apps/public-viewer/config.js');
    const scenePath = 'projects/smarttwin/scenes/' + PUBLIC_SCENE + '.json';
    const scene = JSON.parse(read(root, scenePath)); if (!scene.project || scene.project.publicSceneId !== PUBLIC_SCENE) error('invalid_public_scene', 'The public scene must identify vr-robot-dispatch.');
    add(scenePath, scenePath);
    const catalog = JSON.parse(read(root, 'projects/smarttwin/scenes/catalog.json')), matches = Array.isArray(catalog.scenes) ? catalog.scenes.filter(item => item && item.id === PUBLIC_SCENE) : [];
    if (matches.length !== 1 || matches[0].public !== true) error('invalid_public_catalog', 'The public catalog must declare the selected public scene once.');
    const row = {}; for (const key of ['id', 'roomId', 'name', 'templateId', 'collection', 'difficulty', 'mode', 'projectId', 'revision', 'public', 'included']) if (Object.hasOwn(matches[0], key)) row[key] = matches[0][key];
    add('projects/smarttwin/scenes/catalog.json', null, Buffer.from(JSON.stringify({scenes: [row], maxActive: 1, requiresLogin: false, previewAllExamples: false, includedCount: 1}) + '\n'));
    scenes = [PUBLIC_SCENE];
  } else if (application === 'core-empty') add('core.css', 'apps/core-empty/core.css');
  else {
    ASSET_ROOTS.forEach(folder => walk(root, folder, name => { if (allowedAsset(name)) add(name, name); }, {skipPrivate: true}));
    for (const folder of ['packages', 'modules', 'apps']) walk(root, folder, name => { if (/\.css$/i.test(name) && allowedAsset(name)) add(name, name); }, {skipPrivate: true});
    add('packages/render-three/src/StartupStatus.js', 'packages/render-three/src/StartupStatus.js'); VENDOR_FILES.forEach(name => add(name, name));
    scenes = [...files.keys()].filter(name => /^projects\/smarttwin\/scenes\/[^/]+\.json$/.test(name) && !name.endsWith('/catalog.json')).map(name => path.posix.basename(name, '.json')).sort();
  }
  if (files.size > 20000) error('publication_limit', 'Too many publication files.');
  return {application, files, scenes, compilation: application === 'workspace' ? compilation : null};
}
function attributes(tag) { const result = {}; const expression = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g; let match; while ((match = expression.exec(tag))) result[match[1].toLowerCase()] = match[2] === undefined ? match[3] === undefined ? match[4] : match[3] : match[2]; return result; }
function verifyStartup(plan, getBytes) {
  const html = getBytes('index.html').toString('utf8'), mount = plan.application === 'workspace' ? '/workspace/' : '/', origin = 'https://build.invalid';
  // The API serves the private entry at /editor, while its resources live under
  // /workspace/. A legacy base="./" would silently request public-root files.
  const entryURL = origin + (plan.application === 'workspace' ? '/editor' : mount);
  const baseTag = /<base\b[^>]*>/i.exec(html), base = new URL(baseTag ? attributes(baseTag[0]).href || './' : './', entryURL);
  const check = (value, from) => {
    if (!value || value.startsWith('#') || /^(?:data|blob):/i.test(value)) return;
    const url = new URL(value.replace(/&amp;/g, '&'), from);
    if (url.origin !== origin) error('external_startup', 'Startup resources must be local: ' + value);
    if (!url.pathname.startsWith(mount)) error('startup_mount', 'Startup resource escapes the application mount: ' + value);
    let name; try { name = decodeURIComponent(url.pathname.slice(mount.length)); } catch (_) { error('unsafe_path', 'Invalid startup resource encoding.'); }
    relative(name); if (!plan.files.has(name)) error('missing_startup', 'Startup resource is absent from the allowlist: ' + name); return name;
  };
  const tags = html.match(/<(?:script|link|img|source)\b[^>]*>/gi) || [];
  const scripts = [];
  for (const tag of tags) {
    const attr = attributes(tag);
    if (/^<link/i.test(tag)) { if (/\b(?:stylesheet|icon|preload|modulepreload)\b/i.test(attr.rel || '')) check(attr.href, base); }
    else { const name = check(attr.src, base); if (/^<script/i.test(tag) && name) scripts.push(name); }
  }
  const primary = COMPILED[plan.application][0], requiredScripts = [primary];
  if (plan.application === 'public-viewer') requiredScripts.unshift('config.js');
  if (plan.application === 'workspace') requiredScripts.unshift('packages/render-three/src/StartupStatus.js');
  for (const name of requiredScripts) if (!scripts.includes(name)) error('missing_startup', 'The application HTML does not load its required script: ' + name);
  if (requiredScripts.length > 1 && scripts.indexOf(requiredScripts[0]) > scripts.indexOf(primary)) error('startup_order', 'Startup configuration/status must load before the application bundle.');
  for (const name of plan.files.keys()) if (/\.css$/i.test(name)) {
    const stylesheet = getBytes(name).toString('utf8'), expression = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/g; let match;
    while ((match = expression.exec(stylesheet))) check(match[1] || match[2] || match[3], new URL(mount + name, origin));
  }
}
function listDirectory(root, directory) { const result = []; walk(root, directory, name => result.push(name.slice(directory.length + 1))); return result.sort(); }
function verifyExisting(root, application, compilation) {
  const name = 'artifacts/' + application, directory = safePath(root, name, false); if (!directory) return;
  if (!fs.statSync(directory).isDirectory()) error('unsafe_output', 'The artifact output must be a directory.');
  const existing = listDirectory(root, name), manifestPath = name + '/publication.json';
  let owned;
  if (existing.includes('publication.json')) {
    const publication = JSON.parse(read(root, manifestPath));
    if (publication.format !== FORMAT || publication.version !== 1 || publication.application !== application || !Array.isArray(publication.files)) error('unsafe_output', 'Refusing to replace an artifact without a matching ownership manifest.');
    owned = new Set(publication.files.map(item => relative(item.path))); owned.add('publication.json');
  } else owned = new Set(COMPILED[application].flatMap(name => [name, name + '.map']));
  // A subsequent webpack build may add a new lazy chunk beside an older receipt.
  if (application === 'workspace' && compilation) compilation.assets.forEach(asset => owned.add(asset.path));
  for (const name of existing) if (!owned.has(name)) error('unsafe_output', 'Refusing to delete a file not owned by the build: ' + name);
}
function removeGenerated(root, directory) {
  const artifacts = safePath(root, 'artifacts'); const absolute = path.resolve(directory);
  if (path.dirname(absolute) !== artifacts || !path.basename(absolute).startsWith('.smarttwin-') || !within(root, absolute)) error('unsafe_output', 'Refusing an unbounded build cleanup.');
  if (!fs.existsSync(absolute)) return;
  // Recheck links immediately before the only recursive deletion in this tool.
  const relativeDirectory = posix(path.relative(root, absolute)); safePath(root, relativeDirectory); listDirectory(root, relativeDirectory);
  fs.rmSync(absolute, {recursive: true, force: false});
}
function revisionFor(root, supplied) {
  if (supplied !== undefined) { if (typeof supplied !== 'string' || !supplied || supplied.length > 160 || /[\u0000-\u001f]/.test(supplied)) error('invalid_revision', 'Invalid build revision.'); return supplied; }
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', windowsHide: true});
  if (result.status !== 0 || !/^[a-f0-9]{40,64}$/.test((result.stdout || '').trim())) error('missing_revision', 'Builds need a repository revision or an explicit fixture revision.'); return result.stdout.trim();
}
function packageApps(options = {}) {
  const root = fs.realpathSync(path.resolve(options.root || ROOT)); if (root === path.parse(root).root || !fs.statSync(root).isDirectory()) error('unsafe_root', 'Use a concrete application workspace.');
  const revision = revisionFor(root, options.revision), compilation = workspaceCompilation(root), plans = PROFILES.map(application => makePlan(root, application, compilation));
  plans.forEach(plan => { verifyExisting(root, plan.application, compilation); verifyStartup(plan, name => { const file = plan.files.get(name); return file.bytes === undefined ? read(root, file.source) : file.bytes; }); });
  const artifactsPath = path.join(root, 'artifacts'); if (!fs.existsSync(artifactsPath)) fs.mkdirSync(artifactsPath); const artifacts = safePath(root, 'artifacts');
  const stages = [], committed = []; let totalBytes = 0;
  try {
    for (const plan of plans) {
      const staging = path.join(artifacts, '.smarttwin-stage-' + plan.application + '-' + randomUUID()); fs.mkdirSync(staging); stages.push({plan, staging});
      const files = [];
      for (const name of [...plan.files.keys()].sort()) {
        const file = plan.files.get(name), bytes = file.bytes === undefined ? read(root, file.source) : file.bytes; totalBytes += bytes.length;
        if (totalBytes > 2 * 1024 * 1024 * 1024) error('publication_limit', 'Publication exceeds its bounded size.');
        const output = path.resolve(staging, ...name.split('/')); if (!within(staging, output)) error('unsafe_output', 'Invalid staged output.'); fs.mkdirSync(path.dirname(output), {recursive: true}); fs.writeFileSync(output, bytes, {flag: 'wx'}); files.push({path: name, sha256: digest(bytes)});
      }
      const primary = COMPILED[plan.application][0], bundle = files.find(file => file.path === primary);
      plan.manifest = {format: FORMAT, version: 1, application: plan.application, revision, bundleSha256: bundle.sha256, scenes: plan.scenes, files};
      if (plan.compilation) plan.manifest.compilation = plan.compilation;
      fs.writeFileSync(path.join(staging, 'publication.json'), JSON.stringify(plan.manifest, null, 2) + '\n', {flag: 'wx'});
    }
    for (const item of stages) {
      const destination = path.join(artifacts, item.plan.application), backup = fs.existsSync(destination) ? path.join(artifacts, '.smarttwin-backup-' + item.plan.application + '-' + randomUUID()) : null;
      verifyExisting(root, item.plan.application, compilation); if (backup) fs.renameSync(destination, backup);
      const entry = {destination, backup, installed: false}; committed.push(entry); fs.renameSync(item.staging, destination); entry.installed = true;
    }
  } catch (failure) {
    const rollback = [];
    for (const entry of committed.reverse()) try {
      if (entry.installed) { const rejected = path.join(artifacts, '.smarttwin-rejected-' + randomUUID()); fs.renameSync(entry.destination, rejected); removeGenerated(root, rejected); }
      if (entry.backup) fs.renameSync(entry.backup, entry.destination);
    } catch (error) { rollback.push(error); }
    for (const {staging} of stages) if (fs.existsSync(staging)) try { removeGenerated(root, staging); } catch (error) { rollback.push(error); }
    if (rollback.length) throw new AggregateError([failure, ...rollback], 'Packaging and rollback failed.'); throw failure;
  }
  for (const entry of committed) if (entry.backup) removeGenerated(root, entry.backup);
  return plans.map(plan => ({application: plan.application, directory: path.join(artifacts, plan.application), manifest: plan.manifest}));
}
module.exports = {packageApps, FORMAT, PUBLIC_SCENE, verifyStartup};
if (require.main === module) { try { const values = packageApps(); for (const value of values) console.log(value.application + ': ' + value.manifest.files.length + ' verified files, ' + value.manifest.bundleSha256); } catch (failure) { console.error(failure.message); process.exitCode = 1; } }
