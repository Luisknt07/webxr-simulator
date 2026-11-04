import * as THREE from 'three';
import schema from '../../../contracts/behaviors.js';
import {createIndustrialPrefab} from '../../../functions/presentacion/runtime/IndustrialPrefabs.js';
import cediLayout from '../CediLayout.cjs';
import operatingData from '../CediOperatingData.cjs';

// Stable positions belong to the installation, not to a slide of an exercise.
// Only the selected stage retains native simulation/control behaviours. Other
// areas use baked versions of the very same native equipment, without timers,
// stock producers, controls or an additional renderer.
const POSES={
 'CEDI-01':{E01:[-22,-1.147,27.9,Math.PI/2],E02:[-22,1,20.5,Math.PI/2],E03:[-22,0,17,0],E04:[-27,1,4,0],E05:[-6,1,3,0],E07:[-18,1,10,0],E08:[-27,1.28,9,0]},
 'CEDI-02':{E01:[-20,1,10,0],E02:[-20,1,-15,0],E03:[-8,1,-15,0],E04:[6,1,0,0],E05:[-20,0,14.5,Math.PI],E06:[-15,1.28,5,0],E07:[-6,1,3,0],E08:[-9,0,10,0]},
 'CEDI-03':{E01:[2,1.28,6,0],E02:[6,1,0,0],E03:[15,1,0,0],E04:[4,0,4,0],E05:[21,1,0,0],E06:[21,1,4,0],E07:[15,1,5,0]},
 'CEDI-04':{E01:[5,1,8,0],E02:[12,1,8,0],E03:[18,1,8,0],E04:[22,1,12,0],E05:[18,1,12,0],E06:[13,1,12,0],E07:[22,0,15.5,Math.PI],E08:[7,1.28,12,0]},
 'CEDI-05':{E01:[18,1,16,0],E02:[28,1,10,0],E03:[24,1,16,0],E04:[18,0,12.5,0],E05:[14,1,20.5,Math.PI/2],E06:[14,-1.147,27.9,Math.PI/2],E07:[28,1.28,16,0],E08:[29,1,19,0]}
};
const type=doc=>object=>doc.getBehaviors(object).find(row=>['source','processor','palletQueue','conveyor','robot','vehicle','product','plc'].includes(row.type));
const oid=object=>object.userData.editorId;
const clone=value=>JSON.parse(JSON.stringify(value));

