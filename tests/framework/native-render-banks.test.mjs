import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three'),cost=require('../support/practice-render-costs.cjs');
const source=fs.readFileSync(new URL('../../modules/logistica-industrial/functions/presentacion/runtime/RuntimeNativeRenderBanks.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class RuntimeNativeRenderBanks','return class RuntimeNativeRenderBanks');
const Banks=new Function('THREE',source)(THREE);
function fixture(){const root=new THREE.Group();root.userData.editorPrefabKey='robot';const parent=new THREE.Group();parent.userData.robotJoint='J1';root.add(parent);const material=new THREE.MeshStandardMaterial({color:'#d97628',roughness:.49,metalness:.17}),meshes=[];
 for(let i=0;i<5;i++){const g=new THREE.BoxBufferGeometry(.2,.3,.4);g.setAttribute('color',new THREE.BufferAttribute(new Uint8Array(g.attributes.position.count*3).fill(172),3,true));const object=new THREE.Mesh(g,material);object.name='Native component '+i;object.position.set(i*.3,.4,i*.1);object.rotation.y=i*.15;object.castShadow=object.receiveShadow=true;object.userData.editorId='native:fixture:'+i;parent.add(object);meshes.push(object);}root.updateMatrixWorld(true);return{root,parent,material,meshes,banks:new Banks()};}
function cleanup(f){f.banks.dispose();for(const mesh of f.meshes)mesh.geometry.dispose();f.material.dispose();}
test('rigid render banks retain original semantic meshes and exact PBR geometry, UVs, colours, rays and parent motion',()=>{
 const f=fixture();try{
  const before=cost([f.root]),ids=f.parent.children.slice(),original=f.meshes.map(o=>({g:o.geometry,m:o.material,position:Array.from(o.geometry.attributes.position.array)}));f.banks.sync([f.root]);
  assert.equal(f.banks.banks.length,1);const bank=f.banks.banks[0],after=cost([f.root]);assert.equal(before.drawCalls,5);assert.equal(after.drawCalls,1);assert.equal(after.triangles,before.triangles);assert.equal(bank.material,f.material);assert.equal(bank.castShadow,true);assert.equal(bank.geometry.attributes.color.normalized,true);
  assert.deepEqual(f.parent.children.slice(0,5),ids);for(let i=0,vertex=0;i<f.meshes.length;i++){const o=f.meshes[i];assert.equal(o.geometry,original[i].g);assert.equal(o.material,original[i].m);assert.deepEqual(Array.from(o.geometry.attributes.position.array),original[i].position);assert.equal(o.userData.editorId,'native:fixture:'+i);assert.equal(o.layers.mask,0);
   for(let n=0;n<o.geometry.attributes.position.count;n++,vertex++){const point=new THREE.Vector3().fromBufferAttribute(o.geometry.attributes.position,n).applyMatrix4(o.matrix),actual=new THREE.Vector3().fromBufferAttribute(bank.geometry.attributes.position,vertex);assert(point.distanceTo(actual)<1e-6);for(const name of['uv','color'])for(let k=0;k<o.geometry.attributes[name].itemSize;k++)assert.equal(bank.geometry.attributes[name].array[vertex*o.geometry.attributes[name].itemSize+k],o.geometry.attributes[name].array[n*o.geometry.attributes[name].itemSize+k]);}}
  f.parent.rotation.z=.4;f.root.updateMatrixWorld(true);f.banks.sync([f.root]);assert.equal(f.banks.getStats().rebuilds,1,'Parent joint motion does not rebake rigid local siblings.');
  const target=f.meshes[2].getWorldPosition(new THREE.Vector3()),ray=new THREE.Raycaster(target.clone().add(new THREE.Vector3(0,0,2)),new THREE.Vector3(0,0,-1));const hits=ray.intersectObject(f.root,true);assert(hits.some(hit=>f.meshes.includes(hit.object)),'Three r112 raycast still hits original surfaces.');assert(!hits.some(hit=>hit.object===bank),'The bank is not a duplicate physics/ray target.');
 }finally{cleanup(f);}
});
test('an individually animated source retires while unchanged rigid siblings remain batched',()=>{
 const f=fixture();try{f.banks.sync([f.root]);f.meshes[0].position.y+=.1;f.banks.sync([f.root]);assert.equal(f.meshes[0].layers.mask,1);assert.equal(f.banks.getStats().sources,4);f.meshes[0].position.y+=.1;f.banks.sync([f.root]);assert.equal(f.banks.getStats().rebuilds,2);assert.equal(cost([f.root]).drawCalls,2);}finally{cleanup(f);}
});

test('nested static sections share their exact material bank without crossing joints or changing transformed vertices',()=>{
 const f=fixture();try{
  const left=new THREE.Group(),right=new THREE.Group();left.position.set(.3,.2,-.7);left.rotation.z=.4;right.position.set(-.4,.1,.8);right.scale.set(1.2,.8,1.1);f.parent.add(left,right);
  f.meshes.forEach((object,i)=>(i<2?left:right).add(object));f.root.updateMatrixWorld(true);const originals=f.meshes.map(object=>({object,matrix:object.matrixWorld.clone()}));
  f.banks.sync([f.root]);assert.equal(f.banks.banks.length,1);const bank=f.banks.banks[0];assert.equal(bank.parent,f.parent);assert.equal(cost([f.root]).drawCalls,1);f.root.updateMatrixWorld(true);
  for(let vertex=0,i=0;i<originals.length;i++){const original=originals[i];for(let n=0;n<original.object.geometry.attributes.position.count;n++,vertex++){const expected=new THREE.Vector3().fromBufferAttribute(original.object.geometry.attributes.position,n).applyMatrix4(original.matrix),actual=new THREE.Vector3().fromBufferAttribute(bank.geometry.attributes.position,vertex).applyMatrix4(bank.matrixWorld);assert(expected.distanceTo(actual)<1e-6);}}
  f.parent.rotation.x=.3;f.banks.sync([f.root]);assert.equal(f.banks.getStats().rebuilds,1,'The joint moves its unchanged local bank without rebaking.');
 }finally{cleanup(f);}
});

test('an unknown animated ancestor retires its whole subtree once while action descendants remain independent from the start',()=>{
 const f=fixture();try{
  const moving=new THREE.Group(),fixed=new THREE.Group(),action=new THREE.Group();action.userData.industrialAction='pause';f.parent.add(moving,fixed,action);
  f.meshes.forEach((object,i)=>(i<2?moving:i<4?fixed:action).add(object));f.banks.sync([f.root]);assert.equal(f.banks.getStats().sources,4);assert.equal(f.meshes[4].layers.mask,1);
  moving.rotation.y=.1;f.banks.sync([f.root]);assert.equal(f.banks.getStats().sources,2);assert.equal(f.meshes[0].layers.mask,1);assert.equal(f.meshes[1].layers.mask,1);assert.equal(cost([f.root]).drawCalls,4);
  moving.rotation.y=.2;f.banks.sync([f.root]);assert.equal(f.banks.getStats().rebuilds,2,'An animated group does not cause allocation and rebaking on every frame.');
 }finally{cleanup(f);}
});

test('render-identical native material clones merge without changing ownership and split when one finish changes',()=>{
 const f=fixture(),clones=[];try{
  f.meshes.forEach((object,i)=>{const material=f.material.clone();clones.push(material);material.name='Editable finish '+i;object.material=material;});f.banks.sync([f.root]);assert.equal(f.banks.getStats().banks,1);assert.equal(f.banks.banks[0].material,clones[0]);assert(f.meshes.every((object,i)=>object.material===clones[i]));
  clones[1].color.set('#124477');f.banks.sync([f.root]);assert.equal(f.meshes[1].layers.mask,1);assert.equal(f.banks.getStats().sources,4);assert.equal(f.banks.banks[0].material,clones[0]);
  clones[2].roughness=.9;f.banks.sync([f.root]);assert.equal(f.meshes[2].layers.mask,1);assert.equal(f.banks.getStats().sources,3);assert.equal(cost([f.root]).drawCalls,3);
  const disposed=[];clones.forEach(material=>material.addEventListener('dispose',()=>disposed.push(material)));f.banks.dispose();assert.deepEqual(disposed,[],'Banks never dispose native independently editable materials.');
 }finally{clones.forEach(material=>material.dispose());cleanup(f);}
});

test('opaque untextured colour banks preserve linear diffuse RGB and release only their private material',()=>{
 const f=fixture(),materials=[];try{
  for(let i=0;i<f.meshes.length;i++){const object=f.meshes[i];object.geometry.deleteAttribute('color');const material=f.material.clone();material.color.setRGB(.11+i*.08,.27+i*.04,.63-i*.07);materials.push(material);object.material=material;}
  f.banks.sync([f.root]);assert.equal(f.banks.banks.length,1);let bank=f.banks.banks[0];assert.equal(bank.material.vertexColors,THREE.VertexColors);assert.equal(bank.material.color.getHex(),0xffffff);assert.equal(bank.material.roughness,f.material.roughness);assert.equal(bank.material.metalness,f.material.metalness);assert.notEqual(bank.material,materials[0]);
  for(let vertex=0,i=0;i<f.meshes.length;i++)for(let n=0;n<f.meshes[i].geometry.attributes.position.count;n++,vertex++)for(let channel=0;channel<3;channel++){const expected=materials[i].color[['r','g','b'][channel]],actual=bank.geometry.attributes.color.array[vertex*3+channel];assert(Math.abs(expected-actual)<1e-7,'Vertex colour is already linear, without a second sRGB conversion.');assert(Math.abs(expected*.37-actual*.37)<1e-7,'A common lighting factor preserves the original diffuse term.');}
  let privateDisposed=0,nativeDisposed=0;bank.material.addEventListener('dispose',()=>privateDisposed++);materials.forEach(m=>m.addEventListener('dispose',()=>nativeDisposed++));materials[1].color.setRGB(.83,.12,.25);f.banks.sync([f.root]);assert.equal(privateDisposed,1);assert.equal(nativeDisposed,0);bank=f.banks.banks[0];bank.material.addEventListener('dispose',()=>privateDisposed++);f.banks.dispose();assert.equal(privateDisposed,2);assert.equal(nativeDisposed,0);
 }finally{materials.forEach(m=>m.dispose());cleanup(f);}
});

test('exact fixed siblings inside one button retain the input owner, independently moving cap and ray identity',()=>{
 const f=fixture();try{
  const action=new THREE.Group();action.userData.industrialAction='pause';f.parent.add(action);for(const mesh of f.meshes)action.add(mesh);f.meshes[2].userData.industrialButton=true;f.banks.sync([f.root]);assert.equal(f.banks.getStats().sources,4);assert.equal(f.banks.banks[0].parent,action);assert.equal(f.meshes[2].layers.mask,1);
  const rebuilds=f.banks.getStats().rebuilds;action.rotation.y=.4;f.meshes[2].position.z+=.015;f.root.updateMatrixWorld(true);f.banks.sync([f.root]);assert.equal(f.banks.getStats().rebuilds,rebuilds);assert.equal(action.userData.industrialAction,'pause');const target=f.meshes[0].getWorldPosition(new THREE.Vector3()),hits=new THREE.Raycaster(target.clone().add(new THREE.Vector3(0,0,2)),new THREE.Vector3(0,0,-1)).intersectObject(action,true);assert(hits.some(hit=>hit.object===f.meshes[0]));assert(!hits.some(hit=>hit.object.userData.nativeRenderBank));
 }finally{cleanup(f);}
});

test('a native product bank follows its carried root across parent changes while original geometry and identifiers remain',()=>{
 const f=fixture();try{
  f.root.userData.editorPrefabKey='product';const room=new THREE.Group(),forks=new THREE.Group();room.add(f.root,forks);f.banks.sync([f.root]);const bank=f.banks.banks[0],ids=f.meshes.map(mesh=>mesh.userData.editorId);forks.position.set(2,1.7,-3);forks.rotation.y=.6;forks.add(f.root);room.updateMatrixWorld(true);f.banks.sync([f.root]);assert.equal(f.banks.banks[0],bank);assert.deepEqual(f.meshes.map(mesh=>mesh.userData.editorId),ids);assert.equal(f.banks.getStats().rebuilds,1);
  const p=new THREE.Vector3().fromBufferAttribute(f.meshes[0].geometry.attributes.position,0).applyMatrix4(f.meshes[0].matrixWorld),q=new THREE.Vector3().fromBufferAttribute(bank.geometry.attributes.position,0).applyMatrix4(bank.matrixWorld);assert(p.distanceTo(q)<1e-6);f.banks.dispose();assert(f.meshes.every(mesh=>mesh.layers.mask===1));assert(f.meshes.every(mesh=>mesh.geometry.attributes.position.count>0));
 }finally{cleanup(f);}
});

test('persisted facility opt-in banks preserve separate physical wall colliders after document reload',async()=>{
 const native=require('../support/load-practice-scenes.cjs')(),f=native.fixture();try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall','SF-04',{mode:'automatic',scene:f.scene}),facilityIds=built.manifest.facility.objects.filter(row=>['envelope','detail'].includes(row.role)).map(row=>row.objectId),serialized=native.validateDocument(await f.document.serialize(),v=>v);
  await f.document.load(serialized);const manifest=f.document.studio.moduleData['sector.logistics-industrial'].levels.find(row=>row.roomId==='hall');assert.deepEqual(manifest.facility.objects.filter(row=>['envelope','detail'].includes(row.role)).map(row=>row.objectId),facilityIds);
  const originals=facilityIds.map(id=>f.document.getObject(id)),meshes=originals.flatMap(object=>{const out=[];object.traverse(mesh=>{if(f.ctx.collisionWorld.physicalMesh(mesh))out.push(mesh);});return out;});assert(meshes.length>10);f.runtime.start('hall');f.runtime.syncNativePresentation();assert(f.runtime.nativeRenderBanks.sources.some(row=>originals.some(root=>{for(let o=row.object;o;o=o.parent)if(o===root)return true;return false;})));
  assert(meshes.every(mesh=>f.ctx.collisionWorld.physicalMesh(mesh)),'Draw-only suppression never merges or hides the closed physical partition.');for(const object of originals)assert.equal(f.document.getObject(object.userData.editorId),object);f.runtime.stop();assert(meshes.every(mesh=>mesh.layers.mask!==0));
 }finally{native.releaseGeometry(f);}
});
test('deforming native buffers retire after one change instead of rebaking every headset frame',()=>{
 const f=fixture();try{f.banks.sync([f.root]);const p=f.meshes[0].geometry.attributes.position;p.setY(0,p.getY(0)+.01);p.needsUpdate=true;f.banks.sync([f.root]);assert.equal(f.meshes[0].layers.mask,1);assert.equal(f.banks.getStats().sources,4);p.setY(0,p.getY(0)+.01);p.needsUpdate=true;f.banks.sync([f.root]);assert.equal(f.banks.getStats().rebuilds,2);}finally{cleanup(f);}
});
test('hologram, hidden source, geometry replacement and editor stop fail open without ghost surfaces',()=>{
 const f=fixture();let transparent;try{
  f.banks.sync([f.root]);transparent=f.material.clone();transparent.transparent=true;transparent.opacity=.05;f.meshes[0].material=transparent;f.banks.sync([f.root]);assert.equal(f.meshes[0].layers.mask,1);assert.equal(f.banks.getStats().sources,4);
  f.meshes[1].visible=false;f.banks.sync([f.root]);assert.equal(f.meshes[1].layers.mask,1);assert.equal(f.banks.getStats().sources,3);
  const old=f.meshes[2].geometry;f.meshes[2].geometry=new THREE.SphereBufferGeometry(.1,8,6);f.banks.sync([f.root]);assert.equal(f.banks.getStats().sources,2,'Different attribute layouts keep independent draws.');assert.equal(f.meshes[2].layers.mask,1);old.dispose();
  f.banks.sync([f.root],{editing:true});assert.equal(f.banks.banks.length,0);assert(f.meshes.every(o=>o.layers.mask===1));
 }finally{if(transparent)transparent.dispose();cleanup(f);}
});
test('controls, live screens, unknown shaders, transparent pieces and independent preserved mechanisms keep their own draws',()=>{
 const f=fixture();const clones=[];try{
  f.meshes[0].userData.industrialButton=true;Object.assign(f.meshes[1].userData,{vehiclePreserve:true,equipmentComponentId:'vehicle.controls'});
  f.meshes[2].material=f.material.clone();clones.push(f.meshes[2].material);f.meshes[2].material.onBeforeCompile=()=>{};
  f.meshes[3].material=f.material.clone();clones.push(f.meshes[3].material);f.meshes[3].material.map=new THREE.CanvasTexture({width:4,height:4});
  f.banks.sync([f.root]);assert.equal(f.banks.banks.length,0);assert(f.meshes.every(o=>o.layers.mask===1));
 }finally{for(const material of clones){if(material.map)material.map.dispose();material.dispose();}cleanup(f);}
});
test('disposing is idempotent and releases only private bank buffers',()=>{
 const f=fixture();let nativeDisposed=0,bankDisposed=0;try{for(const o of f.meshes)o.geometry.addEventListener('dispose',()=>nativeDisposed++);f.material.addEventListener('dispose',()=>nativeDisposed++);f.banks.sync([f.root]);f.banks.banks[0].geometry.addEventListener('dispose',()=>bankDisposed++);f.banks.dispose();f.banks.dispose();assert.equal(bankDisposed,1);assert.equal(nativeDisposed,0);assert.equal(f.parent.children.length,5);assert(f.meshes.every(o=>o.layers.mask===1));}finally{cleanup(f);}
});
test('an optional renderer bank failure restores drawing and cannot freeze the simulation loop',()=>{
 const native=require('../support/load-practice-scenes.cjs')(),f=native.fixture();try{
  native.buildConfigurablePracticeScene(f.document,'hall','CEDI-01',{caseId:'A',mode:'manual',difficulty:1,scene:f.scene});f.runtime.start('hall');f.runtime.syncNativePresentation();assert(f.runtime.nativeRenderBanks.getStats().sources>0);
  const bank=f.runtime.nativeRenderBanks,original=bank.sync;bank.sync=()=>{throw Error('fixture renderer boundary');};assert.doesNotThrow(()=>f.runtime.syncNativePresentation());assert.equal(bank.getStats().sources,0);assert.equal(f.runtime.nativePresentationFailure,'fixture renderer boundary');const time=f.runtime.time;assert.doesNotThrow(()=>f.runtime.execute(1/60));assert(f.runtime.time>time);bank.sync=original;f.runtime.start('hall');assert.equal(f.runtime.nativePresentationFailure,null);
 }finally{native.releaseGeometry(f);}
});
test('actual source practices reduce native draw submissions while material stock, physical targets and node identities remain',()=>{
 const native=require('../support/load-practice-scenes.cjs')(),ids=['CEDI-01','CEDI-04','SF-04','SF-05'],rows=[];
 for(const id of ids){const f=native.fixture();try{
  const built=native.buildConfigurablePracticeScene(f.document,'hall',id,{caseId:'A',mode:'automatic',difficulty:1,scene:f.scene}),originals=f.document.getObjects('hall').map(o=>[o.userData.editorId,o]);f.runtime.start('hall');const before=cost(built.objects);f.runtime.syncNativePresentation();const after=cost(built.objects.concat(f.runtime.nativeRenderBanks.banks)),stats=f.runtime.nativeRenderBanks.getStats();
  for(const [id,object]of originals)assert.equal(f.document.getObject(id),object);assert.equal((built.manifest.productIds||[]).filter(id=>f.document.getObject(id)).length,built.manifest.productIds.length);assert(stats.drawCallsAvoided>=15,id+' needs meaningful native render reduction.');assert(after.drawCalls<before.drawCalls,id+' must submit fewer actual visible geometry banks.');assert.equal(after.triangles,before.triangles,'No visible native topology is simplified.');rows.push({id,before:before.drawCalls,after:after.drawCalls,avoided:stats.drawCallsAvoided,bankBytes:stats.bufferBytes});
  f.runtime.stop();assert.equal(f.runtime.nativeRenderBanks.getStats().sources,0);for(const [id,object]of originals)assert.equal(f.document.getObject(id),object);
 }finally{native.releaseGeometry(f);}}
 console.log('Native rigid-bank costs '+JSON.stringify(rows));
});
