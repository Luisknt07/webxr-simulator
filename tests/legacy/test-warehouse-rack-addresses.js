'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const racks=require('../../modules/logistica-industrial/functions/almacenamiento/schema/warehouseRacks');
const {fixture,offer,settle,THREE,h,stock}=require('./test-warehouse-rack-runtime');
const source=file=>fs.readFileSync(path.join(__dirname,'../..',file),'utf8').replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const prefabs=new Function('THREE','behaviorSchema','require',source('modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js')+'\nreturn {createProductVisual,createSourceProductVisual};')(THREE,h.behaviorSchema,require('../support/load-robot-prefabs')(THREE).resolve);
const checkpoint=new Function('THREE','createProductVisual','createSourceProductVisual',source('modules/logistica-industrial/runtime/SimulationCheckpoint.js')+'\nreturn {captureSimulation,restoreSimulation};')(THREE,prefabs.createProductVisual,prefabs.createSourceProductVisual);

function labels(product){const values=[];product.object.traverse(node=>{if(node.userData.warehouseLocationLabel)values.push(node.userData.warehouseLocationLabel);});return values;}
function sourceProduct(f){return f.runtime.sourceRuntime.materialize(f.sourceRecord);}
function schemaChecks(){
  const config=racks.normalize({...racks.defaults('selective'),rackBayWidths:'2.5, 4',rackAisleCode:' a07 ',rackRowCode:' r12 ',withPanel:true}),layout=racks.layout(config);
  assert.equal(config.withPanel,false);assert.equal(config.rackAisleCode,'A07');assert.equal(config.rackRowCode,'R12');assert.deepEqual(layout.bayWidths,[2.5,4]);assert.deepEqual(layout.bayCenters,[-2,1.25]);assert.equal(layout.storageLength,6.5);
  assert.equal(new Set(layout.cells.map(c=>c.code)).size,layout.cells.length);assert(layout.cells.every(c=>c.code.startsWith('A07-R12-B01-M')));
  assert(layout.cells.find(c=>c.bay===0).width<layout.cells.find(c=>c.bay===1).width);
  const code=layout.cells[0].code,plan=racks.normalize({...config,rackAssignments:JSON.stringify([{locationCode:code,palletId:'pallet-001'}])});
  assert.deepEqual(racks.assignments(plan),[{locationCode:code,palletId:'pallet-001'}]);assert.deepEqual(racks.normalize(plan),plan);
  for(const change of [{rackBayWidths:'3'},{rackBayWidths:'3,NaN'},{rackBayWidths:'3,0.2'},{rackAisleCode:'../A'},{rackRowCode:'R\n01'},{rackAssignments:'{}'},{rackAssignments:JSON.stringify([{locationCode:code,palletId:'<script>'}])},{rackAssignments:JSON.stringify([{locationCode:code,palletId:'pallet-001'},{locationCode:code,palletId:'pallet-002'}])},{rackAssignments:JSON.stringify([{locationCode:code,palletId:'pallet-001'},{locationCode:layout.cells[1].code,palletId:'pallet-001'}])}])assert.throws(()=>racks.normalize({...config,...change}));
  assert.throws(()=>racks.normalize({...plan,rackLevels:1,rackBays:1,rackBayWidths:'4',rackAssignments:JSON.stringify([{locationCode:layout.cells.find(c=>c.bay===1).code,palletId:'pallet-001'}])}),/ubicación/);
}