export function arrangeCediPractice(doc,plan,rows,built,objects,api){
 if(!/^CEDI-0[1-5]$/.test(plan.id))return null;
 const byAlias=alias=>doc.getObject(rows.find(row=>row.alias===alias).objectId),moved=new Set(),transforms=new Map(),poses=POSES[plan.id];
 for(const row of rows){
  const root=doc.getObject(row.objectId),pose=poses[row.alias];if(!pose)continue;
  const from=root.position.clone(),forward=new THREE.Vector3(0,0,1).applyQuaternion(root.quaternion),yaw=pose[3]-Math.atan2(forward.x,forward.z),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),to=new THREE.Vector3(...pose.slice(0,3));
  const ids=new Set([row.objectId].concat(row.componentObjectIds||[]));
  if(built.receiving){if(row.alias==='E01')built.sourceIds.concat(built.palletIds).forEach(id=>ids.add(id));if(row.alias==='E05')built.receiving.quarantineIds.forEach(id=>ids.add(id));if(row.alias==='E07')built.receiverIds.forEach(id=>ids.add(id));}
  const transform=p=>p.clone().sub(from).applyQuaternion(q).add(to);transforms.set(row.alias,transform);
  for(const id of ids){if(moved.has(id))continue;const object=doc.getObject(id);if(!object)continue;doc.setTransform(object,{position:transform(object.position).toArray(),quaternion:object.quaternion.clone().premultiply(q).toArray()});moved.add(id);}
  // Native planar vehicles initialize their heading from Euler Y. Keep a
  // canonical yaw, rather than the equivalent XYZ(PI,0,PI) representation.
  doc.setTransform(root,{rotation:[0,pose[3],0]});
  row.cediZone={E01:'receiving',E04:'inspection',E05:'quarantine',E07:'receiving'}[row.alias]||'operations';
 }
 const dockAlias=plan.id==='CEDI-01'?'E02':plan.id==='CEDI-05'?'E05':null;
 if(dockAlias){const row=rows.find(row=>row.alias===dockAlias),object=doc.getObject(row.objectId);doc.setProperty(object,'visible',false);row.physicalGeometryObjectIds=(api.facility.objects||[]).filter(value=>value.partition==='dock-bridges').map(value=>value.objectId);row.visualBinding='Shared facility dock deck; no overlapping second leveler platform.';}
 // Receiving had individually positioned fixtures rather than alias children.
 if(built.receiving){
  const r=built.receiving;for(const key of ['inspectionIds','quarantineIds'])for(const id of r[key]||[]){const object=doc.getObject(id);if(!object||moved.has(id))continue;const fn=transforms.get(key==='inspectionIds'?'E04':'E05');doc.setTransform(object,{position:fn(object.position).toArray()});moved.add(id);}
  r.inspectionCenter=[-24,0,4];for(const id of r.inspectionIds){const object=doc.getObject(id);doc.setTransform(object,{position:[-24,1,4],rotation:[0,0,0]});}
  for(const [index,id]of built.sourceIds.entries()){
   const seat=doc.getObject(id),product=doc.getObject(built.palletIds[index]),z=23+index*.98;
   doc.setTransform(seat,{position:[-22,1,z],rotation:[0,0,0]});doc.setTransform(product,{position:[-22,.005,z],rotation:[0,0,0]});
  }
  // Fill the far row before the near row from the north aisle. Matching the
  // receiver heading to its authored approach avoids driving through either
  // the inspection scale or pallets already released in the front row.
  for(const [index,id]of built.receiverIds.entries())doc.setTransform(doc.getObject(id),{position:[-20+(index%3)*1.5,1,9+Math.floor(index/3)*1.7],rotation:[0,Math.PI,0]});
  for(const [id,position]of [[r.restraintId,[-23.6,-.147,27]],[r.readerId,[-25.5,1,4]],[r.scaleId,[-21.5,1,4]]])if(id&&doc.getObject(id))doc.setTransform(doc.getObject(id),{position,rotation:[0,id===r.restraintId?Math.PI/2:0,0]});
 }
 if(plan.id==='CEDI-05'){
  for(const [index,id]of built.receiverIds.entries())doc.setTransform(doc.getObject(id),{position:[14,1,23+(1-index)*.98],rotation:[0,0,0]});
 }
 // Routes reference actual dock/rack placements and wide installation aisles.
 const approach=(object,distance=3.5)=>{const direction=new THREE.Vector3(0,0,distance).applyQuaternion(object.quaternion);return{x:object.position.x+direction.x,z:object.position.z+direction.z};};
 for(const task of built.tasks||[]){
  const source=doc.getObject(task.sourceId),target=doc.getObject(task.destinationId),product=doc.getObject(task.productId);if(!source||!target)continue;
  const pickup=approach(source),destination=approach(target);
  if(plan.id==='CEDI-01'){pickup.x=-22;pickup.z=19;destination.x=target.position.x;destination.z=target.position.z+3;task.route=[pickup,{x:-22,z:14},{x:-24,z:10},{x:-24,z:6.5},{x:-24,z:10},{x:destination.x,z:14},destination];}
  else if(plan.id==='CEDI-02'){task.route=[pickup,{x:pickup.x,z:7},{x:-12,z:7},{x:-12,z:-7},{x:destination.x,z:-7},destination];}
  else {pickup.z=source.position.z-3.5;destination.z=target.position.z-3.5;task.route=[pickup,{x:27,z:12},{x:27,z:18},{x:destination.x,z:18},destination];}
  task.pickupRoute=[pickup];
  // Replenishment starts at the actual selected rack cell, not its centre.
  if(plan.id==='CEDI-02'&&task.id==='cedi-02-replenish')task.route=[{x:-20,z:-10},{x:-12,z:-7},{x:6,z:-7},destination];
 }
 if(built.vehicleIds.length){const vehicle=doc.getObject(built.vehicleIds[0]);api.set(doc,vehicle,{trainingTasksJson:JSON.stringify(built.tasks||[]),waypointsJson:'[]',routeLoop:false});
  if(built.tasks&&built.tasks.length){const p=built.tasks[0].pickupRoute[0];doc.setTransform(vehicle,{position:[p.x,0,p.z],rotation:[0,plan.id==='CEDI-01'||plan.id==='CEDI-05'?0:Math.PI,0]});}
 }
 for(const id of built.vehicleIds){const vehicle=doc.getObject(id);api.set(doc,vehicle,{detail:'low'});}
 for(const object of objects)if(object.userData.editorPrefabKey)object.userData.cediOperation={practiceId:plan.id,active:true,layoutId:cediLayout.ID};
 return{layoutId:cediLayout.ID,activePractice:plan.id,activeObjectIds:objects.filter(object=>object.userData.editorPrefabKey).map(oid),policy:'Only the selected practice has native material custody, machine timers and control bindings; context is static.'};
}

