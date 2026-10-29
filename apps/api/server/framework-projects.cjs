'use strict';
// Generic framework persistence is separate from the legacy scene document.
// Every loader below is application-owned; project JSON is data, never code.
const {randomUUID}=require('node:crypto');
const {ApiError,plain,safeTree}=require('./validation.js');
const MAX_BYTES=16*1024*1024;
const fail=(status,message,code)=>{throw new ApiError(status,message,code);};
let trustedModules;
function trusted(){
 if(!trustedModules)trustedModules=Promise.all([import('../../../packages/core/index.js'),import('../../../packages/contracts/index.js'),import('../../../tooling/modules/discover.mjs')]).then(([core,contracts,discovery])=>({core,contracts,discovery}));
 return trustedModules;
}
function encoded(value){safeTree(value);const text=JSON.stringify(value);if(Buffer.byteLength(text)>MAX_BYTES)fail(413,'El proyecto modular supera 16 MiB.','payload_too_large');return text;}
function projectName(value){if(typeof value!=='string'||!value.trim()||value.length>120||/[\u0000-\u001f]/.test(value))fail(400,'El nombre de proyecto no es válido.','invalid_request');return value.trim();}
function expectedRevision(value){if(!Number.isSafeInteger(value)||value<1)fail(400,'Falta una revisión esperada válida.','expected_revision_required');return value;}
function frameworkError(error){if(error instanceof ApiError)return error;if(error&&error.name==='FrameworkError')return new ApiError(['inventory_conflict','state_migration_required'].includes(error.code)?409:422,error.message,error.code);return error;}
class FrameworkProjects {
 constructor(service){
  this.service=service;this.db=service.db;
  this.db.exec(`CREATE TABLE IF NOT EXISTS framework_projects (
   id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES studio_users(id), name TEXT NOT NULL,
   revision INTEGER NOT NULL CHECK(revision>0), document TEXT NOT NULL, module_state TEXT NOT NULL,
   created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS framework_projects_owner ON framework_projects(owner_id,updated_at);`);
 }
 actor(req,write=false){const user=write?this.service.requireEditor(req):this.service.user(req);this.service._expectedUser(req,user);return user;}
 row(user,id){const row=this.db.prepare('SELECT * FROM framework_projects WHERE id=? AND owner_id=?').get(id,user.id);if(!row)fail(404,'El proyecto no existe.','not_found');return row;}
 result(row,user,full=true){return {id:row.id,name:row.name,revision:row.revision,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString(),access:{role:'owner',canEdit:!!user&&user.id===row.owner_id&&user.role==='creator'},...(full?{document:JSON.parse(row.document),moduleState:JSON.parse(row.module_state)}:{})};}
 transaction(callback){this.db.exec('BEGIN IMMEDIATE');try{const result=callback();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 async prepare(document,moduleState){
  const {core,contracts,discovery}=await trusted(),discovered=discovery.discoverLocalModules({root:this.service.frameworkModulesRoot}),{catalog}=discovered;
  const localModules=new Map(discovered.modules.map(value=>[value.id,value]));
  const project=contracts.validateProject(document),state=contracts.validateState(moduleState===undefined?{format:contracts.STATE_FORMAT,version:1,worldId:project.worldId,functions:[]}:moduleState);
  if(state.worldId!==project.worldId)fail(422,'El estado pertenece a otro mundo.','world_mismatch');
  const host=core.createHost({catalog,worldId:project.worldId,ports:{},grants:[]});
  try{
   host.importState(state);const stateById=new Map(state.functions.map(value=>[value.id,value]));
   for(const selection of project.modules){
    const installed=catalog.getModule(selection.id);
    // Unknown versions and future state remain opaque, with no loader invoked.
    if(!installed||installed.version!==selection.version)continue;
    const local=localModules.get(selection.id),functions=selection.functions===undefined?local.defaultFunctions.concat(local.imports.map(value=>value.id)):selection.functions;
    const plan=catalog.plan(selection.id,functions);
    if(plan.functions.some(entry=>{const saved=stateById.get(entry.id);return saved&&(saved.version!==entry.version||saved.schemaVersion!==entry.stateVersion);} ))continue;
    await host.activate(selection.id,{functions});
   }
   const inspection=host.inspectProject(project);
   for(const entry of inspection.components)if(entry.status==='ready')host.readComponent(entry.component);
   return {host,document:inspection.project,moduleState:host.exportState(),components:inspection.components.map(entry=>({entityId:entry.entityId,type:entry.component.type,status:entry.status}))};
  }catch(error){await host.dispose({force:true});throw frameworkError(error);}
 }
 async save(req,id,payload){
  const actor=this.actor(req,true);if(!plain(payload))fail(400,'Se esperaba un proyecto JSON.','invalid_request');
  const name=projectName(payload.name),previous=id?this.row(actor,id):null,expected=id?expectedRevision(payload.expectedRevision):null;
  if(previous&&previous.revision!==expected)fail(409,'El proyecto cambió. Recarga su revisión.','revision_conflict');
  const state=payload.moduleState===undefined&&previous?JSON.parse(previous.module_state):payload.moduleState;
  const prepared=await this.prepare(payload.document,state);
  try{
   const document=encoded(prepared.document),moduleState=encoded(prepared.moduleState);
   if(Buffer.byteLength(document)+Buffer.byteLength(moduleState)>MAX_BYTES)fail(413,'El proyecto y su estado superan 16 MiB.','payload_too_large');
   return this.transaction(()=>{
    const current=this.actor(req,true);if(current.id!==actor.id)fail(409,'La cuenta cambió.','session_changed');
    const now=this.service.now(),projectId=id||randomUUID();
    if(id){const row=this.row(current,id);if(row.revision!==expected)fail(409,'El proyecto cambió. Recarga su revisión.','revision_conflict');this.db.prepare('UPDATE framework_projects SET name=?,document=?,module_state=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?').run(name,document,moduleState,now,id,current.id,expected);}
    else this.db.prepare('INSERT INTO framework_projects VALUES(?,?,?,1,?,?,?,?)').run(projectId,current.id,name,document,moduleState,now,now);
    this.service.access.checkQuota(current.id);return this.result(this.row(current,projectId),current);
   });
  }finally{await prepared.host.dispose({force:true});}
 }
 async commands(req,id,payload,metadataOnly=false){
  const actor=this.actor(req),row=this.row(actor,id),prepared=await this.prepare(JSON.parse(row.document),JSON.parse(row.module_state));
  try{
   const commands=prepared.host.registry('commands'),validators=new Map(prepared.host.registry('server-validators').map(entry=>[entry.key,entry.value]));
   const descriptor=entry=>typeof entry.value==='function'?{execute:entry.value}:entry.value;
   const isRead=entry=>descriptor(entry)?.readOnly===true;
   if(metadataOnly){this.actor(req);return {commands:commands.map(entry=>({key:entry.key,functionId:entry.functionId,readOnly:isRead(entry),canExecute:isRead(entry)||actor.role==='creator'&&typeof validators.get(entry.key)?.validate==='function'&&typeof validators.get(entry.key)?.authorize==='function'}))};}
   if(!plain(payload)||typeof payload.command!=='string'||payload.command.length>240)fail(400,'El comando no es válido.','invalid_request');
   const entry=commands.find(entry=>entry.key===payload.command);if(!entry)fail(403,'Este comando no pertenece a la selección activa.','framework_command_denied');
   const readonly=isRead(entry),validator=validators.get(entry.key),expected=readonly?null:expectedRevision(payload.expectedRevision);
   if(!readonly){this.actor(req,true);if(row.revision!==expected)fail(409,'El proyecto cambió. Recarga su revisión.','revision_conflict');if(!validator||typeof validator.validate!=='function'||typeof validator.authorize!=='function')fail(403,'El comando no tiene una política de servidor instalada.','framework_command_denied');}
   let input=payload.payload===undefined?null:payload.payload;encoded(input);
   const validate=validator&&validator.validate||descriptor(entry).validate;
   if(readonly&&!validate&&input!==null)fail(422,'La lectura sin esquema sólo admite datos nulos.','invalid_command_data');
   if(validate){const validated=validate(input);if(validated===false)fail(422,'Los datos del comando no son válidos.','invalid_command_data');if(validated&&typeof validated==='object')input=validated;}
   const permissions=validator?.permissions===undefined?[]:validator.permissions;
   if(!Array.isArray(permissions)||permissions.length>128||permissions.some(value=>typeof value!=='string'||!/^[a-z][a-z0-9.-]{0,179}$/.test(value)))fail(403,'La política local de permisos no es válida.','framework_command_denied');
   if(!readonly&&validator.authorize(Object.freeze({authenticated:true,userId:actor.id,ownerId:row.owner_id,projectId:id,permissions:Object.freeze([...permissions])}))!==true)fail(403,'El servidor no autoriza este comando.','framework_command_denied');
   const {contracts}=await trusted(),result=contracts.cloneData(await prepared.host.dispatch(entry.key,input));
   if(readonly){this.row(this.actor(req),id);return {result,revision:row.revision,readOnly:true};}
   const moduleState=encoded(prepared.host.exportState());
   return this.transaction(()=>{const current=this.actor(req,true),latest=this.row(current,id);if(current.id!==actor.id||latest.revision!==expected)fail(409,'El proyecto cambió. Recarga su revisión.','revision_conflict');this.db.prepare('UPDATE framework_projects SET module_state=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?').run(moduleState,this.service.now(),id,current.id,expected);this.service.access.checkQuota(current.id);return {result,project:this.result(this.row(current,id),current),revision:expected+1,readOnly:false};});
  }catch(error){throw frameworkError(error);}finally{await prepared.host.dispose({force:true});}
 }
 async handle(req,res,pathname){
  if(!/^\/framework\/projects(?:\/|$)/.test(pathname))return false;
  const parts=pathname.split('/').filter(Boolean),method=req.method,send=(status,value)=>this.service.json(res,status,value,method);
  const actor=this.actor(req); // Authentication precedes all resource lookups.
  const body=async()=>{const data=await this.service.readBody(req,MAX_BYTES,'El proyecto modular supera 16 MiB.');safeTree(data);if(!plain(data))fail(400,'Se esperaba un objeto JSON.','invalid_request');return data;};
  try{
   if(parts.length===2&&method==='GET'){send(200,{projects:this.db.prepare('SELECT id,owner_id,name,revision,created_at,updated_at FROM framework_projects WHERE owner_id=? ORDER BY updated_at DESC,id LIMIT 200').all(actor.id).map(row=>this.result(row,actor,false))});return true;}
   if(parts.length===2&&method==='POST'){this.actor(req,true);send(201,{project:await this.save(req,null,await body())});return true;}
   const id=parts[2];if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(id))fail(404,'Ruta no encontrada.','not_found');
   if(parts.length===3&&method==='GET'){send(200,{project:this.result(this.row(actor,id),actor)});return true;}
   if(parts.length===3&&method==='PUT'){this.actor(req,true);send(200,{project:await this.save(req,id,await body())});return true;}
   if(parts.length===3&&method==='DELETE'){this.actor(req,true);const expected=expectedRevision((await body()).expectedRevision);this.transaction(()=>{const row=this.row(this.actor(req,true),id);if(row.revision!==expected)fail(409,'El proyecto cambió.','revision_conflict');this.db.prepare('DELETE FROM framework_projects WHERE id=? AND owner_id=? AND revision=?').run(id,actor.id,expected);});send(200,{ok:true});return true;}
   if(parts.length===4&&parts[3]==='commands'&&['GET','POST'].includes(method)){send(200,await this.commands(req,id,method==='POST'?await body():null,method==='GET'));return true;}
   fail(404,'Ruta no encontrada.','not_found');
  }catch(error){throw frameworkError(error);}
 }
}
module.exports={FrameworkProjects,MAX_BYTES};
