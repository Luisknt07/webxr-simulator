import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {discoverLocalModules, resolveProjectComposition, writeProjectComposition} from '../../tooling/modules/discover.mjs';
import {generateManifests} from '../../tooling/modules/generate-manifests.mjs';
import {copyModuleSource} from '../../tooling/modules/copy-function.mjs';
const SOURCE = fileURLToPath(new URL('../../', import.meta.url));
const write = (root, filename, contents) => { const target = path.join(root, filename); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, typeof contents === 'string' ? contents : JSON.stringify(contents)); };
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smarttwin-discovery-')));
  t.after(() => { const absolute = fs.realpathSync(root); assert.equal(path.dirname(absolute), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(absolute).startsWith('smarttwin-discovery-')); fs.rmSync(absolute, {recursive: true}); });
  for (const folder of ['core', 'contracts', 'module-sdk']) fs.cpSync(path.join(SOURCE, 'packages', folder), path.join(root, 'packages', folder), {recursive: true});
  write(root, 'modules/package.json', {type: 'module'});
  for (const folder of ['logistica-industrial', 'agricultura', 'turismo']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(SOURCE, 'modules', folder, 'manifest.json'))); write(root, `modules/${folder}/manifest.json`, manifest);
    for (const definition of manifest.functions) for (const file of definition.metadata.files) { const input = path.join(SOURCE, 'modules', folder, definition.metadata.packageRoot, file); const output = path.join(root, 'modules', folder, definition.metadata.packageRoot, file); fs.mkdirSync(path.dirname(output), {recursive: true}); fs.copyFileSync(input, output); }
  }
  fs.mkdirSync(path.join(root, 'projects/agricultura'), {recursive: true}); fs.copyFileSync(path.join(SOURCE, 'projects/agricultura/project.json'), path.join(root, 'projects/agricultura/project.json'));
  // Discovery must read metadata without importing this poisoned runtime.
  write(root, 'modules/turismo/functions/recorridos/index.js', 'globalThis.discoveryPoison=true;throw new Error("Unselected tourism code executed");');
  return root;
}
function addFunction(root, {folder = 'nuevo', sectorId = 'sector.new-sector', id = 'new-sector.function', packageName = 'feature', copied = false} = {}) {
  const manifest = {id, version: '1.0.0', metadata: {title: 'Local contribution', packageRoot: 'functions/' + packageName, entry: 'index.js', manifestExport: 'manifest', files: ['index.js', 'manifest.js'], assets: [], tests: []}};
  const base = `modules/${folder}/functions/${packageName}`;
  write(root, base + '/manifest.js', `export const manifest=${JSON.stringify(manifest)};`);
  write(root, base + '/index.js', `import {defineFunction} from '../../../../packages/module-sdk/index.js';import {manifest} from './manifest.js';export default defineFunction({...manifest,register(scope){scope.register('commands','hello',()=>scope.id);scope.register('ui','summary',{kind:'text',title:'Local contribution'});}});`);
  if (copied) write(root, base + '/function-manifest.json', {format: 'smarttwin.function', schemaVersion: 1, ...manifest, entry: 'index.js'});
  else write(root, `modules/${folder}/manifest.json`, {format: 'smarttwin.sector', schemaVersion: 1, id: sectorId, version: '1.0.0', metadata: {folder}, functions: [{...manifest, entry: `functions/${packageName}/index.js`}]});
  return manifest;
}
const project = (moduleId, functions) => ({format: 'smarttwin.project', version: 1, worldId: 'world.discovered', modules: [{id: moduleId, version: '1.0.0', ...(functions ? {functions} : {})}], entities: []});

test('JSON discovery builds and boots Agriculture with only harvest plus storage, never an all-sector catalog', async t => {
  const root = fixture(t); const discovered = discoverLocalModules({root}); assert.equal(discovered.modules.length, 3); assert.equal(globalThis.discoveryPoison, undefined);
  const resolved = resolveProjectComposition({root, projectPath: 'projects/agricultura/project.json'}); assert.deepEqual(resolved.functions.map(entry => entry.id).sort(), ['agriculture.harvest', 'logistics.storage']); assert.equal(resolved.sources.some(source => source.path.includes('turismo')), false);
  const generated = writeProjectComposition({root, projectPath: 'projects/agricultura/project.json'}), text = fs.readFileSync(generated.catalog, 'utf8'); assert.doesNotMatch(text, /modules\/catalog|turismo|logistics\.workspace|IndustrialPrefabs/); assert.match(text, /functions\/almacenamiento\/index\.js/);
  const bootstrap = await import(pathToFileURL(generated.bootstrap).href); const host = await bootstrap.createComposedHost();
  assert.deepEqual(host.status().modules.map(module => module.id), ['sector.agriculture']); assert.deepEqual(host.status().functions.map(entry => entry.id).sort(), ['agriculture.harvest', 'logistics.storage']);
  await host.dispatch('logistics.storage:transaction', {operations: [{type: 'add-location', location: {id: 'field', capacityKg: 100, maxLoads: 2}}]}); await host.dispatch('agriculture.harvest:record', {id: 'crop-1', crop: 'mango', lot: 'lot-1', harvestDate: '2026-10-29', locationId: 'field', quantity: 12, massKg: 20}); assert.equal((await host.dispatch('agriculture.harvest:harvests'))[0].quantity, 12); assert.equal(globalThis.discoveryPoison, undefined); await host.dispose();
});

