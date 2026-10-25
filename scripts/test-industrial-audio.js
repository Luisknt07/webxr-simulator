'use strict';
// Real simulation/document/UI with a deterministic, observable WebAudio device.
// No speaker, external requests, database, build, or AudioContext constructor.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {createRequire} = require('node:module');
const schema = require('../shared/behaviors'), {validateDocument} = require('../server/validation');
const file = path.join(__dirname, 'test-editor-runtime.js'), source = fs.readFileSync(file, 'utf8');
const {harness, dom, browserWindow, storage, remote, THREE, exportsCreated} = new Function('require', '__dirname', source.slice(0, source.indexOf('async function run()')) + '\nreturn {harness,dom,browserWindow,storage,remote,THREE,exportsCreated};')(createRequire(file), __dirname);
const all = node => [node].concat(Array.from(node.children || []).flatMap(all));
const clone = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
class Param { constructor(value = 0) { this.value = value; } cancelScheduledValues() {} setTargetAtTime(value) { this.value = value; } }
class Node {
  constructor(context, type) { this.context = context; this.type = type; this.connections = []; this.disconnects = 0; this.gain = new Param(1); this.frequency = new Param(); this.Q = new Param(); this.playbackRate = new Param(1); ['X', 'Y', 'Z'].forEach(axis => { this['position' + axis] = new Param(); }); context.nodes.push(this); }
  connect(node) { this.connections.push(node); } disconnect() { this.disconnects++; this.connections = []; }
  start() { this.started = true; this.context.sources.add(this); }
  stop(at = this.context.currentTime) { if (!this.started || this.ended) return; this.stopAt = at; if (at <= this.context.currentTime) this.end(); }
  end() { this.ended = true; this.context.sources.delete(this); if (this.onended) this.onended(); }
}
class Device {
  constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'suspended'; this.nodes = []; this.sources = new Set(); this.resumes = 0; this.suspends = 0; this.closes = 0; this.decodes = 0; this.destination = {}; }
  createGain() { return new Node(this, 'gain'); } createBufferSource() { return new Node(this, 'source'); } createPanner() { return new Node(this, 'panner'); } createBiquadFilter() { return new Node(this, 'filter'); }
  createBuffer(channels, length, rate) { const data = new Float32Array(length); return {length, numberOfChannels: channels, duration: length / rate, getChannelData: () => data}; }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); } suspend() { this.suspends++; return Promise.resolve(); } close() { this.closes++; return Promise.resolve(); }
  decodeAudioData(bytes, done) { this.decodes++; const buffer = this.createBuffer(1, 3200, this.sampleRate); done(buffer); return Promise.resolve(buffer); }
  advance(seconds) { this.currentTime += seconds; Array.from(this.sources).forEach(node => { if (node.stopAt !== undefined && node.stopAt <= this.currentTime) node.end(); }); }
}

