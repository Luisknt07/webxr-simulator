'use strict';
// Real browser-input adapter + deterministic vehicle runtime. Only the
// browser's device enumeration and the existing DOM/tracking fixtures are fake.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'test-vehicle-driving.js'),'utf8');
const {setup,key,pad,axis}=new Function('require','__dirname',source.slice(0,source.indexOf('\nconst desktop = setup();'))+'\nreturn {setup,key,pad,axis};')(require,__dirname);
const {Driving}=require('../support/load-vehicle-driving.js')(require('three'));
const near=(actual,expected,epsilon=1e-6)=>assert(Math.abs(actual-expected)<epsilon,actual+' != '+expected);
const device=(overrides={})=>({id:'DualSense Wireless Controller',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0})),...overrides});
const button=(controller,index,value)=>{controller.buttons[index]={pressed:value>.5,value};};
function fixture({vr=false,devices=[]}={}){
 const f=setup(vr);f.driving.dispose();let connected=devices;
 f.navigator={getGamepads:()=>connected};f.driving=new Driving(f.ctx,f.runtime,{document:f.dom,window:f.window,navigator:f.navigator,inputPanelClass:false,notify:message=>f.notices.push(message)});
 assert(f.driving.externalInput,'The real external input adapter must be installed.');f.driving.externalInput.configure({enabled:true});
 f.setDevices=value=>{connected=value;};assert(f.driving.mount(f.record.id));f.driving.docking.snapshot=null;return f;
}
function tick(f){f.driving.beforeStep();return f.v.input;}
function neutral(f,controller){controller.axes.fill(0);controller.buttons.forEach((_,index)=>button(controller,index,0));tick(f);tick(f);}
function frames(f,count,check=()=>{}){for(let frame=0;frame<count;frame++){f.scene.updateMatrixWorld(true);if(f.ctx.collisionWorld)f.ctx.collisionWorld.beginFrame();tick(f);check(frame);f.runtime.time+=1/60;f.api.step(1/60);if(f.ctx.collisionWorld)f.ctx.collisionWorld.endFrame();}}
function close(f){f.driving.dispose();f.runtime.stop();}

// A recognized standard pad uses the real normalization path, clamps invalid
// channels, and combines with the keyboard without summing beyond full travel.
const standard=device(),f=fixture({devices:[standard]});neutral(f,standard);
assert(f.driving.externalInput.getState().armed);
standard.axes=[.6,-.8,.5,-.7];button(standard,6,.4);tick(f);
assert(f.v.input.throttle>0&&f.v.input.throttle<=1);assert(f.v.input.steer>0&&f.v.input.steer<=1);assert(f.v.input.lift>0&&f.v.input.tilt>0);assert(f.v.input.brake>.3&&f.v.input.brake<.5,'An intermediate analog trigger must retain intermediate brake authority after its deadzone.');
key(f,'KeyW');key(f,'KeyD');key(f,'Space');tick(f);near(f.v.input.throttle,1);near(f.v.input.steer,1);near(f.v.input.brake,1);
for(const code of ['KeyW','KeyD','Space'])key(f,code,false);
standard.axes=[NaN,Infinity,-Infinity,NaN];button(standard,6,NaN);tick(f);for(const value of Object.values(f.v.input))assert(Number.isFinite(value));
neutral(f,standard);

// Opening any interactive overlay cancels drive/hydraulics. Closing it while a
// stick is held must wait for neutral rather than replaying the stale input.
standard.axes[1]=-1;tick(f);assert(f.v.input.throttle>0);
for(const flag of ['studioMenuOpen','voicePanelOpen','assistantPanelOpen','externalDevicePanelOpen']){
 f.ctx[flag]=true;tick(f);near(f.v.input.throttle,0);near(f.v.input.lift,0);near(f.v.input.brake,1);
 f.ctx[flag]=false;tick(f);near(f.v.input.throttle,0);near(f.v.input.brake,1);neutral(f,standard);standard.axes[1]=-1;tick(f);assert(f.v.input.throttle>0,flag+' should permit fresh input after neutral');
}
f.ctx.externalDevicePanelOpen=true;tick(f);f.ctx.externalDevicePanelOpen=false;tick(f);near(f.v.input.brake,1);key(f,'KeyW');tick(f);near(f.v.input.throttle,1);near(f.v.input.brake,0);assert.equal(f.driving.externalInput.getState().armed,false,'A fresh keyboard command does not rearm the stale held pad.');key(f,'KeyW',false);tick(f);near(f.v.input.throttle,0);near(f.v.input.brake,1);neutral(f,standard);standard.axes[1]=-1;tick(f);

// Disconnect, blur and hidden documents brake immediately and require fresh
// neutral input after reconnection/focus; keyboard remains usable without a pad.
f.setDevices([]);tick(f);near(f.v.input.throttle,0);near(f.v.input.brake,1);
f.setDevices([standard]);tick(f);near(f.v.input.throttle,0);neutral(f,standard);standard.axes[1]=-1;tick(f);assert(f.v.input.throttle>0);
f.window.fire('blur');tick(f);near(f.v.input.throttle,0);near(f.v.input.brake,1);f.window.fire('focus');tick(f);near(f.v.input.throttle,0);neutral(f,standard);
standard.axes[1]=-1;tick(f);f.dom.hidden=true;tick(f);near(f.v.input.throttle,0);near(f.v.input.brake,1);f.dom.hidden=false;tick(f);near(f.v.input.throttle,0);neutral(f,standard);
f.setDevices([]);tick(f);key(f,'KeyW');tick(f);near(f.v.input.throttle,1);key(f,'KeyW',false);
close(f);

