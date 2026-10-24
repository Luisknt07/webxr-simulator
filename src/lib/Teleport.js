import {rayMaterial} from "./RayControl.js";
import * as THREE from 'three';

export default class Teleport {
  constructor(ctx, mesh) {
    this.ctx = ctx;

    // Holder for all the
    this.teleportEntity = new THREE.Group();

    this.active = false;

    this.teleportHitGeometry = ctx.assets['teleport_model'].scene.getObjectByName('goal');
    this.teleportHitGeometry.material = rayMaterial;

    this.teleportHitGeometry.renderOrder = 10;

    this.ballColliding = ctx.assets['teleport_model'].scene.getObjectByName('glow');
    this.ballColliding.material = new THREE.MeshBasicMaterial({
      color: 0x00257b,
      map: ctx.assets['glow_tex'],
      transparent: true,
      blending: THREE.AdditiveBlending
    });

    this.ballColliding.renderOrder = 10;


    this.ballColliding.visible = false;

    this.teleportEntity.add(this.ballColliding);

    this.teleportHitGeometry.visible = false;

    this.teleportHitGeometry.position.set(-2, 0, -2);

    this.teleportEntity.add(this.teleportHitGeometry);

    this.ctx.scene.add(this.teleportEntity);

    // sounds
    this.startSound = new THREE.Audio(ctx.audioListener);
    this.startSound.setBuffer(ctx.assets['teleport_a_snd']);
    this.startSound.setLoop(true);
    this.startSound.pause();

    this.endSound = new THREE.Audio(ctx.audioListener);
    this.endSound.setBuffer(ctx.assets['teleport_b_snd']);
    this.endSound.setLoop(false);
    this.endSound.pause();
  }


  onSelectStart(evt) {
    //if (evt.target === this.ctx.controllers[0])
    this.active = true;
    this.endSound.pause();
    this.startSound.play();
  }

  onHoverLeave() {
    this.ballColliding.visible = false;
    this.teleportHitGeometry.visible = false;
    this.startSound.pause();
  }

  headPosition() {
    this.ctx.cameraRig.updateMatrixWorld(true);
    const xr = this.ctx.renderer && this.ctx.renderer.xr;
    if (this.ctx.vrMode && xr && xr.getCamera) {
      return new THREE.Vector3().setFromMatrixPosition(xr.getCamera(this.ctx.camera).matrixWorld);
    }
    return this.ctx.camera.getWorldPosition(new THREE.Vector3());
  }

  destination(targetPoint, head) {
    return new THREE.Vector3(targetPoint.x, head.y, targetPoint.z);
  }

  validDestination(eye) {
    if (!this.ctx.collisionWorld) return true;
    const rig = this.ctx.cameraRig.getWorldPosition(new THREE.Vector3());
    const eyeHeight = this.ctx.vrMode ? THREE.Math.clamp(eye.y - rig.y, 0.6, 2.3) : 1.6;
    return this.ctx.collisionWorld.canOccupyCapsule(eye, {radius: 0.25, height: eyeHeight, eyeHeight});
  }

  onHover(hitPoint, active) {
    const allowed = this.validDestination(this.destination(hitPoint, this.headPosition()));
    this.hit = allowed;
    if (active && allowed) {
      this.teleportHitGeometry.visible = true;
      this.teleportHitGeometry.position.copy(hitPoint);
      this.ballColliding.visible = false;
    } else {
      this.teleportHitGeometry.visible = false;
      this.ballColliding.visible = true;
      this.ballColliding.position.copy(hitPoint);
      this.ballColliding.material.color.setHex(allowed ? 0x00257b : 0xb52222);
    }
  }

  onSelectEnd(targetPoint) {
    const head = this.headPosition();
    const destination = this.destination(targetPoint, head);
    const allowed = this.validDestination(destination);
    this.teleportHitGeometry.visible = false;
    this.ballColliding.visible = false;
    this.active = false;
    this.startSound.pause();
    if (!allowed) return false;

    // A teleport may cross an obstacle, but its full destination must be free.
    // Move the rig rather than changing the pose reported by the VR headset.
    const rig = this.ctx.cameraRig;
    const desiredRig = rig.getWorldPosition(new THREE.Vector3()).add(destination.sub(head));
    rig.position.copy(rig.parent ? rig.parent.worldToLocal(desiredRig) : desiredRig);
    rig.updateMatrixWorld(true);
    if (this.ctx.resetCollisionPose) this.ctx.resetCollisionPose();
    this.endSound.play();
    return true;
  }
}
