import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const proof=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/practice-campaign-source-layouts.json'),'utf8'));
const source=require('../../modules/logistica-industrial/practices/data/source-practices.json');
const index=require('../../modules/logistica-industrial/practices/data/practice-index.cjs');
const clean=value=>String(value).replace(/\s+/g,' ').trim();

test('campaign source proof independently preserves both original DOCX identities and all ordered practice names',()=>{
 assert.equal(proof.format,'smarttwin.independent-practice-campaign-source');
 assert.equal(proof.sourceInstructionsAreData,true);
 assert.equal(proof.sources[0].sha256,source.source.sha256);
 assert.equal(proof.sources[0].bytes,source.source.bytes);
 assert.equal(proof.sources[1].sha256,require('../../modules/logistica-industrial/practices/data/source-equipment.json').source.sha256);
 const ordered=['L','I'].flatMap(prefix=>Array.from({length:32},(_,i)=>prefix+String(i+1).padStart(2,'0')));
 assert.deepEqual(proof.practices.map(p=>p.id),ordered);
 assert.deepEqual(index.entries.map(p=>({id:p.id,title:clean(p.title)})),proof.practices.map(p=>({id:p.id,title:p.title})));
 assert.equal(proof.practices[0].title,'Cita de llegada y orden de recepción');
 assert.equal(proof.practices[32].title,'Llegada de materias primas a la fábrica');
});

test('392 source layout objects retain one-to-one identities, physical dimensions and the same local coordinate mapping',()=>{
 let count=0;
 for(const p of proof.practices){
  const actual=index.entries.find(entry=>entry.id===p.id);
  assert.deepEqual(actual.layout.area,p.area,p.id);
  assert.equal(new Set(p.elements.map(e=>e.id)).size,p.elements.length,p.id);
  assert.equal(actual.layout.elements.length,p.elements.length,p.id);
  actual.layout.elements.forEach((e,i)=>{
   const expected=p.elements[i];
   assert.deepEqual({id:e.id,name:clean(e.name),x:e.origin2d.x,z:e.origin2d.y,...e.dimensions},expected,p.id+' element '+e.id);
   for(const key of ['x','z','width','depth','height'])assert(Number.isFinite(expected[key]),p.id+' '+key);
   for(const key of ['width','depth','height'])assert(expected[key]>0,p.id+' '+key);
   assert.equal(e.worldMapping,'x->x, y->z');
  });
  count+=p.elements.length;
 }
 assert.equal(count,392);
});

test('the three practice modes retain their exact actions and eligible equipment instead of legacy scene autoplay labels',()=>{
 const names=['Manual / mecanizada','Semiautomatizada','Automatizada'];
 for(const p of proof.practices){
  const actual=index.entries.find(entry=>entry.id===p.id);
  assert.deepEqual(p.modes.map(m=>m.name),names,p.id);
  assert.deepEqual(actual.modes.map(m=>({name:clean(m.name),variants:clean(m.eligibleVariants),actions:clean(m.actions)})),p.modes,p.id);
  assert(p.modes.every(m=>m.variants&&m.actions));
 }
});

test('all 384 ordered source actions, evidence statements and 192 case conditions remain readable, distinct source requirements',()=>{
 let steps=0,cases=0;
 for(const p of proof.practices){
  const actual=index.entries.find(entry=>entry.id===p.id);
  assert.equal(p.steps.length,6,p.id);assert.equal(p.cases.length,3,p.id);
  assert.deepEqual(actual.steps.map(s=>({title:clean(s.title),action:clean(s.action),evidence:clean(s.expectedEvidence)})),p.steps,p.id);
  assert.deepEqual(actual.cases.map(c=>({name:clean(c.name),condition:clean(c.condition),achievement:clean(c.verifiableAchievement)})),p.cases,p.id);
  p.steps.forEach((s,i)=>{assert.match(s.title,new RegExp('^0'+(i+1)+' · '));assert(s.action&&s.evidence);});
  steps+=p.steps.length;cases+=p.cases.length;
 }
 assert.equal(steps,384);assert.equal(cases,192);
});

test('the receiving-appointment practice describes yard and appointment evidence before physical receipt of goods',()=>{
 const l01=proof.practices[0];
 assert.deepEqual(l01.steps.map(s=>s.title),['01 · Consultar la cita','02 · Registrar el arribo','03 · Comprobar capacidad','04 · Asignar destino','05 · Gestionar excepción','06 · Entregar al muelle']);
 assert.match(l01.steps[1].action,/sin dar por recibida la mercancía/);
 assert.deepEqual(l01.elements.map(e=>e.name),['Camión','Control de acceso','Espera asignada','Muelle','Puesto de recepción','Paso peatonal']);
 assert.deepEqual(l01.area,{width:36,depth:24});
 assert.equal(l01.elements.find(e=>e.id==='04').x,28);
 assert.equal(l01.elements.find(e=>e.id==='04').z,5);
});
