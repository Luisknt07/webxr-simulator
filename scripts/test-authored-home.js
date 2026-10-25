'use strict';
// Exercise the real editor's Home route across enclosed, authored levels.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const file = path.join(__dirname, 'test-editor-runtime.js'), code = fs.readFileSync(file, 'utf8');
const localRequire = require('node:module').createRequire(file);
const {harness} = new Function('require', '__dirname', code.slice(0, code.indexOf('\nasync function run()')) + '\nreturn {harness};')(localRequire, __dirname);
async function run() {
  const f = harness(), editor = f.editor; await editor.ready;
  const camera = editor.document.addPrimitive(editor.roomId, 'box');
  const view = new THREE.PerspectiveCamera(); view.position.set(6, 5.8, 9); view.lookAt(0, 1, 0);
  editor.document.setTransform(camera, {position: view.position.toArray(), quaternion: view.quaternion.toArray(), scale: [.2, .14, .28]});
  editor.document.setBehaviors(camera, [{type: 'collision', enabled: false}]);
  editor.document.setStudio({entities: [{id: 'interior-view', objectId: camera.userData.editorId, roomId: editor.roomId, type: 'camera', fov: 62}]});
  editor.camera.position.set(-30, 20, -30); editor.safeCameraPosition = editor.camera.position.clone(); editor.safeOrbitTarget = new THREE.Vector3();
  editor.home();
  assert(editor.camera.position.distanceTo(view.position) < 1e-8, 'Home selects the authored interior destination instead of sweeping from a previous roof/exterior view.');
  assert(Math.abs(editor.camera.quaternion.dot(view.quaternion)) > .999999); assert.equal(editor.camera.fov, 62);
  assert(Math.abs(editor.orbit.target.distanceTo(editor.camera.position) - 12) < 1e-8);
  assert(editor.safeCameraPosition.equals(editor.camera.position));
  camera.visible = false; editor.home();
  assert(editor.camera.position.distanceTo(new THREE.Vector3(3.2, 2.8, 4.5)) < 1e-8, 'A hidden camera does not override the ordinary editor view.');
  editor.projectSync.stop();
  console.log('Authored Home: interior camera pose/FOV, deliberate cross-level placement, refreshed collision pose and hidden-camera fallback passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
