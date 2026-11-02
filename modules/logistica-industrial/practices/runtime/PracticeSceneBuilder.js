import * as THREE from 'three';
import schema from '../../contracts/behaviors.js';
import recipes from '../schema/PracticeRecipes.cjs';
import catalogue from '../../functions/equipamiento/schema/equipmentCatalog.cjs';
import ConveyorAssembly from '../../functions/bandas/runtime/ConveyorAssembly.js';
import {buildStudyScene} from '../../scenarios/IndustrialStudyScenes.js';
import {studyWorkspace,studySceneBase,disposeStudyGeometry} from '../../scenarios/StudySceneProject.js';
import {buildConfigurablePracticeScene} from '../configurable/runtime/ConfigurablePracticeScene.js';

const MODULE='sector.logistics-industrial';
const id=object=>object.userData.editorId;
const types=['source','conveyor','processor','palletQueue','robot','vehicle','sensor','automation','product'];
const component=(doc,object)=>doc.getBehaviors(object).find(value=>types.includes(value.type));
function patch(doc,object,changes){const current=component(doc,object);doc.setBehaviors(object,doc.getBehaviors(object).map(value=>value.type===current.type?Object.assign({},value,changes):value));}
function native(doc,roomId,kind,name,variant,values,position){const object=doc.addPrefab(roomId,kind,variant);if(values)patch(doc,object,values);doc.setProperty(object,'name',name);if(position)doc.setTransform(object,{position});object.traverse(child=>{const defaults=child.userData.editorDefaultBehaviors;if(Array.isArray(defaults)&&defaults.some(row=>Object.values(row).includes('@root')))child.userData.editorDefaultBehaviors=defaults.map(row=>JSON.parse(JSON.stringify(row,(key,value)=>value==='@root'?id(object):value)));});return object;}

function environment(doc,roomId,plan){
 const objects=[],w=plan.referenceLayout.area.width,depth=plan.referenceLayout.area.depth;
 const part=(name,color,position,scale,collide=true)=>{const o=doc.addPrimitive(roomId,'box',color);doc.setProperty(o,'name',name);doc.setTransform(o,{position,scale});doc.setBehaviors(o,[Object.assign(schema.defaultBehavior('collision'),{enabled:collide})]);objects.push(o);return o;};
 const finish=(preset,color)=>Object.assign(schema.defaultBehavior('surfaceMaterial'),{preset,color,roughness:.82,metalness:0});
 const floor=part('Instalación · suelo de hormigón','#8b9392',[0,-.12,0],[w,.24,depth]);doc.setBehaviors(floor,[schema.defaultBehavior('collision'),schema.defaultBehavior('teleport'),finish('concrete','#8b9392')]);
 for(const x of [-w/2,w/2]){const wall=part('Instalación · pared lateral','#a6aaa4',[x,3,0],[.18,6,depth]);doc.setBehaviors(wall,[schema.defaultBehavior('collision'),finish('concrete','#a6aaa4')]);}
 const back=part('Instalación · pared posterior','#a6aaa4',[0,3,-depth/2],[w,6,.18]);doc.setBehaviors(back,[schema.defaultBehavior('collision'),finish('concrete','#a6aaa4')]);
 part('Instalación · techo industrial','#45535c',[0,6,0],[w,.16,depth]);
 for(const x of [-w*.3,0,w*.3]){part('Viga de techo','#34434b',[x,5.82,0],[.18,.2,depth]);for(const z of [-depth*.25,depth*.25]){const light=part('Luminaria LED','#e9f0e7',[x,5.68,z],[1.8,.05,.18],false);doc.setBehaviors(light,[Object.assign(schema.defaultBehavior('surfaceMaterial'),{preset:'custom',color:'#e9f0e7',emissive:'#c7d6cb',emissiveIntensity:.5,roughness:.4,metalness:0})]);}}
 for(const x of [-w/2+2,w/2-2]){part('Pasillo peatonal · límite de equipo','#478c7c',[x,.012,0],[1.2,.018,depth-2],false);}
  doc.setStudio({environments:(doc.studio&&doc.studio.environments||[]).filter(row=>row.roomId!==roomId).concat([Object.assign(schema.studio.defaultEnvironment(roomId),{sky:'color',skyColor:'#b5c0c5',horizonColor:'#b5c0c5',groundColor:'#84918f',sunIntensity:.8,ambientIntensity:.5,shadows:false,renderQuality:'balanced'})])});
 return objects;
}

