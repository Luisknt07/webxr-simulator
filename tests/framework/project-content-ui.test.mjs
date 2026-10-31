import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createContentProject,readContentProject,CONTENT_PACKAGE_FORMAT} from '../../packages/project-format/index.js';
const SOURCE=fileURLToPath(new URL('../../packages/tools/editor/src/ProjectContentBrowser.js',import.meta.url));

class Element{
  constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.children=[];this.handlers=new Map();this.attributes=new Map();this.dataset={};this.disabled=false;this._text='';}
  set textContent(value){this._text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(_){throw Error('Project content metadata must never become HTML.');}
  appendChild(child){if(child.parentNode)child.remove();child.parentNode=this;this.children.push(child);return child;}
  removeChild(child){this.children=this.children.filter(row=>row!==child);child.parentNode=null;}
  remove(){if(this.parentNode)this.parentNode.removeChild(this);}
  setAttribute(key,value){this.attributes.set(key,String(value));if(key==='open')this.open=true;}
  addEventListener(name,handler){let handlers=this.handlers.get(name);if(!handlers)this.handlers.set(name,handlers=[]);handlers.push(handler);}
  removeEventListener(name,handler){this.handlers.set(name,(this.handlers.get(name)||[]).filter(value=>value!==handler));}
  async emit(name,event={}){for(const handler of this.handlers.get(name)||[])await handler({...event,target:this,preventDefault(){},stopPropagation(){}});}
  async click(){if(!this.disabled)await this.emit('click');}
  focus(){this.ownerDocument.activeElement=this;}
  showModal(){this.open=true;}close(){this.open=false;}
  get isConnected(){let node=this;while(node.parentNode)node=node.parentNode;return node===this.ownerDocument.body;}
  querySelectorAll(selector){const tags=selector.split(',').map(value=>value.trim());return walk(this).slice(1).filter(node=>tags.includes(node.tagName));}
}
const walk=node=>[node,...node.children.flatMap(walk)];
function fixture({readOnly=false,saved=true}={}){
  const document={createElement(tag){return new Element(tag,this);},activeElement:null};document.body=document.createElement('body');const previous=document.createElement('button');document.body.appendChild(previous);previous.focus();
  const Browser=new Function('document',fs.readFileSync(SOURCE,'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class ProjectContentBrowser','return class ProjectContentBrowser'))(document);
  const events=[],messages=[],levels=[{id:'hall',index:0,name:'Recepción',custom:true,initial:true,moduleId:'sector.logistics-industrial'},{id:'sound',index:1,name:'Despacho',custom:true,initial:false,moduleId:''}];
  const studio={scenes:levels.map(({id,name,moduleId})=>({id,name,...(moduleId?{moduleId}:{})})),startRoomId:'hall',moduleProfile:{mode:'specialized',modules:[{id:'sector.logistics-industrial',version:'1.0.0',enabled:true}]}};
  const editor={ui:document.body,roomId:'hall',projectGeneration:7,projectName:'Proyecto <img src=x onerror=run()>',currentProject:saved?{id:'project-1',storage:{relativePath:'data/users/user-1/projects/project-1',materialized:true,contentRevision:3}}:null,
    clearNavigation(){events.push('clearNavigation');},canEditDocument(){return !readOnly;},getSceneEntries(){return levels;},document:{studio,setStudio(update){Object.assign(studio,update);events.push('setStudio');}},
    library:{exportImports(){return [{id:'asset-1',name:'Modelo <script>run()</script>',sha256:'a'.repeat(64)}];}},projectInput:{click(){events.push('importProject');}},assetInput:{click(){events.push('importAsset');}},
    projectModules:{availableModules(){return [{id:'sector.logistics-industrial',title:'Logística industrial'},{id:'sector.agriculture',title:'Agricultura'}];},open(){events.push('modules');}},
    hooks:{async gotoRoom(index){events.push('goto:'+index);editor.roomId=levels.find(level=>level.index===index).id;}},home(){events.push('home:'+this.roomId);},toast(message){messages.push(message);},
    async saveProject(){events.push('save');},async exportContentProject(){events.push('export');},async exportContentFolder(){events.push('exportFolder');},async openContentFolder(){events.push('openFolder');},
    studioTools:{async renameScene(){events.push('rename:'+editor.roomId);},async duplicateScene(){events.push('duplicate:'+editor.roomId);},async deleteScene(id,options){assert.equal(options.confirmed,true);events.push('delete:'+id);},refreshLabels(){events.push('refreshLabels');},guard(action){return action();},async newScene(){events.push('newScene');}}
  };
  const browser=new Browser(editor);return {document,editor,browser,events,messages,levels,previous};
}
const button=(root,label)=>walk(root).find(node=>node.tagName==='button'&&node.textContent===label);
const levelRow=(root,id)=>walk(root).find(node=>node.dataset.levelId===id);

