import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {REPOSITORY, checkedPath, resolveProjectComposition, writeProjectComposition} from '../modules/discover.mjs';

const require = createRequire(import.meta.url), slash = value => value.split(path.sep).join('/');
const digest = value => createHash('sha256').update(value).digest('hex');
const within = (base, file) => file !== base && !path.relative(base, file).startsWith('..') && !path.isAbsolute(path.relative(base, file));
const fail = (code, message) => {throw Object.assign(new Error(message), {code});};
function ensureDirectory(root, relative) {
  const parts = relative.split('/');
  for (let index = 1; index <= parts.length; index++) {
    const name = parts.slice(0, index).join('/'), present = checkedPath(root, name, {missing: true});
    if (!present) fs.mkdirSync(path.join(root, name)); else if (!fs.statSync(present).isDirectory()) fail('project_output', 'A build directory is not a directory.');
  }
  return checkedPath(root, relative);
}

export function selectedAssetPlan(root, functions) {
  const result = [], names = new Set(); let total = 0;
  for (const entry of functions) {
    const assets = entry.metadata.assets || [];
    if (!Array.isArray(assets) || assets.length > 256) fail('project_assets', 'A function needs a bounded asset allowlist.');
    for (const asset of assets) {
      if (typeof asset !== 'string' || asset.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.') || ['server','private','tests','test','data','node_modules'].includes(part.toLowerCase())) || /[\\:%?#\0]/.test(asset) || !/\.(?:png|jpe?g|webp|svg|json|glb|gltf|bin|ogg|mp3|wav|woff2)$/i.test(asset)) fail('project_assets', 'Only explicit local data/media assets inside a selected function can be packaged.');
      const source = entry.packageDirectory + '/' + asset, filename = checkedPath(root, source), stat = fs.statSync(filename);
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || (total += stat.size) > 128 * 1024 * 1024) fail('project_assets', 'Selected assets exceed the publication budget.');
      if (!names.has(source)) {names.add(source); result.push({functionId: entry.id, source, filename, path: source});}
    }
  }
  return result;
}

export function compilationFiles(stats) {
  const files = new Set();
  const visit = modules => {for (const module of modules || []) {
    const identifier = module.identifier || '', filename = identifier.split('!').pop().split('?')[0];
    if (path.isAbsolute(filename) && fs.existsSync(filename) && fs.statSync(filename).isFile()) files.add(path.normalize(filename)); if (module.modules) visit(module.modules);
  }};
  visit(stats.modules); return [...files];
}

export function validateCompilationClosure({root, generated, functions, stats}) {
  const allowed = ['packages/core','packages/contracts','packages/module-sdk','packages/render-three','apps/project-viewer'].map(name => path.join(root, name))
    .concat(generated.output, functions.map(entry => path.join(root, entry.packageDirectory)));
  const files = compilationFiles(stats);
  for (const filename of files) {
    if (slash(filename).includes('/node_modules/')) continue;
    if (!allowed.some(directory => within(directory, filename))) fail('project_dependency', 'The selected project imports an unselected package: ' + slash(path.relative(root, filename)));
    const owner = functions.find(entry => within(path.join(root, entry.packageDirectory), filename));
    if (owner) {
      const relative = slash(path.relative(path.join(root, owner.packageDirectory), filename));
      if (!Array.isArray(owner.metadata.files) || !owner.metadata.files.includes(relative)) fail('project_dependency', `Function ${owner.id} imports an undeclared package file: ${relative}. Add it to metadata.files before building or copying the function.`);
      checkedPath(root, slash(path.relative(root, filename)));
    }
  }
  return files.filter(filename => within(root, filename)).map(filename => slash(path.relative(root, filename))).sort();
}

/** Build one validated local project. Each result has a new immutable output
 * directory; existing apps and prior project publications are never replaced. */
