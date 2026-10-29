const __layout = require("../../tooling/layout.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');

const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-room-assets.js"), '../src/lib/RoomAssets.js')), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class RoomAssets', 'class RoomAssets');
const requests = [];
function loadAssets(renderer, base, batch, resolve, progress, debug, reject) {
  assert.equal(base, "modules/turismo/assets/");
  assert.equal(debug, false);
  const id = Object.keys(batch)[0];
  requests.push({id, descriptor: batch[id], resolve(value) { batch[id] = value; resolve(); }, reject});
}
const RoomAssets = new Function('THREE', 'loadAssets', source + '\nreturn RoomAssets;')(THREE, loadAssets);
function compressed() {
  const result = new THREE.CompressedTexture([{data: new Uint8Array([1, 2, 3, 4]), width: 4, height: 4}], 4, 4, THREE.RGB_S3TC_DXT1_Format);
  result.encoding = THREE.sRGBEncoding;
  result.generateMipmaps = false;
  result.needsUpdate = true;
  return result;
}
function rgba() {
  const result = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4, THREE.RGBAFormat);
  result.mipmaps = [{data: result.image.data, width: 4, height: 4}];
  result.needsUpdate = true;
  return result;
}

(async () => {
  const descriptors = {
    pano2: {url: 'pano-1-full.basis'}, stereopanoL: {url: 'stereo-left.basis'}, stereopanoR: {url: 'stereo-right.basis'},
    pano3: {url: 'pano-2-full.basis'}, pano2_tex: {url: 'pano-preview.basis'}, hall_model: {url: 'hall.glb'}, doorfx_tex: {url: 'door.basis'}
  };
  const assets = Object.assign({}, descriptors);
  const manager = new RoomAssets({}, assets);
  assert.equal(requests.length, 0, 'Creating deferred dependencies must not start background downloads.');
  const initial = manager.initialAssets();
  assert.equal(initial.pano2, undefined);
  assert.equal(initial.stereopanoL, undefined);
  assert.equal(initial.stereopanoR, undefined);
  assert.equal(initial.hall_model, descriptors.hall_model);
  assert.equal(initial.pano2_tex, descriptors.pano2_tex, 'Small hall previews remain in the initial batch.');
  const placeholder = assets.pano2;
  assert.equal(placeholder.isDataTexture, true);
  assert.equal(placeholder.image.width, 1);
  assert.equal(placeholder.userData.roomAssetId, 'pano2');

  // Copies created before visiting the source room keep their deferred identity,
  // including shader-uniform copies made by Three's own Material.clone().
  const shader = new THREE.ShaderMaterial({uniforms: {pano: {value: placeholder}}});
  const clone = shader.clone().uniforms.pano.value;
  assert.notEqual(clone, placeholder);
  assert.equal(clone.userData.roomAssetId, 'pano2');
  assert.equal(clone.isDataTexture, true);
  const geometry = new THREE.BoxBufferGeometry();
  const actor = new THREE.Mesh(geometry, new THREE.ShaderMaterial({uniforms: {maps: {value: [clone]}}}));
  actor.userData.editorId = 'custom-copied-native-panel';
  const root = new THREE.Group(); root.add(actor);
  const dependencyPromise = manager.prepareDependencies(root);
  const loadPromise = manager.load('pano2');
  assert.equal(manager.load('pano2'), loadPromise, 'Concurrent calls deduplicate the same room texture.');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].descriptor, descriptors.pano2);
  const sourceTexture = compressed();
  requests[0].resolve(sourceTexture);
  await Promise.all([dependencyPromise, loadPromise]);
  assert.equal(assets.pano2, placeholder, 'Native material texture identity must be preserved.');
  [placeholder, clone].forEach(texture => {
    assert.equal(texture.image, sourceTexture.image);
    assert.equal(texture.isCompressedTexture, true);
    assert.equal(texture.isDataTexture, false);
    assert.equal(texture.encoding, sourceTexture.encoding);
    assert.equal(texture.format, sourceTexture.format);
    assert.deepEqual(texture.mipmaps, sourceTexture.mipmaps);
    assert.equal(texture.userData.roomAssetId, 'pano2');
    assert(texture.version > 0);
  });
  const laterClone = clone.clone();
  assert.equal(laterClone.isCompressedTexture, true);
  assert.equal(laterClone.isDataTexture, false);
  assert.equal(laterClone.userData.roomAssetId, 'pano2');
  assert.equal(laterClone.image, sourceTexture.image);
  await manager.prepareDependencies(root);
  assert.equal(requests.length, 1);
  assert.equal(actor.geometry, geometry);
  assert.equal(actor.userData.editorId, 'custom-copied-native-panel');

  // Software-renderer Basis RGBA output follows the same deferred path.
  const stereoPromise = manager.prepareRoom('panoramastereo', new THREE.Group());
  assert.equal(requests.length, 3);
  const left = rgba(), right = rgba();
  requests[1].resolve(left); requests[2].resolve(right);
  await stereoPromise;
  assert.equal(assets.stereopanoL.isDataTexture, true);
  assert.equal(assets.stereopanoL.isCompressedTexture, false);
  assert.equal(assets.stereopanoR.image, right.image);
  assert.deepEqual(assets.stereopanoL.mipmaps, left.mipmaps);

  const failure = manager.load('pano3');
  requests[3].reject(new Error('Temporary connection failure'));
  await assert.rejects(failure, /Temporary connection failure/);
  const retry = manager.load('pano3');
  assert.equal(requests.length, 5);
  requests[4].resolve(rgba());
  await retry;
  assert.equal(assets.pano3.image.width, 4);
  await manager.prepareRoom('hall', new THREE.Group());
  await manager.load('unknown');
  assert.equal(requests.length, 5, 'No room-wide downloads or unknown requests are started incidentally.');
  console.log("Room assets: deferred startup, shared requests, native texture identity, shader copies, compressed/RGBA flags and retry passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
