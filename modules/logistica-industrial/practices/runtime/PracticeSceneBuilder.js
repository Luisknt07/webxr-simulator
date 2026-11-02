import * as THREE from 'three';
import schema from '../../contracts/behaviors.js';
import recipes from '../schema/PracticeRecipes.cjs';
import catalogue from '../../functions/equipamiento/schema/equipmentCatalog.cjs';
import ConveyorAssembly from '../../functions/bandas/runtime/ConveyorAssembly.js';
import {buildStudyScene} from '../../scenarios/IndustrialStudyScenes.js';
import {studyWorkspace,studySceneBase,disposeStudyGeometry} from '../../scenarios/StudySceneProject.js';

const MODULE='sector.logistics-industrial';
const id=object=>object.userData.editorId;
const types=['source','conveyor','processor','palletQueue','robot','vehicle','sensor'];
const component=(doc,object)=>doc.getBehaviors(object).find(value=>types.includes(value.type));
function patch(doc,object,changes){const current=component(doc,object);doc.setBehaviors(object,doc.getBehaviors(object).map(value=>value.type===current.type?Object.assign({},value,changes):value));}
function native(doc,roomId,kind,name,variant,values,position){const object=doc.addPrefab(roomId,kind,variant);if(values)patch(doc,object,values);doc.setProperty(object,'name',name);if(position)doc.setTransform(object,{position});return object;}

function environment(doc,roomId,plan){
 const objects=[],w=Math.max(24,Math.min(40,plan.referenceLayout.area&&plan.referenceLayout.area.width||28)),depth=Math.max(18,Math.min(32,plan.referenceLayout.area&&plan.referenceLayout.area.depth||20));
 const part=(name,color,position,scale,collide=true)=>{const o=doc.addPrimitive(roomId,'box',color);doc.setProperty(o,'name',name);doc.setTransform(o,{position,scale});doc.setBehaviors(o,collide?[schema.defaultBehavior('collision')]:[]);objects.push(o);return o;};
 const finish=(preset,color)=>Object.assign(schema.defaultBehavior('surfaceMaterial'),{preset,color,roughness:.82,metalness:0});
 const floor=part('Instalación · suelo de hormigón','#8b9392',[0,-.12,0],[w,.24,depth]);doc.setBehaviors(floor,[schema.defaultBehavior('collision'),schema.defaultBehavior('teleport'),finish('concrete','#8b9392')]);
 for(const x of [-w/2,w/2]){const wall=part('Instalación · pared lateral','#a6aaa4',[x,3,0],[.18,6,depth]);doc.setBehaviors(wall,[schema.defaultBehavior('collision'),finish('concrete','#a6aaa4')]);}
 const back=part('Instalación · pared posterior','#a6aaa4',[0,3,-depth/2],[w,6,.18]);doc.setBehaviors(back,[schema.defaultBehavior('collision'),finish('concrete','#a6aaa4')]);
 part('Instalación · techo industrial','#45535c',[0,6,0],[w,.16,depth]);
 for(const x of [-w*.3,0,w*.3]){part('Viga de techo','#34434b',[x,5.82,0],[.18,.2,depth]);for(const z of [-depth*.25,depth*.25]){const light=part('Luminaria LED','#e9f0e7',[x,5.68,z],[1.8,.05,.18],false);doc.setBehaviors(light,[Object.assign(schema.defaultBehavior('surfaceMaterial'),{preset:'custom',color:'#e9f0e7',emissive:'#c7d6cb',emissiveIntensity:.5,roughness:.4,metalness:0})]);}}
 for(const x of [-w/2+2,w/2-2]){part('Pasillo peatonal · límite de equipo','#478c7c',[x,.012,0],[1.2,.018,depth-2],false);}
  doc.setStudio({environments:(doc.studio&&doc.studio.environments||[]).filter(row=>row.roomId!==roomId).concat([Object.assign(schema.studio.defaultEnvironment(roomId),{sky:'color',skyColor:'#b5c0c5',horizonColor:'#b5c0c5',groundColor:'#84918f',sunIntensity:.8,ambientIntensity:.5})])});
 return objects;
}

