import * as THREE from 'three';

/** r112 exposes targetRaySpace only. Reuse one additional Group per controller
 * for the native gripSpace pose; newer Three versions can provide it directly. */
export function createXRGrip(renderer, controller, index) {
  const managed = typeof renderer.xr.getControllerGrip === 'function';
  const grip = managed ? renderer.xr.getControllerGrip(index) : new THREE.Group();
  if (!managed) {grip.matrixAutoUpdate = false; grip.visible = false;}
  grip.name = 'XR grip · ' + index; grip.userData.xrManagedGrip = managed; grip.userData.editorRuntimeHelper = true;
  controller.userData.gripObject = grip; return grip;
}
export function updateXRGrip(renderer, controller, source, frame) {
  const grip = controller.userData.gripObject; if (!grip) return;
  if (!source) {grip.visible = false; return;}
  if (grip.userData.xrManagedGrip) return;
  const reference = renderer.xr.getReferenceSpace && renderer.xr.getReferenceSpace(); let pose = null;
  if (source.gripSpace && reference && frame && frame.getPose) {
    try {pose = frame.getPose(source.gripSpace, reference);} catch (_) { /* Lost/ended XR frame. */ }
  }
  if (!pose || !pose.transform || !pose.transform.matrix) {grip.visible = false; return;}
  grip.matrix.fromArray(pose.transform.matrix); grip.matrix.decompose(grip.position, grip.quaternion, grip.scale); grip.visible = true; grip.updateMatrixWorld(true);
}
