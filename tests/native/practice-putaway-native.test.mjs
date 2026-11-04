import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('CEDI-02 native putaway route',{timeout:1200000},()=>{
 const h=require('../support/load-practice-scenes.cjs')(),f=h.fixture();let run;
 try{const built=h.buildConfigurablePracticeScene(f.document,'hall','CEDI-02',{scene:f.scene});f.runtime.start('hall');h.advance(f,.1);run=require('../support/run-configurable-putaway.cjs')(h,f,built,progress=>console.log(JSON.stringify(progress)));assert.equal(run.shipments.length,6);assert.equal(new Set(run.shipments.map(row=>row.productId)).size,6);assert.equal(new Set(run.shipments.map(row=>row.locationCode)).size,6);assert.equal(run.replenishment.productId,run.shipments[0].productId);assert.equal(run.replenishment.ownerId,built.tasks[6].destinationId);assert.equal(run.world.finalizedUnits,48);assert.equal(run.world.stageEvidence.length,6);assert.deepEqual(run.world.criticalReasons,[]);assert.deepEqual(run.world.materialBalance.actual,{box:48});assert.equal(run.driving.contacts,0);const directory=new URL('../../data/qa-studio/practice-facilities/',import.meta.url);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(new URL('cedi-02-unified-putaway-native.json',directory),JSON.stringify({passed:true,scope:'all six original pallets put away in six native cells, followed by physical replenishment of the first original pallet and six workflow stages',practiceId:'CEDI-02',shipments:run.shipments,replenishment:run.replenishment,world:run.world,driving:run.driving},null,2));}
 finally{if(run)run.w.dispose();if(f.runtime.active)f.runtime.stop();h.releaseGeometry(f);}
});