function flow(doc,roomId,plan,scene){
 const objects=[],assembly=new ConveyorAssembly({document:doc,roomId,root:doc.getRoot(roomId),ctx:{scene},hooks:{renderScene:scene},assemblyMessage(){}});
 const automatic=plan.mode==='automatic',manual=plan.mode==='manual';
 const sourceCatalog=[Object.assign({},plan.product,{id:plan.sku,name:plan.title+' · unidad de práctica',quality:'good',defect:'none'})];
 if(plan.id==='I29')sourceCatalog.push(Object.assign({},sourceCatalog[0],{id:plan.id+'-SKU-02',name:'Familia B · cambio de formato',width:plan.width*.8,depth:plan.depth*1.15,color:'#6295a6'}));
 const source=native(doc,roomId,'source','01 · Entrada identificada · '+plan.sku,undefined,{running:true,withPanel:false,autoGenerate:false,initialCount:plan.units,totalLimit:plan.units,capacity:Math.max(8,plan.units),delivery:automatic?'automatic':'manual',outputInterval:.4,generationMode:'sequence',catalog:JSON.stringify(sourceCatalog)},[-7,1,0]);objects.push(source);
 const main=catalogue.definition(plan.mainEquipmentId),machine=catalogue.definition(plan.machineEquipmentId);
 if(!machine||machine.nativeKind!=='processor')throw Error('La operación no dispone de una máquina de proceso real: '+plan.id);
 const process=native(doc,roomId,machine.nativeKind,'02 · '+machine.title,'catalogue:'+machine.id,{powered:true,running:true,paused:false,withPanel:true,processTime:plan.cycleSeconds,setupTime:0,setupPolicy:'startup',requiresOperator:manual,operatorAvailable:!manual,capacity:Math.max(8,plan.units),outputCapacity:Math.max(8,plan.units),delivery:automatic?'automatic':'manual',length:plan.processLength,width:plan.product.type==='pallet'?1.6:1.4},[0,1,0]);objects.push(process);
 const before=['I16','I17'].includes(plan.id)?['equipment.machine.hopper-doser']:['I20','I21'].includes(plan.id)?['equipment.machine.fixture']:[];
 const after=['I16','I17','I19'].includes(plan.id)?['equipment.machine.cooling']:['I20','I21'].includes(plan.id)?['equipment.machine.test-bench']:['I28','I29'].includes(plan.id)?['equipment.machine.assembly-bench','equipment.machine.assembly-bench']:[];
 const createStage=(equipmentId,index)=>{const definition=catalogue.definition(equipmentId),cycle=plan.cycleSeconds*(plan.id==='I28'?(plan.caseId==='B'?1.1:index?1.5:2):1);const stage=native(doc,roomId,'processor',definition.title+' · etapa '+(index+2),'catalogue:'+equipmentId,{powered:true,running:true,paused:false,withPanel:false,processTime:cycle,setupTime:plan.id==='I29'?plan.cycleSeconds:0,setupPolicy:plan.id==='I29'?'productChange':'startup',requiresOperator:manual,operatorAvailable:!manual,capacity:Math.max(8,plan.units),outputCapacity:Math.max(8,plan.units),delivery:automatic?'automatic':'manual',length:plan.processLength,width:plan.product.type==='pallet'?1.6:1.4},[0,1,0]);objects.push(stage);return stage;};
 const stages=before.map(createStage).concat([process],after.map(createStage));if(plan.id==='I29')patch(doc,process,{setupTime:plan.cycleSeconds,setupPolicy:'productChange'});
 const conveyorDefinition=plan.id==='I29'?catalogue.definition('equipment.transport.flat-belt'):main.nativeKind==='conveyor'?main:catalogue.source('nexus-illustrated-2026:'+(plan.product.type==='pallet'?'TR-03':'TR-02'));
 const conveyor=native(doc,roomId,'conveyor','03 · '+conveyorDefinition.title,'catalogue:'+conveyorDefinition.id,{powered:true,running:!manual,paused:false,autoSpawn:false,withPanel:false,speed:plan.transportSpeed,length:plan.transportLength,width:plan.product.type==='pallet'?1.6:1.2,rise:0},[3,1,0]);objects.push(conveyor);
 const receiver=native(doc,roomId,'palletQueue','04 · Destino confirmado · '+plan.id,undefined,{running:true,paused:false,withPanel:false,capacity:plan.product.type==='pallet'?plan.units:Math.max(24,plan.units),palletCapacity:plan.product.type==='pallet'?plan.units:2,acceptsPallets:plan.product.type==='pallet',columns:3,rows:2,layers:2,palletType:'euro-1200x800',layoutMode:'fit',autoRelease:false,delivery:'manual'},[6,1,0]);objects.push(receiver);
 const chain=[source].concat(stages,[conveyor,receiver]),links=[];try{for(let index=1;index<chain.length;index++){const pair=[chain[index-1],chain[index]];if(!assembly.align(pair[0],'output',pair[1],'input')||!assembly.connect(assembly.pair(pair[1],'input',pair[0],'output')))throw Error('Los puertos de la práctica no coinciden: '+pair[0].name+' → '+pair[1].name);links.push({source:id(pair[0]),target:id(pair[1]),sourcePort:'output',targetPort:'input'});}}finally{assembly.clear();}
 const instrument=main.nativeKind==='sensor'?native(doc,roomId,'sensor','Identificación / medición de proceso','catalogue:'+main.id,{sourceId:id(conveyor)},[process.position.x,1,2]):null;if(instrument)objects.push(instrument);
 if(!['processor','conveyor','sensor'].includes(main.nativeKind)&&!['workspace','attachment'].includes(main.operationLevel)){const object=native(doc,roomId,main.nativeKind,main.title+' · recurso de la operación','catalogue:'+main.id,{withPanel:false},[-2,main.nativeKind==='source'||main.nativeKind==='palletQueue'?1:0,-5]);objects.push(object);}
 return {objects,links,sourceIds:[id(source)],processIds:stages.map(id),receiverIds:[id(receiver)],conveyorIds:[id(conveyor)],vehicleIds:[],robotIds:[],expectedUnits:plan.units,source,receiver,process};
}

