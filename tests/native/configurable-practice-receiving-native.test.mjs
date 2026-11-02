import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('prepared CEDI-01 completes six original truck pallets, all six material stages and 48-box reconciliation using native manual controls', {timeout:1200000},()=>{
 const h=require('../support/load-practice-scenes.cjs')(),f=h.fixture();try{
  const built=h.buildConfigurablePracticeScene(f.document,'hall','CEDI-01',{scene:f.scene,mode:'manual'});f.runtime.start('hall');h.advance(f,.1);
  const initialIds=built.palletIds.slice(),run=require('../support/run-configurable-receiving.cjs')(h,f,built,progress=>console.log(JSON.stringify(progress)));
  assert.equal(run.world.sourceUnits,0);assert.equal(run.world.receiverUnits,48);assert.equal(run.world.totalUnits,48);assert.equal(run.world.materialBalance.actualPallets,6);assert.deepEqual(run.world.criticalReasons,[]);assert.equal(run.driving.contacts,0);
  assert.deepEqual(run.shipments.map(row=>row.palletId),initialIds);assert.equal(new Set(run.shipments.map(row=>row.destinationId)).size,6);assert(run.shipments.every(row=>row.units===8&&row.massKg===60));assert.deepEqual(run.world.stageEvidence.map(row=>row.guard),['identify','prepare','operate','inspect','deliver','close']);
  const Session=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs').PracticeSession,session=new Session(Object.assign({},built.manifest,{evidenceAdapter:{kind:'workflow',requirements:built.manifest.stageBindings}}),{snapshot:()=>run.workflow.snapshot()});
  for(const guard of ['identify','prepare','operate','inspect','deliver','close'])assert.equal(session.act(guard).accepted,true);assert.equal(session.state().passed,true);
  fs.mkdirSync(new URL('../../data/qa-studio/configurable-practices/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../../data/qa-studio/configurable-practices/receiving-six-pallets.json',import.meta.url),JSON.stringify({practiceId:'CEDI-01',mode:'manual',caseId:'A',sourceHashes:built.manifest.sourceHashes,shipments:run.shipments,world:run.world,driving:run.driving,session:session.state(),method:'bounded native input/steering/lift and G/K commands; no object transforms, joint poses or custody assignments'},null,2));
 }finally{h.releaseGeometry(f);}
});
