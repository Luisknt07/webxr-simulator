import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createContentProject,readContentProject,CONTENT_PROJECT_FILE} from '../../packages/project-format/index.js';
import {readContentFolder,writeContentFolder,packContentProject,unpackContentProject,inspectContentProject,runContentProjectCLI} from '../../tooling/projects/content-project.mjs';
import {writeContentFolderToHandle,readContentFolderFromHandle} from '../../packages/project-format/browser-folder.js';

const document=()=>({format:'hello-webxr-editor',version:1,rooms:{hall:{overrides:[],additions:[]},sound:{overrides:[],additions:[{id:'pallet',visible:true,unknown:{preserve:'opaque'}}]}},imports:[{id:'asset-1',name:'small.bin',dataUrl:'data:application/octet-stream;base64,AAECAw=='}],studio:{scenes:[{id:'sound',name:'Recepción'}],startRoomId:'sound',modules:[{id:'sector.logistics-industrial',version:'1.0.0'}]}});
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'smarttwin-content-folder-')));t.after(()=>{const actual=fs.realpathSync(root);assert.equal(path.dirname(actual),fs.realpathSync(os.tmpdir()));assert(path.basename(actual).startsWith('smarttwin-content-folder-'));fs.rmSync(actual,{recursive:true,force:true});});return root;}
const bundle=()=>createContentProject(document(),{id:'project.warehouse',name:'Mi almacén'});