test('the content browser identifies authorized server storage and actual stable map names without creating markup',()=>{
  const {browser,document}=fixture();browser.open();const codes=walk(browser.dialog).filter(node=>node.tagName==='code').map(node=>node.textContent);
  assert(codes.includes('data/users/user-1/projects/project-1'));assert(codes.includes('Content/Maps/hall.level.json'));assert(codes.includes('Content/Maps/sound.level.json'));
  assert(browser.dialog.textContent.includes('Recepción'));assert(browser.dialog.textContent.includes('Proyecto <img src=x onerror=run()>'));assert.equal(walk(document.body).some(node=>node.tagName==='img'||node.tagName==='script'),false);
  browser.category='Assets';browser.render();assert(browser.dialog.textContent.includes('Modelo <script>run()</script>'));assert(browser.dialog.textContent.includes('Content/Assets/asset-1.asset.json'));browser.dispose();
});
test('an unsaved project has no invented server folder and modal closure restores prior keyboard focus',()=>{
  const {browser,previous,document}=fixture({saved:false});browser.open();assert(browser.location.textContent.includes('Proyecto sin guardar'));assert(!browser.location.textContent.includes('data/users/'));browser.close();assert.equal(browser.dialog,null);assert.equal(document.activeElement,previous);
});
test('level edits open the selected level first and never run against a failed navigation',async()=>{
  const {browser,editor,events,messages}=fixture();browser.open();await button(levelRow(browser.dialog,'sound'),'Renombrar').click();assert.deepEqual(events.slice(-2),['goto:1','rename:sound']);assert.equal(browser.dialog,null);
  editor.roomId='hall';browser.open();editor.hooks.gotoRoom=async()=>{events.push('goto-blocked');};await button(levelRow(browser.dialog,'sound'),'Duplicar').click();assert.equal(events.some(value=>value==='duplicate:hall'||value==='duplicate:sound'),false);assert(messages.at(-1).includes('No se pudo abrir'));
});
test('level removal uses an explicit inline confirmation and cancels without deleting data',async()=>{
  const {browser,events}=fixture();browser.open();await button(levelRow(browser.dialog,'sound'),'Eliminar').click();assert(!events.some(value=>value.startsWith('delete:')));assert(browser.list.textContent.includes('Eliminar «Despacho»'));await button(browser.list,'Cancelar').click();assert(!events.some(value=>value.startsWith('delete:')));
  await button(levelRow(browser.dialog,'sound'),'Eliminar').click();await button(browser.list,'Eliminar nivel').click();assert(events.includes('delete:sound'));
});
test('read-only content keeps save and map mutations disabled while repeated portable exports remain available',async()=>{
  const {browser,events}=fixture({readOnly:true});browser.open();assert.equal(button(browser.dialog,'Guardar proyecto').disabled,true);
  for(const label of ['Renombrar','Duplicar','Inicial','Eliminar'])for(const row of walk(browser.list).filter(node=>node.dataset.levelId))assert.equal(button(row,label).disabled,true);
  assert.equal(button(browser.list,'+ Nuevo nivel').disabled,true);for(const select of walk(browser.list).filter(node=>node.tagName==='select'))assert.equal(select.disabled,true);
  const exportButton=button(browser.dialog,'Descargar proyecto independiente');assert.equal(exportButton.disabled,false);await exportButton.click();assert.equal(exportButton.disabled,false);await exportButton.click();assert.equal(events.filter(value=>value==='export').length,2);assert.equal(button(browser.dialog,'Guardar proyecto').disabled,true);
});
test('stale generations and disposed content controls cannot edit or navigate another project',async()=>{
  const {browser,editor,events}=fixture();browser.open();const rename=button(levelRow(browser.dialog,'sound'),'Renombrar');editor.projectGeneration++;await rename.click();assert.equal(events.some(value=>value.startsWith('goto:')||value.startsWith('rename:')),false);browser.close(true);
  browser.open();const staleExport=button(browser.dialog,'Descargar proyecto independiente'),staleRename=button(levelRow(browser.dialog,'sound'),'Renombrar');browser.dispose();await staleExport.click();await staleRename.click();assert.equal(events.includes('export'),false);assert.equal(events.some(value=>value.startsWith('goto:')||value.startsWith('rename:')),false);
});
test('a project changed while its level loads does not receive the previous level edit command',async()=>{
  const {browser,editor,events}=fixture();let finish;browser.open();editor.hooks.gotoRoom=()=>new Promise(resolve=>{finish=()=>{editor.roomId='sound';resolve();};});
  const pending=button(levelRow(browser.dialog,'sound'),'Renombrar').click();editor.projectGeneration++;finish();await pending;assert.equal(events.some(value=>value.startsWith('rename:')),false);
});
test('module assignment updates only that level through the project configuration with stable IDs',async()=>{
  const {browser,editor,events}=fixture();browser.open();const row=levelRow(browser.dialog,'sound'),select=walk(row).find(node=>node.tagName==='select');select.value='sector.agriculture';await select.emit('change');
  assert.equal(editor.document.studio.scenes.find(scene=>scene.id==='sound').moduleId,'sector.agriculture');assert.equal(editor.document.studio.scenes.find(scene=>scene.id==='hall').moduleId,'sector.logistics-industrial');assert(events.includes('refreshLabels'));
});

