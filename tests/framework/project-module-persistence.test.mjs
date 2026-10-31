import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createLocalCatalog,createProjectSession} from '../../packages/core/index.js';
import {cloneData} from '../../packages/contracts/index.js';
import {discoverLocalModules} from '../../tooling/modules/discover.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url),profileSchema=require('../../packages/project-model/shared/project-module-profile.js'),studioSchema=require('../../packages/project-model/shared/studio-document.js');
const managerSource=fs.readFileSync(path.join(root,'packages/tools/editor/src/ProjectModuleManager.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class ProjectModuleManager','return class ProjectModuleManager');
const Manager=new Function('createLocalCatalog','createProjectSession','cloneData','profileSchema','renderPanel',managerSource)(createLocalCatalog,createProjectSession,cloneData,profileSchema,()=>()=>{});
const editorSource=fs.readFileSync(path.join(root,'packages/tools/editor/src/SceneEditor.js'),'utf8');
function method(name,next,globals={}){
  const start=editorSource.indexOf('  async '+name+'('),end=editorSource.indexOf('\n  async '+next+'(',start);assert(start>=0&&end>start);
  return new Function(...Object.keys(globals),'return ({'+editorSource.slice(start,end).trim()+'})['+JSON.stringify(name)+'];')(...Object.values(globals));
}
const tabsSource=fs.readFileSync(path.join(root,'packages/tools/editor/src/ProjectWorkspaceTabs.js'),'utf8').replace('export default class ProjectWorkspaceTabs','return class ProjectWorkspaceTabs');
const Tabs=new Function('document',tabsSource)(undefined);
function documentData(e){return {format:'hello-webxr-editor',version:1,rooms:{hall:{additions:[],overrides:[]}},imports:[],studio:cloneData(e.document.studio)};}
async function fixture(t){
  const e={active:true,permission:true,dirty:false,changeVersion:0,projectGeneration:1,currentProject:{id:'project.persistence',revision:1,access:{role:'owner',canEdit:true}},projectName:'Finca',roomId:'hall',messages:[],ctx:{vrMode:false,studio:{client:{user:{id:'owner-one'}}}},accessView:{identityGeneration:1}};
  const moduleProfile=profileSchema.normalizeModuleProfile({version:1,mode:'mixed',selectedModuleId:'',modules:[{id:'sector.agriculture',version:'1.0.0',functions:['agriculture.harvest'],editorEnabled:true,viewerEnabled:true}]});
  e.document={studio:studioSchema.normalize({version:1,moduleProfile}),rooms:new Map([['hall',{}]]),undoStack:[],redoStack:[],setStudio(patch){this.studio=studioSchema.normalize({...this.studio,...patch});e.dirty=true;e.changeVersion++;this.undoStack.push(documentData(e));},capture(){return documentData(e);},async serialize(){return documentData(e);}};
  e.canEditDocument=()=>e.permission;e.toast=text=>e.messages.push(text);e.updateStatus=()=>{};e.scopedStorageKey=key=>'owner-one:'+key;e.library={async exportPortableImports(){return [];}};
  e.applyServerProject=async()=>{};e.openServerProject=async()=>{};e.saveProject=async()=>({id:e.currentProject.id,revision:2});
  const manager=new Manager(e,{catalog:discoverLocalModules({root}).catalog});e.projectModules=manager;t.after(()=>manager.dispose());await manager.sync({viewer:false});
  await manager.session.dispatch('logistics.storage:transaction',{operations:[{type:'add-location',location:{id:'field',capacityKg:100,maxLoads:5}}]});manager.flush();e.dirty=false;
  return {e,manager,async record(id='eight'){await manager.session.dispatch('agriculture.harvest:record',{id,crop:'mango',lot:'lot-eight',harvestDate:'2026-10-30',locationId:'field',quantity:8,massKg:12});}};
}
async function assertEight(document){
  const e={active:true,permission:true,projectGeneration:1,currentProject:{id:'reopened'},document:{studio:document.studio},canEditDocument:()=>true,toast(){}};
  const manager=new Manager(e,{catalog:discoverLocalModules({root}).catalog});try{await manager.sync({viewer:false});assert.equal((await manager.session.dispatch('agriculture.harvest:harvests'))[0].quantity,8);}finally{await manager.dispose();}
}

test('switching projects flushes live modular changes before consulting the legacy dirty flag',async t=>{
  const {e,record}=await fixture(t);await record();assert.equal(e.dirty,false);let saved,calls=0;
  e.saveProject=async()=>{calls++;saved=await e.document.serialize();e.dirty=false;return {id:e.currentProject.id,revision:2};};
  assert.equal(await method('keepCurrentProject','openServerProject').call(e),true);assert.equal(calls,1);await assertEight(saved);
});

test('local browser saves and legacy JSON exports include live modular state even before the document was dirty',async t=>{
  const {e,record}=await fixture(t);await record();const stored=[];
  const save=method('saveLocal','exportProject',{localStorage:{setItem(key,value){stored.push({key,value});}},STORAGE_KEY:'editor'});await save.call(e);assert.equal(stored.length,1);await assertEight(JSON.parse(stored[0].value));
  // Exercise the separate legacy export boundary with a fresh unflushed state.
  const another=await fixture(t);await another.record();assert.equal(another.e.dirty,false);let downloaded;
  class DownloadBlob{constructor(parts){downloaded=parts[0];}}
  const exportJSON=method('exportProject','importProjectContent',{URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},Blob:DownloadBlob,el:()=>({click(){}}),setTimeout:callback=>callback()});
  await exportJSON.call(another.e);assert.equal(typeof downloaded,'string');await assertEight(JSON.parse(downloaded));
});

