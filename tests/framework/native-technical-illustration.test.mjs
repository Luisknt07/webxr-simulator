import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as upstream from '../../packages/tools/anatomy/vendor/anatomy/kit/iso-kit.mjs';
const require=createRequire(import.meta.url),THREE=require('three'),illustration=require('../support/load-native-technical-illustration')(THREE);
const fs=require('node:fs'),path=require('node:path'),projectionSource=fs.readFileSync(path.resolve('packages/render-three/src/TechnicalProjection.js'),'utf8').replace(/^export function /gm,'function ').replace('export default {cameraOf, iso, depthOf};','return {cameraOf,iso,depthOf};');
const projection=new Function(projectionSource)();
const material=hex=>{const value=new THREE.MeshStandardMaterial({color:hex,metalness:.25,roughness:.4});value.color.convertSRGBToLinear();value.userData.studioColorSpace='linear';return value;};
function machine(){const root=new THREE.Group(),joint=new THREE.Group();joint.name='Eje J2';root.add(joint);const mesh=new THREE.Mesh(new THREE.BoxBufferGeometry(.7,1.2,.35),material('#f6aa27'));mesh.name='Carcasa';joint.add(mesh);mesh.position.y=.6;root.updateWorldMatrix(true,true);return{root,joint,mesh};}
function snapshot(root){return JSON.stringify(root.toJSON());}

test('shared technical projection is the actual pinned Anatomy camera/iso/depth math without an authoring runtime dependency',()=>{
 for(const camera of [{origin:[0,0],scale:1},{origin:[125,71],scale:2.4,azimuth:17,elevation:48},{origin:[3,-8],scale:.2,azimuth:213,elevation:70}]){
  assert.deepEqual(projection.cameraOf(camera),upstream.cameraOf(camera));for(const point of [[0,0,0],[1,2,3],[-2,.5,9]]){assert.deepEqual(projection.iso(point,camera),upstream.iso(point,camera));assert.equal(projection.depthOf(point,camera),upstream.depthOf(point,camera));}
 }
 assert(!/import |require\(/.test(projectionSource));
});

test('native illustration follows the same articulated mesh, preserves smooth data and corrects linear colours for Canvas',()=>{
 const{root,joint,mesh}=machine(),before=snapshot(root),captured=illustration.capture(root),model=illustration.build(captured,[{name:'Carcasa',match:['carcasa']}]);
 assert.equal(model.meshCount,1);assert.equal(model.sourceTriangles,12);assert.equal(model.triangleCount,6);assert.equal(model.simplifiedMeshes,0);assert.equal(model.projectionSource,'Anatomy / native geometry');
 assert.equal(snapshot(root),before);assert(model.faces.every(face=>face.points.every(point=>Object.values(point).every(Number.isFinite))));
 const channels=model.faces.map(face=>parseInt(face.color.slice(1,3),16));assert(Math.min(...channels)>160,'The yellow painted shell must not be encoded as dark linear RGB hex.');
 const contourEdges=model.faces.reduce((sum,face)=>sum+face.edges.length,0);assert(contourEdges>0&&contourEdges<model.faces.length*3,'Only silhouettes/creases are outlined; the triangular grid is not.');
 const geometry=Array.from(mesh.geometry.attributes.position.array),normals=Array.from(mesh.geometry.attributes.normal.array);joint.rotation.z=.63;root.updateWorldMatrix(true,true);
 const moved=illustration.build(illustration.capture(root),[]);assert.notDeepEqual(moved.faces[0].points,model.faces[0].points);assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),geometry);assert.deepEqual(Array.from(mesh.geometry.attributes.normal.array),normals);
});

test('front/top/exploded views share actual geometry and never transform the source hierarchy',()=>{
 const{root,joint}=machine(),foot=new THREE.Mesh(new THREE.BoxBufferGeometry(.9,.12,.6),material('#334653'));foot.name='Base';root.add(foot);root.updateWorldMatrix(true,true);const before=snapshot(root),parts=[{name:'Base',match:['base']},{name:'Carcasa',match:['carcasa']}];
 const models=Object.fromEntries(illustration.MODES.map(mode=>[mode,illustration.build(illustration.capture(root),parts,0,mode)]));
 assert(Math.abs(models.front.bounds.maxX-models.front.bounds.minX-.9)<1e-6);assert(Math.abs(models.top.bounds.maxY-models.top.bounds.minY-.6)<1e-6);assert(models.exploded.bounds.maxY-models.exploded.bounds.minY>models.isometric.bounds.maxY-models.isometric.bounds.minY);
 assert(models.front.parts.every(part=>part.point));assert.notDeepEqual(models.isometric.faces[0].points,models.front.faces[0].points);assert.equal(snapshot(root),before);assert.equal(joint.rotation.z,0);
});

