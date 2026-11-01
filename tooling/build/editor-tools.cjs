'use strict';
// Optional editor packages are discovered as data. Removing one never creates
// a compiler import, a server plugin or a dependency of an existing CAD mesh.
const fs=require('node:fs'),path=require('node:path');
const FORM='smarttwin.editor-tools',ENTRY='smarttwin.editor-tool';
const safe=name=>typeof name==='string'&&name.length>0&&name.length<360&&!name.includes('\\')&&!name.includes(':')&&!name.includes('%')&&!name.startsWith('/')&&!name.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'));
const privateSegments=new Set(['scripts','tests','test','node_modules','agents','data','server']);
const allowed=name=>safe(name)&&!name.split('/').some(part=>privateSegments.has(part.toLowerCase()))&&(/\.(?:mjs|js|ts|tsx|css|html|json|md|txt|svg|png|webp|jpe?g|wav|pdf)$/i.test(name)||/(?:^|\/)LICENSE$/.test(name));
function fileAt(root,name){if(!safe(name))throw Error('Invalid editor tool path.');let file=root;for(const part of name.split('/')){file=path.join(file,part);if(fs.lstatSync(file).isSymbolicLink())throw Error('Editor tools cannot contain links.');}return file;}
function discoverEditorTools(root){
 const folder=path.join(root,'packages/tools'),tools=[],files=[];
 if(!fs.existsSync(folder))return {catalog:{format:FORM,version:1,tools},files};
 for(const name of fs.readdirSync(folder).sort()){
  if(!/^[a-z][a-z0-9-]{0,47}$/.test(name))continue;
  const directory=path.join(folder,name);if(!fs.statSync(directory).isDirectory())continue;
  const manifest=path.join(directory,'tool.json');if(!fs.existsSync(manifest))continue;
  if(fs.lstatSync(directory).isSymbolicLink()||fs.lstatSync(manifest).isSymbolicLink())throw Error('Linked editor package.');
  const bytes=fs.readFileSync(manifest);if(bytes.length>16384)throw Error('Editor tool manifest too large.');const value=JSON.parse(bytes);
  if(!value||value.format!==ENTRY||value.version!==1||value.id!==name||typeof value.name!=='string'||!value.name.trim()||value.name.length>120||Object.keys(value).some(k=>!['format','version','id','name','entry','adapter','resources','files'].includes(k)))throw Error('Invalid editor tool manifest.');
  if(!safe(value.entry)||!value.entry.endsWith('.html')||!safe(value.adapter)||!value.adapter.endsWith('.mjs')||!Array.isArray(value.resources)||value.resources.length>12||!Array.isArray(value.files)||value.files.length>24)throw Error('Invalid editor tool entries.');
  const prefix='packages/tools/'+name+'/',selected=new Set(['tool.json']);
  const walk=relative=>{if(!safe(relative))throw Error('Invalid editor tool resource path.');if(relative.split('/').some(part=>privateSegments.has(part.toLowerCase())))return;const filename=fileAt(directory,relative),stat=fs.statSync(filename);if(stat.isDirectory()){for(const child of fs.readdirSync(filename).sort())if(!child.startsWith('.'))walk(relative+'/'+child);return;}if(!stat.isFile()||stat.size>32*1024*1024)throw Error('Unbounded editor tool resource.');if(allowed(relative))selected.add(relative);};
  value.resources.forEach(walk);value.files.forEach(relative=>{const filename=fileAt(directory,relative),stat=fs.statSync(filename);if(!allowed(relative)||!stat.isFile()||stat.size>32*1024*1024)throw Error('Invalid explicit editor tool resource.');selected.add(relative);});
  for(const relative of [value.entry,value.adapter])if(!selected.has(relative))throw Error('Editor tool entry not included.');
  if(selected.size>2000)throw Error('Editor tool publication too large.');
  tools.push({id:name,name:value.name.trim(),entry:prefix+value.entry,adapter:prefix+value.adapter,folder:'packages/tools/'+name});
  for(const relative of [...selected].sort())files.push(prefix+relative);
 }
 if(tools.length>32||new Set(files).size!==files.length)throw Error('Invalid editor tool inventory.');
 return {catalog:{format:FORM,version:1,tools},files};
}
module.exports={discoverEditorTools};
