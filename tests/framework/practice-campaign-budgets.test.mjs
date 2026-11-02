import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const proof=JSON.parse(fs.readFileSync(path.join(ROOT,'tests/fixtures/practice-campaign-source-layouts.json'),'utf8'));
const OUTPUT=path.join(ROOT,'data/qa-studio/practice-fidelity/native-matrix.json');
const MODES=['manual','semiautomatic','automatic'],CASES=['A','B','C'];
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
const snapshotFiles=['modules/logistica-industrial/practices/runtime/PracticeSceneBuilder.js','modules/logistica-industrial/practices/runtime/PracticeVehicleScene.js','modules/logistica-industrial/practices/schema/PracticeRecipes.cjs','modules/logistica-industrial/practices/schema/PracticeLayoutBindings.cjs','modules/logistica-industrial/practices/schema/PracticeCapabilities.cjs'];
const sourceHashes=()=>Object.fromEntries(snapshotFiles.map(file=>[file,hash(file)]));
const visible=object=>{for(let node=object;node;node=node.parent)if(!node.visible)return false;return true;};
const localId=value=>String(value).replace(/^[LI]\d{2}:/,'');
const almost=(actual,expected,message)=>assert(Math.abs(actual-expected)<1e-6,message+': '+actual+' != '+expected);

function costs(fixture,native){
 const materials=new Set(),textures=new Set(),geometries=new Set();
 let triangles=0,drawCalls=0,meshes=0,solidMeshes=0,collisionActors=0,lights=0;
 fixture.root.updateWorldMatrix(true,true);
 fixture.root.traverse(object=>{
  if(!visible(object))return;
  assert(object.matrixWorld.elements.every(Number.isFinite),'Every visible world transform must be finite.');
  if(object.isLight)lights++;
  const raw=object.userData.editorBehaviors||object.userData.editorDefaultBehaviors||[];
  if(raw.some(config=>config.type==='collision'&&config.enabled!==false&&config.mode!=='trigger'))collisionActors++;
  if(!object.isMesh||!object.geometry)return;
  meshes++;
  const geometry=object.geometry,position=geometry.attributes&&geometry.attributes.position;
  assert(position&&position.count>0,'A visible native mesh needs real vertices.');
  if(!geometries.has(geometry)){
   geometries.add(geometry);
   for(const attributeName of ['position','normal','uv']){
    const attribute=geometry.attributes[attributeName];if(!attribute)continue;
    for(const value of attribute.array)assert(Number.isFinite(value),'Native '+attributeName+' values must be finite.');
   }
   if(geometry.index)for(const index of geometry.index.array)assert(Number.isInteger(index)&&index>=0&&index<position.count,'Native geometry index bounds.');
  }
  const list=Array.isArray(object.material)?object.material:[object.material];
  for(const material of list){if(!material)continue;materials.add(material);for(const value of Object.values(material))if(value&&value.isTexture)textures.add(value);}
  const total=geometry.index?geometry.index.count:position.count,start=Math.max(0,geometry.drawRange.start||0),end=Math.min(total,start+geometry.drawRange.count),instances=object.isInstancedMesh?object.count:1;
  if(Array.isArray(object.material)&&geometry.groups.length){
   for(const group of geometry.groups){const material=list[group.materialIndex];if(!material||material.visible===false)continue;const count=Math.max(0,Math.min(end,group.start+group.count)-Math.max(start,group.start));if(count>0){drawCalls++;triangles+=count/3*instances;}}
  }else if(!list[0]||list[0].visible!==false){drawCalls++;triangles+=Math.max(0,end-start)/3*instances;}
  if(fixture.ctx.collisionWorld.physicalMesh(object))solidMeshes++;
 });
 return{triangles,drawCalls,meshes,materials:materials.size,textures:textures.size,geometries:geometries.size,solidMeshes,collisionActors,lights};
}

function sourceMapping(fixture,built,source,native){
 const rows=built.manifest.layoutElements;
 assert.equal(rows.length,source.elements.length,'Each source zone must survive every case and mode.');
 assert.equal(new Set(rows.map(row=>localId(row.sourceElementId))).size,rows.length,'No source variant is stacked twice.');
 assert.equal(new Set(rows.map(row=>row.objectId)).size,rows.length,'Each original source object has a distinct editable actor.');
 for(const element of source.elements){
  const row=rows.find(candidate=>localId(candidate.sourceElementId)===element.id);
  assert(row,'Missing source element '+source.id+':'+element.id);
  assert.equal(row.sourceName,element.name);assert.deepEqual(row.sourceOrigin,[element.x,element.z]);assert.deepEqual(row.sourceDimensions,[element.width,element.depth,element.height]);
  const center=[element.x+element.width/2-source.area.width/2,0,element.z+element.depth/2-source.area.depth/2];assert.deepEqual(row.sourceCenter,center);
  const actor=fixture.document.getObject(row.objectId);assert(actor&&actor.parent,'Source actor remains attached and editable.');
  assert.equal(actor.userData.practiceSourceElementId,source.id+':'+element.id);assert(actor.userData.practiceSourceKey);
  actor.position.toArray().forEach((value,axis)=>almost(value,row.actualPosition[axis],'Measured actor position'));
  if(Math.abs(actor.position.x-center[0])>1e-6||Math.abs(actor.position.z-center[2])>1e-6)assert(row.adjustmentReason&&row.adjustmentReason.trim(),'Changed layouts require a reason.');
  assert(Array.isArray(row.actualFootprint)&&row.actualFootprint.length===3&&row.actualFootprint.every(value=>Number.isFinite(value)&&value>=0),'Actual native envelope is recorded.');
  const zone=fixture.document.getObject(row.zoneObjectId);assert(zone&&zone.parent,'Source demarcation remains in the scene.');
  almost(zone.position.x,center[0],'Source zone X');almost(zone.position.z,center[2],'Source zone Z');almost(zone.scale.x,element.width,'Source zone width');almost(zone.scale.z,element.depth,'Source zone depth');
  assert.equal(fixture.ctx.collisionWorld.configuration(zone).enabled,false,'Painted source zones must never block a fork, tyre or payload.');
 }
 const floor=built.objects.find(object=>/suelo de hormig/.test(object.name));assert(floor,'Native industrial floor is present.');
 almost(floor.scale.x,source.area.width,'Original area width is not clamped');almost(floor.scale.z,source.area.depth,'Original area depth is not clamped');
 return rows.length;
}

