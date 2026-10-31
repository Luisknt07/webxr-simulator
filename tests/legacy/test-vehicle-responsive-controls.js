'use strict';
// Actual HUD event handlers and real physics, with only browser surfaces mocked.
const assert = require('node:assert/strict'), {setup,key} = require('./test-vehicle-driving.js');
const f=setup(false,true); assert(f.driving.mount(f.record.id)); const d=f.driving;
const selected=()=>d.controlGroups.filter(group=>!group.hidden).map(group=>group.dataset.group);
assert.deepEqual(selected(),['drive']); assert.equal(d.hud.dataset.expanded,'false');
const initialCustody=f.record.components.vehicle.entry,initialProducts=f.runtime.products.size;
d.controlTabs.get('cargo').fire('click');assert.deepEqual(selected(),['cargo']);assert.equal(d.controlTabs.get('cargo').attributes['aria-selected'],'true');
const up=d.controlButtons.get('liftUp');up.fire('pointerdown',{pointerId:101});d.beforeStep();assert(f.v.input.lift>0);
d.controlTabs.get('view').fire('click');d.beforeStep();assert.equal(f.v.input.lift,0,'Changing control categories clears a held hydraulic input immediately.');
assert.deepEqual(selected(),['view']);d.expandControls.fire('click');assert.equal(d.hud.dataset.expanded,'true');assert.equal(selected().length,4);
d.expandControls.fire('click');assert.deepEqual(selected(),['view']);assert.equal(d.hud.dataset.expanded,'false');
d.minimizeControls.fire('click');assert.equal(d.hud.dataset.minimized,'true');assert.equal(d.minimizeControls.attributes['aria-label'],'Mostrar controles');
d.minimizeControls.fire('click');assert.equal(d.hud.dataset.minimized,'false');
const count=f.commands.length;d.quickEmergency.fire('click');assert.deepEqual(f.commands.slice(count),['emergency']);assert.equal(f.v.emergency,true,'Emergency is available from every category and the minimized header.');
assert.equal(f.record.components.vehicle.entry,initialCustody);assert.equal(f.runtime.products.size,initialProducts,'Expanding and switching UI never changes physical load custody.');
// Hardware and keyboard commands continue to work independently of the visible category.
d.command('resetEmergency');d.command('powerOn');d.command('start');f.v.parkingBrake=false;
d.setControlSection('view');key(f,'KeyQ');d.beforeStep();assert(f.v.input.lift>0);key(f,'KeyQ',false);d.beforeStep();assert.equal(f.v.input.lift,0);
d.dispose();f.runtime.stop();

// A full desktop uses all of its controls immediately. Compact and wide choices
// are remembered separately, so visiting a phone-sized viewport does not undo
// the operator's desktop preference (or vice versa).
const desktop=setup(false,true);
Object.assign(desktop.window,{innerWidth:1440,innerHeight:800});
assert(desktop.driving.mount(desktop.record.id));
const wide=desktop.driving,visible=()=>wide.controlGroups.filter(group=>!group.hidden).map(group=>group.dataset.group);
const resize=(width,height)=>{Object.assign(desktop.window,{innerWidth:width,innerHeight:height});desktop.window.fire('resize');};
assert.equal(wide.prefersWideControls(),true);
assert.equal(wide.hud.dataset.viewport,'wide');
assert.equal(wide.hud.dataset.expanded,'true');
assert.deepEqual(visible(),['drive','cargo','view','safety']);
resize(1439,800);
assert.equal(wide.hud.dataset.viewport,'compact');
assert.deepEqual(visible(),['drive'],'A new compact viewport starts with its driving category.');
wide.controlTabs.get('cargo').fire('click');wide.expandControls.fire('click');
assert.equal(wide.hud.dataset.expanded,'true');
resize(1600,900);
assert.equal(wide.hud.dataset.viewport,'wide');
assert.equal(wide.hud.dataset.expanded,'true','A compact choice does not replace the initial wide layout.');
wide.expandControls.fire('click');
assert.deepEqual(visible(),['cargo']);
resize(1439,800);
assert.equal(wide.hud.dataset.expanded,'true','The operator previously expanded the compact layout.');
resize(1600,900);
assert.deepEqual(visible(),['cargo'],'The wide layout remembers its own explicit compact choice.');
resize(1600,799);
assert.equal(wide.prefersWideControls(),false);
assert.equal(wide.hud.dataset.viewport,'compact','Short desktop windows use the compact breakpoint.');
assert.equal(wide.hud.dataset.expanded,'true');
resize(1440,800);
assert.deepEqual(visible(),['cargo']);
desktop.ctx.vrMode=true;
assert.equal(wide.prefersWideControls(),false,'Desktop expansion does not determine the headset controls.');
desktop.ctx.vrMode=false;
wide.dispose();desktop.runtime.stop();
assert.equal(desktop.window.listeners.get('resize').size,0,'Disposing the driver removes its responsive listener.');

// A breakpoint that hides a held hydraulic button releases real simulation
// input, while a resize inside the same breakpoint does not interrupt it.
const held=setup(false,true);
Object.assign(held.window,{innerWidth:1600,innerHeight:900});
assert(held.driving.mount(held.record.id));
const hydraulic=held.driving.controlButtons.get('liftUp');
hydraulic.fire('pointerdown',{pointerId:202});held.driving.beforeStep();
assert(held.v.input.lift>0);
held.window.innerWidth=1590;held.window.fire('resize');held.driving.beforeStep();
assert(held.v.input.lift>0,'Resizing within the current breakpoint preserves a held input.');
held.window.innerWidth=1200;held.window.fire('resize');held.driving.beforeStep();
assert.equal(held.driving.hud.dataset.expanded,'false');
assert.equal(held.v.input.lift,0,'Hiding a held control at a breakpoint clears its hydraulic input.');
assert.equal(held.driving.touches.size,0);
held.driving.dispose();held.runtime.stop();
assert.equal(held.window.listeners.get('resize').size,0);
held.window.fire('resize');
assert.equal(held.driving.hud,null,'A disposed resize listener cannot recreate the driving console.');

console.log('Responsive controls: desktop defaults, independent breakpoint preferences, held-input release, listener disposal, category selection, emergency access and unchanged custody passed.');
