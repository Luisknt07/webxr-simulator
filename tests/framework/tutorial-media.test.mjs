import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {mediaRange}=require('../../apps/api/media-range.cjs');
const {createApplication}=require('../../apps/api/index.cjs');
const {tutorialAssets,FOLDER}=require('../../tooling/build/tutorial-assets.cjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const PREFIX='smarttwin-tutorial-media-';
const MEDIA='cedi-01-guide.mp4',CAPTIONS='cedi-01-guide.vtt',POSTER='cedi-01-guide-poster.jpg';
// File signatures and deterministic bytes exercise publication and HTTP, not a
// decoder. Tests never read private projects, real credentials or tutorial media.
const MP4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.from(Array.from({length:244},(_,i)=>i))]);
const VTT=Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nConfiguración de prueba.\n');
const JPG=Buffer.from([255,216,255,224,0,8,74,70,73,70,255,217]);
const SOURCES={[MEDIA]:MP4,[CAPTIONS]:VTT,[POSTER]:JPG};
const write=(root,name,bytes)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return file;};
function temporary(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),PREFIX)));
 t.after(()=>{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert(path.basename(resolved).startsWith(PREFIX));assert(!fs.lstatSync(root).isSymbolicLink());fs.rmSync(root,{recursive:true,force:true,maxRetries:3});});
 return root;
}
function assetFixture(t){
 const root=temporary(t),manifest={format:'smarttwin.receiving-video-guide',version:1,practiceId:'CEDI-01',video:{src:FOLDER+'/'+MEDIA,duration:70},poster:{src:FOLDER+'/'+POSTER},captions:{src:FOLDER+'/'+CAPTIONS,language:'es'},chapters:['configuration',...Array.from({length:6},(_,i)=>'step-'+(i+1))].map((id,i)=>({id,title:'Capítulo '+i,start:i*10,end:(i+1)*10,transcript:['Contenido de prueba '+i]})),files:Object.entries(SOURCES).map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:sha(bytes)}))};
 const save=()=>write(root,FOLDER+'/cedi-01-guide.json',JSON.stringify(manifest));
 for(const[name,bytes]of Object.entries(SOURCES))write(root,FOLDER+'/'+name,bytes);save();return{root,manifest,save};
}

test('tutorial byte ranges cover bounded, open, clamped and suffix requests',()=>{
 for(const[header,expected]of [
  ['bytes=0-0',{start:0,end:0}],['bytes=5-20',{start:5,end:20}],['bytes=5-',{start:5,end:99}],
  ['bytes=95-999',{start:95,end:99}],['bytes=-12',{start:88,end:99}],['bytes=-999',{start:0,end:99}],[' bytes=0-99 ',{start:0,end:99}]
 ])assert.deepEqual(mediaRange(header,100),expected,header);
});

