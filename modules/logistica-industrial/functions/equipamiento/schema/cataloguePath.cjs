'use strict';

// Shared sampled route for catalogue geometry, native conveyor custody and
// authoring ports. Product transport is discrete-lot kinematics, not CFD or DEM.
const capabilities=require('./equipmentCapabilities.cjs');
const CUSTOM=new Set(['telescopic','spiral','overhead','transfer-cart','crossbelt-sorter','shoe-sorter','tilt-tray-sorter','vibratory','screw','bucket-elevator','pneumatic','slat-chain']);
const SORTERS=new Set(['crossbelt-sorter','shoe-sorter','tilt-tray-sorter']);
const cache=new WeakMap();
function mechanism(value){const id=value&&value.catalogueEquipmentId;return typeof id==='string'&&id.startsWith('equipment.transport.')?id.slice('equipment.transport.'.length):'';}
function handles(value){return CUSTOM.has(mechanism(value));}
function path(value,route='main'){
 if(!handles(value))return null;
 const key=[value.catalogueEquipmentId,value.length,value.width,value.height,value.rise,value.axis,value.speed,value.branchSide,route].join('|'),prior=cache.get(value);
 if(prior&&prior.key===key)return prior.path;
 const result=capabilities.route(value.catalogueEquipmentId,value);
 if(route==='branch'&&SORTERS.has(mechanism(value))){const L=Number.isFinite(value.length)?value.length:4,side=value.branchSide==='right'?1:-1;result.points=[[-L/2,0,0],[0,0,0],[0,0,side*L/2]];result.lengths=[0,L/2,L];result.length=L;}
 if(value.axis==='z')result.points=result.points.map(([x,y,z])=>[-z,y,x]);
 cache.set(value,{key,path:result});return result;
}
function point(value,distance,route='main'){
 const p=path(value,route);if(!p)return null;
 const clamped=Math.max(0,Math.min(p.length,Number.isFinite(distance)?distance:0)),sample=capabilities.pointAt(p,clamped),extra=distance<0?distance:distance>p.length?distance-p.length:0;
 const pos=sample.position.map((v,k)=>v+sample.tangent[k]*extra);
 return {x:pos[0],y:pos[1],z:pos[2],tx:sample.tangent[0],ty:sample.tangent[1],tz:sample.tangent[2]};
}
function ports(value){
 const main=path(value);if(!main)return null;
 const result={input:Object.assign(point(value,0),{incoming:true,route:'main'}),output:Object.assign(point(value,main.length),{incoming:false,route:'main'})};
 if(SORTERS.has(mechanism(value)))result.branch=Object.assign(point(value,path(value,'branch').length,'branch'),{incoming:false,route:'branch'});
 const bulk=['screw','pneumatic','bucket-elevator'].includes(mechanism(value));
 Object.values(result).forEach(p=>Object.assign(p,{width:value.width||1,height:p.y,surface:bulk?'enclosed-batch':value.surface||'belt',drive:value.drive||'motor',direction:p.incoming?'input':'output',loadClass:bulk?'bulk-batch':'unit',coordination:['ready','occupied','transferComplete']}));
 return result;
}
function closest(value,x,z,route='main',y){
 const p=path(value,route);if(!p)return null;
 let best=null;
 for(let i=1;i<p.points.length;i++){
  const a=p.points[i-1],b=p.points[i],delta=b.map((v,k)=>v-a[k]),query=[x,Number.isFinite(y)?y:0,z],axes=Number.isFinite(y)?[0,1,2]:[0,2];
  const denominator=axes.reduce((s,k)=>s+delta[k]*delta[k],0),t=Math.max(0,Math.min(1,axes.reduce((s,k)=>s+(query[k]-a[k])*delta[k],0)/(denominator||1)));
  const distance=p.lengths[i-1]+(p.lengths[i]-p.lengths[i-1])*t,sample=point(value,distance,route),distanceSq=(x-sample.x)**2+(z-sample.z)**2+(Number.isFinite(y)?(y-sample.y)**2:0),ex=x-sample.x,ez=z-sample.z;
  if(!best||distanceSq<best.distanceSq)best=Object.assign({distance,distanceSq,lateral:-sample.tz*ex+sample.tx*ez},sample);
 }
 return best;
}
function compatibility(value,product={}){
 if(!handles(value))return null;
 const kind=mechanism(value),reasons=[],id=product.catalogueEquipmentId||product.spec&&product.spec.catalogueEquipmentId||'',material=product.materialClass||product.spec&&product.spec.materialClass||'';
 const bulk=material==='bulk'||material==='fluid'||id==='equipment.product.bulk-fluid';
 const bulkMachine=['screw','pneumatic','bucket-elevator'].includes(kind);
 const pallet=product.loadMode==='pallet'||product.productType==='pallet'||product.type==='pallet';
 if(bulkMachine&&(!bulk||pallet))reasons.push({code:'bulk-only',message:'Este equipo admite lotes discretos de granel/fluidos declarados; una caja, saco cerrado o pallet necesita otro transportador.'});
 if(!bulkMachine&&bulk)reasons.push({code:'contained-load',message:'El material a granel necesita un transportador de granel o un recipiente compatible.'});
 if(pallet&&['spiral','overhead','crossbelt-sorter','shoe-sorter','tilt-tray-sorter','vibratory','telescopic'].includes(kind))reasons.push({code:'unit-load-only',message:'La variante educativa está configurada para unidades compatibles, no pallets completos.'});
 if(Number.isFinite(product.mass)&&product.mass>(value.maxLoad||50))reasons.push({code:'mass',message:'La masa declarada supera la capacidad configurada.'});
 if(Number.isFinite(product.depth)&&product.depth>(value.width||1)+1e-5)reasons.push({code:'width',message:'La carga supera el ancho útil.'});
 return {ok:reasons.length===0,reasons,simulationLevel:'discrete-load-kinematics',limits:bulkMachine?'No calcula presión, caudal, dinámica granular ni alimentación de hardware.':''};
}
module.exports={CUSTOM,SORTERS,handles,path,point,ports,closest,compatibility};
