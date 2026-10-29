const __layout = require("../layout.cjs");
'use strict';
// Explicit legacy 2/all-example publication regression profile. Production uses
// artifacts/public-viewer and tooling/build/package-apps.cjs instead.
// Never archive the repository root: it can contain live SQLite/user files.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {SCENES} = require('../../projects/smarttwin/public-scenes');
const FILES = [['index.html', 'apps/workspace/index.html'], ...['bundle.js', 'mesh-optimizer-worker.js', 'collision-worker.js', 'cad-worker.js'].map(name => [name, 'artifacts/workspace/' + name]), ['.nojekyll', '.nojekyll'], ['LICENSE', 'LICENSE']];
// Three.js loads these decoder files at runtime; they are not webpack imports.
const DIRECTORIES = ['modules/turismo/assets', 'modules/logistica-industrial/assets', 'packages/tools/ai/assets', 'packages/tools/editor/assets', 'projects/smarttwin/branding', 'projects/smarttwin/scenes', 'packages/render-three/vendor'];
const DECODERS = ['basis_transcoder.js', 'basis_transcoder.wasm', 'draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'];
const forbidden = name => name.startsWith('.') && name !== '.nojekyll' || /^(?:data|server|tests|node_modules)$/i.test(name) || /\.(?:pem|key|p12|pfx|sqlite(?:3)?|db|log)(?:-[\w]+)?$/i.test(name);

