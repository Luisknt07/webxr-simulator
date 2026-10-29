'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const ROOT=path.resolve(__dirname,'../../..'),OUTPUT=path.join(ROOT,'data/qa-studio');
const {staticServer}=require('../../public-viewer/tests/browser.cjs'),{withBrowser}=require(path.join(ROOT,'tooling/qa/qa-public-publication-browser.js'));
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
async function command(b,owner,action,payload){
 await b.call((owner,action,payload)=>{const panel=[...document.querySelectorAll('[data-function-id]')].find(value=>value.dataset.functionId===owner),output=panel.querySelector('pre');panel.querySelector('textarea').value=JSON.stringify(payload,null,2);output.textContent='';delete output.dataset.state;[...panel.querySelectorAll('button')].find(value=>value.dataset.command===owner+':'+action).click();},owner,action,payload);
 await b.until(()=>b.call(owner=>!![...document.querySelectorAll('[data-function-id]')].find(value=>value.dataset.functionId===owner).querySelector('pre').dataset.state,owner),'The module command did not settle.');
 const result=await b.call(owner=>{const p=[...document.querySelectorAll('[data-function-id]')].find(value=>value.dataset.functionId===owner).querySelector('pre');return {state:p.dataset.state,text:p.textContent};},owner);
 assert.equal(result.state,'success',result.text);return JSON.parse(result.text);
}
async function run(){
 const kind=arg('--case');assert(['agricultura','turismo'].includes(kind));
 const proof=JSON.parse(fs.readFileSync(path.join(ROOT,'data/qa-modular/project-build-'+kind+'.json'))),artifact=arg('--artifact')||proof.output,expected=arg('--expected-bundle-sha256')||proof.bundleSha256;
 assert.equal(createHash('sha256').update(fs.readFileSync(path.join(artifact,'project.js'))).digest('hex'),expected);
 fs.mkdirSync(OUTPUT,{recursive:true});const fixture=await staticServer(artifact),report={case:kind,bundle:expected,artifact,physicalHeadsetTested:false};
 try{await withBrowser(fixture.origin,async b=>{
  await b.send('Page.navigate',{url:fixture.origin+'/webxr-simulator/'});
  await b.until(async()=>{if(b.report.exceptions.length)throw Error(b.report.exceptions[0]);return b.evaluate('!!window.smartTwinProject&&smartTwinProject.getStats().frames>2');},'The project app did not initialize.');
  report.networkHash=await b.call(async()=>{const bytes=await fetch('project.js').then(r=>r.arrayBuffer());return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');});assert.equal(report.networkHash,expected);
  report.initial=await b.evaluate('smartTwinProject.getStats()');const ids=report.initial.core.functions.map(f=>f.id).sort();assert.deepEqual(ids,kind==='agricultura'?['agriculture.harvest','logistics.storage']:['tourism.routes']);
  if(kind==='agricultura'){
   await command(b,'logistics.storage','transaction',{operations:[{type:'add-location',location:{id:'field',capacityKg:100,maxLoads:5}}]});
   await command(b,'agriculture.harvest','record',{id:'browser-lot',crop:'<img src=x onerror=window.__projectXSS=1>',lot:'A',harvestDate:'2026-10-29',locationId:'field',quantity:12,massKg:20});
   report.result=await command(b,'logistics.storage','snapshot',null);assert.equal(report.result.loads.length,1);assert.equal(report.result.loads[0].quantity,12);assert.equal(report.result.loads[0].massKg,20);assert.equal(report.result.loads[0].metadata.sector,'agriculture');
   assert(await b.evaluate('!window.__projectXSS&&document.querySelectorAll("img").length===0'));
  }else{
   const route=await b.evaluate('smartTwinProject.project.entities[0].components[0].data');await command(b,'tourism.routes','configure',route);
   await command(b,'tourism.routes','visit',{routeId:route.id,visitorId:'browser-guest',position:route.points[0].position});
   await command(b,'tourism.routes','visit',{routeId:route.id,visitorId:'browser-guest',position:route.points[1].position});
   report.result=await command(b,'tourism.routes','progress',{routeId:route.id,visitorId:'browser-guest'});assert(report.result.completed);assert.equal(report.result.visited,2);
  }
  await b.screenshot('project-viewer-'+kind+'-desktop');await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  await b.until(()=>b.evaluate('innerWidth===390'),'Mobile viewport did not apply.');await b.screenshot('project-viewer-'+kind+'-mobile');
  report.final=await b.evaluate('smartTwinProject.getStats()');assert.equal(report.final.frames,report.final.primaryRenders);assert.equal(await b.evaluate('smartTwinProject.context.renderer.getContext().getError()'),0);
  report.resources=await b.evaluate('performance.getEntriesByType("resource").map(v=>v.name)');assert(report.resources.every(url=>new URL(url).origin===fixture.origin));assert(!fixture.requests.some(r=>/api\/|modules\/|workspace\/|\.json$/.test(r.path)));
  await b.evaluate('smartTwinProject.dispose()');assert.equal(await b.evaluate('document.querySelectorAll("canvas,.xr-browser-touch").length'),0);
  assert.deepEqual(b.report.exceptions,[]);assert.deepEqual(b.report.consoleErrors,[]);assert.deepEqual(b.report.apiFailures,[]);assert.deepEqual(b.report.writes,[]);report.session=b.report;
 });report.passed=true;}catch(error){report.failure=error.stack;throw error;}finally{report.requests=fixture.requests;fs.writeFileSync(path.join(OUTPUT,'project-viewer-'+kind+'-browser.json'),JSON.stringify(report,null,2));await fixture.close();}
 console.log(JSON.stringify({passed:true,case:kind,bundle:expected,report:path.join(OUTPUT,'project-viewer-'+kind+'-browser.json')}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
