'use strict';
// Server-only adapters. Hosts are fixed; neither a project nor a model can
// supply an upstream URL, key, executable callback or provider credential.
const {ApiError}=require('./validation');
const clean=(value,max=8000)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max):'';
const fail=(status,message,code)=>{throw new ApiError(status,message,code);};
const validModel=(value,fallback)=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(value)?value:fallback;
const oneOf=(value,values,fallback)=>values.includes(value)?value:fallback;
const own=(value,key,fallback)=>value[key]===undefined?fallback:value[key];
const OPENAI_VOICES=['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse','marin','cedar'];

function configuration(value={},env=process.env){
 const enabled=own(value,'enabled',env.SMARTTWIN_VOICE_AI_ENABLED==='true')===true;
 const aiProvider=oneOf(value.aiProvider||value.provider||env.SMARTTWIN_AI_PROVIDER,['openai','deepseek'],'openai');
 const ttsProvider=oneOf(value.ttsProvider||env.SMARTTWIN_TTS_PROVIDER||env.SMARTTWIN_VOICE_TTS_PROVIDER,['openai','elevenlabs','browser'],'openai');
 const sttProvider=oneOf(value.sttProvider||env.SMARTTWIN_STT_PROVIDER||env.SMARTTWIN_VOICE_STT_PROVIDER,['openai','elevenlabs','browser'],'openai');
 const key=clean(own(value,'key',own(value,'apiKey',env.SMARTTWIN_OPENAI_API_KEY||env.OPENAI_API_KEY||'')),1000);
 const deepseekKey=clean(own(value,'deepseekKey',env.SMARTTWIN_DEEPSEEK_API_KEY||env.DEEPSEEK_API_KEY||''),1000);
 const elevenlabsKey=clean(own(value,'elevenlabsKey',env.SMARTTWIN_ELEVENLABS_API_KEY||env.ELEVENLABS_API_KEY||''),1000);
 const rawVoiceId=own(value,'elevenlabsVoiceId',env.SMARTTWIN_ELEVENLABS_VOICE_ID||env.ELEVENLABS_VOICE_ID||'');
 const elevenlabsVoiceId=typeof rawVoiceId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(rawVoiceId)?rawVoiceId:'';
 return {enabled,aiProvider,ttsProvider,sttProvider,key,deepseekKey,elevenlabsKey,elevenlabsVoiceId,
  chat:validModel(value.chat||value.chatModel||env.SMARTTWIN_AI_CHAT_MODEL||env.SMARTTWIN_VOICE_CHAT_MODEL,aiProvider==='deepseek'?'deepseek-flash':'gpt-4.1-mini'),
  speech:validModel(value.speech||value.speechModel||env.SMARTTWIN_VOICE_TTS_MODEL,ttsProvider==='elevenlabs'?'eleven_multilingual_v2':'gpt-4o-mini-tts'),
  transcription:validModel(value.transcription||value.transcriptionModel||env.SMARTTWIN_VOICE_STT_MODEL,sttProvider==='elevenlabs'?'scribe_v2':'gpt-4o-mini-transcribe'),
  voice:oneOf(value.voice||env.SMARTTWIN_VOICE_NAME,OPENAI_VOICES,'cedar')};
}

