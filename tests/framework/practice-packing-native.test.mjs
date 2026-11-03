import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')(),Session=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs').PracticeSession;

for(const id of ['CEDI-04','SF-05'])test(id+' packs the finite original references, builds physical pallets and drives them to their exact receiver before six mission stages can pass',{timeout:1200000},()=>{
 const f=native.fixture();let result,carrier;
 try{
  result=require('../support/prepare-packed-practice.cjs')(native,f,id,step=>{if(!carrier)carrier=require('../support/practice-packed-pallet-driver.cjs')(native,f,step.workflow,step.built);carrier.transfer(step);});
  const {workflow,built}=result;workflow.command('bom-close',{quantity:12});const world=workflow.snapshot();
  assert.deepEqual(world.criticalReasons,[]);assert.equal(world.sourceUnits,0);assert.equal(world.receiverUnits,12);assert.equal(world.totalUnits,12);assert.equal(world.materialBalance.conserved,true);assert.deepEqual(world.materialBalance.actual,{finished:12,carton:12,label:12});
  assert.equal(new Set(result.identities).size,12);assert.equal(result.pallets.length,id==='CEDI-04'?2:1);assert.equal(carrier.stats().driving.contacts,0);assert.equal(f.runtime.held.size,0);
  assert(carrier.stats().delivered.every(row=>built.receiverIds.includes(row.destinationId)));
  const outputs=workflow.operations.outputs(workflow.observe());assert.deepEqual(outputs.map(row=>row.id).sort(),result.identities.sort());assert(outputs.every(row=>row.inReleased&&!row.held&&row.assemblyComplete));
  const unitIds=outputs.flatMap(row=>f.runtime.processorRuntime.leaves([row.entry.members.find(entry=>entry.id===row.id)]).flatMap(leaf=>leaf.materialUnitIds||[]));
  assert.equal(new Set(unitIds).size,36);assert.deepEqual(unitIds.sort(),built.manifest.materialRecipe.stock.flatMap(row=>row.unitIds).sort());
  const session=new Session(Object.assign({},built.manifest,{evidenceAdapter:{kind:'workflow',requirements:built.manifest.stageBindings}}),{snapshot:()=>workflow.snapshot()});
  for(const guard of ['identify','prepare','operate','inspect','deliver','close'])assert(session.act(guard).accepted);assert(session.state().passed);
  fs.mkdirSync(new URL('../../data/qa-studio/practice-facilities/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../../data/qa-studio/practice-facilities/'+id.toLowerCase()+'-native-packing.json',import.meta.url),JSON.stringify({passed:true,practiceId:id,mode:'manual',caseId:'A',originalCartonIds:result.identities,pallets:result.pallets,nativeControllerFrames:result.driver.frames,driving:carrier.stats(),simulationSeconds:f.runtime.time,world,session:session.state()},null,2));
 }finally{if(result){result.driver.dispose();result.workflow.dispose();}native.releaseGeometry(f);}
});
