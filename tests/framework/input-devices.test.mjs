import test from 'node:test';
import assert from 'node:assert/strict';
import GamepadInput,{GAMEPAD_ACTIONS,STANDARD_BINDINGS} from '../../packages/input-devices/GamepadInput.js';
const pad=(id='Xbox Wireless Controller',mapping='standard',axes=[0,0,0,0],count=17)=>({id,mapping,connected:true,axes:axes.slice(),buttons:Array.from({length:count},()=>({value:0,pressed:false}))});
function fixture(t,pads=[pad()],options={}){let time=0;const commands=[],navigator={getGamepads:()=>pads},input=new GamepadInput({navigator,now:()=>time,onCommand:(action,source)=>commands.push({action,source}),...options}),context={active:true,blocked:false,xr:false,selectedVehicleId:'truck-a'};const poll=(patch={})=>{time+=16;return input.poll({...context,...patch});};t.after(()=>input.dispose());return {input,pads,commands,context,poll,navigator,advance:ms=>time+=ms};}
const setButton=(p,index,value)=>{p.buttons[index]={value,pressed:value>.7};};
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),values};};

test('standard PS/Xbox inputs require neutral on connection and command buttons fire only on genuine hysteretic edges',t=>{
 const p=pad('Sony DualSense Wireless Controller'),f=fixture(t,[p]);p.axes[1]=-1;setButton(p,0,1);let out=f.poll();assert.equal(f.input.getState().armed,false);assert.equal(out.brake,1);assert.equal(out.throttle,0);assert.deepEqual(f.commands,[]);
 p.axes[1]=0;setButton(p,0,0);out=f.poll();assert.equal(f.input.getState().armed,true);assert.equal(out.brake,0);
 p.axes=[.6,-.8,.4,-.5];setButton(p,6,.6);out=f.poll();assert(out.throttle>.7&&out.steer>.4&&out.lift>.3&&out.tilt>.2&&out.brake>.5);assert(Object.values(out).every(Number.isFinite));
 setButton(p,0,.7);f.poll();for(let i=0;i<20;i++)f.poll();assert.deepEqual(f.commands.map(row=>row.action),['pickup']);setButton(p,0,.5);f.poll();assert.equal(f.commands.length,1);setButton(p,0,.39);f.poll();setButton(p,0,.8);f.poll();assert.equal(f.commands.length,2);
 assert.equal(f.input.getState().bindings.pickup,'✕');assert.equal(f.input.getState().bindings.release,'○');assert.equal(f.input.getState().bindings.driveForward,'L ↑');assert.equal(f.input.getState().bindings.brake,'L2');assert.equal(STANDARD_BINDINGS.buttons.pickup,0);assert(GAMEPAD_ACTIONS.some(row=>row.action==='emergency'));
});

test('unknown wheel axes are never guessed; explicitly calibrated wheel plus separate pedals support inverted hardware and reverse',t=>{
 const wheel=pad('Logitech G29 Racing Wheel','standard',[0],8),pedals=pad('USB Pedals','',[-1,1],2),f=fixture(t,[wheel,pedals]);f.poll();const [w,p]=f.input.getState().devices;assert.equal(w.standard,false);assert.equal(w.mapped,false);assert.equal(f.input.getState().armed,false);
 f.input.configure({deviceKeys:[w.key,p.key]});f.poll();assert.equal(f.input.getState().status,'unmapped');f.input.updateProfile(w.key,{kind:'wheel'});f.poll();assert.equal(f.input.getState().status,'unmapped','A type label alone is not a usable calibration.');
 f.input.updateProfile(w.key,{kind:'wheel',axes:{steer:{index:0,mode:'bipolar',min:-1,rest:0,max:1,invert:true,deadzone:.1}},reverseButton:3,buttons:{parkingBrake:1}});
 f.input.updateProfile(p.key,{kind:'pedals',axes:{throttle:{index:0,mode:'pedal',rest:-1,full:1,deadzone:.05},brake:{index:1,mode:'pedal',rest:1,full:-1,deadzone:.05}}});
 assert.equal(f.poll().brake,0);assert.equal(f.input.getState().armed,true);wheel.axes[0]=.6;pedals.axes[0]=.5;let out=f.poll();assert(out.steer<-.5&&out.throttle>.7);setButton(wheel,3,1);out=f.poll();assert(out.throttle<-.7,'A wheel button reverses the accelerator on its separate selected pedal device.');pedals.axes[1]=-.5;assert(f.poll().brake>.7);
 assert.equal(f.input.getState().bindings.steerLeft,'Volante');assert.equal(f.input.getState().bindings.driveReverse,'B4 + pedal');
 f.input.updateProfile(w.key,{reverseButton:null});assert.equal(f.input.getState().profiles[w.key].reverseButton,undefined);assert.equal(f.poll().throttle,0,'Editing calibration requires a new neutral sample.');
});

