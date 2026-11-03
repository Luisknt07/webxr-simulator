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
