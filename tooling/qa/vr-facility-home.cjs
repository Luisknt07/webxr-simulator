'use strict';
// A disposable HTTPS/SQLite account exercises the actual home -> login ->
// catalogue -> private VR lesson flow. Existing user data is never opened.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomBytes,createHash}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUTPUT=path.join(ROOT,'data/qa-studio/workspace-production');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function run(){
 const flag=process.argv.indexOf('--expected-workspace-sha256'),expected=flag<0?null:process.argv[flag+1];assert.match(expected||'',/^[a-f0-9]{64}$/,'Pass the reviewed --expected-workspace-sha256.');
 assert.equal(digest(fs.readFileSync(path.join(ROOT,'artifacts/workspace/bundle.js'))),expected);
 fs.mkdirSync(OUTPUT,{recursive:true});
 const report={workspaceSha256:expected,temporaryDatabaseOnly:true,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};
 const password='Disposable-home-QA-'+randomBytes(16).toString('hex'),fixture=await startFixture(password);
 try{
  await withBrowser(fixture,report,async browser=>{
   const galleryReady=()=>browser.until(()=>browser.evaluate('Boolean(window.smartTwinGallery&&document.getElementById("scene-grid").getAttribute("aria-busy")==="false")'),'Home gallery did not initialize.');
   await browser.send('Page.navigate',{url:fixture.origin+'/'});await galleryReady();
   report.anonymous=await browser.call(()=>({gallery:smartTwinGallery.getStats(),canvas:document.querySelectorAll('canvas').length,login:document.getElementById('welcome-access').href}));
   assert.equal(report.anonymous.canvas,0);assert.equal(report.anonymous.gallery.authenticated,false);assert.deepEqual(report.anonymous.gallery.sceneIds,['vr-robot-dispatch']);assert.equal(new URL(report.anonymous.login).pathname,'/login');
   assert(!report.responses.some(row=>/\/api\/library\//.test(row.url)),'An anonymous visit must not request the private catalogue.');
   await browser.screenshot('vr-home-anonymous');
   assert.equal(report.anonymous.gallery.screen,'welcome');await browser.evaluate('document.getElementById("welcome-access").click()');
   await browser.until(()=>browser.evaluate('!!document.getElementById("login")'),'Login link did not reach the real server.');
   await browser.call((username,password)=>{const form=document.getElementById('login');form.elements.username.value=username;form.elements.password.value=password;form.requestSubmit();},'qa_production_owner',password);
   await galleryReady();assert.equal(await browser.evaluate('smartTwinGallery.getStats().screen'),'welcome');await browser.evaluate('document.getElementById("explore-scenes").click()');await browser.until(()=>browser.evaluate('!document.getElementById("gallery").hidden'),'Explore did not open the account catalogue.');report.authenticated=await browser.call(()=>({gallery:smartTwinGallery.getStats(),canvas:document.querySelectorAll('canvas').length,location:location.pathname,cards:document.querySelectorAll('.scene-card').length,overflow:document.documentElement.scrollWidth>innerWidth}));
   const libraryCount=require('../assets/validate-public-scenes').inventory(ROOT).includedCount-1;
   assert.equal(report.authenticated.location,'/');assert.equal(report.authenticated.gallery.authenticated,true);assert.equal(report.authenticated.gallery.sceneIds.length,libraryCount);assert.equal(report.authenticated.cards,libraryCount);assert(report.authenticated.gallery.sceneIds.includes('vr-warehouse-missions'));assert.equal(report.authenticated.canvas,0);assert.equal(report.authenticated.overflow,false);
   assert(!report.responses.some(row=>/\/api\/library\/scenes\//.test(row.url)),'Opening a catalogue must not instantiate all lesson documents.');
   await browser.screenshot('vr-home-authenticated');
   await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
   assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await browser.screenshot('vr-home-authenticated-mobile');await browser.send('Emulation.clearDeviceMetricsOverride');
   await browser.evaluate('document.querySelector("a[data-scene-id=vr-robot-turn]").click()');
   await browser.until(()=>browser.evaluate('Boolean(window.context&&context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&context.editor.currentProject&&context.editor.currentProject.librarySceneId==="vr-robot-turn")'),'The selected private VR lesson did not load.');
   report.initialView=await browser.call(()=>{const e=context.editor;if(e.active)e.leave();const camera=context.camera,root=e.document.getRoot('hall');root.updateWorldMatrix(true,true);return {eye:root.worldToLocal(camera.getWorldPosition(camera.position.clone())).toArray()};});
   assert(report.initialView.eye[0]>-9&&report.initialView.eye[0]<15&&report.initialView.eye[1]<5.6&&report.initialView.eye[2]>-10&&report.initialView.eye[2]<10,'The actual entry pose must be inside the facility.');
   await browser.screenshot('vr-private-turn-entry');
   await browser.call(()=>{const camera=context.camera,root=context.editor.document.getRoot('hall'),eye=root.localToWorld(camera.position.clone().set(9,2.8,7)),target=root.localToWorld(camera.position.clone().set(2,1.2,0));camera.parent.updateWorldMatrix(true,true);camera.position.copy(camera.parent.worldToLocal(eye));camera.lookAt(target);camera.updateWorldMatrix(true,true);});
   await browser.until(()=>browser.call(()=>{const root=context.editor.document.getRoot('hall');let roof;root.traverse(node=>{if(/RV cubierta industrial/.test(node.name))roof=node;});return !!roof&&context.renderer.info.render.calls>0;}),'The closed industrial facility did not render.');
   report.facility=await browser.call(()=>{
    const e=context.editor,root=e.document.getRoot('hall'),walls=[],roofs=[],fixtures=[],shellCasters=[],native=[];let triangles=0;
    root.traverse(node=>{if(/^CEDI · RV pared /.test(node.name))walls.push(node);if(/RV cubierta industrial/.test(node.name))roofs.push(node);if(/RV luminaria LED/.test(node.name))fixtures.push(node);if(/(?:RV pared |RV cubierta industrial)/.test(node.name))node.traverse(mesh=>{if(mesh.isMesh&&mesh.castShadow)shellCasters.push(mesh.name);});if(node.isMesh&&node.geometry)triangles+=(node.geometry.index?node.geometry.index.count:node.geometry.attributes.position.count)/3;});
    for(const entry of e.document.native.values())if(entry.roomId==='hall'&&entry.object.parent===root)native.push({name:entry.object.name,visible:entry.object.visible});
    const env=e.document.studio.environments.find(row=>row.roomId==='hall'),scene=e.hooks.renderScene,key=scene.children.find(row=>row.isLight&&row.name==='sun'),bounce=scene.children.find(row=>row.isHemisphereLight&&row.name==='Studio · rebote interior');return {walls:walls.length,roof:roofs.length,fixtures:fixtures.length,shellCasters,native,environment:{exposure:env.exposure,sun:env.sunIntensity,ambient:env.ambientIntensity},effectiveLighting:{exposure:context.renderer.toneMappingExposure,sun:key&&key.intensity,ambient:bounce&&bounce.intensity,reflections:!!scene.environment},triangles,render:{...context.renderer.info.render},glError:context.renderer.getContext().getError(),snapshot:e.currentProject.librarySceneId};
   });
   assert.equal(report.facility.walls,4);assert.equal(report.facility.roof,1);assert.equal(report.facility.fixtures,4);assert.deepEqual(report.facility.shellCasters,[]);assert(report.facility.native.every(row=>!row.visible));assert.deepEqual(report.facility.environment,{exposure:.87,sun:.6,ambient:.25});assert.equal(report.facility.glError,0);
   assert.deepEqual(report.facility.effectiveLighting,{exposure:1,sun:1.10,ambient:.55,reflections:true});
   await browser.screenshot('vr-private-turn-facility');
   await browser.call(()=>{const camera=context.camera,root=context.editor.document.getRoot('hall'),eye=root.localToWorld(camera.position.clone().set(4,1.65,8)),target=root.localToWorld(camera.position.clone().set(1,5.4,-3));camera.parent.updateWorldMatrix(true,true);camera.position.copy(camera.parent.worldToLocal(eye));camera.lookAt(target);camera.updateWorldMatrix(true,true);});await browser.screenshot('vr-private-turn-roof');
   await browser.evaluate('document.querySelector(".studio-brand").click()');await galleryReady();assert.equal(await browser.evaluate('smartTwinGallery.getStats().screen'),'welcome');assert.equal(await browser.evaluate('document.querySelectorAll("#viewer canvas").length'),0);await browser.screenshot('welcome-return-from-workspace');
   assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin)&&row.status>=400),[]);assert.deepEqual(fixture.errors,[]);
  });report.passed=true;
 }catch(error){report.failure=error.stack;throw error;}
 finally{report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUTPUT,'vr-home-facility-report.json'),JSON.stringify(report,null,2));await fixture.close();}
 console.log(JSON.stringify({passed:true,report:path.join(OUTPUT,'vr-home-facility-report.json')}));
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});module.exports={run};
