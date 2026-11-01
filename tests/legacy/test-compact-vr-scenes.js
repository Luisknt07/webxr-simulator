const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three'),schema=require('../../modules/logistica-industrial/contracts/behaviors');
const fixtureCode=fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-compact-vr-scenes.js"),'test-conveyor-mechanisms.js')),'utf8');
const {setup}=new Function('require','__dirname',fixtureCode.slice(0,fixtureCode.indexOf('async function run()'))+'\nreturn {setup};')(require,__dirname);
const VehicleRuntime=require('../support/load-vehicle-runtime')(THREE);
const {validateDocument}=require('../../apps/api/server/validation');
async function run(){const selected=process.argv.slice(2).filter(value=>!value.startsWith('--')),publicDemo=process.argv.includes('--public-demo');for(const id of selected.length?selected:['vr-robot-dispatch','vr-robot-transfer','vr-robot-turn']){
 const f=setup(),study=require('../support/load-study-scenes')(THREE,schema,f.document.constructor);
 study.studySceneBase(f.document,'hall');const built=study.buildStudyScene(f.document,'hall',publicDemo&&id==='vr-robot-dispatch'?'vr-robot-transfer':id,{scene:f.scene,continuous:true,publicDemo});
 const config=o=>f.document.getBehaviors(o).find(c=>['robot','vehicle','conveyor','source','palletQueue'].includes(c.type));
 const actors=f.document.getObjects('hall').filter(o=>config(o));
 assert.equal(actors.filter(o=>config(o).type==='robot').length,1);assert.equal(actors.filter(o=>config(o).type==='vehicle').length,1);assert.equal(built.conveyors.length,id==='vr-robot-dispatch'&&!publicDemo?1:2);
 if(publicDemo){assert.equal(config(built.vehicle).variant,'forklift-electric-4w');assert.equal(config(built.vehicle).visualModel,'reference-pilot');}
 assert.equal(config(built.source).totalLimit,8,'Even continuous:true must retain eight individual cartons for two finite physical pallets.');assert.equal(config(built.source).loadMode,'individual');assert.equal(config(built.source).capacity,2);assert(built.conveyors.every(o=>config(o).maxPackages===1));
 assert.equal(f.document.studio.entities.filter(e=>e.type==='pointLight').length,0);assert(built.objects.length<=24,'Keep equipment plus the complete industrial shell bounded, independently of registered control children.');
 assert.equal(config(built.vehicle).sourceId,built.pickup.userData.editorId);assert.equal(config(built.vehicle).outputId,built.destination.userData.editorId);assert.equal(config(built.robot).sourceId,built.source.userData.editorId);assert.equal(config(built.robot).outputId,built.palletizer.userData.editorId);assert.equal(config(built.palletizer).outputId,built.conveyors[0].userData.editorId);assert.equal(config(built.palletizer).palletizeLimit,2);
 validateDocument(await f.document.serialize(),()=>{throw Error('No external imports');});
 f.runtime.vehicleRuntime=new VehicleRuntime(f.runtime);f.scene.updateMatrixWorld(true);f.runtime.start('hall');
 const robot=f.runtime.records.get(built.robot.userData.editorId).components.robot;
 const last=f.runtime.records.get(built.pickup.userData.editorId).components.conveyor;
 for(let t=0;t<120*60;t++){f.scene.updateMatrixWorld(true);f.runtime.execute(1/60);if(last.packages.length&&last.actualSpeed===0)break;}
 assert.equal(robot.fault,'',id+': robot must not fault.');assert(last.packages.length,id+': real pallet must reach pickup belt.');assert.equal(last.actualSpeed,0,'Output must stop before manual pickup.');
 const product=last.packages[0].product,metadata=f.runtime.productMetadata(product);
 assert.equal(metadata.units,4);assert.equal(metadata.loadMode,'pallet');assert.equal(metadata.mass,33);assert(f.runtime.vehicleRuntime.productPockets(product));assert.equal(robot.deliveredUnits>=4,true);
 const vehicleRecord=f.runtime.records.get(built.vehicle.userData.editorId),v=vehicleRecord.components.vehicle,api=f.runtime.vehicleRuntime,parking=vehicleRecord.object.position.clone();
 const direction=new THREE.Vector3(0,0,1).applyQuaternion(vehicleRecord.object.quaternion),yaw=Math.atan2(direction.x,direction.z),dock=api.pickupDock(vehicleRecord,{yaw,targetId:built.pickup.userData.editorId},product);assert(dock);
 assert(api.applyPose(vehicleRecord,{...v.pose,lift:dock.toolY-v.config.forkBaseHeight},true),'Forks must reach the actual pallet openings.');api.command(vehicleRecord,'parkingBrake',false);
 const tick=input=>{api.setInput(vehicleRecord,input);f.scene.updateMatrixWorld(true);f.runtime.execute(1/60);};
 let approach=0;while(dock.position.clone().sub(vehicleRecord.object.position).dot(direction)>.015&&approach++<60*40)tick({throttle:.08});
 for(let i=0;i<90;i++)tick({brake:1});
 const docking=api.getDockingState(vehicleRecord);assert(docking.ready,id+': '+docking.reason+' '+JSON.stringify({position:vehicleRecord.object.position.toArray(),dock:dock.position.toArray(),blocked:v.blocked,warning:v.warning,metrics:api.dockingMetrics(vehicleRecord,product),pockets:api.productPockets(product),product:product.object.getWorldPosition(new THREE.Vector3()).toArray(),vehicle:{length:v.config.length,toolY:dock.toolY,lift:v.pose.lift}}));
 const entry=product.sourceEntry;assert(api.pickup(vehicleRecord,product),v.warning);assert.equal(v.entry,entry);assert.equal(last.packages.length,0);assert.equal(api.runtime.productMetadata(product).units,4);assert.equal(api.runtime.productMetadata(product).mass,33);
 const until=(condition,input,seconds=40)=>{let i=0;while(!condition()&&i++<60*seconds)tick(input);assert(condition(),id+': manoeuvre timeout '+JSON.stringify({position:vehicleRecord.object.position.toArray(),blocked:v.blocked,warning:v.warning}));};
 for(let i=0;i<45;i++)tick({brake:1,lift:1});
 until(()=>vehicleRecord.object.position.clone().sub(parking).dot(direction)<=.005,{throttle:-.1});for(let i=0;i<90;i++)tick({brake:1});
 const target=api.missionDestination(vehicleRecord,{targetId:built.destination.userData.editorId});assert(target);const drop=api.dropDock(vehicleRecord,{},target),lateral=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
 const currentYaw=()=>{const d=vehicleRecord.object.getWorldDirection(new THREE.Vector3());return Math.atan2(d.x,d.z);};
 const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
 const quarter=steer=>{const initial=currentYaw(),sign=-Math.sign(steer);for(let i=0;i<120;i++)tick({brake:1,steer});until(()=>sign*angle(currentYaw(),initial)>=Math.PI/2-.006,{throttle:.08,steer});for(let i=0;i<90;i++)tick({brake:1,steer});for(let i=0;i<120;i++)tick({brake:1});assert(!v.blocked,'Turning aisle must stay clear.');};
 quarter(-1);const radius=v.config.wheelbase/Math.tan(v.config.steerLimit),beforeSecondTurn=drop.position.dot(lateral)-radius-v.config.wheelbase/2;
 until(()=>vehicleRecord.object.position.dot(lateral)>=beforeSecondTurn-.006,{throttle:.08},90);for(let i=0;i<90;i++)tick({brake:1});quarter(1);
 const along=()=>drop.position.clone().sub(vehicleRecord.object.position).dot(direction),sign=along()>0?1:-1;
 assert(Math.abs(angle(drop.yaw,yaw))<.01,'Delivery bays must match the output pallet orientation, including the turntable cell.');
 until(()=>sign*along()<=.006,{throttle:sign*.08},90);for(let i=0;i<90;i++)tick({brake:1});
 until(()=>api.releasePlan(vehicleRecord).ready,{brake:1,lift:-1},15);assert.equal(api.releasePlan(vehicleRecord).kind,'stock','The pallet must enter the marked stock bay, rather than merely rest on the floor.');assert(api.release(vehicleRecord),v.warning);
 const stock=f.runtime.records.get(built.destination.userData.editorId).components.palletQueue;assert(stock.queue.includes(entry));assert.equal(stock.receivedUnits,4);assert.equal(entry.product.object,product.object);assert.equal(f.runtime.productMetadata(product).mass,33);
 console.log(JSON.stringify({id,mainObjects:built.objects.length,belts:built.conveyors.length,sourceLimit:8,palletLimit:2,realForkPickup:true,realDrivenDelivery:true,samePalletEntry:true,units:4,mass:33}));
 assert(f.runtime.products.size<=6,'The finite VR batch contains at most two pallet bodies plus the bounded in-progress individual cartons.');
 f.runtime.setVariable(built.pickup.userData.editorId,'running',true); // operator restarts only after the forks have left the pickup zone
 for(let t=0;t<120*60;t++){f.scene.updateMatrixWorld(true);f.runtime.execute(1/60);if(last.packages.length&&last.actualSpeed===0&&robot.completed===8)break;}
 assert.equal(robot.completed,8,'Both pallets require eight genuine single-carton robot cycles.');assert.equal(last.packages.length,1);assert.equal(last.actualSpeed,0);
 const second=last.packages[0].product.sourceEntry;assert.notEqual(second.id,entry.id);assert.equal(second.units,4);assert.equal(f.runtime.productMetadata(second.product).mass,33);
 assert.equal(new Set(entry.members.concat(second.members).map(member=>member.id)).size,8,'Every carton belongs to exactly one of the two physical pallet identities.');
 assert.equal(f.runtime.records.get(built.palletizer.userData.editorId).components.palletQueue.assembly.created,2);assert.equal(f.runtime.records.get(built.source.userData.editorId).components.source.generatedUnits,8);
 f.runtime.stop();
 const geometries=new Set(),materials=new Set();f.scene.traverse(n=>{if(n.geometry)geometries.add(n.geometry);(Array.isArray(n.material)?n.material:[n.material]).filter(Boolean).forEach(m=>materials.add(m));});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
 }console.log('Compact VR: selected bounded integrated cells with physical pallet custody, robot delivery, belt stop, declared fork pockets, eight-unit cap and valid saved documents passed.');}
run().catch(e=>{console.error(e);process.exitCode=1;});
