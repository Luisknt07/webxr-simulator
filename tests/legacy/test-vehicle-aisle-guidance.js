'use strict';
// Native scenes and physical geometry, no fake vehicle adapter, transfers,
// route credits or actor position writes performed by the presentation layer.
const assert=require('node:assert/strict');
const {THREE,fixture}=require('./test-vehicle-runtime.js');
const {guidanceAislePath,guidanceRoute,GUIDANCE_ROUTE_ARROWS}=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleGuidancePlanner.js');
const Guide=require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleHolographicGuide.js').default;
const rounded=point=>[point.x,point.z].map(value=>Math.round(value*10000)/10000);
const corridors=[[-2,-2,2,10],[-2,8,12,12],[8,-2,12,12]];
const inside=point=>corridors.some(rect=>point.x>=rect[0]-.001&&point.x<=rect[2]+.001&&point.z>=rect[1]-.001&&point.z<=rect[3]+.001);
const path=guidanceAislePath(new THREE.Vector3(0,.035,0),new THREE.Vector3(10,.035,0),corridors);
assert(path.length>=4,'A U-shaped aisle must retain its two corners, not cut diagonally through storage.');
for(let i=1;i<path.length;i++)for(let step=0;step<=40;step++)assert(inside(path[i-1].clone().lerp(path[i],step/40)),'Every transit sample remains within an explicitly authored vehicle corridor.');
assert.deepEqual(guidanceAislePath(new THREE.Vector3(0,0,0),new THREE.Vector3(10,0,0),[]).map(rounded),[[0,0],[10,0]],'Without aisles the candidate is a local direct guide.');
assert.equal(guidanceAislePath(new THREE.Vector3(0,0,0),new THREE.Vector3(10,0,0),[[-2,-2,2,2],[8,-2,12,2]]).length,0,'Disconnected lanes never become a line through unmarked storage.');

const f=fixture('forklift-electric-4w',true,false),drive={ctx:f.ctx,simulation:f.runtime,record:()=>f.record,blocked:()=>false,document:null};
const target={kind:'pickup',allowed:true,targetId:'real-task-target',dock:{position:new THREE.Vector3(10,0,.65),yaw:0}};
f.runtime.document.studio={moduleData:{'sector.logistics-industrial':{levels:[{roomId:'hall',facility:{sharedLayout:{aisles:{vehicleRects:corridors,pedestrianRects:[[-1,-1,11,1]]}}}}]}}};
const initial={matrix:f.object.matrixWorld.toArray(),distance:f.v.distance,routeIndex:f.v.routeIndex,entry:f.v.entry,training:f.v.training};
try{
  const route=guidanceRoute(drive,f.record,null,target);assert(route.local&&route.advisory&&route.clear);assert(route.arrows.length>8);assert(route.points.some(point=>point.z>=9));
  for(let i=1;i<route.points.length;i++)for(let step=0;step<=20;step++)assert(inside(route.points[i-1].clone().lerp(route.points[i],step/20)),'Free play uses vehicle aisles, not the green pedestrian shortcut.');
  const wall=new THREE.Mesh(new THREE.BoxBufferGeometry(4,3,.05),new THREE.MeshBasicMaterial());wall.position.set(0,1.5,5);f.root.add(wall);f.scene.updateMatrixWorld(true);f.ctx.collisionWorld.invalidate(wall);
  const blocked=guidanceRoute(drive,f.record,null,target);assert(blocked.blocked&&!blocked.clear);assert(blocked.points.every(point=>point.z<5));f.root.remove(wall);f.ctx.collisionWorld.invalidate(wall);
  assert.deepEqual({matrix:f.object.matrixWorld.toArray(),distance:f.v.distance,routeIndex:f.v.routeIndex,entry:f.v.entry,training:f.v.training},initial,'Checking an aisle route cannot drive, award progress or alter custody.');
}finally{f.runtime.stop();}

for(const variant of ['order-picker','vna-turret']){
  const raised=fixture(variant,true,false),driving={ctx:raised.ctx,simulation:raised.runtime,record:()=>raised.record,blocked:()=>false,document:null};
  try{
    raised.api.applyPose(raised.record,Object.assign({},raised.v.pose,{lift:2}),false);
    // Beside the narrow mast, above the parked cab, but inside the actual
    // elevated operator cabin. The real chassis must be checked as well.
    const beam=new THREE.Mesh(new THREE.BoxBufferGeometry(.06,.12,.1),new THREE.MeshBasicMaterial());
    beam.position.set(raised.v.config.width*.45,raised.v.config.height+1.4,3);raised.root.add(beam);raised.scene.updateMatrixWorld(true);raised.ctx.collisionWorld.invalidate(beam);
    const mission={phase:'pickup',route:[{x:0,z:5}],waypointIndex:0},before={matrix:raised.object.matrixWorld.toArray(),pose:Object.assign({},raised.v.pose),distance:raised.v.distance,entry:raised.v.entry};
    const actual=raised.ctx.collisionWorld.sweepBox(raised.api.bodyBox(raised.record),new THREE.Vector3(0,0,5),raised.api.collisionOptions(raised.record));
    assert(actual.blocked,variant+': the native raised cabin meets the overhead beam.');
    const route=guidanceRoute(driving,raised.record,mission);
    assert(route.blocked&&!route.clear&&route.arrows.length===0,variant+': guidance cannot call a passage clear when the actual elevated cabin collides.');
    assert.deepEqual({matrix:raised.object.matrixWorld.toArray(),pose:raised.v.pose,distance:raised.v.distance,entry:raised.v.entry},before,'Checking elevated-cab clearance leaves pose, distance and custody unchanged.');
    raised.api.applyPose(raised.record,Object.assign({},raised.v.pose,{lift:0}),false);
    const lowered=guidanceRoute(driving,raised.record,mission);
    assert(lowered.clear&&!lowered.blocked,variant+': lowering the cab restores the physically clear route.');
  }finally{raised.runtime.stop();}
}

