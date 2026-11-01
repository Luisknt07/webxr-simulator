import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{verifyPublic,STUDY_FILES,CAD_NOTES}=require('../../tooling/deploy/verify-public.cjs'),{preparePages}=require('../../tooling/deploy/prepare-pages.cjs');
const SOURCE=new URL('../../artifacts/public-viewer/',import.meta.url);
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'smarttwin-publication-')));
 fs.mkdirSync(path.join(root,'artifacts'));fs.cpSync(SOURCE,path.join(root,'artifacts/public-viewer'),{recursive:true});
 t.after(()=>{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('smarttwin-publication-'));fs.rmSync(resolved,{recursive:true});});
 return root;
}
test('Pages receives only one verified scene, even with sensitive repository siblings',t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/private.sqlite'),'private');fs.writeFileSync(path.join(root,'.env'),'secret fixture');
 const result=preparePages({root,revision:'a'.repeat(40)});assert.equal(result.files,29);assert.equal(result.publication.revision,'a'.repeat(40));assert.equal(fs.existsSync(path.join(result.target,'data')),false);assert.equal(fs.existsSync(path.join(result.target,'.env')),false);assert.equal(fs.existsSync(path.join(result.target,'.nojekyll')),true);assert.equal(STUDY_FILES.length,9);assert.equal(CAD_NOTES.length,3);for(const file of STUDY_FILES.concat(CAD_NOTES))assert(fs.statSync(path.join(result.target,file)).isFile());
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

test('reviewed reference images and CAD notes retain the same hash verification as executable files',t=>{
 const root=fixture(t),dir=path.join(root,'artifacts/public-viewer');
 for(const file of [STUDY_FILES[0],CAD_NOTES[1]]){const target=path.join(dir,file),original=fs.readFileSync(target);fs.appendFileSync(target,'tampered reference');assert.throws(()=>verifyPublic({root}),/hash mismatch/);fs.writeFileSync(target,original);}
 assert.equal(verifyPublic({root}).files,29);
});

test('an extra image cannot publish through the study folder even when it is listed and newly hashed',t=>{
 const root=fixture(t),dir=path.join(root,'artifacts/public-viewer'),file='modules/logistica-industrial/assets/study/not-reviewed.jpg',bytes=Buffer.from('unreviewed image');fs.writeFileSync(path.join(dir,file),bytes);
 const manifestFile=path.join(dir,'publication.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));manifest.files.push({path:file,sha256:createHash('sha256').update(bytes).digest('hex')});fs.writeFileSync(manifestFile,JSON.stringify(manifest));assert.throws(()=>verifyPublic({root}),/Unexpected public file allowlist/);
});

test('publication manifest traversal and absolute paths are rejected before any resource read',t=>{
 const root=fixture(t),dir=path.join(root,'artifacts/public-viewer'),manifestFile=path.join(dir,'publication.json'),original=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 for(const candidate of ['../private.sqlite','../../data/private.sqlite','modules/logistica-industrial/assets/study/../../../../data/private.sqlite','modules\\logistica-industrial\\assets\\study\\..\\private.sqlite','C:/private.sqlite','/private.sqlite']){const manifest=structuredClone(original);manifest.files.find(row=>row.path===STUDY_FILES[0]).path=candidate;fs.writeFileSync(manifestFile,JSON.stringify(manifest));assert.throws(()=>verifyPublic({root}),/Unexpected public file allowlist/);}
});
