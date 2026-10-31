import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createContentProject, readContentProject, serializeContentFile, validateContentPath, contentPackageFromFiles, contentHash, CONTENT_PROJECT_FILE} from '../../packages/project-format/index.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const digest=value=>createHash('sha256').update(value).digest('hex');
const studio=()=>({format:'hello-webxr-editor',version:1,rooms:{hall:{overrides:[],additions:[]},sound:{overrides:[],additions:[{id:'truck-1',position:[0,0,0],unknown:{functionId:'future.feature',data:{keep:true}}}]},panorama1:{overrides:[],additions:[]}},imports:[{id:'asset-1',name:'sample.bin',path:'external/sample.bin',url:'/api/assets/'+'a'.repeat(64),sha256:'a'.repeat(64),mime:'application/octet-stream',size:4}],studio:{scenes:[{id:'sound',name:'Recepción'}],startRoomId:'sound',modules:[{id:'sector.logistics-industrial',version:'1.0.0',enabled:true}],missions:[{id:'mission-1',roomId:'sound',source:'truck-1'}]},extension:{future:[{id:'missing-module',payload:{code:'globalThis.contentExecuted=true'}}]}});
const framework=()=>({format:'smarttwin.project',version:1,id:'project.farm',worldId:'world.farm',modules:[{id:'sector.agriculture',version:'1.0.0',functions:['agriculture.harvest']},{id:'sector.future',version:'9.0.0',optional:true,enabled:false}],entities:[{id:'unknown-entity',components:[{functionId:'future.feature',functionVersion:'9.0.0',type:'future.feature:settings',schemaVersion:5,data:{reference:'unknown-target',message:'keep me'}}]}],extension:{retain:true}});
const rehash=(file,bundle)=>{file.sha256=digest(JSON.stringify(file.data));if(bundle)bundle.descriptor.files.find(row=>row.path===file.path).sha256=file.sha256;};

