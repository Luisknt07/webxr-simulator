'use strict';
// Exercise the actual keyboard/touch/XR/cab adapter. Docking geometry is read
// once by the existing monitor; the fine-input path cannot poll physical plans.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const fixture=fs.readFileSync(path.join(__dirname,'test-vehicle-driving.js'),'utf8');
const {setup,key,nodes,pad,axis}=new Function('require','__dirname',fixture.slice(0,fixture.indexOf('\nconst desktop = setup();'))+'\nreturn {setup,key,nodes,pad,axis};')(require,__dirname);
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-9,actual+' != '+expected);
const raw=()=>({throttle:1,steer:-.8,brake:.7,lift:1,tilt:-1,reach:.6,sideShift:-.5,turret:.8});
const copy=value=>JSON.parse(JSON.stringify(value));
function close(f){f.driving.dispose();f.runtime.stop();}
const f=setup(false,true);assert(f.driving.mount(f.record.id));
const cached=f.api.getDockingState(f.record);assert(cached.geometry.target&&cached.geometry.pockets.length);
f.driving.docking.snapshot=cached;
const vehiclePosition=f.object.position.toArray(),vehicleQuaternion=f.object.quaternion.toArray(),headPosition=f.camera.position.toArray(),headQuaternion=f.camera.quaternion.toArray(),product=f.runtime.products.get(f.pallet),parent=product.object.parent,cache=JSON.stringify(cached);
const oldProbe=f.api.getDockingState,oldPickup=f.api.pickupPlan,oldRelease=f.api.releasePlan;let probes=0;
f.api.getDockingState=()=>{probes++;throw Error('Fine input must use the cached snapshot.');};
f.api.pickupPlan=f.api.releasePlan=()=>{throw Error('Fine input cannot poll geometry or attempt custody changes.');};
try{
 for(let i=0;i<100;i++){
  const input=raw();assert.equal(f.driving.applyFineControl(f.record,input),input);assert(f.driving.fineControlActive);
  near(input.throttle,.35);near(input.steer,-.8);near(input.brake,.7);near(input.lift,.3);near(input.tilt,-.3);near(input.reach,.18);near(input.sideShift,-.15);near(input.turret,.24);
 }
 assert.equal(probes,0);assert.equal(JSON.stringify(cached),cache);assert.deepEqual(f.object.position.toArray(),vehiclePosition);assert.deepEqual(f.object.quaternion.toArray(),vehicleQuaternion);assert.deepEqual(f.camera.position.toArray(),headPosition);assert.deepEqual(f.camera.quaternion.toArray(),headQuaternion);assert.equal(product.object.parent,parent);assert.equal(f.v.entry,null);
 const noFine=snapshot=>{f.driving.docking.snapshot=snapshot;const input=raw(),before=raw();f.driving.applyFineControl(f.record,input);assert.equal(f.driving.fineControlActive,false);assert.deepEqual(input,before);};
 const far=copy(cached);far.insertion.actualM=0;far.geometry.target.forEach(point=>{point[0]+=20;});noFine(far);
 noFine({...cached,geometry:{...cached.geometry,pockets:[]}});noFine({...cached,geometry:{...cached.geometry,pockets:[null]}});noFine({...cached,phase:'drop'});
 const malformed=copy(cached);malformed.geometry.target[0][0]=Infinity;noFine(malformed);
 const inserted=copy(far);inserted.insertion.actualM=.03;f.driving.docking.snapshot=inserted;f.driving.applyFineControl(f.record,raw());assert(f.driving.fineControlActive,'Measured real insertion keeps the aid active even if a cached centre is farther away.');
}finally{f.api.getDockingState=oldProbe;f.api.pickupPlan=oldPickup;f.api.releasePlan=oldRelease;}
// All keyboard axes are clamped before reduction; steering/brakes retain full
// authority. The existing HUD announces the mode without another control menu.
f.driving.docking.snapshot=cached;
for(const code of ['KeyW','KeyD','KeyQ','ArrowUp','KeyT','KeyX','KeyL','KeyO','Space'])key(f,code);
f.driving.beforeStep();near(f.v.input.throttle,.35);near(f.v.input.steer,1);near(f.v.input.brake,1);for(const code of ['lift','tilt','reach','sideShift','turret'])near(f.v.input[code],.3);
assert.equal(f.driving.hud.dataset.fineControl,'active');assert(f.driving.hint.textContent.includes('Maniobra fina · velocidad reducida'));
for(const code of ['KeyW','KeyD','KeyQ','ArrowUp','KeyT','KeyX','KeyL','KeyO','Space'])key(f,code,false);
const lower=nodes(f.driving.hud,element=>element.dataset.vehicleHold==='KeyE')[0];lower.fire('pointerdown',{pointerId:7});f.driving.beforeStep();near(f.v.input.lift,-.3);lower.fire('pointercancel',{pointerId:7});f.driving.beforeStep();near(f.v.input.lift,0);
// Cab inputs are reduced after their own physical control arbitration.
const apply=f.driving.cab.apply;f.driving.cab.apply=input=>{input.lift=.8;input.turret=-.6;};f.driving.beforeStep();near(f.v.input.lift,.24);near(f.v.input.turret,-.18);f.driving.cab.apply=apply;
// A carried pallet is never its own deposit target: normal transport remains
// available until a genuine receiver is close in the cached physical plan.
assert(f.api.pickup(f.record),f.v.warning);const drop=f.api.getDockingState(f.record);assert.equal(drop.phase,'drop');f.driving.docking.snapshot={...drop,destination:null};f.driving.applyFineControl(f.record,raw());assert.equal(f.driving.fineControlActive,false);
for(const [distance,expected]of [[4,false],[.61,false],[.6,true],[.2,true],[null,false]]){
 f.driving.docking.snapshot={...drop,destination:{id:'actual-receiver'},errors:{...drop.errors,lateralM:distance}};const input=raw();f.driving.applyFineControl(f.record,input);assert.equal(f.driving.fineControlActive,expected);near(input.throttle,expected?.35:1);
}
f.driving.docking.snapshot={...drop,destination:{id:'actual-receiver'},errors:{lateralM:.2}};
key(f,'KeyW');f.ctx.studioMenuOpen=true;f.driving.beforeStep();near(f.v.input.throttle,0);near(f.v.input.brake,1);assert.equal(f.driving.fineControlActive,false);f.ctx.studioMenuOpen=false;key(f,'KeyW',false);f.v.paused=true;f.driving.beforeStep();near(f.v.input.throttle,0);near(f.v.input.lift,0);assert.equal(f.driving.hud.dataset.fineControl,'off');close(f);
// The controller accessibility mode uses the same reduced output. Tracked
// headset pose and the wheel's steering range are never altered.
const vr=setup(true,true),left=pad('left'),right=pad('right');vr.ctx.raycontrol.controllers=[left,right];assert(vr.driving.mount(vr.record.id));vr.driving.xrControlMode='controllers';vr.driving.beforeStep();const pose=[vr.camera.position.toArray(),vr.camera.quaternion.toArray()];axis(left,1,-1);axis(right,1,-1);vr.driving.beforeStep();near(vr.v.input.throttle,.35);near(vr.v.input.steer,1);near(vr.v.input.lift,.3);near(vr.v.input.tilt,.3);assert.deepEqual([vr.camera.position.toArray(),vr.camera.quaternion.toArray()],pose);close(vr);
console.log('Fine vehicle input: real cached pocket proximity, isolated receiver approach, no geometry probes or pose/custody edits, keyboard/touch/cab/XR parity, full brakes/steering and safety rearm passed.');
