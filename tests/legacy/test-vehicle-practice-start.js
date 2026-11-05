'use strict';
const assert = require('node:assert/strict');
const {setup, key, nodes, pad, axis} = require('./test-vehicle-driving.js');
const physics = require('./test-vehicle-runtime.js');

function interlock(f) {
  f.v.enabled = true;
  f.v.operatorInterlock = {kind:'practice-dock',scope:'load',sourceIds:['receiving-truck-slot'],actionId:'arrival-check',title:'Contrastar la orden antes de descargar',instruction:'Puedes conducir. Antes de retirar mercancía, contrasta la orden y verifica el muelle E02.',label:'Revisar orden de recepción'};
  // The cockpit must read the live component instead of stale telemetry.
  f.record.variables.enabled = false;
  f.v.parkingBrake = true;
}

const f=setup();
try {
  interlock(f); const opened=[];
  f.ctx.editor.practiceController={current:()=>true,panel:{openWorkflowAction:id=>{opened.push(id);return true;}}};
  assert(f.driving.mount(f.record.id));
  assert.equal(f.driving.state(f.record).enabled,true,'Cockpit reads the live native component, not stale record variables.');
  assert.equal(f.driving.nextStep.stage,'parking');
  assert.match(f.driving.phase.textContent,/En marcha/);
  assert.equal(f.driving.preparationButton.hidden,false);
  assert.match(f.driving.guideText.textContent,/freno|pasillo/);
  key(f,'KeyP'); key(f,'KeyP',false);
  assert.equal(f.v.parkingBrake,false,'P releases the actual parking brake.');
  assert(f.v.operatorInterlock,'P releases parking but never verifies the dock or its cargo.');
  const start=f.object.position.clone(); key(f,'KeyW');
  for(let frame=0;frame<60;frame++){f.driving.beforeStep();physics.step(f,1/60);}
  assert(f.object.position.distanceTo(start)>.03,'The actual vehicle moves before verifying documentary preparation.');
  f.driving.preparationButton.fire('click');
  assert.deepEqual(opened,['arrival-check'],'The visible cockpit button opens the actual current workflow action.');
  assert.equal(f.driving.keys.size,0,'Opening the order releases held driving input.');
  f.v.operatorInterlock.actionId='secure-dock';f.v.operatorInterlock.label='Comprobar muelle E02';f.driving.updateHUD();
  f.driving.preparationButton.fire('click');assert.deepEqual(opened,['arrival-check','secure-dock']);
  // Verified preparation removes its reminder; it never grants fictitious cargo.
  delete f.v.operatorInterlock;f.driving.beforeStep();
  assert.equal(f.driving.preparationButton.hidden,true);
  assert.notEqual(f.driving.nextStep.stage,'load-interlock');
  assert.equal(f.v.input.throttle,0);
  key(f,'KeyW',false);key(f,'KeyW');
  for(let frame=0;frame<60;frame++){f.driving.beforeStep();physics.step(f,1/60);}
  assert(f.object.position.distanceTo(start)>.03);
  key(f,'KeyW',false);f.driving.beforeStep();physics.step(f,1,{brake:1});
  const touch=nodes(f.driving.hud,node=>node.dataset.vehicleHold==='KeyW')[0];
  touch.fire('pointerdown',{pointerId:61});f.driving.beforeStep();assert.equal(f.v.input.throttle,1);
  touch.fire('pointercancel',{pointerId:61});f.driving.beforeStep();assert.equal(f.v.input.throttle,0);
  touch.fire('pointerdown',{pointerId:62});f.driving.beforeStep();assert.equal(f.v.input.throttle,1);
  f.ctx.practiceReadingPanelOpen=true;f.driving.beforeStep();assert.equal(f.v.input.throttle,0);assert.equal(f.v.input.brake,1);
  assert.equal(f.driving.touches.size,0,'Opening a mobile reading panel releases its held driving touch.');
  assert.equal(key(f,'KeyW').prevented,undefined,'Reading controls keep native keyboard events.');
  f.ctx.practiceReadingPanelOpen=false;f.driving.beforeStep();assert.equal(f.v.input.throttle,0,'Closing mobile reading never replays held touch or key input.');
  key(f,'KeyW',false);key(f,'KeyW');f.driving.beforeStep();assert.equal(f.v.input.throttle,1);
  f.ctx.vehiclePreparationOpen=true;f.driving.beforeStep();assert.equal(f.v.input.throttle,0);assert.equal(f.v.input.brake,1);
  for(const code of ['Tab','Space','ArrowDown','KeyW']){
    const event=key(f,code,true,{target:{tagName:'BUTTON'}});
    assert.equal(event.prevented,undefined,'The native order/dock dialog keeps '+code+' for focus, activation and scrolling.');
    assert.equal(event.stopped,undefined);
  }
  f.ctx.vehiclePreparationOpen=false;f.driving.beforeStep();assert.equal(f.v.input.throttle,0,'Closing the order/dock dialog never replays driving keys.');
} finally { f.driving.dispose();f.runtime.stop(); }

