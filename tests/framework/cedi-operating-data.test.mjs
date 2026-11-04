import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const data=require('../../modules/logistica-industrial/practices/configurable/CediOperatingData.cjs');
const recipes=require('../../modules/logistica-industrial/practices/configurable/Recipes.cjs');
const schema=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const ids=Array.from({length:5},(_,index)=>'CEDI-0'+(index+1));
const unique=rows=>new Set(rows.map(row=>row.boxId));
const config=settings=>({practiceId:'CEDI-01',mode:'manual',caseId:'A',difficulty:1,roomId:'hall',sourceId:'source',processIds:[],receiverId:'receiver',expectedUnits:48,sku:'CEDI-01-ORDER',steps:recipes.plan('CEDI-01').steps,settings});

test('editable reserve locations exactly match native row/bank/module/level addresses',()=>{
 const racks=require('../../modules/logistica-industrial/contracts/behaviors').warehouseRacks;
 const codes=['R03','R04'].flatMap(rackRowCode=>racks.layout({rackSystem:'selective',rackAisleCode:'A01',rackRowCode,rackBays:4,rackLevels:2,rackColumns:1,rackBayWidths:'2,2,2,2',rackSlotDepth:1.1,rackLevelHeight:1.05}).cells.map(cell=>cell.code));assert.deepEqual(data.LOCATION_CODES,codes);assert.equal(new Set(codes).size,16);assert.deepEqual(data.defaults().inventory.map(row=>row.locationCode),[codes[0],codes[2],codes[4]]);
});

test('all five CEDI stages share one deterministic operating book and conserve actual box identities',()=>{
 const book=data.normalize(data.defaults()),plans=ids.map(id=>recipes.plan(id));
 for(const plan of plans){assert.deepEqual(plan.cediData,book);assert.deepEqual(plan.operatingData.data,book);assert.equal(plan.operatingData.datasetId,'CEDI-COMMON-01');assert.equal(plan.availability.ready,true);}
 const first=plans[0].operatingData;
 assert.equal(first.inboundBoxes.length,48);assert.equal(unique(first.inboundBoxes).size,48);
 assert.equal(first.inboundPallets.length,6);assert(first.inboundPallets.every(p=>p.quantity===8&&p.boxes.length===8&&p.massKg===60&&new Set(p.boxes.map(b=>b.sku)).size===1));
 const inventory=first.inventoryLocations.flatMap(row=>row.boxes),picked=first.orders.flatMap(row=>row.boxes),outbound=first.outboundPallets.flatMap(row=>row.boxes);
 assert.equal(inventory.length,24);assert.equal(unique(inventory).size,24);assert.equal(picked.length,12);assert.equal(unique(picked).size,12);assert.equal(outbound.length,12);assert.equal(unique(outbound).size,12);
 for(const box of inventory)assert(unique(first.inboundBoxes).has(box.boxId));
 for(const box of picked)assert(unique(inventory).has(box.boxId));
 assert.deepEqual([...unique(outbound)].sort(),[...unique(picked)].sort());
 assert.equal(first.inventoryBundles.length,6);assert(first.inventoryBundles.every(row=>row.quantity===4&&row.boxIds.length===4));
 assert(first.orders.every(row=>row.quantity===4&&row.boxIds.length===4));
 assert(first.outboundPallets.every(row=>row.quantity===6&&row.massKg===50));
 assert.deepEqual(plans.map(p=>p.operatingData.stage.initialUnits),[48,48,24,12,12]);
 assert.deepEqual(plans.map(p=>p.operatingData.stage.expectedUnits),[48,48,12,12,12]);
 assert.deepEqual(plans.map(p=>p.operatingData.stage.sourcePallets.length),[6,6,0,0,2]);
 assert.equal(plans[2].operatingData.stage.sourceBundles.length,6);assert.equal(plans[3].operatingData.stage.sourceBoxes.length,12);
 assert.deepEqual(plans.map(p=>p.operatingData.inboundBoxes),Array(5).fill(first.inboundBoxes));
 assert.equal(first.summary.site.width,64);assert.equal(first.summary.site.depth,60);assert.equal(first.summary.site.areaM2,3840);assert.deepEqual(first.summary.site.annexes.map(row=>[row.id,row.footprintM2,row.floors,row.floorAreaM2]),[['administration',209,2,418],['maintenance',132,1,132]]);assert.equal(first.summary.capacity.requiredPalletPositions,9);assert.equal(first.summary.capacity.freeAfterReceiving,3);
});

