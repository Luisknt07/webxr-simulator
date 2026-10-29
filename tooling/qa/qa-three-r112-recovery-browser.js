'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
const {run: isolatedRenderer} = require('./qa-three-r112-instancing-browser');
async function run() {
  const report = await isolatedRenderer(async browser => {
    const result = await browser.call(async () => {
      const T = window.__three, results = [], check = (condition, text) => {if (!condition) throw Error(text);};
      const cases = [false, true].flatMap(shadows => [false, true].map(disposeOnLoss => ({shadows, disposeOnLoss, compileRace: false}))).concat([{shadows: true, disposeOnLoss: true, compileRace: true}]);
      for (const {shadows, disposeOnLoss, compileRace} of cases) {
        const renderer = new T.WebGLRenderer({antialias: false}); renderer.setSize(360, 240); renderer.setClearColor(0x19394a); renderer.shadowMap.enabled = shadows;
        document.body.appendChild(renderer.domElement); const gl = renderer.getContext(), extension = gl.getExtension('WEBGL_lose_context'); check(extension, 'Context loss extension unavailable');
        const camera = new T.OrthographicCamera(-4.5, 4.5, 3, -3, .1, 30); camera.position.z = 10;
        const scene = new T.Scene(), light = new T.DirectionalLight(0xffffff, .65); light.position.set(-2, 3, 6); light.castShadow = shadows; light.shadow.mapSize.set(128, 128);
        scene.add(light, new T.AmbientLight(0xffffff, .7));
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; const drawing = canvas.getContext('2d'); drawing.fillStyle = '#cf6f24'; drawing.fillRect(0, 0, 32, 32);
        const texture = new T.CanvasTexture(canvas), material = new T.MeshStandardMaterial({map: texture, color: 0xffffff, roughness: .7}), geometry = new T.BoxBufferGeometry(.8, .8, .5);
        const ordinary = new T.Mesh(geometry, material), a = new T.InstancedMesh(geometry, material, 1), b = new T.InstancedMesh(geometry, material, 1);
        ordinary.position.x = -3; a.setMatrixAt(0, new T.Matrix4()); b.setMatrixAt(0, new T.Matrix4().makeTranslation(3, 0, 0));
        [ordinary, a, b].forEach((object, index) => {object.castShadow = shadows; object.receiveShadow = shadows; object.renderOrder = index; scene.add(object);});
        const floorGeometry = new T.PlaneBufferGeometry(9, 6), floorMaterial = new T.MeshStandardMaterial({color: 0xcdd2d8, roughness: .9}), floor = new T.Mesh(floorGeometry, floorMaterial); floor.position.z = -.6; floor.receiveShadow = shadows; scene.add(floor);
        const pixels = () => [-3, 0, 3].map(x => {const value = new Uint8Array(4); gl.readPixels((x + 4.5) / 9 * 360, 120, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value); return Array.from(value);});
        renderer.render(scene, camera); const before = pixels();
        const event = name => new Promise(resolve => renderer.domElement.addEventListener(name, resolve, {once: true}));
        const lost = event('webglcontextlost');
        if (compileRace) {
          let requested = false;
          material.onBeforeCompile = () => {if (!requested) {requested = true; extension.loseContext();}};
          material.defines = {RECOVERY_COMPILE_RACE: 1}; material.needsUpdate = true;
          // This draw starts while renderer.isContextLost is still false. Loss
          // occurs inside compilation, before its asynchronous DOM event.
          renderer.render(scene, camera); check(requested, 'Race did not enter real shader compilation');
        } else extension.loseContext();
        await lost;
        if (disposeOnLoss) {geometry.dispose(); material.dispose(); texture.dispose(); floorGeometry.dispose(); floorMaterial.dispose(); texture.needsUpdate = true;}
        const restored = event('webglcontextrestored'); setTimeout(() => extension.restoreContext(), 60); await restored;
        await new Promise(resolve => requestAnimationFrame(resolve));
        renderer.render(scene, camera); const after = pixels(), error = gl.getError();
        results.push({shadows, disposeOnLoss, compileRace, before, after, error, programs: renderer.info.programs.length});
        check(error === 0, 'Post-restore GL error: ' + error);
        after.forEach((value, index) => check(value[0] > 70 && value[0] > value[2] * 1.7 && value.every((channel, component) => Math.abs(channel - before[index][component]) <= 2), 'PBR restore changed: ' + JSON.stringify(results.at(-1))));
        geometry.dispose(); material.dispose(); texture.dispose(); floorGeometry.dispose(); floorMaterial.dispose(); if (light.shadow.map) light.shadow.map.dispose(); renderer.dispose();
      }
      return results;
    });
    browser.report.rendererRecovery = result;
    fs.writeFileSync('data/qa-studio/three-r112-recovery-browser.json', JSON.stringify(browser.report, null, 2));
    assert.deepEqual(browser.report.exceptions, []); assert.deepEqual(browser.report.consoleErrors, []); await browser.screenshot('three-r112-context-recovery');
  });
  fs.writeFileSync('data/qa-studio/three-r112-recovery-browser.json', JSON.stringify(report, null, 2));
  console.log('Isolated renderer recovery passed: ' + JSON.stringify(report.rendererRecovery));
}
if (require.main === module) run().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {run};