const xr=setup(true),left=pad('left');
try {
  interlock(xr);const opened=[];xr.ctx.raycontrol.controllers=[left];
  xr.ctx.editor.practiceController={current:()=>true};xr.ctx.studio={immersiveMenu:{open:page=>opened.push(page)}};
  assert(xr.driving.mount(xr.record.id));
  assert(xr.driving.worldPanel.actions.some(([action])=>action==='practicePreparation'));
  assert(xr.driving.worldPanel.actions.some(([action])=>action==='parkingBrake'),'The dock reminder does not replace the native XR cab controls.');
  assert(xr.driving.command('practicePreparation'));
  assert.deepEqual(opened,['practice']);assert.equal(xr.ctx.studio.immersiveMenu.practiceWorkflowActionId,'arrival-check');
  xr.v.operatorInterlock.actionId='secure-dock';xr.v.operatorInterlock.label='Comprobar muelle E02';xr.driving.updateHUD();
  assert(xr.driving.worldPanel.actions.some(([action,label])=>action==='practicePreparation'&&label==='Comprobar muelle E02'),'XR refreshes its real next preparation action even while the driving guide stays unchanged.');
  axis(left,0,0);xr.driving.beforeStep();xr.driving.beforeStep();xr.driving.command('parkingBrake');xr.driving.beforeStep();axis(left,0,-.8);xr.driving.beforeStep();
  assert(xr.v.input.throttle>0,'The native XR driving axis works before dock verification.');
  xr.ctx.practiceReadingPanelOpen=true;xr.driving.beforeStep();assert.equal(xr.v.input.throttle,0);
  xr.ctx.practiceReadingPanelOpen=false;xr.driving.beforeStep();assert.equal(xr.v.input.throttle,0,'Held XR axes rearm neutral after reading.');
  axis(left,0,0);xr.driving.beforeStep();axis(left,0,-.8);xr.driving.beforeStep();assert(xr.v.input.throttle>0);
  delete xr.v.operatorInterlock;xr.driving.updateHUD();assert(!xr.driving.worldPanel.actions.some(([action])=>action==='practicePreparation'));
} finally { xr.driving.dispose();xr.runtime.stop(); }

const cargo=physics.fixture();try {
  interlock(cargo);cargo.v.parkingBrake=false;const product=cargo.runtime.products.get(cargo.pallet),before=product.object.matrixWorld.clone();
  assert(cargo.api.pickupPlan(cargo.record).ready,'Unrelated pallets keep their existing physical pickup permission.');
  product.sourceEntry={ownerId:'receiving-truck-slot'};
  const blocked=cargo.api.pickupPlan(cargo.record);assert.equal(blocked.ready,false);assert.match(blocked.reason,/Antes de retirar mercancía/);
  assert.equal(cargo.api.getDockingState(cargo.record).preparationRequired,true);assert.equal(cargo.v.entry,null);assert(product.object.matrixWorld.equals(before));
  delete product.sourceEntry;assert.equal(cargo.api.getDockingState(cargo.record).preparationRequired,false);
  cargo.v.enabled=false;physics.step(cargo,.4,{throttle:1});assert.equal(cargo.v.actualSpeed,0,'An explicitly disabled vehicle remains immobile.');
} finally { cargo.runtime.stop(); }
console.log('Practice forklift start: real keyboard/touch/XR travel before paperwork, scoped native cargo permission, actionable dock prerequisite, P semantics and neutral reading rearm passed.');
