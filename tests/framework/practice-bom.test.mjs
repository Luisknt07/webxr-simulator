import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),bom=require('../../modules/logistica-industrial/practices/configurable/schema/PracticeBOM.cjs'),conversion=require('../../modules/logistica-industrial/functions/procesamiento/schema/materialConversion.cjs');
const mass={body:2,lid:.2,screw:.03,finished:2.32,carton:.15,label:.001};
function fixture(id){
 const definition=bom.definition(id),stock=[],entries=[];
 for(const [material,perUnit]of Object.entries(definition.inputs)){
  const quantity=perUnit*definition.batch,sku=id+'-'+material;
  stock.push({sku,material,quantity,unitIds:Array.from({length:quantity},(_,n)=>sku+'-'+(n+1))});
  entries.push({id:'source-'+sku,originId:'owner-'+sku,ownerId:'machine',units:quantity,lineage:['owner-'+sku],spec:{id:sku,mass:mass[material],width:.3,height:.2,depth:.3},load:{loadMode:'individual'},product:null});
 }return{stock,entries};
}

test('four BOM recipes form actual handling units while conserving every component identity and declared mass',()=>{
 for(const id of Object.keys(bom.DEFINITIONS)){
  const f=fixture(id),before=JSON.stringify(f),outputs=bom.prepare(id,f.entries,f.stock),balance=conversion.validate(f.entries,outputs);
  assert.equal(outputs.length,bom.definition(id).batch);assert(outputs.every(entry=>entry.units===1));
  assert(balance.inputHandlingUnits>balance.outputHandlingUnits,'Different SKU unit counts must not be silently added as if cartons were screws.');
  assert(Math.abs(balance.inputMassKg-balance.outputMassKg)<1e-7);
  const materialIds=outputs.flatMap(entry=>entry.members.flatMap(leaf=>leaf.materialUnitIds));
  assert.equal(new Set(materialIds).size,materialIds.length);assert.deepEqual([...materialIds].sort(),f.stock.flatMap(row=>row.unitIds).sort());
  assert.equal(JSON.stringify(f),before,'Preparing a recipe cannot consume stock or alter ownership.');
  assert(!bom.accepts(id,outputs,f.stock),'A finished unit cannot be fabricated again using the same component genealogy.');
 }
});

test('wrong, missing, duplicate or excess BOM references fail before any inventory mutation',()=>{
 const f=fixture('SF-04'),before=JSON.stringify(f);
 assert(!bom.accepts('SF-04',[f.entries[0],f.entries[0]],f.stock));
 assert.throws(()=>bom.prepare('SF-04',f.entries.slice(0,2),f.stock),/BOM/);
 const foreign={...f.entries[2],spec:{...f.entries[2].spec,id:'FOREIGN'}};
 assert.throws(()=>bom.prepare('SF-04',[...f.entries.slice(0,2),foreign],f.stock),/ajenas/);
 const outputs=bom.prepare('SF-04',f.entries,f.stock),removed=structuredClone(outputs);removed[0].members.pop();assert.throws(()=>conversion.validate(f.entries,removed),/conserva/);
 const wrongMass=structuredClone(outputs);wrongMass[0].spec.mass*=2;assert.throws(()=>conversion.validate(f.entries,wrongMass),/masa/);
 assert.equal(JSON.stringify(f),before);
 const cyclic={id:'cycle',members:[]};cyclic.members.push(cyclic);assert.throws(()=>conversion.leaves([cyclic]),/cíclica/);
 let deep={id:'leaf'};for(let i=0;i<18;i++)deep={id:'node-'+i,members:[deep]};assert.throws(()=>conversion.leaves([deep]),/límite/);
});

