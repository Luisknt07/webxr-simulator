import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),h=require('../legacy/test-processor-runtime.js'),warehouse=require('../legacy/test-warehouse-rack-runtime.js'),native=require('../legacy/test-vehicle-storage.js');
const catalog=require('../../modules/logistica-industrial/functions/equipamiento/schema/equipmentCatalog.cjs');
const sources=require('../../modules/logistica-industrial/functions/flujo-materiales/schema/productSources.js');
function realSetup(){const f=h.setup();f.document=new native.Document({});f.document.registerRoom('hall',f.root);f.ctx.collisionWorld=new f.ctx.collisionWorld.constructor(f.ctx,f.document);f.runtime=new f.runtime.constructor(f.ctx,f.document);return f;}
function until(f,condition,seconds=60){for(let t=0;t<seconds&&!condition();t+=.2)h.advance(f,.2);assert.ok(condition(),'Timed out '+(f.catalogueStage||'')+': '+(f.stock?.rack?.status||JSON.stringify(f.runtime.getSnapshot?.().objects.filter(x=>['processor','conveyor','source'].includes(x.type)).map(x=>({name:x.name,type:x.type,state:x.variables.state,queued:x.variables.queued,output:x.variables.outputQueued,received:x.variables.receivedUnits,delivered:x.variables.deliveredUnits})))));}
function behavior(f,o,type){return f.document.getBehaviors(o).find(x=>x.type===type);}
function patch(f,o,type,value){f.document.setBehaviors(o,f.document.getBehaviors(o).map(x=>x.type===type?Object.assign({},x,value):x));}

test('native typed Source materializes the actual IBC/long stock/bulk model and preserves semantic metadata, custody and stop restoration',async()=>{
 for(const [id,type,material,width,height,depth] of [['equipment.product.ibc','jerrycan','solid',1,1.16,1.2],['equipment.product.long-stock','cylinder','steel',2.4,.2,.2],['equipment.product.bulk-fluid','sack','bulk',.35,.25,.35]]){
  const f=realSetup(),spec={id:'typed-load',name:'Carga tipada',type,materialClass:material,catalogueEquipmentId:id,width,height,depth,mass:3,base:'flat',color:'#aa8855',quality:'good',defect:'none'};
  const normalized=sources.normalizeCatalog([spec]);assert.equal(normalized[0].catalogueEquipmentId,id);
  const source=h.add(f,'source',{catalog:JSON.stringify([spec]),generationMode:'sequence',initialCount:1,autoGenerate:false,delivery:'manual'},[-10,1,0]),before=await f.document.serialize();
  f.runtime.start('hall');const record=h.record(f,source),entry=record.components.source.queue[0],product=entry.product;
  assert.ok(product,id+' live product');assert.equal(product.object.userData.catalogueEquipmentId,id);assert.equal(f.runtime.productMetadata(product).catalogueEquipmentId,id);assert.equal(f.runtime.productMetadata(product).materialClass,material);
  assert.equal(product.sourceEntry,entry);assert.equal(entry.ownerId,record.id);assert.equal(entry.units,1);assert.equal(f.runtime.sourceRuntime.liveLoads(),1);
  f.runtime.stop();assert.deepEqual(await f.document.serialize(),before);
 }
 assert.throws(()=>sources.normalizeCatalog([{id:'bad',name:'Bad',type:'box',width:.3,height:.3,depth:.3,color:'#aaaaaa',catalogueEquipmentId:'equipment.machine.cnc-lathe'}]),/producto|carga/);
});

test('CNC, stretch wrapper, picking and put-wall pass four real loads through native ports and preserve identities',()=>{
 for(const id of ['equipment.machine.cnc-lathe','equipment.packaging.stretch-wrapper','equipment.picking.pick-to-light','equipment.picking.put-wall']){
  const f=realSetup(),source=h.add(f,'source',{initialCount:4,capacity:8,autoGenerate:false,delivery:'automatic',outputInterval:.1,width:.3,height:.2,depth:.3},[-8,1,0]);
  const machine=f.document.addPrefab('hall','processor','catalogue:'+id);patch(f,machine,'processor',{processTime:.1,setupTime:0,powered:true,running:true,delivery:'automatic',outputInterval:.1,withPanel:false});f.document.setTransform(machine,{position:[0,1,0]});
  const belt=h.add(f,'conveyor',{length:2,width:1,speed:1.5,autoSpawn:false,withPanel:false,withSensors:false},[8,1,0]);
  const receiver=h.add(f,'source',{initialCount:0,capacity:8,autoGenerate:false,delivery:'manual'},[14,1,0]);
  h.link(f,source,machine);h.link(f,machine,belt);h.link(f,belt,receiver);
  f.runtime.start('hall');const original=[...h.inventory(f,source).queue];
  until(f,()=>h.inventory(f,receiver).queue.length===4,40);
  assert.equal(h.processor(f,machine).completedUnits,4,id);assert.equal(h.record(f,belt).components.conveyor.entryUnits,4,id);assert.equal(f.runtime.sourceRuntime.liveLoads(),4,id);
  const received=h.inventory(f,receiver).queue;assert.deepEqual(new Set(received.map(x=>x.id)),new Set(original.map(x=>x.id)),id);assert.ok(received.every(x=>x.spec.operationHistory?.some(y=>y.equipmentId===id)),id);
  f.runtime.stop();
 }
});

