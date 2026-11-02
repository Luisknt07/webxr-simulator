'use strict';
const source=require('../data/practice-index.cjs');
const equipment=require('../../functions/equipamiento/schema/equipmentCatalog.cjs');
const layoutBindings=require('./PracticeLayoutBindings.cjs');
const capabilities=require('./PracticeCapabilities.cjs');
const SOURCE_KEY='nexus-illustrated-2026:';
const MODES=['manual','semiautomatic','automatic'];
const ENTRIES=source.records||source.entries;
const INDUSTRIAL=['MU-01','MA-25','SE-04','AL-01','SE-11','SE-11','MA-15','MA-18','MA-17','MA-01','MA-03','MA-05','MA-06','MA-11','MA-12','MA-08','MA-09','MA-10','MA-13','MA-15','MA-15','MA-19','RO-01','TR-02','MA-25','MA-24','MA-03','MA-15','MA-15','PI-09','AL-01','MU-01'];
const LOGISTICS=['MU-01','MU-02','MU-01','VE-05','MU-06','TR-07','SE-04','MU-10','SE-05','AL-01','AL-01','VE-06','AL-01','SE-04','VE-08','SE-10','PI-03','PI-01','VE-05','TR-03','TR-19','PI-07','PI-10','PI-12','RO-02','PI-11','MU-02','VE-05','SE-11','SE-16','TR-02','MO-02'];
const VEHICLE=new Set(['L04','L12','L15','L19','L20','L27','L28','L32','I01','I04','I31','I32']);
const ROBOT=new Set(['L25','I23']);
const PALLET=new Set(['L05','L06','L20','L26']);
const ALTERNATIVES={'equipment.transport.pallet-chain':'equipment.transport.roller-pallet','equipment.transport.roller-pallet':'equipment.transport.pallet-chain','equipment.transport.roller-box':'equipment.transport.flat-belt','equipment.sensor.barcode-rfid':'equipment.sensor.barcode-rf','equipment.machine.cnc-lathe':'equipment.machine.machining-center','equipment.machine.paint-curing':'equipment.machine.paint-booth','equipment.machine.press-brake':'equipment.machine.stamping-press','equipment.picking.pick-to-light':'equipment.picking.voice','equipment.packaging.seal-strap':'equipment.packaging.carton-sealer'};
function material(id){
 if(id==='I23')return{type:'cylinder',variant:'cylinder',width:.16,height:.2,depth:.16,mass:.8,base:'rigid',units:1,catalogueEquipmentId:'equipment.product.metal-part',materialClass:'steel',color:'#9ca6ad'};
 if(PALLET.has(id))return{type:'pallet',variant:'pallet-loaded',width:1.2,height:.72,depth:.8,mass:33,base:'runners',units:1,catalogueEquipmentId:'equipment.product.loaded-pallet',materialClass:'solid',color:'#b9945b'};
 if(['I10','I11','I12','I13','I14','I19','I22','I25','I27'].includes(id))return{type:'cylinder',variant:'cylinder',width:.45,height:.14,depth:.2,mass:3,base:'rigid',units:1,catalogueEquipmentId:id==='I10'?'equipment.product.long-stock':'equipment.product.metal-part',materialClass:'steel',color:'#9ca6ad'};
 if(['I16','I17','I18'].includes(id))return{type:'sack',width:.26,height:.18,depth:.3,mass:1.5,base:'rigid',units:1,catalogueEquipmentId:'equipment.product.bulk-fluid',materialClass:'bulk',color:'#9baab2'};
 return{type:'box',width:.28,height:.22,depth:.32,mass:2,base:'flat',units:1,catalogueEquipmentId:'equipment.product.carton',materialClass:'solid',color:'#ba935e'};
}
const number=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const txt=value=>Array.isArray(value)?value.map(txt).join('\n'):typeof value==='string'?value:value&&value.text||'';
function entry(id){const row=ENTRIES.find(row=>row.id===id);if(!row)throw Error('Práctica no disponible: '+id);return row;}
function incidentKind(text){const value=txt(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/document|etiquet|referencia|duplic|cita|asn|codigo/.test(value))return'identification';
 if(/falt|cantidad|conteo|inventario|saldo/.test(value))return'quantity';
 if(/calidad|defect|rechaz|cuarenten|caduc|temperatura/.test(value))return'quality';
 if(/capacidad|peso|masa|sobrecarga|estabilidad|sujeci/.test(value))return'capacity';
 if(/ruta|congest|pasillo|bloque|ocupad/.test(value))return'route';
 return'interlock';
}
function plan(id,options={}){
 const row=entry(id),caseId=options.caseId||'A',mode=options.mode||'semiautomatic',difficulty=options.difficulty===undefined?1:Number(options.difficulty);
 if(!['A','B','C'].includes(caseId)||!MODES.includes(mode)||!Number.isInteger(difficulty)||difficulty<1||difficulty>3)throw Error('Caso, modalidad o dificultad de práctica inválidos.');
 if(difficulty===3&&caseId!=='C')throw Error('D3 requiere el caso C: diagnosticar y recuperar una incidencia real, no sólo ocultar la guía.');
 const availability=capabilities.availability(id,mode);if(!availability.ready)throw Error(availability.reasons.join(' '));
 const mainCode=(row.domain==='logistics'?LOGISTICS:INDUSTRIAL)[Number(id.slice(1))-1],main=equipment.source(SOURCE_KEY+mainCode);
 if(!main)throw Error('Falta el equipo principal de '+id+' ('+mainCode+').');
 const declaredCount=txt(row.initialConditions).match(/\b(\d+)\s+(?:estibas|pallets|cajas|piezas|totes|unidades)\b/i),sourceDemand=declaredCount?Number(declaredCount[1]):null;
 const requestedUnits=options.units===undefined?4:options.units;if(!Number.isInteger(requestedUnits)||requestedUnits<1||requestedUnits>24)throw Error('El lote de práctica admite de 1 a 24 unidades.');
 // L01 is the ASN/arrival transaction for the source order of twelve pallets;
 // it never creates twelve moving products. A generic batch UI cannot silently
 // rewrite the ASN just because its material-demo default is four.
 const units=id==='L01'?12:options.units===undefined?(layoutBindings.DOCUMENTARY.has(id)&&sourceDemand&&sourceDemand<=24?sourceDemand:4):requestedUnits;
 if(PALLET.has(id)&&units>4)throw Error('Esta práctica dispone de cuatro posiciones para pallets completos. Elige un lote de 1 a 4 pallets.');
 const cycle=options.cycleSeconds===undefined?2:Number(options.cycleSeconds);if(!number(cycle,.2,120))throw Error('Tiempo de ciclo fuera del intervalo de práctica.');
 const alternative=caseId==='B'&&ALTERNATIVES[main.id]&&equipment.definition(ALTERNATIVES[main.id]);
 const manualPalletizing=id==='L25'&&mode==='manual'?equipment.definition('equipment.picking.packing-bench'):null;
 const casePicking=id==='L18'?equipment.definition(mode==='automatic'?'equipment.picking.goods-to-robot':mode==='manual'?'equipment.picking.packing-bench':'equipment.picking.voice'):null;
 const replenishment=['L12','L15','L32'].includes(id)?equipment.definition('equipment.vehicle.counterbalance'):null;
 const crossDock=id==='L20'&&mode==='manual'?equipment.definition('equipment.vehicle.pallet-truck-electric'):null;
 const palletizing=id==='L25'&&mode!=='manual'?equipment.definition('equipment.robot.articulated'):null;
 const selected=manualPalletizing||casePicking||replenishment||crossDock||palletizing||alternative||main;
 const permitted=new Set([selected.id,ALTERNATIVES[selected.id]].filter(Boolean));
 if(options.equipmentId&&!permitted.has(options.equipmentId))throw Error('El equipo no figura entre las alternativas compatibles de esta operación y modalidad.');
 const equipmentChoice=options.equipmentId?equipment.definition(options.equipmentId):selected;
 if(!equipmentChoice||!manualPalletizing&&!casePicking&&!crossDock&&!replenishment&&equipmentChoice.role!==main.role||equipmentChoice.operationLevel==='pending')throw Error('La variante elegida no es compatible con la función de esta práctica.');
 const machine=equipmentChoice.nativeKind==='processor'?equipmentChoice:null;
 const product=material(id),choice=row.cases.find(value=>value.id===caseId)||{};
 return {version:1,id,key:row.key,title:row.title,domain:row.domain,caseId,mode,difficulty,units,cycleSeconds:cycle,
  kind:layoutBindings.DOCUMENTARY.has(id)?'documentary':VEHICLE.has(id)&&!(id==='L20'&&mode!=='manual')?'vehicle':ROBOT.has(id)&&!manualPalletizing?'robot':'flow',mainEquipmentId:equipmentChoice.id,machineEquipmentId:machine&&machine.id||'',availability,
  sku:id+'-SKU-01',batch:id+'-LOTE-01',width:product.width,height:product.height,depth:product.depth,mass:product.mass,product,
  processLength:caseId==='B'?3.2:2.8,transportLength:caseId==='B'?3.2:2.4,transportSpeed:caseId==='B'?.45:.6,caseChange:caseId==='B'?(alternative?'Tipología compatible alternativa: '+equipmentChoice.title:'Variación de longitud y velocidad con la misma demanda y calidad.'):'',
  objective:txt(row.objective),incident:txt(row.incident),incidentKind:incidentKind(row.incident),result:txt(row.result),
  steps:row.steps.map((step,index)=>({id:step.id,title:step.title,action:step.action,expectedEvidence:step.expectedEvidence,guard:['identify','prepare','operate','inspect','deliver','close'][index]})),
  caseDescription:choice.condition||'',caseAchievement:choice.verifiableAchievement||'',
  modeDescription:JSON.parse(JSON.stringify(row.modes[MODES.indexOf(mode)])),initialConditions:txt(row.initialConditions),
  sourceDemand,quantityAdjustment:sourceDemand&&sourceDemand!==units?'Copia de ensayo acotada: '+units+' unidades activas; demanda documental original '+sourceDemand+'. No se modifica el documento fuente.':'',
  difficultyDescription:{id:'D'+difficulty,name:['Guía','Configuración','Diagnóstico y comparación'][difficulty-1],text:['D1 proporciona guía.','D2 permite configuración.','D3 requiere diagnóstico y comparación.'][difficulty-1],source:'Evaluación común del documento NEXUS'},
  referenceLayout:row.layout,sourceEquipmentCodes:row.sourceEquipmentCodes||[],sourceSha256:source.source.sha256,
  referenceNotice:'Los planos del documento son referencias. El plano de ejecución se obtiene de las posiciones y puertos reales del nivel.',
  limits:'Simulación educativa por eventos discretos y cinemática. Las condiciones de proceso son parámetros declarados; no certifican calor, fuerza, estabilidad ni capacidad OEM.'};
}
function list(){return ENTRIES.map(row=>({id:row.id,key:row.key,title:row.title,domain:row.domain,objective:txt(row.objective),cases:['A','B','C'],modes:MODES.slice(),availability:MODES.map(mode=>capabilities.availability(row.id,mode)),moduleId:equipment.MODULE_ID}));}
module.exports={SOURCE_KEY,MODES,entry,plan,list,incidentKind,material,ALTERNATIVES,layoutBindings,availability:capabilities.availability,capabilities};
