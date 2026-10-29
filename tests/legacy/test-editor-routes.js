'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createApplication}=require('../../apps/api/index.cjs');
async function run(){
 const root=path.resolve(__dirname,'../..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'xr-editor-routes-')),errors=[];
 const app=createApplication({host:'127.0.0.1',allowInsecureLocal:true,dataDir:temporary,maintenanceIntervalMs:0,onError:error=>errors.push(error)});
 try{
  await app.api.studio.bootstrapOwner({username:'routes-owner',password:'TestRoutesOnly2026!',displayName:'Route fixture'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;
  for(const route of ['/editor','/editor/?project=fixture&room=hall','/workspace/']){const response=await fetch(origin+route,{redirect:'manual'});assert.equal(response.status,302);assert(response.headers.get('location').startsWith('/login?next='));}
  assert.equal((await fetch(origin+'/workspace/bundle.js')).status,401);
  const response=await fetch(origin+'/');assert.equal(response.status,200);assert.equal(await response.text(),fs.readFileSync(path.join(root,'artifacts/public-viewer/index.html'),'utf8'));
  for(const route of ['/editor/missing','/editors','/EDITOR','/data/projects.sqlite','/%64ata/projects.sqlite','/apps/api/server/api.js','/node_modules/three/package.json','/.git/config'])assert.equal((await fetch(origin+route)).status,404,route);
  const login=await fetch(origin+'/api/studio/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({username:'routes-owner',password:'TestRoutesOnly2026!'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const editor=await fetch(origin+'/editor',{headers:{Cookie:cookie}});assert.equal(editor.status,200);const html=await editor.text();assert.match(html,/<base href="\/workspace\/">/);assert.doesNotMatch(html,/googletagmanager|gtag\(/);
  const base=new URL('/workspace/',origin);
  for(const resource of ['bundle.js','packages/render-three/src/StartupStatus.js','packages/tools/editor/src/editor.css','modules/turismo/assets/loadingbg.jpg']){const asset=await fetch(new URL(resource,base),{method:'HEAD',headers:{Cookie:cookie}});assert.equal(asset.status,200,resource);assert(Number(asset.headers.get('content-length'))>0);assert.doesNotMatch(asset.headers.get('content-type'),/^text\/html/);}
  for(const route of ['/workspace/','/editor/?project=fixture&room=hall']){const redirect=await fetch(origin+route,{redirect:'manual',headers:{Cookie:cookie}});assert.equal(redirect.status,302);assert(redirect.headers.get('location').startsWith('/editor'));}
  const head=await fetch(origin+'/editor',{method:'HEAD',headers:{Cookie:cookie}});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),Buffer.byteLength(html));assert.equal(await head.text(),'');assert.deepEqual(errors,[]);
 }finally{await app.close();const target=fs.realpathSync(temporary);assert.equal(path.dirname(target),fs.realpathSync(os.tmpdir()));assert(path.basename(target).startsWith('xr-editor-routes-'));fs.rmSync(target,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
 console.log('Editor routes: public snapshot, authenticated editor, workspace resources and source/data boundaries passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
