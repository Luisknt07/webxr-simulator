import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),THREE=require('three');
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const fixtureFile=path.join(ROOT,'tests/legacy/test-cad-document.js');
const fixtureSource=fs.readFileSync(fixtureFile,'utf8');
const {setup,descriptor,expected,localMatrix}=new Function('require','__dirname',fixtureSource.slice(0,fixtureSource.indexOf('async function run()'))+'\nreturn {setup,descriptor,expected,localMatrix};')(createRequire(fixtureFile),path.dirname(fixtureFile));
const near=(a,b)=>a.elements.forEach((value,index)=>assert(Math.abs(value-b.elements[index])<1e-7,'Attached frame transform differs at '+index));

test('mounted native equipment parts follow their actual frame, save/reload and detach without jumping when the owner is removed',async()=>{
  const doc=setup(),actor=doc.addPrefab('hall','processor'),targetId=actor.userData.editorId;
  doc.setTransform(actor,{position:[1,1,-2],rotation:[0,.5,0]});
  const piece=doc.addCAD('hall',{...descriptor,attachment:{targetId,part:'frame',position:[.2,.25,.3]}});
  const local=localMatrix(piece).clone(),initial=JSON.parse(JSON.stringify(doc._state(piece)));
  for(let n=0;n<80;n++){
    doc.setTransform(actor,{position:[1+n*.01,1,-2],rotation:[0,.5+n*.015,0]});
    doc.syncCADAttachments();near(piece.matrix,expected(doc,piece,actor));
    assert.deepEqual(doc._state(piece),initial,'Following the frame cannot accumulate offset changes.');
  }
  const saved=await doc.serialize();require('../../apps/api/server/validation').validateDocument(saved,value=>value);
  const restored=setup();await restored.load(saved);
  const newActor=restored.getObject(targetId),newPiece=restored.getObject(piece.userData.editorId);
  near(localMatrix(newPiece),local);near(newPiece.matrix,expected(restored,newPiece,newActor));
  assert.deepEqual(await restored.serialize(),saved);
  const before=piece.matrix.clone();doc.remove(actor);doc.syncCADAttachments();near(piece.matrix,before);
  doc.undo();doc.syncCADAttachments();near(piece.matrix,expected(doc,piece,actor));
});

test('frame attachments reject missing, foreign-level, descendant and CAD anchors; cabin/forks remain vehicle-specific',()=>{
  const doc=setup(),owner=doc.addPrefab('hall','processor'),foreign=doc.addPrefab('sound','processor');
  const bind=(targetId,part='frame')=>doc.addCAD('hall',{...descriptor,attachment:{targetId,part,position:[0,0,0]}});
  const count=doc.additions.size;
  for(const targetId of ['missing',foreign.userData.editorId,owner.userData.editorId+'/0'])assert.throws(()=>bind(targetId),/equipo/);
  for(const part of ['forks','cabin'])assert.throws(()=>bind(owner.userData.editorId,part),/vehículo/);
  assert.equal(doc.additions.size,count,'Invalid anchors cannot partially author an object.');
  const piece=bind(owner.userData.editorId);assert.throws(()=>bind(piece.userData.editorId),/equipo/);
  const vehicle=doc.addPrefab('hall','vehicle','forklift-electric-4w');
  for(const part of ['frame','forks','cabin'])assert.doesNotThrow(()=>bind(vehicle.userData.editorId,part));
});