function emptyOperation(){return{objects:[],links:[],sourceIds:[],processIds:[],receiverIds:[],conveyorIds:[],vehicleIds:[],robotIds:[],expectedUnits:0};}

/** Source drawings use zones: a 6×4 CNC zone is not a 6×4 casting. Keep that
 * envelope exactly, select a real catalogue actor, then measure its real body.
 * Connected rigs retain their tested geometry and custody; adaptations are
 * reported instead of stretching machines or fabricating distant transfers. */
function mountSourceLayout(doc,roomId,plan,built){
 const rows=recipes.layoutBindings.bindings(plan),claimed=new Set(),extras=[],adjustments=[];
 const nativeActors=built.objects.filter(object=>component(doc,object)),sourceRow=rows.find(row=>row.role==='source')||rows[0],mainRow=rows.find(row=>row.catalogueEquipmentId===plan.mainEquipmentId),anchor=built.process||built.robot;
 if(built.source&&sourceRow&&plan.kind!=='vehicle'){
  const desired=mainRow&&anchor?mainRow.sourceCenter:sourceRow.sourceCenter,actor=mainRow&&anchor?anchor:built.source;
  const delta=new THREE.Vector3().fromArray(desired).sub(actor.position);delta.y=0;
  built.objects.forEach(object=>doc.setTransform(object,{position:object.position.clone().add(delta).toArray()}));
 }
 const mainId=plan.machineEquipmentId||plan.mainEquipmentId;
 const actualDefinition=object=>{const c=component(doc,object);if(!c)return'';const exact=c.catalogueEquipmentId||object.userData.catalogueEquipmentId;if(exact)return exact;const variant=c.type==='palletQueue'?c.rackSystem:c.variant;const d=variant&&catalogue.DEFINITIONS.find(d=>d.nativeKind===c.type&&d.nativeVariant===variant);return d&&d.id||'';};
 const prefer=(row,index)=>{
  if(row.role==='source'&&built.source&&!claimed.has(built.source))return built.source;
  if(row.role==='bay'&&index===rows.map(r=>r.role).lastIndexOf('bay')&&built.receiver&&!claimed.has(built.receiver))return built.receiver;
  let object=nativeActors.find(o=>!claimed.has(o)&&actualDefinition(o)===row.catalogueEquipmentId&&row.catalogueEquipmentId);
  if(!object&&row.catalogueEquipmentId===mainId&&built.process&&!claimed.has(built.process))object=built.process;
  if(!object&&row.nativeKind==='vehicle')object=nativeActors.find(o=>!claimed.has(o)&&component(doc,o).type==='vehicle');
  if(!object&&row.nativeKind==='robot')object=nativeActors.find(o=>!claimed.has(o)&&component(doc,o).type==='robot');
  if(!object&&row.role==='storage')object=nativeActors.find(o=>!claimed.has(o)&&component(doc,o).type==='palletQueue'&&component(doc,o).rackSystem);
  if(!object&&row.nativeKind==='conveyor')object=nativeActors.find(o=>!claimed.has(o)&&component(doc,o).type==='conveyor');
  return object;
 };
 for(let index=0;index<rows.length;index++){
  const row=rows[index],[sx,sz]=[row.sourceCenter[0],row.sourceCenter[2]];
  // A thin floor demarcation has no physical cargo or operational permissions.
  const zone=doc.addPrimitive(roomId,'box',row.role==='walk'?'#438f7a':'#4c6974');doc.setProperty(zone,'name',plan.id+' · '+row.sourceElementId+' · '+row.sourceName+' · área del plano');
  doc.setTransform(zone,{position:[sx,.008,sz],scale:[row.sourceDimensions[0],.012,row.sourceDimensions[1]]});doc.setBehaviors(zone,[schema.defaultBehavior('analytics'),Object.assign(schema.defaultBehavior('collision'),{enabled:false})]);extras.push(zone);row.zoneObjectId=id(zone);
  let object=prefer(row,index),created=false;
  if(!object){
   if(['area','walk'].includes(row.role))object=zone;
   else{
    const isSource=row.role==='source',isBay=row.role==='bay',d=row.catalogueEquipmentId&&catalogue.definition(row.catalogueEquipmentId),kind=isSource?'source':isBay?'palletQueue':d.nativeKind;
    const values={running:false,powered:true,paused:false,withPanel:false,detail:'low',autoGenerate:false,initialCount:0,totalLimit:0,autoSpawn:false,delivery:'manual'};
    if(kind==='source')Object.assign(values,{running:plan.kind==='documentary',initialCount:plan.kind==='documentary'?plan.units:0,totalLimit:plan.kind==='documentary'?plan.units:0,capacity:Math.max(4,plan.units),catalog:JSON.stringify([Object.assign({},plan.product,{id:plan.sku,name:plan.sku+' · lote identificado',quality:'good',defect:'none'})])});
    if(kind==='palletQueue')Object.assign(values,{rackBays:Math.max(1,Math.min(3,Math.floor(row.sourceDimensions[1]/3))),rackLevels:Math.max(1,Math.min(2,Math.floor(row.sourceDimensions[2]/1.5))),rackColumns:1,rackDepthSlots:1,rackBanks:1,rackAisleCode:plan.id,rackRowCode:'R'+row.sourceElementId});
    if(kind==='robot')Object.assign(values,{mode:'manual',running:false,reach:1.4,payloadKg:8,withPanel:false,wear:.15});
    if(kind==='vehicle')Object.assign(values,{enabled:false,cabInterior:false});
    const position=[sx,kind==='plc'?1.28:['source','processor','conveyor','palletQueue'].includes(kind)?1:0,sz];
    object=native(doc,roomId,kind,plan.id+' · '+row.sourceElementId+' · '+row.sourceName,d?'catalogue:'+d.id:undefined,values,position);extras.push(object);created=true;
    if(kind==='vehicle'){object.userData.practiceSupportOnly=true;object.userData.practiceContextLod='low-exterior; current body and physical rig preserved';}
    if(row.role==='storage'){const b=new THREE.Box3().setFromObject(object),size=b.getSize(new THREE.Vector3());if(size.x>row.sourceDimensions[0]&&size.z<row.sourceDimensions[0])doc.setTransform(object,{rotation:[0,Math.PI/2,0]});}
   }
  }
  if(created){
   object.updateWorldMatrix(true,true);let bounds=new THREE.Box3().setFromObject(object);
   if(plan.kind==='vehicle'&&bounds.min.x<1.7&&bounds.max.x> -1.7&&bounds.min.z<8&&bounds.max.z> -8){const direction=sx>=0?1:-1,delta=direction>0?1.9-bounds.min.x:-1.9-bounds.max.x;doc.setTransform(object,{position:[object.position.x+delta,object.position.y,object.position.z]});row.adjustmentReason='Activo auxiliar fuera del corredor real de maniobra de 3.8 m; no se omiten sus colisiones.';}
   else if(plan.kind!=='documentary'&&plan.kind!=='vehicle'){
    const reserved=nativeActors.filter(core=>core!==object).map(core=>new THREE.Box3().setFromObject(core));
    const overlapping=reserved.filter(box=>bounds.clone().expandByScalar(.08).intersectsBox(box));if(overlapping.length){const maxZ=Math.max(...overlapping.map(box=>box.max.z));doc.setTransform(object,{position:[object.position.x,object.position.y,object.position.z+maxZ+.3-bounds.min.z]});row.adjustmentReason='Puesto auxiliar separado de la celda conectada para conservar holgura entre cuerpos y recorrido de producto.';}
   }
  }
  claimed.add(object);object.userData.practiceSourceElementId=plan.id+':'+row.sourceElementId;object.userData.practiceSourceKey=row.sourceKey;
  row.objectId=id(object);row.actualPosition=object.position.toArray();row.actualCatalogueEquipmentId=actualDefinition(object)||row.catalogueEquipmentId;
  if(row.catalogueEquipmentId&&row.actualCatalogueEquipmentId!==row.catalogueEquipmentId)adjustments.push({sourceElementId:row.sourceElementId,objectId:row.objectId,requestedCatalogueEquipmentId:row.catalogueEquipmentId,actualCatalogueEquipmentId:row.actualCatalogueEquipmentId,reason:'La misión usa el mecanismo nativo de la celda seleccionada; no se declara una tipología distinta ni se escala su cinemática.'});
  object.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3());row.actualFootprint=[size.x,size.z,size.y];
  const moved=Math.hypot(row.actualPosition[0]-sx,row.actualPosition[2]-sz)>.05;
  if(moved){row.adjustmentReason=row.adjustmentReason||'Celda nativa localizada por puertos, holgura de mecanismo y alcance; el área fuente permanece demarcada.';adjustments.push({sourceElementId:row.sourceElementId,objectId:row.objectId,sourceCenter:row.sourceCenter,actualPosition:row.actualPosition,reason:row.adjustmentReason});}
  if(created&&size.y>row.sourceDimensions[2]+.25)adjustments.push({sourceElementId:row.sourceElementId,objectId:row.objectId,reason:'Altura del activo nativo conservada; la cota del documento describe la envolvente de referencia, no un escalado del mecanismo.',actualHeight:size.y,referenceHeight:row.sourceDimensions[2]});
 }
 for(const object of nativeActors)if(!claimed.has(object))adjustments.push({objectId:id(object),reason:'Interfaz auxiliar de la celda funcional: conserva apoyos, puertos y custodia real; no sustituye una zona documental.'});
 built.objects.push(...extras);
 if(plan.kind==='documentary'&&!built.sourceIds.length){
  const actorRows=rows.filter(row=>{const object=doc.getObject(row.objectId);return object&&component(doc,object);});
  const stockRows=actorRows.filter(row=>row.role==='source');built.sourceIds=stockRows.length?stockRows.map(row=>row.objectId):[actorRows[0].objectId];built.receiverIds=[actorRows[actorRows.length-1].objectId];built.expectedUnits=plan.units;
 }
 const evidenceAdapter=recipes.layoutBindings.evidence(plan,rows);
 const toolOptions=plan.id==='I23'?['equipment.tool.parallel-gripper','equipment.tool.three-finger','equipment.tool.vacuum-single'].map((toolId,index)=>({id:toolId,title:catalogue.definition(toolId).title,standId:rows[[2,3,6][index]].objectId,tool:catalogue.definition(toolId).toolType})):[];
 return{layoutElements:rows,layoutAdjustments:adjustments,evidenceAdapter,toolOptions,requiredToolId:plan.id==='I23'?'equipment.tool.three-finger':'',nativeActions:['I23','I28','I29'].includes(plan.id)?['feed','cycle','dispatch']:[],validation:{sourceElementCount:rows.length,mappedElementCount:rows.filter(row=>row.objectId).length,originalArea:plan.referenceLayout.area,coordinateMapping:recipes.layoutBindings.sourceMapping,routeStatus:'reference-polyline; live routing uses actual ports and mission waypoints',modePolicy:'one selected alternative per source position',scope:plan.kind==='documentary'?'documentary-workflow; no synthetic production counters':'native-material-custody',rv:{activeCopies:1,maxInitialUnits:plan.units,detail:'low for supporting equipment; functional core unchanged'}}};
}

