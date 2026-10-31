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
d.dispose();f.runtime.stop();console.log('Responsive controls: bounded category selection, expansion/minimization, hold release, persistent emergency, keyboard independence and unchanged custody passed.');
