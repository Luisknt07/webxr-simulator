import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {REPOSITORY, checkedPath, discoverLocalModules} from './discover.mjs';
import {CORE_API_VERSION, cloneData, deepFreeze, defineModule, functionManifest, plain, versionSatisfies, fail} from '../../packages/contracts/index.js';

const MAX_FILE=32*1024*1024, MAX_TOTAL=128*1024*1024, MAX_PACK=192*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const folder=value=>{if(typeof value!=='string'||!/^[a-z][a-z0-9-]{0,59}$/.test(value))fail('pack_path','Use a short lowercase sector folder.');return value;};
function portablePath(value){
  if(typeof value!=='string'||!value||value.length>400||/[\\:%?#\0]/.test(value)||value.split('/').some(part=>!part||part.length>120||part.startsWith('.')||/[. ]$/.test(part)||!/^[-A-Za-z0-9._ ]+$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)||['node_modules','private'].includes(part.toLowerCase())))fail('pack_path','A module pack contains an unsafe or nonportable path.');
  return value;
}
function absent(filename){try{fs.lstatSync(filename);fail('pack_exists','The destination already exists; module packs never overwrite installed code.');}catch(error){if(error.code!=='ENOENT')throw error;}}
function dependencies(functions,imports=[]){const ids=new Set(functions.map(entry=>entry.id)),result=new Map();for(const required of [...functions.flatMap(entry=>entry.requires),...imports])if(!ids.has(required.id))result.set(required.id+'@'+required.version,{id:required.id,version:required.version});return [...result.values()].sort((a,b)=>(a.id+a.version).localeCompare(b.id+b.version));}
function sourceModule(module,functions){
  const data={id:module.id,version:module.version,coreApi:module.coreApi,metadata:module.metadata,imports:module.imports};
  return Buffer.from(`import {defineModule} from '../../packages/module-sdk/index.js';\nexport default defineModule({...${JSON.stringify(data)},functions:[${functions.map(entry=>`{...${JSON.stringify(entry)},load:()=>import(${JSON.stringify('./'+entry.metadata.packageRoot+'/'+entry.metadata.entry)})}`).join(',')} ]});\n`);
}
function functionData(entry){return {format:'smarttwin.function',schemaVersion:1,...functionManifest(entry),entry:entry.metadata.entry};}
function checkMetadata(entry){
  const metadata=entry.metadata;if(!plain(metadata)||typeof metadata.packageRoot!=='string'||!/^functions\/[a-z][a-z0-9-]{0,59}$/.test(metadata.packageRoot))fail('pack_manifest','Each function needs its own portable function folder.');
  if(!Array.isArray(metadata.files)||!metadata.files.length||metadata.files.length>2048||new Set(metadata.files.map(name=>typeof name==='string'?name.toLowerCase():name)).size!==metadata.files.length)fail('pack_manifest','Each function needs distinct bounded files.');
  metadata.files.forEach(portablePath);portablePath(metadata.entry);if(!metadata.files.includes(metadata.entry))fail('pack_manifest','The function entry must be in its file list.');
  for(const field of ['schema','server','ui','migration'])if(metadata[field]!==undefined&&!metadata.files.includes(metadata[field]))fail('pack_manifest','A declared function file is missing from its file list.');
  for(const field of ['assets','tests'])if(metadata[field]!==undefined&&(!Array.isArray(metadata[field])||metadata[field].length>256||metadata[field].some(name=>!metadata.files.includes(name))))fail('pack_manifest','Every declared resource must travel with its function.');
}

/** Data-only transport for locally trusted code. Inspection/installation never
 * imports package implementation JS and never activates a module or a port. */
export function validateModulePack(input){
  const data=cloneData(input,{maxString:48*1024*1024,maxNodes:200000});
  if(!plain(data)||data.format!=='smarttwin.module-pack'||data.version!==1||!plain(data.module)||!Array.isArray(data.functions)||!data.functions.length||data.functions.length>256||!Array.isArray(data.files)||data.files.length>4096)fail('pack_format','Invalid module pack envelope.');
  const functions=data.functions.map(functionManifest);functions.forEach(checkMetadata);
  if(new Set(functions.map(entry=>entry.metadata.packageRoot.toLowerCase())).size!==functions.length)fail('pack_manifest','Each function must own a distinct folder.');
  const module=defineModule({...data.module,functions:functions.map(entry=>({...entry,load:()=>{throw Error('Inspection cannot load implementation code.');}}))});
  const sectorFolder=folder(module.metadata.folder);
  if(!versionSatisfies(CORE_API_VERSION,module.coreApi)||functions.some(entry=>!versionSatisfies(CORE_API_VERSION,entry.coreApi)))fail('pack_core','This module requires another framework core version.');
  if(!Array.isArray(data.module.functions)||data.module.functions.length>256)fail('pack_manifest','The sector needs an explicit default function list.');
  const byId=new Map(functions.map(entry=>[entry.id,entry])), defaults=new Set();
  for(const row of data.module.functions){const found=byId.get(row.id);if(!found||defaults.has(row.id)||!same(functionManifest(row),found)||row.entry!==found.metadata.packageRoot+'/'+found.metadata.entry)fail('pack_manifest','Sector defaults must match their packaged functions.');defaults.add(row.id);}
  if(data.module.format!=='smarttwin.sector'||data.module.schemaVersion!==1)fail('pack_manifest','The pack requires a framework sector manifest.');
  const required=dependencies(functions,module.imports);if(!same(data.requires,required))fail('pack_manifest','External dependency declarations do not match the function requirements.');
  const files=new Map(),names=new Set();let total=0;
  for(const row of data.files){
    if(!plain(row))fail('pack_file','Invalid packed file.');portablePath(row.path);
    if(names.has(row.path.toLowerCase()))fail('pack_path','Module files collide by name or letter case.');names.add(row.path.toLowerCase());
    if(!Number.isSafeInteger(row.size)||row.size<0||row.size>MAX_FILE||(total+=row.size)>MAX_TOTAL||typeof row.base64!=='string'||row.base64.length>Math.ceil(MAX_FILE/3)*4||row.base64.length%4!==0||/[^A-Za-z0-9+/=]/.test(row.base64)||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256))fail('pack_file','A packed file exceeds its limits or has invalid encoding.');
    const bytes=Buffer.from(row.base64,'base64');if(bytes.length!==row.size||bytes.toString('base64')!==row.base64||digest(bytes)!==row.sha256)fail('pack_integrity','A packed file does not match its length and SHA-256.');files.set(row.path,bytes);
  }
  const expected=new Set(['package.json','manifest.json','module.js']);
  for(const entry of functions){for(const name of entry.metadata.files)expected.add(entry.metadata.packageRoot+'/'+name);expected.add(entry.metadata.packageRoot+'/function-manifest.json');}
  if(files.size!==expected.size||[...files.keys()].some(name=>!expected.has(name)))fail('pack_manifest','The pack must contain exactly the complete declared function files and sector descriptors.');
  const requireExact=(name,bytes)=>{if(!files.has(name)||!files.get(name).equals(bytes))fail('pack_manifest','Generated pack descriptors do not match the declared module: '+name);};
  requireExact('package.json',json({type:'module'}));requireExact('manifest.json',json(data.module));requireExact('module.js',sourceModule(module,functions));
  for(const entry of functions)requireExact(entry.metadata.packageRoot+'/function-manifest.json',json(functionData(entry)));
  return {pack:deepFreeze(data),module,functions,files,folder:sectorFolder,requires:required,totalBytes:total};
}

export function exportModulePack({root=REPOSITORY,moduleId,functions:requested}={}){
  root=fs.realpathSync(path.resolve(root));const discovery=discoverLocalModules({root}),module=discovery.modules.find(entry=>entry.id===moduleId);
  if(!module)fail('missing_module','Choose an installed framework sector.');
  const byId=new Map(module.functions.map(entry=>[entry.id,entry])),selected=new Map(),visiting=new Set();
  if(requested!==undefined&&(!Array.isArray(requested)||!requested.length||requested.length>256||new Set(requested).size!==requested.length))fail('pack_selection','Select distinct owned function identifiers.');
  function visit(id){const entry=byId.get(id);if(!entry)fail('pack_selection','Only functions owned by this sector can be exported.');if(visiting.has(id))fail('dependency_cycle','A module function dependency is cyclic.');if(selected.has(id))return;visiting.add(id);for(const required of entry.requires)if(byId.has(required.id))visit(required.id);visiting.delete(id);selected.set(id,functionManifest(entry));}
  for(const id of requested||module.functions.map(entry=>entry.id))visit(id);
  const functions=[...selected.values()],files=new Map(),normalized=defineModule({...module,functions:functions.map(entry=>({...entry,load:()=>{throw Error('Export does not load code.');}}))});let totalBytes=0;
  for(const entry of functions){checkMetadata(entry);for(const name of entry.metadata.files){const relative=`modules/${module.metadata.folder}/${entry.metadata.packageRoot}/${name}`,filename=checkedPath(root,relative),stat=fs.statSync(filename);if(!stat.isFile()||stat.size>MAX_FILE||(totalBytes+=stat.size)>MAX_TOTAL||files.size>=4093)fail('pack_file','Only bounded regular function files can be exported within the package budget.');files.set(entry.metadata.packageRoot+'/'+name,fs.readFileSync(filename));}files.set(entry.metadata.packageRoot+'/function-manifest.json',json(functionData(entry)));}
  const sector={format:'smarttwin.sector',schemaVersion:1,id:module.id,version:module.version,coreApi:normalized.coreApi,metadata:normalized.metadata,imports:normalized.imports,functions:functions.filter(entry=>module.defaultFunctions.includes(entry.id)).map(entry=>({...entry,entry:entry.metadata.packageRoot+'/'+entry.metadata.entry}))};
  files.set('package.json',json({type:'module'}));files.set('manifest.json',json(sector));files.set('module.js',sourceModule(normalized,functions));
  const pack={format:'smarttwin.module-pack',version:1,trust:'local-code-review-required',module:sector,functions,requires:dependencies(functions,normalized.imports),files:[...files].sort(([a],[b])=>a.localeCompare(b)).map(([name,bytes])=>({path:name,size:bytes.length,sha256:digest(bytes),base64:bytes.toString('base64')}))};
  validateModulePack(pack);return pack;
}

export function inspectModulePack({root=REPOSITORY,pack}={}){
  root=fs.realpathSync(path.resolve(root));const checked=validateModulePack(pack),discovery=discoverLocalModules({root}),conflicts=[];
  if(discovery.catalog.getModule(checked.module.id))conflicts.push({kind:'module',id:checked.module.id});
  for(const fn of checked.functions)if(discovery.catalog.getFunction(fn.id))conflicts.push({kind:'function',id:fn.id});
  const destination=path.join(root,'modules',checked.folder);try{fs.lstatSync(destination);conflicts.push({kind:'folder',folder:checked.folder});}catch(error){if(error.code!=='ENOENT')throw error;}
  const requirements=checked.requires.map(required=>{const installed=discovery.catalog.getFunction(required.id);return {...required,status:!installed?'missing':!installed.exported?'private':versionSatisfies(installed.version,required.version)?'compatible':'incompatible'};});
  return deepFreeze({format:'smarttwin.module-pack-inspection',version:1,moduleId:checked.module.id,moduleVersion:checked.module.version,folder:checked.folder,functions:checked.functions.map(fn=>({id:fn.id,version:fn.version,capabilities:fn.capabilities})),files:checked.files.size,totalBytes:checked.totalBytes,conflicts,requirements,canInstall:conflicts.length===0,trustRequired:true,activation:'Only a reviewed local catalog/build can activate this code. Installing does not run it or grant capabilities.'});
}

export function importModulePack({root=REPOSITORY,pack,trustLocalCode=false}={}){
  root=fs.realpathSync(path.resolve(root));const checked=validateModulePack(pack),inspection=inspectModulePack({root,pack});
  if(trustLocalCode!==true)fail('pack_trust','Review the code and use --trust-local-code to install this local code package.');
  if(!inspection.canInstall)fail('pack_conflict','The module identity, function namespace or destination is already installed.',inspection.conflicts);
  const parent=checkedPath(root,'modules');if(!fs.statSync(parent).isDirectory())fail('pack_path','The module parent must be a directory.');
  const destination=path.join(parent,checked.folder),token=randomUUID(),lock=path.join(parent,'.module-pack-install.lock'),staging=path.join(parent,'.module-pack-'+checked.folder+'-'+token);let lockFd,staged=false;
  try{
    try{lockFd=fs.openSync(lock,'wx');}catch(error){if(error.code==='EEXIST')fail('pack_busy','Another module package installation is in progress.');throw error;}
    fs.writeFileSync(lockFd,token);absent(destination);fs.mkdirSync(staging);staged=true;fs.writeFileSync(path.join(staging,'owner'),token,{flag:'wx'});
    const sector=path.join(staging,'modules',checked.folder);fs.mkdirSync(sector,{recursive:true});
    for(const [name,bytes] of checked.files){const target=path.join(sector,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});}
    // This validates local JSON metadata and regular files, never package JS.
    const validation=discoverLocalModules({root:staging});assertSector(validation,checked);
    const finalInspection=inspectModulePack({root,pack});if(!finalInspection.canInstall)fail('pack_conflict','The destination changed before publication.',finalInspection.conflicts);
    absent(destination);fs.renameSync(sector,destination);
    return {...inspection,format:'smarttwin.module-pack-installation',installed:true,destination,rebuildRequired:true};
  }finally{
    const errors=[];
    if(staged)try{const absolute=fs.realpathSync(staging);if(path.dirname(absolute)!==fs.realpathSync(parent)||!path.basename(absolute).startsWith('.module-pack-')||fs.lstatSync(staging).isSymbolicLink()||fs.readFileSync(path.join(staging,'owner'),'utf8')!==token)fail('pack_cleanup','The staging directory changed; it was preserved.');fs.rmSync(absolute,{recursive:true});}catch(error){errors.push(error);}
    if(lockFd!==undefined){try{fs.closeSync(lockFd);}catch(error){errors.push(error);}try{if(fs.readFileSync(lock,'utf8')===token)fs.unlinkSync(lock);}catch(error){if(error.code!=='ENOENT')errors.push(error);}}
    if(errors.length)throw new AggregateError(errors,'Module pack cleanup failed; changed paths were preserved.');
  }
}
function assertSector(discovery,checked){const installed=discovery.modules.find(entry=>entry.id===checked.module.id);if(!installed||!same(installed.functions.map(functionManifest).sort((a,b)=>a.id.localeCompare(b.id)),[...checked.functions].sort((a,b)=>a.id.localeCompare(b.id))))fail('pack_manifest','The staged module does not match its reviewed manifest.');}

