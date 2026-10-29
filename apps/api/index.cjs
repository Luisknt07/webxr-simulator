'use strict';
// Production entry: private API and immutable build artifacts, never a repo
// directory or a development compiler. Importing this module opens no socket.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https'),net=require('node:net');
const {createHash,randomBytes}=require('node:crypto');
const {createApiHandler}=require("./server/api.js");
const {ApiError}=require("./server/validation.js");
const ROOT=path.resolve(__dirname,'../..'),PUBLIC_SCENE='vr-robot-dispatch';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const ip=value=>String(value||'').replace(/^::ffff:/,'');
const loopback=value=>['127.0.0.1','::1','localhost'].includes(value);
function relativePath(value){return typeof value==='string'&&value.length>0&&!value.startsWith('/')&&!value.includes(':')&&!value.includes('\\')&&!value.includes('%')&&!value.includes('\0')&&!value.split('/').some(part=>!part||part==='.'||part==='..');}
function artifact(directory,publicProfile){
 const root=fs.realpathSync(directory),manifest=JSON.parse(fs.readFileSync(path.join(root,'publication.json'),'utf8'));
 if(!Array.isArray(manifest.files)||!manifest.files.length)throw Error('El artefacto requiere un manifiesto de archivos verificado.');
 if(publicProfile&&JSON.stringify(manifest.scenes)!==JSON.stringify([PUBLIC_SCENE]))throw Error('El artefacto público debe contener únicamente vr-robot-dispatch.');
 const files=new Map();
 for(const entry of manifest.files){if(!entry||!relativePath(entry.path)||!/^([a-f0-9]{64})$/.test(entry.sha256)||files.has(entry.path))throw Error('El manifiesto de archivos no es válido.');files.set(entry.path,entry.sha256);}
 if(!files.has('index.html'))throw Error('Falta index.html en el manifiesto.');
 return {root,manifest,files,verified:new Map(),publicProfile};
}
function realFile(build,relative){
 if(!build.files.has(relative))return null;
 let target=build.root;
 for(const part of relative.split('/')){target=path.join(target,part);const stat=fs.lstatSync(target);if(stat.isSymbolicLink())throw Error('No se sirven enlaces en un artefacto.');}
 const absolute=fs.realpathSync(target);if(!absolute.startsWith(build.root+path.sep))throw Error('Archivo fuera del artefacto.');
 const stat=fs.statSync(absolute);if(!stat.isFile())throw Error('Recurso de artefacto inválido.');
 const stamp=stat.size+':'+stat.mtimeMs;
 if(build.verified.get(relative)!==stamp){if(digest(fs.readFileSync(absolute))!==build.files.get(relative))throw Error('El artefacto no coincide con su manifiesto.');build.verified.set(relative,stamp);}
 return {absolute,size:stat.size,sha256:build.files.get(relative)};
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function nextPath(raw){try{if(typeof raw!=='string'||!raw.startsWith('/')||raw.startsWith('//'))return '/workspace';const url=new URL(raw,'http://local.invalid');return ['/workspace','/workspace/','/editor'].includes(url.pathname)?url.pathname+url.search:'/workspace';}catch(_){return '/workspace';}}
function login(res,next){
 const nonce=randomBytes(18).toString('base64'),destination=JSON.stringify(nextPath(next)).replace(/</g,'\\u003c');
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
 res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceder a SmartTwin</title><style nonce="'+nonce+'">body{font:16px system-ui;background:#10212b;color:#e7f4f4;margin:0;display:grid;min-height:100vh;place-items:center}main{width:min(90vw,360px)}label,input,button{display:block;width:100%;box-sizing:border-box}input,button{font:inherit;padding:.8em;margin:.4em 0 1.2em;border-radius:8px;border:1px solid #699}button{background:#83dfc3;cursor:pointer}a{color:#83dfc3}#message{min-height:2em}</style><main><h1>Acceder a SmartTwin</h1><form id="login"><label>Usuario<input name="username" autocomplete="username" required maxlength="48"></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button>Iniciar sesión</button><p id="message" role="alert"></p></form><a href="/">Ver escenario público</a></main><script nonce="'+nonce+'">document.getElementById("login").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector("button"),message=document.getElementById("message");button.disabled=true;message.textContent="";try{const response=await fetch("/api/studio/login",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:form.elements.username.value,password:form.elements.password.value})});const value=await response.json();if(!response.ok)throw Error(value.error||"No se pudo iniciar sesión.");form.elements.password.value="";location.assign('+destination+');}catch(error){message.textContent=error.message;}finally{button.disabled=false;}});</script></html>');
}
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.wasm':'application/wasm','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.ogg':'audio/ogg','.mp3':'audio/mpeg','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
function createApplication(options={}){
 const host=options.host||'127.0.0.1',trusted=new Set((options.trustedProxyAddresses||[]).map(ip)),allowLocal=options.allowInsecureLocal===true;
 if([...trusted].some(value=>!net.isIP(value)))throw Error('Los proxies confiables deben declararse mediante direcciones IP exactas.');
 if(allowLocal&&!loopback(host))throw Error('HTTP sin TLS sólo se permite con escucha local explícita.');
 if(!options.tls&&!trusted.size&&!allowLocal)throw Error('Configura TLS o un proxy HTTPS confiable; para desarrollo local usa allowInsecureLocal explícito.');
 const publicBuild=artifact(options.publicDir||path.join(ROOT,'artifacts/public-viewer'),true),workspaceBuild=artifact(options.workspaceDir||path.join(ROOT,'artifacts/workspace'),false);
 const api=createApiHandler({dataDir:options.dataDir||path.join(ROOT,'data'),allowBootstrapRegistration:false,requireSecureCookies:!allowLocal,publicSceneId:PUBLIC_SCENE,
   exampleCatalogPath:options.exampleCatalogPath||path.join(ROOT,'projects/smarttwin/scenes/catalog.json'),projectionsDir:options.projectionsDir||path.join(ROOT,'projects/smarttwin/scenes'),maintenanceIntervalMs:options.maintenanceIntervalMs,onError:options.onError});
 const handler=async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Content-Security-Policy',"frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
  const trustedPeer=trusted.has(ip(req.socket.remoteAddress)),forwardedAddress=req.headers['x-forwarded-for'];
  req.studioSecure=!!req.socket.encrypted||(trustedPeer&&req.headers['x-forwarded-proto']==='https');
  // A configured proxy must overwrite, rather than append, this header. An
  // untrusted peer or an ambiguous chain never supplies the rate-limit key.
  req.studioClientAddress=trustedPeer&&typeof forwardedAddress==='string'&&net.isIP(forwardedAddress)?ip(forwardedAddress):ip(req.socket.remoteAddress);
  if(req.studioSecure)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try{
   const url=new URL(req.url,'http://local.invalid');let pathname;try{pathname=decodeURIComponent(url.pathname);}catch(_){return json(res,400,{error:'Ruta inválida.'});}
   if(pathname.includes('\\')||pathname.includes('\0')||pathname.includes('%')||pathname.split('/').some(part=>part==='.'||part==='..'))return json(res,400,{error:'Ruta inválida.'});
   if(pathname==='/api'||pathname.startsWith('/api/')){if(!allowLocal&&!req.studioSecure)return json(res,426,{error:'La API requiere HTTPS.',code:'https_required'});return api(req,res);}
   if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Método no permitido.'});
   if(pathname==='/login'){if(!allowLocal&&!req.studioSecure)return json(res,426,{error:'El acceso requiere HTTPS.'});if(req.method==='HEAD'){res.writeHead(200,{'Cache-Control':'no-store'});return res.end();}return login(res,url.searchParams.get('next'));}
   const privateRoute=pathname==='/editor'||pathname==='/editor/'||pathname==='/workspace'||pathname.startsWith('/workspace/');
   if(privateRoute){if(!allowLocal&&!req.studioSecure)return json(res,426,{error:'El espacio privado requiere HTTPS.'});const user=api.studio.user(req,false);if(!user){if(pathname==='/editor'||pathname==='/editor/'||pathname==='/workspace'||pathname==='/workspace/'){res.writeHead(302,{'Location':'/login?next='+encodeURIComponent('/editor'+url.search),'Cache-Control':'no-store'});return res.end();}return json(res,401,{error:'Inicia sesión.',code:'authentication_required'});}api.studio._expectedUser(req,user);}
   if(pathname==='/workspace'||pathname==='/workspace/'||pathname==='/editor/'){res.writeHead(302,{'Location':'/editor'+url.search,'Cache-Control':'no-store'});return res.end();}
   const build=privateRoute?workspaceBuild:publicBuild,relative=privateRoute?(pathname==='/editor'?'index.html':pathname.slice('/workspace/'.length)):(pathname==='/'?'index.html':pathname.slice(1));
   if(!relativePath(relative))return json(res,404,{error:'Recurso no disponible.'});
   if(relative==='publication.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(req.method==='HEAD'?undefined:JSON.stringify(build.manifest));}
   const file=realFile(build,relative);if(!file)return json(res,404,{error:'Recurso no disponible.'});
   res.writeHead(200,{'Content-Type':TYPES[path.extname(relative).toLowerCase()]||'application/octet-stream','Content-Length':file.size,'Cache-Control':privateRoute?'private, no-store':'public, max-age=0, must-revalidate','ETag':'"'+file.sha256+'"',...(privateRoute?{Vary:'Cookie'}:{})});
   if(req.method==='HEAD')return res.end();const stream=fs.createReadStream(file.absolute);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch(error){if(!(error instanceof ApiError)&&options.onError)options.onError(error);if(!res.headersSent)json(res,error instanceof ApiError?error.status:500,{error:error instanceof ApiError?error.message:'No se pudo completar la solicitud.',code:error instanceof ApiError?error.code:'server_error'});else res.destroy();}
 };
 const server=options.tls?https.createServer(options.tls,handler):http.createServer(handler);server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
 return {server,api,host,close:async()=>{if(server.listening)await new Promise(resolve=>server.close(resolve));api.close();}};
}
async function main(){
 const env=process.env,port=Number(env.SMARTTWIN_API_PORT||8081);if(!Number.isInteger(port)||port<1||port>65535)throw Error('SMARTTWIN_API_PORT no es válido.');
 if(!!env.SMARTTWIN_TLS_KEY!==!!env.SMARTTWIN_TLS_CERT)throw Error('Configura la clave y el certificado TLS juntos.');
 const app=createApplication({host:env.SMARTTWIN_API_HOST||'127.0.0.1',dataDir:env.SMARTTWIN_DATA_DIR,publicDir:env.SMARTTWIN_PUBLIC_DIR,workspaceDir:env.SMARTTWIN_WORKSPACE_DIR,
  trustedProxyAddresses:(env.SMARTTWIN_TRUSTED_PROXY_ADDRESSES||'').split(',').map(value=>value.trim()).filter(Boolean),allowInsecureLocal:env.SMARTTWIN_ALLOW_INSECURE_LOCAL==='true',
  tls:env.SMARTTWIN_TLS_KEY?{key:fs.readFileSync(env.SMARTTWIN_TLS_KEY),cert:fs.readFileSync(env.SMARTTWIN_TLS_CERT)}:null});
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,app.host,resolve);});console.log('SmartTwin API disponible en el puerto '+port+'.');
 const stop=()=>app.close().then(()=>{process.exitCode=0;});process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
module.exports={createApplication,artifact,nextPath,main};if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
