import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createLocalCatalog,createProjectSession} from '../../packages/core/index.js';
import {cloneData} from '../../packages/contracts/index.js';
import {createModule} from '../../tooling/modules/create-module.mjs';
import {writeWorkspaceCatalog} from '../../tooling/modules/workspace-catalog.mjs';
import {discoverLocalModules} from '../../tooling/modules/discover.mjs';
import {createContentProject,readContentProject} from '../../packages/project-format/index.js';

const root=fileURLToPath(new URL('../../',import.meta.url)),profileSchema=createRequire(import.meta.url)('../../packages/project-model/shared/project-module-profile.js');
const {normalizeModuleProfile,enabledModules}=profileSchema;
const source=fs.readFileSync(path.join(root,'packages/tools/editor/src/ProjectModuleManager.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class ProjectModuleManager','return class ProjectModuleManager');
const Manager=new Function('createLocalCatalog','createProjectSession','cloneData','profileSchema','renderPanel',source)(createLocalCatalog,createProjectSession,cloneData,profileSchema,()=>()=>{});
const feature=id=>({id,version:'1.0.0',metadata:{title:id},load:async()=>({id,version:'1.0.0',metadata:{title:id},register(scope){scope.state.set(scope.state.get()||{value:0});scope.register('commands','read',()=>scope.state.get());scope.register('commands','configure',value=>{scope.state.set(value);return scope.state.get();});}})});
const catalog=[{id:'sector.farm',version:'1.0.0',metadata:{title:'Agricultura'},functions:[feature('farm.data')]},{id:'sector.food',version:'1.0.0',metadata:{title:'Alimentos'},functions:[feature('food.data')]}];
function editor(profile){const value={active:true,projectGeneration:1,currentProject:{id:'project-one'},messages:[],writes:0,permission:true};value.document={studio:profile===undefined?{}:{moduleProfile:normalizeModuleProfile(profile)},setStudio(patch){this.studio={...this.studio,...cloneData(patch)};value.writes++;}};value.canEditDocument=()=>value.permission;value.toast=text=>value.messages.push(text);return value;}
const configured=()=>({version:1,mode:'mixed',selectedModuleId:'',modules:[{id:'sector.farm',version:'1.0.0',functions:['farm.data'],editorEnabled:true,viewerEnabled:true},{id:'sector.food',version:'1.0.0',functions:['food.data'],editorEnabled:true,viewerEnabled:false}]});

test('profile data preserves unknown configuration and validates availability, state and specialized selection',()=>{
 const input={...configured(),extra:{nested:['keep',{unknown:true}]}},normalized=normalizeModuleProfile(input);assert.deepEqual(normalized.extra,input.extra);assert.equal(enabledModules(normalized,{viewer:true}).length,1);assert.equal(enabledModules(normalized,{viewer:false}).length,2);
 for(const bad of [{...input,mode:'specialized'},{...input,selectedModuleId:'sector.missing'},{...input,modules:[{id:'sector.farm',version:'1.0.0',editorEnabled:'yes'}]},{...input,modules:[{id:'sector.farm',version:'1.0.0',optional:'yes'}]}])assert.throws(()=>normalizeModuleProfile(bad));
 assert.throws(()=>normalizeModuleProfile({...input,worldId:'world.one',state:{format:'smarttwin.module-state',version:1,worldId:'world.two',functions:[]}}));
 assert.throws(()=>normalizeModuleProfile(JSON.parse('{"version":1,"mode":"mixed","modules":[],"__proto__":{"pollute":true}}')));
});

test('author profile activates only selected roots and removes/readds them with state and separate edit/view availability',async()=>{
 const e=editor(),manager=new Manager(e,{catalog});await manager.sync({viewer:false});assert.equal(manager.session.host.status().functions.length,0);assert.equal(manager.flush(),false);assert.equal(e.writes,0);
 await manager.enableModule('sector.farm');assert.deepEqual(manager.session.host.status().functions.map(fn=>fn.id),['farm.data']);
 await manager.session.dispatch('farm.data:configure',{value:12});assert.equal(manager.flush(),true);assert.equal(manager.flush(),false);
 await manager.setModuleEnabled('sector.farm',{editorEnabled:false,viewerEnabled:true});assert.equal(manager.session.host.status().functions.length,0);assert.equal(manager.canShowLevel('sector.farm'),false);
 await manager.setModuleEnabled('sector.farm',{editorEnabled:true});assert.deepEqual(await manager.session.dispatch('farm.data:read'),{value:12});
 await manager.removeModule('sector.farm');assert.equal(e.document.studio.moduleProfile.modules.length,0);assert.equal(e.document.studio.moduleProfile.state.functions[0].data.value,12);
 await manager.enableModule('sector.farm');assert.deepEqual(await manager.session.dispatch('farm.data:read'),{value:12});await manager.dispose();
});

test('unrelated level edits normalize Studio without reopening or losing live harvest state in saved Content exports',async()=>{
 const studioSchema=createRequire(import.meta.url)('../../packages/project-model/shared/studio-document.js'),discovery=discoverLocalModules({root});
 const e=editor({version:1,mode:'mixed',selectedModuleId:'',modules:[{id:'sector.agriculture',version:'1.0.0',functions:['agriculture.harvest'],editorEnabled:true,viewerEnabled:true}]});
 e.document.studio=studioSchema.normalize({version:1,...e.document.studio,scenes:[{id:'hall',name:'Finca'}]});
 e.document.setStudio=function(patch){this.studio=studioSchema.normalize({...this.studio,...patch});e.writes++;};
 const manager=new Manager(e,{catalog:discovery.catalog});await manager.sync({viewer:false});
 await manager.session.dispatch('logistics.storage:transaction',{operations:[{type:'add-location',location:{id:'field',capacityKg:100,maxLoads:5}}]});
 await manager.session.dispatch('agriculture.harvest:record',{id:'harvest-eight',crop:'mango',lot:'lot-eight',harvestDate:'2026-10-30',locationId:'field',quantity:8,massKg:12});
 const host=manager.session.host,previousProfile=e.document.studio.moduleProfile;
 e.document.setStudio({scenes:[{id:'hall',name:'Finca renombrada',moduleId:'sector.agriculture'}]});assert.notEqual(e.document.studio.moduleProfile,previousProfile);
 await manager.sync({viewer:false});assert.equal(manager.session.host,host,'A semantically identical cloned profile must not reopen its host.');assert.equal((await manager.session.dispatch('agriculture.harvest:harvests'))[0].quantity,8);
 assert.equal(manager.flush(),true);const expected=manager.session.capture().state;
 const exported=createContentProject({format:'hello-webxr-editor',version:1,rooms:{hall:{additions:[],overrides:[]}},imports:[],studio:e.document.studio},{id:e.currentProject.id,name:'Finca'}),restored=readContentProject(exported);
 assert.deepEqual(restored.document.studio.moduleProfile.state,expected);assert.equal(restored.levels[0].name,'Finca renombrada');
 const reopened=new Manager(editor(restored.document.studio.moduleProfile),{catalog:discovery.catalog});await reopened.sync({viewer:false});assert.equal((await reopened.session.dispatch('agriculture.harvest:harvests'))[0].quantity,8);await reopened.dispose();await manager.dispose();
});

test('an equivalent Studio clone keeps a pending lifecycle request current and adopts its latest reference',async()=>{
 const studioSchema=createRequire(import.meta.url)('../../packages/project-model/shared/studio-document.js');let release,started;
 const waiting=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;}),manifest={id:'slow.data',version:'1.0.0'};
 const slow={...manifest,load:async()=>({...manifest,register(scope){scope.state.set(scope.state.get()||{value:0});scope.register('commands','read',()=>scope.state.get());scope.register('commands','configure',input=>scope.state.set(input));},async start(){started();await gate;}})};
 const e=editor({version:1,mode:'mixed',selectedModuleId:'',modules:[{id:'sector.slow',version:'1.0.0',functions:['slow.data']}]}),manager=new Manager(e,{catalog:[{id:'sector.slow',version:'1.0.0',functions:[slow]}]});
 e.document.studio=studioSchema.normalize({version:1,...e.document.studio,scenes:[{id:'hall',name:'Antes'}]});
 const pending=manager.sync({viewer:false});await waiting;e.document.studio=studioSchema.normalize({...e.document.studio,scenes:[{id:'hall',name:'Después'}]});
 assert.equal(manager.sync({viewer:false}),pending,'Equivalent normalization must reuse, not supersede, a pending request.');release();assert.equal(await pending,true);
 await manager.session.dispatch('slow.data:configure',{value:8});await manager.selectModule('sector.slow');assert.deepEqual(await manager.session.dispatch('slow.data:read'),{value:8});await manager.dispose();
});