test('copied function JSON is discovered in its owning sector without editing its original catalog or defaults', async t => {
  const root = fixture(t), filename = path.join(root, 'modules/agricultura/manifest.json'), original = fs.readFileSync(filename, 'utf8');
  addFunction(root, {folder: 'agricultura', id: 'agriculture.copied', packageName: 'copied-feature', copied: true});
  const generated = writeProjectComposition({root, project: project('sector.agriculture', ['agriculture.copied']), name: 'copied'}); assert.deepEqual(generated.composition.functions.map(entry => entry.id), ['agriculture.copied']);
  const host = await (await import(pathToFileURL(generated.bootstrap).href)).createComposedHost(); assert.equal(await host.dispatch('agriculture.copied:hello'), 'agriculture.copied'); assert.equal(host.registry('ui').length, 1); await host.dispose();
  assert.equal(fs.readFileSync(filename, 'utf8'), original); const defaults = resolveProjectComposition({root, project: project('sector.agriculture')}); assert.equal(defaults.functions.some(entry => entry.id === 'agriculture.copied'), false);
});

test('new sectors and manifest regeneration require no manual five-module import list', async t => {
  const root = fixture(t); addFunction(root, {folder: 'salud', sectorId: 'sector.health', id: 'health.checklist'}); assert.equal(await generateManifests({root}), 4);
  assert.equal(fs.existsSync(path.join(root, 'modules/salud/functions/feature/function-manifest.json')), true);
  const generated = writeProjectComposition({root, project: project('sector.health'), name: 'health'}); const host = await (await import(pathToFileURL(generated.bootstrap).href)).createComposedHost(); assert.equal(await host.dispatch('health.checklist:hello'), 'health.checklist'); assert.equal(host.status().functions.length, 1); await host.dispose();
});

test('optional absent modules/functions retain opaque project data; required dependencies still block', t => {
  const root = fixture(t), input = project('sector.agriculture', ['agriculture.harvest']); input.modules.push({id: 'sector.future', version: '2.0.0', optional: true}); input.entities.push({id: 'future-1', components: [{functionId: 'future.feature', functionVersion: '2.0.0', type: 'future.feature:settings', schemaVersion: 42, data: {targetId: 'keep-me', code: 'globalThis.discoveryPoison=true'}}]});
  assert.throws(() => resolveProjectComposition({root, project: input}), {code: 'missing_module'}); const resolved = resolveProjectComposition({root, project: input, allowOptionalMissing: true}); assert.equal(resolved.missing[0].moduleId, 'sector.future'); assert.deepEqual(resolved.project, input); assert.equal(globalThis.discoveryPoison, undefined);
  const missingFunction = project('sector.agriculture', [{id: 'agriculture.future', optional: true}, 'agriculture.harvest']); assert.equal(resolveProjectComposition({root, project: missingFunction, allowOptionalMissing: true}).missing[0].functionId, 'agriculture.future');
  fs.unlinkSync(path.join(root, 'modules/logistica-industrial/manifest.json')); assert.throws(() => resolveProjectComposition({root, project: project('sector.agriculture', ['agriculture.harvest'])}), {code: 'missing_function'});
});

test('disabled sectors and roots stay in the document but leave the selected publication and generated loaders', async t => {
  const root=fixture(t), input=project('sector.agriculture',['agriculture.harvest']);
  input.modules.push({id:'sector.tourism',version:'1.0.0',enabled:false,functions:['tourism.routes']});
  input.modules.push({id:'sector.future',version:'1.0.0',enabled:false});
  const resolved=resolveProjectComposition({root,project:input});
  assert.deepEqual(resolved.project,input);assert.deepEqual(resolved.functions.map(entry=>entry.id).sort(),['agriculture.harvest','logistics.storage']);
  const generated=writeProjectComposition({root,project:input,name:'disabled'}), source=fs.readFileSync(generated.catalog,'utf8');
  assert.doesNotMatch(source,/import\([^)]*turismo/);
  const session=await (await import(pathToFileURL(generated.bootstrap).href)).createComposedSession();
  assert.equal(session.status().modules.find(entry=>entry.id==='sector.tourism').installed,false);
  assert.equal(globalThis.discoveryPoison,undefined);await session.dispose();
});

