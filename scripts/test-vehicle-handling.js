'use strict';
// Production meshes and runtime. Comfort limits are educational configurable
// parameters, not manufacturer performance data or a tire/stability model.
const assert = require('node:assert/strict'), h = require('./test-vehicle-runtime.js'), vehicles = require('../shared/vehicles.js');
const {THREE} = h, UP = new THREE.Vector3(0, 1, 0), metrics = {};
const near = (a, b, tolerance = 1e-6) => assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function front(f) { f.object.updateMatrixWorld(true); return new THREE.Vector3(0, 0, f.config.wheelbase / 2).applyMatrix4(f.object.matrixWorld); }
function yaw(f) { const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(f.object.getWorldQuaternion(new THREE.Quaternion())); return Math.atan2(forward.x, forward.z); }
function advance(f, seconds, input, hz = 60, observe) {
  for (let frame = 0; frame < Math.round(seconds * hz); frame++) {
    const dt = 1 / hz, before = {speed: f.v.actualSpeed, acceleration: f.v.longitudinalAcceleration, steering: f.v.steering, yaw: yaw(f)};
    f.api.setInput(f.record, typeof input === 'function' ? input(frame, f) : input); f.scene.updateMatrixWorld(true); f.runtime.time += dt; f.api.step(dt);
    if (observe) observe(before, {speed: f.v.actualSpeed, acceleration: f.v.longitudinalAcceleration, steering: f.v.steering, yaw: yaw(f)}, dt, frame);
  }
}
const pair = [];
for (const side of [-1, 1]) {
  const f = h.fixture('forklift-electric-4w', false, false), initial = front(f); advance(f, 2.2, {throttle: 1, steer: side * .6});
  const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(f.object.quaternion), final = front(f);
  assert(Math.sign(direction.x) === -side, 'Positive RIGHT steering turns the nose towards cab-right (-X).');
  assert((final.x - initial.x) * side < 0); assert(final.z > initial.z); near(f.v.pose.steer, f.v.steering);
  const rig = f.api.rig(f.record); rig.wheels.forEach(wheel => { if (wheel.steering) assert(wheel.pivot.rotation.y * side > 0, 'Rear road wheels steer opposite the nose heading.'); });
  pair.push({position: f.object.position.clone(), yaw: yaw(f)}); f.runtime.stop();
}
near(pair[0].position.x, -pair[1].position.x); near(pair[0].position.z, pair[1].position.z); near(pair[0].yaw, -pair[1].yaw);
for (const side of [-1, 1]) {
  const f = h.fixture('forklift-electric-4w', false, false); advance(f, 2, {throttle: -1, steer: side * .6});
  const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(f.object.quaternion), tail = f.object.localToWorld(new THREE.Vector3(0, 0, -f.config.wheelbase / 2));
  assert(nose.x * side > 0, 'Reverse flips chassis yaw for the same rear-axle angle.'); assert(tail.x * side < 0 && tail.z < -f.config.wheelbase / 2, 'Reversing with right steering guides the rear axle towards the driver-right side.'); f.runtime.stop();
}

// Front axle has no lateral slip. The rear/centre must sweep in the opposite
// direction when turning, rather than sliding a centre-based bicycle model.
const geometry = h.fixture('forklift-electric-4w', false, false); geometry.v.actualSpeed = 1; geometry.v.steering = .4; geometry.v.pose.steer = .4;
geometry.api.applyPose(geometry.record, geometry.v.pose, false); const frontBefore = front(geometry), tailBefore = geometry.object.localToWorld(new THREE.Vector3(0, 0, -geometry.config.wheelbase / 2)), beforeYaw = yaw(geometry);
advance(geometry, 1/60, {throttle: 1 / geometry.v.speed, steer: .4 / geometry.config.steerLimit});
const movement = front(geometry).sub(frontBefore), midYaw = (beforeYaw + yaw(geometry)) / 2, lateral = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, midYaw);
near(movement.dot(lateral), 0, 1e-7); assert(geometry.object.localToWorld(new THREE.Vector3(0, 0, -geometry.config.wheelbase / 2)).x > tailBefore.x, 'A right turn really sweeps the tail to the operator-left side.'); geometry.runtime.stop();

