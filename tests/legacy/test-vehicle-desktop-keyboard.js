'use strict';
const assert=require('node:assert/strict');
const {setup,key}=require('./test-vehicle-driving.js');
const physics=require('./test-vehicle-runtime.js');

const f=setup();
try{
 f.driving.options.quickStartOnEntry=true;
 Object.assign(f.v,{powered:false,running:false,parkingBrake:true});
 key(f,'KeyF');key(f,'KeyF',false);
 assert.equal(f.driving.id,f.record.id);
 assert(f.v.powered&&f.v.running&&!f.v.parkingBrake,'The public F entry prepares the actual motor and parking brake.');
 const before=f.object.position.clone();key(f,'KeyW');
 for(let i=0;i<60;i++){f.driving.beforeStep();physics.step(f,1/60);}
 assert(f.object.position.distanceTo(before)>.03,'Trusted desktop input must advance the physical vehicle.');
 key(f,'KeyW',false);key(f,'Space');f.driving.beforeStep();assert.equal(f.v.input.brake,1);key(f,'Space',false);
 for(const [code,channel,value]of [['ArrowUp','throttle',1],['ArrowDown','throttle',-1],['ArrowLeft','steer',-1],['ArrowRight','steer',1]]){
  key(f,code);f.driving.beforeStep();assert.equal(f.v.input[channel],value,code);assert.equal(f.v.input.lift,0,'Driving arrows never actuate the hydraulics.');key(f,code,false);
 }
 key(f,'KeyW');key(f,'ArrowUp');f.driving.beforeStep();assert.equal(f.v.input.throttle,1);
 key(f,'ArrowUp',false);f.driving.beforeStep();assert.equal(f.v.input.throttle,1,'Releasing an alias cannot release the independently held W key.');
 key(f,'ArrowDown');f.driving.beforeStep();assert.equal(f.v.input.throttle,0,'Opposite driving requests cancel.');key(f,'KeyW',false);key(f,'ArrowDown',false);
 key(f,'KeyQ');f.driving.beforeStep();assert.equal(f.v.input.lift,1);assert.equal(f.v.input.throttle,0);key(f,'KeyQ',false);
 key(f,'KeyE');f.driving.beforeStep();assert.equal(f.v.input.lift,-1);key(f,'KeyE',false);
 for(const target of [{tagName:'INPUT'},{tagName:'TEXTAREA'},{tagName:'SELECT'},{isContentEditable:true},{getAttribute:name=>name==='role'?'tab':null}]){
  const event=key(f,'ArrowRight',true,{target});assert(!event.prevented,'Native editing and tab navigation keep their arrow keys.');f.driving.beforeStep();assert.equal(f.v.input.steer,0);key(f,'ArrowRight',false,{target});
 }
 key(f,'ArrowUp');f.window.fire('blur');f.driving.beforeStep();assert.equal(f.v.input.throttle,0);
 key(f,'ArrowUp',true,{repeat:true});f.driving.beforeStep();assert.equal(f.v.input.throttle,0,'Focus loss cannot replay a held accelerator.');key(f,'ArrowUp',false);
}finally{f.driving.dispose();f.runtime.stop();}

for(const quickStartOnEntry of [false,true]){
 const guarded=setup();try{
  guarded.driving.options.quickStartOnEntry=quickStartOnEntry;
  guarded.v.parkingBrake=true;guarded.v.emergency=quickStartOnEntry;
  key(guarded,'KeyF');key(guarded,'KeyF',false);
  assert.equal(guarded.v.parkingBrake,true,'Manual workspace entry and an active emergency retain their brake.');
  if(quickStartOnEntry)assert(guarded.v.emergency,'Prepared entry never rearms an emergency.');
 }finally{guarded.driving.dispose();guarded.runtime.stop();}
}
console.log('Desktop keyboard: F preparation, physical movement, independent arrows/WASD, hydraulic isolation, native focus and emergency guards passed.');
