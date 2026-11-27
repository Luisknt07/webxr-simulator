import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),traffic=require('../../projects/smarttwin/PublicDemoTraffic.cjs'),schema=require('../../modules/logistica-industrial/contracts/behaviors.js');
test('marked R1/R2/R3 paths and sampled truck turns clear native machinery and stay separate from pedestrian paint',()=>{
 const f=require('../support/public-demo-fixture.cjs')({manual:true}),T=f.THREE,r=[...f.runtime.records.values()].find(r=>r.components.vehicle),api=f.runtime.vehicleRuntime,world=f.ctx.collisionWorld;
 try{
  assert.deepEqual(r.object.position.toArray(),traffic.HOME.position);assert(r.object.quaternion.angleTo(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),traffic.HOME.yaw))<1e-6);
  const plan=f.built.floorPresentation.userData.editorDescriptor;assert.equal(plan.vehicleLanes.length,4);assert(plan.vehicleArrows.length>=12);assert.equal(plan.vehicleStops.length,4);
  for(const road of plan.vehicleLanes){assert(Math.min(road[2]-road[0],road[3]-road[1])>=3);for(const walk of plan.walkways)assert(!(road[0]<walk[2]&&road[2]>walk[0]&&road[1]<walk[3]&&road[3]>walk[1]),'Vehicle lanes do not become pedestrian shortcuts.');}
  assert(['R1 RECOGIDA','R2 ALMACEN','R3 DESPACHO'].every(label=>plan.texts.includes(label)));
  const drawing={clearRect(){},fillText(){}},visual=schema.industrialFloor.createVisual(T,plan,()=>({getContext:()=>drawing})),textures=new Set();let meshes=0;
  visual.traverse(n=>{if(n.isMesh){meshes++;if(n.material.map)textures.add(n.material.map);}});assert(meshes<=8);assert.equal(textures.size,1);assert.equal([...textures][0].image.height,1024,'All routes and signs reuse the same bounded floor atlas.');
  visual.traverse(n=>{if(n.geometry)n.geometry.dispose();if(n.material)n.material.dispose();});textures.forEach(t=>t.dispose());
  let samples=0;const inspect=(x,z,yaw)=>{r.object.position.set(x,0,z);r.object.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),yaw);f.scene.updateMatrixWorld(true);const options=api.collisionOptions(r),body=api.bodyBox(r);if(world.testBox(body,options)){const hits=[];world.triangles(body,options,(triangle,object)=>{if(body.intersectsTriangle(triangle)&&hits.length<3){const parents=[];for(let p=object;p;p=p.parent)parents.push(p.name);hits.push({parents,triangle:[triangle.a.toArray(),triangle.b.toArray(),triangle.c.toArray()]});}return false;});assert.fail('Blocked chassis at '+JSON.stringify({x,z,yaw,hits,extra:(options.extraBoxes||[]).filter(b=>b.intersectsBox(body)).map(b=>({min:b.min.toArray(),max:b.max.toArray()}))}));}const boxes=api.mechanismBoxes(r);assert(api.mechanismClear(r,boxes),'Blocked fork/mast at '+JSON.stringify({x,z,yaw}));samples++;};
  for(const route of traffic.ROUTES)for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),steps=Math.ceil(length/.4),yaw=Math.atan2(b[0]-a[0],b[1]-a[1]);for(let n=0;n<=steps;n++)inspect(a[0]+(b[0]-a[0])*n/steps,a[1]+(b[1]-a[1])*n/steps,yaw);}
  for(const [x,z,from,to]of [[12.4,0,Math.PI,Math.PI*1.5],[12.4,-2.8,Math.PI,Math.PI*1.5],[8,-2.8,-Math.PI/2,-Math.PI]])for(let i=0;i<=12;i++)inspect(x,z,from+(to-from)*i/12);
  assert(samples>90);assert.equal(f.operations.snapshot().generated,0,'Checking traffic must not admit or fabricate products.');
  assert.throws(()=>schema.industrialFloor.normalize({...plan,vehicleLanes:[[1,0,0,2]]}));assert.throws(()=>schema.industrialFloor.normalize({...plan,vehicleArrows:[[0,NaN,0]]}));
 }finally{f.close();}
});
