import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {REPOSITORY,checkedPath,discoverLocalModules} from './discover.mjs';
import {functionManifest,deepFreeze,fail} from '../../packages/contracts/index.js';
const slash=value=>value.split(path.sep).join('/'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Build-time discovery only. The browser gets inert metadata and literal lazy
 * imports of locally installed portable functions, never a JSON code URL. */
export function writeWorkspaceCatalog({root=REPOSITORY}={}){
  root=fs.realpathSync(path.resolve(root));const discovered=discoverLocalModules({root});
  for(const name of ['data','data/build']){const current=checkedPath(root,name,{missing:true});if(!current)fs.mkdirSync(path.join(root,name));else if(!fs.statSync(current).isDirectory())fail('workspace_catalog','The generated metadata parent is not a directory.');}
  const output=path.join(root,'data/build'),catalogPath=path.join(output,'workspace-catalog.mjs'),metadataPath=path.join(output,'workspace-catalog.json');
  const importPath=filename=>{const value=slash(path.relative(output,filename));return value.startsWith('.')?value:'./'+value;};
  const defaultFunctions=Object.fromEntries(discovered.modules.map(module=>[module.id,module.defaultFunctions.concat(module.imports.map(entry=>entry.id))]));
  const metadata=discovered.modules.map(module=>({id:module.id,version:module.version,title:module.metadata.title||module.metadata.folder||module.id,folder:module.metadata.folder,
    functions:module.functions.map(entry=>({...functionManifest(entry),entry:entry.entry}))}));
  const assets=[...new Set(discovered.modules.flatMap(module=>module.functions.flatMap(entry=>(entry.metadata.assets||[]).map(asset=>entry.packageDirectory+'/'+asset))))].sort();
  const catalog=discovered.modules.map(module=>{
    const info={id:module.id,version:module.version,coreApi:module.coreApi,metadata:module.metadata,imports:module.imports};
    return `{...${JSON.stringify(info)},functions:[${module.functions.map(entry=>`{...${JSON.stringify(functionManifest(entry))},load:()=>import(${JSON.stringify(importPath(path.join(root,entry.entry)))})}`).join(',')}]}`;
  }).join(',\n');
  const source=`// Generated from validated local JSON. Implementations stay lazy.\nexport const catalog=[${catalog}];\nexport const defaultFunctions=${JSON.stringify(defaultFunctions)};\nexport const metadata=${JSON.stringify(metadata)};\n`;
  const receipt={format:'smarttwin.workspace-catalog',version:1,modules:metadata,assets,manifests:discovered.sources,catalogSha256:hash(source)};
  for(const [filename,contents] of [['workspace-catalog.mjs',source],['workspace-catalog.json',JSON.stringify(receipt,null,2)+'\n']]){
    checkedPath(root,'data/build/'+filename,{missing:true});const existing=path.join(output,filename);if(fs.existsSync(existing)&&!fs.statSync(existing).isFile())fail('workspace_catalog','The generated metadata target is not a regular file.');fs.writeFileSync(existing,contents);
  }
  return deepFreeze({catalogPath,metadataPath,modules:metadata,assets,catalogSha256:receipt.catalogSha256});
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{console.log(JSON.stringify(writeWorkspaceCatalog(),null,2));}catch(error){console.error(error.code+': '+error.message);process.exitCode=1;}}