export function applyCediOperatingData(doc,plan,built,api){
 if(!/^CEDI-0[1-5]$/.test(plan.id))return null;
 const book=operatingData.manifest(plan.cediData,plan.id),stage=book.stage;
 const nativeProducts=built.productIds.map(id=>doc.getObject(id));
 const physical=plan.id==='CEDI-03'?book.inventoryLocations.flatMap(location=>location.boxes.map(box=>({sku:box.sku,quantity:1,boxes:[box],boxIds:[box.boxId],massKg:box.unitMassKg,color:box.color,width:box.width,height:box.height,depth:box.depth}))):stage.sourcePallets;
 for(let index=0;index<physical.length;index++){
  const data=physical[index],object=nativeProducts[index];if(!object)continue;
  const boxes=data.boxes||[],first=boxes[0]||{},config=type(doc)(object),metadata={datasetId:book.datasetId,palletId:data.palletId||data.bundleId,sku:data.sku||'MIXTO',items:data.items||[{sku:data.sku,quantity:data.quantity}],boxIds:data.boxIds,boxes,lotId:data.lotId||first.lotId,orderId:data.orderId||first.inboundOrderId,abc:data.abc||first.abc,handling:data.handling||first.handling};
  const values={mass:data.massKg,color:data.color||first.color||config.color};if(plan.id==='CEDI-03')Object.assign(values,{width:first.width,height:first.height,depth:first.depth});
  api.set(doc,object,values);object.userData.cediLoad=metadata;doc.setProperty(object,'name',(metadata.sku||'MIXTO')+' · '+(metadata.lotId||'PEDIDO')+' · '+(data.quantity||boxes.length)+' cajas');
  if(object.userData.configurableLoadIdentity)Object.assign(object.userData.configurableLoadIdentity,{lotId:metadata.lotId,boxIds:data.boxIds});
  const stock=built.materialRecipe&&built.materialRecipe.stock.find(row=>row.objectId===oid(object));if(stock)stock.cediLoad=clone(metadata);
 }
 if(plan.id==='CEDI-04'&&built.materialRecipe){
  let offset=0;for(const stock of built.materialRecipe.stock.filter(row=>row.material==='finished')){const object=doc.getObject(stock.objectId),boxes=stage.sourceBoxes.slice(offset,offset+stock.quantity);offset+=stock.quantity;const cediLoad={datasetId:book.datasetId,sku:'MIXTO',boxes,boxIds:boxes.map(row=>row.boxId),items:book.products.map(profile=>({sku:profile.sku,quantity:boxes.filter(box=>box.sku===profile.sku).length})).filter(row=>row.quantity)};stock.cediLoad=clone(cediLoad);object.userData.cediLoad=cediLoad;api.set(doc,object,{mass:boxes.reduce((sum,row)=>sum+row.unitMassKg,0),color:boxes[0].color});doc.setProperty(object,'name','Pedido '+book.orders[(offset-1)/4|0].id+' · '+cediLoad.items.map(row=>row.sku+' × '+row.quantity).join(' / '));}
 }
 if(built.receiving){built.receiving.operatingLoads=nativeProducts.map(object=>({objectId:oid(object),massKg:type(doc)(object).mass,lotId:object.userData.cediLoad&&object.userData.cediLoad.lotId,sku:object.userData.cediLoad&&object.userData.cediLoad.sku}));built.receiving.lotIds=[...new Set(book.inboundPallets.map(row=>row.lotId))];}
 return book;
}

