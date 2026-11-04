import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')();
function truckDeck(root,position){const meshes=[];root.updateWorldMatrix(true,true);root.traverse(node=>{if(!node.isMesh)return;for(let p=node;p;p=p.parent)if(!p.visible||p.userData.editorGeometryReplaced)return;meshes.push(node);});const point=new native.THREE.Vector3(...position),hit=new native.THREE.Raycaster(point.clone().add(new native.THREE.Vector3(0,.08,0)),new native.THREE.Vector3(0,-1,0),0,.2).intersectObjects(meshes,false)[0];assert(hit,'The load is over an actual surface of the truck.');return hit.point.y;}
test('CEDI receiving seeds six unique native truck loads, not six empty markers or regenerated source packets',()=>{
 const f=native.fixture();try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-01',{scene:f.scene});f.runtime.start('hall');native.advance(f,.1);
  const workflow=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest),world=workflow.snapshot();
  assert.equal(world.totalUnits,48);assert.equal(world.sourceUnits,48);assert.equal(world.receiverUnits,0);assert.equal(world.materialBalance.actualPallets,6);assert.deepEqual(world.criticalReasons,[]);assert.deepEqual(world.stageEvidence,[]);
  assert.equal(new Set(world.pallets.map(p=>p.id)).size,6);assert.equal(new Set(built.manifest.receiving.identities.flatMap(row=>row.boxIds)).size,48);
  const truck=f.document.getObject(built.manifest.receiving.truckId);for(const pallet of world.pallets){assert.equal(pallet.units,8);assert.equal(pallet.massKg,60);assert(pallet.inSource);assert(Math.abs(pallet.position[1]-truckDeck(truck,pallet.position)-.005)<.001,'The raised warehouse and real truck bed are aligned.');assert(f.runtime.records.get(pallet.ownerId).components.palletQueue.queue.some(entry=>entry.product.record.id===pallet.id));}
  const vehicle=f.runtime.records.get(built.vehicleIds[0]);assert.equal(vehicle.components.vehicle.config.mode,'manual');assert.equal(vehicle.components.vehicle.training.error,'');assert.equal(built.tasks.length,6);
  assert.equal(built.manifest.receiving.continuationIds.length,4);assert.equal(built.receiverIds.length,6);assert.equal(built.manifest.aliases.find(row=>row.alias==='E07').sourceName,'Salida liberada');
 }finally{native.releaseGeometry(f);}
});
test('workflow decisions cannot inspect remote stock, duplicate stock, or fabricate unloading and handover',()=>{
 const f=native.fixture();try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-01',{scene:f.scene});f.runtime.start('hall');native.advance(f,.1);
  const w=new native.ConfigurablePracticeRuntime({simulation:f.runtime,document:f.document},built.manifest),palletId=built.palletIds[0],orderId=built.manifest.receiving.orderId;
  assert.throws(()=>w.command('arrival-check',{orderId,boxes:47,dockId:'E02'}),/48 cajas/);
  w.command('arrival-check',{orderId,boxes:48,dockId:'E02'});w.command('secure-dock',{secured:'checked'});
  assert.throws(()=>w.command('inspect-pallet',{palletId,boxes:8,massKg:60,lotId:built.manifest.receiving.lotId}),/Traslada/);
  assert.throws(()=>w.command('disposition',{palletId,decision:'released'}),/Inspecciona/);
  assert.throws(()=>w.command('register-pallet',{palletId,orderId}),/Relaciona/);
  assert.throws(()=>w.command('confirm-handover',{boxes:48}),/Deposita/);
  assert.deepEqual(w.snapshot().stageEvidence.map(row=>row.guard),['identify']);assert.equal(w.snapshot().sourceUnits,48);assert.equal(w.snapshot().receiverUnits,0);
  assert.equal(w.actions().length,6);assert(w.actions().every(row=>row.id&&row.title&&Array.isArray(row.actorAliases)&&Array.isArray(row.fields)&&typeof row.enabled==='boolean'));
 }finally{native.releaseGeometry(f);}
});
test('source quantities and canonical settings including the shared CEDI book survive actual validation/save/reload',async()=>{
 const f=native.fixture(),next=native.fixture();try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-01',{scene:f.scene,difficulty:3}),saved=native.validateDocument(await f.document.serialize(),value=>value);
  await next.document.load(saved);const manifest=next.document.studio.moduleData['sector.logistics-industrial'].levels[0];
  assert.deepEqual(manifest.settings,native.configurableRecipes.normalizedOptions(built.plan));assert.deepEqual(Object.keys(manifest.settings).sort(),['mode','caseId','difficulty','executionMode','evaluation','device','equipmentSelections','layout','helps','cediData'].sort());assert.deepEqual(manifest.settings.cediData,built.plan.operatingData.data);assert(!Object.hasOwn(manifest.settings,'practiceId'));assert(!Object.hasOwn(manifest.settings,'units'));
  assert.equal(manifest.expectedUnits,48);assert.equal(manifest.plan.fixture.pallets,6);assert.equal(manifest.difficulty,3);assert.equal(manifest.caseId,'A','Difficulty is independent of incident cases.');
  next.runtime.start('hall');native.advance(next,.1);const w=new native.ConfigurablePracticeRuntime({simulation:next.runtime,document:next.document},manifest);assert.equal(w.snapshot().totalUnits,48);assert.equal(w.snapshot().sourceUnits,48);
  assert.deepEqual(manifest.stageBindings,native.configurableRecipes.workflowRequirements(manifest.plan));
 }finally{native.releaseGeometry(f);native.releaseGeometry(next);}
});
test('invalid layout and equipment options reject before native allocation; preview alternatives move actual groups without gaining evaluated readiness',()=>{
 const recipes=native.configurableRecipes;
 for(const options of [{layout:null},{layout:{preset:'prepared',overrides:[{alias:'E01',x:NaN,z:0}]}},{layout:{preset:'prepared',overrides:[{alias:'E01',x:Infinity,z:0}]}},{layout:{preset:'prepared',overrides:[{alias:'E01',x:251,z:0}]}},{layout:{preset:'prepared',overrides:[{alias:'E01',x:1,z:2},{alias:'E01',x:3,z:4}]}},{layout:{preset:'prepared',overrides:[{alias:'E99',x:1,z:2}]}},{equipmentSelections:null},{helps:null},{equipmentSelections:{E03:'equipment.vehicle.freight-truck'}}])assert.throws(()=>recipes.plan('CEDI-01',options));
 const f=native.fixture();try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-01',{scene:f.scene,equipmentSelections:{E03:'equipment.vehicle.reach-truck'},layout:{preset:'prepared',overrides:[{alias:'E01',x:-20,z:1,yaw:0}]}});
  assert.equal(built.manifest.availability.ready,false);const row=built.manifest.aliases.find(row=>row.alias==='E03'),c=f.document.getBehaviors(f.document.getObject(row.objectId)).find(c=>c.type==='vehicle');assert.equal(c.variant,'reach-truck');assert.equal(c.catalogueEquipmentId,'equipment.vehicle.reach-truck');
  const truck=f.document.getObject(built.manifest.receiving.truckId);assert.equal(truck.position.x,-20);assert.equal(truck.position.z,1);for(let i=0;i<6;i++){const seat=f.document.getObject(built.sourceIds[i]),product=f.document.getObject(built.palletIds[i]);assert(Math.abs(seat.position.x-product.position.x)<1e-6);assert(Math.abs(seat.position.z-product.position.z)<1e-6);assert(Math.abs(product.position.y-truckDeck(truck,product.position.toArray())-.005)<.001,'Moving the preview retains the load at the actual bed height.');}
 }finally{native.releaseGeometry(f);}
});