test('remote/traversal entry paths, malformed schemas and duplicate function identities are rejected before imports', t => {
  const root = fixture(t), filename = path.join(root, 'modules/agricultura/manifest.json'), original = JSON.parse(fs.readFileSync(filename));
  write(root, 'modules/agricultura/manifest.json', {...original, functions: [{...original.functions[0], entry: 'https://host.invalid/code.js'}]}); assert.throws(() => discoverLocalModules({root}), {code: 'discovery_path'});
  write(root, 'modules/agricultura/manifest.json', {...original, schemaVersion: 99}); assert.throws(() => discoverLocalModules({root}), {code: 'invalid_local_manifest'});
  write(root, 'modules/agricultura/manifest.json', original); addFunction(root, {folder: 'otro', id: 'agriculture.harvest'}); assert.throws(() => discoverLocalModules({root}), {code: 'duplicate_id'}); assert.equal(globalThis.discoveryPoison, undefined);
});

test('incompatible selected module versions fail and project JSON cannot supply executable loaders', t => {
  const root = fixture(t), input = project('sector.agriculture', ['agriculture.harvest']); input.modules[0].version = '2.0.0'; assert.throws(() => resolveProjectComposition({root, project: input}), {code: 'incompatible_version'});
  input.modules[0].version = '1.0.0'; input.modules[0].load = 'https://malicious.invalid/runtime.js'; const resolved = resolveProjectComposition({root, project: input}); assert.equal(resolved.functions.length, 2); assert.equal(globalThis.discoveryPoison, undefined);
});

test('linked sector inputs and generated data roots are rejected without writing outside the workspace', t => {
  const root = fixture(t), outside = path.join(root, 'outside'); fs.mkdirSync(outside); const moduleLink = path.join(root, 'modules/linked'); fs.symlinkSync(outside, moduleLink, process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.throws(() => discoverLocalModules({root}), {code: 'discovery_link'}); } finally { fs.unlinkSync(moduleLink); }
  const dataLink = path.join(root, 'data'); fs.symlinkSync(outside, dataLink, process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.throws(() => writeProjectComposition({root, project: project('sector.agriculture'), name: 'blocked'}), {code: 'discovery_link'}); assert.equal(fs.existsSync(path.join(outside, 'build')), false); } finally { fs.unlinkSync(dataLink); }
});

test('entry metadata cannot escape, disagree with the runtime entry, omit its file or inject copied loader code',t=>{
  const root=fixture(t),filename=path.join(root,'modules/agricultura/manifest.json'),original=JSON.parse(fs.readFileSync(filename)),entry=original.functions[0];
  write(root,'modules/agricultura/manifest.json',{...original,functions:[{...entry,metadata:{...entry.metadata,entry:'../../../../apps/api/server/api.js'}}]});assert.throws(()=>discoverLocalModules({root}),{code:'discovery_path'});
  write(root,'modules/agricultura/manifest.json',{...original,functions:[{...entry,metadata:{...entry.metadata,entry:'schema.js'}}]});assert.throws(()=>discoverLocalModules({root}),{code:'invalid_function_entry'});
  write(root,'modules/agricultura/manifest.json',{...original,functions:[{...entry,metadata:{...entry.metadata,files:entry.metadata.files.filter(name=>name!=='index.js')}}]});assert.throws(()=>discoverLocalModules({root}),{code:'invalid_function_entry'});
  const manifest={metadata:{manifestExport:'manifest',entry:"index.js');globalThis.copyEntryInjected=true;//"}},code=copyModuleSource(manifest).replace(/^import .*;\n/gm,'').replace('export default','return');
  const descriptor=new Function('localFunction','manifest',code)((value,load)=>({value,load}),manifest);assert.equal(typeof descriptor.load,'function');assert.equal(globalThis.copyEntryInjected,undefined);
});

test('a dangling generated output link is rejected before creating any target outside the composition',t=>{
  const root=fixture(t),output=path.join(root,'data/build/compositions/audit'),outside=path.join(root,'outside'),target=path.join(outside,'not-created'),link=path.join(output,'catalog.mjs');fs.mkdirSync(output,{recursive:true});fs.mkdirSync(outside);
  // Directory junctions permit this regression on Windows without elevated
  // file-symlink permission; POSIX uses a dangling file link directly.
  fs.symlinkSync(target,link,process.platform==='win32'?'junction':'file');
  try{assert.equal(fs.existsSync(link),false);assert.throws(()=>writeProjectComposition({root,project:project('sector.agriculture'),name:'audit'}),{code:'discovery_link'});assert.equal(fs.existsSync(target),false);}finally{fs.unlinkSync(link);}
});
