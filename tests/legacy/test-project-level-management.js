'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const behaviorSchema=require('../../modules/logistica-industrial/contracts/behaviors'),studioSchema=require('../../packages/project-model/shared/studio-document');
const {validateDocument}=require('../../apps/api/server/validation');
const root=path.resolve(__dirname,'../..'),source=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*$/gm,'');
const prefabDependencies=require('../support/load-robot-prefabs')(THREE);
const createIndustrialPrefab=new Function('THREE','behaviorSchema','require',source('modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js').replace(/export (const|function) /g,'$1 ')+'\nreturn createIndustrialPrefab;')(THREE,behaviorSchema,prefabDependencies.resolve);
const SceneDocument=new Function('THREE','behaviorSchema','createIndustrialPrefab',source('packages/project-model/src/SceneDocument.js').replace('export default class SceneDocument','return class SceneDocument'))(THREE,behaviorSchema,createIndustrialPrefab);
const clone=value=>JSON.parse(JSON.stringify(value));
class Element {
  constructor(){this.children=[];this.listeners={};this.value='';}
  appendChild(child){this.children.push(child);return child;}
  addEventListener(type,listener){(this.listeners[type]||(this.listeners[type]=[])).push(listener);}
  getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
}
let nextName='Nivel renombrado';
const StudioTools=new Function('THREE','schema','window','document',source('modules/logistica-industrial/integrations/StudioTools.js').replace('export default class StudioTools','return class StudioTools'))(THREE,behaviorSchema,{prompt:()=>nextName},{createElement:()=>new Element()});
const ProjectAccessView=new Function(source('packages/tools/editor/src/ProjectAccessView.js').replace('export default class ProjectAccessView','return class ProjectAccessView'))();

function fixture({access=false}={}){
  const imports=[{id:'import-notes',path:'notes.txt',dataUrl:'data:text/plain;base64,dGVzdA=='}];
  const library={exportImports:()=>clone(imports),restoreImports(records){imports.splice(0,imports.length,...clone(records||[]));}};
  const document=new SceneDocument({}, {assetLibrary:library}),roots={},toasts=[];
  studioSchema.ROOM_IDS.forEach(id=>{const root=new THREE.Group(),native=new THREE.Mesh(new THREE.BoxBufferGeometry(1,1,1),new THREE.MeshBasicMaterial());native.name='Original '+id;root.add(native);roots[id]=root;document.registerRoom(id,root);});
  const editor={document,active:true,editable:true,projectGeneration:0,ctx:{room:0,renderer:{domElement:new Element()}},transform:Object.assign(new THREE.EventDispatcher(),{dragging:false}),camera:new THREE.PerspectiveCamera(),orbit:{target:new THREE.Vector3()},roomSelect:{options:[]},shell:{refresh(){},openWorkspace(){}},
    canEditDocument(){return this.editable;},getSceneEntries(){return studioSchema.sceneEntries(this.document);},select(object){this.selected=object;},toast(message){toasts.push(message);},renderAssets(){},home(){},
    async perform(action){if(this.busy||this.loadingProject||this.transform.dragging)return;try{return await action();}catch(error){this.toast(error.message);}},hooks:{}};
  Object.defineProperties(editor,{roomId:{get(){return studioSchema.ROOM_IDS[this.ctx.room];}},root:{get(){return roots[this.roomId];}}});
  const accessView=new ProjectAccessView(editor);accessView.user={permissions:{editor:true}};
  editor.hooks.gotoRoom=async index=>{const id=studioSchema.ROOM_IDS[index];if(access&&!accessView.canVisit(id))return false;editor.ctx.room=index;return true;};
  return {editor,document,tools:new StudioTools(editor),roots,toasts,imports,accessView};
}
function authored(harness){
  const {document}=harness;
  const first=document.addPrimitive('hall','box','#22aa88'),second=document.addPrimitive('sound','box','#aa8822');
  document.setProperty(first,'name','Recepción conserva este objeto');document.setProperty(second,'name','Despacho elimina este objeto');
  document.setStudio({scenes:[{id:'hall',name:'Recepción',moduleId:'sector.agriculture'},{id:'sound',name:'Despacho',moduleId:'sector.logistics-industrial'}],startRoomId:'sound',environments:[studioSchema.defaultEnvironment('hall'),studioSchema.defaultEnvironment('sound')],widgets:[{id:'hall-counter',name:'Hall',roomId:'hall',kind:'counter'},{id:'sound-counter',name:'Sound',roomId:'sound',kind:'counter'}],missions:[{id:'sound-mission',name:'Despachar',roomId:'sound',steps:[{name:'Despachar carga',event:'load-dispatched',objectId:second.userData.editorId,target:1}]}],entities:[{id:'sound-light',objectId:second.userData.editorId,roomId:'sound',type:'pointLight'}]});
  return {first,second};
}
async function unchangedOnFailure(harness,action,pattern){
  const before=await harness.document.serialize(),room=harness.editor.roomId,undo=harness.document.undoStack.length,redo=harness.document.redoStack.length;
  await assert.rejects(action,pattern);assert.deepEqual(await harness.document.serialize(),before);assert.equal(harness.editor.roomId,room);assert.equal(harness.document.undoStack.length,undo);assert.equal(harness.document.redoStack.length,redo);assert.equal(harness.document.transaction,null);
}