test('CEDI packaging restores each actual SKU/lot/colour and individual mass from a mixed four-carton source without changing source custody',()=>{
 const f=fixture('CEDI-04'),source=f.stock.find(row=>row.material==='finished'),input=f.entries.find(row=>row.spec.id===source.sku),masses=[2,3,5,2];
 source.cediLoad={boxes:masses.map((unitMassKg,index)=>({boxId:'BOX-'+(index+1),sku:'SKU-'+String.fromCharCode(65+index),lotId:'LOT-001',unitMassKg,width:.3,height:index===3?.26:.2,depth:.25,color:['#bc945e','#2255aa','#99bb77','#bf905a'][index]}))};input.spec.mass=masses.reduce((a,b)=>a+b,0)/4;
 const before=JSON.stringify(f),outputs=bom.prepare('CEDI-04',f.entries,f.stock),balance=conversion.validate(f.entries,outputs);
 assert(outputs.every((row,index)=>Math.abs(row.spec.mass-masses[index]-.151)<1e-10));assert.deepEqual(outputs.map(row=>row.spec.operationState.productSku),['SKU-A','SKU-B','SKU-C','SKU-D']);assert.deepEqual(outputs.map(row=>row.spec.operationState.boxId),['BOX-1','BOX-2','BOX-3','BOX-4']);assert(outputs.every(row=>row.spec.operationState.lotId==='LOT-001'));assert.deepEqual(outputs.map(row=>row.spec.color),source.cediLoad.boxes.map(row=>row.color));assert.equal(outputs[3].spec.height,.28);assert(Math.abs(balance.inputMassKg-balance.outputMassKg)<1e-10);assert.equal(JSON.stringify(f),before);
 const oversized=structuredClone(f);oversized.stock[0].cediLoad.boxes[0].width=.4;assert.throws(()=>bom.prepare('CEDI-04',oversized.entries,oversized.stock),/formato|patrón|celdas/);
 const inconsistent=structuredClone(f);inconsistent.stock[0].cediLoad.boxes[0].unitMassKg=4;assert.throws(()=>bom.prepare('CEDI-04',inconsistent.entries,inconsistent.stock),/masa/);
});

test('native timed processing applies the converter only after its cycle; pause and adapter cleanup retain normal lifecycle',()=>{
 const h=require('../legacy/test-processor-runtime.js'),f=h.setup(),object=h.add(f,'processor',{mode:'combiner',combineCount:3,capacity:3,outputCapacity:12,requiresOperator:false,setupTime:0,processTime:.3,running:true});
 f.runtime.start('hall');
 try{
  const record=h.record(f,object),processor=record.components.processor,seed=fixture('SF-04');
  for(const entry of seed.entries){entry.ownerId=record.id;processor.input.queue.push(entry);f.runtime.sourceRuntime.entries.add(entry);}
  const unbind=f.runtime.processorRuntime.registerMaterialAdapter(record.id,{accepts:entries=>bom.accepts('SF-04',entries,seed.stock),prepare:entries=>bom.prepare('SF-04',entries,seed.stock)});
  h.advance(f,.1);assert.equal(processor.jobs.length,1);assert.equal(processor.output.queue.length,0);
  f.runtime.command(record.id,'pause');h.advance(f,.6);assert.equal(processor.output.queue.length,0,'Pausing cannot complete a timed BOM operation.');
  f.runtime.command(record.id,'pause');h.advance(f,.3);
  assert.equal(processor.output.queue.length,12);assert(processor.output.queue.every(entry=>entry.units===1));assert.equal(processor.completed,1);
  const leaves=f.runtime.processorRuntime.leaves(processor.output.queue);assert.equal(leaves.reduce((sum,entry)=>sum+entry.units,0),72);
  assert.equal(f.runtime.sourceRuntime.entries.size,12,'Original entries are consumed once and only the real output entries remain active.');
  unbind();assert.equal(f.runtime.processorRuntime.materialAdapters.size,0);
 }finally{f.runtime.stop();}
});

test('a stopped native input can be removed with the hand without retaining duplicate queue custody',()=>{
 const h=require('../legacy/test-processor-runtime.js'),f=h.setup(),object=h.add(f,'processor',{running:false,requiresOperator:true}),source=h.add(f,'source',{autoGenerate:false,initialCount:1});
 f.runtime.start('hall');
 try{
  const record=h.record(f,object),entry=h.inventory(f,source).queue[0],product=entry.product,hand=new h.THREE.Group();f.scene.add(hand);
  assert(f.runtime.pickupProduct(product,hand));
  f.runtime.setProductMatrix(product,f.runtime.sourceRuntime.frontMatrix(record,product.bounds,product.scale,record.components.processor.input.position));
  assert(f.runtime.releaseProduct(product));assert.equal(record.components.processor.input.queue.length,1);
  assert(f.runtime.pickupProduct(product,hand));assert.equal(record.components.processor.input.queue.length,0);assert.equal(product.heldBy,hand);assert.equal(product.processorOwnerId,'');
 }finally{f.runtime.stop();}
});
