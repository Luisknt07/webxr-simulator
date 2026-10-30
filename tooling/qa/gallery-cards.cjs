'use strict';
// Focused gallery QA: existing static photographs + real production HTTPS API.
// Uses disposable owner/database/browser profiles; never opens the user's data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomBytes}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUTPUT=path.join(ROOT,'data/qa-studio/gallery-cards');
const PUBLIC_ID='vr-robot-dispatch',PREVIEWS='projects/smarttwin/previews/';
const sha=value=>createHash('sha256').update(value).digest('hex');
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
function auditThumbnails(){
 const catalog=JSON.parse(fs.readFileSync(path.join(ROOT,'projects/smarttwin/scenes/catalog.json'),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,PREVIEWS,'manifest.json'),'utf8'));
 assert.equal(manifest.format,'hello-webxr-scene-thumbnails');assert.equal(manifest.complete,true);assert.equal(catalog.scenes.length,require('../assets/validate-public-scenes').inventory(ROOT).includedCount);assert.equal(catalog.scenes.length,manifest.scenes.length);
 const rows=new Map(),historicalSnapshots=[];let bytes=0;
 for(const row of manifest.scenes){
  assert(/^[a-z0-9-]+$/.test(row.id));assert.equal(row.file,row.id+'.png');assert(!rows.has(row.id));
  assert(['actual-study-factory','actual-public-world'].includes(row.method),'A generated icon is not a scene photograph.');
  const image=fs.readFileSync(path.join(ROOT,PREVIEWS,row.file));assert(image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  assert.equal(image.toString('ascii',12,16),'IHDR');assert.equal(image.readUInt32BE(16),480);assert.equal(image.readUInt32BE(20),320);
  assert.equal(image.length,row.bytes);assert.equal(sha(image),row.sha256);assert(row.quality.variance>3&&row.quality.max-row.quality.min>8);
  bytes+=image.length;rows.set(row.id,row);
  const snapshot=path.join(ROOT,'projects/smarttwin/scenes',row.id+'.json');if(fs.existsSync(snapshot)&&sha(fs.readFileSync(snapshot))!==row.sceneSha256)historicalSnapshots.push(row.id);
 }
 for(const scene of catalog.scenes)assert(rows.has(scene.id),'The catalogue needs an actual PNG for '+scene.id);
 assert.equal(bytes,manifest.bytes);assert(bytes<=8*1024*1024);
 return {catalog,manifest,rows,summary:{images:rows.size,width:480,height:320,bytes,methods:[...new Set(manifest.scenes.map(row=>row.method))],historicalSnapshotProvenance:historicalSnapshots}};
}
async function run(options={}){
 assert.match(options.expectedPublicSha256||'',/^[a-f0-9]{64}$/,'Pass the reviewed --expected-public-sha256.');
 const bundle=fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js')),publication=JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/publication.json'),'utf8'));
 assert.equal(sha(bundle),options.expectedPublicSha256);assert.equal(publication.bundleSha256,options.expectedPublicSha256);
 const thumbnails=auditThumbnails(),{sceneEntries}=await import(pathToFileURL(path.join(ROOT,'apps/public-viewer/GalleryData.mjs')).href);
 fs.mkdirSync(OUTPUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const report={startedAt:new Date().toISOString(),expectedPublicSha256:options.expectedPublicSha256,temporaryDatabaseOnly:true,thumbnails:thumbnails.summary,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],filters:[]};
 const password='Disposable-Gallery-QA-'+randomBytes(18).toString('hex'),fixture=await startFixture(password);
 try{
  const anonymousPublic=await request(fixture.origin,'/'+PREVIEWS+PUBLIC_ID+'.png');assert.equal(anonymousPublic.status,200);assert.equal(anonymousPublic.sha256,thumbnails.rows.get(PUBLIC_ID).sha256);
  const privateThumbnail='/workspace/'+PREVIEWS+'vr-robot-turn.png';assert.equal((await request(fixture.origin,privateThumbnail)).status,401);
  assert.equal((await request(fixture.origin,'/'+PREVIEWS+'vr-robot-turn.png')).status,404);
  assert.equal((await request(fixture.origin,'/api/library/scenes')).status,401);
  const owner=await request(fixture.origin,'/api/studio/login','POST',{username:'qa_production_owner',password});assert.equal(owner.status,200);
  const ownerCookie=owner.headers['set-cookie'][0].split(';')[0],catalog=await request(fixture.origin,'/api/library/scenes','GET',undefined,ownerCookie);assert.equal(catalog.status,200);assert.equal(catalog.json.scenes.length,thumbnails.catalog.scenes.length);
  const expected=sceneEntries(catalog.json,true),byId=new Map(expected.map(entry=>[entry.id,entry]));
  assert(catalog.json.scenes.some(scene=>scene.id===PUBLIC_ID),'The public alias remains in the protected catalogue.');
  assert(expected.some(entry=>entry.id==='vr-robot-transfer'),'Signed-in users need the maintained transfer lesson.');
  assert(!byId.has(PUBLIC_ID),'The authenticated gallery must omit the obsolete duplicate demo card.');assert.equal(expected.length,catalog.json.scenes.length-1);
  report.access={publicThumbnail:200,anonymousPrivateThumbnail:401,anonymousOtherThumbnail:404,anonymousLibrary:401,authenticatedScenes:catalog.json.scenes.length,authenticatedCards:expected.length};
  await withBrowser(fixture,report,async browser=>{
   const shot=async name=>{const result=await browser.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const file=path.join(OUTPUT,name+'.png');fs.writeFileSync(file,Buffer.from(result.data,'base64'));report.screenshots.push(file);};
   const ready=async()=>{await browser.until(()=>browser.evaluate('Boolean(window.smartTwinGallery&&smartTwinGallery.ready)'), 'The gallery shell did not initialize.',30000);await browser.evaluate('smartTwinGallery.ready');};
   const noWorld=async()=>assert.equal(await browser.evaluate('document.querySelectorAll("#viewer canvas").length===0&&!window.smartTwinViewer&&!window.context'),true,'Browsing cards must not construct a 3D scene or Workspace.');
   const visibleIds=()=>browser.evaluate('[...document.querySelectorAll(".scene-card[data-scene-id]")].filter(card=>!card.hidden&&card.getClientRects().length).map(card=>card.dataset.sceneId).sort()');
   const fields=async values=>{await browser.call(values=>{for(const [id,value]of Object.entries(values)){const field=document.getElementById(id);if(!field)throw Error('Missing gallery filter '+id);field.value=value;field.dispatchEvent(new Event(field.tagName==='INPUT'?'input':'change',{bubbles:true}));}},values);};
   const clear=()=>fields({'scene-search':'','scene-category':'','scene-level':'','scene-mode':''});
   const filter=async(label,values,predicate)=>{await clear();await fields(values);const actual=await visibleIds(),wanted=expected.filter(predicate).map(entry=>entry.id).sort();assert.deepEqual(actual,wanted,label);report.filters.push({label,count:actual.length,sceneIds:actual});await noWorld();};
   console.log('Gallery cards Chrome: anonymous welcome and preview');
   await browser.send('Page.navigate',{url:fixture.origin+'/'});await ready();
   assert.equal(await browser.evaluate('!document.getElementById("welcome").hidden&&document.getElementById("gallery").hidden&&document.getElementById("loading").hidden'),true);await noWorld();await shot('welcome');
   const loadedSha=await browser.evaluate('(async()=>{const source=[...document.scripts].find(script=>/\\/viewer\\.js$/.test(script.src)).src;const bytes=await(await fetch(source)).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(value=>value.toString(16).padStart(2,"0")).join("");})()');assert.equal(loadedSha,options.expectedPublicSha256);report.browserBundleSha256=loadedSha;
   await browser.evaluate('document.getElementById("explore-scenes").click()');await browser.until(()=>browser.evaluate('location.hash==="#escenarios"&&!document.getElementById("gallery").hidden'),'The welcome action did not open the gallery.');
   assert.deepEqual(await visibleIds(),[PUBLIC_ID]);await noWorld();
   const publicImage=await browser.evaluate('(()=>{const img=document.querySelector(".scene-card img");return img&&{src:img.src,loading:img.loading,decoding:img.decoding};})()');assert(publicImage);assert.equal(publicImage.loading,'lazy');assert.equal(publicImage.decoding,'async');assert(!new URL(publicImage.src).pathname.includes('/workspace/'));
   await browser.until(()=>browser.evaluate('document.querySelector(".scene-card img").naturalWidth===480'),'The public scene photograph did not decode.',15000);await shot('anonymous-gallery');
   const loginURL=await browser.evaluate('document.getElementById("gallery-access").href');assert.equal(new URL(loginURL).pathname,'/login');
   await browser.send('Page.navigate',{url:loginURL});await browser.until(()=>browser.evaluate('location.pathname==="/login"&&!!document.getElementById("login")'),'The gallery account action did not reach login.');
   await browser.call((username,password)=>{const form=document.getElementById('login');form.elements.username.value=username;form.elements.password.value=password;form.requestSubmit();},'qa_production_owner',password);
   await browser.until(()=>browser.evaluate('location.pathname==="/"&&!!window.smartTwinGallery'),'Login did not return to the welcome screen.');await ready();
   assert.equal(await browser.evaluate('smartTwinGallery.getStats().authenticated'),true);await noWorld();
   await browser.evaluate('document.getElementById("explore-scenes").click()');await browser.until(()=>browser.call(count=>document.querySelectorAll('.scene-card[data-scene-id]').length===count,expected.length),'The authenticated gallery did not show the maintained scene list without its legacy demo alias.');
   const cards=await browser.evaluate('[...document.querySelectorAll(".scene-card[data-scene-id]")].map(card=>({id:card.dataset.sceneId,title:card.querySelector(".scene-card-title").textContent,description:card.querySelector(".scene-card-description").textContent,objective:card.querySelector(".scene-card-guide p")?.textContent||"",tasks:[...card.querySelectorAll(".scene-card-guide li")].map(node=>node.textContent),image:card.querySelector("img")?.src,loading:card.querySelector("img")?.loading,decoding:card.querySelector("img")?.decoding,action:card.querySelector(".scene-open")?.href||null}))');
   assert.equal(cards.length,expected.length);assert.equal(new Set(cards.map(card=>card.id)).size,expected.length);assert(!cards.some(card=>card.id===PUBLIC_ID));report.thumbnailResponses=[];
   for(const card of cards){
    const original=byId.get(card.id);assert(original,card.id);assert.equal(card.title,original.title,card.id+' title');assert.equal(card.description,original.description,card.id+' description');assert.equal(card.objective,original.objective||'',card.id+' objective');assert.deepEqual(card.tasks,original.tasks,card.id+' tasks');assert(card.image);assert.equal(card.loading,'lazy');assert.equal(card.decoding,'async');
    const url=new URL(card.image);assert.equal(url.origin,fixture.origin);assert.equal(url.pathname,(card.id===PUBLIC_ID?'/':'/workspace/')+PREVIEWS+card.id+'.png');
    const image=await request(fixture.origin,url.pathname+url.search,'GET',undefined,ownerCookie);assert.equal(image.status,200);assert.equal(image.sha256,thumbnails.rows.get(card.id).sha256);report.thumbnailResponses.push({id:card.id,path:url.pathname,status:image.status,sha256:image.sha256});
    if(card.id!==PUBLIC_ID){const target=new URL(card.action);assert.equal(target.origin,fixture.origin);assert.equal(target.pathname,'/editor');assert.equal(target.searchParams.get('libraryScene'),card.id);}
   }
   report.metadata={titles:cards.length,descriptions:cards.length,objectiveGuides:cards.filter(card=>card.objective).length,matchedExistingMenu:true};
   const target=expected.find(entry=>entry.objective&&entry.tasks.length);assert(target);const phrase=target.objective.slice(0,55);
   await browser.call(id=>{const card=[...document.querySelectorAll('.scene-card')].find(node=>node.dataset.sceneId===id);window.__galleryQaCard=card;window.__galleryQaImage=card.querySelector('img');card.querySelector('details').open=true;},target.id);
   await filter('objective search',{'scene-search':phrase},entry=>normalize([entry.title,entry.category,entry.description,entry.objective].join(' ')).includes(normalize(phrase)));
   await filter('accent-insensitive search',{'scene-search':'fotogrametria'},entry=>normalize([entry.title,entry.category,entry.description,entry.objective].join(' ')).includes('fotogrametria'));
   await filter('category',{'scene-category':'Realidad virtual compacta'},entry=>entry.category==='Realidad virtual compacta');
   await filter('difficulty',{'scene-level':'2'},entry=>entry.difficulty===2);
   await filter('manual mode',{'scene-mode':'manual'},entry=>entry.mode==='manual');
   await filter('original exploration mode',{'scene-mode':'explore'},entry=>entry.mode==='explore');
   await filter('combined filters',{'scene-category':'Fundamentos','scene-level':'2','scene-mode':'automatic'},entry=>entry.category==='Fundamentos'&&entry.difficulty===2&&entry.mode==='automatic');
   await filter('empty search',{'scene-search':'qa-inexistent-scene-87413'},()=>false);assert.equal(await browser.evaluate('!document.getElementById("gallery-empty").hidden'),true);
   await clear();assert.equal(await browser.call(count=>document.querySelectorAll('.scene-card').length===count&&window.__galleryQaCard.isConnected&&window.__galleryQaImage===window.__galleryQaCard.querySelector('img')&&window.__galleryQaCard.querySelector('details').open,expected.length),true,'Filtering must keep existing card/image/detail nodes instead of reloading images.');
   console.log('Gallery cards Chrome: '+expected.length+' lazy photographs and filters');
   for(const card of cards){await browser.call(id=>[...document.querySelectorAll('.scene-card')].find(node=>node.dataset.sceneId===id).scrollIntoView({block:'center'}),card.id);await browser.until(()=>browser.call(id=>{const card=[...document.querySelectorAll('.scene-card')].find(node=>node.dataset.sceneId===id),image=card&&card.querySelector('img');return image&&image.naturalWidth===480&&image.naturalHeight===320;},card.id),'The actual thumbnail did not decode: '+card.id,15000);}
   report.decodedThumbnails=cards.length;await noWorld();await browser.evaluate('document.getElementById("gallery").scrollTo(0,0);window.scrollTo(0,0)');await shot('desktop-gallery');
   await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await browser.evaluate('document.getElementById("gallery").scrollTo(0,0);window.scrollTo(0,0)');
   await browser.until(()=>browser.evaluate('innerWidth===390'),'The mobile viewport did not apply.');
   report.mobile=await browser.evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,cards:document.querySelectorAll(".scene-card").length,worlds:document.querySelectorAll("#viewer canvas").length,filters:["scene-search","scene-category","scene-level","scene-mode"].every(id=>!!document.getElementById(id))})');assert(report.mobile.scrollWidth<=391);assert.equal(report.mobile.worlds,0);assert.equal(report.mobile.filters,true);await shot('mobile-gallery');
   assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin+'/')&&row.status>=400),[]);assert.deepEqual(fixture.errors,[]);
  });
  report.passed=true;console.log('Gallery cards QA passed: '+options.expectedPublicSha256);return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUTPUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();}
}
module.exports={run,auditThumbnails};
if(require.main===module){const index=process.argv.indexOf('--expected-public-sha256');run({expectedPublicSha256:index<0?null:process.argv[index+1]}).catch(error=>{console.error(error);process.exitCode=1;});}
