'use strict';

// One world-space facility for the five CEDI practices. These rectangles are
// usable actor envelopes, not scaled silhouettes from an individual exercise.
const VERSION=1,ID='cedi-unified-u-v1';
const area=(label,rect,floorY=0,kind='operations')=>({label,rect,center:[(rect[0]+rect[2])/2,floorY,(rect[1]+rect[3])/2],width:rect[2]-rect[0],depth:rect[3]-rect[1],floorY,kind});
const zones={
 receiving:area('Recepción y descarga',[-29,9,-10,20]),
 inspection:area('Inspección y registro',[-29,0,-18,8]),
 quarantine:area('Cuarentena segregada',[-8,0,-1,7]),
 reserveStorage:area('Almacenamiento de reserva',[-24,-20,23,-11]),
 picking:area('Picking y reposición',[3,-3,23,5]),
 consolidation:area('Consolidación',[3,7,8,12]),
 packing:area('Empaque y paletizado',[10,7,23,12]),
 dispatch:area('Preparación de despacho',[11,13,24,20]),
 emptyPackaging:area('Envases y embalajes vacíos',[-8,8,-1,12]),
 maintenance:area('Mantenimiento',[-31,-19,-26,-9],0,'support'),
 administration:area('Administración y control',[-9,14,9,22],0,'support'),
 restrooms:area('Servicios higiénicos',[2,18,9,22],0,'support'),
 lockers:area('Vestuario y casilleros',[2,14,9,18],0,'support'),
 parking:area('Estacionamiento de personal',[-46,25,-35,51],-1.15,'outdoor'),
 yard:area('Patio de maniobras',[-33,22,33,54],-1.15,'outdoor')
};
const docks=[[-22,'REC-01','receiving'],[-14,'REC-02','receiving'],[14,'DES-01','dispatch'],[22,'DES-02','dispatch']].map(([x,id,purpose])=>({
 id,label:(purpose==='receiving'?'RECEPCIÓN ':'DESPACHO ')+id,purpose,axis:'x',side:'front',wallCoordinate:22,center:x,width:4.2,height:4.8,deckY:0,apronY:-1.15,
 warehouseApproach:[x,0,18],yardApproach:[x,-1.15,39],bridgeRect:[x-1.45,20.8,x+1.45,22.5],
 truck:{position:[x,-1.147,27.9],yaw:Math.PI/2,length:12,width:2.45,height:3.1,rearAtZ:22.26,bedTopY:0}
}));
const LAYOUT={version:VERSION,id:ID,title:'CEDI · instalación compartida',flow:'U',
 bounds:{minX:-32,maxX:32,minZ:-22,maxZ:22,height:9.2,floorY:0},
 interiorArea:{width:64,depth:44},siteBounds:{minX:-48,maxX:48,minZ:-30,maxZ:58},
 groundBounds:{minX:-72,maxX:72,minZ:-48,maxZ:82},
 worldBoundary:{minX:-70.8,maxX:70.8,minZ:-46.8,maxZ:80.8,height:2.4,thickness:.4},
 apronY:-1.15,docks,zones,
 aisles:{
  vehicleRects:[[-14,-9,-10,20],[-14,-9,29,-5],[25,-9,29,20],[-29,16,-10,20],[10,16,29,20]],
  safePolyline:[[-22,0,18],[-12,0,18],[-12,0,-7],[27,0,-7],[27,0,18],[22,0,18]],
  pedestrianRects:[[-31,-7,-29,20],[-29,-7,-15,-5],[29,-20,31,20],[-10,12,10,14]],
  pedestrianRamp:{rect:[-1.6,22,1.6,36],fromY:0,toY:-1.15},
  crossings:[[-15,12,-9,13.5],[24,12,30,13.5]]
 },
 rooms:[
  {id:'office',label:'Administración',rect:[-9,18,-2,22],door:{axis:'z',coordinate:-2,center:20,width:1.25,height:2.25}},
  {id:'control',label:'Control y recepción',rect:[-9,14,-2,18],door:{axis:'x',coordinate:14,center:-5.5,width:1.3,height:2.25}},
  {id:'lockers',label:'Vestuario',rect:[2,14,9,18],door:{axis:'x',coordinate:14,center:5.5,width:1.3,height:2.25}},
  {id:'restrooms',label:'Servicios higiénicos',rect:[2,18,9,22],door:{axis:'z',coordinate:2,center:20,width:1.25,height:2.25}},
  {id:'maintenance',label:'Mantenimiento',rect:[-31,-19,-26,-9],door:{axis:'z',coordinate:-26,center:-13,width:1.6,height:2.45}}
 ],
 initialView:{eye:[-27,1.65,16],target:[-18,1,9]},
 provenance:'Planta didáctica genérica de flujo en U, compartida por CEDI-01 a CEDI-05; las dimensiones son del simulador y no una réplica OEM.'
};
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
freeze(LAYOUT);
const copy=value=>value?JSON.parse(JSON.stringify(value)):null;
function layout(){return copy(LAYOUT);}
function zone(id){return copy(LAYOUT.zones[id]);}
function dock(id){return copy(LAYOUT.docks.find(row=>row.id===id));}
module.exports={VERSION,ID,LAYOUT,layout,zone,dock};
