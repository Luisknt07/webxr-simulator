'use strict';
const assert=require('node:assert/strict'),THREE=require('three'),vehicles=require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles.js'),prefabs=require('../support/load-vehicle-prefabs.js')(THREE);
const budget={low:18000,balanced:35000,high:60000}, residentBudget={low:1.3e6,balanced:2.7e6,high:4.5e6}, maxima={};
const bounds=object=>new THREE.Box3().setFromObject(object);
for(const detail of Object.keys(budget))for(const definition of vehicles.VARIANTS){
  const config=vehicles.normalize(Object.assign({},definition.preset,{detail,cabinStyle:'protected'})),object=prefabs.createVehicle(config),rig=object.userData.vehicleRig;
  const geometries=new Set(),textures=new Set();let triangles=0,bytes=0,draws=0,atlas=null,decals=0,batches=0;
  object.traverse(node=>{
    if(node.geometry){const geometry=node.geometry;triangles+=(geometry.index?geometry.index.count:geometry.attributes.position.count)/3*(node.isInstancedMesh?node.count:1);draws++;
      if(!geometries.has(geometry)){geometries.add(geometry);Object.values(geometry.attributes).forEach(attribute=>{bytes+=attribute.array.byteLength;});if(geometry.index)bytes+=geometry.index.array.byteLength;}
      if(node.userData.industrialComponents)batches++;
    }
    (Array.isArray(node.material)?node.material:[node.material]).filter(Boolean).forEach(material=>Object.values(material).forEach(value=>{if(value&&value.isTexture)textures.add(value);}));
    if(node.userData.vehicleDecal){decals++;assert(node.material.polygonOffset&&node.material.depthWrite===false);if(atlas)assert.equal(node.material.map,atlas);atlas=node.material.map;const uv=node.geometry.attributes.uv;for(let i=0;i<uv.count;i++)assert(uv.getX(i)>=0&&uv.getX(i)<=1&&uv.getY(i)>=0&&uv.getY(i)<=1);}
  });
  assert(triangles<budget[detail],definition.id+' '+detail+' physical presentation budget');assert(bytes<residentBudget[detail]);assert(textures.size<=2,'One shared wear map and one small decal atlas per vehicle.');assert(decals>0&&atlas.image.width===512&&atlas.image.height===256);assert(batches>0);
  maxima[detail]=Math.max(maxima[detail]||0,triangles);
  if(config.family==='counterbalance'){
    assert(rig.seatCushion&&rig.counterweight);const seat=bounds(rig.seatCushion),hood=bounds(rig.counterweight);
    assert(!seat.intersectsBox(hood),'Sculpted rear housing must not invade the operator seat.');
    const eye=rig.driverSeat.getWorldPosition(new THREE.Vector3());assert(eye.y>seat.max.y+.5);assert(hood.max.z<seat.min.z-.005);
    const shape=rig.counterweight.geometry;assert(shape.parameters.options.bevelEnabled);assert(shape.attributes.position.count>48);
  }
  if(rig.cabin){
    const wheel=rig.controls.wheel;assert(wheel&&wheel.grip.parent===wheel.object);let ring;
    wheel.object.traverse(node=>{if(node.geometry&&node.geometry.type==='TorusBufferGeometry')ring=node;});
    assert(ring,'The steering wheel has a true toroidal rim, not a solid cylinder.');
    assert.deepEqual(wheel.axis,[0,0,1]);assert.equal(wheel.radius,.17);
    const oldTool=rig.forks&&prefabs.getVehicleForkTransform(object).matrix.clone(),rest=wheel.restQuaternion.clone();
    wheel.object.userData.cabControlValue=.6;rig.controls.levers.forEach(control=>{assert(control.grip.parent===control.object);assert(vehicles.supports(config)[control.id]);control.object.userData.cabControlValue=.7;});
    prefabs.updateVehiclePose(object,vehicles.initialPose(config));assert(!wheel.object.quaternion.equals(rest));
    if(oldTool)assert(prefabs.getVehicleForkTransform(object).matrix.equals(oldTool),'Control animation does not move forks without a runtime command.');
    delete wheel.object.userData.cabControlValue;rig.controls.levers.forEach(control=>{delete control.object.userData.cabControlValue;});prefabs.updateVehiclePose(object,vehicles.initialPose(config));
    assert(wheel.object.quaternion.equals(rest));rig.controls.levers.forEach(control=>assert(control.object.quaternion.equals(control.restQuaternion)));
  }
}
const open=prefabs.createVehicle(vehicles.normalize({cabinStyle:'open',cabInterior:false,decals:false})),closed=prefabs.createVehicle(vehicles.normalize({cabinStyle:'enclosed'}));
let openDecals=0,closedGlass=0;open.traverse(node=>{if(node.userData.vehicleDecal)openDecals++;});closed.traverse(node=>{if(node.isMesh&&node.userData.industrialMaterialRole==='glass')closedGlass++;});
assert.equal(openDecals,0);assert.equal(open.userData.vehicleRig.seatCushion,undefined);assert(closedGlass>=5);
const a=prefabs.createVehicle(),b=prefabs.createVehicle();assert.notEqual(a.userData.vehicleRig.controls.wheel,b.userData.vehicleRig.controls.wheel);assert.notEqual(a.userData.vehicleRig.resources.materials.frame,b.userData.vehicleRig.resources.materials.frame);
let disposed=0;const oldAtlas=[];a.traverse(node=>{if(node.userData.vehicleDecal&&!oldAtlas.includes(node.material.map)){oldAtlas.push(node.material.map);node.material.map.addEventListener('dispose',()=>disposed++);}});prefabs.refreshVehicleGeometry(a,vehicles.defaults('reach-truck'));assert.equal(disposed,oldAtlas.length);
console.log('Vehicle detail: 39 variant/quality combinations, sculpted seat clearance, hollow steering rim/direct-control pivots, shared industrial atlas, independent materials, batched cosmetics and clean refresh passed; max triangles '+JSON.stringify(maxima)+'.');