const CONTEXT=[
 ['receive-truck','receiving','robot','equipment.vehicle.freight-truck',[-22,-1.147,27.9,Math.PI/2],'CEDI-01',{length:12,width:2.45,height:3.1}],
 ['receive-truck-secondary','receiving','robot','equipment.vehicle.freight-truck',[-14,-1.147,27.9,Math.PI/2],null,{length:12,width:2.45,height:3.1}],
 ['dispatch-truck','dispatch','robot','equipment.vehicle.freight-truck',[14,-1.147,27.9,Math.PI/2],'CEDI-05',{length:12,width:2.45,height:3.1}],
 ['dispatch-truck-secondary','dispatch','robot','equipment.vehicle.freight-truck',[22,-1.147,27.9,Math.PI/2],null,{length:12,width:2.45,height:3.1}],
 ['reserve-A','reserveStorage','palletQueue','equipment.storage.selective',[-20,1,-15,0],'CEDI-02',{rackBays:2,rackLevels:3,rackColumns:1,rackBayWidths:'2.5,2.5',rackLevelSpacing:1.05,rackSlotDepth:1.1}],
 ['reserve-B','reserveStorage','palletQueue','equipment.storage.selective',[-8,1,-15,0],'CEDI-02',{rackBays:2,rackLevels:3,rackColumns:1,rackBayWidths:'2.5,2.5',rackLevelSpacing:1.05,rackSlotDepth:1.1}],
 ['reserve-C1','reserveStorage','palletQueue','equipment.storage.selective',[6,1,-15,0],null,{rackBays:4,rackLevels:2,rackColumns:1,rackBayWidths:'2,2,2,2',rackLevelSpacing:1.05,rackSlotDepth:1.1,rackAisleCode:'A01',rackRowCode:'R03'}],
 ['reserve-C2','reserveStorage','palletQueue','equipment.storage.selective',[18,1,-15,0],null,{rackBays:4,rackLevels:2,rackColumns:1,rackBayWidths:'2,2,2,2',rackLevelSpacing:1.05,rackSlotDepth:1.1,rackAisleCode:'A01',rackRowCode:'R04'}],
 ['picking-A','picking','palletQueue','equipment.storage.light-medium',[6,1,0,0],'CEDI-03',{rackBays:2,rackLevels:3,rackColumns:1,rackBayWidths:'2.5,2.5'}],
 ['picking-B','picking','palletQueue','equipment.storage.light-medium',[15,1,0,0],'CEDI-03',{rackBays:2,rackLevels:3,rackColumns:1,rackBayWidths:'2.5,2.5'}],
 ['inspection','inspection','processor','equipment.picking.receiving-inspection',[-27,1,4,0],'CEDI-01',{length:2,width:1}],
 ['consolidation','consolidation','processor','equipment.picking.packing-bench',[21,1,0,0],'CEDI-03',{length:2,width:1}],
 ['packing','packing','processor','equipment.picking.packing-bench',[12,1,8,0],'CEDI-04',{length:2,width:1}],
 ['labelling','packing','processor','equipment.picking.packing-bench',[18,1,8,0],'CEDI-04',{length:2,width:1}],
 ['dispatch-control','dispatch','processor','equipment.picking.receiving-inspection',[28,1,10,0],'CEDI-05',{length:2,width:1}],
 ['packing-conveyor','packing','conveyor',null,[11,1,11,0],null,{length:3,width:.75,withPanel:false}],
 ['maintenance-cart','maintenance','vehicle','equipment.vehicle.pallet-truck-manual',[-28,0,-12,0],null,{}]
];

