import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),{documentationAssets}=require('../../tooling/build/package-apps.cjs');
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const FOLDER='modules/logistica-industrial/documentation/assets',PREFIX='smarttwin-doc-publication-';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const png=Buffer.concat([signature,Buffer.from('bounded fixture')]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rejected=(action,code='documentation_assets')=>assert.throws(action,error=>error.code===code);

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),PREFIX)),assets=path.join(root,FOLDER);
 fs.mkdirSync(assets,{recursive:true});
 t.after(()=>{
  const resolved=fs.realpathSync(root),temporary=fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(resolved),temporary);assert(path.basename(resolved).startsWith(PREFIX));assert(!fs.lstatSync(root).isSymbolicLink());
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 });
 const receipt={format:'smarttwin.documentation-assets',version:1,moduleId:'sector.logistics-industrial',sourceSha256:sha('supplied conceptual document'),files:[]};
 const write=()=>fs.writeFileSync(path.join(assets,'manifest.json'),JSON.stringify(receipt));
 const image=(name='TR-01.png',bytes=png)=>{fs.writeFileSync(path.join(assets,name),bytes);const file={path:name,bytes:bytes.length,sha256:sha(bytes)};receipt.files.push(file);write();return file;};
 return{root,assets,receipt,write,image};
}

test('the real private documentation receipt resolves exactly 198 byte-verified bounded PNGs and no source document or script',()=>{
 const manifest=require('../../modules/logistica-industrial/documentation/assets/manifest.json'),files=documentationAssets(ROOT);
 assert.equal(manifest.files.length,198);assert.equal(files.length,198);assert.equal(new Set(files).size,198);
 assert.deepEqual(files,manifest.files.map(file=>FOLDER+'/'+file.path));
 let total=0;
 for(const file of manifest.files){
  assert.match(file.path,/^[A-Z]{2}-\d{2}\.png$/);const bytes=fs.readFileSync(path.join(ROOT,FOLDER,file.path));
  assert.equal(sha(bytes),file.sha256);assert.equal(bytes.length,file.bytes);assert(bytes.length<=1024*1024);assert(bytes.subarray(0,8).equals(signature));total+=bytes.length;
 }
 assert(total<8*1024*1024);assert(files.every(file=>file.startsWith(FOLDER+'/')&&!/\.(?:docx|js|mjs|cjs)$/i.test(file)));
});

test('a missing optional receipt publishes nothing, and a minimal attested PNG publishes only its explicit path',t=>{
 const f=fixture(t);assert.deepEqual(documentationAssets(f.root),[]);
 f.image();assert.deepEqual(documentationAssets(f.root),[FOLDER+'/TR-01.png']);
 fs.writeFileSync(path.join(f.assets,'private.docx'),'not a publication input');fs.writeFileSync(path.join(f.assets,'unlisted.js'),'not a publication input');
 assert.deepEqual(documentationAssets(f.root),[FOLDER+'/TR-01.png'],'Unlisted files must never expand the explicit receipt.');
});

test('documentation illustration paths reject traversal, absolute paths, encoded paths and non-PNG documents or code',t=>{
 const f=fixture(t),file=f.image();
 for(const unsafe of ['../TR-01.png','/TR-01.png','C:/TR-01.png','TR\\01.png','%2e%2e/TR-01.png','TR-01.png/../x','TR-01.png\0x','original.docx','private.js','module.mjs','program.cjs','tr-01.png']){
  file.path=unsafe;f.write();rejected(()=>documentationAssets(f.root));
 }
});

test('duplicate illustration paths and oversized receipt lists cannot broaden the private package',t=>{
 const f=fixture(t),file=f.image();f.receipt.files.push({...file});f.write();rejected(()=>documentationAssets(f.root));
 f.receipt.files=Array.from({length:513},()=>({...file}));f.write();rejected(()=>documentationAssets(f.root));
});

test('tampered bytes, stale sizes, invalid hashes and disguised image signatures are rejected',t=>{
 const f=fixture(t),file=f.image(),original={...file};
 const altered=Buffer.from(png);altered[altered.length-1]^=1;fs.writeFileSync(path.join(f.assets,file.path),altered);rejected(()=>documentationAssets(f.root));
 fs.writeFileSync(path.join(f.assets,file.path),png);file.bytes++;f.write();rejected(()=>documentationAssets(f.root));
 Object.assign(file,original);file.sha256='not-a-sha256';f.write();rejected(()=>documentationAssets(f.root));
 const disguised=Buffer.from('not a png document');Object.assign(file,{bytes:disguised.length,sha256:sha(disguised)});fs.writeFileSync(path.join(f.assets,file.path),disguised);f.write();rejected(()=>documentationAssets(f.root));
});

test('both individual and aggregate illustration byte budgets are enforced before publication',t=>{
 const f=fixture(t),file=f.image();file.bytes=1024*1024+1;f.write();rejected(()=>documentationAssets(f.root));
 f.receipt.files=[];const large=Buffer.alloc(1024*1024);signature.copy(large);
 for(let i=1;i<=9;i++)f.image('TR-'+String(i).padStart(2,'0')+'.png',large);
 rejected(()=>documentationAssets(f.root));
});

test('linked illustration inputs cannot escape receipt validation when the platform permits symlinks',t=>{
 const f=fixture(t),file=f.image(),target=path.join(f.root,'outside-illustration.png');fs.writeFileSync(target,png);
 const link=path.join(f.assets,file.path);fs.unlinkSync(link);
 try{fs.symlinkSync(target,link,'file');}catch(error){if(['EPERM','EACCES','ENOSYS'].includes(error.code)){t.skip('This host does not permit file symlinks.');return;}throw error;}
 rejected(()=>documentationAssets(f.root),'symlink_input');
});

test('a linked asset directory is rejected as well as linked files',t=>{
 const f=fixture(t);f.image();const moved=path.join(f.root,'actual-assets');
 assert.equal(path.dirname(path.resolve(moved)),path.resolve(f.root));assert(path.resolve(f.assets).startsWith(path.resolve(f.root)+path.sep));
 fs.renameSync(f.assets,moved);
 try{fs.symlinkSync(moved,f.assets,process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES','ENOSYS'].includes(error.code)){t.skip('This host does not permit directory links.');return;}throw error;}
 rejected(()=>documentationAssets(f.root),'symlink_input');
});
