'use strict';
const assert = require('node:assert/strict');
const {setup, key, nodes, pad, axis} = require('./test-vehicle-driving.js');
const physics = require('./test-vehicle-runtime.js');

function interlock(f) {
  f.v.enabled = false;
  f.v.operatorInterlock = {kind:'practice-dock',actionId:'arrival-check',title:'Contrastar la orden antes de conducir',instruction:'Contrasta la orden y verifica el muelle E02.',label:'Revisar orden de recepción'};
  // Reproduce the reported inconsistency: old record telemetry says enabled.
  f.record.variables.enabled = true;
  f.v.parkingBrake = true;
}

const f=setup();
try {
  interlock(f); const opened=[];
  f.ctx.editor.practiceController={current:()=>true,panel:{openWorkflowAction:id=>{opened.push(id);return true;}}};
  assert(f.driving.mount(f.record.id));
  assert.equal(f.driving.state(f.record).enabled,false,'Cockpit reads the live native component, not stale record variables.');
  assert.equal(f.driving.nextStep.stage,'practice-interlock');
  assert.match(f.driving.phase.textContent,/Pendiente de preparación/);
  assert.equal(f.driving.preparationButton.hidden,false);
  assert.match(f.driving.guideText.textContent,/orden|muelle/);
  key(f,'KeyP'); key(f,'KeyP',false);
  assert.equal(f.v.parkingBrake,false,'P releases the actual parking brake.');
  assert.equal(f.v.enabled,false,'P must not bypass the dock verification.');
  const start=f.object.position.clone(); key(f,'KeyW'); f.driving.beforeStep(); physics.step(f,.4);
  assert(f.object.position.equals(start)); assert.equal(f.v.input.throttle,0);
  f.driving.preparationButton.fire('click');
  assert.deepEqual(opened,['arrival-check'],'The visible cockpit button opens the actual current workflow action.');
  assert.equal(f.driving.keys.size,0,'Opening the order releases held driving input.');
  f.v.operatorInterlock.actionId='secure-dock';f.v.operatorInterlock.label='Comprobar muelle E02';f.driving.updateHUD();
  f.driving.preparationButton.fire('click');assert.deepEqual(opened,['arrival-check','secure-dock']);
  // Only the native workflow grants permission, then controls rearm neutral.
  f.v.enabled=true;delete f.v.operatorInterlock;f.driving.beforeStep();
  assert.equal(f.driving.preparationButton.hidden,true);
  assert.notEqual(f.driving.nextStep.stage,'practice-interlock');
  assert.equal(f.v.input.throttle,0);
  key(f,'KeyW',false);key(f,'KeyW');
  for(let frame=0;frame<60;frame++){f.driving.beforeStep();physics.step(f,1/60);}
  assert(f.object.position.distanceTo(start)>.03,'Actual native physics advances after verification; it is not a HUD-only unlock.');
  key(f,'KeyW',false);f.driving.beforeStep();physics.step(f,1,{brake:1});
  const touch=nodes(f.driving.hud,node=>node.dataset.vehicleHold==='KeyW')[0];
  touch.fire('pointerdown',{pointerId:61});f.driving.beforeStep();assert.equal(f.v.input.throttle,1);
  touch.fire('pointercancel',{pointerId:61});f.driving.beforeStep();assert.equal(f.v.input.throttle,0);
} finally { f.driving.dispose();f.runtime.stop(); }

const xr=setup(true),left=pad('left');
try {
  interlock(xr);const opened=[];xr.ctx.raycontrol.controllers=[left];
  xr.ctx.editor.practiceController={current:()=>true};xr.ctx.studio={immersiveMenu:{open:page=>opened.push(page)}};
  assert(xr.driving.mount(xr.record.id));
  assert(xr.driving.worldPanel.actions.some(([action])=>action==='practicePreparation'));
  assert(xr.driving.command('practicePreparation'));
  assert.deepEqual(opened,['practice']);assert.equal(xr.ctx.studio.immersiveMenu.practiceWorkflowActionId,'arrival-check');
  axis(left,0,-.8);xr.driving.beforeStep();assert.equal(xr.v.input.throttle,0);
  xr.v.enabled=true;delete xr.v.operatorInterlock;axis(left,0,0);xr.driving.beforeStep();xr.driving.beforeStep();
  xr.v.parkingBrake=false;axis(left,0,-.8);xr.driving.beforeStep();
  assert(xr.v.input.throttle>0,'The native XR driving axis remains available after the dock interlock.');
} finally { xr.driving.dispose();xr.runtime.stop(); }
console.log('Practice forklift start: live permission, actionable dock prerequisite, P semantics, neutral rearm and real keyboard/touch/XR driving passed.');
