import {CONTENT_PROJECT_FILE, CONTENT_LIMITS, CONTENT_PROJECT_FORMAT, CONTENT_PACKAGE_FORMAT, readContentProject, serializeContentFile, validateContentPath, contentHash} from './index.js';
import {portableContentAssetPlan,withPortableContentAssets} from './asset-portability.js';
const problem=(code,message,details)=>{const error=Object.assign(new Error(message),{code});if(details)Object.assign(error,details);throw error;};
const missing=error=>error&&error.name==='NotFoundError';
function folderName(value){if(typeof value!=='string'||!value.trim()||value.length>120||value==='.'||value==='..'||/[\\/:<>"|?*\0-\x1f]/.test(value)||value.endsWith('.')||value.endsWith(' ')||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))problem('content_path','El nombre de carpeta no es compatible.');return value;}
async function absent(parent,name){try{await parent.getDirectoryHandle(name);problem('content_exists','La carpeta de destino ya existe. Elige un nombre nuevo.');}catch(error){if(!missing(error))throw error;}try{await parent.getFileHandle(name);problem('content_exists','El destino ya existe como archivo.');}catch(error){if(!missing(error))throw error;}}
async function destination(root,relative,create){
  validateContentPath(relative);const parts=relative.split('/');let directory=root;
  for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part,{create});
  return {directory,name:parts[parts.length-1]};
}
async function writeJSON(directory,name,text){const handle=await directory.getFileHandle(name,{create:true}),writer=await handle.createWritable();try{await writer.write(text);await writer.close();}catch(error){if(writer.abort)try{await writer.abort();}catch(_){}throw error;}}
/** Called only after an application-owned directory picker. It creates a NEW
 * subfolder and never deletes, merges or recursively cleans a user's folder. */
export async function writeContentFolderToHandle(parentHandle,bundle,{folderName:name}={}){
  const validated=readContentProject(bundle);folderName(name);
  if(!parentHandle||typeof parentHandle.getDirectoryHandle!=='function')problem('content_handle','Selecciona una carpeta de destino.');
  await absent(parentHandle,name);const root=await parentHandle.getDirectoryHandle(name,{create:true});
  if(typeof root.entries==='function')for await(const _ of root.entries())problem('content_exists','La carpeta de destino dejó de estar vacía. No se modificó su contenido.');
  try{
    for(const file of validated.files){const target=await destination(root,file.path,true);await writeJSON(target.directory,target.name,serializeContentFile(file));}
    // Descriptor is last: an interrupted folder is not advertised as a complete project.
    await writeJSON(root,CONTENT_PROJECT_FILE,JSON.stringify(validated.descriptor,null,2)+'\n');
    return {folder:name,descriptor:name+'/'+CONTENT_PROJECT_FILE,files:validated.files.length,levels:validated.levels.length};
  }catch(error){throw Object.assign(new Error((error&&error.message||String(error))+' La carpeta parcial «'+name+'» se conservó; elige otra para reintentar.'),{code:error&&error.code||'content_write',partialFolder:name,cause:error});}
}
export async function readContentFolderFromHandle(root){
  if(!root||typeof root.getFileHandle!=='function')problem('content_handle','Selecciona la carpeta del proyecto.');
  const descriptorFile=await (await root.getFileHandle(CONTENT_PROJECT_FILE)).getFile();if(descriptorFile.size>4*1024*1024)problem('content_limit','El descriptor excede el límite de tamaño.');
  const descriptor=JSON.parse(await descriptorFile.text());
  if(!descriptor||descriptor.format!==CONTENT_PROJECT_FORMAT||descriptor.version!==1||!Array.isArray(descriptor.files)||descriptor.files.length>CONTENT_LIMITS.files)problem('content_schema','El descriptor del proyecto no es compatible.');
  const files=[],seen=new Set();let total=0;
  for(const reference of descriptor.files){
    validateContentPath(reference.path);const lower=reference.path.toLowerCase();if(seen.has(lower)||!reference.path.endsWith('.json'))problem('content_path','La lista del descriptor contiene rutas duplicadas o incompatibles.');seen.add(lower);
    const target=await destination(root,reference.path,false),file=await (await target.directory.getFileHandle(target.name)).getFile();total+=file.size;
    if(file.size>CONTENT_LIMITS.fileBytes||total>CONTENT_LIMITS.totalBytes)problem('content_limit','El contenido del proyecto excede su límite.');
    const data=JSON.parse(await file.text());files.push({path:reference.path,data,sha256:contentHash(JSON.stringify(data))});
  }
  const bundle={format:CONTENT_PACKAGE_FORMAT,version:1,descriptor,files};readContentProject(bundle);
  const assets=new Map();
  for(const entry of portableContentAssetPlan(bundle)){
    if(assets.has(entry.sha256))continue;const target=await destination(root,entry.path,false),file=await (await target.directory.getFileHandle(target.name)).getFile();
    if(file.size!==entry.size||file.size>256*1024*1024)problem('content_asset','Un recurso del proyecto no coincide con su tamaño declarado.');
    assets.set(entry.sha256,new Uint8Array(await file.arrayBuffer()));
  }
  return withPortableContentAssets(bundle,assets);
}