async function limitedBytes(response,maximum,signal){
 if(signal&&signal.aborted)fail(408,'La consulta se canceló.','assistant_cancelled');
 const length=Number(response.headers&&response.headers.get('content-length'));
 if(length>maximum){if(response.body)await response.body.cancel();fail(502,'La respuesta supera el límite del asistente.','assistant_response_limit');}
 if(!response.body||!response.body.getReader){const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>maximum)fail(502,'La respuesta supera el límite del asistente.','assistant_response_limit');return bytes;}
 const reader=response.body.getReader(),chunks=[];let total=0;
 try{for(;;){if(signal&&signal.aborted)fail(408,'La consulta se canceló.','assistant_cancelled');const next=await reader.read();if(next.done)break;total+=next.value.length;if(total>maximum){await reader.cancel();fail(502,'La respuesta supera el límite del asistente.','assistant_response_limit');}chunks.push(Buffer.from(next.value));}return Buffer.concat(chunks,total);}finally{reader.releaseLock();}
}
async function request(fetcher,url,{key,header='Authorization',body,signal,form=false,maximum=1024*1024}){
 let response;
 try{response=await fetcher(url,{method:'POST',redirect:'error',headers:{[header]:header==='Authorization'?'Bearer '+key:key,...(!form?{'Content-Type':'application/json'}:{})},body:form?body:JSON.stringify(body),signal});}
 catch(_){fail(signal&&signal.aborted?408:502,signal&&signal.aborted?'La consulta se canceló.':'No se pudo conectar con el proveedor del asistente.',signal&&signal.aborted?'assistant_cancelled':'assistant_unavailable');}
 if(!response||!response.ok){if(response&&response.body)await response.body.cancel();fail(response&&response.status===429?429:502,'El proveedor no pudo completar la consulta.','assistant_provider_error');}
 return limitedBytes(response,maximum,signal);
}
function parseJSON(bytes){try{return JSON.parse(bytes.toString('utf8'));}catch(_){fail(502,'El proveedor no devolvió datos válidos.','assistant_invalid_response');}}
function functionSpec(tool){const source=tool&&tool.function||tool;if(!source||!/^[_a-zA-Z][_a-zA-Z0-9-]{0,63}$/.test(source.name||''))fail(400,'La herramienta no tiene un nombre válido.','invalid_tool');return {name:source.name,description:clean(source.description,1000),parameters:source.parameters||{type:'object',properties:{},additionalProperties:false}};}
function toolCall(raw,index){
 const source=raw&&raw.function||raw||{},name=source.name,id=raw&&raw.call_id||raw&&raw.id||'call_'+index;
 if(!/^[_a-zA-Z][_a-zA-Z0-9-]{0,63}$/.test(name||'')||typeof id!=='string'||id.length>160)fail(502,'La IA propuso una herramienta inválida.','assistant_invalid_tool');
 const encoded=source.arguments===undefined?'{}':source.arguments;
 if(typeof encoded!=='string'||encoded.length>16384)fail(502,'La IA propuso argumentos inválidos.','assistant_invalid_tool');let args;try{args=JSON.parse(encoded);}catch(_){fail(502,'La IA propuso argumentos inválidos.','assistant_invalid_tool');}
 if(!args||typeof args!=='object'||Array.isArray(args))fail(502,'La IA propuso argumentos inválidos.','assistant_invalid_tool');
 return {id,name,arguments:args};
}
function normalizedMessages(messages){
 if(!Array.isArray(messages)||messages.length>40)fail(400,'El contexto del asistente supera el límite.','assistant_context_limit');
 const result=[];let total=0;
 for(const row of messages){if(!row||!['user','assistant','tool'].includes(row.role))fail(400,'El mensaje del asistente no es válido.','invalid_assistant_message');const content=clean(row.content,24000);total+=content.length;if(total>64000)fail(400,'El contexto del asistente supera el límite.','assistant_context_limit');
  const next={role:row.role,content};if(row.role==='tool'){if(typeof row.tool_call_id!=='string'||row.tool_call_id.length>160)fail(400,'La respuesta de herramienta no es válida.','invalid_assistant_message');next.tool_call_id=row.tool_call_id;}
  if(row.role==='assistant'&&Array.isArray(row.tool_calls)){if(row.tool_calls.length>8)fail(400,'Hay demasiadas herramientas en el mensaje.','assistant_context_limit');next.tool_calls=row.tool_calls.map((call,index)=>{const item=toolCall(call,index),encoded=JSON.stringify(item.arguments);total+=encoded.length;if(total>64000)fail(400,'El contexto del asistente supera el límite.','assistant_context_limit');return {id:item.id,type:'function',function:{name:item.name,arguments:encoded}};});}
  result.push(next);
 }
 return result;
}
function responseInput(messages){const result=[];for(const row of messages){if(row.role==='tool')result.push({type:'function_call_output',call_id:row.tool_call_id,output:row.content});else{if(row.content)result.push({role:row.role,content:row.content});for(const call of row.tool_calls||[])result.push({type:'function_call',call_id:call.id,name:call.function.name,arguments:call.function.arguments});}}return result;}

