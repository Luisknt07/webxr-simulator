import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('prepared SF-01 receives two original multi-reference pallets at separate rack levels with native manual controls and all six stages',{timeout:1200000},()=>{
 const h=require('../support/load-practice-scenes.cjs')(),f=h.fixture();let run;
 try{
  const built=h.buildConfigurablePracticeScene(f.document,'hall','SF-01',{scene:f.scene,mode:'manual'});f.runtime.start('hall');h.advance(f,.1);
  run=require('../support/run-configurable-raw-receiving.cjs')(h,f,built,p=>console.log(JSON.stringify(p)));
  assert.equal(run.world.sourceUnits,0);assert.equal(run.world.receiverUnits,12);assert.equal(run.world.totalUnits,12);assert.deepEqual(run.world.materialBalance.actual,{body:12,lid:12,screw:48});assert.equal(run.world.materialBalance.conserved,true);assert.deepEqual(run.world.criticalReasons,[]);assert.equal(run.driving.contacts,0);
  assert.deepEqual(run.shipments.map(row=>row.palletId),built.palletIds);assert.deepEqual(run.shipments.map(row=>row.slot),[0,1]);assert(run.shipments[1].position[1]>run.shipments[0].position[1]+.5);assert(run.shipments.every(row=>row.massKg===33.92));assert.deepEqual(run.world.stageEvidence.map(row=>row.guard),['identify','prepare','operate','inspect','deliver','close']);
  const Session=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs').PracticeSession,session=new Session(Object.assign({},built.manifest,{evidenceAdapter:{kind:'workflow',requirements:built.manifest.stageBindings}}),{snapshot:()=>run.workflow.snapshot()});
  for(const guard of ['identify','prepare','operate','inspect','deliver','close'])assert.equal(session.act(guard).accepted,true);assert.equal(session.state().passed,true);
  fs.mkdirSync(new URL('../../data/qa-studio/configurable-practices/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../../data/qa-studio/configurable-practices/raw-receiving-two-pallets.json',import.meta.url),JSON.stringify({practiceId:'SF-01',mode:'manual',caseId:'A',sourceHashes:built.manifest.sourceHashes,shipments:run.shipments,world:run.world,driving:run.driving,session:session.state(),method:'bounded native steering, pedal, hydraulic and G/K controls; no actor transforms, joint poses or custody assignments'},null,2));
 }finally{if(run)run.workflow.dispose();h.releaseGeometry(f);}
});
