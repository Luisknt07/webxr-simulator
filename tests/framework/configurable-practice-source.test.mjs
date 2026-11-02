import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const BASE=path.join(ROOT,'modules/logistica-industrial/practices/configurable');
const proof=JSON.parse(fs.readFileSync(path.join(ROOT,'tests/fixtures/configurable-practice-source-proof.json'),'utf8'));
const source=JSON.parse(fs.readFileSync(path.join(BASE,'data/source.json'),'utf8'));
const index=JSON.parse(fs.readFileSync(path.join(BASE,'data/index.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(BASE,'assets/manifest.json'),'utf8'));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const digest=value=>hash(JSON.stringify(value));
const MODE_KEYS={M:'manual',S:'semiautomatic',A:'automatic'};
const numeric=value=>Number(value.trim().replaceAll(',','.'));

test('the new authored source contains exactly ten integrated practices, sixty steps and thirty mode-specific inventories',()=>{
 assert.equal(source.format,'smarttwin.configurable-practice-source');assert.deepEqual(source.records.map(row=>row.id),proof.ids);
 assert.deepEqual(index.records.map(row=>row.id),proof.ids);assert.equal(source.records.filter(row=>row.domain==='logistics').length,5);assert.equal(source.records.filter(row=>row.domain==='industrial').length,5);
 for(const record of source.records){
  assert.deepEqual(record.steps.map(step=>step.number),[1,2,3,4,5,6]);assert.equal(new Set(record.steps.map(step=>step.id)).size,6);
  assert(record.objective&&record.fixtureText&&record.result&&record.indicators&&record.casesText&&record.allowedChanges&&record.continuity&&record.minimumTest);
  assert.deepEqual(Object.keys(record.modes),['manual','semiautomatic','automatic']);
  for(const mode of Object.values(record.modes)){assert(mode.name&&mode.actorsText&&mode.changeText);assert(mode.equipment.length);assert.equal(new Set(mode.equipment.map(row=>row.alias)).size,mode.equipment.length);}
 }
 assert.deepEqual(source.sources.map(row=>[row.filename,row.sha256]),Object.entries(proof.sourceHashes));
 assert.equal(source.coverage.equipmentRows,255);assert.equal(source.coverage.promptGuideDifferences,0);
});

test('all 255 mode-specific equipment rows match the independently extracted original DOCX tables, including centers rather than corners',()=>{
 let rows=0;
 for(const expected of proof.modeTables){
  const record=source.records.find(row=>row.id===expected.practiceId),mode=record.modes[MODE_KEYS[expected.mode]];
  assert.equal(mode.code,expected.mode);assert.equal(mode.equipment.length,expected.rows.length);
  for(let i=0;i<expected.rows.length;i++){
   const cells=expected.rows[i],actual=mode.equipment[i],match=cells[1].match(/^(.*) · (\d+)$/),point=cells[2].match(/^\(([^;]+); ([^)]+)\)$/),footprint=cells[3].split(' × ').map(numeric);
   assert(match&&point);assert.equal(actual.alias,cells[0]);assert.equal(actual.name,match[1]);assert.equal(actual.count,Number(match[2]));assert.deepEqual(actual.center,[numeric(point[1]),numeric(point[2])]);assert.deepEqual(actual.footprint,footprint);assert.equal(actual.componentsText,cells[4]);
   assert.equal(actual.provenance.guideTableId,expected.tableId);assert.equal(actual.provenance.guideRow,i+1);assert(Number.isInteger(actual.provenance.promptLine));rows++;
  }
 }
 assert.equal(rows,255);assert.equal(source.common.coordinateSystem.equipmentPosition,'center-of-footprint');
 assert.equal(source.records.find(row=>row.id==='CEDI-01').modes.manual.equipment[0].center[0],-5,'Truck yards must retain source coordinates outside the interior.');
 assert(!source.records.find(row=>row.id==='CEDI-01').modes.manual.equipment.some(row=>row.alias==='E09'),'Manual does not silently load the AGV.');
 assert(!source.records.find(row=>row.id==='CEDI-02').modes.automatic.equipment.some(row=>row.alias==='E08'),'Automatic configuration removes the source-declared manual replenishment pallet truck.');
});

test('all original narrative and complete guide paragraphs/tables survive without treating embedded instructions as executable behavior',()=>{
 const corpus=[source.common.masterText,...source.records.map(row=>row.sourceText)].join('\n');assert.equal(digest(corpus.split(/\r?\n/).map(line=>line.trim()).filter(Boolean)),proof.promptNonemptyLinesDigest);
 assert.equal(source.sourceEvidence.paragraphs.length,proof.guideParagraphs.count);assert.equal(digest(source.sourceEvidence.paragraphs),proof.guideParagraphs.digest);assert.equal(source.sourceEvidence.tables.length,proof.guideTables.count);assert.equal(digest(source.sourceEvidence.tables),proof.guideTables.digest);
 const paragraphs=new Map(source.sourceEvidence.paragraphs.map(row=>[row.id,row]));
 const references=source.common.guideParagraphIds.concat(source.records.flatMap(row=>row.sourceRefs.guideParagraphIds));assert.equal(new Set(references).size,references.length);assert.deepEqual(new Set(references),new Set(paragraphs.keys()));
 const tableIds=source.common.guideTableIds.concat(source.records.flatMap(row=>row.sourceRefs.guideTableIds));assert.equal(new Set(tableIds).size,36);assert.deepEqual(new Set(tableIds),new Set(source.sourceEvidence.tables.map(row=>row.id)));
 for(const record of source.records)for(const step of record.steps)assert.equal(paragraphs.get(step.provenance.guideParagraphId).text,`${step.number}. ${step.title}. ${step.action}`);
 assert(source.common.instructionPolicy.includes('inert'));assert.equal(source.common.difficultyLevels.length,3);assert(source.common.difficultyLevels[0].description.includes('sin fallos aleatorios'));assert.equal(source.common.configurationSelectors.length,8);assert.equal(source.common.verificationCriteria.length,12);
 assert(!source.records.find(row=>row.id==='SF-05').sourceRefs.guideParagraphIds.includes('p01935'),'Global rubric is common context, not fabricated as an SF-05-specific paragraph.');
});

test('thirty authored route polylines retain their synthetic reference measures and never claim runtime clearance or total mission time',()=>{
 let count=0;
 for(const record of source.records){
  assert(record.interiorArea.width>0&&record.interiorArea.depth>0);assert.equal(record.interiorArea.yardSeparate,true);
  for(const code of ['M','S','A']){const route=record.routes[code];let length=0;for(let i=1;i<route.points.length;i++)length+=Math.hypot(route.points[i][0]-route.points[i-1][0],route.points[i][1]-route.points[i-1][1]);assert(Math.abs(length-route.referenceMeasure.nominal_m)<=.051);assert(Math.abs(length-route.computedPolylineM)<1e-6);assert.equal(route.referenceMeasure.assumed_speed_m_s,.8);assert(Math.abs(length/.8-route.referenceMeasure.free_travel_lower_bound_s)<=.051);assert(route.provenance.includes('not collision-validated'));assert(route.provenance.includes('not a mission-time'));count++;}
 }
 assert.equal(count,30);
});

test('forty original diagram bytes and their exact OOXML relationships map once to process and M/S/A layouts using a bounded PNG receipt',()=>{
 assert.equal(manifest.format,'smarttwin.configurable-practice-assets');assert.equal(manifest.files.length,40);assert.equal(new Set(manifest.files.map(row=>row.path)).size,40);assert.equal(new Set(manifest.files.map(row=>row.sourceRelationshipId)).size,40);
 let bytes=0;
 for(const expected of proof.figures){
  const item=manifest.files.find(row=>row.sourceRelationshipId===expected.relationshipId);assert(item);for(const key of ['practiceId','kind','mode','sourceMediaPath','filename','bytes','sha256'])assert.equal(item[key],expected[key]);
  assert(/^images\/image\d+\.png$/.test(item.path));const file=path.resolve(BASE,'assets',item.path);assert(file.startsWith(path.resolve(BASE,'assets')+path.sep));const data=fs.readFileSync(file);assert.equal(data.length,item.bytes);assert.equal(hash(data),item.sha256);assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(data.readUInt32BE(16),item.width);assert.equal(data.readUInt32BE(20),item.height);bytes+=data.length;
  const record=source.records.find(row=>row.id===expected.practiceId),diagram=expected.kind==='process'?record.diagrams.process:record.diagrams.layouts[expected.mode];assert.equal(diagram.path,item.path);assert.equal(diagram.sha256,item.sha256);assert(diagram.src.endsWith('/assets/'+item.path));assert(diagram.alt);
 }
 assert.equal(manifest.totalBytes,bytes);assert(manifest.access.includes('workspace-private'));assert(!JSON.stringify(manifest).includes('Downloads'));assert(!manifest.files.some(row=>/\.(?:docx|txt|js|py)$/i.test(row.path)));
});

test('the runtime index remains thin and excludes source documents, bulk tables, image binaries and manufacturing code',()=>{
 assert(fs.statSync(path.join(BASE,'data/index.json')).size<15000);assert(!('sourceEvidence' in index));assert(!('masterText' in index));for(const record of index.records){assert(!('sourceText' in record));assert(!('equipment' in record));assert(!('code' in record));assert.equal(record.modes.length,3);}
});
