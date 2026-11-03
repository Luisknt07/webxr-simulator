import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('CEDI-02 native putaway route',{timeout:1200000},()=>{
 const h=require('../support/load-practice-scenes.cjs')(),f=h.fixture();let run;
 try{const built=h.buildConfigurablePracticeScene(f.document,'hall','CEDI-02',{scene:f.scene});f.runtime.start('hall');h.advance(f,.1);run=require('../support/run-configurable-putaway.cjs')(h,f,built,progress=>console.log(JSON.stringify(progress)));assert.equal(run.shipments.length,6);assert.equal(run.world.finalizedUnits,48);assert.equal(run.world.stageEvidence.length,6);assert.deepEqual(run.world.criticalReasons,[]);}
 finally{if(run)run.w.dispose();h.releaseGeometry(f);}
});
