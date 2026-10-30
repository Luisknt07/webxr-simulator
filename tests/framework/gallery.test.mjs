import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {backendOrigin, loadGallery, sceneEntries, sceneURL, PUBLIC_SCENE_ID} from '../../apps/public-viewer/GalleryData.mjs';

const origin = 'http://localhost:8081', settings = {configuration: {backendAvailable: true, apiOrigin: origin}, baseURI: origin + '/'};
const response = data => ({ok:true,json:async()=>data});

test('static Pages starts with only the public card and makes no API or scene requests', async () => {
  let requests = 0;
  const state = await loadGallery({configuration:{backendAvailable:false},baseURI:'https://example.github.io/webxr-simulator/',fetcher:()=>{requests++;throw Error('Unexpected request');}});
  assert.deepEqual(state.scenes.map(scene=>scene.id),[PUBLIC_SCENE_ID]);assert.equal(requests,0);assert.equal(state.user,null);
  const source=fs.readFileSync(new URL('../../apps/public-viewer/main.js',import.meta.url),'utf8');
  assert(!/\nstart\(\)\.catch/.test(source),'The public app must not automatically create the 3D viewer.');
  assert.match(source,/async onStart\(\)\s*\{return navigation\.openDemo\(\)/);
  assert.match(source,/startDemo: start/);
});

test('anonymous server sessions never request the private catalogue', async () => {
  const calls=[];const result=await loadGallery({...settings,fetcher:async(url,options)=>{calls.push({url,options});return response({user:null});}});
  assert.equal(calls.length,1);assert.equal(calls[0].url,origin+'/api/studio/me');assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');
  assert.deepEqual(result.scenes.map(scene=>scene.id),[PUBLIC_SCENE_ID]);assert.equal(result.user,null);
});

test('a confirmed account loads metadata only and opens selected library scenes through the authenticated route',async()=>{
  const calls=[];const result=await loadGallery({...settings,fetcher:async(url,options)=>{calls.push({url,options});return response(url.endsWith('/me')?{user:{id:'account-1',displayName:'Operador'}}:{scenes:[{id:'vr-robot-turn',name:'Giro compacto',collection:'Realidad virtual compacta',mode:'mixed',difficulty:2,url:'https://invalid.example/private.json'},{id:'../secret',name:'Bad'},{id:PUBLIC_SCENE_ID,name:'Demo'}]});}});
  assert.deepEqual(calls.map(call=>call.url),[origin+'/api/studio/me',origin+'/api/library/scenes']);assert(calls.every(call=>call.options.credentials==='same-origin'));assert.equal(result.user.name,'Operador');
  assert.equal(result.scenes.length,2);const chosen=result.scenes.find(scene=>scene.id==='vr-robot-turn');assert.equal(sceneURL(chosen,origin),origin+'/editor?libraryScene=vr-robot-turn');assert.equal(sceneURL(result.scenes.find(scene=>scene.id===PUBLIC_SCENE_ID),origin),null);
  assert(!('url' in chosen));assert(!calls.some(call=>/\.json/.test(call.url)));
});

test('catalogue failures and foreign capability URLs fall back without disclosing private entries',async()=>{
  let calls=0;const state=await loadGallery({...settings,fetcher:async()=>{calls++;return calls===1?response({user:{id:'viewer',displayName:'Cuenta'}}):{ok:false,status:401};}});
  assert.equal(state.unavailable,true);assert.deepEqual(state.scenes.map(scene=>scene.id),[PUBLIC_SCENE_ID]);
  for(const apiOrigin of ['https://other.example','https://user:password@localhost:8081','javascript:alert(1)','http://public.example'])assert.equal(backendOrigin({backendAvailable:true,apiOrigin},origin),null);
  assert.equal(backendOrigin({backendAvailable:true,apiOrigin:origin},origin),origin);
  assert.equal(backendOrigin({apiOrigin:origin},origin),null);
  assert.throws(()=>sceneURL({id:'../../data'},origin));assert.throws(()=>sceneURL({id:'private-scene'},null));
});

test('catalogue rows are bounded, deduplicated and anonymous output stays restricted',()=>{
  const catalog={scenes:[{id:'vr-robot-turn',name:'Private'},{id:PUBLIC_SCENE_ID,name:'<img src=x onerror=evil()>',collection:'Public'},{id:PUBLIC_SCENE_ID,name:'Duplicate'},...Array.from({length:150},(_,i)=>({id:'scene-'+i,name:'Scene '+i}))]};
  const anonymous=sceneEntries(catalog);assert.equal(anonymous.length,1);assert.equal(anonymous[0].id,PUBLIC_SCENE_ID);assert.equal(anonymous[0].name,'<img src=x onerror=evil()>');
  assert(sceneEntries(catalog,true).length<=128);assert.equal(new Set(sceneEntries(catalog,true).map(scene=>scene.id)).size,sceneEntries(catalog,true).length);
});

test('authenticated transfer opens the regular system scenario without a duplicate test card',()=>{
  const catalog={scenes:[{id:PUBLIC_SCENE_ID,name:'Old demo'},{id:'vr-robot-transfer',name:'Transferencia entre dos bandas'},{id:'vr-robot-turn',name:'Giro'}]};
  assert.deepEqual(sceneEntries(catalog,true).map(scene=>scene.id),['vr-robot-transfer','vr-robot-turn']);
  assert.equal(sceneURL({id:PUBLIC_SCENE_ID},origin,true),origin+'/editor?libraryScene=vr-robot-transfer');
  assert.equal(sceneURL({id:'vr-robot-transfer'},origin,true),origin+'/editor?libraryScene=vr-robot-transfer');
  assert.deepEqual(sceneEntries(catalog,false).map(scene=>scene.id),[PUBLIC_SCENE_ID]);
  assert.equal(sceneURL({id:PUBLIC_SCENE_ID},origin,false),null);
});
