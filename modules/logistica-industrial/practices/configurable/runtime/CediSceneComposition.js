import * as THREE from 'three';
import schema from '../../../contracts/behaviors.js';
import {createIndustrialPrefab} from '../../../functions/presentacion/runtime/IndustrialPrefabs.js';
import cediLayout from '../CediLayout.cjs';
import operatingData from '../CediOperatingData.cjs';
import cad from '../../../../../packages/tools/cad/schema/cad.js';

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

// A single populated installation. These reference machines use the production
// factories and native rack seats, then are baked per area/material. They do
// not create a second simulation or interfere with the selected stage's stock.
const CONTEXT=[
 ['receive-truck','receiving','robot','equipment.vehicle.freight-truck',[-22,-1.147,27.9,Math.PI/2],'CEDI-01',{length:12,width:2.45,height:3.1}],
 ['receive-truck-secondary','receiving','robot','equipment.vehicle.freight-truck',[-14,-1.147,27.9,Math.PI/2],null,{length:12,width:2.45,height:3.1}],
 ['dispatch-truck','dispatch','robot','equipment.vehicle.freight-truck',[14,-1.147,27.9,Math.PI/2],'CEDI-05',{length:12,width:2.45,height:3.1}],
 ['dispatch-truck-secondary','dispatch','robot','equipment.vehicle.freight-truck',[22,-1.147,27.9,Math.PI/2],null,{length:12,width:2.45,height:3.1}],
 ['reserve-A','reserveStorage','palletQueue','equipment.storage.selective',[-20,1,-15,0],'CEDI-02',{rackBays:2,rackLevels:3,rackColumns:1,rackBayWidths:'2.5,2.5',rackLevelHeight:1.5,rackSlotDepth:1.1,rackAisleCode:'A01',rackRowCode:'R01'}],
 ['reserve-B','reserveStorage','palletQueue','equipment.storage.selective',[-8,1,-15,0],'CEDI-02',{rackBays:2,rackLevels:3,rackColumns:1,rackBayWidths:'2.5,2.5',rackLevelHeight:1.5,rackSlotDepth:1.1,rackAisleCode:'A01',rackRowCode:'R02'}],
 ['reserve-C1','reserveStorage','palletQueue','equipment.storage.selective',[6,1,-15,0],null,{rackBays:4,rackLevels:2,rackColumns:1,rackBayWidths:'2,2,2,2',rackLevelHeight:1.5,rackSlotDepth:1.1,rackAisleCode:'A01',rackRowCode:'R03'}],
 ['reserve-C2','reserveStorage','palletQueue','equipment.storage.selective',[18,1,-15,0],null,{rackBays:4,rackLevels:2,rackColumns:1,rackBayWidths:'2,2,2,2',rackLevelHeight:1.5,rackSlotDepth:1.1,rackAisleCode:'A01',rackRowCode:'R04'}],
 ['picking-A','picking','palletQueue','equipment.storage.light-medium',[6,1,0,0],'CEDI-03',{rackBays:2,rackLevels:3,rackColumns:1,rackBayWidths:'2.5,2.5',rackLevelHeight:.7}],
 ['picking-B','picking','palletQueue','equipment.storage.light-medium',[15,1,0,0],'CEDI-03',{rackBays:2,rackLevels:3,rackColumns:1,rackBayWidths:'2.5,2.5',rackLevelHeight:.7}],
 ['inspection','inspection','processor','equipment.picking.receiving-inspection',[-27,1,4,0],'CEDI-01',{length:2,width:1}],
 ['consolidation','consolidation','processor','equipment.picking.packing-bench',[21,1,0,0],'CEDI-03',{length:2,width:1}],
 ['packing','packing','processor','equipment.picking.packing-bench',[12,1,8,0],'CEDI-04',{length:2,width:1}],
 ['labelling','packing','processor','equipment.picking.packing-bench',[18,1,8,0],'CEDI-04',{length:2,width:1}],
 ['dispatch-control','dispatch','processor','equipment.picking.receiving-inspection',[28,1,10,0],'CEDI-05',{length:2,width:1}],
 ['maintenance-cart','maintenance','vehicle','equipment.vehicle.pallet-truck-manual',[-40,0,-22,Math.PI/2],null,{}]
];
const row=(key,zone,kind,equipment,pose,values={},active=null)=>CONTEXT.push([key,zone,kind,equipment,pose,active,values]);
// Parallel unloading/inspection lanes, outside the REC-01 native manoeuvre.
for(let n=0;n<2;n++){
 row('reception-rollers-'+n,'receiving','conveyor','equipment.transport.roller-pallet',[-28+n*11,1,3,Math.PI/2],{length:5,width:1.05,withPanel:false});
 row('qc-bench-'+n,'inspection','processor','equipment.picking.receiving-inspection',[-27+n*8,1,-9,0],{length:2.2,width:1.05});
}
// The two AS/RS rack-and-crane assemblies are native pallet AS/RS equipment.
// Their longitudinal guide, lift carriage and extractor are not a miniload icon.
for(let n=0;n<2;n++)row('asrs-crane-rack-'+n,'asrs','palletQueue','equipment.storage.pallet-asrs',[-23,1,-33.2+n*7.3,n?Math.PI:0],{rackBays:5,rackLevels:5,rackColumns:1,rackBayWidth:1.8,rackSlotDepth:1.35,rackLevelHeight:1.55,rackAisleCode:'AS01',rackRowCode:'R0'+(n+1)});
for(let n=0;n<2;n++)row('asrs-feed-'+n,'asrs','conveyor','equipment.transport.roller-pallet',[-27+n*8,1,-23.2,Math.PI/2],{length:2,width:1.1,withPanel:false});
// Four full rows of reserve, rather than isolated sample shelves on a wall.
for(let z=0;z<2;z++)for(let x=0;x<2;x++)row('reserve-rear-'+z+'-'+x,'rearReserve','palletQueue','equipment.storage.selective',[-6+x*18,1,-33+z*6,0],{rackBays:6,rackLevels:4,rackColumns:1,rackBayWidths:'2,2,2,2,2,2',rackLevelHeight:1.5,rackSlotDepth:1.1,rackAisleCode:'AB'+(z+2),rackRowCode:'R0'+(x+5),displayClass:x?'B':'A'});
row('special-cantilever','specialStorage','palletQueue','equipment.storage.cantilever',[28,1,-29,Math.PI/2],{rackBays:2,rackLevels:3,rackColumns:1,rackBayWidth:2.5,rackSlotDepth:1.1});
row('special-enclosed','specialStorage','palletQueue','equipment.storage.light-medium',[28,1,-19,Math.PI/2],{rackBays:2,rackLevels:3,rackColumns:1,rackBayWidth:1.8,rackSlotDepth:.75,rackLevelHeight:.7});
row('quarantine-rack','quarantine','palletQueue','equipment.storage.selective',[-4.5,1,.8,0],{rackBays:2,rackLevels:2,rackColumns:1,rackBayWidths:'2,2',rackSlotDepth:1.1,rackLevelHeight:1.3,rackAisleCode:'Q01',rackRowCode:'RET'});
row('empty-packaging-rack','emptyPackaging','palletQueue','equipment.storage.light-medium',[-4.5,1,11.2,0],{rackBays:2,rackLevels:3,rackColumns:1,rackBayWidth:2,rackLevelHeight:.55,rackSlotDepth:.7});
// Packing forms a continuous U conveyor around three protected manual stations.
// The selected stage's guarded packaging/robot assets replace matching fixtures.
for(let n=0;n<3;n++)row('packing-manual-'+n,'packing','processor','equipment.picking.packing-bench',[10.5+n*4.2,1,-4,0],{length:2.4,width:1});
// Native sealing/label machines already contain their own load-bearing beds.
// External belts end before those beds; short fixed transfer plates close the
// roller clearance without drawing a second coplanar belt through a machine.
row('packing-belt-spine-in','packing','conveyor','equipment.transport.flat-belt',[10.0875,1,-2.4,0],{length:2.105,width:.65,withPanel:false});
row('packing-belt-spine-mid','packing','conveyor','equipment.transport.flat-belt',[15.25,1,-2.4,0],{length:.78,width:.65,withPanel:false});
row('packing-belt-spine-out','packing','conveyor','equipment.transport.flat-belt',[19.8625,1,-2.4,0],{length:1.005,width:.65,withPanel:false});
row('packing-belt-in','packing','conveyor','equipment.transport.flat-belt',[8.6,1,-3.2,Math.PI/2],{length:1.7,width:.65,withPanel:false});
row('packing-belt-out','packing','conveyor','equipment.transport.flat-belt',[20.8,1,-3.2,Math.PI/2],{length:1.7,width:.65,withPanel:false});
row('packing-carton-sealer','packing','processor','equipment.packaging.carton-sealer',[13,1,-2.4,0],{length:1.4,width:.8});
row('packing-print-apply','packing','processor','equipment.packaging.print-apply',[17.5,1,-2.4,0],{length:1.3,width:.8});
const PACKING_TRANSFER_GAPS=[[8.925,9.035],[11.14,11.25],[14.75,14.86],[15.64,15.75],[19.25,19.36],[20.365,20.475]];
row('packing-robot','palletizing','robot','equipment.robot.four-axis-palletizer',[24.5,0,6.8,Math.PI],{withPanel:false,detail:'low',reach:1.8,payload:25},'CEDI-04');
row('palletizing-roller','palletizing','conveyor','equipment.transport.roller-pallet',[24.5,1,9.5,Math.PI/2],{length:2.4,width:1.05,withPanel:false});
row('packing-wrap-context','palletizing','processor','equipment.packaging.stretch-wrapper',[28,1,6,0],{length:1.6,width:1.4},'CEDI-04');
// Cross docking stays a clear driving connection, with two short transfer banks
// alongside its path, never a conveyor blocking the full manoeuvring aisle.
for(let n=0;n<2;n++)row('crossdock-buffer-'+n,'crossDock','conveyor','equipment.transport.roller-pallet',[-6+n*7,1,18.9,0],{length:3.2,width:1.05,withPanel:false});

