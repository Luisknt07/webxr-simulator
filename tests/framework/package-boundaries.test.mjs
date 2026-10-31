import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {discoverLocalModules} from '../../tooling/modules/discover.mjs';
import {buildProject} from '../../tooling/build/project.mjs';
import {createHost} from '../../packages/core/index.js';

const SOURCE = fileURLToPath(new URL('../../', import.meta.url));
const write = (root, name, value) => {
  const filename = path.join(root, name); fs.mkdirSync(path.dirname(filename), {recursive:true});
  fs.writeFileSync(filename, typeof value === 'string' ? value : JSON.stringify(value));
};
const packageRoot = 'functions/feature', base = 'modules/boundary/' + packageRoot;
const digest = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
function fixture(t, {browser = false} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smarttwin-package-boundary-')));
  t.after(() => {
    const absolute = fs.realpathSync(root);
    assert.equal(path.dirname(absolute), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith('smarttwin-package-boundary-'));
    const dependencies = path.join(absolute, 'node_modules');
    if (fs.existsSync(dependencies)) {assert.equal(fs.lstatSync(dependencies).isSymbolicLink(), true); fs.unlinkSync(dependencies);}
    fs.rmSync(absolute, {recursive:true});
  });
  for (const folder of ['core','contracts','module-sdk']) fs.cpSync(path.join(SOURCE, 'packages', folder), path.join(root, 'packages', folder), {recursive:true});
  write(root, 'modules/package.json', {type:'module'});
  if (browser) {
    fs.cpSync(path.join(SOURCE, 'packages/render-three'), path.join(root, 'packages/render-three'), {recursive:true, filter:filename => !filename.split(path.sep).includes('vendor')});
    fs.cpSync(path.join(SOURCE, 'apps/project-viewer'), path.join(root, 'apps/project-viewer'), {recursive:true});
    fs.cpSync(path.join(SOURCE, 'tooling/build/loaders'), path.join(root, 'tooling/build/loaders'), {recursive:true});
    fs.symlinkSync(fs.realpathSync(path.join(SOURCE, 'node_modules')), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  return root;
}
function feature(root, metadata = {}) {
  const manifest = {id:'boundary.feature', version:'1.0.0', metadata:{title:'Portable boundary', packageRoot, entry:'index.js', manifestExport:'manifest', files:['index.js','manifest.js'], assets:[], tests:[], ...metadata}};
  const sector = {format:'smarttwin.sector', schemaVersion:1, id:'sector.boundary', version:'1.0.0', metadata:{folder:'boundary'}, functions:[{...manifest, entry:packageRoot + '/index.js'}]};
  write(root, 'modules/boundary/manifest.json', sector);
  write(root, base + '/manifest.js', 'export const manifest=' + JSON.stringify(manifest) + ';\n');
  write(root, base + '/index.js', "import {defineFunction} from '../../../../packages/module-sdk/index.js';import {manifest} from './manifest.js';export default defineFunction({...manifest,register(scope){scope.register('commands','answer',()=>42);}});\n");
  write(root, 'projects/boundary/project.json', {format:'smarttwin.project', version:1, worldId:'world.boundary', modules:[{id:sector.id, version:'1.0.0', functions:[manifest.id]}], entities:[]});
  return manifest;
}

test('portable metadata cannot advertise schema, UI, validators, migrations, tests or media that a copy omits', t => {
  const root = fixture(t);
  for (const [field, value, filename] of [['schema','schema.js','schema.js'],['server','server.js','server.js'],['ui','ui.js','ui.js'],['migration','migrations.js','migrations.js'],['tests',['contract.test.mjs'],'contract.test.mjs'],['assets',['marker.svg'],'marker.svg']]) {
    write(root, base + '/' + filename, 'export const content=42;');
    feature(root, {[field]:value});
    assert.throws(() => discoverLocalModules({root}), {code:'nonportable_function'}, field + ' must be copied with its declaration');
    feature(root, {[field]:value, files:['index.js','manifest.js',filename]});
    assert.equal(discoverLocalModules({root}).catalog.getFunction('boundary.feature').metadata.files.includes(filename), true);
  }
});

test('portable file and reference lists reject duplicates, malformed arrays and unsafe paths before runtime imports', t => {
  const root = fixture(t);
  for (const metadata of [{files:['index.js','manifest.js','index.js']},{files:['index.js','manifest.js','INDEX.js']},{files:['index.js','manifest.js',{}]},{assets:'marker.svg'},{tests:[{}]},{schema:{file:'schema.js'}},{assets:['index.js','index.js']},{tests:['index.js','index.js']}]) {
    feature(root, metadata);
    assert.throws(() => discoverLocalModules({root}), {code:'nonportable_function'});
  }
  for (const unsafe of ['../outside.js','/outside.js','https://host.invalid/helper.js','nested\\helper.js']) {
    feature(root, {files:['index.js','manifest.js',unsafe]});
    assert.throws(() => discoverLocalModules({root}), {code:'discovery_path'});
  }
  feature(root);
  write(root, base + '/index.js', 'globalThis.packageBoundaryPoison=true;throw Error("must not run during discovery");');
  discoverLocalModules({root}); assert.equal(globalThis.packageBoundaryPoison, undefined);
});

test('real compilation rejects a helper missing from the copy allowlist; declaring it yields a complete working copied package', async t => {
  const root = fixture(t, {browser:true}), svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><path d="M0 0h4v4H0z"/></svg>';
  let manifest = feature(root, {assets:['marker.svg'], files:['index.js','manifest.js','marker.svg']});
  write(root, base + '/marker.svg', svg); write(root, base + '/helper.js', 'export const answer=42;\n');
  const source = "import {defineFunction} from '../../../../packages/module-sdk/index.js';import {manifest} from './manifest.js';import {answer} from './helper.js';export default defineFunction({...manifest,register(scope){scope.register('commands','answer',()=>answer);}});\n";
  write(root, base + '/index.js', source);
  assert.throws(() => buildProject({root, projectPath:'projects/boundary/project.json', name:'omitted-helper'}), error => error.code === 'project_dependency' && /undeclared package file: helper\.js/.test(error.message));
  manifest = feature(root, {...manifest.metadata, files:[...manifest.metadata.files,'helper.js']}); write(root, base + '/index.js', source);
  const result = buildProject({root, projectPath:'projects/boundary/project.json', name:'complete-package'});
  assert.ok(result.graph.includes(base + '/helper.js'));
  assert.equal(digest(path.join(result.output, base, 'marker.svg')), digest(path.join(root, base, 'marker.svg')));
  // A portable copy carries exactly metadata.files; no undocumented helper or
  // source-directory fallback can rescue a missing declaration.
  const copiedRoot = 'modules/copied/' + packageRoot, copiedManifest = {...manifest, id:'copied.feature'};
  for (const filename of manifest.metadata.files) write(root, copiedRoot + '/' + filename, fs.readFileSync(path.join(root, base, filename)).toString());
  write(root, copiedRoot + '/manifest.js', 'export const manifest=' + JSON.stringify(copiedManifest) + ';\n');
  write(root, 'modules/copied/manifest.json', {format:'smarttwin.sector', schemaVersion:1, id:'sector.copied', version:'1.0.0', metadata:{folder:'copied'}, functions:[{...copiedManifest, entry:packageRoot + '/index.js'}]});
  const {catalog} = discoverLocalModules({root}), host = createHost({catalog});
  try {
    await host.activate('sector.copied'); assert.equal(await host.dispatch('copied.feature:answer'), 42);
    assert.equal(digest(path.join(root, copiedRoot, 'marker.svg')), digest(path.join(root, base, 'marker.svg')));
    await assert.rejects(host.dispatch('boundary.feature:answer'), {code:'inactive_command'});
  } finally {await host.dispose({force:true});}
});

test('a generic render adapter cannot conceal imports from an unselected sector in a real project bundle', t => {
  const root = fixture(t, {browser:true}); feature(root);
  write(root, 'modules/unselected/manifest.json', {format:'smarttwin.sector', schemaVersion:1, id:'sector.unselected', version:'1.0.0', metadata:{folder:'unselected'}, functions:[]});
  write(root, 'modules/unselected/private.js', 'export const domainValue=7;\n');
  write(root, 'packages/render-three/domain-adapter.js', "export {domainValue} from '../../modules/unselected/private.js';\n");
  write(root, base + '/index.js', "import {defineFunction} from '../../../../packages/module-sdk/index.js';import {manifest} from './manifest.js';import {domainValue} from '../../../../packages/render-three/domain-adapter.js';export default defineFunction({...manifest,register(scope){scope.register('commands','answer',()=>domainValue);}});\n");
  assert.throws(() => buildProject({root, projectPath:'projects/boundary/project.json', name:'hidden-sector'}), error => error.code === 'project_dependency' && /modules\/unselected\/private\.js/.test(error.message));
});