function flow(doc,roomId,plan,scene){
 const objects=[],assembly=new ConveyorAssembly({document:doc,roomId,root:doc.getRoot(roomId),ctx:{scene},hooks:{renderScene:scene},assemblyMessage(){}});
 const automatic=plan.mode==='automatic',manual=plan.mode==='manual';
 const source=native(doc,roomId,'source','01 · Entrada identificada · '+plan.sku,undefined,{running:true,withPanel:false,autoGenerate:false,initialCount:plan.units,totalLimit:plan.units,capacity:Math.max(8,plan.units),delivery:automatic?'automatic':'manual',outputInterval:.4,generationMode:'sequence',catalog:JSON.stringify([Object.assign({},plan.product,{id:plan.sku,name:plan.title+' · unidad de práctica',quality:'good',defect:'none'})])},[-7,1,0]);objects.push(source);
 const main=catalogue.definition(plan.mainEquipmentId),machine=catalogue.definition(plan.machineEquipmentId);
 const process=native(doc,roomId,machine.nativeKind,'02 · '+machine.title,'catalogue:'+machine.id,{powered:true,running:true,paused:false,withPanel:true,processTime:plan.cycleSeconds,setupTime:0,setupPolicy:'startup',requiresOperator:manual,operatorAvailable:!manual,capacity:Math.max(8,plan.units),outputCapacity:Math.max(8,plan.units),delivery:automatic?'automatic':'manual',length:plan.processLength,width:plan.product.type==='pallet'?1.6:1.4},[0,1,0]);objects.push(process);
 const conveyorDefinition=main.nativeKind==='conveyor'?main:catalogue.source('nexus-illustrated-2026:'+(plan.product.type==='pallet'?'TR-03':'TR-02'));
 const conveyor=native(doc,roomId,'conveyor','03 · '+conveyorDefinition.title,'catalogue:'+conveyorDefinition.id,{powered:true,running:!manual,paused:false,autoSpawn:false,withPanel:false,speed:plan.transportSpeed,length:plan.transportLength,width:plan.product.type==='pallet'?1.6:1.2,rise:0},[3,1,0]);objects.push(conveyor);
 const receiver=native(doc,roomId,'palletQueue','04 · Destino confirmado · '+plan.id,undefined,{running:true,paused:false,withPanel:false,capacity:plan.product.type==='pallet'?plan.units:Math.max(24,plan.units),palletCapacity:plan.product.type==='pallet'?plan.units:2,acceptsPallets:plan.product.type==='pallet',columns:3,rows:2,layers:2,palletType:'euro-1200x800',layoutMode:'fit',autoRelease:false,delivery:'manual'},[6,1,0]);objects.push(receiver);
 const links=[];try{for(const pair of [[source,process],[process,conveyor],[conveyor,receiver]]){if(!assembly.align(pair[0],'output',pair[1],'input')||!assembly.connect(assembly.pair(pair[1],'input',pair[0],'output')))throw Error('Los puertos de la práctica no coinciden: '+pair[0].name+' → '+pair[1].name);links.push({source:id(pair[0]),target:id(pair[1]),sourcePort:'output',targetPort:'input'});}}finally{assembly.clear();}
 const instrument=main.nativeKind==='sensor'?native(doc,roomId,'sensor','Identificación / medición de proceso','catalogue:'+main.id,{sourceId:id(conveyor)},[process.position.x,1,2]):null;if(instrument)objects.push(instrument);
 if(!['processor','conveyor','sensor'].includes(main.nativeKind)&&!['workspace','attachment'].includes(main.operationLevel)){const object=native(doc,roomId,main.nativeKind,main.title+' · recurso de la operación','catalogue:'+main.id,{withPanel:false},[-2,main.nativeKind==='source'||main.nativeKind==='palletQueue'?1:0,-5]);objects.push(object);}
 return {objects,links,sourceIds:[id(source)],processIds:[id(process)],receiverIds:[id(receiver)],conveyorIds:[id(conveyor)],vehicleIds:[],robotIds:[],expectedUnits:plan.units,source,receiver,process};
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
 patch(doc,source,{initialCount:plan.units,totalLimit:plan.units,autoGenerate:false,interval:1.5,catalog:JSON.stringify([{id:plan.sku,name:'Pieza identificada · '+plan.id,type:'box',width:plan.width,height:plan.height,depth:plan.depth,mass:plan.mass,base:'flat',color:'#bd9254',quality:'good',defect:'none'}])});
 patch(doc,r,{mode:plan.mode==='automatic'?'automatic':'manual',running:plan.mode==='automatic',speed:.7,withPanel:true,payloadKg:8,wear:.22});
 return {objects:built.objects,links:built.links||[],sourceIds:[id(source)],receiverIds:[id(receiver)],processIds:[],conveyorIds:built.objects.filter(object=>component(doc,object)&&component(doc,object).type==='conveyor').map(id),robotIds:[id(r)],vehicleIds:[],expectedUnits:plan.units,source,receiver,robot:r};
}

export function buildPracticeScene(doc,roomId,practiceId,options={}){
 const plan=recipes.plan(practiceId,options),own=!doc.transaction;if(own)doc.begin();
 try{
  studySceneBase(doc,roomId);const shell=environment(doc,roomId,plan);
  let built;
  if(plan.kind==='vehicle')built=require('./PracticeVehicleScene.js').buildVehiclePractice(doc,roomId,plan,{scene:options.scene});
  else built=plan.kind==='robot'?robot(doc,roomId,plan,options.scene):['L06','L20','L21','L31','I24'].includes(plan.id)?transport(doc,roomId,plan,options.scene):flow(doc,roomId,plan,options.scene);
  const all=shell.concat(built.objects),stageIds=built.processIds.concat(built.robotIds||[],built.vehicleIds||[]);
  const manifest={version:1,practiceId:plan.id,caseId:plan.caseId,mode:plan.mode,difficulty:plan.difficulty,roomId,sourceId:built.sourceIds[0],processIds:stageIds,receiverId:built.receiverIds[0],expectedUnits:built.expectedUnits,sku:plan.sku,steps:plan.steps,
   sourceIds:built.sourceIds,receiverIds:built.receiverIds,conveyorIds:built.conveyorIds||[],robotIds:built.robotIds||[],vehicleIds:built.vehicleIds||[],kind:plan.kind,title:plan.title,productIds:built.productIds||[],targetProductId:built.targetProductId||'',incident:plan.incident,incidentKind:plan.incidentKind,sourceSha256:plan.sourceSha256,plan:JSON.parse(JSON.stringify(plan))};
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
