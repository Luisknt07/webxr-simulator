'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
class Element {
  constructor() {this.listeners = new Map(); this.clientWidth = 800; this.clientHeight = 600; this.children = [];}
  addEventListener(name, listener) {if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(listener);}
  removeEventListener(name, listener) {if (this.listeners.has(name)) this.listeners.get(name).delete(listener);}
  dispatch(name, event = {}) {for (const listener of this.listeners.get(name) || []) listener(event);}
  setAttribute() {} removeAttribute() {}
  appendChild(child) {child.parent = this; this.children.push(child);}
  remove() {if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null;}
}
class Renderer {
  constructor() {this.domElement = new Element(); this.shadowMap = {}; this.xr = {getSession: () => this.session}; this.frames = 0; this.info = {render: {}, memory: {}};}
  setPixelRatio() {} setSize() {} setAnimationLoop(callback) {this.loop = callback;} render() {this.frames++;} dispose() {this.disposed = true;}
}
class Input {constructor() {this.changes = [];this.resets = 0;} reset() {this.resets++;} step() {} xrChanged(active) {this.changes.push(active);} dispose() {this.disposed = true;}}
class Graphics {setViewport() {} tick() {} dispose() {this.disposed = true;}}
async function run() {
  const window = new Element(), document = {hidden: false}, target = new Element(); let xrCallback;
  const VRButton = {createButton(renderer, callback) {xrCallback = callback; return new Element();}};
  const source = fs.readFileSync(path.join(__dirname, '../BrowserHost.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const create = new Function('THREE', 'AdaptiveGraphics', 'VRButton', 'BrowserInput', 'window', 'document', source + '\nreturn createBrowserHost;')({...THREE, WebGLRenderer: Renderer}, Graphics, VRButton, Input, window, document);
  const browser = create({container: target}), ctx = browser.context, renderer = ctx.renderer;
  let before = 0, after = 0; browser.setFrameHandler({before() {before++;}, after() {after++;}}); browser.start();
  renderer.loop(0); renderer.loop(16); assert.equal(renderer.frames, 2); assert.equal(before, 2); assert.equal(after, 2);
  document.hidden = true; renderer.loop(32); assert.equal(renderer.frames, 2); document.hidden = false;
  let prevented = false; renderer.domElement.dispatch('webglcontextlost', {preventDefault() {prevented = true;}}); renderer.loop(48);
  assert(prevented && browser.stats().contextLost); assert.equal(renderer.frames, 2);
  renderer.domElement.dispatch('webglcontextrestored'); renderer.loop(64); assert.equal(renderer.frames, 3);
  let transition = 0; browser.mountXR(new Element(), {afterChange() {transition++;}});
  await browser.dispose(); assert.equal(renderer.loop, null); assert(renderer.disposed && ctx.input.disposed && ctx.graphics.disposed); assert.equal(target.children.length, 0);
  // navigator.requestSession may resolve after a navigation/dispose. A late
  // success must end that native session without reviving disposed controls.
  let ended = 0; renderer.session = {end() {ended++; return Promise.resolve();}};
  xrCallback('sessionStarted', {referenceSpaceType: 'local-floor'}); await Promise.resolve();
  assert.equal(ended, 1, 'A late native XR session must be ended.'); assert.equal(ctx.vrMode, false); assert.equal(transition, 0); assert.deepEqual(ctx.input.changes, []);
  assert.throws(() => browser.start(), /disposed/);
  console.log(JSON.stringify({onePrimaryLoop: true,hiddenGate: true,contextLossRecovery: true,cleanup: true,lateXRSessionEnded: true}));
}
run().catch(error => {console.error(error); process.exitCode = 1;});