function addSourceWayfinding(doc,roomId,plan,built,layout){
 const rows=layout.layoutElements,area=plan.referenceLayout.area;
 const route=built.task?Array.from(new Map((built.task.pickupRoute||[]).concat(built.task.route||[]).map(point=>[point.x+','+point.z,[point.x,point.z]])).values()):plan.id==='L01'?[rows[0],rows[2],rows[3]].map(row=>[row.actualPosition[0],row.actualPosition[2]]):[];
 let length=0;const arrows=[];
 for(let index=1;index<route.length;index++){const a=route[index-1],b=route[index],dx=b[0]-a[0],dz=b[1]-a[1],span=Math.hypot(dx,dz);length+=span;for(let distance=.8;distance<span;distance+=1.4)arrows.push([a[0]+dx*distance/span,a[1]+dz*distance/span,Math.atan2(dx,dz)]);}
 const floorPlan={type:'industrialFloor',version:1,bounds:[-area.width/2,-area.depth/2,area.width/2,area.depth/2],floorY:.029,texts:rows.map(row=>(row.sourceElementId+' · '+row.sourceName).slice(0,64)),labels:rows.map((row,index)=>[row.sourceCenter[0],row.sourceCenter[2]+row.sourceDimensions[1]/2-.28,0,Math.max(.25,Math.min(3.8,row.sourceDimensions[0]-.12)),.32,8+index]),arrows:arrows.slice(0,96)};
 const presentation=doc.addIndustrialFloorPresentation(roomId,floorPlan);doc.setProperty(presentation,'name',plan.id+' · identificación original y guía de recorrido');doc.setBehaviors(presentation,[Object.assign(schema.defaultBehavior('collision'),{enabled:false})]);built.objects.push(presentation);
 layout.executionRoute={points:route,measuredLengthM:length,provenance:built.task?'derived-native-mission-waypoints':route.length?'derived-source-zone-interaction-guide':'native-connected-ports',referencePolylineLengthM:plan.referenceLayout.referencePolylineLengthM,referencePointsSupplied:false,purpose:built.task?'vehicle-mission':route.length?'operator-interaction':'material-flow',notice:'La longitud de la lámina es una referencia. Esta guía usa los puntos reales declarados del montaje, no coordenadas supuestas de la imagen.'};
}

