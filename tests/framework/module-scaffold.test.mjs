import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createModule} from '../../tooling/modules/create-module.mjs';
import {discoverLocalModules, writeProjectComposition} from '../../tooling/modules/discover.mjs';
import {buildProject} from '../../tooling/build/project.mjs';

const SOURCE = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const hash = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smarttwin-scaffold-')));
  fs.mkdirSync(path.join(root, 'modules')); fs.mkdirSync(path.join(root, 'projects'));
  for (const name of ['core', 'contracts', 'module-sdk']) fs.cpSync(path.join(SOURCE, 'packages', name), path.join(root, 'packages', name), {recursive: true});
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(root), /^smarttwin-scaffold-/);
    fs.rmSync(root, {recursive: true});
  });
  return root;
}
const options = root => ({root, sector:'salud', sectorId:'sector.health', folder:'checklist', functionId:'health.checklist', title:'Salud', functionTitle:'Lista de verificación', projectName:'salud'});
const debris = root => ['modules','projects'].flatMap(parent => fs.readdirSync(path.join(root,parent)).filter(name => name.startsWith('.create-')));

test('scaffold creates a complete discoverable sector and isolated lifecycle without loading unrelated code', async t => {
  const root = fixture(t), before = hash(path.join(root,'packages/core/host.js'));
  const result = createModule(options(root));
  assert.equal(result.projectPath, 'projects/salud/project.json');
  assert.deepEqual(debris(root), []);
  const discovered = discoverLocalModules({root});
  assert.deepEqual(discovered.modules.map(module => module.id), ['sector.health']);
  const feature = discovered.catalog.getFunction('health.checklist');
  assert.equal(feature.metadata.files.length, 9);
  for (const name of feature.metadata.files) assert(fs.statSync(path.join(result.destination,'functions/checklist',name)).isFile());
  assert(feature.metadata.files.includes(feature.metadata.schema)); assert(feature.metadata.files.includes(feature.metadata.server));
  assert(feature.metadata.files.includes(feature.metadata.ui)); assert(feature.metadata.files.includes(feature.metadata.migration));
  const descriptor = (await import(pathToFileURL(path.join(result.destination,'module.js')).href)).default;
  assert.equal(descriptor.functions[0].id, feature.id);
  const generated = writeProjectComposition({root,projectPath:result.projectPath,name:'health'});
  const source = fs.readFileSync(generated.catalog,'utf8');
  assert.doesNotMatch(source,/logistica|turismo|apps\/workspace|modules\/catalog/);
  const host = await (await import(pathToFileURL(generated.bootstrap).href)).createComposedHost();
  try {
    assert.deepEqual(host.status().functions.map(entry=>entry.id), ['health.checklist']);
    assert.deepEqual(await host.dispatch('health.checklist:inspect'), {label:'Lista de verificación',enabled:true});
    await host.dispatch('health.checklist:configure',{label:'Inspección de ingreso',enabled:false});
    await host.pause('sector.health');
    await assert.rejects(host.dispatch('health.checklist:configure',{label:'No ejecutar',enabled:true}), {code:'inactive_command'});
    await host.activate('sector.health');
    assert.deepEqual(await host.dispatch('health.checklist:inspect'), {label:'Inspección de ingreso',enabled:false});
    await host.remove('sector.health');
    assert.equal(host.registry('commands').length, 0); assert.equal(host.status().functions.length, 0);
    assert.equal(host.exportState().functions[0].data.label, 'Inspección de ingreso');
    await host.activate('sector.health');
    assert.equal((await host.dispatch('health.checklist:inspect')).label, 'Inspección de ingreso');
    const ui = host.registry('ui')[0]; assert.equal(ui.functionId, 'health.checklist');
    assert.equal(host.registry('server-validators')[0].value.authorize({authenticated:true,permissions:['health.checklist.write']}),true);
    assert.equal(host.registry('server-validators')[0].value.authorize({authenticated:false,permissions:['health.checklist.write']}),false);
  } finally {await host.dispose({force:true});}
  assert.equal(hash(path.join(root,'packages/core/host.js')), before);
  const contracts = spawnSync(process.execPath,['--test',path.join(result.destination,'functions/checklist/contract.test.mjs')],{encoding:'utf8',windowsHide:true});
  assert.equal(contracts.status,0,contracts.stderr+'\n'+contracts.stdout);
});