test('all 64 × three cases × three modes retain their source BOM/area and bounded real native geometry, or reject before authoring',()=>{
 const startedAt=new Date().toISOString(),loadedSourceHashes=sourceHashes(),native=require('../support/load-practice-scenes.cjs')();
 const rows=[],failures=[],budgets={triangleLimit:200000,drawCallReviewTarget:250,drawCallRegressionLimit:400},worst={triangles:null,drawCalls:null};
 let sourceMappings=0;
 try{
  for(const source of proof.practices)for(const mode of MODES)for(const caseId of CASES){
   const fixture=native.fixture(),options={mode,caseId,difficulty:1,units:4,scene:fixture.scene},row={id:source.id,mode,caseId};
   try{
    const availability=native.recipes.availability(source.id,mode);row.ready=availability.ready;
    if(!availability.ready){
     const before=fixture.document.getObjects('hall').map(object=>object.userData.editorId);assert.throws(()=>native.recipes.plan(source.id,options));assert.throws(()=>native.buildPracticeScene(fixture.document,'hall',source.id,options));assert.deepEqual(fixture.document.getObjects('hall').map(object=>object.userData.editorId),before,'Unavailable modes cannot create actors or cargo.');row.reasons=availability.reasons;row.rejectedBeforeAuthoring=true;
    }else{
     const built=native.buildPracticeScene(fixture.document,'hall',source.id,options);sourceMappings+=sourceMapping(fixture,built,source,native);Object.assign(row,costs(fixture,native),{sourceElements:source.elements.length,actorCount:built.objects.length,layoutAdjustments:built.manifest.layoutAdjustments.length});
     if(!worst.triangles||row.triangles>worst.triangles.triangles)worst.triangles={...row};if(!worst.drawCalls||row.drawCalls>worst.drawCalls.drawCalls)worst.drawCalls={...row};
     row.drawCallReview=row.drawCalls>budgets.drawCallReviewTarget;
     assert(row.triangles<=budgets.triangleLimit,'Native scene exceeds the 200k-triangle scene envelope.');
     assert(row.drawCalls<=budgets.drawCallRegressionLimit,'Native scene exceeds the measured 400-draw regression guard; inspect the explicit 250-draw review list.');
     assert.equal(row.lights,0,'Actors must not add dynamic scene lights.');
     assert(row.solidMeshes>0&&row.collisionActors>0,'The audit must retain actual collisions instead of hiding bodies to lower costs.');
    }
   }catch(error){row.error=error.message;failures.push({id:source.id,mode,caseId,error:error.message});}
   finally{rows.push(row);native.releaseGeometry(fixture);}
  }
 }finally{
  fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});fs.writeFileSync(OUTPUT,JSON.stringify({format:'smarttwin.practice-native-matrix-audit',version:1,startedAt,completedAt:new Date().toISOString(),loadedSourceHashes,finishedSourceHashes:sourceHashes(),sourcePracticeCount:proof.practices.length,sourceElementCount:proof.practices.reduce((sum,row)=>sum+row.elements.length,0),matrixCases:rows.length,supported:rows.filter(row=>row.ready).length,rejected:rows.filter(row=>row.rejectedBeforeAuthoring).length,sourceMappings,budgets,worst,drawCallReview:rows.filter(row=>row.drawCallReview),failures,rows,limits:'Construction/geometry audit only. Draws are visible native mesh/material draw groups before dynamic material stock or renderer LOD. This is not a frame-rate, runtime contact or headset measurement.'},null,2));
 }
 assert.equal(rows.length,64*3*3,'The full 576-case source matrix is accounted for.');assert.equal(failures.length,0,JSON.stringify(failures));
 console.log('Native matrix: '+rows.filter(row=>row.ready).length+' supported, '+rows.filter(row=>row.rejectedBeforeAuthoring).length+' rejected. Worst triangles '+worst.triangles.triangles+' ('+worst.triangles.id+'), draws '+worst.drawCalls.drawCalls+' ('+worst.drawCalls.id+'). Review '+rows.filter(row=>row.drawCallReview).length+' cases above 250 draws.');
});
