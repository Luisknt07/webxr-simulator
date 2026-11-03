import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')();

test('SF04 assembles twelve units from the original BOM, tests each actual body and delivers all twelve using native hand custody',()=>{
 const f=native.fixture();let workflow;
 try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall','SF-04',{mode:'manual',caseId:'A',scene:f.scene});f.scene.updateMatrixWorld(true);f.runtime.start('hall');native.advance(f,.1);
  workflow=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest);
  const driver=require('../support/practice-hand-driver.cjs')(native,f),machine=workflow.alias('E02'),tester=workflow.alias('E03'),initial=workflow.observe();
  assert.deepEqual(initial.criticalReasons,[]);assert.throws(()=>workflow.command('bom-close',{quantity:12}));
  workflow.command('bom-order',{orderId:built.manifest.materialRecipe.orderId,quantity:12});workflow.command('bom-prepare',{method:'ensamble-1-1-4'});
  for(const stock of built.manifest.materialRecipe.stock)driver.toProcessor(workflow.product(stock.objectId),machine);
  assert.equal(machine.components.processor.input.queue.length,3);assert.equal(machine.components.processor.output.queue.length,0);
  workflow.command('bom-cycle',{station:'E02'});native.advance(f,8);workflow.update();
  assert.equal(machine.components.processor.output.queue.length,12);assert.deepEqual(workflow.observe().criticalReasons,[]);
  const identityIds=[];
  for(let index=0;index<12;index++){
   const entry=machine.components.processor.output.queue[0];assert(entry&&entry.product);identityIds.push(entry.id);
   driver.toProcessor(entry.product,tester);workflow.command('bom-cycle',{station:'E03'});native.advance(f,4.5);workflow.update();
   const output=tester.components.processor.output.queue[0];assert(output);assert.equal(output.id,entry.id,'The test cannot replace the actual assembled unit.');assert.equal(output.spec.operationState.testResult,'pass');
   const destination=f.runtime.records.get(built.receiverIds[Math.floor(index/4)]);driver.toQueue(output.product,destination);
   workflow.command('bom-inspect',{loadId:output.id,quantity:1,condition:'conforme'});assert.deepEqual(workflow.observe().criticalReasons,[]);
  }
  workflow.command('bom-close',{quantity:12});const final=workflow.snapshot();assert.equal(final.receiverUnits,12);assert.equal(final.stageEvidence.length,6);assert.equal(new Set(identityIds).size,12);assert.deepEqual(workflow.observe().quantities,{body:12,lid:12,screw:48});
  const Session=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs').PracticeSession,session=new Session(Object.assign({},built.manifest,{evidenceAdapter:{kind:'workflow',requirements:built.manifest.stageBindings}}),{snapshot:()=>workflow.snapshot()});for(const guard of ['identify','prepare','operate','inspect','deliver','close'])assert(session.act(guard).accepted);assert(session.state().passed);
  fs.mkdirSync(new URL('../../data/qa-studio/practice-facilities/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../../data/qa-studio/practice-facilities/assembly-native.json',import.meta.url),JSON.stringify({practice:'SF-04',mode:'manual',caseId:'A',identityIds,simulationSeconds:f.runtime.time,receiverUnits:final.receiverUnits,evidence:final.stageEvidence,materialBalance:final.materialBalance,nativeControllerFrames:driver.frames},null,2));
 }finally{if(workflow)workflow.dispose();native.releaseGeometry(f);}
});
