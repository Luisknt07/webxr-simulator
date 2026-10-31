import {cloneData, deepFreeze, plain, validateProject, versionSatisfies, CORE_API_VERSION, fail} from '../contracts/index.js';
import {contentHash} from './sha256.js';
export {contentHash} from './sha256.js';

export const CONTENT_PACKAGE_FORMAT='smarttwin.content-package';
export const CONTENT_PROJECT_FORMAT='smarttwin.content-project';
export const CONTENT_LEVEL_FORMAT='smarttwin.level';
export const CONTENT_PROJECT_FILE='project.stproject';
export const CONTENT_LIMITS=Object.freeze({files:10000,levels:256,assets:8192,totalBytes:512*1024*1024,fileBytes:384*1024*1024});
const jsonOptions={maxString:384*1024*1024,maxNodes:1000000,maxDepth:60};
const copy=value=>cloneData(value,jsonOptions);
const text=(value,label,maximum=180)=>{if(typeof value!=='string'||!value.trim()||value.length>maximum||/[\0-\x1f\x7f]/.test(value))fail('content_schema',`Invalid ${label}.`);return value;};
const stem=value=>/^[a-z][a-z0-9_-]{0,99}$/.test(value)?value:(value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,65)||'item')+'-'+contentHash(value).slice(0,12);
const json=value=>JSON.stringify(value);
const byteLength=value=>new TextEncoder().encode(value).length;

