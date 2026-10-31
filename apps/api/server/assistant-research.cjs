'use strict';
// Search is a fixed external API, never an open URL proxy. Retrieved text is
// untrusted evidence for answers; the caller must not execute its instructions.
const {isIP}=require('node:net'),{createHash}=require('node:crypto');
const {ApiError}=require('./validation'),{limitedBytes}=require('./assistant-providers.cjs');
const clean=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max):'';
const fail=(status,message,code)=>{throw new ApiError(status,message,code);};
function researchURL(raw){try{const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||raw.length>2048)return null;const host=url.hostname.toLowerCase().replace(/\.$/,'');if(!host.includes('.')||isIP(host.replace(/^\[|\]$/g,''))||/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(host)||host==='metadata.google.internal')return null;url.hash='';return url.href;}catch(_){return null;}}
function configuration(value={},env=process.env){const provider=value.searchProvider||env.SMARTTWIN_SEARCH_PROVIDER;return {enabled:value.enabled===undefined?env.SMARTTWIN_VOICE_AI_ENABLED==='true':value.enabled===true,searchProvider:provider==='deepseek'?'deepseek':'tavily',tavilyKey:clean(value.tavilyKey===undefined?value.searchKey===undefined?env.SMARTTWIN_TAVILY_API_KEY||env.TAVILY_API_KEY||'':value.searchKey:value.tavilyKey,1000),deepseekKey:clean(value.deepseekKey===undefined?env.SMARTTWIN_DEEPSEEK_API_KEY||env.DEEPSEEK_API_KEY||'':value.deepseekKey,1000)};}
function createResearch({config,fetch:fetcher=globalThis.fetch}={}){
 const settings=configuration(config),status=()=>({search:settings.enabled&&!!(settings.searchProvider==='deepseek'?settings.deepseekKey:settings.tavilyKey)&&typeof fetcher==='function',provider:settings.searchProvider});
 async function search({query,signal}={}){
  if(!status().search)fail(503,'La búsqueda web no está configurada en el servidor.','research_not_configured');const input=clean(query,400);if(!input)fail(400,'Escribe qué información deseas consultar.','invalid_search');const native=settings.searchProvider==='deepseek';if(native&&[...input].length>128)fail(400,'La búsqueda de DeepSeek admite hasta 128 caracteres; acorta la consulta.','research_query_too_long');if(native&&[...input].some(char=>char.codePointAt(0)>=0xd800&&char.codePointAt(0)<=0xdfff))fail(400,'La consulta contiene caracteres Unicode inválidos.','invalid_search');let response;
  const endpoint=native?'https://api.deepseek.com/v1/tools/search':'https://api.tavily.com/search',key=native?settings.deepseekKey:settings.tavilyKey,body=native?{query:input,count:5,need_content:true}:{query:input,topic:'general',search_depth:'basic',max_results:5,include_answer:false,include_raw_content:true,include_images:false,safe_search:true};
  try{response=await fetcher(endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal});}catch(_){fail(signal&&signal.aborted?408:502,signal&&signal.aborted?'La consulta se canceló.':'No se pudo conectar con la búsqueda web.',signal&&signal.aborted?'assistant_cancelled':'research_unavailable');}
  if(!response||!response.ok){if(response&&response.body)await response.body.cancel();fail(response&&response.status===429?429:502,'La búsqueda web no pudo completar la consulta.','research_provider_error');}
  let data;try{data=JSON.parse((await limitedBytes(response,2*1024*1024,signal)).toString('utf8'));}catch(error){if(error instanceof ApiError)throw error;fail(502,'La búsqueda no devolvió datos válidos.','research_invalid_response');}
  const used=new Set(),results=[];for(const item of (Array.isArray(data&&data.results)?data.results:[]).slice(0,20)){const url=researchURL(item&&item.url);if(!url||used.has(url))continue;used.add(url);results.push({id:'source_'+createHash('sha256').update(url).digest('hex').slice(0,20),title:clean(item.title,180)||new URL(url).hostname,url,snippet:clean(native?item.snippet||item.summary:item.content,1200),content:clean(native?item.content||item.summary||item.snippet:item.raw_content||item.content,6000)});if(results.length===5)break;}
  return {query:input,results,provider:settings.searchProvider};
 }
 return {status,search};
}
module.exports={createResearch,configuration,researchURL};
