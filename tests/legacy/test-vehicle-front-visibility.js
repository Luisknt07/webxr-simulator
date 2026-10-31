'use strict';
const assert=require('node:assert/strict'),THREE=require('three');
const vehicles=require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles.js');
const prefabs=require('../support/load-vehicle-prefabs.js')(THREE);
const Visibility=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleFrontVisibility.js').default;
const meshes=root=>{const result=[];root.traverse(node=>{if(node.isMesh)result.push(node);});return result;};
const forkMeshes=rig=>meshes(rig.forks).filter(mesh=>mesh.userData.vehicleForkBlade&&!mesh.userData.vehicleForkEntryContrast);
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
    tines.forEach(mesh=>{assert.equal(mesh.material.transparent,false);assert.equal(mesh.material.opacity,1);assert.equal(mesh.material.metalness,.45);assert.equal(mesh.material.roughness,.36);assert.equal(mesh.material.color.clone().convertLinearToSRGB().getHexString(),'c2cfd8');assert.equal(mesh.material.emissiveIntensity,.08);});
    const contrast=rig.forkEntryContrast;assert(contrast&&contrast.outline.isLineSegments&&contrast.marks.isMesh,definition.id+' uses two bounded contrast draws');
    assert.deepEqual(rig.forks.children.slice(-2),[contrast.outline,contrast.marks],'New visual children append after existing batched nodes so saved node paths stay stable');
    [contrast.outline,contrast.marks].forEach(object=>{assert.equal(object.parent,rig.forks);assert.equal(object.visible,true);assert.equal(object.material.transparent,false);assert.equal(object.material.depthTest,true);assert.equal(object.material.depthWrite,false);assert.equal(object.userData.editorRuntimeHelper,true);assert.equal(object.userData.vehicleForkBlade,true);assert(!helper.entries.some(entry=>entry.mesh===object),'Entry outlines and painted tips remain opaque in the hologram');});
    assert.equal(contrast.outline.geometry.attributes.position.count,60);assert.equal(contrast.marks.geometry.attributes.position.count,60);
    const paintColors=contrast.marks.geometry.attributes.color.array;assert(new Set(Array.from(paintColors).map(value=>value.toFixed(4))).size>=5,'Dark boundaries and amber tips have distinct vertex colors');
    for(const object of [contrast.outline,contrast.marks]){
      const coordinates=object.geometry.attributes.position;
      for(let index=0;index<coordinates.count;index++){
        const x=coordinates.getX(index),y=coordinates.getY(index),z=coordinates.getZ(index),side=Math.sign(x),center=side*rig.config.forkSpread/2;
        assert(Math.abs(x-center)<=rig.config.forkWidth/2+1e-7&&y<=1e-7&&y>=-rig.config.forkThickness-1e-7&&z>=-1e-7&&z<=rig.config.forkLength+1e-7,'Every decorative vertex remains inside the real blade envelope');
      }
    }
    // The amber band must lie on the bevel itself. A small inward inset can
    // pass all bounds checks yet disappear behind steel in the close camera.
    const faces=[];tines.forEach(mesh=>{mesh.updateMatrix();const positions=mesh.geometry.attributes.position,indices=mesh.geometry.index,count=indices?indices.count:positions.count;for(let index=0;index<count;index+=3){const vertex=corner=>new THREE.Vector3().fromBufferAttribute(positions,indices?indices.getX(index+corner):index+corner).applyMatrix4(mesh.matrix);faces.push(new THREE.Triangle(vertex(0),vertex(1),vertex(2)));}});
    const paint=contrast.marks.geometry.attributes.position,nearest=new THREE.Vector3();for(let index=0;index<paint.count;index++){const point=new THREE.Vector3().fromBufferAttribute(paint,index);assert(Math.min(...faces.map(face=>face.closestPointToPoint(point,nearest).distanceTo(point)))<1e-7,'Contrast paint stays exactly on a physical entry-blade surface, never buried inside it');}
    // Inspect the final batched geometry, not only inherited node tags: heels
    // and blades used to merge into one mesh carrying the first blade's tag.
    tines.forEach(mesh=>{if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();assert(mesh.geometry.boundingBox.max.y<=.015,'Opaque entry-blade batch cannot contain a tall vertical heel');});
    const heels=meshes(rig.forks).filter(mesh=>mesh.userData.vehicleForkTine&&!mesh.userData.vehicleForkBlade);
    if(rig.config.family!=='pallet-truck')assert(heels.length>0,definition.id+' retains real separate upright heels after material batching');
    heels.forEach(mesh=>{assert.equal(mesh.material.transparent,true,'Upright heels belong to the transparent front, not the visible entry blades');assert(mesh.material.opacity<=.07);});
    const wire=helper.wire,wireStats=helper.getWireStats();
    assert(wire&&wire.isLineSegments&&wireStats.segments>0&&wireStats.segments<=6000,'One bounded sparse wire buffer outlines the front mechanisms');
    assert.equal(wireStats.drawCalls,1);assert.equal(wire.parent,root);assert.equal(wire.material.depthTest,true);assert.equal(wire.material.depthWrite,false);assert.equal(wire.userData.editorCollisionDisabled,true);assert.equal(wire.userData.editorRuntimeHelper,true);
    assert.equal(wire.geometry.attributes.position.count,wireStats.segments*2);assert.equal(wire.geometry.attributes.color.count,wireStats.segments*2);
    const colors=new Set(helper.wireSources.map(source=>source.color.getHexString()));assert(colors.size>0);if(rig.mast||rig.boom)assert(colors.size>=2,definition.id+' body/protection and steel/hydraulic components have distinct legible wire colors');
    assert(!helper.wireSources.some(source=>source.mesh.userData.vehicleForkBlade||source.mesh.userData.editorHelper||source.mesh.userData.vehicleDecal),'Opaque blades, tip marks and decals are not turned into a wire overlay');
    const controls=[rig.controls&&rig.controls.wheel,...(rig.controls&&rig.controls.levers||[])].filter(Boolean);
    controls.forEach(control=>meshes(control.object).forEach(mesh=>{const original=before.find(row=>row.mesh===mesh);assert.equal(mesh.material,original.material,'Physical wheel and levers stay opaque');}));
  }
  before.forEach(row=>{assert.equal(row.mesh.geometry,row.geometry);assert.equal(row.mesh.raycast,row.raycast);assert.deepEqual(row.mesh.matrixWorld.toArray(),row.matrix);});
  const wireBounds=new THREE.Box3().setFromObject(root);assert(wireBounds.min.distanceTo(bounds.min)<1e-5&&wireBounds.max.distanceTo(bounds.max)<1e-5,'Decorative wire coordinates remain inside the physical envelope, allowing only float-buffer rounding');
  const allocations=helper.getStats().allocations;
  const wireUpdates=helper.getWireStats().updates,wirePositions=helper.wire&&helper.wire.geometry.attributes.position;
  for(let frame=0;frame<500;frame++)helper.update();assert.equal(helper.getStats().allocations,allocations,'No material allocation per frame');assert.equal(helper.getWireStats().updates,wireUpdates,'Stationary parts do not rewrite wire geometry each frame');if(wirePositions)assert.equal(helper.wire.geometry.attributes.position,wirePositions);
  driving.holographicGuide.enabled=false;helper.update();before.forEach(row=>{assert.equal(row.mesh.material,row.material);assert.equal(row.mesh.castShadow,row.castShadow);});
  driving.holographicGuide.enabled=true;helper.update();assert.equal(helper.getStats().allocations,allocations,'Toggling reuses cached clones');
  const clones=[...helper.materials.values()],disposed=new Set(),originalDisposed=new Set(),textureDisposed=new Set();
  const wireResources=[helper.wireGeometry,helper.wireMaterial].filter(Boolean),wireDisposed=new Set();wireResources.forEach(resource=>resource.addEventListener('dispose',()=>wireDisposed.add(resource)));
  clones.forEach(material=>material.addEventListener('dispose',()=>disposed.add(material)));
  before.forEach(row=>values(row.material).forEach(material=>{material.addEventListener('dispose',()=>originalDisposed.add(material));if(material.map)material.map.addEventListener('dispose',()=>textureDisposed.add(material.map));}));
  helper.unmount();assert.equal(disposed.size,clones.length);assert.equal(originalDisposed.size,0);assert.equal(textureDisposed.size,0);
  assert.equal(wireDisposed.size,wireResources.length);assert.equal(helper.getWireStats().drawCalls,0);assert.equal(helper.getWireStats().segments,0);assert(!root.children.some(node=>node.userData.vehicleHologramWire));
  assert.deepEqual(helper.getStats(),{active:false,meshes:0,materials:0,allocations});
  before.forEach(row=>{assert.equal(row.mesh.material,row.material);assert.equal(row.mesh.castShadow,row.castShadow);});checked++;
}
// Legacy standard fork colors brighten; an authored custom finish is preserved.
for(const color of ['#677682','#a4bbcc']){const object=prefabs.createVehicle({...vehicles.defaults(),forkColor:color});const material=forkMeshes(object.userData.vehicleRig)[0].material;assert.equal(material.color.clone().convertLinearToSRGB().getHexString(),color==='#677682'?'c2cfd8':'a4bbcc');}
// The actual moving mast/side-shift/boom sources are transformed into the
// vehicle-local wire buffer; driving the whole chassis must not rebuild it.
for(const variant of ['forklift-electric-4w','telehandler']){
  const root=prefabs.createVehicle(vehicles.defaults(variant)),rig=root.userData.vehicleRig,drive={id:'moving-wire',visualRoot:root,holographicGuide:{enabled:true}},helper=new Visibility(drive);helper.mount(root);
  const geometry=helper.wireGeometry,material=helper.wireMaterial,positions=geometry.attributes.position.array,before=Array.from(positions);
  prefabs.updateVehiclePose(root,{lift:.8,reach:.18,tilt:.035,sideShift:.04,boomAngle:.3});helper.update();assert.equal(helper.wireGeometry,geometry);assert.equal(helper.wireMaterial,material);assert(before.some((value,index)=>Math.abs(value-positions[index])>.02),'Wire edges follow moving real lift/reach components');
  const inverse=new THREE.Matrix4().getInverse(root.matrixWorld),matrix=new THREE.Matrix4(),instance=new THREE.Matrix4();
  helper.wireSources.forEach(source=>{matrix.multiplyMatrices(inverse,source.mesh.matrixWorld);if(source.instance>=0){source.mesh.getMatrixAt(source.instance,instance);matrix.multiply(instance);}const expected=new THREE.Vector3().fromArray(source.local).applyMatrix4(matrix),actual=new THREE.Vector3().fromArray(positions,source.offset*3);assert(expected.distanceTo(actual)<1e-5,'Each visible wire range follows its own component rather than a stale static chassis frame');});
  const updates=helper.getWireStats().updates,localBefore=Array.from(positions);root.position.set(5,0,-3);root.rotation.y=.7;root.updateWorldMatrix(true,true);helper.update();assert.equal(helper.getWireStats().updates,updates);assert.deepEqual(Array.from(positions),localBefore,'Chassis movement is inherited by the one local overlay without reallocation or buffer rewrites');
  const source=helper.wireSources[0];source.mesh.visible=false;helper.update();for(let i=0;i<source.local.length;i++)assert.equal(positions[source.offset*3+i],0,'Hidden physical components do not retain floating wire edges');source.mesh.visible=true;helper.update();assert(source.local.some((value,index)=>positions[source.offset*3+index]!==0));
  helper.dispose();
}
// Geometry refresh owns and releases both small contrast resources exactly once.
const refreshable=prefabs.createVehicle(vehicles.defaults()),contrast=refreshable.userData.vehicleRig.forkEntryContrast,released=new Map();
for(const object of [contrast.outline,contrast.marks])for(const resource of [object.geometry,object.material])resource.addEventListener('dispose',()=>released.set(resource,(released.get(resource)||0)+1));
prefabs.refreshVehicleGeometry(refreshable,{...vehicles.defaults(),forkSpread:.7});assert.equal(released.size,4);released.forEach(count=>assert.equal(count,1));assert.notEqual(refreshable.userData.vehicleRig.forkEntryContrast,contrast);
// A shared source material is not edited even if another truck uses it.
const a=prefabs.createVehicle(vehicles.defaults()),b=prefabs.createVehicle(vehicles.defaults()),first=meshes(a.userData.vehicleRig.mast)[0],second=meshes(b.userData.vehicleRig.mast)[0];
second.material=first.material;const shared=first.material,driving={id:'occupied',visualRoot:a,holographicGuide:{enabled:true}},helper=new Visibility(driving);helper.mount(a);assert.notEqual(first.material,shared);assert.equal(second.material,shared);assert(!shared.transparent);helper.dispose();
// The actual collision filter must continue accepting a translucent mast.
const h=require('./test-vehicle-runtime.js'),physicalFixture=h.fixture('forklift-electric-4w',true,false),visual=physicalFixture.v.visualRoot;
const collisionBefore=meshes(visual).map(mesh=>[mesh,physicalFixture.ctx.collisionWorld.physicalMesh(mesh)]),physicalGuide=new Visibility({id:physicalFixture.record.id,visualRoot:visual,holographicGuide:{enabled:true}});
physicalGuide.mount(visual);assert(physicalGuide.getStats().active);collisionBefore.forEach(([mesh,solid])=>assert.equal(physicalFixture.ctx.collisionWorld.physicalMesh(mesh),solid,'Sight aid never removes a physical collider'));assert.equal(physicalFixture.ctx.collisionWorld.physicalMesh(visual.userData.vehicleRig.forkEntryContrast.marks),false,'Painted contrast is excluded from physical triangle tests');physicalGuide.dispose();physicalFixture.runtime.stop();

