import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three'),View=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleFacilityView.js').default;
const h=require('../legacy/test-vehicle-runtime.js');

test('local inspection uses the original tines and pallet geometry even when the main view batches them, with bounded drawables and no world pass',()=>{
 const f=h.fixture(),view=new View(f.ctx),product=f.runtime.products.get(f.pallet),rig=f.api.rig(f.record),before=f.pallet.matrixWorld.clone(),driving={record:()=>f.record,simulation:f.runtime};let disposed=0;
 try{rig.forks.traverse(n=>{if(n.isMesh){n.layers.mask=0;n.geometry.addEventListener('dispose',()=>disposed++);}});const scene=view.inspection(f.scene,driving,{product});assert.notEqual(scene,f.scene);assert(view.inspectionStats.meshes>2&&view.inspectionStats.meshes<=112);assert(view.inspectionStats.triangles<=120000);for(const [source,mesh]of view.inspectionRows){assert.equal(mesh.geometry,source.geometry);assert(mesh.matrix.equals(source.matrixWorld));assert.equal(mesh.layers.mask,1);}assert(f.pallet.matrixWorld.equals(before));assert.equal(f.v.entry,null);}finally{view.dispose();assert.equal(disposed,0);f.runtime.stop();}
});

test('the facility view displays original native truck geometry and follows it without altering the operational rig',()=>{
 const f=h.fixture('forklift-electric-4w',false,false),view=new View(f.ctx);try{
  f.scene.updateMatrixWorld(true);const parent=f.object.parent,rig=f.api.rig(f.record),seat=rig.driverSeat,forks=rig.forks;
  view.sync(f.scene,true);assert(view.stats.meshes>5);const [source,row]=[...view.rows].find(([source])=>{for(let n=source;n;n=n.parent)if(n===f.object)return true;return false;});assert(source);
  assert.equal(row.mesh.geometry,source.geometry);assert.notEqual(row.mesh,source);assert.equal(source.parent!==view.scene,true);assert.equal(f.object.parent,parent);assert.equal(f.api.rig(f.record).driverSeat,seat);assert.equal(f.api.rig(f.record).forks,forks);
  f.object.position.x+=2;f.scene.updateMatrixWorld(true);view.sync(f.scene);assert(row.mesh.matrix.equals(source.matrixWorld));assert.equal(f.v.entry,null);assert.equal(f.v.distance,0);
 }finally{view.dispose();f.runtime.stop();}
});

test('the native map bounds drawables, retains the authored floor and never disposes shared world geometry or materials',()=>{
 const world=new THREE.Scene(),geometry=new THREE.BoxBufferGeometry(.3,.3,.3),material=new THREE.MeshStandardMaterial({color:0xe7ad38});let geometryDisposed=0,materialDisposed=0;geometry.addEventListener('dispose',()=>geometryDisposed++);material.addEventListener('dispose',()=>materialDisposed++);
 for(let i=0;i<400;i++){const mesh=new THREE.Mesh(geometry,material);mesh.position.set(i%20,0,Math.floor(i/20));world.add(mesh);}
 const floor=new THREE.Mesh(new THREE.BoxBufferGeometry(30,.05,30),new THREE.MeshStandardMaterial({color:0xaabbb9}));world.add(floor);world.updateMatrixWorld(true);const view=new View({});view.sync(world,true);assert.equal(view.stats.meshes,320);assert(view.stats.truncated);assert.equal(view.rows.get(floor).mesh.material,floor.material);
 const selected=[...view.rows][1][0];selected.visible=false;view.sync(world);assert.equal(view.rows.get(selected).mesh.visible,false);assert.equal(selected.layers.mask,1);view.dispose();assert.equal(geometryDisposed,0);assert.equal(materialDisposed,0);assert.equal(world.children.length,401);assert.equal(view.scene.children.filter(n=>n.isMesh).length,0);
});
