import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const base='../../modules/logistica-industrial/functions/equipamiento/schema/';
const catalog=require(base+'equipmentCatalog.cjs'),operations=require(base+'operationSpec.cjs'),capabilities=require(base+'equipmentCapabilities.cjs'),paths=require(base+'cataloguePath.cjs');
const conveyors=require('../../modules/logistica-industrial/functions/bandas/schema/conveyors.js');

test('387 namespaced document references map to 237 reviewed semantic identities without code collision',()=>{
 assert.equal(catalog.sourceRefs.length,387);assert.equal(catalog.DEFINITIONS.length,237);
 assert.equal(new Set(catalog.sourceRefs.map(x=>x.key)).size,387);
 assert.equal(catalog.source('nexus-conceptual-198:TR-03').id,'equipment.transport.flat-belt');
 assert.equal(catalog.source('nexus-illustrated-2026:TR-03').id,'equipment.transport.roller-pallet');
 assert.notEqual(catalog.source('nexus-conceptual-198:AL-07').id,catalog.source('nexus-illustrated-2026:AL-07').id);
 catalog.sourceRefs.forEach(row=>assert.ok(catalog.source(row.key),row.key));
 assert.equal(catalog.source('TR-03'),null);assert.equal(catalog.source('other:TR-03'),null);
});

test('a source illustration or descriptor alone never claims functional insertion',()=>{
 const resources=catalog.resources();assert.equal(resources.length,237);
 resources.forEach(row=>{assert.equal(row.status,'development');assert.equal(row.action,null);});
 const ready=catalog.resources({nativeReady:d=>d.operationLevel==='attachment'||d.operationLevel==='workspace'});
 assert.equal(ready.find(x=>x.catalogueEquipmentId==='equipment.tool.forks').action.type,'applyEquipmentTool');
 assert.equal(ready.find(x=>x.catalogueEquipmentId==='equipment.monitor.assistant').action.type,'workspace');
 assert.equal(ready.find(x=>x.catalogueEquipmentId==='equipment.machine.cnc-lathe').status,'development');
 assert.throws(()=>catalog.normalize('equipment.machine.cnc-lathe',{width:Infinity}));
 assert.throws(()=>catalog.normalize('equipment.machine.cnc-lathe',{capacity:2.5}));
 assert.throws(()=>catalog.normalize('equipment.machine.cnc-lathe',JSON.parse('{"__proto__":{"polluted":true}}')));
});

const input=()=>({id:'load-1',originId:'source-1',ownerId:'station-1',units:3,spec:{id:'part-a',type:'cylinder',width:.6,height:.4,depth:.3,mass:4,quality:'good'},load:{loadMode:'individual'},product:{object:{parent:{name:'live-scene'}}}});
test('operation preview is immutable; commit conserves identities, units, custody and material balance',()=>{
 const entry=input(),before=JSON.stringify(entry),product=entry.product;
 const config={catalogueEquipmentId:'equipment.machine.cnc-lathe',operationParametersJson:JSON.stringify({targetWidth:.5,removedMassKg:.5})};
 const plan=operations.prepareOperation(config,[entry],{recordId:'machine-1',runSequence:4});
 assert.equal(JSON.stringify(entry),before);assert.equal(plan.ledger.inputUnits,3);assert.equal(plan.ledger.outputUnits,3);
 assert.equal(plan.ledger.inputMassKg,12);assert.equal(plan.ledger.outputMassKg,10.5);assert.equal(plan.ledger.wasteMassKg,1.5);
 assert.ok(Object.isFrozen(plan.updates[0].spec));
 const result=operations.commitOperation(plan);assert.equal(result.entries[0],entry);assert.equal(entry.product,product);assert.equal(entry.ownerId,'station-1');assert.equal(entry.id,'load-1');
 assert.equal(entry.spec.width,.5);assert.equal(entry.spec.mass,3.5);assert.equal(entry.spec.operationState.manufacturingStage,'machine');
 assert.throws(()=>operations.commitOperation(plan),/committed/);
 assert.throws(()=>operations.commitOperation({updates:[{entry,spec:{mass:1000}}]}),/invalid/);
});

test('stale inputs, invalid recipes and unsatisfied interlocks cannot partially mutate custody',()=>{
 const entry=input(),config={catalogueEquipmentId:'equipment.packaging.carton-sealer'};
 const plan=operations.prepareOperation(config,[entry]);entry.ownerId='different-owner';const before=JSON.stringify(entry);
 assert.throws(()=>operations.commitOperation(plan),/changed/);assert.equal(JSON.stringify(entry),before);
 const stable=input(),original=JSON.stringify(stable);
 assert.throws(()=>operations.prepareOperation({catalogueEquipmentId:'equipment.machine.saw',operationParametersJson:'{"removedMassKg":5}'},[stable]),/balance/);
 assert.throws(()=>operations.prepareOperation({catalogueEquipmentId:'equipment.machine.saw',operationParametersJson:'{"guardClosed":false}'},[stable]),/interlock/);
 assert.throws(()=>operations.prepareOperation({catalogueEquipmentId:'equipment.machine.saw',operationParametersJson:'{"eval":"alert(1)"}'},[stable]),/Unsupported/);
 assert.equal(JSON.stringify(stable),original);
});

