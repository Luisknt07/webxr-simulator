import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{verifyPublic}=require('../../tooling/deploy/verify-public.cjs'),{preparePages}=require('../../tooling/deploy/prepare-pages.cjs');
const SOURCE=new URL('../../artifacts/public-viewer/',import.meta.url);
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'smarttwin-publication-')));
 fs.mkdirSync(path.join(root,'artifacts'));fs.cpSync(SOURCE,path.join(root,'artifacts/public-viewer'),{recursive:true});
 t.after(()=>{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('smarttwin-publication-'));fs.rmSync(resolved,{recursive:true});});
 return root;
}
test('Pages receives only one verified scene, even with sensitive repository siblings',t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/private.sqlite'),'private');fs.writeFileSync(path.join(root,'.env'),'secret fixture');
 const result=preparePages({root,revision:'a'.repeat(40)});assert.equal(result.files,7);assert.equal(result.publication.revision,'a'.repeat(40));assert.equal(fs.existsSync(path.join(result.target,'data')),false);assert.equal(fs.existsSync(path.join(result.target,'.env')),false);assert.equal(fs.existsSync(path.join(result.target,'.nojekyll')),true);
});
test('publication rejects tampered code and unlisted files',t=>{
 const root=fixture(t),dir=path.join(root,'artifacts/public-viewer'),code=path.join(dir,'viewer.js'),original=fs.readFileSync(code);
 fs.appendFileSync(code,'\n// tampered');assert.throws(()=>verifyPublic({root}),/hash mismatch/);fs.writeFileSync(code,original);
 fs.writeFileSync(path.join(dir,'admin.js'),'private admin');assert.throws(()=>verifyPublic({root}),/Unlisted files/);
});
test('a newly hashed future private metadata field still fails the public schema',t=>{
 const root=fixture(t),dir=path.join(root,'artifacts/public-viewer'),file='projects/smarttwin/scenes/vr-robot-dispatch.json';
 const json=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));json.project.document.studio.organization={private:true};const bytes=JSON.stringify(json);fs.writeFileSync(path.join(dir,file),bytes);
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'publication.json'),'utf8'));manifest.files.find(row=>row.path===file).sha256=createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(path.join(dir,'publication.json'),JSON.stringify(manifest));
 assert.throws(()=>verifyPublic({root}),/private or editable/);
});