test('portable visual functions use only granted scene adapters and retire owned nodes across editor and viewer availability',async()=>{
 const nodes=new Set(),scene={add(node){nodes.add(node);},remove(node){nodes.delete(node);}};let released=0,loops=0;
 const port=Object.freeze({scene,camera:{},cameraRig:{},renderer:{setAnimationLoop(){loops++;}}});
 const manifest={id:'visual.room',version:'1.0.0',capabilities:['platform.scene']};
 const visual={...manifest,load:async()=>({...manifest,register(scope){const adapter=scope.port('platform.scene');assert.equal(adapter,port);assert.equal(adapter.editor,undefined);const node={name:'Owned visual content'};adapter.scene.add(node);scope.own(node,item=>{adapter.scene.remove(item);released++;});}})};
 const e=editor({version:1,mode:'mixed',selectedModuleId:'',modules:[{id:'sector.visual',version:'1.0.0',functions:['visual.room'],editorEnabled:true,viewerEnabled:true}]}),manager=new Manager(e,{catalog:[{id:'sector.visual',version:'1.0.0',functions:[visual]}],grants:['platform.scene'],ports:{'platform.scene':port}});
 await manager.sync({viewer:false});assert.equal(nodes.size,1);assert.equal(loops,0);
 await manager.setModuleEnabled('sector.visual',{editorEnabled:false});assert.equal(nodes.size,0);assert.equal(released,1);const profile=cloneData(e.document.studio.moduleProfile),writes=e.writes;
 e.active=false;e.permission=false;await manager.sync({viewer:true});assert.equal(nodes.size,1);assert.equal(loops,0);assert.equal(manager.flush(),false);await assert.rejects(manager.setModuleEnabled('sector.visual',{editorEnabled:true}),/modo edición/);assert.deepEqual(e.document.studio.moduleProfile,profile);assert.equal(e.writes,writes);
 e.active=true;e.permission=true;await manager.sync({viewer:false});assert.equal(nodes.size,0);assert.equal(released,2);await manager.removeModule('sector.visual');assert.equal(nodes.size,0);assert.deepEqual(e.document.studio.moduleProfile.modules,[]);await manager.dispose();assert.equal(released,2);assert.equal(loops,0);
});

