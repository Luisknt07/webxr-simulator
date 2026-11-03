import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')(),catalog=require('../../modules/logistica-industrial/contracts/resourceCatalog.js');
const source=fs.readFileSync(new URL('../../packages/tools/editor/src/ResourcePresetConfiguration.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export default .*;\r?\n?/gm,'').replace(/^export /gm,'');
const presets=new Function('createIndustrialPrefab','schema',source+'\nreturn {describe,normalize,createConfiguredPrefab,applyToObject};')(native.createIndustrialPrefab,native.schema);
const resource=id=>{const row=catalog.RESOURCES.find(value=>value.id===id);assert(row,id);return row;};
function release(root){const geometry=new Set(),materials=new Set(),textures=new Set();root.traverse(node=>{if(node.geometry)geometry.add(node.geometry);for(const m of(Array.isArray(node.material)?node.material:[node.material]).filter(Boolean)){materials.add(m);for(const k of Object.keys(m))if(m[k]&&m[k].isTexture)textures.add(m[k]);}});textures.forEach(v=>v.dispose());materials.forEach(v=>v.dispose());geometry.forEach(v=>v.dispose());}

test('resource presets expose the actual machine defaults and only supported native configuration',()=>{
 for(const id of ['library:storage.rack','library:vehicle.forklift','library:vehicle.industrial','library:conveyor.straight','library:product.box']){
  const row=resource(id),description=presets.describe(row),actual=native.createIndustrialPrefab(row.action.kind,row.action.variant);
  try{const base=actual.userData.editorDefaultBehaviors.find(value=>value.type===row.action.kind);assert(description.fields.length>=4,id);for(const field of description.fields){assert.equal(description.values[field.key],base[field.key]);assert.equal(field.value,base[field.key]);}assert(!description.fields.some(field=>/Id$|rules|running|powered|output/i.test(field.key)));if(row.action.kind==='palletQueue')assert(!description.fields.some(field=>field.key==='withPanel'));}finally{release(actual);}
 }
 assert.deepEqual(presets.describe({action:{type:'workspace'}}),{fields:[],values:{}});
});

test('untrusted settings cannot inject variants, connections, scripts or unsafe numerical values',()=>{
 const row=resource('library:storage.rack');
 for(const bad of [{rackBays:99},{rackBays:1.2},{rackBayWidth:NaN},{rackLevels:Infinity},{variant:'drive-in'},{outputId:'other'},{running:true},{__proto__:null,constructor:'unsafe'},JSON.parse('{"__proto__":{"polluted":true}}'),Object.create({rackBays:2})])assert.throws(()=>presets.normalize(row,bad));
 assert.equal({}.polluted,undefined);assert.throws(()=>presets.normalize(row,{rackBays:'2'}));
 const robot=resource('library:vehicle.industrial');assert.throws(()=>presets.normalize(robot,{tool:'unknown'}));assert.throws(()=>presets.normalize(robot,{withPanel:'false'}));
});

test('every configurable catalogue variant accepts its own real native defaults',()=>{
 let configured=0;
 for(const row of catalog.RESOURCES){const description=presets.describe(row);if(!description.fields.length)continue;configured++;assert.doesNotThrow(()=>presets.normalize(row,description.values),row.id);}
 assert(configured>250,'The matrix must cover both native and generated equipment variants.');
});

test('mobile carriers never advertise arm tooling merely because they share the robot runtime',()=>{
 for(const row of catalog.RESOURCES.filter(row=>/^equipment\.(vehicle|mobile)\./.test(row.catalogueEquipmentId||'')&&row.action.kind==='robot')){
  const description=presets.describe(row);assert(!description.fields.some(field=>['reach','tool','panelDesign','pendantDesign'].includes(field.key)),row.id);
  assert.throws(()=>presets.normalize(row,{tool:'gripper'}),row.id);
 }
 assert(presets.describe(resource('library:vehicle.industrial')).fields.some(field=>field.key==='tool'));
});

test('reading native defaults releases private geometry without disposing the shared industrial atlas',()=>{
 const counters={shared:0,private:0,geometry:0,material:0},shared={isTexture:true,userData:{sharedIndustrialTexture:true},dispose(){counters.shared++;}},owned={isTexture:true,dispose(){counters.private++;}};
 const creator=()=>({userData:{editorDefaultBehaviors:[{type:'conveyor',length:3,width:1,supportHeight:1,speed:.4}]},traverse(fn){fn({geometry:{dispose(){counters.geometry++;}},material:{map:shared,normalMap:owned,dispose(){counters.material++;}}});}});
 const inspected=new Function('createIndustrialPrefab','schema',source+'\nreturn {describe};')(creator,native.schema);inspected.describe({id:'private-default-inspection',action:{type:'prefab',kind:'conveyor',variant:'roller-motor'}});
 assert.deepEqual(counters,{shared:0,private:1,geometry:1,material:1});
});

test('configured previews use the same native mechanism as insertion without mutating catalogue presets',()=>{
 for(const [id,patch]of [['library:storage.rack',{rackBays:3,rackLevels:2,rackBayWidth:3.4}],['library:vehicle.forklift',{forkLength:1.2,payloadKg:2200}],['library:conveyor.straight',{length:5.5,width:1.2}]]){
  const row=resource(id),before=JSON.stringify(row),object=presets.createConfiguredPrefab(row,patch);
  try{const actual=object.userData.editorDefaultBehaviors.find(value=>value.type===row.action.kind);for(const [key,value]of Object.entries(patch))assert.equal(actual[key],value,id+'/'+key);assert.equal(JSON.stringify(row),before);}finally{release(object);}
 }
});

test('new configured rack instances remain independent, undoable and persist through the real project validator',async()=>{
 const fixture=native.fixture(),restored=native.fixture(),row=resource('library:storage.rack'),patch={rackBays:3,rackLevels:2,rackBayWidth:3.4};
 try{
  const existing=fixture.document.addPrefab('hall','palletQueue','selective'),original=JSON.stringify(fixture.document.getBehaviors(existing));
  fixture.document.begin();const object=fixture.document.addPrefab('hall',row.action.kind,row.action.variant);presets.applyToObject(fixture.document,object,row,patch);fixture.document.commit();
  const id=object.userData.editorId;assert.equal(JSON.stringify(fixture.document.getBehaviors(existing)),original);
  const config=fixture.document.getBehaviors(object).find(value=>value.type==='palletQueue');for(const [key,value]of Object.entries(patch))assert.equal(config[key],value);
  const saved=native.validateDocument(await fixture.document.serialize(),value=>value);await restored.document.load(saved);const reopened=restored.document.getBehaviors(restored.document.getObject(id)).find(value=>value.type==='palletQueue');for(const [key,value]of Object.entries(patch))assert.equal(reopened[key],value);
  fixture.document.undo();assert.equal(fixture.document.getObject(id),null);assert(fixture.document.getObject(existing.userData.editorId));fixture.document.redo();assert(fixture.document.getObject(id));
 }finally{native.releaseGeometry(fixture);native.releaseGeometry(restored);}
});
