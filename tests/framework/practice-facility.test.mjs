import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const native=require('../support/load-practice-scenes.cjs')(),costs=require('../support/practice-render-costs.cjs');
const filename='modules/logistica-industrial/practices/configurable/runtime/PracticeFacility.js';
const source=fs.readFileSync(path.join(ROOT,filename),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const {buildPracticeFacility}=new Function('THREE','schema',source+'\nreturn {buildPracticeFacility};')(native.THREE,native.schema);
const report=[];

function assertGate(actors,gate,THREE){
  const meshes=[];actors.forEach(actor=>actor.traverse(node=>{if(node.isMesh)meshes.push(node);}));
  for(const y of [.3,1.5,2.8])for(const fraction of [-.32,0,.32]){
    if(y>gate.height-.1)continue;
    const coordinate=gate.center+gate.width*fraction,origin=gate.axis==='z'?new THREE.Vector3(gate.wallCoordinate-1,y,coordinate):new THREE.Vector3(coordinate,y,gate.wallCoordinate-1),direction=gate.axis==='z'?new THREE.Vector3(1,0,0):new THREE.Vector3(0,0,1);
    const ray=new THREE.Raycaster(origin,direction,0,2),hits=ray.intersectObjects(meshes,false);
    assert.equal(hits.length,0,gate.id+' physical opening obstructed at '+coordinate+', '+y);
  }
}

test('all ten facilities have real enclosed CAD envelopes, usable openings, textured floors and bounded static architecture',async()=>{
  for(const entry of native.configurableRecipes.list()){
    const f=native.fixture(),plan=native.configurableRecipes.plan(entry.id,{mode:'manual'}),objects=[];
    try{
      f.document.begin();const facility=buildPracticeFacility(f.document,'hall',plan,objects);f.document.commit();f.root.updateWorldMatrix(true,true);
      assert.equal(facility.floor.scale.x,plan.interiorArea.width);assert.equal(facility.floor.scale.z,plan.interiorArea.depth);assert.deepEqual(facility.floor.position.toArray(),[0,-.12,0]);
      assert(facility.floor.name.startsWith('Interior'));
      assert(facility.openings.some(row=>row.purpose==='Salida peatonal'));assert(facility.openings.some(row=>row.side==='left'));
      for(const gate of facility.openings)assertGate(objects,gate,native.THREE);
      const floorBoxes=facility.floors.map(row=>new native.THREE.Box3().setFromObject(row));
      for(let i=0;i<floorBoxes.length;i++)for(let j=i+1;j<floorBoxes.length;j++){
        const a=floorBoxes[i],b=floorBoxes[j],dx=Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x),dz=Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z);
        assert(dx<1e-5||dz<1e-5,'Coplanar duplicate floor slabs cause texture fighting.');
      }
      for(const floor of facility.floors){const material=f.document.getBehaviors(floor).find(row=>row.type==='surfaceMaterial');assert.equal(material.preset,'concrete');assert.equal(material.colorMapMode,'preserve');assert.equal(material.name,'Hormigón');assert(f.document.getBehaviors(floor).some(row=>row.type==='teleport'&&row.enabled));}
      const measures=costs(objects,{validate:(value,message)=>assert(value,message)});
      assert(measures.drawCalls-facility.outdoor.costs.batches<=38,'The unchanged interior keeps its original draw bound.');assert(facility.outdoor.costs.batches<=12,'The physical yard, outer boundary and two neighbouring warehouses add at most twelve static batches.');assert(measures.drawCalls<=50);assert(measures.triangles<26000);assert.equal(measures.lights,0);assert.equal(facility.costs.dynamicLights,0);assert.equal(facility.costs.shadowMaps,0);
      assert(facility.costs.parts>200,'Profiles, seams, fixtures and services are real geometry, not text-only claims.');
      assert(objects.some(row=>row.name.includes('Difusores LED')));assert(objects.some(row=>row.name.includes('Protección contra incendios')));assert(objects.some(row=>row.name.includes('señalética')));
      assert.equal(f.document.studio.environments.find(row=>row.roomId==='hall').renderQuality,'balanced');
      const saved=native.validateDocument(await f.document.serialize(),value=>value);assert(saved.rooms.hall.additions.some(row=>row.descriptor.type==='cad'));
      report.push({id:entry.id,...measures,architecture:facility.costs,openings:facility.openings,bounds:facility.bounds,outdoor:facility.outdoor});
    }finally{native.releaseGeometry(f);}
  }
  fs.mkdirSync(path.join(ROOT,'data/qa-studio/practice-facilities'),{recursive:true});fs.writeFileSync(path.join(ROOT,'data/qa-studio/practice-facilities/facility-matrix.json'),JSON.stringify({format:'smarttwin.practice-facility-audit',passed:true,rows:report,limits:'Native geometry, persisted materials and clear aperture probes; no hardware FPS/lux/legal certification.'},null,2));
});

