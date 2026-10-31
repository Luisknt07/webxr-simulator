import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import apiModule from '../../apps/api/server/api.js';
import storageModule from '../../apps/api/server/storage.js';
import {readContentProject} from '../../packages/project-format/index.js';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const {createApiHandler}=apiModule,{ProjectStore}=storageModule;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const empty=()=>({format:'hello-webxr-editor',version:1,imports:[],rooms:{hall:{overrides:[],additions:[]},sound:{overrides:[],additions:[]},panorama1:{overrides:[],additions:[]}},studio:{version:1,scenes:[{id:'hall',name:'Recepción'},{id:'sound',name:'Despacho'}],startRoomId:'hall'}});
function packageAt(folder){
  const descriptor=JSON.parse(fs.readFileSync(path.join(folder,'project.stproject'),'utf8')),receipt=JSON.parse(fs.readFileSync(path.join(folder,'.projection.json'),'utf8'));
  const files=receipt.files.filter(row=>/^(?:Content|Config)\/.+\.json$/.test(row.path)).map(row=>({path:row.path,data:JSON.parse(fs.readFileSync(path.join(folder,row.path),'utf8')),sha256:row.sha256}));
  return {format:'smarttwin.content-package',version:1,descriptor,files};
}
async function fixture(run,{legacy=false,modulesSetup}={}){
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'smarttwin-content-storage-'))),store=new ProjectStore({dataDir:directory}),errors=[];
  const legacyProject=legacy?store.saveProject(null,{name:'Unowned legacy',document:empty()}):null;
  const frameworkModulesRoot=modulesSetup?path.join(directory,'framework'):undefined;
  if(modulesSetup){
    for(const name of ['core','contracts','module-sdk'])fs.cpSync(path.join(ROOT,'packages',name),path.join(frameworkModulesRoot,'packages',name),{recursive:true});
    fs.mkdirSync(path.join(frameworkModulesRoot,'modules'),{recursive:true});fs.writeFileSync(path.join(frameworkModulesRoot,'modules/package.json'),JSON.stringify({type:'module'}));
    modulesSetup(frameworkModulesRoot);
  }
  const api=createApiHandler({store,frameworkModulesRoot,requireSecureCookies:false,maintenanceIntervalMs:0,onError:error=>errors.push(error)}),server=http.createServer(api);
  try{
    await api.studio.bootstrapOwner({username:'content_owner',password:'Synthetic-content-owner-123',invitationOnly:false});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
    const request=async(route,method='GET',body,cookie)=>{
      const binary=Buffer.isBuffer(body),response=await fetch(origin+route,{method,headers:{...(body===undefined?{}:{'Content-Type':binary?'application/octet-stream':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:binary?body:JSON.stringify(body)});
      return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
    };
    const owner=await request('/api/studio/login','POST',{username:'content_owner',password:'Synthetic-content-owner-123'});
    const register=async username=>{const result=await request('/api/studio/register','POST',{username,password:'Synthetic-content-member-123'});assert.equal(result.status,201);return result;};
    await run({directory,store,api,request,owner,register,legacyProject});assert.deepEqual(errors,[]);
  }finally{
    if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}api.close();
    assert.equal(path.dirname(directory),fs.realpathSync(os.tmpdir()));assert(path.basename(directory).startsWith('smarttwin-content-storage-'));fs.rmSync(directory,{recursive:true,force:true});
  }
}

test('private editor saves materialize identifiable Content maps and authorized assets without exposing host paths',async()=>fixture(async({directory,request,register,store})=>{
  const alpha=await register('content_alpha'),beta=await register('content_beta');
  const asset=await request('/api/assets','POST',Buffer.from('Synthetic owned project asset'),alpha.cookie);assert.equal(asset.status,201);
  const input=empty();input.imports.push({id:'asset-notes',path:'notes.txt',...asset.data.asset});
  const saved=await request('/api/projects','POST',{name:'Centro de distribución',document:input},alpha.cookie);assert.equal(saved.status,201,JSON.stringify(saved.data));
  const project=saved.data.project,expected='data/users/'+alpha.data.user.id+'/projects/'+project.id;
  assert.deepEqual(project.storage,{kind:'server',canonical:'sqlite',relativePath:expected,descriptorPath:expected+'/project.stproject',contentPath:expected+'/Content',mapsPath:expected+'/Content/Maps',materialized:true,contentRevision:1});
  assert.equal(JSON.stringify(project.storage).includes(directory),false);assert.equal(path.isAbsolute(project.storage.relativePath),false);
  const folder=path.join(directory,'users',alpha.data.user.id,'projects',project.id),bundle=packageAt(folder);
  assert.deepEqual(bundle.descriptor.maps.map(map=>map.id),['hall','sound']);assert.equal(bundle.descriptor.maps.length,2,'Unused preallocated rooms must not become fake Content levels.');
  assert.deepEqual(readContentProject(bundle).document,store.getProject(project.id).document);
  assert.equal(hash(fs.readFileSync(path.join(folder,'Content/Assets',asset.data.asset.sha256+'.blob'))),asset.data.asset.sha256);
  assert.equal(fs.existsSync(path.join(folder,'Engine')),false);assert.equal(fs.existsSync(path.join(folder,'node_modules')),false);
  assert.equal((await request('/api/projects/'+project.id)).status,401);assert.equal((await request('/api/projects/'+project.id,'GET',undefined,beta.cookie)).status,403);
  assert.equal((await request('/api/projects/'+project.id+'/shares','PUT',{userId:beta.data.user.id,permission:'viewer'},alpha.cookie)).status,200);
  const originalDescriptorTime=fs.statSync(path.join(folder,'project.stproject'),{bigint:true}).mtimeNs;
  const shared=await request('/api/projects/'+project.id,'GET',undefined,beta.cookie);assert.equal(shared.status,200);assert.equal(shared.data.project.storage.relativePath,expected);assert.equal(shared.data.project.access.canEdit,false);
  assert.equal(fs.statSync(path.join(folder,'project.stproject'),{bigint:true}).mtimeNs,originalDescriptorTime,'Reading an intact current Content projection must not rewrite its files.');
  assert.equal((await request('/data/users/'+alpha.data.user.id+'/projects/'+project.id+'/project.stproject')).status,404);
}));

test('current Content revisions replace managed maps atomically; historical and stale requests cannot overwrite them',async()=>fixture(async({directory,request,owner,store})=>{
  let saved=(await request('/api/projects','POST',{name:'Mapas',document:empty()},owner.cookie)).data.project;
  const folder=path.join(directory,'users',owner.data.user.id,'projects',saved.id),first=packageAt(folder),soundPath=first.descriptor.maps.find(map=>map.id==='sound').path;
  const next=structuredClone(saved.document);delete next.rooms.sound;next.studio.scenes=next.studio.scenes.filter(scene=>scene.id!=='sound');next.studio.scenes[0].name='Recepción principal';
  const response=await request('/api/projects/'+saved.id,'PUT',{name:'Mapas revisados',document:next,expectedRevision:1},owner.cookie);assert.equal(response.status,200);saved=response.data.project;
  assert.equal(saved.storage.materialized,true);assert.equal(saved.storage.contentRevision,2);assert.equal(fs.existsSync(path.join(folder,soundPath)),false);
  const current=fs.readFileSync(path.join(folder,'project.stproject'),'utf8');
  const old=await request('/api/projects/'+saved.id+'?revision=1','GET',undefined,owner.cookie);assert.equal(old.status,200);assert.equal(fs.readFileSync(path.join(folder,'project.stproject'),'utf8'),current);
  assert.equal((await request('/api/projects/'+saved.id,'PUT',{name:'Stale',document:empty(),expectedRevision:1},owner.cookie)).status,409);
  assert.equal(fs.readFileSync(path.join(folder,'project.stproject'),'utf8'),current);assert.equal(store.getProject(saved.id).revision,2);
  const parked=path.join(directory,'parked-projection');fs.renameSync(folder,parked);
  const repaired=await request('/api/projects/'+saved.id,'GET',undefined,owner.cookie);assert.equal(repaired.status,200);assert.equal(repaired.data.project.storage.materialized,true);assert.equal(store.getProject(saved.id).revision,2);assert.equal(store.listProjects().length,1);
  assert.deepEqual(readContentProject(packageAt(folder)).document,saved.document);
}));

test('projection failures preserve external edits and do not misreport a committed SQLite save as failed',async()=>fixture(async({directory,request,owner,store})=>{
  const saved=(await request('/api/projects','POST',{name:'Proyecto',document:empty()},owner.cookie)).data.project;
  const folder=path.join(directory,'users',owner.data.user.id,'projects',saved.id);fs.writeFileSync(path.join(folder,'manual-notes.txt'),'Keep local notes');
  const response=await request('/api/projects/'+saved.id,'PUT',{name:'Saved despite projection conflict',document:empty(),expectedRevision:1},owner.cookie);
  assert.equal(response.status,200);assert.equal(response.data.project.revision,2);assert.equal(response.data.project.storage.materialized,false);assert.equal(response.data.project.storage.warning,'content_modified');
  assert.equal(fs.readFileSync(path.join(folder,'manual-notes.txt'),'utf8'),'Keep local notes');assert.equal(store.getProject(saved.id).revision,2);
  const reloaded=await request('/api/projects/'+saved.id,'GET',undefined,owner.cookie);assert.equal(reloaded.status,200);assert.equal(reloaded.data.project.storage.warning,'content_modified');
  assert.equal(fs.readFileSync(path.join(folder,'manual-notes.txt'),'utf8'),'Keep local notes');
}));

test('owned content projections refuse linked project paths and leave ownerless legacy projects in SQLite',async()=>fixture(async({directory,request,owner,legacyProject,store})=>{
  const legacy=await request('/api/projects/'+legacyProject.id,'GET',undefined,owner.cookie);assert.equal(legacy.status,200);assert.equal(legacy.data.project.storage.relativePath,null);assert.equal(legacy.data.project.storage.warning,'legacy_ownerless');
  const saved=(await request('/api/projects','POST',{name:'Linked fixture',document:empty()},owner.cookie)).data.project;
  const folder=path.join(directory,'users',owner.data.user.id,'projects',saved.id),parked=path.join(directory,'projection-original'),outside=path.join(directory,'outside-user-tree');
  fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'sentinel.txt'),'unchanged');fs.renameSync(folder,parked);fs.symlinkSync(outside,folder,'junction');
  const updated=await request('/api/projects/'+saved.id,'PUT',{name:'Logical save',document:empty(),expectedRevision:1},owner.cookie);assert.equal(updated.status,200);assert.equal(updated.data.project.storage.materialized,false);assert.equal(updated.data.project.storage.warning,'projection_unavailable');
  assert.deepEqual(fs.readdirSync(outside),['sentinel.txt']);assert.equal(store.getProject(saved.id).revision,2);
},{legacy:true}));

