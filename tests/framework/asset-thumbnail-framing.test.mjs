import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three');
const source=fs.readFileSync(new URL('../../packages/tools/editor/src/AssetThumbnails.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class AssetThumbnails','class AssetThumbnails');
const implementation=new Function('THREE',source+'\nreturn {Thumbnails:AssetThumbnails,disposeObject};')(THREE),Thumbnails=implementation.Thumbnails;
const mesh=(x,y,z)=>new THREE.Mesh(new THREE.BoxBufferGeometry(x,y,z),new THREE.MeshBasicMaterial());
function vertices(root){
 const points=[];root.updateMatrixWorld(true);
 const visit=node=>{
  if(!node.visible||node.userData.editorHelper||node.userData.editorRuntimeHelper||node.userData.thumbnailExclude)return;
  const materials=(Array.isArray(node.material)?node.material:[node.material]).filter(Boolean);
  if(node.geometry&&(!materials.length||materials.some(material=>material.visible!==false&&!(material.transparent&&material.opacity<=0)))){
   const matrices=[];
   if(node.isInstancedMesh){for(let n=0;n<node.count;n++){const matrix=new THREE.Matrix4();node.getMatrixAt(n,matrix);matrices.push(new THREE.Matrix4().multiplyMatrices(node.matrixWorld,matrix));}}else matrices.push(node.matrixWorld);
   const geometry=node.geometry;
   for(const matrix of matrices){if(geometry.attributes&&geometry.attributes.position){const p=geometry.attributes.position;for(let n=0;n<p.count;n++)points.push(new THREE.Vector3().fromBufferAttribute(p,n).applyMatrix4(matrix));}else for(const value of geometry.vertices||[])points.push(value.clone().applyMatrix4(matrix));}
  }
  node.children.forEach(visit);
 };visit(root);return points;
}
function projection(points,camera){
 const projected=points.map(point=>point.clone().project(camera));assert(projected.length>0);
 assert(projected.every(p=>[p.x,p.y,p.z].every(Number.isFinite)),'The native projection must remain finite.');
 return{minX:Math.min(...projected.map(p=>p.x)),maxX:Math.max(...projected.map(p=>p.x)),minY:Math.min(...projected.map(p=>p.y)),maxY:Math.max(...projected.map(p=>p.y)),minZ:Math.min(...projected.map(p=>p.z)),maxZ:Math.max(...projected.map(p=>p.z))};
}
function checkFit(object,aspect=1,options={}){
 const camera=new THREE.PerspectiveCamera(38,aspect,.1,100),fit=Thumbnails.frameCamera(object,camera,options),bounds=projection(vertices(object),camera);
 assert(bounds.minX>=-.920001&&bounds.maxX<=.920001&&bounds.minY>=-.920001&&bounds.maxY<=.920001,'Visible native geometry clips its padded viewport: '+JSON.stringify(bounds));
 assert(bounds.minZ>=-1&&bounds.maxZ<=1,'Near/far planes cut the model.');assert(camera.near>0&&camera.far>camera.near);return{camera,fit,bounds};
}
const dispose=object=>{object.traverse(node=>{if(node.geometry)node.geometry.dispose();for(const material of Array.isArray(node.material)?node.material:[node.material])if(material)material.dispose();});};

test('native orbit preview copies own their textures while the scene atlas remains shared',()=>{
 const library=fs.readFileSync(new URL('../../packages/tools/editor/src/AssetLibrary.js',import.meta.url),'utf8');
 const helpers=new Function(library.slice(library.indexOf('function materialsOf('),library.indexOf('export default class AssetLibrary'))+'\nreturn {cloneNativeMaterial,disposeObject};')();
 const atlas=new THREE.Texture();atlas.userData={sharedIndustrialTexture:true};let sharedDisposed=0,copyDisposed=0;atlas.addEventListener('dispose',()=>sharedDisposed++);
 const original=new THREE.MeshBasicMaterial({map:atlas}),copy=helpers.cloneNativeMaterial(original,new Map());assert.notEqual(copy.map,atlas);assert.equal(atlas.userData.sharedIndustrialTexture,true);assert.equal(copy.map.userData&&copy.map.userData.sharedIndustrialTexture,undefined);copy.map.addEventListener('dispose',()=>copyDisposed++);
 const root=new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxBufferGeometry(),copy));helpers.disposeObject(root);assert.equal(sharedDisposed,0);assert.equal(copyDisposed,1);original.dispose();
});

