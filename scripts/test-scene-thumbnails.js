'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {validate, expectedIds, hash, WIDTH, HEIGHT} = require('./validate-scene-thumbnails');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webxr-scene-thumbnail-test-'));
try {
  const directory = path.join(root, 'assets/scene-thumbnails'); fs.mkdirSync(directory, {recursive: true}); fs.mkdirSync(path.join(root, 'assets/public-scenes'), {recursive: true});
  const ids = ['first-scene', 'second-scene'], image = Buffer.alloc(1200, 13);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(image); image.write('IHDR',12); image.writeUInt32BE(WIDTH,16); image.writeUInt32BE(HEIGHT,20);
  const rows = ids.map(id => ({id, file: id + '.png', title: id, method: 'actual-study-factory', recipeVersion: 2, width: WIDTH, height: HEIGHT,
    bytes: image.length, sha256: hash(image), bundleSha256: 'a'.repeat(64), sceneSha256: 'b'.repeat(64), quality: {width: WIDTH, height: HEIGHT, mean: 100, variance: 45, min: 20, max: 150}}));
  const manifest = {format: 'hello-webxr-scene-thumbnails', version: 1, recipeVersion: 2, width: WIDTH, height: HEIGHT, complete: true,
    bundleSha256: 'a'.repeat(64), catalogSha256: 'c'.repeat(64), bytes: image.length * rows.length, scenes: rows};
  const save = () => fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  rows.forEach(row => fs.writeFileSync(path.join(directory, row.file), image)); save();
  fs.writeFileSync(path.join(root, 'assets/public-scenes/catalog.json'), JSON.stringify({scenes: [{id: ids[0]}]}));
  assert.equal(validate(root, {expectedIds: ids}).scenes, 2, 'A restricted catalog may use the full baked framework inventory.');
  manifest.complete = false; save(); assert.throws(() => validate(root, {expectedIds: ids}), /incomplete/); manifest.complete = true;
  manifest.scenes = rows.slice(0,1); save(); assert.throws(() => validate(root, {expectedIds: ids}), /Every framework/); manifest.scenes = rows;
  rows[1].sha256 = 'd'.repeat(64); save(); assert.throws(() => validate(root, {expectedIds: ids}), /Modified scene image/); rows[1].sha256 = hash(image);
  rows[1].quality.variance = 0; save(); assert.throws(() => validate(root, {expectedIds: ids}), /Blank scene image/); rows[1].quality.variance = 45;
  rows[1].file = '../private.png'; save(); assert.throws(() => validate(root, {expectedIds: ids})); rows[1].file = ids[1] + '.png'; save();
  fs.writeFileSync(path.join(directory, 'private.png'), image); assert.throws(() => validate(root, {expectedIds: ids}), /Only declared/); fs.unlinkSync(path.join(directory, 'private.png'));
  fs.writeFileSync(path.join(root, 'assets/public-scenes/catalog.json'), JSON.stringify({scenes: [{id: 'private-user-scene'}]}));
  assert.throws(() => validate(root, {expectedIds: ids}), /unrecognized preview/);
  const actualIds = expectedIds(); assert(actualIds.length > 2); assert.equal(new Set(actualIds).size, actualIds.length);
  assert(actualIds.includes('l-transfer') && actualIds.includes('inspection-sorting') && actualIds.includes('industrial-lab-complete') && actualIds.includes('forklift-training'));
  console.log('Offline scene thumbnails: dynamic framework inventory, restricted catalog, complete coverage, dimensions/hash, path restrictions and blank-image regression checks passed.');
} finally {
  const target = path.resolve(root); if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('webxr-scene-thumbnail-test-')) throw Error('Unexpected thumbnail fixture path.');
  fs.rmSync(target, {recursive: true, force: true});
}