test('framework persistence honors disabled module/function flags and stores state in independent Content packages',async()=>fixture(async({directory,request,owner})=>{
  const input=JSON.parse(fs.readFileSync(path.join(ROOT,'projects/agricultura/project.json'),'utf8'));input.modules[0].enabled=false;
  const saved=await request('/api/framework/projects','POST',{name:'Disabled agriculture',document:input},owner.cookie);assert.equal(saved.status,201,JSON.stringify(saved.data));
  const project=saved.data.project,folder=path.join(directory,'users',owner.data.user.id,'projects',project.id);
  assert.equal(project.storage.materialized,true);assert.deepEqual((await request('/api/framework/projects/'+project.id+'/commands','GET',undefined,owner.cookie)).data.commands,[]);
  const restored=readContentProject(packageAt(folder));assert.deepEqual(restored.document,input);assert.deepEqual(restored.moduleState,project.moduleState);
  const next=structuredClone(input);next.modules[0].enabled=true;next.modules[0].functions=[{id:'agriculture.harvest',enabled:false}];
  const stillDisabled=await request('/api/framework/projects/'+project.id,'PUT',{name:'Disabled function',expectedRevision:1,document:next},owner.cookie);assert.equal(stillDisabled.status,200,JSON.stringify(stillDisabled.data));
  assert.deepEqual((await request('/api/framework/projects/'+project.id+'/commands','GET',undefined,owner.cookie)).data.commands,[]);
  next.modules[0].functions=[{id:'agriculture.harvest',enabled:true}];
  const enabled=await request('/api/framework/projects/'+project.id,'PUT',{name:'Enabled function',expectedRevision:2,document:next},owner.cookie);assert.equal(enabled.status,200,JSON.stringify(enabled.data));
  assert((await request('/api/framework/projects/'+project.id+'/commands','GET',undefined,owner.cookie)).data.commands.some(row=>row.key==='agriculture.harvest:record'));
  assert.equal(enabled.data.project.storage.contentRevision,3);
}));

