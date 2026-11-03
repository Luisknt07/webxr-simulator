'use strict';
// Reviewed immutable artifacts; one disposable Chrome; isolated HTTPS/SQLite.
// Only visible learner actions launch scenes. No award, actor teleport or real
// account/database is used. CPU/software WebGL is not a headset FPS benchmark.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/practice-facilities');
const SOURCE=require('../../modules/logistica-industrial/practices/configurable/data/source.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function guard(app,file,expected){
 assert.match(expected||'',/^[a-f0-9]{64}$/,'Supply final reviewed bundle hashes before starting Chrome.');
 const folder=path.join(ROOT,'artifacts',app),manifest=JSON.parse(fs.readFileSync(path.join(folder,'publication.json'),'utf8'));
 assert.equal(hash(fs.readFileSync(path.join(folder,file))),expected);assert.equal(manifest.bundleSha256,expected);
 for(const row of manifest.files.filter(row=>row.path.endsWith('.css')))assert.equal(hash(fs.readFileSync(path.join(folder,row.path))),row.sha256,'Stale stylesheet '+row.path);
 return manifest;
}
async function run({expectedWorkspaceSha256,expectedPublicSha256}={}){
 guard('workspace','bundle.js',expectedWorkspaceSha256);guard('public-viewer','viewer.js',expectedPublicSha256);
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const password='Disposable-Installations-'+randomBytes(16).toString('hex');
 const report={startedAt:new Date().toISOString(),workspaceSha256:expectedWorkspaceSha256,publicSha256:expectedPublicSha256,temporaryDataOnly:true,physicalQuestTest:false,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],scenes:[],mobile:[],claims:'Ten source practice montages via real learner controls; stock identity, facilities, initial collision clearance, desktop/mobile viewport, bounded real render loop. No manufactured completion or physical device FPS claim.'};
 const fixture=await startFixture(password,{voice:{enabled:false,key:''}});
 try{
  const login=await request(fixture.origin,'/api/studio/login','POST',{username:'qa_production_owner',password});assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'][0].split(';')[0];
  await withBrowser(fixture,report,async b=>{
   const mark=stage=>{report.stage=stage;console.log('Practice facilities QA: '+stage);};
   const until=(callback,message)=>b.until(callback,message,120000);
   const shot=async name=>{const data=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(data.data,'base64'));report.screenshots.push(file);};
   const size=async(width,height,mobile=false)=>{await b.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:mobile?5:1});await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await b.call(()=>{if(context.editor)context.editor.resize();});await b.call(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
   const setting=async(key,value)=>b.call(({key,value})=>{const input=document.querySelector('.st-practice-setup [data-practice-setting="'+key+'"]');if(!input)throw Error('Missing setting '+key);input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));},{key,value});
   const viewport=()=>b.call(()=>{
    const rect=node=>{if(!node)return null;const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    return{width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+2,frame:rect(document.querySelector('[data-practice-scene-viewport]')),canvas:rect(context.renderer.domElement),aspect:context.camera.aspect,fitted:context.renderer.domElement.hasAttribute('data-practice-render-viewport')};
   });
   const checkViewport=value=>{assert(!value.overflow,'Document must not overflow horizontally.');if(value.frame&&value.frame.width>=64&&value.frame.height>=64){assert(value.fitted);for(const key of ['x','y','width','height'])assert(Math.abs(value.frame[key]-value.canvas[key])<1.2,'Render viewport mismatch '+key);assert(Math.abs(value.aspect-value.canvas.width/value.canvas.height)<.004);}};
   const frames=()=>b.call(async()=>{
    const samples=[],start=performance.now();for(let i=0;i<8;i++){await new Promise(resolve=>requestAnimationFrame(resolve));samples.push({frame:context.renderer.info.render.frame,calls:context.renderer.info.render.calls,triangles:context.renderer.info.render.triangles});}
    return{samples,elapsedMs:performance.now()-start,memory:{...context.renderer.info.memory},programs:(context.renderer.info.programs||[]).length,gl:context.renderer.getContext().getError()};
   });
   await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
   await b.send('Page.navigate',{url:fixture.origin+'/play'});await until(()=>b.evaluate('!!document.getElementById("login")'),'Isolated login did not appear.');
   await b.call(password=>{const form=document.getElementById('login');form.elements.username.value='qa_production_owner';form.elements.password.value=password;form.requestSubmit();},password);
   await until(()=>b.evaluate('!!window.context&&!!context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&!!context.studio&&!!context.studio.practiceCampaign'),'Packaged learner did not initialize.');await b.evaluate('context.studio.ready');await size(1440,1000);
   await until(()=>b.evaluate('document.querySelectorAll(".st-practice-card").length===10'),'Exactly ten source practice cards expected.');
   report.catalogue=await b.call(()=>({cards:document.querySelectorAll('.st-practice-card').length,groups:[...document.querySelectorAll('.st-practice-domain>h3')].map(row=>row.textContent)}));assert.equal(report.catalogue.groups.length,2);
   for(const record of SOURCE.records){
    const id=record.id;mark(id+' manual / A / baseline');
    await b.call(()=>context.studio.open('scenes'));await until(()=>b.evaluate('document.querySelectorAll(".st-practice-card").length===10'),'Practice browser did not reopen.');
    await b.call(id=>{const search=document.querySelector('.st-practice-filters input');search.value=id;search.dispatchEvent(new Event('input',{bubbles:true}));const card=[...document.querySelectorAll('.st-practice-card')].find(row=>row.querySelector('.st-practice-code').textContent===id);if(!card)throw Error('Missing practice '+id);card.open=true;card.dispatchEvent(new Event('toggle'));},id);
    await until(()=>b.evaluate('!!document.querySelector(".st-practice-setup")'),'Native setup did not open.');
    await setting('caseId','A');await setting('mode','manual');await setting('difficulty',1);await setting('executionMode','isolated');
    await b.call(()=>{const start=document.querySelector('.st-practice-create');if(!start||start.disabled)throw Error('Launch disabled: '+document.querySelector('.st-practice-setup').textContent);start.click();});
    await until(()=>b.call(id=>{const host=context.studio.practiceCampaign,m=host.activeManifest();return!!m&&m.practiceId===id&&!host.busy;},id),'Practice failed to mount '+id);
    await until(()=>b.call(()=>{const e=context.editor,m=context.studio.practiceCampaign.activeManifest(),textures=new Set(),ids=new Set((m.facility.objects||[]).map(row=>row.objectId));for(const object of e.document.getObjects(m.roomId))if(ids.has(object.userData.editorId))object.traverse(n=>{if(n.material)for(const material of(Array.isArray(n.material)?n.material:[n.material]))if(material&&material.map)textures.add(material.map);});return textures.size>=2&&[...textures].every(t=>t.image&&(t.image.data||t.image.complete!==false));}),'Facility textures did not become available.');
    const row=await b.call(()=>{
     const e=context.editor,host=context.studio.practiceCampaign,m=host.activeManifest(),runtime=e.simulation,controller=e.practiceController,world=context.collisionWorld,point=context.camera.getWorldPosition(context.camera.position.clone()),parts=[],textures=new Set();
     const facilityById=new Map((m.facility.objects||[]).map(row=>[row.objectId,row]));for(const object of e.document.getObjects(m.roomId))if(facilityById.has(object.userData.editorId)){let meshes=0;object.traverse(node=>{if(!node.isMesh)return;meshes++;for(const material of(Array.isArray(node.material)?node.material:[node.material]))if(material)for(const key of['map','bumpMap','normalMap','roughnessMap'])if(material[key])textures.add(material[key]);});parts.push({name:object.name,...facilityById.get(object.userData.editorId),meshes});}
     const products=(m.productIds||[]).map(id=>{const object=e.document.getObject(id),p=object&&runtime&&runtime.products&&runtime.products.get(object),behavior=object&&e.document.getBehaviors(object).find(b=>b.type==='product');return{id,exists:!!object,mounted:!!p,units:p&&runtime.productMetadata?runtime.productMetadata(p).units:behavior&&behavior.units,mass:behavior&&behavior.mass};});
     const state=controller&&controller.state(),source=state&&state.world;
     return{practiceId:m.practiceId,mode:m.mode,caseId:m.caseId,ready:!!m.availability.ready,preview:!!host.preview,controller:!!controller,attempt:!!host.attempt,passed:state&&state.session.passed,facility:m.facility,parts,textures:[...textures].map(t=>({width:t.image&&t.image.width,height:t.image&&t.image.height,data:!!(t.image&&t.image.data),ready:!!t.image&&(!!t.image.data||t.image.complete!==false)})),initialEye:point.toArray(),cameraFree:!!world&&typeof world.canOccupyCapsule==='function'?world.canOccupyCapsule(point,{radius:.3,height:1.65}):null,products,source:source&&{sourceUnits:source.sourceUnits,totalUnits:source.totalUnits,initialUnits:source.initialUnits},gl:context.renderer.getContext().getError(),nativePresentationFailure:runtime&&runtime.nativePresentationFailure,nativeRenderBanks:runtime&&runtime.nativeRenderBanks&&runtime.nativeRenderBanks.getStats?runtime.nativeRenderBanks.getStats():null};
    });
    assert.equal(row.practiceId,id);assert.equal(row.mode,'manual');assert.equal(row.caseId,'A');assert.equal(row.gl,0);assert(!row.nativePresentationFailure,'Render banks must initialize without silent fallback.');assert(row.facility&&row.facility.bounds,'A real facility must be mounted.');assert(row.parts.some(p=>p.role==='envelope'));assert(row.textures.length>=2&&row.textures.every(t=>t.ready),'Facility texture data must be available.');assert(row.products.length>0&&row.products.every(p=>p.exists),'Declared material stock must exist.');assert.notEqual(row.cameraFree,false,'Initial walking eye overlaps an installation.');assert(!row.passed,'A renderer check must not complete the attempt.');
    if(row.ready){assert(row.controller&&row.attempt&&!row.preview);if(row.source)assert.equal(row.source.totalUnits,row.source.initialUnits,'Opening a view must conserve source units.');}else assert(row.preview&&!row.controller&&!row.attempt,'An unavailable evaluated adapter must remain explicitly in consultation.');
    row.frames=await frames();assert.equal(row.frames.gl,0);assert(row.frames.samples.at(-1).frame>row.frames.samples[0].frame,'Native render loop stopped.');
    row.viewport=await viewport();checkViewport(row.viewport);await shot(id.toLowerCase()+'-workspace-1440');
    const hasFocus=await b.call(()=>{const button=document.querySelector('[data-practice-focus]');if(button){button.click();return true;}return false;});
    if(hasFocus){await b.call(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));row.fullScene=await viewport();checkViewport(row.fullScene);await shot(id.toLowerCase()+'-full-scene');await b.call(()=>document.querySelector('[data-practice-focus]').click());}
    if(['CEDI-01','SF-01'].includes(id))for(const dimensions of[[390,844],[844,390]]){
     await size(...dimensions,true);const mobile={id,...await viewport()};checkViewport(mobile);
     mobile.tabs=await b.call(()=>[...document.querySelectorAll('.st-practice-learning-navigation [data-practice-pane]')].map(n=>n.getAttribute('data-practice-pane')));if(row.controller)assert(mobile.tabs.includes('scene')&&mobile.tabs.includes('instructions'));
     await shot(id.toLowerCase()+'-mobile-'+dimensions[0]);
     if(mobile.tabs.includes('scene')){await b.call(()=>document.querySelector('.st-practice-learning-navigation [data-practice-pane="scene"]').click());await b.call(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));mobile.scene=await viewport();checkViewport(mobile.scene);await shot(id.toLowerCase()+'-mobile-scene-'+dimensions[0]);}
     report.mobile.push(mobile);
    }
    await size(1440,1000);report.scenes.push(row);
   }
   const projects=await request(fixture.origin,'/api/projects','GET',undefined,cookie);assert.equal(projects.status,200);assert.equal(projects.json.projects.length,0,'Transient practice inspection must not author persistent projects.');
   report.resourceFailures=report.failedRequests.filter(row=>row.url||row.method||row.error!=='net::ERR_CACHE_MISS');assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.resourceFailures,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin+'/')&&row.status>=400),[]);assert.deepEqual(fixture.errors,[]);
  });
  guard('workspace','bundle.js',expectedWorkspaceSha256);guard('public-viewer','viewer.js',expectedPublicSha256);report.passed=true;return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUT,'browser-report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,stage:report.stage,scenes:report.scenes.length,screenshots:report.screenshots.length,report:path.join(OUT,'browser-report.json')}));}
}
module.exports={run};
if(require.main===module){const flag=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};run({expectedWorkspaceSha256:flag('--expected-workspace-sha256'),expectedPublicSha256:flag('--expected-public-sha256')}).catch(error=>{console.error(error);process.exitCode=1;});}
