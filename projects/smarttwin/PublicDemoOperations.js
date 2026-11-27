import schema from '../../modules/logistica-industrial/contracts/behaviors.js';

/** Orders schedule the native source; inventory and dispatch keep native custody. */
export default class PublicDemoOperations {
 constructor(simulation){this.simulation=simulation;this.run=-1;this.reset();}
 records(){return [...this.simulation.records.values()].filter(r=>['source','robot','conveyor','palletQueue','vehicle'].some(type=>r.components[type]));}
 refs(){const records=this.records();return{records,source:records.find(r=>r.components.source&&r.components.source.config.delivery==='automatic'),robot:records.find(r=>r.components.robot),arrival:records.find(r=>r.components.source&&r.components.source.config.delivery==='manual'),assembly:records.find(r=>r.components.palletQueue&&r.components.palletQueue.config.palletize),pickup:records.find(r=>/^04 ·/.test(r.object.name)),rack:records.find(r=>r.components.palletQueue&&r.components.palletQueue.rack),dispatch:records.find(r=>/^06 ·/.test(r.object.name)),vehicle:records.find(r=>r.components.vehicle)};}
 reset(){
  const source=this.refs().source;if(!source)return;
  this.run=this.simulation.runSequence;this.catalog=schema.productSources.normalizeCatalog(source.components.source.config.catalog);
  this.orders=[];this.inspections=new Map();this.shipments=[];this.withdrawn=0;this.receivingPaused=false;this.elapsed=3;this.sequence=0;this.version=0;
 }
 syncRun(){if(this.run!==this.simulation.runSequence)this.reset();}
 event(type,message){this.version++;this.simulation.event(this.refs().source.id,type,message);}
 addProduct(values){
  this.syncRun();if(this.catalog.length>=8)throw Error('El catálogo admite ocho tipologías por sesión.');
  const type=values.type||'box';if(!['box','crate'].includes(type))throw Error('Esta célula admite cajas de cartón y cajas plásticas.');
  const n=(key,fallback)=>Number(values[key]===undefined?fallback:values[key]);
  let next=this.catalog.length+1;while(this.catalog.some(p=>p.id==='SKU-'+next))next++;
  if(['width','depth','height'].some(key=>values[key]!==undefined&&Number(values[key])!==({width:.3,depth:.3,height:.22})[key]))throw Error('El nuevo SKU usa el modelo de caja de 0,30 × 0,30 × 0,22 m de esta célula.');
  const spec=schema.productSources.normalizeCatalog([{id:values.id||'SKU-'+next,name:values.name||'Nuevo producto '+next,type,variant:type==='crate'?'crate':'box-small',width:.3,depth:.3,height:.22,mass:n('mass',2),base:type==='crate'?'rigid':'flat',color:values.color||'#8b9fbe',quality:values.quality||'good',defect:values.quality==='defective'?'damaged':'none'}])[0];
  if(this.catalog.some(p=>p.id===spec.id))throw Error('Ese código de producto ya existe.');
  if(spec.mass>10)throw Error('El robot de esta célula admite hasta 10 kg por caja.');
  this.catalog.push(spec);this.event('catalog-added','Producto registrado: '+spec.id+' · '+spec.name);return spec;
 }
 createOrder(sku,quantity){
  this.syncRun();quantity=Number(quantity);if(!this.catalog.some(p=>p.id===sku))throw Error('Selecciona una tipología registrada.');
  if(!Number.isInteger(quantity)||quantity<1||quantity>16)throw Error('Elige entre 1 y 16 unidades por lote.');
  const planned=this.orders.reduce((sum,o)=>sum+o.admitted+(o.cancelled?0:o.quantity-o.admitted),0);
  if(planned+quantity>32||this.orders.length>=32)throw Error('La sesión dispone de 32 cajas y ocho pallets; reinicia para una nueva sesión.');
  const order={id:'L'+String(++this.sequence).padStart(3,'0'),sku,quantity,admitted:0,authorized:false,cancelled:false};this.orders.push(order);
  this.event('receiving-order',order.id+' preparado: '+quantity+' × '+this.catalog.find(p=>p.id===sku).name);return order;
 }
 authorize(id){this.syncRun();const selected=this.orders.filter(o=>(!id||o.id===id)&&!o.cancelled&&o.admitted<o.quantity);if(!selected.length)throw Error('Prepara un lote pendiente antes de autorizar la entrada.');for(const order of selected)order.authorized=true;this.receivingPaused=false;this.elapsed=3;this.event('receiving-authorized','Entrada autorizada: '+selected.map(o=>o.id).join(', '));}
 cancelOrder(id){const o=this.orders.find(row=>row.id===id);if(!o||o.admitted>=o.quantity||o.cancelled)throw Error('Ese lote ya no tiene unidades pendientes.');o.cancelled=true;this.event('receiving-cancelled',o.id+': canceladas '+(o.quantity-o.admitted)+' unidades pendientes; las admitidas se conservan.');}
 pauseReceiving(){this.receivingPaused=!this.receivingPaused;this.event('receiving-paused',this.receivingPaused?'Llegadas pausadas.':'Llegadas habilitadas.');}
 receptionBelt(){const source=this.refs().source;return this.simulation.records.get(source.components.source.config.outputId);}
 holdReceiving(){const belt=this.receptionBelt(),release=!belt.components.conveyor.running;const result=this.simulation.command(belt.id,release?'start':'stop',undefined,'module');this.event('receiving-hold',release?'Recepción liberada a la línea.':'Recepción retenida para inspección y retirada.');return result;}
 step(delta){
  this.syncRun();const {source}=this.refs();if(!source)return;const c=source.components.source;this.elapsed=Math.min(120,this.elapsed+delta);
  if(this.receivingPaused||!c.enabled||!c.running||c.paused||c.emergency||this.elapsed<c.interval)return;
  const order=this.orders.find(o=>o.authorized&&!o.cancelled&&o.admitted<o.quantity);if(!order)return;
  c.config.catalog=JSON.stringify([this.catalog.find(p=>p.id===order.sku)]);
  if(this.simulation.sourceRuntime.generate(source)){order.admitted++;this.elapsed=0;this.version++;this.simulation.refreshVariables();}
 }
 command(action,targetId){
  if(!['powerOn','start','stop','pause','emergency','resetEmergency'].includes(action))throw Error('Mando no disponible.');
  const {records,source}=this.refs(),target=targetId?records.find(r=>r.id===targetId):source;if(!target)throw Error('Selecciona un equipo disponible.');
  if(action==='emergency'&&targetId&&this.simulation.machineComponent(target).emergency)return true;
  return this.simulation.command(target.id,action,undefined,targetId?'module':'line');
 }
 entry(id){const entry=[...this.simulation.sourceRuntime.entries].find(row=>row.id===id);if(!entry)throw Error('La carga ya no está en la instalación.');return entry;}
 loads(){
  const s=this.simulation,r=this.refs(),records=new Map(r.records.map(row=>[row.id,row]));
  return [...s.sourceRuntime.entries].filter(entry=>entry.units>0||entry.product&&entry.product.packing).map(entry=>{
   const p=entry.product,meta=p?s.productMetadata(p):entry.spec,item=p&&p.item,owner=records.get(p&&(p.vehicleOwnerId||p.robotOwnerId)||item&&(item.palletOwnerId||item.beltId)||entry.ownerId),spec=entry.spec,inspection=this.inspections.get(entry.id);
   const reserved=!!(p&&(p.heldBy||p.robotOwnerId||p.robotReservedBy||p.vehicleOwnerId||p.vehicleReservedBy));
   const damaged=(entry.members||[]).find(m=>m.spec.quality==='defective');
   const packing=p&&p.packing;
   return{id:entry.id,sku:spec.id,name:packing?'Caja de embalaje · '+entry.units+' unidades':entry.members?'Pallet · '+entry.units+' unidades':spec.name,type:packing?'tote':entry.members?'pallet':spec.type,units:entry.units,mass:meta.mass===undefined?schema.productSources.entryMass(entry):meta.mass,width:meta.width||spec.width,depth:meta.depth||spec.depth,height:meta.height||spec.height,quality:damaged?'defective':meta.quality||spec.quality||'good',defect:damaged?damaged.spec.defect:meta.defect||spec.defect||'none',location:packing?'Mesa de embalaje':owner?owner.object.name:'En transferencia',inspected:!!inspection,inspection,withdrawable:[r.source&&r.source.id,r.arrival&&r.arrival.id].includes(entry.ownerId)&&!reserved,shippable:entry.ownerId===(r.dispatch&&r.dispatch.id)&&!reserved&&!!inspection,contents:(entry.members||[]).map(m=>({id:m.id,sku:m.spec.id,name:m.spec.name,units:m.units,mass:schema.productSources.entryMass(m),quality:m.spec.quality,defect:m.spec.defect}))};
  });
 }
 inspect(id){this.entry(id);const row=this.loads().find(p=>p.id===id);this.inspections.set(id,{time:this.simulation.time,quality:row.quality,defect:row.defect});this.event('load-inspected','Inspeccionada '+id+' · '+row.name+' · '+row.quality);return this.loads().find(p=>p.id===id);}
 withdraw(id){
  const row=this.loads().find(load=>load.id===id);if(!row||!row.withdrawable)throw Error('Solo se retiran cargas libres de recepción; las cargas en proceso se conservan.');
  const e=this.entry(id),record=this.simulation.records.get(e.ownerId),units=e.units;
  if(!this.simulation.sourceRuntime.remove(record,e,'retirada de recepción'))throw Error('La carga cambió de propietario.');
  this.simulation.processorRuntime.consume(e);this.simulation.sourceRuntime.materialize(record);this.withdrawn+=units;this.event('receiving-withdrawn','Retiradas '+units+' unidades de recepción.');
 }
 finishPallet(){const r=this.refs(),robot=r.robot.components.robot;if(robot.entry||!['idle','return','wait-output'].includes(robot.phase))throw Error('Espera a que el robot libere la carga antes de cerrar el pallet parcial.');const result=this.simulation.palletQueueRuntime.command(r.assembly,'sealPallet');if(!result)throw Error('No hay un pallet parcial libre para cerrar.');return result;}
 ship(id){
  const row=this.loads().find(load=>load.id===id);if(!row||!row.shippable)throw Error('Deposita la carga en DESPACHO e inspecciónala antes de confirmar la salida.');
  const entry=this.entry(id),r=this.refs().dispatch,index=entry.product.item.palletIndex;
  if(!this.simulation.palletQueueRuntime.releasePallet(r,index))throw Error('Despeja la carga y habilita despacho para expedir.');
  this.shipments.push({...row,time:this.simulation.time});this.event('shipment-confirmed','Expedido '+row.id+' · '+row.units+' unidades / '+row.mass+' kg.');
 }
 snapshot(){
  this.syncRun();const r=this.refs(),s=this.simulation,c=r.source.components.source,arrival=r.arrival.components.source,assembly=r.assembly.components.palletQueue,rack=r.rack.components.palletQueue,dispatch=r.dispatch.components.palletQueue;
  const ready=r.pickup.components.conveyor.packages.filter(item=>s.productMetadata(item.product).loadMode==='pallet').length,loads=this.loads();
  const machines=r.records.map(record=>{const c=s.machineComponent(record),v=record.variables;return{id:record.id,name:record.object.name,state:c.emergency?'Emergencia':c.paused?'Pausa':c.powered===false?'Apagado':!c.running?'Detenido':v.blocked||v.transferBlocked?'Esperando':'En marcha',paused:!!c.paused,emergency:!!c.emergency};});
  let instruction='Inicio: prepara una tipología y cantidad en RECEPCIÓN y autoriza la entrada. Fin: deposita en DESPACHO, inspecciona y confirma Expedir.',tone='live';
  if(machines.some(m=>m.emergency)){tone='danger';instruction='Emergencia enclavada. Revisa el área, pulsa Rearmar y después Iniciar.';}
  else if(!c.running){tone='stopped';instruction='Línea detenida. Pulsa Iniciar para continuar las cargas y los lotes existentes.';}
  else if(ready){tone='ready';instruction='Pallet disponible en 04 RECOGIDA: A en Quest o G en escritorio. Deposita con A o K en almacén o despacho.';}
  else if(!this.orders.some(o=>o.authorized&&!o.cancelled&&o.admitted<o.quantity)&&!c.generatedUnits)instruction='Recepción espera tu orden: elige producto y cantidad, pulsa Preparar lote y después Autorizar entradas.';
  else if(assembly.queue.length&&!r.robot.components.robot.entry)instruction='Puedes completar el pallet con otro lote o detener el robot y pulsar Cerrar pallet parcial.';
  return{time:s.time,tone,instruction,paused:!!s.getPanelSnapshot(r.source.id,'line').variables.paused,receivingPaused:this.receivingPaused,receptionHeld:!this.receptionBelt().components.conveyor.running,catalog:this.catalog.map(p=>({...p})),orders:this.orders.map(o=>({...o})),loads,shipments:this.shipments.slice(-8),withdrawn:this.withdrawn,shipped:this.shipments.length,shippedUnits:this.shipments.reduce((n,p)=>n+p.units,0),generated:c.generatedUnits,total:this.orders.reduce((n,o)=>n+(o.cancelled?o.admitted:o.quantity),0),arrived:arrival.receivedUnits,waiting:arrival.queue.length,palletized:r.robot.components.robot.completed,pallets:assembly.assembly.completed,partial:assembly.pallets[0].sealed?0:assembly.pallets[0].items.length,ready,stock:rack.queue.length,slots:rack.rack.layout.cells.length,dispatched:dispatch.queue.length,machines,events:s.events.filter(e=>r.records.some(row=>row.id===e.objectId)).slice(-6).reverse()};
 }
}
