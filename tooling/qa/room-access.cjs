'use strict';
// Real public entry -> authentication -> native room panel; disposable data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/room-access');
async function run(){
 fs.mkdirSync(OUT,{recursive:true});const password='Disposable-room-access-'+randomBytes(12).toString('hex'),fixture=await startFixture(password,{voice:{enabled:false,key:''}});
 fixture.renderBackend='d3d11';const report={exceptions:[],consoleErrors:[],responses:[],failedRequests:[],screenshots:[],publicHash:createHash('sha256').update(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))).digest('hex')};
 try{
  await withBrowser(fixture,report,async b=>{
   const shot=async name=>{const data=await b.send('Page.captureScreenshot',{format:'png'}),file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(data.data,'base64'));report.screenshots.push(file);};
   await b.send('Page.navigate',{url:fixture.origin+'/'});
   await b.until(()=>b.evaluate('!!document.querySelector("#explore-demo")'),'Public entry unavailable.');await b.call(()=>document.querySelector('#explore-demo').click());
   await b.until(()=>b.evaluate('!!window.smartTwinViewer?.context?.demo&&!document.body.classList.contains("welcome-open")'),'Public demo unavailable.',90000);
   report.desktop=await b.call(()=>{const header=document.querySelector('#rooms-access'),side=document.querySelector('[data-tour-tool=rooms]'),r=header.getBoundingClientRect();return{header:header.textContent,side:side.textContent,visible:r.width>0&&r.height>0,right:r.right,width:innerWidth};});
   assert(report.desktop.header.includes('Sala grupal')&&report.desktop.side==='Sala grupal'&&report.desktop.visible&&report.desktop.right<=report.desktop.width);await shot('desktop-room-shortcut');
   await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
   report.mobile=await b.call(()=>{document.body.classList.add('driving');const r=document.querySelector('#rooms-access').getBoundingClientRect();return{visible:r.width>0&&r.height>0,left:r.left,right:r.right,width:innerWidth};});assert(report.mobile.visible&&report.mobile.left>=0&&report.mobile.right<=report.mobile.width);await shot('mobile-room-shortcut');
   await b.call(()=>document.body.classList.remove('driving'));await b.send('Emulation.clearDeviceMetricsOverride');
   await b.call(()=>document.querySelector('#viewer-menu-toggle').click());await b.until(()=>b.evaluate('document.querySelector("#viewer-menu").open'),'Public menu unavailable.');
   assert(await b.evaluate('document.querySelector("#menu-rooms").textContent.includes("Crear o unirse")'));await shot('public-menu-room-entry');await b.call(()=>document.querySelector('#menu-rooms').click());
   await b.until(()=>b.evaluate('location.pathname==="/login"&&!!document.querySelector("#login")'),'Room entry did not request authentication.');
   report.login=await b.call(()=>({next:new URL(location.href).searchParams.get('next')}));assert.equal(report.login.next,'/play?scene=vr-robot-dispatch&panel=rooms');
   await b.call(password=>{const f=document.querySelector('#login');f.elements.username.value='qa_production_owner';f.elements.password.value=password;f.requestSubmit();},password);
   await b.until(()=>b.evaluate('!!window.context?.studio&&!context.editor.initializing&&!context.editor.loadingProject'),'Authenticated scene unavailable.',90000);await b.evaluate('context.studio.ready');
   report.panel=await b.call(()=>({page:context.studio.page,visible:!context.studio.drawer.hidden,text:context.studio.drawer.textContent}));assert.equal(report.panel.page,'rooms');assert(report.panel.visible&&report.panel.text.includes('Crear sala con este escenario')&&report.panel.text.includes('Código de invitación')&&report.panel.text.includes('Unirse'));await shot('native-create-or-join');
   await b.call(()=>{context.studio.close();context.studio.roomsButton.click();});assert(await b.evaluate('context.studio.page==="rooms"&&!context.studio.drawer.hidden'));
  });
  assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(fixture.errors,[]);report.passed=true;
 }catch(error){report.failure=error.stack;throw error;}finally{
  for(const row of report.responses)if(row.url.startsWith('data:'))row.url='data:local-generated-image';
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await fixture.close();console.log(JSON.stringify({passed:!!report.passed,path:OUT}));
 }
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