export function validateContentPath(value) {
  if(typeof value!=='string'||!value||value.length>500||/[\\:%?#<>"|*\0-\x1f\x7f]/.test(value)||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..'||part.endsWith('.')||part.endsWith(' ')||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))fail('content_path','Only portable, bounded relative Content/Config paths are allowed.');
  if(!/^(?:Content|Config)\//.test(value))fail('content_path','Content files must remain below Content/ or Config/.');
  return value;
}
export function serializeContentFile(file) {
  if(!plain(file)||!Object.hasOwn(file,'data'))fail('content_schema','A content file needs JSON data.');
  return json(copy(file.data));
}
function assetReference(record,index) {
  if(!plain(record))fail('content_schema','An imported asset must be an object.');
  const id=record.id===undefined?'asset-'+index:text(record.id,'asset id',240);
  const result={id,path:'Content/Assets/'+stem(id)+'.asset.json'};
  if(record.sha256!==undefined){
    if(typeof record.sha256!=='string'||!/^[a-f0-9]{64}$/.test(record.sha256))fail('content_schema','An asset hash must be SHA-256.');
    result.sha256=record.sha256;result.blobPath='Content/Assets/'+record.sha256+'.blob';
  }
  return result;
}
function addFile(files,path,data){
  validateContentPath(path);const source=json(data),size=byteLength(source);
  if(size>CONTENT_LIMITS.fileBytes)fail('content_limit','A content file exceeds 384 MiB.');
  files.push({path,data,sha256:contentHash(source)});
}
function documentKind(document,kind){
  const detected=document.format==='hello-webxr-editor'?'studio':document.format==='smarttwin.project'?'framework':document.format==='smarttwin.project-session'?'session':null;
  if(!detected||kind!==undefined&&kind!==detected)fail('content_schema','Unsupported document kind.');
  if(detected==='studio'&&(document.version!==1||!plain(document.rooms)||document.imports!==undefined&&!Array.isArray(document.imports)))fail('content_schema','Invalid editor document envelope.');
  if(detected==='framework')validateProject(document);
  if(detected==='session'){
    if(document.version!==1||!plain(document.project))fail('content_schema','Invalid modular session envelope.');
    validateProject(document.project);
  }
  return detected;
}
function projectModules(document,kind){
  if(kind==='framework')return copy(document.modules);if(kind==='session')return copy(document.project.modules);
  const studio=plain(document.studio)?document.studio:{},profile=plain(studio.moduleProfile)?studio.moduleProfile:{};
  return Array.isArray(profile.modules)?copy(profile.modules):Array.isArray(studio.modules)?copy(studio.modules):[];
}
function levelId(value){text(value,'level id',240);if(['__proto__','prototype','constructor'].includes(value))fail('content_schema','Reserved level identifier.');return value;}
function studioNames(document){
  const scenes=plain(document.studio)&&Array.isArray(document.studio.scenes)?document.studio.scenes:[],names=new Map();
  for(const row of scenes){if(!plain(row))fail('content_schema','Invalid level label.');levelId(row.id);text(row.name,'level name',160);if(names.has(row.id))fail('content_duplicate','Duplicate level label.');names.set(row.id,row.name);}
  return names;
}
function actualStudioLevels(document){
  const studio=plain(document.studio)?document.studio:{},deleted=new Set(Array.isArray(studio.deletedScenes)?studio.deletedScenes:[]),authored=new Set(studioNames(document).keys());
  deleted.forEach(levelId);
  const result=new Set();
  for(const [id,room] of Object.entries(document.rooms)){
    levelId(id);if(deleted.has(id))continue;
    if(authored.has(id)||(Array.isArray(room.additions)&&room.additions.length)||(Array.isArray(room.overrides)&&room.overrides.length)||['environments','entities','spawns','widgets','missions','groups'].some(key=>Array.isArray(studio[key])&&studio[key].some(row=>plain(row)&&row.roomId===id)))result.add(id);
  }
  if(!result.size){const initial=Object.hasOwn(document.rooms,studio.startRoomId)&&!deleted.has(studio.startRoomId)?studio.startRoomId:Object.keys(document.rooms).find(id=>!deleted.has(id));if(initial)result.add(initial);}
  return result;
}

/** Split a supported project document into data files. Engine/runtime code is
 * never embedded or imported by a content project; original extension data is
 * retained so older editor and missing-module payloads survive the roundtrip. */
export function createContentProject(input,options={}) {
  const document=copy(input);if(!plain(document))fail('content_schema','A project document must be an object.');
  const kind=documentKind(document,options.kind),base=copy(document),files=[],maps=[],assets=[],unusedRooms={},roomOrder=[];
  const id=text(options.id===undefined?(kind==='session'?document.project.id||document.project.worldId:document.id||document.worldId||'project.local'):options.id,'project id',240);
  const name=text(options.name===undefined?document.title||document.name||'Proyecto WebXR':options.name,'project name',160);
  if(kind==='studio'){
    const names=studioNames(document);
    const actual=actualStudioLevels(document);
    for(const [levelId,data] of Object.entries(document.rooms)){
      roomOrder.push(levelId);if(!plain(data))fail('content_schema','A level must be a JSON object.');
      if(!actual.has(levelId)){unusedRooms[levelId]=data;continue;}
      const path='Content/Maps/'+stem(levelId)+'.level.json',name=typeof names.get(levelId)==='string'?text(names.get(levelId),'level name',160):levelId;
      maps.push({id:levelId,name,path});addFile(files,path,{format:CONTENT_LEVEL_FORMAT,version:1,id:levelId,name,kind,data});
    }
    delete base.rooms;
    if(Object.hasOwn(document,'imports')){
      document.imports.forEach((record,index)=>{const reference=assetReference(record,index);assets.push(reference);addFile(files,reference.path,record);});delete base.imports;
    }
  }else{
    const target=kind==='session'?base.project:base,source=kind==='session'?document.project:document;
    maps.push({id:'main',name:'Nivel principal',path:'Content/Maps/main.level.json'});
    addFile(files,maps[0].path,{format:CONTENT_LEVEL_FORMAT,version:1,id:'main',name:'Nivel principal',kind,data:{entities:source.entities}});delete target.entities;
  }
  if(maps.length>CONTENT_LIMITS.levels||assets.length>CONTENT_LIMITS.assets)fail('content_limit','The project contains too many levels or assets.');
  const descriptor={format:CONTENT_PROJECT_FORMAT,version:1,id,name,kind,engine:{id:'smarttwin',api:'^'+CORE_API_VERSION},contentRoot:'Content',projectFile:'Config/Project.json',maps,assets,modules:projectModules(document,kind)};
  if(options.revision!==undefined){if(!Number.isSafeInteger(options.revision)||options.revision<0)fail('content_schema','Invalid project revision.');descriptor.revision=options.revision;}
  const layout={format:'smarttwin.project-data',version:1,kind,document:base,split:{maps:true,imports:kind==='studio'&&Object.hasOwn(document,'imports')}};
  if(kind==='studio'){layout.unusedRooms=unusedRooms;layout.split.roomOrder=roomOrder;}
  addFile(files,descriptor.projectFile,layout);
  if(options.moduleState!==undefined){descriptor.stateFile='Config/ModuleState.json';addFile(files,descriptor.stateFile,copy(options.moduleState));}
  descriptor.files=files.map(file=>({path:file.path,sha256:file.sha256}));
  const bundle={format:CONTENT_PACKAGE_FORMAT,version:1,descriptor,files};
  readContentProject(bundle);return deepFreeze(bundle);
}

/** Validate an imported data package before callers touch paths, assets or the
 * active editor. It never imports code or treats a filename as an instruction. */
export function readContentProject(input) {
  const bundle=copy(input);
  if(!plain(bundle)||bundle.format!==CONTENT_PACKAGE_FORMAT||bundle.version!==1||!plain(bundle.descriptor)||!Array.isArray(bundle.files)||bundle.files.length>CONTENT_LIMITS.files)fail('content_schema','Invalid Content project package.');
  const descriptor=bundle.descriptor;
  if(descriptor.format!==CONTENT_PROJECT_FORMAT||descriptor.version!==1||!['studio','framework','session'].includes(descriptor.kind)||descriptor.contentRoot!=='Content'||descriptor.projectFile!=='Config/Project.json'||!plain(descriptor.engine)||descriptor.engine.id!=='smarttwin'||!Array.isArray(descriptor.maps)||descriptor.maps.length>CONTENT_LIMITS.levels||!Array.isArray(descriptor.assets)||descriptor.assets.length>CONTENT_LIMITS.assets||!Array.isArray(descriptor.modules)||!Array.isArray(descriptor.files)||descriptor.files.length>CONTENT_LIMITS.files)fail('content_schema','Invalid project descriptor.');
  text(descriptor.id,'project id',240);text(descriptor.name,'project name',160);
  if(!versionSatisfies(CORE_API_VERSION,descriptor.engine.api))fail('content_engine','The project requires another framework API version.');
  if(descriptor.revision!==undefined&&(!Number.isSafeInteger(descriptor.revision)||descriptor.revision<0))fail('content_schema','Invalid project revision.');
  const declared=new Map();
  for(const entry of descriptor.files){if(!plain(entry)||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256))fail('content_schema','Invalid descriptor file manifest.');validateContentPath(entry.path);if(declared.has(entry.path.toLowerCase()))fail('content_duplicate','Duplicate descriptor file path.');declared.set(entry.path.toLowerCase(),entry);}
  const files=new Map(),names=new Set();let total=0;
  for(const file of bundle.files){
    if(!plain(file)||!Object.hasOwn(file,'data')||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256))fail('content_schema','Invalid JSON content file.');
    validateContentPath(file.path);const lower=file.path.toLowerCase();if(names.has(lower))fail('content_duplicate','Content paths must be distinct on Windows and Linux.');names.add(lower);
    const source=json(file.data),size=byteLength(source);total+=size;
    if(size>CONTENT_LIMITS.fileBytes||total>CONTENT_LIMITS.totalBytes)fail('content_limit','Project content exceeds the package budget.');
    if(contentHash(source)!==file.sha256)fail('content_hash','A content file does not match its SHA-256.');
    const expected=declared.get(lower);if(!expected||expected.path!==file.path||expected.sha256!==file.sha256)fail('content_hash','Content data and the descriptor file manifest disagree.');files.set(file.path,file);
  }
  if(declared.size!==files.size)fail('content_missing','The descriptor and content file inventory disagree.');
  const consumed=new Set(),read=path=>{validateContentPath(path);const file=files.get(path);if(!file)fail('content_missing','A declared content file is missing: '+path);if(consumed.has(path))fail('content_duplicate','A content file is declared twice.');consumed.add(path);return file.data;};
  const config=read(descriptor.projectFile);
  if(!plain(config)||config.format!=='smarttwin.project-data'||config.version!==1||config.kind!==descriptor.kind||!plain(config.document)||!plain(config.split)||config.split.maps!==true||typeof config.split.imports!=='boolean')fail('content_schema','Invalid project configuration.');
  const document=copy(config.document),levels=[],levelIds=new Set(),roomData=new Map();
  if(descriptor.kind==='studio'){if(Object.hasOwn(document,'rooms')||Object.hasOwn(document,'imports')&&config.split.imports)fail('content_schema','Split content cannot also remain in the project configuration.');document.rooms={};}
  else if((descriptor.kind==='session'?!plain(document.project)||Object.hasOwn(document.project,'entities'):Object.hasOwn(document,'entities'))||config.split.imports||descriptor.assets.length||descriptor.maps.length!==1)fail('content_schema','Invalid modular level layout.');
  for(const reference of descriptor.maps){
    if(!plain(reference))fail('content_schema','Invalid level reference.');levelId(reference.id);text(reference.name,'level name',160);validateContentPath(reference.path);
    if(!reference.path.startsWith('Content/Maps/')||!reference.path.endsWith('.level.json')||levelIds.has(reference.id))fail('content_duplicate','Invalid or duplicate level reference.');levelIds.add(reference.id);
    const level=read(reference.path);
    if(!plain(level)||level.format!==CONTENT_LEVEL_FORMAT||level.version!==1||level.kind!==descriptor.kind||level.id!==reference.id||level.name!==reference.name||!plain(level.data))fail('content_schema','Level metadata and descriptor disagree.');
    if(descriptor.kind==='studio')roomData.set(level.id,copy(level.data));
    else{if(level.id!=='main'||!Array.isArray(level.data.entities)||Object.keys(level.data).some(key=>key!=='entities'))fail('content_schema','Invalid modular reference level.');(descriptor.kind==='session'?document.project:document).entities=copy(level.data.entities);}
    levels.push({...reference,data:copy(level.data)});
  }
  if(descriptor.kind==='studio'){
    if(!plain(config.unusedRooms)||!Array.isArray(config.split.roomOrder)||config.split.roomOrder.length>CONTENT_LIMITS.levels||new Set(config.split.roomOrder).size!==config.split.roomOrder.length)fail('content_schema','Invalid preserved room-slot layout.');
    for(const [id,data] of Object.entries(config.unusedRooms)){levelId(id);if(roomData.has(id)||!plain(data))fail('content_schema','Invalid or duplicate preserved room slot.');roomData.set(id,copy(data));}
    if(roomData.size!==config.split.roomOrder.length)fail('content_schema','Room slots and their original order disagree.');
    for(const id of config.split.roomOrder){levelId(id);if(!roomData.has(id))fail('content_schema','The room order references a missing slot.');document.rooms[id]=roomData.get(id);}
  }
  const imports=[],assetIds=new Set();
  for(const reference of descriptor.assets){
    if(!plain(reference))fail('content_schema','Invalid asset reference.');text(reference.id,'asset id',240);validateContentPath(reference.path);
    if(!reference.path.startsWith('Content/Assets/')||!reference.path.endsWith('.asset.json')||assetIds.has(reference.id))fail('content_duplicate','Invalid or duplicate asset reference.');assetIds.add(reference.id);
    const record=read(reference.path);if(!plain(record))fail('content_schema','Invalid imported asset metadata.');
    const expected=assetReference(record,imports.length);
    if(expected.id!==reference.id||expected.path!==reference.path||expected.sha256!==reference.sha256||expected.blobPath!==reference.blobPath)fail('content_schema','Asset metadata and descriptor disagree.');imports.push(copy(record));
  }
  if(config.split.imports)document.imports=imports;else if(descriptor.assets.length)fail('content_schema','Assets are not declared in the project layout.');
  let moduleState;
  if(descriptor.stateFile!==undefined){if(descriptor.stateFile!=='Config/ModuleState.json')fail('content_path','Module state has a fixed configuration path.');moduleState=copy(read(descriptor.stateFile));}
  if(consumed.size!==files.size)fail('content_extra','The package contains undeclared content files.');
  documentKind(document,descriptor.kind);
  if(json(projectModules(document,descriptor.kind))!==json(descriptor.modules))fail('content_schema','Module settings and the project descriptor disagree.');
  return deepFreeze({document,descriptor,levels,files:bundle.files,...(descriptor.stateFile===undefined?{}:{moduleState})});
}

/** Convert a materialized folder's descriptor and JSON file records back to the
 * browser-transfer package shape. Files are still validated on read. */
export function contentPackageFromFiles(descriptor,files){const bundle={format:CONTENT_PACKAGE_FORMAT,version:1,descriptor:copy(descriptor),files:copy(files)};readContentProject(bundle);return deepFreeze(bundle);}