function readPack(filename){const stat=fs.lstatSync(filename);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>MAX_PACK)fail('pack_file','Choose a bounded regular .stmodule JSON file.');return JSON.parse(fs.readFileSync(filename,'utf8'));}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{
    const action=process.argv[2],args={};for(let index=3;index<process.argv.length;index++){
      const flag=process.argv[index];if(flag==='--trust-local-code'){if(args.trust)fail('pack_usage','Duplicate trust option.');args.trust=true;continue;}
      if(!['--module','--functions','--out','--file'].includes(flag)||!process.argv[index+1]||process.argv[index+1].startsWith('--')||Object.hasOwn(args,flag))fail('pack_usage','Use export --module sector.health --out file.stmodule, inspect --file file.stmodule, or import --file file.stmodule --trust-local-code.');args[flag]=process.argv[++index];
    }
    let result;
    if(action==='export'&&args['--module']&&args['--out']&&!args['--file']&&!args.trust){const pack=exportModulePack({moduleId:args['--module'],functions:args['--functions']?args['--functions'].split(','):undefined}),output=path.resolve(args['--out']);const parent=fs.realpathSync(path.dirname(output));if(fs.lstatSync(path.dirname(output)).isSymbolicLink())fail('pack_path','The output parent cannot be a link.');absent(output);fs.writeFileSync(path.join(parent,path.basename(output)),json(pack),{flag:'wx'});result={exported:true,path:output,moduleId:pack.module.id,functions:pack.functions.map(fn=>fn.id)};}
    else if(action==='inspect'&&args['--file']&&!args['--module']&&!args['--out']&&!args['--functions']&&!args.trust)result=inspectModulePack({pack:readPack(path.resolve(args['--file']))});
    else if(action==='import'&&args['--file']&&!args['--module']&&!args['--out']&&!args['--functions'])result=importModulePack({pack:readPack(path.resolve(args['--file'])),trustLocalCode:args.trust===true});
    else fail('pack_usage','Use export --module sector.health --out file.stmodule, inspect --file file.stmodule, or import --file file.stmodule --trust-local-code.');
    console.log(JSON.stringify(result,null,2));
  }catch(error){console.error(error.code+': '+error.message);process.exitCode=1;}
}
