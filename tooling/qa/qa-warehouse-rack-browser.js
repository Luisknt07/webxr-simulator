const __layout = require("../layout.cjs");
'use strict';
// Actual compiled app, real WebGL and actual editor UI. Every project/account
// mutation belongs to a disposable HTTPS server and OS-temp SQLite database.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {startTemporaryServer}=require('./qa-project-workspace-browser'),{withBrowser}=require('./qa-public-publication-browser');
const systems=require('../../modules/logistica-industrial/functions/almacenamiento/schema/warehouseRacks').SYSTEMS,OUTPUT=__layout.map(path.resolve(__layout.oldDir("scripts/qa-warehouse-rack-browser.js"),'../data/qa-studio'));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const option=key=>{const i=process.argv.indexOf(key);return i<0?null:process.argv[i+1];};
async function crop(b,name){
 const clip=await b.call(()=>{const r=context.editor.viewport.getBoundingClientRect();return{x:Math.ceil(r.left),y:Math.ceil(r.top),width:Math.floor(r.width)-2,height:Math.floor(r.height)-2,scale:1};});
 const shot=await b.send('Page.captureScreenshot',{format:'png',clip}),file=__layout.map(path.join(OUTPUT,'rack-'+name+'.png'));fs.writeFileSync(file,Buffer.from(shot.data,'base64'));b.report.shots.push(file);return file;
}
async function ready(b){await b.until(()=>b.evaluate('context.editor.active&&!context.editor.loadingProject&&!context.editor.creatingProject&&!context.editor.pendingEdits&&!context.editor.pastingObject'),'The editor did not settle.');}
async function category(b){
 await b.call(()=>{const e=context.editor;e.shell.setPanel('resources',true);e.shell.setPanel('inspector',true);const r=e.resourceBrowser;r.openTab('library');r.state.query='';r.search.value='';r.kindFilter.value='equipment';r.kindFilter.dispatchEvent(new Event('change'));const group=r.folderList.querySelector('[data-category=racks]');if(!group)throw Error('Rack category missing.');group.open=true;const all=[...group.querySelectorAll('button')].find(n=>n.textContent.trim()==='Todos');if(!all)throw Error('Rack category entry missing.');all.click();});
 await b.until(()=>b.evaluate('context.editor.resourceBrowser.state.folder==="racks"&&context.editor.resourceBrowser.cards.size===14'),'All fourteen rack cards must remain visible under Equipos.');
}
async function place(b,id){
 await category(b);
 await b.call(variant=>{const e=context.editor,r=e.resourceBrowser,resource=r.resources.find(v=>v.category==='racks'&&v.variant===variant);if(!resource)throw Error('Rack resource missing: '+variant);e.stopOrbitMotion();e.orbit.target.set(0,1,0);r.cards.get(resource.id).click();window.__rackPlacedBefore=new Set(e.document.getObjects(e.roomId).map(v=>v.userData.editorId));r.cards.get(resource.id).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));},id);
 await b.until(()=>b.call(variant=>{const e=context.editor,o=e.selected;return !e.pendingEdits&&o&&!__rackPlacedBefore.has(o.userData.editorId)&&e.document.getBehaviors(o).some(c=>c.type==='palletQueue'&&c.rackSystem===variant);},id),'Actual resource insertion failed: '+id);
 return b.evaluate('context.editor.selected.userData.editorId');
}
async function isolate(b){
 return b.call(()=>{const e=context.editor,o=e.document.getObject(window.__rackActiveId);if(!o)throw Error('Rack actor disappeared.');e.select(null);e.clearAssetPreview();e.shell.setPanel('resources',false);e.shell.setPanel('hierarchy',false);e.shell.setPanel('inspector',false);e.resize();const box=e.collisionWorld.objectBounds(o),center=box.getCenter(e.camera.position.clone()),size=box.getSize(e.camera.position.clone()),direction=center.clone().set(1,.68,1.25).normalize();const radius=size.length()/2,distance=Math.max(4,radius*1.18/Math.sin(42*Math.PI/360));e.stopOrbitMotion();e.camera.fov=42;e.camera.updateProjectionMatrix();e.camera.position.copy(center).addScaledVector(direction,distance);e.orbit.target.copy(center);e.safeCameraPosition=null;e.safeOrbitTarget=null;e.orbit.update();e.constrainEditorCamera(false);e.camera.updateWorldMatrix(true,false);return{center:center.toArray(),size:size.toArray(),eye:e.camera.position.toArray()};});
}
async function removeRacks(b){
 await b.call(async()=>{const e=context.editor;if(!e.active)e.enter();await e.perform(()=>{e.document.begin();e.document.getObjects(e.roomId).filter(o=>o.userData.editorDescriptor?.prefab==='palletQueue'&&o.userData.editorDescriptor.variant).forEach(o=>e.document.remove(o));e.document.commit();e.select(null);});});await ready(b);
}
async function run(){
 const expected=option('--expected');assert(/^[a-f0-9]{64}$/.test(expected||''),'Pass --expected with the reviewed final bundle SHA256.');assert.equal(digest(__layout.map(path.resolve(__layout.oldDir("scripts/qa-warehouse-rack-browser.js"),'../bundle.js'))),expected,'Build changed after review.');fs.mkdirSync(OUTPUT,{recursive:true});
 const fixture=await startTemporaryServer();
 try{
  const account=await fixture.request('/api/studio/register','POST',{username:'qa_warehouse_racks',displayName:'Prueba temporal de estanterías',password:'Disposable-rack-browser-2026!'});assert.equal(account.status,201);
  await withBrowser(fixture.origin,async b=>{
   b.report.bundleSha256=expected;b.report.temporaryAccountAndDatabase=true;b.report.physicalHeadset=false;b.report.models=[];
   await b.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1100,deviceScaleFactor:1,mobile:false});
   const split=account.cookie.indexOf('=');await b.send('Network.setCookie',{name:account.cookie.slice(0,split),value:account.cookie.slice(split+1),url:fixture.origin,secure:true});
   await b.navigate('/editor');await ready(b);assert(await b.evaluate('context.editor.canEditDocument()'));
   await b.evaluate('window.__rackProjectOperation=context.editor.studioTools.newProject();true');await b.until(()=>b.evaluate('Boolean(document.querySelector(".ed-scene-create[open]"))'),'New-project wizard did not open.');
   await b.call(()=>{const d=document.querySelector('.ed-scene-create');d.querySelectorAll('.ed-scene-create-choice')[0].click();d.querySelector('input').value='QA · Almacén configurable';d.querySelector('form').requestSubmit();});await b.evaluate('__rackProjectOperation');await ready(b);
   await b.call(()=>{const e=context.editor;e.projectSync.stop();context.graphics.setMode('balanced');context.graphics.tier=1;context.graphics.tick=()=>context.graphics.getStats();context.graphics.applyDesktopRatio();});
   await category(b);
   b.report.category=await b.call(()=>{const r=context.editor.resourceBrowser,g=r.folderList.querySelector('[data-category=racks]');return{folder:r.state.folder,kind:r.state.kind,cards:r.cards.size,subfolders:[...g.querySelectorAll('button')].map(n=>n.textContent.trim()),variants:r.resources.filter(v=>v.category==='racks').map(v=>v.variant)};});
   assert.equal(b.report.category.subfolders.length,4);assert.equal(new Set(b.report.category.variants).size,14);await b.screenshot('warehouse-racks-category');
   const firstId=await place(b,'selective');
   const before=await b.call(()=>{const e=context.editor,o=e.selected;window.__rackOriginalId=o.userData.editorId;return{width:e.document.getBehaviors(o).find(c=>c.type==='palletQueue').rackBayWidth,size:e.collisionWorld.objectBounds(o).getSize(e.camera.position.clone()).toArray(),controls:[...e.document.additions.get(o.userData.editorId).nodes.values()].filter(n=>e.document.getBehaviors(n).some(c=>c.type==='control')).map(n=>n.userData.editorId)};});
   await b.call(width=>{const e=context.editor;e.showInspectorTab('object');const field=e.inspector.querySelector('[data-behavior-field=rackBayWidth]');if(!field)throw Error('Editable rack dimension missing.');field.value=width+.4;field.dispatchEvent(new Event('change',{bubbles:true}));},before.width);await ready(b);
   const resized=await b.call(()=>{const e=context.editor,o=e.document.getObject(__rackOriginalId);return{config:e.document.getBehaviors(o).find(c=>c.type==='palletQueue'),size:e.collisionWorld.objectBounds(o).getSize(e.camera.position.clone()).toArray(),controls:[...e.document.additions.get(o.userData.editorId).nodes.values()].filter(n=>e.document.getBehaviors(n).some(c=>c.type==='control')).map(n=>n.userData.editorId)};});
   assert.equal(resized.config.rackBayWidth,before.width+.4);assert(resized.size[0]>before.size[0]+.2);assert.deepEqual(resized.controls,before.controls);await b.screenshot('warehouse-rack-inspector');
   await b.call(()=>{const e=context.editor,duplicate=[...e.inspector.querySelectorAll('button')].find(n=>n.textContent==='Duplicar con funciones');if(!duplicate)throw Error('Rack duplicate action missing.');duplicate.click();});await ready(b);
   b.report.copy=await b.call(()=>{const e=context.editor,all=e.document.getObjects(e.roomId).filter(o=>o.userData.editorDescriptor?.prefab==='palletQueue'&&o.userData.editorDescriptor.variant==='selective');return all.map(o=>({id:o.userData.editorId,config:e.document.getBehaviors(o).find(c=>c.type==='palletQueue'),controls:[...e.document.additions.get(o.userData.editorId).nodes.values()].filter(n=>e.document.getBehaviors(n).some(c=>c.type==='control')).map(n=>e.document.getBehaviors(n).find(c=>c.type==='control').targetId)}));});
   assert.equal(b.report.copy.length,2);for(const c of b.report.copy){assert.equal(c.config.rackBayWidth,before.width+.4);assert(c.controls.every(target=>target===c.id));}
   const project=await b.call(async()=>{await context.editor.saveProject();return context.editor.currentProject.id;});
   await b.navigate('/editor?project='+encodeURIComponent(project));await ready(b);
   const restored=await b.call(()=>{const e=context.editor;return e.document.getObjects(e.roomId).filter(o=>o.userData.editorDescriptor?.prefab==='palletQueue'&&o.userData.editorDescriptor.variant==='selective').map(o=>({id:o.userData.editorId,config:e.document.getBehaviors(o).find(c=>c.type==='palletQueue')}));});assert.deepEqual(restored.map(v=>v.id).sort(),b.report.copy.map(v=>v.id).sort());assert(restored.every(v=>v.config.rackBayWidth===before.width+.4));b.report.reopened=true;
   await b.call(()=>{context.editor.projectSync.stop();context.graphics.setMode('balanced');context.graphics.tier=1;context.graphics.tick=()=>context.graphics.getStats();context.graphics.applyDesktopRatio();});await removeRacks(b);
   const pictures=[];
   for(const system of systems){
    console.log('Warehouse Chrome: '+system.id);const actorId=await place(b,system.id);await b.call(id=>{window.__rackActiveId=id;},actorId);
    const controls=await b.call(()=>{const e=context.editor,o=e.document.getObject(__rackActiveId);return[...e.document.additions.get(o.userData.editorId).nodes.values()].flatMap(n=>e.document.getBehaviors(n).filter(c=>c.type==='control').map(c=>({command:c.command,targetId:c.targetId,value:c.value})));});assert(controls.length>=4);assert(controls.every(c=>c.targetId===actorId));
    if(system.id==='mobile')assert(controls.some(c=>c.command==='openAisle'));
    if(system.id==='push-back')assert(controls.some(c=>c.command==='prepareRackInput'));
    if(['vertical-lift','miniload'].includes(system.id)){
     // The four-button physical HMI keeps the compatible dispatch command.
     // PalletQueueRuntime.dispatch requests the selected tray while none is
     // presented, then transfers that same load on a subsequent dispatch.
     assert(controls.some(c=>c.command==='dispatch'));
     // Authoring extracts HMI controls as addition nodes, rather than keeping
     // their original prefab child positions. The live document controls
     // above prove the final commands and remapped target references.
     assert(controls.filter(c=>c.command==='dispatch').every(c=>c.targetId===actorId), 'Automatic HMI must dispatch to its own rack.');
    }
    const pose=await isolate(b);await b.evaluate('new Promise(resolve=>setTimeout(resolve,450))');
    const snapshot=await b.call(()=>{const e=context.editor,o=e.document.getObject(__rackActiveId),r=context.renderer,meshes=[];o.traverse(n=>{if(n.isMesh)meshes.push(n);});return{actorId:o.userData.editorId,activeRacks:e.document.getObjects(e.roomId).filter(o=>o.userData.editorDescriptor?.prefab==='palletQueue'&&o.userData.editorDescriptor.variant).length,config:e.document.getBehaviors(o).find(c=>c.type==='palletQueue'),actorMeshes:meshes.length,actorTriangles:meshes.reduce((s,n)=>s+(n.geometry.index?n.geometry.index.count:n.geometry.attributes.position.count)/3,0),render:{...r.info.render},gpu:{...r.info.memory},resources:e.performance.getStats(),gl:r.getContext().getError()};});
    assert.equal(snapshot.activeRacks,1,'Each rendered example must contain only its own rack.');assert.equal(snapshot.gl,0);snapshot.system=system.id;snapshot.name=system.label;snapshot.pose=pose;snapshot.controls=controls;
    const picture=await crop(b,system.id);pictures.push({name:system.label,id:system.id,url:'data:image/png;base64,'+fs.readFileSync(picture).toString('base64')});b.report.models.push(snapshot);
    await removeRacks(b);
   }
   const sheet=await b.call(async pictures=>{
    const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1390;const d=canvas.getContext('2d');d.fillStyle='#0c1e2a';d.fillRect(0,0,canvas.width,canvas.height);d.fillStyle='#a5ead9';d.font='bold 32px Segoe UI, Arial';d.fillText('SMARTTWIN · ESTANTERÍAS CONFIGURABLES',30,49);d.fillStyle='#c0d5dc';d.font='18px Segoe UI, Arial';d.fillText('14 sistemas · modelos reales de la plataforma · un equipo por captura',30,80);
    for(let i=0;i<pictures.length;i++){const p=pictures[i],image=new Image();image.src=p.url;await image.decode();const x=20+(i%4)*395,y=105+Math.floor(i/4)*315;d.fillStyle='#18303d';d.fillRect(x,y,375,296);const scale=Math.min(365/image.width,245/image.height),w=image.width*scale,h=image.height*scale;d.drawImage(image,x+(375-w)/2,y+8+(245-h)/2,w,h);d.fillStyle='#eef6f7';d.font='bold 18px Segoe UI, Arial';d.fillText(p.name,x+12,y+278,350);}
    return canvas.toDataURL('image/png');
   },pictures);
   const sheetFile=__layout.map(path.join(OUTPUT,'warehouse-racks-contact-sheet.png'));fs.writeFileSync(sheetFile,Buffer.from(sheet.split(',')[1],'base64'));b.report.contactSheet=sheetFile;
   assert.deepEqual(b.report.exceptions,[]);assert.deepEqual(b.report.consoleErrors,[]);assert.deepEqual(fixture.errors,[]);assert.deepEqual(b.report.apiFailures,[]);
   fs.writeFileSync(__layout.map(path.join(OUTPUT,'warehouse-rack-browser.json')),JSON.stringify(b.report,null,2));console.log('Warehouse browser passed: category14/subfolders3, actual inspector resize/copy/server reopen, individual WebGL renders, correct HMI targets, no JS/GL errors and contact sheet from actual captures.');
  });
 }finally{await fixture.close();}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});module.exports={run};
