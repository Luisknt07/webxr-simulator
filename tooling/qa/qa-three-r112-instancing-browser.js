const __layout = require("../layout.cjs");
'use strict';
// Isolated renderer regression. Uses the production webpack loader against the
// pinned dependency; it does not compile the application or open a database.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https'), webpack = require('webpack');
const {withBrowser} = require('./qa-public-publication-browser');
const ROOT = __layout.map(path.resolve(__layout.oldDir("scripts/qa-three-r112-instancing-browser.js"), '..')), OUTPUT = __layout.map(path.join(ROOT, 'data/qa-studio'));

async function run(action) {
  const temporary = fs.mkdtempSync(__layout.map(path.join(os.tmpdir(), 'hello-renderer-compat-')));
  const entry = __layout.map(path.join(temporary, 'entry.js'));
  fs.writeFileSync(entry, 'import * as THREE from ' + JSON.stringify(__layout.map(path.join(ROOT, 'node_modules/three/build/three.module.js'))) + '; window.__three = THREE; window.__threeReady = true;');
  let server;
  try {
    const config = require('../build/webpack.legacy.cjs')[0];
    await new Promise((resolve, reject) => webpack({mode: 'development', context: ROOT, entry, devtool: false,
      output: {filename: 'compat.js', path: temporary, hashFunction: 'sha256'}, module: {rules: [config.module.rules[0]]}, resolve: {modules: [__layout.map(path.join(ROOT, 'node_modules'))]}},
    (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({all: false, errors: true}))) : resolve()));
    const certificate = fs.readFileSync(__layout.map(path.join(ROOT, 'node_modules/webpack-dev-server/ssl/server.pem')));
    server = https.createServer({key: certificate, cert: certificate}, (request, response) => {
      if (request.url === '/compat.js') {response.writeHead(200, {'Content-Type': 'application/javascript'}); fs.createReadStream(__layout.map(path.join(temporary, 'compat.js'))).pipe(response);}
      else if (request.url === '/') {response.writeHead(200, {'Content-Type': 'text/html'}); response.end('<!doctype html><title>Renderer compatibility regression</title><style>body{margin:0;background:#111;color:#eee;font:20px sans-serif}canvas{width:900px;height:600px}pre{margin:20px}</style><script src="compat.js"></script>');}
      else {response.writeHead(204); response.end();}
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fs.mkdirSync(OUTPUT, {recursive: true});
    const origin = 'https://localhost:' + server.address().port;
    const report = await withBrowser(origin, async browser => {
      await browser.send('Page.navigate', {url: origin + '/'});
      await browser.until(() => browser.evaluate('window.__threeReady === true'), 'Isolated renderer module did not load.');
      if (action) {await action(browser); return;}
      const result = await browser.call(() => {
        const T = window.__three, check = (condition, message) => {if (!condition) throw Error(message);};
        check(T.REVISION === '112', 'Unexpected Three revision');
        const renderer = new T.WebGLRenderer({antialias: false}), gl = renderer.getContext();
        renderer.setSize(900, 600); renderer.setClearColor(0x070a10); renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
        document.body.appendChild(renderer.domElement);
        const alive = new Set(), created = [], deleted = [], originalCreate = gl.createBuffer.bind(gl), originalDelete = gl.deleteBuffer.bind(gl);
        gl.createBuffer = function () {const buffer = originalCreate(); alive.add(buffer); created.push(buffer); return buffer;};
        gl.deleteBuffer = function (buffer) {if (buffer) {alive.delete(buffer); deleted.push(buffer);} return originalDelete(buffer);};
        const scene = new T.Scene(), camera = new T.OrthographicCamera(-4.5, 4.5, 3, -3, .1, 30);
        camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
        scene.add(new T.AmbientLight(0xffffff, .8));
        const light = new T.DirectionalLight(0xffffff, .5); light.position.set(-3, 5, 6); light.castShadow = true;
        Object.assign(light.shadow.camera, {left: -5, right: 5, top: 4, bottom: -4}); light.shadow.mapSize.set(128, 128); scene.add(light);
        const customUniform = {value: 1}, hooks = [];
        const material = new T.MeshStandardMaterial({color: 0xf52b22, roughness: .7});
        material.onBeforeCompile = shader => {shader.uniforms.compatGain = customUniform; shader.fragmentShader = 'uniform float compatGain;\n' + shader.fragmentShader.replace('#include <dithering_fragment>', 'gl_FragColor.rgb *= compatGain;\n#include <dithering_fragment>'); hooks.push(shader);};
        const geometry = new T.BoxBufferGeometry(.8, .8, .5);
        const ordinary = new T.Mesh(geometry, material), batchA = new T.InstancedMesh(geometry, material, 1), batchB = new T.InstancedMesh(geometry, material, 1);
        ordinary.position.set(-3, 0, 0); batchA.setMatrixAt(0, new T.Matrix4().makeTranslation(0, 0, 0)); batchB.setMatrixAt(0, new T.Matrix4().makeTranslation(3, 0, 0));
        for (const [index, object] of [ordinary, batchA, batchB].entries()) {object.castShadow = true; object.receiveShadow = true; object.renderOrder = index; scene.add(object);}
        const floorGeometry = new T.PlaneBufferGeometry(9, 6), floorMaterial = new T.MeshStandardMaterial({color: 0x889099, roughness: 1}), floor = new T.Mesh(floorGeometry, floorMaterial);
        floor.position.z = -.6; floor.receiveShadow = true; scene.add(floor);
        const target = new T.WebGLRenderTarget(360, 240);
        const frame = () => {renderer.setRenderTarget(target); renderer.render(scene, camera);};
        const pixel = x => {const result = new Uint8Array(4); renderer.readRenderTargetPixels(target, Math.round((x + 4.5) / 9 * 360), 120, 1, 1, result); return Array.from(result);};
        frame();
        const red = [-3, 0, 3].map(pixel);
        for (const value of red) check(value[0] > value[2] * 2 && value[0] > 80, 'Shared geometry batch missing or red material changed: ' + value);
        check(hooks.length === 2, 'Expected precisely one shader callback per instancing variant: ' + hooks.length);
        check(hooks.every(shader => shader.uniforms.compatGain === customUniform), 'Custom uniform ownership was lost');
        const programs = renderer.info.programs.length, hookCount = hooks.length, initialBuffers = alive.size;
        for (let index = 0; index < 80; index++) {
          ordinary.renderOrder = index % 2 ? 4 : 0; batchA.renderOrder = index % 2 ? 1 : 3; batchB.renderOrder = 2; frame();
        }
        check(renderer.info.programs.length === programs && hooks.length === hookCount, 'Mesh/instance flips recompile programs');
        material.color.setHex(0x143cf2); frame(); const blue = [-3, 0, 3].map(pixel);
        for (const value of blue) check(value[2] > value[0] * 2 && value[2] > 80, 'Color mutation did not reach both program variants: ' + value);
        customUniform.value = .4; frame(); const dimmed = [-3, 0, 3].map(pixel);
        dimmed.forEach((value, index) => check(value[2] < blue[index][2] * .65, 'Shared custom uniform stopped updating'));
        customUniform.value = 1;
        material.defines = {COMPAT_REVISION: 1}; material.needsUpdate = true; frame();
        check(hooks.length === hookCount + 2, 'Material revision was not applied to both variants');
        check(renderer.info.programs.length === programs, 'Replacing material revision leaked old programs');
        check(material === ordinary.material && material === batchA.material && material === batchB.material, 'Material was cloned');
        check(gl.getError() === gl.NO_ERROR, 'WebGL error while switching batches');
        // Base geometry has index, position, normal, uv plus one matrix buffer
        // for each batch. All six must be deleted, exactly once, on disposal.
        scene.remove(ordinary, batchA, batchB);
        const beforeDispose = alive.size, deleteStart = deleted.length;
        geometry.dispose();
        check(beforeDispose - alive.size === 6, 'Instance buffers not released with shared geometry: ' + (beforeDispose - alive.size));
        check(deleted.length - deleteStart === 6 && new Set(deleted.slice(deleteStart)).size === 6, 'A geometry buffer was deleted twice');
        const steadyBuffers = alive.size;
        for (let index = 0; index < 24; index++) {
          const g = new T.BoxBufferGeometry(.2, .2, .2), a = new T.InstancedMesh(g, material, 2), b = new T.InstancedMesh(g, material, 1), m = new T.Mesh(g, material);
          a.setMatrixAt(0, new T.Matrix4().makeTranslation(-1, 0, 0)); a.setMatrixAt(1, new T.Matrix4().makeTranslation(0, 0, 0)); b.setMatrixAt(0, new T.Matrix4().makeTranslation(1, 0, 0)); scene.add(a, b, m); frame(); scene.remove(a, b, m); g.dispose();
          check(alive.size === steadyBuffers, 'Instance GL buffer leak at scene cycle ' + index + ': ' + alive.size + '/' + steadyBuffers);
        }
        // The same matrix attribute can be explicitly shared between geometries.
        const ga = new T.BoxBufferGeometry(.3, .3, .3), gb = new T.BoxBufferGeometry(.3, .3, .3), sa = new T.InstancedMesh(ga, material, 1), sb = new T.InstancedMesh(gb, material, 1);
        sa.setMatrixAt(0, new T.Matrix4().makeTranslation(0, 0, 0)); sb.instanceMatrix = sa.instanceMatrix; scene.add(sa, sb); frame();
        const sharedBefore = alive.size; scene.remove(sa); ga.dispose(); check(sharedBefore - alive.size === 4, 'Disposing one shared attribute owner removed its peer');
        frame(); check(gl.getError() === gl.NO_ERROR, 'Shared instance attribute became invalid'); scene.remove(sb); gb.dispose(); check(alive.size === steadyBuffers, 'Last matrix owner failed to release buffer');
        renderer.setRenderTarget(null); renderer.render(scene, camera); material.dispose(); floorGeometry.dispose(); floorMaterial.dispose(); target.dispose();
        const output = {revision: T.REVISION, red, blue, dimmed, programs, shaderCallbacks: hooks.length, mixedFrames: 83, sceneCycles: 24, initialBuffers, remainingBuffers: alive.size, created: created.length, deleted: deleted.length, glError: gl.getError(), shadowMap: Boolean(light.shadow.map)};
        // Keep the final composition available in the screenshot while releasing
        // all task-owned GPU resources after its measurements.
        light.shadow.map.dispose(); renderer.dispose();
        document.body.appendChild(Object.assign(document.createElement('pre'), {textContent: JSON.stringify(output, null, 2)}));
        return output;
      });
      assert.equal(result.glError, 0); assert.equal(result.remainingBuffers, 0);
      assert.deepEqual(browser.report.exceptions, []); assert.deepEqual(browser.report.consoleErrors, []);
      browser.report.rendererCompatibility = result; await browser.screenshot('three-r112-instancing');
    });
    if (!action) {
      fs.writeFileSync(__layout.map(path.join(OUTPUT, 'three-r112-instancing-browser.json')), JSON.stringify(report, null, 2));
      console.log('Real Chrome pinned renderer compatibility passed: ' + JSON.stringify(report.rendererCompatibility));
    }
    return report;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(__layout.map(path.resolve(temporary))), __layout.map(path.resolve(os.tmpdir()))); assert(path.basename(temporary).startsWith('hello-renderer-compat-'));
    fs.rmSync(temporary, {recursive: true, force: true, maxRetries: 6, retryDelay: 100});
  }
}
if (require.main === module) run().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {run};
