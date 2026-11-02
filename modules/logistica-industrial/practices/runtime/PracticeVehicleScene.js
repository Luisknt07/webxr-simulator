import {buildStudyScene} from '../../scenarios/IndustrialStudyScenes.js';
import catalogue from '../../functions/equipamiento/schema/equipmentCatalog.cjs';

const id=object=>object.userData.editorId;
function set(doc,object,type,changes){doc.setBehaviors(object,doc.getBehaviors(object).map(config=>config.type===type?Object.assign({},config,changes):config));}

/** One real pallet mission per exercise. Other seeded stock remains inventory;
 * no forklift action, load or scoring event is fabricated by the lesson. */
export function buildVehiclePractice(doc,roomId,plan,{scene}={}){
 const built=buildStudyScene(doc,roomId,'vr-warehouse-missions',{scene,preview:true}),putaway=['L12','I04','I31'].includes(plan.id),task=Object.assign({},built.tasks[putaway?1:0]);
 task.id=plan.id+'-pallet-task';task.name=plan.title;
 if(!putaway&&['L04','L27','L28','I01','I32'].includes(plan.id)){
  task.productId=id(built.products[1]);task.sourceId=id(built.incoming);delete task.sourceLocationCode;task.destinationId=id(built.outgoing);task.destinationSlot=0;delete task.locationCode;
 }
 for(const seeded of built.products)set(doc,seeded,'product',{units:plan.units,mass:25+plan.units*plan.mass});
 const product=doc.getObject(task.productId);set(doc,product,'product',{sku:plan.sku});doc.setProperty(product,'name',plan.sku+' · pallet identificado de '+plan.units+' cajas');
 const vehicle=built.vehicle,source=doc.getObject(task.sourceId),destination=doc.getObject(task.destinationId),floorTransfer=source===built.incoming&&destination===built.outgoing;
 const relocate=(store,position)=>{const delta=store.position.clone().multiplyScalar(-1).add(store.position.clone().fromArray(position));doc.setTransform(store,{position});for(const seeded of built.products){const spec=doc.getBehaviors(seeded).find(value=>value.type==='product');if(spec&&spec.sourceId===id(store))doc.setTransform(seeded,{position:seeded.position.clone().add(delta).toArray()});}};
 // These are independent practice copies. A straight, clear operating aisle
 // avoids inventing a turn radius or making a truck rotate on the spot. The
 // actual fork/pocket, rack access and support planners still own every handoff.
 if(floorTransfer){relocate(built.incoming,[0,1,4]);relocate(built.outgoing,[0,1,-2]);}
 else{
  const rack=putaway?destination:source,code=putaway?task.locationCode:task.sourceLocationCode;
  const cells=built.rack===rack&&built.layout?built.layout.cells:null;
  const cell=cells&&cells.find(value=>value.code===code);
  if(!cell)throw Error('Falta la ubicación física de la práctica: '+code);
  relocate(rack,[-cell.position[0],rack.position.y,rack.position.z]);
  if(putaway)relocate(built.incoming,[0,1,4]);else relocate(built.outgoing,[0,1,4]);
 }
 // Shipping exercises deposit onto the real parked truck deck, near the open
 // side so a finite-length fork can reach it without driving into the chassis.
 // The queue declares the seat; the separate truck mesh supplies its support
 // and remains part of all normal body/fork/payload collision tests.
 if(['L28','I32'].includes(plan.id)){
  const definition=catalogue.definition('equipment.vehicle.freight-truck'),cfg=definition.defaults,truck=doc.addPrefab(roomId,definition.nativeKind,'catalogue:'+definition.id);
  set(doc,truck,'robot',{mode:'manual',running:false,withPanel:false});doc.setProperty(truck,'name','Camión de expedición · estacionado y calzado');
  const bedTop=cfg.height*.37,truckZ=-2,seatZ=truckZ+cfg.width*.47-.8/2-.05;
  doc.setTransform(truck,{position:[-cfg.length*.17,0,truckZ]});built.objects.push(truck);relocate(built.outgoing,[0,bedTop+1,seatZ]);doc.setProperty(built.outgoing,'name','CAMIÓN · posición de pallet sobre la plataforma');
  set(doc,vehicle,'vehicle',{forkLength:1.2,loadCenter:.6});
 }
 const sourceZ=source===built.incoming?source.position.z+3:-2,destinationZ=destination===built.outgoing?destination.position.z+3:-2;
 doc.setTransform(vehicle,{position:[0,0,sourceZ],rotation:[0,Math.PI,0]});doc.getRoot(roomId).updateWorldMatrix(true,true);
 const home=vehicle.matrixWorld.clone(),inverse=home.clone().getInverse(home),forward=vehicle.position.clone().set(0,0,1).transformDirection(home),homeYaw=Math.atan2(forward.x,forward.z),localPoint=(x,z,values)=>{const point=vehicle.position.clone().set(x,0,z).applyMatrix4(inverse);return Object.assign({x:point.x,z:point.z,yaw:Math.PI-homeYaw},values);};
 const points=[localPoint(0,sourceZ,{action:'pickup',targetId:task.sourceId}),localPoint(0,destinationZ,{action:'drop',targetId:task.destinationId,reverse:destinationZ>sourceZ,lift:.25})];
 task.pickupRoute=[{x:0,z:sourceZ}];task.route=[{x:0,z:sourceZ},{x:0,z:destinationZ}];
 set(doc,vehicle,'vehicle',{mode:plan.mode==='automatic'?'automatic':'manual',sourceId:task.sourceId,outputId:task.destinationId,powered:true,running:true,parkingBrake:plan.mode!=='automatic',speed:.7,reverseSpeed:.5,routeLoop:false,trainingTasksJson:JSON.stringify([task]),waypointsJson:plan.mode==='automatic'?JSON.stringify(points):'[]'});
 doc.setProperty(vehicle,'name',plan.mode==='automatic'?'Vehículo guiado · '+plan.title:'Montacargas · '+plan.title);
 return{objects:built.objects,links:[{source:task.sourceId,target:id(vehicle)},{source:id(vehicle),target:task.destinationId}],sourceIds:[task.sourceId],receiverIds:[task.destinationId],processIds:[],conveyorIds:[],robotIds:[],vehicleIds:[id(vehicle)],productIds:built.products.map(id),targetProductId:task.productId,task,studentRoute:points,expectedUnits:plan.units,source,destination,vehicle};
}
