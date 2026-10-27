'use strict';
// Real Chrome, native CDP mouse/keyboard and the compiled production animation.
// No driving.command(), setInput(), synthetic DOM events or manual runtime steps.
// Pointer lock is intentionally outside this test (headless native widget limit).
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
const {startTemporaryServer, withBrowser} = require('./qa-project-workspace-browser');
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'data/qa-studio');
const PASSWORD = 'Temporary-native-vehicle-handling-2026!';
const keys = {W: ['KeyW', 'w', 87], A: ['KeyA', 'a', 65], S: ['KeyS', 's', 83], D: ['KeyD', 'd', 68], F: ['KeyF', 'f', 70], P: ['KeyP', 'p', 80], SPACE: ['Space', ' ', 32]};
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const change = (a, b) => a.map((v, i) => v - b[i]);
const yawDelta = (a, b) => Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw));
const sampleAt = (trace, seconds) => trace.find(s => s.simTime - trace[0].simTime >= seconds) || trace[trace.length - 1];
function assertTrace(trace, label) {
  assert(trace.length > 4, label + ': insufficient actual animation frames.');
  trace.forEach(s => {assert(s.position.every(Number.isFinite)); assert([s.speed, s.steer, s.acceleration, s.wheelAngle, s.simTime].every(Number.isFinite)); assert(!s.blocked, label + ': unexpected collision in the clear test area.');});
}
function smoothness(trace, config) {
  let maxAcceleration = 0, maxJerk = 0, maxYawRate = 0, maxLateralAcceleration = 0, maxSteerRate = 0;
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1], b = trace[i], dt = b.simTime - a.simTime; if (dt < 1e-5) continue;
    maxAcceleration = Math.max(maxAcceleration, Math.abs(b.speed - a.speed) / dt);
    maxYawRate = Math.max(maxYawRate, Math.abs(yawDelta(b, a)) / dt);
    maxLateralAcceleration = Math.max(maxLateralAcceleration, Math.max(Math.abs(a.speed), Math.abs(b.speed)) * Math.abs(yawDelta(b, a)) / dt);
    maxSteerRate = Math.max(maxSteerRate, Math.abs(b.steer - a.steer) / dt);
    // At a reached target the integrator resets acceleration to zero; that
    // terminal snap is not used to claim a continuous physical jerk model.
    if (a.acceleration > .01 && b.acceleration > .01 && b.speed < config.speed - .02) maxJerk = Math.max(maxJerk, Math.abs(b.acceleration - a.acceleration) / dt);
  }
  return {maxAcceleration, maxJerk, maxYawRate, maxLateralAcceleration, maxSteerRate};
}
async function run() {
  const index = process.argv.indexOf('--expected-bundle-sha256'), expected = index < 0 ? null : process.argv[index + 1];
  assert(expected && /^[a-f0-9]{64}$/.test(expected), 'Pass the reviewed compiled build via --expected-bundle-sha256.');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'bundle.js'))).digest('hex'), expected);
  fs.mkdirSync(OUTPUT, {recursive: true}); const fixture = await startTemporaryServer();
  try {
    assert.equal((await fixture.request('/api/studio/register', 'POST', {username: 'qa_vehicle_handling', displayName: 'QA manejo nativo', password: PASSWORD})).status, 201);
    const report = await withBrowser(fixture.origin, async b => {
      b.report.bundleSha256 = expected; b.report.pointerLockCoverage = 'Not exercised: headless Chrome native widget cannot acquire pointer lock. All HUD clicks and driving keys below are trusted native inputs with a free cursor.';
      // Record before the production window capture listener stops propagation.
      await b.send('Page.addScriptToEvaluateOnNewDocument', {source: "window.__qaNativeEvents=[];['keydown','keyup'].forEach(type=>window.addEventListener(type,event=>{if(/^Key[WASDFP]$|^Space$/.test(event.code))__qaNativeEvents.push({type,code:event.code,trusted:event.isTrusted});},true));"});
      await b.navigate('/'); await b.call(async password => {await context.studio.client.login('qa_vehicle_handling', password); await context.studio.client.me(); await context.studio.authenticated();}, PASSWORD); await b.navigate('/editor');
      await b.call(() => {window.__qaCreate = context.editor.studioTools.newProject();}); await b.until(() => b.evaluate('!!document.querySelector(".ed-scene-create[open]")'), 'Creation wizard missing.');
      await b.call(() => {const d = document.querySelector('.ed-scene-create'); d.querySelectorAll('.ed-scene-create-choice')[0].click(); d.querySelector('input').value = 'QA · Manejo del montacargas'; d.querySelector('form').requestSubmit();}); await b.evaluate('__qaCreate'); await b.until(() => b.evaluate('context.editor.active&&!context.editor.busy'), 'Editor did not become ready.');
      await b.call(async () => {
        const e = context.editor; e.document.getObjects(e.roomId).filter(o => o !== e.root && e.document.isNative(o)).forEach(o => {o.visible = false;});
        const actor = await e.perform(() => {const o = e.document.addPrefab(e.roomId, 'vehicle', 'forklift-electric-4w'); e.document.setBehaviors(o, e.document.getBehaviors(o).map(c => c.type === 'vehicle' ? {...c, powered: false, running: false, parkingBrake: true, mode: 'manual', detail: 'high'} : c)); e.document.setTransform(o, {position: [0, 0, 0]}); return o;}); window.__qaVehicleId = actor.userData.editorId; e.select(actor);
        window.__qaNativeEvents = []; document.addEventListener('click', event => {const button = event.target.closest && event.target.closest('[data-vehicle-command]'); if (button) __qaNativeEvents.push({type: event.type, action: button.dataset.vehicleCommand, trusted: event.isTrusted});}, true);
      });
      const mouse = async p => {await b.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x, y: p.y}); await b.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1}); await b.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1});};
      const click = async expression => mouse(await b.until(() => b.call(source => {const el = (0, eval)(source); if (!el || el.hidden || el.disabled) return null; const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y); return r.width && r.height && top && (top === el || el.contains(top)) ? {x, y} : null;}, expression), 'Native click target obscured: ' + expression, 10000));
      const hud = action => click('context.editor.vehicleDriving.hud.querySelector(\'[data-vehicle-command="' + action + '"]\')');
      const held = new Set(), setKey = async (name, down) => {const [code, key, virtual] = keys[name]; await b.send('Input.dispatchKeyEvent', {type: down ? 'keyDown' : 'keyUp', code, key, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual}); down ? held.add(name) : held.delete(name);};
      const releaseKeys = async () => {for (const name of [...held]) await setKey(name, false);};
      const key = async name => {await setKey(name, true); await setKey(name, false);};
      console.log('Handling Chrome: native Play, F, Encender, Marcha and Freno P.');
      await click('context.editor.playButton'); await b.until(() => b.evaluate('!context.editor.active&&context.editor.simulation.running'), 'Native Probar did not start.');
      await b.call(async () => {context.cameraRig.position.set(3, 0, 0); context.cameraRig.quaternion.set(0, 0, 0, 1); context.camera.position.set(0, 1.6, 0); context.camera.rotation.set(0, -Math.PI / 2, 0); context.cameraRig.updateWorldMatrix(true, true); context.resetCollisionPose?.(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));});
      await key('F'); await b.until(() => b.evaluate('context.editor.vehicleDriving.id===__qaVehicleId&&!document.pointerLockElement'), 'Native F did not mount with a usable cursor.');
      await b.call(() => {
        window.__qaSample = () => {
          const e = context.editor, r = e.simulation.records.get(__qaVehicleId), v = r.components.vehicle, rig = v.visualRoot.userData.vehicleRig, vector = () => r.object.position.clone(), forward = r.object.getWorldDirection(vector()).normalize(), wheel = rig.controls.wheel, q = wheel.restQuaternion.clone().inverse().multiply(wheel.object.quaternion), axis = wheel.axis;
          const wheelAngle = 2 * Math.atan2(q.x * axis[0] + q.y * axis[1] + q.z * axis[2], q.w), center = wheel.object.getWorldPosition(vector()), normal = vector().fromArray(axis).applyQuaternion(wheel.object.getWorldQuaternion(r.object.quaternion.clone())), eye = context.camera.getWorldPosition(vector());
          const projectedCenter = center.clone().project(context.camera), marker = wheel.object.localToWorld(vector().set(0, wheel.radius, 0)).project(context.camera), restMarker = wheel.object.parent.localToWorld(vector().set(0, wheel.radius, 0).multiply(wheel.object.scale).applyQuaternion(wheel.restQuaternion).add(wheel.object.position)).project(context.camera);
          const turn = Math.atan2(marker.y - projectedCenter.y, marker.x - projectedCenter.x) - Math.atan2(restMarker.y - projectedCenter.y, restMarker.x - projectedCenter.x), screenWheelTurn = Math.atan2(Math.sin(turn), Math.cos(turn));
          return {wallTime: performance.now(), simTime: e.simulation.time, position: r.object.getWorldPosition(vector()).toArray(), frontAxle: r.object.localToWorld(vector().set(0, v.config.wheelRadius, v.config.wheelbase / 2)).toArray(), forward: forward.toArray(), driverRight: [-forward.z, 0, forward.x], yaw: Math.atan2(forward.x, forward.z), speed: v.actualSpeed, acceleration: v.longitudinalAcceleration || 0, steer: v.steering, wheelAngle, screenWheelTurn, wheelFacesOperator: normal.dot(eye.sub(center)), rearAngles: rig.wheels.filter(w => w.steering).map(w => w.pivot.rotation.y), input: {...v.input}, powered: v.powered, running: v.running, parkingBrake: v.parkingBrake, blocked: v.blocked, distance: v.distance};
        };
        window.__qaTrace = []; window.__qaSampling = true; const sample = () => {if (!__qaSampling) return; __qaTrace.push(__qaSample()); requestAnimationFrame(sample);}; requestAnimationFrame(sample);
      });
      const state = () => b.evaluate('__qaSample()'), wait = (test, message) => b.until(async () => {const s = await state(); return test(s) ? s : null;}, message, 20000);
      const duration = async seconds => {const start = await state(); return wait(s => s.simTime >= start.simTime + seconds, 'Production animation stopped advancing.');};
      const segment = async (label, desired, seconds, shot) => {
        await releaseKeys(); const first = await state(); await b.evaluate('__qaTrace=[]');
        for (const name of desired) await setKey(name, true);
        try {
          await duration(seconds);
          if (shot) {
            // Look down from the same real seat; a level view crops the rim
            // below the HUD. This changes the inspection camera, not physics.
            // CDP represents a top-level −0 as unserializableValue rather than
            // value. Capture it inside JSON so the helper cannot drop it.
            const pitch = await b.call(() => ({value: context.camera.rotation.x, negativeZero: Object.is(context.camera.rotation.x, -0)})); assert(Number.isFinite(pitch.value));
            (b.report.cameraInspections || (b.report.cameraInspections = [])).push({shot, ...pitch});
            await b.call(async () => {context.camera.rotation.x = -.75; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));});
            await b.screenshot(shot);
            await b.call(async value => {context.camera.rotation.x = value; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));}, pitch.value);
          }
          const last = await state(), trace = await b.evaluate('__qaTrace.slice()'); assertTrace(trace, label); return {label, first, last, trace};
        } finally {await releaseKeys();}
      };
      const stop = async () => {await releaseKeys(); await setKey('SPACE', true); try {await wait(s => Math.abs(s.speed) < .003, 'Native Space did not stop.');} finally {await releaseKeys();} await duration(1.2);};
      b.report.config = await b.call(() => ({...context.editor.simulation.records.get(__qaVehicleId).components.vehicle.config})); const c = b.report.config;
      await hud('powerOn'); await wait(s => s.powered && !s.running, 'Encender failed.'); await hud('start'); await wait(s => s.running && s.parkingBrake, 'Marcha failed.'); await hud('parkingBrake'); await wait(s => !s.parkingBrake, 'Freno P did not release.');
      b.report.pedals = await b.call(() => {const r = context.editor.simulation.records.get(__qaVehicleId), result = {}; r.object.traverse(o => {if (o.name === 'Pedal de acelerador' || o.name === 'Pedal de freno') result[o.name] = r.object.worldToLocal(o.getWorldPosition(r.object.position.clone())).toArray();}); return result;});
      assert(b.report.pedals['Pedal de acelerador'][0] < 0 && b.report.pedals['Pedal de freno'][0] > 0, 'Accelerator must be at the driver’s right (−X), brake at the driver’s left (+X).');
      console.log('Handling Chrome: W acceleration and high-speed right turn.');
      b.report.acceleration = await segment('forward acceleration', ['W'], 3.2); const acc = b.report.acceleration, inputTrace = acc.trace.filter(s => s.input.throttle > .5), m = smoothness(inputTrace, c); b.report.acceleration.metrics = m;
      assert(inputTrace.length > 5); assert(acc.last.speed > .8 && acc.last.speed <= c.speed + 1e-5); assert(dot(change(acc.last.position, acc.first.position), acc.first.forward) > .5, 'W must advance towards the mast (+Z), not backwards.');
      assert(sampleAt(inputTrace, .2).speed < .25, 'Acceleration jumps immediately instead of ramping.'); assert(m.maxAcceleration <= c.acceleration + .12); assert(m.maxJerk <= c.accelerationJerk + .2, 'Initial throttle acceleration exceeds its configured jerk ramp.');
      b.report.right = await segment('forward right at speed', ['W', 'D'], 1.4, 'vehicle-handling-right-wheel'); const right = b.report.right, rm = smoothness(right.trace, c); b.report.right.metrics = rm;
      assert(dot(right.last.forward, right.first.driverRight) > .05, 'D must yaw the forward-moving nose to the driver’s right.'); assert(right.last.steer > .05); assert(right.last.wheelAngle < -.05 && right.last.screenWheelTurn < -.05 && right.last.wheelFacesOperator > 0, 'The projected rim must rotate clockwise as seen by the driver for D.'); assert(right.last.rearAngles.every(a => a > .05), 'Rear wheels must counter-steer relative to the nose.');
      assert(rm.maxYawRate <= c.maxYawRate + .06, 'Turn exceeds the configured comfortable yaw limit.'); assert(rm.maxLateralAcceleration <= c.maxLateralAcceleration + .12, 'Turn exceeds the configured lateral acceleration limit.'); assert(rm.maxSteerRate <= c.steerRate + .06, 'Steering moves faster than the configured gradual response.');
      b.report.brake = await segment('service brake', ['SPACE'], 1.8); assert(Math.abs(b.report.brake.last.speed) < .003); assert(b.report.brake.trace.some(s => s.speed > .1), 'Brake test must start in motion.'); await duration(1.2);
      console.log('Handling Chrome: left steering, throttle release, reversal and reverse right.');
      b.report.left = await segment('forward left from stop', ['W', 'A'], 1.6, 'vehicle-handling-left-wheel'); const left = b.report.left;
      assert(dot(left.last.forward, left.first.driverRight) < -.04, 'A must turn left relative to the driver.'); assert(left.last.steer < -.05); assert(left.last.wheelAngle > .05 && left.last.screenWheelTurn > .05, 'A must rotate the projected rim counter-clockwise.'); assert(left.last.rearAngles.every(a => a < -.05)); await stop();
      b.report.coastStart = await segment('accelerate before throttle release', ['W'], 1.5); b.report.coast = await segment('throttle release', [], .65); assert(b.report.coast.first.speed > .2); assert(b.report.coast.last.speed > 0 && b.report.coast.last.speed < b.report.coast.first.speed, 'Releasing W must coast down progressively.');
      const releasedThrottle = b.report.coast.trace.filter(s => Math.abs(s.input.throttle) < .01); assert(releasedThrottle.length > 2); assert(Math.max(...releasedThrottle.map(s => s.speed)) <= releasedThrottle[0].speed + .005, 'A released accelerator must not continue adding propulsive speed.');
      b.report.reversal = await segment('forward to reverse', ['S'], 2.5); const reversal = b.report.reversal;
      assert(reversal.first.speed > 0 && reversal.last.speed < -.15, 'S must brake advance, then reverse.'); assert(reversal.trace.some(s => Math.abs(s.speed) < .04), 'Reversal must pass through rest.');
      const crossing = reversal.trace.findIndex(s => s.speed < -.01), reverseTrace = reversal.trace.slice(crossing); assert(crossing > 0); assert(dot(change(reverseTrace[reverseTrace.length - 1].position, reverseTrace[0].position), reverseTrace[0].forward) < -.05, 'S must reverse along the vehicle’s backward axis.');
      b.report.reverseRight = await segment('reverse right', ['S', 'D'], 1.4, 'vehicle-handling-reverse-wheel'); const rev = b.report.reverseRight;
      assert(rev.last.speed < -.1 && rev.last.steer > .05 && rev.last.wheelAngle < -.05); assert(dot(rev.last.forward, rev.first.driverRight) < -.04, 'With the same right axle input, reversing must reverse the nose yaw.'); await stop();
      console.log('Handling Chrome: native parking brake prevents motion, final power-off.');
      await key('P'); await wait(s => s.parkingBrake, 'Native P did not engage parking brake.'); b.report.parked = await segment('parked throttle interlock', ['W'], .8); assert(Math.abs(b.report.parked.last.speed) < .003); assert(Math.hypot(...change(b.report.parked.last.position, b.report.parked.first.position)) < .002);
      await hud('powerOff'); await wait(s => !s.powered && !s.running, 'Native power-off failed.'); await hud('exit'); await b.until(() => b.evaluate('!context.editor.vehicleDriving.id'), 'Native exit failed.'); await b.evaluate('__qaSampling=false');
      b.report.nativeEvents = await b.evaluate('__qaNativeEvents'); assert(b.report.nativeEvents.length > 30 && b.report.nativeEvents.every(e => e.trusted)); assert(b.report.nativeEvents.some(e => e.type === 'click' && e.action === 'powerOn'));
      assert.equal(await b.evaluate('context.renderer.getContext().getError()'), 0); assert.deepEqual(b.report.exceptions, []); assert.deepEqual(b.report.consoleErrors, []); assert.deepEqual(b.report.apiFailures, []);
    });
    fs.writeFileSync(path.join(OUTPUT, 'vehicle-handling-browser.json'), JSON.stringify(report, null, 2)); assert.deepEqual(fixture.errors, []);
    console.log('PASS trusted native vehicle handling: gradual acceleration, left/right/wheel agreement, limited cornering, coast/reverse, service and parking brakes. Native pointer lock is outside this run.');
  } finally {await fixture.close();}
}
run().catch(error => {console.error(error); process.exitCode = 1;});