test('viewers choose only authored available modules and never mutate project configuration or editor state',async()=>{
 const e=editor(configured()),manager=new Manager(e,{catalog});await manager.sync({viewer:false});await manager.session.dispatch('farm.data:configure',{value:8});manager.flush();const authored=cloneData(e.document.studio.moduleProfile),writes=e.writes;
 e.active=false;e.permission=false;e.document.studio=createRequire(import.meta.url)('../../packages/project-model/shared/studio-document.js').normalize({version:1,...e.document.studio,scenes:[{id:'hall',name:'Vista de prueba'}]});await manager.sync({viewer:true});assert.deepEqual(manager.session.host.status().functions.map(fn=>fn.id),['farm.data']);assert.equal((await manager.session.dispatch('farm.data:read')).value,8);assert.equal(manager.canShowLevel('sector.food'),false);assert.equal(manager.canShowLevel('sector.farm'),true);assert.equal(manager.canShowLevel(),true);
 await manager.sync({viewer:false});assert.equal(manager.viewer,true);assert.deepEqual(manager.session.host.status().functions.map(fn=>fn.id),['farm.data']);
 await assert.rejects(manager.selectModule('sector.food'),/no está disponible/);await assert.rejects(manager.enableModule('sector.food'),/modo edición/);
 await manager.selectModule('sector.farm');await manager.session.dispatch('farm.data:configure',{value:99});assert.equal(manager.flush(),false);assert.equal(e.writes,writes);assert.deepEqual(e.document.studio.moduleProfile,authored);
 e.active=true;e.permission=true;await manager.sync({viewer:false});assert.deepEqual(await manager.session.dispatch('farm.data:read'),{value:8});await manager.dispose();
});