function transport(doc,roomId,plan,scene){
 const objects=[],assembly=new ConveyorAssembly({document:doc,roomId,root:doc.getRoot(roomId),ctx:{scene},hooks:{renderScene:scene},assemblyMessage(){}}),automatic=plan.mode==='automatic',pallet=plan.product.type==='pallet';
 const source=native(doc,roomId,'source','01 · Entrada identificada · '+plan.sku,undefined,{running:true,withPanel:false,autoGenerate:false,initialCount:plan.units,totalLimit:plan.units,capacity:Math.max(8,plan.units),delivery:automatic?'automatic':'manual',outputInterval:.4,generationMode:'sequence',catalog:JSON.stringify([Object.assign({},plan.product,{id:plan.sku,name:plan.title+' · carga identificada',quality:'good',defect:'none'})])},[-8,1,0]);objects.push(source);
 const definitions=[catalogue.definition(plan.mainEquipmentId),catalogue.source('nexus-illustrated-2026:'+(pallet?'TR-03':'TR-02')),catalogue.source('nexus-illustrated-2026:'+(pallet?'TR-07':'TR-02'))],conveyors=[];
 definitions.forEach((d,index)=>{const o=native(doc,roomId,'conveyor',String(index+2)+' · '+d.title,'catalogue:'+d.id,{powered:true,running:plan.mode!=='manual',paused:false,autoSpawn:false,withPanel:index===0,speed:plan.transportSpeed,length:plan.transportLength,width:pallet?1.6:1.2,rise:0},[-4+index*3,1,0]);objects.push(o);conveyors.push(o);});
 const receiver=native(doc,roomId,'palletQueue','05 · Salida verificada · '+plan.id,undefined,{running:true,paused:false,withPanel:false,capacity:pallet?plan.units:Math.max(24,plan.units),palletCapacity:pallet?plan.units:2,acceptsPallets:pallet,columns:3,rows:2,layers:2,palletType:'euro-1200x800',layoutMode:'fit',autoRelease:false,delivery:'manual'},[7,1,0]);objects.push(receiver);
 const chain=[source].concat(conveyors,[receiver]),links=[];try{for(let index=1;index<chain.length;index++){const a=chain[index-1],b=chain[index];if(!assembly.align(a,'output',b,'input')||!assembly.connect(assembly.pair(b,'input',a,'output')))throw Error('Falla de interfaz de transporte de '+plan.id);links.push({source:id(a),target:id(b),sourcePort:'output',targetPort:'input'});}}finally{assembly.clear();}
 return{objects,links,sourceIds:[id(source)],processIds:[],receiverIds:[id(receiver)],conveyorIds:conveyors.map(id),vehicleIds:[],robotIds:[],expectedUnits:plan.units,source,receiver};
}