function hookFixture(){
  const source=fs.readFileSync(fileURLToPath(new URL('../../packages/tools/editor/src/SceneEditor.js',import.meta.url)),'utf8'),start=source.indexOf('  async importProjectContent('),end=source.indexOf('  updateStatus()',start);assert(start>=0&&end>start);
  const applyStart=source.indexOf('  async applyServerProject('),applyEnd=source.indexOf('  async applyServerProjectNow(',applyStart);assert(applyStart>=0&&applyEnd>applyStart);
  const Editor=new Function('createContentProject','readContentProject','CONTENT_PACKAGE_FORMAT','ROOM_IDS','writeContentFolderToHandle','readContentFolderFromHandle','window','el','URL','Blob','setTimeout','return class EditorHooks {\n'+source.slice(applyStart,applyEnd)+source.slice(start,end)+'\n}')(createContentProject,readContentProject,CONTENT_PACKAGE_FORMAT,['hall','sound'],()=>{},()=>{}, {},()=>{}, {},class{},()=>{});
  const editor=new Editor(),events=[],messages=[],data={format:'hello-webxr-editor',version:1,rooms:{hall:{overrides:[],additions:[]},sound:{overrides:[],additions:[]}},imports:[],studio:{version:1,startRoomId:'hall',scenes:[{id:'hall',name:'Nivel inicial'}]}},asset={id:'asset-1',kind:'model',name:'model.glb',path:'model.glb',dataUrl:'data:model/gltf-binary;base64,AAECAw=='};
  const validate=createRequire(import.meta.url)('../../apps/api/server/validation.js').validateDocument;
  Object.assign(editor,{projectGeneration:2,accessView:{identityGeneration:1,enabled:true},currentProject:{id:'old-project',name:'Old project',revision:3},projectName:'Mi proyecto',roomId:'hall',active:true,
    async keepCurrentProject(){events.push('keep');},clearAssetPreview(){events.push('clearPreview');},assetThumbnails:{dispose(){events.push('disposeThumbnails');}},cancelDecalPlacement(){events.push('cancelDecals');},decals:{dispose(){events.push('disposeDecals');}},infoPreview:{dispose(){events.push('disposeInfo');}},
    document:{_validate(input){events.push('validate');return validate(input,record=>JSON.parse(JSON.stringify(record)));},async serialize(){events.push('serialize');return JSON.parse(JSON.stringify(data));},async load(input,options){events.push('load');if(options.assertCurrent)options.assertCurrent();editor.loaded=input;}},
    library:{async exportPortableImports(){events.push('portableAssets');return [asset];},async getCatalog(){events.push('catalog');return [];}},projectModules:{flush(){events.push('flushModules');},close(){events.push('closeModules');},async sync(){events.push('syncModules');}},
    async applyServerProjectNow(project,options){events.push('apply');assert.equal(options.accessGeneration,this.accessView.identityGeneration);assert.equal(options.expectedProjectGeneration,this.projectGeneration);this.loaded=project.document;this.currentProject=project.localImport?null:project;this.projectName=project.name;this.projectGeneration++;},
    async prepareRoom(){events.push('prepare');},clearObjectClipboard(){events.push('clearClipboard');},rememberProject(project){events.push('remember:'+project);},renderAssets(){events.push('renderAssets');},select(){events.push('select');},toast(message){messages.push(message);}});
  return {editor,events,messages,data,asset};
}
test('the actual editor export hook captures a complete portable project and module settings without changing its server identity',async()=>{
  const {editor,events,data,asset}=hookFixture(),bundle=await editor.contentProjectPackage(),restored=readContentProject(bundle);
  assert.equal(bundle.descriptor.id,'old-project');assert.equal(bundle.descriptor.name,'Mi proyecto');assert.deepEqual(restored.document,{...data,imports:[asset]});assert.equal(editor.currentProject.id,'old-project');assert(events.indexOf('flushModules')<events.indexOf('serialize'));assert.equal(events.includes('load'),false);
});
test('the actual editor export hook refuses a late result after the account/project changes',async()=>{
  const {editor}=hookFixture();let finish;editor.library.exportPortableImports=()=>new Promise(resolve=>{finish=resolve;});const operation=editor.contentProjectPackage();await Promise.resolve();await Promise.resolve();editor.accessView.identityGeneration++;editor.projectGeneration++;editor.currentProject={id:'another-project'};finish([]);await assert.rejects(operation,/cuenta o el proyecto cambió/);assert.equal(editor.currentProject.id,'another-project');
});
test('the actual editor import hook validates package hashes before retiring the current project and opens a new independent copy',async()=>{
  const {editor,events,data}=hookFixture(),bundle=createContentProject(data,{id:'external-project',name:'Proyecto externo'}),bad=JSON.parse(JSON.stringify(bundle));bad.files[0].sha256='0'.repeat(64);
  await assert.rejects(editor.importProjectContent(bad),{code:'content_hash'});assert.equal(editor.currentProject.id,'old-project');assert.equal(events.length,0);
  await editor.importProjectContent(bundle);assert.equal(editor.currentProject,null);assert.equal(editor.projectName,'Proyecto externo');assert.deepEqual(editor.loaded,data);assert(events.indexOf('validate')<events.indexOf('keep'));assert(events.indexOf('keep')<events.indexOf('apply'));
});
test('the actual editor imports a modular framework project as an editable level while keeping its module data intact',async()=>{
  const {editor}=hookFixture(),project={format:'smarttwin.project',version:1,id:'project.farm',worldId:'world.farm',modules:[{id:'sector.agriculture',version:'1.0.0',functions:['agriculture.harvest']}],entities:[],extension:{keep:'future'}};
  await editor.importProjectContent(createContentProject(project,{name:'Finca',moduleState:{format:'smarttwin.module-state',version:1,worldId:'world.farm',functions:[]}}));
  assert.equal(editor.loaded.format,'hello-webxr-editor');assert.deepEqual(editor.loaded.studio.moduleProfile.project,project);assert.equal(editor.loaded.studio.moduleProfile.modules[0].editorEnabled,true);assert.equal(editor.loaded.studio.moduleProfile.modules[0].viewerEnabled,true);assert.deepEqual(editor.loaded.studio.moduleProfile.state,{format:'smarttwin.module-state',version:1,worldId:'world.farm',functions:[]});
});
test('the actual editor import hook cannot replace a different project while retaining the previous project asynchronously',async()=>{
  const {editor,events,data}=hookFixture();let finish;editor.keepCurrentProject=()=>new Promise(resolve=>{finish=resolve;});const operation=editor.importProjectContent(createContentProject(data));editor.projectGeneration++;editor.accessView.identityGeneration++;editor.currentProject={id:'another-account-project'};finish();
  await assert.rejects(operation,/cuenta|proyecto cambió/);assert.equal(events.includes('load'),false);assert.equal(editor.currentProject.id,'another-account-project');
});