test('portable integrity SHA-256 matches known vectors, block boundaries and Unicode UTF-8',()=>{
  for(const text of ['', 'abc','a'.repeat(55),'a'.repeat(56),'a'.repeat(64),'a'.repeat(65),'ñ árbol 👩🏽‍🚒','a'.repeat(1000000)])assert.equal(contentHash(text),digest(text));
  assert.equal(contentHash(new Uint8Array([0,1,254,255])),digest(Buffer.from([0,1,254,255])));
});
test('studio project splits actual levels and assets from engine code with lossless full document roundtrip',()=>{
  const input=studio(),bundle=createContentProject(input,{id:'project-123',name:'Mi almacén',revision:7,kind:'studio'});
  assert.equal(CONTENT_PROJECT_FILE,'project.stproject');assert.equal(bundle.descriptor.id,'project-123');assert.equal(bundle.descriptor.revision,7);
  assert.deepEqual(bundle.descriptor.maps.map(level=>({id:level.id,name:level.name,path:level.path})),[{id:'sound',name:'Recepción',path:'Content/Maps/sound.level.json'}]);
  assert.deepEqual(bundle.files.map(file=>file.path),['Content/Maps/sound.level.json','Content/Assets/asset-1.asset.json','Config/Project.json']);
  assert.equal(bundle.descriptor.assets[0].blobPath,'Content/Assets/'+'a'.repeat(64)+'.blob');
  for(const file of bundle.files)assert.equal(digest(serializeContentFile(file)),file.sha256);
  const restored=readContentProject(bundle);assert.deepEqual(restored.document,input);assert.deepEqual(Object.keys(restored.document.rooms),Object.keys(input.rooms));
  assert.equal(globalThis.contentExecuted,undefined);assert(Object.isFrozen(restored.document.extension));assert.deepEqual(input,studio(),'Splitting must not mutate the active document.');
});
test('only actual levels are listed while empty/deleted room slots and cross-level references remain exact',()=>{
  const input=studio();input.studio.deletedScenes=['sound'];input.studio.scenes.push({id:'panorama1',name:'Expedición'});input.studio.startRoomId='panorama1';
  const bundle=createContentProject(input,{id:'project-123',name:'Niveles'});
  assert.deepEqual(bundle.descriptor.maps.map(row=>row.id),['panorama1']);assert.deepEqual(readContentProject(bundle).document,input);
  const native={format:'hello-webxr-editor',version:1,rooms:{hall:{overrides:[],additions:[]},sound:{overrides:[],additions:[]}},imports:[]};
  assert.deepEqual(createContentProject(native).descriptor.maps.map(row=>row.id),['hall']);
  native.studio={environments:[{roomId:'sound',sky:'native'}]};assert.deepEqual(createContentProject(native).descriptor.maps.map(row=>row.id),['sound']);
});
test('editing a map data file applies only that level and preserves configuration, other slots and asset references',()=>{
  const input=studio(),bundle=clone(createContentProject(input));const file=bundle.files.find(file=>file.path==='Content/Maps/sound.level.json');
  file.data.data.additions[0].position=[2,3,4];rehash(file,bundle);
  const restored=readContentProject(bundle).document;
  assert.deepEqual(restored.rooms.sound.additions[0].position,[2,3,4]);assert.deepEqual(restored.rooms.hall,input.rooms.hall);assert.deepEqual(restored.studio,input.studio);assert.deepEqual(restored.imports,input.imports);
});
test('portable editor assets may exceed the contracts default one-MiB string limit without losing bytes',()=>{
  const input=studio();input.imports=[{id:'portable',name:'model.glb',dataUrl:'data:model/gltf-binary;base64,'+'A'.repeat(1100000)}];
  const bundle=createContentProject(input);assert.deepEqual(readContentProject(bundle).document,input);assert.equal(bundle.descriptor.assets[0].blobPath,undefined);
});
test('framework projects and modular session state retain opaque missing-module payloads exactly',()=>{
  const project=framework(),moduleState={format:'future-state',version:8,functions:[{id:'future.feature',unknown:[1,2,3]}]};
  const bundle=createContentProject(project,{kind:'framework',moduleState});
  assert.deepEqual(bundle.descriptor.maps.map(row=>row.id),['main']);assert.equal(bundle.descriptor.stateFile,'Config/ModuleState.json');
  const restored=readContentProject(bundle);assert.deepEqual(restored.document,project);assert.deepEqual(restored.moduleState,moduleState);
  const session={format:'smarttwin.project-session',version:1,project,state:{format:'smarttwin.module-state',version:1,worldId:'world.farm',functions:[]},pausedModules:['sector.agriculture'],allowOptionalMissing:true};
  assert.deepEqual(readContentProject(createContentProject(session)).document,session);
});
test('editor module profiles expose their actual editor/viewer selections in the independent descriptor',()=>{
  const input=studio();delete input.studio.modules;input.studio.moduleProfile={version:1,mode:'mixed',selectedModuleId:'',modules:[{id:'sector.agriculture',version:'1.0.0',editorEnabled:true,viewerEnabled:false,functions:['agriculture.harvest']},{id:'sector.logistics-industrial',version:'1.0.0',editorEnabled:false,viewerEnabled:true}],state:{futureState:true}};
  const bundle=createContentProject(input);assert.deepEqual(bundle.descriptor.modules,input.studio.moduleProfile.modules);assert.deepEqual(readContentProject(bundle).document,input);
});
test('materialized JSON files reconstruct the package using the recognized descriptor',()=>{
  const bundle=createContentProject(studio());const files=bundle.files.map(file=>({...file,data:JSON.parse(serializeContentFile(file))}));
  assert.deepEqual(readContentProject(contentPackageFromFiles(clone(bundle.descriptor),files)).document,studio());
});
test('integrity mismatches, omissions, duplicates, extra files and metadata disagreement reject before reconstruction',()=>{
  const original=createContentProject(studio());
  let bad=clone(original);bad.files[0].data.data.additions[0].position[0]=9;assert.throws(()=>readContentProject(bad),{code:'content_hash'});
  bad=clone(original);bad.files.pop();assert.throws(()=>readContentProject(bad),{code:'content_missing'});
  bad=clone(original);bad.files.push({...bad.files[0],path:bad.files[0].path.toUpperCase().replace('CONTENT/','Content/')});assert.throws(()=>readContentProject(bad),{code:'content_duplicate'});
  bad=clone(original);const data={message:'not declared'},extra={path:'Content/extra.json',data,sha256:digest(JSON.stringify(data))};bad.files.push(extra);bad.descriptor.files.push({path:extra.path,sha256:extra.sha256});assert.throws(()=>readContentProject(bad),{code:'content_extra'});
  bad=clone(original);bad.descriptor.maps[0].name='Wrong label';assert.throws(()=>readContentProject(bad),{code:'content_schema'});
  bad=clone(original);bad.descriptor.assets[0].blobPath='Content/Assets/private.blob';assert.throws(()=>readContentProject(bad),{code:'content_schema'});
  bad=clone(original);bad.descriptor.modules=[];assert.throws(()=>readContentProject(bad),{code:'content_schema'});
});
test('unsafe paths, reserved identifiers, prototype keys, incompatible versions and code-shaped extras never execute',()=>{
  for(const path of ['../secret','Content/../private.json','Content/C:/secret','Content/maps%2fprivate.json','Content\\Maps\\bad.json','/Content/Maps/bad.json','Content/NUL.json','Content/Maps/<bad>.json','Content/Maps/a.json.','Content/Maps/a.json ','Source/run.js'])assert.throws(()=>validateContentPath(path),{code:'content_path'});
  assert.throws(()=>createContentProject(JSON.parse('{"format":"hello-webxr-editor","version":1,"rooms":{"__proto__":{}},"imports":[]}')),{code:'unsafe_key'});
  const bad=clone(createContentProject(studio()));bad.descriptor.engine.api='^9.0.0';assert.throws(()=>readContentProject(bad),{code:'content_engine'});
  const reserved=clone(createContentProject(studio()));reserved.descriptor.maps[0].id='__proto__';assert.throws(()=>readContentProject(reserved),{code:'content_schema'});
  assert.throws(()=>createContentProject(studio(),{kind:'framework'}),{code:'content_schema'});assert.equal(globalThis.contentExecuted,undefined);
});
test('file identities remain stable when project or level display labels change',()=>{
  const first=studio(),second=studio();second.studio.scenes[0].name='Otro nombre';
  const a=createContentProject(first,{name:'Primero'}),b=createContentProject(second,{name:'Segundo'});
  assert.equal(a.descriptor.maps[0].path,b.descriptor.maps[0].path);assert.equal(a.descriptor.assets[0].path,b.descriptor.assets[0].path);
});
