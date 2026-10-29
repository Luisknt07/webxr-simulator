/* Read Blender's optional saved-file TEST thumbnail using bounded file reads. */
const fs = require('fs');
const zlib = require('zlib');

const MAX_DIMENSION = 2048;
const MAX_BLOCKS = 100000;

function readExactly(descriptor, size, position) {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = fs.readSync(descriptor, buffer, offset, size - offset, position + offset);
    if (!count) return null;
    offset += count;
  }
  return buffer;
}

function readBlendThumbnail(filename) {
  let descriptor;
  try {
    descriptor = fs.openSync(filename, 'r');
    const fileSize = fs.fstatSync(descriptor).size;
    if (fileSize < 12) return null;
    const header = readExactly(descriptor, 12, 0);
    // Compressed or newer unsupported headers gracefully fall back to an export.
    if (!header || !/^BLENDER[-_][vV]\d{3}$/.test(header.toString('ascii'))) return null;
    const blockHeaderSize = header[7] === 45 ? 24 : 20;
    const littleEndian = header[8] === 118;
    const integer = (buffer, offset) => littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    let position = 12;
    for (let block = 0; block < MAX_BLOCKS && position + blockHeaderSize <= fileSize; block++) {
      const blockHeader = readExactly(descriptor, blockHeaderSize, position);
      if (!blockHeader) return null;
      const code = blockHeader.toString('ascii', 0, 4);
      const length = integer(blockHeader, 4);
      const dataPosition = position + blockHeaderSize;
      if (length > fileSize - dataPosition) return null;
      if (code === 'ENDB') return null;
      if (code === 'TEST') {
        if (length < 8) return null;
        const dimensions = readExactly(descriptor, 8, dataPosition);
        if (!dimensions) return null;
        const width = integer(dimensions, 0);
        const height = integer(dimensions, 4);
        if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
        const pixelLength = width * height * 4;
        if (length !== 8 + pixelLength) return null;
        const rgba = readExactly(descriptor, pixelLength, dataPosition + 8);
        return rgba ? { width, height, rgba } : null;
      }
      position = dataPosition + length;
    }
  } catch (_) {
    // Missing, truncated or unsupported sources must not prevent catalog creation.
    return null;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  return null;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return result;
}

function thumbnailPng(thumbnail) {
  const { width, height, rgba } = thumbnail;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > MAX_DIMENSION || height > MAX_DIMENSION || !Buffer.isBuffer(rgba) || rgba.length !== width * height * 4) {
    throw new Error('Invalid Blender thumbnail dimensions or pixels');
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6; // RGBA, 8 bits per channel.
  const rowSize = width * 4;
  const scanlines = Buffer.alloc(height * (rowSize + 1));
  for (let row = 0; row < height; row++) {
    // Blender starts at the bottom left; PNG starts at the top left.
    rgba.copy(scanlines, row * (rowSize + 1) + 1, (height - row - 1) * rowSize, (height - row) * rowSize);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { readBlendThumbnail, thumbnailPng };