function robot(doc,roomId,plan,scene){
 const built=buildStudyScene(doc,roomId,'robot-handling-line',{scene,continuous:false,preview:true});
 const source=built.sources[0],receiver=built.receivers[0],r=built.objects.find(object=>component(doc,object)&&component(doc,object).type==='robot');
 patch(doc,source,{initialCount:plan.units,totalLimit:plan.units,autoGenerate:false,interval:1.5,catalog:JSON.stringify([Object.assign({},plan.product,{id:plan.sku,name:'Pieza identificada · '+plan.id,quality:'good',defect:'none'})])});
 patch(doc,r,{mode:plan.mode==='automatic'?'automatic':'manual',running:plan.mode==='automatic',speed:.7,withPanel:true,payloadKg:8,wear:.22});
 if(plan.id==='I23')patch(doc,r,{catalogueToolId:'equipment.tool.parallel-gripper',tool:'gripper',toolMassKg:.5,mode:'manual',running:false});
 return {objects:built.objects,links:built.links||[],sourceIds:[id(source)],receiverIds:[id(receiver)],processIds:[],conveyorIds:built.objects.filter(object=>component(doc,object)&&component(doc,object).type==='conveyor').map(id),robotIds:[id(r)],vehicleIds:[],expectedUnits:plan.units,source,receiver,robot:r};
}

