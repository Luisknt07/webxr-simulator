'use strict';
const assert=require('node:assert/strict'),THREE=require('three');
const vehicles=require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles.js');
const prefabs=require('../support/load-vehicle-prefabs.js')(THREE);
const Visibility=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleFrontVisibility.js').default;
const meshes=root=>{const result=[];root.traverse(node=>{if(node.isMesh)result.push(node);});return result;};
const forkMeshes=rig=>meshes(rig.forks).filter(mesh=>mesh.userData.vehicleForkBlade);
const values=material=>Array.isArray(material)?material:[material];
// Batching may change draw grouping, never the physical triangle population
// or the world envelope of any supported truck.
const fs=require('node:fs'),path=require('node:path'),directory=path.resolve(__dirname,'../../modules/logistica-industrial/functions/montacargas/runtime');
const clean=name=>fs.readFileSync(path.join(directory,name),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const originalDetail=new Function('THREE',clean('VehicleDetailGeometry.js')+';return createVehicleDetailBuilder;')(THREE);
const triangles=root=>{let count=0;root.traverse(mesh=>{if(mesh.isMesh)count+=(mesh.geometry.index?mesh.geometry.index.count:mesh.geometry.attributes.position.count)/3;});return count;};
let batches=0;
const tracedDetail=(builder,config)=>{const detail=originalDetail(builder,config),batch=detail.batch;detail.batch=root=>{root.updateWorldMatrix(true,true);const before={triangles:triangles(root),box:new THREE.Box3().setFromObject(root)};batch(root);root.updateWorldMatrix(true,true);const after=new THREE.Box3().setFromObject(root);assert.equal(triangles(root),before.triangles);assert(before.box.min.distanceTo(after.min)<1e-5&&before.box.max.distanceTo(after.max)<1e-5);batches++;};return detail;};
const tracedPrefab=new Function('THREE','vehicles','createVehicleDetailBuilder',clean('VehiclePrefabs.js')+';return createVehicle;')(THREE,vehicles,tracedDetail);
vehicles.VARIANTS.forEach(definition=>tracedPrefab(definition.preset));assert.equal(batches,vehicles.VARIANTS.length);
let checked=0;
assert.equal(vehicles.defaults().forkColor,'#9eacb5');
for(const definition of vehicles.VARIANTS){
  const root=prefabs.createVehicle(definition.preset),rig=root.userData.vehicleRig,driving={id:'occupied',visualRoot:root,holographicGuide:{enabled:true}};
  root.updateMatrixWorld(true);
  const before=meshes(root).map(mesh=>({mesh,geometry:mesh.geometry,material:mesh.material,castShadow:mesh.castShadow,raycast:mesh.raycast,matrix:mesh.matrixWorld.toArray()})),bounds=new THREE.Box3().setFromObject(root),helper=new Visibility(driving);
  helper.mount(root);
  const supports=vehicles.supports(definition.preset).forks;
  assert.equal(helper.getStats().active,supports,definition.id+' has guidance only with real forks');
  if(supports){
    assert(helper.getStats().meshes>0);assert(helper.getStats().materials>0&&helper.getStats().materials<=10);
    helper.entries.forEach(({mesh,material})=>{values(mesh.material).forEach((value,index)=>{const original=values(material)[index];assert(value.transparent&&value.opacity>0&&value.opacity<=.07);assert.equal(value.depthWrite,false);if(Number.isFinite(original.envMapIntensity))assert.equal(value.envMapIntensity,original.envMapIntensity*.25);});assert.notEqual(mesh.material,material);});
    const tines=forkMeshes(rig);assert(tines.length,definition.id+' retains independent opaque tines');
    tines.forEach(mesh=>{assert.equal(mesh.material.transparent,false);assert.equal(mesh.material.opacity,1);assert.equal(mesh.material.metalness,.55);assert.equal(mesh.material.roughness,.38);assert.equal(mesh.material.color.clone().convertLinearToSRGB().getHexString(),'9eacb5');});
    // Inspect the final batched geometry, not only inherited node tags: heels
    // and blades used to merge into one mesh carrying the first blade's tag.
    tines.forEach(mesh=>{if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();assert(mesh.geometry.boundingBox.max.y<=.015,'Opaque entry-blade batch cannot contain a tall vertical heel');});
    const heels=meshes(rig.forks).filter(mesh=>mesh.userData.vehicleForkTine&&!mesh.userData.vehicleForkBlade);
    if(rig.config.family!=='pallet-truck')assert(heels.length>0,definition.id+' retains real separate upright heels after material batching');
    heels.forEach(mesh=>{assert.equal(mesh.material.transparent,true,'Upright heels belong to the transparent front, not the visible entry blades');assert(mesh.material.opacity<=.07);});
    const controls=[rig.controls&&rig.controls.wheel,...(rig.controls&&rig.controls.levers||[])].filter(Boolean);
    controls.forEach(control=>meshes(control.object).forEach(mesh=>{const original=before.find(row=>row.mesh===mesh);assert.equal(mesh.material,original.material,'Physical wheel and levers stay opaque');}));
  }
  before.forEach(row=>{assert.equal(row.mesh.geometry,row.geometry);assert.equal(row.mesh.raycast,row.raycast);assert.deepEqual(row.mesh.matrixWorld.toArray(),row.matrix);});
  assert(new THREE.Box3().setFromObject(root).equals(bounds),'Transparency cannot change physical geometry bounds');
  const allocations=helper.getStats().allocations;
  for(let frame=0;frame<500;frame++)helper.update();assert.equal(helper.getStats().allocations,allocations,'No material allocation per frame');
  driving.holographicGuide.enabled=false;helper.update();before.forEach(row=>{assert.equal(row.mesh.material,row.material);assert.equal(row.mesh.castShadow,row.castShadow);});
  driving.holographicGuide.enabled=true;helper.update();assert.equal(helper.getStats().allocations,allocations,'Toggling reuses cached clones');
  const clones=[...helper.materials.values()],disposed=new Set(),originalDisposed=new Set(),textureDisposed=new Set();
  clones.forEach(material=>material.addEventListener('dispose',()=>disposed.add(material)));
  before.forEach(row=>values(row.material).forEach(material=>{material.addEventListener('dispose',()=>originalDisposed.add(material));if(material.map)material.map.addEventListener('dispose',()=>textureDisposed.add(material.map));}));
  helper.unmount();assert.equal(disposed.size,clones.length);assert.equal(originalDisposed.size,0);assert.equal(textureDisposed.size,0);
  assert.deepEqual(helper.getStats(),{active:false,meshes:0,materials:0,allocations});
  before.forEach(row=>{assert.equal(row.mesh.material,row.material);assert.equal(row.mesh.castShadow,row.castShadow);});checked++;
}
// Legacy standard fork colors brighten; an authored custom finish is preserved.
for(const color of ['#677682','#a4bbcc']){const object=prefabs.createVehicle({...vehicles.defaults(),forkColor:color});const material=forkMeshes(object.userData.vehicleRig)[0].material;assert.equal(material.color.clone().convertLinearToSRGB().getHexString(),color==='#677682'?'9eacb5':'a4bbcc');}
// A shared source material is not edited even if another truck uses it.
const a=prefabs.createVehicle(vehicles.defaults()),b=prefabs.createVehicle(vehicles.defaults()),first=meshes(a.userData.vehicleRig.mast)[0],second=meshes(b.userData.vehicleRig.mast)[0];
second.material=first.material;const shared=first.material,driving={id:'occupied',visualRoot:a,holographicGuide:{enabled:true}},helper=new Visibility(driving);helper.mount(a);assert.notEqual(first.material,shared);assert.equal(second.material,shared);assert(!shared.transparent);helper.dispose();
// The actual collision filter must continue accepting a translucent mast.
const h=require('./test-vehicle-runtime.js'),physicalFixture=h.fixture('forklift-electric-4w',true,false),visual=physicalFixture.v.visualRoot;
const collisionBefore=meshes(visual).map(mesh=>[mesh,physicalFixture.ctx.collisionWorld.physicalMesh(mesh)]),physicalGuide=new Visibility({id:physicalFixture.record.id,visualRoot:visual,holographicGuide:{enabled:true}});
physicalGuide.mount(visual);assert(physicalGuide.getStats().active);collisionBefore.forEach(([mesh,solid])=>assert.equal(physicalFixture.ctx.collisionWorld.physicalMesh(mesh),solid,'Sight aid never removes a physical collider'));physicalGuide.dispose();physicalFixture.runtime.stop();

// Actual input adapter, physical product and tracked head fixture: toggling
// the sight aid leaves custody, geometry and headset pose untouched.
const {setup}=require('./test-vehicle-driving.js'),f=setup(true,true);assert(f.driving.mount(f.record.id));assert(f.driving.frontVisibility.getStats().active);
const head=f.camera.position.clone(),rotation=f.camera.quaternion.clone(),physical=f.object.matrixWorld.toArray(),product=f.runtime.products.get(f.pallet);
assert(f.api.pickup(f.record),f.v.warning);const entry=f.v.entry,owner=product.vehicleOwnerId,parent=product.object.parent;
for(let toggle=0;toggle<12;toggle++){assert(f.driving.command('holographicGuide'));assert.equal(f.v.entry,entry);assert.equal(product.vehicleOwnerId,owner);assert.equal(product.object.parent,parent);assert(f.camera.position.equals(head)&&f.camera.quaternion.equals(rotation));assert.deepEqual(f.object.matrixWorld.toArray(),physical);}
assert(f.driving.frontVisibility.getStats().active);assert(f.driving.unmount(true));assert(!f.driving.frontVisibility.getStats().active);assert.equal(f.v.entry,entry);f.driving.dispose();f.runtime.stop();
console.log('Front visibility: '+checked+' variants, opaque silver forks, isolated/restored materials, no per-frame clones, complete cleanup and unchanged physical custody/XR passed.');