async function runtime() {
  storage.clear(); remote.projects.clear(); remote.online = true; browserWindow.document = dom; dom.hidden = false;
  const f = harness(), e = f.editor; await e.ready;
  const device = new Device(), nativeGain = device.createGain(); f.ctx.audioListener = {context: device, getInput: () => nativeGain};
  e.document.studio = {version: 1, environments: [{roomId: 'hall', machineSounds: true, machineVolume: .25, ambientPreset: 'off', ambientVolume: .12}]};
  const objects = [];
  for (let i = 0; i < 14; i++) {
    const object = e.document.addPrefab('hall', 'conveyor', 'roller-motor');
    e.document.setBehaviors(object, e.document.getBehaviors(object).map(value => value.type === 'conveyor' ? Object.assign({}, value, {withPanel: false, withSensors: false, running: true, autoSpawn: false}) : value));
    e.document.setTransform(object, {position: [i, 1, -4]}); objects.push(object);
  }
  e.leave(); e.simulation.execute(.2, .2); const audio = e.industrialAudio, before = clone(await e.document.serialize());
  audio.sync('hall', .1); assert.equal(device.nodes.length, 1); assert.equal(device.resumes, 0, 'Starting/syncing a level never resumes or creates audio before its gesture.');
  assert.equal(await audio.activate(), true); assert.equal(device.resumes, 1); audio.sync('hall', .1);
  assert.equal(audio.voices.size, 8); assert.equal(audio.stats.loops, 8); assert.equal(audio.stats.peakVoices, 8);
  const first = audio.voices.get('loop:' + objects[0].userData.editorId); assert(first); assert.equal(first.panner.distanceModel, 'linear'); assert.equal(first.panner.maxDistance, 18); assert(Math.abs(first.source.playbackRate.value - .93) < 1e-8);
  assert([...audio.voices.values()].every(voice => voice.source.buffer.getChannelData(0).some(value => value !== 0)), 'Procedural voices contain actual waveforms.');
  const starts = audio.stats.starts; for (let i = 0; i < 30; i++) audio.sync('hall', .016);
  assert.equal(audio.stats.starts, starts, 'Steady running updates gain/rate/position without rebuilding WebAudio voices.');
  e.simulation.setVariable(objects[0].userData.editorId, 'speed', .9); e.simulation.execute(.1, .3); audio.sync('hall', .1);
  assert(first.source.playbackRate.value > .93, 'Actual transport speed changes the existing mechanical audio rate.');
  f.ctx.camera.position.x = 13; f.ctx.camera.updateWorldMatrix(true, false); audio.sync('hall', .1); device.advance(.1); audio.sync('hall', .1);
  assert(audio.voices.has('loop:' + objects[13].userData.editorId)); assert(!audio.voices.has('loop:' + objects[0].userData.editorId), 'Only nearest operating machines keep voices.');
  objects.forEach(object => e.simulation.event(object.userData.editorId, 'package-entry', 'test load')); audio.sync('hall', .1);
  assert(audio.voices.size <= 12); assert(audio.stats.peakVoices <= 12, 'Impacts share a hard total voice budget with the eight nearest loops.');
  audio.sync('hall', .1, true); device.advance(1); audio.sync('hall', .1, true); assert.equal(audio.voices.size, 0, 'Pausing silences mechanical loops without changing the shared context.');
  audio.sync('hall', .1); assert(audio.voices.size);
  objects.forEach(object => e.simulation.command(object.userData.editorId, 'powerOff')); e.simulation.execute(.1, .4); audio.sync('hall', .1); device.advance(.1); audio.sync('hall', .1); assert.equal(audio.voices.size, 0, 'Power-off silences machines from their runtime state.');
  objects.forEach(object => { e.simulation.command(object.userData.editorId, 'powerOn'); e.simulation.command(object.userData.editorId, 'start'); }); e.simulation.execute(.1, .5); audio.sync('hall', .1);
  dom.hidden = true; await dom.fire('visibilitychange'); assert.equal(audio.voices.size, 0, 'Desktop hidden immediately releases owned voices.');
  f.ctx.vrMode = true; audio.sync('hall', .1); assert(audio.voices.size, 'XR audio continues even when the desktop document is hidden.');
  f.ctx.vrMode = false; dom.hidden = false;
  f.ctx.camera.position.set(200, 1.6, 200); f.ctx.camera.updateWorldMatrix(true, false); audio.sync('hall', .1); device.advance(.1); audio.sync('hall', .1); assert.equal(audio.voices.size, 0, 'Out-of-range machines allocate no ongoing voice.');
  audio.setVolume(.35); audio.setMuted(true); assert.equal(device.suspends, 0); assert.equal(device.closes, 0); assert.equal(nativeGain.disconnects, 0);
  assert.deepEqual(clone(await e.document.serialize()), before, 'Playback and local mute/volume never change the authored document.');
  audio.stop(); assert.equal(device.sources.size, 0); assert([...device.nodes].filter(node => node.type === 'source').every(node => node.disconnects > 0));

  // A plain Group zone has smooth volume boundaries and no render/collision mesh.
  e.enter(); const zone = e.document.addAudioZone('hall', {shape: 'sphere', radius: 3, fade: 2, preset: 'ventilation'}, {position: [0, 1.6, 0]});
  let meshes = 0; zone.traverse(node => { if (node.isMesh) meshes++; }); assert.equal(meshes, 0);
  e.document.undo(); assert(!e.document.getObject(zone.userData.editorId)); e.document.redo(); assert.equal(e.document.getObject(zone.userData.editorId), zone);
  e.document.studio = {version: 1, environments: [{roomId: 'hall', machineSounds: false, ambientPreset: 'off'}]};
  e.leave(); audio.setMuted(false); f.ctx.camera.position.set(0, 1.6, 0); f.ctx.camera.updateWorldMatrix(true, false); audio.sync('hall', .1);
  let voice = audio.voices.get('loop:zone:' + zone.userData.editorId); assert(voice); const full = voice.gain.gain.value;
  f.ctx.camera.position.x = 4; f.ctx.camera.updateWorldMatrix(true, false); audio.sync('hall', .1); assert(Math.abs(voice.gain.gain.value - full / 2) < 1e-6, 'Halfway through a zone fade its smooth gain is half.');
  f.ctx.camera.position.x = 6; f.ctx.camera.updateWorldMatrix(true, false); audio.sync('hall', .1); device.advance(.1); audio.sync('hall', .1); assert.equal(audio.voices.size, 0);
  e.enter(); e.document.setBehaviors(zone, [Object.assign(schema.defaultBehavior('audioZone'), {shape: 'box', width: 4, height: 2, depth: 2, fade: 2})]);
  e.document.setTransform(zone, {position: [10, 2, -5], rotation: [0, Math.PI / 2, 0], scale: [2, 1, 3]});
  e.leave(); zone.updateWorldMatrix(true, false);
  f.ctx.camera.position.copy(f.ctx.camera.parent.worldToLocal(zone.localToWorld(new THREE.Vector3()))); f.ctx.camera.updateWorldMatrix(true, false); audio.sync('hall', .1);
  voice = audio.voices.get('loop:zone:' + zone.userData.editorId); assert(voice); const boxFull = voice.gain.gain.value;
  f.ctx.camera.position.copy(f.ctx.camera.parent.worldToLocal(zone.localToWorld(new THREE.Vector3(3, 0, 0)))); f.ctx.camera.updateWorldMatrix(true, false); audio.sync('hall', .1);
  assert(Math.abs(voice.gain.gain.value - boxFull / 2) < 1e-6, 'Rotated box zones use the actual local box and scale their fade with a nonuniform scene transform.');
  f.ctx.camera.position.copy(f.ctx.camera.parent.worldToLocal(zone.localToWorld(new THREE.Vector3(5, 0, 0)))); f.ctx.camera.updateWorldMatrix(true, false); audio.sync('hall', .1); device.advance(.1); audio.sync('hall', .1); assert.equal(audio.voices.size, 0);
  e.enter(); e.select(zone); e.focus(); assert.equal(e.transform.object, zone); assert.equal(e.box.visible, false, 'Invisible anchors stay selectable with a transform gizmo, without stale mesh bounds.');
  e.document.studio = schema.studio.normalize(e.document.studio);
  const snapshot = await e.document.serialize(); assert.deepEqual(clone(validateDocument(snapshot, record => record)), clone(snapshot));
  e.document.undo(); e.document.redo(); assert.deepEqual(clone(await e.document.serialize()), clone(snapshot));
  audio.dispose(); assert.equal(device.sources.size, 0); assert.equal(nativeGain.disconnects, 0); assert.equal(device.closes, 0);
  e.projectSync.stop(); e.clearAssembly(true); delete browserWindow.document;
}