export function buildPracticeScene(doc,roomId,practiceId,options={}){
 if(/^(CEDI|SF)-0[1-5]$/.test(practiceId))return buildConfigurablePracticeScene(doc,roomId,practiceId,options);
 const plan=recipes.plan(practiceId,options),own=!doc.transaction;if(own)doc.begin();
 try{
  studySceneBase(doc,roomId);const shell=environment(doc,roomId,plan);
  let built;
  if(plan.kind==='documentary')built=plan.id==='I23'?robot(doc,roomId,plan,options.scene):['I28','I29'].includes(plan.id)?flow(doc,roomId,plan,options.scene):emptyOperation();
  else if(plan.kind==='vehicle')built=require('./PracticeVehicleScene.js').buildVehiclePractice(doc,roomId,plan,{scene:options.scene});
  else built=plan.kind==='robot'?robot(doc,roomId,plan,options.scene):['L06','L20','L21','L31','I24'].includes(plan.id)?transport(doc,roomId,plan,options.scene):flow(doc,roomId,plan,options.scene);
  const layout=mountSourceLayout(doc,roomId,plan,built);
  addSourceWayfinding(doc,roomId,plan,built,layout);
  const all=shell.concat(built.objects),stageIds=built.processIds.concat(built.robotIds||[],built.vehicleIds||[]);
  const manifest={version:1,practiceId:plan.id,caseId:plan.caseId,mode:plan.mode,difficulty:plan.difficulty,roomId,sourceId:built.sourceIds[0],processIds:stageIds,receiverId:built.receiverIds[0],expectedUnits:built.expectedUnits,sku:plan.sku,steps:plan.steps,
   sourceIds:built.sourceIds,receiverIds:built.receiverIds,conveyorIds:built.conveyorIds||[],robotIds:built.robotIds||[],vehicleIds:built.vehicleIds||[],kind:plan.kind,title:plan.title,productIds:built.productIds||[],targetProductId:built.targetProductId||'',incident:plan.incident,incidentKind:plan.incidentKind,sourceSha256:plan.sourceSha256,plan:JSON.parse(JSON.stringify(plan)),...layout};
  const studio=doc.studio||{},moduleData=Object.assign({},studio.moduleData||{}),data=Object.assign({version:1,levels:[],attempts:[]},moduleData[MODULE]||{});
  data.levels=(data.levels||[]).filter(row=>row.roomId!==roomId).concat([manifest]);moduleData[MODULE]=data;
  doc.setStudio({moduleData,scenes:(studio.scenes||[]).filter(row=>row.id!==roomId).concat([{id:roomId,name:plan.id+' · '+plan.title+' · '+plan.caseId,moduleId:MODULE}]),startRoomId:roomId});
  doc.getRoot(roomId).updateWorldMatrix(true,true);const actorIds=all.map(id);
  if(actorIds.some(value=>!value)||new Set(actorIds).size!==actorIds.length)throw Error('La práctica contiene identificadores repetidos.');
  if(own)doc.commit();return Object.assign(built,{plan,manifest,objects:all,report:{id:plan.id,caseId:plan.caseId,mode:plan.mode,actors:all.length,equipment:built.objects.length,links:built.links||[],expectedUnits:built.expectedUnits,sourceIds:built.sourceIds,receiverIds:built.receiverIds}});
 }catch(error){if(own)doc.cancel();throw error;}
}

export async function compilePracticeProject(practiceId,options={}){
 const workspace=studyWorkspace(),roomId='hall';try{const built=buildPracticeScene(workspace.document,roomId,practiceId,Object.assign({},options,{scene:workspace.scene}));const document=await workspace.document.serialize();
  if(options.nativeDocument&&options.nativeDocument.native)options.nativeDocument.native.forEach((entry,nativeId)=>{if(entry.roomId===roomId&&entry.object.parent===options.nativeDocument.getRoot(roomId))document.rooms[roomId].overrides.push({id:nativeId,visible:false});});
  return{name:'Práctica '+practiceId+' · '+built.plan.title+' · '+built.plan.caseId,document,reports:[built.report]};
 }finally{disposeStudyGeometry(workspace.scene);}
}