const response = h.fixture('forklift-electric-4w', false, false);
advance(response, .5, {steer: 1}); assert(response.v.steering > .20 && response.v.steering < .40, 'Road steering takes time instead of snapping to full lock in .36 s.');
advance(response, 1.4, {steer: 1}); near(response.v.steering, response.config.steerLimit);
advance(response, .5, {steer: -1}); assert(response.v.steering > .2, 'Reversing the wheel cannot instantly cross to the opposite lock.');
advance(response, 2.5, {steer: -1}); near(response.v.steering, -response.config.steerLimit);
advance(response, .3, {}); assert(response.v.steering < -.5); advance(response, 1.2, {}); near(response.v.steering, 0); response.runtime.stop();

const acceleration = h.fixture('forklift-electric-4w', false, false); let maxJerk = 0, maxAcceleration = 0, reachedAt = 0;
// Keep an old project's authored acceleration=1.2: the new jerk policy must
// still improve its start rather than only changing fresh model defaults.
acceleration.v.config.acceleration = 1.2;
advance(acceleration, 4, {throttle: 1}, 60, (before, after, dt, frame) => {
  assert(after.speed >= before.speed - 1e-8); assert(after.speed <= acceleration.v.speed + 1e-8);
  maxAcceleration = Math.max(maxAcceleration, after.acceleration); assert(after.acceleration <= 1.2 + 1e-8);
  if (before.speed < acceleration.v.speed - .05 && after.speed < acceleration.v.speed - .05) {
    maxJerk = Math.max(maxJerk, Math.abs(after.acceleration - before.acceleration) / dt); assert(maxJerk <= acceleration.config.accelerationJerk + 1e-6);
  }
  if (!reachedAt && after.speed > acceleration.v.speed * .95) reachedAt = (frame + 1) * dt;
});
assert(reachedAt > 2.3 && reachedAt < 4, 'Configured 1.2 m/s² starts progressively instead of reaching 2.2 m/s in 1.83 s.');
metrics.acceleration = {maxJerk, maxAcceleration, secondsTo95Percent: reachedAt};
const coasting = acceleration.v.actualSpeed; advance(acceleration, 1, {}); assert(acceleration.v.actualSpeed < coasting && acceleration.v.actualSpeed > .2, 'Releasing throttle provides gradual rolling resistance.');
advance(acceleration, 4, {}); near(acceleration.v.actualSpeed, 0); acceleration.runtime.stop();
const liftOff = h.fixture('forklift-electric-4w', false, false); advance(liftOff, 1.5, {throttle: 1}); const liftOffSpeed = liftOff.v.actualSpeed; assert(liftOff.v.longitudinalAcceleration > 0);
advance(liftOff, .65, {}, 60, (before, after, dt) => { assert(after.speed <= before.speed + 1e-8, 'Lifting off during the acceleration ramp never continues propelling the truck.'); assert(before.speed - after.speed <= liftOff.config.coastDeceleration * dt + 1e-7); });
assert(liftOff.v.actualSpeed < liftOffSpeed); liftOff.runtime.stop();

const turning = h.fixture('forklift-electric-4w', false, false); turning.v.actualSpeed = turning.v.speed; let peakYaw = 0, peakLateral = 0;
advance(turning, 4, {throttle: 1, steer: 1}, 60, (before, after, dt) => {
  const rate = Math.abs(Math.atan2(Math.sin(after.yaw - before.yaw), Math.cos(after.yaw - before.yaw))) / dt;
  peakYaw = Math.max(peakYaw, rate); peakLateral = Math.max(peakLateral, rate * Math.abs(after.speed));
  assert(rate <= turning.config.maxYawRate + .005); assert(rate * Math.abs(after.speed) <= turning.config.maxLateralAcceleration + .01);
});
assert(turning.v.actualSpeed < 1.15, 'A sustained tight turn reduces travel speed, including on existing authored projects.'); metrics.turning = {peakYaw, peakLateral, tightTurnSpeed: turning.v.actualSpeed};
advance(turning, 3, {throttle: 1, steer: 0}, 60, (before, after, dt) => {
  const rate = Math.abs(Math.atan2(Math.sin(after.yaw - before.yaw), Math.cos(after.yaw - before.yaw))) / dt;
  assert(rate <= turning.config.maxYawRate + .005); assert(rate * Math.abs(after.speed) <= turning.config.maxLateralAcceleration + .01, 'Releasing D while holding W remains limited by the real steering rack as it returns.');
}); near(turning.v.steering, 0); assert(turning.v.actualSpeed > metrics.turning.tightTurnSpeed); turning.runtime.stop();