test('outdoor ground physically joins every original pad, preserves routes and encloses the terrain before its edge',async()=>{
  const report=[];
  for(const entry of native.configurableRecipes.list()){
    const f=native.fixture(),next=native.fixture(),objects=[];
    try{
      const plan=native.configurableRecipes.plan(entry.id,{mode:'manual'}),facility=buildPracticeFacility(f.document,'hall',plan,objects),out=facility.outdoor;
      f.root.updateWorldMatrix(true,true);f.ctx.collisionWorld.setRoom('hall');
      assert(out.objectIds.length>0);assert.equal(out.context.length,2);assert.equal(out.entrances[0].width,10);assert.equal(out.entrances[1].width,2);
      const ground=objects.filter(o=>facility.floors.includes(o)||o.userData.practiceFacility.role==='outdoor-ground');
      const groundMeshes=[];ground.forEach(o=>{o.traverse(n=>{if(n.isMesh)groundMeshes.push(n);});assert(f.document.getBehaviors(o).some(b=>b.type==='collision'&&b.enabled));assert(f.document.getBehaviors(o).some(b=>b.type==='teleport'&&b.enabled));});
      const rects=out.sourceFloorRects.concat(out.pavementRects,out.terrainRects);
      for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
        const a=rects[i],b=rects[j],dx=Math.min(a[2],b[2])-Math.max(a[0],b[0]),dz=Math.min(a[3],b[3])-Math.max(a[1],b[1]);assert(dx<1e-5||dz<1e-5,'Source/yard/road/terrain surfaces must not share coplanar area.');
      }
      const points=[];
      for(const r of out.sourceFloorRects){const x=(r[0]+r[2])/2,z=(r[1]+r[3])/2;points.push([r[0]-.05,z],[r[2]+.05,z],[x,r[1]-.05],[x,r[3]+.05]);}
      for(const g of out.entrances)points.push([g.center,out.siteBounds.maxZ-.5],[g.center,out.siteBounds.maxZ+.5]);
      points.push([out.road.center,91.8],[-91.8,0],[91.8,0],[0,-91.8]);
      for(const [x,z] of points){
        const ray=new native.THREE.Raycaster(new native.THREE.Vector3(x,.5,z),new native.THREE.Vector3(0,-1,0),0,1),hits=ray.intersectObjects(groundMeshes,false);
        assert(hits.length,'Native ground geometry missing beside an old edge at '+[entry.id,x,z]);assert(Math.abs(hits[0].point.y)<1e-5,'Exterior support must remain level with the existing source floor.');
      }
      const world=f.ctx.collisionWorld,T=native.THREE;
      for(const g of out.entrances){
        const from=new T.Vector3(g.center,1.6,g.wallCoordinate-1),to=new T.Vector3(g.center,1.6,g.wallCoordinate+1),moved=world.moveCapsule(from,to,{radius:.25,height:1.6,eyeHeight:1.6});
        assert(moved.distanceTo(to)<.02,'The real '+g.kind+' access cannot be blocked by a compound perimeter collider.');
      }
      const start=new T.Vector3(out.road.center,1.6,91.7),wanted=new T.Vector3(out.road.center,1.6,93.7),stopped=world.moveCapsule(start,wanted,{radius:.25,height:1.6,eyeHeight:1.6});
      assert(stopped.z<92.4&&stopped.z>91.7,'Closed outer boundary must stop native walking before the terrain edge.');
      assert.equal(world.canOccupyCapsule(new T.Vector3(out.road.center,1.6,92.8),{radius:.25,height:1.6,eyeHeight:1.6}),false);
      const sideStart=new T.Vector3(out.siteBounds.minX+1,1.6,out.siteBounds.minZ+7.31),sideEnd=sideStart.clone().add(new T.Vector3(-2,0,0)),sideStopped=world.moveCapsule(sideStart,sideEnd,{radius:.25,height:1.6,eyeHeight:1.6});
      assert(sideStopped.x>out.siteBounds.minX+.15,'Rendered welded fence bars must stop native capsule passage between posts.');
      // The CEDI receiving routes can retreat over the original far edge with
      // uninterrupted physical support. No stock or vehicle transform changes.
      if(['CEDI-01','SF-01'].includes(entry.id)){
        const x=-plan.interiorArea.width/2-14,from=new T.Vector3(x+.5,1.6,0),to=new T.Vector3(x-1,1.6,0);assert(world.moveCapsule(from,to,{radius:.25,height:1.6,eyeHeight:1.6}).distanceTo(to)<.02);
      }
      const saved=native.validateDocument(await f.document.serialize(),v=>v);await next.document.load(saved);next.ctx.collisionWorld.setRoom('hall');
      assert(out.objectIds.every(id=>next.document.getObject(id)),'Every outdoor object has a normal persisted editable ID.');
      assert.equal(next.ctx.collisionWorld.canOccupyCapsule(new T.Vector3(out.road.center,1.6,92.8),{radius:.25,height:1.6,eyeHeight:1.6}),false,'Outer physical boundary survives save/reopen.');
      report.push({id:entry.id,physicalSupportSamples:points.length,preservedSourceFloors:out.sourceFloorRects.length,gateWidths:out.entrances.map(g=>g.width),outerBoundaryStop:stopped.toArray(),outdoorCosts:out.costs});
    }finally{native.releaseGeometry(f);native.releaseGeometry(next);}
  }
  fs.mkdirSync(path.join(ROOT,'data/qa-studio/practice-facilities'),{recursive:true});fs.writeFileSync(path.join(ROOT,'data/qa-studio/practice-facilities/outdoor-ground-native.json'),JSON.stringify({passed:true,rows:report,limits:'Native support/collision, access probes and document persistence. No device FPS or outdoor lux certification.'},null,2));
});

