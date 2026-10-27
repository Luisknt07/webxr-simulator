'use strict';
// Dependency-free publication of the already built, versioned application.
// Never archive the repository root: it can contain live SQLite/user files.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {SCENES} = require('../shared/public-scenes');
const FILES = ['index.html', 'bundle.js', 'mesh-optimizer-worker.js', 'collision-worker.js', 'cad-worker.js', '.nojekyll', 'LICENSE'];
// Three.js loads these decoder files at runtime; they are not webpack imports.
const DIRECTORIES = ['assets', 'res', 'src/vendor'];
const DECODERS = ['basis_transcoder.js', 'basis_transcoder.wasm', 'draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'];
const forbidden = name => name.startsWith('.') && name !== '.nojekyll' || /^(?:data|server|node_modules)$/i.test(name) || /\.(?:pem|key|p12|pfx|sqlite(?:3)?|db|log)(?:-[\w]+)?$/i.test(name);

function safeOutput(root, output) {
  const target = path.resolve(output || path.join(root, 'data/pages-site'));
  if (target !== path.join(root, 'data/pages-site')) throw new Error('La publicación sólo puede escribirse en data/pages-site dentro de este proyecto.');
  // Check every existing component before the one bounded recursive removal.
  for (const value of [path.join(root, 'data'), target]) {
    let stat;
    try { stat = fs.lstatSync(value); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new Error('La carpeta de publicación debe ser un directorio real del proyecto.');
  }
  return target;
}
function prepare(options = {}) {
  const root = fs.realpathSync(options.root || path.resolve(__dirname, '..'));
  const output = safeOutput(root, options.output), plan = [];
  function add(relative) {
    const absolute = path.join(root, relative), stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('No se publican enlaces simbólicos: ' + relative);
    if (forbidden(path.basename(relative))) throw new Error('Archivo no publicable en recursos estáticos: ' + relative);
    if (!stat.isFile()) throw new Error('Falta un archivo estático: ' + relative);
    plan.push({relative, absolute, size: stat.size});
  }
  function walk(relative, accept = () => true) {
    const absolute = path.join(root, relative), stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Los recursos deben pertenecer al proyecto: ' + relative);
    for (const item of fs.readdirSync(absolute, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(relative, item.name);
      if (item.isSymbolicLink()) throw new Error('No se publican enlaces simbólicos: ' + child);
      if (item.isDirectory()) { if (forbidden(item.name)) throw new Error('Carpeta no publicable: ' + child); walk(child, accept); }
      else if (accept(child)) add(child);
    }
  }
  FILES.forEach(add); DIRECTORIES.forEach(directory => walk(directory));
  walk('src', file => file.endsWith('.css') || file.split(path.sep).join('/') === 'src/lib/StartupStatus.js');
  const available = new Set(plan.map(item => item.relative.split(path.sep).join('/')));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1];
    if (/^(?:[a-z]+:|#|\/\/)/i.test(value) || value === './') continue;
    const relative = value.split(/[?#]/)[0].replace(/^\.\//, '');
    if (relative.startsWith('/') || !available.has(relative)) throw new Error('El HTML referencia un recurso fuera de la publicación: ' + value);
  }
  for (const file of ['src/lib/StartupStatus.js', ...DECODERS.map(file => 'src/vendor/' + file), 'assets/materials/ai-industrial-concrete-v1-512.jpg', 'assets/ai/native-texture-ai-worker.js', 'assets/public-scenes/catalog.json', ...SCENES.map(scene => 'assets/public-scenes/' + scene.id + '.json')]) {
    if (!available.has(file)) throw new Error('Falta un recurso necesario para publicar: ' + file);
  }
  const published = fs.readdirSync(path.join(root, 'assets/public-scenes')).sort();
  if (JSON.stringify(published) !== JSON.stringify(['catalog.json', ...SCENES.map(scene => scene.id + '.json')].sort())) throw new Error('La copia estática sólo incluye los dos escenarios públicos.');
  for (const scene of SCENES) {
    const project = JSON.parse(fs.readFileSync(path.join(root, 'assets/public-scenes', scene.id + '.json'), 'utf8')).project;
    if (!project || project.publicSceneId !== scene.id || project.access.canEdit !== false || JSON.stringify(Object.keys(project.document.rooms)) !== JSON.stringify([scene.roomId]) || (project.document.imports || []).length) throw new Error('La proyección pública no es válida: ' + scene.id);
  }
  // All inputs/output boundaries are checked before replacing the old artifact.
  if (fs.existsSync(output)) fs.rmSync(output, {recursive: true});
  fs.mkdirSync(output, {recursive: true});
  for (const item of plan) {
    const destination = path.join(output, item.relative); fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(item.absolute, destination); // Copies, never tar hard links.
  }
  const rawRevision = options.revision || process.env.GITHUB_SHA || '';
  const publication = {format: 'hello-webxr-publication', version: 1, revision: /^[a-f0-9]{40}$/i.test(rawRevision) ? rawRevision : null,
    bundleSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(output, 'bundle.js'))).digest('hex'), scenes: SCENES.map(scene => scene.id)};
  fs.writeFileSync(path.join(output, 'publication.json'), JSON.stringify(publication, null, 2) + '\n');
  return {output, files: plan.length + 1, bytes: plan.reduce((sum, item) => sum + item.size, 0), publication};
}
if (require.main === module) {
  const result = prepare(); console.log('Publicación estática: ' + result.files + ' archivos · ' + (result.bytes / 1048576).toFixed(1) + ' MiB · ' + result.publication.bundleSha256);
}
module.exports = {prepare, safeOutput};
