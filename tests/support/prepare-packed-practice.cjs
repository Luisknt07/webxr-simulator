'use strict';
const assert=require('node:assert/strict');
// All products, conversions and pallet members are owned by native runtimes.
// onPallet must operate the carrier, never rewrite an aggregate pose/queue.
module.exports=function preparePacked(native,f,id,onPallet,options={}){
 const built=native.buildConfigurablePracticeScene(f.document,'hall',id,Object.assign({},options,{mode:'manual',caseId:'A',scene:f.scene}));f.scene.updateMatrixWorld(true);f.runtime.start('hall');native.advance(f,.1);
 const workflow=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest),driver=require('./practice-hand-driver.cjs')(native,f),main=workflow.alias('E02'),seal=id==='CEDI-04'?workflow.alias('E03'):null,palletizer=workflow.alias(id==='CEDI-04'?'E04':'E03'),capacity=id==='CEDI-04'?6:12;
 const tick=seconds=>{native.advance(f,seconds);workflow.update();};
 assert.deepEqual(workflow.observe().criticalReasons,[]);assert.throws(()=>workflow.command('bom-close',{quantity:12}));
 workflow.command('bom-order',{orderId:built.manifest.materialRecipe.orderId,quantity:12});workflow.command('bom-prepare',{method:'contenido-caja-etiqueta'});
 const identities=[],pallets=[];
 for(let group=0;group<3;group++){
  for(const stock of built.manifest.materialRecipe.stock.slice(group*3,group*3+3))driver.toProcessor(workflow.product(stock.objectId),main);
  workflow.command('bom-cycle',{station:'E02'});tick(5);assert.equal(main.components.processor.output.queue.length,4);
  for(let box=0;box<4;box++){
   const entry=main.components.processor.output.queue[0];identities.push(entry.id);
   if(seal){driver.toProcessor(entry.product,seal);workflow.command('bom-cycle',{station:'E03'});tick(3);assert.equal(seal.components.processor.output.queue[0].id,entry.id);}
   workflow.command('bom-inspect',{loadId:entry.id,quantity:1,condition:'conforme'});driver.toQueue(entry.product,palletizer);tick(.1);
   const assembly=palletizer.components.palletQueue.pallets[0].assemblyProduct;
   if(assembly&&!assembly.palletAssemblyIncomplete){
    assert.equal(assembly.sourceEntry.units,capacity);assert.equal(assembly.sourceEntry.members.length,capacity);pallets.push(assembly.sourceEntry.id);
    const first=assembly.sourceEntry.members[0];workflow.command('bom-secure',{loadId:first.id,secured:'patron-y-sujecion-verificados'});
    if(onPallet)onPallet({native,f,built,workflow,driver,palletizer,assembly,index:pallets.length-1});
    else return{built,workflow,driver,palletizer,assembly,identities,pallets};
    tick(.2);
   }
   assert.deepEqual(workflow.observe().criticalReasons,[]);
  }
 }
 return{built,workflow,driver,palletizer,identities,pallets};
};
