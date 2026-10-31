import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createLocalCatalog} from '../../packages/core/index.js';
import {resolveProjectSelection} from '../../packages/core/project-selection.js';
import {readContentProject, CONTENT_PROJECT_FILE, CONTENT_PACKAGE_FORMAT} from '../../packages/project-format/index.js';
import {readContentFolder} from '../projects/content-project.mjs';
import {cloneData, functionManifest, identifier, plain, version, versionSatisfies, validateProject, fail, deepFreeze} from '../../packages/contracts/index.js';

export const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url));
const within = (base, target) => target === base || !path.relative(base, target).startsWith('..') && !path.isAbsolute(path.relative(base, target));
const slash = value => value.split(path.sep).join('/');
export function checkedPath(root, relative, {missing = false} = {}) {
  if (typeof relative !== 'string' || !relative || relative.startsWith('/') || /[\\:%?#\0]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) fail('discovery_path', 'Only bounded local manifest paths are allowed.');
  let target = root;
  for (const part of relative.split('/')) { target = path.join(target, part); let stat; try { stat = fs.lstatSync(target); } catch (error) { if (missing && error.code === 'ENOENT') return null; fail('missing_manifest_file', `Missing local package file: ${relative}`); } if (stat.isSymbolicLink()) fail('discovery_link', `Linked package paths are not allowed: ${relative}`); }
  const resolved = fs.realpathSync(target); if (!within(root, resolved)) fail('discovery_path', 'A package path escapes the trusted root.'); return resolved;
}
function readJSON(root, relative) {
  const filename = checkedPath(root, relative), stat = fs.statSync(filename); if (!stat.isFile() || stat.size > 4 * 1024 * 1024) fail('invalid_local_manifest', 'A manifest must be a bounded JSON file.');
  const bytes = fs.readFileSync(filename); let value; try { value = JSON.parse(bytes); } catch (_) { fail('invalid_local_manifest', `Invalid JSON manifest: ${relative}`); }
  return {value: cloneData(value), relative, sha256: createHash('sha256').update(bytes).digest('hex')};
}
function projectInput(input,{moduleState,contentDescriptor}={}) {
  let value=input;
  if(value&&value.format===CONTENT_PACKAGE_FORMAT){const restored=readContentProject(value);value=restored.document;moduleState=restored.moduleState;contentDescriptor=restored.descriptor;}
  if(value&&value.format==='hello-webxr-editor')fail('project_editor_required','Este proyecto contiene niveles del editor industrial. Ábrelo con Contenido → Abrir carpeta de proyecto; el compilador genérico solo publica proyectos modulares.');
  if(value&&value.format==='smarttwin.project-session'){if(value.version!==1)fail('invalid_project','This modular project session uses an unsupported version.');if(moduleState===undefined&&value.state!==undefined)moduleState=value.state;value=value.project;}
  return {project:validateProject(value),...(moduleState===undefined?{}:{moduleState}),...(contentDescriptor===undefined?{}:{contentDescriptor})};
}

/** Recognize a bounded installed project document or independent Content
 * folder. Reading a descriptor verifies every JSON file and imports no code. */
export function readLocalProject({root=REPOSITORY,projectPath}={}) {
  root=fs.realpathSync(path.resolve(root));
  const filename=checkedPath(root,projectPath),stat=fs.statSync(filename);
  if(stat.isDirectory()||path.basename(filename)===CONTENT_PROJECT_FILE){
    const descriptor=stat.isDirectory()?checkedPath(root,slash(path.relative(root,path.join(filename,CONTENT_PROJECT_FILE)))):filename;
    return projectInput(readContentFolder(descriptor));
  }
  return projectInput(readJSON(root,projectPath).value);
}
function functionEntry(root, folder, row, localPackage) {
  const manifest = functionManifest(row), moduleDirectory = `modules/${folder}`;
  if (!plain(manifest.metadata) || typeof manifest.metadata.entry !== 'string') fail('nonportable_function', 'A local function must declare portable entry metadata.');
  const entry = localPackage ? `${localPackage}/${row.entry || manifest.metadata.entry}` : row.entry;
  const absolute = checkedPath(root, `${moduleDirectory}/${entry}`);
  if (!/\.(?:js|mjs)$/.test(absolute) || !fs.statSync(absolute).isFile()) fail('invalid_function_entry', `Function ${manifest.id} needs a local ESM entry.`);
  const packageRoot = manifest.metadata && manifest.metadata.packageRoot;
  if (typeof packageRoot !== 'string' || !packageRoot.startsWith('functions/') || localPackage && packageRoot !== localPackage) fail('invalid_function_entry', 'A portable function must declare its own package root.');
  const packageDirectory = checkedPath(root, `${moduleDirectory}/${packageRoot}`); if (!within(packageDirectory, absolute)) fail('invalid_function_entry', 'A function entry must remain inside its package.');
  if (!Array.isArray(manifest.metadata.files) || !manifest.metadata.files.length || manifest.metadata.files.length > 2048 || manifest.metadata.files.some(filename => typeof filename !== 'string') || new Set(manifest.metadata.files.map(filename => filename.toLowerCase())).size !== manifest.metadata.files.length) fail('nonportable_function', `Function ${manifest.id} needs a bounded file allowlist without case-colliding names.`);
  const declaredEntry = checkedPath(root, `${moduleDirectory}/${packageRoot}/${manifest.metadata.entry}`);
  if (declaredEntry !== absolute || !manifest.metadata.files.includes(manifest.metadata.entry)) fail('invalid_function_entry', 'The portable entry must match the validated entry and belong to its file allowlist.');
  for (const filename of manifest.metadata.files) { const file = checkedPath(root, `${moduleDirectory}/${packageRoot}/${filename}`); if (!fs.statSync(file).isFile()) fail('missing_manifest_file', 'A package allowlist entry is not a regular file.'); }
  const files = new Set(manifest.metadata.files);
  for (const field of ['schema', 'server', 'ui', 'migration']) {
    const filename = manifest.metadata[field];
    if (filename !== undefined && (typeof filename !== 'string' || !files.has(filename))) fail('nonportable_function', `Function ${manifest.id} must include its ${field} in metadata.files so a copy remains complete.`);
  }
  for (const field of ['assets', 'tests']) {
    const filenames = manifest.metadata[field];
    if (filenames === undefined) continue;
    if (!Array.isArray(filenames) || filenames.length > 256 || new Set(filenames).size !== filenames.length || filenames.some(filename => typeof filename !== 'string' || !files.has(filename))) fail('nonportable_function', `Function ${manifest.id} must include every distinct ${field} entry in metadata.files so a copy remains complete.`);
  }
  return {...manifest, entry: slash(path.relative(root, absolute)), sectorEntry: slash(path.relative(path.join(root, moduleDirectory), absolute)), moduleDirectory, packageDirectory: slash(path.relative(root, packageDirectory))};
}

/** JSON-only local discovery. Reading a manifest never imports implementation JS. */
export function discoverLocalModules({root = REPOSITORY} = {}) {
  root = fs.realpathSync(path.resolve(root)); const directory = checkedPath(root, 'modules'), modules = [], allFunctions = new Map(), sources = [];
  for (const child of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    if (child.name.startsWith('.')) continue;
    if (child.isSymbolicLink()) fail('discovery_link', 'Sector directories cannot be links.');
    if (!child.isDirectory()) continue;
    const moduleFile = checkedPath(root, `modules/${child.name}/manifest.json`, {missing: true}); if (!moduleFile) continue;
    const document = readJSON(root, `modules/${child.name}/manifest.json`), data = document.value;
    if (!plain(data) || data.format !== 'smarttwin.sector' || data.schemaVersion !== 1 || !Array.isArray(data.functions) || data.functions.length > 256) fail('invalid_local_manifest', 'Invalid sector manifest schema.');
    identifier(data.id); version(data.version); if (data.metadata && data.metadata.folder !== child.name) fail('invalid_local_manifest', 'Sector folder and declared metadata disagree.');
    if (modules.some(module => module.id === data.id)) fail('duplicate_id', `Duplicate sector ${data.id}.`);
    sources.push({path: document.relative, sha256: document.sha256});
    const functions = new Map(), defaults = data.functions.map(row => row.id);
    const add = (row, localPackage) => {
      const entry = functionEntry(root, child.name, row, localPackage), prior = functions.get(entry.id);
      if (prior) { if (prior.entry !== entry.entry || JSON.stringify(functionManifest(prior)) !== JSON.stringify(functionManifest(entry))) fail('manifest_conflict', `Conflicting function declarations: ${entry.id}`); return; }
      if (allFunctions.has(entry.id)) fail('duplicate_id', `Function ${entry.id} is already owned by another sector.`);
      functions.set(entry.id, entry); allFunctions.set(entry.id, {moduleId: data.id, ...entry});
    };
    data.functions.forEach(row => add(row));
    const packages = checkedPath(root, `modules/${child.name}/functions`, {missing: true});
    if (packages) for (const candidate of fs.readdirSync(packages, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (candidate.name.startsWith('.')) continue; if (candidate.isSymbolicLink()) fail('discovery_link', 'Function packages cannot be links.'); if (!candidate.isDirectory()) continue;
      const name = `modules/${child.name}/functions/${candidate.name}/function-manifest.json`; if (!checkedPath(root, name, {missing: true})) continue;
      const copied = readJSON(root, name); if (copied.value.format !== 'smarttwin.function' || copied.value.schemaVersion !== 1) fail('invalid_local_manifest', 'Invalid portable function manifest schema.'); sources.push({path: copied.relative, sha256: copied.sha256}); add(copied.value, `functions/${candidate.name}`);
    }
    const module = {id: data.id, version: data.version, coreApi: data.coreApi || '^1.0.0', metadata: data.metadata || {folder: child.name}, imports: data.imports || [], functions: [...functions.values()], defaultFunctions: defaults, manifestPath: document.relative}; modules.push(module);
  }
  // The core registry validates dependency references, namespace/version syntax
  // and duplicate declarations. These callbacks are inert until explicit use.
  const catalog = createLocalCatalog(modules.map(module => ({...module, functions: module.functions.map(entry => ({...entry, load: () => import(pathToFileURL(path.join(root, entry.entry)).href)}))})));
  return {root, modules, sources, catalog};
}

export function resolveProjectComposition({root = REPOSITORY, projectPath, project, allowOptionalMissing = false} = {}) {
  const discovery = discoverLocalModules({root}); root = discovery.root;
  const input = project === undefined ? readLocalProject({root, projectPath}) : projectInput(project);
  const defaultFunctions = Object.fromEntries(discovery.modules.map(module => [module.id, module.defaultFunctions.concat(module.imports.map(entry => entry.id))]));
  const selection = resolveProjectSelection({catalog: discovery.catalog, project: input.project, allowOptionalMissing, defaultFunctions});
  const document = selection.project, selections = selection.selections, missing = selection.missing, selected = new Set(selection.functions.map(entry => entry.id));
  const neededOwners = new Set(selections.map(selection => selection.moduleId)); for (const module of discovery.modules) if (module.functions.some(entry => selected.has(entry.id))) neededOwners.add(module.id);
  const modules = discovery.modules.filter(module => neededOwners.has(module.id)).map(module => ({...module, functions: module.functions.filter(entry => selected.has(entry.id)), imports: module.imports.filter(entry => selected.has(entry.id))}));
  const functions = modules.flatMap(module => module.functions.map(entry => ({...entry, moduleId: module.id}))), selectedSources = new Set(modules.map(module => module.manifestPath).concat(functions.map(entry => entry.packageDirectory + '/function-manifest.json')));
  return {root, project: document, selections, missing, modules, functions, defaultFunctions, sources: discovery.sources.filter(source => selectedSources.has(source.path)),...(input.moduleState===undefined?{}:{moduleState:input.moduleState}),...(input.contentDescriptor===undefined?{}:{contentDescriptor:input.contentDescriptor})};
}

export function writeProjectComposition(options = {}) {
  const resolved = resolveProjectComposition(options), root = resolved.root, name = options.name || path.basename(path.dirname(options.projectPath || 'project/default/project.json'));
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(name)) fail('discovery_path', 'Use a bounded generated project name.');
  for (const name of ['data', 'data/build', 'data/build/compositions']) if (!checkedPath(root, name, {missing: true})) fs.mkdirSync(path.join(root, name));
  const parent = path.join(root, 'data/build/compositions');
  const output = path.join(parent, name); if (fs.existsSync(output)) checkedPath(root, `data/build/compositions/${name}`); else fs.mkdirSync(output);
  const importPath = absolute => { const relative = slash(path.relative(output, absolute)); return relative.startsWith('.') ? relative : './' + relative; };
  const catalogSource = resolved.modules.map(module => {
    const metadata = {id: module.id, version: module.version, coreApi: module.coreApi, metadata: module.metadata, imports: module.imports};
    return `{...${JSON.stringify(metadata)},functions:[${module.functions.map(entry => `{...${JSON.stringify(functionManifest(entry))},load:()=>import(${JSON.stringify(importPath(path.join(root, entry.entry)))})}`).join(',')} ]}`;
  }).join(',\n');
  const defaults = Object.fromEntries(resolved.modules.map(module => [module.id, resolved.defaultFunctions[module.id].filter(id => resolved.functions.some(entry => entry.id === id))]));
  const catalog = `// Generated from validated local JSON. No remote code, no all-sector barrel.\nexport const project=${JSON.stringify(resolved.project)};\nexport const selections=${JSON.stringify(resolved.selections)};\nexport const missing=${JSON.stringify(resolved.missing)};\nexport const defaultFunctions=${JSON.stringify(defaults)};\nexport const moduleState=${JSON.stringify(resolved.moduleState||null)};\nexport const catalog=[${catalogSource}];\n`;
  const coreImport = JSON.stringify(importPath(path.join(root, 'packages/core/index.js')));
  const sessionImport = JSON.stringify(importPath(path.join(root, 'packages/core/project-session.js')));
  const bootstrap = `import {composeSelection} from ${coreImport};\nimport {createProjectSession} from ${sessionImport};\nimport {catalog,project,selections,defaultFunctions,moduleState} from './catalog.mjs';\nexport {project,selections,missing} from './catalog.mjs';\nexport function createComposedHost({ports={},grants=[],...options}={}){return composeSelection({...options,worldId:project.worldId,ports,grants,catalog,selections,state:moduleState});}\nexport async function createComposedSession({ports={},grants=[],...options}={}){const session=createProjectSession({...options,ports,grants,catalog,defaultFunctions});try{await session.open(project,{allowOptionalMissing:true,...(moduleState?{state:moduleState}:{})});return session;}catch(error){await session.dispose({force:true});throw error;}}\n`;
  const receipt = cloneData({format: 'smarttwin.composition', version: 1, worldId: resolved.project.worldId, selections: resolved.selections, missing: resolved.missing, functions: resolved.functions.map(entry => ({id: entry.id, version: entry.version, entry: entry.entry, moduleId: entry.moduleId})), manifests: resolved.sources});
  // Never follow a pre-existing file link or overwrite an unrelated file name.
  for (const [filename, contents] of [['catalog.mjs', catalog], ['bootstrap.mjs', bootstrap], ['selection.json', JSON.stringify(receipt, null, 2) + '\n']]) { const relative = `data/build/compositions/${name}/${filename}`; checkedPath(root, relative, {missing:true}); fs.writeFileSync(path.join(output, filename), contents); }
  return deepFreeze({output, catalog: path.join(output, 'catalog.mjs'), bootstrap: path.join(output, 'bootstrap.mjs'), receipt: path.join(output, 'selection.json'), composition: receipt});
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const index = process.argv.indexOf('--project'); if (index < 0 || !process.argv[index + 1]) fail('discovery_usage', 'Use --project projects/agricultura/project.json [--allow-optional-missing].');
  console.log(JSON.stringify(writeProjectComposition({projectPath: process.argv[index + 1], allowOptionalMissing: process.argv.includes('--allow-optional-missing')}), null, 2));
}
