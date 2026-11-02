'use strict';
// Frozen production artifacts, real temporary HTTPS/API/SQLite and disposable
// Chrome. Only this fixture's account/project are changed. No user data is read.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/editor-sidebar-layout');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function guard(application,file,expected){
 assert.match(expected||'',/^[a-f0-9]{64}$/,'Both reviewed bundle hashes are required before Chrome.');
 const folder=path.join(ROOT,'artifacts',application),manifest=JSON.parse(fs.readFileSync(path.join(folder,'publication.json'),'utf8'));
 assert.equal(hash(fs.readFileSync(path.join(folder,file))),expected,'Compiled artifact changed: '+application);
 assert.equal(manifest.bundleSha256,expected,'Publication receipt is stale: '+application);
}
function styles(){
 const folder=path.join(ROOT,'artifacts/workspace'),manifest=JSON.parse(fs.readFileSync(path.join(folder,'publication.json'),'utf8'));
 return manifest.files.filter(row=>row.path.endsWith('.css')).map(row=>{assert.equal(hash(fs.readFileSync(path.join(folder,row.path))),row.sha256,'Stylesheet receipt is stale: '+row.path);return{path:row.path,sha256:row.sha256};});
}
function template(){
 const document=JSON.parse(fs.readFileSync(path.join(ROOT,'projects/smarttwin/scenes/vr-warehouse-missions.json'),'utf8')).project.document;
 document.rooms.hall.additions=[];document.rooms.hall.overrides=[{id:'native:hall:root.0',visible:false}];
 Object.assign(document.studio,{groups:[],missions:[],entities:[],spawns:[],scenes:[{id:'hall',name:'QA distribución de biblioteca'}],moduleProfile:{version:1,mode:'mixed',selectedModuleId:'',modules:[{id:'sector.logistics-industrial',version:'1.0.0',functions:['logistics.storage'],editorEnabled:true,viewerEnabled:true}]}});
 return document;
}
async function run({expectedWorkspaceSha256,expectedPublicSha256}={}){
 guard('workspace','bundle.js',expectedWorkspaceSha256);guard('public-viewer','viewer.js',expectedPublicSha256);
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const password='Disposable-Sidebar-'+randomBytes(16).toString('hex'),report={startedAt:new Date().toISOString(),workspaceSha256:expectedWorkspaceSha256,publicSha256:expectedPublicSha256,stylesheets:styles(),temporaryDataOnly:true,physicalDeviceTest:false,exceptions:[],consoleErrors:[],responses:[],failedRequests:[],screenshots:[],mobile:[]};
 const fixture=await startFixture(password,{voice:{enabled:false,key:''}});
 try{
  const registered=await request(fixture.origin,'/api/studio/register','POST',{username:'qa_sidebar_owner',displayName:'QA distribución',password});assert.equal(registered.status,201);
  await withBrowser(fixture,report,async b=>{
   const until=(fn,message)=>b.until(fn,message,90000),ready=()=>until(()=>b.evaluate('!!window.context&&!!context.editor&&!context.editor.initializing&&!context.editor.loadingProject&&!!context.studio'),'Compiled editor did not initialize.');
   const settled=()=>until(()=>b.evaluate('context.editor.active&&!context.editor.pendingEdits&&!context.editor.loadingProject&&!context.editor.busy'),'Editor operations did not settle.');
   const shot=async name=>{await new Promise(resolve=>setTimeout(resolve,180));const png=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(png.data,'base64'));report.screenshots.push(file);};
   const size=async(width,height,mobile=false)=>{await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await b.call(()=>{if(window.context&&context.editor){context.editor.shell.applyLayout(false);context.editor.resize();}});await new Promise(resolve=>setTimeout(resolve,250));};
   await b.send('Network.setBlockedURLs',{urls:['https://code.cdn.mozilla.net/*','https://fonts.googleapis.com/*','https://fonts.gstatic.com/*']});
   await b.send('Page.addScriptToEvaluateOnNewDocument',{source:"new MutationObserver(function(_,o){if(!document.documentElement)return;const s=document.createElement('style');s.textContent='*{font-family:system-ui,sans-serif!important}';document.documentElement.appendChild(s);o.disconnect();}).observe(document,{childList:true,subtree:true});"});
   await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
   await b.send('Page.navigate',{url:fixture.origin+'/login?next=%2Feditor'});await until(()=>b.evaluate('!!document.getElementById("login")'),'Disposable login form is missing.');
   await b.call(({username,password})=>{const form=document.getElementById('login');form.elements.username.value=username;form.elements.password.value=password;form.requestSubmit();},{username:'qa_sidebar_owner',password});
   await ready();await b.evaluate('context.studio.ready');await settled();
   report.project=await b.call(async document=>{
    const e=context.editor,p=await e.projectClient.createProject('QA distribución de biblioteca',document);await e.applyServerProject(p);if(!e.active)e.enter();e.projectSync.stop();
    await e.perform(()=>{const floor=e.document.addPrimitive(e.roomId,'box');e.document.rename(floor,'QA suelo');e.document.setTransform(floor,{position:[0,-.05,0],scale:[40,.1,30]});});
    if(context.voiceAssistant)context.voiceAssistant.setAutomatic(false);e.shell.restoreLayout();e.shell.openResources('library');e.showInspectorTab('object');
    window.__sidebarQA={hierarchy:e.hierarchy,tree:e.tree,search:e.treeSearch,documentBefore:JSON.stringify(await e.document.serialize()),undoBefore:e.document.undoStack.length,messages:[]};
    const toast=e.toast;e.toast=function(text){__sidebarQA.messages.push(String(text));return toast.apply(this,arguments);};
    return{id:e.currentProject.id,room:e.roomId,canEdit:e.canEditDocument(),initialObject:e.selected&&e.selected.userData.editorId};
   },template());assert(report.project.canEdit);await settled();
   report.desktop=await b.call(()=>{
    const e=context.editor,r=e.resourceBrowser,rect=node=>{const v=node.getBoundingClientRect();return{x:v.x,y:v.y,width:v.width,height:v.height,right:v.right,bottom:v.bottom};},shown=node=>!!node&&getComputedStyle(node).display!=='none'&&!node.hidden;
    Object.assign(r.state,{folder:'',query:'',kind:'all',status:'all',view:'cards'});r.refresh();
    const first=[...r.cards.values()].find(shown);if(first)first.scrollIntoView({block:'nearest'});
    return{library:rect(e.assets),viewport:rect(e.viewport),inspector:rect(e.inspector),status:rect(e.status||e.ui.querySelector('.ed-status')),folders:rect(r.folderList),grid:rect(r.grid),card:first&&rect(first),libraryShown:shown(e.assets),foldersShown:shown(r.folderList),gridShown:shown(r.grid),libraryOverflow:e.assets.scrollWidth>e.assets.clientWidth+2,gridOverflow:r.grid.scrollWidth>r.grid.clientWidth+2,bottomSplitter:e.shell.splitters.bottom&&shown(e.shell.splitters.bottom),tabs:[...e.inspectorTabButtons.keys()],uiOverflow:e.ui.scrollWidth>innerWidth+2,pageOverflow:document.documentElement.scrollWidth>innerWidth+2};
   });
   assert(report.desktop.libraryShown&&report.desktop.foldersShown&&report.desktop.gridShown);assert(report.desktop.library.width>=340&&report.desktop.library.width<=500,'Desktop Library must be the full left column.');
   assert(report.desktop.library.height>=650,'Library must use the former lower viewport space.');assert(Math.abs(report.desktop.library.bottom-report.desktop.status.y)<5);assert(Math.abs(report.desktop.viewport.bottom-report.desktop.status.y)<5,'A retired bottom dock must not leave an empty row under the viewport.');
   assert(report.desktop.folders.height>=60&&report.desktop.grid.height>=150&&report.desktop.card&&report.desktop.card.width>=100);assert(!report.desktop.libraryOverflow&&!report.desktop.gridOverflow&&!report.desktop.uiOverflow&&!report.desktop.pageOverflow,'Desktop cards and categories must fit the actual column.');assert(!report.desktop.bottomSplitter,'Retired bottom splitter must not occupy an active grid track.');assert.deepEqual(report.desktop.tabs,['object','resource','hierarchy']);
   await shot('sidebar-desktop-1440x1000');
   report.hierarchy=await b.call(async()=>{
    const e=context.editor,q=__sidebarQA;e.showInspectorTab('hierarchy');const parent=e.hierarchy.parentElement;
    e.treeSearch.value='QA suelo';e.treeSearch.dispatchEvent(new Event('input',{bubbles:true}));const filtered=e.tree.querySelectorAll('[role="treeitem"]').length;
    const row=e.tree.querySelector('[role="treeitem"]');if(!row)throw Error('The moved hierarchy cannot find the actual floor.');row.click();e.renderInspector();e.showInspectorTab('hierarchy');
    const identities=e.hierarchy===q.hierarchy&&e.tree===q.tree&&e.treeSearch===q.search,connected=e.hierarchy.isConnected&&e.inspector.contains(e.hierarchy),query=e.treeSearch.value,selection=e.selected&&e.selected.name;
    const selectTab=e.inspectorTabButtons.get('hierarchy');selectTab.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));const home=e.inspectorTab,homeFocus=document.activeElement===e.inspectorTabButtons.get('object');
    e.inspectorTabButtons.get('object').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));const end=e.inspectorTab,endFocus=document.activeElement===e.inspectorTabButtons.get('hierarchy');
    e.inspectorTabButtons.get('hierarchy').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));const wrap=e.inspectorTab;
    e.inspectorTabButtons.get('object').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));const next=e.inspectorTab;
    e.inspectorTabButtons.get('resource').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));const third=e.inspectorTab;
    const aria=[...e.inspectorTabButtons].map(([id,button])=>({id,selected:button.getAttribute('aria-selected'),controls:button.getAttribute('aria-controls'),panel:document.getElementById(button.getAttribute('aria-controls'))&&document.getElementById(button.getAttribute('aria-controls')).getAttribute('role')}));
    return{identities,connected,parentReused:parent===e.hierarchy.parentElement,query,filtered,selection,home,homeFocus,end,endFocus,wrap,next,third,aria,documentUnchanged:q.documentBefore===JSON.stringify(await e.document.serialize()),undoUnchanged:q.undoBefore===e.document.undoStack.length};
   });
   assert(report.hierarchy.identities&&report.hierarchy.connected&&report.hierarchy.parentReused);assert.equal(report.hierarchy.query,'QA suelo');assert.equal(report.hierarchy.filtered,1);assert.equal(report.hierarchy.selection,'QA suelo');assert(report.hierarchy.homeFocus&&report.hierarchy.endFocus);assert.equal(report.hierarchy.home,'object');assert.equal(report.hierarchy.end,'hierarchy');assert.equal(report.hierarchy.wrap,'object');assert.equal(report.hierarchy.next,'resource');assert.equal(report.hierarchy.third,'hierarchy');assert(report.hierarchy.documentUnchanged&&report.hierarchy.undoUnchanged);assert(report.hierarchy.aria.every(row=>row.panel==='tabpanel'));assert.equal(report.hierarchy.aria.filter(row=>row.selected==='true').length,1);
   await shot('sidebar-hierarchy-right');
   await b.call(()=>{const e=context.editor,r=e.resourceBrowser;e.treeSearch.value='';e.renderTree();Object.assign(r.state,{folder:'',query:'conveyor.straight',kind:'all',status:'all'});r.refresh();const card=r.cards.get('library:conveyor.straight');if(!card)throw Error('Real conveyor card is missing.');card.click();});
   await until(()=>b.evaluate('context.editor.resourceBrowser.previewVisible&&context.editor.resourceBrowser.previewResource==="library:conveyor.straight"'),'Resource tab failed to load its one native preview.');
   report.preview=await b.call(()=>{
    const e=context.editor,r=e.resourceBrowser,loaded={tab:e.inspectorTab,visible:r.previewVisible,resource:r.previewResource,host:e.inspector.contains(r.preview)};
    e.showInspectorTab('hierarchy');const hidden={visible:r.previewVisible,resource:r.previewResource,cleanup:r.previewCleanup};e.showInspectorTab('object');const objectHidden=!r.previewVisible;e.showInspectorTab('resource');
    return{loaded,hidden:{visible:hidden.visible,resource:hidden.resource,cleanupReleased:hidden.cleanup===null},objectHidden};
   });assert.equal(report.preview.loaded.tab,'resource');assert(report.preview.loaded.visible&&report.preview.loaded.host);assert(!report.preview.hidden.visible&&report.preview.hidden.resource===null&&report.preview.hidden.cleanupReleased&&report.preview.objectHidden);
   await until(()=>b.evaluate('context.editor.resourceBrowser.previewResource==="library:conveyor.straight"'),'Native preview did not reopen after switching tabs.');
   const separator=await b.call(()=>{const e=context.editor,s=e.shell.splitters.left,r=s.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+Math.min(100,r.height/2),before:e.shell.layout.left};});
   await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:separator.x,y:separator.y});await b.send('Input.dispatchMouseEvent',{type:'mousePressed',x:separator.x,y:separator.y,button:'left',clickCount:1});await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:separator.x+36,y:separator.y,button:'left',buttons:1});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:separator.x+36,y:separator.y,button:'left',clickCount:1});
   report.resize=await b.call(()=>{const e=context.editor;return{value:e.shell.layout.left,width:e.assets.getBoundingClientRect().width,stored:JSON.parse(localStorage.getItem('hello-studio-layout-v2')||'null')};});assert(report.resize.value>separator.before+20);assert(Math.abs(report.resize.width-report.resize.value)<2);assert(report.resize.stored&&report.resize.stored.left===report.resize.value);
   report.visibility=await b.call(async()=>{
    const e=context.editor,q=__sidebarQA,before=e.viewport.getBoundingClientRect(),preview=e.resourceBrowser.previewResource;e.shell.setPanel('resources',false);const collapsed=e.assets.hidden,listingHidden=!e.resourceBrowser.listingVisible,after=e.viewport.getBoundingClientRect(),stillPreview=e.resourceBrowser.previewVisible&&e.resourceBrowser.previewResource===preview;
    const reopen=[...e.shell.reopen.querySelectorAll('button')].find(button=>button.dataset.panel==='resources');if(!reopen)throw Error('Library reopening control is missing.');reopen.click();
    return{collapsed,listingHidden,reopened:!e.assets.hidden&&e.resourceBrowser.listingVisible,stillPreview,viewportGained:after.width>before.width+200,documentUnchanged:q.documentBefore===JSON.stringify(await e.document.serialize()),undoUnchanged:q.undoBefore===e.document.undoStack.length};
   });for(const key of ['collapsed','listingHidden','reopened','stillPreview','viewportGained','documentUnchanged','undoUnchanged'])assert(report.visibility[key],key);
   console.log('Compiled desktop layout, hierarchy identity, keyboard tabs, preview lifetime and splitter passed.');
   report.drag=await b.call(()=>{
    const e=context.editor,r=e.resourceBrowser;Object.assign(r.state,{folder:'',query:'conveyor.straight',kind:'all',status:'all'});r.refresh();const card=r.cards.get('library:conveyor.straight');if(!card||!card.draggable)throw Error('Actual native card is not draggable.');card.scrollIntoView({block:'nearest'});
    const transfer=new DataTransfer(),before=e.document.additions.size,previous=e.selected&&e.selected.userData.editorId,rect=e.viewport.getBoundingClientRect();
    const start=new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer});card.dispatchEvent(start);const id=transfer.getData('application/x-hello-studio-resource');if(start.defaultPrevented||!id)throw Error('Actual card dragstart refused its MIME identity.');
    e.viewport.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2}));
    e.viewport.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2}));
    return{resourceId:id,before,previous};
   });assert.equal(report.drag.resourceId,'library:conveyor.straight');
   await until(()=>b.call(({before,previous})=>{const e=context.editor;return !e.pendingEdits&&e.document.additions.size===before+1&&e.selected&&e.selected.userData.editorId!==previous&&e.document.getBehaviors(e.selected).some(component=>component.type==='conveyor');},report.drag),'Real card drop did not insert exactly one native conveyor.');
   report.saved=await b.call(async()=>{const e=context.editor,o=e.selected;await e.perform(()=>e.document.rename(o,'QA transportador arrastrado'));const id=o.userData.editorId,config=e.document.getBehaviors(o).find(component=>component.type==='conveyor'),descriptor=JSON.stringify(o.userData.editorDescriptor);if(!await e.saveProject())throw Error('Actual server project save failed.');return{project:e.currentProject.id,room:e.roomId,id,name:o.name,variant:config.variant,descriptor,left:e.shell.layout.left};});
   await b.send('Page.navigate',{url:fixture.origin+'/editor?project='+encodeURIComponent(report.saved.project)+'&room='+encodeURIComponent(report.saved.room)});await ready();await b.evaluate('context.studio.ready');await settled();
   report.reopened=await b.call(({project,id,descriptor})=>{const e=context.editor,o=e.document.getObject(id);e.projectSync.stop();if(context.voiceAssistant)context.voiceAssistant.setAutomatic(false);return{project:e.currentProject.id,id:o&&o.userData.editorId,name:o&&o.name,descriptorMatches:o&&JSON.stringify(o.userData.editorDescriptor)===descriptor,exists:!!o,canEdit:e.canEditDocument(),left:e.shell.layout.left,treeConnected:e.tree.isConnected,rendererGL:context.renderer.getContext().getError()};},report.saved);
   assert.equal(report.reopened.project,report.saved.project);assert.equal(report.reopened.id,report.saved.id);assert.equal(report.reopened.name,report.saved.name);assert(report.reopened.descriptorMatches&&report.reopened.exists&&report.reopened.canEdit&&report.reopened.treeConnected);assert.equal(report.reopened.left,report.saved.left);assert.equal(report.reopened.rendererGL,0);await shot('sidebar-saved-and-reopened');
   await size(390,844,true);
   for(const pane of ['resources','scene','object','hierarchy']){
    const state=await b.call(pane=>{
     const e=context.editor,buttons=[...e.ui.querySelectorAll('[data-editor-pane]')],button=buttons.find(node=>node.dataset.editorPane===pane);if(!button)throw Error('Mobile pane control is missing: '+pane);button.click();
     const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},shown=node=>!!node&&getComputedStyle(node).display!=='none'&&!node.hidden;
     const target=pane==='resources'?e.assets:pane==='scene'?e.viewport:pane==='hierarchy'?e.hierarchy:e.inspector,hitRect=button.getBoundingClientRect(),hit=document.elementFromPoint(hitRect.x+hitRect.width/2,hitRect.y+hitRect.height/2);
     return{pane,active:e.shell.mobilePanel,tab:e.inspectorTab,target:rect(target),visible:shown(target),button:rect(button),reachable:hit===button||button.contains(hit),selected:button.getAttribute('aria-selected')||button.getAttribute('aria-pressed'),uiSize:{scroll:e.ui.scrollWidth,client:e.ui.clientWidth},uiOverflow:e.ui.scrollWidth>innerWidth+2,pageOverflow:document.documentElement.scrollWidth>innerWidth+2,targetOverflow:target.scrollWidth>target.clientWidth+2,overflowing:[...e.ui.querySelectorAll('*')].map(node=>({tag:node.tagName,cls:node.className,box:rect(node),overflowX:getComputedStyle(node).overflowX,scroll:node.scrollWidth,client:node.clientWidth})).filter(row=>row.box.width>0&&(row.box.right>innerWidth+2||row.box.x< -2)).sort((a,b)=>b.box.right-a.box.right).slice(0,24),treeConnected:e.tree.isConnected,rendererGL:context.renderer.getContext().getError()};
    },pane);
    report.mobile.push(state);assert(state.visible&&state.reachable,'Mobile pane and its real button must be visible: '+pane);assert(state.target.width>=280&&state.target.height>=120,pane+' must have usable room.');assert(state.target.x>=-2&&state.target.right<=392&&state.target.y>=-2&&state.target.bottom<=846,'Mobile pane exceeds the actual viewport: '+pane);assert(!state.uiOverflow&&!state.pageOverflow&&!state.targetOverflow,'Mobile pane overflows: '+pane);assert(state.treeConnected);assert.equal(state.rendererGL,0);if(pane==='hierarchy')assert.equal(state.tab,'hierarchy');if(pane==='object')assert.equal(state.tab,'object');await shot('sidebar-mobile-'+pane+'-390x844');
   }
   report.mobileMenus=[];
   for(const width of [390,320]){
    await size(width,844,true);await b.call(()=>context.editor.shell.showPanel('scene'));
    for(const label of ['Ayuda','Archivo']){
     const trigger=await b.call(label=>{const e=context.editor,s=e.shell;s.closeMenus();const menu=s.menus.find(row=>row.trigger.textContent===label);if(!menu)throw Error('Missing mobile menu: '+label);menu.trigger.scrollIntoView({block:'nearest',inline:'nearest'});const r=menu.trigger.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},label);
     await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',...trigger});await b.send('Input.dispatchMouseEvent',{type:'mousePressed',...trigger,button:'left',clickCount:1});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',...trigger,button:'left',clickCount:1});
     const menu=await b.call(label=>{
      const e=context.editor,s=e.shell,m=s.menus.find(row=>row.trigger.textContent===label),target=m.items.find(row=>row.node.children[1].textContent===(label==='Ayuda'?'Controles del editor':'Guardar'));
      if(!target||target.node.disabled)throw Error('The real mobile menu action is unavailable.');target.node.scrollIntoView({block:'nearest',inline:'nearest'});const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},p=rect(m.popup),t=rect(target.node),hit=document.elementFromPoint(t.x+t.width/2,t.y+t.height/2);
      return{label,width:innerWidth,opened:!m.popup.hidden,expanded:m.trigger.getAttribute('aria-expanded'),popup:p,target:t,reachable:hit===target.node||target.node.contains(hit),helpBefore:e.viewportHelp.hidden,revision:e.currentProject.revision,uiOverflow:e.ui.scrollWidth>innerWidth+2,pageOverflow:document.documentElement.scrollWidth>innerWidth+2};
     },label);
     assert(menu.opened&&menu.expanded==='true'&&menu.reachable,label+' must be reachable after horizontal menu scrolling.');assert(menu.popup.x>=0&&menu.popup.right<=width+1&&menu.popup.y>=0&&menu.popup.bottom<=845,label+' popup exceeds the actual mobile viewport.');assert(!menu.uiOverflow&&!menu.pageOverflow,'The menu bar must scroll independently without overflowing the editor.');
     const point={x:menu.target.x+menu.target.width/2,y:menu.target.y+menu.target.height/2};
     await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await b.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await settled();
     const after=await b.call(()=>({closed:context.editor.shell.menuIndex===-1,help:context.editor.viewportHelp.hidden,revision:context.editor.currentProject.revision,dirty:context.editor.dirty}));assert(after.closed,'A real menu action must close the menu.');if(label==='Ayuda')assert.equal(after.help,!menu.helpBefore,'The mobile help action must actually toggle editor instructions.');else assert(!after.dirty&&after.revision>menu.revision,'Mobile File/Save must persist through its real menu action.');report.mobileMenus.push({...menu,after});
     await shot('sidebar-mobile-menu-'+label.toLowerCase()+'-'+width);
    }
   }
   const blocked=/^https:\/\/(?:code\.cdn\.mozilla\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
   report.environmentalFonts=report.failedRequests.filter(row=>blocked.test(row.url||''));assert.deepEqual(report.failedRequests.filter(row=>!blocked.test(row.url||'')),[]);assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin+'/')&&row.status>=400),[]);assert.deepEqual(fixture.errors,[]);
  });
  guard('workspace','bundle.js',expectedWorkspaceSha256);guard('public-viewer','viewer.js',expectedPublicSha256);assert.deepEqual(styles(),report.stylesheets,'Styles changed during browser QA.');report.passed=true;return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,mobile:report.mobile.length,screenshots:report.screenshots.length,report:path.join(OUT,'report.json')}));}
}
module.exports={run};
if(require.main===module){const value=key=>{const index=process.argv.indexOf(key);return index<0?undefined:process.argv[index+1];};run({expectedWorkspaceSha256:value('--expected-workspace-sha256'),expectedPublicSha256:value('--expected-public-sha256')}).catch(error=>{console.error(error);process.exitCode=1;});}
