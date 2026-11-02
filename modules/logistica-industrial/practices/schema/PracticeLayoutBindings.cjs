'use strict';
// The source table is an area/BOM, not a set of scaled OEM CAD dimensions.
// Entries below select ONE native alternative per position; they never overlay
// every manual/automatic alternative on the same drawing.
const cat=require('../../functions/equipamiento/schema/equipmentCatalog.cjs');
const DOCUMENTARY=new Set(['L01','L02','L03','L07','L08','L09','L10','L11','L13','L14','L16','L24','L27','L29','L30','I02','I03','I05','I06','I07','I08','I23','I25','I26','I27','I28','I29']);
const R={source:'source',bay:'bay',area:'area',walk:'walk',terminal:'control.hmi',scanner:'sensor.barcode-rf',inspect:'picking.receiving-inspection',rack:'storage.selective',table:'machine.assembly-bench',fork:'vehicle.counterbalance',truck:'vehicle.freight-truck',dock:'dock.loading-dock',leveler:'dock.leveler',hold:'storage.reject-bin',main:'main',tool:'tool.stand',out:'bay'};
const GROUPS=[
 ['L01','truck terminal area dock terminal walk'],
 ['L02 L03 L04 I01','truck leveler source fork terminal hold safety.guard'],
 ['L05','source fork dock.forklift-station transport.roller-pallet terminal hold'],
 ['L06 L31','source main transport.popup-transfer transport.roller-box terminal bay'],
 ['L07 L08 L09 L24 I02','source inspect sensor.weigh-dimension scanner hold bay'],
 ['L10 L16 I03 I05 I06','terminal rack source terminal rack transport.roller-box'],
 ['L11 L12 L13 L14 L19 I04 I31','source rack rack rack fork terminal'],
 ['L15 L17 L18','storage.carton-flow rack vehicle.picking-cart main scanner bay'],
 ['L20','source scanner bay dock fork hold'],
 ['L21','source scanner main bay bay hold terminal'],
 ['L22 L23','source picking.consolidation main storage.light-medium terminal bay'],
 ['L25 L26 I30','source main bay storage.light-medium terminal packaging.stretch-wrapper'],
 ['L27 L28 L29 I32','source scanner fork dock truck terminal'],
 ['L30','source picking.consolidation inspect picking.decanting hold bay'],
 ['L32 I24','source bay bay main control.wcs control.charging-station'],
 ['I07','rack picking.decanting storage.carton-flow picking.pick-to-light vehicle.tow-tractor storage.light-medium'],
 ['I08','source main robot.articulated tool terminal inspect'],
 ['I09 I11 I12','source main robot.articulated tool terminal inspect'],
 ['I10','source machine.stock-feeder main hold terminal bay'],
 ['I13','source main vehicle.ergonomic-manipulator tool terminal bay'],
 ['I14','source machine.positioner robot.welding machine.welding-source terminal inspect'],
 ['I15','source main utility.extraction machine.paint-curing terminal inspect'],
 ['I16 I17','machine.hopper-doser main utility.extraction machine.cooling terminal inspect'],
 ['I18','source main machine.finishing hold terminal bay'],
 ['I19','source main machine.cooling storage.light-medium terminal bay'],
 ['I20 I21','source machine.fixture robot.articulated storage.light-medium terminal machine.test-bench'],
 ['I22','source main robot.finishing utility.extraction terminal inspect'],
 ['I23','source main tool tool terminal inspect tool'],
 ['I25 I26','source machine.cmm machine.test-bench table hold bay'],
 ['I27','main bay sensor.condition utility.energy storage.light-medium table'],
 ['I28 I29','source table table table tool terminal bay']
];
const MAP={};GROUPS.forEach(([ids,values])=>ids.split(' ').forEach(id=>{MAP[id]=values.split(' ');}));
function definition(token,plan){const value=R[token]||token;if(['source','bay','area','walk'].includes(value))return{role:value,catalogueEquipmentId:''};const id=value==='main'?plan.mainEquipmentId:'equipment.'+value;const d=cat.definition(id);if(!d||!d.nativeKind)throw Error('No native layout binding: '+plan.id+' / '+id);return{role:d.role,catalogueEquipmentId:id,nativeKind:d.nativeKind};}
function bindings(plan){const tokens=MAP[plan.id];if(!tokens||tokens.length!==plan.referenceLayout.elements.length)throw Error('Incomplete source-layout mapping: '+plan.id);return plan.referenceLayout.elements.map((element,index)=>{
 let token=tokens[index];
 if(['L04','I01'].includes(plan.id)&&index===2)token='bay';
 if(['L11','L12','L13','L14','L19','I04','I31'].includes(plan.id)&&token==='rack')token=plan.mode==='automatic'?'storage.pallet-asrs':plan.mode==='semiautomatic'?(plan.caseId==='B'?'storage.pallet-flow':'storage.double-deep'):(plan.caseId==='B'?'storage.block':'storage.selective');
 if(plan.id==='L25'&&token==='main'&&plan.mode==='manual')token='picking.packing-bench';
 if(plan.id==='I14'&&token==='robot.welding'&&plan.mode==='manual')token='machine.welding-cell';
 if(['I09','I11','I12'].includes(plan.id)&&token==='robot.articulated'&&plan.mode==='manual')token='vehicle.ergonomic-manipulator';
 const result=definition(token,plan),area=plan.referenceLayout.area;
 return Object.assign({sourceElementId:element.id,sourceKey:plan.key+':'+element.id,sourceName:element.name,sourceOrigin:[element.origin2d.x,element.origin2d.y],sourceDimensions:[element.dimensions.width,element.dimensions.depth,element.dimensions.height],sourceCenter:[element.origin2d.x+element.dimensions.width/2-area.width/2,0,element.origin2d.y+element.dimensions.depth/2-area.depth/2]},result);
 });}
