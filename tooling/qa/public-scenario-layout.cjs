'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/public-scenario-layout');
async function run(expected){
 assert.match(expected||'',/^[a-f0-9]{64}$/);assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))).digest('hex'),expected);
 fs.mkdirSync(OUT,{recursive:true});const report={publicSha256:expected,physicalHeadsetTest:false,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};
 const fixture=await startFixture('Disposable-Scenario-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});fixture.renderBackend='d3d11';
 try{await withBrowser(fixture,report,async b=>{
  const shot=async name=>{const png=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(png.data,'base64'));report.screenshots.push(file);};
  await b.send('Page.navigate',{url:fixture.origin+'/'});await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Welcome unavailable.');
  await b.evaluate('document.querySelector("#explore-demo").click()');await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context.demo?.interactions'),'Scenario unavailable.',90000);
  report.dashboard=await b.call(()=>{document.querySelector('[data-tour-tool="dashboard"]').click();const c=smartTwinViewer.context;return{open:document.querySelector('.demo-operations').open,blocked:c.publicDialogOpen,continues:c.demoOperationsOpen,time:c.demo.simulation.time,cards:document.querySelectorAll('.demo-operations-kpis strong').length};});
  assert(report.dashboard.open&&report.dashboard.blocked&&report.dashboard.continues);assert.equal(report.dashboard.cards,8);
  await b.until(()=>b.call(time=>smartTwinViewer.context.demo.simulation.time>time+1,report.dashboard.time),'Opening the dashboard froze production.');
  await shot('operations-dashboard');
  report.commands=await b.call(()=>{const d=smartTwinViewer.context.demo,p=document.querySelector('.demo-operations'),s=d.operations.refs().source,click=action=>p.querySelector('[data-operation="'+action+'"]').click();click('stop');const stopped=!s.components.source.running;click('emergency');click('emergency');const latched=s.components.source.emergency;click('resetEmergency');const reset=!s.components.source.emergency&&!s.components.source.running;d.setPaused(true);click('start');const started=s.components.source.running&&!d.paused;p.querySelector('.demo-operations-header button').click();return{stopped,latched,reset,started,unblocked:!smartTwinViewer.context.publicDialogOpen};});assert(Object.values(report.commands).every(Boolean));
  report.layout=await b.call(()=>{
   const a=smartTwinViewer,c=a.context,d=c.demo,records=Array.from(d.simulation.records.values()),rows=Array.from(a.document.additions.values());c.renderer.setAnimationLoop(null);
   const belts=records.filter(r=>r.components.conveyor&&/^DEMOSTRACIÓN/.test(r.object.name));
   const receiver=records.find(r=>/recepción de ocho cajas/.test(r.object.name));
   window.__scenarioQA={a,c,d,belts,receiver,seen:belts.map(()=>new Set()),frames:0,
    tick(seconds){for(let i=0;i<seconds*30;i++){c.scene.updateMatrixWorld(true);d.step(1/30);belts.forEach((r,n)=>r.components.conveyor.packages.forEach(item=>this.seen[n].add(item.product.object.uuid)));this.frames++;}d.present(1/30);},
    view(position,target){c.camera.position.fromArray(position);c.camera.lookAt(...target);c.camera.updateMatrixWorld(true);c.scene.updateMatrixWorld(true);c.renderer.render(c.scene,c.camera);}};
   return{robots:records.filter(r=>r.components.robot).length,belts:records.filter(r=>r.components.conveyor).length,monitors:d.monitors.entries.size,
    messages:d.interactions.contextual.length,doors:rows.filter(row=>a.document.getBehaviors(row.object).some(v=>v.type==='hingeDoor')).length};
  });assert.deepEqual(report.layout,{robots:1,belts:6,monitors:1,messages:6,doors:2});
  await b.call(()=>{__scenarioQA.tick(17);__scenarioQA.view([-7.4,4.5,7.8],[2,1,-2.8]);});await shot('installation-overview');
  await b.call(()=>__scenarioQA.view([-6.7,3,2.8],[-3.4,1,-1.8]));await shot('boxes-between-belts');
  report.flow=await b.call(async()=>{
   const q=__scenarioQA;while(q.d.operations.snapshot().palletized<8&&q.frames<150*30){q.tick(2);if(q.d.stats().robot.warning)throw Error(q.d.stats().robot.warning);await new Promise(resolve=>setTimeout(resolve,0));}
   const pallets=[...q.d.simulation.products.values()].filter(p=>p.sourceEntry?.load?.physicalAssembly),arrivals=pallets.flatMap(p=>p.sourceEntry.members.map(entry=>entry.product.object.uuid)).sort();
   return{arrivals,metrics:q.d.operations.snapshot(),seen:q.seen.map(set=>[...set].sort()),frames:q.frames,robot:q.d.stats().robot,frameError:q.a.getStats().frameError};
  });assert.equal(report.flow.arrivals.length,8);assert.equal(report.flow.metrics.pallets,2);assert.equal(report.flow.metrics.arrived,8);for(const seen of report.flow.seen)assert.deepEqual(seen,report.flow.arrivals);assert.equal(report.flow.frameError,null);
  report.digitalControls=await b.call(()=>{
   const q=__scenarioQA,s=q.d.simulation,entry=[...q.d.monitors.entries.values()][0],source=q.d.operations.refs().source,results=[];
   const click=key=>{const region=entry.regions.find(row=>row.key===key);if(!region)throw Error('Missing digital control: '+key);const point=entry.plane.localToWorld(new q.a.THREE.Vector3(((region.x+region.width/2)/1024-.5)*.98,(.5-(region.y+region.height/2)/576)*.98,0));q.view([-3.4,1.85,7.7],point.toArray());const ray=q.c.raycontrol;ray.execute(q.c,.016,s.time);const data=ray.controllers.find(row=>row.desktop),selected=ray.selectionEntries(data).some(row=>row.state===entry.state);ray.onSelectStart({target:q.c.desktopController});ray.onSelectEnd({target:q.c.desktopController});q.d.monitors.sync('hall',0,false);return selected;};
   if(!click('control')||entry.page!=='control')throw Error('The existing CONTROL tab is unavailable.');
   for(const action of ['stop','emergency','resetEmergency','start']){const selected=click(action);results.push({action,selected,handTouchable:entry.state.handTouchable,running:source.components.source.running,emergency:source.components.source.emergency});}
   click('diagram');return results;
  });assert(report.digitalControls.every(r=>r.selected&&r.handTouchable));assert(!report.digitalControls[0].running);assert(report.digitalControls[1].emergency);assert(!report.digitalControls[2].emergency&&!report.digitalControls[2].running);assert(report.digitalControls[3].running);
  await b.call(()=>__scenarioQA.view([-3.4,1.7,8],[-3.4,1.85,5.5]));await shot('native-suspended-monitor');
  await b.call(()=>__scenarioQA.view([-4.3,3.15,9.4],[-3.4,3.2,5.5]));await shot('monitor-ceiling-mount');
  report.doors=await b.call(()=>{
   const q=__scenarioQA,T=q.a.THREE;q.d.setPaused(true);
   const doors=Array.from(q.a.document.additions.values()).map(row=>row.object).filter(o=>q.a.document.getBehaviors(o).some(v=>v.type==='hingeDoor'));
   return doors.map(door=>{
    const x=door.position.x;q.view([x,1.65,8.2],door.getWorldPosition(new T.Vector3()).toArray());
    const ray=q.c.raycontrol;ray.execute(q.c,.016,q.d.simulation.time);
    const data=ray.controllers.find(row=>row.desktop),selected=ray.selectionEntries(data).some(entry=>entry.state.colliderMesh===door);
    ray.onSelectStart({target:q.c.desktopController});ray.onSelectEnd({target:q.c.desktopController});q.tick(1);
    const passage=!q.c.collisionWorld.rayBlocked(new T.Vector3(x,1.2,8.5),new T.Vector3(x,1.2,11.5));
    return{name:door.name,selected,open:door.userData.hingeDoorOpen,passage};
   });
  });assert(report.doors.every(door=>door.selected&&door.open&&door.passage));
  await b.call(()=>__scenarioQA.view([-4.5,1.9,6.8],[-6,1.4,10]));await shot('entrance-open');
  await b.call(()=>__scenarioQA.view([10.5,1.9,6.8],[12,1.4,10]));await shot('exit-open');
  report.message=await b.call(()=>{
   const q=__scenarioQA;q.view([-5.3,1.65,4],[-5.3,1.6,2.2]);q.tick(1.5);q.c.renderer.render(q.c.scene,q.c.camera);
   const runtime=q.d.interactions,active=runtime.contextualActive;
   return{title:active?.config.title,text:active?.config.text,opacity:active?.opacity,canvases:runtime.contextualStats.canvases,states:runtime.states.length};
  });assert.equal(report.message.title,'Llegada y recepción de cajas');assert(report.message.opacity>.9&&report.message.canvases<=2);await shot('interactive-station-message');
  report.restart=await b.call(()=>{
   const q=__scenarioQA;q.d.restart();return{states:q.d.interactions.states.length,messages:q.d.interactions.contextual.length,
    openDoors:Array.from(q.a.document.additions.values()).filter(row=>row.object.userData.hingeDoorOpen).length,errors:q.a.getStats().frameError};
  });assert.deepEqual(report.restart,{states:2,messages:6,openDoors:0,errors:null});
 });assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(fixture.errors,[]);report.passed=true;
 }catch(error){report.failure=error.stack||String(error);throw error;}
 finally{fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,report:path.join(OUT,'report.json')}));}
 return report;
}
module.exports={run};if(require.main===module)run(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