const angled=fixture('forklift-electric-4w',true,false);
try{
  angled.object.rotation.y=Math.PI/4;angled.object.updateMatrix();angled.scene.updateMatrixWorld(true);
  const body=angled.api.bodyBox(angled.record),movement=new THREE.Vector3(.35,0,.35),options=angled.api.collisionOptions(angled.record);
  for(const side of [-1,1]){const wall=new THREE.Mesh(new THREE.BoxBufferGeometry(.05,1.4,8),new THREE.MeshBasicMaterial());wall.position.set(side*(body.max.x+.65),1.4,0);angled.root.add(wall);angled.ctx.collisionWorld.invalidate(wall);}
  angled.scene.updateMatrixWorld(true);
  const mechanism=angled.api.mechanismBoxes(angled.record),boxes=[body,mechanism.mast,...mechanism.forks].filter(Boolean);
  assert(boxes.every(box=>!angled.ctx.collisionWorld.testBox(box,options)&&!angled.ctx.collisionWorld.sweepBox(box,movement,options).blocked),'The native chassis, mast and tines have clearance in the rotated corridor.');
  const before=angled.object.matrixWorld.toArray(),route=guidanceRoute({ctx:angled.ctx,simulation:angled.runtime},angled.record,{phase:'pickup',route:[{x:.35,z:.35}],waypointIndex:0});
  assert(route.clear&&!route.blocked&&route.arrows.length>0,'A truck at 45 degrees must not acquire a doubly inflated chassis envelope and lose its otherwise clear route.');
  assert.deepEqual(angled.object.matrixWorld.toArray(),before,'The angled clearance check leaves the actual chassis transform unchanged.');
}finally{angled.runtime.stop();}

const h=require('../support/load-practice-scenes.cjs')(),cedi=h.fixture();let guide;
try{
  const built=h.buildConfigurablePracticeScene(cedi.document,'hall','CEDI-01',{scene:cedi.scene,mode:'manual'});cedi.runtime.start('hall');h.advance(cedi,.1);
  const record=cedi.runtime.records.get(built.vehicleIds[0]),driving={ctx:cedi.ctx,simulation:cedi.runtime,record:()=>record,blocked:()=>false,document:null};
  const before={position:record.object.position.toArray(),training:JSON.stringify(record.components.vehicle.training),distance:record.components.vehicle.distance};
  guide=new Guide(driving);guide.setEnabled(false);guide.mount(record);
  assert(guide.routeRoot.visible&&!guide.root.visible,'The route is visible with the near-pallet hologram OFF.');
  assert(guide.route.arrows.length>0&&guide.route.points.length>=2,'CEDI-01 has a real checked approach from the initial seat, despite its pickup waypoint already being complete.');
  assert(guide.route.dockingLimit&&guide.route.blocked,'Low forks stop the drawn route before touching the pallet; the guide does not invent pocket clearance.');
  assert(guide.route.points[1].z>20&&guide.route.points[1].z<20.25);
  assert.match(guide.getState().routeNote,/ajusta altura y alineación/i);
  const allocations=guide.stats.allocations,geometry=guide.arrows.geometry;
  for(let query=0;query<10;query++)guide.update(true);
  assert.equal(guide.stats.allocations,allocations);assert.equal(guide.arrows.geometry,geometry);assert(geometry.drawRange.count<=64*6+GUIDANCE_ROUTE_ARROWS*12);assert(guide.stats.routeDrawCalls<=3);
  assert.deepEqual({position:record.object.position.toArray(),training:JSON.stringify(record.components.vehicle.training),distance:record.components.vehicle.distance},before,'Visible approach arrows never bypass the native mission or move the machine.');
  const parent=guide.routeRoot.parent;guide.dispose();assert(!parent.children.some(object=>object.name==='Ruta manual · recogida y entrega'),'All route resources leave the scene on exit.');guide=null;
}finally{if(guide)guide.dispose();if(cedi.runtime.active)cedi.runtime.stop();h.releaseGeometry(cedi);}
console.log('Aisle guidance: explicit U corridors, no pedestrian shortcut, free-space guide, real obstruction clipping including raised operator cabins, visible native CEDI-01 final approach with hidden hologram, bounded open chevrons and unchanged physical mission state passed.');
