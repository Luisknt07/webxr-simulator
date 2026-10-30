import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {STUDY_SCENES} from '../../modules/logistica-industrial/scenarios/StudySceneCatalog.js';
import {publicSceneEntry, normalizeSceneSearch, DIFFICULTY_LABELS, MODE_LABELS} from '../../projects/smarttwin/SceneLibraryMetadata.mjs';
import {sceneEntries, filterSceneEntries, PUBLIC_SCENE} from '../../apps/public-viewer/GalleryData.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../../projects/smarttwin/scenes/catalog.json',import.meta.url),'utf8'));

test('startup library shares menu metadata and omits the replaced demo alias',()=>{
  const rows=catalog.scenes.filter(scene=>scene.id!=='vr-robot-dispatch');
  const cards=sceneEntries(catalog,true);assert.equal(cards.length,rows.length);assert.deepEqual(cards.map(card=>card.id),rows.map(scene=>scene.id));
  for(const row of rows){const expected=publicSceneEntry(row,true),card=cards.find(entry=>entry.id===row.id);for(const key of ['title','category','description','objective','tasks','difficulty','mode','searchable'])assert.deepEqual(card[key],expected[key],row.id+' shares '+key);}
  const compact=cards.filter(card=>card.category==='Realidad virtual compacta');
  assert.deepEqual(compact.map(card=>card.id),STUDY_SCENES.filter(scene=>scene.compactVR&&scene.id!=='vr-robot-dispatch').map(scene=>scene.id));assert(compact.some(card=>card.id==='vr-warehouse-missions'));
  const warehouse=compact.find(card=>card.id==='vr-warehouse-missions');assert.equal(warehouse.mode,'manual');assert.equal(warehouse.tasks.length,3);assert.match(warehouse.objective,/ubicación exacta/);
  assert.equal(cards.find(card=>card.id==='original-hall').mode,'explore');assert.equal(cards.find(card=>card.id==='original-hall').difficulty,0);
  assert.equal(MODE_LABELS.explore,'Exploración');assert.equal(DIFFICULTY_LABELS[2],'Intermedia');
});

test('public fallback is a full lesson with its only public static image; other previews remain authenticated',()=>{
  assert.equal(PUBLIC_SCENE.included,true);assert.equal(PUBLIC_SCENE.templateId,'vr-robot-transfer');assert(PUBLIC_SCENE.description&&PUBLIC_SCENE.objective&&PUBLIC_SCENE.tasks.length);
  assert.equal(PUBLIC_SCENE.title,'RV · Transferencia guiada');
  assert.equal(PUBLIC_SCENE.thumbnailURL,'projects/smarttwin/previews/vr-robot-dispatch.png');
  const cards=sceneEntries(catalog,true);for(const card of cards)assert.equal(card.thumbnailURL,card.public?'projects/smarttwin/previews/vr-robot-dispatch.png':'/workspace/projects/smarttwin/previews/'+card.id+'.png');
  assert.deepEqual(sceneEntries(catalog).map(card=>card.id),['vr-robot-dispatch']);
});

test('filters normalize accents, search tasks/objectives and preserve category, level-zero and exploration semantics',()=>{
  const cards=sceneEntries({scenes:[{id:'manual-demo',name:'Mesa',collection:'Trabajo',included:true,objective:'Evaluar trazabilidad',tasks:['Inspección del envío'],difficulty:0,mode:'explore'},{id:'other-demo',name:'Otro',collection:'Trabajo',difficulty:2,mode:'manual'}]},true);
  assert.equal(normalizeSceneSearch(' InspeCCIÓN '),'inspeccion');
  assert.deepEqual(filterSceneEntries(cards,{query:'inspeccion'}).map(card=>card.id),['manual-demo']);assert.deepEqual(filterSceneEntries(cards,{query:'TRAZABILIDAD'}).map(card=>card.id),['manual-demo']);
  assert.deepEqual(filterSceneEntries(cards,{category:'Trabajo',difficulty:'0',mode:'explore'}).map(card=>card.id),['manual-demo']);
  assert.equal(filterSceneEntries(cards,{category:'Trabajo',difficulty:'2',mode:'manual'}).length,1);assert.equal(filterSceneEntries(cards,{category:'Wrong'}).length,0);
});

test('thumbnail addresses and displayed fields never trust URLs or malformed metadata from a catalogue',()=>{
  const entries=sceneEntries({scenes:[{id:'vr-robot-turn',included:true,url:'https://evil.invalid/scene',thumbnailURL:'javascript:evil()',thumbnail:'https://evil.invalid/p.png',name:'<img src=x onerror=evil()>',description:'<script>evil()</script>',tasks:['Valid',{},4],mode:{toString:{}},roomId:{toString:{}}},{id:'../secret',included:true},{id:{toString:{}}}]},true);
  const card=entries.find(entry=>entry.id==='vr-robot-turn');assert.equal(card.thumbnailURL,'/workspace/projects/smarttwin/previews/vr-robot-turn.png');assert.equal(card.name,'<img src=x onerror=evil()>');assert.equal(card.description,'<script>evil()</script>');assert.deepEqual(card.tasks,['Valid']);assert.equal(card.mode,'mixed');
  for(const key of ['url','thumbnail','scene'])assert(!(key in card));assert.equal(entries.length,2);
  assert.equal(sceneEntries({scenes:Array.from({length:128},(_,i)=>({id:'private-'+i,name:'Scene'}))},true).length,128,'The fallback does not exceed the bounded card budget.');
  const source=fs.readFileSync(new URL('../../projects/smarttwin/SceneLibraryMetadata.mjs',import.meta.url),'utf8');const imports=[...source.matchAll(/^import .* from ['"]([^'"]+)/gm)].map(match=>match[1]);assert.deepEqual(imports,['../../modules/logistica-industrial/scenarios/StudySceneCatalog.js']);
  const library=fs.readFileSync(new URL('../../packages/tools/editor/src/PublicSceneLibrary.js',import.meta.url),'utf8');assert.match(library,/SceneLibraryMetadata\.mjs/);assert(!library.includes('StudySceneCatalog.js'));
});
