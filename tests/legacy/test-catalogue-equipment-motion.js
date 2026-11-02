'use strict';
// Actual geometry, actual processor-state contract, and sampled mechanism poses.
// This checks bounded presentation, not material-removal/thermal/fluid physics.
const assert=require('node:assert/strict'),THREE=require('three');
const catalog=require('../../modules/logistica-industrial/functions/equipamiento/schema/equipmentCatalog.cjs');
const geometry=require('../../modules/logistica-industrial/functions/equipamiento/runtime/EquipmentGeometry.cjs');
const rackSchema=require('../../modules/logistica-industrial/functions/almacenamiento/schema/warehouseRacks.js');
const meshes=root=>{const out=[];root.traverse(n=>{if(n.isMesh)out.push(n);});return out;};
const actors=root=>{const out=[];root.traverse(n=>{if(n.userData.equipmentMotion)out.push(n);});return out;};
const fixture=id=>{const def=catalog.definition(id),cfg=catalog.normalize(id),layout=catalog.layout(id,cfg),root=geometry.createEquipmentGeometry(def,cfg,{THREE,layout});root.userData.catalogueGeometryBody=true;return {def,cfg,layout,root};};
const state=progress=>({enabled:true,powered:true,running:true,busy:true,progress,state:'PROCESSING'});
let animated=0;
for(const def of catalog.DEFINITIONS.filter(d=>d.nativeKind==='processor')){
 if(geometry.keepNative(def))continue;
 const f=fixture(def.id),nodes=actors(f.root),staticNodes=meshes(f.root).filter(n=>!n.parent.userData.equipmentMotion),before=staticNodes.map(n=>n.matrixWorld.clone()),identities=nodes.map(n=>n.uuid);
 if(nodes.length)animated++;
 const rest=nodes.map(n=>({position:n.position.clone(),quaternion:n.quaternion.clone()}));
 for(const progress of [0,25,50,75,100]){
  geometry.animateEquipment(f.root,state(progress));
  staticNodes.forEach((n,i)=>assert(n.matrixWorld.equals(before[i]),def.id+': housings, buffers and support frames remain fixed.'));
  for(const n of nodes){assert(n.matrixWorld.elements.every(Number.isFinite));const motion=n.userData.equipmentMotion,axis=motion.axis,entry=rest[nodes.indexOf(n)];if(motion.kind==='linear'){const displacement=n.position[axis]-entry.position[axis];assert(displacement>=Math.min(0,motion.min||0)-1e-7&&displacement<=Math.max(0,motion.max||0)+1e-7,def.id+': bounded actuator stroke.');}const box=new THREE.Box3().setFromObject(n);assert(box.min.y>=f.layout.floor-1e-5,def.id+': moving part never crosses the installation floor.');}
 }
 geometry.animateEquipment(f.root,state(12.5));const stopped=nodes.map(n=>n.matrixWorld.clone());
 for(const stop of [{paused:true},{emergency:true},{running:false},{waitingOperator:true},{settingUp:true},{powered:false}]){
  geometry.animateEquipment(f.root,Object.assign(state(66),stop));nodes.forEach((n,i)=>assert(n.matrixWorld.equals(stopped[i]),def.id+': a stopped machine cannot continue an independent visual timer.'));
 }
 geometry.animateEquipment(f.root,{editing:true});nodes.forEach((n,i)=>{assert(n.position.equals(rest[i].position));assert(n.quaternion.equals(rest[i].quaternion));});assert.deepEqual(nodes.map(n=>n.uuid),identities,'Animation must preserve actor identity.');
 // A real top-facing surface exists at every authoritative staging point.
 f.root.updateMatrixWorld(true);
 for(const buffer of f.root.userData.catalogueBufferSupports||[]){const p=buffer.position,ray=new THREE.Raycaster(new THREE.Vector3(p[0],p[1]+.02,p[2]),new THREE.Vector3(0,-1,0),0,.05);assert(ray.intersectObjects(meshes(f.root),false).some(hit=>Math.abs(hit.point.y-p[1])<1e-5),def.id+': physical buffer support coincides with flow pose.');}
 for(const anchor of f.root.userData.industrialStickerAnchors||[]){const normal=new THREE.Vector3().fromArray(anchor.normal),origin=new THREE.Vector3().fromArray(anchor.position).addScaledVector(normal,.09),ray=new THREE.Raycaster(origin,normal.negate(),0,.2);assert(ray.intersectObjects(meshes(f.root),false).length,def.id+': identification/warning projects onto an actual manufactured face, never a floating sign.');}
 geometry.disposeGeometry(f.root);
}
assert(animated>=10,'Reviewed mechanisms must animate actual named parts across more than a few samples.');
const lathe=fixture('equipment.machine.cnc-lathe'),spindle=actors(lathe.root).find(n=>n.userData.equipmentPartRole==='spindle');assert(spindle);assert(spindle.children.every(n=>(n.userData.equipmentSourceParts||[]).every(name=>!/Contrapunto|Torreta|refrigerante/.test(name))),'Only the chuck, nose and jaws rotate; the toolholder and tailstock remain fixed.');geometry.disposeGeometry(lathe.root);
// SceneDocument wraps a native prefab; compiled IndustrialVisuals receives
// that editor wrapper, not the private mechanical child from the unit factory.
const wrapped=fixture('equipment.machine.injection-molder'),native=new THREE.Group(),wrapper=new THREE.Group();native.add(wrapped.root);wrapper.add(native);const platen=actors(wrapped.root).find(n=>n.userData.equipmentPartRole==='clamping-platen'),rest=platen.position.clone();assert(geometry.animateEquipment(wrapper,state(50))>0);assert(platen.position.distanceTo(rest)>.02,'A real editor wrapper must not suppress native actuator motion.');native.remove(wrapped.root);const replacement=fixture('equipment.machine.injection-molder');native.add(replacement.root);assert(geometry.animateEquipment(wrapper,state(50))>0,'Replacing a prefab invalidates its cached animation body.');geometry.disposeGeometry(wrapped.root);geometry.disposeGeometry(wrapper);

