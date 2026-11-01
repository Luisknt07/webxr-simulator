'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),THREE=require('three'),schema=require('../../modules/logistica-industrial/contracts/behaviors.js');
const fixture=fs.readFileSync(path.join(__dirname,'test-conveyor-mechanisms.js'),'utf8'),{setup}=new Function('require','__dirname',fixture.slice(0,fixture.indexOf('async function run()'))+';return{setup};')(require,__dirname),f=setup(),study=require('../support/load-study-scenes.js')(THREE,schema,f.document.constructor);study.studySceneBase(f.document,'hall');const built=study.buildStudyScene(f.document,'hall','vr-robot-dispatch',{scene:f.scene,preview:true});
f.document.setBehaviors(built.source,f.document.getBehaviors(built.source).map(c=>c.type==='source'?{...c,loadMode:'pallet',palletType:'euro-1200x800',palletColumns:2,palletRows:2,palletLayers:1,totalLimit:1}:c));
f.document.setBehaviors(built.robot,f.document.getBehaviors(built.robot).map(c=>c.type==='robot'?{...c,acceptedTypes:'pallets',payloadKg:100,maxProductWidth:1.3,maxProductDepth:1.1,maxProductHeight:1}:c));
f.scene.updateMatrixWorld(true);f.runtime.start('hall');f.runtime.execute(1/60);const robot=f.runtime.records.get(built.robot.userData.editorId).components.robot,source=f.runtime.records.get(built.source.userData.editorId).components.source,product=source.queue[0].product;
assert(robot.fault.includes('apoyo inferior'),'Native runtime must explain why touching a top carton cannot lift its pallet.');assert.equal(source.queue.length,1);assert.equal(source.delivered,0);assert(!product.robotOwnerId&&!product.robotReservedBy&&!robot.entry);assert.equal(f.runtime.productMetadata(product).mass,33);f.runtime.stop();
const bad=[];for(const file of fs.readdirSync(path.join(__dirname,'../../projects/smarttwin/scenes')).filter(name=>name.endsWith('.json')&&name!=='catalog.json')){
 const document=JSON.parse(fs.readFileSync(path.join(__dirname,'../../projects/smarttwin/scenes',file),'utf8')).project.document;
 for(const room of Object.values(document.rooms||{})){
  const objects=new Map((room.additions||[]).map(object=>[object.id,object])),component=object=>(object.behaviors||[]).find(c=>['source','robot','conveyor','product','palletQueue','processor'].includes(c.type));
  for(const object of objects.values()){
   const c=component(object);if(!c||c.type!=='robot'||!['vacuum','gripper'].includes(c.tool)||c.operation==='process'||c.tool==='process')continue;
   const seen=new Set(),visit=id=>{if(!id||seen.has(id))return;seen.add(id);const node=objects.get(id),cfg=node&&component(node);if(!cfg)return;
    if(cfg.type==='source'&&(cfg.loadMode==='pallet'||schema.productSources.normalizeCatalog(cfg.catalog||'[]').some(spec=>['pallet','cage'].includes(spec.type)))||cfg.type==='product'&&(cfg.loadMode==='pallet'||cfg.productType==='pallet')||cfg.type==='palletQueue'&&(cfg.acceptsPallets||cfg.palletize))bad.push(file+': '+object.name+' <- '+node.name);
    if(['conveyor','processor'].includes(cfg.type))for(const prev of objects.values()){const edge=component(prev);if(edge&&[edge.outputId,edge.branchId,edge.targetId].includes(id))visit(prev.id);}
   };visit(c.sourceId||c.targetId);
  }
 }
}
assert.deepEqual(bad,[],'Maintained public examples cannot feed loose loaded pallets to top/box grips.');
console.log('Robot load policy: native rejected top-grip whole-pallet pickup leaves custody intact; all maintained public robot upstream networks audited.');
