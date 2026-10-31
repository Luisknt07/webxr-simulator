import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import ActionRegistry from '../../packages/assistant-core/ActionRegistry.js';
import {TOOL_DEFINITIONS,validateToolCall} from '../../packages/assistant-core/contracts.js';

const root=fileURLToPath(new URL('../../',import.meta.url)),legacy=path.join(root,'tests/legacy/test-project-level-management.js'),require=createRequire(legacy);
const harness=fs.readFileSync(legacy,'utf8');
const {fixture:documentFixture}=new Function('require','__dirname',harness.slice(0,harness.indexOf('\nasync function run()'))+'\nreturn {fixture};')(require,path.dirname(legacy));
const behaviorSchema=require('../../modules/logistica-industrial/contracts/behaviors.js');
const bridgeSource=fs.readFileSync(path.join(root,'modules/logistica-industrial/integrations/AssistantActionBridge.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'').replace('default createAssistantActions;','');
const {AssistantActionBridge}=new Function('ActionRegistry','behaviorSchema',bridgeSource+'\nreturn {AssistantActionBridge};')(ActionRegistry,behaviorSchema);
const editorSource=fs.readFileSync(path.join(root,'packages/tools/editor/src/SceneEditor.js'),'utf8');
const EquipmentEditor=new Function('behaviorSchema','return class {'+editorSource.slice(editorSource.indexOf('  equipmentGeometryKey('),editorSource.indexOf('  applyEquipmentReflow('))+editorSource.slice(editorSource.indexOf('  editConnectedEquipment('),editorSource.indexOf('  alignConveyorPorts('))+'};')(behaviorSchema);
function fixture(t){
 const f=documentFixture({access:true}),e=f.editor;e.accessView=f.accessView;e.serverCapabilities={privateProjects:true};e.currentProject={id:'project.synthetic',name:'Synthetic warehouse',revision:1,access:{role:'owner',ownerId:'owner-a',canEdit:true}};e.projectName=e.currentProject.name;e.accessView.identityGeneration=1;e.ctx.studio={client:{user:{id:'owner-a',permissions:{editor:true}}}};e.document.setStudio({scenes:[{id:'hall',name:'Recepción'},{id:'sound',name:'Despacho'}],startRoomId:'hall'});
 e.assembly={supported:()=>false};e.machineConfig=object=>e.document.getBehaviors(object).find(row=>row.type===object.userData.editorPrefabKey);for(const name of ['equipmentGeometryKey','editConnectedEquipment','setEquipmentTransform','setEquipmentBehaviors'])e[name]=EquipmentEditor.prototype[name];
 const item=e.document.addPrimitive('hall','box','#22aa88');e.document.setProperty(item,'name','Pallet de prueba');const foreign=e.document.addPrimitive('sound','box','#bb8822');e.document.setProperty(foreign,'name','Objeto privado de otro nivel');const bridge=new AssistantActionBridge(e.ctx,{editor:e});t.after(()=>bridge.dispose());return {...f,bridge,item,foreign};
}

test('a local registry exposes only declared registered tools and rejects unknown calls, fields and stale identities',async()=>{
 let identity='owner-a/project';const registry=new ActionRegistry({getIdentity:()=>identity});registry.register('get_context',()=>({mode:'viewer'}));assert.equal(registry.definitions().length,1);assert.equal(registry.definitions()[0].name,'get_context');
 assert.throws(()=>registry.register('execute_javascript',()=>{}),/declarada/);await assert.rejects(registry.execute('get_context',{code:'alert(1)'}));await assert.rejects(registry.execute('update_component',{componentId:'x',patch:{visible:false}}),/disponible/);await assert.rejects(registry.execute('get_context',{}, {expectedIdentity:'old'}),error=>error.code==='session_changed');
 registry.dispose();await assert.rejects(registry.execute('get_context'),error=>error.code==='assistant_disposed');
});
test('context and component reads stay inside the authorized current level and contain bounded declarative metadata',async t=>{
 const {bridge,item,foreign,editor}=fixture(t),context=await bridge.registry.execute('get_context',{});assert.equal(context.editable,true);assert(context.identity.includes('owner-a'));assert.equal(context.selected,null);assert(context.objects.some(row=>row.id===item.userData.editorId));assert(!JSON.stringify(context).includes(foreign.name));assert.equal(context.document,undefined);assert.equal(context.imports,undefined);
 const found=await bridge.registry.execute('list_components',{query:'pallet',limit:10});assert.equal(found.components.length,1);assert.equal(found.components[0].id,item.userData.editorId);await assert.rejects(bridge.registry.execute('inspect_component',{componentId:foreign.userData.editorId}),error=>error.code==='assistant_component_missing');
 editor.select(item);const inspected=await bridge.registry.execute('inspect_component',{});assert.equal(inspected.component.id,item.userData.editorId);
});
test('a live level transition hides authored context and blocks edits until the transition finishes',async t=>{
 for(const origin of ['host','editor']){
  const {bridge,item,editor,document}=fixture(t),before=await document.serialize();bridge.ctx={...editor.ctx};const context=origin==='host'?bridge.ctx:editor.ctx;context.roomTransition={to:'sound'};
  const snapshot=bridge.snapshot();assert.equal(snapshot.available,false,origin);assert.equal(snapshot.editable,false,origin);assert.equal(snapshot.objects,undefined,origin);assert.equal(snapshot.selected,undefined,origin);
  await assert.rejects(bridge.registry.execute('get_context',{}),error=>error.code==='assistant_context_unavailable');await assert.rejects(bridge.registry.execute('update_component',{componentId:item.userData.editorId,patch:{visible:false}}),error=>error.code==='assistant_context_unavailable');assert.deepEqual(await document.serialize(),before,origin);
  context.roomTransition=null;assert.equal((await bridge.registry.execute('get_context',{})).available,true,origin);await bridge.registry.execute('update_component',{componentId:item.userData.editorId,patch:{visible:false}});assert.equal(item.visible,false,origin);
 }
});
test('transform, name, visibility and color changes are one real SceneDocument undo transaction and serialize correctly',async t=>{
 const {bridge,item,document}=fixture(t),before=await document.serialize(),undo=document.undoStack.length;
 const result=await bridge.registry.execute('update_component',{componentId:item.userData.editorId,patch:{name:'Caja terminada',visible:false,color:'#336699',position:[2,1,3],rotation:[0,.5,0],scale:[1.2,.8,1]}},{expectedIdentity:bridge.identity()});assert.equal(result.updated.name,'Caja terminada');assert.deepEqual(item.position.toArray(),[2,1,3]);assert.equal(item.visible,false);assert.equal(item.userData.editorColor,'#336699');assert.equal(document.undoStack.length,undo+1);const changed=await document.serialize();assert.notDeepEqual(changed,before);document.undo();assert.deepEqual(await document.serialize(),before);document.redo();assert.deepEqual(await document.serialize(),changed);
});
test('numeric equipment edits use the inspector equipment API and schema ranges while preserving connections',async t=>{
 const {bridge,document,editor}=fixture(t),belt=document.addPrefab('hall','conveyor'),id=belt.userData.editorId;let routed=0;const original=editor.setEquipmentBehaviors.bind(editor);editor.setEquipmentBehaviors=(...args)=>{routed++;return original(...args);};
 const before=await document.serialize(),undo=document.undoStack.length;const current=document.getBehaviors(belt).find(row=>row.type==='conveyor');const result=await bridge.registry.execute('update_component',{componentId:id,patch:{behavior:{type:'conveyor',changes:{speed:1.25}}}});assert.equal(routed,1);assert.equal(document.getBehaviors(belt).find(row=>row.type==='conveyor').speed,1.25);assert.equal(result.undoAvailable,true);assert.equal(document.undoStack.length,undo+1);document.undo();assert.deepEqual(await document.serialize(),before);
 const same=await document.serialize();await assert.rejects(bridge.registry.execute('update_component',{componentId:id,patch:{behavior:{type:'conveyor',changes:{outputId:12}}}}),/habilitado/);await assert.rejects(bridge.registry.execute('update_component',{componentId:id,patch:{behavior:{type:'conveyor',changes:{speed:99999}}}}),/intervalo/);assert.deepEqual(await document.serialize(),same);assert.equal(document.getBehaviors(belt).find(row=>row.type==='conveyor').outputId,current.outputId);
});
test('a failing real document operation rolls back all earlier changes without a partial undo entry',async t=>{
 const {bridge,document,roots}=fixture(t),native=roots.hall.children[0],before=await document.serialize(),undo=document.undoStack.length;
 await assert.rejects(bridge.registry.execute('update_component',{componentId:native.userData.editorId,patch:{name:'Invalid native rename',visible:false}}),/nativo/);assert.deepEqual(await document.serialize(),before);assert.equal(document.undoStack.length,undo);assert.equal(document.transaction,null);
});
test('public viewers, unknown accounts, shared rooms and active operations cannot mutate authored content',async t=>{
 for(const guard of ['viewer','unknown','shared','busy','loading','dragging','transaction']){
  const {bridge,editor,item,document}=fixture(t),before=await document.serialize();if(guard==='viewer'){editor.editable=false;editor.active=false;}else if(guard==='unknown')editor.ctx.studio.client.user=null;else if(guard==='shared')editor.ctx.studio.room={id:'shared'};else if(guard==='busy')editor.busy=true;else if(guard==='loading')editor.loadingProject=true;else if(guard==='dragging')editor.transform.dragging=true;else document.begin();
  await assert.rejects(bridge.registry.execute('update_component',{componentId:item.userData.editorId,patch:{visible:false}}));if(guard==='transaction')document.cancel();assert.deepEqual(await document.serialize(),before,guard);
 }
});
test('scene navigation respects the project catalogue, tombstones and module visibility',async t=>{
 const {bridge,editor,document}=fixture(t);assert.equal((await bridge.registry.execute('list_scenes',{})).scenes.length,2);assert.equal((await bridge.registry.execute('open_scene',{sceneId:'sound'})).opened.id,'sound');assert.equal(editor.roomId,'sound');
 await assert.rejects(bridge.registry.execute('open_scene',{sceneId:'photogrammetry'}),/disponible/);document.setStudio({scenes:[{id:'hall',name:'Inicio'}],deletedScenes:['sound'],startRoomId:'hall'});editor.ctx.room=0;await assert.rejects(bridge.registry.execute('open_scene',{sceneId:'sound'}),/disponible/);
 editor.vehicleDriving={id:'truck'};await assert.rejects(bridge.registry.execute('open_scene',{sceneId:'hall'}),/montacargas/);
});
test('an asynchronous panel action drops its result after a changed account and a queued mutation cannot run in parallel',async t=>{
 const {bridge,editor,item}=fixture(t);let resolve;const pending=new Promise(done=>resolve=done);editor.projectModules={open:()=>pending};const opening=bridge.registry.execute('show_panel',{panel:'modules'});await assert.rejects(bridge.registry.execute('update_component',{componentId:item.userData.editorId,patch:{visible:false}}),error=>error.code==='assistant_busy');editor.ctx.studio.client.user={id:'owner-b',permissions:{editor:true}};editor.accessView.identityGeneration++;resolve();await assert.rejects(opening,error=>error.code==='session_changed');
});
test('telemetry visuals are measured from authorized live records and do not expose another level or write simulation state',async t=>{
 const {bridge,editor,item,foreign}=fixture(t);let reads=0;editor.simulation={running:true,getSnapshot(){reads++;return {time:12,objects:[{id:item.userData.editorId,name:'Banda',variables:{speed:1.5,enabled:true}},{id:foreign.userData.editorId,name:'Not allowed',variables:{secret:777}}]};}};
 const result=await bridge.registry.execute('get_telemetry',{});assert.equal(reads,1);assert.equal(result.objects.length,1);assert.equal(result.visuals[0].sourceKind,'measured');assert.equal(result.visuals[0].points[0].value,1.5);assert(!JSON.stringify(result).includes('777'));assert.equal(result.objects[0].variables.enabled,true);await assert.rejects(bridge.registry.execute('get_telemetry',{componentId:foreign.userData.editorId}),/disponible/);assert.equal(reads,1);
});
