'use strict';

// One authored receiving bank shared by the five CEDI practices. Coordinates
// are metres in the installation; native conveyor ports, not intersecting
// decorative rollers, define each right-angle connection.
const VERSION=1,ID='cedi-receiving-inspection-v1';
const BRANCH_X=[-28.25,-23.75,-19.25],WIDTH=1.35,TOP=1,FRONT_Z=-.5,SPINE_Z=-6.3,TRANSFER_LENGTH=1.4;
const BRANCH_END=SPINE_Z+TRANSFER_LENGTH/2,BRANCH_LENGTH=FRONT_Z-BRANCH_END;
const BASE={surface:'rollers',width:WIDTH,supportHeight:TOP,rollerPitch:.12,maxLoad:600,clearance:2.5,withPanel:false,withSensors:true,withPallet:false,autoSpawn:false,powered:true,running:true,paused:false,speed:.35,detail:'low',wear:.17};
const fixtures=[],connections=[],workcells=[];
const row=(key,zone,kind,equipment,pose,active,values)=>fixtures.push([key,zone,kind,equipment,pose,active,values]);
for(let i=0;i<BRANCH_X.length;i++){
 const x=BRANCH_X[i],code='REC-QC-0'+(i+1),intakeKey='receiving-intake-'+i,transferKey='receiving-transfer-'+i;
 row(intakeKey,'receiving','conveyor','equipment.transport.roller-pallet',[x,TOP,(FRONT_Z+BRANCH_END)/2,Math.PI/2],'CEDI-01',Object.assign({},BASE,{length:BRANCH_LENGTH}));
 // A pallet-compatible pop-up chain transfer receives from the north branch,
 // then hands the same physical load to the eastbound roller collector. Its
 // lifting strands occupy the gaps between the transverse support rollers.
 row(transferKey,'receiving','conveyor','equipment.transport.popup-transfer',[x,TOP,SPINE_Z,0],'CEDI-01',Object.assign({},BASE,{length:TRANSFER_LENGTH,surface:'chains',layout:'tee',mechanism:'liftTransfer',junctionMode:'merge',branchSide:'right',mergeAngle:90,routing:'primary',actuatorTime:.7}));
 connections.push({sourceKey:intakeKey,sourcePort:'output',targetKey:transferKey,targetPort:'branch'});
 const benchKey='receiving-qc-bench-'+i,rackKey='receiving-qc-rack-'+i;
 row(benchKey,'inspection','processor','equipment.picking.receiving-inspection',[x+2.6,TOP,-1.7,0],null,{length:1.6,width:1.05,withPanel:false,detail:'low',wear:.17});
 row(rackKey,'inspection','palletQueue','equipment.storage.light-medium',[x+2.25,TOP,-3.8,0],null,{rackBays:1,rackLevels:3,rackColumns:1,rackBayWidth:2.2,rackBayWidths:'2.2',rackSlotDepth:.65,rackLevelHeight:.55,withPanel:false,autoRelease:false,detail:'low',wear:.17});
 workcells.push({id:code,index:i+1,intakeKey,transferKey,benchKey,rackKey,branchX:x,benchCenter:[x+2.6,TOP,-1.7],rackCenter:[x+2.25,TOP,-3.8],operatorCenter:[x+2.25,0,-2.85],operatorEntrance:{from:x+WIDTH/2+.18,to:x+2.6-.8,minWidth:.9},guardLine:{axis:'x',coordinate:-4.9,from:x+.9,to:x+4.05},accessGap:{from:x+2.9,to:x+4.05},footprint:[x-.87,-5.4,x+3.55,1]});
 if(i<BRANCH_X.length-1){
  const next=BRANCH_X[i+1],key='receiving-collector-'+i,start=x+TRANSFER_LENGTH/2,end=next-TRANSFER_LENGTH/2;
  row(key,'receiving','conveyor','equipment.transport.roller-pallet',[(start+end)/2,TOP,SPINE_Z,0],'CEDI-01',Object.assign({},BASE,{length:end-start}));
  connections.push({sourceKey:transferKey,sourcePort:'output',targetKey:key,targetPort:'input'},{sourceKey:key,sourcePort:'output',targetKey:'receiving-transfer-'+(i+1),targetPort:'input'});
 }
}
const EXIT_START=BRANCH_X[2]+TRANSFER_LENGTH/2,EXIT_LENGTH=2;
row('receiving-outfeed','receiving','conveyor','equipment.transport.roller-pallet',[EXIT_START+EXIT_LENGTH/2,TOP,SPINE_Z,0],'CEDI-01',Object.assign({},BASE,{length:EXIT_LENGTH}));
connections.push({sourceKey:'receiving-transfer-2',sourcePort:'output',targetKey:'receiving-outfeed',targetPort:'input'});
const RECEIVING={version:VERSION,id:ID,title:'Recepción · descarga, inspección y clasificación',fixtures,connections,workcells,
 branchXs:BRANCH_X,width:WIDTH,deckY:TOP,frontZ:FRONT_Z,spineZ:SPINE_Z,transferLength:TRANSFER_LENGTH,
 bounds:[-29.3,-7.3,-15.55,1.25],pedestrianReturn:[-29.2,-8.15,-15,-7.15],
 untouchedInspectionBay:[-24,0,4],untouchedActiveApproach:[[-22,19],[-22,14],[-24,10],[-24,6.5]],
 inlets:workcells.map(cell=>({key:cell.intakeKey,port:'input',position:[cell.branchX,TOP,FRONT_Z],tangent:[0,0,-1]})),
 outlet:{key:'receiving-outfeed',port:'output',position:[EXIT_START+EXIT_LENGTH,TOP,SPINE_Z],tangent:[1,0,0]},
 policy:'CEDI-01 usa transportadores nativos conectados y vacíos; no crean ni duplican inventario. CEDI-02 a CEDI-05 muestran la misma geometría como contexto estático. Los puestos adicionales no sustituyen las comprobaciones ni los apoyos físicos de la misión de recepción.'};
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
freeze(RECEIVING);
const copy=value=>JSON.parse(JSON.stringify(value));
module.exports={VERSION,ID,RECEIVING,layout:()=>copy(RECEIVING),fixtures:()=>copy(fixtures),connections:()=>copy(connections),workcells:()=>copy(workcells)};
