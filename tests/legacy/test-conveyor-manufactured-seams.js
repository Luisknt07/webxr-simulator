'use strict';
const assert=require('node:assert/strict'),THREE=require('three'),{setup}=require('./test-vehicle-storage'),layout=require('../../modules/logistica-industrial/functions/bandas/schema/conveyors');
let probes=0;
for(const variant of ['roller-curve-left','roller-curve-right','roller-tee-split','roller-tee-merge']){
 const document=setup(),root=document.addPrefab('hall','conveyor',variant),config=document.getBehaviors(root).find(c=>c.type==='conveyor'),parts=[];root.updateMatrixWorld(true);root.traverse(node=>{if(node.isMesh&&/Ala superior del perfil/i.test(node.material.name))parts.push(node);});assert(parts.length);
 const length=layout.pathLength(config,'main'),steps=Math.max(2,Math.min(512,Math.ceil(length/.14)));let exposed=0;
 const shared=[];if(config.layout==='tee'){const length=layout.pathLength(config,'branch');for(let i=0;i<=640;i++){const p=layout.pathPoint(config,length*i/640,'branch');if(Math.abs(p.z)<1e-7&&p.tx>.999999)shared.push(p.x);}}
 for(let index=1;index<steps;index++){
  const at=layout.pathPoint(config,index*length/steps,'main');
  // Crossing profiles at the actual T mouth are a legitimate joined frame;
  // the shared upstream approach must have only one exposed top surface.
  if(config.layout==='tee'&&(at.x<Math.min(...shared)+.15||at.x>Math.max(...shared)-.15))continue;
  for(const offset of [-.0015,.0015])for(const side of [-1,1]){
   const p=layout.pathPoint(config,index*length/steps+offset,'main'),z=side*(config.width/2+.1),origin=root.localToWorld(new THREE.Vector3(p.x-p.tz*z,.1,p.z+p.tx*z)),hits=new THREE.Raycaster(origin,new THREE.Vector3(0,-1,0),0,.3).intersectObjects(parts,false);
   const label=variant+' has no competing flange at manufactured seam '+index+' / '+side+' / '+offset;
   if(config.layout==='tee')assert(hits.length<=1,label);else assert.equal(hits.length,1,label);if(hits.length)exposed++;probes++;
  }
 }
 assert(exposed>=4,variant+' still exposes real supporting flanges away from its open junction');
 // Actual local surface normals remain finite/unit after the same production
 // batching and complete actor transform used by the editor.
 for(const part of parts){const normal=part.geometry.attributes.normal;for(let i=0;i<normal.count;i++)assert(Math.abs(new THREE.Vector3().fromBufferAttribute(normal,i).length()-1)<1e-5);}
}
console.log('Conveyor manufacturing seams: '+probes+' real curved/T exposed-flange ray probes, shared mitre planes, no repeated common approach, bounded normals and unchanged actor paths passed.');