function safeOutput(root, output) {
  const target = __layout.map(path.resolve(output || __layout.map(path.join(root, 'data/pages-site'))));
  if (target !== __layout.map(path.join(root, 'data/pages-site'))) throw new Error('La publicación sólo puede escribirse en data/pages-site dentro de este proyecto.');
  // Check every existing component before the one bounded recursive removal.
  for (const value of [__layout.map(path.join(root, 'data')), target]) {
    let stat;
    try { stat = fs.lstatSync(value); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new Error('La carpeta de publicación debe ser un directorio real del proyecto.');
  }
  return target;
}
function prepare(options = {}) {
  const root = fs.realpathSync(options.root || __layout.map(path.resolve(__layout.oldDir("scripts/prepare-pages-site.js"), '..')));
  const catalog = JSON.parse(fs.readFileSync(__layout.map(path.join(root, "projects/smarttwin/scenes/catalog.json")), 'utf8'));
  const scenes = catalog.scenes;
  if (!Array.isArray(scenes) || !scenes.length || scenes.length > 64 || new Set(scenes.map(scene => scene.id)).size !== scenes.length || scenes.some(scene => !/^[a-z0-9-]{1,80}$/.test(scene.id))) throw new Error('El catálogo de ejemplos incluidos no es válido.');
  if (!catalog.previewAllExamples && JSON.stringify(scenes.map(scene => scene.id)) !== JSON.stringify(SCENES.map(scene => scene.id))) throw new Error('La publicación restringida sólo permite dos escenarios públicos.');
  const output = safeOutput(root, options.output), plan = [], added = new Set();
  function add(relative, source = relative) {
    if (added.has(relative)) return;
    const absolute = path.join(root, source), stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('No se publican enlaces simbólicos: ' + relative);
    if (forbidden(path.basename(relative))) throw new Error('Archivo no publicable en recursos estáticos: ' + relative);
    if (!stat.isFile()) throw new Error('Falta un archivo estático: ' + relative);
    plan.push({relative, absolute, size: stat.size}); added.add(relative);
  }
  function walk(relative, accept = () => true, skipPrivate = false) {
    const absolute = path.join(root, relative), stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Los recursos deben pertenecer al proyecto: ' + relative);
    for (const item of fs.readdirSync(absolute, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(relative, item.name);
      if (item.isSymbolicLink()) throw new Error('No se publican enlaces simbólicos: ' + child);
      if (item.isDirectory()) { if (forbidden(item.name)) {if (skipPrivate) continue; throw new Error('Carpeta no publicable: ' + child);} walk(child, accept, skipPrivate); }
      else if (accept(child)) add(child);
    }
  }
  FILES.forEach(([relative, source]) => add(relative, source)); DIRECTORIES.forEach(directory => walk(directory));
  if (fs.existsSync(path.join(root, 'projects/smarttwin/previews'))) walk('projects/smarttwin/previews');
  for (const folder of ['packages', 'modules', 'apps']) walk(folder, file => file.endsWith('.css'), true);
  add('packages/render-three/src/StartupStatus.js');
  const available = new Set(plan.map(item => item.relative.split(path.sep).join('/')));
  const html = fs.readFileSync(path.join(root, 'apps/workspace/index.html'), 'utf8');
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1];
    if (/^(?:[a-z]+:|#|\/\/)/i.test(value) || value === './') continue;
    const relative = value.split(/[?#]/)[0].replace(/^\.\//, '');
    if (relative.startsWith('/') || !available.has(relative)) throw new Error('El HTML referencia un recurso fuera de la publicación: ' + value);
  }
  for (const file of ["packages/render-three/src/StartupStatus.js", ...DECODERS.map(file => "packages/render-three/vendor/" + file), "modules/logistica-industrial/assets/materials/ai-industrial-concrete-v1-512.jpg", "packages/tools/ai/assets/native-texture-ai-worker.js", "projects/smarttwin/scenes/catalog.json", ...scenes.map(scene => "projects/smarttwin/scenes/" + scene.id + '.json')]) {
    if (!available.has(file)) throw new Error('Falta un recurso necesario para publicar: ' + file);
  }
  const published = fs.readdirSync(path.join(root, 'projects/smarttwin/scenes')).sort();
  if (JSON.stringify(published) !== JSON.stringify(['catalog.json', ...scenes.map(scene => scene.id + '.json')].sort())) throw new Error('La copia estática sólo incluye los escenarios públicos declarados.');
  for (const scene of scenes) {
    const project = JSON.parse(fs.readFileSync(path.join(root, 'projects/smarttwin/scenes', scene.id + '.json'), 'utf8')).project;
    if (!project || project.publicSceneId !== scene.id || project.access.canEdit !== false || JSON.stringify(Object.keys(project.document.rooms)) !== JSON.stringify([scene.roomId]) || (project.document.imports || []).length) throw new Error('La proyección pública no es válida: ' + scene.id);
  }
  // All inputs/output boundaries are checked before replacing the old artifact.
  if (fs.existsSync(output)) fs.rmSync(output, {recursive: true});
  fs.mkdirSync(output, {recursive: true});
  for (const item of plan) {
    const destination = __layout.map(path.join(output, item.relative)); fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(item.absolute, destination); // Copies, never tar hard links.
  }
  const rawRevision = options.revision || process.env.GITHUB_SHA || '';
  const publication = {format: 'hello-webxr-publication', version: 1, revision: /^[a-f0-9]{40}$/i.test(rawRevision) ? rawRevision : null,
    bundleSha256: crypto.createHash('sha256').update(fs.readFileSync(__layout.map(path.join(output, "bundle.js")))).digest('hex'), previewAllExamples: catalog.previewAllExamples === true, scenes: scenes.map(scene => scene.id),
    catalogSha256: crypto.createHash('sha256').update(fs.readFileSync(__layout.map(path.join(output, "projects/smarttwin/scenes/catalog.json")))).digest('hex'),
    projectionSha256: Object.fromEntries(scenes.map(scene => [scene.id, crypto.createHash('sha256').update(fs.readFileSync(path.join(output, 'projects/smarttwin/scenes', scene.id + '.json'))).digest('hex')]))};
  fs.writeFileSync(__layout.map(path.join(output, 'publication.json')), JSON.stringify(publication, null, 2) + '\n');
  return {output, files: plan.length + 1, bytes: plan.reduce((sum, item) => sum + item.size, 0), publication};
}
if (require.main === module) {
  const result = prepare(); console.log('Publicación estática: ' + result.files + ' archivos · ' + (result.bytes / 1048576).toFixed(1) + ' MiB · ' + result.publication.bundleSha256);
}
module.exports = {prepare, safeOutput};
