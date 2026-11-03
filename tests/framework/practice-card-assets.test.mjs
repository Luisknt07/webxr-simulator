import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{practiceCardAssets}=require('../../tooling/build/package-apps.cjs'),ROOT=path.resolve(import.meta.dirname,'../..'),FOLDER='modules/logistica-industrial/practices/configurable/assets/catalog';
test('ten distinct reference illustrations are bounded WebP assets belonging only to the practice card receipt',()=>{
 const files=practiceCardAssets(ROOT),receipt=JSON.parse(fs.readFileSync(path.join(ROOT,FOLDER,'manifest.json'),'utf8'));assert.equal(files.length,10);assert.equal(new Set(receipt.files.map(row=>row.sha256)).size,10);assert(receipt.files.reduce((sum,row)=>sum+row.bytes,0)<1024*1024);assert(files.every(file=>file.startsWith(FOLDER+'/')&&file.endsWith('.webp')));
});
test('the practice card publisher rejects stale images, extra files, traversal, wrong IDs and oversized media before publication',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'smarttwin-card-art-')),folder=path.join(root,FOLDER),receipt=JSON.parse(fs.readFileSync(path.join(ROOT,FOLDER,'manifest.json'),'utf8'));fs.mkdirSync(folder,{recursive:true});for(const row of receipt.files)fs.copyFileSync(path.join(ROOT,FOLDER,row.path),path.join(folder,row.path));
 t.after(()=>{const real=fs.realpathSync(root);assert.equal(path.dirname(real),fs.realpathSync(os.tmpdir()));assert(path.basename(real).startsWith('smarttwin-card-art-'));assert(!fs.lstatSync(root).isSymbolicLink());fs.rmSync(real,{recursive:true,force:true,maxRetries:3});});
 const write=()=>fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(receipt));write();assert.equal(practiceCardAssets(root).length,10);fs.writeFileSync(path.join(folder,'private.docx'),'not media');assert.equal(practiceCardAssets(root).length,10);
 const row=receipt.files[0],original={...row};for(const change of [{path:'../private.webp'},{practiceId:'CEDI-06'},{bytes:300*1024+1},{sha256:'0'.repeat(64)},{width:999999}]){Object.assign(row,original,change);write();assert.throws(()=>practiceCardAssets(root),/card/i);}Object.assign(row,original);receipt.files.push({...row});write();assert.throws(()=>practiceCardAssets(root));receipt.files.pop();write();fs.writeFileSync(path.join(folder,row.path),Buffer.alloc(row.bytes));assert.throws(()=>practiceCardAssets(root),/card bytes/i);
});