test('specialized modules and project changes preserve their own saved state without leaking between projects',async()=>{
 const e=editor(configured()),manager=new Manager(e,{catalog});await manager.sync({viewer:false});await manager.session.dispatch('farm.data:configure',{value:5});manager.flush();const original=cloneData(e.document.studio.moduleProfile);
 await manager.setProfile({mode:'specialized',selectedModuleId:'sector.food'});assert.deepEqual(manager.session.host.status().functions.map(fn=>fn.id),['food.data']);assert.equal(manager.activeModuleId,'sector.food');assert.equal(manager.canShowLevel('sector.farm'),false);
 e.currentProject={id:'project-two'};e.projectGeneration++;e.document.studio={moduleProfile:configured()};await manager.sync({viewer:false});assert.deepEqual(await manager.session.dispatch('farm.data:read'),{value:0});
 e.currentProject={id:'project-one'};e.projectGeneration++;e.document.studio={moduleProfile:original};await manager.sync({viewer:false});assert.deepEqual(await manager.session.dispatch('farm.data:read'),{value:5});await manager.dispose();
});

test('an imported framework project keeps entities, identity and opaque data while module choices load only the requested context',async()=>{
 const content={format:'smarttwin.project',version:1,id:'project.imported',worldId:'world.imported',title:'Proyecto externo',modules:[],entities:[{id:'future',components:[{functionId:'future.data',functionVersion:'7.0.0',type:'future.data:settings',schemaVersion:4,data:{keep:'opaque'}}]}],extra:{source:'preserve'}};
 const e=editor({...configured(),project:content}),manager=new Manager(e,{catalog});await manager.sync({viewer:false});assert.deepEqual(manager.session.project.entities,content.entities);assert.deepEqual(manager.session.project.extra,content.extra);assert.equal(manager.session.project.id,content.id);assert.equal(manager.session.project.worldId,content.worldId);
 await manager.session.dispatch('farm.data:configure',{value:21});await manager.selectModule('sector.food');assert.deepEqual(manager.session.host.status().functions.map(row=>row.id),['food.data']);assert.equal(manager.canShowLevel('sector.farm'),false);
 await manager.selectModule('');assert.deepEqual(await manager.session.dispatch('farm.data:read'),{value:21});manager.flush();assert.deepEqual(e.document.studio.moduleProfile.project.entities,content.entities);
 await manager.dispose();assert.throws(()=>normalizeModuleProfile({...configured(),project:content,worldId:'world.other'}),/otro mundo/);
});

test('a held module load cannot commit authored changes after a permission change',async()=>{
 let release,started;const waiting=new Promise(resolve=>{started=resolve;}),slow={id:'slow.data',version:'1.0.0',load:()=>{started();return new Promise(resolve=>{release=()=>resolve({id:'slow.data',version:'1.0.0',register(){}});});}};
 const e=editor(),manager=new Manager(e,{catalog:[{id:'sector.slow',version:'1.0.0',functions:[slow]}]});await manager.sync({viewer:false});const operation=manager.enableModule('sector.slow');await waiting;e.permission=false;release();await assert.rejects(operation,/permisos cambiaron/);assert.equal(e.writes,0);assert.equal(manager.session,null);await manager.dispose();
});