test('tutorial byte ranges reject malformed, multiple, zero-length and unsafe ranges',()=>{
 for(const header of [undefined,null,{},'', 'bytes=-','bytes=-0','bytes=100-','bytes=101-200','bytes=20-10','bytes=0-1,4-5','items=0-1','bytes=foo-bar','bytes=1.5-2','bytes=+1-2','bytes=9007199254740992-','bytes=-9007199254740992','bytes=0-1\r\nX-Test: true','bytes='+'1'.repeat(130)+'-'])assert.equal(mediaRange(header,100),null,String(header));
 for(const size of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(mediaRange('bytes=0-',size),null,String(size));
});

test('tutorial publication is optional until present, then returns only its verified four files',t=>{
 const absent=temporary(t);assert.deepEqual(tutorialAssets(absent),[]);
 const f=assetFixture(t);assert.deepEqual(tutorialAssets(f.root),['cedi-01-guide.json',MEDIA,CAPTIONS,POSTER].map(name=>FOLDER+'/'+name));
 write(f.root,FOLDER+'/unapproved.mp4',MP4);assert(!tutorialAssets(f.root).some(name=>name.endsWith('unapproved.mp4')),'Siblings cannot widen the media allowlist.');
});

test('tutorial publication rejects missing, changed or reordered media receipts',async t=>{
 for(const [name,mutate]of [
  ['missing receipt',f=>{f.manifest.files.pop();f.save();}],
  ['wrong hash',f=>{f.manifest.files[0].sha256='a'.repeat(64);f.save();}],
  ['wrong length',f=>{f.manifest.files[0].bytes++;f.save();}],
  ['receipt reordered',f=>{f.manifest.files.reverse();f.save();}],
  ['media tampered',f=>write(f.root,FOLDER+'/'+MEDIA,Buffer.concat([MP4,Buffer.from([7])]))],
  ['media absent',f=>fs.unlinkSync(path.join(f.root,FOLDER,CAPTIONS))]
 ])await t.test(name,st=>{const f=assetFixture(st);mutate(f);assert.throws(()=>tutorialAssets(f.root));});
});

test('tutorial publication cannot redirect media paths or exceed media budgets',async t=>{
 for(const[name,mutate]of [
  ['parent path',f=>{f.manifest.video.src='../private.mp4';f.save();}],
  ['remote video',f=>{f.manifest.video.src='https://example.invalid/video.mp4';f.save();}],
  ['receipt escape',f=>{f.manifest.files[0].path='../'+MEDIA;f.save();}],
  ['oversized declared video',f=>{f.manifest.files[0].bytes=32*1024*1024+1;f.save();}],
  ['oversized actual manifest',f=>write(f.root,FOLDER+'/cedi-01-guide.json',' '.repeat(128*1024+1))],
  ['oversized actual poster',f=>{const bytes=Buffer.alloc(1024*1024+1);JPG.copy(bytes);write(f.root,FOLDER+'/'+POSTER,bytes);f.manifest.files[2].bytes=bytes.length;f.manifest.files[2].sha256=sha(bytes);f.save();}],
  ['unsupported language',f=>{f.manifest.captions.language='en';f.save();}]
 ])await t.test(name,st=>{const f=assetFixture(st);mutate(f);assert.throws(()=>tutorialAssets(f.root));});
});

test('tutorial publication requires configuration plus six complete contiguous chapters',async t=>{
 for(const[name,mutate]of [
  ['missing mission',m=>m.chapters.pop()],['incorrect order',m=>{m.chapters[1].id='step-2';}],
  ['gap',m=>{m.chapters[2].start+=1;}],['overlap',m=>{m.chapters[2].start-=1;}],
  ['empty span',m=>{m.chapters[2].end=m.chapters[2].start;}],['incomplete ending',m=>{m.chapters[6].end=69;}],
  ['beyond duration',m=>{m.chapters[6].end=71;}],['missing transcript',m=>{m.chapters[0].transcript=[];}],
  ['overlong transcript',m=>{m.chapters[0].transcript=['x'.repeat(4001)];}],['invalid duration',m=>{m.video.duration=901;}]
 ])await t.test(name,st=>{const f=assetFixture(st);mutate(f.manifest);f.save();assert.throws(()=>tutorialAssets(f.root));});
});

test('tutorial publication verifies signatures even when length and hashes match',async t=>{
 for(const name of [MEDIA,CAPTIONS,POSTER])await t.test(name,st=>{const f=assetFixture(st),bytes=Buffer.alloc(SOURCES[name].length,65),row=f.manifest.files.find(row=>row.path===name);write(f.root,FOLDER+'/'+name,bytes);row.sha256=sha(bytes);f.save();assert.throws(()=>tutorialAssets(f.root),/format/);});
});

test('tutorial publication rejects a linked media directory before reading its files',t=>{
 const f=assetFixture(t),folder=path.join(f.root,FOLDER),held=path.join(f.root,'linked-assets');fs.renameSync(folder,held);
 // Directory junctions exercise the same trust boundary on Windows without
 // depending on permission to create unprivileged file symlinks.
 fs.symlinkSync(held,folder,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>tutorialAssets(f.root),/Linked tutorial asset/);
 fs.unlinkSync(folder);fs.renameSync(held,folder);
});

test('production tutorial HTTP preserves authentication, exact MIME, seeking and logout',{timeout:30000},async t=>{
 const root=temporary(t),publicDir=path.join(root,'public'),workspaceDir=path.join(root,'workspace'),dataDir=path.join(root,'private-data'),projectionsDir=path.join(root,'projections'),errors=[];
 const publication=(directory,scenes,files)=>{for(const[name,bytes]of Object.entries(files))write(directory,name,bytes);write(directory,'publication.json',JSON.stringify({scenes,files:Object.entries(files).map(([name,bytes])=>({path:name,sha256:sha(bytes)}))}));};
 publication(publicDir,['vr-robot-dispatch'],{'index.html':'<!doctype html><title>Public synthetic fixture</title>'});
 publication(workspaceDir,['private-fixture'],{'index.html':'<!doctype html><base href="/workspace/"><title>Private synthetic fixture</title>',...Object.fromEntries(Object.entries(SOURCES).map(([name,bytes])=>[FOLDER+'/'+name,bytes]))});
 write(projectionsDir,'catalog.json',JSON.stringify({scenes:[]}));
 const app=createApplication({host:'127.0.0.1',allowInsecureLocal:true,publicDir,workspaceDir,dataDir,projectionsDir,exampleCatalogPath:path.join(projectionsDir,'catalog.json'),maintenanceIntervalMs:0,onError:error=>errors.push(error)});
 try{
  await app.api.studio.bootstrapOwner({username:'tutorial_owner',password:'Disposable-tutorial-owner-846',invitationOnly:false});await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+app.server.address().port,resource='/workspace/'+FOLDER+'/'+MEDIA;
  const get=async(url,{method='GET',cookie,headers={},body}={})=>{const response=await fetch(origin+url,{method,redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});return{status:response.status,headers:response.headers,bytes:Buffer.from(await response.arrayBuffer())};};
  const anonymous=await get(resource,{headers:{Range:'bytes=0-15'}});assert.equal(anonymous.status,401);assert(!anonymous.headers.has('content-range'));assert(!anonymous.headers.has('accept-ranges'));
  const login=await get('/api/studio/login',{method:'POST',body:{username:'tutorial_owner',password:'Disposable-tutorial-owner-846'}});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert(cookie);
  const full=await get(resource,{cookie});assert.equal(full.status,200);assert.deepEqual(full.bytes,MP4);assert.equal(full.headers.get('content-type'),'video/mp4');assert.equal(Number(full.headers.get('content-length')),MP4.length);assert.equal(full.headers.get('accept-ranges'),'bytes');assert.equal(full.headers.get('cache-control'),'private, no-store');assert.equal(full.headers.get('vary'),'Cookie');assert.equal(full.headers.get('x-content-type-options'),'nosniff');assert.equal(full.headers.get('etag'),'"'+sha(MP4)+'"');
  for(const[range,start,end]of [['bytes=4-15',4,15],['bytes=12-',12,MP4.length-1],['bytes=-13',MP4.length-13,MP4.length-1],['bytes=250-999',250,MP4.length-1]]){
   const response=await get(resource,{cookie,headers:{Range:range,'If-Range':full.headers.get('etag')}});assert.equal(response.status,206,range);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${MP4.length}`);assert.equal(Number(response.headers.get('content-length')),end-start+1);assert.deepEqual(response.bytes,MP4.subarray(start,end+1));assert.equal(response.headers.get('content-type'),'video/mp4');assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
  for(const range of ['bytes=0-1,4-5','bytes=-0','bytes=999-','bytes=20-10','items=1-3','bytes=abc-def']){const response=await get(resource,{cookie,headers:{Range:range}});assert.equal(response.status,416,range);assert.equal(response.headers.get('content-range'),'bytes */'+MP4.length);assert.equal(response.bytes.length,0);}
  const stale=await get(resource,{cookie,headers:{Range:'bytes=4-15','If-Range':'"different-revision"'}});assert.equal(stale.status,200);assert.deepEqual(stale.bytes,MP4);assert(!stale.headers.has('content-range'));
  const head=await get(resource,{method:'HEAD',cookie,headers:{Range:'bytes=4-15'}});assert.equal(head.status,200);assert.equal(head.bytes.length,0);assert.equal(Number(head.headers.get('content-length')),MP4.length);assert.equal(head.headers.get('content-type'),'video/mp4');assert(!head.headers.has('content-range'));
  const captions=await get('/workspace/'+FOLDER+'/'+CAPTIONS,{cookie});assert.equal(captions.status,200);assert.equal(captions.headers.get('content-type'),'text/vtt; charset=utf-8');assert.deepEqual(captions.bytes,VTT);assert.equal(captions.headers.get('cache-control'),'private, no-store');
  for(const name of [MEDIA,CAPTIONS,POSTER])assert.equal((await get('/'+FOLDER+'/'+name,{cookie,headers:{Range:'bytes=0-7'}})).status,404,'Private media must not enter the public mount.');
  write(workspaceDir,FOLDER+'/unlisted.mp4',MP4);assert.equal((await get('/workspace/'+FOLDER+'/unlisted.mp4',{cookie})).status,404,'Physically present files still require publication membership.');
  const logout=await get('/api/studio/logout',{method:'POST',cookie,body:{}});assert.equal(logout.status,200);
  for(const name of [MEDIA,CAPTIONS,POSTER])assert.equal((await get('/workspace/'+FOLDER+'/'+name,{cookie,headers:{Range:'bytes=0-7'}})).status,401,'A revoked session cannot request subsequent media bytes.');
  assert.equal(app.api.studio.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,0,'The media fixture creates no editor project.');assert.deepEqual(errors,[]);
 }finally{if(app.server.listening)app.server.closeAllConnections();await app.close();}
});
