const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../../modules/logistica-industrial/contracts/behaviors'), {createRequire} = require('node:module');
const test = __layout.map(path.join(__layout.oldDir("scripts/test-industrial-audio-autostart.js"), 'test-industrial-audio.js')), fixture = fs.readFileSync(test, 'utf8');
const {Device} = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('async function runtime()')) + '\nreturn {Device};')(createRequire(test), __dirname);
const code = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-industrial-audio-autostart.js"), '../src/editor/IndustrialAudioSystem.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class IndustrialAudioSystem', 'return class IndustrialAudioSystem');
const Audio = new Function('THREE', 'behaviorSchema', code)(THREE, schema);
class Events {
  constructor() { this.events = new Map(); }
  addEventListener(type, listener) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(listener); }
  removeEventListener(type, listener) { if (this.events.has(type)) this.events.get(type).delete(listener); }
  async fire(type, event = {}) { for (const listener of [...this.events.get(type) || []]) await listener(event); }
  count(type) { return (this.events.get(type) || new Set()).size; }
}
async function run() {
  const originalWindow = global.window, originalStorage = global.localStorage;
  let saved = JSON.stringify({muted: true, volume: .3}); global.localStorage = {getItem: () => saved, setItem: (key, value) => { saved = value; }};
  const dom = new Events(); global.window = {document: dom};
  const make = state => {
    const device = new Device(); device.state = state; const native = device.createGain(), xr = new Events(); xr.isPresenting = false;
    const ctx = {audioListener: {context: device, getInput: () => native}, camera: new THREE.PerspectiveCamera(), renderer: {xr}};
    const document = {studio: {environments: [{roomId: 'hall', ambientPreset: 'warehouse', ambientVolume: .12}]}, getObjects: () => []};
    const audio = new Audio(ctx, document, {events: [], records: new Map(), runSequence: 1}, {}); audio.start('hall'); return {audio, device, ctx, native, xr};
  };
  try {
    const f = make('suspended'); assert.equal(f.audio.muted, false, 'Every new visit enables sound, including an old saved mute preference.'); assert.equal(f.audio.volume, .3);
    assert.equal(f.device.resumes, 0); assert.equal(f.device.nodes.length, 1, 'A locked browser has no audio sources, extra nodes, requests or resume attempts before interaction.');
    await dom.fire('pointerdown', {isTrusted: false}); assert.equal(f.device.resumes, 0);
    await dom.fire('pointerdown', {isTrusted: true, target: {closest: () => ({})}}); assert.equal(f.device.resumes, 0, 'The sound toggle handles its own action once.');
    await dom.fire('pointerdown', {isTrusted: true}); assert(f.audio.activated); assert.equal(f.device.resumes, 1); assert.equal(dom.count('pointerdown'), 0);
    f.audio.sync('hall', .1); assert(f.audio.voices.size > 0, 'The actual ambient waveform starts after an ordinary scene interaction.');
    f.audio.setMuted(true); await dom.fire('keydown', {isTrusted: true}); assert.equal(f.audio.voices.size, 0); assert(f.audio.muted, 'Later gestures respect an intentional mute during this visit.');
    f.audio.dispose(); assert.equal(dom.count('touchend'), 0); assert.equal(f.native.disconnects, 0); assert.equal(f.device.closes, 0); assert.equal(f.device.suspends, 0);
    const allowed = make('running'); assert(allowed.audio.activated, 'An already permitted browser starts audio as soon as the level starts.'); assert.equal(allowed.device.resumes, 0); allowed.audio.dispose();
    const resumed = make('suspended'); resumed.device.state = 'running'; resumed.audio.sync('hall', .1); assert(resumed.audio.activated, 'A native audio unlock is shared without requiring a second click.'); resumed.audio.dispose();
    const xr = make('suspended'); xr.ctx.vrMode = true; xr.xr.isPresenting = true; await xr.xr.fire('sessionstart'); await Promise.resolve(); assert(xr.audio.activated); xr.audio.dispose(); assert.equal(xr.xr.count('sessionstart'), 0);
    const pending = make('suspended'); let finish; pending.device.resume = () => { pending.device.resumes++; return new Promise(resolve => { finish = () => { pending.device.state = 'running'; resolve(); }; }); };
    const operation = pending.audio.activate(); pending.audio.dispose(); finish(); assert.equal(await operation, false); assert.equal(pending.device.nodes.length, 1, 'Disposal while a permission resume is pending cannot re-create a stale audio branch.');
    console.log('Audio autostart: enabled default, trusted first interaction, permitted/native/XR startup, no pre-permission work, mute intent, no double toggle, listener cleanup and pending-resume disposal passed.');
  } finally { global.window = originalWindow; global.localStorage = originalStorage; }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
