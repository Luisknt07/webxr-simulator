import ActionRegistry from '../../../packages/assistant-core/ActionRegistry.js';
import behaviorSchema from '../contracts/behaviors.js';

const ROOM_IDS=['hall','sound','photogrammetry','vertigo','panoramastereo','panorama1','panorama2','panorama3','panorama4','panorama5'];
const numericFields={conveyor:['speed','length','width','radius','curveAngle','supportHeight','rise','rollerPitch','zoneLength','mergeAngle','spawnInterval'],source:['capacity','interval','width','height','depth','palletColumns','palletRows','palletLayers','outputInterval'],processor:['processTime','setupTime','capacity','parallelism','outputCapacity','combineCount','splitCount','length','width','outputInterval'],palletQueue:['palletCapacity','width','depth','columns','rows','layers','capacity','rackBays','rackLevels','rackColumns','rackDepthSlots','rackBayWidth','rackSlotDepth','rackLevelHeight','rackBaseHeight','rackClearance','rackMaxLoadKg','rackLevelLoadKg','rackAisleWidth'],robot:['cycleTime','speed','reach','maxLoadKg'],vehicle:['maxSpeed','reverseSpeed','maxLiftHeight','maxLoadKg'],analytics:['interval']};
const error=(message,code)=>Object.assign(new Error(message),{code});
const text=(value,max=200)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,max):'';
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>JSON.parse(JSON.stringify(value));
const finite=(value)=>typeof value==='number'&&Number.isFinite(value);
const vector=value=>value&&typeof value.toArray==='function'?value.toArray().slice(0,3).map(number=>finite(number)?number:0):[0,0,0];
function dataFields(value,max=48){const result={};for(const [key,item]of Object.entries(value||{}).slice(0,max)){if(!/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/.test(key)||['constructor','prototype','__proto__'].includes(key))continue;if(typeof item==='boolean'||finite(item))result[key]=item;else if(typeof item==='string')result[key]=text(item,180);}return result;}

/** Industrial adapter only. Generic assistant orchestration owns no editor,
 * simulation, credentials or project files. All changes use authored APIs. */
