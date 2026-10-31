import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {REPOSITORY, checkedPath, discoverLocalModules} from './discover.mjs';
import {functionManifest, identifier, version as validateVersion, validateProject, fail} from '../../packages/contracts/index.js';

const folderName = value => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,59}$/.test(value)) fail('scaffold_path', 'Use a lowercase folder name of at most 60 characters.');
  return value;
};
const titleText = (value, fallback) => {
  const text = value === undefined ? fallback : value;
  if (typeof text !== 'string' || !text.trim() || text.length > 160 || /[\0-\x1f]/.test(text)) fail('scaffold_title', 'Use a nonempty title of at most 160 characters.');
  return text;
};
const json = value => JSON.stringify(value, null, 2) + '\n';
function absent(filename) {
  try { fs.lstatSync(filename); fail('scaffold_exists', 'The destination already exists; scaffolding never overwrites a module or project.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function directory(root, relative) {
  const resolved = checkedPath(root, relative);
  if (!fs.statSync(resolved).isDirectory()) fail('scaffold_path', 'A scaffold parent must be a directory.');
  return resolved;
}
function removeStaging(parent, staging) {
  const resolvedParent = fs.realpathSync(parent), resolved = path.resolve(staging);
  if (path.dirname(resolved) !== resolvedParent || !path.basename(resolved).startsWith('.create-')) fail('scaffold_cleanup', 'Refusing cleanup outside the owned staging directory.');
  const stat = fs.lstatSync(resolved); if (stat.isSymbolicLink() || !stat.isDirectory()) fail('scaffold_cleanup', 'Refusing cleanup of a replaced staging path.');
  fs.rmSync(resolved, {recursive: true, force: true});
}
function templateFiles(manifest, sectorManifest, sector, folder) {
  const sdk = '../../../../packages/module-sdk/index.js', contracts = '../../../../packages/contracts/index.js';
  const functionTitle = manifest.metadata.title;
  const packageFiles = new Map([
    ['manifest.js', `export const manifest = Object.freeze(${JSON.stringify(manifest, null, 2)});\n`],
    ['index.js', `import {defineFunction} from ${JSON.stringify(sdk)};
import {manifest} from './manifest.js';
import {validateSettings} from './schema.js';
import {createSettingsRuntime} from './runtime.js';
import {authorizeSettingsEdit} from './server.js';
import {migrateSettingsState} from './migrations.js';
import {settingsPanel} from './ui.js';

export default defineFunction({...manifest, register(scope) {
  const runtime = createSettingsRuntime(scope, {label: manifest.metadata.title, enabled: true});
  scope.register('commands', 'configure', {validate: input => {validateSettings(input); return true;}, execute: input => runtime.configure(input)});
  scope.register('commands', 'inspect', {readOnly: true, execute: () => runtime.inspect()});
  scope.register('components', 'settings', {schemaVersion: 1, validate: input => {validateSettings(input); return true;}});
  scope.register('server-validators', 'configure', {validate: validateSettings, authorize: context => authorizeSettingsEdit(context, scope.id), permissions: [scope.id + '.write']});
  scope.register('migrations', 'state', migrateSettingsState);
  scope.register('ui', 'settings', settingsPanel);
}});
`],
    ['schema.js', `import {cloneData, plain, fail} from ${JSON.stringify(contracts)};
export function validateSettings(input) {
  const value = cloneData(input);
  if (!plain(value) || Object.keys(value).length !== 2 || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 160 || typeof value.enabled !== 'boolean') fail('settings_data', 'Provide a label and a boolean enabled setting.');
  return value;
}
`],
    ['runtime.js', `import {cloneData} from ${JSON.stringify(contracts)};
import {validateSettings} from './schema.js';
// A portable function owns its state; it never creates a render loop or imports another sector.
export function createSettingsRuntime(scope, defaults) {
  let settings = validateSettings(scope.state.get() || defaults);
  scope.state.set(settings);
  return Object.freeze({
    inspect: () => cloneData(settings),
    configure(input) {const next = validateSettings(input); scope.state.set(next); settings = next; return cloneData(settings);}
  });
}
`],
    ['server.js', `export {validateSettings} from './schema.js';
// An application/API adapter must explicitly install this validator and authenticate its route.
export const authorizeSettingsEdit = (context, functionId) => !!context && context.authenticated === true && Array.isArray(context.permissions) && context.permissions.includes(functionId + '.write');
`],
    ['migrations.js', `import {cloneData, fail} from ${JSON.stringify(contracts)};
import {validateSettings} from './schema.js';
export function migrateSettingsState(entry) {
  const value = cloneData(entry);
  if (value.schemaVersion !== 1) fail('state_migration_required', 'Add an explicit migration for this state version.');
  value.data = validateSettings(value.data); return value;
}
`],
    ['ui.js', `export const settingsPanel = Object.freeze({kind: 'form', title: ${JSON.stringify(functionTitle)}, fields: ['label', 'enabled'], actions: ['configure', 'inspect']});\n`],
    ['contract.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSettings} from './schema.js';
import {authorizeSettingsEdit} from './server.js';
test('settings are bounded data and writes need explicit application permission', () => {
  assert.deepEqual(validateSettings({label: 'Example', enabled: true}), {label: 'Example', enabled: true});
  assert.throws(() => validateSettings({label: '', enabled: true}));
  assert.throws(() => validateSettings({label: 'Example', enabled: 'yes'}));
  assert.equal(authorizeSettingsEdit({authenticated: false, permissions: ['example.feature.write']}, 'example.feature'), false);
  assert.equal(authorizeSettingsEdit({authenticated: true, permissions: ['example.feature.write']}, 'example.feature'), true);
});
`],
    ['README.md', `# ${functionTitle}\n\nThis complete function package owns its runtime, state, schema, UI descriptor, server validator, migration and contract test. Replace the example settings operation with this function's domain behavior. Declare dependencies and service contracts in manifest.js, then keep function-manifest.json and the sector manifest in sync with module:manifests.\n\nRegister local names through scope; use scope.id for namespaced permissions. Reuse other functions through requires/uses instead of importing another sector's private files. Acquire browser resources only through granted ports and register cleanup with scope.own/scope.onDispose. No timers or second animation loop are created by this template.\n\nThe enabled setting is example business data. Activate/pause/remove the function through its host/module lifecycle; changing enabled does not unload code.\n`],
    ['function-manifest.json', json({format: 'smarttwin.function', schemaVersion: 1, ...manifest, entry: 'index.js'})]
  ]);
  const files = new Map([
    ['package.json', json({private: true, type: 'module'})],
    ['manifest.json', json({format: 'smarttwin.sector', schemaVersion: 1, ...sectorManifest, functions: [{...manifest, entry: `functions/${folder}/index.js`}]})],
    ['manifest.js', `export {manifest} from './functions/${folder}/manifest.js';\nexport const sectorManifest = Object.freeze(${JSON.stringify(sectorManifest, null, 2)});\n`],
    ['module.js', `import {defineModule, localFunction} from '../../packages/module-sdk/index.js';\nimport {sectorManifest, manifest} from './manifest.js';\nexport default defineModule({...sectorManifest, functions: [localFunction(manifest, () => import('./functions/${folder}/index.js'))]});\n`],
    ['README.md', `# ${sectorManifest.metadata.title}\n\nThis sector owns its portable features under functions/. Discover it from its JSON manifest; the core and other sectors need no new imports. A project selects ${manifest.id} explicitly. Only that function and declared dependencies enter a selected build.\n\nPortable function: functions/${folder}/. A function can be reused by declaring requires/uses or copied with tooling/modules/copy-function.mjs. Copying code does not copy live project state.\n\nActivate: host.activate(${JSON.stringify(sectorManifest.id)}, {functions: [${JSON.stringify(manifest.id)}]}). Pause: host.pause(${JSON.stringify(sectorManifest.id)}). Remove: host.remove(${JSON.stringify(sectorManifest.id)}). Removing retains serializable state and respects dependencies and canStop guards. Use exportState/importState to persist a project's own state. Do not delete files used by an active process; remove from the composition and rebuild first.\n`]
  ]);
  for (const [name, contents] of packageFiles) files.set(`functions/${folder}/${name}`, contents);
  return files;
}

/** Create a new portable sector and optional project, using data-only inputs.
 * Existing sectors/functions/projects are never rewritten; no runtime is loaded.
 */
export function createModule({root = REPOSITORY, sector, sectorId, folder, functionId, title, functionTitle, version = '1.0.0', projectName} = {}) {
  sector = folderName(sector); folder = folderName(folder);
  identifier(sectorId); identifier(functionId); validateVersion(version);
  title = titleText(title, sector); functionTitle = titleText(functionTitle, folder);
  if (projectName !== undefined) projectName = folderName(projectName);
  root = fs.realpathSync(path.resolve(root));
  const moduleParent = directory(root, 'modules'), destination = path.join(moduleParent, sector);
  absent(destination);
  for (const relative of ['packages/core/index.js', 'packages/module-sdk/index.js', 'packages/contracts/index.js']) checkedPath(root, relative);
  const {catalog} = discoverLocalModules({root});
  if (catalog.getModule(sectorId) || catalog.getFunction(functionId)) fail('duplicate_id', 'A sector or function with that identity is already installed.');
  const projectParent = projectName === undefined ? null : directory(root, 'projects');
  const projectDestination = projectParent && path.join(projectParent, projectName);
  if (projectDestination) absent(projectDestination);
  const fileNames = ['index.js','manifest.js','schema.js','runtime.js','server.js','migrations.js','ui.js','contract.test.mjs','README.md'];
  const manifest = functionManifest({id: functionId, version, coreApi: '^1.0.0', requires: [], uses: [], provides: [], capabilities: [], exported: true, stateVersion: 1,
    metadata: {title: functionTitle, packageRoot: `functions/${folder}`, manifestExport: 'manifest', entry: 'index.js', schema: 'schema.js', server: 'server.js', migration: 'migrations.js', ui: 'ui.js', assets: [], tests: ['contract.test.mjs'], files: fileNames}});
  const sectorManifest = {id: sectorId, version, coreApi: '^1.0.0', metadata: {title, folder: sector}, imports: []};
  const project = projectName === undefined ? null : validateProject({format: 'smarttwin.project', version: 1, worldId: `world.${projectName}`,
    modules: [{id: sectorId, version, functions: [functionId]}], entities: []});
  const files = templateFiles(manifest, sectorManifest, sector, folder);
  const suffix = randomUUID(), staging = path.join(moduleParent, `.create-${sector}-${suffix}`), projectStaging = projectParent && path.join(projectParent, `.create-${projectName}-${suffix}`);
  // Exclusive parent locks coordinate simultaneous scaffold commands. Staging
  // directories are hidden from discovery until the complete manifest is ready.
  const lock = path.join(moduleParent, '.create-modules.lock'), lockFd = fs.openSync(lock, 'wx');
  let created = false, projectCreated = false, staged = false, projectStaged = false;
  try {
    absent(destination); if (projectDestination) absent(projectDestination);
    const current = discoverLocalModules({root}).catalog;
    if (current.getModule(sectorId) || current.getFunction(functionId)) fail('duplicate_id', 'A sector or function with that identity is already installed.');
    fs.mkdirSync(staging); staged = true;
    for (const [name, contents] of files) {const filename = path.join(staging, name); fs.mkdirSync(path.dirname(filename), {recursive: true}); fs.writeFileSync(filename, contents, {flag: 'wx'});}
    if (projectStaging) {fs.mkdirSync(projectStaging); projectStaged = true; fs.writeFileSync(path.join(projectStaging, 'project.json'), json(project), {flag: 'wx'});}
    // Validate local parents again immediately before publishing the new paths.
    if (directory(root, 'modules') !== moduleParent || projectParent && directory(root, 'projects') !== projectParent) fail('scaffold_path', 'A scaffold parent changed while preparing files.');
    absent(destination); if (projectDestination) absent(projectDestination);
    fs.renameSync(staging, destination); staged = false; created = true;
    if (projectStaging) {absent(projectDestination); fs.renameSync(projectStaging, projectDestination); projectStaged = false; projectCreated = true;}
  } catch (error) {
    // Roll back only a module this operation just published, after checking all
    // of its exact files. Never recursively remove a changed/user-owned tree.
    if (created && !projectCreated) {
      const expected = [...files]; let owned = !fs.lstatSync(destination).isSymbolicLink();
      for (const [name, contents] of expected) {try {const filename = checkedPath(root, `modules/${sector}/${name}`); owned = owned && fs.readFileSync(filename, 'utf8') === contents;} catch (_) {owned = false;}}
      const expectedPaths = new Set(files.keys());
      for (const name of files.keys()) {const parts=name.split('/'); for(let index=1;index<parts.length;index++) expectedPaths.add(parts.slice(0,index).join('/')+'/');}
      const actualPaths = [];
      const walk = (base, prefix = '') => {
        for(const entry of fs.readdirSync(base, {withFileTypes:true})) {
          if(entry.isSymbolicLink()) {owned=false;continue;}
          const name=prefix+entry.name+(entry.isDirectory()?'/':'');actualPaths.push(name);
          if(entry.isDirectory()) walk(path.join(base,entry.name),name);
        }
      };
      if(owned) walk(destination);
      if (owned && actualPaths.length === expectedPaths.size && actualPaths.every(name=>expectedPaths.has(name))) {fs.renameSync(destination, staging); staged = true;}
      else error.scaffoldPreserved = destination;
    }
    throw error;
  } finally {
    if (staged) removeStaging(moduleParent, staging);
    if (projectStaged) removeStaging(projectParent, projectStaging);
    fs.closeSync(lockFd); fs.unlinkSync(lock);
  }
  return {format: 'smarttwin.module-scaffold', version: 1, moduleId: sectorId, functionId, destination, files: [...files.keys()],
    ...(projectDestination ? {projectPath: `projects/${projectName}/project.json`, projectDestination} : {})};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const options = {};
  try {
    const names = {sector:'sector', id:'sectorId', folder:'folder', function:'functionId', title:'title', 'function-title':'functionTitle', version:'version', project:'projectName'};
    for (let index = 2; index < process.argv.length; index += 2) {
      const name = process.argv[index].replace(/^--/, '');
      if (!process.argv[index].startsWith('--') || !Object.hasOwn(names, name) || !process.argv[index + 1] || Object.hasOwn(options, names[name])) fail('scaffold_usage', 'Use --sector salud --id sector.health --folder checklist --function health.checklist [--project salud] [--title Salud] [--function-title Checklist] [--version 1.0.0].');
      options[names[name]] = process.argv[index + 1];
    }
    console.log(JSON.stringify(createModule(options), null, 2));
  } catch (error) {console.error(error.code + ': ' + error.message); process.exitCode = 1;}
}