test('real instances, draw ranges and mirrored transforms are represented while helpers and hidden descendants stay out',()=>{
 const root=new THREE.Group(),geometry=new THREE.BoxBufferGeometry(1,1,1),mesh=new THREE.InstancedMesh(geometry,material('#bf4d27'),2);root.add(mesh);mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-2,0,0));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(2,0,0));
 const hidden=new THREE.Group();hidden.visible=false;hidden.add(new THREE.Mesh(geometry,material('#000000')));root.add(hidden);const helper=new THREE.Group();helper.userData.editorRuntimeHelper=true;helper.add(new THREE.Mesh(geometry,material('#000000')));root.add(helper);
 let entries=illustration.capture(root);assert.equal(entries.length,2);let model=illustration.build(entries);assert.equal(model.sourceTriangles,24);assert(model.triangleCount>=8);assert(model.bounds.maxX-model.bounds.minX>3);
 geometry.setDrawRange(0,6);entries=illustration.capture(root);assert.equal(entries[0].count,2);assert.equal(illustration.build(entries).sourceTriangles,4);
 geometry.setDrawRange(0,Infinity);root.scale.x=-1;model=illustration.build(illustration.capture(root));assert(model.faces.length>0&&model.faces.every(face=>/^#[0-9a-f]{6}$/i.test(face.color)));assert(model.faces.every(face=>face.points.every(point=>Object.values(point).every(Number.isFinite))));
});

test('over-budget surfaces use complete labelled envelopes instead of holes from triangle subsampling',()=>{
 const root=new THREE.Group(),geometry=new THREE.TorusBufferGeometry(1,.2,64,256),mesh=new THREE.Mesh(geometry,material('#aebcc8'));mesh.name='Malla externa muy densa';root.add(mesh);const positions=Array.from(geometry.attributes.position.array),before=snapshot(root),model=illustration.build(illustration.capture(root));
 assert(model.sourceTriangles>illustration.LIMITS.sourceFaces);assert.equal(model.simplifiedMeshes,1);assert.equal(model.triangleCount,6);assert(model.faces.reduce((sum,face)=>sum+face.edges.length,0)>=6);assert.equal(snapshot(root),before);assert.deepEqual(Array.from(geometry.attributes.position.array),positions);
 const many=new THREE.Group();for(let i=0;i<450;i++){const box=new THREE.Mesh(new THREE.BoxBufferGeometry(.1,.1,.1),material('#8899aa'));box.position.set(i%25,Math.floor(i/25),0);many.add(box);}const entries=illustration.capture(many);assert.equal(entries.length,illustration.LIMITS.meshes);const partial=illustration.build(entries);assert(partial.triangleCount<=illustration.LIMITS.faces);assert.equal(partial.truncatedMeshes,50);assert.equal(partial.omittedInstances,50);assert.equal(partial.sourceTriangles,450*12);assert.equal(partial.capturedSourceTriangles,400*12);
});

test('mobile/XR illustration has its own lower CPU limits without reducing source geometry',()=>{
 const root=new THREE.Group(),geometry=new THREE.SphereBufferGeometry(.2,16,10);for(let i=0;i<220;i++){const mesh=new THREE.Mesh(geometry,material('#e3a329'));mesh.position.set(i%20,Math.floor(i/20),0);root.add(mesh);}root.updateWorldMatrix(true,true);
 const before=snapshot(root),budget={faces:2000,sourceFaces:4000,maxMeshes:160},model=illustration.build(illustration.capture(root,budget),[],0,'isometric',budget);
 assert.equal(model.limits.faces,2000);assert.equal(model.limits.sourceFaces,4000);assert.equal(model.limits.meshes,160);assert.equal(model.meshCount,160);assert.equal(model.omittedInstances,60);assert(model.simplifiedMeshes>0);assert(model.triangleCount<=2000);assert.equal(snapshot(root),before);
 illustration.clearCache();assert.equal(snapshot(root),before);
});

