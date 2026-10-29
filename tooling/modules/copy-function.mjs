import {readFile, writeFile, mkdir, realpath, stat, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {requireClosure} from '../../packages/core/index.js';
import {discoverLocalModules} from './discover.mjs';
import {functionManifest, identifier, fail} from '../../packages/contracts/index.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const inside = (base, target) => target !== base && !path.relative(base, target).startsWith('..') && !path.isAbsolute(path.relative(base, target));
const folderName = value => { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(value)) fail('invalid_copy_path', 'Use a local lowercase sector/folder name.'); return value; };
export function copyModuleSource(manifest) {
  const symbol = manifest.metadata.manifestExport;
  if (!/^[A-Za-z_]\w*$/.test(symbol) || typeof manifest.metadata.entry !== 'string') fail('nonportable_function', 'A copy needs a local manifest export and entry.');
  return `import {localFunction} from '../../../../packages/module-sdk/index.js';\nimport {${symbol}} from './manifest.js';\nexport default localFunction(${symbol}, () => import(${JSON.stringify('./' + manifest.metadata.entry)}));\n`;
}

/** Copies only a declared portable island. It never loads function code and never
 * copies a sector's legacy runtime/schema directories or live project state. */
export async function copyFunction({functionId, sector, folder, id, version} = {}) {
  identifier(id); folderName(sector); folderName(folder); const {catalog} = discoverLocalModules({root: repository}), source = catalog.getFunction(functionId);
  if (!source || !source.exported) fail('missing_function', 'Choose an exported local function.');
  const owner = catalog.getModule(source.moduleId), sourceRoot = await realpath(path.join(repository, 'modules', owner.metadata.folder, source.metadata.packageRoot));
  const moduleRoot = await realpath(path.join(repository, 'modules')), targetSector = await realpath(path.join(moduleRoot, sector));
  if (!inside(moduleRoot, sourceRoot) || !inside(moduleRoot, targetSector)) fail('invalid_copy_path', 'The package must stay inside local modules.');
  const parent = path.join(targetSector, 'functions'); await mkdir(parent, {recursive: true}); const resolvedParent = await realpath(parent);
  if (!inside(targetSector, resolvedParent)) fail('invalid_copy_path', 'The function folder must stay inside its target sector.');
  const destination = path.resolve(resolvedParent, folder); if (!inside(resolvedParent, destination)) fail('invalid_copy_path', 'Unsafe destination.');
  try { await stat(destination); fail('copy_exists', 'The destination exists; copies never overwrite another function.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!Array.isArray(source.metadata.files) || !source.metadata.files.length || !/^[A-Za-z_]\w*$/.test(source.metadata.manifestExport)) fail('nonportable_function', 'This function has not declared a complete portable file package.');
  const files = new Map(), hashes = {};
  for (const name of source.metadata.files) {
    if (typeof name !== 'string' || path.isAbsolute(name) || name.includes('\\') || name.split('/').some(part => part === '..' || !part)) fail('invalid_copy_path', 'Invalid declared package file.');
    const filename = await realpath(path.join(sourceRoot, name)); if (!inside(sourceRoot, filename)) fail('invalid_copy_path', 'A package file escapes its root.');
    const content = await readFile(filename); files.set(name, content); hashes[name] = createHash('sha256').update(content).digest('hex');
  }
  const manifest = functionManifest({...source, id, version: version || source.version, origin: {functionId: source.id, version: source.version, moduleId: source.moduleId, sourceHashes: hashes}, metadata: {...source.metadata, packageRoot: `functions/${folder}`}});
  if (manifest.id === source.id) fail('invalid_fork', 'A copy needs a new namespace.');
  const dependencies = requireClosure(catalog, owner.id, [source.id]).filter(entry => entry.id !== source.id).map(entry => ({id: entry.id, version: entry.version, moduleId: entry.moduleId}));
  const symbol = source.metadata.manifestExport;
  files.set('manifest.js', Buffer.from(`export const ${symbol} = Object.freeze(${JSON.stringify(manifest, null, 2)});\n`));
  files.set('module.js', Buffer.from(copyModuleSource(manifest)));
  files.set('function-manifest.json', Buffer.from(JSON.stringify({format: 'smarttwin.function', schemaVersion: 1, ...manifest, entry: source.metadata.entry}, null, 2) + '\n'));
  const receipt = {format: 'smarttwin.function-copy', version: 1, functionId: manifest.id, functionVersion: manifest.version, origin: manifest.origin, dependencies, sharedServicePolicy: 'One provider per service per world; replace the original provider or use an explicit consumer adapter.', files: [...files.keys()]};
  files.set('copy-manifest.json', Buffer.from(JSON.stringify(receipt, null, 2) + '\n'));
  const staging = path.join(resolvedParent, `.copy-${folder}-${randomUUID()}`);
  await mkdir(staging);
  try { for (const [name, contents] of files) { const output = path.resolve(staging, name); if (!inside(staging, output)) fail('invalid_copy_path', 'Unsafe output file.'); await mkdir(path.dirname(output), {recursive: true}); await writeFile(output, contents, {flag: 'wx'}); } await rename(staging, destination); }
  catch (error) { const checked = path.resolve(staging); if (inside(resolvedParent, checked) && path.basename(checked).startsWith('.copy-')) await rm(checked, {recursive: true, force: true}); throw error; }
  return {destination, descriptor: path.join(destination, 'module.js'), ...receipt};
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const flags = {}; for (let i = 2; i < process.argv.length; i += 2) { if (!/^--(?:function|sector|folder|id|version)$/.test(process.argv[i]) || !process.argv[i + 1]) fail('copy_usage', 'Usage: --function logistics.storage --sector agricultura --folder almacenamiento-propio --id agriculture.storage [--version 1.0.0]'); flags[process.argv[i].slice(2)] = process.argv[i + 1]; }
  console.log(JSON.stringify(await copyFunction({functionId: flags.function, sector: flags.sector, folder: flags.folder, id: flags.id, version: flags.version}), null, 2));
}
