'use strict';
// Selected generic publication + disposable HTTPS/Chrome. No user account,
// workspace database, saved industrial project or remote service is touched.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url'),{withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-modular/browser');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function run(){
  fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
  const {buildProject}=await import(pathToFileURL(path.join(ROOT,'tooling/build/project.mjs')).href);
  const build=buildProject({root:ROOT,projectPath:'projects/agricultura/project.json',name:'qa-modular'});
  const manifest=JSON.parse(fs.readFileSync(path.join(build.output,'publication.json'))),files=new Map();
  for(const file of manifest.files){const bytes=fs.readFileSync(path.join(build.output,file.path));assert.equal(hash(bytes),file.sha256);files.set('/'+file.path,bytes);}
  files.set('/',files.get('/index.html'));
  const certificate=fs.readFileSync(path.join(ROOT,'node_modules/webpack-dev-server/ssl/server.pem'));
  const server=https.createServer({key:certificate,cert:certificate},(req,res)=>{
    const name=new URL(req.url,'https://localhost').pathname,bytes=files.get(name);
    if(!bytes||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
    const type=name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8';
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const fixture={certificate,origin:'https://localhost:'+server.address().port};
  const report={startedAt:new Date().toISOString(),bundleSha256:build.bundleSha256,functions:build.functions,graph:build.graph,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};
  try{
    await withBrowser(fixture,report,async browser=>{
      await browser.send('Page.navigate',{url:fixture.origin+'/'});
      await browser.until(()=>browser.evaluate('Boolean(window.smartTwinProject && smartTwinProject.session && !smartTwinProject.session.status().busy && smartTwinProject.browser.stats().frames>1)'),'The selected project did not start.');
      const click=async(label)=>{
        await browser.call(label=>{const card=document.querySelector('[data-module-id="sector.agriculture"]'),button=[...card.querySelectorAll('button')].find(node=>node.textContent===label);if(!button||button.disabled)throw Error('Unavailable module button: '+label);button.click();},label);
        await browser.until(()=>browser.evaluate('!smartTwinProject.session.status().busy'),'Module operation did not settle.');
      };
      await browser.call(async()=>{
        const session=smartTwinProject.session;
        await session.dispatch('logistics.storage:transaction',{operations:[{type:'add-location',location:{id:'field',capacityKg:100,maxLoads:4}}]});
        await session.dispatch('agriculture.harvest:record',{id:'qa-harvest',crop:'mango',lot:'qa-lot',harvestDate:'2026-10-30',locationId:'field',quantity:8,massKg:12});
      });
      await click('Pausar');assert.equal(await browser.evaluate('smartTwinProject.session.status().core.functions.find(row=>row.id==="agriculture.harvest").status'),'paused');
      assert.equal(await browser.call(()=>document.querySelectorAll('#panels [data-function-id="agriculture.harvest"]').length),0);
      await click('Continuar');await click('Desactivar');assert.equal(await browser.evaluate('smartTwinProject.session.status().core.functions.length'),0);
      await click('Activar');assert.equal(await browser.call(async()=>(await smartTwinProject.session.dispatch('agriculture.harvest:harvests'))[0].quantity),8);
      await browser.call(()=>{const input=document.querySelector('[data-module-id="sector.agriculture"] input');input.checked=false;input.dispatchEvent(new Event('change'));});
      await browser.until(()=>browser.evaluate('!smartTwinProject.session.status().busy'),'Function disable did not finish.');assert.equal(await browser.evaluate('smartTwinProject.session.status().core.functions.length'),0);
      await browser.call(()=>{const input=document.querySelector('[data-module-id="sector.agriculture"] input');input.checked=true;input.dispatchEvent(new Event('change'));});
      await browser.until(()=>browser.evaluate('!smartTwinProject.session.status().busy'),'Function enable did not finish.');
      assert.equal(await browser.call(async()=>(await smartTwinProject.session.dispatch('agriculture.harvest:harvests'))[0].quantity),8);
      await click('Quitar del proyecto');await click('Añadir');
      assert.equal(await browser.call(async()=>(await smartTwinProject.session.dispatch('agriculture.harvest:harvests'))[0].quantity),8);
      const snapshot=await browser.evaluate('smartTwinProject.session.capture()');
      const upload=async data=>browser.call(data=>{const input=document.querySelector('.project-transfer input'),transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(data)],'project.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change'));},data);
      const other={...snapshot.project,id:'project.qa-other',worldId:'world.qa-other',title:'Segundo proyecto modular'};await upload(other);
      await browser.until(()=>browser.evaluate('smartTwinProject.session.status().worldId==="world.qa-other" && !smartTwinProject.session.status().busy'),'Project file did not open.');
      assert.deepEqual(await browser.call(async()=>smartTwinProject.session.dispatch('agriculture.harvest:harvests')),[]);
      await upload({format:'smarttwin.project-session',version:1,...snapshot});
      await browser.until(()=>browser.call(world=>smartTwinProject.session.status().worldId===world&&!smartTwinProject.session.status().busy,snapshot.project.worldId),'Saved project session did not restore.');
      assert.equal(await browser.call(async()=>(await smartTwinProject.session.dispatch('agriculture.harvest:harvests'))[0].quantity),8);
      const frame=await browser.evaluate('({stats:smartTwinProject.getStats(),glError:smartTwinProject.context.renderer.getContext().getError(),managerCards:document.querySelectorAll(".module-card").length})');
      assert.equal(frame.glError,0);assert(frame.stats.render.triangles>0);assert.equal(frame.stats.frames,frame.stats.primaryRenders);assert.equal(frame.managerCards,2);
      const shot=await browser.send('Page.captureScreenshot',{format:'png'});const filename=path.join(OUT,'desktop.png');fs.writeFileSync(filename,Buffer.from(shot.data,'base64'));report.screenshots.push(filename);
      await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
      const mobile=await browser.send('Page.captureScreenshot',{format:'png'});const mobileFile=path.join(OUT,'mobile.png');fs.writeFileSync(mobileFile,Buffer.from(mobile.data,'base64'));report.screenshots.push(mobileFile);
      report.browser={pauseResume:true,disableEnable:true,functionToggle:true,removeAdd:true,projectSwitch:true,snapshotRestore:true,sharedInventoryPreserved:true,mobileNoHorizontalOverflow:true,render:frame.stats.render,glError:frame.glError};
      await browser.evaluate('smartTwinProject.dispose()');assert.equal(await browser.evaluate('smartTwinProject.browser.stats().disposed'),true);
    });
    assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);
    assert.equal(report.responses.some(row=>row.status>=400),false);report.passed=true;
    console.log(JSON.stringify({passed:true,bundleSha256:report.bundleSha256,functions:report.functions,...report.browser}));return report;
  }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
  finally{report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await new Promise(resolve=>server.close(resolve));}
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