function field(key,label,expected,alternatives){const options=Array.from(new Set([expected].concat(alternatives||[]))).map(value=>({value:String(value),label:String(value)}));return{key,label,type:'choice',expected:String(expected),options};}
function evidence(plan,rows){
 if(!DOCUMENTARY.has(plan.id))return null;
 const terminal=rows.find(row=>row.nativeKind==='plc')||rows[0],input=rows.find(row=>row.role==='source')||rows[0],destination=rows[rows.length-1];
 const context={orderId:plan.id+'-ORD-01',batch:plan.batch,sku:plan.sku,expectedUnits:plan.units,sourceInitialConditions:plan.initialConditions,sourceScope:'transacción educativa local; no conexión a ERP/WMS/OCR externo'};
 let values=[['orderId','Orden asignada',context.orderId,[plan.id+'-ORD-02','SIN-ORDEN']],['batch','Lote trazable',plan.batch,[plan.id+'-LOTE-02','SIN-LOTE']],['quantity','Cantidad de la orden',String(plan.units),[String(plan.units+1),'0']],['destination','Destino autorizado',destination.sourceElementId,[rows[0].sourceElementId,'SIN-ASIGNAR']],['decision','Decisión sobre incidencia',plan.caseId==='C'?'CONTENER-Y-CORREGIR':'LIBERAR-CONFORME',['LIBERAR-SIN-VERIFICAR','DESCARTAR-REGISTRO']],['closure','Estado de cierre','CONCILIADO',['PENDIENTE','DIFERENCIA']]];
 let actors=[terminal,input,input,terminal,terminal,destination];
 if(plan.id==='L01'){
  Object.assign(context,{appointmentId:'CIT-L01-01',truckId:'TRK-L01-01',asnId:'ASN-01',expectedPallets:12,dockId:'D01',dockCapacity:1});
  values=[['appointmentId','Cita prevista',context.appointmentId,['CIT-L01-02','SIN-CITA']],['truckId','Matrícula / transporte',context.truckId,['TRK-L01-02','NO-IDENTIFICADO']],['capacity','Muelles compatibles disponibles','1',['0','2']],['dockId','Muelle autorizado','D01',['D02','ESPERA-SIN-ASIGNAR']],['resolution','Resolución de cita',plan.caseId==='C'?'REPROGRAMAR-CON-AUTORIZACION':'CITA-UNICA-VALIDADA',['IGNORAR-DUPLICADO','DESCARGAR-SIN-CITA']],['handover','Entrega de tarea','D01-RECEPCION',['SIN-CONFIRMAR','D02-RECEPCION']]];actors=[rows[1],rows[0],rows[3],rows[1],rows[4],rows[3]];
 }
 if(plan.id==='I23'){
  Object.assign(context,{initialToolId:'equipment.tool.parallel-gripper',requiredToolId:'equipment.tool.three-finger',toolMassKg:.5,execution:'Cambio manual/asistido de configuración del EOAT real; no se simula un acoplador automático ni manos de un operario.'});
  values=[['loadState','Condición para cambiar','SIN-CARGA',['CARGA-SUSPENDIDA','EN-CICLO']],['stand','Soporte de la herramienta inicial',rows[2].sourceElementId,[rows[3].sourceElementId,'SIN-SOPORTE']],['isolation','Servicios durante desacople','AISLADOS',['ENERGIZADOS','SIN-COMPROBAR']],['newTool','EOAT asignado',context.requiredToolId,['equipment.tool.vacuum-single','equipment.tool.parallel-gripper']],['toolMass','Masa de herramienta configurada','0.5',['0','80']],['test','Prueba de nueva tarea','TRANSFERENCIA-VERIFICADA',['SOLO-ANIMACION','SIN-PRODUCTO']]];
  actors=[rows[1],rows[2],rows[1],rows[1],rows[1],rows[1]];
 }
 const requirements=plan.steps.map((step,index)=>({guard:step.guard,eventId:plan.id+'-'+step.guard+'-record',title:step.title,action:step.action,objectId:actors[index].objectId,fields:[field.apply(null,values[index])]}));
 if(plan.id==='I23'){
  [3,4].forEach(index=>{requirements[index].observe={component:'robot',path:'config.catalogueToolId',expected:context.requiredToolId};});
  requirements[5].observe=[{component:'robot',path:'config.catalogueToolId',expected:context.requiredToolId},{component:'robot',path:'completed',minimum:1},{component:'world',path:'receiverUnits',minimum:1}];
 }
 if(['I28','I29'].includes(plan.id))requirements[5].observe={component:'world',path:'receiverUnits',minimum:plan.units};
 return{kind:'documentary',context,requirements};
}
module.exports={DOCUMENTARY,bindings,evidence,sourceMapping:'document-local x→world x, y→world z; centered without rescaling',GROUPS};
