/* Bounded metric storage recipes shared by authoring, geometry and custody.
 * Load ratings are configurable simulation limits, not structural certification.
 * All support coordinates are local to the stock actor: floor=-1, front=+Z.
 */
'use strict';

const LIMIT = 128;
const SYSTEMS = [
  ['selective','Selectiva convencional','palletized','direct','static','pallet','Acceso individual a cada pallet desde el pasillo.',{}],
  ['double-deep','Doble profundidad','palletized','lifo','static','pallet','Dos pallets a fondo; la posición delantera bloquea la trasera.',{rackDepthSlots:2}],
  ['drive-in','Compacta Drive-In','palletized','lifo','static','pallet','El montacargas entra en calles de carga por una sola cara.',{rackColumns:1,rackBayWidth:1.6,rackDepthSlots:3,rackLevels:2}],
  ['drive-through','Compacta Drive-Through','palletized','fifo','static','pallet','Carga por una cara y retirada por la opuesta.',{rackColumns:1,rackBayWidth:1.6,rackDepthSlots:3,rackLevels:2}],
  ['pallet-flow','Dinámica de pallets por gravedad','palletized','fifo','gravity','pallet','Carriles inclinados con entrada posterior y salida frontal.',{rackColumns:1,rackBayWidth:1.6,rackDepthSlots:3,rackLevels:2,rackBaseHeight:.65,rackSlope:.04}],
  ['push-back','Push-Back','palletized','lifo','push-back','pallet','Carga por la misma cara, con carros que retroceden y retornan.',{rackColumns:1,rackBayWidth:1.6,rackDepthSlots:3,rackLevels:2,rackSlope:.04}],
  ['mobile','Estantería sobre bases móviles','palletized','direct','mobile','pallet','Bases que abren el pasillo seleccionado y conservan las cargas.',{rackBanks:3,rackBays:1,rackColumns:2}],
  ['cantilever','Cantilever para cargas largas','palletized','direct','static','long','Brazos en voladizo con frente abierto para cargas largas.',{rackBays:2,rackColumns:1,rackBayWidth:2.4,rackSlotDepth:1.2,rackMaxLoadKg:1000}],
  ['light-duty','Entrepaños de carga ligera','picking','direct','static','individual','Picking manual de cajas, piezas y recipientes ligeros.',{rackBays:2,rackLevels:4,rackColumns:2,rackBayWidth:1.5,rackSlotDepth:.65,rackLevelHeight:.5,rackBaseHeight:.2,rackMaxLoadKg:75,rackLevelLoadKg:150}],
  ['medium-duty','Estantería de media carga','picking','direct','static','individual','Baldas y largueros para cajas y productos de picking.',{rackBays:2,rackLevels:3,rackColumns:2,rackBayWidth:2.4,rackSlotDepth:.9,rackLevelHeight:.7,rackBaseHeight:.2,rackMaxLoadKg:250,rackLevelLoadKg:500}],
  ['carton-flow','Carton Flow para cajas','picking','fifo','gravity','individual','Cajas que avanzan por gravedad desde la reposición hasta picking.',{rackBays:2,rackLevels:3,rackColumns:2,rackDepthSlots:3,rackBayWidth:1.6,rackSlotDepth:.6,rackLevelHeight:.65,rackBaseHeight:.3,rackSlope:.04,rackMaxLoadKg:35,rackLevelLoadKg:200}],
  ['mezzanine','Mezzanine y pasillo elevado','picking','direct','static','individual','Plataforma de acceso peatonal con posiciones de picking.',{rackBays:2,rackLevels:1,rackColumns:2,rackBayWidth:3,rackSlotDepth:2,rackBaseHeight:2.4,rackLevelHeight:2.2,rackMaxLoadKg:100,rackLevelLoadKg:500,rackTransferHeight:2.4}],
  ['vertical-lift','Almacén vertical de bandejas','automated','direct','lift','individual','Extractor vertical que presenta una ubicación en la ventana de trabajo.',{rackBays:1,rackColumns:1,rackLevels:4,rackBayWidth:2,rackSlotDepth:1,rackLevelHeight:.65,rackBaseHeight:.3,rackMaxLoadKg:150,rackLevelLoadKg:150}],
  ['miniload','Miniload para cajas y bandejas','automated','direct','miniload','individual','Transelevador con desplazamiento horizontal, vertical y extracción.',{rackBays:3,rackColumns:1,rackLevels:3,rackBayWidth:1.1,rackSlotDepth:.8,rackLevelHeight:.7,rackBaseHeight:.3,rackMaxLoadKg:60,rackLevelLoadKg:120}]
].map(([id,label,category,policy,mechanism,acceptedLoad,description,preset]) => Object.freeze({id,name:label,label,category,group:category,policy,mechanism,acceptedLoad,description,preset:Object.freeze(preset),
  loadFace:id==='pallet-flow'||id==='carton-flow'?'rear':'front',pickFace:id==='drive-through'?'rear':'front',requiresReach:id==='double-deep'}));