test('a portable folder has a recognized descriptor, Content/Maps and assets, and no engine code',t=>{
  const root=fixture(t),output=path.join(root,'Mi almacen'),written=writeContentFolder(bundle(),output);
  assert.equal(written.descriptor,path.join(output,CONTENT_PROJECT_FILE));assert.equal(fs.existsSync(path.join(output,'Content/Maps/sound.level.json')),true);assert.equal(fs.existsSync(path.join(output,'Content/Assets/asset-1.asset.json')),true);
  assert.deepEqual(readContentProject(readContentFolder(output)).document,document());assert.deepEqual(inspectContentProject(output).levels,[{id:'sound',name:'Recepción',path:'Content/Maps/sound.level.json'}]);
  assert.equal(fs.existsSync(path.join(output,'Engine')),false);assert.equal(fs.existsSync(path.join(output,'Source')),false);
});
test('pack and unpack use new destinations and preserve the exact project and opaque content',t=>{
  const root=fixture(t),folder=path.join(root,'A'),packageFile=path.join(root,'warehouse.stproject.json'),second=path.join(root,'B');writeContentFolder(bundle(),folder);
  packContentProject({project:folder,out:packageFile});unpackContentProject({file:packageFile,out:second});
  assert.deepEqual(readContentProject(readContentFolder(second)).document,document());
  assert.throws(()=>writeContentFolder(bundle(),folder),{code:'project_exists'});assert.throws(()=>packContentProject({project:folder,out:packageFile}),{code:'project_exists'});
  assert.deepEqual(readContentProject(readContentFolder(folder)).document,document());
});
test('map edits require explicit refresh into a new package and never change the source descriptor',t=>{
  const root=fixture(t),folder=path.join(root,'A'),packageFile=path.join(root,'edited.stproject.json');writeContentFolder(bundle(),folder);
  const descriptor=fs.readFileSync(path.join(folder,CONTENT_PROJECT_FILE),'utf8'),filename=path.join(folder,'Content/Maps/sound.level.json'),level=JSON.parse(fs.readFileSync(filename,'utf8'));level.data.additions[0].visible=false;fs.writeFileSync(filename,JSON.stringify(level));
  assert.throws(()=>readContentFolder(folder),{code:'content_hash'});packContentProject({project:folder,out:packageFile,refresh:true});
  const edited=readContentProject(JSON.parse(fs.readFileSync(packageFile,'utf8')));assert.equal(edited.document.rooms.sound.additions[0].visible,false);assert.equal(fs.readFileSync(path.join(folder,CONTENT_PROJECT_FILE),'utf8'),descriptor);
  assert.throws(()=>readContentFolder(folder),{code:'content_hash'},'Refresh creates a new package instead of silently rewriting the original project.');
});
test('packing a server materialized folder embeds only its verified owned blobs for another framework installation',t=>{
  const root=fixture(t),folder=path.join(root,'Server project'),out=path.join(root,'portable.json'),bytes=Buffer.from([0,1,254,255]),hash=createHash('sha256').update(bytes).digest('hex'),source=document();
  source.imports=[{id:'asset-1',name:'server.bin',path:'server.bin',url:'/api/assets/'+hash,sha256:hash,mime:'application/octet-stream',size:bytes.length}];
  writeContentFolder(createContentProject(source),folder);fs.writeFileSync(path.join(folder,'Content/Assets/'+hash+'.blob'),bytes);
  packContentProject({project:folder,out});const restored=readContentProject(JSON.parse(fs.readFileSync(out,'utf8'))).document;
  assert.equal(restored.imports[0].dataUrl,'data:application/octet-stream;base64,'+bytes.toString('base64'));assert.equal(restored.imports[0].url,undefined);assert.equal(restored.imports[0].sha256,undefined);
  assert.deepEqual(readContentProject(readContentFolder(folder)).document,source,'Packaging must never rewrite the SQLite projection source.');
  fs.writeFileSync(path.join(folder,'Content/Assets/'+hash+'.blob'),Buffer.from([0,1,255,254]));assert.throws(()=>packContentProject({project:folder,out:path.join(root,'corrupt.json')}),{code:'content_asset'});assert.equal(fs.existsSync(path.join(root,'corrupt.json')),false);
});
test('linked folders, descriptor traversal and invalid packages are rejected before destination writes',t=>{
  const root=fixture(t),folder=path.join(root,'A');writeContentFolder(bundle(),folder);
  const linked=path.join(root,'linked');fs.symlinkSync(folder,linked,process.platform==='win32'?'junction':'dir');assert.throws(()=>readContentFolder(linked),{code:'project_link'});
  assert.throws(()=>writeContentFolder(bundle(),path.join(linked,'new-project')),{code:'project_link'});
  const invalid=JSON.parse(JSON.stringify(bundle()));invalid.descriptor.files[0].path='../private.json';assert.throws(()=>writeContentFolder(invalid,path.join(root,'Bad')),{code:'content_path'});assert.equal(fs.existsSync(path.join(root,'Bad')),false);
  const descriptor=JSON.parse(fs.readFileSync(path.join(folder,CONTENT_PROJECT_FILE),'utf8'));descriptor.files[0].path='Content/Maps/../../../secret.json';fs.writeFileSync(path.join(folder,CONTENT_PROJECT_FILE),JSON.stringify(descriptor));assert.throws(()=>readContentFolder(folder),{code:'content_path'});
});
test('failed staged writes clean only their temporary directory and preserve existing files',t=>{
  const root=fixture(t),sentinel=path.join(root,'keep.txt');fs.writeFileSync(sentinel,'unchanged');const original=fs.writeFileSync;
  fs.writeFileSync=function(filename,...args){if(String(filename).endsWith('Config'+path.sep+'Project.json'))throw Error('Injected write failure');return original.call(this,filename,...args);};
  try{assert.throws(()=>writeContentFolder(bundle(),path.join(root,'Failure')),/Injected write failure/);}finally{fs.writeFileSync=original;}
  assert.deepEqual(fs.readdirSync(root),['keep.txt']);assert.equal(fs.readFileSync(sentinel,'utf8'),'unchanged');
});
test('CLI rejects unknown, duplicate or mixed options before creating anything',t=>{
  const root=fixture(t);for(const args of [[],['unpack','--file','a','--out','b','--out','c'],['inspect','--project',root,'--refresh'],['pack','--project',root,'--file','x'],['unpack','--out','x'],['inspect','--project',root,'--remote','https://bad']])assert.throws(()=>runContentProjectCLI(args),{code:'project_usage'});
  assert.deepEqual(fs.readdirSync(root),[]);
});

