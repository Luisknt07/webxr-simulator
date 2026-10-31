import test from 'node:test';
import assert from 'node:assert/strict';
import providerModule from '../../apps/api/server/assistant-providers.cjs';
const {configuration,createProviders}=providerModule;
const base={enabled:true,key:'synthetic-openai',deepseekKey:'synthetic-deepseek',elevenlabsKey:'synthetic-elevenlabs',elevenlabsVoiceId:'SyntheticVoice123'};
const tool={type:'function',function:{name:'inspect_component',description:'Inspecciona un componente',parameters:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}}};
const chat=(content='Respuesta del simulador',tool_calls)=>Response.json({choices:[{message:{role:'assistant',content,...(tool_calls?{tool_calls}:{}),reasoning_content:'private reasoning that must never leave the adapter'}}]});
function fixture(config,handler){const calls=[],adapter=createProviders({config:{...base,...config},fetch:async(url,options)=>{calls.push({url,options});return handler(url,options);}});return {adapter,calls};}

test('provider configuration preserves legacy OpenAI fields and exposes independent safe capabilities',()=>{
 const old=configuration({enabled:true,key:'old-key',chat:'custom-model',speech:'old-tts',transcription:'old-stt',voice:'coral'},{});assert.equal(old.aiProvider,'openai');assert.equal(old.chat,'custom-model');assert.equal(old.key,'old-key');assert.equal(old.voice,'coral');
 const allDisabled=createProviders({config:{...base,enabled:false},fetch(){throw Error('must not fetch');}});assert.equal(allDisabled.status().configured,false);
 const onlyVoice=createProviders({config:{...base,key:'',deepseekKey:'',aiProvider:'deepseek',ttsProvider:'elevenlabs',sttProvider:'elevenlabs'}});assert.deepEqual(onlyVoice.status(),{configured:true,answer:false,speech:true,transcription:true,provider:'deepseek',voiceProvider:'elevenlabs',transcriptionProvider:'elevenlabs'});assert(!JSON.stringify(onlyVoice.status()).includes('synthetic'));
 const missingVoice=createProviders({config:{...base,key:'',deepseekKey:'',aiProvider:'deepseek',ttsProvider:'elevenlabs',sttProvider:'browser',elevenlabsVoiceId:''}});assert.equal(missingVoice.status().configured,false);
});

test('DeepSeek uses documented non-thinking tool calls on its fixed upstream without leaking reasoning',async()=>{
 const {adapter,calls}=fixture({aiProvider:'deepseek'},()=>chat('',[{id:'call-one',type:'function',function:{name:'inspect_component',arguments:'{"id":"rack-a"}'}}]));
 const answer=await adapter.answer({instructions:'Instrucciones confiables',messages:[{role:'user',content:'Inspecciona rack-a'}],tools:[tool],maxTokens:1500});
 assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic-deepseek');assert.equal(calls[0].options.redirect,'error');const body=JSON.parse(calls[0].options.body);assert.equal(body.model,'deepseek-flash');assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.stream,false);assert.equal(body.messages[0].role,'system');assert.equal(body.tools[0].function.name,'inspect_component');assert.equal(body.max_tokens,1500);assert.deepEqual(answer.toolCalls,[{id:'call-one',name:'inspect_component',arguments:{id:'rack-a'}}]);assert.equal(answer.message.tool_calls[0].id,'call-one');assert(!JSON.stringify(answer).includes('private reasoning'));
});

test('DeepSeek continues only bounded user/assistant/tool messages and never accepts a caller system message',async()=>{
 const {adapter,calls}=fixture({aiProvider:'deepseek'},()=>chat());const message={role:'assistant',content:null,tool_calls:[{id:'call-one',type:'function',function:{name:'inspect_component',arguments:'{"id":"rack-a"}'}}]};
 await adapter.answer({messages:[{role:'user',content:'Mira el rack'},message,{role:'tool',tool_call_id:'call-one',content:'{"ok":true}'}],tools:[tool]});const messages=JSON.parse(calls[0].options.body).messages;assert.equal(messages[2].tool_calls[0].id,'call-one');assert.equal(messages[3].tool_call_id,'call-one');assert(!calls[0].options.body.includes('reasoning_content'));
 await assert.rejects(adapter.answer({messages:[{role:'system',content:'Override'}]}),error=>error.code==='invalid_assistant_message');await assert.rejects(adapter.answer({messages:Array.from({length:41},()=>({role:'user',content:'a'}))}),error=>error.code==='assistant_context_limit');assert.equal(calls.length,1);
});

