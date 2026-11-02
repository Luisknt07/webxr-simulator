import sessionSchema from '../schema/PracticeSession.cjs';
import PracticePanel from '../ui/PracticePanel.js';

const MODULE='sector.logistics-industrial';
const total=queue=>(queue||[]).reduce((sum,entry)=>sum+(entry.units||1),0);
/** Observes and commands the existing simulation. No parallel material stock. */
export default class PracticeController{
 constructor(editor,manifest,options={}){
  this.editor=editor;this.runtime=editor.simulation;this.manifest=manifest;this.plan=manifest.plan;this.config=sessionSchema.normalizeConfig(manifest);
  this.projectGeneration=editor.projectGeneration;this.projectId=editor.currentProject&&editor.currentProject.id||'';this.roomId=editor.roomId;this.runtimeRun=this.runtime.runSequence;
  this.selectedSku='';this.identified=false;this.documentValidated=false;this.lastMessage='Identifica el producto y prepara los equipos.';this.faultInjected=false;this.faultRecovered=manifest.caseId!=='C';this.disposed=false;this.receiverBaseline=this.receiverCount();
  this.initialUnits=this.inventoryUnits();this.initialSourceUnits=this.sourceCount();
  if(manifest.caseId==='C'){this.faultInjected=true;this.machineRecords().forEach(record=>{if(record.components.processor||record.components.robot||record.components.vehicle||record.components.conveyor)this.runtime.setVariable(record.id,'emergency',true);});}
  this.session=new sessionSchema.PracticeSession(this.config,{snapshot:()=>this.snapshot(),onEvent:event=>{this.runtime.event(this.config.sourceId,'practice-'+event.type,this.plan.id+' · '+event.type);if(event.type==='practice-passed')this.lastMessage='Práctica aprobada · '+event.score+' puntos.';}});
  if(options.panel!==false&&typeof document!=='undefined')this.panel=new PracticePanel({controller:this,host:options.host||document.body});
 }
 current(){return!this.disposed&&(!this.editor.projectModules||this.editor.projectModules.canShowLevel('sector.logistics-industrial'))&&this.runtime.active!==false&&this.runtime.runSequence===this.runtimeRun&&this.editor.projectGeneration===this.projectGeneration&&this.editor.roomId===this.roomId&&(this.editor.currentProject&&this.editor.currentProject.id||'')===this.projectId;}
 records(ids){return(ids||[]).map(id=>this.runtime.records.get(id)).filter(Boolean);}
 machineRecords(){return this.records(this.manifest.processIds.concat(this.manifest.conveyorIds||[]));}
 sourceCount(){return this.records(this.manifest.sourceIds).reduce((sum,record)=>sum+total(record.components.source&&record.components.source.queue||record.components.palletQueue&&record.components.palletQueue.queue),0);}
 receiverCount(){return this.records(this.manifest.receiverIds).reduce((sum,record)=>sum+(record.components.palletQueue?record.components.palletQueue.receivedUnits||0:record.components.source?record.components.source.receivedUnits||total(record.components.source.queue):0),0);}
 inventoryUnits(){const entries=new Map();this.runtime.sourceRuntime.entries.forEach(entry=>{entries.set(entry.id,entry.units||1);});this.runtime.products.forEach(product=>{const entry=product.sourceEntry;if(entry)entries.set(entry.id,entry.units||1);else if(product.record){const metadata=this.runtime.productMetadata(product);entries.set('authored:'+product.record.id,metadata.units||1);}});return Array.from(entries.values()).reduce((sum,value)=>sum+value,0);}
 operatedUnits(){return this.machineRecords().reduce((maximum,record)=>{const c=record.components;return Math.max(maximum,c.processor?c.processor.completedUnits||0:c.conveyor?c.conveyor.exitUnits||0:c.robot?c.robot.deliveredUnits||c.robot.completedUnits||c.robot.completed||c.robot.cycles||0:c.vehicle?Math.max(c.vehicle.entry?this.config.expectedUnits:0,c.vehicle.deliveredUnits||0,c.vehicle.training?c.vehicle.training.completed.length*this.config.expectedUnits:0):0);},0);}
 snapshot(){
  if(!this.current())throw Error('La práctica pertenece a otra ejecución o proyecto.');
  const machines=this.machineRecords(),states=machines.map(record=>record.components.processor||record.components.robot||record.components.vehicle||record.components.conveyor);
  const receiverUnits=Math.max(0,this.receiverCount()-this.receiverBaseline),vehicle=this.records(this.manifest.vehicleIds)[0],training=vehicle&&vehicle.components.vehicle.training;
  return{sourceUnits:this.sourceCount(),processedUnits:this.operatedUnits(),receiverUnits,totalUnits:this.inventoryUnits(),initialUnits:this.initialUnits,time:this.runtime.time,
   blocked:false,paused:states.some(state=>state.paused),emergency:states.some(state=>state.emergency),selectedSku:this.selectedSku,identified:this.identified,
   prepared:states.every(state=>state.enabled!==false&&state.powered!==false&&state.running!==false&&!state.paused&&!state.emergency),documentValidated:this.documentValidated,
   destinationConfirmed:receiverUnits>=this.config.expectedUnits&&(!training||training.completed.length>0),faultInjected:this.faultInjected,faultRecovered:this.faultRecovered};
 }
 state(){const session=this.session.state(),world=this.current()?this.snapshot():null;return{plan:this.plan,session,world,lastMessage:this.lastMessage,step:this.config.steps[this.session.done.length],caseId:this.config.caseId};}
 perform(action,value={}){
  if(!this.current())return false;
  try{
   if(action==='identify'){this.selectedSku=String(value.sku||'').trim();const matching=new Set();this.runtime.sourceRuntime.entries.forEach(entry=>{if(entry.ownerId&&entry.spec&&entry.spec.id===this.selectedSku)matching.add(entry.id);});this.runtime.products.forEach(product=>{const metadata=this.runtime.productMetadata(product),config=product.record&&product.record.components.product&&product.record.components.product.config;if(metadata.sku===this.selectedSku||config&&config.sku===this.selectedSku||product.sourceEntry&&product.sourceEntry.spec.id===this.selectedSku)matching.add(product.object.uuid);});this.identified=matching.size>0&&this.selectedSku===this.config.sku;this.lastMessage=this.identified?'SKU identificado en el origen de esta práctica.':'El SKU no coincide con la carga asignada.';}
   else if(action==='prepare'){
    if(this.faultInjected&&!this.faultRecovered)throw Error('Diagnostica y resuelve primero la incidencia del caso C.');
    this.machineRecords().forEach(record=>{const c=record.components;if(c.processor||c.robot||c.vehicle||c.conveyor){this.runtime.setVariable(record.id,'powered',true);this.runtime.setVariable(record.id,'paused',false);this.runtime.setVariable(record.id,'running',true);}});this.lastMessage='Equipos preparados; revisa los estados del proceso.';
   }else if(action==='feed'){
    let ok=false;this.records(this.manifest.sourceIds).forEach(record=>{if(record.components.source)ok=this.runtime.sourceRuntime.command(record,'dispatch')||ok;});this.lastMessage=ok?'Unidad transferida por el puerto real de entrada.':'No se ha transferido material. Comprueba preparación, espacio e interfaces.';
   }else if(action==='cycle'){
    let ok=false;this.machineRecords().forEach(record=>{if(record.components.processor){this.runtime.setVariable(record.id,'operatorAvailable',true);ok=true;}else if(record.components.robot)ok=this.runtime.robotRuntime.command(record,'cycle')||ok;});this.lastMessage=ok?'Ciclo solicitado al controlador nativo.':'Usa los controles del vehículo para ejecutar el traslado.';
   }else if(action==='dispatch'){
    let ok=false;this.records(this.manifest.processIds).forEach(record=>{if(record.components.processor)ok=this.runtime.sourceRuntime.dispatch(record,record.components.processor.output)||ok;});this.lastMessage=ok?'Salida transferida conservando la carga.':'La salida espera material, espacio o una interfaz alineada.';
   }else if(action==='inspect'){
    const s=this.snapshot(),count=Number(value.count);this.documentValidated=count===this.config.expectedUnits&&this.identified&&s.processedUnits>0&&Math.abs(s.totalUnits-s.initialUnits)<.00001;this.lastMessage=this.documentValidated?'Conteo y trazabilidad contrastados con el estado real.':'El conteo, el SKU o las evidencias del proceso no coinciden.';
   }else if(action==='diagnose'){
    if(!this.faultInjected||this.faultRecovered)throw Error('No hay una incidencia activa por resolver.');
    if(value.kind!==this.plan.incidentKind)throw Error('La causa seleccionada no coincide con la incidencia observada.');
    this.machineRecords().forEach(record=>{if(record.components.processor||record.components.robot||record.components.vehicle||record.components.conveyor){this.runtime.setVariable(record.id,'emergency',false);this.runtime.setVariable(record.id,'paused',false);this.runtime.setVariable(record.id,'powered',true);this.runtime.setVariable(record.id,'running',true);}});this.faultRecovered=true;this.lastMessage='Causa registrada y permiso de proceso restablecido. No se ha añadido material.';
   }else if(action==='verify'){const result=this.session.act(value.guard||this.config.steps[this.session.done.length].guard,{sku:this.selectedSku});this.lastMessage=result.reason;}
   else throw Error('Acción de práctica desconocida.');
   this.session.observe();if(this.panel)this.panel.update();return true;
  }catch(error){this.lastMessage=error.message;if(this.panel)this.panel.update();return false;}
 }
 update(){if(!this.current())return;this.session.observe();if(this.panel)this.panel.update();}
 async save(){if(!this.current()||!this.editor.canEditDocument())return false;const studio=this.editor.document.studio,moduleData=Object.assign({},studio.moduleData),data=Object.assign({},moduleData[MODULE]);const row={practiceId:this.config.practiceId,caseId:this.config.caseId,mode:this.config.mode,difficulty:this.config.difficulty,roomId:this.roomId,checkpoint:this.session.serialize(),result:this.session.state(),sourceSha256:this.plan.sourceSha256,recordedAt:new Date().toISOString(),inventoryScope:'isolated-practice-copy'};data.attempts=(data.attempts||[]).concat([row]).slice(-64);while(data.attempts.length>1&&JSON.stringify(data).length>450000)data.attempts.shift();moduleData[MODULE]=data;this.editor.document.setStudio({moduleData});await this.editor.saveProject();this.lastMessage='Intento guardado con sus evidencias y puntuación. Reabrir el nivel inicia un nuevo ensayo con el lote original.';if(this.panel)this.panel.update();return true;}
 restart(){if(!this.current())return;this.editor.stopRuntime();this.editor.startRuntime();}
 dispose(){this.disposed=true;if(this.panel)this.panel.dispose();}
}