test('pallet-sized dock and wrapper buffers physically support and transfer a real 1.2 metre loaded pallet',()=>{
 for(const id of ['equipment.dock.forklift-station','equipment.packaging.stretch-wrapper']){
  const f=realSetup(),spec={id:'pallet-batch',name:'Pallet cargado',type:'pallet',variant:'pallet-loaded',catalogueEquipmentId:'equipment.product.loaded-pallet',width:1.2,height:.72,depth:.8,mass:33,base:'runners',materialClass:'solid',color:'#b9945b',units:1};
  const source=h.add(f,'source',{catalog:JSON.stringify([spec]),generationMode:'sequence',initialCount:1,capacity:4,autoGenerate:false,delivery:'automatic',outputInterval:.1},[-8,1,0]);
  const machine=f.document.addPrefab('hall','processor','catalogue:'+id);patch(f,machine,'processor',{width:1.6,processTime:.1,setupTime:0,powered:true,running:true,delivery:'automatic',outputInterval:.1,withPanel:false});f.document.setTransform(machine,{position:[0,1,0]});
  const cfg=behavior(f,machine,'processor'),layout=catalog.layout(id,cfg);assert.equal(layout.bufferLength,1.5);assert.ok(layout.inputPosition[0]+layout.bufferLength/2<=-layout.bodyLength/2);assert.equal(layout.output.x,layout.length/2);
  let supports;machine.traverse(node=>{if(node.userData.catalogueBufferSupports)supports=node.userData.catalogueBufferSupports;});assert.ok(supports?.every(row=>row.length===1.5),'Visible supports share the real buffer dimensions.');
  const belt=h.add(f,'conveyor',{variant:'pallet-roller',length:2,width:1.6,speed:1.5,autoSpawn:false,withPanel:false,withSensors:false},[8,1,0]),receiver=h.add(f,'source',{initialCount:0,capacity:4,autoGenerate:false,delivery:'manual',palletWidth:1.6,palletDepth:1.5},[14,1,0]);
  h.link(f,source,machine);h.link(f,machine,belt);h.link(f,belt,receiver);f.runtime.start('hall');const original=h.inventory(f,source).queue.map(entry=>entry.id);until(f,()=>h.inventory(f,receiver).queue.length===1,40);assert.equal(h.processor(f,machine).completedUnits,1);assert.deepEqual(new Set(h.inventory(f,receiver).queue.map(entry=>entry.id)),new Set(original));f.runtime.stop();
 }
});

test('complete catalogue pallets retain pallet admission and exact total mass through source, conveyor and pallet stock',()=>{
 const f=realSetup(),spec={id:'complete-pallet',name:'Pallet completo',type:'pallet',catalogueEquipmentId:'equipment.product.loaded-pallet',width:1.2,height:.72,depth:.8,mass:33,base:'runners',materialClass:'solid',color:'#b9945b',units:1};
 const source=h.add(f,'source',{catalog:JSON.stringify([spec]),generationMode:'sequence',initialCount:4,capacity:4,autoGenerate:false,delivery:'automatic',outputInterval:.1},[-8,1,0]);
 const belt=f.document.addPrefab('hall','conveyor','catalogue:equipment.transport.roller-pallet');patch(f,belt,'conveyor',{length:3,width:1.6,speed:1.5,powered:true,running:true,autoSpawn:false,withPanel:false,withSensors:false});
 const receiver=f.document.addPrefab('hall','palletQueue');patch(f,receiver,'palletQueue',{capacity:4,palletCapacity:4,acceptsPallets:true,running:true,withPanel:false,autoRelease:false});h.link(f,source,belt);
 const beltConfig=behavior(f,belt,'conveyor'),receiverConfig=behavior(f,receiver,'palletQueue');patch(f,belt,'conveyor',{outputId:receiver.userData.editorId,outputPort:'input'});f.scene.updateMatrixWorld(true);const out=h.ports(beltConfig).outlet||h.ports(beltConfig).output,input=h.behaviorSchema.palletQueues.layout(receiverConfig).input,point=new h.THREE.Vector3(out.x,0,out.z).applyMatrix4(belt.matrixWorld).sub(new h.THREE.Vector3(input.x,0,input.z));f.document.setTransform(receiver,{position:point.toArray()});
 f.runtime.start('hall');const original=h.inventory(f,source).queue.map(entry=>entry.id),first=h.inventory(f,source).queue[0];assert.equal(f.runtime.productMetadata(first.product).loadMode,'pallet');assert.equal(f.runtime.productMetadata(first.product).mass,33);assert.notEqual(first.load?.loadMode,'pallet','Already complete pallets do not acquire another pallet assembly.');
 until(f,()=>h.record(f,receiver).components.palletQueue.receivedUnits===4,50);const stored=h.record(f,receiver).components.palletQueue.queue;assert.deepEqual(new Set(stored.map(entry=>entry.id)),new Set(original));assert.ok(stored.every(entry=>entry.spec.mass===33));assert.equal(f.runtime.sourceRuntime.liveLoads(),4);f.runtime.stop();
});

