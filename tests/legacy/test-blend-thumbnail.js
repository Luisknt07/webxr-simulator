const __layout = require("../../tooling/layout.cjs");
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { readBlendThumbnail, thumbnailPng } = require('../../tooling/maintenance/blend-thumbnail');
const { generateCatalog } = require('../../tooling/assets/generate-asset-catalog');

const directory = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'hello-webxr-blend-previews-')));
const pixels = Buffer.from([
  255, 0, 0, 255, 0, 255, 0, 255, // Bottom row.
  0, 0, 255, 255, 255, 255, 255, 128 // Top row, including alpha.
]);

function blendFixture(options = {}) {
  const pointerSize = options.pointerSize || 8;
  const littleEndian = options.littleEndian !== false;
  const blockHeaderSize = pointerSize === 8 ? 24 : 20;
  const writeInteger = (buffer, value, offset) => littleEndian ? buffer.writeUInt32LE(value, offset) : buffer.writeUInt32BE(value, offset);
  const renderHeader = Buffer.alloc(blockHeaderSize);
  renderHeader.write('REND');
  writeInteger(renderHeader, 4, 4);
  const testHeader = Buffer.alloc(blockHeaderSize);
  testHeader.write('TEST');
  writeInteger(testHeader, options.blockLength === undefined ? 8 + pixels.length : options.blockLength, 4);
  const dimensions = Buffer.alloc(8);
  writeInteger(dimensions, options.width === undefined ? 2 : options.width, 0);
  writeInteger(dimensions, options.height === undefined ? 2 : options.height, 4);
  return Buffer.concat([
    Buffer.from('BLENDER' + (pointerSize === 8 ? '-' : '_') + (littleEndian ? 'v' : 'V') + '280'),
    renderHeader, Buffer.from([1, 2, 3, 4]), testHeader, dimensions, pixels
  ]);
}

function save(name, buffer) {
  const filename = __layout.map(path.join(directory, name));
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, buffer);
  return filename;
}

try {
  for (const pointerSize of [4, 8]) {
    for (const littleEndian of [true, false]) {
      const filename = save('test-' + pointerSize + '-' + littleEndian + '.blend', blendFixture({ pointerSize, littleEndian }));
      const thumbnail = readBlendThumbnail(filename);
      assert.strictEqual(thumbnail.width, 2);
      assert.strictEqual(thumbnail.height, 2);
      assert.deepStrictEqual(thumbnail.rgba, pixels);
    }
  }
  const thumbnail = readBlendThumbnail(__layout.map(path.join(directory, 'test-8-true.blend')));
  const png = thumbnailPng(thumbnail);
  assert.strictEqual(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.strictEqual(png.readUInt32BE(16), 2);
  assert.strictEqual(png.readUInt32BE(20), 2);
  const compressedLength = png.readUInt32BE(33);
  const scanlines = zlib.inflateSync(png.subarray(41, 41 + compressedLength));
  assert.deepStrictEqual(scanlines, Buffer.concat([
    Buffer.from([0]), pixels.subarray(8, 16), Buffer.from([0]), pixels.subarray(0, 8)
  ]), 'PNG rows must be flipped vertically without changing RGBA channels');
  assert.throws(() => thumbnailPng({ width: 2, height: 2, rgba: Buffer.alloc(15) }), /Invalid/);

  for (const fixture of [
    Buffer.alloc(5),
    Buffer.from('INVALID-v280'),
    zlib.gzipSync(blendFixture()),
    blendFixture().subarray(0, -1),
    blendFixture({ width: 0 }),
    blendFixture({ width: 0xffffffff }),
    blendFixture({ height: 2049 }),
    blendFixture({ blockLength: 8 }),
    blendFixture({ blockLength: 0xffffffff })
  ]) {
    assert.strictEqual(readBlendThumbnail(save('malformed.blend', fixture)), null);
  }
  assert.strictEqual(readBlendThumbnail(__layout.map(path.join(directory, 'missing.blend'))), null);

  const catalogRoot = __layout.map(path.join(directory, 'catalog'));
  fs.mkdirSync(catalogRoot);
  for (const name of ['angel', 'hall', 'hall_empty', 'hall_for_hubs', 'ambiguous']) {
    fs.mkdirSync(__layout.map(path.join(catalogRoot, 'blender')), { recursive: true });
    fs.writeFileSync(__layout.map(path.join(catalogRoot, 'blender', name + '.blend')), blendFixture());
  }
  for (const name of ['angel.min.glb', 'hall.glb', 'variants/hall_empty.glb', 'ambiguous.glb', 'ambiguous.min.glb']) {
    const filename = __layout.map(path.join(catalogRoot, name));
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, 'fixture');
  }
  let entries = generateCatalog(catalogRoot);
  const sources = new Map(entries.filter(entry => entry.kind === 'source').map(entry => [entry.name, entry]));
  assert.strictEqual(sources.get('angel.blend').previewPath, 'angel.min.glb');
  assert.strictEqual(sources.get('hall_empty.blend').previewPath, 'variants/hall_empty.glb');
  assert.strictEqual(sources.get('hall_for_hubs.blend').previewPath, undefined, 'Variants must never reuse a similarly named model');
  assert.strictEqual(sources.get('ambiguous.blend').previewPath, undefined, 'Ambiguous exports must not be guessed');
  for (const entry of sources.values()) {
    assert.match(entry.thumbnailPath, /^editor-previews\/[a-zA-Z0-9_-]+\.png$/);
    assert(fs.existsSync(__layout.map(path.join(catalogRoot, entry.thumbnailPath))));
  }
  const thumbnailPath = __layout.map(path.join(catalogRoot, sources.get('hall.blend').thumbnailPath));
  const timestamp = fs.statSync(thumbnailPath).mtimeMs;
  entries = generateCatalog(catalogRoot);
  assert.strictEqual(fs.statSync(thumbnailPath).mtimeMs, timestamp, 'Unchanged thumbnails must not trigger watcher reloads');
  assert.strictEqual(entries.length, 10, 'Generated previews and the generated catalog must stay out of the asset catalog');

  const actualBlends = fs.readdirSync(__layout.map(path.resolve(__layout.oldDir("scripts/test-blend-thumbnail.js"), '../assets/blender'))).filter(name => /\.blend$/.test(name));
  for (const name of actualBlends) {
    const readSync = fs.readSync;
    let bytesRead = 0;
    let actual;
    try {
      fs.readSync = function (...args) {
        const count = readSync.apply(fs, args);
        bytesRead += count;
        return count;
      };
      actual = readBlendThumbnail(__layout.map(path.resolve(__layout.oldDir("scripts/test-blend-thumbnail.js"), '../assets/blender', name)));
    } finally {
      fs.readSync = readSync;
    }
    assert(actual, name + ' must provide its original saved Blender thumbnail');
    assert.strictEqual(actual.rgba.length, actual.width * actual.height * 4);
    assert(bytesRead < 70000, name + ' thumbnail extraction must avoid loading the whole source');
  }
  console.log('Blender thumbnail tests passed (32/64-bit, endianness, PNG orientation, malformed bounds, export matching, real sources).');
} finally {
  assert.strictEqual(path.dirname(__layout.map(path.resolve(directory))), __layout.map(path.resolve(os.tmpdir())));
  assert(path.basename(directory).startsWith('hello-webxr-blend-previews-'));
  fs.rmSync(directory, { recursive: true, force: true });
}
