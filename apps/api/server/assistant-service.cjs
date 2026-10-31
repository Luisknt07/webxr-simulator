'use strict';
const {ApiError}=require('./validation'),{configuration,createProviders}=require('./assistant-providers.cjs'),{createResearch}=require('./assistant-research.cjs'),{createAgentService}=require('./assistant-agent.cjs');
const text=(value,max=700)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\s+/g,' ').trim().slice(0,max):'';
const fail=(status,message,code)=>{throw new ApiError(status,message,code);};
function createAssistantService({studio,json,readBody,config,fetch:fetcher=globalThis.fetch,now=Date.now,contextData,voiceInstructions}={}){
 const settings=configuration(config),providers=createProviders({config,fetch:fetcher}),research=createResearch({config,fetch:fetcher}),agent=createAgentService({providers,research,now}),active=new Set(),rates=new Map();let closed=false;
 const status=()=>{const p=providers.status(),search=research.status().search;return {...p,configured:p.configured||search,agent:p.answer,search};};
 const admit=actor=>{if(active.size>=8||[...active].filter(row=>row.userId===actor.id).length>=2)fail(429,'Espera a que termine la consulta anterior.','assistant_busy');};
 function rate(actor,kind){const limit=kind==='speech'?36:kind==='ask'?16:kind==='agent'?36:10,key=actor.id+':'+kind,time=now();let row=rates.get(key);if(!row||row.until<=time)row={count:0,until:time+60000};if(++row.count>limit)fail(429,'Espera un momento antes de volver a consultar al asistente.','assistant_rate_limited');rates.set(key,row);if(rates.size>2048)for(const [id,value]of rates)if(value.until<=time)rates.delete(id);if(rates.size>4096)fail(429,'El asistente está ocupado.','assistant_busy');}
 async function handle(req,res,pathname){
  if(pathname!=='/assistant'&&!pathname.startsWith('/assistant/'))return false;const kind=pathname.slice('/assistant/'.length),actor=studio.user(req,false);if(actor)studio._expectedUser(req,actor);const available=status();
  if(kind==='status'&&req.method==='GET'){const authenticated=!!actor;json(res,200,{configured:available.configured,authenticated,answer:authenticated&&available.answer,agent:authenticated&&available.agent,search:authenticated&&available.search,speech:authenticated&&available.speech,transcription:authenticated&&available.transcription,providers:{brain:available.provider,voice:available.voiceProvider,transcription:available.transcriptionProvider,search:research.status().provider},reason:!available.configured?'not_configured':!authenticated?'sign_in':'ready',voice:authenticated&&available.speech?settings.ttsProvider==='elevenlabs'?'ElevenLabs':settings.voice:null});return true;}
  if(!['ask','agent','research','speech','transcribe'].includes(kind)||req.method!=='POST')fail(404,'Consulta del asistente no encontrada.','not_found');if(!actor)fail(401,'Inicia sesión para consultar la IA. La guía local sigue disponible.','authentication_required');
  const capable=kind==='ask'||kind==='agent'?available.answer:kind==='speech'?available.speech:kind==='transcribe'?available.transcription:available.search||available.answer;if(!capable||closed)fail(503,'Esta capacidad de IA no está configurada en el servidor. La guía local sigue disponible.','assistant_not_configured');
  rate(actor,kind);admit(actor);const body=await readBody(req,kind==='transcribe'?3*1024*1024:kind==='agent'?160*1024:16*1024,'La consulta del asistente supera el límite.');if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'La consulta debe ser un objeto JSON.','invalid_request');
  const guard=()=>{if(req.studioWriteGuard)req.studioWriteGuard();const current=studio.user(req);studio._expectedUser(req,current);if(current.id!==actor.id)fail(409,'La cuenta cambió durante la consulta.','session_changed');};guard();admit(actor);
  const controller=new AbortController(),entry={controller,userId:actor.id};active.add(entry);const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnect);const timer=setTimeout(()=>controller.abort(),18000);if(timer.unref)timer.unref();
  try{
   if(kind==='agent'||kind==='research'){const result=kind==='agent'?await agent.plan(body,{actor,signal:controller.signal}):await agent.consult(body,{actor,signal:controller.signal});guard();json(res,200,result);}
   else if(kind==='ask'){
    const query=text(body.query,1024);if(!query)fail(400,'Escribe o dicta una pregunta.','invalid_question');const context=contextData(body.snapshot),history=(Array.isArray(body.history)?body.history:[]).slice(-4).filter(row=>row&&['user','assistant'].includes(row.role)).map(row=>({role:row.role,content:text(row.text,700)}));
    const response=await providers.answer({messages:[...history,{role:'user',content:JSON.stringify({pregunta:query,contextoActual:context})}],instructions:voiceInstructions,tools:[],signal:controller.signal,maxTokens:320});guard();json(res,200,{text:text(response.text,700),source:'ai'});
   }else if(kind==='speech'){
    const input=text(body.text,700);if(!input)fail(400,'No hay texto para narrar.','invalid_speech');const result=await providers.synthesize({text:input,signal:controller.signal});guard();res.writeHead(200,{'Content-Type':result.contentType,'Content-Length':result.audio.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',Vary:'Cookie'});res.end(result.audio);
   }else{
    const mime=text(body.mimeType,100).split(';')[0].toLowerCase(),extension={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'mp4','audio/wav':'wav','audio/x-wav':'wav'}[mime],encoded=body.audio;
    if(!extension||typeof encoded!=='string'||!encoded.length||encoded.length>2800000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail(400,'La grabación no tiene un formato compatible.','invalid_audio');const bytes=Buffer.from(encoded,'base64');if(!bytes.length||bytes.length>2*1024*1024)fail(413,'La grabación es demasiado grande.','audio_too_large');const valid=mime==='audio/webm'?bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])):mime==='audio/ogg'?bytes.toString('ascii',0,4)==='OggS':mime==='audio/mp4'?bytes.toString('ascii',4,8)==='ftyp':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE';if(!valid)fail(400,'La grabación no coincide con su formato.','invalid_audio');const result=await providers.transcribe({audio:bytes,mimeType:mime,signal:controller.signal});guard();json(res,200,{text:text(result.text,1024)});
   }
   return true;
  }finally{clearTimeout(timer);res.removeListener('close',disconnect);active.delete(entry);}
 }
 return {handle,close(){closed=true;for(const entry of active)entry.controller.abort();rates.clear();agent.close();},status:()=>({configured:status().configured})};
}
module.exports={createAssistantService};
