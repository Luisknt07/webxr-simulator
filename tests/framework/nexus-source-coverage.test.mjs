import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const folder=path.join(root,'modules/logistica-industrial/practices');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const proof=read(path.join(root,'tests/fixtures/nexus-independent-source-proof.json'));
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const datasets=proof.sources.map(source=>({source,data:read(path.join(folder,'data/source-'+(source.kind==='equipment'?'equipment':'practices')+'.json'))}));

test('new sources retain all 9,595 paragraph texts, 550 tables and 334 image references from independent OOXML evidence',()=>{
 let paragraphs=0,tables=0,references=0;
 for(const {source,data}of datasets){
  assert.equal(data.namespace,source.namespace);assert.equal(data.source.sha256,source.source.sha256);assert.equal(data.source.bytes,source.source.bytes);
  assert.equal(data.paragraphs.length,source.counts.paragraphs);assert.equal(data.tables.length,source.counts.tables);assert.equal(data.diagrams.length,source.counts.imageReferences);
  assert.equal(hash(data.paragraphs.map(p=>({id:p.id,text:p.text,headingLevel:p.headingLevel,imageIds:p.imageIds||[]}))),source.paragraphSha256,'Every original paragraph, including blanks, headings and prompt text, is preserved.');
  assert.equal(hash(data.tables.map(t=>({id:t.id,rows:t.rows}))),source.tableSha256,'Every original table cell is preserved, not summarized away.');
  assert.equal(hash(data.diagrams.map(d=>({id:d.sourceImageId,paragraphId:d.paragraphId,sourceMedia:d.sourceMedia}))),source.diagramSha256,'Image reuse is preserved as distinct source references.');
  paragraphs+=data.paragraphs.length;tables+=data.tables.length;references+=data.diagrams.length;
 }
 assert.equal(paragraphs,9595);assert.equal(tables,550);assert.equal(references,334);
});

test('189 equipment headings and 64 practices have source-proven names and identifiers in separate namespaces',()=>{
 for(const {source,data}of datasets){
  assert.equal(data.records.length,source.records.length);assert.deepEqual(data.records.map(r=>({id:r.id,title:r.title,headingId:r.provenance.headingId})),source.records);
  const keys=new Set();for(const record of data.records){assert.equal(record.key,source.namespace+':'+record.id);assert(!keys.has(record.key));keys.add(record.key);assert.equal(record.provenance.sourceSha256,source.source.sha256);}
 }
 const equipment=datasets[0].data;assert.equal(equipment.records.length,189);assert.equal(new Set(equipment.records.map(r=>r.familyId)).size,11);
 for(const record of equipment.records){assert.equal(record.fields.length,6);assert.equal(new Set(record.fields.map(f=>f.name)).size,6);for(const field of record.fields){assert(field.text&&field.provenance.paragraphIds.length);assert(field.provenance.paragraphIds.every(id=>equipment.paragraphs.some(p=>p.id===id)));}}
 const old=require('../../modules/logistica-industrial/documentation/index.cjs');assert.equal(old.entries.length,198,'This new source does not overwrite the delivered 198-card edition.');
 const oldTR=old.entries.find(r=>r.id==='TR-03'||r.id==='TR-3'),newTR=equipment.records.find(r=>r.id==='TR-03');assert(oldTR&&newTR);assert.notEqual(newTR.title,oldTR.title,'TR-03 really has a different meaning in the new edition.');assert.equal(newTR.canonicalId,null,'Reusing a short source ID does not inherit a native equipment binding.');
});

test('64 practices preserve 384 source steps, 192 cases, modes, layouts and source-only implementation status',()=>{
 const data=datasets[1].data;assert.equal(data.records.length,64);assert.equal(data.records.filter(r=>r.domain==='logistics').length,32);assert.equal(data.records.filter(r=>r.domain==='manufacturing').length,32);
 let steps=0,cases=0;for(const record of data.records){
  assert.equal(record.enabled,false);assert.equal(record.implementationStatus,'source-requirements-only');assert.equal(record.steps.length,6);assert.equal(record.cases.length,3);assert.equal(record.modes.length,3);assert(record.objective.text&&record.initialConditions&&record.incident);
  assert.deepEqual(record.steps.map(s=>s.number),[1,2,3,4,5,6]);record.steps.forEach(s=>{assert(s.action&&s.expectedEvidence&&s.provenance.tableId);assert.equal(s.eventBinding,null,'Document prose alone cannot invent an evaluated runtime event.');});
  assert.deepEqual(record.cases.map(c=>c.id),['A','B','C']);record.cases.forEach(c=>assert(c.condition&&c.verifiableAchievement&&c.provenance.tableId));assert(record.layout&&record.layout.referenceNotice);assert(record.sourcePrompts.length);steps+=record.steps.length;cases+=record.cases.length;
 }
 assert.equal(steps,384);assert.equal(cases,192);
});

