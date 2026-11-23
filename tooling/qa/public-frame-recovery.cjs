'use strict';
// Compiled app, normal native RAF throughout. Deliberate, contained errors
// exercises recovery; it is not a reproduction of the reported user failure.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/public-frame-recovery');
const MARKER='SMARTTWIN_QA_INTENTIONAL_FRAME_FAILURE_ONCE',delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function guard(app,file,expected){
 assert.match(expected||'',/^[a-f0-9]{64}$/,'Both reviewed artifact hashes are required.');
 const directory=path.join(ROOT,'artifacts',app);
 assert.equal(hash(fs.readFileSync(path.join(directory,file))),expected,'Reviewed bundle changed: '+app);
 assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'publication.json'))).bundleSha256,expected);
}
async function run({expectedWorkspaceSha256,expectedPublicSha256,renderBackend}={}){
 guard('workspace','bundle.js',expectedWorkspaceSha256);guard('public-viewer','viewer.js',expectedPublicSha256);
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const report={startedAt:new Date().toISOString(),workspaceSha256:expectedWorkspaceSha256,publicSha256:expectedPublicSha256,anonymous:true,temporaryDataOnly:true,
  normalRAF:true,manualPhysicsTicks:0,fabricatedPoses:false,artificialFaultCoverage:true,userFailureReproduced:false,physicalQuestTest:false,
  exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],samples:[]};
 const fixture=await startFixture('Disposable-Frame-Recovery-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});
 fixture.renderBackend=renderBackend;
 try{
  const served=await request(fixture.origin,'/viewer.js');assert.equal(served.status,200);assert.equal(served.sha256,expectedPublicSha256);report.servedPublicBundleSha256=served.sha256;
  await withBrowser(fixture,report,async b=>{
   const save=()=>fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
   const shot=async name=>{const image=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(image.data,'base64'));report.screenshots.push(file);save();};
   const click=async selector=>{
    const rect=await b.call(selector=>{const element=document.querySelector(selector);if(!element||element.disabled)throw Error('Missing or disabled UI control: '+selector);element.scrollIntoView({block:'center',inline:'nearest'});const rect=element.getBoundingClientRect();if(rect.width<=0||rect.height<=0)throw Error('Hidden UI control: '+selector);return{x:rect.left+rect.width/2,y:rect.top+rect.height/2};},selector);
    await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});
   };
   await b.send('Network.setBlockedURLs',{urls:['https://code.cdn.mozilla.net/*','https://fonts.googleapis.com/*','https://fonts.gstatic.com/*']});
   await b.send('Emulation.setDeviceMetricsOverride',{width:640,height:360,deviceScaleFactor:1,mobile:false});await b.send('Emulation.setFocusEmulationEnabled',{enabled:true});
   await b.send('Page.navigate',{url:fixture.origin+'/#escenarios'});
   await b.until(()=>b.evaluate('!!window.smartTwinGallery&&!!document.querySelector(".scene-open[data-scene-id=vr-robot-dispatch]")'),'Public gallery did not initialize.',90000);
   await b.evaluate('smartTwinGallery.ready');await click('.scene-open[data-scene-id="vr-robot-dispatch"]');
   await b.until(()=>b.evaluate('!!window.smartTwinViewer&&!!smartTwinViewer.context.demo'),'Public native demonstration did not initialize.',90000);
   await b.until(()=>b.call(()=>[...smartTwinViewer.context.demo.simulation.products.values()].some(p=>p.object.userData.sourceProduct&&p.object.userData.sourceProduct.type==='pallet'&&p.object.userData.editorDefaultBehaviors)),'The actual runtime pallet did not materialize.',15000);
   report.productInspection=await b.call(()=>{
    const a=smartTwinViewer,d=a.context.demo,p=[...d.simulation.products.values()].find(p=>p.object.userData.sourceProduct&&p.object.userData.sourceProduct.type==='pallet'&&p.object.userData.editorDefaultBehaviors),object=p.object;
    const behavior=a.document.getBehaviors(object)[0],ancestors=[];
    // This exact native ancestry read threw "no compatible: pallet" in the
    // user's console. No cargo is moved or artificial ray hit introduced.
    for(let node=object;node;node=node.parent)ancestors.push({name:node.name,study:d.equipmentStudy.canStudy(node)});
    d.equipmentStudy.focusFromView();
    return{type:behavior.type,productType:behavior.productType,ancestors,stats:a.getStats()};
   });
   assert.equal(report.productInspection.type,'product');assert.equal(report.productInspection.productType,'pallet');
   assert.equal(report.productInspection.ancestors[0].study,false);assert.deepEqual(report.productInspection.stats.displayErrors,[]);assert.equal(report.productInspection.stats.frameError,null);
   report.optionalStart=await b.call(()=>{
    const a=smartTwinViewer,d=a.context.demo,original=d.monitors.sync;
    window.__optionalDisplayQA={original,calls:0};
    d.monitors.sync=function(){window.__optionalDisplayQA.calls++;throw Error('SMARTTWIN_QA_OPTIONAL_MONITOR');};
    return{time:d.simulation.time,frames:a.getStats().primaryRenders};
   });
   await b.until(()=>b.evaluate('smartTwinViewer.getStats().displayErrors.some(row=>row.disabled)'),'Optional display was not disabled after bounded retries.',15000);
   report.optionalFailure=await b.call(()=>{
    const a=smartTwinViewer,d=a.context.demo;d.monitors.sync=__optionalDisplayQA.original;
    return{stats:a.getStats(),calls:__optionalDisplayQA.calls};
   });
   assert.equal(report.optionalFailure.calls,3);assert.equal(report.optionalFailure.stats.frameError,null);
   assert(report.optionalFailure.stats.simulation.time>report.optionalStart.time+1);
   await b.call(()=>{const d=smartTwinViewer.context.demo,id=[...d.simulation.records.values()].find(r=>r.components.vehicle).id;if(!d.driving.mount(id))throw Error('Could not board the real forklift.');});
   // Observe, without changing pause, timestamps, joints, cargo or inventories.
   await b.until(()=>b.call(()=>{const s=smartTwinViewer.context.demo.simulation,r=[...s.records.values()].find(v=>v.components.robot).components.robot;return !!r.entry&&r.phase==='carry';}),'The first individual carton never entered the native carry phase.',60000);
   report.injection=await b.call(marker=>{
    const api=smartTwinViewer,demo=api.context.demo,s=demo.simulation,r=[...s.records.values()].find(v=>v.components.robot).components.robot;
    if(demo.paused||!r.entry||r.completed!==0)throw Error('The artificial failure must occur during the first real carton carry.');
    const before={time:s.time,frames:api.getStats().primaryRenders,phase:r.phase,entryId:r.entry.id,object:r.entry.product.object.uuid,loadMode:r.entry.load.loadMode,tool:r.config.tool,toolMassKg:r.config.toolMassKg,payloadKg:r.config.payloadKg};
    const original=demo.step;let injected=false;
    demo.step=function(){const result=original.apply(this,arguments);if(!injected){injected=true;demo.step=original;throw new Error(marker);}return result;};
    return before;
   },MARKER);
   assert.equal(report.injection.loadMode,'individual');assert.equal(report.injection.tool,'vacuum');assert.equal(report.injection.toolMassKg,1.5);assert.equal(report.injection.payloadKg,12);
   await b.until(()=>b.evaluate('!!smartTwinViewer.getStats().frameError&&!!smartTwinViewer.context.publicFrameFailure'),'The frame error was not contained and latched.',10000);
   report.latched=await b.call(()=>({stats:smartTwinViewer.getStats(),failure:smartTwinViewer.context.publicFrameFailure,notice:document.getElementById('viewer-notice').textContent,
    alert:document.getElementById('viewer-notice').getAttribute('role'),driveDisabled:document.getElementById('drive').disabled,pauseDisabled:document.getElementById('pause').disabled,camera:smartTwinViewer.context.camera.position.toArray()}));
   assert.match(report.latched.stats.frameError.message,new RegExp(MARKER));assert.equal(report.latched.stats.frameError.phase,'before');assert.equal(report.latched.stats.frameErrors,1);
   assert.equal(report.latched.stats.simulation.paused,true);assert.equal(report.latched.alert,'alert');assert.equal(report.latched.driveDisabled,true);assert.equal(report.latched.pauseDisabled,true);
   assert.equal(report.latched.stats.recovery.pending,true);
   await b.until(()=>b.evaluate('!smartTwinViewer.getStats().frameError&&!smartTwinViewer.context.publicFrameFailure&&!smartTwinViewer.context.publicDialogOpen'),'The automatic full restart did not clear the failure and input gate.',15000);
   report.restarted=await b.call(previousObject=>{
    const a=smartTwinViewer,d=a.context.demo,s=d.simulation,records=[...s.records.values()],source=records.find(v=>v.components.source).components.source,r=records.find(v=>v.components.robot).components.robot,p=records.find(v=>v.components.palletQueue&&v.components.palletQueue.config.palletize).components.palletQueue;
    return{stats:a.getStats(),sourceGenerated:source.generatedUnits,robotCompleted:r.completed,robotCarrying:!!r.entry,palletCompleted:p.assembly.completed,palletCartons:p.received,
     oldCargoStillActive:[...s.products.values()].some(v=>v.object.uuid===previousObject),driving:!!d.driving.id,vehicle:{parkingBrake:d.driving.record().components.vehicle.parkingBrake,actualSpeed:d.driving.record().components.vehicle.actualSpeed},driveDisabled:document.getElementById('drive').disabled,pauseDisabled:document.getElementById('pause').disabled,dialog:!!a.context.publicDialogOpen};
   },report.injection.object);
   assert.equal(report.restarted.stats.simulation.paused,false);assert.equal(report.restarted.robotCompleted,0);assert.equal(report.restarted.robotCarrying,false);
   assert.equal(report.restarted.palletCompleted,0);assert.equal(report.restarted.palletCartons,0);assert.equal(report.restarted.oldCargoStillActive,false);
   assert(report.restarted.sourceGenerated<=1);assert.equal(report.restarted.driveDisabled,false);assert.equal(report.restarted.pauseDisabled,false);assert.equal(report.restarted.dialog,false);
   assert.equal(report.restarted.driving,true);assert.equal(report.restarted.vehicle.parkingBrake,true);assert.equal(report.restarted.vehicle.actualSpeed,0);
   assert.equal(report.restarted.stats.recovery.attempts,1);assert.match(report.restarted.stats.lastFailure.message,new RegExp(MARKER));
   assert.deepEqual(report.restarted.stats.displayErrors,[]);await shot('automatic-recovery-restored-cab-and-inventory');
   // A second critical fault within the cooldown must remain contained, with
   // a working real menu, rather than repeatedly discarding scene state.
   await b.call(marker=>{const d=smartTwinViewer.context.demo,original=d.step;d.step=function(){d.step=original;throw Error(marker+'_SECOND');};},MARKER);
   await b.until(()=>b.evaluate('!!smartTwinViewer.getStats().frameError'),'Second failure was not contained.',10000);
   await delay(1000);
   report.repeated=await b.evaluate('smartTwinViewer.getStats()');
   assert.equal(report.repeated.recovery.attempts,1);assert.equal(report.repeated.recovery.pending,false);assert(report.repeated.frameError);
   await click('#viewer-menu-toggle');await b.until(()=>b.evaluate('document.getElementById("viewer-menu").open'),'The real menu stopped responding after a frame error.',5000);
   report.menuOpened=true;await click('#restart');
   await b.until(()=>b.evaluate('!smartTwinViewer.getStats().frameError&&!smartTwinViewer.context.publicFrameFailure&&!smartTwinViewer.context.publicDialogOpen&&!document.getElementById("viewer-menu").open'),'The real menu restart did not clear the repeated failure.',15000);
   await shot('real-menu-restart-restored-inventory');
   await b.call(()=>{
    const a=smartTwinViewer,c=a.context,d=c.demo,s=d.simulation,rows=[...s.records.values()],source=rows.find(v=>v.components.source),robot=rows.find(v=>v.components.robot),vehicle=rows.find(v=>v.components.vehicle),pickup=s.records.get(vehicle.components.vehicle.config.sourceId);
    const q=window.__frameRecoveryQA={s,d,source,robot,vehicle,pickup,entries:new Map(),objects:new Map(),samples:0,startTime:s.time,vehiclePosition:vehicle.object.position.toArray()};
    const check=(ok,text)=>{if(!ok)throw Error(text);};
    q.remember=entry=>{if(!entry||entry.originId!==source.id||entry.spec.type!=='box')return;check(entry.load.loadMode==='individual'&&entry.units===1&&entry.spec.mass===2,'Original carton shape or mass changed.');if(q.entries.has(entry.id))check(q.entries.get(entry.id)===entry,'Original carton entry replaced.');else q.entries.set(entry.id,entry);const product=entry.product||entry.archivedProduct;if(product){if(q.objects.has(entry.id))check(q.objects.get(entry.id)===product.object,'Original carton mesh replaced.');else q.objects.set(entry.id,product.object);}};
    q.audit=()=>{
     q.samples++;const r=robot.components.robot,sourceState=source.components.source,active=[...s.products.values()],archived=new Set(),individual=new Set(),pallets=[],custody=new Map();
     check(!d.paused&&!a.getStats().frameError&&!c.publicFrameFailure,'Normal RAF failed or paused after restart.');check(!r.fault,'Native robot fault: '+r.fault);
     if(r.entry){check(r.entry.load.loadMode==='individual'&&!r.entry.load.physicalAssembly&&r.entry.spec.type==='box','Vacuum robot acquired a whole pallet.');check(s.productMetadata(r.entry.product).mass+r.config.toolMassKg<=r.config.payloadKg,'Declared carton plus tool exceeds the configured robot payload.');}
     for(const entry of s.sourceRuntime.entries)q.remember(entry);q.remember(r.entry);
     for(const product of active){const entry=product.sourceEntry;q.remember(entry);if(!entry||!entry.members||!entry.members.length)continue;
      check(entry.load.physicalAssembly===true&&entry.members.length===4,'Finished pallet lacks four actual source cartons.');const ids=new Set();
      for(const member of entry.members){q.remember(member);check(!ids.has(member.id)&&!archived.has(member.id),'A source carton is duplicated in pallet custody.');ids.add(member.id);archived.add(member.id);const child=member.product||member.archivedProduct;
       check(child&&child.object===q.objects.get(member.id)&&member===q.entries.get(member.id),'Original carton identity was not preserved.');check(!s.products.has(child.object)&&s.processorRuntime.archive.get(member.id)===child,'An archived carton is independently active or lacks provenance.');
       let node=child.object,within=false;while(node){if(node===product.object)within=true;node=node.parent;}check(within&&child.object.visible,'The physical carton was detached or hidden on its pallet.');
      }
      const meta=s.productMetadata(product);check(meta.mass===33&&meta.units===4&&meta.loadMode==='pallet','Pallet tare or carton mass was lost.');pallets.push({id:entry.id,object:product.object.uuid,members:entry.members.map(v=>v.id),massKg:meta.mass,units:meta.units});
     }
     const own=(entry,label)=>{if(!entry||entry.originId!==source.id||entry.spec.type!=='box')return;if(!custody.has(entry.id))custody.set(entry.id,[]);custody.get(entry.id).push(label);};
     for(const record of s.records.values()){if(record.components.source)record.components.source.queue.forEach(v=>own(v,'source'));if(record.components.palletQueue)record.components.palletQueue.queue.forEach(v=>own(v,'stock'));if(record.components.conveyor)record.components.conveyor.packages.forEach(v=>own(v.product&&v.product.sourceEntry,'belt'));if(record.components.robot)own(record.components.robot.entry,'robot');}
     for(const entry of s.sourceRuntime.entries)if(entry.originId===source.id&&entry.spec.type==='box')individual.add(entry.id);
     for(const product of active){const entry=product.sourceEntry;if(entry&&entry.originId===source.id&&entry.spec.type==='box')individual.add(entry.id);}
     for(const id of individual)check(!archived.has(id)&&custody.has(id)&&custody.get(id).length===1,'Carton has ambiguous or duplicated native custody.');for(const id of archived)check(!custody.has(id),'Archived carton retained independent custody.');
     check(individual.size+archived.size===sourceState.generatedUnits,'Generated carton units are not conserved.');check(sourceState.generatedUnits<=8,'Finite scene generated more than eight cartons.');
     check(!vehicle.components.vehicle.entry&&vehicle.object.position.toArray().every((v,i)=>Math.abs(v-q.vehiclePosition[i])<1e-8),'The parked forklift moved or acquired cargo without input.');
     let ready=null;const belt=pickup.components.conveyor;for(const item of belt.packages){const entry=item.product&&item.product.sourceEntry;if(entry&&entry.members&&entry.members.length===4&&belt.transferBlocked&&Math.abs(belt.actualSpeed)<1e-8){check(s.products.get(item.product.object)===item.product&&item.beltId===pickup.id,'Pallet is not in native pickup conveyor custody.');ready={id:entry.id,object:item.product.object.uuid,massKg:s.productMetadata(item.product).mass,units:entry.units,beltId:pickup.id};}}
     return{wall:performance.now()/1000,time:s.time,elapsed:s.time-q.startTime,frames:a.getStats().primaryRenders,phase:r.phase,cycles:r.completed,carrying:r.entry&&r.entry.id||null,generated:sourceState.generatedUnits,activeUnits:individual.size,archivedUnits:archived.size,accountedUnits:individual.size+archived.size,pallets,ready,render:a.getStats().render};
    };
   });
   const start=Date.now();let last=null,progressTime=-1,progressAt=Date.now();
   while(Date.now()-start<180000){
    last=await b.evaluate('__frameRecoveryQA.audit()');report.samples.push(last);report.final=last;save();console.log('Normal RAF: '+last.time.toFixed(2)+' s sim / '+((Date.now()-start)/1000).toFixed(1)+' s wall; '+last.cycles+' cartons, '+last.generated+' generated.');
    if(last.time>progressTime){progressTime=last.time;progressAt=Date.now();}assert(Date.now()-progressAt<10000,'Normal RAF simulation time stopped for at least 10 wall seconds.');
    if(last.ready)break;await delay(2000);
   }
   report.normalWallSeconds=(Date.now()-start)/1000;assert(last&&last.ready,'Normal RAF failed to deliver the actual four-carton pallet to stopped pickup within 180 wall seconds.');
   assert(last.cycles>=4);assert.equal(last.ready.massKg,33);assert.equal(last.ready.units,4);assert.equal(last.pallets.length,1);assert.equal(last.pallets[0].members.length,4);
   assert.equal(last.ready.id,last.pallets[0].id);assert.equal(last.accountedUnits,last.generated);assert(last.generated<=8);assert(report.samples.length>=4);
   await shot('normal-raf-four-carton-pallet-at-pickup');report.finalGL=await b.evaluate('smartTwinViewer.context.renderer.getContext().getError()');assert.equal(report.finalGL,0);
   const cookies=await b.send('Network.getCookies',{urls:[fixture.origin]});assert(!cookies.cookies.some(v=>v.name==='hello_studio_session'));
   report.intentionalConsoleErrors=report.consoleErrors.filter(v=>v.includes(MARKER));assert.equal(report.intentionalConsoleErrors.length,2,'Exactly two deliberate contained critical failures should be logged.');
   assert.deepEqual(report.consoleErrors.filter(v=>!v.includes(MARKER)),[]);assert.deepEqual(report.exceptions,[]);
   report.blockedExternalFonts=report.failedRequests.filter(v=>/^https:\/\/(?:code\.cdn\.mozilla\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(v.url||''));
   assert.deepEqual(report.failedRequests.filter(v=>!report.blockedExternalFonts.includes(v)),[]);assert.deepEqual(report.responses.filter(v=>v.url.startsWith(fixture.origin+'/')&&v.status>=400),[]);assert.deepEqual(fixture.errors,[]);
  });
  guard('workspace','bundle.js',expectedWorkspaceSha256);guard('public-viewer','viewer.js',expectedPublicSha256);report.passed=true;return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,normalWallSeconds:report.normalWallSeconds,simulatedSeconds:report.final&&report.final.time,screenshots:report.screenshots.length,report:path.join(OUT,'report.json')}));}
}
module.exports={run};
if(require.main===module){const arg=key=>{const at=process.argv.indexOf(key);return at<0?undefined:process.argv[at+1];};run({expectedWorkspaceSha256:arg('--expected-workspace-sha256'),expectedPublicSha256:arg('--expected-public-sha256'),renderBackend:process.argv.includes('--hardware')?'d3d11':undefined}).catch(error=>{console.error(error);process.exitCode=1;});}
