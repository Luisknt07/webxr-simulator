'use strict';
// Real vehicle mechanism and driving adapter; canvas/XR surfaces are fixtures.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const h = require('./test-vehicle-runtime.js'), {THREE} = h;
const source = fs.readFileSync(path.join(__dirname, 'test-vehicle-driving.js'), 'utf8');
const {setup, Element, key, nodes} = new Function('require', '__dirname', source.slice(0, source.indexOf('const desktop = setup();')) + '\nreturn {setup,Element,key,nodes};')(require, __dirname);
const near = (a, b, epsilon = 1e-7) => assert(Math.abs(a - b) < epsilon, `${a} != ${b}`);
Element.prototype.getContext = function () {
  if (this.context) return this.context; const calls = this.calls = [];
  this.context = {measureText: text => ({width: String(text).length * 10})};
  ['fillRect', 'fillText', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill'].forEach(name => { this.context[name] = (...args) => { args.forEach(value => { if (typeof value === 'number') assert(Number.isFinite(value), `${name} receives finite geometry`); }); calls.push([name, ...args]); }; });
  return this.context;
};
Element.prototype.getBoundingClientRect = function () { return {left: 0, top: 0, width: 768, height: 432}; };

// C toggles an auxiliary feed while the main camera remains in the selected
// cab/chase view. The feed uses actual fork matrices at every articulation.
const desktop = setup(false, true), parent = new THREE.Group(); parent.rotation.y = -.3; parent.position.set(-3, .2, 4); desktop.scene.add(parent); parent.add(desktop.cameraRig);
desktop.root.rotation.y = .7; desktop.root.position.set(3, 0, -5); desktop.scene.updateMatrixWorld(true);
assert(desktop.driving.mount(desktop.record.id)); const rig = desktop.api.rig(desktop.record);
assert.equal(desktop.driving.viewIndex, 0); assert(desktop.driving.docking.cameraEnabled);
const cabinWorld = desktop.camera.matrixWorld.clone(), cabinLocal = desktop.camera.matrix.clone();
key(desktop, 'KeyC'); assert.equal(desktop.driving.viewIndex, 0); assert(!desktop.driving.docking.cameraEnabled); key(desktop, 'KeyC', false); key(desktop, 'KeyC'); assert.equal(desktop.driving.viewIndex, 0); assert(desktop.driving.docking.cameraEnabled); key(desktop, 'KeyC', false);
assert(desktop.camera.matrixWorld.equals(cabinWorld)); assert(desktop.camera.matrix.equals(cabinLocal));
for (const pose of [{lift: 0, tilt: 0}, {lift: .72, tilt: .04}, {lift: 2.7, tilt: -.08, sideShift: .08}]) {
  assert(desktop.api.applyPose(desktop.record, Object.assign({}, desktop.v.pose, pose), false)); desktop.driving.follow();
  desktop.driving.docking.update(true); const feed = desktop.driving.docking.forkCamera, framing = feed.frame(desktop.driving.docking.snapshot), eye = feed.camera.getWorldPosition(new THREE.Vector3()), target = framing.aim.clone();
  const eyeLocal = eye.clone().applyMatrix4(new THREE.Matrix4().getInverse(rig.forks.matrixWorld)); assert(eyeLocal.x < -desktop.config.width/2-.3, 'The inspection camera is laterally outside the body, rather than inside a loaded carton.');
  near(feed.camera.getWorldDirection(new THREE.Vector3()).dot(target.sub(eye).normalize()), 1);
  assert(desktop.camera.quaternion.equals(new THREE.Quaternion()));
  assert(desktop.camera.getWorldPosition(new THREE.Vector3()).distanceTo(rig.driverSeat.getWorldPosition(new THREE.Vector3())) < 1e-7, 'The cab camera stays at the seat while auxiliary framing follows the real tines.');
}
assert.match(desktop.driving.viewButton.controlLabel.textContent, /Cabina/); const commands = desktop.commands.length;
nodes(desktop.driving.hud, node => Object.prototype.hasOwnProperty.call(node.dataset, 'vehicleView'))[0].fire('click'); assert.equal(desktop.driving.viewIndex, 1); const chase = desktop.camera.matrixWorld.clone();
desktop.driving.forkCameraButton.fire('click'); assert.equal(desktop.driving.viewIndex, 1); assert(desktop.camera.matrixWorld.equals(chase), 'Toggling the auxiliary feed also preserves a selected chase camera.');
nodes(desktop.driving.hud, node => Object.prototype.hasOwnProperty.call(node.dataset, 'vehicleView'))[0].fire('click'); assert.equal(desktop.driving.viewIndex, 0); assert.equal(desktop.commands.length, commands, 'Changing camera does not send a machinery command.');
near(desktop.camera.getWorldPosition(new THREE.Vector3()).distanceTo(rig.driverSeat.getWorldPosition(new THREE.Vector3())), 0);

// Read-only snapshots control all colors. In particular, "almost aligned" is
// never made green by the presentation layer, and menus cannot retain green.
const monitor = desktop.driving.docking, product = desktop.runtime.products.get(desktop.pallet), beforeMatrix = product.object.matrixWorld.clone(), beforePose = Object.assign({}, desktop.v.pose), beforePopulation = desktop.runtime.products.size;
const quad = (x, z, w, d) => [[x-w/2, 0, z-d/2], [x+w/2, 0, z-d/2], [x+w/2, 0, z+d/2], [x-w/2, 0, z+d/2]];
const snapshot = {phase: 'pickup', targetName: 'Pallet EUR 1200×800', ready: false, severity: 'near', reason: 'Ajusta la altura', errors: {lateralM: .025, verticalM: .04, yawRad: .03}, insertion: {actualM: .72, requiredM: .85}, stability: {loadKg: 145, capacityKg: 1800}, geometry: {frame: {position: [0,0,0], yaw: 0}, chassis: quad(0,-1,1,2), forks: [quad(-.25,.5,.1,1),quad(.25,.5,.1,1)], target: quad(0,.9,1.2,.8), pockets: [quad(-.25,.9,.2,.8),quad(.25,.9,.2,.8)]}};
let queries = 0; desktop.api.getDockingState = () => { queries++; return snapshot; }; monitor.update(true);
assert.equal(monitor.severity, 'near'); assert.match(monitor.summary.textContent, /AJUSTAR/); assert(monitor.canvas.calls.some(call => call[0] === 'lineTo'), 'Actual contours are drawn, rather than substituting a status-only overlay.');
const pLeft = monitor.projection.screen([-.3,0,1]), pRight = monitor.projection.screen([.3,0,1]), pForward = monitor.projection.screen([0,0,2]), pBack = monitor.projection.screen([0,0,0]);
assert(pLeft[0] > pRight[0], 'Operator right (−X when facing +Z) appears on the right of the top view.'); assert(pForward[1] < pBack[1], 'Vehicle forward appears toward the top of the plan.');
snapshot.ready = true; snapshot.severity = 'ready'; snapshot.reason = 'Ambas horquillas alineadas'; monitor.update(true); assert.equal(monitor.severity, 'ready');
desktop.ctx.studioMenuOpen = true; monitor.update(true); assert.equal(monitor.severity, 'blocked'); assert.match(monitor.summary.textContent, /Controles bloqueados/); desktop.ctx.studioMenuOpen = false;
snapshot.ready = false; snapshot.severity = 'blocked'; snapshot.reason = 'Capacidad excedida'; monitor.update(true); assert.equal(monitor.severity, 'blocked');
const sampleCount = queries; for (let i = 0; i < 100; i++) monitor.update(); assert(queries - sampleCount <= 1, 'Snapshot queries are bounded to 10Hz independently of render frequency.');
assert(product.object.matrixWorld.equals(beforeMatrix)); assert.deepEqual(desktop.v.pose, beforePose); assert.equal(desktop.runtime.products.size, beforePopulation); assert.equal(desktop.v.entry, null, 'Guidance neither takes nor clones the target product.');
monitor.canvas.fire('click', {clientX: 680, clientY: 30}); assert.equal(monitor.page, 'guide'); monitor.canvas.fire('click', {clientX: 680, clientY: 30}); assert.equal(monitor.page, 'alignment');
desktop.driving.command('dockingHelp'); assert(monitor.element.hidden); desktop.driving.command('dockingHelp'); assert(!monitor.element.hidden); assert.equal(monitor.plane.visible, false);
desktop.driving.dispose(); desktop.runtime.stop();

// Production API integration: displayed green corresponds to the exact same
// plan that pickup/drop executes, on the same pallet identity and geometry.
const real = setup(false, true); assert(real.driving.mount(real.record.id));
const realMonitor = real.driving.docking, realProduct = real.runtime.products.get(real.pallet), initialPose = Object.assign({}, real.v.pose), initialTransform = realProduct.object.matrixWorld.clone(), initialEntries = real.runtime.sourceRuntime.entries.size;
assert.equal(typeof real.api.getDockingState, 'function'); realMonitor.update(true);
assert.equal(realMonitor.snapshot.phase, 'pickup'); assert.equal(realMonitor.snapshot.ready, true); assert.equal(realMonitor.severity, 'ready');
assert.equal(realMonitor.snapshot.geometry.forks.length, 2); assert.equal(realMonitor.snapshot.geometry.target.length, 4); assert(realMonitor.snapshot.geometry.pockets.length >= 2);
real.v.powered = false; realMonitor.update(true); assert.equal(realMonitor.severity, 'blocked', 'An aligned but powered-off vehicle is not shown as ready or merely misaligned.'); real.v.powered = true;
const fork0 = new THREE.Vector3(-real.config.forkSpread/2-real.config.forkWidth/2, 0, 0).applyMatrix4(real.api.rig(real.record).forks.matrixWorld);
assert(realMonitor.snapshot.geometry.forks[0].some(p => new THREE.Vector3().fromArray(p).distanceTo(fork0) < 1e-7), 'The displayed footprint is measured from the real tine frame.');
for (let i = 0; i < 20; i++) realMonitor.update(true);
assert.deepEqual(real.v.pose, initialPose); assert(realProduct.object.matrixWorld.equals(initialTransform)); assert.equal(real.runtime.sourceRuntime.entries.size, initialEntries); assert.equal(real.v.entry, null);
real.pallet.position.x = .4; real.scene.updateMatrixWorld(true); realMonitor.update(true); assert.equal(realMonitor.snapshot.ready, false); assert.notEqual(realMonitor.severity, 'ready'); assert.equal(real.api.pickup(real.record), false);
real.pallet.position.x = 0; real.scene.updateMatrixWorld(true); realMonitor.update(true); assert(realMonitor.snapshot.ready); assert(real.driving.command('pickup')); const actualEntry = real.v.entry;
realMonitor.update(true); assert.equal(realMonitor.snapshot.phase, 'drop'); assert.equal(realMonitor.snapshot.stability.attached, true); assert.equal(realMonitor.snapshot.stability.loadKg, 145);
assert.equal(realMonitor.snapshot.ready, real.api.releasePlan(real.record).ready); assert(realMonitor.snapshot.ready); assert(real.driving.command('release')); assert.equal(real.v.entry, null); assert.equal(realProduct.sourceEntry, actualEntry); assert.equal(real.runtime.products.get(real.pallet), realProduct);
real.driving.dispose(); real.runtime.stop();

// Regression from the compiled Chrome image: the true dock's full carton
// pallet enclosed the old camera at heel+[0,.32,.08]. The alternate view must
// stay outside both cargo and chassis before and after taking that same load.
const inspection = setup(false, true), inspectedProduct = inspection.runtime.products.get(inspection.pallet);
inspection.camera.fov=80;inspection.camera.aspect=1582/848;inspection.camera.updateProjectionMatrix();
inspection.pallet.position.z = 3.6; inspection.scene.updateMatrixWorld(true);
const dock = inspection.api.pickupDock(inspection.record, {yaw: 0}, inspectedProduct); assert(dock);
inspection.object.position.copy(dock.position); inspection.object.rotation.set(0, dock.yaw || 0, 0); inspection.scene.updateMatrixWorld(true);
assert(inspection.api.applyPose(inspection.record, Object.assign({}, inspection.v.pose, {lift: dock.toolY - inspection.v.originWorld.y - inspection.config.forkBaseHeight}), false));
inspection.scene.updateMatrixWorld(true); assert(inspection.driving.mount(inspection.record.id)); inspection.driving.docking.update(true);
const inspectionFeed = inspection.driving.docking.forkCamera; inspectionFeed.setMode('tips'); inspectionFeed.frame(inspection.driving.docking.snapshot);
// Sample actual visible first surfaces at the production wide-screen FOV. An
// unoccluded target alone missed the previous huge wheel at the image edge.
const visible=object=>{for(let node=object;node;node=node.parent)if(!node.visible||node.userData.editorRuntimeHelper)return false;return true;},meshes=[];
[inspection.object,inspectedProduct.object].forEach(root=>root.traverse(node=>{if(node.isMesh&&visible(node))meshes.push(node);}));
const wheelPivots=new Set(inspection.api.rig(inspection.record).wheels.map(wheel=>wheel.pivot)),counts={wheel:0,cargo:0,forks:0},ray=new THREE.Raycaster(),frustumSampleCount=32*18;
for(let y=0;y<18;y++)for(let x=0;x<32;x++){ray.setFromCamera(new THREE.Vector2((x+.5)/32*2-1,1-(y+.5)/18*2),inspectionFeed.camera);const first=ray.intersectObjects(meshes,false)[0];if(!first)continue;let node=first.object;while(node&&!wheelPivots.has(node)&&node!==inspectedProduct.object&&node!==inspection.api.rig(inspection.record).forks)node=node.parent;if(wheelPivots.has(node))counts.wheel++;else if(node===inspectedProduct.object)counts.cargo++;else if(node===inspection.api.rig(inspection.record).forks)counts.forks++;}
assert(counts.wheel/frustumSampleCount<.10,'A front wheel cannot fill the inspection frame.');assert(counts.cargo/frustumSampleCount>.10&&counts.forks>0,'The real pallet/cargo and fork surfaces both remain visible in the wide-screen inspection view.');
for (const carried of [false, true]) {
  if (carried) assert(inspection.driving.command('pickup'));
  for (const transform of [{lift: inspection.v.pose.lift, tilt: 0, yaw: 0}, {lift: .8, tilt: .06, yaw: -.7}, {lift: 2.4, tilt: -.06, yaw: .3}]) {
    if (carried) { inspection.object.rotation.y = transform.yaw; inspection.scene.updateMatrixWorld(true); assert(inspection.api.applyPose(inspection.record, Object.assign({}, inspection.v.pose, {lift: transform.lift, tilt: transform.tilt}), false)); }
    inspection.driving.follow(); inspection.driving.docking.update(true); inspectionFeed.frame(inspection.driving.docking.snapshot); const eye = inspectionFeed.camera.getWorldPosition(new THREE.Vector3());
    const cargoBox = inspectedProduct.bounds.clone().applyMatrix4(inspectedProduct.object.matrixWorld).expandByScalar(.025);
    assert(!cargoBox.containsPoint(eye), 'A full24-box pallet never encloses the inspection camera.');
    const inBody = eye.clone().applyMatrix4(new THREE.Matrix4().getInverse(inspection.object.matrixWorld));
    assert(Math.abs(inBody.x) > inspection.config.width/2+.3, 'The exterior inspection camera does not occupy the chassis or operator seat.');
    assert(eye.y >= inspection.v.originWorld.y + .06, 'Low fork viewing remains above the actual ground plane.');
    const screen = new THREE.Vector3(0, -inspection.config.forkThickness*.25, .05).applyMatrix4(inspection.api.rig(inspection.record).forks.matrixWorld).project(inspectionFeed.camera);
    assert(Math.abs(screen.x) < .95 && Math.abs(screen.y) < .95, 'The entry end of the tines remains inside the auxiliary viewport.');
    near(inspection.camera.getWorldPosition(new THREE.Vector3()).distanceTo(inspection.api.rig(inspection.record).driverSeat.getWorldPosition(new THREE.Vector3())), 0);
    // This is an orthographic front-entry feed. Check rays produced by that
    // camera to the exposed tips; the loaded pallet legitimately hides heels.
    const forks = inspection.api.rig(inspection.record).forks;
    for (const side of [-1, 1]) {
      const point = new THREE.Vector3(side * inspection.config.forkSpread / 2, -inspection.config.forkThickness * .20, inspection.config.forkLength - .012).applyMatrix4(forks.matrixWorld);
      const projected = point.clone().project(inspectionFeed.camera), tipRay = new THREE.Raycaster();
      assert(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1, 'Both fork tips stay within the auxiliary image.');
      tipRay.setFromCamera(new THREE.Vector2(projected.x, projected.y), inspectionFeed.camera);
      const hits = tipRay.intersectObjects([inspection.object, inspectedProduct.object], true);
      assert(hits.length, 'The exposed real tine tip has a visible surface.');
      let node = hits[0].object; while (node && node !== forks) node = node.parent;
      assert(node === forks, 'The actual camera ray reaches the exposed fork tip before cargo, chassis or mast; side=' + side + ', first=' + (hits[0].object.name || hits[0].object.type) + '.');
    }
  }
}
inspection.driving.dispose(); inspection.runtime.stop();

// The VR helper shares one canvas and uses the existing rays for both hands.
// Its auxiliary camera never modifies the headset's tracked local pose.
const vr = setup(true), trackingQ = vr.camera.quaternion.clone(), trackingP = vr.camera.position.clone(); assert(vr.driving.mount(vr.record.id));
const vrMonitor = vr.driving.docking, rigPose = vr.cameraRig.matrixWorld.clone(); assert(vrMonitor.element.hidden); assert(vrMonitor.plane.visible); assert.equal(vrMonitor.state.controller, 'both'); assert(vrMonitor.state.isSelectable()); assert(vr.driving.worldPanel.regions.length <= 6); assert(vr.driving.worldPanel.actions.some(([action]) => action === 'controls'));
vrMonitor.state.onSelectStart({uv: new THREE.Vector2(680 / 768, 1 - 30 / 432)}); assert.equal(vrMonitor.page, 'guide');
const leftEdge = vr.driving.worldPanel.plane.position.x - .82 * vr.driving.worldPanel.plane.scale.x / 2, monitorRightEdge = vrMonitor.plane.position.x + .66 * vrMonitor.plane.scale.x / 2; assert(monitorRightEdge < leftEdge - .03, 'The auxiliary screen does not cover the compact physical-cab menu.');
for (let i = 0; i < 4; i++) { vr.driving.command('view'); vr.driving.follow(); }
assert.equal(vr.driving.viewIndex, 0); assert(vr.camera.quaternion.equals(trackingQ)); assert(vr.camera.position.equals(trackingP)); assert(vr.cameraRig.matrixWorld.equals(rigPose));
const beforeVRFeed = vrMonitor.cameraEnabled; vr.driving.command('forkCamera'); assert.equal(vrMonitor.cameraEnabled, !beforeVRFeed); vr.driving.command('forkCamera'); assert.equal(vrMonitor.cameraEnabled, beforeVRFeed); assert(vr.cameraRig.matrixWorld.equals(rigPose)); assert(vr.camera.quaternion.equals(trackingQ)); assert(vr.camera.position.equals(trackingP));
vr.ctx.studioMenuOpen = true; assert(!vrMonitor.state.isSelectable()); const page = vrMonitor.page; vrMonitor.state.onSelectStart({uv: new THREE.Vector2(680/768, 1-30/432)}); assert.equal(vrMonitor.page, page); vr.ctx.studioMenuOpen = false;
const resources = [vrMonitor.plane.geometry, vrMonitor.plane.material, vrMonitor.texture], disposed = new Set(); resources.forEach(resource => resource.addEventListener('dispose', () => disposed.add(resource)));
const monitorStateName = vrMonitor.stateName; delete vr.ctx.raycontrol.removeState; assert(vr.driving.unmount(true)); assert.equal(disposed.size, 3); assert.equal(vr.ctx.raycontrol.states[monitorStateName], undefined); assert.equal(vr.active.size, 0);
assert(vr.camera.quaternion.equals(trackingQ)); assert(vr.camera.position.equals(trackingP));
for (let i = 0; i < 3; i++) { assert(vr.driving.mount(vr.record.id)); assert(vr.driving.unmount(true)); assert.equal(vr.active.size, 0); }
vr.driving.dispose(); vr.runtime.stop();
console.log('Vehicle docking view: separate real fork camera across lift/tilt/parent transforms, C preserves cab/chase and XR tracking, read-only guidance, authoritative traffic-light states, compact capability-aware cab menu and repeated resource cleanup passed.');