function createProviders({config,fetch:fetcher=globalThis.fetch}={}){
 const settings=configuration(config);
 const status=()=>{const available=settings.enabled&&typeof fetcher==='function',answer=available&&!!(settings.aiProvider==='deepseek'?settings.deepseekKey:settings.key),speech=available&&(settings.ttsProvider==='elevenlabs'?!!(settings.elevenlabsKey&&settings.elevenlabsVoiceId):settings.ttsProvider==='openai'&&!!settings.key),transcription=available&&(settings.sttProvider==='elevenlabs'?!!settings.elevenlabsKey:settings.sttProvider==='openai'&&!!settings.key);return {configured:answer||speech||transcription,answer,speech,transcription,provider:settings.aiProvider,voiceProvider:settings.ttsProvider,transcriptionProvider:settings.sttProvider};};
 const requireCapability=capability=>{if(!status()[capability])fail(503,'Esta capacidad del asistente no está configurada en el servidor.','assistant_not_configured');};
 async function answer({messages=[],instructions='',tools=[],signal,maxTokens=1200}={}){
  requireCapability('answer');const history=normalizedMessages(messages);if(!Array.isArray(tools)||tools.length>32)fail(400,'Hay demasiadas herramientas.','assistant_context_limit');const definitions=tools.map(functionSpec),maximum=Math.max(64,Math.min(4096,Number.isFinite(maxTokens)?Math.floor(maxTokens):1200));
  let data,text='',calls=[];
  if(settings.aiProvider==='deepseek'){
   const body={model:settings.chat,messages:[{role:'system',content:clean(instructions,16000)},...history],max_tokens:maximum,stream:false,thinking:{type:'disabled'},...(definitions.length?{tools:definitions.map(fn=>({type:'function',function:fn})),tool_choice:'auto'}:{})};
   data=parseJSON(await request(fetcher,'https://api.deepseek.com/chat/completions',{key:settings.deepseekKey,body,signal}));const message=data&&Array.isArray(data.choices)&&data.choices[0]&&data.choices[0].message;
   if(!message)fail(502,'La IA no devolvió una respuesta válida.','assistant_invalid_response');text=clean(message.content);calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
  }else{
   const body={model:settings.chat,instructions:clean(instructions,16000),input:responseInput(history),store:false,max_output_tokens:maximum,...(definitions.length?{tools:definitions.map(fn=>({type:'function',...fn,strict:false})),tool_choice:'auto'}:{})};
   data=parseJSON(await request(fetcher,'https://api.openai.com/v1/responses',{key:settings.key,body,signal}));const output=Array.isArray(data&&data.output)?data.output:[];text=clean(output.filter(row=>row&&row.type==='message'&&row.role==='assistant').flatMap(row=>Array.isArray(row.content)?row.content:[]).filter(row=>row&&row.type==='output_text').map(row=>row.text).join(' '));calls=output.filter(row=>row&&row.type==='function_call');
  }
  if(calls.length>8)fail(502,'La IA propuso demasiadas acciones en un turno.','assistant_tool_limit');const toolCalls=calls.map(toolCall);if(toolCalls.some(call=>!definitions.some(definition=>definition.name===call.name)))fail(502,'La IA propuso una herramienta que no estaba disponible.','assistant_invalid_tool');if(!text&&!toolCalls.length)fail(502,'La IA no devolvió una respuesta.','assistant_empty_response');
  return {text,toolCalls,provider:settings.aiProvider,message:{role:'assistant',content:text||null,...(toolCalls.length?{tool_calls:toolCalls.map(call=>({id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}))}:{})}};
 }
 async function synthesize({text,signal}={}){
  requireCapability('speech');const input=clean(text,700);if(!input)fail(400,'No hay texto para narrar.','invalid_speech');let audio;
  if(settings.ttsProvider==='elevenlabs')audio=await request(fetcher,'https://api.elevenlabs.io/v1/text-to-speech/'+settings.elevenlabsVoiceId+'?output_format=mp3_44100_128',{key:settings.elevenlabsKey,header:'xi-api-key',signal,maximum:4*1024*1024,body:{text:input,model_id:settings.speech,voice_settings:{stability:.45,similarity_boost:.75,use_speaker_boost:true}}});
  else audio=await request(fetcher,'https://api.openai.com/v1/audio/speech',{key:settings.key,signal,maximum:4*1024*1024,body:{model:settings.speech,voice:settings.voice,input,response_format:'mp3',instructions:'Habla en español latinoamericano con voz cálida y natural de instructor. Ritmo conversacional sereno, pausas breves, sin tono robótico ni entusiasmo exagerado. Pronuncia con claridad y no añadas palabras al texto.'}});
  if(!audio.length)fail(502,'No se recibió audio.','assistant_empty_response');return {audio,contentType:'audio/mpeg',provider:settings.ttsProvider};
 }
 async function transcribe({audio,mimeType,signal}={}){
  requireCapability('transcription');const mime=clean(mimeType,100).split(';')[0].toLowerCase(),extension={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'mp4','audio/wav':'wav','audio/x-wav':'wav'}[mime];if(!extension)fail(400,'La grabación no tiene un formato compatible.','invalid_audio');const bytes=Buffer.isBuffer(audio)?audio:audio instanceof Uint8Array?Buffer.from(audio):audio&&typeof audio.arrayBuffer==='function'?Buffer.from(await audio.arrayBuffer()):null;if(!bytes||!bytes.length||bytes.length>2*1024*1024)fail(413,'La grabación supera el límite de audio.','audio_too_large');
  const form=new FormData();form.set('file',new Blob([bytes],{type:mime}),'question.'+extension);let response;
  if(settings.sttProvider==='elevenlabs'){form.set('model_id',settings.transcription);form.set('language_code','es');response=await request(fetcher,'https://api.elevenlabs.io/v1/speech-to-text',{key:settings.elevenlabsKey,header:'xi-api-key',body:form,form:true,signal});}
  else{form.set('model',settings.transcription);form.set('language','es');response=await request(fetcher,'https://api.openai.com/v1/audio/transcriptions',{key:settings.key,body:form,form:true,signal});}
  const result=parseJSON(response),transcript=clean(result&&result.text,1024);if(!transcript)fail(422,'No se reconocieron palabras. Vuelve a intentarlo.','empty_transcript');return {text:transcript,provider:settings.sttProvider};
 }
 return {status,answer,synthesize,transcribe};
}
module.exports={configuration,createProviders,limitedBytes};
