'use strict';
// Real command/custody runtime and actual DOM event handlers. The temporary
// DOM fixture replaces only browser surfaces, never input or vehicle physics.
const assert=require('node:assert/strict'),{setup,key,nodes}=require('./test-vehicle-driving.js');
const tap=(f,code,shiftKey=false)=>{key(f,code,true,{shiftKey});key(f,code,false,{shiftKey});};
const f=setup(false,true);assert(f.driving.mount(f.record.id));
const d=f.driving,hud=d.hud,definitions=d.definitions();
assert.equal(hud.dataset.layout,'compact');assert.equal(nodes(hud,node=>node.tagName==='DETAILS').length,0,'No supported control is tucked inside an accordion');
assert.equal(d.controlGroups.length,4);assert(d.controlGroups.every(group=>group.parentNode===d.controlGroups[0].parentNode));
for(const definition of definitions){
  const button=d.controlButtons.get(definition.action);assert(button&&!button.hidden,definition.action+' remains visible from the start');
  assert(button.children.some(node=>node.className==='vehicle-control-icon'&&node.attributes['aria-hidden']==='true'));
  assert(button.controlLabel.textContent.length>0);assert(button.attributes['aria-label'].includes(definition.label));assert(button.attributes['aria-label'].includes(definition.key));
}
assert(d.controlButtons.get('depositIntent').disabled,'Preparation is visible before custody, while its unavailable action is disabled');
const hologram=d.actionButtons.get('holographicGuide'),entry=f.v.entry,products=f.runtime.products.size;
const enabled=d.holographicGuide.enabled;tap(f,'KeyG',true);assert.equal(d.holographicGuide.enabled,!enabled);assert(hologram.controlLabel.textContent.endsWith(enabled?'OFF':'ON'));assert.equal(hologram.attributes['aria-pressed'],String(!enabled));
assert.equal(f.v.entry,entry);assert.equal(f.runtime.products.size,products);tap(f,'KeyG',true);assert.equal(d.holographicGuide.enabled,enabled);
Object.assign(f.v,{powered:true,running:true,paused:false,emergency:false,parkingBrake:false});
const mirror=d.docking.forkCamera.selectedFeed;
key(f,'KeyR',true,{shiftKey:true});d.beforeStep();assert.notEqual(d.docking.forkCamera.selectedFeed,mirror);assert.equal(f.v.input.tilt,0,'Mirror shortcut cannot also tilt a loaded fork');
assert.equal(d.actionButtons.get('rearView').attributes['aria-pressed'],String(d.docking.forkCamera.selectedFeed==='mirror'));
key(f,'KeyR',true,{shiftKey:true,repeat:true});assert.notEqual(d.docking.forkCamera.selectedFeed,mirror,'Held shortcut does not repeat-toggle the mirror');key(f,'KeyR',false,{shiftKey:true});
key(f,'KeyJ',true,{shiftKey:true});d.beforeStep();assert.equal(f.v.input.sideShift,0,'Changing objective cannot also move the side-shift cylinder');key(f,'KeyJ',false,{shiftKey:true});
key(f,'KeyR');d.beforeStep();assert(Math.abs(f.v.input.tilt)>0,'The original unshifted hydraulic control still works');key(f,'KeyR',false);d.beforeStep();assert.equal(f.v.input.tilt,0);
const forward=d.controlButtons.get('driveForward');forward.fire('pointerdown',{pointerId:71});d.beforeStep();assert(f.v.input.throttle>0);forward.fire('pointercancel',{pointerId:71});d.beforeStep();assert.equal(f.v.input.throttle,0,'A cancelled hold releases traction immediately');
const before=f.commands.length;tap(f,'KeyH');assert.deepEqual(f.commands.slice(before),['horn'],'H remains the established horn control');
f.ctx.publicDialogOpen=true;d.updateHUD();const blockedHolo=d.holographicGuide.enabled;tap(f,'KeyG',true);assert.equal(d.holographicGuide.enabled,blockedHolo,'A public menu blocks keyboard commands as well as movement');assert([...d.controlButtons.values()].every(button=>button.disabled));f.ctx.publicDialogOpen=false;f.runtime.time+=.21;d.updateHUD();
let locked=true,lockCalls=0,unlocks=0,resets=0;f.ctx.desktopLook={get isLocked(){return locked;},lock(){locked=true;lockCalls++;},unlock(){locked=false;unlocks++;},reset(){resets++;}};
assert(d.unmount());assert.equal(locked,false,'Returning to walking always releases captured mouse look');assert.equal(lockCalls,0);assert.equal(unlocks,1);assert.equal(resets,1);assert.equal(f.v.entry,entry);assert.equal(f.runtime.products.size,products);
d.dispose();f.runtime.stop();
console.log('Compact vehicle controls: all capability-aware actions visible, accessible icon/key labels, clear Shift+G state, isolated mirror/target shortcuts, actual hydraulic/hold release and free cursor on walking passed.');