test('molding transforms a declared bulk preform into a real solid product body without replacing its load identity or adding mass',async()=>{
 const f=realSetup(),spec={id:'polymer-batch',name:'Lote de polímero',type:'sack',materialClass:'bulk',catalogueEquipmentId:'equipment.product.bulk-fluid',width:.35,height:.25,depth:.35,mass:3,base:'flat',color:'#c7b58f',quality:'good',defect:'none'};
 const source=h.add(f,'source',{catalog:JSON.stringify([spec]),generationMode:'sequence',initialCount:2,capacity:4,autoGenerate:false,delivery:'automatic',outputInterval:.1},[-8,1,0]);
 const machine=f.document.addPrefab('hall','processor','catalogue:equipment.machine.injection-molder');patch(f,machine,'processor',{processTime:.1,setupTime:0,powered:true,running:true,delivery:'automatic',outputInterval:.1,withPanel:false,operationParametersJson:'{"targetWidth":0.45,"targetHeight":0.30,"targetDepth":0.20}'});f.document.setTransform(machine,{position:[0,1,0]});
 const belt=h.add(f,'conveyor',{length:2,width:1,speed:1.5,autoSpawn:false,withPanel:false,withSensors:false},[8,1,0]),receiver=h.add(f,'source',{initialCount:0,capacity:4,autoGenerate:false,delivery:'manual'},[14,1,0]);h.link(f,source,machine);h.link(f,machine,belt);h.link(f,belt,receiver);
 const before=await f.document.serialize();f.runtime.start('hall');const original=[...h.inventory(f,source).queue],firstObject=original[0].product.object;
 until(f,()=>h.inventory(f,receiver).queue.length===2,40);const received=h.inventory(f,receiver).queue;
 assert.deepEqual(new Set(received.map(x=>x.id)),new Set(original.map(x=>x.id)));assert.equal(received.find(x=>x.id===original[0].id).product.object,firstObject);
 const receiverRecord=h.record(f,receiver);
 for(const entry of received.slice()){const product=entry.product||f.runtime.sourceRuntime.materialize(receiverRecord),metadata=f.runtime.productMetadata(product),size=product.bounds.getSize(new h.THREE.Vector3());assert.equal(metadata.materialClass,'solid');assert.equal(metadata.catalogueEquipmentId,'equipment.product.discrete-part');assert.equal(metadata.mass,3);assert.equal(entry.units,1);assert.ok(Math.abs(size.x-.45)<.001);assert.ok(Math.abs(size.y-.30)<.001);assert.ok(Math.abs(size.z-.20)<.001);f.runtime.sourceRuntime.remove(receiverRecord,entry,'manual');const exit=product.object.matrixWorld.clone();exit.setPosition(new h.THREE.Vector3(-5,1,5+received.indexOf(entry)*2));f.runtime.setProductMatrix(product,exit);f.runtime.invalidateCollision(product.object);}
 f.runtime.stop();assert.deepEqual(await f.document.serialize(),before);
});