test('opaque framework asset claims never materialize another user private bytes',async()=>fixture(async({directory,request,owner,register})=>{
  const other=await register('content_other');
  const asset=await request('/api/assets','POST',Buffer.from('Synthetic private bytes not shared'),owner.cookie);assert.equal(asset.status,201);
  const input={format:'smarttwin.project',version:1,worldId:'world.asset-claim',modules:[],entities:[],imports:[{id:'claim',path:'private.txt',...asset.data.asset}]};
  const saved=await request('/api/framework/projects','POST',{name:'Opaque claim',document:input},other.cookie);assert.equal(saved.status,201);assert.equal(saved.data.project.storage.materialized,true);
  const folder=path.join(directory,'users',other.data.user.id,'projects',saved.data.project.id);assert.equal(fs.existsSync(path.join(folder,'Content/Assets',asset.data.asset.sha256+'.blob')),false);
  assert.deepEqual(readContentProject(packageAt(folder)).document,input,'Opaque import metadata is preserved as data rather than acquiring private asset ownership.');
  assert.equal((await request(asset.data.asset.url,'GET',undefined,other.cookie)).status,403);
}));

test('trusted browser-only functions remain opaque on the API while independent logical roots stay functional',async()=>{
  const previous=globalThis.__contentApiVisualImported;globalThis.__contentApiVisualImported=0;
  try{await fixture(async({request,owner})=>{
    const document={format:'smarttwin.project',version:1,worldId:'world.visual-api',modules:[{id:'sector.visual',version:'1.0.0',functions:['visual.scene','visual.counter']}],entities:[],grants:['platform.scene'],ports:{'platform.scene':{untrusted:true}}};
    const state={format:'smarttwin.module-state',version:1,worldId:document.worldId,functions:[{id:'visual.scene',version:'1.0.0',schemaVersion:1,data:{opaqueScene:true}},{id:'visual.counter',version:'1.0.0',schemaVersion:1,data:{count:4}}]};
    const saved=await request('/api/framework/projects','POST',{name:'Visual and logical project',document,moduleState:state},owner.cookie);
    assert.equal(saved.status,201,JSON.stringify(saved.data));const project=saved.data.project;assert.deepEqual(project.document,document);assert.deepEqual(project.moduleState,state);assert.equal(project.storage.materialized,true);assert.equal(globalThis.__contentApiVisualImported,0);
    const commands=await request('/api/framework/projects/'+project.id+'/commands','GET',undefined,owner.cookie);
    assert.deepEqual(commands.data.commands.map(row=>row.key).sort(),['visual.counter:increment','visual.counter:read']);
    assert.equal((await request('/api/framework/projects/'+project.id+'/commands','POST',{command:'visual.scene:render',payload:null,expectedRevision:1},owner.cookie)).status,403);
    const read=await request('/api/framework/projects/'+project.id+'/commands','POST',{command:'visual.counter:read',payload:null},owner.cookie);assert.equal(read.status,200);assert.equal(read.data.result,4);
    const changed=await request('/api/framework/projects/'+project.id+'/commands','POST',{command:'visual.counter:increment',payload:{delta:2},expectedRevision:1},owner.cookie);assert.equal(changed.status,200,JSON.stringify(changed.data));assert.equal(changed.data.result,6);assert.deepEqual(changed.data.project.moduleState.functions.find(row=>row.id==='visual.scene'),state.functions[0]);
    const onlyBrowser=structuredClone(document);onlyBrowser.modules[0].functions=['visual.scene'];
    const opaque=await request('/api/framework/projects/'+project.id,'PUT',{name:'Only browser root',document:onlyBrowser,expectedRevision:2},owner.cookie);assert.equal(opaque.status,200,JSON.stringify(opaque.data));assert.equal(opaque.data.project.moduleState.functions.find(row=>row.id==='visual.counter').data.count,6);
    assert.deepEqual((await request('/api/framework/projects/'+project.id+'/commands','GET',undefined,owner.cookie)).data.commands,[],'A logical dependency used only by an unsupported browser root is not unnecessarily started on the API.');assert.equal(globalThis.__contentApiVisualImported,0);
  },{modulesSetup(root){
    const write=(file,data)=>{const filename=path.join(root,file);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,typeof data==='string'?data:JSON.stringify(data));};
    const metadata=folder=>({entry:'index.js',packageRoot:'functions/'+folder,files:['index.js'],assets:[],tests:[]});
    const counter={id:'visual.counter',version:'1.0.0',provides:[{id:'world.counter',version:'1.0.0'}],metadata:metadata('counter')};
    const scene={id:'visual.scene',version:'1.0.0',requires:[{id:'visual.counter',version:'1.0.0'}],uses:[{id:'world.counter',version:'1.0.0'}],capabilities:['platform.scene'],metadata:metadata('scene')};
    write('modules/visual/manifest.json',{format:'smarttwin.sector',schemaVersion:1,id:'sector.visual',version:'1.0.0',metadata:{folder:'visual'},functions:[{...scene,entry:'functions/scene/index.js'},{...counter,entry:'functions/counter/index.js'}]});
    write('modules/visual/functions/scene/index.js','globalThis.__contentApiVisualImported++;throw Error("The API must never import this trusted browser implementation.");');
    write('modules/visual/functions/counter/index.js',`import {defineFunction} from '../../../../packages/module-sdk/index.js';export default defineFunction({...${JSON.stringify(counter)},register(scope){let state=scope.state.get()||{count:0};const read=()=>state.count;scope.provide('world.counter',{read});scope.register('commands','read',{readOnly:true,validate:input=>input===null,execute:read});scope.register('commands','increment',input=>{state={count:state.count+input.delta};scope.state.set(state);return state.count;});scope.register('server-validators','increment',{validate:input=>!!input&&Number.isInteger(input.delta)&&input.delta>0&&input.delta<=10,permissions:['visual.counter.write'],authorize:context=>context.authenticated&&context.ownerId===context.userId&&context.permissions.includes('visual.counter.write')});}});`);
  }});}finally{if(previous===undefined)delete globalThis.__contentApiVisualImported;else globalThis.__contentApiVisualImported=previous;}
});