test('packaging and inspection change actual product state and retain unknown measurement honesty',()=>{
 const entry=input();operations.applyOperation({catalogueEquipmentId:'equipment.packaging.carton-sealer'},[entry]);assert.equal(entry.spec.operationState.sealed,true);
 operations.applyOperation({catalogueEquipmentId:'equipment.sensor.checkweigher',operationParametersJson:'{"minMassKg":5,"maxMassKg":6}'},[entry]);
 assert.equal(entry.spec.operationState.inspectionResult,'reject');assert.equal(entry.spec.quality,'defective');
 delete entry.spec.mass;operations.applyOperation({catalogueEquipmentId:'equipment.sensor.checkweigher'},[entry]);assert.equal(entry.spec.operationState.inspectionResult,'unknown');
 const last=entry.spec.operationHistory.at(-1);assert.equal(last.measurement.source,'declared-simulation');assert.equal(last.measurement.massKg,null);
 const length=entry.spec.operationHistory.length;for(let i=0;i<30;i++)operations.applyOperation({catalogueEquipmentId:'equipment.packaging.print-apply',operationParametersJson:'{"label":"BATCH-03"}'},[entry]);
 assert.equal(entry.spec.operationHistory.length,24);assert.ok(length<=24);assert.equal(entry.spec.operationState.label,'BATCH-03');
});

test('new 3D transport paths drive the same endpoints, tangent, projection and ports as native conveyor API',()=>{
 for(const mechanism of paths.CUSTOM){
  const cfg=catalog.normalize('equipment.transport.'+mechanism),route=paths.path(cfg),length=conveyors.pathLength(cfg);
  assert.ok(length>0);assert.equal(length,route.length);
  const p=conveyors.ports(cfg),a=conveyors.pathPoint(cfg,0),b=conveyors.pathPoint(cfg,length);
  for(const key of ['x','y','z','tx','ty','tz']){assert.equal(a[key],p.input[key]);assert.equal(b[key],p.output[key]);}
  for(let i=0;i<=20;i++){
   const at=length*i/20,q=conveyors.pathPoint(cfg,at);assert.ok(Object.values(q).every(Number.isFinite),mechanism);
   const closest=conveyors.closestPath(cfg,q.x,q.z,'main',q.y);assert.ok(closest.distanceSq<1e-8,mechanism+' '+i);
  }
  assert.ok(conveyors.pathPoint(cfg,-.2).x!==undefined);
 }
 const spiral=catalog.normalize('equipment.transport.spiral'),L=conveyors.pathLength(spiral),end=conveyors.pathPoint(spiral,L);
 assert.ok(end.y>2);assert.ok(conveyors.closestPath(spiral,end.x,end.z,'main',end.y).distance>L-.001);
 const sorter=catalog.normalize('equipment.transport.shoe-sorter');assert.deepEqual(conveyors.pathBranches(sorter),['main','branch']);assert.ok(conveyors.ports(sorter).branch.z<0);
});

test('bulk machines reject boxes and pallets; end-effector topology and sensor reads use declared live data',()=>{
 for(const mechanism of ['screw','pneumatic','bucket-elevator']){
  const cfg=catalog.normalize('equipment.transport.'+mechanism);
  assert.equal(conveyors.productCompatibility(cfg,{type:'box',width:.2,depth:.2}).ok,false);
  assert.equal(conveyors.productCompatibility(cfg,{type:'pallet',width:.2,depth:.2,loadMode:'pallet'}).ok,false);
  assert.equal(conveyors.productCompatibility(cfg,{catalogueEquipmentId:'equipment.product.bulk-fluid',width:.2,depth:.2,mass:2}).ok,true);
 }
 assert.equal(capabilities.assessTool('equipment.tool.magnet',{payloadKg:12},{mass:1,material:'aluminium'}).accepted,false);
 assert.equal(capabilities.assessTool('equipment.tool.magnet',{payloadKg:12},{mass:1,material:'steel'}).accepted,true);
 assert.equal(capabilities.assessTool('equipment.tool.vacuum-single',{payloadKg:100},{mass:20,loadMode:'pallet'}).accepted,false);
 assert.equal(capabilities.assessTool('equipment.tool.forks',{payloadKg:100},{mass:20,loadMode:'pallet'}).accepted,true);
 assert.deepEqual(capabilities.sampleSensor('equipment.sensor.photoelectric',{presence:true}).value,true);
 assert.equal(capabilities.sampleSensor('equipment.sensor.condition',{}).known,false);
 assert.equal(capabilities.interlock({emergency:true,running:true}).permit,false);
});

test('native catalogue factory dispatch retains real actor, rig and control identity without an alternate model',()=>{
 const THREE=require('three'),loader=require('../support/load-robot-prefabs.js')(THREE),factory=loader.resolve('CatalogueEquipmentFactory.js');
 const native=new THREE.Group(),actor=new THREE.Group(),rig={real:true};native.userData.robotRig=rig;native.userData.editorDefaultBehaviors=[{type:'robot'}];native.add(actor);let called;
 const made=factory.createCatalogueEquipment('equipment.robot.articulated',{}, {nativeFactory:(kind,variant,cfg)=>(called={kind,variant,cfg},native)});
 assert.equal(made,native);assert.equal(made.userData.robotRig,rig);assert.equal(made.children[0],actor);assert.equal(called.kind,'robot');assert.equal(called.variant,'articulated-general');assert.equal(made.userData.editorDefaultBehaviors[0].catalogueEquipmentId,'equipment.robot.articulated');
 assert.throws(()=>factory.createCatalogueEquipment('equipment.tool.forks',{}, {nativeFactory:()=>native}),/attachment/);
 assert.throws(()=>factory.performCatalogueAction({catalogueEquipmentId:'equipment.tool.forks'},{canEdit:()=>false,applyRobotTool:()=>{throw Error('must not run')}}),/editable/);
 let config;factory.performCatalogueAction({catalogueEquipmentId:'equipment.tool.forks'},{canEdit:()=>true,applyRobotTool:(id,change)=>(config=change({family:'articulated'}))});assert.equal(config.tool,'fork');assert.equal(config.catalogueToolId,'equipment.tool.forks');
});
