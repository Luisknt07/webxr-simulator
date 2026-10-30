'use strict';
// Geometry and serialization checks for the same three production VR recipes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const schema=require('../../modules/logistica-industrial/contracts/behaviors');
const fixtureCode=fs.readFileSync(path.join(__dirname,'test-conveyor-mechanisms.js'),'utf8');
const {setup}=new Function('require','__dirname',fixtureCode.slice(0,fixtureCode.indexOf('async function run()'))+'\nreturn {setup};')(require,__dirname);
const {validateDocument}=require('../../apps/api/server/validation');
function dispose(root){const geometries=new Set(),materials=new Set();root.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const m of (Array.isArray(node.material)?node.material:[node.material]))if(m)materials.add(m);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
async function run(){
 for(const id of ['vr-robot-dispatch','vr-robot-transfer','vr-robot-turn']){
  const f=setup(),study=require('../support/load-study-scenes')(THREE,schema,f.document.constructor);
  try{
   study.studySceneBase(f.document,'hall');const built=study.buildStudyScene(f.document,'hall',id,{scene:f.scene,continuous:true}),facility=built.environment;
   assert.equal(facility.walls.length,4);assert(facility.roof);assert.equal(facility.structure.length,2);assert.equal(facility.fixtures.length,4);assert.equal(facility.objects.length,12);
   assert(built.objects.length<=24);assert.equal(f.document.studio.entities.filter(row=>row.type==='pointLight').length,0);
   f.scene.updateMatrixWorld(true);let triangles=0;
   for(const object of facility.objects)object.traverse(mesh=>{if(mesh.isMesh)triangles+=(mesh.geometry.index?mesh.geometry.index.count:mesh.geometry.attributes.position.count)/3;});
   assert(triangles<=144,'The entire closed shell is only twelve boxes / 144 triangles.');
   const volumes=facility.walls.concat(facility.roof).map(object=>new THREE.Box3().setFromObject(object));
   for(let i=0;i<volumes.length;i++)for(let j=i+1;j<volumes.length;j++){const overlap=volumes[i].clone().intersect(volumes[j]),size=overlap.getSize(new THREE.Vector3());assert(size.x*size.y*size.z<1e-8,'Wall/roof volumes only meet at edges; they must not overlap.');}
   for(const direction of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]]){
    const ray=new THREE.Raycaster(new THREE.Vector3(4,1.65,8),new THREE.Vector3(...direction));
    assert(ray.intersectObjects(facility.walls.concat(facility.roof),true).length,'An eye-height view is enclosed in every wall/ceiling direction.');
   }
   const settings=facility.environment;assert.equal(settings.exposure,.87);assert.equal(settings.sunIntensity,.6);assert.equal(settings.ambientIntensity,.25);
   facility.walls.forEach(wall=>{const finish=f.document.getBehaviors(wall).find(b=>b.type==='surfaceMaterial');assert.equal(finish.colorMapMode,'none');assert(finish.roughness>=.9);});
   const saved=await f.document.serialize();validateDocument(saved,()=>{throw Error('No external imports in a compact facility.');});
   const records=saved.rooms.hall.additions;assert.equal(records.filter(row=>/^CEDI · RV pared /.test(row.name)).length,4);assert.equal(records.filter(row=>/RV cubierta industrial/.test(row.name)).length,1);
   const restored=setup();try{await restored.document.load(saved);const loaded=await restored.document.serialize();assert.equal(loaded.rooms.hall.additions.filter(row=>/RV cubierta industrial/.test(row.name)).length,1);assert.equal(loaded.rooms.hall.additions.filter(row=>/^CEDI · RV pared /.test(row.name)).length,4);}finally{dispose(restored.scene);}
   console.log(JSON.stringify({id,mainObjects:built.objects.length,architecture:facility.objects.length,triangles,walls:4,roof:true,realLights:0,roundtrip:true}));
  }finally{dispose(f.scene);}
 }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
