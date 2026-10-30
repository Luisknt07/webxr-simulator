const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const vehicles = require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles'), {THREE} = require('./test-vehicle-runtime');
const code = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-vehicle-cab-panel-layout.js"), 'test-vehicle-driving.js')), 'utf8');
const prefix = code.slice(0, code.indexOf('const desktop = setup();')).replace("h.fixture('forklift-electric-4w',", 'h.fixture(variant,');
const make = variant => new Function('require', '__dirname', 'variant', prefix + '\nreturn setup;')(require, __dirname, variant)(true, false);
function points(plane) {
  const {width, height} = plane.geometry.parameters;
  return [[0, 0], [-.48, -.48], [.48, -.48], [-.48, .48], [.48, .48]].map(([x, y]) => new THREE.Vector3(width * x, height * y, 0).applyMatrix4(plane.matrixWorld));
}
function distanceToScreen(plane, point) {
  const local = point.clone().applyMatrix4(new THREE.Matrix4().getInverse(plane.matrixWorld)), {width, height} = plane.geometry.parameters;
  local.x = Math.max(-width / 2, Math.min(width / 2, local.x)); local.y = Math.max(-height / 2, Math.min(height / 2, local.y)); local.z = 0;
  return local.applyMatrix4(plane.matrixWorld).distanceTo(point);
}
function run() {
  const measured = [];
  for (const variant of ['forklift-electric-3w', 'forklift-electric-4w', 'forklift-ic', 'reach-truck', 'stacker', 'order-picker', 'vna-turret', 'rough-terrain', 'telehandler']) {
    const f = make(variant); assert(f.driving.mount(f.record.id)); const d = f.driving, rig = d.visualRoot.userData.vehicleRig;
    const trackedPosition = f.camera.position.clone(), trackedQuaternion = f.camera.quaternion.clone();
    const panels = [d.worldPanel.plane, d.docking.plane];
    if (d.docking.forkCamera.plane) panels.push(d.docking.forkCamera.plane);
    if (d.docking.forkCamera.mirrorPlane) panels.push(d.docking.forkCamera.mirrorPlane);
    const controls = [rig.controls.wheel, ...rig.controls.levers].filter(Boolean), meshes = [];
    rig.visual.traverse(node => {if (node.isMesh && !node.userData.editorRuntimeHelper && !node.material.transparent) meshes.push(node);});
    let clearance = Infinity;
    for (const full of [false, true]) {
      if ((d.worldPage === 'controls') !== full) d.command('controls'); f.scene.updateMatrixWorld(true);
      for (const control of controls) {
        const samples = control.id === 'steering' ? Array.from({length: 12}, (_, i) => new THREE.Vector3(Math.cos(i * Math.PI / 6) * control.radius, Math.sin(i * Math.PI / 6) * control.radius, 0).applyMatrix4(control.object.matrixWorld)) : [control.grip.getWorldPosition(new THREE.Vector3())];
        for (const point of samples) for (const panel of panels) {
          const distance = distanceToScreen(panel, point); clearance = Math.min(clearance, distance);
          assert(distance > .20, variant + ': panel must clear the real control and a 0.20 m hand envelope: ' + distance);
        }
        const eye = rig.driverSeat.getWorldPosition(new THREE.Vector3());
        for (const point of samples) {
          const delta = point.clone().sub(eye), hits = new THREE.Raycaster(eye, delta.clone().normalize(), 0, delta.length()).intersectObjects(panels, false);
          assert.equal(hits.length, 0, variant + ': screens must not cover the physical wheel or lever from the seated eye.');
        }
      }
      // Eye-to-panel rays test roof bars, mast and real controls. Helpers never
      // prove their own visibility by disabling depth tests.
      const eye = rig.driverSeat.getWorldPosition(new THREE.Vector3());
      for (const panel of panels) for (const target of points(panel)) {
        const delta = target.clone().sub(eye), hits = new THREE.Raycaster(eye, delta.clone().normalize(), 0, delta.length() - .01).intersectObjects(meshes, false);
        if (hits.length && process.env.PANEL_DIAGNOSTICS) {console.log(JSON.stringify({variant, full, panel: panel.name, target: rig.driverSeat.worldToLocal(target.clone()).toArray(), hit: rig.driverSeat.worldToLocal(hits[0].point.clone()).toArray()})); continue;}
        assert.equal(hits.length, 0, variant + ': ' + panel.name + ' behind ' + (hits[0] && hits[0].object.name));
      }
    }
    assert(f.camera.position.equals(trackedPosition)); assert(f.camera.quaternion.equals(trackedQuaternion));
    assert.equal(d.docking.element.dataset.plan, 'open'); assert(!d.docking.plan.hidden); d.docking.planButton.fire('click'); assert.equal(d.docking.element.dataset.plan, 'open'); assert(!d.docking.plan.hidden, 'Plan and measurements remain visible while changing cameras.');
    const left = new THREE.Group(), right = new THREE.Group(), leftHand = {controller: left, source: {}, control: d.cab.controls[0], hover: null};
    d.cab.hands.set(left, leftHand);
    assert(!d.worldState.state.isSelectable(null, left)); assert(!d.docking.state.isSelectable(null, left));
    assert(d.worldState.state.isSelectable(null, right)); assert(d.docking.state.isSelectable(null, right));
    d.cab.hands.delete(left);
    const future = new THREE.Group(), grip = new THREE.Group(); f.scene.add(grip); grip.position.copy(controls[0].grip.getWorldPosition(new THREE.Vector3())); f.scene.updateMatrixWorld(true);
    f.ctx.raycontrol.controllers.push({controller: future, grip});
    assert(!d.worldState.state.isSelectable(null, future), 'The first input frame also protects an uncached hand at the wheel.');
    f.ctx.raycontrol.controllers.length = 0; f.scene.remove(grip);
    measured.push({variant, minimumControlDistance: Number(clearance.toFixed(3))}); d.dispose(); f.runtime.stop();
  }
  console.log('Cab panels: real wheel/lever hand envelopes, eye rays, compact/full menus, per-hand capture exclusion and unchanged XR tracking passed.');
  console.log(JSON.stringify(measured));
}
if (require.main === module) run(); module.exports = {run};
