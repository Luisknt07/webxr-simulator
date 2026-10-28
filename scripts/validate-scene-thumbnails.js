'use strict';
// Built-in Node modules only: the Pages release can validate its baked images
// in a clean checkout without running Chrome, npm, or a scene constructor.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {definitions} = require('./validate-public-scenes'), {ROOM_IDS} = require('../shared/studio-document');
const ROOT = path.resolve(__dirname, '..'), WIDTH = 480, HEIGHT = 320, MAX_BYTES = 8 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function expectedIds(root = ROOT) {
  const alias = id => id === 'lab-transfer-l' ? 'l-transfer' : id === 'lab-sorting' ? 'inspection-sorting' : id;
  return definitions(root).map(scene => alias(scene.id)).concat('industrial-lab-complete', ROOM_IDS.map(id => 'original-' + id));
}
function validate(root = ROOT, options = {}) {
  const expected = options.expectedIds || expectedIds(root), directory = path.join(root, 'assets/scene-thumbnails');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.format, 'hello-webxr-scene-thumbnails'); assert.equal(manifest.version, 1);
  assert(Number.isInteger(manifest.recipeVersion) && manifest.recipeVersion >= 2, 'Use the complete, reviewed thumbnail recipe.');
  assert.equal(manifest.width, WIDTH); assert.equal(manifest.height, HEIGHT); assert.equal(manifest.complete, true, 'Offline scene images are incomplete.');
  assert(Array.isArray(manifest.scenes));
  assert.equal(new Set(expected).size, expected.length, 'The framework inventory has duplicate scene IDs.');
  assert.deepEqual(manifest.scenes.map(scene => scene.id).sort(), expected.slice().sort(), 'Every framework example needs its own offline image.');
  assert.deepEqual(fs.readdirSync(directory).sort(), ['manifest.json'].concat(expected.map(id => id + '.png')).sort(), 'Only declared framework previews belong in the thumbnail directory.');
  for (const field of ['bundleSha256', 'catalogSha256']) assert.match(manifest[field] || '', /^[a-f0-9]{64}$/, field);
  let bytes = 0;
  for (const row of manifest.scenes) {
    assert.match(row.id, /^[a-z0-9-]{1,80}$/); assert.equal(row.file, row.id + '.png');
    assert(typeof row.title === 'string' && row.title.length > 0);
    assert(['actual-study-factory', 'actual-public-world'].includes(row.method), 'Scene previews must come from the actual application: ' + row.id);
    assert.equal(row.recipeVersion, manifest.recipeVersion); assert.equal(row.width, WIDTH); assert.equal(row.height, HEIGHT);
    const image = fs.readFileSync(path.join(directory, row.file)); bytes += image.length;
    assert(image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Invalid PNG: ' + row.id);
    assert.equal(image.toString('ascii', 12, 16), 'IHDR'); assert.equal(image.readUInt32BE(16), WIDTH); assert.equal(image.readUInt32BE(20), HEIGHT);
    assert(image.length > 1000 && image.length < 750000, 'Unexpected thumbnail size: ' + row.id);
    assert.equal(row.bytes, image.length); assert.equal(row.sha256, hash(image), 'Modified scene image: ' + row.id);
    for (const field of ['bundleSha256', 'sceneSha256']) assert.match(row[field] || '', /^[a-f0-9]{64}$/, row.id + ': ' + field);
    const quality = row.quality; assert(quality && quality.width === WIDTH && quality.height === HEIGHT);
    for (const field of ['mean', 'variance', 'min', 'max']) assert(Number.isFinite(quality[field]), row.id + ': quality ' + field);
    assert(quality.max - quality.min > 8 && quality.variance > 3, 'Blank scene image: ' + row.id);
  }
  assert.equal(manifest.bytes, bytes); assert(bytes <= MAX_BYTES, 'The static gallery must stay below 8 MiB encoded.');
  // A later runtime build can preserve the same appearance. Keep the source
  // hashes as provenance instead of claiming that every rebuild rerenders it.
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/public-scenes/catalog.json'), 'utf8'));
  assert(catalog.scenes.every(scene => expected.includes(scene.id)), 'The authorized catalog references an unrecognized preview.');
  return {scenes: expected.length, publishedScenes: catalog.scenes.length, bytes, width: WIDTH, height: HEIGHT, recipeVersion: manifest.recipeVersion};
}
if (require.main === module) { const result = validate(); console.log('Offline scene previews: ' + result.scenes + ' actual images, ' + result.bytes + ' encoded bytes, ready for static publication.'); }
module.exports = {validate, expectedIds, hash, WIDTH, HEIGHT, MAX_BYTES};