// Cube extraction grips from ABOVE and is parked clear of the real entry bin.
// Carousel tray positions and labels move with the authoritative slot identity.
for(const system of ['catalogue-cube','catalogue-carousel']){
 const cfg=rackSchema.defaults(system),layout=rackSchema.layout(cfg),root=geometry.createCatalogueStorageVisual(THREE,cfg,layout),rig=root.userData.warehouseRackRig;
 assert(rig&&rig.pallets.length===layout.cells.length);assert.equal(Object.prototype.propertyIsEnumerable.call(root.userData,'warehouseRackRig'),false);
 if(system==='catalogue-cube'){
  assert(Math.abs(rig.carriage.position.y-(layout.motion.topY-.16))<1e-8,'Parked rim gripper clears the top gantry and the entry load.');
  const box=new THREE.Box3().setFromObject(rig.carriage);assert(box.max.y<layout.motion.topY,'Gripper bridge does not cut through the gantry/cap.');
  assert(!meshes(rig.carriage).some(n=>(n.userData.equipmentSourceParts||[]).some(name=>/bandeja|plataforma/i.test(name))),'A top extractor cannot add a floating platform below its load.');
 }else{
  assert.equal(rig.carouselTrays.length,layout.carousel.count);
  rig.carouselTrays.forEach((tray,i)=>{assert.deepEqual(tray.position.toArray(),layout.cells[i].position);assert.equal(tray.userData.warehouseRackCarouselSlot,i);assert(tray.children.some(n=>n.userData.equipmentComponentId==='equipment.storage.carousel.addresses'),'The address label belongs to the moving tray.');});
 }
 geometry.disposeGeometry(root);
}
console.log('Catalogue equipment motion passed: '+animated+' processor bodies; five real-cycle poses, pause/emergency/operator stops, fixed housing/IDs, floor clearance, staging support rays, cube top-grip park and carousel tray labels.');