test('scaffold never overwrites existing sectors/projects or duplicates installed identities', t => {
  const root = fixture(t), result = createModule(options(root));
  const sectorManifest = hash(path.join(result.destination,'manifest.json')), project = hash(path.join(root,result.projectPath));
  assert.throws(()=>createModule(options(root)), {code:'scaffold_exists'});
  assert.throws(()=>createModule({...options(root),sector:'otra',projectName:'otro'}), {code:'duplicate_id'});
  assert.throws(()=>createModule({...options(root),sector:'otra',sectorId:'sector.other',projectName:'otro'}), {code:'duplicate_id'});
  assert.throws(()=>createModule({...options(root),sector:'otra',sectorId:'sector.other',functionId:'other.feature'}), {code:'scaffold_exists'});
  assert.equal(hash(path.join(result.destination,'manifest.json')),sectorManifest);
  assert.equal(hash(path.join(root,result.projectPath)),project);
  assert(!fs.existsSync(path.join(root,'modules/otra')));
  assert.deepEqual(debris(root),[]);
});

test('scaffold rejects traversal, malformed identity/version, code-like folder inputs and links before writing', t => {
  const root = fixture(t);
  for (const name of ['../salud','Salud','a/b','a\\b','x%2fy','x?y','c:salud','', '.hidden']) {
    for (const field of ['sector','folder','projectName']) assert.throws(()=>createModule({...options(root),[field]:name}),{code:'scaffold_path'});
  }
  assert.throws(()=>createModule({...options(root),sectorId:'health'}),{code:'invalid_id'});
  assert.throws(()=>createModule({...options(root),functionId:'(()=>run())'}),{code:'invalid_id'});
  assert.throws(()=>createModule({...options(root),version:'01.0.0'}),{code:'invalid_version'});
  assert.throws(()=>createModule({...options(root),title:'one\ntwo'}),{code:'scaffold_title'});
  const outside = path.join(root,'outside'); fs.mkdirSync(outside);
  for (const parent of ['modules','projects']) {
    const original = path.join(root,parent), saved = path.join(root,parent+'-real'); fs.renameSync(original,saved);
    fs.symlinkSync(outside,original,process.platform==='win32'?'junction':'dir');
    try {assert.throws(()=>createModule(options(root)),{code:'discovery_link'});assert.deepEqual(fs.readdirSync(outside),[]);}
    finally {fs.unlinkSync(original);fs.renameSync(saved,original);}
  }
  const dangling = path.join(root,'modules/salud');
  fs.symlinkSync(path.join(outside,'missing'),dangling,process.platform==='win32'?'junction':'dir');
  try {assert.equal(fs.existsSync(dangling),false);assert.throws(()=>createModule(options(root)),{code:'scaffold_exists'});}
  finally {fs.unlinkSync(dangling);}
  assert.deepEqual(debris(root),[]);
});

test('scaffold rolls back its own staged/published files when an optional project cannot be committed', t => {
  const root = fixture(t), originalRename = fs.renameSync;
  const destination = path.join(root,'projects/salud');
  let rejected = false;
  fs.renameSync = (from,to,...args) => {
    if (to===destination && !rejected) {rejected=true;throw Object.assign(new Error('Injected project publication failure'),{code:'EIO'});}
    return originalRename(from,to,...args);
  };
  try {assert.throws(()=>createModule(options(root)),{code:'EIO'});}
  finally {fs.renameSync = originalRename;}
  assert.equal(rejected,true);
  assert(!fs.existsSync(path.join(root,'modules/salud')));assert(!fs.existsSync(destination));
  assert.deepEqual(debris(root),[]);
  assert.doesNotThrow(()=>createModule(options(root)));
});

