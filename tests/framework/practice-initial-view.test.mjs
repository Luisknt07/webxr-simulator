import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),THREE=require('three');
const source=fs.readFileSync('modules/logistica-industrial/practices/runtime/PracticeCampaignHost.js','utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class PracticeCampaignHost','class PracticeCampaignHost');
const Host=new Function(source+'\nreturn PracticeCampaignHost;')();
function fixture(){
 const scene=new THREE.Scene(),root=new THREE.Group(),vehicle=new THREE.Object3D(),truck=new THREE.Object3D(),rig=new THREE.Group(),camera=new THREE.PerspectiveCamera(55,1,.08,100);root.position.set(3,0,-2);scene.add(root);root.add(vehicle,truck);vehicle.position.set(-20,0,5);truck.position.set(-19,0,0);vehicle.rotation.y=Math.PI;rig.add(camera);scene.add(rig);scene.updateMatrixWorld(true);
 const actors=new Map([['vehicle',vehicle],['truck',truck]]),manifest={practiceId:'CEDI-01',roomId:'hall',vehicleIds:['vehicle'],aliases:[{alias:'E01',objectId:'truck'}],receiving:{truckId:'truck'}};
 let reset=0,lookReset=0;const ctx={camera,cameraRig:rig,vrMode:false,resetCollisionPose(){reset++;},desktopLook:{reset(){lookReset++;}}},editor={ctx,active:false,roomId:'hall',document:{studio:{moduleData:{'sector.logistics-industrial':{levels:[manifest]}}},getObject:id=>actors.get(id)}};
 const host=new Host({editor,client:{}});return{host,ctx,editor,manifest,actors,vehicle,truck,rig,camera,resets:()=>[reset,lookReset]};
}
const pose=object=>({position:object.position.toArray(),quaternion:object.quaternion.toArray(),scale:object.scale.toArray()});
test('receiving opens the actual viewer beside its forklift and looks at the patio without moving equipment',()=>{
 const f=fixture(),before=[pose(f.vehicle),pose(f.truck)],vehicle=f.vehicle.getWorldPosition(new THREE.Vector3()),truck=f.truck.getWorldPosition(new THREE.Vector3());
 assert.equal(f.host.frameInitialView(),true);assert.deepEqual(f.rig.position.toArray(),[vehicle.x-4.5,0,vehicle.z+3]);assert(5.2015+3<=9-.3,'The prepared patio keeps the initial walking view at least 0.3 m inside its floor.');assert.deepEqual(f.camera.position.toArray(),[0,1.65,0]);assert.deepEqual(f.rig.quaternion.toArray(),[0,0,0,1]);
 const target=new THREE.Vector3((vehicle.x+truck.x)/2,1.3,(vehicle.z+truck.z)/2),direction=target.sub(f.camera.getWorldPosition(new THREE.Vector3())).normalize();assert(f.camera.getWorldDirection(new THREE.Vector3()).dot(direction)>.99999);
 assert.deepEqual([pose(f.vehicle),pose(f.truck)],before);assert.deepEqual(f.resets(),[1,1]);
});
test('tracked XR poses and active editing retain their camera positions',()=>{
 const f=fixture(),before=[pose(f.rig),pose(f.camera),pose(f.vehicle),pose(f.truck)];f.ctx.vrMode=true;assert.equal(f.host.frameInitialView(),false);f.ctx.vrMode=false;f.editor.active=true;assert.equal(f.host.frameInitialView(),false);assert.deepEqual([pose(f.rig),pose(f.camera),pose(f.vehicle),pose(f.truck)],before);assert.deepEqual(f.resets(),[0,0]);
});
test('other practices, absent actors and headless contexts keep their established view',()=>{
 const f=fixture(),before=[pose(f.rig),pose(f.camera)];f.manifest.practiceId='SF-03';assert.equal(f.host.frameInitialView(),false);f.manifest.practiceId='CEDI-01';f.actors.delete('truck');assert.equal(f.host.frameInitialView(),false);f.editor.ctx={};assert.equal(f.host.frameInitialView(),false);assert.deepEqual([pose(f.rig),pose(f.camera)],before);assert.deepEqual(f.resets(),[0,0]);
});

