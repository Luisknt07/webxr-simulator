import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('SF-03 preserves twelve original bodies through real fixture, timed machining, measurement and three WIP destinations',{timeout:240000},()=>{
 const native=require('../support/load-practice-scenes.cjs')(),f=native.fixture();let w,d;
 try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall','SF-03',{scene:f.scene});f.runtime.start('hall');native.advance(f,.1);
  w=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest);
  const h=Object.assign({},native,{advance(f,seconds){for(let t=0;t<seconds-1e-9;t+=1/60){native.advance(f,Math.min(1/60,seconds-t));w.update();}}});
  d=require('../support/practice-hand-driver.cjs')(h,f);
  w.command('material-order',{orderId:built.materialRecipe.orderId,quantity:12});w.command('material-prepare',{method:'mecanizado-con-sujecion'});
  const stations=['E02','E03','E04'].map(alias=>w.alias(alias)),shipments=[];
  for(let i=0;i<3;i++){
   const product=w.product(built.productIds[i]),original=product.sourceEntry.id;
   if(i===0){d.toProcessor(product,stations[1]);assert.throws(()=>w.command('start-material-cycle',{station:'E03'}),/sujeción/i);assert.equal(stations[1].components.processor.jobs.length,0);assert.equal(product.sourceEntry.id,original,'An incorrectly loaded idle station can return the same body to preparation.');}
   for(let j=0;j<stations.length;j++){
    const record=stations[j],p=record.components.processor,before=p.completed;
    d.toProcessor(product,record);
    assert.equal(p.jobs.length,0,'A new manual input waits for its explicit cycle request.');assert.equal(p.completed,before);
    w.command('start-material-cycle',{station:['E02','E03','E04'][j]});
    h.advance(f,.1);assert.equal(p.completed,before,'No instant material transformation.');
    f.runtime.setVariable(record.id,'paused',true);const progress=p.jobs[0].elapsed;h.advance(f,.5);assert.equal(p.jobs[0].elapsed,progress,'Pause freezes the actual native job.');f.runtime.setVariable(record.id,'paused',false);
    for(let t=0;t<1200&&p.completed===before;t++)h.advance(f,1/60);
    assert.equal(p.completed,before+1);assert.equal(p.operatorAvailable,false);assert.equal(p.running,false);assert(p.output.queue.includes(product.sourceEntry));assert.equal(product.sourceEntry.id,original);
   }
   d.toQueue(product,f.runtime.records.get(built.receiverIds[i]));assert.equal(product.sourceEntry.ownerId,built.receiverIds[i]);
   assert.deepEqual(w.observe().criticalReasons,[]);shipments.push({id:original,objectId:built.productIds[i],destinationId:built.receiverIds[i],history:product.sourceEntry.spec.operationHistory});
  }
  w.command('material-inspect',{quantity:12,quality:'conforme'});w.command('material-close',{quantity:12});const world=w.snapshot();assert.equal(world.finalizedUnits,12);assert.equal(world.stageEvidence.length,6);assert.deepEqual(world.materialBalance.actual,{body:12});assert.deepEqual(world.criticalReasons,[]);
  const Session=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs').PracticeSession,session=new Session(Object.assign({},built.manifest,{evidenceAdapter:{kind:'workflow',requirements:built.manifest.stageBindings}}),{snapshot:()=>w.snapshot()});for(const guard of ['identify','prepare','operate','inspect','deliver','close'])assert(session.act(guard).accepted);assert.equal(session.state().passed,true);
  fs.mkdirSync(new URL('../../data/qa-studio/configurable-practices/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../../data/qa-studio/configurable-practices/sf03-native-machining.json',import.meta.url),JSON.stringify({practiceId:'SF-03',mode:'manual',caseId:'A',shipments,world,frames:d.frames,method:'Native hand input, collision sweeps, processor input/output custody, explicit timed cycles and native pause. No material transforms or custody assignments.'},null,2));
 }finally{if(d)d.dispose();if(w)w.dispose();native.releaseGeometry(f);}
});