test('native cube, long conveyor, tall rack and thin plane fill the limiting viewport dimension without clipping',()=>{
 for(const size of [[1,1,1],[14,.25,.7],[.3,20,.45],[3,.001,2]])for(const aspect of [.5,1,2.7]){
  const object=mesh(...size);object.position.set(7,-2,4);object.rotation.set(.17,.5,-.13);object.scale.set(1.3,.85,1.15);
  const before=[...object.position.toArray(),...object.quaternion.toArray(),...object.scale.toArray()],{bounds}=checkFit(object,aspect);
  assert(Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY)>=1.83,'The actual model still wastes its image stage.');
  assert.deepEqual([...object.position.toArray(),...object.quaternion.toArray(),...object.scale.toArray()],before);dispose(object);
 }
});

test('hidden descendants, transparent-only parts and editor helpers do not shrink the equipment into a distant dot',()=>{
 const root=new THREE.Group(),subject=mesh(2,3,1),hidden=new THREE.Group(),hiddenMesh=mesh(100,100,100),helper=mesh(100,100,100),invisible=mesh(200,200,200);
 hidden.visible=false;hidden.add(hiddenMesh);hidden.position.x=500;helper.userData.editorRuntimeHelper=true;helper.position.y=900;invisible.material.transparent=true;invisible.material.opacity=0;root.add(subject,hidden,helper,invisible);
 const {fit,bounds}=checkFit(root);assert.deepEqual(fit.bounds.getSize(new THREE.Vector3()).toArray(),[2,3,1]);assert(Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY)>1.8);assert.equal(hidden.visible,false);assert.equal(helper.userData.editorRuntimeHelper,true);dispose(root);
});

test('all native instance transforms are fitted, including a distant last instance and a transformed parent',()=>{
 const root=new THREE.Group(),group=new THREE.Group(),instances=new THREE.InstancedMesh(new THREE.BoxBufferGeometry(1,.4,.6),new THREE.MeshBasicMaterial(),3);
 instances.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-4,0,0));instances.setMatrixAt(1,new THREE.Matrix4().makeTranslation(0,2,1));instances.setMatrixAt(2,new THREE.Matrix4().compose(new THREE.Vector3(7,4,-2),new THREE.Quaternion().setFromEuler(new THREE.Euler(.3,.8,0)),new THREE.Vector3(1,2,.7)));
 group.position.set(5,3,-2);group.rotation.y=.7;group.scale.set(-1,1.2,.9);group.add(instances);root.add(group);
 for(const aspect of [.65,1,2]){const {bounds}=checkFit(root,aspect);assert(Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY)>1.5);}
 dispose(root);
});

test('camera fit supports orbit direction, extreme aspect and vertical views without allocating a renderer',()=>{
 const object=mesh(4,2,1);
 for(const direction of [new THREE.Vector3(0,1,0),new THREE.Vector3(-2,1,-3),new THREE.Vector3(0,0,1)])for(const aspect of [.25,4])checkFit(object,aspect,{direction});
 const camera=new THREE.PerspectiveCamera(38,1,.1,100);assert.doesNotThrow(()=>Thumbnails.frameCamera(object,camera,{direction:new THREE.Vector3(NaN,0,0)}));
 const empty=new THREE.Group();assert.throws(()=>Thumbnails.frameCamera(empty,camera),/geometría visible/);assert.throws(()=>Thumbnails.frameCamera(object,new THREE.OrthographicCamera()),/perspectiva/);camera.aspect=0;assert.throws(()=>Thumbnails.frameCamera(object,camera),/proporción/);dispose(object);
});

test('a camera under a translated/rotated parent still frames the equipment in world coordinates',()=>{
 const object=mesh(3,2,1),parent=new THREE.Group(),camera=new THREE.PerspectiveCamera(38,1,.1,100);parent.position.set(15,4,-8);parent.rotation.y=.63;parent.add(camera);
 Thumbnails.frameCamera(object,camera);const bounds=projection(vertices(object),camera);assert(bounds.minX>=-.920001&&bounds.maxX<=.920001&&bounds.minY>=-.920001&&bounds.maxY<=.920001);assert(Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY)>1.8);dispose(object);
});

