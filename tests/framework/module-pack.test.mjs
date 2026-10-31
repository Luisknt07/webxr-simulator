import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createModule} from '../../tooling/modules/create-module.mjs';
import {exportModulePack,inspectModulePack,importModulePack,validateModulePack} from '../../tooling/modules/module-pack.mjs';
import {discoverLocalModules} from '../../tooling/modules/discover.mjs';
import {createHost} from '../../packages/core/index.js';

const SOURCE=fileURLToPath(new URL('../../',import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'smarttwin-module-pack-')));fs.mkdirSync(path.join(root,'modules'));fs.mkdirSync(path.join(root,'projects'));
 for(const name of ['core','contracts','module-sdk'])fs.cpSync(path.join(SOURCE,'packages',name),path.join(root,'packages',name),{recursive:true});
 t.after(()=>{const absolute=fs.realpathSync(root);assert.equal(path.dirname(absolute),fs.realpathSync(os.tmpdir()));assert.match(path.basename(absolute),/^smarttwin-module-pack-/);fs.rmSync(absolute,{recursive:true});});return root;
}
function health(root){return createModule({root,sector:'salud',sectorId:'sector.health',folder:'checklist',functionId:'health.checklist',title:'Salud'});}
const packClone=pack=>JSON.parse(JSON.stringify(pack));
const residue=root=>fs.readdirSync(path.join(root,'modules')).filter(name=>name.startsWith('.module-pack'));
function replaceBytes(pack,name,bytes){const row=pack.files.find(row=>row.path===name);assert(row);row.base64=bytes.toString('base64');row.sha256=hash(bytes);row.size=bytes.length;}

test('module packs roundtrip complete trusted code/resources across framework installations without executing it on install',async t=>{
 const source=fixture(t),target=fixture(t),created=health(source);
 const entry=path.join(created.destination,'functions/checklist/index.js');fs.appendFileSync(entry,'\nglobalThis.__packImplementationLoaded = (globalThis.__packImplementationLoaded || 0) + 1;\n');
 const pack=exportModulePack({root:source,moduleId:'sector.health'});assert.equal(globalThis.__packImplementationLoaded,undefined);
 assert.equal(pack.functions.length,1);assert.equal(pack.files.length,13);assert.equal(pack.requires.length,0);
 const inspection=inspectModulePack({root:target,pack});assert.equal(inspection.canInstall,true);assert.equal(inspection.trustRequired,true);
 assert.throws(()=>importModulePack({root:target,pack}),{code:'pack_trust'});assert.deepEqual(fs.readdirSync(path.join(target,'modules')),[]);
 const installed=importModulePack({root:target,pack,trustLocalCode:true});assert.equal(installed.rebuildRequired,true);assert.equal(globalThis.__packImplementationLoaded,undefined);assert.deepEqual(residue(target),[]);
 for(const row of pack.files)assert.equal(hash(fs.readFileSync(path.join(installed.destination,row.path))),row.sha256);
 const discovery=discoverLocalModules({root:target}),host=createHost({catalog:discovery.catalog,worldId:'world.imported'});
 try{await host.activate('sector.health');assert.equal(globalThis.__packImplementationLoaded,1);assert.deepEqual(await host.dispatch('health.checklist:inspect'),{label:'checklist',enabled:true});
 await host.dispatch('health.checklist:configure',{label:'Cambio local',enabled:false});await host.remove('sector.health');await host.activate('sector.health');assert.deepEqual(await host.dispatch('health.checklist:inspect'),{label:'Cambio local',enabled:false});}
 finally{await host.dispose({force:true});delete globalThis.__packImplementationLoaded;}
});