// A physical disconnection while moving keeps braking over actual simulation
// frames rather than cancelling throttle for just one frame and then coasting.
const movingPad=device(),moving=fixture({devices:[movingPad]});neutral(moving,movingPad);movingPad.axes[1]=-1;frames(moving,60);assert(moving.v.actualSpeed>.2);
moving.setDevices([]);frames(moving,90,()=>{near(moving.v.input.throttle,0);near(moving.v.input.brake,1);});near(moving.v.actualSpeed,0);const stoppedPosition=moving.object.position.clone();
moving.setDevices([movingPad]);frames(moving,20,()=>{near(moving.v.input.throttle,0);near(moving.v.input.brake,1);});assert(moving.object.position.equals(stoppedPosition));neutral(moving,movingPad);near(moving.v.input.brake,0);movingPad.axes[1]=-1;frames(moving,20);assert(moving.v.actualSpeed>0);
moving.ctx.externalDevicePanelOpen=true;frames(moving,90,()=>{near(moving.v.input.brake,1);near(moving.v.input.throttle,0);});near(moving.v.actualSpeed,0);moving.ctx.externalDevicePanelOpen=false;frames(moving,20,()=>{near(moving.v.input.brake,1);near(moving.v.input.throttle,0);});neutral(moving,movingPad);near(moving.v.input.brake,0);close(moving);

const deniedPad=device(),denied=fixture({devices:[deniedPad]});neutral(denied,deniedPad);deniedPad.axes[1]=-1;tick(denied);const enumerate=denied.navigator.getGamepads;denied.navigator.getGamepads=()=>{throw Object.assign(Error('Synthetic gamepad Permissions Policy denial'),{name:'SecurityError'});};tick(denied);tick(denied);near(denied.v.input.throttle,0);near(denied.v.input.brake,1);denied.navigator.getGamepads=enumerate;neutral(denied,deniedPad);assert(denied.driving.externalInput.getState().armed);close(denied);

// Raw wheel axes do not acquire driving authority from an ID guess. A selected,
// calibrated local profile supplies steering and independent pedal channels.
const wheel=device({id:'USB Racing Wheel and Pedals',mapping:'',axes:[0,1,1],buttons:Array.from({length:10},()=>({pressed:false,value:0}))}),w=fixture({devices:[wheel]});tick(w);tick(w);near(w.v.input.throttle,0);
const wheelKey=w.driving.externalInput.getState().devices[0].key;w.driving.externalInput.updateProfile(wheelKey,{kind:'wheel',axes:{steer:{index:0,mode:'bipolar',min:-1,max:1,rest:0,deadzone:.05},throttle:{index:1,mode:'pedal',min:-1,max:1,rest:1,full:-1,deadzone:.02},brake:{index:2,mode:'pedal',min:-1,max:1,rest:1,full:-1,deadzone:.02}}});w.driving.externalInput.configure({enabled:true,deviceKeys:[wheelKey]});tick(w);tick(w);assert(w.driving.externalInput.getState().armed);
wheel.axes=[.5,-1,0];tick(w);near(w.v.input.throttle,1);assert(w.v.input.steer>0&&w.v.input.steer<1);assert(w.v.input.brake>0&&w.v.input.brake<1);
wheel.axes=[0,1,1];tick(w);w.setDevices([]);tick(w);near(w.v.input.brake,1);near(w.v.input.throttle,0);close(w);

// External devices cannot compete with tracked XR controls or alter head pose.
const external=device(),xr=fixture({vr:true,devices:[external]}),left=pad('left'),right=pad('right');xr.ctx.raycontrol.controllers=[left,right];xr.driving.xrControlMode='controllers';tick(xr);
external.axes[1]=-1;axis(left,.5,-1);axis(right,0,0);const pose=[xr.camera.position.toArray(),xr.camera.quaternion.toArray()];tick(xr);assert(xr.v.input.throttle>0);assert(xr.driving.externalInput.getState().armed===false);assert.deepEqual([xr.camera.position.toArray(),xr.camera.quaternion.toArray()],pose);
axis(left,0,0);tick(xr);near(xr.v.input.throttle,0);xr.ctx.vrMode=false;tick(xr);near(xr.v.input.throttle,0);neutral(xr,external);external.axes[1]=-1;tick(xr);assert(xr.v.input.throttle>0);close(xr);

// Device buttons issue edges, never repeated commands on every frame. Power
// buttons can recover a stopped vehicle without forwarding held analog axes.
const commandsPad=device(),commands=fixture({devices:[commandsPad]});neutral(commands,commandsPad);button(commandsPad,4,1);tick(commands);tick(commands);assert.equal(commands.commands.filter(name=>name==='parkingBrake').length,1);button(commandsPad,4,0);tick(commands);button(commandsPad,4,1);tick(commands);assert.equal(commands.commands.filter(name=>name==='parkingBrake').length,2);neutral(commands,commandsPad);
commands.driving.command('powerOff');tick(commands);near(commands.v.input.throttle,0);neutral(commands,commandsPad);button(commandsPad,9,1);tick(commands);assert(commands.v.powered);button(commandsPad,9,0);tick(commands);button(commandsPad,5,1);tick(commands);assert(commands.v.running);button(commandsPad,5,0);neutral(commands,commandsPad);commandsPad.axes[1]=-1;tick(commands);assert(commands.v.input.throttle>0);
const adapter=commands.driving.externalInput;close(commands);assert.equal(adapter.getState().active,false);
console.log('External vehicle input: standard pads, calibrated wheel/pedals, keyboard merge, UI/focus rearm, disconnect brake, XR isolation, command edges and stopped-vehicle recovery passed.');