test('native collision leaves interior stock locations empty and blocks real wall material after reload',async()=>{
  const f=native.fixture(),next=native.fixture(),objects=[];
  try{
    const facility=buildPracticeFacility(f.document,'hall',native.configurableRecipes.plan('CEDI-03'),objects);
    const candidate=f.document.addPrimitive('hall','box','#c9b37b');f.document.setBehaviors(candidate,[native.schema.defaultBehavior('collision')]);f.document.setTransform(candidate,{scale:[.8,.36,.8]});
    f.ctx.collisionWorld.setRoom('hall');
    for(const y of [.205,.905,1.605,3])for(const x of [-8.25,0,8.25])for(const z of [-5,0,5]){
      f.document.setTransform(candidate,{position:[x,y,z]});
      assert(f.ctx.collisionWorld.canPlaceObject(candidate),'An empty facility must permit native placement at '+[x,y,z]);
    }
    f.document.setTransform(candidate,{position:[1.285314131996156,.5031960426168399,2.57403176332616]});assert(f.ctx.collisionWorld.canPlaceObject(candidate),'A ring of physical steel posts cannot become a solid interior room.');
    f.document.setTransform(candidate,{position:[facility.bounds.maxX,1.6,5]});assert.equal(f.ctx.collisionWorld.canPlaceObject(candidate),false,'Actual wall triangles must remain physical.');
    f.document.setTransform(candidate,{position:[facility.bounds.maxX+1,1.6,5]});assert(f.ctx.collisionWorld.canPlaceObject(candidate),'Outside space must not become an enclosing CAD solid.');
    const saved=native.validateDocument(await f.document.serialize(),v=>v);await next.document.load(saved);next.ctx.collisionWorld.setRoom('hall');const restored=next.document.getObject(candidate.userData.editorId);
    next.document.setTransform(restored,{position:[-8.25,1.605,5]});assert(next.ctx.collisionWorld.canPlaceObject(restored),'The CEDI-03 upper stock cell must remain usable after persistence.');
    next.document.setTransform(restored,{position:[facility.bounds.maxX,1.6,5]});assert.equal(next.ctx.collisionWorld.canPlaceObject(restored),false);
  }finally{native.releaseGeometry(f);native.releaseGeometry(next);}
});

