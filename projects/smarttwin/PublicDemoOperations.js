/** Public lesson operations use the same native commands and inventory as
 * the physical control desk. No synthetic production counters or cargo. */
export default class PublicDemoOperations {
 constructor(simulation){this.simulation=simulation;}
 records(){return [...this.simulation.records.values()].filter(r=>['source','robot','conveyor','palletQueue','vehicle'].some(type=>r.components[type]));}
 refs(){const records=this.records();return{records,source:records.find(r=>r.components.source&&r.components.source.config.autoGenerate),robot:records.find(r=>r.components.robot),arrival:records.find(r=>/recepción de ocho cajas/.test(r.object.name)),assembly:records.find(r=>r.components.palletQueue&&r.components.palletQueue.config.palletize),pickup:records.find(r=>/^04 ·/.test(r.object.name)),rack:records.find(r=>r.components.palletQueue&&r.components.palletQueue.rack),dispatch:records.find(r=>/^06 ·/.test(r.object.name)),vehicle:records.find(r=>r.components.vehicle)};}
 command(action,targetId){
  if(!['powerOn','start','stop','pause','emergency','resetEmergency'].includes(action))throw Error('Mando no disponible.');
  const {records,source}=this.refs(),target=targetId?records.find(r=>r.id===targetId):source;if(!target)throw Error('Selecciona un equipo disponible.');
  if(action==='emergency'){
   if(!targetId)return this.simulation.command(target.id,'emergency',undefined,'line');
   if(this.simulation.machineComponent(target).emergency)return true;
  }
  return this.simulation.command(target.id,action,undefined,targetId?'module':'line');
 }
 snapshot(){
  const r=this.refs(),s=this.simulation,source=r.source&&r.source.components.source,arrival=r.arrival&&r.arrival.components.source,assembly=r.assembly&&r.assembly.components.palletQueue,rack=r.rack&&r.rack.components.palletQueue,dispatch=r.dispatch&&r.dispatch.components.palletQueue,vehicle=r.vehicle&&r.vehicle.components.vehicle;
  const physical=entry=>!!(entry&&entry.load&&entry.load.physicalAssembly),ready=r.pickup&&r.pickup.components.conveyor.packages.filter(item=>s.productMetadata(item.product).loadMode==='pallet').length||0;
  const machines=r.records.map(record=>{const c=s.machineComponent(record),v=record.variables;return{id:record.id,name:record.object.name,state:c.emergency?'Emergencia':c.paused?'Pausa':c.powered===false?'Apagado':!c.running?'Detenido':v.blocked||v.transferBlocked?'Esperando':'En marcha',paused:!!c.paused,emergency:!!c.emergency};});
  let instruction='Sigue las cajas desde LLEGADA hasta RECEPCIÓN. El robot forma dos pallets; recoge en 04 y coloca en ALMACÉN o DESPACHO.',tone='live';
  if(machines.some(m=>m.emergency)){tone='danger';instruction='Emergencia enclavada. Revisa el área, pulsa Rearmar y después Iniciar. Rearmar conserva la línea detenida.';}
  else if(source&&!source.running){tone='stopped';instruction='Línea detenida. Usa Encender si falta alimentación y pulsa Iniciar para continuar el mismo lote.';}
  else if(ready){tone='ready';instruction='Hay un pallet en 04 RECOGIDA. Detén el montacargas frente a él y pulsa A en Quest o G en escritorio; luego A o K junto a un hueco libre.';}
  else if(r.robot&&!r.robot.components.robot.running&&(arrival&&arrival.queue.length)){tone='waiting';instruction='Hay cajas esperando al robot. Selecciona el robot en Equipo y pulsa Iniciar cuando el área esté libre.';}
  else if(assembly&&assembly.assembly.completed>=2){tone='ready';instruction='El lote de ocho cajas ya está paletizado. Lleva los dos pallets a ALMACÉN o DESPACHO; reinicia para comenzar otro lote.';}
  return{time:s.time,tone,instruction,paused:!!(s.getPanelSnapshot(r.source.id,'line').variables.paused),generated:source&&source.generatedUnits||0,total:source&&source.config.totalLimit||8,arrived:arrival&&arrival.receivedUnits||0,waiting:arrival&&arrival.queue.length||0,palletized:r.robot&&r.robot.components.robot.completed||0,pallets:assembly&&assembly.assembly.completed||0,ready,carried:vehicle&&vehicle.entry?1:0,stock:rack&&rack.queue.length||0,slots:rack&&rack.rack.layout.cells.length||0,stored:rack&&rack.queue.filter(physical).length||0,dispatched:dispatch&&dispatch.queue.filter(physical).length||0,machines,events:(s.events||[]).filter(event=>r.records.some(record=>record.id===event.objectId)).slice(-6).reverse()};
 }
}
