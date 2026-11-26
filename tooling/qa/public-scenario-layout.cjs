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
  report.layout=await b.call(()=>{
   const a=smartTwinViewer,c=a.context,d=c.demo,records=Array.from(d.simulation.records.values()),rows=Array.from(a.document.additions.values());c.renderer.setAnimationLoop(null);
   const belts=records.filter(r=>r.components.conveyor&&/^DEMOSTRACIÓN/.test(r.object.name));
   const receiver=records.find(r=>/recepción de ocho cajas/.test(r.object.name));
   window.__scenarioQA={a,c,d,belts,receiver,seen:belts.map(()=>new Set()),frames:0,
    tick(seconds){for(let i=0;i<seconds*60;i++){c.scene.updateMatrixWorld(true);d.step(1/60);belts.forEach((r,n)=>r.components.conveyor.packages.forEach(item=>this.seen[n].add(item.product.object.uuid)));this.frames++;}},
    view(position,target){c.camera.position.fromArray(position);c.camera.lookAt(...target);c.camera.updateMatrixWorld(true);c.scene.updateMatrixWorld(true);c.renderer.render(c.scene,c.camera);}};
   return{robots:records.filter(r=>r.components.robot).length,belts:records.filter(r=>r.components.conveyor).length,monitors:d.monitors.entries.size,
    messages:d.interactions.contextual.length,doors:rows.filter(row=>a.document.getBehaviors(row.object).some(v=>v.type==='hingeDoor')).length};
  });assert.deepEqual(report.layout,{robots:1,belts:6,monitors:0,messages:6,doors:2});
  await b.call(()=>{__scenarioQA.tick(17);__scenarioQA.view([-7.4,4.5,7.8],[2,1,-2.8]);});await shot('installation-overview');
  await b.call(()=>__scenarioQA.view([-5.5,2.5,-1.7],[-3,1,-6]));await shot('boxes-between-belts');
  report.flow=await b.call(async()=>{
   const q=__scenarioQA;while(q.receiver.components.palletQueue.queue.length<8&&q.frames<90*60){q.tick(2);await new Promise(resolve=>setTimeout(resolve,0));}
   const arrivals=q.receiver.components.palletQueue.queue.map(entry=>entry.product.object.uuid).sort();
   return{arrivals,seen:q.seen.map(set=>[...set].sort()),frames:q.frames,robot:q.d.stats().robot,frameError:q.a.getStats().frameError};
  });assert.equal(report.flow.arrivals.length,8);for(const seen of report.flow.seen)assert.deepEqual(seen,report.flow.arrivals);assert.equal(report.flow.frameError,null);
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
   const q=__scenarioQA;q.view([-4.7,1.65,-1.5],[-4.7,1.6,-3.1]);q.tick(1.5);q.c.renderer.render(q.c.scene,q.c.camera);
   const runtime=q.d.interactions,active=runtime.contextualActive;
   return{title:active?.config.title,text:active?.config.text,opacity:active?.opacity,canvases:runtime.contextualStats.canvases,states:runtime.states.length};
  });assert.equal(report.message.title,'Cajas de banda en banda');assert(report.message.opacity>.9&&report.message.canvases<=2);await shot('interactive-station-message');
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