test('a processed authored product restores its original native geometry and resources when simulation stops',async()=>{
 const f=realSetup(),actor=f.document.addPrefab('hall','product','catalogue:equipment.product.metal-part');f.document.setTransform(actor,{position:[-4,0,0]});const originalChildren=actor.children.slice(),before=await f.document.serialize(),disposed=new Set();actor.traverse(node=>{if(node.geometry)node.geometry.addEventListener('dispose',()=>disposed.add(node.geometry));});
 f.runtime.start('hall');const product=f.runtime.products.get(actor),initialBounds=product.bounds.clone(),entry={id:'authored-load',originId:actor.userData.editorId,ownerId:'machine',units:1,product,spec:{id:'part',type:'cylinder',catalogueEquipmentId:'equipment.product.metal-part',width:.4,height:.3,depth:.5,mass:2,color:'#777777',base:'rigid'},load:{loadMode:'individual'}};
 require('../../modules/logistica-industrial/functions/equipamiento/schema/operationSpec.cjs').applyOperation({catalogueEquipmentId:'equipment.machine.cnc-lathe',operationParametersJson:'{"targetWidth":0.25,"targetHeight":0.20,"targetDepth":0.25}'},[entry]);
 assert.equal(f.runtime.sourceRuntime.refreshVisual(entry),true);assert.equal(product.object,actor);assert.notEqual(actor.children[0],originalChildren[0]);assert.ok(Math.abs(product.bounds.getSize(new h.THREE.Vector3()).x-.25)<.001);assert.equal(disposed.size,0);
 f.runtime.stop();assert.deepEqual(actor.children,originalChildren);assert.equal(disposed.size,0);assert.deepEqual(product.bounds,initialBounds);assert.deepEqual(await f.document.serialize(),before);
});

test('six new warehouse mechanisms fill and retrieve every configured seat with the same loads; cube forbids extracting underneath a bin',async()=>{
 for(const system of ['catalogue-pallet-shuttle','catalogue-automatic-pallet-shuttle','catalogue-pallet-asrs','catalogue-multilevel-shuttle','catalogue-cube','catalogue-carousel']){
  const defaults=h.behaviorSchema.warehouseRacks.defaults(system),count=h.behaviorSchema.warehouseRacks.layout(defaults).cells.length;
  const f=warehouse.fixture(system,Object.assign({},defaults,{rackMechanismSpeed:1}),{initialCount:count,capacity:count},{setup:realSetup}),api=f.runtime.palletQueueRuntime,before=await f.document.serialize(),entries=[];
  while(entries.length<count){f.catalogueStage=system+' store '+entries.length+'/'+count;let entry=warehouse.offer(f);if(entry){entries.push(entry);until(f,()=>!api.rackBusy(f.stock));}else{until(f,()=>!api.rackBusy(f.stock));entry=warehouse.offer(f);assert.ok(entry,system+' did not prepare an empty seat: '+f.stock.rack.status);entries.push(entry);until(f,()=>!api.rackBusy(f.stock));}}
  assert.equal(f.stock.items.length,count,system);assert.equal(new Set(entries.map(x=>x.product.object)).size,count);
  if(system==='catalogue-cube')assert.equal(api.rackRequestRetrieval(f.rackRecord,0),false,'The top load must be removed before a lower cube container.');
  if(system==='catalogue-pallet-shuttle'){const rear=f.stock.items.find(item=>api.rackCell(f.stock,item.palletIndex).depthIndex===1);assert.equal(api.rackRequestRetrieval(f.rackRecord,rear.palletIndex),false,'A front pallet must be removed before a deeper LIFO pallet.');}
  const ordered=f.stock.items.slice().sort((a,b)=>api.rackCell(f.stock,b.palletIndex).level-api.rackCell(f.stock,a.palletIndex).level||api.rackCell(f.stock,a.palletIndex).depthIndex-api.rackCell(f.stock,b.palletIndex).depthIndex);
  for(const item of ordered){const identity=item.product.object,units=item.product.sourceEntry.units,slot=item.palletIndex;f.catalogueStage=system+' retrieve '+slot;assert.equal(api.rackRequestRetrieval(f.rackRecord,slot),true,system+' retrieval request '+slot);until(f,()=>!api.rackBusy(f.stock));assert.equal(f.stock.rack.presentedSlot,slot,system);assert.equal(item.product.object,identity);assert.equal(item.product.sourceEntry.units,units);assert.equal(api.canPickup(item.product),true);api.picked(item.product);assert.ok(!f.stock.items.includes(item));const removed=item.product.object.matrixWorld.clone();removed.setPosition(new h.THREE.Vector3(-8,1,5+slot*2));f.runtime.setProductMatrix(item.product,removed);f.runtime.invalidateCollision(item.product.object);}
  assert.equal(f.stock.items.length,0);f.runtime.stop();assert.deepEqual(await f.document.serialize(),before,system+' stop restoration');
 }
});
