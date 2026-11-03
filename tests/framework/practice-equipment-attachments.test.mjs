import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const native=require('../support/load-practice-scenes.cjs')(),geometryFactory=require('../../modules/logistica-industrial/functions/equipamiento/runtime/EquipmentGeometry.cjs'),costs=require('../support/practice-render-costs.cjs');
const source=fs.readFileSync(path.join(ROOT,'modules/logistica-industrial/practices/configurable/runtime/PracticeEquipmentAttachments.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const buildPracticeEquipmentAttachments=new Function('THREE','schema','catalogue','geometryFactory',source+'\nreturn buildPracticeEquipmentAttachments;')(native.THREE,native.schema,native.catalogue,geometryFactory);
const report=[];
test('all thirty source configurations mount requested non-stock hardware on actual native equipment without duplicate shelves, panels or stock',async()=>{
  for(const entry of native.configurableRecipes.list())for(const mode of native.configurableRecipes.MODES){
    const f=native.fixture();try{
      const built=native.buildConfigurablePracticeScene(f.document,'hall',entry.id,{mode,scene:f.scene}),rows=built.manifest.aliases,attached=built.manifest.equipmentAttachments,fresh=attached.createdObjectIds.map(id=>f.document.getObject(id)),measured=costs(fresh,{validate:(v,m)=>assert(v,m)});
      const expected=rows.flatMap(row=>(row.componentEquipmentIds||[]).filter(equipmentId=>!['product','vehicle','storage'].includes(native.catalogue.definition(equipmentId).role)).map(equipmentId=>({alias:row.alias,equipmentId}))).concat(rows.flatMap(row=>(row.manualAccessories||[]).map(value=>({alias:row.alias,equipmentId:'manual.'+value}))));
      for(const component of expected)assert(attached.components.some(row=>row.ownerAlias===component.alias&&row.equipmentId===component.equipmentId),'Missing physical hardware '+entry.id+'/'+mode+'/'+component.alias+'/'+component.equipmentId);
      for(const component of attached.components){assert(component.objectIds.length);for(const id of component.objectIds)assert(f.document.getObject(id));if(component.representation.includes('sensor')){assert(f.document.getBehaviors(f.document.getObject(component.sensorObjectId)).some(b=>b.type==='sensor'&&b.sourceId===component.sourceId));assert(f.document.getObject(component.sourceId));}}
      for(const object of fresh){assert.equal(object.userData.editorDescriptor.type,'cad');assert.equal(object.userData.editorDescriptor.attachment.part,'frame');assert(f.document.getObject(object.userData.editorDescriptor.attachment.targetId));assert(!f.document.getBehaviors(object).some(b=>b.type==='product'||b.type==='source'),'Hardware never creates a parallel material inventory.');}
      assert(fresh.every(o=>!o.name.includes('PLC simulado')),'No second control cabinet allocated.');
      assert(measured.drawCalls<=30,'Native hardware shares static finishes on each host, bounded to 30 additional draws.');assert.equal(measured.lights,0);assert(measured.triangles<45000);
      const saved=native.validateDocument(await f.document.serialize(),value=>value);assert(saved.rooms.hall.additions.filter(row=>row.descriptor.attachment).length>=fresh.length);
      report.push({id:entry.id,mode,...measured,components:attached.components.map(row=>({equipmentId:row.equipmentId,ownerAlias:row.ownerAlias,representation:row.representation,parts:row.objectIds.length})),inventoryDelegated:attached.inventoryComponents});
    }finally{native.releaseGeometry(f);}
  }
  fs.mkdirSync(path.join(ROOT,'data/qa-studio/practice-facilities'),{recursive:true});fs.writeFileSync(path.join(ROOT,'data/qa-studio/practice-facilities/hardware-matrix.json'),JSON.stringify({passed:true,rows:report},null,2));
});

test('frame-mounted tools, nests and native sensor source bindings follow translation, rotation and a complete saved-project reload',async()=>{
  const f=native.fixture(),next=native.fixture();try{
    const built=native.buildConfigurablePracticeScene(f.document,'hall','SF-03',{mode:'automatic',scene:f.scene}),hardware=built.manifest.equipmentAttachments,tool=hardware.components.find(row=>row.representation==='parked-native-tool-in-locating-nest'),owner=f.document.getObject(tool.ownerId),part=f.document.getObject(tool.objectIds[0]);
    assert(part);const local=part.position.clone(),before=part.getWorldPosition(new native.THREE.Vector3());f.document.setTransform(owner,{position:[owner.position.x+1.1,owner.position.y,owner.position.z-.4],rotation:[0,.45,0]});f.document.syncCADAttachments();owner.updateWorldMatrix(true,true);
    assert(part.getWorldPosition(new native.THREE.Vector3()).distanceTo(owner.localToWorld(local.clone()))<1e-6);assert(part.getWorldPosition(new native.THREE.Vector3()).distanceTo(before)>.5);
    const expected=part.matrixWorld.elements.slice(),saved=native.validateDocument(await f.document.serialize(),value=>value);await next.document.load(saved);next.document.syncCADAttachments();next.root.updateWorldMatrix(true,true);const restored=next.document.getObject(part.userData.editorId);assert(restored);restored.matrixWorld.elements.forEach((n,i)=>assert(Math.abs(n-expected[i])<1e-5));
  }finally{native.releaseGeometry(f);native.releaseGeometry(next);}
});

test('a mounted photoeye counts an actual native carton crossing its beam, without a synthetic event or duplicated material',()=>{
  const f=native.fixture();try{
    const owner=f.document.addPrefab('hall','conveyor','catalogue:equipment.transport.flat-belt');
    const config=f.document.getBehaviors(owner).find(row=>row.type==='conveyor');f.document.setBehaviors(owner,[{...config,running:true,powered:true,autoSpawn:false,length:3,width:1.2,speed:.6,withPanel:false}]);f.document.setTransform(owner,{position:[0,1,0]});
    const rows=[{alias:'E01',objectId:owner.userData.editorId,catalogueEquipmentId:'equipment.transport.flat-belt',sourceDimensions:[3,1.2],componentEquipmentIds:['equipment.sensor.photoelectric']}],objects=[owner];
    const hardware=buildPracticeEquipmentAttachments(f.document,'hall',{id:'SF-04'},rows,objects),sensor=hardware.components.find(row=>row.sensorObjectId);assert(sensor);
    f.runtime.start('hall');assert(f.runtime.insertProduct(owner.userData.editorId));native.advance(f,6);
    const record=f.runtime.records.get(sensor.sensorObjectId);assert(record&&record.components.sensor);assert.equal(record.components.sensor.config.sourceId,owner.userData.editorId);assert.equal(record.components.sensor.count,1,'The native conveyor package physically traverses the mounted detector.');assert.equal(f.runtime.products.size,1);assert.equal(f.runtime.packageCount,1);
  }finally{native.releaseGeometry(f);}
});