const brake = h.fixture('forklift-electric-4w', false, false); brake.v.actualSpeed = brake.v.speed; let stoppedAt = 0, peakBrake = 0;
advance(brake, 2, {brake: 1}, 60, (before, after, dt, frame) => {
  assert(after.speed <= before.speed + 1e-8 && after.speed >= 0); peakBrake = Math.max(peakBrake, (before.speed - after.speed) / dt); assert(peakBrake <= brake.config.brakeDeceleration + 1e-6);
  if (!stoppedAt && after.speed === 0) stoppedAt = (frame + 1) * dt;
}); assert(stoppedAt > .7 && stoppedAt < 1.6); metrics.brake = {secondsFromMaximum: stoppedAt, peakDeceleration: peakBrake}; brake.runtime.stop();
const reverse = h.fixture('forklift-electric-4w', false, false); reverse.v.actualSpeed = 1.2; let zeroSeen = false, negativeSeen = false;
advance(reverse, 4, {throttle: -1, steer: .4}, 60, (before, after) => { if (after.speed === 0) zeroSeen = true; if (after.speed < 0) { negativeSeen = true; assert(zeroSeen, 'Direction changes must stop at zero before reverse torque.'); } assert(after.speed >= -reverse.config.reverseSpeed - 1e-7); });
assert(negativeSeen); assert(yaw(reverse) > -.1, 'Reverse with the same rear axle angle reverses yaw rather than flipping controls.'); reverse.runtime.stop();

for (const command of ['powerOff', 'emergency', 'pause', 'stop']) {
  const f = h.fixture('forklift-electric-4w', false, false); advance(f, .6, {throttle: 1}); assert(f.v.longitudinalAcceleration > 0); f.api.command(f.record, command); near(f.v.longitudinalAcceleration, 0);
  if (['powerOff', 'emergency', 'pause'].includes(command)) near(f.v.actualSpeed, 0); f.runtime.stop();
}
const loaded = h.fixture('forklift-electric-4w', false, true); assert(loaded.api.pickup(loaded.record)); loaded.api.applyPose(loaded.record, Object.assign({}, loaded.v.pose, {lift: 2}), false);
advance(loaded, 3, {throttle: 1}); assert(loaded.v.actualSpeed <= loaded.v.speed * .18 + 1e-7); loaded.api.command(loaded.record, 'parkingBrake', true); advance(loaded, 1, {throttle: 1}); near(loaded.v.actualSpeed, 0); loaded.runtime.stop();

const rates = [];
for (const hz of [30, 60, 120]) {
  const f = h.fixture('forklift-electric-4w', false, false); advance(f, 3, {throttle: 1, steer: .45}, hz); rates.push({hz, position: f.object.position.clone(), yaw: yaw(f), speed: f.v.actualSpeed, steering: f.v.steering}); f.runtime.stop();
}
rates.forEach(result => { assert(result.position.distanceTo(rates[1].position) < .025); near(result.yaw, rates[1].yaw, .015); near(result.speed, rates[1].speed, .025); near(result.steering, rates[1].steering, .015); }); metrics.frameRates = rates.map(row => ({hz: row.hz, x: row.position.x, z: row.position.z, yaw: row.yaw, speed: row.speed}));
for (const key of ['accelerationJerk', 'coastDeceleration', 'steerRate', 'steerReturnRate', 'maxLateralAcceleration', 'maxYawRate']) {
  const oldProject = vehicles.normalize({variant: 'forklift-electric-4w', acceleration: 1.2}); assert(Number.isFinite(oldProject[key]) && oldProject[key] > 0);
  assert.throws(() => vehicles.normalize({variant: 'forklift-electric-4w', [key]: NaN}));
}
console.log('Vehicle handling: real right/left rear steering, front-axle no-slip/tail swing, bounded steering response, jerk-limited old-project starts, service brake/reverse, elevated-load limits and 30/60/120Hz consistency passed.');
console.log(JSON.stringify(metrics));
