import PracticeMaterialOperations from './PracticeMaterialOperations.js';
import PracticeCycleInterlock from './PracticeCycleInterlock.js';

const GUARDS=['identify','prepare','operate','inspect','deliver','close'];
const clone=value=>JSON.parse(JSON.stringify(value));
const choices=values=>values.map(value=>typeof value==='object'?value:{value,label:String(value)});
const add=(target,key,value)=>{target[key]=(target[key]||0)+value;};
const equalVector=(a,b)=>[...new Set(Object.keys(a).concat(Object.keys(b)))].every(key=>Math.abs((a[key]||0)-(b[key]||0))<1e-7);

/** A workflow over native custody. Authoring seeds finite real products; hands,
 * vehicles and machines own their movement and discrete transformations. This
 * observer rejects duplicated/lost leaves and never assigns object transforms.
 */
export default class MaterialPracticeRuntime{
 constructor(editor,manifest){
  this.editor=editor;this.runtime=editor.simulation;this.manifest=manifest;this.recipe=manifest.materialRecipe;this.disposed=false;
  if(!this.recipe||this.recipe.version!==1||this.recipe.practiceId!==manifest.practiceId)throw Error('Falta la receta material de esta práctica.');
  this.state=manifest.materialWorkflowState&&manifest.materialWorkflowState.version===1?clone(manifest.materialWorkflowState):{version:1,order:false,prepared:false,locations:{},putaway:[],inspected:{},registered:{},shortages:false,closed:false};
  this.seedErrors=[];this.lastMessage='Consulta la orden, identifica los materiales reales y usa las manos o el vehículo asignado para trasladarlos.';
  this.seedInitialCustody();this.cycles=new PracticeCycleInterlock(this.runtime);
  this.operations=new PracticeMaterialOperations(editor,manifest,{observe:()=>this.observe(),save:()=>this.save()});
 }
 live(){if(this.disposed||this.runtime.active===false)throw Error('El ensayo material ya no está activo.');}
 alias(value){const row=(this.manifest.aliases||[]).find(row=>row.alias===value),record=row&&this.runtime.records.get(row.objectId);return record&&record.object&&record.object.parent?record:null;}
 product(objectId){return Array.from(this.runtime.products.values()).find(p=>p.record&&p.record.id===objectId||p.object&&p.object.userData.editorId===objectId);}
 seedInitialCustody(){
  const api=this.runtime.palletQueueRuntime;
  for(const stock of this.recipe.stock){
   const product=this.product(stock.objectId),source=this.runtime.records.get(stock.sourceId);
   if(!product||!source||!source.components.palletQueue){this.seedErrors.push('No existe el material o apoyo inicial '+stock.sku+'.');continue;}
   if(product.sourceEntry&&product.sourceEntry.ownerId===source.id)continue;
   // A saved initial label does not permit a stock transfer. The actual body
   // must already rest at the intended native seat, within assembly tolerance.
   product.object.updateWorldMatrix(true,true);const center=product.bounds.clone().applyMatrix4(product.object.matrixWorld).getCenter(product.object.position.clone()),placement=api.placement(source,product,[],center);
   if(!placement){this.seedErrors.push('El apoyo inicial no admite '+stock.sku+'.');continue;}
   const wanted=product.object.position.clone().setFromMatrixPosition(placement.matrix),actual=product.object.getWorldPosition(product.object.position.clone());
   if(actual.distanceTo(wanted)>.18){this.seedErrors.push('El material inicial no está apoyado en su posición '+stock.sku+'.');continue;}
   const entry=this.runtime.sourceRuntime.entryForProduct(source,product);
   if(!api.receive(source,entry,true,placement))this.seedErrors.push('No se pudo registrar la custodia inicial '+stock.sku+'.');
  }
 }
 vector(entry){
  const vector={},leaves=this.runtime.processorRuntime.leaves([entry]);
  for(const leaf of leaves){const stock=this.recipe.stock.find(row=>row.sku===leaf.spec.id);if(!stock)continue;if(stock.materials)for(const [material,quantity]of Object.entries(stock.materials))add(vector,material,quantity*leaf.units/stock.quantity);else add(vector,stock.material,leaf.units);}
  return vector;
 }
 quantity(vector){const id=this.manifest.practiceId;return id==='SF-02'?(vector.body||0)/4:id==='SF-01'||id==='SF-03'||id==='SF-04'?vector.body||0:id==='CEDI-04'||id==='SF-05'?vector.finished||0:vector.box||0;}
 observe(){
  const entries=[],quantities={},leafQuantities={},duplicates=[],custodyMismatch=[],owners=new Map(),seen=new Set(),expectedLeaves=new Map(this.recipe.stock.map(row=>[row.sku,row.quantity]));
  const own=(entry,record)=>{if(!entry)return;const rows=owners.get(entry)||[];rows.push(record.id);owners.set(entry,rows);};
  this.runtime.records.forEach(record=>{const c=record.components;if(c.source)(c.source.queue||[]).forEach(entry=>own(entry,record));if(c.palletQueue)(c.palletQueue.queue||[]).forEach(entry=>own(entry,record));if(c.processor){c.processor.input.queue.forEach(entry=>own(entry,record));c.processor.output.queue.forEach(entry=>own(entry,record));c.processor.jobs.forEach(job=>(job.results||job.inputs||[]).forEach(entry=>own(entry,record)));}if(c.vehicle&&c.vehicle.entry)own(c.vehicle.entry,record);if(c.robot&&c.robot.entry)own(c.robot.entry,record);});
  for(const entry of this.runtime.sourceRuntime.entries){
   const vector=this.vector(entry);if(!Object.keys(vector).length)continue;
   if(seen.has(entry))continue;seen.add(entry);const leafs=this.runtime.processorRuntime.leaves([entry]);
   for(const leaf of leafs)if(expectedLeaves.has(leaf.spec.id))add(leafQuantities,leaf.spec.id,leaf.units);
   for(const [material,value]of Object.entries(vector))add(quantities,material,value);
   const memberships=owners.get(entry)||[],product=entry.product,hand=!!(product&&product.heldBy),vehicle=product&&product.vehicleOwnerId&&this.runtime.records.get(product.vehicleOwnerId),ownerId=memberships[0]||entry.ownerId||'',record=this.runtime.records.get(ownerId);
   if(memberships.length>1)duplicates.push(entry.id);
   if((!hand&&memberships.length!==1)||memberships.length===1&&entry.ownerId!==ownerId)custodyMismatch.push(entry.id);
   const position=product&&product.object.getWorldPosition(product.object.position.clone()).toArray(),source=this.manifest.sourceIds.includes(ownerId),receiver=this.manifest.receiverIds.includes(ownerId),rack=!!(record&&record.components.palletQueue&&record.components.palletQueue.rack);
   const row={id:entry.id,objectId:product&&product.record&&product.record.id||product&&product.object.userData.editorId||'',sku:entry.spec.id,entry,product,ownerId,quantity:this.quantity(vector),materials:vector,units:entry.units,massKg:product?this.runtime.productMetadata(product).mass:leafs.reduce((sum,leaf)=>sum+(Number(leaf.spec.mass)||0)*leaf.units,0),inSource:source,inReleased:receiver,inRack:rack,held:hand||!!vehicle,vehicleId:vehicle&&vehicle.id||'',position,quality:entry.spec.quality||'good',operationState:entry.spec.operationState||{},operationHistory:entry.spec.operationHistory||[]};
   entries.push(row);if(rack&&row.objectId&&!this.state.putaway.includes(row.objectId))this.state.putaway.push(row.objectId);
  }
  const missing=[];for(const [sku,quantity]of expectedLeaves)if(Math.abs((leafQuantities[sku]||0)-quantity)>1e-7)missing.push({sku,expected:quantity,actual:leafQuantities[sku]||0});
  const criticalReasons=this.seedErrors.slice();if(missing.length)criticalReasons.push('La genealogía no conserva todas las unidades originales.');if(!equalVector(quantities,this.recipe.quantities))criticalReasons.push('El balance por referencia no coincide con los insumos iniciales.');if(duplicates.length)criticalReasons.push('Una carga tiene más de una custodia física.');if(custodyMismatch.length)criticalReasons.push('Una carga no coincide con su custodia nativa.');if((this.manifest.aliases||[]).some(row=>!this.alias(row.alias)))criticalReasons.push('Falta un equipo del montaje original.');
  return{entries,quantities,leafQuantities,criticalReasons,materialBalance:{expected:clone(this.recipe.quantities),actual:quantities,missing,duplicates,custodyMismatch,conserved:criticalReasons.length===0}};
 }
 save(){this.manifest.materialWorkflowState=clone(this.state);const doc=this.editor.document,studio=doc&&doc.studio;if(!doc||!studio||!doc.setStudio)return;const moduleData=Object.assign({},studio.moduleData||{}),sector=Object.assign({},moduleData['sector.logistics-industrial']||{});sector.levels=(sector.levels||[]).map(row=>row.practiceId===this.manifest.practiceId&&row.roomId===this.manifest.roomId?Object.assign({},row,{materialWorkflowState:clone(this.state)}):row);moduleData['sector.logistics-industrial']=sector;doc.setStudio({moduleData});}
 palletField(){return{key:'palletId',label:'Carga real',type:'choice',options:choices(this.recipe.stock.map(stock=>({value:stock.objectId,label:stock.sku+' · '+stock.quantity+' unidades'})))};}
 actions(){
  const id=this.manifest.practiceId;if(!['CEDI-02','CEDI-03','CEDI-05','SF-01','SF-03'].includes(id))return this.operations.actions();
  const common=[{id:'material-order',title:'Contrastar orden y cantidad',actorAliases:[id==='SF-03'?'E07':id==='CEDI-02'?'E06':id==='CEDI-03'?'E01':id==='CEDI-05'?'E07':'E08'],fields:[{key:'orderId',label:'Orden',type:'choice',options:choices([this.recipe.orderId,'ORD-OTRA'])},{key:'quantity',label:id==='SF-01'?'Juegos de componentes disponibles':'Unidades de la orden',type:'number'}],enabled:!this.state.order,reason:'Compara el documento con las cargas identificadas.'},
   {id:'material-prepare',title:id==='CEDI-03'?'Elegir picking por bulto de cuatro cajas':'Preparar ruta, medios y condiciones',actorAliases:(this.manifest.aliases||[]).map(row=>row.alias),fields:[{key:'method',label:'Método compatible',type:'choice',options:choices(id==='CEDI-03'?['bulto-cuatro-cajas','sin-identificar']:id==='SF-03'?['mecanizado-con-sujecion','sin-sujecion']:['ruta-y-capacidad-verificadas','sin-verificar'])}],enabled:!!this.state.order&&!this.state.prepared,reason:'Confirma un método acorde con la unidad de manipulación.'}];
  if(id==='CEDI-02')common.push({id:'assign-stock-location',title:'Reservar ubicación de cada pallet',actorAliases:['E02','E03','E06'],fields:[this.palletField(),{key:'locationCode',label:'Código de ubicación',type:'choice',options:choices(this.manifest.tasks.slice(0,6).map(task=>{const r=this.runtime.records.get(task.destinationId),cell=r&&this.runtime.palletQueueRuntime.locations(r).find(c=>c.index===task.destinationSlot);return cell&&cell.code;}).filter(Boolean))}],enabled:!!this.state.order,reason:'La carga y su dirección deben coincidir.'});
  if(id==='SF-03')common.push({id:'start-material-cycle',title:'Cargar receta y solicitar ciclo real',actorAliases:['E02','E03','E04'],fields:[{key:'station',label:'Estación',type:'choice',options:choices(['E02','E03','E04'])}],enabled:!!this.state.prepared,reason:'Deposita el contenedor en la entrada física antes del ciclo.'});
  if(id==='CEDI-05')common.push({id:'secure-material-dock',title:'Comprobar vehículo y habilitar muelle',actorAliases:['E05','E06'],fields:[{key:'secured',label:'Comprobación del muelle',type:'choice',options:choices(['calzos-borde-y-acceso-verificados','sin-verificar'])}],enabled:!!this.state.prepared&&!this.state.secured,reason:'El vehículo de salida debe permanecer parado durante la carga.'});
  common.push({id:'material-inspect',title:id==='CEDI-03'?'Conciliar recogida y faltantes':'Contrastar cantidad, calidad y ubicación',actorAliases:(this.manifest.aliases||[]).filter(row=>['inspection','terminal','storage'].includes(row.role)).map(row=>row.alias),fields:[{key:'quantity',label:'Cantidad física contrastada',type:'number'},{key:'quality',label:'Condición observada',type:'choice',options:choices(['conforme','retenido'])}],enabled:!!this.state.prepared,reason:'El registro requiere el material fuera del origen y físicamente disponible.'},
   {id:'material-close',title:'Conciliar y cerrar la operación',actorAliases:(this.manifest.aliases||[]).map(row=>row.alias),fields:[{key:'quantity',label:'Cantidad conciliada',type:'number'}],enabled:Object.keys(this.state.inspected).length>0,reason:'Completa el traslado y la entrega física antes del cierre.'});
  if(id==='SF-01')common.splice(common.length-1,0,{id:'register-material-lot',title:'Registrar lote de materias primas',actorAliases:['E08'],fields:[{key:'orderId',label:'Orden',type:'choice',options:choices([this.recipe.orderId,'ORD-OTRA'])},{key:'lotId',label:'Lote observado',type:'choice',options:choices(['LOT-'+id+'-001','LOT-OTRO'])}],enabled:!!this.state.inspected.order,reason:'Sólo se registra el mismo material previamente inspeccionado.'});
  return common;
 }
 expected(){return this.manifest.expectedUnits;}
 command(type,payload={}){
  this.live();const o=this.observe();if(o.criticalReasons.length)throw Error(o.criticalReasons.join(' '));const id=this.manifest.practiceId;
  if(!['CEDI-02','CEDI-03','CEDI-05','SF-01','SF-03'].includes(id))return this.operations.command(type,payload);
  if(type==='material-order'){
   if(payload.orderId!==this.recipe.orderId||Number(payload.quantity)!==this.expected())throw Error('La orden o cantidad no corresponde al lote físico.');this.state.order=true;this.lastMessage='Orden contrastada con las identidades y cantidades originales.';
  }else if(type==='material-prepare'){
   const wanted=id==='CEDI-03'?'bulto-cuatro-cajas':id==='SF-03'?'mecanizado-con-sujecion':'ruta-y-capacidad-verificadas';if(!this.state.order||payload.method!==wanted)throw Error('Revisa primero la orden y el método compatible.');this.state.prepared=true;this.lastMessage='Medios preparados. Traslada el material con los controles nativos.';
  }else if(type==='assign-stock-location'){
   const task=this.manifest.tasks.find(row=>row.productId===payload.palletId),record=task&&this.runtime.records.get(task.destinationId),cell=record&&this.runtime.palletQueueRuntime.locations(record).find(row=>row.index===task.destinationSlot);
   if(!this.state.order||!task||!cell||payload.locationCode!==cell.code)throw Error('Relaciona este pallet con el código asignado a su misión de reserva.');this.runtime.palletQueueRuntime.assignLocation(record,{palletId:payload.palletId,locationCode:cell.code});this.state.locations[payload.palletId]=cell.code;this.lastMessage='Ubicación reservada en el rack real: '+cell.code+'.';
  }else if(type==='start-material-cycle'){
   const record=this.alias(payload.station),p=record&&record.components.processor;if(!this.state.prepared||!['E02','E03','E04'].includes(payload.station)||!p||!p.input.queue.length||p.jobs.length)throw Error('Prepara la celda y coloca el contenedor en la entrada real de la estación.');
   if(payload.station==='E03'&&p.input.queue.some(entry=>!entry.spec.operationState||!entry.spec.operationState.fixtureVerified))throw Error('Comprueba la sujeción en E02 antes de mecanizar.');
   if(payload.station==='E04'&&p.input.queue.some(entry=>!entry.spec.operationState||entry.spec.operationState.manufacturingStage!=='machine'))throw Error('La medición requiere cuerpos mecanizados en E03.');
   this.cycles.request(record);this.lastMessage='Ciclo solicitado al procesador nativo; espera su salida antes de retirar material.';
  }else if(type==='secure-material-dock'){
   const truck=this.alias('E06'),component=truck&&(truck.components.vehicle||truck.components.robot);if(!this.state.prepared||payload.secured!=='calzos-borde-y-acceso-verificados'||!component||component.actualSpeed&&Math.abs(component.actualSpeed)>.02||component.running)throw Error('Detén el camión y comprueba calzos, acceso y borde antes de habilitar la carga.');this.state.secured=true;this.lastMessage='Muelle comprobado; carga por el medio nativo conservando las identidades.';
  }else if(type==='register-material-lot'){
   if(!this.state.inspected.order||payload.orderId!==this.recipe.orderId||payload.lotId!=='LOT-'+id+'-001')throw Error('El lote, orden o inspección no coincide con el material real.');this.state.registered.lot={orderId:payload.orderId,lotId:payload.lotId,quantity:this.expected(),time:this.runtime.time};this.lastMessage='Lote registrado una sola vez; se conserva la misma existencia física.';
  }else if(type==='material-inspect'){
   const physical=this.processed(o),wanted=id==='CEDI-03'?12:this.expected();if(!this.state.prepared||physical+1e-7<wanted||Number(payload.quantity)!==wanted||payload.quality!=='conforme'||o.entries.some(row=>row.held&&row.quantity))throw Error('La cantidad, calidad o posición real no permite confirmar esta inspección.');
   this.state.inspected.order={quantity:wanted,time:this.runtime.time};this.lastMessage='Conteo y condición contrastados con las mismas cargas físicas.';
  }else if(type==='material-close'){
   const target=this.finalized(o);if(!this.state.inspected.order||Number(payload.quantity)!==this.expected()||target+1e-7<this.expected())throw Error('Completa la entrega real y concilia todas las unidades antes de cerrar.');this.state.closed=true;this.lastMessage='Operación cerrada con conservación por referencia y destinos físicos confirmados.';
  }else throw Error('Acción material no admitida.');
  const actor=this.alias((this.manifest.aliases.find(row=>row.role==='terminal')||this.manifest.aliases[0]).alias);if(actor)this.runtime.event(actor.id,'configurable-'+type,this.manifest.practiceId);this.save();return{accepted:true,message:this.lastMessage};
 }
 processed(o){
  const id=this.manifest.practiceId;if(id==='CEDI-02')return o.entries.filter(row=>!row.inSource&&(row.inRack||row.inReleased)).reduce((sum,row)=>sum+row.quantity,0);
  if(id==='CEDI-03')return o.entries.filter(row=>row.inReleased).reduce((sum,row)=>sum+row.quantity,0);
  if(id==='SF-03')return o.entries.filter(row=>this.machiningSequence(row)).reduce((sum,row)=>sum+row.quantity,0);
  return o.entries.filter(row=>!row.inSource).reduce((sum,row)=>sum+row.quantity,0);
 }
 machiningSequence(row,measured=false){
  const history=row.operationHistory||[];let fixture=-1,machine=-1,measure=-1;
  for(let i=0;i<history.length;i++){const recipe=history[i].recipe;if(recipe==='clamp'){fixture=i;machine=-1;measure=-1;}else if(recipe==='machine'&&fixture>=0){machine=i;measure=-1;}else if(recipe==='measure'&&machine>fixture)measure=i;}
  return measured?measure>machine&&machine>fixture&&fixture>=0:machine>fixture&&fixture>=0;
 }
 finalized(o){
  const id=this.manifest.practiceId;
  if(id==='CEDI-02'){const refill=this.recipe.destinations.find(row=>row.alias==='E04'),delivered=o.entries.some(row=>row.ownerId===(refill&&refill.objectId)&&row.quantity===8);return delivered&&this.recipe.stock.every(stock=>this.state.putaway.includes(stock.objectId))?this.processed(o):0;}
  if(id==='CEDI-03'){const counts=this.recipe.destinations.map(dest=>o.entries.filter(row=>row.ownerId===dest.objectId).reduce((sum,row)=>sum+row.quantity,0));return counts.length===3&&counts.every(value=>value===4)?12:0;}
  if(id==='SF-03')return o.entries.filter(row=>row.inReleased&&this.machiningSequence(row,true)).reduce((sum,row)=>sum+row.quantity,0);
  return o.entries.filter(row=>row.inReleased).reduce((sum,row)=>sum+row.quantity,0);
 }
 update(){this.cycles.update();if(this.operations&&this.operations.update)this.operations.update();}
 snapshot(){
  this.live();const o=this.observe(),id=this.manifest.practiceId,special=['CEDI-02','CEDI-03','CEDI-05','SF-01','SF-03'].includes(id),op=special?null:this.operations.snapshot(),processed=special?this.processed(o):op.processedUnits||0,finalized=special?this.finalized(o):op.finalizedUnits||0;
  let conditions=special?[this.state.order,this.state.order&&this.state.prepared,processed>=this.expected(),!!this.state.inspected.order,finalized>=this.expected(),this.state.closed&&finalized>=this.expected()]:(op.stageConditions||Array(6).fill(false));
  if(id==='CEDI-02'){conditions[0]=this.state.order&&this.recipe.stock.every(stock=>this.state.locations[stock.objectId]);conditions[1]=conditions[0]&&this.state.prepared;conditions[2]=conditions[1]&&this.recipe.stock.every(stock=>this.state.putaway.includes(stock.objectId))&&processed>=48;}
  if(id==='CEDI-05')conditions=[this.state.order,this.state.prepared,!!this.state.secured,finalized>=this.expected(),!!this.state.inspected.order&&finalized>=this.expected(),this.state.closed&&finalized>=this.expected()];
  if(id==='SF-01')conditions=[this.state.order,this.state.prepared&&processed>=this.expected(),!!this.state.inspected.order,!!this.state.registered.lot,finalized>=this.expected(),this.state.closed&&finalized>=this.expected()];
  if(id==='SF-03')conditions=[this.state.order,this.state.prepared,o.entries.every(row=>!row.inSource&&row.operationHistory.some(event=>event.recipe==='clamp')),processed>=this.expected(),!!this.state.inspected.order&&finalized>=this.expected(),this.state.closed&&finalized>=this.expected()];
  for(let i=1;i<conditions.length;i++)conditions[i]=conditions[i]&&conditions[i-1];
  const criticalReasons=o.criticalReasons.concat(op&&op.criticalReasons||[]),time=this.runtime.time,stageEvidence=conditions.flatMap((ok,index)=>ok&&!criticalReasons.length?[{guard:GUARDS[index],eventId:this.manifest.stageBindings[index].requiredEvent,actorAliases:this.manifest.stageBindings[index].actorAliases.slice(),quantity:this.expected(),time,details:{originalStockIds:this.recipe.stock.map(stock=>stock.objectId),materialQuantities:o.quantities}}]:[]);
  const sourceUnits=o.entries.filter(row=>row.inSource).reduce((sum,row)=>sum+row.quantity,0),normalTotal=this.quantity(o.quantities),initial=this.expected(),total=id==='CEDI-03'?normalTotal/2:normalTotal;
  return{sourceUnits:Math.min(initial,sourceUnits),stockSourceUnits:sourceUnits,orderRemainingUnits:Math.max(0,initial-finalized),processedUnits:processed,receiverUnits:finalized,finalizedUnits:finalized,totalUnits:total,initialUnits:initial,time,blocked:criticalReasons.length>0,paused:false,emergency:this.manifest.vehicleIds.some(value=>{const r=this.runtime.records.get(value);return r&&r.components.vehicle&&r.components.vehicle.emergency;}),selectedSku:this.manifest.sku,identified:!!conditions[0],prepared:!!conditions[1],documentValidated:!!conditions[3],destinationConfirmed:!!conditions[5],faultInjected:false,faultRecovered:true,stageEvidence,criticalReasons,materialBalance:o.materialBalance,pallets:o.entries.map(row=>({id:row.objectId||row.id,sku:row.sku,units:row.quantity,massKg:row.massKg,ownerId:row.ownerId,position:row.position,held:row.held,inSource:row.inSource,inReleased:row.inReleased,inRack:row.inRack,materials:row.materials})),ledger:Object.assign(clone(this.state),op&&op.ledger||{})};
 }
 dispose(){this.disposed=true;this.cycles.dispose();if(this.operations&&this.operations.dispose)this.operations.dispose();}
}