async function customAndInspector() {
  storage.clear(); remote.projects.clear(); const f = harness(), e = f.editor; await e.ready;
  const device = new Device(), output = device.createGain(); f.ctx.audioListener = {context: device, getInput: () => output};
  const object = e.document.addPrefab('hall', 'conveyor', 'roller-motor'); e.select(object);
  const soundPanel = all(e.inspectorContent).find(node => node.getAttribute('data-sound-inspector')); assert(soundPanel);
  const field = key => all(soundPanel).find(node => node.getAttribute('data-behavior-field') === key);
  assert(field('asset')); assert(field('preset')); assert(field('trigger')); assert(field('range'));
  const before = e.document.getBehaviors(object); field('volume').value = '.4'; await field('volume').fire('change'); await tick();
  assert.equal(e.document.getBehaviors(object).find(value => value.type === 'machineAudio').volume, .4);
  assert.deepEqual(e.document.getBehaviors(object).filter(value => value.type !== 'machineAudio'), before);
  const button = e.document.addPrefab('hall', 'control', 'start');
  e.document.setBehaviors(button, e.document.getBehaviors(button).map(value => value.type === 'control' ? Object.assign({}, value, {targetId: object.userData.editorId}) : value).concat([Object.assign(schema.defaultBehavior('machineAudio'), {asset: 'own-click', trigger: 'button'})]));
  e.library.imports = [{id: 'own-click', importId: 'own-click', batchId: 'batch-audio', path: 'click.wav', name: 'click.wav', kind: 'audio', extension: 'wav', size: 24, dataUrl: 'data:audio/wav;base64,AAAA'}]; e.entries = await e.library.getCatalog();
  let requests = 0; const originalFetch = global.fetch;
  global.fetch = async url => { requests++; assert(String(url).includes('own-click')); return {ok: true, headers: {get: () => '24'}, arrayBuffer: async () => new ArrayBuffer(24)}; };
  try {
    e.leave(); assert.equal(requests, 0); await e.industrialAudio.activate(); await tick(); assert.equal(requests, 1); assert.equal(device.decodes, 1);
    const state = Object.values(f.ctx.raycontrol.states).find(state => state.colliderMesh === button && state.onSelectStart); assert(state);
    state.onSelectStart(null, null); e.industrialAudio.sync('hall', .1); assert([...e.industrialAudio.voices.values()].some(voice => !voice.loop && voice.signature === 'own-click'), 'A physical control press plays its imported clip.');
    const starts = e.industrialAudio.stats.starts; e.industrialAudio.sync('hall', .1); assert.equal(e.industrialAudio.stats.starts, starts, 'The same press sequence never repeats its click each frame.');
    e.industrialAudio.stop(); assert.equal(device.sources.size, 0); assert.equal(output.disconnects, 0);
    let complete; global.fetch = () => new Promise(resolve => { complete = resolve; });
    e.industrialAudio.buffers.clear(); e.industrialAudio.start('hall'); await tick(); assert(complete);
    e.industrialAudio.stop(); complete({ok: true, headers: {get: () => '24'}, arrayBuffer: async () => new ArrayBuffer(24)}); await tick();
    assert.equal(e.industrialAudio.voices.size, 0); assert.equal(e.industrialAudio.buffers.size, 0, 'A clip decoded after leaving the level cannot restore stale sounds or cached resources.');
  } finally { global.fetch = originalFetch; }
  e.enter(); e.document.setStudio({environments: [Object.assign(schema.studio.defaultEnvironment('hall'), {ambientPreset: 'off', ambientSound: 'own-click', ambientVolume: .12})]});
  await e.exportProject(); const portable = JSON.parse(await exportsCreated.at(-1).text());
  assert.equal(portable.studio.environments[0].ambientSound, 'own-click'); assert(portable.imports.find(value => value.id === 'own-click').dataUrl.startsWith('data:audio/'), 'Portable JSON carries the ambient import bytes together with its stable importId.');
  const snapshot = await e.saveProject('Sound settings'); const reopened = harness(); await reopened.editor.ready;
  assert.deepEqual(clone(await reopened.editor.document.serialize()), clone(snapshot.document), 'Audio profiles/assets and zones remain portable across save/reopen.');
  e.projectSync.stop(); reopened.editor.projectSync.stop(); e.clearAssembly(true); reopened.editor.clearAssembly(true);
}

async function run() {
  for (const type of ['machineAudio', 'audioZone']) for (const asset of ['../outside.wav', 'https://invalid/a.wav', '/api/assets/x', 'C:\\sound.wav', 'file.wav?x=1']) assert.throws(() => schema.normalizeBehaviors([{type, asset}]), /audio/);
  assert.throws(() => schema.normalizeBehaviors([{type: 'machineAudio', range: 2, refDistance: 3}]), /alcance/);
  assert.throws(() => schema.normalizeBehaviors([{type: 'audioZone', fade: 0}]), /sonido/);
  await runtime(); await customAndInspector();
  console.log('Industrial audio: explicit gesture, shared-context isolation, actual speed/pause, nearest 8/total 12 voices, impact budget, hidden desktop/XR, smooth invisible zones, real button/custom clip, safe references and unchanged save/reopen passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