test('editable profiles propagate their real lot, dimensions, colour and mass into the bounded physical seed',()=>{
 const input=data.defaults();input.name='Operación regional mixta';input.products[0].unitMassKg=2;input.products[1].unitMassKg=3;input.products[2].unitMassKg=2;input.products[1].handling='fragile';input.products[1].color='#1144aa';input.products[1].width=.28;input.inboundOrders[0].lotId='LOTE-2026-A';
 const manifest=data.manifest(input,'CEDI-01');
 assert.deepEqual(manifest.inboundPallets.map(row=>row.massKg),[36,36,36,44,44,36]);
 for(const pallet of manifest.inboundPallets)assert.equal(pallet.massKg,pallet.palletTareKg+pallet.boxes.reduce((sum,box)=>sum+box.unitMassKg,0));
 for(const pallet of manifest.outboundPallets)assert.equal(pallet.massKg,pallet.palletTareKg+pallet.boxes.reduce((sum,box)=>sum+box.unitMassKg,0));
 const b=manifest.inboundBoxes.find(row=>row.sku==='SKU-B');assert.equal(b.color,'#1144aa');assert.equal(b.width,.28);assert.equal(b.unitMassKg,3);assert.equal(b.lotId,'LOTE-2026-A');assert.equal(b.handling,'fragile');
 const plan=recipes.plan('CEDI-01',{cediData:input});assert.equal(plan.availability.ready,true,'A valid data book does not pretend that another automation or machine was verified.');assert.equal(plan.units,48);assert.equal(data.isDefault(input),false);
 assert.equal(data.validate(input).valid,true);
});

test('canonicalisation is order-independent, detached, idempotent and preserves a caller-defined SKU mix',()=>{
 const input=data.defaults(),permuted=clone(input);for(const key of ['products','suppliers','inboundOrders','inventory','outboundOrders'])permuted[key].reverse();for(const order of [...permuted.inboundOrders,...permuted.outboundOrders])order.lines.reverse();
 const first=data.normalize(input),second=data.normalize(permuted);assert.deepEqual(first,second);assert.deepEqual(data.normalize(first),first);assert(data.isDefault(second));
 const nativeCompare=String.prototype.localeCompare;try{String.prototype.localeCompare=()=>{throw Error('Device locale must not define stock identity.');};assert.deepEqual(data.normalize(permuted),first);assert.deepEqual(data.manifest(permuted).inboundBoxes,data.manifest(input).inboundBoxes);}finally{String.prototype.localeCompare=nativeCompare;}
 input.products[0].name='Changed outside';input.inventory[0].quantity=4;assert.notEqual(first.products[0].name,input.products[0].name);assert.equal(first.inventory[0].quantity,8);
 const next=data.defaults();next.inboundOrders[0].lines[0].quantity=16;next.inboundOrders[0].lines[1].quantity=16;
 const m=data.manifest(next,'CEDI-02');assert.equal(m.inboundBoxes.filter(row=>row.sku==='SKU-A').length,16);assert.equal(m.inboundBoxes.filter(row=>row.sku==='SKU-B').length,24);assert.equal(unique(m.inboundBoxes).size,48);
 m.products[0].name='Only this manifest';assert.notEqual(data.manifest(next).products[0].name,m.products[0].name);
});

test('unknown fields, executable-looking records, nonfinite numbers and unsupported product geometry are rejected',()=>{
 const mutations=[
  x=>x.script='alert(1)',x=>x.products[0].callback=()=>{},x=>x.products[0].name='<script>run()</script>',x=>x.products[0].color='red',x=>x.products[0].color='url(x)',
  x=>x.products[0].unitMassKg=Infinity,x=>x.products[0].unitMassKg=NaN,x=>x.products[0].unitMassKg=0,x=>x.products[0].unitMassKg=5.01,
  x=>x.products[0].width=10,x=>x.products[0].height=.01,x=>x.products[0].depth=.31,x=>x.products[0].abc='D',x=>x.products[0].handling='explosive',
  x=>x.products[0].sku='../../private',x=>x.products[0].name='x'.repeat(81),x=>x.suppliers[0].name='line\nbreak',x=>x.products=Array(7).fill(x.products[0]),
  x=>x.products[0]=new Date(),x=>x.products[0]=Object.assign(Object.create({inherited:true}),x.products[0]),x=>x.products[0]=null,
  x=>x.inboundOrders[0].lines[0].quantity='24',x=>x.capacities.palletPositions=16.1,x=>x.version=2,x=>x.datasetId='EXTERNAL',x=>x.name='界'.repeat(80)+'x'.repeat(12000)
 ];
 for(const change of mutations){const input=data.defaults();change(input);const result=data.validate(input);assert.equal(result.valid,false,change.toString());assert.equal(result.value,null);assert.equal(result.summary,null);assert.equal(result.errors.length,1);assert.equal(typeof result.errors[0].path,'string');assert.throws(()=>data.normalize(input));}
 assert.equal(data.validate(Object.create({})).valid,false);assert.equal(data.validate([]).valid,false);assert.equal(data.validate({}).valid,false);
 const polluted=JSON.parse(JSON.stringify(data.defaults()));Object.defineProperty(polluted.products[0],'__proto__',{value:{polluted:true},enumerable:true});assert.equal(data.validate(polluted).valid,false);assert.equal({}.polluted,undefined);
});