const num = (key,label,def,min,max,step=1) => ({key,label,input:'number',default:def,min,max,step});
const FIELDS = [
  {key:'rackSystem',label:'Sistema de estantería',input:'select',default:'floor',options:[{value:'floor',label:'Estibas a piso (original)'}].concat(SYSTEMS.map(s=>({value:s.id,label:s.label})))},
  num('rackBays','Módulos de frente',2,1,8),num('rackLevels','Niveles de almacenamiento',3,1,6),num('rackColumns','Posiciones por módulo y nivel',2,1,3),
  num('rackDepthSlots','Posiciones a fondo',1,1,6),num('rackBayWidth','Ancho de módulo (m)',3,.8,6,.05),num('rackSlotDepth','Paso de fondo (m)',1.1,.4,3,.05),
  num('rackLevelHeight','Separación entre niveles (m)',1.5,.4,3.5,.05),num('rackBaseHeight','Altura del primer apoyo sobre piso (m)',.25,0,6,.05),
  num('rackClearance','Holgura por lado (m)',.08,.02,.3,.01),num('rackMaxLoadKg','Carga simulada máxima por posición (kg)',1500,1,3000,1),num('rackLevelLoadKg','Carga simulada máxima por módulo/nivel (kg)',6000,1,12000,1),
  num('rackSlope','Pendiente de los carriles (m/m)',.04,0,.12,.005),num('rackMechanismSpeed','Velocidad del mecanismo (m/s)',.25,.05,1,.05),
  num('rackBanks','Filas móviles',3,1,4),num('rackAisleWidth','Ancho de pasillo móvil (m)',2.8,1.2,4,.1),num('rackOpenAisle','Pasillo abierto (desde 0)',0,0,3),
  num('rackTransferHeight','Altura de transferencia sobre piso (m)',.8,.1,6,.05),num('rackSelectedSlot','Posición solicitada (desde 0)',0,0,127),
  {key:'rackSkuPolicy',label:'Referencias por calle',input:'select',default:'mixed',options:[{value:'mixed',label:'Permitir referencias diferentes'},{value:'lane',label:'Una referencia por calle'}]}
];
const INTEGER = new Set(['rackBays','rackLevels','rackColumns','rackDepthSlots','rackBanks','rackOpenAisle','rackSelectedSlot']);
function definition(value) {const id=typeof value==='string'?value:value&&value.rackSystem;return SYSTEMS.find(s=>s.id===id)||null;}
function isRack(value) {return !!(value&&value.rackSystem&&value.rackSystem!=='floor');}
function defaults(id='selective') {
  if(id==='floor')return {rackSystem:'floor'};
  const system=definition(id);if(!system)throw new Error('Sistema de estantería desconocido.');
  const result={};FIELDS.forEach(field=>{result[field.key]=field.default;});
  return Object.assign(result,system.preset,{rackSystem:id,rackSkuPolicy:['drive-in','drive-through','pallet-flow','push-back','carton-flow'].includes(id)?'lane':'mixed',
    palletType:'euro-1200x800',palletMaterial:'wood',width:1.2,depth:.8,acceptsPallets:system.acceptedLoad==='pallet',columns:1,rows:1,layers:1,layoutMode:'grid',autoRelease:false});
}
function normalize(value={}) {
  if(!isRack(value))return Object.assign({},value);
  const system=definition(value);if(!system)throw new Error('Sistema de estantería desconocido.');
  const result=Object.assign({},defaults(system.id),value);
  FIELDS.forEach(field=>{
    const item=result[field.key];
    if(field.input==='number'){
      if(typeof item!=='number'||!Number.isFinite(item)||item<field.min||item>field.max||INTEGER.has(field.key)&&!Number.isInteger(item))throw new Error('Valor fuera de rango en '+field.label+'.');
    }else if(!field.options.some(option=>option.value===item))throw new Error('Opción inválida en '+field.label+'.');
  });
  if(system.id==='double-deep')result.rackDepthSlots=2;
  if(['selective','mobile','cantilever','light-duty','medium-duty','mezzanine','vertical-lift','miniload'].includes(system.id))result.rackDepthSlots=1;
  if(system.id==='vertical-lift'){result.rackBays=1;result.rackColumns=1;}
  if(system.id!=='mobile')result.rackBanks=1;
  result.rackOpenAisle=Math.min(result.rackOpenAisle,result.rackBanks-1);
  const count=result.rackBays*result.rackLevels*result.rackColumns*result.rackDepthSlots*result.rackBanks;
  if(count>LIMIT)throw new Error('La estantería admite hasta 128 posiciones. Reduce módulos, niveles o profundidad.');
  if((result.rackBayWidth-.12)/result.rackColumns-result.rackClearance*2<.15||result.rackSlotDepth-result.rackClearance*2<.15)throw new Error('Las posiciones necesitan más espacio útil después de las holguras.');
  if(system.id==='mezzanine'){
    if(result.rackBaseHeight<2.1)throw new Error('El mezzanine necesita al menos 2,1 m de altura libre bajo la plataforma.');
    if(result.rackLevels>1&&result.rackLevelHeight<2.1)throw new Error('Los pisos del mezzanine necesitan al menos 2,1 m entre niveles.');
    if(result.rackBays*result.rackBayWidth<2.4)throw new Error('El mezzanine necesita al menos 2,4 m de frente para las escaleras y el paso de retorno.');
  }
  result.rackSelectedSlot=Math.min(result.rackSelectedSlot,count-1);
  result.palletCapacity=count;result.capacity=count;result.columns=result.rows=result.layers=1;result.layoutMode='grid';result.palletHeight=0;
  result.acceptsPallets=system.acceptedLoad==='pallet';result.autoRelease=false;
  return result;
}
function mobileOffset(value,bank,openAisle) {
  const c=normalize(value);if(c.rackSystem!=='mobile')return [0,0,0];
  const aisle=Math.max(0,Math.min(c.rackBanks-1,Number.isInteger(openAisle)?openAisle:c.rackOpenAisle));
  return [0,0,bank>=aisle?-c.rackAisleWidth:0];
}
function layout(value={}) {
  const c=normalize(value),system=definition(c);if(!system)throw new Error('Selecciona un sistema de estantería.');
  const frame=.12,storageLength=c.rackBays*c.rackBayWidth,bankDepth=c.rackDepthSlots*c.rackSlotDepth+.16,bankPitch=bankDepth+.12;
  const frontZ=bankDepth/2,backZ=frontZ-c.rackBanks*bankPitch+.12;
  const columnPitch=(c.rackBayWidth-frame)/c.rackColumns,cellWidth=columnPitch-c.rackClearance*2,cellDepth=c.rackSlotDepth-c.rackClearance*2;
  const accessFaces=system.loadFace===system.pickFace?[system.loadFace]:[system.loadFace,system.pickFace];
  const cells=[];
  for(let bank=0;bank<c.rackBanks;bank++)for(let bay=0;bay<c.rackBays;bay++)for(let level=0;level<c.rackLevels;level++)for(let column=0;column<c.rackColumns;column++)for(let depthIndex=0;depthIndex<c.rackDepthSlots;depthIndex++){
    const index=cells.length,x=(bay-(c.rackBays-1)/2)*c.rackBayWidth+(column-(c.rackColumns-1)/2)*columnPitch;
    const slope=(system.mechanism==='gravity'||system.mechanism==='push-back')?c.rackSlope*depthIndex*c.rackSlotDepth:0;
    const y=-1+c.rackBaseHeight+level*c.rackLevelHeight+slope,z=frontZ-.08-(depthIndex+.5)*c.rackSlotDepth-bank*bankPitch;
    const closedPosition=[x,y,z],offset=system.mechanism==='mobile'?mobileOffset(c,bank):[0,0,0],position=[x,y,z+offset[2]],lane=bank+':'+bay+':'+level+':'+column;
    cells.push({index,slot:index,palletIndex:index,localSlot:0,bay,column,level,depthIndex,bank,lane,position,closedPosition,x,y,z:position[2],width:cellWidth,depth:cellDepth,
      clearHeight:Math.max(.15,c.rackLevelHeight-.16),capacityKg:c.rackMaxLoadKg,levelCapacityKg:c.rackLevelLoadKg,
      loadFace:system.loadFace,pickFace:system.pickFace,accessFaces:accessFaces.slice(),requiredReachM:(depthIndex+.5)*c.rackSlotDepth});
  }
  const pallets=cells.map(cell=>Object.assign({},cell,{position:cell.position.slice(),top:cell.position[1]}));
  const automatic=system.mechanism==='lift'||system.mechanism==='miniload',shaftZ=frontZ+c.rackSlotDepth/2+.35;
  const lane=cells.filter(cell=>cell.bank===(system.mechanism==='mobile'?c.rackOpenAisle:0)&&cell.bay===0&&cell.level===0&&cell.column===0);
  const seatFor=face=>lane.find(cell=>cell.depthIndex===(face==='rear'?c.rackDepthSlots-1:0));
  const inputSeat=seatFor(system.loadFace),outputSeat=seatFor(system.pickFace);
  const accessPosition=automatic?[0,-1+c.rackTransferHeight,shaftZ+.6]:inputSeat.position.slice();
  // Static links stage only at a real, lowest reachable seat. They do not
  // make a conveyor magically reach upper tiers/deeper blocked locations.
  // Automatic machines own the explicit route from their one real window.
  const port=(face,incoming,seat)=>({x:automatic?accessPosition[0]:seat.position[0],y:automatic?accessPosition[1]:seat.position[1],
    z:automatic?accessPosition[2]:seat.position[2]+(face==='rear'?-1:1)*(c.rackSlotDepth/2+.16),
    tx:0,tz:face==='rear'?(incoming?1:-1):(incoming?-1:1),width:cellWidth,face,seatIndex:seat.index,supportPosition:(automatic?accessPosition:seat.position).slice()});
  const input=port(system.loadFace,true,inputSeat),output=port(system.pickFace,false,outputSeat);
  const stairRun=system.id==='mezzanine'?(c.rackLevels>1?Math.max(Math.ceil(c.rackBaseHeight/.18),Math.ceil(c.rackLevelHeight/.18))*.28+.55:Math.ceil(c.rackBaseHeight/.18)*.28+.2):0;
  const physicalBack=backZ-(system.mechanism==='mobile'?c.rackAisleWidth:0),physicalFront=automatic?accessPosition[2]+cellDepth/2+.2:frontZ+stairRun;
  const length=automatic?storageLength+.3:storageLength;
  // Rear seats rise along inclined lanes. Include their actual usable envelope
  // and framing so long/deep recipes remain inside the authored footprint.
  const storedHeight=Math.max(...cells.map(cell=>cell.position[1]+cell.clearHeight))+1+.22;
  const height=Math.max(c.rackBaseHeight+c.rackLevels*c.rackLevelHeight+.15,storedHeight,automatic?c.rackTransferHeight+cells[0].clearHeight+.35:0);
  return {rack:true,config:c,definition:system,length,width:physicalFront-physicalBack,height,floor:-1,frontZ,backZ,storageLength,
    bounds:[-length/2,-1,physicalBack,length/2,-1+height,physicalFront],storageBounds:[-storageLength/2,-1,backZ,storageLength/2,-1+height,frontZ],
    bankDepth,bankPitch,columnPitch,bayWidth:c.rackBayWidth,levelHeight:c.rackLevelHeight,baseHeight:c.rackBaseHeight,stairRun,
    input,inlet:input,output,outlet:output,inputSeatIndex:inputSeat.index,outputSeatIndex:outputSeat.index,accessPosition,shaftPosition:[0,shaftZ],deckHeight:-1+c.rackBaseHeight,
    palletPosition:cells[0].position.slice(),palletTop:cells[0].position[1],queuePosition:accessPosition.slice(),cellWidth,cellDepth,cells,slots:cells,pallets,
    pallet:{width:cellWidth,depth:cellDepth,columns:1,rows:1,layers:1,capacity:cells.length,top:cells[0].position[1],floor:-1},
    mobile:{axis:[0,0,-1],stroke:c.rackAisleWidth,banks:c.rackBanks,openAisle:c.rackOpenAisle},
    motion:{mechanism:system.mechanism,speed:c.rackMechanismSpeed,shaftPosition:[0,shaftZ],accessPosition:accessPosition.slice()}};
}

module.exports={LIMIT,SYSTEMS,FIELDS,isRack,definition,defaults,normalize,settings:normalize,layout,mobileOffset};