async function run(){
  schemaChecks();
  const f=fixture('selective',{rackColumns:2,rackBayWidth:3,rackAisleCode:'A02',rackRowCode:'R03'},{},{beforeStart(f){f.extra=stock.addQueue(f,{...racks.defaults('selective'),rackBays:1,rackColumns:1,rackLevels:1,rackAisleCode:'A02',rackRowCode:'R04',withPanel:false},[10,1,0]);}}),api=f.runtime.palletQueueRuntime;
  const product=sourceProduct(f),entry=product.sourceEntry,id=api.palletIdentity(product),cells=f.stock.rack.layout.cells;
  assert.equal(id,entry.id);assert.notEqual(id,f.runtime.productMetadata(product).sku);
  assert(api.assignLocation(f.rackRecord,{locationCode:cells[1].code,palletId:id}));
  const extra=f.runtime.records.get(f.extra.userData.editorId),extraCode=extra.components.palletQueue.rack.layout.cells[0].code;
  assert.throws(()=>api.assignLocation(extra,{locationCode:extraCode,palletId:id}),/otra estantería/,'A physical pallet cannot have two simultaneous reserved destinations.');
  assert.equal(api.rackPlacement(extra,product),null,'Another rack cannot accept a pallet reserved elsewhere.');
  const row=api.locations(f.rackRecord)[1];assert.equal(row.status,'reserved');assert.equal(row.assignedPalletId,id);assert.equal(row.palletId,'');
  const place=api.placement(f.rackRecord,product);assert.equal(place.palletIndex,1);assert.equal(place.locationCode,cells[1].code);
  const wrong={...place,palletIndex:0};assert.equal(api.receive(f.rackRecord,entry,true,wrong),false,'A caller cannot bypass a reserved destination by supplying a different seat.');assert.equal(f.stock.items.length,0);assert.equal(entry.ownerId,f.sourceRecord.id);
  assert(f.runtime.sourceRuntime.remove(f.sourceRecord,entry,'address-test'));assert(api.receive(f.rackRecord,entry,true,place));
  assert.equal(f.stock.queue[0],entry);assert.equal(api.locations(f.rackRecord)[1].palletId,id);assert.equal(api.locations(f.rackRecord)[1].status,'occupied');
  assert.equal(product.object.userData.sourcePalletId,id);assert.equal(product.object.userData.sourceRackLocationCode,cells[1].code);
  assert(labels(product).some(label=>label.includes(id)));assert(labels(product).some(label=>label.includes(cells[1].code)));
  assert.equal(f.stock.rack.assignments.length,0,'A fulfilled reservation becomes actual occupancy, rather than leaving an empty reserved seat behind a moving pallet.');
  assert(api.assignLocation(f.rackRecord,{locationCode:cells[0].code,palletId:id}));
  assert.equal(product.object.userData.sourceRackLocationCode,cells[1].code,'A new destination does not move the current load.');
  assert(labels(product).includes('A '+cells[0].code),'The physical tag shows a pending destination while the pallet waits for pickup.');
  assert(api.clearLocationAssignment(f.rackRecord,cells[0].code));assert(labels(product).includes('EN '+cells[1].code));
  const next=sourceProduct(f),nextId=api.palletIdentity(next);
  assert.throws(()=>api.assignLocation(f.rackRecord,{locationCode:cells[1].code,palletId:nextId}),/ocupada/);
  assert(api.assignLocation(f.rackRecord,{locationCode:cells[0].code,palletId:nextId}));
  const stateCode=api.locations(f.rackRecord)[0].code;
  const saved=JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime)));
  checkpoint.restoreSimulation(f.runtime,saved);
  const restored=f.runtime.records.get(f.rackRecord.id),store=restored.components.palletQueue,stored=store.queue[0].product;
  assert.equal(api.locations(restored)[0].assignedPalletId,nextId);assert.equal(api.locations(restored)[0].status,'reserved');
  assert.equal(api.locations(restored)[1].palletId,id);assert.equal(stored.object.userData.sourceRackLocationCode,cells[1].code);assert(labels(stored).some(label=>label.includes(id)));
  assert(api.clearLocationAssignment(restored,stateCode));assert.equal(api.locations(restored)[0].status,'free');
  assert.equal(api.clearLocationAssignment(restored,stateCode),false);
  const entryAfter=store.queue[0];assert(f.runtime.sourceRuntime.remove(restored,entryAfter,'manual',store.inventory));api.removeItem(store,stored);
  assert.equal(stored.object.userData.sourceRackLocationCode,undefined);assert.equal(stored.object.userData.sourceRackLastLocationCode,cells[1].code);assert.equal(api.locations(restored)[1].status,'free');
  const removedState=JSON.parse(JSON.stringify(checkpoint.captureSimulation(f.runtime)));
  stored.object.userData.sourceRackLocationCode=cells[1].code;stored.object.userData.sourceRackLocationOwner=restored.id;stored.object.userData.sourceRackDestinationCode='STALE';
  checkpoint.restoreSimulation(f.runtime,removedState,{reuse:true});
  assert.equal(stored.object.userData.sourceRackLocationCode,undefined,'A shared/resumed pallet cannot resurrect an absent current address.');
  assert.equal(stored.object.userData.sourceRackLocationOwner,undefined);assert.equal(stored.object.userData.sourceRackDestinationCode,'');
  assert.equal(stored.object.userData.sourceRackLastLocationCode,cells[1].code);assert(labels(stored).includes('DE '+cells[1].code));assert(!labels(stored).some(label=>label.startsWith('EN ')));
  f.runtime.stop();assert.equal(api.identificationLabels.size,0);

  const dynamic=fixture('pallet-flow',{rackDepthSlots:2,rackLevels:1,rackAisleCode:'A03',rackRowCode:'R01'}),dynamicApi=dynamic.runtime.palletQueueRuntime,e=offer(dynamic);assert(e);settle(dynamic,20);
  const current=dynamic.stock.rack.layout.cells[e.product.item.palletIndex];assert.equal(current.depthIndex,0);assert.equal(e.product.object.userData.sourceRackLocationCode,current.code);assert.equal(dynamicApi.locations(dynamic.rackRecord).find(row=>row.palletId===e.id).code,current.code);dynamic.runtime.stop();

  // A legacy belt can create a physical unit before it has an inventory entry.
  // Assigning that unit must survive the later real entryForProduct handoff.
  const legacy=fixture('medium-duty',{rackColumns:2,rackAisleCode:'A08',rackRowCode:'R01'},{},{beforeStart(f){f.belt=h.add(f,'conveyor',{powered:true,running:true,autoSpawn:false,withPanel:false,withPallet:false,speed:0},[20,1,0]);}}),legacyApi=legacy.runtime.palletQueueRuntime,
    beltRecord=legacy.runtime.records.get(legacy.belt.userData.editorId),belt=beltRecord.components.conveyor;
  assert(legacy.runtime.spawn(beltRecord,belt));const legacyItem=belt.packages[0],unit=legacyItem.product,unitMesh=unit.object;
  assert(!unit.sourceEntry);const unitId=legacyApi.palletIdentity(unit),targetCode=legacy.stock.rack.layout.cells[0].code;
  assert(unitId.startsWith('load:'));assert(legacyApi.assignLocation(legacy.rackRecord,{locationCode:targetCode,palletId:unitId}));
  const custody=legacy.runtime.sourceRuntime.entryForProduct(beltRecord,unit);assert.notEqual(custody.id,unitId);
  assert.equal(legacyApi.palletIdentity(unit),unitId,'Creating custody must never replace an assigned physical unit ID.');
  assert.equal(legacyApi.plannedLocation(unitId).locationCode,targetCode);
  const seat=legacyApi.placement(legacy.rackRecord,unit);assert(seat);assert.equal(seat.locationCode,targetCode);assert.equal(seat.palletIndex,0);
  legacy.runtime.sourceRuntime.receiveBelt({record:beltRecord,item:legacyItem,target:legacy.rackRecord,placement:seat});belt.packages=belt.packages.filter(item=>item!==legacyItem);legacy.runtime.packageCount--;
  assert.equal(legacy.stock.queue[0],custody);assert.equal(custody.product.object,unitMesh);assert.equal(legacyApi.locations(legacy.rackRecord)[0].palletId,unitId);assert.equal(unit.object.userData.sourceRackLocationCode,targetCode);assert(labels(unit).includes(unitId));
  const legacyState=JSON.parse(JSON.stringify(checkpoint.captureSimulation(legacy.runtime)));checkpoint.restoreSimulation(legacy.runtime,legacyState);
  const restoredLegacy=legacy.runtime.records.get(legacy.rackRecord.id),restoredUnit=restoredLegacy.components.palletQueue.queue[0].product;
  assert.equal(legacyApi.palletIdentity(restoredUnit),unitId);assert.equal(legacyApi.locations(restoredLegacy)[0].palletId,unitId);
  const authored={object:new THREE.Group(),record:{id:'custom-authored-pallet'},sourceEntry:{id:'new-custody'}};authored.object.userData.sourcePalletId='old-tag';assert.equal(legacyApi.palletIdentity(authored),'custom-authored-pallet');legacy.runtime.stop();
  console.log('Warehouse rack addressing: variable bay widths, safe unique addresses, explicit pallet reservation, mismatched-seat rejection, same-entry receipt, physical matching tags, fulfilled reservation, checkpoint and pickup/moving-lane updates passed.');
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run,schemaChecks};
