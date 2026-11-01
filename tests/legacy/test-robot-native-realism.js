'use strict';
// Resculpted native castings retain a bounded web/Quest resource envelope.
// Geometry may change; working kinematics, clean shading and ownership may not.
const assert=require('node:assert/strict'),fs=require('node:fs'),THREE=require('three');
const schema=require('../../modules/logistica-industrial/functions/robots/schema/robots.js'),kinematics=require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../modules/logistica-industrial/functions/robots/runtime/RobotPrefabs.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const {createRobot,refreshRobotGeometry,getRobotToolTransform,updateRobotPose}=new Function('THREE','robotSchema','kinematics',source+'\nreturn {createRobot,refreshRobotGeometry,getRobotToolTransform,updateRobotPose};')(THREE,schema,kinematics);
const profiles = schema.VARIANTS.flatMap(variant => ['low', 'balanced', 'high'].map(detail => ({variant: variant.id, detail})));
const budgets = {low: {triangles: 5000, draws: 65, geometry: 55}, balanced: {triangles: 10000, draws: 80, geometry: 65}, high: {triangles: 15000, draws: 80, geometry: 65}};
const tolerance=(a,b,eps=2e-6)=>assert(Math.abs(a-b)<eps,a+' != '+b);
let creaseMeshes=0,turnedMeshes=0,gradientMeshes=0;
for(const expected of profiles){
 const robot=createRobot({...schema.defaults(expected.variant),detail:expected.detail}),geometries=new Set(),materials=new Set(),textures=new Set();let triangles=0,draws=0;
 robot.traverse(mesh=>{
  if(!mesh.isMesh)return;draws++;const g=mesh.geometry;geometries.add(g);triangles+=(g.index?g.index.count:g.attributes.position.count)/3*(mesh.isInstancedMesh?mesh.count:1);
  for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){materials.add(m);for(const p of ['map','bumpMap','normalMap','roughnessMap'])if(m[p])textures.add(m[p]);assert.equal(m.userData.industrialManufacturedFinish,true);assert.equal(m.userData.industrialPaintWear,robot.userData.robotRig.config.wear);if(m.map){assert.equal(m.map.generateMipmaps,true);assert.equal(m.map.minFilter,THREE.LinearMipmapLinearFilter);}if(m.userData.industrialMaterialRole==='frame'&&robot.userData.robotRig.config.finish==='painted'){assert(m.roughness>=.3&&m.roughness<.4);assert(m.metalness<=.18);assert(m.bumpScale<.0002);assert(Math.min(...m.map.image.data)>240,'Ordinary new paint must not have the deep dark pit/chip texture that made castings look broken.');}}
  const p=g.attributes.position,n=g.attributes.normal;for(let i=0;i<n.count;i++){const length=Math.hypot(n.getX(i),n.getY(i),n.getZ(i));assert(Number.isFinite(length));assert(length>.99&&length<1.01,mesh.name+' normal '+i);}
  if(g.userData.industrialCreaseAngle){creaseMeshes++;assert.equal(g.index,null);const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();for(let i=0;i+2<p.count;i+=3){a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);const face=b.sub(a).cross(c.sub(a));if(face.lengthSq()<1e-18)continue;face.normalize();for(let j=0;j<3;j++)assert(face.dot(new THREE.Vector3().fromBufferAttribute(n,i+j))>.5,'A manufactured corner normal must remain on its own side of the crease.');}}
  if(g.userData.industrialNormalModel==='turned-profile'){turnedMeshes++;for(let i=0;i<p.count;i++){const r=Math.hypot(p.getX(i),p.getZ(i));if(r<1e-8)continue;tolerance(n.getX(i)*p.getZ(i)-n.getZ(i)*p.getX(i),0,1e-7);}}
  if(g.userData.industrialNormalModel==='manufactured-section-gradient'){gradientMeshes++;const count=p.count/12;assert(Number.isInteger(count));for(let ring=1;ring<11;ring++){const a=ring*count,b=a+count-1;for(const key of ['getX','getY','getZ'])tolerance(n[key](a),n[key](b),1e-7);}assert(g.index,'The arm stays indexed for a bounded shared-vertex delivery mesh.');}
 });
 const budget=budgets[expected.detail];assert(triangles>0&&triangles<=budget.triangles,expected.variant+'/'+expected.detail+': '+triangles+' triangles');assert(draws>0&&draws<=budget.draws);assert(geometries.size<=budget.geometry);assert(materials.size<=6);assert(textures.size>=3&&textures.size<=5);assert.equal(robot.userData.robotGeometryVersion,3);
 const home=kinematics.homePose(robot.userData.robotRig.config),tcp=getRobotToolTransform(robot);tolerance(tcp.position.distanceTo(new THREE.Vector3().fromArray(home.toolPosition)),0);
 const oldResources=[...textures],disposals=new Map(oldResources.map(texture=>[texture,0]));oldResources.forEach(texture=>texture.addEventListener('dispose',()=>disposals.set(texture,disposals.get(texture)+1)));refreshRobotGeometry(robot,{...schema.defaults(expected.variant),detail:expected.detail});for(const count of disposals.values())assert.equal(count,1,'Native material refresh must release every private map exactly once.');
}
assert(creaseMeshes>20&&turnedMeshes>20&&gradientMeshes>20);
const clean=createRobot({...schema.defaults('articulated-general'),wear:0}),worn=createRobot({...schema.defaults('articulated-general'),wear:1});const paint=robot=>{let result;robot.traverse(mesh=>{if(mesh.material&&mesh.material.userData.industrialMaterialRole==='frame')result=mesh.material;});return result;};assert(paint(worn).roughness>paint(clean).roughness);assert(paint(worn).map.image.data.some((value,index)=>value!==paint(clean).map.image.data[index]));
console.log('Native robot realism:45 resculpted profiles within explicit web resource budgets, stable TCP, manufactured crease/profile normals, clean paint, editable wear and complete map disposal passed.');
