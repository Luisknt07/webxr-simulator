'use strict';
// Actual public artifacts and static home only; no scene or personal data.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const {startFixture,withBrowser,request}=require('./workspace-production.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'data/qa-studio/public-welcome-layout'),hash=b=>createHash('sha256').update(b).digest('hex');
async function run({baseline=false}={}){
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(path.join(ROOT,'data/qa-studio/workspace-production'),{recursive:true});
 const report={baseline,publicSha256:hash(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/viewer.js'))),cssSha256:hash(fs.readFileSync(path.join(ROOT,'artifacts/public-viewer/welcome.css'))),layouts:[],exceptions:[],consoleErrors:[],failedRequests:[],responses:[],screenshots:[]};
 const f=await startFixture('Disposable-home-'+randomBytes(16).toString('hex'),{voice:{enabled:false,key:''}});f.renderBackend='d3d11';
 // Serve the exact public-only file allowlist under the GitHub Pages base path
 // as well as the real API home; their account-link labels have different widths.
 const directory=path.join(ROOT,'artifacts/public-viewer'),manifest=JSON.parse(fs.readFileSync(path.join(directory,'publication.json'))),files=new Map(manifest.files.map(row=>[row.path,fs.readFileSync(path.join(directory,row.path))]));
 const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'};
 const staticServer=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,prefix='/webxr-simulator/';if(!pathname.startsWith(prefix)){res.writeHead(404);return res.end();}const name=pathname.slice(prefix.length)||'index.html',bytes=files.get(name);if(!bytes){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':mime[path.extname(name)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);});
 await new Promise(resolve=>staticServer.listen(0,'127.0.0.1',resolve));
 try{assert.equal((await request(f.origin,'/welcome.css')).sha256,report.cssSha256);
 for(const [mode,url]of [['server',f.origin+'/'],...baseline?[]:[['static','http://127.0.0.1:'+staticServer.address().port+'/webxr-simulator/']]])await withBrowser(f,report,async b=>{
  await b.send('Page.navigate',{url});await b.until(()=>b.evaluate('!!window.smartTwinGallery'),'Home unavailable.');
  for(const [width,height]of [[2560,1380],[1920,1080],[1440,900],[1366,768],[1280,720],[1024,768],[768,1024],[650,900],[390,844],[360,640],[320,568],[844,390]]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await b.evaluate('scrollTo(0,0)');
   const layout=await b.call(()=>{
    const selectors=['.viewer-header','.viewer-brand','#workspace-link','.welcome-content','.welcome-panel','.welcome-intro','.welcome-start','#welcome-title','.welcome-entry-options','#explore-demo','#explore-scenes','#editor-access','.welcome-domains','.welcome-guide','.welcome-steps'];
    const rows=selectors.map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return{selector,x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth};});
    const clipped=[...document.querySelectorAll('#welcome h1,#welcome p,#welcome button,#welcome a,#welcome .welcome-entry-copy,#welcome .welcome-entry-badge,.viewer-header a')].map(e=>{const r=e.getBoundingClientRect();return{selector:e.id||e.className,x:r.x,right:r.right,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth};}).filter(r=>r.right>innerWidth+1||r.x<-1||r.scrollWidth>r.clientWidth+1);
    const brand=document.querySelector('.viewer-brand').getBoundingClientRect(),access=document.querySelector('#workspace-link').getBoundingClientRect(),header=document.querySelector('.viewer-header').getBoundingClientRect(),hero=document.querySelector('.welcome-content').getBoundingClientRect();
    return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,rows,clipped,headerOverlap:brand.right>access.left-6,heroTop:hero.top,headerBottom:header.bottom,canvases:document.querySelectorAll('#viewer canvas').length};
   });layout.mode=mode;report.layouts.push(layout);
   if([2560,1920,1440,1366,390,320,844].includes(width)){const file=path.join(OUT,(baseline?'before-':mode==='static'?'static-':'home-')+width+'.png'),png=await b.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(file,Buffer.from(png.data,'base64'));report.screenshots.push(file);}
   if(!baseline){assert(layout.scrollWidth<=width+1,'Horizontal page overflow '+width);assert.deepEqual(layout.clipped,[],'Clipped home content '+width);assert(!layout.headerOverlap,'Header actions overlap the brand '+width);assert.equal(layout.canvases,0);assert(layout.heroTop>=layout.headerBottom-1,'The home content must start below the header.');if(width>=1000&&height>=700)assert(layout.scrollHeight<=height+1,'The desktop home must fit vertically '+width);
    if(width>=1000){const intro=layout.rows.find(r=>r.selector==='.welcome-intro'),entries=layout.rows.find(r=>r.selector==='.welcome-entry-options');assert(entries.y>=intro.bottom-1,'Entry cards must remain below the introduction.');assert(Math.abs(entries.x-intro.x)<1,'Entry cards must align with the original left column.');assert(entries.right<=width*.68,'Entry cards must leave the right side of the cover photograph clear.');}
    await b.evaluate('scrollTo(0,document.documentElement.scrollHeight)');const bottom=await b.call(()=>{const r=document.querySelector('.welcome-guide').getBoundingClientRect();return{bottom:r.bottom,top:r.top};});assert(bottom.bottom<=height+1&&bottom.top>=-1,'The whole guide must remain reachable '+width);
   }
  }
 });assert.deepEqual(report.exceptions,[]);assert.deepEqual(report.consoleErrors,[]);report.passed=true;return report;
 }catch(error){report.failure=error.stack;throw error;}finally{fs.writeFileSync(path.join(OUT,baseline?'baseline.json':'report.json'),JSON.stringify(report,null,2));await new Promise(resolve=>staticServer.close(resolve));await f.close();console.log(JSON.stringify({passed:!!report.passed,layouts:report.layouts.length,report:path.join(OUT,baseline?'baseline.json':'report.json')}));}
}
if(require.main===module)run({baseline:process.argv.includes('--baseline')}).catch(e=>{console.error(e);process.exitCode=1;});module.exports={run};