test('a completed facility starts other practices at a free walking pose in its own world frame',()=>{
 const f=fixture(),root=f.vehicle.parent,before=[pose(f.vehicle),pose(f.truck)],probes=[];
 root.rotation.y=.3;root.position.y=.15;root.updateWorldMatrix(true,true);
 f.manifest.practiceId='SF-03';f.manifest.facility={bounds:{minX:-16,maxX:16,minZ:-12,maxZ:12}};f.editor.document.getRoot=()=>root;
 f.ctx.collisionWorld={canOccupyCapsule(point){probes.push(point.clone());return probes.length>1;}};
 assert.equal(f.host.frameInitialView(),true);assert.equal(probes.length,2,'An occupied first view cannot trap the user inside a machine.');
 const eye=f.camera.getWorldPosition(new THREE.Vector3());assert(eye.distanceTo(root.localToWorld(new THREE.Vector3(-14,1.65,10)))<1e-7);
 const target=root.localToWorld(new THREE.Vector3(0,1.3,0));assert(f.camera.getWorldDirection(new THREE.Vector3()).dot(target.sub(eye).normalize())>.99999);
 assert.deepEqual([pose(f.vehicle),pose(f.truck)],before);assert.deepEqual(f.resets(),[1,1]);
 f.ctx.collisionWorld.canOccupyCapsule=()=>false;const old=pose(f.rig);assert.equal(f.host.frameInitialView(),false);assert.deepEqual(pose(f.rig),old);
});

test('all five CEDI stages use the shared pedestrian entry and look at reception in the facility world frame',()=>{
 for(let level=1;level<=5;level++){
  const f=fixture(),root=f.vehicle.parent,before=[pose(f.vehicle),pose(f.truck)];root.rotation.y=.4;root.position.y=.12;root.updateWorldMatrix(true,true);f.editor.document.getRoot=()=>root;f.manifest.practiceId='CEDI-0'+level;f.manifest.facility={bounds:{minX:-32,maxX:32,minZ:-22,maxZ:22},initialView:{eye:[-27,1.65,16],target:[-18,1,9]}};let probed;f.ctx.collisionWorld={canOccupyCapsule(point){probed=point.clone();return true;}};
  assert.equal(f.host.frameInitialView(),true);const expected=root.localToWorld(new THREE.Vector3(-27,1.65,16)),eye=f.camera.getWorldPosition(new THREE.Vector3()),target=root.localToWorld(new THREE.Vector3(-18,1,9));assert(eye.distanceTo(expected)<1e-7);assert(probed.distanceTo(expected)<1e-7);assert(f.camera.getWorldDirection(new THREE.Vector3()).dot(target.sub(eye).normalize())>.99999);assert.deepEqual([pose(f.vehicle),pose(f.truck)],before);assert.deepEqual(f.resets(),[1,1]);
 }
});

test('a blocked shared CEDI entry falls back only to a physically free walking position and never alters XR',()=>{
 const f=fixture(),root=f.vehicle.parent;f.editor.document.getRoot=()=>root;f.manifest.facility={bounds:{minX:-32,maxX:32,minZ:-22,maxZ:22},initialView:{eye:[-27,1.65,16],target:[-18,1,9]}};let count=0;f.ctx.collisionWorld={canOccupyCapsule(){return ++count===3;}};assert(f.host.frameInitialView());assert.equal(count,3);f.ctx.vrMode=true;const before=[pose(f.rig),pose(f.camera)];assert.equal(f.host.frameInitialView(),false);assert.deepEqual([pose(f.rig),pose(f.camera)],before);
 f.ctx.vrMode=false;f.ctx.collisionWorld.canOccupyCapsule=()=>false;assert.equal(f.host.frameInitialView(),false);assert.deepEqual([pose(f.rig),pose(f.camera)],before);
});

test('the CEDI guide keeps ABC reference inventory separate from physical stock and renders untrusted labels as text',()=>{
 function element(tag){return{tagName:tag.toUpperCase(),children:[],text:'',appendChild(child){this.children.push(child);return child;},set textContent(value){this.text=String(value);this.children=[];},get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}};}
 const WithDocument=new Function('document',source+'\nreturn PracticeCampaignHost;')({createElement:element}),host=new WithDocument({editor:{},client:{}}),parent=element('div'),manifest={operatingData:{summary:{inboundBoxes:48,inventoryBoxes:24,requestedBoxes:12},data:{products:[{sku:'SKU-A',abc:'A',handling:'fragile'}]}},cediContext:{inventory:[{sku:'SKU-A',quantity:8,locationCode:'A01-R01-B01'},{sku:'<script>inert</script>',quantity:4,abc:'C',locationCode:'A01-R01-B02'}]}};const before=JSON.stringify(manifest),section=host.renderCediContext(parent,manifest),all=node=>[node,...node.children.flatMap(all)];assert.match(section.textContent,/no se suman al stock operativo/i);assert.match(section.textContent,/clasificación ABC/);assert.match(section.textContent,/48 cajas de ingreso/);assert.match(section.textContent,/Frágil/);assert(all(section).some(node=>node.tagName==='TD'&&node.textContent==='<script>inert</script>'));assert(!all(section).some(node=>node.tagName==='SCRIPT'));assert.equal(JSON.stringify(manifest),before);
});
