'use strict';

// Stable, shared world-space installation. Runtime actors and inventory are
// independent of architecture; none of the validated front docks are moved.
const VERSION=2,ID='cedi-unified-u-v2';
const area=(label,rect,floorY=0,kind='operations')=>({label,rect,center:[(rect[0]+rect[2])/2,floorY,(rect[1]+rect[3])/2],width:rect[2]-rect[0],depth:rect[3]-rect[1],floorY,kind});
const zones={
 receiving:area('Recepción y descarga',[-29,9,-10,20]),
 inspection:area('Inspección y registro',[-29,0,-18,8]),
 quarantine:area('Cuarentena segregada',[-8,0,-1,7]),
 reserveStorage:area('Almacenamiento de reserva',[-24,-20,23,-11]),
 rearReserve:area('Reserva posterior y alta densidad',[-14,-36,24,-22]),
 asrs:area('Almacén automático AS/RS',[-30,-36,-16,-22]),
 picking:area('Picking y reposición',[3,-3,23,5]),
 pickingFloor:area('Picking de piso y preparación ABC',[3,-11,23,-9.4]),
 specialStorage:area('Cargas especiales y almacenamiento cerrado',[26.5,-32,30,-16.5]),
 palletizing:area('Paletizado y envoltura',[22.5,3,30.5,12]),
 consolidation:area('Consolidación',[3,7,8,12]),
 packing:area('Empaque y paletizado',[10,7,23,12]),
 dispatch:area('Preparación de despacho',[11,13,24,20]),
 crossDock:area('Cross-docking y transferencia frontal',[-27,13,27,18]),
 emptyPackaging:area('Envases y embalajes vacíos',[-8,8,-1,12]),
 maintenance:area('Taller de mantenimiento exterior',[-44,-31,-33,-19],0,'support'),
 administration:area('Administración exterior · dos plantas',[33,1,44,20],0,'support'),
 upperOffice:area('Oficinas y sala de reunión',[33,1,44,20],3.3,'support'),
 restrooms:area('Servicios higiénicos',[39.2,12,44,20],0,'support'),
 lockers:area('Vestuario y casilleros',[33,15,37.5,20],0,'support'),
 parking:area('Estacionamiento de personal',[-46,25,-35,51],-1.15,'outdoor'),
 yard:area('Patio de maniobras',[-33,22,33,54],-1.15,'outdoor')
};
// Dispersed process islands are represented as distinct real subareas. Keep
// every established main rect unchanged: active native tasks address them.
const subarea=(id,label,rect,floorY=0)=>({id,...area(label,rect,floorY)});
for(const zone of Object.values(zones))zone.areas=[subarea('main',zone.label,zone.rect,zone.floorY)];
zones.receiving.areas.push(subarea('receiving-docks','Muelles REC-01 y REC-02',[-25,21,-11,35],-1.15),subarea('receiving-roller-west','Rodillos de recepción oeste',[-29.6,.2,-26.4,6.5]),subarea('receiving-roller-east','Rodillos de recepción este',[-18.6,.2,-15.4,6.5]));
zones.inspection.areas.push(subarea('quality-checks','Puestos adicionales de control de calidad',[-29.5,-10.4,-16.5,-7.5]));
zones.consolidation.areas.push(subarea('order-control','Control de pedidos junto al picking',[18.5,-1.2,23.5,1.4]));
zones.packing.areas.push(subarea('manual-packing-line','Empaque manual, encintado y etiquetado',[7.5,-5.2,23.5,-1]));
zones.dispatch.areas.push(subarea('dispatch-docks','Muelles DES-01 y DES-02',[11,21,25,35],-1.15),subarea('front-staging','Lotes de despacho preparados',[4.3,19.4,10.7,20.8]),subarea('dispatch-control','Registro y control de expedición',[25.5,8.5,30,12]));
zones.crossDock.areas.push(subarea('transfer-buffers','Bancos laterales de transferencia rápida',[-8.2,17.8,3.2,20.1]));
const docks=[[-22,'REC-01','receiving'],[-14,'REC-02','receiving'],[14,'DES-01','dispatch'],[22,'DES-02','dispatch']].map(([x,id,purpose])=>({
 id,label:(purpose==='receiving'?'RECEPCIÓN ':'DESPACHO ')+id,purpose,axis:'x',side:'front',wallCoordinate:22,center:x,width:4.2,height:4.8,deckY:0,apronY:-1.15,
 warehouseApproach:[x,0,18],yardApproach:[x,-1.15,39],bridgeRect:[x-1.45,20.8,x+1.45,22.5],
 truck:{position:[x,-1.147,27.9],yaw:Math.PI/2,length:12,width:2.45,height:3.1,rearAtZ:22.26,bedTopY:0}
}));
const LAYOUT={version:VERSION,id:ID,title:'CEDI · instalación compartida y anexos',flow:'U',
 bounds:{minX:-32,maxX:32,minZ:-38,maxZ:22,height:10.2,floorY:0},
 interiorArea:{width:64,depth:60},siteBounds:{minX:-48,maxX:48,minZ:-46,maxZ:58},
 groundBounds:{minX:-72,maxX:72,minZ:-64,maxZ:82},
 worldBoundary:{minX:-70.8,maxX:70.8,minZ:-62.8,maxZ:80.8,height:2.4,thickness:.4},
 apronY:-1.15,docks,zones,
 aisles:{
  vehicleRects:[[-14,-9,-10,20],[-14,-9,29,-5],[25,-36,29,20],[-29,16,-10,20],[10,16,29,20],[-30,-22,29,-20],[-16,-36,-14,-20]],
  safePolyline:[[-22,0,18],[-12,0,18],[-12,0,-7],[27,0,-7],[27,0,18],[22,0,18]],
  pedestrianRects:[[-31,-7,-29,20],[-29,-7,-15,-5],[29,-36,31,20],[-10,12,10,14],[-31,-37,29,-35],[29.5,3.8,33.2,6.2],[-33.2,-26.2,-29.5,-23.8]],
  pedestrianRamp:{rect:[-1.6,22,1.6,36],fromY:0,toY:-1.15,axis:'z'},
  crossings:[[-15,12,-9,13.5],[24,12,30,13.5],[-29,14,-10,15.2],[10,14,29,15.2]]
 },
 annexes:{
  administration:{rect:[33,1,44,20],floorY:0,upperY:3.3,height:6.6,connectorRect:[31.8,3.8,33.2,6.2],warehouseDoor:{axis:'z',coordinate:32,center:5,width:2.4,height:2.6},entrance:{axis:'x',coordinate:20,center:38.4,width:2.4,height:2.6},ramp:{rect:[37.2,20,39.6,32],fromY:0,toY:-1.15,axis:'z'},stair:{voidRect:[34,8.5,37,12.7],flight1:[34,8.5,35.3,11.3],flight2:[35.7,8.5,37,11.3],landingRect:[34,11.3,37,12.7],rise:3.3,stepsPerFlight:10,tread:.28,stepHeight:.165,groundStart:[34.65,0,8.15],landing:[34.65,1.65,12],upperEnd:[36.35,3.3,8.15]}},
  maintenance:{rect:[-44,-31,-33,-19],floorY:0,height:3.7,connectorRect:[-33.2,-26.2,-31.8,-23.8],warehouseDoor:{axis:'z',coordinate:-32,center:-25,width:2.4,height:2.8},entrance:{axis:'z',coordinate:-44,center:-25,width:2.6,height:2.8},ramp:{rect:[-54,-26.2,-44,-23.8],fromY:-1.15,toY:0,axis:'x'}}
 },
 rooms:[
  {id:'control',label:'Recepción administrativa',rect:[38.5,1,44,8],floorY:0,door:{axis:'z',coordinate:38.5,center:5,width:1.5,height:2.25}},
  {id:'office',label:'Oficinas · planta alta',rect:[33,1,44,20],floorY:3.3,door:{axis:'x',coordinate:8.3,center:36.35,width:1.3,height:2.25}},
  {id:'lockers',label:'Vestuario',rect:[33,15,37.5,20],floorY:0,door:{axis:'z',coordinate:37.5,center:17,width:1.3,height:2.25}},
  {id:'restrooms',label:'Servicios higiénicos',rect:[39.2,12,44,20],floorY:0,door:{axis:'z',coordinate:39.2,center:14,width:1.3,height:2.25}},
  {id:'maintenance',label:'Mantenimiento exterior',rect:[-44,-31,-33,-19],floorY:0,door:{axis:'z',coordinate:-33,center:-25,width:2.4,height:2.8}}
 ],
 initialView:{eye:[-27,1.65,16],target:[-18,1,9]},
 provenance:'Instalación didáctica de flujo en U compartida por cinco prácticas; ampliación posterior AS/RS y reserva, administración de dos plantas y mantenimiento exteriores. No es una réplica OEM.'
};
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
freeze(LAYOUT);
const copy=value=>value?JSON.parse(JSON.stringify(value)):null;
function layout(){return copy(LAYOUT);}
function zone(id){return copy(LAYOUT.zones[id]);}
function dock(id){return copy(LAYOUT.docks.find(row=>row.id===id));}
module.exports={VERSION,ID,LAYOUT,layout,zone,dock};