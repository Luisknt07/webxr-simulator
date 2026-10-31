'use strict';
// Browser geometry of the source UI only. Uses about:blank and a disposable
// Chrome profile; no application account, user database or external page opens.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'../..'),{withBrowser}=require('./workspace-production.cjs');
const OUTPUT=path.join(ROOT,'data/qa-assistant-responsive');

async function run(){
 fs.mkdirSync(OUTPUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const moduleCode=fs.readFileSync(path.join(ROOT,'packages/assistant-ui/AssistantWorkspacePanel.js'),'utf8').replace(/^export default .*;\r?\n?/gm,'').replace(/^export /gm,'')+'\nreturn AssistantWorkspacePanel;';
 const css=fs.readFileSync(path.join(ROOT,'packages/assistant-ui/assistant-workspace.css'),'utf8');
 const report={startedAt:new Date().toISOString(),sourceUI:true,temporaryChromeProfile:true,noDatabase:true,exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[],viewports:[]};
 try{
  await withBrowser({certificate:fs.readFileSync(path.join(ROOT,'node_modules/webpack-dev-server/ssl/server.pem'))},report,async browser=>{
   const capture=async name=>{const result=await browser.send('Page.captureScreenshot',{format:'png'}),filename=path.join(OUTPUT,name+'.png');fs.writeFileSync(filename,Buffer.from(result.data,'base64'));report.screenshots.push(filename);};
   for(const [width,height,mobile]of [[1600,900,false],[390,844,true],[844,390,true],[667,375,true]]){
    await browser.send('Page.navigate',{url:'about:blank'});await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    await browser.call(({moduleCode,css})=>{
     document.open();document.write('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:linear-gradient(130deg,#526b6d,#a3b0a8);height:100dvh}.studio-header-actions{display:flex;justify-content:flex-end;gap:8px;padding:16px;background:#14222d}</style><style>'+css+'</style></head><body><div class="studio-header-actions"></div></body></html>');document.close();
     const Panel=new Function(moduleCode)(),listeners=new Set();let state={busy:false,phase:'idle',messages:[{role:'user',text:'Explícame el estado del almacén y muestra un gráfico.'},{role:'assistant',text:'Hay tres pallets disponibles. Consulta la ruta de la misión y compara las ubicaciones del gráfico.'}],tools:[{name:'get_context',status:'complete',message:'Estado consultado'},{name:'analyze_telemetry',status:'complete',message:'Comparación preparada'}],results:[{type:'source',id:'docs',title:'Documentación de simulación',url:'https://docs.example.com/guide',snippet:'Conceptos para comprender el proceso de almacenamiento.',content:'Un sistema de almacenamiento organiza ubicaciones, inventario y recorridos.',verified:true},{type:'chart',title:'Pallets por ubicación',chartType:'bar',sourceKind:'measured',unit:'pallets',points:[{label:'Entrada',value:1},{label:'Estantería',value:2},{label:'Salida',value:0}]}]};
     const agent={ask(query){state={...state,messages:[...state.messages,{role:'user',text:query}],busy:true,phase:'thinking'};for(const callback of listeners)callback(state);},stop(){state={...state,busy:false,phase:'cancelled'};for(const callback of listeners)callback(state);},subscribe(callback){listeners.add(callback);callback(state);return()=>listeners.delete(callback);}};
     window.__assistantResponsive=new Panel({document,context:{document,desktopLook:{unlock(){},reset(){}},input:{reset(){}}},agent});__assistantResponsive.mount();__assistantResponsive.open();
    },{moduleCode,css});
    const geometry=await browser.call(()=>{
     const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};},ui=__assistantResponsive,close=ui.closeButton.getBoundingClientRect(),send=ui.sendButton.getBoundingClientRect();
     return {panel:rect(ui.element),header:rect(ui.element.querySelector('.assistant-ui-header')),form:rect(ui.form),body:rect(ui.panes.conversation),closeReachable:ui.closeButton.contains(document.elementFromPoint(close.x+close.width/2,close.y+close.height/2)),sendReachable:ui.sendButton.contains(document.elementFromPoint(send.x+send.width/2,send.y+send.height/2)),scrollWidth:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight};
    });
    report.viewports.push({width,height,mobile,...geometry});assert(geometry.panel.x>=0&&geometry.panel.y>=0&&geometry.panel.right<=width+1&&geometry.panel.bottom<=height+1);assert(geometry.form.bottom<=geometry.panel.bottom+1,'The form must fit the panel '+width+'x'+height);assert(geometry.body.height>=30,'The result pane must remain usable');assert(geometry.closeReachable&&geometry.sendReachable,'Close and submit controls must be reachable');assert(geometry.scrollWidth<=width+1);await capture('conversation-'+width+'x'+height);
    await browser.call(()=>{__assistantResponsive.setTab('visuals');__assistantResponsive.setExpanded(true);});
    const expanded=await browser.call(()=>{const ui=__assistantResponsive,r=ui.element.getBoundingClientRect(),close=ui.closeButton.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,chartCount:ui.element.querySelectorAll('.assistant-ui-chart').length,closeReachable:ui.closeButton.contains(document.elementFromPoint(close.x+close.width/2,close.y+close.height/2))};});assert(expanded.x>=0&&expanded.y>=0&&expanded.right<=width+1&&expanded.bottom<=height+1&&expanded.closeReachable);assert.equal(expanded.chartCount,1);await capture('visuals-'+width+'x'+height);
    const cleared=await browser.call(()=>{const ui=__assistantResponsive,oldReaderButton=ui.sources.querySelector('button');ui.update({busy:false,phase:'idle',messages:[],results:[],tools:[]});oldReaderButton.click();return {readerHidden:ui.reader.hidden,frames:ui.frames.size,sourceCards:ui.sources.querySelectorAll('.assistant-ui-source').length};});assert(cleared.readerHidden&&cleared.frames===0&&cleared.sourceCards===0,'A cleared account context must invalidate old source controls.');
    await browser.call(()=>__assistantResponsive.dispose());assert.equal(await browser.evaluate('document.querySelectorAll("[data-assistant-workspace]").length'),0);
   }
  });
  assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedRequests,[]);assert.equal(report.responses.some(row=>/^https?:/.test(row.url)),false,'Sources and media must not load before a deliberate action.');report.passed=true;console.log(JSON.stringify({passed:true,viewports:report.viewports.length,noDatabase:true,noExternalRequests:true}));return report;
 }catch(error){report.passed=false;report.failure=error.stack||String(error);throw error;}
 finally{report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUTPUT,'report.json'),JSON.stringify(report,null,2));}
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
