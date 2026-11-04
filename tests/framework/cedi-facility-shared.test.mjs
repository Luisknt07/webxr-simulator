import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')(),costs=require('../support/practice-render-costs.cjs'),cedi=require('../../modules/logistica-industrial/practices/configurable/CediLayout.cjs');
const source=fs.readFileSync(new URL('../../modules/logistica-industrial/practices/configurable/runtime/CediFacility.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const build=new Function('THREE','schema','cediLayout',source+'\nreturn buildCediFacility;')(native.THREE,native.schema,cedi),T=native.THREE;
function setup(id='CEDI-01'){const f=native.fixture(),objects=[];f.document.begin();
 // The harness inherits an unrelated 100 m gallery floor at y=0. Persist the
 // ordinary native override that a replacement CEDI level needs, otherwise it
 // would bury the genuinely depressed apron under the old gallery's floor.
 for(const entry of f.document.native.values())if(entry.roomId==='hall'&&entry.object.parent===f.root)f.document.setProperty(entry.object,'visible',false);
 const facility=build(f.document,'hall',{id},objects);f.document.commit();f.root.updateWorldMatrix(true,true);return{f,objects,facility};}
const solid=(f,objects)=>objects.filter(object=>f.document.getBehaviors(object).some(config=>config.type==='collision'&&config.enabled));
const meshList=objects=>objects.flatMap(object=>{const meshes=[];object.traverse(node=>{if(node.isMesh)meshes.push(node);});return meshes;});
const signature=objects=>createHash('sha256').update(JSON.stringify(objects.map(object=>{const meshes=[];object.traverse(node=>{if(node.isMesh)meshes.push({positions:Array.from(node.geometry.attributes.position.array),matrix:node.matrixWorld.elements});});return{name:object.name,meshes};}))).digest('hex');

test('five CEDI practices use an identical 64 by 44 metre native facility and four front docks',()=>{
 let expected;for(let n=1;n<=5;n++){
  const {f,objects,facility}=setup('CEDI-0'+n);try{
   const layout=cedi.layout();assert.equal(facility.layoutId,layout.id);assert.deepEqual(facility.sharedLayout,layout);assert.deepEqual(facility.initialView,{eye:[-27,1.65,16],target:[-18,1,9]});assert.deepEqual(facility.bounds,layout.bounds);
   assert.deepEqual(facility.floor.position.toArray(),[0,-.12,0]);assert.deepEqual(facility.floor.scale.toArray(),[64,.24,44]);
   const docks=facility.openings.filter(row=>row.id!=='STAFF-ENTRY');assert.equal(docks.length,4);assert.deepEqual(docks.map(row=>row.center),[-22,-14,14,22]);assert.equal(docks.filter(row=>row.purpose==='Recepción').length,2);assert.equal(docks.filter(row=>row.purpose==='Despacho').length,2);assert(docks.every(row=>row.wallCoordinate===22&&row.deckY===0&&row.apronY===-1.15));
   const fingerprint=signature(objects);if(expected)assert.equal(fingerprint,expected,'A different practice must not regenerate a different building.');expected=fingerprint;
   const measured=costs(objects);assert(measured.drawCalls<=65,JSON.stringify(measured));assert(measured.triangles<26000);assert.equal(measured.lights,0);assert.equal(facility.costs.dynamicLights,0);assert.equal(facility.costs.shadowMaps,0);assert(facility.costs.parts>1400);
   assert(facility.fixtures.some(row=>row.kind==='two-toilets-basin-mirror'));assert(facility.fixtures.some(row=>row.kind==='six-lockers-and-bench'));assert(facility.fixtures.some(row=>row.kind==='workbench-tool-nests-service-cabinet'));
  }finally{native.releaseGeometry(f);}
 }
});

test('four cargo apertures and the staff entrance have actual clear geometry, bridge support and correct levels',()=>{
 const {f,objects,facility}=setup();try{
  const physical=meshList(solid(f,objects));
  for(const opening of facility.openings)for(const offset of [-.3,0,.3])for(const height of [.3,1.6,3.6]){
   if(height>=opening.height-.1)continue;const ray=new T.Raycaster(new T.Vector3(opening.center+opening.width*offset,height,21.2),new T.Vector3(0,0,1),0,1.6);assert.equal(ray.intersectObjects(physical,false).length,0,opening.id+' blocked at '+height+'/'+offset);
  }
  const ground=meshList(objects.filter(object=>f.document.getBehaviors(object).some(config=>config.type==='teleport'&&config.enabled)||object.userData.practiceFacility.role==='dock-bridge'));
  for(const dock of facility.openings.filter(row=>row.bridgeRect))for(const z of [21.2,22.3]){const ray=new T.Raycaster(new T.Vector3(dock.center,1,z),new T.Vector3(0,-1,0),0,3),hits=ray.intersectObjects(ground,false);assert(hits.length);assert(Math.abs(hits[0].point.y)<.002,'A real dock bridge must be flush with the zero-height truck bed.');}
  for(const[x,z,y]of [[-29,40,-1.15],[29,65,-1.15],[-40,35,-1.15],[0,29,-.575],[0,36,-1.15]]){const ray=new T.Raycaster(new T.Vector3(x,1,z),new T.Vector3(0,-1,0),0,4),hits=ray.intersectObjects(ground,false);assert(hits.length,'Missing floor support at '+[x,z]);assert(Math.abs(hits[0].point.y-y)<.005,'Wrong support height at '+[x,z]);}
 }finally{native.releaseGeometry(f);}
});

test('native collision keeps the full U aisles and staff rooms usable while walls, glass and ramp rails remain physical',()=>{
 const {f,objects,facility}=setup();try{
  const world=f.ctx.collisionWorld;world.setRoom('hall');const capsule={radius:.25,height:1.6,eyeHeight:1.6};
  for(const point of facility.sharedLayout.aisles.safePolyline){const pose=new T.Vector3(point[0],point[1]+1.6,point[2]);assert(world.canOccupyCapsule(pose,capsule),'U aisle wrongly enclosed by compound geometry: '+point);}
  const path=facility.sharedLayout.aisles.safePolyline.map(point=>new T.Vector3(point[0],point[1]+1.602,point[2]));for(let n=1;n<path.length;n++)assert(world.moveCapsule(path[n-1],path[n],capsule).distanceTo(path[n])<.025,'A real swept U-aisle segment is blocked: '+n);
  for(const[x,z]of [[-5.5,19.1],[-5.5,15.1],[5.5,15.1],[5.5,19.5],[-28,-12],[0,20]])assert(world.canOccupyCapsule(new T.Vector3(x,1.6,z),capsule),'Staff room or corridor is inaccessible: '+[x,z]);
  for(const[x,y,z]of [[-32,1.6,0],[32,1.6,0],[0,1.6,-22],[-5.5,1.6,22]])assert.equal(world.canOccupyCapsule(new T.Vector3(x,y,z),capsule),false,'Rendered wall/glazing must block actual walking.');
  const candidate=f.document.addPrimitive('hall','box','#9c9981');f.document.setBehaviors(candidate,[native.schema.defaultBehavior('collision')]);f.document.setTransform(candidate,{scale:[.8,.4,.8]});
  for(const y of [.3,1.6,3])for(const[x,z]of [[0,0],[-12,-7],[27,-7],[-22,18]]){f.document.setTransform(candidate,{position:[x,y,z]});assert(world.canPlaceObject(candidate),'Warehouse air became a filled CAD solid: '+[x,y,z]);}
  const from=new T.Vector3(0,1.025,29),wanted=new T.Vector3(2.4,1.025,29),stopped=world.moveCapsule(from,wanted,capsule);assert(stopped.x<1.6,'Visible handrail protects the actual ramp edge.');
  const rampTop=new T.Vector3(0,1.602,22),rampBottom=new T.Vector3(0,.452,36);assert(world.moveCapsule(rampBottom,rampTop,capsule).distanceTo(rampTop)<.025,'The staff ramp must have a continuous physical gradient.');
 }finally{native.releaseGeometry(f);}
});

test('depressed yard, parking, roads and closed outer boundary persist as ordinary editable native geometry',async()=>{
 const {f,objects,facility}=setup(),next=native.fixture();try{
  const saved=native.validateDocument(await f.document.serialize(),value=>value);await next.document.load(saved);next.root.updateWorldMatrix(true,true);next.ctx.collisionWorld.setRoom('hall');
  const restored=objects.map(object=>next.document.getObject(object.userData.editorId));assert(restored.every(Boolean));assert.equal(signature(restored),signature(objects));assert.equal(costs(restored).drawCalls,costs(objects).drawCalls);
  assert(facility.outdoor.objectIds.every(id=>next.document.getObject(id)));assert.equal(facility.outdoor.worldBoundary.floorY,-1.15);
  const capsule={radius:.25,height:1.6,eyeHeight:1.6},world=next.ctx.collisionWorld;
  for(const entry of facility.outdoor.entrances){const from=new T.Vector3(entry.center,.45,57),to=new T.Vector3(entry.center,.45,59);assert(world.moveCapsule(from,to,capsule).distanceTo(to)<.02,'Site gate is obstructed: '+entry.id);}
  const from=new T.Vector3(29,.45,79.8),to=new T.Vector3(29,.45,81.5),stopped=world.moveCapsule(from,to,capsule);assert(stopped.z<80.4&&stopped.z>79.8,'World boundary must stop walking before the road edge.');
  assert(restored.some(object=>next.document.getBehaviors(object).some(config=>config.type==='surfaceMaterial'&&config.emissiveIntensity>1)));
  assert.equal(next.document.studio.environments.find(row=>row.roomId==='hall').ambientIntensity,.72);
 }finally{native.releaseGeometry(f);native.releaseGeometry(next);}
});

test('zone and docking metadata are independent copies with no silent positional or stock mutations',()=>{
 const first=cedi.layout(),second=cedi.layout();first.zones.picking.rect[0]=999;assert.notEqual(second.zones.picking.rect[0],999);assert.equal(cedi.LAYOUT.zones.picking.rect[0],3);
 assert.equal(cedi.zone('unknown'),null);assert.equal(cedi.dock('unknown'),null);assert.equal(cedi.zone('yard').floorY,-1.15);
 assert.deepEqual(cedi.dock('REC-01').truck.position,[-22,-1.147,27.9]);assert.equal(cedi.dock('REC-01').truck.yaw,Math.PI/2);
 for(const zone of Object.values(cedi.LAYOUT.zones)){assert(zone.width>0&&zone.depth>0);assert.equal(zone.center[0],(zone.rect[0]+zone.rect[2])/2);assert(!zone.objectId&&!zone.productId&&!zone.stock);}
});