test('export transports declared media exactly, while inspect/import preserve incomplete dependencies as explicit requirements',t=>{
 const source=fixture(t),target=fixture(t),created=health(source),base=path.join(created.destination,'functions/checklist');
 const manifest=JSON.parse(fs.readFileSync(path.join(base,'function-manifest.json')));manifest.requires=[{id:'logistics.storage',version:'^1.0.0'}];manifest.metadata.assets=['assets/sample.bin'];manifest.metadata.files.push('assets/sample.bin');
 fs.mkdirSync(path.join(base,'assets'));fs.writeFileSync(path.join(base,'assets/sample.bin'),Buffer.from([0,255,10,50]));
 fs.writeFileSync(path.join(base,'function-manifest.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(base,'manifest.js'),'export const manifest='+JSON.stringify(manifest)+';');
 const sector=JSON.parse(fs.readFileSync(path.join(created.destination,'manifest.json')));sector.functions[0]={...manifest,entry:'functions/checklist/index.js'};fs.writeFileSync(path.join(created.destination,'manifest.json'),JSON.stringify(sector));
 const pack=exportModulePack({root:source,moduleId:'sector.health'});assert.deepEqual(pack.requires,[{id:'logistics.storage',version:'^1.0.0'}]);assert.deepEqual(Buffer.from(pack.files.find(row=>row.path.endsWith('sample.bin')).base64,'base64'),Buffer.from([0,255,10,50]));
 const inspected=inspectModulePack({root:target,pack});assert.equal(inspected.requirements[0].status,'missing');
 importModulePack({root:target,pack,trustLocalCode:true});const discovered=discoverLocalModules({root:target});assert.throws(()=>discovered.catalog.plan('sector.health'),{code:'missing_function'});assert.deepEqual(residue(target),[]);
});

test('packs reject tampered file hashes, lengths, encoding, extra code, traversal and case-colliding files before writing',t=>{
 const source=fixture(t),target=fixture(t);health(source);const original=exportModulePack({root:source,moduleId:'sector.health'});
 for(const mutate of [pack=>{pack.files[0].sha256='0'.repeat(64);},pack=>{pack.files[0].size++;},pack=>{pack.files[0].base64+='!';}]){const pack=packClone(original);mutate(pack);assert.throws(()=>importModulePack({root:target,pack,trustLocalCode:true}));}
 for(const name of ['../outside.js','functions/checklist/../../outside.js','C:/secret.js','functions\\secret.js','functions/CON.js','functions/.env','functions/name%2f.js']){const pack=packClone(original);pack.files[0].path=name;assert.throws(()=>validateModulePack(pack),{code:'pack_path'});}
 const collision=packClone(original);collision.files.push({...collision.files[0],path:collision.files[0].path.toUpperCase()});assert.throws(()=>validateModulePack(collision),{code:'pack_path'});
 const extra=packClone(original);extra.files.push({path:'surprise.js',size:0,sha256:hash(Buffer.alloc(0)),base64:''});assert.throws(()=>validateModulePack(extra),{code:'pack_manifest'});
 const descriptor=packClone(original);replaceBytes(descriptor,'module.js',Buffer.from('throw Error("run unwanted code");'));assert.throws(()=>validateModulePack(descriptor),{code:'pack_manifest'});
 assert.deepEqual(fs.readdirSync(path.join(target,'modules')),[]);
});

test('a selected root brings its required same-sector functions without enabling unrelated copied defaults',t=>{
 const source=fixture(t),created=health(source),base=path.join(created.destination,'functions/checklist'),provider=path.join(created.destination,'functions/provider');
 fs.cpSync(base,provider,{recursive:true});const functionManifest=JSON.parse(fs.readFileSync(path.join(provider,'function-manifest.json')));functionManifest.id='health.provider';functionManifest.metadata.packageRoot='functions/provider';
 fs.writeFileSync(path.join(provider,'function-manifest.json'),JSON.stringify(functionManifest));fs.writeFileSync(path.join(provider,'manifest.js'),'export const manifest='+JSON.stringify(functionManifest)+';');
 const consumer=JSON.parse(fs.readFileSync(path.join(base,'function-manifest.json')));consumer.requires=[{id:'health.provider',version:'1.0.0'}];
 fs.writeFileSync(path.join(base,'function-manifest.json'),JSON.stringify(consumer));fs.writeFileSync(path.join(base,'manifest.js'),'export const manifest='+JSON.stringify(consumer)+';');
 const sector=JSON.parse(fs.readFileSync(path.join(created.destination,'manifest.json')));sector.functions=[{...consumer,entry:'functions/checklist/index.js'}];fs.writeFileSync(path.join(created.destination,'manifest.json'),JSON.stringify(sector));
 const pack=exportModulePack({root:source,moduleId:'sector.health',functions:['health.checklist']});assert.deepEqual(pack.functions.map(fn=>fn.id),['health.provider','health.checklist']);assert.deepEqual(pack.requires,[]);assert.deepEqual(pack.module.functions.map(fn=>fn.id),['health.checklist']);
 const target=fixture(t);importModulePack({root:target,pack,trustLocalCode:true});const discovered=discoverLocalModules({root:target});assert.deepEqual(discovered.modules[0].defaultFunctions,['health.checklist']);assert.deepEqual(discovered.catalog.plan('sector.health').functions.map(fn=>fn.id),['health.provider','health.checklist']);
 assert.throws(()=>exportModulePack({root:source,moduleId:'sector.health',functions:['foreign.feature']}),{code:'pack_selection'});
});

test('install rejects existing folders and namespaces, dangling links, linked module parents and incompatible core versions',t=>{
 const source=fixture(t),target=fixture(t);health(source);const pack=exportModulePack({root:source,moduleId:'sector.health'});health(target);
 const before=hash(fs.readFileSync(path.join(target,'modules/salud/manifest.json')));assert.equal(inspectModulePack({root:target,pack}).canInstall,false);assert.throws(()=>importModulePack({root:target,pack,trustLocalCode:true}),{code:'pack_conflict'});assert.equal(hash(fs.readFileSync(path.join(target,'modules/salud/manifest.json'))),before);
 const linked=fixture(t),outside=path.join(linked,'outside');fs.mkdirSync(outside);const destination=path.join(linked,'modules/salud');fs.symlinkSync(path.join(outside,'absent'),destination,process.platform==='win32'?'junction':'dir');
 try{assert.throws(()=>importModulePack({root:linked,pack,trustLocalCode:true}));}finally{fs.unlinkSync(destination);}
 const originalModules=path.join(linked,'modules');fs.renameSync(originalModules,originalModules+'-real');fs.symlinkSync(outside,originalModules,process.platform==='win32'?'junction':'dir');
 try{assert.throws(()=>importModulePack({root:linked,pack,trustLocalCode:true}),{code:'discovery_link'});assert.deepEqual(fs.readdirSync(outside),[]);}finally{fs.unlinkSync(originalModules);fs.renameSync(originalModules+'-real',originalModules);}
 const incompatible=packClone(pack);incompatible.module.coreApi='^99.0.0';assert.throws(()=>validateModulePack(incompatible),{code:'pack_core'});
});

test('a failed publication cleans only its staged files and never removes a concurrently-created destination or someone else lock',t=>{
 const source=fixture(t),target=fixture(t);health(source);const pack=exportModulePack({root:source,moduleId:'sector.health'}),rename=fs.renameSync;
 fs.renameSync=(from,to)=>{if(path.basename(to)==='salud'){fs.mkdirSync(to);fs.writeFileSync(path.join(to,'user.txt'),'preserve');throw Error('Publish failed');}return rename(from,to);};
 try{assert.throws(()=>importModulePack({root:target,pack,trustLocalCode:true}),/Publish failed/);}finally{fs.renameSync=rename;}
 assert.equal(fs.readFileSync(path.join(target,'modules/salud/user.txt'),'utf8'),'preserve');assert.deepEqual(residue(target),[]);
 const locked=fixture(t),lock=path.join(locked,'modules/.module-pack-install.lock');fs.writeFileSync(lock,'another-owner');
 assert.throws(()=>importModulePack({root:locked,pack,trustLocalCode:true}),{code:'pack_busy'});assert.equal(fs.readFileSync(lock,'utf8'),'another-owner');
});
