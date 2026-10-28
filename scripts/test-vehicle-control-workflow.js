'use strict';
// Actual VehicleDriving DOM/key adapter, hydraulic input and cargo runtime.
// Reuses the central vehicle fixture; no renderer, server or live data needed.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const original = fs.readFileSync(path.join(__dirname, 'test-vehicle-driving.js'), 'utf8');
const {setup,key} = new Function('require', '__dirname', original.slice(0, original.indexOf('\nconst desktop = setup();')) + '\nreturn {setup,key};')(require, __dirname);
const runtime = require('./test-vehicle-runtime'), {getGeometryTree} = require('./load-geometry-acceleration')(THREE);
const CollisionWorld = new Function('THREE','getGeometryTree',fs.readFileSync(path.join(__dirname,'../src/lib/CollisionWorld.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default class CollisionWorld','return class CollisionWorld'))(THREE,getGeometryTree);
const Guide = new Function(fs.readFileSync(path.join(__dirname,'../src/editor/VehicleControlGuide.js'),'utf8').replace('export default class VehicleControlGuide','return class VehicleControlGuide'))();
function tap(f,code,shiftKey=false) {key(f,code,true,{shiftKey});key(f,code,false,{shiftKey});}
function refresh(f) {f.runtime.time+=.21;f.driving.docking.update(true);f.driving.updateHUD();return f.driving.nextStep;}
function cleanup(f) {f.driving.dispose();f.runtime.stop();}
const f = setup(false,true); f.ctx.collisionWorld = new CollisionWorld(f.ctx,f.document); f.ctx.collisionWorld.setRoom('hall');
Object.assign(f.v,{powered:false,running:false,parkingBrake:true}); assert(f.driving.mount(f.record.id));
const hud = f.driving.hud, button = action => f.driving.controlButtons.get(action), recommended = action => button(action).dataset.recommended === 'true';
assert.equal(f.driving.nextStep.action,'powerOn'); assert(recommended('powerOn'));
assert.equal(f.driving.guideText.attributes['aria-live'],'polite'); assert.equal(f.driving.guideText.attributes['aria-atomic'],'true');
f.driving.controlButtons.forEach((element,action)=>{const definition=Guide.actions.find(value=>value.action===action),kbd=element.children.find(node=>node.tagName==='KBD');assert(kbd&&kbd.textContent===definition.key);assert(element.attributes['aria-label'].includes(definition.key));});
tap(f,'KeyB'); assert(f.v.powered&&!f.v.running&&f.v.parkingBrake);assert.equal(f.driving.nextStep.action,'start');assert(recommended('start'));
tap(f,'KeyV'); assert(f.v.running&&f.v.parkingBrake);assert.equal(f.driving.nextStep.action,'parkingBrake');assert(recommended('parkingBrake'));
tap(f,'KeyP'); assert(!f.v.parkingBrake); refresh(f); assert.equal(f.driving.nextStep.action,'pickup');assert(recommended('pickup'));
for (const modifier of ['ctrlKey','altKey','metaKey','isComposing']) {const count=f.commands.length;key(f,'KeyB',true,{[modifier]:true});key(f,'KeyB',false,{[modifier]:true});assert.equal(f.commands.length,count,'Modified or composed browser input must not dispatch vehicle commands.');}
const commands = (code,expected) => {const start=f.commands.length;tap(f,code,true);assert.deepEqual(f.commands.slice(start),[expected]);};
commands('KeyB','powerOff'); assert(!f.v.powered);tap(f,'KeyB');tap(f,'KeyV');
commands('KeyV','stop'); assert(!f.v.running&&f.v.powered);tap(f,'KeyV');
const parking = f.v.parkingBrake;commands('KeyP','pause');assert(f.v.paused);assert.equal(f.v.parkingBrake,parking);commands('KeyP','pause');assert(!f.v.paused);
tap(f,'KeyY');assert(f.v.emergency&&!f.v.running);commands('KeyY','resetEmergency');assert(!f.v.emergency);tap(f,'KeyV');
const cameraOn=f.driving.docking.cameraEnabled,mode=f.driving.docking.forkCamera.mode,lights=f.v.lights;
tap(f,'KeyC',true);assert.notEqual(f.driving.docking.forkCamera.mode,mode);assert.equal(f.driving.docking.cameraEnabled,cameraOn);
tap(f,'KeyN',true);assert.equal(f.v.lights,lights);assert.equal(f.driving.docking.forkCamera.side,1);
// Unassigned Shift combinations cannot accidentally drive hydraulic axes.
for (const code of ['KeyW','KeyQ','ArrowUp']) {key(f,code,true,{shiftKey:true});key(f,code,true,{shiftKey:true,repeat:true});f.driving.beforeStep();assert.equal(f.v.input.throttle,0,'Shift must not activate movement for '+code);assert.equal(f.v.input.lift,0,'Shift must not activate elevation for '+code);key(f,code,false,{shiftKey:true});}
const population=f.runtime.products.size, product=f.runtime.products.get(f.pallet), identity=product.object;
refresh(f); tap(f,'KeyG'); assert(f.v.entry); const entry=f.v.entry;
assert.equal(f.driving.operatorIntent,'transport');assert.equal(f.driving.nextStep.action,'liftUp');assert(recommended('liftUp'));assert(!recommended('release'));assert.equal(f.runtime.products.size,population);
key(f,'KeyQ');for(let frame=0;frame<100&&f.v.pose.lift<f.config.carryLift;frame++){f.driving.beforeStep();runtime.step(f,1/60);}key(f,'KeyQ',false);f.driving.beforeStep();
refresh(f);assert.equal(f.v.entry,entry);assert.equal(f.driving.nextStep.action,'depositIntent');assert(recommended('depositIntent'));assert(!recommended('release'));
tap(f,'KeyK',true);assert.equal(f.driving.operatorIntent,'deposit');assert.equal(f.v.entry,entry,'Preparing a deposit cannot release cargo.');
refresh(f);assert.equal(f.driving.docking.snapshot.ready,false);assert.notEqual(f.driving.nextStep.action,'release');
tap(f,'KeyK');assert.equal(f.v.entry,entry,'A real unsupported release remains rejected by the runtime.');
key(f,'KeyE');for(let frame=0;frame<120&&!f.api.getDockingState(f.record).ready;frame++){f.driving.beforeStep();runtime.step(f,1/60);}key(f,'KeyE',false);f.driving.beforeStep();
refresh(f);assert(f.driving.docking.snapshot.ready);assert.equal(f.driving.nextStep.action,'release');assert(recommended('release'));
tap(f,'KeyK');assert.equal(f.v.entry,null);assert.equal(f.driving.operatorIntent,'auto');assert.equal(product.object,identity);assert.equal(f.runtime.products.size,population);
// Pure coaching is throttled at the integrated 5 Hz HUD cadence and receives
// cached docking data, rather than requesting whole-scene runtime snapshots.
let evaluations=0;const evaluate=f.driving.controlGuide.evaluate.bind(f.driving.controlGuide);f.driving.controlGuide.evaluate=value=>{evaluations++;return evaluate(value);};
const snapshot=f.runtime.getSnapshot;f.runtime.getSnapshot=()=>{throw Error('Coaching must not request a global snapshot');};
for(let frame=0;frame<120;frame++){f.runtime.time+=1/120;f.driving.updateHUD();}assert(evaluations>=4&&evaluations<=6,'120 HUD visits need about five coaching evaluations, got '+evaluations);f.runtime.getSnapshot=snapshot;
f.ctx.studioMenuOpen=true;f.driving.updateHUD();assert.equal(f.driving.nextStep.stage,'blocked');assert([...f.driving.controlButtons.values()].every(element=>element.disabled));f.ctx.studioMenuOpen=false;refresh(f);
cleanup(f);

// Reuse one live cockpit HUD across different real vehicle capabilities.
const reuse=setup(false,false),tow=reuse.addVehicle('tow-tractor',[6,0,0]);
for (const modifier of ['shiftKey','ctrlKey','altKey','metaKey','isComposing']) {key(reuse,'KeyF',true,{[modifier]:true});key(reuse,'KeyF',false,{[modifier]:true});assert(!reuse.driving.id,'Modified F cannot mount a vehicle from a browser/editor command.');}
assert(reuse.driving.mount(reuse.record.id));
const reusedHud=reuse.driving.hud, control=action=>reuse.driving.controlButtons.get(action);
assert(!control('liftUp').hidden);assert(control('couple').hidden);reuse.driving.unmount(true);assert(reuse.driving.mount(tow.id));
assert.equal(reuse.driving.hud,reusedHud);for(const action of ['pickup','release','liftUp','liftDown','tiltBack','forkCamera','mode'])assert(control(action).hidden,'Tow tractor cannot expose '+action);
assert(!control('couple').hidden&&!control('uncouple').hidden);
let start=reuse.commands.length;tap(reuse,'KeyI');assert.deepEqual(reuse.commands.slice(start),['couple']);start=reuse.commands.length;tap(reuse,'KeyI',true);assert.deepEqual(reuse.commands.slice(start),['uncouple']);
reuse.driving.unmount(true);assert(reuse.driving.mount(reuse.record.id));assert.equal(reuse.driving.hud,reusedHud);assert(!control('liftUp').hidden);assert(control('couple').hidden);assert.equal(reuse.driving.operatorIntent,'auto');
cleanup(reuse);
console.log('Vehicle control workflow: actual key dispatch/startup, Shift isolation, accessible labeled highlights, real G-to-lift-to-prepare-to-supported-K cargo flow, 5 Hz read-only coaching, blocked controls and cockpit reuse by vehicle capability passed.');