test('receiving keeps its six-pallet operational crossing clear after a real save and reload',async()=>{
  const f=native.fixture(),next=native.fixture(),objects=[];
  try{
    const facility=buildPracticeFacility(f.document,'hall',native.configurableRecipes.plan('CEDI-01'),objects),gate=facility.openings.find(row=>row.side==='left'),physical=objects.filter(row=>f.document.getBehaviors(row).some(b=>b.type==='collision'&&b.enabled));
    f.root.updateWorldMatrix(true,true);
    assertGate(physical,{...gate,center:6.3,width:2.7},native.THREE);
    assert(facility.bounds.maxX>22,'The preserved CEDI-02 continuation remains inside the building.');
    const apron=facility.floors.find(row=>row.name.includes('Continuación'));assert(apron);assert.deepEqual(apron.position.toArray(),[17,-.12,0]);assert.deepEqual(apron.scale.toArray(),[10,.24,18]);
    const saved=native.validateDocument(await f.document.serialize(),value=>value);await next.document.load(saved);next.root.updateWorldMatrix(true,true);
    const restoredObjects=objects.map(row=>next.document.getObject(row.userData.editorId));assert(restoredObjects.every(Boolean));
    const original=costs(objects),restored=costs(restoredObjects);assert.equal(restored.drawCalls,original.drawCalls);assert.equal(restored.triangles,original.triangles);
    assertGate(restoredObjects,{...gate,center:6.3,width:2.7},native.THREE);
    assert(next.document.getObjects('hall').some(row=>next.document.getBehaviors(row).some(b=>b.type==='surfaceMaterial'&&b.emissiveMode==='custom'&&b.emissiveIntensity>1)),'Persisted LED emission must survive reload.');
  }finally{native.releaseGeometry(f);native.releaseGeometry(next);}
});

test('the actual configurable project persists exterior IDs and physical bounds with its practice manifest',async()=>{
  const f=native.fixture(),next=native.fixture();
  try{
    const built=native.buildConfigurablePracticeScene(f.document,'hall','CEDI-01',{mode:'manual',scene:f.scene});
    const saved=native.validateDocument(await f.document.serialize(),v=>v),level=saved.studio.moduleData['sector.logistics-industrial'].levels.find(row=>row.roomId==='hall');
    assert.deepEqual(level.facility.outdoor,built.manifest.facility.outdoor,'The real project manifest must include the exterior, not only temporary runtime userData.');
    assert.equal(level.facility.outdoor.physicalBounds.minX,-94);assert.equal(level.facility.outdoor.physicalBounds.maxX,94);
    assert.equal(level.facility.outdoor.worldBoundary.height,2.4);assert.equal(level.facility.outdoor.costs.batches,12);
    await next.document.load(saved);next.ctx.collisionWorld.setRoom('hall');
    assert(level.facility.outdoor.objectIds.every(id=>next.document.getObject(id)));
    const b=level.facility.outdoor.worldBoundary,x=level.facility.outdoor.road.center;
    assert.equal(next.ctx.collisionWorld.canOccupyCapsule(new native.THREE.Vector3(x,1.6,b.maxZ),{radius:.25,height:1.6,eyeHeight:1.6}),false,'The outer wall is present and physical in the saved actual practice project.');
  }finally{native.releaseGeometry(f);native.releaseGeometry(next);}
});
