import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {CONTENT_PROJECT_FILE, CONTENT_LIMITS, CONTENT_PACKAGE_FORMAT, CONTENT_PROJECT_FORMAT, readContentProject, serializeContentFile, validateContentPath, contentHash} from '../../packages/project-format/index.js';
import {portableContentAssetPlan,withPortableContentAssets} from '../../packages/project-format/asset-portability.js';

const problem=(code,message)=>{throw Object.assign(new Error(message),{code});};
const within=(parent,target)=>target===parent||!path.relative(parent,target).startsWith('..')&&!path.isAbsolute(path.relative(parent,target));
function noLinks(filename,{directory=false}={}){
  const absolute=path.resolve(filename),parsed=path.parse(absolute);let current=parsed.root;
  for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){current=path.join(current,part);const stat=fs.lstatSync(current);if(stat.isSymbolicLink())problem('project_link','Linked project paths are not supported.');}
  const resolved=fs.realpathSync(absolute),stat=fs.statSync(resolved);if(directory?!stat.isDirectory():!stat.isFile())problem('project_path','The selected project path has the wrong type.');return resolved;
}
function absent(filename){try{fs.lstatSync(filename);problem('project_exists','The destination already exists; choose a new project folder or package filename.');}catch(error){if(error.code!=='ENOENT')throw error;}}
function targetPath(filename){
  if(typeof filename!=='string'||!filename.trim())problem('project_usage','Specify a new output path.');
  const absolute=path.resolve(filename),parent=noLinks(path.dirname(absolute),{directory:true}),name=path.basename(absolute);
  if(!name||name==='.'||name==='..'||/[<>:"|?*\0-\x1f]/.test(name)||name.endsWith('.')||name.endsWith(' ')||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))problem('project_path','The destination needs a portable filename.');
  const target=path.join(parent,name);if(!within(parent,target)||target===parent)problem('project_path','Invalid destination.');absent(target);return {parent,target};
}
function readJSON(filename,maximum){
  const source=noLinks(filename),size=fs.statSync(source).size;if(size>maximum)problem('project_limit','The project file exceeds its size budget.');
  try{return JSON.parse(fs.readFileSync(source,'utf8'));}catch(error){problem('project_json','A declared project file is not valid JSON.');}
}
function descriptorPath(input){
  if(typeof input!=='string'||!input.trim())problem('project_usage','Select a project folder or its project.stproject descriptor.');
  const absolute=path.resolve(input),stat=fs.lstatSync(absolute);if(stat.isSymbolicLink())problem('project_link','Linked project paths are not supported.');
  const filename=stat.isDirectory()?path.join(noLinks(absolute,{directory:true}),CONTENT_PROJECT_FILE):noLinks(absolute);
  if(path.basename(filename)!==CONTENT_PROJECT_FILE)problem('project_descriptor','Select the recognized project.stproject descriptor.');return noLinks(filename);
}
function descriptorFiles(descriptor){
  if(!descriptor||descriptor.format!==CONTENT_PROJECT_FORMAT||descriptor.version!==1||!Array.isArray(descriptor.files)||descriptor.files.length>CONTENT_LIMITS.files)problem('project_descriptor','Invalid Content project descriptor.');
  const seen=new Set();
  for(const file of descriptor.files){
    if(!file||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256))problem('project_descriptor','Invalid content file checksum.');
    validateContentPath(file.path);if(!file.path.endsWith('.json'))problem('project_descriptor','A content data file must be JSON.');
    const lower=file.path.toLowerCase();if(seen.has(lower))problem('content_duplicate','Descriptor file paths collide.');seen.add(lower);
  }
  return descriptor.files;
}

/** Read only declared JSON data. --refresh accepts deliberate map/config edits
 * into a NEW package; schema/path/reference validation remains mandatory. */
export function readContentFolder(projectPath,{refresh=false,portable=false}={}){
  const filename=descriptorPath(projectPath),root=noLinks(path.dirname(filename),{directory:true}),descriptor=readJSON(filename,4*1024*1024),files=[];
  let total=0;
  for(const reference of descriptorFiles(descriptor)){
    const target=path.resolve(root,reference.path);if(!within(root,target))problem('content_path','Content escaped its project folder.');
    const resolved=noLinks(target),size=fs.statSync(resolved).size;total+=size;if(size>CONTENT_LIMITS.fileBytes||total>CONTENT_LIMITS.totalBytes)problem('project_limit','Project content exceeds its size budget.');
    const data=readJSON(resolved,CONTENT_LIMITS.fileBytes),sha256=contentHash(JSON.stringify(data));
    files.push({path:reference.path,data,sha256});if(refresh)reference.sha256=sha256;
  }
  const bundle={format:CONTENT_PACKAGE_FORMAT,version:1,descriptor,files};readContentProject(bundle);
  if(!portable)return bundle;
  const assets=new Map();
  for(const entry of portableContentAssetPlan(bundle)){
    if(assets.has(entry.sha256))continue;const filename=noLinks(path.resolve(root,entry.path)),stat=fs.statSync(filename);
    if(!within(root,filename)||stat.size!==entry.size||stat.size>256*1024*1024)problem('content_asset','The project blob size does not match its metadata.');assets.set(entry.sha256,fs.readFileSync(filename));
  }
  return withPortableContentAssets(bundle,assets,{encodeBase64:bytes=>Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64')});
}
function safeStageCleanup(parent,stage,identity){
  const absolute=path.resolve(stage),stat=fs.lstatSync(absolute);
  if(path.dirname(absolute)!==parent||!path.basename(absolute).startsWith('.stproject-')||stat.isSymbolicLink()||!stat.isDirectory()||stat.ino!==identity.ino||stat.dev!==identity.dev||fs.realpathSync(absolute)!==absolute)problem('project_cleanup','Refusing cleanup of a replaced staging directory.');
  fs.rmSync(absolute,{recursive:true,force:true});
}
function publishFile(source,target){
  try{fs.linkSync(source,target);}catch(error){if(!['EXDEV','EPERM','EOPNOTSUPP','ENOTSUP','ENOSYS'].includes(error.code))throw error;fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);}
}
/** Materialize only a validated package below a NEW explicit destination. No
 * installed framework, project, user folder or engine file is overwritten. */
export function writeContentFolder(input,out){
  const validated=readContentProject(input),{parent,target}=targetPath(out),stage=path.join(parent,'.stproject-'+randomUUID());
  fs.mkdirSync(stage);const identity=fs.statSync(stage);let created=false;
  try{
    for(const file of validated.files){
      const destination=path.resolve(stage,file.path);if(!within(stage,destination))problem('content_path','Invalid content destination.');
      fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,serializeContentFile(file),{encoding:'utf8',flag:'wx'});
    }
    fs.writeFileSync(path.join(stage,CONTENT_PROJECT_FILE),JSON.stringify(validated.descriptor,null,2)+'\n',{encoding:'utf8',flag:'wx'});
    readContentFolder(stage);
    // mkdir publishes a new destination without a replace race. Each file is
    // linked exclusively; the recognized descriptor is published last. Failed
    // publication leaves a clearly reported partial folder, never deletes it.
    fs.mkdirSync(target);created=true;
    for(const file of validated.files){const destination=path.resolve(target,file.path);fs.mkdirSync(path.dirname(destination),{recursive:true});noLinks(path.dirname(destination),{directory:true});publishFile(path.join(stage,file.path),destination);}
    publishFile(path.join(stage,CONTENT_PROJECT_FILE),path.join(target,CONTENT_PROJECT_FILE));
    return {folder:target,descriptor:path.join(target,CONTENT_PROJECT_FILE),files:validated.files.length,levels:validated.levels.map(row=>({id:row.id,name:row.name,path:row.path}))};
  }catch(error){if(created){error.partialFolder=target;error.message+=' The partial project folder was preserved: '+target;}throw error;}
  finally{if(fs.existsSync(stage))safeStageCleanup(parent,stage,identity);}
}
function writeNewPackage(bundle,out){
  readContentProject(bundle);const {parent,target}=targetPath(out),temporary=path.join(parent,'.stproject-'+randomUUID()+'.tmp');let identity;
  try{
    fs.writeFileSync(temporary,JSON.stringify(bundle,null,2)+'\n',{encoding:'utf8',flag:'wx'});
    identity=fs.statSync(temporary);
    // link is an atomic no-replace publication for files on the same volume.
    publishFile(temporary,target);return {file:target,files:bundle.files.length,levels:bundle.descriptor.maps.length};
  }finally{if(fs.existsSync(temporary)){const stat=fs.lstatSync(temporary);if(stat.isSymbolicLink()||!stat.isFile()||path.dirname(temporary)!==parent||!identity||stat.ino!==identity.ino||stat.dev!==identity.dev)problem('project_cleanup','Refusing cleanup of a replaced temporary package.');fs.unlinkSync(temporary);}}
}
export function unpackContentProject({file,out}){return writeContentFolder(readJSON(file,CONTENT_LIMITS.totalBytes),out);}
export function packContentProject({project,out,refresh=false}){return writeNewPackage(readContentFolder(project,{refresh,portable:true}),out);}
export function inspectContentProject(project){const bundle=readContentFolder(project),restored=readContentProject(bundle);return {id:restored.descriptor.id,name:restored.descriptor.name,kind:restored.descriptor.kind,descriptor:descriptorPath(project),levels:restored.levels.map(row=>({id:row.id,name:row.name,path:row.path})),modules:restored.descriptor.modules,assets:restored.descriptor.assets.length,files:restored.files.length};}
export function runContentProjectCLI(args){
  const [command,...rest]=args,options={};if(!['unpack','pack','inspect'].includes(command))problem('project_usage','Use unpack --file package.stproject.json --out NEW_FOLDER, inspect --project FOLDER, or pack --project FOLDER --out NEW_FILE [--refresh].');
  for(let index=0;index<rest.length;index++){
    const key=rest[index];if(key==='--refresh'){if(options.refresh)problem('project_usage','Duplicate refresh flag.');options.refresh=true;continue;}
    if(!['--file','--project','--out'].includes(key)||!rest[index+1]||rest[index+1].startsWith('--')||options[key.slice(2)]!==undefined)problem('project_usage','Invalid or duplicate project option.');options[key.slice(2)]=rest[++index];
  }
  const allowed=command==='unpack'?['file','out']:command==='pack'?['project','out','refresh']:['project'];
  if(Object.keys(options).some(key=>!allowed.includes(key))||allowed.filter(key=>key!=='refresh').some(key=>options[key]===undefined))problem('project_usage','Missing or unsupported option for this project command.');
  return command==='unpack'?unpackContentProject(options):command==='pack'?packContentProject(options):inspectContentProject(options.project);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{console.log(JSON.stringify(runContentProjectCLI(process.argv.slice(2)),null,2));}catch(error){console.error((error.code||'project_error')+': '+error.message);process.exitCode=1;}}