test('actual industrial robot, conveyor, forklift and rack retain their native rigs and occupy a prominent model image',()=>{
 const prefabModules=require('../support/load-robot-prefabs.js')(THREE),schema=require('../../modules/logistica-industrial/contracts/behaviors');
 const nativeSource=fs.readFileSync(new URL('../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
 const factory=new Function('THREE','behaviorSchema','require',nativeSource+'\nreturn createIndustrialPrefab;')(THREE,schema,prefabModules.resolve);
 const cases=[['robot','articulated-general'],['conveyor',undefined],['vehicle','forklift-electric-3w'],['palletQueue','selective']];
 for(const [kind,variant]of cases){
  const object=factory(kind,variant),behaviors=JSON.stringify(object.userData.editorDefaultBehaviors),rig=object.userData.robotRig||object.userData.vehicleRig,poses=[];object.traverse(node=>poses.push({node,position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray(),visible:node.visible}));
  const {bounds,fit}=checkFit(object);assert(Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY)>1.4,kind+' native model is still too small.');assert(fit.points>8);assert.equal(JSON.stringify(object.userData.editorDefaultBehaviors),behaviors);assert.equal(object.userData.robotRig||object.userData.vehicleRig,rig);
  for(const pose of poses){assert.deepEqual(pose.node.position.toArray(),pose.position);assert.deepEqual(pose.node.quaternion.toArray(),pose.quaternion);assert.deepEqual(pose.node.scale.toArray(),pose.scale);assert.equal(pose.node.visible,pose.visible);}dispose(object);
 }
});

test('reference card CSS uses a real image column and separate copy/actions, without the prior tiny compact override',()=>{
 const css=fs.readFileSync(new URL('../../packages/tools/editor/src/resources.css',import.meta.url),'utf8'),navigation=fs.readFileSync(new URL('../../packages/tools/editor/src/library-navigation.css',import.meta.url),'utf8');
 assert.match(css,/grid-template-columns:136px minmax\(0,1fr\)/);assert.match(css,/width:136px!important;height:145px!important/);assert.match(css,/\.studio-resource-card-copy\{display:flex/);assert.match(css,/@container editor-library \(max-width:599px\)/);assert.match(css,/@container resource-card \(max-width:299px\)/);assert.match(css,/grid-template-columns:228px minmax\(300px,1fr\)/);assert.doesNotMatch(css,/studio-resource-thumbnail\{[^}]*width:(?:44|55)px/);assert.doesNotMatch(css,/studio-resource-preview-content canvas \{ height:240px !important/);assert.match(navigation,/studio-resource-variant-select:focus-visible/);
});

test('preview cleanup releases its private textures, geometry and materials once while preserving shared native atlases',()=>{
 const shared=new THREE.Texture(),privateMap=new THREE.Texture(),privateUniform=new THREE.Texture();shared.userData={sharedIndustrialTexture:true};
 const a=mesh(1,1,1),b=mesh(1,2,1),root=new THREE.Group(),disposed={shared:0,map:0,uniform:0,materials:0,geometry:0};
 shared.addEventListener('dispose',()=>disposed.shared++);privateMap.addEventListener('dispose',()=>disposed.map++);privateUniform.addEventListener('dispose',()=>disposed.uniform++);
 a.material.map=shared;a.material.uniforms={privateSample:{value:privateUniform},sharedSample:{value:shared}};b.material.map=privateMap;b.material.normalMap=privateMap;b.material.uniforms={sharedSample:{value:shared},samePrivate:{value:privateUniform}};
 for(const node of [a,b]){node.material.addEventListener('dispose',()=>disposed.materials++);node.geometry.addEventListener('dispose',()=>disposed.geometry++);}root.add(a,b);implementation.disposeObject(root);
 assert.deepEqual(disposed,{shared:0,map:1,uniform:1,materials:2,geometry:2});assert.equal(a.material.map,shared,'The shared texture object/identity remains usable by the live native scene.');
});