test('orders, physical quantities, native location capacity and cross-references cannot create missing stock',()=>{
 const mutations=[
  x=>x.inboundOrders[0].supplierId='UNKNOWN',x=>x.inboundOrders[0].lines[0].sku='UNKNOWN',x=>x.inboundOrders[0].lines.push(clone(x.inboundOrders[0].lines[0])),x=>x.inboundOrders.push(clone(x.inboundOrders[0])),
  x=>x.inboundOrders[0].lines[0].quantity=16,x=>x.inboundOrders[0].lines[0].quantity=23,x=>x.inventory[0].quantity=7,x=>x.inventory[0].quantity=4,
  x=>x.inventory[1].locationCode=x.inventory[0].locationCode,x=>x.inventory[0].locationCode='RACK-UNKNOWN',x=>x.inventory[0].locationCode=data.LOCATION_CODES[15],
  x=>x.capacities.palletPositions=8,x=>x.capacities.stagingPallets=5,x=>x.capacities.packingBufferBoxes=11,
  x=>x.outboundOrders.pop(),x=>x.outboundOrders[0].lines[0].quantity=3,x=>x.outboundOrders[1].id=x.outboundOrders[0].id,
  x=>{for(const order of x.outboundOrders)order.lines=[{sku:'SKU-C',quantity:4}];},
  x=>{x.inventory[0].sku='SKU-C';x.inventory[1].sku='SKU-C';}
 ];
 for(const change of mutations){const input=data.defaults();change(input);assert.equal(data.validate(input).valid,false,change.toString());}
 const input=data.defaults();input.inventory=input.inventory.flatMap((row,index)=>[{...row,quantity:4,locationCode:data.LOCATION_CODES[index*2]},{...row,quantity:4,locationCode:data.LOCATION_CODES[index*2+1]}]);input.capacities.palletPositions=12;
 const result=data.validate(input);assert.equal(result.valid,true,JSON.stringify(result.errors));assert.equal(result.summary.capacity.occupiedInventoryPositions,6);assert.equal(result.summary.capacity.freeAfterReceiving,0);
});

test('settings persist the canonical operating book and checkpoint identity rejects changed data without changing Smart Factory',()=>{
 const settings=recipes.normalizedOptions({cediData:data.defaults()}),normalized=schema.normalizeAttemptSettings(settings);assert.deepEqual(normalized.cediData,data.normalize(data.defaults()));assert.deepEqual(schema.normalizeAttemptSettings(normalized),normalized);
 const world={sourceUnits:48,processedUnits:0,receiverUnits:0,totalUnits:48,initialUnits:48,time:0};
 const session=new schema.PracticeSession(config(settings),{snapshot:()=>world}),checkpoint=session.serialize(),modified=clone(settings);modified.cediData.products[0].unitMassKg=2;
 assert.throws(()=>schema.PracticeSession.restore(config(modified),checkpoint,{snapshot:()=>world}),/another configuration/);
 const capacity=clone(settings);capacity.cediData.capacities.palletPositions=13;assert.throws(()=>schema.PracticeSession.restore(config(capacity),checkpoint,{snapshot:()=>world}),/another configuration/);
 assert.deepEqual(schema.PracticeSession.restore(config(settings),checkpoint,{snapshot:()=>world}).config.settings.cediData,settings.cediData);
 assert.equal(Object.hasOwn(recipes.plan('SF-01'),'cediData'),false);assert.equal(Object.hasOwn(recipes.plan('SF-01'),'operatingData'),false);assert.throws(()=>recipes.plan('SF-01',{cediData:data.defaults()}),/Smart Factory/);assert.throws(()=>data.manifest(data.defaults(),'SF-01'));
 assert.throws(()=>schema.normalizeAttemptSettings({practiceId:'SF-01',cediData:data.defaults()}));assert.throws(()=>schema.normalizeConfig({...config(settings),practiceId:'SF-01'}));
 const legacy=schema.normalizeAttemptSettings({mode:'manual',caseId:'A',difficulty:1});assert.equal(Object.hasOwn(legacy,'cediData'),false,'Do not silently rewrite previously stored attempt signatures.');
});

test('operator mode and difficulty guidance cannot claim unverified automation or award campaign progress',()=>{
 for(const id of ids)for(const mode of ['manual','semiautomatic','automatic'])for(const difficulty of [1,2,3]){
  const plan=recipes.plan(id,{mode,difficulty,cediData:data.defaults(),executionMode:'campaign'});assert.equal(plan.availability.ready,mode==='manual');assert.equal(plan.operatingGuide.mode.id,mode);assert.equal(plan.operatingGuide.difficulty.level,difficulty);assert.equal(plan.operatingGuide.execution.id,'campaign');assert.equal(plan.expectedUnits,id==='CEDI-01'||id==='CEDI-02'?48:12);
  if(mode!=='manual')assert(plan.operatingGuide.mode.system.includes('validado')||plan.operatingGuide.mode.system.includes('prueba fin a fin'));
 }
 assert(data.operationalGuide({executionMode:'isolated'}).execution.progression.includes('no desbloquea'));
 assert.throws(()=>data.operationalGuide({mode:'omniscient'}));assert.throws(()=>data.operationalGuide({difficulty:4}));
});