test('workspace tabs stash flushed modular state and capture the post-flush change version',async t=>{
  const {e,record}=await fixture(t);await record();assert.equal(e.dirty,false);const tabs=new Tabs(e);t.after(()=>tabs.dispose());const before=e.changeVersion,entry=await tabs.stash();
  assert(e.changeVersion>before);assert.equal(entry.changeVersion,e.changeVersion);assert.equal(entry.dirty,true);assert.deepEqual(entry.snapshot.studio.moduleProfile.state,entry.serialized.studio.moduleProfile.state);await assertEight(entry.serialized);
});

test('UI dispatch marks authored logical changes dirty, while viewer practice never flushes authored data',async t=>{
  const {e,manager}=await fixture(t);await manager.dispatch('agriculture.harvest:record',{id:'ui-eight',crop:'mango',lot:'lot-ui',harvestDate:'2026-10-30',locationId:'field',quantity:8,massKg:12});assert.equal(e.dirty,true);await assertEight(await e.document.serialize());
  const authored=cloneData(e.document.studio),version=e.changeVersion;e.active=false;e.permission=false;await manager.sync({viewer:true});await manager.dispatch('agriculture.harvest:record',{id:'viewer-eight',crop:'mango',lot:'lot-viewer',harvestDate:'2026-10-30',locationId:'field',quantity:8,massKg:12});assert.deepEqual(e.document.studio,authored);assert.equal(e.changeVersion,version);
});

test('a command resolving after account identity changes cannot flush into the next account or reuse its transient state',async t=>{
  const {e,manager}=await fixture(t),authored=cloneData(e.document.studio),version=e.changeVersion;
  const operation=manager.dispatch('agriculture.harvest:record',{id:'account-eight',crop:'mango',lot:'lot-account',harvestDate:'2026-10-30',locationId:'field',quantity:8,massKg:12});
  e.ctx.studio.client.user={id:'owner-two'};e.accessView.identityGeneration++;await operation;
  assert.deepEqual(e.document.studio,authored);assert.equal(e.changeVersion,version);assert.equal(manager.flush(),false);
  await manager.sync({viewer:false});assert.deepEqual(await manager.session.dispatch('agriculture.harvest:harvests'),[]);
});

test('saving immediately after restoring undo history cannot overwrite restored authored state with a stale live host',async t=>{
  const {e,manager}=await fixture(t),before=cloneData(e.document.studio);let saved;
  await manager.dispatch('agriculture.harvest:record',{id:'undo-eight',crop:'mango',lot:'lot-undo',harvestDate:'2026-10-30',locationId:'field',quantity:8,massKg:12});
  assert.equal((await manager.session.dispatch('agriculture.harvest:harvests'))[0].quantity,8);
  // SceneDocument.undo restores its prior captured Studio value. Do not give
  // the application a frame to synchronize the portable host before Save.
  e.document.studio=studioSchema.normalize(before);e.dirty=true;e.changeVersion++;
  const restored=cloneData(e.document.studio.moduleProfile.state);assert.equal(manager.flush(),false);assert.deepEqual(e.document.studio.moduleProfile.state,restored);
  await assert.rejects(manager.dispatch('agriculture.harvest:harvests'),/configuración del proyecto cambió/);
  e.saveProject=async()=>{saved=await e.document.serialize();e.dirty=false;return {id:e.currentProject.id,revision:2};};
  assert.equal(await method('keepCurrentProject','openServerProject').call(e),true);assert.deepEqual(saved.studio.moduleProfile.state,restored);
  await manager.sync({viewer:false});assert.deepEqual(await manager.session.dispatch('agriculture.harvest:harvests'),[]);
  // Equivalent normalization, in contrast, must still save fresh live data.
  const equivalent=await fixture(t);await equivalent.record();equivalent.e.document.studio=studioSchema.normalize({...equivalent.e.document.studio});assert.equal(equivalent.manager.flush(),true);await assertEight(await equivalent.e.document.serialize());
});
