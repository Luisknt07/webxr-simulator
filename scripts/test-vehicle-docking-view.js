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

// The camera is driven by actual fork world matrices at every articulation,
// not by a duplicated initial-lift/configuration formula.
const desktop = setup(false, true), parent = new THREE.Group(); parent.rotation.y = -.3; parent.position.set(-3, .2, 4); desktop.scene.add(parent); parent.add(desktop.cameraRig);
desktop.root.rotation.y = .7; desktop.root.position.set(3, 0, -5); desktop.scene.updateMatrixWorld(true);
assert(desktop.driving.mount(desktop.record.id)); const rig = desktop.api.rig(desktop.record);
assert.equal(desktop.driving.viewIndex, 0); key(desktop, 'KeyC'); assert.equal(desktop.driving.viewIndex, 1); key(desktop, 'KeyC', false); key(desktop, 'KeyC'); assert.equal(desktop.driving.viewIndex, 2); key(desktop, 'KeyC', false);
for (const pose of [{lift: 0, tilt: 0}, {lift: .72, tilt: .04}, {lift: 2.7, tilt: -.08, sideShift: .08}]) {
  assert(desktop.api.applyPose(desktop.record, Object.assign({}, desktop.v.pose, pose), false)); desktop.driving.follow();
  const eye = desktop.camera.getWorldPosition(new THREE.Vector3()), target = new THREE.Vector3(0, -desktop.config.forkThickness * .25, Math.min(.70, desktop.config.forkLength * .62)).applyMatrix4(rig.forks.matrixWorld);
  const eyeLocal = eye.clone().applyMatrix4(new THREE.Matrix4().getInverse(rig.forks.matrixWorld)); assert(eyeLocal.x < -desktop.config.width/2-.3, 'The inspection camera is laterally outside the body, rather than inside a loaded carton.');
  near(desktop.camera.getWorldDirection(new THREE.Vector3()).dot(target.sub(eye).normalize()), 1);
  assert(desktop.camera.quaternion.equals(new THREE.Quaternion()));
}
assert.match(desktop.driving.viewButton.textContent, /Horquillas/); const commands = desktop.commands.length;
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
inspection.scene.updateMatrixWorld(true); assert(inspection.driving.mount(inspection.record.id)); inspection.driving.command('view'); inspection.driving.command('view');
// Sample actual visible first surfaces at the production wide-screen FOV. An
// unoccluded target alone missed the previous huge wheel at the image edge.
const visible=object=>{for(let node=object;node;node=node.parent)if(!node.visible||node.userData.editorRuntimeHelper)return false;return true;},meshes=[];
[inspection.object,inspectedProduct.object].forEach(root=>root.traverse(node=>{if(node.isMesh&&visible(node))meshes.push(node);}));
const wheelPivots=new Set(inspection.api.rig(inspection.record).wheels.map(wheel=>wheel.pivot)),counts={wheel:0,cargo:0,forks:0},ray=new THREE.Raycaster(),frustumSampleCount=32*18;
for(let y=0;y<18;y++)for(let x=0;x<32;x++){ray.setFromCamera(new THREE.Vector2((x+.5)/32*2-1,1-(y+.5)/18*2),inspection.camera);const first=ray.intersectObjects(meshes,false)[0];if(!first)continue;let node=first.object;while(node&&!wheelPivots.has(node)&&node!==inspectedProduct.object&&node!==inspection.api.rig(inspection.record).forks)node=node.parent;if(wheelPivots.has(node))counts.wheel++;else if(node===inspectedProduct.object)counts.cargo++;else if(node===inspection.api.rig(inspection.record).forks)counts.forks++;}
assert(counts.wheel/frustumSampleCount<.10,'A front wheel cannot fill the inspection frame.');assert(counts.cargo/frustumSampleCount>.10&&counts.forks>0,'The real pallet/cargo and fork surfaces both remain visible in the wide-screen inspection view.');
for (const carried of [false, true]) {
  if (carried) assert(inspection.driving.command('pickup'));
  for (const transform of [{lift: inspection.v.pose.lift, tilt: 0, yaw: 0}, {lift: .8, tilt: .06, yaw: -.7}, {lift: 2.4, tilt: -.06, yaw: .3}]) {
    if (carried) { inspection.object.rotation.y = transform.yaw; inspection.scene.updateMatrixWorld(true); assert(inspection.api.applyPose(inspection.record, Object.assign({}, inspection.v.pose, {lift: transform.lift, tilt: transform.tilt}), false)); }
    inspection.driving.follow(); const eye = inspection.camera.getWorldPosition(new THREE.Vector3());
    const cargoBox = inspectedProduct.bounds.clone().applyMatrix4(inspectedProduct.object.matrixWorld).expandByScalar(.025);
    assert(!cargoBox.containsPoint(eye), 'A full24-box pallet never encloses the inspection camera.');
    const inBody = eye.clone().applyMatrix4(new THREE.Matrix4().getInverse(inspection.object.matrixWorld));
    assert(Math.abs(inBody.x) > inspection.config.width/2+.3, 'The exterior inspection camera does not occupy the chassis or operator seat.');
    assert(eye.y >= inspection.v.originWorld.y + .06, 'Low fork viewing remains above the actual ground plane.');
    const screen = new THREE.Vector3(0, -inspection.config.forkThickness*.25, .05).applyMatrix4(inspection.api.rig(inspection.record).forks.matrixWorld).project(inspection.camera);
    assert(Math.abs(screen.x) < .95 && Math.abs(screen.y) < .95, 'The entry end of the tines remains inside the main viewport.');
    if(!carried){const forks=inspection.api.rig(inspection.record).forks;for(const side of [-1,1]){const point=new THREE.Vector3(side*inspection.config.forkSpread/2,-inspection.config.forkThickness*.25,.07).applyMatrix4(forks.matrixWorld),distance=point.distanceTo(eye),ray=new THREE.Raycaster(eye,point.sub(eye).normalize(),0,distance+.02),hits=ray.intersectObjects([inspection.object,inspectedProduct.object],true);assert(hits.length,'The real tine entry has a visible surface.');let node=hits[0].object;while(node&&node!==forks)node=node.parent;assert.equal(node,forks,'The inspection ray reaches the real fork entry before a carton, chassis or mast can occlude it.');}}
  }
}
inspection.driving.dispose(); inspection.runtime.stop();

