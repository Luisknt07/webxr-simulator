'use strict';
// Full-window learner HUD against the packaged app, a disposable account and DB.
// UI state is exercised without manufacturing simulation evidence or moving cargo.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/practice-hud-production');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run({expectedWorkspaceSha256}={}){
 assert.match(expectedWorkspaceSha256||'',/^[a-f0-9]{64}$/);
 assert.equal(hash(fs.readFileSync(path.join(ROOT,'artifacts/workspace/bundle.js'))),expectedWorkspaceSha256);
 const publication=JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/workspace/publication.json'),'utf8'));
 assert.equal(publication.bundleSha256,expectedWorkspaceSha256);
 const styles=['modules/logistica-industrial/practices/ui/practice.css','apps/workspace/studio/interface.css'],styleSha256={};for(const stylePath of styles){styleSha256[stylePath]=hash(fs.readFileSync(path.join(ROOT,stylePath)));assert.equal(hash(fs.readFileSync(path.join(ROOT,'artifacts/workspace',stylePath))),styleSha256[stylePath],'Packaged CSS must match reviewed source: '+stylePath);}
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const report={workspaceSha256:expectedWorkspaceSha256,styleSha256,temporaryDatabaseOnly:true,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};
 const password='Practice-HUD-QA-'+randomBytes(18).toString('hex');
 const fixture=await startFixture(password,{voice:{enabled:false,key:''},voiceFetch:async()=>{throw Error('No external provider in this QA.');}});
 try{
  assert.equal((await request(fixture.origin,'/api/studio/register','POST',{username:'qa_practice_hud',displayName:'QA learner HUD',password})).status,201);
  await withBrowser(fixture,report,async b=>{
   const until=(callback,message)=>b.until(callback,message,180000);
   const click=async selector=>{
    const point=await b.call(selector=>{const node=document.querySelector(selector);if(!node||node.disabled)throw Error('Unavailable '+selector);node.scrollIntoView({block:'nearest',inline:'nearest'});const rect=node.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2,hit=document.elementFromPoint(x,y);if(!rect.width||!rect.height||!(hit===node||node.contains(hit)))throw Error('Covered '+selector);return{x,y};},selector);
    await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
   };
   const shot=async name=>{await delay(200);const result=await b.send('Page.captureScreenshot',{format:'png'});const file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(result.data,'base64'));report.screenshots.push(file);};
   const key=async(code,value,down)=>b.send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:value,windowsVirtualKeyCode:value==='Escape'?27:value===' '?32:value.toUpperCase().charCodeAt(0)});
   const escape=async()=>{await key('Escape','Escape',true);await key('Escape','Escape',false);await delay(80);};
   const observation=()=>b.call(()=>{const c=context.editor.practiceController,o=c.workflow.observe();return{done:[...c.session.done],score:c.session.state().score,units:o.materialBalance.actualUnits,owners:o.units.map(row=>({id:row.id,ownerId:row.ownerId,position:row.position}))};});
   const layout=()=>b.call(()=>{
    const rect=node=>{if(!node||node.hidden||getComputedStyle(node).display==='none'||!node.getClientRects().length)return null;const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const root=document.querySelector('.st-practice-panel[data-interface=game]'),scene=root.querySelector('[data-practice-scene-viewport]'),p=context.editor.practiceController.panel;
    return{width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,scene:rect(scene),canvas:rect(context.renderer.domElement),missionBar:rect(p.missionBar),drawers:Object.entries(p.sidebarButtons).map(([id,button])=>({id,expanded:button.getAttribute('aria-expanded'),button:rect(button),panel:rect(id==='missions'?p.learningLeft:id==='instructions'?p.learningRight:p.learningHelp)})),buttons:[...root.querySelectorAll('.st-practice-game-button')].map(button=>({name:button.getAttribute('aria-label'),rect:rect(button)})),nativeTargets:[...document.querySelectorAll('.mobile-navigation-pad,.mobile-navigation-actions button,.equipment-study-trigger')].map(node=>({name:node.getAttribute('aria-label')||node.className||node.textContent,rect:rect(node)})).filter(row=>row.rect),reading:!!context.practiceReadingPanelOpen,instrument:context.practiceInstrument||null};
   });
   const fullScene=row=>{assert(!row.overflow);assert(row.scene&&row.scene.x<=1&&row.scene.y<=1&&row.scene.right>=row.width-1&&row.scene.bottom>=row.height-1,'The live scene must fill the viewport.');assert(row.canvas&&Math.abs(row.canvas.x-row.scene.x)<2&&Math.abs(row.canvas.width-row.scene.width)<2,'Renderer and scene surface must match: '+JSON.stringify({canvas:row.canvas,scene:row.scene}));assert(row.drawers.filter(drawer=>drawer.expanded==='true').length<=1,'A single information drawer may open at once.');for(const button of row.buttons.filter(button=>button.rect)){assert(button.name,'Every icon needs an accessible label.');assert(button.rect.width>=43&&button.rect.height>=43,'Touch targets must remain usable.');assert(button.rect.x>=-1&&button.rect.right<=row.width+1&&button.rect.y>=-1&&button.rect.bottom<=row.height+1,'Every HUD control must fit the viewport.');}};
   const stableLayout=async()=>{let row;await b.until(async()=>{row=await layout();return row.canvas&&row.scene&&Math.abs(row.canvas.width-row.scene.width)<2&&Math.abs(row.canvas.height-row.scene.height)<2;},'Renderer resize did not settle: '+JSON.stringify(await layout()),15000);return row;};
   const noNativeOverlap=row=>{const overlaps=(a,b)=>a&&b&&a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1;for(const native of row.nativeTargets){assert(!overlaps(native.rect,row.missionBar),'Mission banner covers '+native.name);for(const button of row.buttons)assert(!overlaps(native.rect,button.rect),'HUD '+button.name+' covers '+native.name);}for(const native of row.nativeTargets.filter(row=>/equipment-study/.test(row.name)))for(const pad of row.nativeTargets.filter(row=>!/equipment-study/.test(row.name)))assert(!overlaps(native.rect,pad.rect),'Study launcher covers '+pad.name);};
   await b.send('Emulation.setDeviceMetricsOverride',{width:1720,height:1080,deviceScaleFactor:1,mobile:false});
   await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
   await b.send('Page.navigate',{url:fixture.origin+'/play'});
   await until(()=>b.evaluate('!!document.querySelector("#login")'),'Missing login');
   await b.call(password=>{const form=document.querySelector('#login');form.elements.username.value='qa_practice_hud';form.elements.password.value=password;form.requestSubmit();},password);
   await until(()=>b.evaluate('document.querySelectorAll(".st-practice-card").length===10'),'Missing practice catalogue');
   await click('[data-practice-id="CEDI-01"]>summary');
   await until(()=>b.evaluate('!!document.querySelector(".st-practice-live-preview[data-state=ready]")'),'Missing configuration preview');
   await click('.st-practice-create');
   await until(()=>b.evaluate('!!window.context&&!!context.editor?.practiceController&&!context.studio.practiceCampaign.busy'),'Missing native practice');await delay(400);
   report.initial=await observation();assert.equal(report.initial.units,48);
   report.desktop=await layout();fullScene(report.desktop);assert(report.desktop.drawers.every(drawer=>drawer.expanded==='false'&&!drawer.panel));assert.equal(report.desktop.reading,false);await shot('desktop-full-scene');
   await click('[data-practice-sidebar="missions"]');await delay(150);report.missions=await layout();fullScene(report.missions);assert.equal(report.missions.reading,true);assert(report.missions.drawers.find(drawer=>drawer.id==='missions').panel);assert.deepEqual(report.missions.scene,report.desktop.scene,'Opening a drawer overlays the same full scene, without resizing it.');await shot('desktop-missions');
   await click('[data-practice-sidebar="instructions"]');await delay(100);report.instructions=await layout();fullScene(report.instructions);assert.equal(report.instructions.drawers.find(drawer=>drawer.id==='missions').expanded,'false');assert.equal(report.instructions.drawers.find(drawer=>drawer.id==='instructions').expanded,'true');await shot('desktop-registration');
   const formValue=await b.call(()=>{const p=context.editor.practiceController.panel,input=p.workflow.querySelector('[data-practice-workflow-field]');if(!input)throw Error('Missing native workflow field');const selected=input.tagName==='SELECT'?[...input.options].find(option=>option.value):null;input.value=selected?selected.value:'48';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return{name:input.name,value:input.value};});
   await escape();assert.equal((await layout()).reading,false);await click('[data-practice-sidebar="instructions"]');
   const restored=await b.call(()=>{const input=context.editor.practiceController.panel.workflow.querySelector('[data-practice-workflow-field]');return{name:input.name,value:input.value};});assert.deepEqual(restored,formValue,'Native field data must survive hiding and reopening.');
   await b.call(()=>{document.activeElement&&document.activeElement.blur();const canvas=context.renderer.domElement;canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:innerWidth/2,clientY:innerHeight/2}));});await delay(100);assert.equal((await layout()).reading,false,'Returning to the scene closes the reader.');
   for(const viewport of [{width:2560,height:1440,mobile:false},{width:1280,height:720,mobile:false},{width:390,height:844,mobile:true},{width:844,height:390,mobile:true},{width:667,height:375,mobile:true}]){
    await b.send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1});await b.send('Emulation.setTouchEmulationEnabled',{enabled:viewport.mobile,maxTouchPoints:5});await delay(250);
    const row=await stableLayout();report['scene'+viewport.width+'x'+viewport.height]=row;fullScene(row);if(viewport.mobile)noNativeOverlap(row);await shot('scene-'+viewport.width+'x'+viewport.height);
    await click('[data-practice-sidebar="instructions"]');await delay(100);const opened=await layout();fullScene(opened);const panel=opened.drawers.find(drawer=>drawer.id==='instructions').panel;assert(panel&&panel.x>=-1&&panel.right<=viewport.width+1&&panel.y>=-1&&panel.bottom<=viewport.height+1,'The open reader must fit small screens.');assert.equal(opened.reading,true);await shot('registration-'+viewport.width+'x'+viewport.height);await escape();assert.equal((await layout()).reading,false);
   }
   await b.send('Emulation.setDeviceMetricsOverride',{width:1720,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Emulation.setTouchEmulationEnabled',{enabled:false});await stableLayout();
   // Reading survives the real inactivity timer while a native field has focus,
   // then disappears after focus returns to the world. No workflow is submitted.
   await click('[data-practice-sidebar="instructions"]');
   await b.call(()=>{const p=context.editor.practiceController.panel,input=p.workflow.querySelector('[data-practice-workflow-field]');input.focus();p.hudHovered=false;p.lastHudActivity=Date.now()-p.hudIdleMs-100;});await delay(1200);assert.equal((await layout()).reading,true,'Idle dismissal cannot interrupt a focused form.');
   await b.call(()=>{const p=context.editor.practiceController.panel;document.activeElement.blur();p.hudHovered=false;p.lastHudActivity=Date.now()-p.hudIdleMs-100;});await until(()=>b.evaluate('!context.practiceReadingPanelOpen'),'Idle reader did not close');
   await click('[data-practice-sidebar="missions"]');await click('.studio-menu');await until(()=>b.evaluate('!context.studio.drawer.hidden'),'Header menu did not open');assert.equal((await layout()).reading,false,'The outer menu replaces the practice reader.');await shot('desktop-header-menu');await b.call(()=>context.studio.close());
   // Mount through the existing driver and exercise its real hold buttons. These
   // UI interactions neither alter component data nor satisfy mission evidence.
   report.nativeBefore=await b.call(()=>{const c=context.editor.practiceController,d=context.editor.vehicleDriving;if(!d.mount(c.manifest.vehicleIds[0]))throw Error('Native forklift mount failed');document.activeElement&&document.activeElement.blur();const v=d.record().components.vehicle;return{enabled:v.enabled,powered:v.powered,running:v.running,parkingBrake:v.parkingBrake,interlock:v.operatorInterlock||null};});await delay(350);
   report.cabClosed=await b.call(()=>({hud:getComputedStyle(context.editor.vehicleDriving.hud).display,navigation:getComputedStyle(document.querySelector('.vehicle-navigation-display')).display}));assert.equal(report.cabClosed.hud,'none');assert.equal(report.cabClosed.navigation,'none');await shot('desktop-cab-unobstructed');
   await click('[data-practice-hud-action="controls"]');await delay(150);assert.equal((await layout()).reading,false);
   report.nativeControls=await b.call(()=>{const d=context.editor.vehicleDriving,h=d.hud,r=h.getBoundingClientRect();return{display:getComputedStyle(h).display,x:r.x,y:r.y,right:r.right,bottom:r.bottom,clientHeight:h.clientHeight,scrollHeight:h.scrollHeight,expanded:d.controlsExpanded,groups:d.controlGroups.filter(group=>!group.hidden).map(group=>group.dataset.group)};});assert.notEqual(report.nativeControls.display,'none');assert(report.nativeControls.x>=0&&report.nativeControls.right<=1720&&report.nativeControls.bottom<=1080);assert.deepEqual(report.nativeControls.groups,['drive','cargo','view','safety']);await shot('desktop-cab-controls');
   const holdPoint=await b.call(()=>{const n=context.editor.vehicleDriving.controlButtons.get('driveReverse'),r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...holdPoint});await delay(100);report.nativeHeld=await b.call(()=>({touches:[...context.editor.vehicleDriving.touches.values()],blocked:context.editor.vehicleDriving.blocked()}));assert(report.nativeHeld.touches.includes('KeyS'),'The visible reverse control must hold its native input.');assert.equal(report.nativeHeld.blocked,false);await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...holdPoint});assert.equal(await b.evaluate('context.editor.vehicleDriving.touches.size'),0);
   await key('KeyS','s',true);await delay(100);assert(await b.evaluate('context.editor.vehicleDriving.keys.has("KeyS")'));await click('[data-practice-sidebar="instructions"]');report.nativeReading=await b.call(()=>({blocked:context.editor.vehicleDriving.blocked(),keys:[...context.editor.vehicleDriving.keys],touches:context.editor.vehicleDriving.touches.size}));assert.equal(report.nativeReading.blocked,true);assert.deepEqual(report.nativeReading.keys,[]);assert.equal(report.nativeReading.touches,0);await key('KeyS','s',false);await escape();assert.equal(await b.evaluate('context.editor.vehicleDriving.blocked()'),false,'Returning to the scene releases the reading lock.');
   await click('[data-practice-hud-action="layout"]');await delay(200);report.nativeMap=await b.call(()=>{const n=document.querySelector('.vehicle-navigation-display'),r=n.getBoundingClientRect();return{display:getComputedStyle(n).display,x:r.x,y:r.y,right:r.right,bottom:r.bottom,hud:getComputedStyle(context.editor.vehicleDriving.hud).display};});assert.notEqual(report.nativeMap.display,'none');assert.equal(report.nativeMap.hud,'none');assert(report.nativeMap.x>=0&&report.nativeMap.right<=1720&&report.nativeMap.bottom<=1080);await shot('desktop-cab-map');await escape();
   await b.call(()=>{const d=context.editor.vehicleDriving;d.resetInput();if(!d.unmount())throw Error('Stopped vehicle could not return to walking');});
   report.final=await observation();assert.deepEqual(report.final,report.initial,'Reading the HUD must not alter stock or grant practice evidence.');
   assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);report.passed=true;
  });
 }finally{report.serverErrors=fixture.errors;await fixture.close();fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');}
 return report;
}
if(require.main===module)run({expectedWorkspaceSha256:process.env.ST_REVIEWED_WORKSPACE_SHA256}).then(report=>console.log(JSON.stringify({passed:report.passed,output:OUT}))).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
