'use strict';
// Tutorial stills from a disposable account and the compiled player. Only
// observer cameras and real UI commands are used; no inventory or score writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/receiving-tutorial');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
 fs.mkdirSync(OUT,{recursive:true});
 const report={startedAt:new Date().toISOString(),workspaceSha256:createHash('sha256').update(fs.readFileSync(path.join(ROOT,'artifacts/workspace/bundle.js'))).digest('hex'),temporaryDatabaseOnly:true,actorPoseAssignments:false,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],shots:[]};
 const password='Tutorial-QA-'+randomBytes(18).toString('hex');
 const fixture=await startFixture(password,{voice:{enabled:false,key:''},voiceFetch:async()=>{throw Error('Tutorial capture has no external providers.');}});
 try{
  assert.equal((await request(fixture.origin,'/api/studio/register','POST',{username:'qa_tutorial_creator',displayName:'Guía de recepción',password})).status,201);
  await withBrowser(fixture,report,async b=>{
   const until=(fn,message)=>b.until(fn,message,180000);
   const click=async selector=>{const point=await b.call(selector=>{const node=document.querySelector(selector);if(!node||node.disabled)throw Error('Control unavailable: '+selector);node.scrollIntoView({block:'center',inline:'nearest'});const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(!r.width||!r.height||!(node===hit||node.contains(hit)))throw Error('Control covered: '+selector);return{x,y};},selector);await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});};
   const shot=async(id,title,selectors=[])=>{await delay(350);const metadata=await b.call(selectors=>{const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};return{url:location.pathname+location.search,viewport:{width:innerWidth,height:innerHeight},areas:selectors.map(selector=>{const n=document.querySelector(selector);return{selector,present:!!n,text:n&&n.innerText,rect:n&&rect(n)};}),text:document.body.innerText};},selectors);const value=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,id+'.png');fs.writeFileSync(file,Buffer.from(value.data,'base64'));report.screenshots.push(file);report.shots.push({id,title,file,...metadata});console.log('Tutorial screenshot: '+id);fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(report,null,2));};
   await b.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
   await b.send('Page.navigate',{url:fixture.origin+'/play'});await until(()=>b.evaluate('!!document.querySelector("#login")'),'No login form.');
   await b.call(password=>{const form=document.querySelector('#login');form.elements.username.value='qa_tutorial_creator';form.elements.password.value=password;form.requestSubmit();},password);
   await until(()=>b.evaluate('document.querySelectorAll(".st-practice-card").length===10'),'No practice library.');
   await shot('00-library','Catálogo de prácticas: escoger CEDI-01',['[data-practice-id="CEDI-01"]>summary','.st-practice-execution-choice']);
   await click('[data-practice-id="CEDI-01"]>summary');await until(()=>b.evaluate('!!document.querySelector(".st-practice-live-preview[data-state=ready]")'),'No native preview.');await click('[data-practice-suggested]');await until(()=>b.evaluate('!!document.querySelector(".st-practice-live-preview[data-state=ready]")'),'Suggested setup failed.');
   await shot('01-configuration','Configuración recomendada: caso A, guiada y manual',['.st-practice-setup-dialog','[data-practice-suggested]','[data-practice-setting="caseId"]','[data-practice-setting="difficulty"]','[data-practice-setting="mode"]','.st-practice-live-preview','.st-practice-create']);
   await click('[data-practice-preview-view="3d"]');await shot('02-configuration-3d','Previsualización 3D del mismo montaje',['.st-practice-live-preview','[data-practice-preview-view="3d"]']);
   await click('[data-practice-setup-pane="data"]');await shot('03-products','Productos y pedidos: referencias, cajas y embalajes',['.st-practice-setup-data','.st-practice-live-preview','[data-cedi-pane="products"]']);
   await b.call(()=>document.querySelector('[data-cedi-section="products"]').scrollIntoView({block:'start'}));await shot('03-product-cards','Fotografías: unidad comercial, caja y pallet configurados',['[data-cedi-section="products"]','.st-practice-live-preview']);
   for(const pane of ['purchases','inventory','demand','capacity']){await click('[data-cedi-pane="'+pane+'"]');await b.call(pane=>document.querySelector('[data-cedi-section="'+pane+'"]').scrollIntoView({block:'start'}),pane);await shot('04-data-'+pane,'Datos de operación: '+pane,['[data-cedi-section="'+pane+'"]','.st-practice-live-preview']);}
   await click('[data-practice-setup-pane="guide"]');await shot('05-setup-guide','Consulta las seis misiones antes de iniciar',['.st-practice-setup-guide','.st-practice-create','.st-practice-live-preview']);
   await click('[data-practice-setup-pane="configuration"]');await click('.st-practice-create');await until(()=>b.evaluate('!!window.context&&!!context.editor?.practiceController&&!context.studio.practiceCampaign.busy&&context.renderer.info.render.triangles>0'),'No CEDI-01 scene.');
   report.initial=await b.call(()=>{const c=context.editor.practiceController,o=c.workflow.observe();return{practiceId:c.manifest.practiceId,order:c.state().order,identities:o.units.map(r=>({id:r.id,ownerId:r.ownerId,units:r.units,position:r.position})),materialBalance:o.materialBalance,criticalReasons:o.criticalReasons};});
   assert.equal(report.initial.practiceId,'CEDI-01');assert.equal(report.initial.identities.length,6);assert.equal(report.initial.materialBalance.actualUnits,48);
   await shot('06-player-overview','Pantalla de práctica: misiones, escena, instrucciones y registro',['.st-practice-learning-left','.st-practice-learning-right','.st-practice-scene-frame','.st-practice-active-mission']);
   await b.call(()=>{const p=context.editor.practiceController.panel;p.userExpanded=true;p.setExpanded(true);p.order.querySelector('details').open=true;p.workflowChosen='arrival-check';p.renderWorkflow(p.controller.state());p.learningRight.scrollTop=p.learningRight.scrollHeight;});
   await shot('07-order','La orden indica lote, muelle, pallets, cajas y masa',['.st-practice-order','[data-practice-workflow="arrival-check"]']);
   await b.call(()=>{context.editor.practiceController.panel.openWorkflowAction('arrival-check');});await shot('08-arrival-form','Paso 1: contrastar cita, vehículo y orden',['.st-practice-vehicle-preparation','[data-practice-workflow="arrival-check"]']);
   const fill=async(id,values)=>{await b.call((id,values)=>{const p=context.editor.practiceController.panel;p.workflowChosen=id;p.renderWorkflow(p.controller.state());const f=document.querySelector('[data-practice-workflow="'+id+'"]');for(const[k,v]of Object.entries(values)){f.elements.namedItem(k).value=String(v);f.elements.namedItem(k).dispatchEvent(new Event('change',{bubbles:true}));}},id,values);await shot(id==='arrival-check'?'08-arrival-filled':'09-secure-filled','Datos seleccionados antes de confirmar: '+id,['.st-practice-vehicle-preparation','[data-practice-workflow="'+id+'"]']);await click('[data-practice-workflow="'+id+'"] button[type=submit]');await delay(400);};
   await fill('arrival-check',{orderId:report.initial.order.orderId,boxes:48,dockId:'E02'});
   await b.call(()=>{context.editor.practiceController.panel.openWorkflowAction('secure-dock');});await shot('09-secure-dock','Paso 2: verificar calzos y habilitación del muelle',['.st-practice-vehicle-preparation','[data-practice-workflow="secure-dock"]']);
   await fill('secure-dock',{secured:'checked'});await b.call(()=>{context.editor.practiceController.panel.closeWorkflowAction();});
   for(const[id,caption]of[['inspect-pallet','Paso 3: datos de inspección del pallet'],['disposition','Paso 4: decisión de calidad'],['register-pallet','Paso 5: registro de recepción'],['confirm-handover','Paso 6: confirmar entrega al siguiente proceso']]){
    await b.call(id=>{const p=context.editor.practiceController.panel;p.userExpanded=true;p.setExpanded(true);p.workflowChosen=id;p.renderWorkflow(p.controller.state());p.learningRight.scrollTop=p.learningRight.scrollHeight;const form=document.querySelector('[data-practice-workflow="'+id+'"]');form.scrollIntoView({block:'center'});},id);
    await shot('10-form-'+id,caption+' (vista de los campos; primero cumple la condición física)',['.st-practice-operation-card','[data-practice-workflow="'+id+'"]']);
   }
   await b.call(()=>{const p=context.editor.practiceController.panel;p.sceneFocus=true;p.userExpanded=false;p.update();context.studio.setDesktopFlight(true);document.activeElement.blur();});
   const views=[
    {id:'11-truck-dock',title:'Muelle E02 y seis pallets originales del lote',eye:[-12,6.5,30],target:[-22,1,23.5]},
    {id:'12-overview-reception',title:'Recepción con tres entradas de rodillos en L y puestos de calidad',eye:[-10,8.9,8],target:[-23,1,-4]},
    {id:'13-quality-pod',title:'Puesto de inspección junto a la línea de rodillos',eye:[-21.5,3.1,-.1],target:[-21.5,.85,-4.5]},
    {id:'14-inspection-E04',title:'Bahía E04 de inspección: detener aquí el pallet antes de registrar',eye:[-17,4.4,9],target:[-24,1,4]},
    {id:'15-quarantine-E05',title:'Zona E05: separar la carga retenida',eye:[0,4.5,8],target:[-6,1,3]},
    {id:'16-release-E07',title:'Zona E07: posiciones de pallets liberados para almacenamiento',eye:[-10,5,14],target:[-18.5,.4,10]},
    {id:'17-analytics',title:'Tablero de recepción: estado real del lote sin fabricar resultados',eye:[-26,1.6,-2.85],target:[-26,3.15,-4.5]}
   ];
   for(const view of views){await b.call(view=>{const c=context.camera,r=context.cameraRig;if(context.input)context.input.reset();if(context.desktopLook){context.desktopLook.unlock();context.desktopLook.reset();}r.position.set(view.eye[0],view.eye[1]-1.65,view.eye[2]);r.quaternion.set(0,0,0,1);c.position.set(0,1.65,0);r.updateMatrixWorld(true);c.lookAt(...view.target);c.updateMatrixWorld(true);if(context.resetCollisionPose)context.resetCollisionPose();},view);await delay(600);await shot(view.id,view.title,['.st-practice-scene-frame']);report.shots[report.shots.length-1].observerPose=view;}
   await b.call(()=>{const c=context.editor.practiceController,d=context.editor.vehicleDriving;if(!d.mount(c.manifest.vehicleIds[0]))throw Error('Cannot mount receiving forklift.');document.activeElement.blur();});await delay(500);
   await shot('18-cockpit-controls','Cabina: P libera el freno, W/S avanza o retrocede; Q/E altura',['.vehicle-driving-hud','.vehicle-docking-monitor']);
   await b.call(async()=>{await context.studio.practiceCampaign.openGuide('layout');const reading=document.querySelector('.st-practice-guide-content');reading.scrollTop=0;});await shot('20-live-layout','Guía → Layout en vivo: posiciones actuales de E01, E02, E03, E04, E05, E07 y E08',['.st-practice-guide-modal','.st-practice-live-layout']);const layoutPng=await b.call(()=>document.querySelector('.st-practice-live-layout').toDataURL('image/png'));fs.writeFileSync(path.join(OUT,'20-live-layout-canvas.png'),Buffer.from(layoutPng.split(',')[1],'base64'));report.nativeLayoutCanvas={file:path.join(OUT,'20-live-layout-canvas.png'),source:'Unmodified native canvas from Guide / Layout en vivo',width:1200,height:760};await b.call(()=>context.studio.practiceCampaign.closeGuide());
   // Freeze only the disposable browser clock for a readable still of the
   // existing dialog. The fields retain their real physical prerequisites.
   // No completion, custody, transforms or workflow result is assigned.
   await b.send('Emulation.setVirtualTimePolicy',{policy:'pause'});
   for(const id of ['inspect-pallet','disposition','register-pallet','confirm-handover']){
    await b.call(id=>{const p=context.editor.practiceController.panel;p.closeWorkflowAction();p.openWorkflowAction(id);const dialog=p.workflowDialog;const form=dialog.querySelector('[data-practice-workflow="'+id+'"]');const content=dialog.querySelector('.st-practice-vehicle-preparation-body');content.scrollTop=content.scrollHeight;form.scrollIntoView({block:'center'});},id);
    await shot('19-modal-'+id,'Vista ampliada del formulario real: '+id+'; sin cumplir aún el requisito físico',['.st-practice-vehicle-preparation','[data-practice-workflow="'+id+'"]']);
    await b.call(()=>context.editor.practiceController.panel.closeWorkflowAction());
   }
   report.final=await b.call(()=>{const c=context.editor.practiceController,o=c.workflow.observe();return{secured:c.workflow.state.secured,arrival:!!c.workflow.state.arrival,identities:o.units.map(r=>({id:r.id,ownerId:r.ownerId,units:r.units,position:r.position})),materialBalance:o.materialBalance,criticalReasons:o.criticalReasons};});
   assert.deepEqual(report.final.identities,report.initial.identities,'Observer capture moved cargo.');assert.deepEqual(report.final.materialBalance,report.initial.materialBalance);assert(report.final.secured&&report.final.arrival);assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(fixture.errors,[]);report.passed=true;
  });return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:report.passed,shots:report.shots.length,out:OUT}));}
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
