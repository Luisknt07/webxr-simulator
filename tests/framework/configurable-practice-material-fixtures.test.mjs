import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')();
const expected={
 'CEDI-02':{box:48},'CEDI-03':{box:24},'CEDI-04':{finished:12,carton:12,label:12},'CEDI-05':{box:12},
 'SF-01':{body:12,lid:12,screw:48},'SF-02':{body:12,lid:12,screw:48},'SF-03':{body:12},'SF-04':{body:12,lid:12,screw:48},'SF-05':{finished:12,carton:12,label:12}
};

test('all nine additional practice mounts contain finite native material identities and real, supported custody',()=>{
 for(const [id,quantities]of Object.entries(expected)){
  const f=native.fixture();let w;try{
   const built=native.buildConfigurablePracticeScene(f.document,'hall',id,{scene:f.scene});assert.equal(built.manifest.materialFixture.status,'native-seeded');
   assert(built.productIds.length>0);assert.equal(new Set(built.productIds).size,built.productIds.length);assert(built.manifest.equipmentAttachments.components.length>0);
   f.runtime.start('hall');native.advance(f,.1);w=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest);
   const observed=w.observe(),snapshot=w.snapshot();assert.deepEqual(observed.quantities,quantities,id);assert.deepEqual(observed.criticalReasons,[],id);assert(observed.materialBalance.conserved,id);assert.equal(snapshot.totalUnits,built.manifest.expectedUnits,id);
   assert.deepEqual(snapshot.stageEvidence,[],id+' cannot claim a stage merely by displaying stock.');assert.equal(snapshot.finalizedUnits,0,id);
   assert(w.actions().length>=4);assert(w.actions().every(row=>row.fields.length<=4),'Actions remain available through the same XR field contract.');
   for(const stock of built.materialRecipe.stock){const product=w.product(stock.objectId);assert(product&&product.sourceEntry&&product.sourceEntry.ownerId===stock.sourceId,id+' initial custody');assert.deepEqual(product.object.scale.toArray(),[1,1,1]);}
   native.advance(f,2);assert.deepEqual(w.observe().quantities,quantities,id+' must not generate more material while waiting.');
  }finally{if(w)w.dispose();native.releaseGeometry(f);}
 }
});

test('new material workflow rejects remote inspection, wrong orders, missing stock and duplicate native custody',()=>{
 for(const id of ['CEDI-02','CEDI-03','CEDI-05','SF-01','SF-03']){
  const f=native.fixture();let w;try{
   const built=native.buildConfigurablePracticeScene(f.document,'hall',id,{scene:f.scene});f.runtime.start('hall');native.advance(f,.1);w=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest);
   assert.throws(()=>w.command('material-order',{orderId:'ORD-OTHER',quantity:built.plan.expectedUnits}),/orden/i);
   w.command('material-order',{orderId:built.materialRecipe.orderId,quantity:built.plan.expectedUnits});
   const method=id==='CEDI-03'?'bulto-cuatro-cajas':id==='SF-03'?'mecanizado-con-sujecion':'ruta-y-capacidad-verificadas';w.command('material-prepare',{method});
   assert.throws(()=>w.command('material-inspect',{quantity:built.plan.expectedUnits,quality:'conforme'}),/cantidad|posición|inspección/i);assert.throws(()=>w.command('material-close',{quantity:built.plan.expectedUnits}),/entrega|concili/i);
   const initial=w.observe(),entry=initial.entries[0].entry,original=entry.units;entry.units=original-1;assert(w.observe().criticalReasons.length>0);entry.units=original;
   const owner=f.runtime.records.get(entry.ownerId).components.palletQueue;owner.queue.push(entry);assert(w.observe().materialBalance.duplicates.length>0);owner.queue.pop();assert.deepEqual(w.observe().criticalReasons,[]);
  }finally{if(w)w.dispose();native.releaseGeometry(f);}
 }
});

test('three actual four-carton bundles follow native hand sweeps into three order seats; the other twelve cartons remain in source',()=>{
 const f=native.fixture();let w,operator;try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-03',{scene:f.scene});f.runtime.start('hall');native.advance(f,.1);w=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest);operator=require('../support/practice-hand-operator.cjs')(native,f,w);
  assert.equal(w.snapshot().stockSourceUnits,24);assert.equal(w.snapshot().orderRemainingUnits,12);
  w.command('material-order',{orderId:built.materialRecipe.orderId,quantity:12});w.command('material-prepare',{method:'bulto-cuatro-cajas'});
  for(let index=0;index<3;index++){
   const product=w.product(built.materialRecipe.stock[index].objectId),record=f.runtime.records.get(built.receiverIds[index]),from=product.object.getWorldPosition(new native.THREE.Vector3()),target=operator.target(record,product);
   operator.pickup(product);operator.move([from.x,from.y,from.z+1.25]);operator.move([from.x,Math.max(1.05,from.y),from.z+1.25]);operator.move([-3.5,Math.max(1.05,from.y),from.z+1.25]);operator.move([-3.5,1.05,0]);operator.move([target.x,1.05,0]);operator.move([target.x,1.05,target.z+1.2]);operator.move([target.x,target.y,target.z+1.2]);operator.move(target.toArray());operator.release();
   assert.equal(product.sourceEntry.ownerId,record.id);assert.deepEqual(w.observe().criticalReasons,[]);assert.equal(w.snapshot().stockSourceUnits,24-4*(index+1));
  }
  w.command('material-inspect',{quantity:12,quality:'conforme'});w.command('material-close',{quantity:12});const state=w.snapshot();assert.equal(state.stockSourceUnits,12);assert.equal(state.orderRemainingUnits,0);assert.equal(state.totalUnits,12);assert.equal(state.initialUnits,12);assert.equal(state.receiverUnits,12);assert.equal(state.finalizedUnits,12);assert.equal(w.observe().entries.filter(row=>row.inSource).reduce((sum,row)=>sum+row.quantity,0),12);assert.deepEqual(w.observe().quantities,{box:24});assert.equal(state.stageEvidence.length,6);assert(operator.stats().ticks>1000);
  const Session=require('../../modules/logistica-industrial/practices/schema/PracticeSession.cjs').PracticeSession,session=new Session(Object.assign({},built.manifest,{evidenceAdapter:{kind:'workflow',requirements:built.manifest.stageBindings}}),{snapshot:()=>w.snapshot()});for(const guard of ['identify','prepare','operate','inspect','deliver','close'])assert(session.act(guard).accepted);assert.equal(session.state().passed,true);
 }finally{if(operator)operator.dispose();if(w)w.dispose();native.releaseGeometry(f);}
});
