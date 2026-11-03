import MaterialPracticeRuntime from './MaterialPracticeRuntime.js';

const GUARDS=['identify','prepare','operate','inspect','deliver','close'];
const copy=value=>JSON.parse(JSON.stringify(value));
const options=values=>values.map(value=>({value,label:String(value)}));

/** A receiving ledger over the existing native product/vehicle/store owners.
 * It never creates stock, edits poses, deposits a pallet or awards completion.
 * Documentary decisions are coupled to observable material before acceptance.
 */
export default class ConfigurablePracticeRuntime{
 constructor(editor,manifest){
  if(manifest.materialRecipe)return new MaterialPracticeRuntime(editor,manifest);
  this.editor=editor;this.runtime=editor.simulation;this.manifest=manifest;this.lastMessage='Revisa la orden y el muelle; conduce con los controles nativos.';this.disposed=false;
  const restored=manifest.workflowState;
  this.state=restored&&restored.version===1?copy(restored):{version:1,arrival:null,secured:false,inspections:{},dispositions:{},registrations:{},unloaded:[],closed:false};
  this.ids=(manifest.palletIds||manifest.productIds||[]).slice();this.receiving=manifest.receiving||{};
  if(manifest.practiceId==='CEDI-01'&&manifest.availability&&manifest.availability.ready&&this.runtime.setVariable)(manifest.vehicleIds||[]).forEach(id=>this.runtime.setVariable(id,'enabled',this.state.secured===true));
 }
 live(){if(this.disposed||this.runtime.active===false)throw Error('El intento ya no está activo.');}
 alias(alias){const row=(this.manifest.aliases||[]).find(row=>row.alias===alias),record=row&&this.runtime.records.get(row.objectId);return record&&record.object&&record.object.parent?record:null;}
 product(id){return Array.from(this.runtime.products.values()).find(product=>product.record&&product.record.id===id||product.object&&product.object.userData.editorId===id);}
 owner(product){return product&&product.sourceEntry&&product.sourceEntry.ownerId||product&&product.item&&product.item.palletOwnerId||product&&product.vehicleOwnerId||'';}
 observe(){
  const units=[],missing=[],unexpected=[],duplicates=[],custodyMismatch=[],custody=new Map(),sourceIds=new Set(this.manifest.sourceIds||[]),receivers=new Set(this.manifest.receiverIds||[]),quarantine=new Set(this.receiving.quarantineIds||[]),inspection=new Set(this.receiving.inspectionIds||[]);
  const own=(entry,record)=>{if(!entry||!entry.product)return;const rows=custody.get(entry.product)||[];rows.push(record.id);custody.set(entry.product,rows);};
  this.runtime.records.forEach(record=>{const c=record.components;if(c.source)(c.source.queue||[]).forEach(entry=>own(entry,record));if(c.palletQueue)(c.palletQueue.queue||[]).forEach(entry=>own(entry,record));if(c.processor){(c.processor.input.queue||[]).forEach(entry=>own(entry,record));(c.processor.output.queue||[]).forEach(entry=>own(entry,record));(c.processor.jobs||[]).forEach(job=>(job.inputs||[]).forEach(entry=>own(entry,record)));}if(c.vehicle&&c.vehicle.entry)own(c.vehicle.entry,record);if(c.robot&&c.robot.entry)own(c.robot.entry,record);if(c.conveyor)(c.conveyor.packages||[]).forEach(item=>{const product=item.product;if(product&&product.sourceEntry)own(product.sourceEntry,record);});});
  for(const id of this.ids){const product=this.product(id);if(!product){missing.push(id);continue;}const metadata=this.runtime.productMetadata(product),owners=custody.get(product)||[],owner=owners[0]||this.owner(product),vehicle=product.vehicleOwnerId&&this.runtime.records.get(product.vehicleOwnerId),v=vehicle&&vehicle.components.vehicle;
   const position=product.object.getWorldPosition(product.object.position.clone()),inInspection=inspection.has(owner)||!!(v&&Math.abs(v.actualSpeed)<.06&&position.y<.6&&Math.hypot(position.x-this.receiving.inspectionCenter[0],position.z-this.receiving.inspectionCenter[2])<=2.2);
   if(owners.length>1)duplicates.push(id);if(owners.length!==1||product.sourceEntry&&product.sourceEntry.ownerId&&product.sourceEntry.ownerId!==owner)custodyMismatch.push(id);
   if(Number(metadata.units)!==8||Math.abs(Number(metadata.mass)-60)>.01||metadata.loadMode!=='pallet')unexpected.push(id);
   if(!sourceIds.has(owner)&&owner&&!this.state.unloaded.includes(id))this.state.unloaded.push(id);
   units.push({id,sku:metadata.sku,units:Number(metadata.units)||0,massKg:Number(metadata.mass)||0,ownerId:owner,quality:metadata.quality||'good',held:!!v,vehicleId:vehicle&&vehicle.id||'',position:position.toArray(),inInspection,inSource:sourceIds.has(owner),inReleased:receivers.has(owner),inQuarantine:quarantine.has(owner)});
  }
  const foreignIds=Array.from(this.runtime.products.values()).filter(product=>!this.ids.includes(product.record&&product.record.id||product.object&&product.object.userData.editorId)).map(product=>product.record&&product.record.id||product.object.uuid);
  const materialBalance={expectedPallets:6,actualPallets:units.length,expectedUnits:48,actualUnits:units.reduce((sum,row)=>sum+row.units,0),missing,duplicates,custodyMismatch,invalidMetadata:unexpected,foreignIds};
  const criticalReasons=[];if(missing.length)criticalReasons.push('Faltan pallets físicos identificados.');if(duplicates.length)criticalReasons.push('Una carga presenta más de una custodia activa.');if(custodyMismatch.length)criticalReasons.push('La identidad no coincide con su cola de custodia real.');if(unexpected.length)criticalReasons.push('La carga real no coincide con 8 cajas / 60 kg por pallet.');if(foreignIds.length)criticalReasons.push('Hay cargas ajenas a la orden de seis pallets.');if(materialBalance.actualUnits!==48)criticalReasons.push('El balance no conserva las 48 cajas de la orden.');if((this.manifest.aliases||[]).some(row=>!this.alias(row.alias)))criticalReasons.push('Falta un actor nativo del montaje original.');
  return {units,materialBalance,criticalReasons};
 }
 save(){
  this.manifest.workflowState=copy(this.state);
  const doc=this.editor.document,studio=doc&&doc.studio;if(!doc||!studio||!doc.setStudio)return;
  const moduleData=Object.assign({},studio.moduleData||{}),data=Object.assign({},moduleData['sector.logistics-industrial']||{});
  data.levels=(data.levels||[]).map(row=>row.roomId===this.manifest.roomId&&row.practiceId===this.manifest.practiceId?Object.assign({},row,{workflowState:copy(this.state)}):row);moduleData['sector.logistics-industrial']=data;doc.setStudio({moduleData});
 }
 actions(){
  if(this.manifest.practiceId!=='CEDI-01'||!this.manifest.availability||!this.manifest.availability.ready)return[];
  const rows=this.observe().units,palletOptions=rows.map(row=>({value:row.id,label:row.sku+' · '+(row.inInspection?'en inspección':row.inSource?'en camión':row.inReleased?'entregado':'en traslado')})),palletField={key:'palletId',label:'Pallet real',type:'choice',options:palletOptions};
  return [
   {id:'arrival-check',title:'Contrastar cita, vehículo y orden',actorAliases:['E01','E02','E08'],fields:[{key:'orderId',label:'Orden visible en la guía',type:'choice',options:options([this.receiving.orderId,'ORD-OTRA'])},{key:'boxes',label:'Cajas en la orden',type:'number',hint:'6 pallets × 8 cajas'},{key:'dockId',label:'Muelle asignado',type:'choice',options:options(['E02','OTRO-MUELLE'])}],enabled:!this.state.arrival,reason:this.state.arrival?'Orden ya contrastada.':''},
   {id:'secure-dock',title:'Verificar calzos y habilitación del muelle',actorAliases:['E01','E02'],fields:[{key:'secured',label:'Comprobación de retención y borde',type:'choice',options:[{value:'checked',label:'Calzos, borde y muelle revisados'},{value:'not-checked',label:'Sin revisar'}]}],enabled:!!this.state.arrival&&!this.state.secured,reason:!this.state.arrival?'Contrasta primero la orden.':this.state.secured?'Muelle ya habilitado.':''},
   {id:'inspect-pallet',title:'Contar e inspeccionar el pallet en E04',actorAliases:['E03','E04'],fields:[palletField,{key:'boxes',label:'Cajas observadas',type:'number'},{key:'massKg',label:'Masa total con tara (kg)',type:'number'},{key:'lotId',label:'Lote de la etiqueta',type:'choice',options:options([this.receiving.lotId,'LOTE-OTRO'])}],enabled:!!this.state.secured,reason:this.state.secured?'':'Asegura primero el muelle y traslada el pallet a E04.'},
   {id:'disposition',title:'Decidir la condición de calidad',actorAliases:['E04','E05','E07'],fields:[palletField,{key:'decision',label:'Disposición',type:'choice',options:[{value:'released',label:'Liberar · conforme'},{value:'quarantine',label:'Retener · no conforme'}]}],enabled:Object.keys(this.state.inspections).length>0,reason:'Cada pallet requiere inspección real previa.'},
   {id:'register-pallet',title:'Registrar la recepción sin duplicar existencias',actorAliases:['E04','E08'],fields:[palletField,{key:'orderId',label:'Documento',type:'choice',options:options([this.receiving.orderId,'ORD-OTRA'])}],enabled:Object.keys(this.state.dispositions).length>0,reason:'Registra cada identidad después de decidir su calidad.'},
   {id:'confirm-handover',title:'Conciliar y cerrar la entrega a CEDI-02',actorAliases:['E07','E08'],fields:[{key:'boxes',label:'Cajas conciliadas',type:'number'}],enabled:Object.keys(this.state.registrations).length===6,reason:'Las seis cargas deben estar registradas y físicamente depositadas.'}
  ];
 }
 command(type,payload={}){
  this.live();if(this.manifest.practiceId!=='CEDI-01'||!this.manifest.availability||!this.manifest.availability.ready)throw Error('Este montaje aún no dispone de evaluación material validada.');
  const observation=this.observe();if(observation.criticalReasons.length)throw Error(observation.criticalReasons.join(' '));
  const pallet=observation.units.find(row=>row.id===payload.palletId);
  if(type==='arrival-check'){
   if(payload.orderId!==this.receiving.orderId||Number(payload.boxes)!==48||payload.dockId!=='E02'||!this.alias('E01')||!this.alias('E02'))throw Error('La cita, el muelle o las 48 cajas no coinciden con la orden real.');
   this.state.arrival={orderId:payload.orderId,truckId:this.alias('E01').id,dockId:this.alias('E02').id,boxes:48,time:this.runtime.time};this.lastMessage='Orden de 48 cajas asociada al camión y al muelle E02.';
  }else if(type==='secure-dock'){
   if(!this.state.arrival||payload.secured!=='checked')throw Error('Revisa la retención, el borde y la disponibilidad del muelle antes de descargar.');
   this.state.secured=true;(this.manifest.vehicleIds||[]).forEach(id=>this.runtime.setVariable(id,'enabled',true));this.lastMessage='Muelle verificado. Descarga cada pallet con el montacargas nativo hacia E04.';
  }else if(type==='inspect-pallet'){
   if(!this.state.secured||!pallet||pallet.inSource||!pallet.inInspection)throw Error('Traslada y detén ese pallet en la zona real E04; no se inspecciona desde el camión ni en marcha.');
   if(Number(payload.boxes)!==pallet.units||Number(payload.massKg)!==pallet.massKg||payload.lotId!==this.receiving.lotId)throw Error('El conteo, la masa con tara o el lote no coinciden con la carga observada.');
   this.state.inspections[pallet.id]={units:pallet.units,massKg:pallet.massKg,lotId:payload.lotId,ownerId:pallet.ownerId,time:this.runtime.time};this.lastMessage='Pallet inspeccionado: 8 cajas, 60 kg con tara y lote contrastado.';
  }else if(type==='disposition'){
   if(!pallet||!this.state.inspections[pallet.id])throw Error('Inspecciona esta identidad antes de decidir la calidad.');
   const expected=pallet.quality==='good'?'released':'quarantine';if(payload.decision!==expected)throw Error('La decisión no corresponde al estado físico y la calidad de ese pallet.');
   this.state.dispositions[pallet.id]={decision:expected,time:this.runtime.time};this.lastMessage=expected==='released'?'Carga conforme: puede ir a E07.':'Carga retenida: deposítala en E05.';
  }else if(type==='register-pallet'){
   if(!pallet||!this.state.dispositions[pallet.id]||payload.orderId!==this.receiving.orderId)throw Error('Relaciona identidad, inspección, calidad y orden antes de registrar.');
   if(!this.state.registrations[pallet.id])this.state.registrations[pallet.id]={orderId:payload.orderId,lotId:this.receiving.lotId,units:pallet.units,quality:this.state.dispositions[pallet.id].decision,time:this.runtime.time};
   this.lastMessage='Recepción registrada una sola vez. La acción no crea ni mueve existencias.';
  }else if(type==='confirm-handover'){
   if(Number(payload.boxes)!==48||this.ids.some(id=>!this.state.registrations[id])||observation.units.some(row=>this.state.dispositions[row.id].decision==='released'?!row.inReleased:!row.inQuarantine))throw Error('Deposita todas las cargas en sus destinos reales y concilia las 48 cajas antes del cierre.');
   this.state.closed=true;this.lastMessage='Las 48 cajas están conciliadas en destinos físicos; recepción cerrada.';
  }else throw Error('Acción de práctica no admitida.');
  const actor=this.alias(type==='arrival-check'||type==='register-pallet'?'E08':type==='confirm-handover'?'E07':type==='secure-dock'?'E02':'E04');if(actor)this.runtime.event(actor.id,'configurable-'+type,this.manifest.practiceId+' · '+(pallet?pallet.sku:this.receiving.orderId));this.save();return{accepted:true,message:this.lastMessage};
 }
 snapshot(){
  this.live();const o=this.observe(),conserved=!o.criticalReasons.length,all=map=>this.ids.length===6&&this.ids.every(id=>map[id]),prepared=!!(this.state.arrival&&this.state.secured),conditions=[!!this.state.arrival,prepared&&this.state.unloaded.length===6&&o.units.every(row=>!row.inSource),all(this.state.inspections),all(this.state.dispositions)&&o.units.every(row=>this.state.dispositions[row.id].decision===(row.quality==='good'?'released':'quarantine')),all(this.state.registrations),this.state.closed&&all(this.state.registrations)&&o.units.every(row=>this.state.dispositions[row.id].decision==='released'?row.inReleased:row.inQuarantine)];
  // Saved forms cannot stand in for a new material run. Every later stage
  // retains all earlier live preconditions, including actual source removal.
  for(let index=1;index<conditions.length;index++)conditions[index]=conditions[index]&&conditions[index-1];
  const stageEvidence=conditions.flatMap((ok,index)=>ok&&conserved?[{guard:GUARDS[index],eventId:this.manifest.stageBindings[index].requiredEvent,actorAliases:this.manifest.stageBindings[index].actorAliases.slice(),quantity:index?48:6,time:this.runtime.time,details:{palletIds:this.ids.slice(),physicalUnits:o.materialBalance.actualUnits,registeredPallets:Object.keys(this.state.registrations).length}}]:[]),sourceUnits=o.units.filter(row=>row.inSource).reduce((s,row)=>s+row.units,0),receiverUnits=o.units.filter(row=>row.inReleased).reduce((s,row)=>s+row.units,0),retainedUnits=o.units.filter(row=>row.inQuarantine).reduce((s,row)=>s+row.units,0);
  return {sourceUnits,processedUnits:Math.max(0,48-sourceUnits),receiverUnits,retainedUnits,finalizedUnits:receiverUnits+retainedUnits,totalUnits:o.materialBalance.actualUnits,initialUnits:48,time:this.runtime.time,blocked:!conserved,paused:false,emergency:(this.manifest.vehicleIds||[]).some(id=>{const record=this.runtime.records.get(id);return record&&record.components.vehicle&&record.components.vehicle.emergency;}),selectedSku:this.manifest.sku,identified:!!this.state.arrival,prepared,documentValidated:all(this.state.registrations),destinationConfirmed:conditions[5],faultInjected:false,faultRecovered:true,stageEvidence,criticalReasons:o.criticalReasons,materialBalance:o.materialBalance,pallets:o.units,ledger:copy(this.state)};
 }
 dispose(){this.disposed=true;}
}
