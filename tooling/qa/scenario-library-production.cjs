'use strict';
// Immutable production bundles, disposable HTTPS/SQLite and disposable Chrome.
// Uses learner controls only; never changes actor poses, stock or progression.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/scenario-library-production');
const index=require('../../modules/logistica-industrial/practices/configurable/index.cjs');
const ASSETS='modules/logistica-industrial/practices/configurable/assets/catalog/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function sourceCheck(){
 assert.equal(index.entries.length,10);assert.deepEqual(index.groups.map(row=>row.id),['logistics','industrial']);
 const thumbnails=index.entries.map(row=>{const relative=ASSETS+row.id+'.webp',bytes=fs.readFileSync(path.join(ROOT,relative));assert.equal(bytes.subarray(0,4).toString(),'RIFF',relative);assert.equal(bytes.subarray(8,12).toString(),'WEBP',relative);assert(bytes.length>=10000,relative+' must contain a real web image, not an icon.');return{id:row.id,path:relative,bytes:bytes.length,sha256:sha(bytes)};});
 assert.equal(new Set(thumbnails.map(row=>row.sha256)).size,10,'Each practice needs its own illustration.');
 return{cards:10,routes:2,thumbnails};
}
function reviewed(app,file,expected){
 assert.match(expected||'',/^[a-f0-9]{64}$/,'Pass both reviewed bundle hashes before browser QA.');
 const folder=path.join(ROOT,'artifacts',app),manifest=JSON.parse(fs.readFileSync(path.join(folder,'publication.json'),'utf8'));
 assert.equal(sha(fs.readFileSync(path.join(folder,file))),expected,app+' bundle changed after review.');assert.equal(manifest.bundleSha256,expected,app+' publication receipt is stale.');return manifest;
}
function packagedImages(manifest,source){
 return source.thumbnails.map(image=>{const row=manifest.files.find(row=>row.path===image.path);assert(row,'Missing packaged catalogue image '+image.path);const bytes=fs.readFileSync(path.join(ROOT,'artifacts/workspace',image.path));assert.equal(sha(bytes),row.sha256);assert.equal(row.sha256,image.sha256);return{path:row.path,sha256:row.sha256};});
}
function packagedPage(manifest){
 const rows=manifest.files.filter(row=>/^(?:catalogue\.html|scenario-library\.js)$/.test(row.path)||row.path==='modules/logistica-industrial/practices/ui/practice.css');
 assert(rows.some(row=>row.path==='catalogue.html')&&rows.some(row=>row.path==='scenario-library.js'),'The reviewed publication needs the independent catalogue HTML and entry bundle.');
 return rows.map(row=>{assert.equal(sha(fs.readFileSync(path.join(ROOT,'artifacts/workspace',row.path))),row.sha256,'Catalogue publication mismatch: '+row.path);return{path:row.path,sha256:row.sha256};});
}
const instrument=`(()=>{
 const original=HTMLCanvasElement.prototype.getContext,seen=new WeakSet();
 window.__libraryQA={webglCreated:0,webglCanvasIds:[],posts:[],documentToken:String(Date.now())+'-'+Math.random()};
 HTMLCanvasElement.prototype.getContext=function(type){const result=original.apply(this,arguments);if(result&&/^(webgl2?|experimental-webgl)$/.test(String(type))&&!seen.has(this)){seen.add(this);__libraryQA.webglCreated++;__libraryQA.webglCanvasIds.push(this.id||'(unnamed)');}return result;};
 const fetchOriginal=window.fetch;window.fetch=function(input,init){const url=typeof input==='string'?input:input&&input.url||'';if(init&&String(init.method||'GET').toUpperCase()==='POST')__libraryQA.posts.push(new URL(url,location.href).pathname);return fetchOriginal.apply(this,arguments);};
})();`;
function isWorldResource(url){const name=new URL(url).pathname;return /\/workspace\/bundle\.js$|logistics-practice-scenes|\.(?:glb|gltf|fbx|obj)(?:$)|\/projects\/[^/]+\/scenes\/[^/]+\.json$|\/res\//i.test(name);}
async function run({expectedWorkspaceSha256,expectedPublicSha256}={}){
 const manifest=reviewed('workspace','bundle.js',expectedWorkspaceSha256);reviewed('public-viewer','viewer.js',expectedPublicSha256);
 const source=sourceCheck(),packaged=packagedImages(manifest,source),pageFiles=packagedPage(manifest);fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const password='Disposable-Library-'+randomBytes(18).toString('hex'),fixture=await startFixture(password,{voice:{enabled:false,key:''}});
 const report={startedAt:new Date().toISOString(),workspaceSha256:expectedWorkspaceSha256,publicSha256:expectedPublicSha256,source,packaged,pageFiles,temporaryDatabaseOnly:true,physicalQuestTest:false,exceptions:[],consoleErrors:[],responses:[],failedRequests:[],screenshots:[],views:[],filterChecks:[]};
 try{
  await withBrowser(fixture,report,async b=>{
   const mark=stage=>{report.stage=stage;console.log('Scenario library QA: '+stage);};
   const until=(callback,message)=>b.until(callback,message,120000);
   const size=async(width,height,mobile=false)=>{await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await delay(200);};
   const click=async selector=>{const point=await b.call(selector=>{const node=document.querySelector(selector);if(!node||node.disabled)throw Error('Unavailable control: '+selector);node.scrollIntoView({block:'center',inline:'nearest'});const box=node.getBoundingClientRect();return{x:box.x+box.width/2,y:box.y+box.height/2};},selector);await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});};
   const shot=async name=>{await delay(150);const result=await b.send('Page.captureScreenshot',{format:'png'}),filename=path.join(OUT,name+'.png');fs.writeFileSync(filename,Buffer.from(result.data,'base64'));report.screenshots.push(filename);};
   const catalogueReady=()=>until(()=>b.evaluate('document.documentElement.dataset.page==="scenario-library"&&!!document.querySelector("#scenario-library-page .st-practice-card")&&document.querySelectorAll(".st-practice-card").length===10'),'The independent ten-card catalogue did not open.');
   const noWorld=async(label,startResponse=0)=>{
    const state=await b.call(label=>({label,url:location.pathname+location.search,page:document.documentElement.dataset.page,contexts:__libraryQA.webglCreated,canvas:document.querySelectorAll('canvas').length,context:!!(window.context&&window.context.editor),world:!!window.world,viewer:!!window.smartTwinViewer,root:!!document.getElementById('scenario-library-page')}),label);
    assert.equal(state.contexts,0,label+' instantiated WebGL.');assert.equal(state.canvas,0,label+' left a canvas behind the catalogue.');assert(!state.context&&!state.world&&!state.viewer,label+' retained a running world.');
    state.worldResources=report.responses.slice(startResponse).filter(row=>row.url.startsWith(fixture.origin)&&isWorldResource(row.url));assert.deepEqual(state.worldResources,[],label+' downloaded a world before selection.');report.views.push(state);return state;
   };
   const setSearch=async value=>{await b.call(value=>{const field=document.querySelector('input[data-practice-search]');field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));},value);};
   const inspectSurface=async label=>b.call(label=>{
    const shown=node=>{const s=getComputedStyle(node),box=node.getBoundingClientRect();return !node.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&box.width>0&&box.height>0;};
    const root=document.querySelector('.st-practice-browser'),list=root.querySelector('.st-practice-list'),cards=[...root.querySelectorAll('.st-practice-card')];
    const rgba=value=>{const n=(value.match(/[\d.]+/g)||[]).map(Number);return[n[0]||0,n[1]||0,n[2]||0,n.length>3?n[3]:1];};
    const composite=(a,b)=>[a[0]*a[3]+b[0]*(1-a[3]),a[1]*a[3]+b[1]*(1-a[3]),a[2]*a[3]+b[2]*(1-a[3]),1];
    const background=node=>{const chain=[];for(let parent=node;parent;parent=parent.parentElement)chain.unshift(parent);return chain.reduce((color,parent)=>composite(rgba(getComputedStyle(parent).backgroundColor),color),[255,255,255,1]);};
    const luminance=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);}).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
    const contrast=node=>{const bg=background(node),fg=composite(rgba(getComputedStyle(node).color),bg),a=luminance(fg),b=luminance(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
    return{label,width:innerWidth,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,rootOverflow:root.scrollWidth>root.clientWidth+2,listOverflow:list.scrollWidth>list.clientWidth+2,selects:root.querySelectorAll('.st-practice-filters select').length,filters:[...root.querySelectorAll('button[data-practice-filter]')].map(node=>({id:node.dataset.practiceFilter,name:node.textContent.trim()||node.getAttribute('aria-label'),pressed:node.getAttribute('aria-pressed'),height:node.getBoundingClientRect().height,visible:shown(node)})),search:!!root.querySelector('label input[data-practice-search],input[data-practice-search][aria-label]'),cards:cards.map(card=>{const image=card.querySelector('[data-practice-thumbnail]'),title=card.querySelector('summary>strong'),badge=card.querySelector('.st-practice-validation');return{id:card.dataset.practiceId,locked:card.dataset.locked==='true',title:title.textContent,fontSize:parseFloat(getComputedStyle(title).fontSize),contrast:contrast(title),badgeContrast:contrast(badge),opacity:getComputedStyle(card).opacity,image:image&&{src:new URL(image.currentSrc||image.src).pathname,loaded:image.complete&&image.naturalWidth>0,width:image.naturalWidth,height:image.naturalHeight,alt:image.alt,fit:getComputedStyle(image).objectFit},illustrative:/ilustr|referenc/i.test(card.textContent+' '+(image&&image.alt||''))};})};
   },label);
   const checkSurface=surface=>{assert(!surface.overflow&&!surface.rootOverflow&&!surface.listOverflow,surface.label+' has horizontal overflow.');assert.equal(surface.selects,0,'The area dropdown duplicates category buttons.');assert(surface.search,'Search needs an accessible name.');assert.deepEqual(surface.filters.map(row=>row.id),['all','logistics','industrial']);assert(surface.filters.every(row=>row.visible&&row.name&&row.height>=38));assert.equal(surface.filters.filter(row=>row.pressed==='true').length,1);for(const card of surface.cards){assert(card.fontSize>=16);assert(card.contrast>=4.5,card.id+' title is hard to read.');if(card.locked){assert(card.badgeContrast>=4.5,card.id+' lock prerequisite is hard to read.');assert.equal(card.opacity,'1');}}};
   await b.send('Page.addScriptToEvaluateOnNewDocument',{source:instrument});await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});await size(1440,1000);
   mark('Home -> dedicated library; no world preload');await b.send('Page.navigate',{url:fixture.origin+'/'});await until(()=>b.evaluate('!!document.getElementById("explore-scenes")&&!document.getElementById("welcome").hidden'),'Homepage did not open.');await noWorld('anonymous-home');await shot('home-1440');
   await click('#explore-scenes');await until(()=>b.evaluate('!!document.getElementById("login")||document.documentElement.dataset.page==="scenario-library"'),'Explore did not navigate to catalogue/login.');
   if(await b.evaluate('!!document.getElementById("login")')){await noWorld('catalogue-login');await b.call((username,password)=>{const form=document.getElementById('login');form.elements.username.value=username;form.elements.password.value=password;form.requestSubmit();},'qa_production_owner',password);}
   await catalogueReady();await noWorld('dedicated-catalogue');assert.equal(await b.evaluate('location.pathname'),'/play');assert.equal(await b.evaluate('document.querySelectorAll(".st-practice-browser[data-presentation=page]").length'),1);
   mark('Ten decoded reference thumbnails and legible locked cards');
   for(const id of index.entries.map(row=>row.id)){await b.call(id=>document.querySelector('[data-practice-id="'+id+'"]').scrollIntoView({block:'center'}),id);await until(()=>b.call(id=>{const image=document.querySelector('[data-practice-thumbnail="'+id+'"]');return image&&image.complete&&image.naturalWidth>0;},id),'Catalogue illustration did not decode: '+id);}
   report.desktop=await inspectSurface('catalogue-1440');checkSurface(report.desktop);assert.equal(report.desktop.cards.length,10);assert.equal(report.desktop.cards.filter(card=>card.locked).length,8);assert.equal(new Set(report.desktop.cards.map(card=>card.image.src)).size,10);
   for(const card of report.desktop.cards){assert(card.image.loaded&&card.image.width>=640&&card.image.height>=360,card.id+' needs a detailed image.');assert(card.image.alt.trim());assert.equal(card.image.fit,'contain','Complete equipment illustrations must remain in frame.');assert(card.illustrative,card.id+' reference art must be labelled as illustration.');assert.equal(card.image.src,'/workspace/'+ASSETS+card.id+'.webp');}
   await b.call(()=>document.querySelector('.st-practice-list').scrollTop=0);await shot('catalogue-1440');
   mark('Accessible category buttons and search');
   for(const[id,count]of[['logistics',5],['industrial',5],['all',10]]){await click('[data-practice-filter="'+id+'"]');const surface=await inspectSurface('filter-'+id);checkSurface(surface);assert.equal(surface.cards.length,count);assert.equal(surface.filters.find(row=>row.id===id).pressed,'true');report.filterChecks.push({id,count});}
   await b.call(()=>{const button=document.querySelector('[data-practice-filter="logistics"]');button.focus();if(document.activeElement!==button)throw Error('Category button did not receive keyboard focus.');__libraryQA.keyboard=[];for(const type of ['keydown','keypress','keyup'])button.addEventListener(type,event=>__libraryQA.keyboard.push({type:event.type,key:event.key,trusted:event.isTrusted,prevented:event.defaultPrevented}));});
   // CDP does not synthesize a character event from raw key codes alone. Match
   // an actual Enter press so native BUTTON activation is exercised by Chrome.
   await b.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
   await b.send('Input.dispatchKeyEvent',{type:'char',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
   await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
   report.keyboard=await b.evaluate('({events:__libraryQA.keyboard,cards:document.querySelectorAll(".st-practice-card").length})');assert(report.keyboard.events.every(event=>event.trusted),'Keyboard activation must use browser input, not dispatchEvent.');assert.equal(report.keyboard.cards,5);await click('[data-practice-filter="all"]');
   await setSearch('CEDI-04');assert.equal(await b.evaluate('document.querySelectorAll(".st-practice-card").length'),1);assert.equal(await b.evaluate('document.querySelector(".st-practice-card").dataset.practiceId'),'CEDI-04');await setSearch('nothing-matches-qa');assert.equal(await b.evaluate('document.querySelectorAll(".st-practice-card").length'),0);assert(await b.evaluate('!!document.querySelector(".st-practice-empty")'));await setSearch('');
   await size(390,844,true);report.mobile=await inspectSurface('catalogue-390');checkSurface(report.mobile);assert.equal(report.mobile.cards.length,10);await b.call(()=>document.querySelector('.st-practice-list').scrollTop=0);await shot('catalogue-390');
   await click('[data-practice-id="CEDI-02"]>summary');await until(()=>b.evaluate('!!document.querySelector(".st-practice-setup")'),'Locked practice configuration did not open.');report.locked=await b.call(()=>({disabled:document.querySelector('.st-practice-create').disabled,message:document.querySelector('.st-practice-setup').textContent,contexts:__libraryQA.webglCreated}));assert(report.locked.disabled);assert.match(report.locked.message,/CEDI-01|anterior|requisito/i);assert.equal(report.locked.contexts,0);await shot('locked-practice-390');await click('[data-practice-id="CEDI-02"]>summary');
   await noWorld('filtered-mobile-catalogue');await size(1440,1000);
   mark('One explicit prepared practice -> one native world');
   const postsBefore=report.responses.filter(row=>new URL(row.url).pathname==='/api/studio/practices/attempts'&&row.status===201).length;
   await click('[data-practice-id="CEDI-01"]>summary');await until(()=>b.evaluate('!!document.querySelector(".st-practice-setup")'),'Prepared practice form did not open.');assert.equal(await b.evaluate('document.querySelector(".st-practice-create").disabled'),false);await noWorld('prepared-settings');await click('.st-practice-create');
   await until(()=>b.evaluate('!!window.context&&!!context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&!!context.editor.practiceController&&context.studio.practiceCampaign.activeManifest().practiceId==="CEDI-01"'),'Selected prepared practice did not start.');await b.evaluate('context.studio.ready');
   report.started=await b.call(async()=>{const start=context.editor.simulation.time;await new Promise(resolve=>{let frames=0;const tick=()=>++frames>=5?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick);});const host=context.studio.practiceCampaign,m=host.activeManifest();return{practiceId:m.practiceId,contexts:__libraryQA.webglCreated,attemptId:host.attempt&&host.attempt.id,running:context.editor.simulation.running,startTime:start,endTime:context.editor.simulation.time,controllers:document.querySelectorAll('.st-practice-panel').length,catalogues:document.querySelectorAll('#scenario-library-page').length,gl:context.renderer.getContext().getError(),stock:context.editor.practiceController.snapshot().totalUnits};});
   assert.equal(report.started.contexts,1);assert.equal(report.started.controllers,1);assert.equal(report.started.catalogues,0);assert(report.started.running&&report.started.endTime>report.started.startTime);assert(report.started.attemptId);assert.equal(report.started.gl,0);assert.equal(report.started.stock,48);assert.equal(report.responses.filter(row=>new URL(row.url).pathname==='/api/studio/practices/attempts'&&row.status===201).length-postsBefore,1);await shot('selected-practice-1440');
   mark('Menu -> catalogue -> browser Back lifecycle');
   await click('.studio-menu');await until(()=>b.evaluate('!!document.querySelector(".studio-drawer:not([hidden])")'),'Native menu did not open.');
   const menuSelector=await b.call(()=>{const button=[...document.querySelectorAll('.studio-drawer button')].find(row=>/Escenarios/.test(row.textContent));if(!button)throw Error('Missing real menu catalogue control.');button.setAttribute('data-library-qa-navigation','');return'[data-library-qa-navigation]';});
   const returnResponses=report.responses.length;await click(menuSelector);await catalogueReady();report.returned=await noWorld('catalogue-after-menu',returnResponses);await shot('catalogue-returned-1440');
   await b.send('Page.navigateToHistoryEntry',{entryId:(await b.send('Page.getNavigationHistory')).entries[(await b.send('Page.getNavigationHistory')).currentIndex-1].id});
   await until(()=>b.evaluate('!!window.context&&!!context.editor&&!!context.editor.practiceController&&!context.editor.loadingProject'),'Browser Back did not safely restore/reload the selected practice.');
   report.back=await b.call(()=>({practice:context.studio.practiceCampaign.activeManifest().practiceId,contexts:__libraryQA.webglCreated,controllers:document.querySelectorAll('.st-practice-panel').length,running:context.editor.simulation.running,gl:context.renderer.getContext().getError()}));assert.equal(report.back.practice,'CEDI-01');assert.equal(report.back.contexts,1);assert.equal(report.back.controllers,1);assert(report.back.running);assert.equal(report.back.gl,0);
   const progress=await b.call(async()=>{const response=await fetch('/api/studio/practices/progress',{credentials:'same-origin'});if(!response.ok)throw Error('Cannot verify disposable campaign state.');return(await response.json()).progress;});assert.equal(progress.routes.cedi.completed.length,0);assert.equal(progress.routes['smart-factory'].completed.length,0);report.noFabricatedCompletion=true;
   assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);assert.deepEqual(fixture.errors,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin+'/')&&row.status>=400),[]);
  });
  reviewed('workspace','bundle.js',expectedWorkspaceSha256);reviewed('public-viewer','viewer.js',expectedPublicSha256);assert.deepEqual(packagedImages(manifest,source),packaged);assert.deepEqual(packagedPage(manifest),pageFiles);report.passed=true;return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,stage:report.stage,report:path.join(OUT,'report.json'),screenshots:report.screenshots.length}));}
}
module.exports={run,sourceCheck,isWorldResource};
if(require.main===module){if(process.argv.includes('--check'))console.log(JSON.stringify(sourceCheck(),null,2));else{const flag=key=>{const at=process.argv.indexOf(key);return at<0?undefined:process.argv[at+1];};run({expectedWorkspaceSha256:flag('--expected-workspace-sha256'),expectedPublicSha256:flag('--expected-public-sha256')}).catch(error=>{console.error(error);process.exitCode=1;});}}
