'use strict';
// Compiled receiving-zone audit in a disposable HTTPS/SQLite workspace. Camera
// poses below are observer viewpoints only; machine/cargo poses and workflow
// evidence are never assigned by this audit.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/receiving-zone-production');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function run({expectedWorkspaceSha256}={}){
 assert.match(expectedWorkspaceSha256||'',/^[a-f0-9]{64}$/);
 assert.equal(sha(fs.readFileSync(path.join(ROOT,'artifacts/workspace/bundle.js'))),expectedWorkspaceSha256,'Rebuild or pass the reviewed compiled bundle hash.');
 fs.mkdirSync(OUT,{recursive:true});
 const report={startedAt:new Date().toISOString(),workspaceSha256:expectedWorkspaceSha256,temporaryDatabaseOnly:true,actorPoseAssignments:false,observerCameraViews:true,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],views:[]};
 const password='Receiving-QA-'+randomBytes(18).toString('hex');
 const fixture=await startFixture(password,{voice:{enabled:false,key:''},voiceFetch:async()=>{throw Error('This audit makes no external provider requests.');}});
 try{
  assert.equal((await request(fixture.origin,'/api/studio/register','POST',{username:'qa_receiving_creator',displayName:'QA recepción',password})).status,201);
  await withBrowser(fixture,report,async b=>{
   const stage=value=>{report.stage=value;console.log('Receiving production QA: '+value);};
   const until=(fn,message)=>b.until(fn,message,180000);
   const click=async selector=>{const point=await b.call(selector=>{const node=document.querySelector(selector);if(!node||node.disabled)throw Error('Control unavailable: '+selector);node.scrollIntoView({block:'center',inline:'nearest'});const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(!r.width||!r.height||!(node===hit||node.contains(hit)))throw Error('Control covered: '+selector);return{x,y};},selector);await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});};
   const shot=async name=>{await delay(200);const value=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(value.data,'base64'));report.screenshots.push(file);};
   const snapshot=()=>b.call(()=>{
    const controller=context.editor.practiceController,m=controller.manifest,workflow=controller.workflow,o=workflow.observe(),runtime=context.editor.simulation;
    const bank=m.receivingConveyors,assembly=context.editor.assembly,document=context.editor.document;
    return{practiceId:m.practiceId,simulationTime:runtime.time,productCount:runtime.products.size,orderId:m.receiving.orderId,prepared:workflow.state.secured,arrival:!!workflow.state.arrival,materialBalance:o.materialBalance,criticalReasons:o.criticalReasons,
     identities:o.units.map(row=>({id:row.id,ownerId:row.ownerId,units:row.units,massKg:row.massKg,position:row.position,inSource:row.inSource,inReleased:row.inReleased,inQuarantine:row.inQuarantine})),
     context:(m.cediContext.entries||[]).filter(row=>['receiving','inspection'].includes(row.zone)),receivingZone:m.cediContext.receivingZone||m.receivingZone||null,
     analytics:{boardIds:m.receivingAnalytics&&m.receivingAnalytics.boardIds||[],standby:(m.receivingAnalytics&&m.receivingAnalytics.standby||[]).map(reference=>{const object=document.getObject(reference.objectId);let visibleMeshes=0;if(object)object.traverse(node=>{if(!node.isMesh)return;for(let parent=node;parent;parent=parent.parent){if(!parent.visible)return;if(parent===object)break;}visibleMeshes++;});return{id:reference.objectId,present:!!object,rootVisible:object&&object.visible,visibleMeshes};}),draws:controller.receivingAnalytics&&controller.receivingAnalytics.draws||0,models:(controller.receivingAnalytics&&controller.receivingAnalytics.entries||[]).map(entry=>entry.signature?JSON.parse(entry.signature):null)},
     conveyors:bank?{layoutId:bank.layoutId,nativeIds:bank.nativeIds,inlets:bank.inlets,outlet:bank.outlet,actors:bank.conveyorIds.map(id=>{const record=runtime.records.get(id),v=record&&record.components.conveyor;return{id,present:!!v,autoSpawn:v&&v.config.autoSpawn,withPallet:v&&v.config.withPallet,packages:v&&(v.packages||[]).length};}),links:bank.links.map(link=>{const source=document.getObject(link.sourceId),target=document.getObject(link.targetId),config=source&&assembly.config(source),branch=link.sourcePort==='branch';return{sourceId:link.sourceId,targetId:link.targetId,sourcePort:link.sourcePort,targetPort:link.targetPort,boundTarget:config&&config[branch?'branchId':'outputId'],boundPort:config&&(config[branch?'branchPort':'outputPort']||'input'),assessment:source&&target&&assembly.assessConnection(source,link.sourcePort,target,link.targetPort)};})}:null,
     nativeActors:m.aliases.map(row=>({alias:row.alias,id:row.objectId,present:!!runtime.records.get(row.objectId)})),
     render:{calls:context.renderer.info.render.calls,triangles:context.renderer.info.render.triangles,geometries:context.renderer.info.memory.geometries,textures:context.renderer.info.memory.textures,gl:context.renderer.getContext().getError()}};
   });
   await b.send('Emulation.setDeviceMetricsOverride',{width:1720,height:1080,deviceScaleFactor:1,mobile:false});await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
   stage('Create the real CEDI-01 attempt through the normal account UI');
   await b.send('Page.navigate',{url:fixture.origin+'/play'});await until(()=>b.evaluate('!!document.querySelector("#login")'),'No login form.');
   await b.call(password=>{const form=document.querySelector('#login');form.elements.username.value='qa_receiving_creator';form.elements.password.value=password;form.requestSubmit();},password);
   await until(()=>b.evaluate('document.querySelectorAll(".st-practice-card").length===10'),'No practice library.');await click('[data-practice-id="CEDI-01"]>summary');
   await until(()=>b.evaluate('!!document.querySelector(".st-practice-live-preview[data-state=ready]")'),'The native setup preview failed.');await click('[data-practice-suggested]');
   await until(()=>b.evaluate('!!document.querySelector(".st-practice-live-preview[data-state=ready]")'),'Suggested setup failed.');await shot('receiving-setup-preview');await click('.st-practice-create');
   await until(()=>b.evaluate('!!window.context&&!!context.editor?.practiceController&&!context.studio.practiceCampaign.busy&&context.renderer.info.render.triangles>0'),'No compiled CEDI receiving scene.');
   report.initial=await snapshot();assert.equal(report.initial.practiceId,'CEDI-01');assert.equal(report.initial.materialBalance.actualUnits,48);assert.equal(report.initial.identities.length,6);assert(report.initial.identities.every(row=>row.inSource&&row.units===8));assert.deepEqual(report.initial.criticalReasons,[]);assert(report.initial.nativeActors.every(row=>row.present));assert.equal(report.initial.render.gl,0);
   const checkConveyors=s=>{assert(s.conveyors,'No real receiving conveyor bank.');assert.equal(s.conveyors.actors.length,9);assert.equal(s.conveyors.inlets.length,3);assert.equal(s.conveyors.links.length,8);assert(s.conveyors.actors.every(row=>row.present&&row.autoSpawn===false&&row.withPallet===false&&row.packages===0),'Receiving conveyors must be native and must not generate phantom cargo.');for(const link of s.conveyors.links){assert.equal(link.boundTarget,link.targetId);assert.equal(link.boundPort,link.targetPort);assert(link.assessment&&link.assessment.ready&&link.assessment.gap<1e-6&&link.assessment.heading>.999999,'Actual receiving ports do not coincide.');}};
   checkConveyors(report.initial);await delay(3200);report.afterIdle=await snapshot();checkConveyors(report.afterIdle);assert.equal(report.afterIdle.productCount,6);assert.deepEqual(report.afterIdle.identities,report.initial.identities);assert.deepEqual(report.afterIdle.materialBalance,report.initial.materialBalance);
   stage('Observer viewpoints of the same native reception, no cargo or machine mutation');
   await b.call(()=>{const p=context.editor.practiceController.panel;p.sceneFocus=true;p.userExpanded=false;p.update();context.studio.setDesktopFlight(true);document.activeElement.blur();});
   const observer=async view=>{
    const actual=await b.call(view=>{const c=context.camera,r=context.cameraRig;if(context.input)context.input.reset();if(context.desktopLook){context.desktopLook.unlock();context.desktopLook.reset();}r.position.set(view.eye[0],view.eye[1]-1.65,view.eye[2]);r.quaternion.set(0,0,0,1);c.position.set(0,1.65,0);r.updateMatrixWorld(true);c.lookAt(view.target[0],view.target[1],view.target[2]);c.updateMatrixWorld(true);if(context.resetCollisionPose)context.resetCollisionPose();return{eye:c.getWorldPosition(c.position.clone()).toArray(),target:view.target};},view);
    await delay(700);await shot(view.id);report.views.push(Object.assign({},view,{actual}));
   };
   const boardView=await b.call(()=>{const controller=context.editor.practiceController,id=controller.manifest.receivingAnalytics.boardIds[0],owner=context.editor.document.getObject(id),target=owner.getWorldPosition(owner.position.clone()).toArray();return{eye:[target[0],target[1],target[2]+3.05],target};});
   const views=[
    {id:'receiving-front-observer',eye:[-10,8.9,8],target:[-23,1,-4]},
    {id:'receiving-reverse-observer',eye:[-31,8.5,-14],target:[-23,1,-4]},
    {id:'receiving-inspection-observer',eye:[-14,3.5,-1],target:[-23,1.1,-4]},
    {id:'receiving-quality-pod-observer',eye:[-21.5,3.1,-.1],target:[-21.5,.85,-4.5]},
    Object.assign({id:'receiving-analytics-before-preparation'},boardView),
    {id:'receiving-analytics-pedestrian-observer',eye:[-26,1.6,-2.85],target:boardView.target}
   ];
   for(const view of views)await observer(view);
   report.afterViews=await snapshot();assert.deepEqual(report.afterViews.identities,report.initial.identities,'Observer photography changed material custody or poses.');assert.deepEqual(report.afterViews.materialBalance,report.initial.materialBalance);
   assert(report.afterViews.analytics.boardIds.length>0,'Reception has no physical analytics board.');assert(report.afterViews.analytics.draws>0,'The physical analytics canvas never drew.');
   assert.equal(report.afterViews.analytics.standby.length,report.afterViews.analytics.boardIds.length,'Every physical board must retain its own authored editor standby legend.');assert(report.afterViews.analytics.standby.every(row=>row.present&&row.visibleMeshes===0),'The authored standby legend is overprinted on the live analytics screen.');
   const boardBefore=report.afterViews.analytics.models.find(Boolean);assert(boardBefore&&boardBefore.available,'No real receiving ledger on the analytics board.');assert.equal(boardBefore.physicalUnits,48);assert.equal(boardBefore.prepared,false);assert(boardBefore.metrics.every(row=>row.value===0),'Initial board must not fabricate completed operations.');assert.equal(boardBefore.rows.length,6);
   stage('Existing receiving preparation remains physically gated and actionable');
   await b.call(()=>{const d=context.editor.vehicleDriving,m=context.editor.practiceController.manifest;if(!d.mount(m.vehicleIds[0]))throw Error('Cannot mount the native receiving forklift.');document.activeElement.blur();});
   await delay(200);const vehicle=()=>b.call(()=>{const r=context.editor.vehicleDriving.record(),v=r.components.vehicle;return{id:r.id,enabled:v.enabled,interlock:v.operatorInterlock,distance:v.distance,entry:!!v.entry};});
   report.beforePreparation=await vehicle();assert.equal(report.beforePreparation.enabled,false);assert.equal(report.beforePreparation.interlock.actionId,'arrival-check');await click('[data-vehicle-preparation]');
   const fill=async(id,values)=>{await until(()=>b.call(id=>{const form=document.querySelector('[data-practice-workflow="'+id+'"]');return form&&!form.hidden&&!!form.getBoundingClientRect().height;},id),'Workflow form unavailable: '+id);await b.call((id,values)=>{const form=document.querySelector('[data-practice-workflow="'+id+'"]');for(const[key,value]of Object.entries(values)){const input=form.elements.namedItem(key);if(!input)throw Error('Missing workflow field '+key);input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));}},id,values);await click('[data-practice-workflow="'+id+'"] button[type=submit]');await delay(250);};
   await fill('arrival-check',{orderId:report.initial.orderId,boxes:48,dockId:'E02'});report.afterArrival=await vehicle();assert.equal(report.afterArrival.enabled,false);assert.equal(report.afterArrival.interlock.actionId,'secure-dock');
   await fill('secure-dock',{secured:'checked'});await until(()=>b.evaluate('context.editor.vehicleDriving.record().components.vehicle.enabled===true'),'Real secured dock did not enable the forklift.');report.afterPreparation=await vehicle();
   report.final=await snapshot();assert.equal(report.final.prepared,true);assert.equal(report.final.arrival,true);assert.deepEqual(report.final.identities,report.initial.identities,'Documentary preparation created or moved cargo.');assert.deepEqual(report.final.criticalReasons,[]);assert.deepEqual(report.final.materialBalance,report.initial.materialBalance);assert.equal(report.final.render.gl,0);
   await shot('receiving-verified-native-cockpit');
   stage('Trusted driving still works after preparation in the redesigned receiving area');
   const key=async(code,key,vk,down=true)=>b.send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});
   if(await b.evaluate('context.editor.vehicleDriving.record().components.vehicle.parkingBrake')){await key('KeyP','p',80);await key('KeyP','p',80,false);}
   await key('KeyW','w',87);await until(()=>b.evaluate('context.editor.vehicleDriving.record().components.vehicle.distance>.10'),'Receiving forklift could not move after verified preparation.');await key('KeyW','w',87,false);await key('Space',' ',32);await until(()=>b.evaluate('Math.abs(context.editor.vehicleDriving.record().components.vehicle.actualSpeed)<.02'),'Receiving forklift would not brake.');await key('Space',' ',32,false);report.driven=await vehicle();assert(report.driven.distance>.10);
   await b.call(()=>{if(!context.editor.vehicleDriving.unmount())throw Error('Native unmount rejected.');context.studio.setDesktopFlight(true);const p=context.editor.practiceController.panel;p.update();p.sceneFocus=true;p.userExpanded=false;p.update();});
   await observer(Object.assign({id:'receiving-analytics-after-preparation'},boardView));
   report.afterPreparationView=await snapshot();const boardAfter=report.afterPreparationView.analytics.models.find(Boolean);assert(boardAfter&&boardAfter.prepared,'Analytics did not reflect the real secured dock.');assert.equal(boardAfter.physicalUnits,48);assert(boardAfter.metrics.every(row=>row.value===0),'Preparing the dock must not count as unloading cargo.');assert.deepEqual(report.afterPreparationView.identities,report.initial.identities);assert.equal(report.afterPreparationView.render.gl,0);
   assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);assert.deepEqual(fixture.errors,[]);report.passed=true;
  });return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:report.passed,stage:report.stage,report:path.join(OUT,'report.json')}));}
}
module.exports={run};
if(require.main===module){const at=process.argv.indexOf('--expected-workspace-sha256');run({expectedWorkspaceSha256:at<0?undefined:process.argv[at+1]}).catch(error=>{console.error(error);process.exitCode=1;});}