// The VR helper shares one canvas and uses the existing rays for both hands.
// It never modifies tracked local pose or adds a camera/render target.
const vr = setup(true), trackingQ = vr.camera.quaternion.clone(), trackingP = vr.camera.position.clone(); assert(vr.driving.mount(vr.record.id));
const vrMonitor = vr.driving.docking, rigPose = vr.cameraRig.matrixWorld.clone(); assert(vrMonitor.element.hidden); assert(vrMonitor.plane.visible); assert.equal(vrMonitor.state.controller, 'both'); assert(vrMonitor.state.isSelectable()); assert.equal(vr.driving.worldPanel.actions.length, 14);
vrMonitor.state.onSelectStart({uv: new THREE.Vector2(680 / 768, 1 - 30 / 432)}); assert.equal(vrMonitor.page, 'guide');
const leftEdge = vr.driving.worldPanel.plane.position.x - .82 / 2, monitorRightEdge = vrMonitor.plane.position.x + .66 / 2; assert(monitorRightEdge < leftEdge - .03, 'The auxiliary screen does not cover the14 existing cockpit actions.');
for (let i = 0; i < 4; i++) { vr.driving.command('view'); vr.driving.follow(); }
assert.equal(vr.driving.viewIndex, 0); assert(vr.camera.quaternion.equals(trackingQ)); assert(vr.camera.position.equals(trackingP)); assert(vr.cameraRig.matrixWorld.equals(rigPose));
vr.ctx.studioMenuOpen = true; assert(!vrMonitor.state.isSelectable()); const page = vrMonitor.page; vrMonitor.state.onSelectStart({uv: new THREE.Vector2(680/768, 1-30/432)}); assert.equal(vrMonitor.page, page); vr.ctx.studioMenuOpen = false;
const resources = [vrMonitor.plane.geometry, vrMonitor.plane.material, vrMonitor.texture], disposed = new Set(); resources.forEach(resource => resource.addEventListener('dispose', () => disposed.add(resource)));
const monitorStateName = vrMonitor.stateName; delete vr.ctx.raycontrol.removeState; assert(vr.driving.unmount(true)); assert.equal(disposed.size, 3); assert.equal(vr.ctx.raycontrol.states[monitorStateName], undefined); assert.equal(vr.active.size, 0);
assert(vr.camera.quaternion.equals(trackingQ)); assert(vr.camera.position.equals(trackingP));
for (let i = 0; i < 3; i++) { assert(vr.driving.mount(vr.record.id)); assert(vr.driving.unmount(true)); assert.equal(vr.active.size, 0); }
vr.driving.dispose(); vr.runtime.stop();
console.log('Vehicle docking view: actual fork camera across lift/tilt/parent transforms, 10Hz read-only contour guidance, authoritative traffic-light states, unchanged14 commands, VR head pose/rays and repeated resource cleanup passed.');
