'use strict';
const assert=require('node:assert/strict'),THREE=require('three'),racks=require('../../modules/logistica-industrial/functions/almacenamiento/schema/warehouseRacks'),visual=require('../../modules/logistica-industrial/functions/almacenamiento/schema/warehouseRackVisual');
let checked=0;
for(const kind of ['light-duty','medium-duty','vertical-lift','miniload']){
 const config=racks.defaults(kind),layout=racks.layout(config),before=JSON.stringify(layout),root=visual.createVisual(THREE,config,layout),meshes=[];root.updateMatrixWorld(true);root.traverse(node=>{if(node.isMesh)meshes.push(node);});
 for(const cell of layout.cells){const p=cell.position;
  for(const sign of [-1,1]){
   const origin=new THREE.Vector3(p[0],p[1]+.04,p[2]+sign*cell.depth*.44),ray=new THREE.Raycaster(origin,new THREE.Vector3(0,-1,0),0,.22),hits=ray.intersectObjects(meshes,false),deck=hits.find(hit=>hit.object.userData.materialPart==='deck'),beam=hits.find(hit=>hit.object.userData.materialPart==='beam');
   assert(deck&&beam,kind+' has actual shelf and supporting beam geometry');assert(Math.abs(deck.point.y-p[1])<2e-6,kind+' retains its actual pallet support height');assert(Math.abs(deck.point.y-beam.point.y-.036)<2e-6,kind+' does not stack coplanar painted/galvanised upper faces');
   const top=hits.filter(hit=>Math.abs(hit.point.y-p[1])<.0005);assert(top.every(hit=>hit.object.userData.materialPart==='deck'),kind+' top pixels cannot alternate between two material banks');checked++;
  }
 }
 assert.equal(JSON.stringify(layout),before,'Appearance cleanup never changes location codes, dimensions or stock layout');assert(visual.stats(root).draws<=24);visual.disposeVisual(root);
}
console.log('Shelf surface separation: '+checked+' real front/rear ray probes across four rack families, no competing material faces, unchanged support/layout and bounded batches passed.');
