import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const finitePoint = point => point && [point.x, point.y, point.z].every(Number.isFinite);
const visible = object => {for (let node = object; node; node = node.parent) if (!node.visible || node.userData.editorGeometryReplaced) return false; return true;};

/** Shared native/public teleport. No museum asset, audio context or controller
 * model is required. The tracked headset is never repositioned directly. */
export default class Teleport {
  constructor(ctx) {
    this.ctx = ctx; this.active = false; this.hit = false; this.disposed = false; this.surfaces = [];
    this.teleportEntity = new THREE.Group(); this.teleportEntity.name = 'XR teleport destination';
    this.teleportEntity.userData.editorRuntimeHelper = true;
    this.teleportHitGeometry = new THREE.Group(); this.teleportHitGeometry.visible = false;
    this.material = new THREE.MeshBasicMaterial({color: 0x54f1d4, transparent: true, opacity: .95, depthWrite: false, side: THREE.DoubleSide});
    for (const [inside, outside] of [[.28, .33], [.075, .10]]) {
      const ring = new THREE.Mesh(new THREE.RingBufferGeometry(inside, outside, 40), this.material);
      ring.rotation.x = -Math.PI / 2; ring.renderOrder = 10; this.teleportHitGeometry.add(ring);
    }
    this.ballColliding = new THREE.Mesh(new THREE.SphereBufferGeometry(.025, 10, 6), this.material);
    this.ballColliding.visible = false; this.ballColliding.renderOrder = 10;
    this.arcGeometry = new THREE.BufferGeometry(); this.arcGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(34 * 3), 3));
    this.arcMaterial = new THREE.LineBasicMaterial({color: 0x54f1d4, transparent: true, opacity: .9, depthWrite: false});
    this.arc = new THREE.Line(this.arcGeometry, this.arcMaterial); this.arc.visible = false; this.arc.frustumCulled = false; this.arc.renderOrder = 9;
    this.teleportEntity.add(this.teleportHitGeometry, this.ballColliding, this.arc); ctx.scene.add(this.teleportEntity);
    this.raycaster = new THREE.Raycaster(); this.normalMatrix = new THREE.Matrix3();
    this.origin = new THREE.Vector3(); this.direction = new THREE.Vector3(); this.previous = new THREE.Vector3(); this.next = new THREE.Vector3();
    this.startSound = this.sound('teleport_a_snd', true); this.endSound = this.sound('teleport_b_snd', false);
  }
  sound(name, loop) {
    const buffer = this.ctx.assets && this.ctx.assets[name];
    if (!this.ctx.audioListener || !buffer) return null;
    const sound = new THREE.Audio(this.ctx.audioListener); sound.setBuffer(buffer); sound.setLoop(loop); return sound;
  }
  play(sound) {if (sound && !sound.isPlaying) {try {sound.play();} catch (_) { /* Audio permission is optional. */ }}}
  pause(sound) {if (sound && sound.isPlaying) sound.pause();}
  blocked() {
    const ctx = this.ctx, editor = ctx.editor, xr = ctx.renderer && ctx.renderer.xr, session = xr && xr.getSession && xr.getSession();
    return this.disposed || !ctx.vrMode || !xr || !xr.isPresenting || !session || ctx.xrEntryPending || ctx.xrExitPending ||
      ctx.drivingVehicle || ctx.publicDialogOpen || ctx.studioMenuOpen || ctx.voicePanelOpen || ctx.assistantPanelOpen || ctx.externalDevicePanelOpen ||
      ctx.roomTransition || ctx.goto !== null && ctx.goto !== undefined || session.visibilityState && session.visibilityState !== 'visible' ||
      editor && (editor.active || editor.initializing || editor.loadingProject || editor.busy || editor.creatingScene || editor.document && editor.document.loading);
  }
  cancel() {
    this.active = false; this.hit = false; this.aimController = null; this.aimPoint = null;
    this.teleportHitGeometry.visible = this.ballColliding.visible = this.arc.visible = false; this.pause(this.startSound);
  }
  headPosition() {
    const ctx = this.ctx; ctx.cameraRig.updateWorldMatrix(true, true);
    const xr = ctx.renderer && ctx.renderer.xr;
    if (ctx.vrMode && xr && xr.getCamera) return new THREE.Vector3().setFromMatrixPosition(xr.getCamera(ctx.camera).matrixWorld);
    return ctx.camera.getWorldPosition(new THREE.Vector3());
  }
  eyeHeight(head = this.headPosition()) {
    const ctx = this.ctx, rig = ctx.cameraRig.getWorldPosition(new THREE.Vector3());
    // A local reference space puts the standing eye in the rig's floor offset.
    return ctx.vrMode && ctx.xrReferenceSpaceType === 'local' ? 1.65 : THREE.Math.clamp(head.y - rig.y, .6, 2.3);
  }
  destination(targetPoint, head) {return new THREE.Vector3(targetPoint.x, targetPoint.y + this.eyeHeight(head), targetPoint.z);}
  validDestination(eye, eyeHeight = this.eyeHeight()) {
    const world = this.ctx.collisionWorld;
    return finitePoint(eye) && (!world || world.canOccupyCapsule(eye, {radius: .25, height: eyeHeight, eyeHeight}));
  }
  show(point, allowed, active) {
    this.hit = allowed; this.material.color.setHex(allowed ? 0x54f1d4 : 0xf07469); this.arcMaterial.color.copy(this.material.color);
    this.teleportHitGeometry.visible = true; this.teleportHitGeometry.position.copy(point); this.teleportHitGeometry.position.y += .018;
    this.teleportHitGeometry.scale.setScalar(active ? 1 : .7); this.ballColliding.visible = false;
  }
  onSelectStart() {
    if (this.aimController || this.blocked()) return false;
    this.active = true; this.pause(this.endSound); this.play(this.startSound); return true;
  }
  onHoverLeave() {if (!this.aimController) this.cancel();}
  onHover(hitPoint, active) {
    if (this.aimController) return;
    if (this.blocked() || !finitePoint(hitPoint)) {this.cancel(); return;}
    this.show(hitPoint, this.validDestination(this.destination(hitPoint, this.headPosition())), active);
  }
  onSelectEnd(targetPoint) {
    if (this.aimController) return false;
    if (this.blocked() || !finitePoint(targetPoint)) {this.cancel(); return false;}
    const head = this.headPosition(), height = this.eyeHeight(head), destination = this.destination(targetPoint, head);
    const allowed = this.validDestination(destination, height); this.cancel(); if (!allowed) return false;
    const rig = this.ctx.cameraRig, desiredRig = rig.getWorldPosition(new THREE.Vector3()).add(destination.sub(head));
    rig.position.copy(rig.parent ? rig.parent.worldToLocal(desiredRig) : desiredRig); rig.updateWorldMatrix(true, true);
    if (this.ctx.resetCollisionPose) this.ctx.resetCollisionPose(); this.play(this.endSound); return true;
  }
  teleportEnabled(object) {
    const data = object.userData || {}, list = data.editorBehaviors || data.editorDefaultBehaviors || [];
    return list.some(config => config && config.type === 'teleport' && config.enabled !== false) || data.editorInteraction && data.editorInteraction.type === 'teleport';
  }
  refreshSurfaces() {
    const ctx = this.ctx, world = ctx.collisionWorld, document = ctx.editor && ctx.editor.document || world && world.document;
    const root = world && world.root || document && document.getRoot && document.getRoot(ctx.roomId || ctx.editor && ctx.editor.roomId || 'hall');
    const surfaces = new Set();
    if (root) root.traverse(object => {if (this.teleportEnabled(object) && visible(object)) surfaces.add(object);});
    for (const state of ctx.raycontrol && ctx.raycontrol.currentStates || []) {
      if (state === this.rayState || !state.teleport && !/^teleport/i.test(state.name || '')) continue;
      for (const object of Array.isArray(state.colliderMesh) ? state.colliderMesh : [state.colliderMesh]) if (object && visible(object)) surfaces.add(object);
    }
    this.surfaces = Array.from(surfaces); this.surfaceRoot = root; this.surfaceChildren = root && root.children.length;
    if (this.rayState) this.rayState.colliderMesh = this.surfaces; return this.surfaces;
  }
  installRayState() {
    const ray = this.ctx.raycontrol; if (!ray || this.rayState) return;
    this.stateName = 'xr-browser-teleport';
    this.rayState = {controller: 'primary', vrOnly: true, teleport: true, colliderMesh: [], consumeSelect: true,
      isSelectable: hit => !this.blocked() && this.walkableHit(hit),
      onHover: (hit, active) => this.onHover(hit.point, active), onHoverLeave: () => this.onHoverLeave(),
      onSelectStart: () => this.onSelectStart(), onSelectEnd: hit => this.onSelectEnd(hit.point)};
    ray.addState(this.stateName, this.rayState, true);
  }
  walkableHit(hit) {
    const object = hit && (hit.actualObject || hit.object); if (!object || !hit.face || !visible(object)) return false;
    this.normalMatrix.getNormalMatrix(object.matrixWorld);
    return hit.face.normal.clone().applyMatrix3(this.normalMatrix).normalize().dot(UP) > .65;
  }
  tick() {
    if (this.blocked()) {this.cancel(); return;}
    const root = this.ctx.collisionWorld && this.ctx.collisionWorld.root;
    if (!this.surfaces.length || root !== this.surfaceRoot || root && root.children.length !== this.surfaceChildren) this.refreshSurfaces();
  }
  beginAim(controller) {
    if (this.blocked() || !controller || !visible(controller) || controller.userData && (controller.userData.grabbing || controller.userData.vehicleCabGrip)) return false;
    this.cancel(); this.refreshSurfaces(); if (!this.surfaces.length) return false;
    this.aimController = controller; this.active = true; this.play(this.startSound); return this.updateAim(controller);
  }
  updateAim(controller) {
    if (this.blocked() || this.aimController !== controller || !visible(controller)) {this.cancel(); return false;}
    controller.updateWorldMatrix(true, false); this.origin.setFromMatrixPosition(controller.matrixWorld);
    this.direction.set(0, 0, -1).transformDirection(controller.matrixWorld); this.previous.copy(this.origin);
    const positions = this.arcGeometry.attributes.position, world = this.ctx.collisionWorld;
    let count = 1, hit = null; positions.setXYZ(0, this.previous.x, this.previous.y, this.previous.z);
    for (let index = 1; index <= 32; index++) {
      const t = index * .055;
      this.next.copy(this.origin).addScaledVector(this.direction, 6 * t); this.next.y -= 4.9 * t * t;
      const length = this.next.distanceTo(this.previous);
      this.raycaster.set(this.previous, this.direction.copy(this.next).sub(this.previous).normalize()); this.raycaster.far = length;
      const matches = this.raycaster.intersectObjects(this.surfaces, true).filter(value => this.walkableHit(value));
      hit = matches[0] || null; const end = hit ? hit.point : this.next;
      // The same physical collision world prevents an arc going through racks,
      // walls or equipment into a hidden floor on the other side.
      if (world && world.rayBlocked && world.rayBlocked(this.previous, end)) {hit = null; positions.setXYZ(count++, end.x, end.y, end.z); break;}
      positions.setXYZ(count++, end.x, end.y, end.z); if (hit) break;
      this.previous.copy(this.next);
      this.direction.set(0, 0, -1).transformDirection(controller.matrixWorld);
    }
    positions.needsUpdate = true; this.arcGeometry.setDrawRange(0, count); this.arc.visible = true;
    this.aimPoint = hit && hit.point.clone();
    const allowed = !!hit && this.validDestination(this.destination(hit.point, this.headPosition()));
    if (hit) this.show(hit.point, allowed, true); else {this.hit = false; this.teleportHitGeometry.visible = false; this.arcMaterial.color.setHex(0xf07469);}
    return true;
  }
  endAim(controller, confirm = true) {
    if (this.aimController !== controller) return false;
    const point = confirm && !this.blocked() && visible(controller) && this.hit && this.aimPoint && this.aimPoint.clone(); this.cancel();
    return point ? this.onSelectEnd(point) : false;
  }
  dispose() {
    if (this.disposed) return; this.cancel(); this.disposed = true;
    const ray = this.ctx.raycontrol;
    if (ray && this.rayState && ray.states[this.stateName] === this.rayState) {ray.deactivateState(this.stateName); delete ray.states[this.stateName];}
    const geometries = new Set(); this.teleportEntity.traverse(object => {if (object.geometry) geometries.add(object.geometry);});
    geometries.forEach(value => value.dispose()); this.material.dispose(); this.arcMaterial.dispose();
    this.pause(this.endSound); if (this.teleportEntity.parent) this.teleportEntity.parent.remove(this.teleportEntity);
    this.surfaces = []; if (this.ctx.teleport === this) delete this.ctx.teleport;
  }
}