export function buildProject({root = REPOSITORY, projectPath, name} = {}) {
  root = fs.realpathSync(path.resolve(root));
  if (typeof projectPath !== 'string') fail('project_usage', 'Pass --project projects/agricultura/project.json.');
  const resolved = resolveProjectComposition({root, projectPath});
  const base = name || path.basename(path.dirname(projectPath));
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(base)) fail('project_name', 'Use a short lowercase project name.');
  for (const entry of resolved.functions) for (const capability of entry.capabilities) if (capability !== 'platform.scene') fail('project_capability', 'The generic browser has no adapter for ' + capability + '; select a compatible function or an application-specific adapter.');
  const assets = selectedAssetPlan(root, resolved.functions), projectHash = digest(JSON.stringify(resolved.project));
  const buildName = base + '-' + projectHash.slice(0, 8) + '-' + randomUUID().slice(0, 8), generated = writeProjectComposition({root, projectPath, name: buildName});
  const staged = ensureDirectory(root, slash(path.relative(root, generated.output)) + '/site');
  const importPath = filename => {const relative = slash(path.relative(generated.output, filename)); return relative.startsWith('.') ? relative : './' + relative;};
  const entry = path.join(generated.output, 'browser.mjs');
  fs.writeFileSync(entry, `import {createComposedHost,createComposedSession,project,missing} from './bootstrap.mjs';\nimport {mountProject} from ${JSON.stringify(importPath(path.join(root, 'apps/project-viewer/boot.js')))};\nmountProject({createComposedHost,createComposedSession,project,missing}).catch(error=>{document.getElementById('status').textContent=error.message;console.error(error);});\n`);
  const config = path.join(generated.output, 'webpack.cjs'), webpackModule = require.resolve('webpack');
  const settings = {name: buildName, mode: 'production', target: 'web', context: root, entry, output: {filename: 'project.js', path: staged, publicPath: '', globalObject: 'self'}, devtool: false,
    module: {rules: [{test: {regex: '[\\\\/]three[\\\\/]build[\\\\/]three(?:\\.module)?\\.js$'}, use: {loader: path.join(root, 'tooling/build/loaders/three-r112-instancing.js')}},
      {test: {regex: '\\.(js|mjs)$'}, exclude: {regex: 'node_modules'}, use: {loader: require.resolve('babel-loader'), options: {babelrc: false, configFile: false, parserOpts: {plugins: ['dynamicImport','objectRestSpread','classProperties']}}}}]},
    resolve: {extensions: ['.mjs','.js','.json'], alias: {'three$': path.join(root, 'node_modules/three/build/three.module.js')}}, optimization: {splitChunks: false, runtimeChunk: false}, performance: {hints: false}};
  fs.writeFileSync(config, `const webpack=require(${JSON.stringify(webpackModule)});\nconst config=${JSON.stringify(settings)};\nconfig.module.rules.forEach(rule=>{rule.test=new RegExp(rule.test.regex);if(rule.exclude)rule.exclude=new RegExp(rule.exclude.regex);});\nconfig.plugins=[new webpack.optimize.LimitChunkCountPlugin({maxChunks:1})];\nmodule.exports=config;\n`);
  const flags = Number(process.versions.node.split('.')[0]) >= 17 ? ['--openssl-legacy-provider'] : [];
  const built = spawnSync(process.execPath, [...flags, require.resolve('webpack/bin/webpack.js'), '--config', config, '--json'], {cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true});
  fs.writeFileSync(path.join(generated.output, 'webpack-stats.json'), built.stdout || '');
  if (built.error || built.status !== 0) fail('project_compile', built.error ? built.error.message : (built.stderr || built.stdout || 'Webpack failed.').slice(-4000));
  const stats = JSON.parse(built.stdout); if (!Array.isArray(stats.errors) || stats.errors.length) fail('project_compile', 'The project compilation has errors.');
  const graph = validateCompilationClosure({root, generated, functions: resolved.functions, stats});
  if (!Array.isArray(stats.assets) || stats.assets.length !== 1 || stats.assets[0].name !== 'project.js') fail('project_compile', 'The project must emit exactly its selected browser bundle.');
  const files = [];
  const add = (relative, bytes) => {
    const destination = path.resolve(staged, relative); if (!within(staged, destination)) fail('project_output', 'A publication path escapes its staging directory.');
    fs.mkdirSync(path.dirname(destination), {recursive: true}); fs.writeFileSync(destination, bytes); files.push({path: relative, size: bytes.length, sha256: digest(bytes)});
  };
  const bundle = fs.readFileSync(path.join(staged, 'project.js')); files.push({path: 'project.js', size: bundle.length, sha256: digest(bundle)});
  add('index.html', fs.readFileSync(checkedPath(root, 'apps/project-viewer/index.html')));
  add('viewer.css', fs.readFileSync(checkedPath(root, 'apps/project-viewer/viewer.css')));
  add('modules.css', fs.readFileSync(checkedPath(root, 'apps/project-viewer/modules.css')));
  for (const asset of assets) add(asset.path, fs.readFileSync(asset.filename));
  const manifest = {format: 'smarttwin.project-publication', version: 1, application: 'project-viewer', worldId: resolved.project.worldId,
    projectSha256: projectHash, bundleSha256: digest(bundle), selections: generated.composition.selections, functions: generated.composition.functions,
    manifestSources: generated.composition.manifests, files: files.sort((a,b) => a.path.localeCompare(b.path)), referenceScene: true, statePersistence: 'memory'};
  fs.writeFileSync(path.join(staged, 'publication.json'), JSON.stringify(manifest, null, 2));
  const parent = ensureDirectory(root, 'artifacts/projects'), output = path.join(parent, buildName);
  if (!within(root, staged) || !within(parent, output) || fs.existsSync(output)) fail('project_output', 'Invalid immutable project publication target.');
  // Both absolute directory targets were verified inside this repository.
  fs.renameSync(staged, output);
  const receipt = {output, generated: generated.output, bundleSha256: manifest.bundleSha256, functions: manifest.functions.map(entry => entry.id), graph, files: manifest.files};
  fs.writeFileSync(path.join(generated.output, 'browser-build.json'), JSON.stringify(receipt, null, 2)); return receipt;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = key => {const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1];};
  try {console.log(JSON.stringify(buildProject({projectPath: arg('--project'), name: arg('--name')}), null, 2));}
  catch (error) {console.error(error.code + ': ' + error.message); process.exitCode = 1;}
}