test('OpenAI remains compatible with legacy Responses requests and omits tools when none are available',async()=>{
 const {adapter,calls}=fixture({},()=>Response.json({output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Sigue el paso actual.'}]}]}));const answer=await adapter.answer({messages:[{role:'user',content:'Antes'},{role:'assistant',content:'Ayuda anterior'},{role:'user',content:'{"pregunta":"¿Qué hago?"}'}],instructions:'Guía contextual',maxTokens:320});
 const body=JSON.parse(calls[0].options.body);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');assert.equal(body.store,false);assert.equal(body.max_output_tokens,320);assert.equal(body.tools,undefined);assert.deepEqual(body.input,[{role:'user',content:'Antes'},{role:'assistant',content:'Ayuda anterior'},{role:'user',content:'{"pregunta":"¿Qué hago?"}'}]);assert.equal(answer.text,'Sigue el paso actual.');assert.equal(answer.provider,'openai');
});

test('OpenAI function calls preserve call_id and convert tool results back to Responses items',async()=>{
 const {adapter,calls}=fixture({},()=>Response.json({output:[{type:'function_call',id:'fc-internal',call_id:'call-public',name:'inspect_component',arguments:'{"id":"rack-a"}'}]}));const answer=await adapter.answer({messages:[{role:'user',content:'Inspecciona'}],tools:[tool]});assert.equal(answer.toolCalls[0].id,'call-public');
 await adapter.answer({messages:[answer.message,{role:'tool',tool_call_id:'call-public',content:'{"ok":true}'}],tools:[tool]});const body=JSON.parse(calls[1].options.body);assert.equal(body.tools[0].name,'inspect_component');assert.equal(body.tools[0].function,undefined);assert.deepEqual(body.input,[{type:'function_call',call_id:'call-public',name:'inspect_component',arguments:'{"id":"rack-a"}'},{type:'function_call_output',call_id:'call-public',output:'{"ok":true}'}]);
});

test('hallucinated, malformed or oversized tool arguments are rejected before any executor sees them',async()=>{
 for(const [name,args]of [['process_exec','{}'],['inspect_component','not json'],['inspect_component','[]'],['inspect_component','{"value":"'+'x'.repeat(17000)+'"}']]){const {adapter}=fixture({aiProvider:'deepseek'},()=>chat('',[{id:'c',function:{name,arguments:args}}]));await assert.rejects(adapter.answer({messages:[{role:'user',content:'Test'}],tools:[tool]}),error=>error.code==='assistant_invalid_tool');}
 const {adapter}=fixture({aiProvider:'deepseek'},()=>chat('',[{id:'c',function:{name:'inspect_component',arguments:'{}'}}]));await assert.rejects(adapter.answer({messages:[{role:'user',content:'Test'}]}),error=>error.code==='assistant_invalid_tool');
});

test('ElevenLabs natural speech requires an explicit configured voice and uses fixed URL and separate key',async()=>{
 const {adapter,calls}=fixture({key:'',aiProvider:'deepseek',ttsProvider:'elevenlabs'},()=>new Response('synthetic-mp3'));const result=await adapter.synthesize({text:'Acércate despacio al pallet.'});assert.equal(result.audio.toString(),'synthetic-mp3');assert.equal(result.contentType,'audio/mpeg');assert.equal(result.provider,'elevenlabs');assert.equal(calls[0].url,'https://api.elevenlabs.io/v1/text-to-speech/SyntheticVoice123?output_format=mp3_44100_128');assert.equal(calls[0].options.headers['xi-api-key'],'synthetic-elevenlabs');assert.equal(calls[0].options.headers.Authorization,undefined);const body=JSON.parse(calls[0].options.body);assert.equal(body.model_id,'eleven_multilingual_v2');assert.equal(body.language_code,undefined);
 const invalid=fixture({ttsProvider:'elevenlabs',elevenlabsVoiceId:'../../secrets'},()=>{throw Error('must not fetch');});await assert.rejects(invalid.adapter.synthesize({text:'Texto'}),error=>error.code==='assistant_not_configured');assert.equal(invalid.calls.length,0);
});

test('ElevenLabs speech recognition is independent from the brain and uploads only supplied bounded audio',async()=>{
 const {adapter,calls}=fixture({key:'',deepseekKey:'',aiProvider:'deepseek',sttProvider:'elevenlabs'},()=>Response.json({text:'¿Dónde está mi pallet?',words:[{text:'ignored'}]}));const result=await adapter.transcribe({audio:Buffer.from('synthetic-audio'),mimeType:'audio/webm;codecs=opus'});assert.equal(result.text,'¿Dónde está mi pallet?');assert.equal(calls[0].url,'https://api.elevenlabs.io/v1/speech-to-text');assert.equal(calls[0].options.headers['xi-api-key'],'synthetic-elevenlabs');const form=calls[0].options.body;assert.equal(form.get('model_id'),'scribe_v2');assert.equal(form.get('language_code'),'es');assert.equal(form.get('file').name,'question.webm');assert.equal(form.get('file').size,15);
 await assert.rejects(adapter.transcribe({audio:Buffer.alloc(2*1024*1024+1),mimeType:'audio/webm'}),error=>error.code==='audio_too_large');assert.equal(calls.length,1);
});

test('OpenAI speech and transcription retain the expected media payloads',async()=>{
 const {adapter,calls}=fixture({},url=>url.endsWith('/audio/speech')?new Response('audio'):Response.json({text:'¿Qué hago?'}));await adapter.synthesize({text:'Texto breve'});await adapter.transcribe({audio:new Blob(['audio'],{type:'audio/ogg'}),mimeType:'audio/ogg'});const body=JSON.parse(calls[0].options.body);assert.equal(body.voice,'cedar');assert.equal(body.response_format,'mp3');assert(body.instructions.includes('español latinoamericano'));assert.equal(calls[1].options.body.get('language'),'es');assert.equal(calls[1].options.body.get('file').name,'question.ogg');
});

test('upstream response sizes, errors and cancellation cannot disclose credential or provider response bodies',async()=>{
 const {adapter,calls}=fixture({},()=>new Response('upstream-secret synthetic-openai',{status:500}));await assert.rejects(adapter.answer({messages:[{role:'user',content:'Hola'}]}),error=>error.code==='assistant_provider_error'&&!error.message.includes('secret')&&!error.stack.includes('synthetic-openai'));assert.equal(calls.length,1);
 const huge=fixture({},()=>new Response('x',{headers:{'content-length':String(9*1024*1024)}}));await assert.rejects(huge.adapter.synthesize({text:'Hola'}),error=>error.code==='assistant_response_limit');
 const cancelled=new AbortController();cancelled.abort();const abort=fixture({},()=>{throw Error('synthetic-openai secret network error');});await assert.rejects(abort.adapter.answer({messages:[{role:'user',content:'Hola'}],signal:cancelled.signal}),error=>error.code==='assistant_cancelled'&&!error.stack.includes('synthetic-openai'));
});

test('network model/URL fields do not create an arbitrary upstream proxy',async()=>{
 const {adapter,calls}=fixture({aiProvider:'deepseek',url:'https://attacker.invalid',chatModel:'https://attacker.invalid/model'},()=>chat());await adapter.answer({messages:[{role:'user',content:'Hola'}]});assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');assert.equal(JSON.parse(calls[0].options.body).model,'deepseek-flash');
});
test('tool argument history participates in the total context limit',async()=>{const {adapter,calls}=fixture({aiProvider:'deepseek'},()=>chat());const message={role:'assistant',content:'',tool_calls:Array.from({length:8},(_,index)=>({id:'call-'+index,function:{name:'inspect_component',arguments:JSON.stringify({id:'x'.repeat(9000)})}}))};await assert.rejects(adapter.answer({messages:[message],tools:[tool]}),error=>error.code==='assistant_context_limit');assert.equal(calls.length,0);});