test('real machine framing excludes its attached HMI while a standalone PLC remains fully inspectable',()=>{
 const behaviors=require('../../modules/logistica-industrial/contracts/behaviors.js'),prefabs=require('../support/load-robot-prefabs')(THREE),source=file=>fs.readFileSync(path.resolve(file),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
 const factory=new Function('THREE','behaviorSchema','require',source('modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js')+'\nreturn createIndustrialPrefab;')(THREE,behaviors,prefabs.resolve),SceneDocument=new Function('THREE','behaviorSchema','createIndustrialPrefab',source('packages/project-model/src/SceneDocument.js').replace('default class SceneDocument','return class SceneDocument'))(THREE,behaviors,factory);
 const document=new SceneDocument({});document.registerRoom('hall',new THREE.Group());
 for(const type of ['robot','conveyor']){
  const object=document.addPrefab('hall',type),panel=object.children[0].children[type==='robot'?1:6];assert.equal(panel.visible,true);object.updateWorldMatrix(true,true);const before=snapshot(object),withPanel=illustration.build(illustration.capture(object));
  assert.equal(snapshot(object),before,'Framing must not hide, delete or modify the physical HMI.');
  document.setBehaviors(object,document.getBehaviors(object).map(row=>row.type===type?{...row,withPanel:false}:row));const withoutPanel=illustration.build(illustration.capture(object));
  assert.equal(withPanel.sourceTriangles,withoutPanel.sourceTriangles);assert.deepEqual(withPanel.bounds,withoutPanel.bounds);assert.deepEqual(withPanel.faces,withoutPanel.faces);
 }
 const panel=document.addPrefab('hall','plc');panel.updateWorldMatrix(true,true);const before=snapshot(panel),captured=illustration.capture(panel),model=illustration.build(captured);assert(captured.length>8);assert(model.triangleCount>100);assert(captured.some(entry=>entry.names.includes('armario')));assert.equal(snapshot(panel),before);
});

test('exploded views separate real robot, conveyor, vehicle and merged rack banks instead of translating the whole model',()=>{
 const behaviors=require('../../modules/logistica-industrial/contracts/behaviors.js'),prefabs=require('../support/load-robot-prefabs')(THREE),source=file=>fs.readFileSync(path.resolve(file),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
 const factory=new Function('THREE','behaviorSchema','require',source('modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js')+'\nreturn createIndustrialPrefab;')(THREE,behaviors,prefabs.resolve),SceneDocument=new Function('THREE','behaviorSchema','createIndustrialPrefab',source('packages/project-model/src/SceneDocument.js').replace('default class SceneDocument','return class SceneDocument'))(THREE,behaviors,factory);
 const monitor=source('modules/logistica-industrial/functions/almacenamiento/runtime/LineMonitorSystem.js').split('/** World-space, ray-operated HMI.')[0],partsFor=new Function('THREE','behaviorSchema','nativeIllustration',monitor+'\nreturn equipmentParts;')(THREE,behaviors,illustration),document=new SceneDocument({});document.registerRoom('hall',new THREE.Group());
 const spread=model=>{const points=model.faces.flatMap(face=>face.points),mean=points.reduce((sum,p)=>({x:sum.x+p.x/points.length,y:sum.y+p.y/points.length}),{x:0,y:0});return points.reduce((sum,p)=>sum+((p.x-mean.x)**2+(p.y-mean.y)**2)/points.length,0);};
 for(const[type,variant]of [['robot','articulated-general'],['conveyor','roller-start'],['vehicle','forklift-electric-4w'],['palletQueue','selective']]){
  const object=document.addPrefab('hall',type,variant);object.updateWorldMatrix(true,true);const before=snapshot(object),config=document.getBehaviors(object).find(row=>row.type===type),parts=partsFor({object,config}),meshes=illustration.capture(object),iso=illustration.build(meshes,parts,0,'isometric'),exploded=illustration.build(meshes,parts,0,'exploded');
  assert.equal(exploded.triangleCount,iso.triangleCount,type+': source surfaces must remain unchanged');assert(Math.abs(spread(exploded)-spread(iso))/Math.max(1e-6,spread(iso))>1e-5,type+': explosion must change relative component positions, not just translate the entire model');assert.equal(snapshot(object),before,type+': preview must not transform native mechanical parts');
  if(type==='palletQueue'){assert(parts.some(part=>part.roles.includes('frame')));assert(parts.some(part=>part.roles.includes('beam')));assert(new Set(exploded.faces.map(face=>face.part)).size>2,'Merged structural, beam and address banks remain independently identifiable.');}
 }
});
