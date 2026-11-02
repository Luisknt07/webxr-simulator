'use strict';
// Pure evidence evaluator. The host supplies native world observations and
// performs every real action; this module never edits equipment or inventory.
const GUARDS=['identify','prepare','operate','inspect','deliver','close'];
const WEIGHTS=Object.freeze({accuracy:35,process:25,service:20,diagnosis:15,coordination:5});
const CHECKS={accuracy:['identify','inspect','deliver'],process:['prepare','operate','inspect'],service:['deliver'],diagnosis:['close'],coordination:['prepare','close']};
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const text=(value,max=240)=>typeof value==='string'?value.slice(0,max):'';
const num=(value,name,min=0,max=1e9)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error('Invalid '+name);return value;};
const id=(value,name)=>{if(!ID.test(value||''))throw Error('Invalid '+name);return value;};
const clone=value=>JSON.parse(JSON.stringify(value));
const OBSERVATION_PATHS=new Set(['robot.config.catalogueToolId','robot.completed','world.receiverUnits']);
function normalizeObservations(value){
 if(value===undefined)return[];const rows=Array.isArray(value)?value:[value];if(!rows.length||rows.length>4)throw Error('Las observaciones de la operación exceden sus límites.');
 const result=rows.map(row=>{if(!row||!OBSERVATION_PATHS.has(row.component+'.'+row.path))throw Error('Observación de componente no admitida.');const out={component:row.component,path:row.path};if(row.path==='config.catalogueToolId'){if(typeof row.expected!=='string'||!/^equipment\.tool\.[a-z0-9-]{1,80}$/.test(row.expected))throw Error('Herramienta observable inválida.');out.expected=row.expected;}else out.minimum=num(row.minimum,'mínimo observable',0,1e9);return out;});
 if(new Set(result.map(row=>row.component+'.'+row.path)).size!==result.length)throw Error('Observación duplicada.');return result;
}
function validateObservations(requirement,observed){
 const rows=requirement.observe||[];if(!rows.length)return{};if(!observed||typeof observed!=='object'||Array.isArray(observed)||Object.keys(observed).length!==rows.length)throw Error('Falta el estado real del componente.');const out={};for(const row of rows){const key=row.component+'.'+row.path,value=observed[key];if(row.expected!==undefined?value!==row.expected:typeof value!=='number'||!Number.isFinite(value)||value<row.minimum)throw Error('El componente real todavía no cumple «'+key+'».');out[key]=value;}return out;
}
function normalizeAdapter(value){
 if(value&&value.kind==='workflow'){
  const input=value.requirements||value.stageBindings;if(!Array.isArray(input)||input.length!==6)throw Error('El proceso requiere seis etapas verificables.');
  const requirements=input.map((row,index)=>{if(!row||row.guard!==GUARDS[index]||!Array.isArray(row.actorAliases)||!row.actorAliases.length||row.actorAliases.length>32)throw Error('Etapa o actores del proceso inválidos.');return{guard:row.guard,eventId:id(row.requiredEvent||row.eventId,'evento de etapa'),actorAliases:row.actorAliases.map(alias=>id(alias,'alias del actor')),title:text(row.title),action:text(row.action,1000)};});
  return{kind:'workflow',requirements};
 }
 if(!value||value.kind!=='documentary')return null;
 if(!Array.isArray(value.requirements)||value.requirements.length!==6)throw Error('La operación documental requiere seis eventos verificables.');
 const requirements=value.requirements.map(row=>{
  if(!row||!GUARDS.includes(row.guard)||!Array.isArray(row.fields)||!row.fields.length||row.fields.length>12)throw Error('Requisito documental inválido.');
  const fields=row.fields.map(field=>{if(!field||!['text','number','choice'].includes(field.type))throw Error('Campo documental inválido.');const expected=field.type==='number'?num(field.expected,'valor documental',0,1e9):text(field.expected,240);if(field.type!=='number'&&!expected)throw Error('Falta el valor contrastable de la orden.');const result={key:id(field.key,'campo documental'),label:text(field.label)||field.key,type:field.type,expected};if(field.type==='choice'||field.options!==undefined){if(!Array.isArray(field.options)||!field.options.length||field.options.length>32)throw Error('Opciones documentales inválidas.');result.options=field.options.map(option=>({value:field.type==='number'?num(option.value,'opción documental',0,1e9):text(option.value,240),label:text(option.label,240)}));if(!result.options.some(option=>option.value===expected))throw Error('La orden no coincide con las opciones documentales.');}return result;});
  if(new Set(fields.map(field=>field.key)).size!==fields.length)throw Error('Campo documental duplicado.');const result={guard:row.guard,eventId:id(row.eventId,'evento documental'),objectId:id(row.objectId,'actor documental'),title:text(row.title),action:text(row.action,1000),fields};const observe=normalizeObservations(row.observe);if(observe.length)result.observe=observe;return result;
 });
 if(new Set(requirements.map(row=>row.guard)).size!==6||new Set(requirements.map(row=>row.eventId)).size!==6)throw Error('Los eventos documentales deben ser distintos.');
 return{kind:'documentary',requirements};
}
function validateRecord(requirement,value){
 if(!requirement||!value||value.kind!==requirement.eventId||value.objectId!==requirement.objectId||!value.values||typeof value.values!=='object'||Array.isArray(value.values)||Object.keys(value.values).length!==requirement.fields.length)throw Error('Selecciona el actor y los datos de la operación activa.');
 const values={};for(const field of requirement.fields){const observed=value.values[field.key];if(field.type==='number'?(typeof observed!=='number'||!Number.isFinite(observed)||Math.abs(observed-field.expected)>1e-7):typeof observed!=='string'||observed.trim()!==field.expected)throw Error('La comprobación de «'+field.label+'» no coincide con la orden o el estado del actor.');values[field.key]=observed;}
 const result={guard:requirement.guard,eventId:requirement.eventId,objectId:requirement.objectId,values};if(requirement.observe&&requirement.observe.length)result.observed=validateObservations(requirement,value.observed);return result;
}
function normalizeAttemptSettings(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>30000)throw Error('Configuración de intento inválida.');
 const allowed=new Set(['practiceId','caseId','mode','difficulty','executionMode','equipmentSelections','layout','helps','evaluation','device','units','cycleSeconds','cycleTime']);for(const key of Object.keys(value))if(!allowed.has(key))throw Error('Propiedad de configuración no admitida: '+key);
 const result={mode:value.mode||'manual',caseId:value.caseId||'A',difficulty:value.difficulty===undefined?1:value.difficulty,executionMode:value.executionMode||'isolated',evaluation:value.evaluation||'practice',device:value.device||'desktop',equipmentSelections:{},layout:{preset:'prepared',overrides:[]},helps:{text:true,voice:false,hints:'guided'}};
 if(value.practiceId)result.practiceId=id(value.practiceId,'práctica');if(!['A','B','C'].includes(result.caseId)||!['manual','semiautomatic','automatic'].includes(result.mode)||![1,2,3].includes(result.difficulty)||!['isolated','campaign'].includes(result.executionMode)||!['practice','assessed'].includes(result.evaluation)||!['desktop','mobile','vr'].includes(result.device))throw Error('Selector del intento no admitido.');
 if(value.equipmentSelections!==undefined){if(!value.equipmentSelections||typeof value.equipmentSelections!=='object'||Array.isArray(value.equipmentSelections)||Object.keys(value.equipmentSelections).length>40)throw Error('Selección de equipos inválida.');for(const[key,selection]of Object.entries(value.equipmentSelections)){id(key,'alias');result.equipmentSelections[key]=id(selection,'equipo');}}
 if(value.layout!==undefined){const layout=value.layout;if(!layout||!['prepared'].includes(layout.preset)||!Array.isArray(layout.overrides)||layout.overrides.length>40)throw Error('Layout del intento inválido.');result.layout={preset:layout.preset,overrides:layout.overrides.map(row=>({alias:id(row.alias,'alias de posición'),x:num(row.x,'posición X',-10000,10000),z:num(row.z,'posición Z',-10000,10000),yaw:row.yaw===undefined?0:num(row.yaw,'orientación',-360,360)}))};if(new Set(result.layout.overrides.map(row=>row.alias)).size!==result.layout.overrides.length)throw Error('Posición de equipo duplicada.');}
 if(value.helps!==undefined){if(!value.helps||typeof value.helps.text!=='boolean'||typeof value.helps.voice!=='boolean'||!['guided','on-request','none'].includes(value.helps.hints))throw Error('Ayudas del intento inválidas.');result.helps={text:value.helps.text,voice:value.helps.voice,hints:value.helps.hints};}
 for(const key of ['units','cycleSeconds','cycleTime'])if(value[key]!==undefined)num(value[key],key,key==='units'?1:.2,key==='units'?10000:3600);return result;
}
function normalizeConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Practice configuration is required.');
 const aliases={M:'manual',S:'semiautomatic',A:'automatic',semi:'semiautomatic',assisted:'semiautomatic',semiautomatizada:'semiautomatic',automated:'automatic',automatizada:'automatic'},mode=aliases[value.mode]||value.mode||'manual';
 if(!['manual','semiautomatic','automatic'].includes(mode))throw Error('Unsupported practice mode.');
 const difficulty=typeof value.difficulty==='string'&&/^D[123]$/.test(value.difficulty)?Number(value.difficulty[1]):value.difficulty===undefined?1:value.difficulty;
 if(!Number.isInteger(difficulty)||difficulty<1||difficulty>3)throw Error('Unsupported practice difficulty.');
 const caseId=value.caseId||'A';if(!['A','B','C'].includes(caseId))throw Error('Unsupported practice case.');
 if(!Array.isArray(value.steps)||value.steps.length!==6)throw Error('A practice requires six evidence-bound steps.');
 const steps=value.steps.map((step,index)=>{if(!step||!GUARDS.includes(step.guard))throw Error('Invalid practice evidence guard.');return{id:id(step.id,'step id'),title:text(step.title)||'Paso '+(index+1),action:text(step.action,1000),guard:step.guard};});
 if(new Set(steps.map(s=>s.id)).size!==6||new Set(steps.map(s=>s.guard)).size!==6||steps[5].guard!=='close')throw Error('Six distinct guards are required; close must be the final step.');
 const processIds=value.processIds||[];if(!Array.isArray(processIds)||processIds.length>32||new Set(processIds).size!==processIds.length)throw Error('Invalid process actor IDs.');
 const notApplicable=value.notApplicable||[];if(!Array.isArray(notApplicable)||notApplicable.some(k=>!Object.hasOwn(WEIGHTS,k))||new Set(notApplicable).size!==notApplicable.length||notApplicable.length===5)throw Error('Invalid rubric applicability.');
 const expectedUnits=num(value.expectedUnits,'expected units',.000001),sku=text(value.sku,120);if(!sku.trim())throw Error('A declared SKU is required.');
 const result={format:'smarttwin.practice-config',version:1,practiceId:id(value.practiceId,'practice id'),caseId,mode,difficulty,roomId:id(value.roomId,'room id'),sourceId:id(value.sourceId,'source id'),processIds:processIds.map(v=>id(v,'process actor id')),receiverId:id(value.receiverId,'receiver id'),expectedUnits,sku,steps,notApplicable:[...notApplicable],projectId:value.projectId?text(value.projectId,160):'',generation:value.generation===undefined?'':text(String(value.generation),160),penaltyPerAttempt:value.penaltyPerAttempt===undefined?2:num(value.penaltyPerAttempt,'attempt penalty',0,10),maxPenalty:value.maxPenalty===undefined?40:num(value.maxPenalty,'maximum penalty',0,75),penaltyCooldown:value.penaltyCooldown===undefined?2:num(value.penaltyCooldown,'penalty cooldown',.1,60)};
 const adapter=normalizeAdapter(value.evidenceAdapter);if(adapter)result.evidenceAdapter=adapter;if(value.settings){result.settings=normalizeAttemptSettings(value.settings);if(result.settings.caseId!==caseId||result.settings.mode!==mode||result.settings.difficulty!==difficulty)throw Error('Los selectores no corresponden a la configuración del proceso.');if(result.settings.evaluation==='practice')result.penaltyPerAttempt=0;}return result;
}
// Exact canonical signature, rather than a browser crypto dependency. The
// checkpoint is data, not an authentication boundary; live evidence is checked.
function fingerprint(config){return JSON.stringify(config);}
function readSnapshot(callback){
 const s=callback();if(!s||typeof s!=='object')throw Error('Native practice evidence is missing.');
 const result={};for(const key of ['sourceUnits','processedUnits','receiverUnits','totalUnits','initialUnits','time'])result[key]=num(s[key],key,0,key==='time'?1e12:1e9);
 for(const key of ['blocked','paused','emergency','identified','prepared','documentValidated','destinationConfirmed','faultInjected','faultRecovered'])result[key]=s[key]===true;
 result.selectedSku=text(s.selectedSku,120);if(s.documentaryEvidence!==undefined){if(!Array.isArray(s.documentaryEvidence)||s.documentaryEvidence.length>6||JSON.stringify(s.documentaryEvidence).length>12000)throw Error('Evidencia documental excede sus límites.');result.documentaryEvidence=clone(s.documentaryEvidence);}if(s.documentaryObservations!==undefined){if(!Array.isArray(s.documentaryObservations)||s.documentaryObservations.length>6||JSON.stringify(s.documentaryObservations).length>6000)throw Error('Observaciones documentales exceden sus límites.');result.documentaryObservations=clone(s.documentaryObservations);}if(s.stageEvidence!==undefined){if(!Array.isArray(s.stageEvidence)||s.stageEvidence.length>6||JSON.stringify(s.stageEvidence).length>24000)throw Error("Las evidencias de las etapas exceden sus límites.");result.stageEvidence=clone(s.stageEvidence);}if(s.retainedUnits!==undefined)result.retainedUnits=num(s.retainedUnits,'unidades retenidas');if(s.finalizedUnits!==undefined)result.finalizedUnits=num(s.finalizedUnits,'unidades conciliadas');return result;
}
class PracticeSession{
 constructor(config,{snapshot,onEvent}={}){
  if(typeof snapshot!=='function')throw Error('A native snapshot provider is required.');
  this.config=normalizeConfig(config);this.configHash=fingerprint(this.config);this.snapshot=snapshot;this.onEvent=typeof onEvent==='function'?onEvent:()=>{};
  this.done=[];this.history=[];this.sequence=0;this.penalty=0;this.lastPenaltyTime=-Infinity;this.faultSeen=false;this.recoverySeen=false;this.baseline=null;this.latest=null;this.evidenceError='';this.passed=false;this.observe();
 }
 emit(type,detail={}){
  const current=this.config.steps[this.done.length],event={id:++this.sequence,type,time:this.latest?this.latest.time:0,stepId:current?current.id:null,...detail};
  this.history.push(event);if(this.history.length>64)this.history.shift();try{this.onEvent(clone(event));}catch(error){this.lastEventError=text(error&&error.message||String(error));}return event;
 }
 conserved(s=this.latest){return!!s&&Math.abs(s.totalUnits-s.initialUnits)<=Math.max(1e-7,s.initialUnits*1e-9);}
 critical(s=this.latest){const reasons=[];if(this.evidenceError||!s)reasons.push('native-evidence-unavailable');if(s){if(s.blocked)reasons.push('blocked');if(s.paused)reasons.push('paused');if(s.emergency)reasons.push('emergency');if(!this.conserved(s))reasons.push('inventory-conservation');}return reasons;}
 hasOperated(s=this.latest){return!!s&&!!this.baseline&&(s.processedUnits>0||s.sourceUnits<this.baseline.sourceUnits-1e-7);}
 guard(type,s=this.latest,past=false){
  if(!s||this.evidenceError)return{accepted:false,reason:'Falta evidencia nativa válida del escenario.'};
  if(!past&&this.critical(s).length)return{accepted:false,reason:'Resuelve pausa, emergencia, bloqueo o diferencia de inventario antes de continuar.'};
  if(this.config.evidenceAdapter&&this.config.evidenceAdapter.kind==='workflow'){
   const requirement=this.config.evidenceAdapter.requirements.find(row=>row.guard===type),event=(s.stageEvidence||[]).find(row=>row.guard===type&&row.eventId===requirement.eventId);
   const actors=event&&event.actorAliases,accepted=!!event&&Number.isFinite(event.time)&&event.time>=0&&event.time<=s.time&&Array.isArray(actors)&&requirement.actorAliases.every(alias=>actors.includes(alias))&&this.conserved(s)&&(type!=='close'||this.done.length>=5&&(s.finalizedUnits===undefined?s.receiverUnits+(s.retainedUnits||0):s.finalizedUnits)+1e-7>=this.config.expectedUnits&&(this.config.caseId!=='C'||this.faultSeen&&this.recoverySeen));
   return{accepted,reason:accepted?'Etapa verificada en el estado operativo de los equipos.':'Completa «'+(requirement.title||requirement.eventId)+"? con los equipos y la evidencia del proceso. Un formulario o una ilustración no sustituye la operación."};
  }
  if(this.config.evidenceAdapter){
   const requirement=this.config.evidenceAdapter.requirements.find(row=>row.guard===type),event=(s.documentaryEvidence||[]).find(row=>row.guard===type&&row.eventId===requirement.eventId&&row.objectId===requirement.objectId);let accepted=false;
   try{if(event&&Number.isFinite(event.time)&&event.time<=s.time){validateRecord(requirement,{kind:event.eventId,objectId:event.objectId,values:event.values,observed:event.observed});if(requirement.observe&&requirement.observe.length){const current=(s.documentaryObservations||[]).find(row=>row.eventId===requirement.eventId&&row.objectId===requirement.objectId);validateObservations(requirement,current&&current.observed);}accepted=this.conserved(s)&&(type!=='close'||this.done.length>=5&&(this.config.caseId!=='C'||this.faultSeen&&this.recoverySeen));}}catch(_){}
   return{accepted,reason:accepted?'Evento documental contrastado con el actor y la orden.':'Registra y comprueba los datos de «'+(requirement.title||requirement.eventId)+'» en el actor asignado. No se sustituye por procesar una carga.'};
  }
  const sku=s.selectedSku===this.config.sku,checks={
   identify:[s.identified&&sku,'Identifica el SKU correcto en el estado real del escenario.'],
   prepare:[s.prepared,'Confirma la preparación real de los equipos y permisos.'],
   operate:[this.hasOperated(s),'Ejecuta el proceso: todavía no hay material procesado o retirado del origen.'],
   inspect:[s.documentValidated&&sku&&this.hasOperated(s)&&this.conserved(s),'Verifica el documento, SKU y cantidades del proceso real.'],
   deliver:[s.receiverUnits+1e-7>=this.config.expectedUnits&&s.destinationConfirmed&&this.conserved(s),'Entrega la cantidad esperada y confirma su destino real.'],
   close:[this.done.length>=5&&s.documentValidated&&sku&&s.destinationConfirmed&&s.receiverUnits+1e-7>=this.config.expectedUnits&&this.conserved(s)&&(this.config.caseId!=='C'||this.faultSeen&&this.recoverySeen),'Completa los objetivos materiales y la recuperación de la incidencia antes del cierre.']};
  const check=checks[type];return{accepted:!!check[0],reason:check[0]?'Evidencia nativa confirmada.':check[1]};
 }
 score(){
  const done=new Set(this.done.map(v=>v.guard));let earned=0,available=0;
  for(const key of Object.keys(WEIGHTS)){if(this.config.notApplicable.includes(key))continue;available+=WEIGHTS[key];earned+=WEIGHTS[key]*CHECKS[key].filter(guard=>done.has(guard)).length/CHECKS[key].length;}
  return Math.max(0,Math.round((100*earned/available-this.penalty)*100)/100);
 }
 observe(){
  try{this.latest=readSnapshot(this.snapshot);this.evidenceError='';if(!this.baseline)this.baseline=clone(this.latest);if(this.latest.faultInjected)this.faultSeen=true;if(this.faultSeen&&this.latest.faultRecovered&&!this.latest.blocked&&!this.latest.emergency)this.recoverySeen=true;}
  catch(error){this.evidenceError=text(error.message||String(error));this.latest=null;}
  if(this.done.length===6&&!this.passed&&this.score()>=75&&!this.critical().length&&(this.config.caseId!=='C'||this.faultSeen&&this.recoverySeen)){this.passed=true;this.emit('practice-passed',{score:this.score()});}
  return this.state();
 }
 act(type,value){
  this.observe();const step=this.config.steps[this.done.length];
  if(this.done.some(s=>s.guard===type))return{accepted:false,duplicate:true,reason:'Este paso ya fue confirmado; no concede puntos adicionales.',state:this.state()};
  let result=!step?{accepted:false,reason:'La práctica ya está completada.'}:type!==step.guard?{accepted:false,reason:'Completa primero el paso activo.'}:this.guard(type);
  if(result.accepted&&type==='identify'&&value!==undefined&&!this.config.evidenceAdapter){const selected=typeof value==='string'?value:value&&value.sku;if(selected!==this.config.sku)result={accepted:false,reason:'El SKU indicado no coincide con el objetivo.'};}
  if(!result.accepted){
   this.reject(type,result.reason);
   return{...result,state:this.state()};
  }
  const evidence=clone(this.latest);this.done.push({id:step.id,guard:step.guard,time:evidence.time,evidence});this.emit('step-completed',{stepId:step.id,guard:step.guard,score:this.score()});this.observe();return{accepted:true,reason:result.reason,state:this.state()};
 }
 reject(type,reason){const now=this.latest?this.latest.time:0;if(!this.evidenceError&&this.latest&&this.config.steps[this.done.length]&&now-this.lastPenaltyTime>=this.config.penaltyCooldown){this.penalty=Math.min(this.config.maxPenalty,this.penalty+this.config.penaltyPerAttempt);this.lastPenaltyTime=now;this.emit('attempt-rejected',{requested:text(type,32),reason:text(reason,1000),penalty:this.penalty});}}
 state(){return{practiceId:this.config.practiceId,caseId:this.config.caseId,mode:this.config.mode,difficulty:this.config.difficulty,stepIndex:this.done.length,currentStep:this.config.steps[this.done.length]?clone(this.config.steps[this.done.length]):null,completedSteps:this.done.map(s=>s.id),completed:this.done.length===6,passed:this.passed,score:this.score(),penalty:this.penalty,criticalReasons:this.critical(),faultObserved:this.faultSeen,recoveryObserved:this.recoverySeen,evidence:this.latest?clone(this.latest):null,evidenceError:this.evidenceError,history:clone(this.history)};}
 serialize(){return{format:'smarttwin.practice-session',version:1,configHash:this.configHash,baseline:this.baseline?clone(this.baseline):null,done:clone(this.done),history:clone(this.history),sequence:this.sequence,penalty:this.penalty,lastPenaltyTime:Number.isFinite(this.lastPenaltyTime)?this.lastPenaltyTime:null,faultSeen:this.faultSeen,recoverySeen:this.recoverySeen};}
 restore(value){
  if(!value||value.format!=='smarttwin.practice-session'||value.version!==1||value.configHash!==this.configHash)throw Error('Practice checkpoint belongs to another configuration or project generation.');
  if(!Array.isArray(value.done)||value.done.length>6||!Array.isArray(value.history)||value.history.length>64||JSON.stringify(value).length>100000)throw Error('Practice checkpoint exceeds its limits.');
  const live=readSnapshot(this.snapshot),baseline=readSnapshot(()=>value.baseline);num(value.penalty,'checkpoint penalty',0,this.config.maxPenalty);num(value.sequence,'checkpoint sequence',0,1e9);if(!Number.isSafeInteger(value.sequence))throw Error('Invalid checkpoint sequence.');
  const penaltyTime=value.lastPenaltyTime===null?-Infinity:num(value.lastPenaltyTime,'last penalty time',0,live.time+.1);
  const prior={done:this.done,baseline:this.baseline,latest:this.latest,evidenceError:this.evidenceError,faultSeen:this.faultSeen,recoverySeen:this.recoverySeen};
  try{
   this.done=[];this.baseline=baseline;this.latest=live;this.evidenceError='';this.faultSeen=value.faultSeen===true&&live.faultInjected;this.recoverySeen=value.recoverySeen===true&&live.faultRecovered&&this.faultSeen;
   for(const [i,record]of value.done.entries()){const expected=this.config.steps[i];if(record.id!==expected.id||record.guard!==expected.guard)throw Error('Practice checkpoint skips or changes a step.');readSnapshot(()=>record.evidence);num(record.time,'completed step time',0,live.time+.1);if(!this.guard(record.guard,live,true).accepted)throw Error('Native world does not support the restored practice evidence: '+record.guard);this.done.push(clone(record));}
   for(const event of value.history){if(!event||!Number.isSafeInteger(event.id)||event.id<1||event.id>value.sequence||!['step-completed','attempt-rejected','practice-passed'].includes(event.type)||typeof event.time!=='number'||!Number.isFinite(event.time)||event.time<0)throw Error('Invalid practice event history.');}
  }catch(error){Object.assign(this,prior);throw error;}
  this.history=clone(value.history);this.sequence=value.sequence;this.penalty=value.penalty;this.lastPenaltyTime=penaltyTime;this.passed=false;return this.observe();
 }
 static restore(config,value,options){const session=new PracticeSession(config,options);session.restore(value);return session;}
}
function campaignLedger(options={}){
 const l=Object.assign({pallets:12,boxesPerPallet:20,blockedPallets:1,dispatchBoxes:160},options.logistics),m=Object.assign({a:120,b:80,produced:20,bomA:2,bomB:1,rejected:2},options.manufacturing);
 for(const [name,data]of[['logistics',l],['manufacturing',m]])for(const [key,value]of Object.entries(data)){num(value,name+'.'+key,0,1e9);if(!Number.isSafeInteger(value))throw Error('Campaign unit counts must be integers.');}
 const initialBoxes=l.pallets*l.boxesPerPallet,blockedBoxes=l.blockedPallets*l.boxesPerPallet,eligibleBoxes=initialBoxes-blockedBoxes;
 if(l.blockedPallets>l.pallets||l.dispatchBoxes>eligibleBoxes)throw Error('Campaign dispatch exceeds eligible physical inventory.');
 const consumedA=m.produced*m.bomA,consumedB=m.produced*m.bomB;if(consumedA>m.a||consumedB>m.b||m.rejected>m.produced)throw Error('BOM production exceeds available inputs or rejection count.');
 if(l.boxesPerPallet<1||m.bomA+m.bomB<1||![initialBoxes,blockedBoxes,consumedA,consumedB].every(Number.isSafeInteger))throw Error('Campaign units require nonempty, exactly representable packs and BOMs.');
 const result={logistics:{initialBoxes,blockedBoxes,eligibleBoxes,dispatchedBoxes:l.dispatchBoxes,remainingBoxes:initialBoxes-l.dispatchBoxes,remainingBlockedBoxes:blockedBoxes,remainingEligibleBoxes:eligibleBoxes-l.dispatchBoxes},manufacturing:{initialA:m.a,initialB:m.b,produced:m.produced,consumedA,consumedB,remainingA:m.a-consumedA,remainingB:m.b-consumedB,conforming:m.produced-m.rejected,rejected:m.rejected},mass:{known:false,reason:'La fuente declara unidades y BOM; las masas deben proporcionarse explícitamente.'}};
 if(options.massKg){const a=num(options.massKg.a,'component A mass',0),b=num(options.massKg.b,'component B mass',0),unitFG=m.bomA*a+m.bomB*b,initial=m.a*a+m.b*b,remainingRaw=result.manufacturing.remainingA*a+result.manufacturing.remainingB*b,good=result.manufacturing.conforming*unitFG,rejected=m.rejected*unitFG;result.mass={known:true,units:'kg',initial,remainingRaw,conforming:good,rejected,productUnit:unitFG,conserved:Math.abs(initial-remainingRaw-good-rejected)<1e-7};}
 return result;
}
module.exports={normalizeAttemptSettings,normalizeConfig,normalizeAdapter,normalizeObservations,validateObservations,validateRecord,PracticeSession,Session:PracticeSession,campaignLedger,WEIGHTS,GUARDS};