// Actual input adapter, physical product and tracked head fixture: toggling
// the sight aid leaves custody, geometry and headset pose untouched.
const {setup}=require('./test-vehicle-driving.js'),f=setup(true,true);assert(f.driving.mount(f.record.id));assert(f.driving.frontVisibility.getStats().active);
const head=f.camera.position.clone(),rotation=f.camera.quaternion.clone(),physical=f.object.matrixWorld.toArray(),product=f.runtime.products.get(f.pallet);
assert(f.api.pickup(f.record),f.v.warning);const entry=f.v.entry,owner=product.vehicleOwnerId,parent=product.object.parent;
for(let toggle=0;toggle<12;toggle++){assert(f.driving.command('holographicGuide'));assert.equal(f.v.entry,entry);assert.equal(product.vehicleOwnerId,owner);assert.equal(product.object.parent,parent);assert(f.camera.position.equals(head)&&f.camera.quaternion.equals(rotation));assert.deepEqual(f.object.matrixWorld.toArray(),physical);}
assert(f.driving.frontVisibility.getStats().active);assert(f.driving.unmount(true));assert(!f.driving.frontVisibility.getStats().active);assert.equal(f.v.entry,entry);f.driving.dispose();f.runtime.stop();
console.log('Front visibility: '+checked+' variants, opaque silver forks, isolated/restored materials, no per-frame clones, complete cleanup and unchanged physical custody/XR passed.');