test('scaffold locking does not remove another operation\'s lock or expose a partial manifest', t => {
  const root = fixture(t), filename = path.join(root,'modules/.create-modules.lock');
  fs.writeFileSync(filename,'another operation');
  try {assert.throws(()=>createModule(options(root)),{code:'EEXIST'});assert.equal(fs.readFileSync(filename,'utf8'),'another operation');}
  finally {fs.unlinkSync(filename);}
  assert(!fs.existsSync(path.join(root,'modules/salud')));assert(!fs.existsSync(path.join(root,'projects/salud')));
  // A sector can also be created without introducing any project folder.
  const noProject = {...options(root)};delete noProject.projectName;
  const result = createModule(noProject);assert.equal(result.projectPath,undefined);assert.deepEqual(fs.readdirSync(path.join(root,'projects')),[]);
});

test('rollback preserves a published sector if another actor has changed its tree', t => {
  const root = fixture(t), originalRename=fs.renameSync, sector=path.join(root,'modules/salud'), extra=path.join(sector,'user-content');
  fs.renameSync=(from,to,...args)=>{
    if(to===path.join(root,'projects/salud')) {fs.mkdirSync(extra);throw Object.assign(new Error('Injected concurrent project failure'),{code:'EIO'});}
    return originalRename(from,to,...args);
  };
  try {assert.throws(()=>createModule(options(root)),error=>error.code==='EIO'&&error.scaffoldPreserved===sector);}
  finally {fs.renameSync=originalRename;}
  assert(fs.statSync(extra).isDirectory());assert(fs.statSync(path.join(sector,'manifest.json')).isFile());
  assert.deepEqual(debris(root),[]);assert(!fs.existsSync(path.join(root,'projects/salud')));
});

test('CLI rejects incomplete, duplicate and unknown options before writing any scaffold', () => {
  const command=path.join(SOURCE,'tooling/modules/create-module.mjs');
  for(const args of [[],['--sector'],['--unknown','value'],['--sector','one','--sector','two']]) {
    const result=spawnSync(process.execPath,[command,...args],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,1);assert.match(result.stderr,/scaffold_(?:usage|path):/);
    assert.equal(result.stdout,'');
  }
});

test('a scaffolded sector compiles as a lean real browser project with only its own runtime', () => {
  const suffix = randomUUID().slice(0,8), sector = 'scaffold-proof-'+suffix, functionId = `proof-${suffix}.settings`;
  let receipt, built;
  const cleanup = (parent, target, prefix) => {
    const resolvedParent=fs.realpathSync(parent), absolute=fs.realpathSync(target);
    assert.equal(path.dirname(absolute),resolvedParent);assert(path.basename(absolute).startsWith(prefix));
    assert.equal(fs.lstatSync(absolute).isSymbolicLink(),false);fs.rmSync(absolute,{recursive:true});
  };
  try {
    receipt=createModule({root:SOURCE,sector,sectorId:`sector.proof-${suffix}`,folder:'settings',functionId,projectName:sector});
    built=buildProject({root:SOURCE,projectPath:receipt.projectPath,name:sector});
    assert.deepEqual(built.functions,[functionId]);
    const domain=built.graph.filter(name=>name.startsWith('modules/'));
    assert(domain.length>0);assert(domain.every(name=>name.startsWith(`modules/${sector}/functions/settings/`)));
    assert(!built.graph.some(name=>/apps\/workspace|packages\/tools|modules\/catalog|logistica-industrial/.test(name)));
    for(const file of built.files) assert.equal(hash(path.join(built.output,file.path)),file.sha256);
  } finally {
    if(built) {cleanup(path.join(SOURCE,'artifacts/projects'),built.output,sector);cleanup(path.join(SOURCE,'data/build/compositions'),built.generated,sector);}
    if(receipt) {cleanup(path.join(SOURCE,'projects'),receipt.projectDestination,sector);cleanup(path.join(SOURCE,'modules'),receipt.destination,sector);}
  }
});