export class AssistantActionBridge{
  constructor(ctx={},options={}){
    this.ctx=ctx;this.options=options;this.disposed=false;
    this.registry=new ActionRegistry({...options.registryOptions,getIdentity:()=>this.identity(),guard:execution=>this.guard(execution)});
    const register=(name,handler)=>this.registry.register(name,handler.bind(this));
    register('get_context',()=>this.snapshot());register('list_scenes',()=>({scenes:this.scenes()}));register('list_components',this.listComponents);register('open_scene',this.openScene);register('select_component',this.selectComponent);register('inspect_component',this.inspectComponent);register('update_component',this.updateComponent);register('show_panel',this.showPanel);register('get_telemetry',this.telemetry);
  }
  get editor(){return this.options.editor||this.ctx.editor;}
  actor(){const e=this.editor,client=this.ctx.studio&&this.ctx.studio.client||e&&e.ctx&&e.ctx.studio&&e.ctx.studio.client;return client&&client.user||e&&e.accessView&&e.accessView.user||null;}
  identity(){const e=this.editor,user=this.actor();return String(e&&e.currentProject&&e.currentProject.id||'local')+'@'+String(e&&e.projectGeneration||0)+'#'+String(user&&user.id||'')+'/'+String(e&&e.accessView&&e.accessView.identityGeneration||0);}
  canView(){
    const e=this.editor;if(this.disposed||!e||!e.document||e.loadingProject||e.initializing||e.accessLoadFailed||this.ctx.roomTransition||e.ctx&&e.ctx.roomTransition)return false;
    const access=e.currentProject&&e.currentProject.access,user=this.actor();
    if(e.accessView&&e.accessView.enabled&&!user&&!['public','template'].includes(access&&access.role))return false;
    if(access&&access.role==='owner'&&access.ownerId&&(!user||user.id!==access.ownerId))return false;
    return !e.accessView||typeof e.accessView.canVisit!=='function'||e.accessView.canVisit(e.roomId);
  }
  ready(edit=false,inside=false){
    const e=this.editor;if(!this.canView())throw error('No hay un proyecto autorizado listo para consultar.','assistant_context_unavailable');
    if(e.busy||e.loadingProject||e.creatingScene||e.importingFiles||e.pastingObject||e.creatingProject||e.document.loading||e.document.transaction||e.transform&&e.transform.dragging||!inside&&e.pendingEdits)throw error('Termina la operación actual antes de pedir otra acción.','assistant_busy');
    if(edit&&(!this.actor()||!this.actor().id||!e.active||!e.canEditDocument||!e.canEditDocument()||e.ctx&&e.ctx.vrMode||e.ctx&&e.ctx.studio&&e.ctx.studio.room))throw error('Abre un proyecto propio con permiso de edición para modificar componentes.','assistant_edit_forbidden');
    return e;
  }
  guard(execution){this.ready(execution.definition.effect==='edit');}
  scenes(){const e=this.editor;return (e&&e.getSceneEntries?e.getSceneEntries():[]).slice(0,256).map(row=>({id:String(row.id||row.roomId||ROOM_IDS[row.index]||''),name:text(row.name||row.title||row.id),moduleId:text(row.moduleId,100),current:(row.id||row.roomId||ROOM_IDS[row.index])===e.roomId})).filter(row=>row.id&&(!e.accessView||!e.accessView.canVisit||e.accessView.canVisit(row.id))&&(!e.projectModules||!e.projectModules.canShowLevel||e.projectModules.canShowLevel(row.moduleId)));}
  objects(){const e=this.editor;return e.document.getObjects(e.roomId).slice(0,10000).filter(object=>object&&object.userData&&object.userData.editorId&&e.document.getRoomForObject(object)===e.roomId&&!object.userData.editorRuntimeHelper);}
  editableFields(type){const allowed=new Set(numericFields[type]||[]),definition=behaviorSchema.definitionFor(type);return (definition&&definition.fields||[]).filter(field=>field.input==='number'&&allowed.has(field.key)).map(field=>({key:field.key,label:text(field.label,100),min:finite(field.min)?field.min:undefined,max:finite(field.max)?field.max:undefined}));}
  describe(object,{details=false}={}){const e=this.editor,behaviors=e.document.getBehaviors(object),result={id:String(object.userData.editorId),name:text(object.name),roomId:e.roomId,type:text(object.userData.editorPrefabKey||object.userData.editorDescriptor&&object.userData.editorDescriptor.type||'object',80),visible:object.visible!==false,position:vector(object.position),rotation:vector(object.rotation),scale:vector(object.scale),components:behaviors.slice(0,16).map(row=>({type:row.type,...(details?{parameters:dataFields(row),editableFields:this.editableFields(row.type)}:{})}))};if(details){const color=object.userData.editorColor;if(typeof color==='string')result.color=color;}return result;}
  snapshot(){
    const e=this.editor,base={identity:this.identity(),available:this.canView(),authenticated:!!(this.actor()&&this.actor().id)};if(!base.available)return {...base,editable:false,reason:'El contexto está cargando o no está autorizado.'};
    const objects=this.objects(),selected=e.selected&&objects.includes(e.document.getEditableObject(e.selected))?e.document.getEditableObject(e.selected):null;
    return {...base,project:{id:text(e.currentProject&&e.currentProject.id,200),name:text(e.projectName||e.currentProject&&e.currentProject.name),revision:e.currentProject&&e.currentProject.revision||0,dirty:!!e.dirty},roomId:e.roomId,editable:!!(this.actor()&&this.actor().id&&e.active&&e.canEditDocument&&e.canEditDocument()),mode:e.active?'editor':'viewer',scenes:this.scenes(),selected:selected?this.describe(selected,{details:true}):null,objectCount:objects.length,objects:objects.slice(0,80).map(object=>this.describe(object))};
  }
  object(id){const e=this.editor,object=id?e.document.getObject(id):e.selected&&e.document.getEditableObject(e.selected);if(!object||!object.userData||e.document.getRoomForObject(object)!==e.roomId||object.userData.editorRuntimeHelper)throw error('El componente no está disponible en el nivel actual.','assistant_component_missing');return object;}
  listComponents({query='',limit=40}={}){const needle=text(query).toLowerCase(),matches=this.objects().filter(object=>!needle||String(object.name||'').toLowerCase().includes(needle)||object.userData.editorId.includes(needle)||String(object.userData.editorPrefabKey||'').toLowerCase().includes(needle));return {components:matches.slice(0,Math.max(1,Math.min(100,limit))).map(object=>this.describe(object)),total:matches.length};}
  inspectComponent({componentId}={}){return {component:this.describe(this.object(componentId),{details:true})};}
  selectComponent({componentId}){const e=this.ready(),object=this.object(componentId);if(!e.active)throw error('Abre la edición para seleccionar un componente del inspector.','assistant_edit_forbidden');e.select(object);if(e.shell&&e.shell.setPanel)e.shell.setPanel('inspector',true);return {selected:this.describe(object,{details:true})};}
  async openScene({sceneId},execution){const e=this.ready(),scene=this.scenes().find(row=>row.id===sceneId);if(!scene)throw error('Ese nivel no está disponible en el proyecto o módulo actual.','assistant_scene_unavailable');if(e.ctx&&e.ctx.studio&&e.ctx.studio.room)throw error('Sal de la sala compartida antes de cambiar de nivel.','assistant_busy');if(e.vehicleDriving&&e.vehicleDriving.id)throw error('Detén el montacargas y baja antes de cambiar de nivel.','assistant_vehicle_active');execution.assertCurrent();if(scene.id!==e.roomId){const result=await e.hooks.gotoRoom(ROOM_IDS.indexOf(scene.id));execution.assertCurrent();if(result===false||e.roomId!==scene.id)throw error('No se pudo abrir el nivel solicitado.','assistant_scene_failed');}return {opened:{id:scene.id,name:scene.name},identity:this.identity()};}
  behaviorPatch(object,patch){
    const e=this.editor,previous=e.document.getBehaviors(object),config=previous.find(row=>row.type===patch.type);if(!config)throw error('El objeto no contiene ese componente.','assistant_component_missing');const fields=new Map(this.editableFields(patch.type).map(field=>[field.key,field]));const changed={...config};
    for(const [key,value]of Object.entries(patch.changes)){const field=fields.get(key);if(!field||!finite(value))throw error('Ese parámetro no está habilitado para edición asistida: '+key+'.','assistant_parameter_forbidden');if(field.min!==undefined&&value<field.min||field.max!==undefined&&value>field.max)throw error('El parámetro '+key+' está fuera del intervalo permitido.','assistant_parameter_range');changed[key]=value;}
    const result=behaviorSchema.normalizeBehaviors(previous.map(row=>row===config?changed:row));for(const [key,value]of Object.entries(patch.changes)){const normalized=result.find(row=>row.type===patch.type);if(!normalized||normalized[key]!==value)throw error('El valor '+key+' requiere otro valor compatible con el componente.','assistant_parameter_range');}return result;
  }
  async updateComponent({componentId,patch},execution){
    const e=this.ready(true),object=this.object(componentId),next=plain(patch)?patch:{};const fields=Object.keys(next);if(!fields.length)throw error('Indica al menos una propiedad para modificar.','assistant_empty_patch');
    const prepared=next.behavior?this.behaviorPatch(object,next.behavior):null,transform={};for(const key of ['position','rotation','scale'])if(next[key]!==undefined)transform[key]=next[key];if(next.scale&&next.scale.some(value=>value<=0))throw error('La escala debe ser positiva.','assistant_parameter_range');
    const before=this.describe(object,{details:true});let completed=false,failure;
    const change=()=>{execution.assertCurrent();this.ready(true,true);e.document.begin();try{for(const key of ['name','visible','color'])if(next[key]!==undefined)e.document.setProperty(object,key,next[key]);if(Object.keys(transform).length)(e.setEquipmentTransform?e.setEquipmentTransform.bind(e):e.document.setTransform.bind(e.document))(object,transform);if(prepared)(e.setEquipmentBehaviors?e.setEquipmentBehaviors.bind(e):e.document.setBehaviors.bind(e.document))(object,prepared);e.document.commit();completed=true;}catch(err){e.document.cancel();failure=err;throw err;}};
    if(e.perform)await e.perform(change);else change();if(failure)throw failure;if(!completed)throw error('La edición no se pudo completar.','assistant_edit_failed');execution.assertCurrent();if(e.renderTree)e.renderTree();if(e.renderInspector)e.renderInspector();if(e.updateStatus)e.updateStatus();return {updated:this.describe(object,{details:true}),before,undoAvailable:!!e.document.canUndo};
  }
  async showPanel({panel},execution){const e=this.ready(),shell=e.shell;execution.assertCurrent();if(panel==='editor'){if(!this.actor()||!e.canEditDocument||!e.canEditDocument()||e.ctx&&e.ctx.studio&&e.ctx.studio.room)throw error('No tienes permiso de edición para este proyecto o la sala está compartida.','assistant_edit_forbidden');if(!e.active)await e.enter();execution.assertCurrent();if(!e.active)throw error('No se pudo abrir la edición del proyecto.','assistant_edit_forbidden');}
    else if(panel==='viewer'){if(e.active)e.leave();}
    else if(panel==='voice'){if(this.ctx.voicePanel)this.ctx.voicePanel.open();else throw error('El panel de voz no está instalado.','assistant_panel_unavailable');}
    else if(panel==='simulation'){if(e.simulationPanel)e.simulationPanel.toggle(true);else throw error('El monitor no está disponible.','assistant_panel_unavailable');}
    else if(panel==='scenes'){if(shell&&shell.openSceneCatalog)shell.openSceneCatalog();else if(this.ctx.studio&&this.ctx.studio.open)this.ctx.studio.open('scenes');else throw error('El catálogo no está disponible.','assistant_panel_unavailable');}
    else if(panel==='content'){if(!e.active)throw error('Abre la edición para organizar el contenido.','assistant_edit_forbidden');if(e.openProjectContent)e.openProjectContent();else throw error('El contenido no está disponible.','assistant_panel_unavailable');}
    else if(panel==='modules'){if(e.projectModules)await e.projectModules.open({viewer:!e.active});else throw error('El gestor de módulos no está disponible.','assistant_panel_unavailable');}
    else if(['inspector','hierarchy'].includes(panel)){if(!e.active||!shell||!shell.setPanel)throw error('Ese panel requiere la edición abierta.','assistant_panel_unavailable');shell.setPanel(panel,true);}
    else throw error('El panel solicitado no está habilitado.','assistant_panel_unavailable');execution.assertCurrent();return {panel,opened:true};
  }
  telemetry({componentId}={}){
    const e=this.ready(),simulation=e.simulation;if(!simulation||!simulation.running||typeof simulation.getSnapshot!=='function')return {available:false,message:'No hay una simulación activa.',objects:[],visuals:[]};
    if(componentId)this.object(componentId);const allowed=new Set(this.objects().map(object=>object.userData.editorId)),snapshot=simulation.getSnapshot(),objects=(snapshot.objects||[]).filter(row=>allowed.has(row.id)&&(!componentId||row.id===componentId)).slice(0,40).map(row=>({id:text(row.id,400),name:text(row.name),variables:dataFields(row.variables,64)}));
    const points=objects.flatMap(row=>Object.entries(row.variables).filter(([key,value])=>finite(value)).slice(0,componentId?12:2).map(([key,value])=>({label:text((row.name||row.id)+' · '+key,120),value}))).slice(0,24);
    return {available:true,time:finite(snapshot.time)?snapshot.time:0,roomId:e.roomId,objects,visuals:points.length?[{type:'chart',chartType:'table',title:componentId?'Variables del componente':'Variables de la simulación',points,unit:'variable',sourceKind:'measured',source:'Simulación actual'}]:[]};
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.registry.dispose();}
}
export const createAssistantActions=(ctx,options)=>{const bridge=new AssistantActionBridge(ctx,options);return {registry:bridge.registry,snapshot:()=>bridge.snapshot(),dispose:()=>bridge.dispose(),bridge};};
export default createAssistantActions;