test('context changes, UI blocking, blur, long polling gaps and disconnect require neutral before motion or commands resume',t=>{
 const p=pad(),f=fixture(t,[p]);f.poll();p.axes[1]=-.8;assert(f.poll().throttle>0);f.poll({blocked:true});assert.equal(f.input.getState().status,'blocked');assert.equal(f.poll().throttle,0);p.axes[1]=0;f.poll();assert(f.input.getState().armed);
 p.axes[1]=-.8;f.input.reset('blur');assert.equal(f.poll().throttle,0);p.axes[1]=0;f.poll();p.axes[1]=-.7;f.context.selectedVehicleId='truck-b';assert.equal(f.poll().brake,1);p.axes[1]=0;f.poll();assert(f.input.getState().armed);
 p.axes[1]=-.7;f.advance(2000);assert.equal(f.poll().throttle,0);p.axes[1]=0;f.poll();p.axes[1]=-.7;p.connected=false;assert.equal(f.poll().brake,1);p.connected=true;assert.equal(f.poll().throttle,0);p.axes[1]=0;assert.equal(f.poll().brake,0);
 setButton(p,0,1);f.poll({blocked:true});f.poll();assert.equal(f.commands.length,0);setButton(p,0,0);f.poll();setButton(p,0,1);f.poll();assert.deepEqual(f.commands.map(row=>row.action),['pickup']);
});

test('XR standard pads and explicitly excluded source IDs never become desktop input, and XR mode preserves its own control path',t=>{
 const p=pad(),xr=pad('Quest controller','xr-standard',[0,0,0,0]),f=fixture(t,[xr,p]);f.poll({excludedIds:[p.id]});assert.equal(f.input.getState().devices.length,0);assert.equal(f.input.getState().armed,false);f.poll();assert.equal(f.input.getState().devices.length,1);assert.equal(f.input.getState().devices[0].label,p.id);
 p.axes[1]=-1;assert.equal(f.poll({xr:true}).throttle,0);assert.equal(f.input.getState().status,'xr');assert.equal(f.poll().throttle,0);p.axes[1]=0;f.poll();assert(f.input.getState().armed);
});

test('calibration rejects malformed fields and degenerate ranges atomically, accepts finite zero, and combined pedals are explicit',t=>{
 const p=pad('Custom USB Wheel','',[0,0],5),f=fixture(t,[p]);f.poll();const key=f.input.getState().devices[0].key;assert.equal(f.input.captureCalibration(key,0),0);assert.throws(()=>f.input.captureCalibration(key,16));assert.throws(()=>f.input.captureCalibration(key,2));
 f.input.configure({deviceKeys:[key]});f.input.calibrate(key,'steer',{index:0,mode:'bipolar',min:-1,rest:0,max:1,invert:true,deadzone:.1});const before=f.input.getState().profiles;
 for(const mapping of [{index:0,mode:'bipolar',min:0,rest:0,max:1},{index:0,mode:'pedal',rest:1,full:1},{index:0,mode:'pedal',rest:0,full:NaN},{index:16,mode:'bipolar',min:-1,rest:0,max:1},{index:0,mode:'pedal',rest:-1,full:1,code:'alert(1)'}])assert.throws(()=>f.input.calibrate(key,'throttle',mapping));
 assert.deepEqual(f.input.getState().profiles,before);assert.throws(()=>f.input.updateProfile(key,{buttons:{eval:0}}));assert.throws(()=>f.input.updateProfile(key,{reverseButton:32}));assert.throws(()=>f.input.configure({deviceKeys:[key,key]}));
 f.input.updateProfile(key,{combinedPedals:{index:1,min:-1,rest:0,max:1,invert:true,deadzone:.1}});f.poll();p.axes[1]=-.8;assert(f.poll().throttle>.7);p.axes[1]=.8;assert(f.poll().brake>.7);assert.throws(()=>f.input.calibrate(key,'throttle',{index:1,mode:'pedal',rest:-1,full:1}));
});

