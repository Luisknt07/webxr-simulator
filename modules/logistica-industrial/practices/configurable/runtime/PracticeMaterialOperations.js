import bom from '../schema/PracticeBOM.cjs';
import PracticeCycleInterlock from './PracticeCycleInterlock.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const choices=values=>values.map(value=>({value,label:String(value)}));
const SUPPORTED=['SF-02','SF-04','CEDI-04','SF-05'];

/** Domain recipes prepare a native timed processor job. Material is loaded,
 * carried and released through the existing handling interfaces; a form can
 * request a cycle, but cannot move a load or manufacture evidence. */
export default class PracticeMaterialOperations {
 constructor(editor,manifest,callbacks={}){
  this.editor=editor;this.runtime=editor.simulation;this.manifest=manifest;this.callbacks=callbacks;this.disposed=false;this.id=manifest.practiceId;this.recipe=manifest.materialRecipe||{};this.unbind=[];this.cycles=new PracticeCycleInterlock(this.runtime);
  this.state=manifest.bomWorkflowState&&manifest.bomWorkflowState.version===1?copy(manifest.bomWorkflowState):{version:1,order:false,prepared:false,stationReady:false,quality:{},secured:{},closed:false};
  if(!SUPPORTED.includes(this.id))return;
  const record=this.alias(this.id==='SF-02'?'E03':'E02');
  if(!record||!record.components.processor||!this.runtime.processorRuntime.registerMaterialAdapter)throw Error('La estación de conversión BOM no está disponible.');
  this.machineId=record.id;
  this.unbind.push(this.runtime.processorRuntime.registerMaterialAdapter(record.id,{
   accepts:entries=>bom.accepts(this.id,entries,this.recipe.stock),
   prepare:entries=>{const outputs=bom.prepare(this.id,entries,this.recipe.stock);for(const output of outputs)for(const event of output.spec.operationHistory)event.recordId=record.id;return outputs;}
  }));
 }
 live(){if(this.disposed||this.runtime.running===false||this.runtime.active===false||!this.runtime.roomId)throw Error('La práctica ya no está activa.');}
 alias(alias){const row=(this.manifest.aliases||[]).find(row=>row.alias===alias);return row&&this.runtime.records.get(row.objectId);}
 observe(){return this.callbacks.observe?this.callbacks.observe():{entries:[],criticalReasons:[]};}
 sourceState(){const o=this.observe();if(o.criticalReasons.length)throw Error(o.criticalReasons.join(' '));return o;}
 save(){
  this.manifest.bomWorkflowState=copy(this.state);
  const doc=this.editor.document,studio=doc&&doc.studio;if(doc&&doc.setStudio&&studio){const moduleData=Object.assign({},studio.moduleData),sector=Object.assign({},moduleData['sector.logistics-industrial']);sector.levels=(sector.levels||[]).map(row=>row.roomId===this.manifest.roomId&&row.practiceId===this.id?Object.assign({},row,{bomWorkflowState:copy(this.state)}):row);moduleData['sector.logistics-industrial']=sector;doc.setStudio({moduleData});}
  if(this.callbacks.save)this.callbacks.save();
 }
 isOutput(row){return !!(row.operationState&&row.operationState.sourcePractice===this.id);}
 outputs(o){
  const outputs=[];
  for(const row of o.entries){
   if(this.isOutput(row)){outputs.push(row);continue;}
   if(!row.entry||!row.entry.load||!row.entry.load.physicalAssembly)continue;
   // A formed pallet owns the original cartons. Observe those same carton IDs
   // inside the physical aggregate; never recreate boxes after palletization.
   const visit=entry=>{if(entry.spec&&entry.spec.operationState&&entry.spec.operationState.sourcePractice===this.id){outputs.push(Object.assign({},row,{id:entry.id,sku:entry.spec.id,quantity:entry.units,operationState:entry.spec.operationState,operationHistory:entry.spec.operationHistory||[],assemblyId:row.entry.id,assemblyComplete:!row.product.palletAssemblyIncomplete}));return;}for(const child of entry.members||[])visit(child);};
   for(const member of row.entry.members||[])visit(member);
  }
  return outputs;
 }
 count(rows){return rows.reduce((sum,row)=>sum+(Number(row.quantity)||0),0);}
 released(o){return this.outputs(o).filter(row=>row.inReleased&&!row.held);}
 machine(){return this.runtime.records.get(this.machineId);}
 required(){return this.id==='SF-02'?3:12;}
 completeInspection(row){
  if(this.id==='SF-02')return true;
  if(this.id==='SF-04')return row.operationState.testResult==='pass'&&row.operationHistory.some(event=>event.recipe==='test');
  if(this.id==='CEDI-04'){const station=this.alias('E03');return row.operationState.sealed&&row.operationHistory.some(event=>event.recipe==='seal'||event.recipe==='inspect'||event.recipe==='weigh'||station&&event.recordId===station.id&&event.recipe==='pack');}
  return row.operationState.packed&&row.operationState.identified;
 }
 finalRows(o){return this.released(o).filter(row=>this.completeInspection(row)&&this.state.quality[row.id]);}
 actions(){
  if(!SUPPORTED.includes(this.id))return[];
  const o=this.observe(),outputs=this.outputs(o),load={key:'loadId',label:'Unidad física',type:'choice',options:outputs.map(row=>({value:row.id,label:row.sku+' · '+row.quantity+' '+(this.id==='SF-02'?'kit':'unidades')}))};
  const main=this.id==='SF-02'?'E03':'E02',stations=[main].concat(this.id==='SF-04'||this.id==='CEDI-04'?['E03']:[]);
  return[
   {id:'bom-order',title:'Contrastar orden, materiales y destino',actorAliases:(this.manifest.aliases||[]).filter(row=>row.role==='terminal').map(row=>row.alias),fields:[{key:'orderId',label:'Orden',type:'choice',options:choices([this.recipe.orderId,'ORD-OTRA'])},{key:'quantity',label:this.id==='SF-02'?'Kits previstos':'Unidades terminadas previstas',type:'number'}],enabled:!this.state.order,reason:'Revisa la BOM y las existencias originales de la guía.'},
   {id:'bom-prepare',title:'Preparar método y sujeción compatibles',actorAliases:[main],fields:[{key:'method',label:'Receta',type:'choice',options:choices([this.id==='SF-02'?'kit-4-4-16':this.id==='SF-04'?'ensamble-1-1-4':'contenido-caja-etiqueta','sin-verificar'])}],enabled:!!this.state.order&&!this.state.prepared,reason:'La receta utiliza componentes físicos, no un lote generado.'},
   {id:'bom-cycle',title:'Solicitar ciclo de la estación cargada',actorAliases:stations,fields:[{key:'station',label:'Estación',type:'choice',options:choices(stations)}],enabled:!!this.state.prepared,reason:'Lleva cada contenedor a la entrada real; luego solicita el ciclo. La salida debe retirarse antes de saturar el buffer.'},
   {id:'bom-inspect',title:this.id==='SF-02'?'Identificar kit completo':'Contrastar calidad e identificación',actorAliases:[main,this.id==='SF-04'||this.id==='CEDI-04'?'E03':'E10'],fields:[load,{key:'quantity',label:'Cantidad observada en esta unidad',type:'number'},{key:'condition',label:'Resultado observado',type:'choice',options:choices(['conforme','retenido'])}],enabled:outputs.length>0,reason:'Retira la unidad terminada y completa el ensayo físico previsto antes de liberarla.'},
   {id:'bom-secure',title:this.id==='SF-02'?'Comprobar estación abastecida':'Verificar y asegurar el pallet formado',actorAliases:[this.id==='SF-02'?'E07':this.id==='CEDI-04'?'E05':'E04'],fields:this.id==='SF-02'?[{key:'ready',label:'Estación de consumo',type:'choice',options:choices(['util-receta-y-entradas-verificadas','sin-verificar'])}]:[load,{key:'secured',label:'Condición de la carga',type:'choice',options:choices(['patron-y-sujecion-verificados','sin-verificar'])}],enabled:this.count(outputs)>=this.required(),reason:'Completa la formación o entrega real; el formulario no crea pallets ni kits.'},
   {id:'bom-close',title:'Conciliar consumos y entrega física',actorAliases:(this.manifest.aliases||[]).map(row=>row.alias),fields:[{key:'quantity',label:'Cantidad final conciliada',type:'number'}],enabled:Object.keys(this.state.quality).length>0,reason:'Todos los productos y sus componentes originales deben estar conciliados y en destino.'}
  ].filter(action=>this.id!=='SF-04'||action.id!=='bom-secure');
 }
 command(type,payload={}){
  this.live();if(!SUPPORTED.includes(this.id))throw Error('Esta práctica no utiliza estas operaciones.');const o=this.sourceState();
  if(type==='bom-order'){
   if(payload.orderId!==this.recipe.orderId||Number(payload.quantity)!==this.required())throw Error('La orden y cantidad no corresponden a la BOM física.');this.state.order=true;
  }else if(type==='bom-prepare'){
   const wanted=this.id==='SF-02'?'kit-4-4-16':this.id==='SF-04'?'ensamble-1-1-4':'contenido-caja-etiqueta';
   if(!this.state.order||payload.method!==wanted||!this.machine())throw Error('Revisa la orden, la herramienta y la receta compatible.');this.state.prepared=true;
  }else if(type==='bom-cycle'){
   const main=this.id==='SF-02'?'E03':'E02',allowed=[main].concat(this.id==='SF-04'||this.id==='CEDI-04'?['E03']:[]),record=allowed.includes(payload.station)&&this.alias(payload.station),p=record&&record.components.processor;
   if(!this.state.prepared||!p||p.emergency)throw Error('Carga físicamente la entrada y verifica la estación preparada y sin emergencia.');
   if(p.jobs.length)return{accepted:true,message:'El ciclo nativo ya está en curso; espera su salida antes de solicitar otro.'};
   if(!p.input.queue.length)throw Error('Carga físicamente la entrada antes de solicitar el ciclo.');
   if(payload.station===main)bom.prepare(this.id,p.input.queue.slice(0,p.config.combineCount),this.recipe.stock);
   else if(p.input.queue.some(entry=>!entry.spec.operationState||entry.spec.operationState.sourcePractice!==this.id))throw Error('La inspección o cierre requiere productos fabricados por esta orden.');
   this.cycles.request(record);
  }else if(type==='bom-inspect'){
   const row=this.outputs(o).find(row=>row.id===payload.loadId);
   if(!row||row.held||Number(payload.quantity)!==row.quantity||payload.condition!=='conforme'||!this.completeInspection(row))throw Error('La identidad, cantidad, ensayo o estado de esa unidad física no permiten liberarla.');
   this.state.quality[row.id]={quantity:row.quantity,ownerId:row.ownerId,time:this.runtime.time};
  }else if(type==='bom-secure'){
   if(this.id==='SF-02'){
    const station=this.alias('E07');if(!station||this.count(this.released(o))!==3||payload.ready!=='util-receta-y-entradas-verificadas')throw Error('Entrega los tres kits al consumo y comprueba el útil y la receta de la estación real.');this.state.stationReady=true;
   }else{
    const row=this.outputs(o).find(row=>row.id===payload.loadId),product=row&&row.product;
    if(!row||!row.assemblyComplete||row.held||!product||!product.item||!product.item.palletOwnerId||payload.secured!=='patron-y-sujecion-verificados')throw Error('Forma primero un pallet físico, apoyado y completo; después verifica su patrón y sujeción.');
    for(const member of this.outputs(o).filter(value=>value.assemblyId===row.assemblyId))this.state.secured[member.id]={ownerId:product.item.palletOwnerId,time:this.runtime.time};
   }
  }else if(type==='bom-close'){
   if(Number(payload.quantity)!==this.required()||!this.canClose(o))throw Error('Aún faltan unidades identificadas, componentes conciliados o entrega física al destino correcto.');this.state.closed=true;
  }else throw Error('Acción BOM no admitida.');
  this.save();const actor=this.machine();if(actor)this.runtime.event(actor.id,'configurable-'+type,this.id);return{accepted:true,message:type==='bom-cycle'?'Ciclo nativo solicitado: observa el proceso y retira su salida.':'Registro contrastado con las existencias y posiciones reales.'};
 }
 canClose(o){
  const rows=this.finalRows(o);if(this.count(rows)!==this.required()||o.criticalReasons.length)return false;
  if(this.id==='SF-02')return this.state.stationReady;
  if(this.id==='SF-04')return true;
  return rows.every(row=>this.state.secured[row.id]);
 }
 update(){this.cycles.update();}
 snapshot(){
  if(!SUPPORTED.includes(this.id))return{stageConditions:Array(6).fill(false)};
  const o=this.observe(),outputs=this.outputs(o),processed=this.count(outputs),delivered=this.count(this.finalRows(o)),quality=outputs.length>0&&outputs.every(row=>this.state.quality[row.id]),secured=outputs.length>0&&outputs.every(row=>this.state.secured[row.id]),complete=delivered===this.required();
  let conditions;
  if(this.id==='SF-02')conditions=[this.state.order,this.state.prepared,processed===3,complete,this.state.stationReady,this.state.closed&&this.canClose(o)];
  else if(this.id==='SF-04')conditions=[this.state.order,this.state.prepared,processed===12,quality&&outputs.every(row=>this.completeInspection(row)),complete,this.state.closed&&this.canClose(o)];
  else if(this.id==='CEDI-04')conditions=[this.state.order,this.state.prepared&&processed===12,quality,outputs.length>0&&outputs.every(row=>row.product&&row.product.item&&row.product.item.palletOwnerId),secured,this.state.closed&&this.canClose(o)];
  else conditions=[this.state.order,this.state.prepared&&processed===12,secured,complete,complete,this.state.closed&&this.canClose(o)];
  return{stageConditions:conditions.map(Boolean),identified:!!this.state.order,prepared:!!this.state.prepared,processedUnits:processed,receiverUnits:delivered,finalizedUnits:delivered,documentValidated:!!this.state.order,destinationConfirmed:complete,criticalReasons:o.criticalReasons,ledger:copy(this.state)};
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.cycles.dispose();for(const remove of this.unbind)remove();this.unbind=[];}
}