class HandleError extends Error{constructor(name){super(name);this.name=name;}}
class FileHandle{
  constructor(name,failure){this.kind='file';this.name=name;this.value='';this.failure=failure;}
  async createWritable(){const handle=this;return {async write(text){if(handle.failure&&handle.failure(handle.name))throw Error('Injected browser write failure');handle.value=String(text);},async close(){},async abort(){}};}
  async getFile(){const value=this.value,bytes=this.bytes;return {size:bytes?bytes.length:new TextEncoder().encode(value).length,async text(){return value;},async arrayBuffer(){return bytes?bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength):new TextEncoder().encode(value).buffer;}};}
}
class DirectoryHandle{
  constructor(name='',failure){this.kind='directory';this.name=name;this.values=new Map();this.failure=failure;}
  async getDirectoryHandle(name,{create=false}={}){const existing=this.values.get(name);if(existing){if(existing.kind!=='directory')throw new HandleError('TypeMismatchError');return existing;}if(!create)throw new HandleError('NotFoundError');const handle=new DirectoryHandle(name,this.failure);this.values.set(name,handle);return handle;}
  async getFileHandle(name,{create=false}={}){const existing=this.values.get(name);if(existing){if(existing.kind!=='file')throw new HandleError('TypeMismatchError');return existing;}if(!create)throw new HandleError('NotFoundError');const handle=new FileHandle(name,this.failure);this.values.set(name,handle);return handle;}
  async *entries(){yield* this.values.entries();}
}
test('browser-selected folders write and reopen a complete new project without merging existing content',async()=>{
  const parent=new DirectoryHandle(),result=await writeContentFolderToHandle(parent,bundle(),{folderName:'Mi almacén'}),folder=await parent.getDirectoryHandle('Mi almacén');
  assert.equal(result.descriptor,'Mi almacén/project.stproject');assert.deepEqual(readContentProject(await readContentFolderFromHandle(folder)).document,document());
  await assert.rejects(writeContentFolderToHandle(parent,bundle(),{folderName:'Mi almacén'}),{code:'content_exists'});assert.deepEqual(readContentProject(await readContentFolderFromHandle(folder)).document,document());
});
test('browser folder writes reject invalid data before creating directories and preserve partial folders on failure',async()=>{
  const parent=new DirectoryHandle(),bad=JSON.parse(JSON.stringify(bundle()));bad.files[0].sha256='0'.repeat(64);
  await assert.rejects(writeContentFolderToHandle(parent,bad,{folderName:'Bad'}),{code:'content_hash'});assert.equal(parent.values.size,0);
  await assert.rejects(writeContentFolderToHandle(parent,bundle(),{folderName:'../Bad'}),{code:'content_path'});
  const failing=new DirectoryHandle('',name=>name==='Project.json');let error;try{await writeContentFolderToHandle(failing,bundle(),{folderName:'Partial'});}catch(failure){error=failure;}
  assert.equal(error.partialFolder,'Partial');const folder=await failing.getDirectoryHandle('Partial');assert.equal(folder.values.has(CONTENT_PROJECT_FILE),false);assert.equal(folder.values.has('Content'),true);
});
test('browser folder read validates declared JSON hashes instead of trusting edited metadata',async()=>{
  const parent=new DirectoryHandle();await writeContentFolderToHandle(parent,bundle(),{folderName:'Project'});const folder=await parent.getDirectoryHandle('Project'),maps=await (await folder.getDirectoryHandle('Content')).getDirectoryHandle('Maps'),file=await maps.getFileHandle('sound.level.json');
  const level=JSON.parse(file.value);level.data.additions[0].visible=false;file.value=JSON.stringify(level);await assert.rejects(readContentFolderFromHandle(folder),{code:'content_hash'});
});
test('browser folder import hydrates verified owned asset blobs without any network or private API URL',async()=>{
  const bytes=new Uint8Array([0,1,254,255]),hash=createHash('sha256').update(bytes).digest('hex'),source=document();source.imports=[{id:'asset-1',path:'server.bin',url:'/api/assets/'+hash,sha256:hash,size:4,mime:'application/octet-stream'}];
  const parent=new DirectoryHandle();await writeContentFolderToHandle(parent,createContentProject(source),{folderName:'Server'});const folder=await parent.getDirectoryHandle('Server'),assets=await (await folder.getDirectoryHandle('Content')).getDirectoryHandle('Assets'),blob=await assets.getFileHandle(hash+'.blob',{create:true});blob.bytes=bytes;
  const restored=readContentProject(await readContentFolderFromHandle(folder)).document;assert.equal(restored.imports[0].dataUrl,'data:application/octet-stream;base64,AAH+/w==');assert.equal(restored.imports[0].url,undefined);
  blob.bytes=new Uint8Array([0,1,255,254]);await assert.rejects(readContentFolderFromHandle(folder),{code:'content_asset'});
});
