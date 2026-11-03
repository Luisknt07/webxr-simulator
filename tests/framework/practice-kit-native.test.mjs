import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')(),handDriver=require('../support/practice-hand-driver.cjs'),ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('SF-02 forms and delivers three physical 4/4/16 kits through hand input and timed native cycles before all six stages unlock',()=>{
 const f=native.fixture();let hands,workflow;
 try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall','SF-02',{mode:'manual',scene:f.scene});f.runtime.start('hall');native.advance(f,.1);
  workflow=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest);hands=handDriver(native,f);
  const initial=workflow.snapshot();assert.deepEqual(initial.criticalReasons,[]);assert.deepEqual(initial.stageEvidence,[]);assert.equal(f.runtime.products.size,9);assert.equal(initial.totalUnits,3);
  assert.throws(()=>workflow.command('bom-close',{quantity:3}),/faltan/);
  workflow.command('bom-order',{orderId:built.manifest.materialRecipe.orderId,quantity:3});workflow.command('bom-prepare',{method:'kit-4-4-16'});
  const machine=workflow.alias('E03'),outputs=[];
  for(let group=1;group<=3;group++){
   for(const material of ['BODY','LID','SCREW']){
    const stock=built.manifest.materialRecipe.stock.find(row=>row.sku==='SF-02-'+material+'-'+group);assert(stock);
    const product=workflow.product(stock.objectId);assert(product);
    hands.toProcessor(product,machine);workflow.update();assert.deepEqual(workflow.snapshot().criticalReasons,[]);
   }
   const before=machine.components.processor.completed;workflow.command('bom-cycle',{station:'E03'});hands.advance(5);workflow.update();
   assert.equal(machine.components.processor.completed,before+1);assert.equal(machine.components.processor.output.queue.length,1,'Exactly one physical kit is formed from this group.');
   assert(f.runtime.command(machine.id,'stop'),'The manual operator stops the native station before loading the next batch.');
   const entry=machine.components.processor.output.queue[0],row=workflow.operations.outputs(workflow.observe()).find(row=>row.id===entry.id);assert(row);assert.equal(entry.units,1);assert.deepEqual(row.materials,{body:4,lid:4,screw:16});assert.equal(row.quantity,1);
   workflow.command('bom-inspect',{loadId:entry.id,quantity:1,condition:'conforme'});
   const destination=f.runtime.records.get(built.receiverIds[group-1]);hands.toQueue(entry.product,destination);workflow.update();outputs.push(entry);
   assert.equal(entry.ownerId,destination.id);assert.equal(destination.components.palletQueue.queue.length,1);assert.deepEqual(workflow.snapshot().criticalReasons,[]);
  }
  assert.throws(()=>workflow.command('bom-close',{quantity:3}),/faltan/,'A form cannot substitute for readiness of the actual consumption station.');
  workflow.command('bom-secure',{ready:'util-receta-y-entradas-verificadas'});workflow.command('bom-close',{quantity:3});
  const result=workflow.snapshot(),leaves=outputs.flatMap(entry=>f.runtime.processorRuntime.leaves([entry])),unitIds=leaves.flatMap(leaf=>leaf.materialUnitIds||[]),expectedIds=built.manifest.materialRecipe.stock.flatMap(row=>row.unitIds);
  assert.deepEqual(result.criticalReasons,[]);assert.equal(result.destinationConfirmed,true);assert.equal(result.finalizedUnits,3);assert.equal(result.processedUnits,3);assert.equal(result.totalUnits,3);assert.equal(result.sourceUnits,0);assert.deepEqual(result.stageEvidence.map(row=>row.guard),['identify','prepare','operate','inspect','deliver','close']);
  assert.deepEqual(result.materialBalance.actual,{body:12,lid:12,screw:48});assert.deepEqual([...unitIds].sort(),[...expectedIds].sort());assert.equal(new Set(unitIds).size,72);assert.equal(f.runtime.products.size,3);assert.equal(f.runtime.held.size,0);
  fs.mkdirSync(path.join(ROOT,'data/qa-studio/practice-facilities'),{recursive:true});fs.writeFileSync(path.join(ROOT,'data/qa-studio/practice-facilities/sf02-native-kits.json'),JSON.stringify({passed:true,practiceId:'SF-02',mode:'manual',controllerFrames:hands.frames,simulatedSeconds:f.runtime.time,outputs:outputs.map(entry=>({id:entry.id,ownerId:entry.ownerId,units:entry.units,mass:entry.spec.mass,history:entry.spec.operationHistory})),snapshot:result},null,2));
 }finally{if(hands)hands.dispose();if(workflow)workflow.dispose();f.runtime.stop();native.releaseGeometry(f);}
});
