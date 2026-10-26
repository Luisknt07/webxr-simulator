'use strict';
// Deterministic ONNX graph conversion, not training. Apache-2.0 model source and
// all learned TensorProto bytes remain intact. See assets/ai/README.md.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const ORIGINAL_SHA = '85f36ff88cc504a24af5e0602148bc56a8aa09a58eca8c0da2756f3e8186035e';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function varint(value) { let n = BigInt(value), bytes = []; do { let byte = Number(n & 127n); n >>= 7n; if (n) byte |= 128; bytes.push(byte); } while (n); return Buffer.from(bytes); }
function fields(buffer) {
  const result = []; let offset = 0;
  const read = () => { let value = 0n, shift = 0n, byte; do { assert(offset < buffer.length); byte = buffer[offset++]; value |= BigInt(byte & 127) << shift; shift += 7n; assert(shift <= 70n); } while (byte & 128); return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value; };
  while (offset < buffer.length) { const start = offset, key = Number(read()), field = key >>> 3, wire = key & 7; let value;
    if (wire === 0) value = read();
    else if (wire === 2) { const length = Number(read()); assert(length >= 0 && offset + length <= buffer.length); value = buffer.subarray(offset, offset + length); offset += length; }
    else if (wire === 5 || wire === 1) { const length = wire === 5 ? 4 : 8; value = buffer.subarray(offset, offset + length); offset += length; }
    else throw new Error('Unsupported protobuf wire type ' + wire);
    result.push({field, wire, value, raw: buffer.subarray(start, offset)});
  } return result;
}
const bytes = (field, value) => { value = Buffer.isBuffer(value) ? value : Buffer.from(value); return Buffer.concat([varint(field * 8 + 2), varint(value.length), value]); };
const integer = (field, value) => Buffer.concat([varint(field * 8), varint(value)]);
function dynamicValueInfo(buffer, output) {
  return Buffer.concat(fields(buffer).map(field => {
    if (field.field !== 2) return field.raw;
    const type = Buffer.concat(fields(field.value).map(tensorType => {
      if (tensorType.field !== 1) return tensorType.raw;
      const tensor = Buffer.concat(fields(tensorType.value).map(shape => {
        if (shape.field !== 2) return shape.raw;
        let dimension = 0;
        const dimensions = fields(shape.value).map(dim => { if (dim.field !== 1) return dim.raw; const index = dimension++; return index < 2 ? dim.raw : bytes(1, bytes(2, (index === 2 ? 'height' : 'width') + (output ? '_x3' : ''))); });
        assert.equal(dimension, 4); return bytes(2, Buffer.concat(dimensions));
      })); return bytes(1, tensor);
    })); return bytes(2, type);
  }));
}
function convert(original) {
  assert.equal(sha(original), ORIGINAL_SHA, 'Only the pinned official model can be converted.');
  const model = fields(original), graphField = model.find(field => field.field === 7), graph = fields(graphField.value), nodes = graph.filter(field => field.field === 1);
  const operations = nodes.map(node => fields(node.value).find(field => field.field === 4).value.toString()); assert.deepEqual(operations, ['Conv', 'Relu', 'Conv', 'Relu', 'Conv', 'Relu', 'Conv', 'Constant', 'Reshape', 'Transpose', 'Constant', 'Reshape']);
  // Original output is N x 1 x 3H x 3W. With one output channel, its two
  // reshapes and transpose are exactly DepthToSpace DCR with block size three.
  const block = bytes(5, Buffer.concat([bytes(1, 'blocksize'), integer(3, 3), integer(20, 2)]));
  const shuffle = bytes(1, Buffer.concat([bytes(1, '15'), bytes(2, 'output'), bytes(3, 'HELLO_Dynamic_PixelShuffle'), bytes(4, 'DepthToSpace'), block]));
  let nodeIndex = 0;
  const transformed = Buffer.concat(graph.map(field => {
    if (field.field === 1) { const index = nodeIndex++; return index < 7 ? field.raw : index === 7 ? shuffle : Buffer.alloc(0); }
    if ((field.field === 11 || field.field === 12) && ['input', 'output'].includes(fields(field.value).find(value => value.field === 1).value.toString())) return bytes(field.field, dynamicValueInfo(field.value, field.field === 12));
    return field.raw;
  }));
  const retained = fields(transformed).filter(field => field.field === 5), weights = graph.filter(field => field.field === 5); assert.equal(retained.length, 8); retained.forEach((field, index) => assert(field.raw.equals(weights[index].raw), 'Learned parameter bytes must remain exact.'));
  const notice = 'Modified by HELLO Studio: spatial metadata made dynamic; fixed PixelShuffle reshapes/transpose replaced by mathematically equivalent DepthToSpace(blocksize=3) for single-channel output. Learned parameters unchanged. Original ONNX Model Zoo Apache-2.0 weights SHA256 ' + ORIGINAL_SHA;
  const result = Buffer.concat(model.filter(field => field.field !== 6).map(field => field.field === 7 ? bytes(7, transformed) : field.raw).concat(bytes(6, notice)));
  return {buffer: result, originalSha256: ORIGINAL_SHA, sha256: sha(result), parameterTensors: weights.map(field => { const tensor = fields(field.value); return {name: tensor.find(value => value.field === 8).value.toString(), sha256: sha(field.value)}; })};
}
if (require.main === module) { const root = path.join(__dirname, '../assets/ai/models'), result = convert(fs.readFileSync(path.join(root, 'super-resolution-10.onnx'))); fs.writeFileSync(path.join(root, 'super-resolution-espcn-x3-dynamic.onnx'), result.buffer); const {buffer, ...manifest} = result; fs.writeFileSync(path.join(root, 'conversion.json'), JSON.stringify(manifest, null, 2) + '\n'); console.log('Equivalent dynamic model prepared; eight learned tensors preserved. SHA256 ' + result.sha256); }
module.exports = {convert, fields};