class Element{constructor(tag){this.tagName=tag;this.children=[];this.events=new Map();this.style={};this.open=false;}set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text||'';}appendChild(child){child.parentNode=this;this.children.push(child);return child;}setAttribute(name,value){this[name]=value;}removeAttribute(name){delete this[name];}addEventListener(name,handler){this.events.set(name,handler);}removeEventListener(name,handler){if(this.events.get(name)===handler)this.events.delete(name);}remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);}showModal(){this.open=true;}close(){this.open=false;}}
const walk=node=>[node,...node.children.flatMap(walk)];
test('viewer module dialog exposes selection but no authoring switches and all listeners are removed on close/disposal',async()=>{
 const doc={body:new Element('body'),createElement:tag=>new Element(tag)},e=editor(configured());e.active=false;e.permission=false;const manager=new Manager(e,{catalog,document:doc});await manager.open({viewer:true});
 const nodes=walk(doc.body);assert(nodes.some(node=>node.tagName==='select'));assert(!nodes.some(node=>node.textContent==='Añadir al proyecto'||node.textContent==='Quitar del proyecto'||node.type==='checkbox'));
 const button=nodes.find(node=>node.tagName==='button'&&node.textContent==='Cerrar');manager.close();assert.equal(button.events.size,0);await manager.dispose();assert.equal(doc.body.children.length,0);
});

test('workspace discovery emits inert literal loaders and explicit assets without executing installed module code',async t=>{
 const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'smarttwin-workspace-catalog-')));fs.mkdirSync(path.join(directory,'modules'));fs.mkdirSync(path.join(directory,'projects'));
 for(const name of ['core','contracts','module-sdk'])fs.cpSync(path.join(root,'packages',name),path.join(directory,'packages',name),{recursive:true});
 t.after(()=>{assert.equal(path.dirname(directory),fs.realpathSync(os.tmpdir()));assert.match(path.basename(directory),/^smarttwin-workspace-catalog-/);fs.rmSync(directory,{recursive:true});});
 const created=createModule({root:directory,sector:'salud',sectorId:'sector.health',folder:'checklist',functionId:'health.checklist'}),featureRoot=path.join(created.destination,'functions/checklist');fs.appendFileSync(path.join(featureRoot,'index.js'),'\nglobalThis.__workspaceCatalogPoison=true;throw Error("Do not load while discovering");');
 const manifest=JSON.parse(fs.readFileSync(path.join(featureRoot,'function-manifest.json')));manifest.metadata.files.push('assets/sample.bin');manifest.metadata.assets=['assets/sample.bin'];fs.mkdirSync(path.join(featureRoot,'assets'));fs.writeFileSync(path.join(featureRoot,'assets/sample.bin'),Buffer.from([0,1,255]));fs.writeFileSync(path.join(featureRoot,'function-manifest.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(featureRoot,'manifest.js'),'export const manifest='+JSON.stringify(manifest)+';');
 const sector=JSON.parse(fs.readFileSync(path.join(created.destination,'manifest.json')));sector.functions=[{...manifest,entry:'functions/checklist/index.js'}];fs.writeFileSync(path.join(created.destination,'manifest.json'),JSON.stringify(sector));
 const result=writeWorkspaceCatalog({root:directory}),module=await import(pathToFileURL(result.catalogPath).href);assert.equal(globalThis.__workspaceCatalogPoison,undefined);assert.equal(module.catalog[0].functions[0].id,'health.checklist');assert.match(fs.readFileSync(result.catalogPath,'utf8'),/load:\(\)=>import\(/);assert.deepEqual(result.assets,['modules/salud/functions/checklist/assets/sample.bin']);assert.deepEqual(module.defaultFunctions['sector.health'],['health.checklist']);
 assert.equal(JSON.parse(fs.readFileSync(result.metadataPath)).format,'smarttwin.workspace-catalog');
 const original=fs.readFileSync(result.catalogPath);fs.unlinkSync(result.catalogPath);const outside=path.join(directory,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'user.txt'),'preserve');fs.symlinkSync(outside,result.catalogPath,process.platform==='win32'?'junction':'dir');try{assert.throws(()=>writeWorkspaceCatalog({root:directory}),{code:'discovery_link'});assert.equal(fs.readFileSync(path.join(outside,'user.txt'),'utf8'),'preserve');}finally{fs.unlinkSync(result.catalogPath);fs.writeFileSync(result.catalogPath,original);}
});
