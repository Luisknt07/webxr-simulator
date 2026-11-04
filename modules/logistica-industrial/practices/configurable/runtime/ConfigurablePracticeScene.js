import * as THREE from 'three';
import schema from '../../../contracts/behaviors.js';
import catalogue from '../../../functions/equipamiento/schema/equipmentCatalog.cjs';
import recipes from '../Recipes.cjs';
import {studySceneBase,studyWorkspace,disposeStudyGeometry} from '../../../scenarios/StudySceneProject.js';
import {buildPracticeFacility} from './PracticeFacility.js';
import {buildCediFacility} from './CediFacility.js';
import {arrangeCediPractice,applyCediOperatingData,buildCediContext} from './CediSceneComposition.js';
import {buildPracticeMaterialFixtures} from './PracticeMaterialFixtures.js';
import {buildPracticeEquipmentAttachments} from './PracticeEquipmentAttachments.js';

const MODULE='sector.logistics-industrial';
const TYPES=['source','conveyor','processor','palletQueue','robot','vehicle','sensor','automation','product','plc'];
const FLOOR_STOCK={running:true,paused:false,withPanel:false,acceptsPallets:true,palletType:'euro-1200x800',palletMaterial:'wood',width:1.2,depth:.8,palletCapacity:1,capacity:1,columns:1,rows:1,layers:1,autoRelease:false,delivery:'manual'};
const id=o=>o.userData.editorId;
const config=(doc,o)=>doc.getBehaviors(o).find(c=>TYPES.includes(c.type));
const set=(doc,o,values)=>{const c=config(doc,o);doc.setBehaviors(o,doc.getBehaviors(o).map(row=>row.type===c.type?Object.assign({},row,values):row));};
function add(doc,roomId,objects,kind,name,variant,values,position,rotation){
 const object=doc.addPrefab(roomId,kind,variant);if(values)set(doc,object,values);doc.setProperty(object,'name',name);if(position||rotation)doc.setTransform(object,{position:position||[0,0,0],rotation:rotation||[0,0,0]});
 object.traverse(child=>{const rows=child.userData.editorDefaultBehaviors;if(Array.isArray(rows)&&rows.some(row=>Object.values(row).includes('@root')))child.userData.editorDefaultBehaviors=JSON.parse(JSON.stringify(rows,(key,value)=>value==='@root'?id(object):value));});objects.push(object);return object;
}
function queue(doc,roomId,objects,name,position){return add(doc,roomId,objects,'palletQueue',name,undefined,FLOOR_STOCK,[position[0],position[1]+1,position[2]]);}
function shell(doc,roomId,plan,objects){
 if(/^CEDI-0[1-5]$/.test(plan.id))return buildCediFacility(doc,roomId,plan,objects);
 return buildPracticeFacility(doc,roomId,plan,objects);

}
function actor(doc,roomId,plan,row,objects){
 const d=row.catalogueEquipmentId&&catalogue.definition(row.catalogueEquipmentId),position=row.sourceCenter.slice();let object;
 if(row.role==='bay'||row.role==='area'||!d){object=queue(doc,roomId,objects,row.alias+' · '+row.sourceName,[position[0],0,position[2]]);}
 else{
  const kind=d.nativeKind||'plc',variant=d.nativeKind?'catalogue:'+d.id:undefined;
  const values=Object.assign({running:false,powered:true,paused:false,withPanel:false,detail:'low',wear:.18,autoGenerate:false,initialCount:0,totalLimit:0,autoSpawn:false,delivery:'manual'},row.config||{});
  if(kind==='vehicle')Object.assign(values,schema.vehicles.defaults(d.nativeVariant),{running:true,parkingBrake:true,mode:'manual',detail:'low',cabInterior:row.alias===plan.operatorVehicleAlias});
  if(kind==='robot')Object.assign(values,{mode:plan.mode==='automatic'&&d.role==='mobile'?'automatic':'manual',running:false,withPanel:d.role==='robot',reach:1.5,payloadKg:12});
  if(kind==='palletQueue')Object.assign(values,{running:true,rackBays:2,rackLevels:3,rackColumns:1,rackBayWidths:'2.5,2.5',rackSlotDepth:1.1,rackAisleCode:row.alias,rackRowCode:'R01',autoRelease:false});
  if(kind==='conveyor')Object.assign(values,{length:Math.max(1.2,row.sourceDimensions[0]),width:/pallet/.test(d.id)?1.4:1,running:false});
  position[1]=['source','processor','conveyor','palletQueue'].includes(kind)?1:kind==='plc'?1.28:0;
  object=add(doc,roomId,objects,kind,row.alias+' · '+row.sourceName,variant,values,position);
 }
 object.userData.configurablePracticeAlias=row.alias;object.userData.configurablePracticeId=plan.id;row.objectId=id(object);row.actualPose={position:object.position.toArray(),rotation:object.rotation.toArray().slice(0,3),scale:object.scale.toArray()};row.actualCatalogueEquipmentId=d&&d.id||'';row.components=doc.getBehaviors(object).map(c=>c.type);return object;
}
function addFloorPlan(doc,roomId,plan,rows,objects){
 if(/^CEDI-0[1-5]$/.test(plan.id)){
  const stock=plan.operatingData&&plan.operatingData.inventoryLocations||[],texts=['RESERVA A · ALTA ROTACIÓN','RESERVA B · ROTACIÓN MEDIA','RESERVA C · BAJA / ESPECIALES'].concat(stock.map(row=>row.sku+' · '+row.locationCode));
  const labels=[[-20,-12,0,6,.45,8],[-8,-12,0,6,.45,9],[12,-12,0,7.8,.45,10]].concat(stock.map((row,i)=>{const code=/R(\d+)-B01-M(\d+)-N(\d+)/.exec(row.locationCode),rack=code&&Number(code[1])===4?18:6,bay=code?Number(code[2]):1,level=code?Number(code[3]):1;return[rack-3+(bay-1)*2,-13.8+(level-1)*.3,0,1.9,.13,11+i];}));
  const floor=doc.addIndustrialFloorPresentation(roomId,{type:'industrialFloor',version:1,bounds:[-32,-22,32,22],floorY:.031,texts,labels});doc.setProperty(floor,'name','CEDI · clasificación ABC y ubicaciones de reserva');doc.setBehaviors(floor,[Object.assign(schema.defaultBehavior('collision'),{enabled:false})]);objects.push(floor);return{points:[],referenceOnly:true,provenance:'shared-cedi-layout'};
 }
 const sourceRoute=plan.sourceRow.routes[{manual:'M',semiautomatic:'S',automatic:'A'}[plan.mode]],points=(sourceRoute&&sourceRoute.points||[]).map(p=>[p[0]-plan.interiorArea.width/2,p[1]-plan.interiorArea.depth/2]),arrows=[];
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);for(let t=.8;t<length;t+=1.5)arrows.push([a[0]+dx*t/length,a[1]+dz*t/length,Math.atan2(dx,dz)]);}
 const floor=doc.addIndustrialFloorPresentation(roomId,{type:'industrialFloor',version:1,bounds:[-plan.interiorArea.width/2,-plan.interiorArea.depth/2,plan.interiorArea.width/2,plan.interiorArea.depth/2],floorY:.029,texts:rows.map(row=>(row.alias+' · '+row.sourceName).slice(0,64)),labels:rows.map((row,index)=>[(row.actualPose&&row.actualPose.position||row.sourceCenter)[0],(row.actualPose&&row.actualPose.position||row.sourceCenter)[2]+row.sourceDimensions[1]/2-.25,0,Math.min(4,Math.max(.3,row.sourceDimensions[0])),.28,8+index]),arrows:plan.availability.ready?[]:arrows.slice(0,96)});doc.setProperty(floor,'name','Referencias de fuente · la ruta operativa usa contactos y misiones nativos');doc.setBehaviors(floor,[Object.assign(schema.defaultBehavior('collision'),{enabled:false})]);objects.push(floor);return{points,provenance:'source-numeric-reference-polyline',referenceOnly:true,notice:'Flechas de referencia; no certifican el espacio libre ni sustituyen la ruta de la misión nativa.'};
}
function receiving(doc,roomId,plan,rows,objects,adjustments){
 const byAlias=alias=>doc.getObject(rows.find(row=>row.alias===alias).objectId),truck=byAlias('E01'),vehicle=byAlias('E03'),inspection=byAlias('E04');
 // Source dimensions are a proposal, not a scaled truck. A 12 m side-access
 // platform fits six accessible real Euro pallets in one row. The driven truck
 // stays parked; a floor vehicle is never teleported up its bed.
 set(doc,truck,{length:12,width:2.45,height:3.1,mode:'manual',running:false,withPanel:false,detail:'low'});doc.setTransform(truck,{position:[-19,0,0]});
 adjustments.push({alias:'E01',reason:'Plataforma de acceso lateral de 12 m y patio ampliado: seis pallets accesibles sin conducir sobre la caja del camión; la dimensión 8 m de la lámina es una hipótesis.',sourceCenter:rows.find(row=>row.alias==='E01').sourceCenter,actualPosition:truck.position.toArray()});
 const bedTop=3.1*.37,seatZ=2.45*.47-.8/2-.05,sourceIds=[],palletIds=[],stock=[],inspectionCenter=[-5.5,0,-4.5],inspectionBay=queue(doc,roomId,objects,'E04 · apoyo de inspección · no depositar sobre la mesa',inspectionCenter);
 doc.setTransform(inspection,{position:[-7.8,1,-6.8]});adjustments.push({alias:'E04',reason:'La mesa se separa del apoyo de suelo; el pallet permanece a piso o detenido a baja altura, nunca encima de la mesa.',actualPosition:inspection.position.toArray(),inspectionCenter});
 const terminal=byAlias('E08');doc.setTransform(terminal,{position:[10,1.28,-7.5]});adjustments.push({alias:'E08',reason:'Terminal fuera del corredor de retorno: la posición de referencia intersectaba la reversa después del segundo depósito. Se conserva la terminal real y se localiza junto al borde posterior, sin alterar la custodia.',actualPosition:terminal.position.toArray()});
 const restraint=add(doc,roomId,objects,'processor','E02 · calzos y retenedor del muelle','catalogue:equipment.dock.restraint',{running:false,withPanel:false,length:1.5,width:1,height:1.2},[-23.5,1,-1.5]);
 const reader=add(doc,roomId,objects,'sensor','E04 · lector de identidad real','catalogue:equipment.sensor.barcode-rf',{withPanel:false,sourceId:id(inspectionBay)},[-6.3,1,-6.5]);
 const scale=add(doc,roomId,objects,'processor','E04 · báscula de plataforma · pesaje opcional','catalogue:equipment.sensor.platform-scale',{running:false,withPanel:false,length:1.5,width:1,height:1},[-3,1,-6.4]);
 rows.find(row=>row.alias==='E02').componentObjectIds=[id(restraint)];rows.find(row=>row.alias==='E04').componentObjectIds=[id(reader),id(scale),id(inspectionBay)];
 for(let i=0;i<6;i++){
  const position=[-19+12*.17+(i-2.5)*1.26,bedTop,seatZ],seat=queue(doc,roomId,objects,'E01 · asiento cargado P'+String(i+1).padStart(2,'0'),position),sku='CEDI-01-P'+String(i+1).padStart(2,'0');sourceIds.push(id(seat));
  const product=add(doc,roomId,objects,'product',sku+' · 8 cajas × 5 kg + tara 20 kg','pallet-loaded',{sourceId:id(seat),sku,productType:'pallet',loadMode:'pallet',units:8,mass:60,palletTareKg:20,width:1.2,depth:.8,height:.72,palletType:'euro-1200x800',palletMaterial:'wood',contents:'boxes',quality:'good',defect:'none',color:'#b8935e'},[position[0],bedTop+.005,position[2]]);
  product.userData.configurableLoadIdentity={palletId:sku,lotId:'LOTE-CEDI-01-001',orderId:'ORD-CEDI-01-048',boxIds:Array.from({length:8},(_,n)=>sku+'-B'+String(n+1).padStart(2,'0'))};palletIds.push(id(product));stock.push({product,seat,position});
 }
 const releasedRoot=byAlias('E07'),quarantineRoot=byAlias('E05'),releasedPositions=[[6.8,0,-5],[8.3,0,-5],[12.9,0,-6],[14.4,0,-6],[12.9,0,-3.5],[14.4,0,-3.5]],receiverIds=[],quarantineIds=[id(quarantineRoot)];
 set(doc,releasedRoot,Object.assign({},FLOOR_STOCK,{rackSystem:'floor'}));set(doc,quarantineRoot,Object.assign({},FLOOR_STOCK,{rackSystem:'floor'}));
 doc.setTransform(releasedRoot,{position:[releasedPositions[0][0],1,releasedPositions[0][2]]});receiverIds.push(id(releasedRoot));
 for(let i=1;i<6;i++){const seat=queue(doc,roomId,objects,'E07 · '+(i<2?'salida libre ':'continuación física reservada CEDI-02 ')+(i+1),releasedPositions[i]);receiverIds.push(id(seat));}
 const q=queue(doc,roomId,objects,'E05 · segunda posición segregada',[quarantineRoot.position.x+1.5,0,quarantineRoot.position.z]);quarantineIds.push(id(q));
 adjustments.push({alias:'E07',reason:'Se conservan dos posiciones de salida y se añaden cuatro apoyos físicos en la continuación reservada CEDI-02 para conservar seis identidades sin eliminar, regenerar ni apilar stock.',continuationPositions:releasedPositions.slice(2),reservedContinuation:true});
 const tasks=[];
 stock.forEach((row,i)=>{
  const pickupApproach={x:row.position[0],z:seatZ+4.5},inspectApproach={x:inspectionCenter[0],z:inspectionCenter[2]+3};
  const target=releasedPositions[i],destinationApproach={x:target[0],z:target[2]+3};
  tasks.push({id:'cedi-receive-'+i,name:'P'+(i+1)+' · descargar, detenerse en E04, inspeccionar/registrar y entregar',productId:id(row.product),sourceId:id(row.seat),destinationId:receiverIds[i],destinationSlot:0,pickupRoute:[pickupApproach],route:[pickupApproach,{x:row.position[0]+2.7,z:6.3},{x:-2.8,z:6.3},{x:inspectionCenter[0],z:5.2},inspectApproach,{x:inspectionCenter[0],z:2},{x:-2.8,z:3.1},{x:target[0]+2.7,z:3.1},{x:target[0],z:2},destinationApproach]});
 });
 const selectedVehicle=catalogue.definition(rows.find(row=>row.alias==='E03').catalogueEquipmentId);
 set(doc,vehicle,Object.assign({},schema.vehicles.defaults(selectedVehicle.nativeVariant),{catalogueEquipmentId:selectedVehicle.id,mode:'manual',powered:true,running:true,parkingBrake:true,forkLength:1.2,loadCenter:.6,forkSpread:.48,sourceId:sourceIds[0],outputId:id(inspectionBay),speed:.7,reverseSpeed:.5,trainingTasksJson:JSON.stringify(tasks),waypointsJson:'[]',routeLoop:false,detail:'balanced',cabInterior:true}));
 doc.setTransform(vehicle,{position:[stock[0].position[0],0,seatZ+4.5],rotation:[0,Math.PI,0]});
 adjustments.push({alias:'E03',reason:'Inicio en aproximación lateral recta al primer pallet, fuera del camión. La pose de dibujo se sustituye por una aproximación comprobable sin giro sobre el muelle.',actualPosition:vehicle.position.toArray()});
 return {sourceIds,receiverIds,productIds:palletIds,palletIds,vehicleIds:[id(vehicle)],robotIds:[],conveyorIds:[],processIds:[id(vehicle)],tasks,receiving:{orderId:'ORD-CEDI-01-048',lotId:'LOTE-CEDI-01-001',inspectionIds:[id(inspectionBay)],inspectionCenter,quarantineIds,truckId:id(truck),restraintId:id(restraint),readerId:id(reader),scaleId:id(scale),unitsPerPallet:8,palletMassKg:60,continuationIds:receiverIds.slice(2),identities:stock.map(row=>({objectId:id(row.product),palletId:row.product.userData.configurableLoadIdentity.palletId,boxIds:row.product.userData.configurableLoadIdentity.boxIds,initialOwnerId:id(row.seat)}))},links:stock.map((row,index)=>({source:id(row.seat),target:id(vehicle),custody:'native-vehicle-pickup',destination:receiverIds[index]}))};
}
function layoutOverrides(doc,plan,rows,built,adjustments){
 for(const override of plan.layout.overrides){
  const row=rows.find(row=>row.alias===override.alias),object=doc.getObject(row.objectId),ids=new Set([row.objectId].concat(row.componentObjectIds||[]));
  if(built.receiving){if(row.alias==='E01')built.sourceIds.concat(built.palletIds).forEach(value=>ids.add(value));if(row.alias==='E05')built.receiving.quarantineIds.forEach(value=>ids.add(value));if(row.alias==='E07')built.receiverIds.forEach(value=>ids.add(value));}
  const origin=object.position.clone(),yaw=THREE.Math.degToRad(override.yaw||0)-object.rotation.y,rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),target=new THREE.Vector3(override.x,origin.y,override.z);
  for(const objectId of ids){const actor=doc.getObject(objectId);if(!actor)continue;const position=actor.position.clone().sub(origin).applyQuaternion(rotation).add(target),quaternion=actor.quaternion.clone().premultiply(rotation);doc.setTransform(actor,{position:position.toArray(),quaternion:quaternion.toArray()});}
  if(row.alias==='E04'&&built.receiving){const p=new THREE.Vector3().fromArray(built.receiving.inspectionCenter).sub(origin).applyQuaternion(rotation).add(target);built.receiving.inspectionCenter=p.toArray();}
  adjustments.push({alias:row.alias,reason:'Posición alternativa de configuración; los grupos de carga y apoyo conservan sus transformaciones relativas. La ruta y las interferencias de esta alternativa requieren una nueva validación antes de evaluarla.',actualPosition:target.toArray(),executionValidated:false});
 }
}
function measure(objects){let triangles=0,drawCalls=0,meshes=0;const materials=new Set(),textures=new Set();for(const object of objects)object.traverse(node=>{if(!node.isMesh||!node.geometry||node.userData.editorGeometryReplaced)return;for(let p=node;p;p=p.parent)if(!p.visible||p.userData.editorGeometryReplaced)return;meshes++;const g=node.geometry;triangles+=(g.index?g.index.count:g.attributes.position.count)/3;const list=Array.isArray(node.material)?node.material:[node.material];drawCalls+=Array.isArray(node.material)?Math.max(1,(g.groups&&g.groups.length)||0):1;for(const m of list)if(m){materials.add(m);for(const key of ['map','normalMap','roughnessMap','metalnessMap','aoMap'])if(m[key])textures.add(m[key]);}});return{triangles,drawCalls,meshes,materials:materials.size,textures:textures.size,lights:objects.reduce((n,o)=>{o.traverse(node=>{if(node.isLight)n++;});return n;},0),activeCopies:1,measurement:'visible native meshes before frustum culling; renderer groups only for material arrays; not physical headset FPS'};}
export function buildConfigurablePracticeScene(doc,roomId,practiceId,options={}){
 const plan=recipes.plan(practiceId,options),own=!doc.transaction,objects=[],adjustments=[],rows=plan.layoutBindings.map(row=>Object.assign({},row));if(own)doc.begin();
 try{
  if(/^CEDI-0[1-5]$/.test(plan.id)&&doc.native)doc.native.forEach(entry=>{if(entry.roomId===roomId&&entry.object.parent===doc.getRoot(roomId))doc.setProperty(entry.object,'visible',false);});
  studySceneBase(doc,roomId);const facility=shell(doc,roomId,plan,objects);rows.forEach(row=>actor(doc,roomId,plan,row,objects));
  let built={sourceIds:[],receiverIds:[],productIds:[],palletIds:[],vehicleIds:[],robotIds:[],conveyorIds:[],processIds:[],links:[]};
  if(plan.id==='CEDI-01')built=receiving(doc,roomId,plan,rows,objects,adjustments);
  else built=buildPracticeMaterialFixtures(doc,roomId,plan,rows,objects,{add,set,queue,id,schema});
  const cediOperations=arrangeCediPractice(doc,plan,rows,built,objects,{set,facility});
  const operatingData=applyCediOperatingData(doc,plan,built,{set});
  const cediContext=buildCediContext(doc,roomId,plan,objects,{set});
  if(built.materialRecipe){built.materialRecipe.operationReady=!!plan.availability.ready;built.materialRecipe.validatedEvidence=plan.availability.evidence||null;}
  adjustments.push(...(facility&&facility.adaptations||[]),...(built.fixtureLayoutAdjustments||[]));
  layoutOverrides(doc,plan,rows,built,adjustments);
  for(const row of rows){const object=doc.getObject(row.objectId);object.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3());row.actualPose={position:object.position.toArray(),rotation:object.rotation.toArray().slice(0,3),scale:object.scale.toArray()};row.actualFootprint=[size.x,size.z,size.y];}
  const equipmentAttachments=buildPracticeEquipmentAttachments(doc,roomId,plan,rows,objects);
  const route=addFloorPlan(doc,roomId,plan,rows,objects),stageBindings=recipes.workflowRequirements(plan);
  const settings=recipes.normalizedOptions(plan);
  const manifest=Object.assign({version:2,practiceId:plan.id,title:plan.title,caseId:plan.caseId,mode:plan.mode,difficulty:plan.difficulty,roomId,kind:'configurable',expectedUnits:plan.expectedUnits,sku:plan.id+'-ORDER',steps:plan.steps,sourceSha256:plan.sourceSha256,sourceHashes:plan.sourceHashes,plan,settings,aliases:rows,layoutElements:rows,layoutAdjustments:adjustments,stageBindings,evidenceAdapter:{kind:'workflow'},availability:plan.availability,executionRoute:route,facility:facility&&Object.fromEntries(['version','profile','bounds','openings','adaptations','costs','environment','limits','objects','outdoor'].map(key=>[key,facility[key]])),validation:{coordinateMapping:'table centre -> centred world; no dimension scaling',mappedAliases:rows.length,sourceAliases:plan.modeDescription.equipment.length,modePolicy:'exactly one selected mode; no hidden actors for other modes',rv:measure(objects),executionReady:plan.availability.ready,limits:plan.availability.reasons}},built);
  manifest.equipmentAttachments=equipmentAttachments;
  if(cediOperations){manifest.cediOperations=cediOperations;manifest.cediContext=cediContext;manifest.operatingData=operatingData;manifest.facility.layoutId=facility.layoutId;manifest.facility.sharedLayout=facility.sharedLayout;manifest.facility.initialView=facility.initialView;manifest.executionRoute={points:facility.sharedLayout.aisles.safePolyline,referenceOnly:true,provenance:'shared-cedi-aisles; native task supplies final approach'};}
  manifest.sourceId=built.sourceIds[0]||rows[0].objectId;manifest.receiverId=built.receiverIds[0]||rows[rows.length-1].objectId;
  manifest.materialFixture={status:built.productIds.length?'native-seeded':'source-recipe-only',quantities:JSON.parse(JSON.stringify(plan.fixture)),physicalProductIds:built.productIds.slice(),notice:built.productIds.length?'Existencias físicas iniciales identificadas y conservadas por referencia. La evaluación exige además el adaptador y las pruebas del flujo; el registro no genera stock.':'Montaje de configuración: la receta de insumos está documentada; no se crean existencias ni se habilita evaluación antes de enlazar su adaptador material específico.'};
  const studio=doc.studio||{},moduleData=Object.assign({},studio.moduleData||{}),data=Object.assign({version:1,levels:[],attempts:[]},moduleData[MODULE]||{});data.levels=(data.levels||[]).filter(row=>row.roomId!==roomId).concat([manifest]);moduleData[MODULE]=data;doc.setStudio({moduleData,scenes:(studio.scenes||[]).filter(row=>row.id!==roomId).concat([{id:roomId,name:plan.id+' · '+plan.title,moduleId:MODULE}]),startRoomId:roomId});
  if(own)doc.commit();return{plan,manifest,objects,report:{id:plan.id,caseId:plan.caseId,mode:plan.mode,actors:objects.length,expectedUnits:plan.expectedUnits,rv:manifest.validation.rv},...built};
 }catch(error){if(own)doc.cancel();throw error;}
}
export async function compilePracticeProject(practiceId,options={}){
 const workspace=studyWorkspace();try{const built=buildConfigurablePracticeScene(workspace.document,'hall',practiceId,Object.assign({},options,{scene:workspace.scene}));return{name:practiceId+' · '+built.plan.title,document:await workspace.document.serialize(),reports:[built.report]};}finally{disposeStudyGeometry(workspace.scene);}
}
