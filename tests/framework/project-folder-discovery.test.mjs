import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createContentProject,CONTENT_PROJECT_FILE} from '../../packages/project-format/index.js';
import {writeContentFolder} from '../../tooling/projects/content-project.mjs';
import {readLocalProject,resolveProjectComposition,writeProjectComposition} from '../../tooling/modules/discover.mjs';
const SOURCE=fileURLToPath(new URL('../../',import.meta.url));
const write=(root,name,value)=>{const filename=path.join(root,name);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,typeof value==='string'?value:JSON.stringify(value));};
function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'smarttwin-folder-discovery-')));t.after(()=>{const target=fs.realpathSync(root);assert.equal(path.dirname(target),fs.realpathSync(os.tmpdir()));assert(path.basename(target).startsWith('smarttwin-folder-discovery-'));fs.rmSync(target,{recursive:true,force:true});});
  for(const folder of ['core','contracts','module-sdk'])fs.cpSync(path.join(SOURCE,'packages',folder),path.join(root,'packages',folder),{recursive:true});
  write(root,'modules/package.json',{type:'module'});
  for(const folder of ['agricultura','logistica-industrial','turismo']){
    const manifest=JSON.parse(fs.readFileSync(path.join(SOURCE,'modules',folder,'manifest.json'),'utf8'));write(root,`modules/${folder}/manifest.json`,manifest);
    for(const fn of manifest.functions)for(const file of fn.metadata.files){const source=path.join(SOURCE,'modules',folder,fn.metadata.packageRoot,file),destination=path.join(root,'modules',folder,fn.metadata.packageRoot,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);}
  }
  write(root,'modules/turismo/functions/recorridos/index.js','globalThis.folderDiscoveryPoison=true;throw Error("An unselected runtime was loaded");');
  fs.mkdirSync(path.join(root,'projects'));return root;
}
const project=()=>({format:'smarttwin.project',version:1,id:'project.farm',worldId:'world.farm',modules:[{id:'sector.agriculture',version:'1.0.0',functions:['agriculture.harvest']},{id:'sector.tourism',version:'1.0.0',enabled:false}],entities:[{id:'missing',components:[{functionId:'future.feature',functionVersion:'9.0.0',type:'future.feature:data',schemaVersion:7,data:{code:'globalThis.folderDiscoveryPoison=true'}}]}]});
const state=()=>({format:'smarttwin.module-state',version:1,worldId:'world.farm',functions:[{id:'future.feature',version:'9.0.0',schemaVersion:7,data:{keep:{unknown:true}}}]});

test('the local engine recognizes an independent folder descriptor, preserves module state and selects only required functions',async t=>{
  const root=fixture(t),folder=path.join(root,'projects/finca');writeContentFolder(createContentProject(project(),{name:'Finca independiente',moduleState:state()}),folder);
  const input=readLocalProject({root,projectPath:'projects/finca/'+CONTENT_PROJECT_FILE});assert.deepEqual(input.project,project());assert.deepEqual(input.moduleState,state());assert.equal(input.contentDescriptor.name,'Finca independiente');
  const resolved=resolveProjectComposition({root,projectPath:'projects/finca'});assert.deepEqual(resolved.project,project());assert.deepEqual(resolved.moduleState,state());assert.deepEqual(resolved.functions.map(row=>row.id).sort(),['agriculture.harvest','logistics.storage']);assert.equal(globalThis.folderDiscoveryPoison,undefined);
  const generated=writeProjectComposition({root,projectPath:'projects/finca/'+CONTENT_PROJECT_FILE,name:'independent-farm'}),catalog=fs.readFileSync(generated.catalog,'utf8');assert.doesNotMatch(catalog,/import\([^)]*turismo/);
  const bootstrap=await import(pathToFileURL(generated.bootstrap).href),host=await bootstrap.createComposedHost();assert.deepEqual(host.status().functions.map(row=>row.id).sort(),['agriculture.harvest','logistics.storage']);assert.deepEqual(host.exportState().functions.find(row=>row.id==='future.feature'),state().functions[0]);await host.dispose();
  const session=await bootstrap.createComposedSession();assert.deepEqual(session.capture().state.functions.find(row=>row.id==='future.feature'),state().functions[0]);await session.dispose();assert.equal(globalThis.folderDiscoveryPoison,undefined);
});
test('session descriptors and standalone session JSON preserve their project and opaque state without treating it as code',t=>{
  const root=fixture(t),session={format:'smarttwin.project-session',version:1,project:project(),state:state(),pausedModules:[],allowOptionalMissing:true};
  writeContentFolder(createContentProject(session),path.join(root,'projects/session'));const folder=readLocalProject({root,projectPath:'projects/session'});assert.deepEqual(folder.project,project());assert.deepEqual(folder.moduleState,state());
  write(root,'projects/session.json',session);assert.deepEqual(readLocalProject({root,projectPath:'projects/session.json'}),{project:project(),moduleState:state()});assert.equal(globalThis.folderDiscoveryPoison,undefined);
  write(root,'projects/unsupported-session.json',{...session,version:2});assert.throws(()=>readLocalProject({root,projectPath:'projects/unsupported-session.json'}),{code:'invalid_project'});
});
test('bad checksums, linked folders and outside paths fail before any selected runtime is imported',t=>{
  const root=fixture(t),folder=path.join(root,'projects/finca');writeContentFolder(createContentProject(project()),folder);
  const filename=path.join(folder,'Content/Maps/main.level.json'),level=JSON.parse(fs.readFileSync(filename,'utf8'));level.data.entities=[];fs.writeFileSync(filename,JSON.stringify(level));
  assert.throws(()=>resolveProjectComposition({root,projectPath:'projects/finca'}),{code:'content_hash'});assert.equal(globalThis.folderDiscoveryPoison,undefined);
  const linked=path.join(root,'projects/linked');fs.symlinkSync(folder,linked,process.platform==='win32'?'junction':'dir');assert.throws(()=>readLocalProject({root,projectPath:'projects/linked'}),{code:'discovery_link'});
  for(const projectPath of ['../outside/project.stproject',folder,'https://example.invalid/project.stproject','projects/finca/../project.stproject'])assert.throws(()=>readLocalProject({root,projectPath}),{code:'discovery_path'});
});
test('descriptor content paths cannot escape the project and studio projects receive a clear editor-only instruction',t=>{
  const root=fixture(t),folder=path.join(root,'projects/finca');writeContentFolder(createContentProject(project()),folder);
  const descriptorPath=path.join(folder,CONTENT_PROJECT_FILE),descriptor=JSON.parse(fs.readFileSync(descriptorPath,'utf8'));descriptor.files[0].path='Content/Maps/../../../secret.json';fs.writeFileSync(descriptorPath,JSON.stringify(descriptor));assert.throws(()=>readLocalProject({root,projectPath:'projects/finca'}),{code:'content_path'});
  const studio={format:'hello-webxr-editor',version:1,rooms:{hall:{overrides:[],additions:[]}},imports:[],studio:{scenes:[{id:'hall',name:'Nave industrial'}],startRoomId:'hall'}};writeContentFolder(createContentProject(studio),path.join(root,'projects/industrial'));
  assert.throws(()=>readLocalProject({root,projectPath:'projects/industrial'}),error=>error.code==='project_editor_required'&&/editor industrial/.test(error.message));assert.equal(globalThis.folderDiscoveryPoison,undefined);
});
