import {cloneData} from '../contracts/index.js';
import {TOOL_BY_NAME,validateToolCall,commandAuthority,normalizeCommand} from './contracts.js';
const short=(value,max=1600)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const abortError=()=>Object.assign(Error('La consulta se canceló.'),{code:'assistant_cancelled'});
const clone=value=>cloneData(value,{maxDepth:16,maxNodes:40000});
const canonical=value=>JSON.stringify(value,(key,item)=>{if(item&&typeof item==='object'&&!Array.isArray(item)){const result={};for(const name of Object.keys(item).sort())result[name]=item[name];return result;}return item;});
const localCommand=value=>String(value||'').trim().replace(/^[¿¡\s]+/,'').replace(/^(?:jarvis|asistente)[,\s]*/i,'').replace(/^(?:por favor\s+)?(?:(?:puedes|podr[ií]as|quiero que|necesito que)\s+)?/i,'');
/** A bounded agent loop over declared host capabilities. No editor, renderer,
 * browser control, credentials or machine commands belong to this core. */
export class AgentController{
 constructor({registry,getSnapshot=()=>({}),getScope,transport={},onBegin,onNarrate,onStop,isVisible=()=>false,maxSteps=8}={}){
  if(!registry)throw Error('El agente necesita un registro de acciones.');Object.assign(this,{registry,getSnapshot,getScope,transport,onBegin,onNarrate,onStop,isVisible});this.maxSteps=Math.max(1,Math.min(12,maxSteps));this.listeners=new Set();this.messages=[];this.results=[];this.tools=[];this.history=[];this.sequence=0;this.disposed=false;this.busy=false;this.phase='ready';this.status='Pregunta o pide una acción sobre el proyecto actual.';this.conversation='';this.scope=null;this.identityElapsed=0;this.liveElapsed=0;this.liveGeneration=0;this.livePending=false;
 }
 state(){return {busy:this.busy,phase:this.phase,status:this.status,messages:this.messages.map(row=>({...row})),results:this.results.map(clone),tools:this.tools.map(row=>({...row})),capabilities:this.capabilities()};}
 capabilities(){return typeof this.transport.state==='function'?this.transport.state():{};}
 subscribe(callback){if(this.disposed)return ()=>{};this.listeners.add(callback);callback(this.state());return ()=>this.listeners.delete(callback);}
 emit(){if(this.disposed)return;const state=this.state();for(const listener of this.listeners)try{listener(state);}catch(_){};}
 snapshot(){return this.getSnapshot()||{};}
 currentScope(){const snapshot=this.getScope?this.getScope():this.snapshot();return {identity:String(snapshot.identity||''),roomId:String(snapshot.roomId||'')};}
 check(run,scope=this.scope){if(this.disposed||run!==this.sequence||!this.controller||this.controller.signal.aborted)throw abortError();const current=this.currentScope();if(scope&&(scope.identity!==current.identity||!this.transitioning&&scope.roomId!==current.roomId))throw Object.assign(Error('La cuenta, el proyecto o el nivel cambió. Vuelve a pedir la acción.'),{code:'session_changed'});}
 syncContext(){const current=this.currentScope();if(this.lastIdentity!==undefined&&this.lastIdentity!==current.identity){this.history=[];this.messages=[];this.results=[];this.tools=[];this.conversation='';this.stop('Cambió la cuenta o el proyecto. La conversación anterior se cerró.');}if(this.lastRoomId!==undefined&&this.lastRoomId!==current.roomId)this.clearLive();this.lastRoomId=current.roomId;this.lastIdentity=current.identity;if(this.busy&&!this.transitioning&&this.scope&&(this.scope.identity!==current.identity||this.scope.roomId!==current.roomId))this.stop('El contexto cambió. Puedes hacer una nueva consulta.');}
 step(delta=0){const elapsed=Number.isFinite(delta)?Math.max(0,delta):0;this.identityElapsed+=elapsed;this.liveElapsed+=elapsed;if(this.identityElapsed>=.5){this.identityElapsed=0;this.syncContext();}if(this.liveElapsed<2)return;this.liveElapsed=0;let visible=false;try{visible=this.isVisible()===true;}catch(_){}if(visible&&!this.disposed&&!this.busy&&!this.livePending&&this.liveTelemetry)this.pollTelemetry();}
 clearLive(){this.liveGeneration++;this.liveTelemetry=null;this.liveElapsed=0;if(this.liveController)this.liveController.abort();this.liveController=null;}
 stop(message='Consulta detenida.'){if(this.controller)this.controller.abort();this.controller=null;this.clearLive();this.sequence++;this.busy=false;this.transitioning=false;this.phase='ready';this.status=message;if(this.onStop)this.onStop();this.emit();}
 publish(result){if(!result)return;this.results.push(clone(result));if(this.results.length>24)this.results.splice(0,this.results.length-24);this.emit();}
 publishTelemetry(result){const visuals=result&&Array.isArray(result.visuals)?result.visuals.slice(0,4):[];this.results=this.results.filter(row=>row.liveTelemetry!==true);for(let index=0;index<visuals.length;index++)this.results.push({...clone(visuals[index]),id:'live-telemetry-'+index,liveTelemetry:true,simulationTime:typeof result.time==='number'&&Number.isFinite(result.time)?result.time:0});if(this.results.length>24)this.results.splice(0,this.results.length-24);this.emit();}
 async pollTelemetry(){const track=this.liveTelemetry,generation=this.liveGeneration;if(!track||this.livePending||this.disposed)return;const controller=new AbortController();this.liveController=controller;this.livePending=true;try{const result=await this.registry.execute('get_telemetry',track.args,{signal:controller.signal,expectedIdentity:track.identity}),current=this.currentScope();if(this.disposed||controller.signal.aborted||generation!==this.liveGeneration||this.liveTelemetry!==track||current.identity!==track.identity||current.roomId!==track.roomId)return;this.publishTelemetry(result);}catch(_){if(generation===this.liveGeneration){this.clearLive();this.status='La actualización de métricas se pausó. Consulta de nuevo para continuar.';this.emit();}}finally{this.livePending=false;if(this.liveController===controller)this.liveController=null;}}
 offered(authority){return [...this.registry.definitions().map(row=>row.name),'web_search','summarize_sources','show_visual','show_video'].filter(name=>{const definition=TOOL_BY_NAME.get(name);return definition&&(definition.effect!=='edit'||authority.edit)&&(name!=='open_scene'||authority.navigate);});}
 async execute(name,args,run,authority){
  this.check(run);const parameters=validateToolCall(name,args),definition=TOOL_BY_NAME.get(name);if(definition.effect==='edit'&&!authority.edit||(name==='open_scene'||name==='show_panel'&&['editor','viewer'].includes(parameters.panel))&&!authority.navigate)throw Error('La consulta original no autorizó ese cambio. Pide la acción expresamente.');
  const progress={name,status:'running',message:''};this.tools.push(progress);this.tools=this.tools.slice(-24);this.phase='tool';this.status=definition.description;this.emit();let result;
  try{
   if(definition.origin==='server'){
    if(!this.transport.research)throw Error('La búsqueda web no está disponible.');result=await this.transport.research({name,args:parameters,conversationId:this.conversation,signal:this.controller.signal});this.check(run);
    if(name==='web_search')for(const source of result.results||[])this.publish({...source,type:'source',verified:true});
    else this.publish({type:'summary',title:'Resumen de fuentes',text:short(result.text,6000),sourceIds:result.sourceIds||[]});
   }else if(name==='show_visual'){
    if(parameters.basis==='web'&&(!parameters.sourceIds||!parameters.sourceIds.length||parameters.sourceIds.some(id=>!this.results.some(row=>row.type==='source'&&row.id===id&&row.verified))))throw Error('El gráfico necesita fuentes recuperadas en esta conversación.');
    result={type:'chart',chartType:parameters.kind,title:parameters.title,points:parameters.labels.map((label,index)=>({label,value:parameters.values[index]})),unit:parameters.unit||'',sourceKind:parameters.basis==='web'?'web':'modelled',source:parameters.basis==='web'?'Fuentes de la conversación':'Ejemplo ilustrativo, no medición del sistema'};this.publish(result);
   }else if(name==='show_video'){
    // Rendering validates and isolates provider-specific embed URLs again.
    const url=new URL(parameters.url);if(url.protocol!=='https:'||url.username||url.password||!['youtube.com','www.youtube.com','youtu.be','www.youtube-nocookie.com','youtube-nocookie.com','vimeo.com','www.vimeo.com'].includes(url.hostname))throw Error('Utiliza una URL pública de YouTube o Vimeo.');result={type:'video',url:url.href,title:parameters.title||'Video relacionado'};this.publish(result);
   }else{
    if(name==='open_scene')this.transitioning=true;
    try{result=await this.registry.execute(name,parameters,{signal:this.controller.signal,expectedIdentity:this.scope.identity});if(name==='open_scene'){const current=this.currentScope();if(current.identity!==this.scope.identity)throw Error('El proyecto cambió al abrir el nivel.');this.scope.roomId=current.roomId;}}
    finally{this.transitioning=false;}
    this.check(run);if(name==='get_telemetry'){this.clearLive();if(result&&result.available!==false)this.liveTelemetry={args:clone(parameters),identity:this.scope.identity,roomId:this.scope.roomId};this.publishTelemetry(result);}else if(result&&Array.isArray(result.visuals))for(const visual of result.visuals.slice(0,4))this.publish(visual);
   }
   progress.status='complete';progress.message=name==='update_component'?'Cambio aplicado. Puedes deshacerlo en el editor.':'Completado';this.emit();return result;
  }catch(error){progress.status='error';progress.message=short(error.message,240);this.emit();throw error;}
 }
 async local(query,run,authority){
  const command=localCommand(query),normal=normalizeCommand(command),snapshot=this.snapshot();let name,args,answer;
  const panel=normal.match(/^(?:abre|abrir|muestra|mostrar) (?:el |la |los )?(?:panel (?:de )?)?(contenido|niveles|escenas|modulos|inspector|jerarquia|simulacion|voz|editor|visor)$/);
  if(panel){name='show_panel';args={panel:({contenido:'content',niveles:'scenes',escenas:'scenes',modulos:'modules',inspector:'inspector',jerarquia:'hierarchy',simulacion:'simulation',voz:'voice',editor:'editor',visor:'viewer'})[panel[1]]};answer='Se abrió el panel solicitado.';}
  else if(/^(?:analiza|analizar|muestra.*(?:grafico|metricas)|grafica|informe|compara)/.test(normal)){name='get_telemetry';args={};answer='Estos son los datos disponibles de la simulación actual. Las unidades se indican en cada variable.';}
  else if(/^(?:busca|investiga|consulta en internet)\b/.test(normal)){name='web_search';args={query:short(query.replace(/^(?:busca|investiga|consulta en internet)\s*/i,''),600)};answer='Se muestran las fuentes recuperadas. El contenido externo no controla el editor.';}
  else if(authority.navigate&&/^(?:abre|muestra|ve a|entra)/.test(normal)){const wanted=normal.replace(/^(?:abre|muestra|ve a|entra)\s+(?:(?:el nivel|la escena|el mapa)\s+)?/,'');const scenes=(snapshot.scenes||[]).filter(row=>normalizeCommand(row.id)===wanted||normalizeCommand(row.name)===wanted);if(scenes.length===1){name='open_scene';args={sceneId:scenes[0].id};answer='Nivel abierto: '+scenes[0].name+'.';}}
  else if(/^selecciona\b/.test(normal)){const queryName=short(command.replace(/^selecciona\s*/i,''),160),listing=await this.execute('list_components',{query:queryName,limit:20},run,authority);if(listing.components&&listing.components.length===1){name='select_component';args={componentId:listing.components[0].id};answer='Componente seleccionado: '+listing.components[0].name+'.';}else answer='Encontré '+(listing.total||0)+' coincidencias. Indica el nombre exacto del componente.';}
  const rename=command.match(/^(?:renombra|renombrar)\s+(?:el |la )?seleccionad[oa]\s+(?:a|como)\s+(.+)$/i);if(!name&&rename&&snapshot.selected){name='update_component';args={componentId:snapshot.selected.id,patch:{name:rename[1].trim()}};answer='Se actualizó el nombre de la selección. Puedes deshacer el cambio.';}
  if(name){const result=await this.execute(name,args,run,authority);if(result&&result.available===false)return result.message||'No hay datos disponibles.';return answer;}
  if(answer)return answer;
  const guidance=snapshot.guidance||{};return short(guidance.spokenText||guidance.text||snapshot.objective||'Puedo abrir niveles y paneles, seleccionar componentes y mostrar métricas. Para razonamiento avanzado configura el proveedor de IA en el servidor.',1200);
 }
 async ask(query,{speak=true}={}){
  const request=short(query,2048);if(!request||this.disposed)return false;this.syncContext();this.stop('Preparando la consulta…');const run=this.sequence,scope=this.currentScope();this.scope=scope;this.controller=new AbortController();this.busy=true;this.phase='thinking';this.status='Revisando el estado actual…';this.tools=[];this.messages.push({role:'user',text:request});this.messages=this.messages.slice(-24);
  if(!this.conversation)this.conversation='conversation_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);const authority=commandAuthority(request),steps=[],executed=new Set();if(this.onBegin)this.onBegin();this.emit();let answer='',source='local';
  try{
   if(this.snapshot().available===false)throw Error('Espera a que termine de cargar un proyecto autorizado antes de consultar al asistente.');
   const capabilities=this.capabilities();if(!capabilities.agent||!this.transport.plan)answer=await this.local(request,run,authority);
   else{
    source='ai';for(let turn=0;turn<this.maxSteps;turn++){
     this.check(run);this.phase='thinking';this.status=turn?'Integrando el resultado de las acciones…':'Analizando tu petición…';this.emit();
     const result=await this.transport.plan({query:request,snapshot:this.snapshot(),history:this.history.slice(-6),steps,toolNames:this.offered(authority),conversationId:this.conversation,signal:this.controller.signal});this.check(run);
     const calls=Array.isArray(result.toolCalls)?result.toolCalls:[];if(!calls.length){answer=short(result.text,8000);break;}if(calls.length>4||steps.length+calls.length>this.maxSteps)throw Error('La petición necesita más acciones. Divide la tarea para continuar con precisión.');
     for(const call of calls){this.check(run);if(!this.offered(authority).includes(call.name))throw Error('La IA propuso una acción fuera de lo solicitado.');const args=validateToolCall(call.name,call.arguments||{}),key=call.name+':'+canonical(args);if(executed.has(key))throw Error('Se detuvo una acción repetida para evitar un bucle.');executed.add(key);try{const observation=await this.execute(call.name,args,run,authority);steps.push({name:call.name,args,result:observation});}catch(error){if(['assistant_cancelled','session_changed'].includes(error.code))throw error;steps.push({name:call.name,args,result:{error:short(error.message,300),applied:false}});}}
    }
    if(!answer)answer=!steps.length?'No recibí una respuesta útil de la IA. Puedes pedir una acción concreta o utilizar la guía local.':steps.some(step=>step.result&&step.result.error)?'Algunas acciones no pudieron completarse. Revisa sus resultados en el panel y ajusta la petición.':'Se obtuvieron los resultados indicados en el panel. Puedes continuar con una petición más concreta.';
   }
   this.check(run);this.messages.push({role:'assistant',text:answer,source});this.messages=this.messages.slice(-24);this.history.push({role:'user',text:request},{role:'assistant',text:short(answer,3000)});this.history=this.history.slice(-6);this.busy=false;this.phase='ready';this.status=source==='ai'?'Respuesta de IA con herramientas verificadas.':'Acción o guía local del simulador.';this.emit();if(speak&&this.onNarrate)this.onNarrate(answer,source);return {text:answer,source,actions:steps.length};
  }catch(error){if(this.disposed||run!==this.sequence)return false;this.busy=false;this.phase='error';this.status=short(error.message,600);this.messages.push({role:'assistant',text:this.status,source:'system'});this.emit();return {text:this.status,source:'system',error:true};}
 }
 dispose(){if(this.disposed)return;this.stop();this.disposed=true;this.listeners.clear();this.history=[];this.messages=[];this.results=[];this.tools=[];}
}
export default AgentController;