test('first standard-pad customization keeps automatic axes, analog brake and unchanged PS labels',t=>{
 const p=pad('Sony DualShock 054c'),f=fixture(t,[p]);f.poll();const key=f.input.getState().devices[0].key;f.input.updateProfile(key,{buttons:{horn:7}});let state=f.input.getState();assert.equal(state.profiles[key].kind,'gamepad');assert.equal(state.profiles[key].axes.throttle.index,1);assert.equal(state.profiles[key].brakeButton,6);
 f.poll();p.axes[1]=-.8;setButton(p,6,.5);const out=f.poll();assert(out.throttle>.7&&out.brake>.4);assert.equal(f.input.getState().bindings.pickup,'✕');assert.equal(f.input.getState().bindings.horn,'B8');assert.equal(f.input.getState().bindings.brake,'L2');
 f.input.removeProfile(key);assert.equal(f.input.getState().profiles[key],undefined);
});

test('local persistence validates all profiles, survives denied storage, and contains only data',t=>{
 const storage=memory(),p=pad('Configured wheel','',[0],2),f=fixture(t,[p],{storage});f.poll();const key=f.input.getState().devices[0].key;f.input.configure({deviceKeys:[key]});f.input.calibrate(key,'steer',{index:0,mode:'bipolar',min:-1,rest:0,max:1});const restored=new GamepadInput({navigator:f.navigator,storage});t.after(()=>restored.dispose());restored.poll({active:true,selectedVehicleId:'copy'});assert.equal(restored.getState().profiles[key].axes.steer.index,0);assert.deepEqual(restored.getState().deviceKeys,[key]);
 const invalid=memory();invalid.setItem('smarttwin.input-devices.v1','{"version":1,"enabled":true,"deviceKeys":null,"profiles":{"__proto__":{"kind":"wheel"}}}');const rejected=new GamepadInput({storage:invalid});t.after(()=>rejected.dispose());assert.deepEqual(rejected.getState().profiles,{});
 const denied=new GamepadInput({storage:{getItem(){throw Error('denied');},setItem(){throw Error('full');}}});t.after(()=>denied.dispose());assert.doesNotThrow(()=>denied.configure({enabled:false}));assert.equal(denied.getState().enabled,false);
});

test('non-finite or missing hardware data fails neutral, safety commands win simultaneous edges, and dispose releases observers',t=>{
 const p=pad(),f=fixture(t,[p]);let notifications=0;const unsubscribe=f.input.subscribe(()=>notifications++);f.poll();setButton(p,0,1);setButton(p,11,1);f.poll();assert.deepEqual(f.commands.map(row=>row.action),['emergency']);f.poll();assert.equal(f.commands.length,1);
 p.axes[0]=NaN;assert.equal(f.poll().brake,1);assert.equal(f.input.getState().armed,false);p.axes[0]=0;setButton(p,0,0);setButton(p,11,0);f.poll();assert(f.input.getState().armed);const snapshot=f.input.getState();snapshot.devices[0].axes[0]=1;assert.equal(f.input.getState().devices[0].axes[0],0);
 f.navigator.getGamepads=()=>{throw Error('SecurityError');};assert.equal(f.poll().throttle,0);assert.equal(f.input.getState().armed,false);const before=f.commands.length;f.input.dispose();assert.equal(f.input.getState().status,'disposed');assert.equal(f.input.poll({active:true,selectedVehicleId:'truck'}).brake,1);assert.equal(f.commands.length,before);const after=notifications;f.input.reset('blur');assert.equal(notifications,after);unsubscribe();
});