export function buildCediContext(doc,roomId,plan,objects,api){
 if(!/^CEDI-0[1-5]$/.test(plan.id))return null;
 const banks=new Map(),entries=[],inventory=[],displayStock=[],stockCells=new Map(),rackLayouts=new Map(),geometrySet=new Set(),materialSet=new Set(),point=new THREE.Vector3(),book=operatingData.manifest(plan.cediData,plan.id);
 const finishRole=material=>material&&material.userData&&material.userData.industrialMaterialRole||'';
 function bake(key,zone,body,pose,label){
  body.position.fromArray(pose.slice(0,3));body.rotation.y=pose[3]||0;body.updateWorldMatrix(true,true);
  const box=new THREE.Box3().setFromObject(body),entry={key,zone,label,position:pose.slice(0,3),bounds:{min:box.min.toArray(),max:box.max.toArray()},interactive:false,objectIds:[]};entries.push(entry);
  body.traverse(node=>{
   if(node.geometry)geometrySet.add(node.geometry);const materials=Array.isArray(node.material)?node.material:node.material?[node.material]:[];materials.forEach(m=>materialSet.add(m));
   if(!node.isMesh||!node.geometry||!node.geometry.attributes.position)return;
   for(let parent=node;parent;parent=parent.parent)if(!parent.visible||parent.userData.editorGeometryReplaced)return;
   // Atlas glyphs cannot be flattened to colour-only CAD without becoming
   // opaque plates. Shared row/area codes are rendered by the floor/sign layer.
   if(node.userData.warehouseRackLocationLabels)return;
   const g=node.geometry,a=g.attributes.position,index=g.index,total=index?index.count:a.count;
   const m=materials[0],role=finishRole(m),original=m&&m.color?m.color.clone():new THREE.Color('#7b8b8f'),hsl={};
   if(m&&m.userData&&m.userData.studioColorSpace==='linear')original.convertLinearToSRGB();original.getHSL(hsl);
   const description=role+' '+(m&&m.name||'')+' '+(node.name||'');
   const preset=/rubber|tire|seat|neum|asiento/i.test(description)||hsl.l<.13?'rubber':/wood|cardboard|carton|madera|tablas/i.test(description)?'wood':/steel|chrome|alumin|acero|metal/i.test(role)&&hsl.s<.25?'steel':hsl.s<.09?'steel':'paintedMetal';
   // Keep the manufactured frame/beam/guard palette and SKU distinction. The
   // former hue-only quantizer painted orange beams and blue racks alike.
   const color=preset==='rubber'?'#27363c':preset==='steel'?(hsl.l<.35?'#52646b':'#abbabd'):preset==='wood'?(hsl.l>.7?'#d6c3a1':'#b79464'):hsl.h<.07?'#b96636':hsl.h<.14?'#d58b32':hsl.h<.2?'#d8b43a':hsl.h<.44?'#63816a':hsl.h<.59?'#588994':'#346483';
   const bankKey=zone+':'+preset+':'+color;
   if(!banks.has(bankKey))banks.set(bankKey,{zone,preset,color,positions:[],entries:[]});const bank=banks.get(bankKey);if(!bank.entries.includes(entry))bank.entries.push(entry);
   for(let i=0;i<total;i++){point.fromBufferAttribute(a,index?index.getX(i):i).applyMatrix4(node.matrixWorld);bank.positions.push(Math.round(point.x*1e5)/1e5,Math.round(point.y*1e5)/1e5,Math.round(point.z*1e5)/1e5);}
  });return entry;
 }
 try{
  const rackConfig=body=>{let config;body.traverse(node=>{const found=(node.userData.editorDefaultBehaviors||[]).find(row=>row.type==='palletQueue');if(found&&!config&&schema.warehouseRacks.isRack(found))config=found;});return config;};
  const addStock=(key,zone,position,profile,quantity=8,height=.9,locationCode='')=>{
   const body=createIndustrialPrefab('product','pallet-loaded',{width:1.2,depth:.8,height,palletType:'euro-1200x800',palletMaterial:'wood',contents:'boxes',units:quantity,color:profile.color,detail:'low'});
   const entry=bake(key,zone,body,position.concat(0),(profile.abc||'')+' · '+profile.sku+' · '+locationCode);
   displayStock.push({key,zone,sku:profile.sku,abc:profile.abc,handling:profile.handling,locationCode,position:position.slice(),contextKey:entry.key,operational:false});return entry;
  };
  const addRackStock=(key,fixtureKey,rack,cell,profile)=>{
   const position=cell.worldPosition,light=['light-duty','medium-duty','carton-flow'].includes(rack.config.rackSystem),long=rack.config.rackSystem==='cantilever';
   if(!light&&!long){const entry=addStock(key,rack.zone,position,profile,8,Math.min(1.05,(rack.config.rackLevelHeight||1.5)-.2),cell.code);displayStock[displayStock.length-1].supportFixtureKey=fixtureKey;displayStock[displayStock.length-1].loadType='pallet';return entry;}
   const height=Math.min(.42,(rack.config.rackLevelHeight||.7)-.12),width=Math.min(1.25,cell.width*.8),depth=Math.min(.55,cell.depth*.8);
   let body,loadType;
   if(long){
    body=new THREE.Group();loadType='long-steel-profiles';
    // Three real channel sections span both cantilever arms. Unlike a short
    // Euro pallet, each section has a continuous bearing length along the bay.
    const length=cell.width*.9,steel=new THREE.MeshStandardMaterial({color:'#8a9b9e',roughness:.58,metalness:.72});
    for(const z of [-.22,0,.22])for(const[p,size]of [[[0,.012,z],[length,.024,.13]],[[0,.073,z-.057],[length,.122,.016]],[[0,.073,z+.057],[length,.122,.016]]]){const mesh=new THREE.Mesh(new THREE.BoxBufferGeometry(...size),steel);mesh.name='Long structural channel';mesh.position.fromArray(p);body.add(mesh);}
   }else{loadType=rack.zone==='emptyPackaging'?'empty-tote':'picking-tote';body=createIndustrialPrefab('product','tote',{width,depth,height,units:1,color:rack.zone==='emptyPackaging'?'#7d9aa0':profile.color,detail:'low'});}
   const entry=bake(key,rack.zone,body,position.concat(rack.yaw),long?'Long structural sections':loadType+' '+cell.code);
   displayStock.push({key,zone:rack.zone,sku:long?'REF-PERFIL':profile.sku,abc:profile.abc,handling:long?'long-stock':profile.handling,loadType,supportFixtureKey:fixtureKey,locationCode:cell.code,position:position.slice(),yaw:rack.yaw,contextKey:entry.key,operational:false});return entry;
  };
  for(const [key,zone,kind,equipment,pose,active,values]of CONTEXT){if(active===plan.id||plan.id==='CEDI-02'&&key==='picking-A')continue;
   const body=createIndustrialPrefab(kind,equipment?'catalogue:'+equipment:undefined,Object.assign({detail:'low',withPanel:false,wear:.15,autoRelease:false,running:false},values));
   const config=rackConfig(body);
   if(config){
    const layout=schema.warehouseRacks.layout(config),transform=new THREE.Matrix4().compose(new THREE.Vector3(...pose.slice(0,3)),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),pose[3]||0),new THREE.Vector3(1,1,1));
    rackLayouts.set(key,{zone,config,yaw:pose[3]||0,cells:layout.cells.map(cell=>Object.assign({},cell,{worldPosition:new THREE.Vector3(cell.x,cell.y+.005,cell.z).applyMatrix4(transform).toArray()}))});
    if(key==='reserve-C1'||key==='reserve-C2')for(const cell of rackLayouts.get(key).cells)stockCells.set(cell.code,{position:cell.worldPosition,capacityKg:cell.capacityKg});
    // Recreate only reference racks with the native structural LOD. All native
    // load geometry and address coordinates stay identical to the full rig.
    if(!/^asrs-/.test(key)){
     body.traverse(node=>{if(node.geometry)geometrySet.add(node.geometry);(Array.isArray(node.material)?node.material:node.material?[node.material]:[]).forEach(m=>materialSet.add(m));});
     body.children.slice().forEach(child=>body.remove(child));body.add(schema.warehouseRackVisual.createVisual(THREE,Object.assign({},config,{rackContextLOD:true}),layout));
    }
   }
   bake(key,zone,body,pose,key.replace(/-/g,' '));
  }
  // Populated, labelled reference rows make every area readable. A reference
  // snapshot has its own explicit ledger and never inflates attempt inventory.
  let displayIndex=0;
  for(const [key,rack]of rackLayouts){
   if(['reserve-C1','reserve-C2'].includes(key))continue;
   const fill=/asrs|reserve-rear/.test(key)?.72:/quarantine/.test(key)?.5:/picking/.test(key)?.7:/reserve-/.test(key)?.65:.45;
   for(const cell of rack.cells){
    if((cell.index*37%100)/100>=fill)continue;
    const profile=book.products[(cell.bay+cell.level+displayIndex)%book.products.length];
    addRackStock('display-rack-'+displayIndex++,key,rack,cell,profile);
   }
  }
  // Floor picking is grouped into product lanes with gaps for the forks, not
  // random boxes in a circulation lane. Keep the validated z=-9..-5 aisle free.
  for(let n=0;n<8;n++)addStock('picking-floor-'+n,'pickingFloor',[4.2+n*2.4,.005,-10.3],book.products[n%book.products.length],8,.75+n%3*.1,'P02-'+String(n+1).padStart(2,'0'));
  for(let n=0;n<3;n++)addStock('quarantine-floor-'+n,'quarantine',[-7+n*2,.005,6.2],book.products[n%book.products.length],4,.6,'Q01-S0'+(n+1));
  for(let n=0;n<4;n++)addStock('dispatch-stage-'+n,'dispatch',[5.1+n*1.6,.005,20.1],book.products[n%book.products.length],8,1,'DES-B0'+(n+1));
  for(let n=0;n<2;n++){addStock('crossdock-fast-'+n,'crossDock',[-6+n*7,1.005,18.9],book.products[n%book.products.length],8,.85,'XD-0'+(n+1));displayStock[displayStock.length-1].supportFixtureKey='crossdock-buffer-'+n;displayStock[displayStock.length-1].loadType='pallet';}
  // The displayed reserve is a finite snapshot. It never registers phantom
  // runtime products or changes the active exercise's material conservation.
  for(let i=0;i<book.inventoryLocations.length;i++){
   const location=book.inventoryLocations[i],profile=book.products.find(row=>row.sku===location.sku),cell=stockCells.get(location.locationCode);if(!cell)throw Error('La ubicación de inventario no existe en la reserva física: '+location.locationCode);const pose=cell.position.concat(0);
   const body=createIndustrialPrefab('product','pallet-loaded',{width:1.2,depth:.8,height:.72,palletType:'euro-1200x800',palletMaterial:'wood',contents:'boxes',units:location.quantity,color:profile.color,detail:'low'});
   const entry=bake('stock-'+i,'reserveStorage',body,pose,location.sku+' · '+location.locationCode);inventory.push({sku:location.sku,abc:profile.abc,handling:profile.handling,quantity:location.quantity,locationCode:location.locationCode,boxIds:location.boxIds,position:pose.slice(0,3),contextKey:entry.key,status:'reference-stock'});
  }
  // Safety cages and manual work bays. All clearances are authored around
  // existing native paths; no wall crosses the front cross-docking corridor.
  const hardware=new Map();
  const part=(zone,color,name,p,size,rotation=[0,0,0])=>{if(!hardware.has(zone))hardware.set(zone,new THREE.Group());const mesh=new THREE.Mesh(new THREE.BoxBufferGeometry(...size),new THREE.MeshStandardMaterial({color,roughness:.7,metalness:.2}));mesh.name=name;mesh.position.fromArray(p);mesh.rotation.fromArray(rotation);hardware.get(zone).add(mesh);};
  for(const[from,to]of PACKING_TRANSFER_GAPS){part('packing','#abbabd','Transfer bridge between actual conveyor and machine beds',[(from+to)/2,.994,-2.4],[to-from-.004,.012,.65]);for(const side of [-1,1])part('packing','#52646b','Transfer bridge support bracket',[(from+to)/2,.947,-2.4+side*.3],[to-from+.02,.05,.035]);}
  const fence=(zone,axis,at,from,to,opening)=>{
   const segments=opening?[[from,opening[0]],[opening[1],to]]:[[from,to]];
   for(const[a,b]of segments){if(b-a<.1)continue;const p=(along,y)=>axis==='x'?[along,y,at]:[at,y,along],dims=(length,height,depth)=>axis==='x'?[length,height,depth]:[depth,height,length];
    const count=Math.ceil((b-a)/2.5);for(let i=0;i<=count;i++){const c=a+(b-a)*i/count;part(zone,'#2b3e46','Poste de cerramiento',p(c,1.05),dims(.07,2.1,.07));part(zone,'#a5b1b4','Placa de anclaje',p(c,.025),dims(.2,.05,.2));}
    for(const y of [.2,1.05,2.05])part(zone,'#d3ac36','Marco de seguridad',p((a+b)/2,y),dims(b-a,.045,.045));
    // Coarse welded-wire mesh is batched and has no transparency overdraw.
    for(let c=a+.2;c<b;c+=.32)part(zone,'#b7aa62','Malla de seguridad',p(c,1.1),dims(.009,1.8,.009));
    for(let y=.4;y<2;y+=.28)part(zone,'#b7aa62','Malla horizontal',p((a+b)/2,y),dims(b-a,.009,.009));
   }
  };
  fence('asrs','z',-16.5,-36,-22.7);fence('asrs','x',-22.7,-29.5,-16.5,[-27.8,-18.2]);
  fence('packing','x',-4.9,8,23,[19.5,22]);fence('packing','z',23,-4.9,-1.7);fence('packing','z',8,-4.9,-1.7,[-4.2,-2.2]);
  fence('palletizing','z',30,3,11.5,[5,7.4]);fence('palletizing','x',11.5,24,30,[26,28]);
  fence('quarantine','z',-8.4,.2,7.4);fence('quarantine','x',7.4,-8.4,-.8,[-6.5,-4]);
  // Tablet stands, chairs, sealing stock and small unmistakable workstation
  // details, all supported on the same actual bench and floor surfaces.
  for(let n=0;n<3;n++){
   const x=10.5+n*4.2;part('packing','#23505b','Monitor de puesto',[x,1.37,-3.66],[.48,.34,.045]);part('packing','#7c939d','Brazo de monitor',[x,1.15,-3.61],[.055,.45,.055]);part('packing','#283b44','Asiento de operario',[x,.46,-4.65],[.5,.12,.5]);part('packing','#283b44','Respaldo de operario',[x,.76,-4.87],[.5,.55,.08]);for(const dx of [-.18,.18])for(const dz of [-.18,.18])part('packing','#71838a','Pata de silla',[x+dx,.23,-4.65+dz],[.035,.46,.035]);
   part('packing','#d3bea0','Cartón preparado',[x+.6,1.19,-4],[.45,.36,.35]);part('packing','#617e91','Dispensador de etiqueta',[x-.7,1.13,-4],[.22,.22,.26]);
  }
  for(const[zone,body]of hardware)bake('guards-and-fixtures-'+zone,zone,body,[0,0,0,0],'Cerramientos, protecciones y puestos de '+zone);
  const marks=doc.addIndustrialFloorPresentation(roomId,{type:'industrialFloor',version:1,bounds:[-32,-38,32,22],floorY:.034,
   texts:['A · ALTA ROTACIÓN','B · ROTACIÓN MEDIA','C · BAJA ROTACIÓN','ESPECIALES','RETENIDO · Q01','P02 · PICKING POR SKU','CROSS-DOCK · SALIDA RÁPIDA','PUESTOS MANUALES','PALETIZADO · ACCESO CONTROLADO','DESPACHO · LOTE Y DESTINO'],
   labels:[[-6,-35.6,0,7,.7,8],[12,-29.9,0,7,.7,9],[12,-12.8,0,7,.7,10],[28,-23.5,Math.PI/2,7,.7,11],[-4.5,5,0,5.5,.6,12],[12.6,-9.7,0,8,.5,13],[0,16.3,0,8,.7,14],[15,-4.5,0,7,.55,15],[27,10.6,0,5,.5,16],[8,18.6,0,6,.5,17]],
   arrows:[[-8,16,Math.PI/2],[0,16,Math.PI/2],[8,16,Math.PI/2]],signs:[[-15.8,-23.8,0,1,16],[-.8,6.8,0,1,12],[29,-23.5,Math.PI/2,1,11]]});
  doc.setProperty(marks,'name','CEDI · referencias ABC, producto, zonas y cross-docking');doc.setBehaviors(marks,[Object.assign(schema.defaultBehavior('collision'),{enabled:false})]);objects.push(marks);
  for(const bank of banks.values()){
   const positions=bank.positions.length?cad.encodePositions(bank.positions):null;if(!positions)continue;
   const object=doc.addCAD(roomId,{type:'cad',recipe:{steps:[{id:'s1',op:'primitive.mesh',params:{positions},inputs:[]}],output:'s1'},mesh:{positions},color:bank.color,smoothingAngle:35,sourceData:{tool:'cedi-static-native-context',version:1,document:{layoutId:cediLayout.ID,zone:bank.zone,interactive:false,contextKeys:bank.entries.map(entry=>entry.key)}}});doc.setTransform(object,{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
   doc.setProperty(object,'name','CEDI · '+bank.zone+' · contexto estático');doc.setBehaviors(object,[Object.assign(schema.defaultBehavior('collision'),{enabled:true}),Object.assign(schema.defaultBehavior('surfaceMaterial'),{preset:bank.preset,color:bank.color,colorMapMode:'preserve',metalness:bank.preset==='steel'?.65:0,roughness:bank.preset==='rubber'?.9:.65,wear:.12,wearType:'scratches',seed:815})]);objects.push(object);bank.entries.forEach(entry=>entry.objectIds.push(oid(object)));
  }
 }finally{geometrySet.forEach(g=>g.dispose());materialSet.forEach(m=>m.dispose());}
 return{version:2,layoutId:cediLayout.ID,entries,inventory,displayStock,staticDraws:banks.size+1,simulationActors:0,notice:'Las áreas de contexto son visibles y consultables; sus controles y cargas no forman parte del intento activo. Las existencias operativas se muestran por separado.'};
}

export function cediPracticePoses(id){return clone(POSES[id]||{});}