export function buildCediContext(doc,roomId,plan,objects,api){
 if(!/^CEDI-0[1-5]$/.test(plan.id))return null;
 const banks=new Map(),entries=[],inventory=[],stockCells=new Map(),geometrySet=new Set(),materialSet=new Set(),point=new THREE.Vector3(),book=operatingData.manifest(plan.cediData,plan.id);
 const finishRole=material=>material&&material.userData&&material.userData.industrialMaterialRole||'';
 function bake(key,zone,body,pose,label){
  body.position.fromArray(pose.slice(0,3));body.rotation.y=pose[3]||0;body.updateWorldMatrix(true,true);
  const box=new THREE.Box3().setFromObject(body),entry={key,zone,label,position:pose.slice(0,3),bounds:{min:box.min.toArray(),max:box.max.toArray()},interactive:false,objectIds:[]};entries.push(entry);
  body.traverse(node=>{
   if(node.geometry)geometrySet.add(node.geometry);const materials=Array.isArray(node.material)?node.material:node.material?[node.material]:[];materials.forEach(m=>materialSet.add(m));
   if(!node.isMesh||!node.geometry||!node.geometry.attributes.position)return;
   for(let parent=node;parent;parent=parent.parent)if(!parent.visible||parent.userData.editorGeometryReplaced)return;
   const g=node.geometry,a=g.attributes.position,index=g.index,total=index?index.count:a.count;
   const m=materials[0],role=finishRole(m),original=m&&m.color?m.color:new THREE.Color('#7b8b8f'),hsl={};original.getHSL(hsl);
   const preset=/rubber|tire|seat/.test(role)||hsl.l<.12?'rubber':/wood|cardboard/.test(role)?'wood':/steel|metal|chrome|alumin/.test(role)||hsl.s<.12?'steel':'paintedMetal';
   const color=preset==='rubber'?'#26333a':preset==='steel'?'#a9b8bc':preset==='wood'?'#bc9b6b':hsl.h<.18?'#c89435':hsl.h<.48?'#487b69':'#496b7c';
   const bankKey=zone+':'+preset+':'+color;
   if(!banks.has(bankKey))banks.set(bankKey,{zone,preset,color,positions:[],entries:[]});const bank=banks.get(bankKey);if(!bank.entries.includes(entry))bank.entries.push(entry);
   for(let i=0;i<total;i++){point.fromBufferAttribute(a,index?index.getX(i):i).applyMatrix4(node.matrixWorld);bank.positions.push(Math.round(point.x*1e5)/1e5,Math.round(point.y*1e5)/1e5,Math.round(point.z*1e5)/1e5);}
  });return entry;
 }
 try{
  for(const [key,zone,kind,equipment,pose,active,values]of CONTEXT){if(active===plan.id||plan.id==='CEDI-02'&&key==='picking-A')continue;
   const body=createIndustrialPrefab(kind,equipment?'catalogue:'+equipment:undefined,Object.assign({detail:'low',withPanel:false,wear:.15,autoRelease:false,running:false},values));bake(key,zone,body,pose,key.replace(/-/g,' '));
   if(key==='reserve-C1'||key==='reserve-C2'){let config;body.traverse(node=>{const row=(node.userData.editorDefaultBehaviors||[]).find(row=>row.type==='palletQueue');if(row&&!config)config=row;});if(config)for(const cell of schema.warehouseRacks.layout(config).cells)stockCells.set(cell.code,{position:[pose[0]+cell.x,pose[1]+cell.y+.005,pose[2]+cell.z],capacityKg:cell.capacityKg});}
  }
  // The displayed reserve is a finite snapshot. It never registers phantom
  // runtime products or changes the active exercise's material conservation.
  for(let i=0;i<book.inventoryLocations.length;i++){
   const location=book.inventoryLocations[i],profile=book.products.find(row=>row.sku===location.sku),cell=stockCells.get(location.locationCode);if(!cell)throw Error('La ubicación de inventario no existe en la reserva física: '+location.locationCode);const pose=cell.position.concat(0);
   const body=createIndustrialPrefab('product','pallet-loaded',{width:1.2,depth:.8,height:.72,palletType:'euro-1200x800',palletMaterial:'wood',contents:'boxes',units:location.quantity,color:profile.color,detail:'low'});
   const entry=bake('stock-'+i,'reserveStorage',body,pose,location.sku+' · '+location.locationCode);inventory.push({sku:location.sku,abc:profile.abc,handling:profile.handling,quantity:location.quantity,locationCode:location.locationCode,boxIds:location.boxIds,position:pose.slice(0,3),contextKey:entry.key,status:'reference-stock'});
  }
  for(const bank of banks.values()){
   const positions=bank.positions;if(!positions.length)continue;
   const object=doc.addCAD(roomId,{type:'cad',recipe:{steps:[{id:'s1',op:'primitive.mesh',params:{positions},inputs:[]}],output:'s1'},mesh:{positions},color:bank.color,smoothingAngle:35,sourceData:{tool:'cedi-static-native-context',version:1,document:{layoutId:cediLayout.ID,zone:bank.zone,interactive:false,contextKeys:bank.entries.map(entry=>entry.key)}}});doc.setTransform(object,{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
   doc.setProperty(object,'name','CEDI · '+bank.zone+' · contexto estático');doc.setBehaviors(object,[Object.assign(schema.defaultBehavior('collision'),{enabled:true}),Object.assign(schema.defaultBehavior('surfaceMaterial'),{preset:bank.preset,color:bank.color,colorMapMode:'preserve',metalness:bank.preset==='steel'?.65:0,roughness:bank.preset==='rubber'?.9:.65,wear:.12,wearType:'scratches',seed:815})]);objects.push(object);bank.entries.forEach(entry=>entry.objectIds.push(oid(object)));
  }
 }finally{geometrySet.forEach(g=>g.dispose());materialSet.forEach(m=>m.dispose());}
 return{version:1,layoutId:cediLayout.ID,entries,inventory,staticDraws:banks.size,simulationActors:0,notice:'Las áreas de contexto son visibles y consultables; sus controles y cargas no forman parte del intento activo. Las existencias operativas se muestran por separado.'};
}

export function cediPracticePoses(id){return clone(POSES[id]||{});}