test('333 declared private images are exact original bytes, independently hashed and path bounded',()=>{
 const manifest=read(path.join(folder,'assets/manifest.json')),expected=proof.sources.flatMap(s=>s.media);assert.equal(manifest.format,'smarttwin.nexus-source-assets');assert.equal(manifest.files.length,333);assert.equal(expected.length,333);
 const seen=new Set();let bytes=0;for(const reference of expected){
  assert(!seen.has(reference.path));seen.add(reference.path);assert(!reference.path.includes('..')&&!path.isAbsolute(reference.path));const entry=manifest.files.find(f=>f.path===reference.path);assert(entry,reference.path);assert.equal(entry.sha256,reference.sha256);assert.equal(entry.bytes,reference.bytes);assert.equal(entry.sourceMedia,reference.sourceMedia);
  const absolute=path.resolve(folder,'assets',entry.path);assert(absolute.startsWith(path.resolve(folder,'assets')+path.sep));const raw=fs.readFileSync(absolute);assert.equal(raw.length,reference.bytes);assert.equal(hash(raw),reference.sha256);assert(entry.references.length&&entry.width>0&&entry.height>0);bytes+=raw.length;
 }
 assert.equal(bytes,15225230);assert.equal(manifest.totalBytes,bytes);
 for(const {data}of datasets)for(const image of data.diagrams){assert.equal(image.delivery,'declared-private-workspace');assert(image.src.startsWith('modules/logistica-industrial/practices/assets/'+data.namespace+'/'));assert(seen.has(image.src.replace('modules/logistica-industrial/practices/assets/','')));}
});

test('cold indexes load no full sources/books; lazy books show six sections per card and retain source tables and diagrams',()=>{
 const cold=execFileSync(process.execPath,['-e',"require('./modules/logistica-industrial/practices/data/equipment-index.cjs');require('./modules/logistica-industrial/practices/data/practice-index.cjs');console.log(JSON.stringify(Object.keys(require.cache)));"],{cwd:root,encoding:'utf8'});
 assert(!JSON.parse(cold).some(p=>/source-(?:equipment|practices)\.json|(?:equipment|practice)-book\.cjs|source-book-adapter/.test(p)));
 for(const {source,data}of datasets){
  const index=require(path.join(folder,'data',source.kind+'-index.cjs')),book=require(path.join(folder,'documentation',source.kind+'-book.cjs'));
  assert.equal(index.entries.length,data.records.length);assert(!('paragraphs'in index)&&!('tables'in index));assert.equal(book.ARTICLES.length,data.records.length+1);assert(book.ARTICLES.some(a=>a.id===source.namespace+':source-guide'&&a.sections.length));
  for(const record of data.records){const entry=index.entries.find(e=>e.key===record.key),article=book.ARTICLES.find(a=>a.id===record.key);assert(entry&&article);assert.equal(article.sections.length,6);assert.equal(article.provenance.sourceSha256,source.source.sha256);assert.deepEqual(article.sourceTableIds,record.tableIds);assert.deepEqual(article.sourceTables,record.tableIds.map(id=>data.tables.find(t=>t.id===id)));assert.equal(article.implementationStatus,'source-requirements-unverified');assert.deepEqual(article.resourceLinks,[],'A source article is not an executable insertion privilege.');}
  const images=[];for(const article of book.ARTICLES){if(article.illustration)images.push(article.illustration.src);for(const section of article.sections)for(const block of section.blocks)if(block.type==='image')images.push(block.src);}for(const diagram of data.diagrams)assert(images.includes(diagram.src),'Every diagram has a readable place in the lazy book.');
 }
});

test('embedded document prompts remain inert content and never authorize implementation or source ID reuse',()=>{
 for(const {source,data}of datasets){assert.deepEqual(data.instructionPolicy,{sourcePromptsAreData:true,executeSourcePrompts:false,sourceDoesNotProveImplementation:true,oldIdentifierBindingsMustNotBeReused:true});assert.equal(source.source.originalModified,false);assert.equal(data.source.documentInstructionsAreData,true);assert.equal(data.source.executable,false);assert.equal(data.source.implementationStatus,'unverified-source-requirements');}
});
