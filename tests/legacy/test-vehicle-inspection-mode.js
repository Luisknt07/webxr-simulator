'use strict';
// Presentation decisions use world proximity and verified custody. No DOM,
// camera, vehicle command, route-progress or inventory substitute is involved.
const assert = require('node:assert/strict');
const InspectionMode = require('../../modules/logistica-industrial/functions/montacargas/runtime/VehicleInspectionMode.js').default;
const policy = new InspectionMode();
const source = {id: 'source-pallet', position: [0, 1.4, 0]}, destination = {id: 'drop:rack-cell', position: [15, 2, 0]};
const sourceBefore = JSON.stringify(source), destinationBefore = JSON.stringify(destination);
const update = (x, changes = {}) => policy.update({position: [x, 0, 0], target: source, entryId: '', ...changes});

assert.equal(update(6), 'layout', 'Travel begins with the complete installation map.');
assert.equal(update(2.001), 'layout');
assert.equal(update(2), 'inspection', 'A camera activates at a reachable pallet mouth.');
assert.equal(update(2.5), 'inspection', 'Small approach corrections cannot flicker between displays.');
assert.equal(update(2.8), 'inspection');
assert.equal(update(2.801), 'layout');
assert.equal(update(2.5), 'layout', 'Reentry uses the smaller approach distance.');
assert.equal(update(0, {position: [0, 30, 0]}), 'inspection', 'Elevated rack locations use horizontal approach distance.');

// A real pickup reparents the pallet to the forks. Keep the last fixed source
// while backing out, then switch to the destination rather than following it.
assert.equal(update(.4, {entryId: 'held-pallet', target: destination}), 'inspection');
assert.deepEqual(policy.latch, {id: source.id, position: source.position});
for (const x of [1, 2, 2.7]) assert.equal(update(x, {entryId: 'held-pallet', target: destination}), 'inspection');
assert.equal(update(3, {entryId: 'held-pallet', target: destination}), 'layout');
assert.equal(policy.latch, null);
assert.equal(update(8, {entryId: 'held-pallet', target: destination}), 'layout', 'A loaded truck does not remain in inspection for its entire journey.');
assert.equal(update(12.9, {entryId: 'held-pallet', target: destination}), 'layout');
assert.equal(update(13, {entryId: 'held-pallet', target: destination}), 'inspection');

// After a real release, an immediately eligible deposited pallet must not
// replace the fixed unloading point until both forks have withdrawn.
assert.equal(update(14.5, {entryId: '', target: null}), 'inspection');
assert.deepEqual(policy.latch, {id: destination.id, position: destination.position});
assert.notEqual(policy.latch.position, destination.position, 'The unload latch owns a fixed copy of world coordinates.');
assert.equal(update(13, {target: null}), 'inspection');
assert.equal(update(12.1, {target: null}), 'layout');
assert.equal(policy.latch, null);

assert.equal(update(8, {mirror: true}), 'rear', 'Explicit rear view works independently of pallet proximity.');
assert.equal(update(8), 'layout', 'Returning from the mirror resumes automatic navigation.');
assert.equal(update(0, {forceLayout: true}), 'layout');
assert.equal(update(0, {forceLayout: true, mirror: true}), 'layout', 'The explicit plan control takes precedence over rear view.');
assert.equal(update(0), 'inspection');
assert.equal(update(0, {automatic: false}), 'layout');
assert.equal(update(0, {automatic: false, mirror: true}), 'layout', 'Disabling inspection does not secretly render a camera.');
assert.equal(update(0), 'inspection');
assert.equal(update(0, {entryId: 'another-load', target: destination}), 'inspection');
assert(policy.latch);
assert.equal(update(0, {available: false}), 'layout');
assert.equal(policy.latch, null); assert.equal(policy.target, null); assert.equal(policy.entryId, '');
assert.equal(update(8), 'layout');
assert.equal(update(0, {target: {id: 'bad', position: [NaN, 0, 0]}}), 'layout');
assert.equal(update(0, {position: null}), 'layout');
assert.equal(JSON.stringify(source), sourceBefore); assert.equal(JSON.stringify(destination), destinationBefore);
console.log('Inspection policy: proximity hysteresis, fixed pickup/unload latches, loaded travel, rear override, forced plan, unavailable reset and immutable inputs passed.');
