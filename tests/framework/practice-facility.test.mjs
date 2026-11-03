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
      assert(measures.drawCalls<=38,'Thin wall and frame partitions preserve collision correctness in at most 38 static draws before culling.');assert(measures.triangles<12000);assert.equal(measures.lights,0);assert.equal(facility.costs.dynamicLights,0);assert.equal(facility.costs.shadowMaps,0);
      assert(facility.costs.parts>200,'Profiles, seams, fixtures and services are real geometry, not text-only claims.');
      assert(objects.some(row=>row.name.includes('Difusores LED')));assert(objects.some(row=>row.name.includes('Protección contra incendios')));assert(objects.some(row=>row.name.includes('señalética')));
      assert.equal(f.document.studio.environments.find(row=>row.roomId==='hall').renderQuality,'balanced');
      const saved=native.validateDocument(await f.document.serialize(),value=>value);assert(saved.rooms.hall.additions.some(row=>row.descriptor.type==='cad'));
      report.push({id:entry.id,...measures,architecture:facility.costs,openings:facility.openings,bounds:facility.bounds});
    }finally{native.releaseGeometry(f);}
  }
  fs.mkdirSync(path.join(ROOT,'data/qa-studio/practice-facilities'),{recursive:true});fs.writeFileSync(path.join(ROOT,'data/qa-studio/practice-facilities/facility-matrix.json'),JSON.stringify({format:'smarttwin.practice-facility-audit',passed:true,rows:report,limits:'Native geometry, persisted materials and clear aperture probes; no hardware FPS/lux/legal certification.'},null,2));
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
