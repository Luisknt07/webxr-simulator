'use strict';

// Pure, deterministic robot-local kinematics. Distances are metres, angles
// radians; the renderer and simulation consume the same mechanical model.
const robots = require('./robots.js');
const PI = Math.PI, EPS = 1e-9;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, n) => a.map(v => v * n);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = a => Math.sqrt(dot(a, a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => mul(a, 1 / Math.max(EPS, norm(a)));
const axis = (i, a) => [i === 0 ? Math.sin(a / 2) : 0, i === 1 ? Math.sin(a / 2) : 0, i === 2 ? Math.sin(a / 2) : 0, Math.cos(a / 2)];
function quat(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function rotate(v, q) {
  const result = quat(quat(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return result.slice(0, 3);
}
const point = value => Array.isArray(value) ? value.slice(0, 3) : [Number(value && value.x) || 0, Number(value && value.y) || 0, Number(value && value.z) || 0];
const objectPoint = p => ({x: p[0], y: p[1], z: p[2]});
const prepared = new WeakMap();
function configuration(value) {
  if (!value || typeof value !== 'object') return robots.normalize({});
  // Geometry/runtime hold stable config objects during a cycle. Invalidate on
  // every mechanical field edit while avoiding full schema parsing per frame.
  const signature = [value.variant, value.family, value.reach, value.length, value.width, value.height, value.baseHeight, value.maxProductDepth, value.jointLimitsJson].join('|');
  const cached = prepared.get(value); if (cached && cached.signature === signature) return cached.config;
  const config = robots.normalize(value); prepared.set(value, {signature, config});
  prepared.set(config, {signature: [config.variant, config.family, config.reach, config.length, config.width, config.height, config.baseHeight, config.maxProductDepth, config.jointLimitsJson].join('|'), config});
  return config;
}

function getDimensions(value) {
  const c = configuration(value), reach = c.reach;
  return {family: c.family, reach, length: c.length, width: c.width, height: c.height, baseHeight: c.baseHeight,
    shoulder: [0, c.baseHeight, 0], upperArm: reach * .52, forearm: reach * .48,
    deltaTop: c.baseHeight + c.height, deltaRadius: reach * .42,
    deltaUpper: reach * .34, deltaLower: reach * .90, deltaEffector: reach * .075,
    toolLength: ['amr', 'agv', 'shuttle', 'mobileSorter'].includes(c.family) ? 0 : .20};
}
function jointDefinitions(value) { return robots.getJointDefinitions(configuration(value)); }
function clampJoints(value, joints) {
  return jointDefinitions(value).map((definition, index) => clamp(Number.isFinite(Number(joints && joints[index])) ? Number(joints[index]) : Number(definition.home) || 0, definition.min, definition.max));
}
function homePose(value) {
  const c = configuration(value), d = getDimensions(c);
  if (c.family === 'delta') return inverse(c, [0, d.deltaTop - d.reach * .72, 0]);
  return forward(c, jointDefinitions(c).map(definition => definition.home || 0));
}
function result(c, joints, p, q, frames, extra) {
  return Object.assign({joints, tcp: objectPoint(p), toolPosition: p.slice(), quaternion: q.slice(), toolQuaternion: q.slice(), frames,
    reached: true, error: 0}, extra || {});
}
function frame(position, quaternion) { return {position: position.slice(), quaternion: quaternion.slice()}; }

function deltaElbows(d, joints) {
  return [0, 1, 2].map(i => {
    const a = i * PI * 2 / 3, radial = [Math.cos(a), 0, Math.sin(a)];
    const base = add(mul(radial, d.deltaRadius), [0, d.deltaTop, 0]);
    const elbow = add(base, add(mul(radial, -d.deltaUpper * Math.cos(joints[i])), [0, -d.deltaUpper * Math.sin(joints[i]), 0]));
    return {base, elbow, radial};
  });
}
function deltaForward(d, joints) {
  const elbows = deltaElbows(d, joints);
  // Each forearm terminates on the translated platform. Removing its radial
  // attachment offset produces three equal-radius spheres for trilateration.
  const centres = elbows.map(e => sub(e.elbow, mul(e.radial, d.deltaEffector)));
  const ex = unit(sub(centres[1], centres[0])), distance = norm(sub(centres[1], centres[0]));
  const p3p1 = sub(centres[2], centres[0]), i = dot(ex, p3p1);
  const ey = unit(sub(p3p1, mul(ex, i))), ez = cross(ex, ey), j = dot(ey, p3p1);
  if (distance < EPS || Math.abs(j) < EPS) return {elbows, valid: false, tcp: [0, d.deltaTop - d.reach * .72, 0]};
  const x = distance / 2, y = (i * i + j * j - 2 * i * x) / (2 * j);
  const z2 = d.deltaLower * d.deltaLower - x * x - y * y;
  const plane = add(centres[0], add(mul(ex, x), mul(ey, y)));
  const a = add(plane, mul(ez, Math.sqrt(Math.max(0, z2)))), b = add(plane, mul(ez, -Math.sqrt(Math.max(0, z2))));
  return {elbows, valid: z2 >= -EPS, tcp: a[1] < b[1] ? a : b};
}

function forward(value, input) {
  const c = configuration(value), d = getDimensions(c), j = clampJoints(c, input), frames = [];
  let p = d.shoulder.slice(), q = [0, 0, 0, 1];
  if (c.family === 'articulated' || c.family === 'palletizer' || c.family === 'mobileManipulator') {
    q = axis(1, j[0]); frames.push(frame(p, q));
    q = quat(q, axis(2, j[1])); frames.push(frame(p, q));
    p = add(p, rotate([d.upperArm, 0, 0], q)); q = quat(q, axis(2, j[2])); frames.push(frame(p, q));
    p = add(p, rotate([d.forearm, 0, 0], q));
    if (c.family === 'palletizer') {
      q = quat(axis(1, j[0] + (j[3] || 0)), axis(2, -PI / 2)); frames.push(frame(p, q));
    } else {
      q = quat(q, axis(0, j[3])); frames.push(frame(p, q));
      q = quat(q, axis(2, j[4])); frames.push(frame(p, q));
      q = quat(q, axis(0, j[5])); frames.push(frame(p, q));
    }
    p = add(p, rotate([d.toolLength, 0, 0], q));
  } else if (c.family === 'cylindrical' || c.family === 'polar') {
    q = axis(1, j[0]); frames.push(frame(p, q));
    if (c.family === 'cylindrical') p[1] += j[1];
    else q = quat(q, axis(2, j[1]));
    frames.push(frame(p, q)); p = add(p, rotate([j[2], 0, 0], q)); frames.push(frame(p, q));
    q = quat(q, axis(2, -PI / 2)); p = add(p, rotate([d.toolLength, 0, 0], q));
  } else if (c.family === 'scara') {
    q = axis(1, j[0]); frames.push(frame(p, q));
    p = add(p, rotate([d.upperArm, 0, 0], q)); q = quat(q, axis(1, j[1])); frames.push(frame(p, q));
    p = add(p, rotate([d.forearm, 0, 0], q)); p[1] -= j[2]; frames.push(frame(p, q));
    q = quat(q, quat(axis(1, j[3]), axis(2, -PI / 2))); frames.push(frame(p, q));
    p = add(p, rotate([d.toolLength, 0, 0], q));
  } else if (c.family === 'cartesian') {
    p = [j[0], c.baseHeight, 0]; frames.push(frame(p, q));
    p[2] = j[1]; frames.push(frame(p, q)); p[1] += j[2]; frames.push(frame(p, q));
    q = axis(2, -PI / 2);
  } else if (c.family === 'delta') {
    const delta = deltaForward(d, j); q = quat(axis(1, j[3] || 0), axis(2, -PI / 2)); p = add(delta.tcp, rotate([d.toolLength, 0, 0], q));
    delta.elbows.forEach(e => frames.push(frame(e.elbow, [0, 0, 0, 1])));
    return result(c, j, p, q, frames, {deltaElbows: delta.elbows, deltaPlatform: delta.tcp.slice(), reached: delta.valid, error: delta.valid ? 0 : Infinity});
  } else if (c.family === 'mobileSorter') {
    const deck = c.baseHeight + c.height + .025, tilted = axis(2, j[1]);
    p = add([0, deck, 0], rotate([j[0], 0, 0], tilted)); q = quat(tilted, axis(2, -PI / 2));
    frames.push(frame(p, tilted)); frames.push(frame([0, deck, 0], tilted));
  } else if (c.family === 'shuttle') {
    p = [j[0] || 0, c.baseHeight + .2, 0]; frames.push(frame(p, q)); q = axis(2, -PI / 2);
  } else {
    p = [0, c.baseHeight + c.height + .025, 0]; q = axis(2, -PI / 2);
  }
  return result(c, j, p, q, frames);
}

function inverse(value, target, seed) {
  const c = configuration(value), d = getDimensions(c);
  const targetPoint = point(target && target.position ? target.position : target), desired = target && (target.quaternion || target.toolQuaternion);
  const initial = Array.isArray(seed) ? seed : seed && seed.joints || [], joints = jointDefinitions(c).map((definition, index) => Number.isFinite(initial[index]) ? initial[index] : definition.home || 0);
  if (c.family === 'articulated' || c.family === 'palletizer' || c.family === 'mobileManipulator') {
    const targetOrientation = desired || axis(2, -PI / 2), wristPoint = sub(targetPoint, rotate([d.toolLength, 0, 0], targetOrientation));
    const xz = Math.hypot(wristPoint[0], wristPoint[2]), y = wristPoint[1] - c.baseHeight;
    const cosElbow = clamp((xz * xz + y * y - d.upperArm * d.upperArm - d.forearm * d.forearm) / (2 * d.upperArm * d.forearm), -1, 1);
    const limits = jointDefinitions(c), choices = [];
    for (const radialSign of [1, -1]) for (const elbowSign of [-1, 1]) {
      const candidate = joints.slice(), radial = xz * radialSign;
      candidate[0] = fitAngle(Math.atan2(-wristPoint[2], wristPoint[0]) + (radialSign < 0 ? PI : 0), limits[0], initial[0]);
      candidate[2] = elbowSign * Math.acos(cosElbow);
      candidate[1] = fitAngle(Math.atan2(y, radial) - Math.atan2(d.forearm * Math.sin(candidate[2]), d.upperArm + d.forearm * Math.cos(candidate[2])), limits[1], initial[1]);
      const clamped = clampJoints(c, candidate), effectiveRadius = d.upperArm * Math.cos(clamped[1]) + d.forearm * Math.cos(clamped[1] + clamped[2]);
      const effectiveY = d.upperArm * Math.sin(clamped[1]) + d.forearm * Math.sin(clamped[1] + clamped[2]);
      const predicted = [Math.cos(clamped[0]) * effectiveRadius, c.baseHeight + effectiveY, -Math.sin(clamped[0]) * effectiveRadius];
      const distance = norm(sub(predicted, wristPoint));
      const preference = initial.length ? clamped.slice(0, 3).reduce((sum, angle, index) => sum + Math.pow(angle - initial[index], 2), 0) : (elbowSign < 0 ? 0 : .1) + (radialSign < 0 ? .2 : 0);
      let wristError = 0;
      if (c.family === 'articulated' || c.family === 'mobileManipulator') {
        const wrist = solveWrist(quat(axis(1, clamped[0]), axis(2, clamped[1] + clamped[2])), targetOrientation, limits, initial);
        clamped.splice(3, 3, ...wrist.joints); wristError = wrist.error;
      } else if (desired) clamped[3] = fitAngle(yawOfDownQuaternion(desired) - clamped[0], limits[3], initial[3]);
      choices.push({joints: clamped, score: (distance + wristError) * 100000 + preference});
    }
    choices.sort((a, b) => a.score - b.score); joints.splice(0, joints.length, ...choices[0].joints);
  } else if (c.family === 'cylindrical' || c.family === 'polar') {
    const radial = Math.hypot(targetPoint[0], targetPoint[2]), y = targetPoint[1] - c.baseHeight;
    joints[0] = Math.atan2(-targetPoint[2], targetPoint[0]);
    if (c.family === 'cylindrical') { joints[1] = y + d.toolLength; joints[2] = radial; }
    else {
      joints[2] = Math.sqrt(Math.max(0, radial * radial + y * y - d.toolLength * d.toolLength));
      joints[1] = Math.atan2(y, radial) + Math.atan2(d.toolLength, joints[2]);
    }
  } else if (c.family === 'scara') {
    const x = targetPoint[0], z = -targetPoint[2];
    const limits = jointDefinitions(c), beta = Math.acos(clamp((x * x + z * z - d.upperArm * d.upperArm - d.forearm * d.forearm) / (2 * d.upperArm * d.forearm), -1, 1));
    const choices = [-1, 1].map(sign => {
      const elbow = clamp(sign * beta, limits[1].min, limits[1].max), angle = fitAngle(Math.atan2(z, x) - Math.atan2(d.forearm * Math.sin(elbow), d.upperArm + d.forearm * Math.cos(elbow)), limits[0], initial[0]);
      const xx = d.upperArm * Math.cos(angle) + d.forearm * Math.cos(angle + elbow), zz = d.upperArm * Math.sin(angle) + d.forearm * Math.sin(angle + elbow);
      return {angle, elbow, score: Math.hypot(xx - x, zz - z) * 100000 + Math.pow(angle - (initial[0] || 0), 2) + Math.pow(elbow - (initial[1] || 0), 2)};
    }).sort((a, b) => a.score - b.score);
    joints[0] = choices[0].angle; joints[1] = choices[0].elbow;
    joints[2] = c.baseHeight - targetPoint[1] - d.toolLength;
    if (desired) joints[3] = fitAngle(yawOfDownQuaternion(desired) - joints[0] - joints[1], limits[3], initial[3]);
  } else if (c.family === 'cartesian') {
    joints[0] = targetPoint[0]; joints[1] = targetPoint[2]; joints[2] = targetPoint[1] - c.baseHeight;
  } else if (c.family === 'delta') {
    let possible = true; const platformPoint = add(targetPoint, [0, d.toolLength, 0]);
    for (let i = 0; i < 3; i++) {
      const angle = i * PI * 2 / 3, radial = [Math.cos(angle), 0, Math.sin(angle)];
      const base = add(mul(radial, d.deltaRadius), [0, d.deltaTop, 0]);
      const v = sub(add(platformPoint, mul(radial, d.deltaEffector)), base);
      const a = -dot(v, radial), b = -v[1], h = Math.hypot(a, b);
      const rhs = (d.deltaUpper * d.deltaUpper + dot(v, v) - d.deltaLower * d.deltaLower) / (2 * d.deltaUpper);
      if (h < EPS || Math.abs(rhs) > h + 1e-8) possible = false;
      joints[i] = Math.atan2(b, a) - Math.acos(clamp(rhs / Math.max(EPS, h), -1, 1));
    }
    if (desired) joints[3] = fitAngle(yawOfDownQuaternion(desired), jointDefinitions(c)[3], initial[3]);
    const output = forward(c, joints); output.error = norm(sub(output.toolPosition, targetPoint));
    output.reached = possible && output.reached && output.error < .002;
    if (desired) {
      output.orientationError = 2 * Math.acos(clamp(Math.abs(dot(output.quaternion, desired)), -1, 1));
      output.reached = output.reached && output.orientationError < .002;
    }
    return output;
  } else if (c.family === 'mobileSorter') {
    joints[1] = initial[1] || 0;
    if (desired) { const local = quat(desired, axis(2, PI / 2)); joints[1] = 2 * Math.atan2(local[2], local[3]); }
    const offset = [targetPoint[0], targetPoint[1] - c.baseHeight - c.height - .025, targetPoint[2]];
    joints[0] = dot(offset, rotate([1, 0, 0], axis(2, joints[1])));
  } else if (c.family === 'shuttle') joints[0] = targetPoint[0];
  const output = forward(c, joints); output.error = norm(sub(output.toolPosition, targetPoint)); output.reached = output.error < .002;
  if (desired) {
    output.orientationError = 2 * Math.acos(clamp(Math.abs(dot(output.quaternion, desired)), -1, 1));
    output.reached = output.reached && output.orientationError < .002;
  }
  return output;
}

function fitAngle(angle, limit, preferred = 0) {
  const choices = [angle - 4 * PI, angle - 2 * PI, angle, angle + 2 * PI, angle + 4 * PI].filter(value => value >= limit.min - EPS && value <= limit.max + EPS);
  choices.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
  return choices.length ? clamp(choices[0], limit.min, limit.max) : clamp(angle, limit.min, limit.max);
}
function solveWrist(beforeWrist, orientation, limits, initial) {
  const relative = quat([-beforeWrist[0], -beforeWrist[1], -beforeWrist[2], beforeWrist[3]], orientation);
  const x = relative[0], y = relative[1], z = relative[2], w = relative[3];
  const beta = Math.acos(clamp(1 - 2 * (y * y + z * z), -1, 1));
  let candidates;
  if (Math.abs(Math.sin(beta)) > 1e-7) {
    const a = Math.atan2(2 * (x * z - y * w), 2 * (x * y + z * w));
    const c = Math.atan2(2 * (x * z + y * w), -2 * (x * y - z * w));
    candidates = [[a, beta, c], [a + PI, -beta, c + PI]];
  } else {
    const roll = 2 * Math.atan2(x, w);
    candidates = [initial[3] || 0, limits[3].min, limits[3].max, 0].map(a => [a, beta, roll - a]);
  }
  return candidates.map(values => {
    const joints = values.map((angle, index) => fitAngle(angle, limits[index + 3], initial[index + 3]));
    const actual = quat(quat(axis(0, joints[0]), axis(2, joints[1])), axis(0, joints[2]));
    const error = 2 * Math.acos(clamp(Math.abs(dot(actual, relative)), -1, 1));
    const preference = joints.reduce((sum, angle, index) => sum + Math.pow(angle - (initial[index + 3] || 0), 2), 0);
    return {joints, error, score: error * 100000 + preference};
  }).sort((a, b) => a.score - b.score)[0];
}
function yawOfDownQuaternion(q) {
  const yaw = quat(q, axis(2, PI / 2)); return 2 * Math.atan2(yaw[1], yaw[3]);
}

function validatePose(value, pose) {
  const c = configuration(value), definitions = jointDefinitions(c);
  if (!pose || !Array.isArray(pose.joints) || pose.joints.length !== definitions.length ||
    pose.joints.some((joint, index) => !Number.isFinite(joint) || joint < definitions[index].min - 1e-7 || joint > definitions[index].max + 1e-7)) throw new Error('La postura del robot no coincide con sus ejes o recorridos.');
  if (pose.open !== undefined && (!Number.isFinite(pose.open) || pose.open < 0 || pose.open > 1) ||
    pose.gripSpan !== undefined && (!Number.isFinite(pose.gripSpan) || pose.gripSpan < 0 || pose.gripSpan > Math.hypot(c.maxProductWidth, c.maxProductHeight, c.maxProductDepth) + 1e-6)) throw new Error('La apertura de la herramienta del robot es inválida.');
  const derived = forward(c, pose.joints), p = pose.tcp;
  if (!p || ![p.x, p.y, p.z].every(Number.isFinite) || norm(sub(point(p), derived.toolPosition)) > 1e-6 ||
    !Array.isArray(pose.quaternion) || pose.quaternion.length !== 4 || !pose.quaternion.every(Number.isFinite) || Math.abs(dot(pose.quaternion, pose.quaternion) - 1) > 1e-6 ||
    1 - Math.abs(dot(pose.quaternion, derived.quaternion)) > 1e-7 || !derived.reached) throw new Error('El TCP del robot no corresponde a su postura articular.');
  return Object.assign({}, pose, derived);
}

module.exports = {getDimensions, jointDefinitions, clampJoints, forward, inverse, homePose, validatePose};
