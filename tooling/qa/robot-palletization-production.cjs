'use strict';
// Actual reviewed anonymous public bundle and finite native material flow.
// Only the public pause control is changed. Physics advances at 1/60 s; no
// truck/product transforms, custody entries or inventories are manufactured.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/robot-palletization-production'),hash=value=>createHash('sha256').update(value).digest('hex');
function guard(app,file,expected){assert.match(expected||'',/^[a-f0-9]{64}$/,'Both reviewed bundle hashes are required.');const directory=path.join(ROOT,'artifacts',app);assert.equal(hash(fs.readFileSync(path.join(directory,file))),expected,'Reviewed artifact changed: '+app);assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'publication.json'))).bundleSha256,expected);}
async function run({expectedWorkspaceSha256,expectedPublicSha256}={}){
 guard('workspace','bundle.js',expectedWorkspaceSha256);guard('public-viewer','viewer.js',expectedPublicSha256);fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const report={startedAt:new Date().toISOString(),workspaceSha256:expectedWorkspaceSha256,publicSha256:expectedPublicSha256,anonymous:true,temporaryDataOnly:true,externalServicesUsed:false,poseFabrication:false,physicalQuestTest:false,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],chunks:[]};
 const fixture=await startFixture('Disposable-Palletization-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});
 try{
  const scenes=await request(fixture.origin,'/api/public/scenes');assert.equal(scenes.status,200);assert.deepEqual(scenes.json.scenes.map(scene=>scene.id),['vr-robot-dispatch']);
  // The API fixture mounts the public artifact at /; /workspace is private.
  const served=await request(fixture.origin,'/viewer.js');assert.equal(served.status,200);assert.equal(served.sha256,expectedPublicSha256);report.servedPublicBundleSha256=served.sha256;
  await withBrowser(fixture,report,async browser=>{
   const shot=async name=>{await new Promise(resolve=>setTimeout(resolve,180));const image=await browser.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(image.data,'base64'));report.screenshots.push(file);};
   await browser.send('Network.setBlockedURLs',{urls:['https://code.cdn.mozilla.net/*','https://fonts.googleapis.com/*','https://fonts.gstatic.com/*']});
   await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:"new MutationObserver(function(_,o){if(!document.documentElement)return;const s=document.createElement('style');s.textContent='*{font-family:system-ui,sans-serif!important}';document.documentElement.appendChild(s);o.disconnect();}).observe(document,{childList:true,subtree:true});"});
   await browser.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await browser.send('Emulation.setFocusEmulationEnabled',{enabled:true});
   // Launch through the same authorized public gallery button as a real guest;
   // a cold #demostracion deep link intentionally falls back to the gallery.
   await browser.send('Page.navigate',{url:fixture.origin+'/#escenarios'});
   await browser.until(()=>browser.evaluate('!!window.smartTwinGallery&&!!document.querySelector(".scene-open[data-scene-id=vr-robot-dispatch]")'),'The anonymous public scene launcher did not initialize.',90000);
   await browser.evaluate('smartTwinGallery.ready');
   await browser.call(()=>{const launch=document.querySelector('.scene-open[data-scene-id="vr-robot-dispatch"]');if(!launch||launch.tagName!=='BUTTON')throw Error('The real anonymous launch control is missing.');launch.click();});
   await browser.until(()=>browser.evaluate('!!window.smartTwinViewer&&!!smartTwinViewer.context.demo&&!!smartTwinViewer.context.demo.simulation'),'The actual compiled public demonstration did not initialize.',90000);
   report.initial=await browser.call(()=>{
    const api=smartTwinViewer,ctx=api.context,demo=ctx.demo,s=demo.simulation;demo.setPaused(true);if(ctx.voiceAssistant)ctx.voiceAssistant.setAutomatic(false);
    const records=[...s.records.values()],source=records.find(record=>record.components.source),robot=records.find(record=>record.components.robot),palletizer=records.find(record=>record.components.palletQueue&&record.components.palletQueue.config.palletize),vehicle=records.find(record=>record.components.vehicle),pickup=vehicle&&s.records.get(vehicle.components.vehicle.config.sourceId);
    if(!source||!robot||!palletizer||!vehicle||!pickup||!pickup.components.conveyor)throw Error('The curated native cell is incomplete.');
    const q=window.__palletizationQA={ctx,demo,s,source,robot,palletizer,vehicle,pickup,entries:new Map(),objects:new Map(),sampleCount:0,firstConveyor:null,firstReady:null,startTime:s.time,vehiclePosition:vehicle.object.position.toArray()};
    const check=(condition,message)=>{if(!condition)throw Error(message);};
    q.remember=entry=>{
     if(!entry||entry.originId!==source.id||entry.spec&&entry.spec.type!=='box')return;
     check(entry.load&&entry.load.loadMode==='individual','The robot Source contains a non-individual carton.');check(entry.units===1,'An original carton must retain one commercial unit.');check(entry.spec.mass===2,'Every original public carton must retain its declared 2 kg mass.');
     if(q.entries.has(entry.id))check(q.entries.get(entry.id)===entry,'Cloned/replaced original inventory entry '+entry.id);else q.entries.set(entry.id,entry);
     const product=entry.product||entry.archivedProduct;if(product&&product.object&&product.object.visible){if(q.objects.has(entry.id))check(q.objects.get(entry.id)===product.object,'A visible original carton object was replaced: '+entry.id);else q.objects.set(entry.id,product.object);}
    };
    q.audit=()=>{
     q.sampleCount++;const r=robot.components.robot,c=source.components.source,activeProducts=[...s.products.values()],archivedIds=new Set(),aggregateRows=[];
     check(!r.fault,'Robot fault: '+r.fault);if(r.entry)check(!(r.entry.load&&(r.entry.load.loadMode==='pallet'||r.entry.load.physicalAssembly))&&r.entry.spec.type!=='pallet','Vacuum robot acquired a pallet instead of one carton.');
     for(const entry of s.sourceRuntime.entries)q.remember(entry);q.remember(r.entry);for(const product of activeProducts)q.remember(product.sourceEntry);
     for(const product of activeProducts){const entry=product.sourceEntry;if(!entry||!entry.members||!entry.members.length)continue;
      check(entry.load.physicalAssembly===true,'Aggregate lacks physical assembly provenance.');check(entry.members.length===4&&entry.units===4,'A finished pallet must contain exactly four actual cartons.');
      const ids=new Set();for(const member of entry.members){q.remember(member);check(!ids.has(member.id)&&!archivedIds.has(member.id),'Carton belongs to multiple pallet identities: '+member.id);ids.add(member.id);archivedIds.add(member.id);
       const child=member.product||member.archivedProduct;check(child&&child.object===q.objects.get(member.id),'Pallet member is not the originally visible carton object.');check(member===q.entries.get(member.id),'Pallet member entry identity was replaced.');check(!s.products.has(child.object),'Pallet carton remains separately active and would be counted twice.');check(s.processorRuntime.archive.get(member.id)===child,'Pallet member is not retained by native provenance archive.');
       let ancestor=child.object,contained=false;while(ancestor){if(ancestor===product.object)contained=true;ancestor=ancestor.parent;}check(contained&&child.object.visible,'Original carton is not physically parented to its pallet.');
      }
      const metadata=s.productMetadata(product);check(metadata.mass===33&&metadata.units===4&&metadata.loadMode==='pallet','Physical pallet metadata lost 25 kg tare or four 2 kg cartons.');
      aggregateRows.push({id:entry.id,object:product.object.uuid,members:entry.members.map(member=>({id:member.id,object:(member.product||member.archivedProduct).object.uuid})),units:metadata.units,massKg:metadata.mass});
     }
     const activeIds=new Set();for(const entry of s.sourceRuntime.entries)if(entry.originId===source.id&&entry.spec&&entry.spec.type==='box'){check(!archivedIds.has(entry.id),'Archived carton is still a separate active inventory entry.');activeIds.add(entry.id);}
     for(const product of activeProducts){const entry=product.sourceEntry;if(entry&&entry.originId===source.id&&entry.spec&&entry.spec.type==='box'){check(!archivedIds.has(entry.id),'Archived carton is still an active physics product.');activeIds.add(entry.id);}}
     const custody=new Map(),own=(entry,label)=>{if(!entry||entry.originId!==source.id||entry.spec.type!=='box')return;if(!custody.has(entry.id))custody.set(entry.id,[]);custody.get(entry.id).push(label);};
     for(const record of s.records.values()){if(record.components.source)record.components.source.queue.forEach(entry=>own(entry,'source:'+record.id));if(record.components.palletQueue)record.components.palletQueue.queue.forEach(entry=>own(entry,'stock:'+record.id));if(record.components.conveyor)record.components.conveyor.packages.forEach(item=>own(item.product&&item.product.sourceEntry,'belt:'+record.id));if(record.components.robot)own(record.components.robot.entry,'robot:'+record.id);}
     for(const id of activeIds)check(custody.has(id)&&custody.get(id).length===1,'Carton must have exactly one actual custody container: '+id+' '+JSON.stringify(custody.get(id)));for(const id of archivedIds)check(!custody.has(id),'Archived carton also has an independent custody container: '+id);
     const accounted=activeIds.size+archivedIds.size;check(accounted===c.generatedUnits,'Unit conservation failed: '+accounted+' actual individual/archived units, '+c.generatedUnits+' generated.');check(c.generatedUnits<=8,'The finite public batch generated more than eight cartons.');
     const allObjects=[...q.objects.values()];check(new Set(allObjects).size===allObjects.length,'Distinct source IDs reference the same carton object.');
     let ready=null;for(const record of s.records.values()){const belt=record.components.conveyor;if(!belt)continue;for(const item of belt.packages){const entry=item.product&&item.product.sourceEntry;if(!entry||!entry.members||entry.members.length!==4)continue;check(s.products.get(item.product.object)===item.product&&item.beltId===record.id,'Pallet is not in actual native conveyor custody.');
       const row={entryId:entry.id,object:item.product.object.uuid,beltId:record.id,time:s.time,massKg:s.productMetadata(item.product).mass,units:entry.units};if(!q.firstConveyor)q.firstConveyor=row;else check(q.firstConveyor.entryId===entry.id&&q.firstConveyor.object===item.product.object.uuid,'A replacement pallet appeared before the first was collected.');if(record===pickup&&belt.transferBlocked&&Math.abs(belt.actualSpeed)<1e-8)ready=row;
     }}
     if(ready&&!q.firstReady)q.firstReady=ready;
     check(!vehicle.components.vehicle.entry,'The QA unexpectedly picked up a pallet with the vehicle.');check(vehicle.object.position.toArray().every((value,index)=>Math.abs(value-q.vehiclePosition[index])<1e-8),'The parked vehicle moved during the passive QA.');
     return {time:s.time,elapsed:s.time-q.startTime,paused:demo.paused,samples:q.sampleCount,generated:c.generatedUnits,sourceQueued:c.queue.length,configuredTotal:c.config.totalLimit,activeIndividualUnits:activeIds.size,archivedCartonUnits:archivedIds.size,accountedUnits:accounted,robot:{received:r.receivedUnits,delivered:r.deliveredUnits,completed:r.completed,phase:r.phase,carryingId:r.entry&&r.entry.id||null,carryingMode:r.entry&&r.entry.load.loadMode||null},aggregates:aggregateRows,firstConveyor:q.firstConveyor,ready:q.firstReady,activeProducts:activeProducts.length};
    };
    const initial=q.audit();return{source:{id:source.id,totalLimit:source.components.source.config.totalLimit,loadMode:source.components.source.config.loadMode,capacity:source.components.source.config.capacity},robot:{id:robot.id,tool:robot.components.robot.config.tool,toolMassKg:robot.components.robot.config.toolMassKg,payloadKg:robot.components.robot.config.payloadKg},palletizer:{id:palletizer.id,capacity:palletizer.components.palletQueue.config.capacity,limit:palletizer.components.palletQueue.config.palletizeLimit},pickupId:pickup.id,stats:initial};
   });
   assert.equal(report.initial.source.totalLimit,8);assert.equal(report.initial.source.loadMode,'individual');assert.equal(report.initial.robot.tool,'vacuum');assert.equal(report.initial.robot.toolMassKg,1.5);assert.equal(report.initial.robot.payloadKg,12);assert.equal(report.initial.palletizer.capacity,4);assert.equal(report.initial.palletizer.limit,2);assert(report.initial.stats.paused);
   let last=report.initial.stats;
   while(!last.ready&&last.elapsed<120){last=await browser.call(()=>{const q=__palletizationQA;for(let i=0;i<120&&!q.firstReady;i++){q.ctx.scene.updateMatrixWorld(true);q.s.execute(1/60);q.audit();}return q.audit();});report.chunks.push(last);if(report.chunks.length%10===0)console.log('Public native palletization: '+last.elapsed.toFixed(1)+' simulated seconds, '+last.robot.completed+' robot cycles, '+last.generated+' generated cartons.');}
   report.final=last;assert(last.ready,'No actual four-member pallet reached the stopped pickup conveyor in 120 simulated seconds: '+JSON.stringify(last));assert(last.robot.received>=4&&last.robot.completed>=4);assert.equal(last.ready.massKg,33);assert.equal(last.ready.units,4);assert.equal(last.accountedUnits,last.generated);assert(last.generated<=8);assert.equal(last.aggregates.length,1);assert.equal(last.aggregates[0].members.length,4);assert.equal(last.aggregates[0].id,last.ready.entryId);assert.equal(last.aggregates[0].object,last.ready.object);assert(last.samples>=100);
   await browser.call(()=>{const q=__palletizationQA;q.demo.visuals.sync(q.s.roomId,0,true);const overview=document.getElementById('overview');if(overview&&overview.textContent.includes('Vista general'))overview.click();});await shot('public-native-four-carton-pallet-ready');
   report.finalGL=await browser.evaluate('smartTwinViewer.context.renderer.getContext().getError()');assert.equal(report.finalGL,0);const cookies=await browser.send('Network.getCookies',{urls:[fixture.origin]});assert(!cookies.cookies.some(cookie=>cookie.name==='hello_studio_session'));
   report.blockedExternalFonts=report.failedRequests.filter(row=>/^https:\/\/(?:code\.cdn\.mozilla\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(row.url||''));assert.deepEqual(report.failedRequests.filter(row=>!report.blockedExternalFonts.includes(row)),[]);assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(fixture.errors,[]);assert.deepEqual(report.responses.filter(row=>row.url.startsWith(fixture.origin+'/')&&row.status>=400),[]);
  });
  guard('workspace','bundle.js',expectedWorkspaceSha256);guard('public-viewer','viewer.js',expectedPublicSha256);report.passed=true;return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();report.serverErrors=fixture.errors;fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,simulatedSeconds:report.final&&report.final.elapsed,generated:report.final&&report.final.generated,robotCycles:report.final&&report.final.robot.completed,screenshots:report.screenshots.length,report:path.join(OUT,'report.json')}));}
}
module.exports={run};if(require.main===module){const arg=key=>{const at=process.argv.indexOf(key);return at<0?undefined:process.argv[at+1];};run({expectedWorkspaceSha256:arg('--expected-workspace-sha256'),expectedPublicSha256:arg('--expected-public-sha256')}).catch(error=>{console.error(error);process.exitCode=1;});}
