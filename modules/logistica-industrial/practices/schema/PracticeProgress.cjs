'use strict';
// User-scoped campaign ledger. Persistence/authentication belong to the host.
// A UI checkbox or a passed flag alone cannot produce a completion receipt.
const sessionSchema=require('./PracticeSession.cjs');
const SOURCE_SHA256='476c91fcf6a080a23741805c4841458b96907e967e8267087b73e9b053de15f8';
const ROUTES=Object.freeze([{id:'cedi',title:'CEDI · Logística',domain:'logistics',prefix:'CEDI-'},{id:'smart-factory',title:'Smart Factory · Industrial',domain:'industrial',prefix:'SF-'}].map(route=>Object.freeze(Object.assign({},route,{practiceIds:Object.freeze(Array.from({length:5},(_,index)=>route.prefix+String(index+1).padStart(2,'0')))}))));
const MODES=Object.freeze([{id:'manual',title:'Manual / mecanizada'},{id:'semiautomatic',title:'Semiautomatizada'},{id:'automatic',title:'Automatizada'}]);
const DIFFICULTIES=Object.freeze([{id:1,title:'D1 · Guiada',description:'Instrucciones, ayudas y verificación paso a paso.'},{id:2,title:'D2 · Configurable',description:'Configura la operación y comprueba sus resultados.'},{id:3,title:'D3 · Diagnóstico',description:'Diagnostica incidencias y compara alternativas con evidencia.'}]);
const clone=value=>JSON.parse(JSON.stringify(value));
const identifier=(value,name)=>{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/.test(value))throw Error('Identificador inválido: '+name);return value;};
function routeFor(practiceId){return ROUTES.find(route=>route.practiceIds.includes(practiceId))||null;}
function empty(userId){return{format:'smarttwin.practice-progress',version:1,userId:identifier(userId,'usuario'),sourceSha256:SOURCE_SHA256,routes:Object.fromEntries(ROUTES.map(route=>[route.id,{completed:[]}]))};}
function normalize(value,userId){
 const output=empty(userId);if(value===undefined||value===null)return output;
 if(!value||value.format!==output.format||value.version!==1||value.userId!==userId||value.sourceSha256!==SOURCE_SHA256||JSON.stringify(value).length>200000)throw Error('El progreso no corresponde a esta cuenta o edición de la campaña.');
 for(const route of ROUTES){const stored=value.routes&&value.routes[route.id],rows=stored&&stored.completed;if(!Array.isArray(rows)||rows.length>route.practiceIds.length)throw Error('Progreso de ruta inválido.');
  for(let index=0;index<rows.length;index++){const row=rows[index];if(!row||row.practiceId!==route.practiceIds[index]||!MODES.some(mode=>mode.id===row.mode)||!['A','B','C'].includes(row.caseId)||![1,2,3].includes(row.difficulty)||!Number.isFinite(row.score)||row.score<75||row.score>100||row.verified!==true)throw Error('El progreso contiene un salto o resultado no verificado.');identifier(row.attemptId,'intento');if(typeof row.completedAt!=='string'||!Number.isFinite(Date.parse(row.completedAt)))throw Error('Fecha de intento inválida.');output.routes[route.id].completed.push({practiceId:row.practiceId,mode:row.mode,caseId:row.caseId,difficulty:row.difficulty,score:row.score,attemptId:row.attemptId,verified:true,completedAt:row.completedAt});}
 }
 return output;
}
function access(progress,practiceId,{author=false}={}){
 const route=routeFor(practiceId);if(!route)return{allowed:false,reason:'La práctica no pertenece a una ruta de campaña.'};const index=route.practiceIds.indexOf(practiceId),rows=progress&&progress.routes&&progress.routes[route.id]&&progress.routes[route.id].completed||[],completed=rows.find(row=>row.practiceId===practiceId),prerequisite=index?route.practiceIds[index-1]:null;
 return{allowed:author||index<=rows.length,completed:!!completed,locked:!author&&index>rows.length,routeId:route.id,routeTitle:route.title,position:index+1,total:route.practiceIds.length,prerequisite,next:route.practiceIds[index+1]||null,bestScore:completed&&completed.score||null,reason:!author&&index>rows.length?'Supera un caso de '+prerequisite+' para desbloquear esta práctica.':''};
}
function validateCompletion(receipt){
 if(!receipt||receipt.format!=='smarttwin.practice-completion'||receipt.version!==1||receipt.sourceSha256!==SOURCE_SHA256||JSON.stringify(receipt).length>120000)throw Error('Falta un resultado completo y acotado de la simulación.');
 const route=routeFor(receipt.practiceId);if(!route||route.id!==receipt.routeId)throw Error('Ruta y práctica no coinciden.');identifier(receipt.attemptId,'intento');
 const config=sessionSchema.normalizeConfig(receipt.config);if(config.practiceId!==receipt.practiceId||config.expectedUnits<1)throw Error('El resultado pertenece a otra práctica.');
 const checkpoint=receipt.checkpoint;if(!checkpoint||checkpoint.configHash!==JSON.stringify(config)||!Array.isArray(checkpoint.done)||checkpoint.done.length!==6||!checkpoint.baseline||!Array.isArray(checkpoint.history)||checkpoint.history.length>64||!Number.isFinite(checkpoint.penalty)||checkpoint.penalty<0||checkpoint.penalty>config.maxPenalty)throw Error('Se requieren los seis pasos con sus evidencias nativas.');
 let observation=checkpoint.baseline;const replay=new sessionSchema.PracticeSession(config,{snapshot:()=>observation}),initial=observation.initialUnits;let time=observation.time;
 for(let index=0;index<6;index++){
  const row=checkpoint.done[index],expected=config.steps[index];if(!row||row.id!==expected.id||row.guard!==expected.guard||!row.evidence||!Number.isFinite(row.time)||row.time<time||row.time!==row.evidence.time||row.evidence.initialUnits!==initial)throw Error('El historial no conserva orden, tiempo o lote inicial.');
  observation=row.evidence;const result=replay.act(row.guard,{sku:config.sku});if(!result.accepted)throw Error('Evidencia insuficiente para '+row.guard+': '+result.reason);time=row.time;
 }
 observation=receipt.finalEvidence;if(!observation||observation.time<time||observation.initialUnits!==initial)throw Error('El estado final no corresponde al mismo intento.');replay.penalty=checkpoint.penalty;const result=replay.observe();
 if(config.evidenceAdapter&&sessionSchema.GUARDS.some(guard=>!replay.guard(guard,observation,true).accepted))throw Error('Los registros documentales finales fueron alterados o ya no coinciden con la orden.');
 if(!result.passed||result.score<75||result.criticalReasons.length||!replay.guard('close').accepted)throw Error('La práctica todavía no reúne los objetivos materiales, puntuación y seguridad requeridos.');
 return{practiceId:receipt.practiceId,routeId:route.id,attemptId:receipt.attemptId,mode:config.mode,caseId:config.caseId,difficulty:config.difficulty,score:result.score,verified:true,executionMode:config.settings&&config.settings.executionMode||'campaign',evaluation:config.settings&&config.settings.evaluation||'assessed'};
}
function mergeCompletion(progress,receipt,{userId,now=new Date().toISOString()}={}){
 const output=normalize(progress,userId),result=validateCompletion(receipt);if(result.executionMode!=='campaign'||result.evaluation!=='assessed')return output;const permission=access(output,result.practiceId);if(!permission.allowed)throw Error(permission.reason);const rows=output.routes[result.routeId].completed,existing=rows.find(row=>row.practiceId===result.practiceId);
 if(existing){if(existing.attemptId===result.attemptId||existing.score>=result.score)return output;Object.assign(existing,result,{completedAt:now});delete existing.routeId;delete existing.executionMode;delete existing.evaluation;return normalize(output,userId);}
 rows.push(Object.assign({},result,{completedAt:now}));delete rows[rows.length-1].routeId;delete rows[rows.length-1].executionMode;delete rows[rows.length-1].evaluation;return normalize(output,userId);
}
function receipt(config,session,{attemptId,routeId,sourceSha256=SOURCE_SHA256}={}){
 const normalized=sessionSchema.normalizeConfig(config),state=session.state();if(!state.passed)throw Error('El intento aún no ha sido aprobado.');const value={format:'smarttwin.practice-completion',version:1,sourceSha256,practiceId:normalized.practiceId,routeId:routeId||routeFor(normalized.practiceId)&&routeFor(normalized.practiceId).id,attemptId,config:normalized,checkpoint:session.serialize(),finalEvidence:state.evidence};validateCompletion(value);return value;
}
module.exports={SOURCE_SHA256,ROUTES,MODES,DIFFICULTIES,empty,normalize,routeFor,access,validateCompletion,mergeCompletion,receipt};
