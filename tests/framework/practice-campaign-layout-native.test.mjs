import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const proof=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/practice-campaign-source-layouts.json'),'utf8'));
const localId=value=>String(value).replace(/^[LI]\d{2}:/,'');
const almost=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-6,label+': '+actual+' != '+expected);

test('each of the 64 authored levels maps every original DOCX layout object to the actual editable native scene',()=>{
 const native=require('../support/load-practice-scenes.cjs')();
 let count=0;
 for(const source of proof.practices){
  const fixture=native.fixture();
  try{
   const built=native.buildPracticeScene(fixture.document,'hall',source.id,{caseId:'A',mode:'manual',difficulty:1,units:2,scene:fixture.scene});
   const rows=built.manifest.layoutElements;
   assert(Array.isArray(rows),source.id+' must preserve a source-to-native layout manifest.');
   assert.equal(rows.length,source.elements.length,source.id+' must retain all source elements.');
   assert.equal(new Set(rows.map(r=>localId(r.sourceElementId))).size,rows.length,source.id+' cannot stack duplicate source variants.');
   assert.equal(new Set(rows.map(r=>r.objectId)).size,rows.length,source.id+' must have a distinct editable actor per source element.');
   for(const expected of source.elements){
    const row=rows.find(r=>localId(r.sourceElementId)===expected.id);
    assert(row,source.id+' source element '+expected.id);
    assert.equal(row.sourceName,expected.name);
    assert.deepEqual(row.sourceOrigin,[expected.x,expected.z]);
    assert.deepEqual(row.sourceDimensions,[expected.width,expected.depth,expected.height]);
    const center=[expected.x+expected.width/2-source.area.width/2,0,expected.z+expected.depth/2-source.area.depth/2];
    assert.deepEqual(row.sourceCenter,center,source.id+' source corner must map to its real centered footprint.');
    const actor=fixture.document.getObject(row.objectId);
    assert(actor&&actor.parent,source.id+' source actor is editable and attached.');
    assert.equal(actor.userData.practiceSourceElementId,source.id+':'+expected.id);
    assert(actor.userData.practiceSourceKey,source.id+' source provenance is retained on the actual actor.');
    assert(Array.isArray(row.actualPosition)&&row.actualPosition.length===3);
    actor.position.toArray().forEach((value,axis)=>almost(value,row.actualPosition[axis],source.id+' actor position'));
    const displaced=Math.abs(row.actualPosition[0]-center[0])>1e-6||Math.abs(row.actualPosition[2]-center[2])>1e-6;
    if(displaced)assert(typeof row.adjustmentReason==='string'&&row.adjustmentReason.trim(),source.id+' geometric changes need a documented reason.');
    assert(row.actualFootprint&&typeof row.actualFootprint==='object',source.id+' native bounds must be recorded.');
    let surfaces=0;actor.traverse(mesh=>{if(mesh.isMesh&&mesh.geometry)surfaces++;});
    assert(surfaces>0,source.id+' source actor must have an actual rendered representation.');
    count++;
   }
  }finally{native.releaseGeometry(fixture);}
 }
 assert.equal(count,392,'The audit must reach every original source layout element.');
});
