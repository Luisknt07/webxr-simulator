'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {startTemporaryServer}=require('./qa-project-workspace-browser'),{withBrowser}=require('./qa-public-publication-browser');
async function run(){
 const fixture=await startTemporaryServer();
 try{
  const account=await fixture.request('/api/studio/register','POST',{username:'qa_floor_layout',displayName:'Prueba temporal de piso',password:'Disposable-floor-layout-2026!'});assert.equal(account.status,201);
  await withBrowser(fixture.origin,async b=>{
   await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
   await b.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 OculusBrowser/38.0 Chrome/134.0.0.0 Safari/537.36'});
   const split=account.cookie.indexOf('=');await b.send('Network.setCookie',{name:account.cookie.slice(0,split),value:account.cookie.slice(split+1),url:fixture.origin,secure:true});
   await b.navigate('/editor');await b.until(()=>b.evaluate('context.editor.active&&context.editor.canEditDocument()'),'Authenticated editor did not open.');
   await b.evaluate('window.__qaFloorOperation=context.editor.studioTools.newProject();true');
   await b.until(()=>b.evaluate('Boolean(document.querySelector(".ed-scene-create[open]"))'),'Template wizard missing.');
   await b.call(()=>{const d=document.querySelector('.ed-scene-create');d.querySelectorAll('.ed-scene-create-choice')[1].click();d.querySelector('input').value='QA · Piso adaptable RV';d.querySelector('select').value='included:vr-robot-dispatch';d.querySelector('form').requestSubmit();});
   await b.evaluate('window.__qaFloorOperation');await b.until(()=>b.evaluate('context.editor.active&&!context.editor.loadingProject&&!context.editor.creatingProject'),'Template creation did not settle.');
   assert(await b.evaluate('context.editor.camera.position.y<5'),'Compact editor must start below its roof.');
   assert(await b.evaluate('context.graphics.getXRClarity()==="sharp"'));
   await b.call(()=>{const e=context.editor;e.shell.openFloorPlan();});
   await b.until(()=>b.evaluate('Boolean(document.querySelector(".ed-floor-plan-dialog[open]"))'),'Floor dialog failed to open.');
   const layout=await b.call(()=>{const d=document.querySelector('.ed-floor-plan-dialog'),r=d.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,rows:d.querySelectorAll('tbody tr').length};});assert(layout.left>=0&&layout.right<=layout.width);assert.equal(layout.rows,5);
   await b.screenshot('floor-plan-dialog');
   await b.call(()=>{const d=document.querySelector('.ed-floor-plan-dialog');for(const row of d.querySelectorAll('tbody tr')){const type=row.cells[0].textContent,field=row.querySelector('input[type=text]');if(type==='Texto en piso'&&field.value==='CELDA RV')field.value='ENSAMBLE 01';else if(type==='Cartel')field.value='ENTRADA DE PRODUCCIÓN';else continue;field.dispatchEvent(new Event('input',{bubbles:true}));}d.querySelector('form').requestSubmit();});
   await b.until(()=>b.evaluate('!document.querySelector(".ed-floor-plan-dialog")&&!context.editor.pendingEdits'),'Floor changes were not applied.');
   const changed=await b.call(()=>{const e=context.editor,o=e.document.getObjects(e.roomId).find(o=>o.userData.editorDescriptor?.type==='industrialFloor');window.__qaFloorId=o.userData.editorId;return o.userData.editorDescriptor;});assert(changed.texts.includes('ENSAMBLE 01'));assert(changed.texts.includes('ENTRADA DE PRODUCCIÓN'));
   const placement=await b.call(async()=>{const e=context.editor;let result;await e.perform(()=>{e.document.begin();try{const o=e.document.addPrefab(e.roomId,'conveyor','belt-middle');const point=e.orbit.target.clone().set(-6,1.2,7);e.root.updateWorldMatrix(true,true);result=e.equipmentPlacement.place(o,e.root.localToWorld(point));e.document.commit();return o;}catch(error){e.document.cancel();throw error;}});return result&&{attempts:result.attempts,floorY:result.floorY};});assert.equal(placement.attempts,1);assert(Math.abs(placement.floorY)<.001);
   await b.call(()=>{const e=context.editor;e.select(null);e.camera.fov=70;e.camera.updateProjectionMatrix();e.camera.position.set(8,4.7,9);e.orbit.target.set(0,0,1);e.orbit.update();});await b.screenshot('floor-plan-built-on-walkway');
   await b.call(async()=>{await context.editor.saveProject();});
   const saved=await b.call(async()=>{const e=context.editor,project=await e.projectClient.getProject(e.currentProject.id),d=project.document;return Object.values(d.rooms).flatMap(r=>r.additions||[]).find(o=>o.id===__qaFloorId).descriptor.texts;});assert(saved.includes('ENSAMBLE 01'));assert(saved.includes('ENTRADA DE PRODUCCIÓN'));
   await b.call(()=>{const e=context.editor;e.performancePanel.hidden=false;e.resetPerformancePanel();const p=e.performanceGraphics;p.claritySelect.value='balanced';p.claritySelect.dispatchEvent(new Event('change'));});assert.equal(await b.evaluate('context.graphics.getXRClarity()'),'balanced');
   await b.call(()=>{const p=context.editor.performanceGraphics;p.claritySelect.value='sharp';p.claritySelect.dispatchEvent(new Event('change'));});assert.equal(await b.evaluate('context.graphics.getXRClarity()'),'sharp');await b.screenshot('floor-plan-xr-clarity');
   assert.deepEqual(b.report.exceptions,[]);assert.deepEqual(b.report.consoleErrors,[]);assert.deepEqual(fixture.errors,[]);
   fs.writeFileSync('data/qa-studio/floor-plan-browser.json',JSON.stringify({...b.report,layout,placement,customTexts:saved,temporaryDataOnly:true,physicalHeadset:false,bundleSha256:crypto.createHash('sha256').update(fs.readFileSync("bundle.js")).digest('hex')},null,2));
   console.log('Floor browser: real editable template, visible floor dialog, custom floor/sign text, first-attempt conveyor placement on painted walkway, server save and local clarity controls passed in temporary account only.');
  });
 }finally{await fixture.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