async function run(){
  const current=fixture(),{first,second}=authored(current),{document,editor,tools}=current;
  editor.ctx.room=studioSchema.ROOM_IDS.indexOf('sound');
  const before=await document.serialize(),undo=document.undoStack.length,firstId=first.userData.editorId,secondId=second.userData.editorId;
  assert.equal(await tools.deleteScene('sound',{confirmed:true}),true);assert.equal(editor.roomId,'hall');
  assert.deepEqual(document.studio.deletedScenes,['sound']);assert.equal(document.studio.startRoomId,'hall');assert.equal(document.undoStack.length,undo+1,'Deleting a level must be exactly one undo step.');
  assert.equal(document.getObject(secondId),null);assert.equal(document.getObject(firstId).name,'Recepción conserva este objeto');
  for(const key of ['environments','widgets','missions','entities'])assert(!(document.studio[key]||[]).some(row=>row.roomId==='sound'));
  assert.equal(studioSchema.sceneEntries(document).some(row=>row.id==='sound'),false);assert.equal(current.accessView.canVisit('sound'),false,'Deleted levels must remain inaccessible even outside authenticated mode.');
  const deleted=await document.serialize();assert.deepEqual(deleted.imports,before.imports,'Deleting a map must not delete project-level imported assets.');assert.deepEqual(deleted.rooms.hall,before.rooms.hall);
  assert.deepEqual(validateDocument(deleted,value=>value),deleted,'Deletion and module assignments must survive server validation.');
  document.undo();assert.deepEqual(await document.serialize(),before);assert(document.getObject(secondId));document.redo();assert.deepEqual(await document.serialize(),deleted);
  const reopened=fixture();await reopened.document.load(deleted,{activeRoomId:'hall'});assert.equal(reopened.accessView.canVisit('sound'),false);assert.deepEqual(await reopened.document.serialize(),deleted,'Save and reopen must retain tombstones and other maps/imports.');
  const pending=fixture();await pending.document.load(before,{activeRoomId:'hall'});assert(pending.document.pendingRooms.has('sound'),'The inactive authored level must begin deferred.');
  await pending.tools.deleteScene('sound',{confirmed:true});assert.equal(pending.editor.roomId,'hall');assert.equal(pending.document.pendingRooms.has('sound'),false);assert.equal(pending.document.studio.deletedScenes.includes('sound'),true);
  pending.document.undo();assert.equal(pending.document.pendingRooms.has('sound'),true);assert.deepEqual(await pending.document.serialize(),before,'Deleting an inactive deferred level must undo without losing its saved records.');
  nextName='Nueva recepción';await tools.renameScene('hall');assert.equal(document.studio.scenes.find(scene=>scene.id==='hall').moduleId,'sector.agriculture','Renaming a level cannot discard its sector association.');

  const reuse=fixture({access:true});authored(reuse);reuse.editor.ctx.room=1;await reuse.tools.deleteScene('sound',{confirmed:true});
  const reserved=reuse.document.undoStack.length;const newRoom=await reuse.tools.newScene({name:'Despacho nuevo'});assert.equal(newRoom,'sound','New levels should reuse the deleted slot before consuming another slot.');
  assert.equal(reuse.document.studio.deletedScenes.includes('sound'),false);assert.equal(reuse.document.studio.scenes.find(scene=>scene.id==='sound').name,'Despacho nuevo');assert.equal(reuse.accessView.canVisit('sound'),true);assert.equal(reuse.document.undoStack.length,reserved+1);
  assert.equal(reuse.document.getObjects('sound').some(object=>object.name==='Despacho elimina este objeto'),false,'Reusing a slot must not resurrect the deleted map.');
  reuse.document.undo();assert.equal(reuse.document.studio.deletedScenes.includes('sound'),true);reuse.document.redo();assert.equal(reuse.document.studio.deletedScenes.includes('sound'),false);

  const last=fixture();last.document.setStudio({scenes:[{id:'hall',name:'Único nivel'}],startRoomId:'hall',deletedScenes:studioSchema.ROOM_IDS.filter(id=>id!=='hall')});
  await unchangedOnFailure(last,()=>last.tools.deleteScene('hall',{confirmed:true}),/al menos un nivel/);
  for(const guard of ['confirmation','permission','inactive','busy','loadingProject','importingFiles','creatingScene','pastingObject','shared','dragging']){
    const guarded=fixture();authored(guarded);guarded.editor.ctx.room=1;
    if(guard==='permission')guarded.editor.editable=false;else if(guard==='inactive')guarded.editor.active=false;else if(guard==='shared')guarded.editor.ctx.studio={room:{id:'shared'}};else if(guard==='dragging')guarded.editor.transform.dragging=true;else if(guard!=='confirmation')guarded.editor[guard]=true;
    await unchangedOnFailure(guarded,()=>guarded.tools.deleteScene('sound',{confirmed:guard!=='confirmation'}),/Confirma|editable|operación|sala compartida|completar|eliminar/i);
  }
  const transaction=fixture();authored(transaction);transaction.editor.ctx.room=1;transaction.document.begin();
  await assert.rejects(()=>transaction.tools.deleteScene('sound',{confirmed:true}),/operación/);transaction.document.cancel();

  const failed=fixture();authored(failed);failed.editor.ctx.room=1;const reset=failed.document.resetRoom.bind(failed.document);
  failed.document.resetRoom=roomId=>{reset(roomId);throw Error('Synthetic level reset failure');};
  await unchangedOnFailure(failed,()=>failed.tools.deleteScene('sound',{confirmed:true}),/Synthetic level reset failure/);
  const skipped=fixture();authored(skipped);skipped.editor.ctx.room=1;skipped.editor.perform=async()=>undefined;
  await unchangedOnFailure(skipped,()=>skipped.tools.deleteScene('sound',{confirmed:true}),/completar|eliminar/i);
  const blocked=fixture();authored(blocked);blocked.editor.ctx.room=1;blocked.editor.hooks.gotoRoom=async()=>false;
  await unchangedOnFailure(blocked,()=>blocked.tools.deleteScene('sound',{confirmed:true}),/No se pudo abrir/);

  const legacy=fixture(),legacyBefore=await legacy.document.serialize();assert.equal(studioSchema.sceneEntries(legacy.document).length,10);assert.deepEqual(await legacy.document.serialize(),legacyBefore);assert(!Object.hasOwn(legacyBefore,'studio'));
  console.log('Project level management: confirmed atomic delete/undo/redo/save/reopen, tombstone access and slot reuse, module-preserving rename, last-level protection, guards, swallowed/failing operations rollback and legacy/import/other-map preservation passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
