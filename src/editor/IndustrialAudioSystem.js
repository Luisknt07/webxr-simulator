import * as THREE from 'three';
import behaviorSchema from '../../shared/behaviors.js';

const schema = behaviorSchema.machineAudio;
const MAX_VOICES = 12, MAX_LOOPS = 8, MAX_BUFFERS = 24, MAX_ASSET_BYTES = 24 * 1024 * 1024, MAX_DECODED_BYTES = 64 * 1024 * 1024;
const SETTINGS_KEY = 'hello-industrial-audio-v1';
const CYCLES = new Set(['mechanism-positioned', 'processor-job-start', 'source-generated', 'pallet-dispatched']);
const LOADS = new Set(['package-entry', 'package-transfer', 'package-stacked', 'processor-entry', 'processor-complete', 'source-generated', 'source-received', 'pallet-queue-entry', 'pallet-dispatched']);
const ACTIVE_PHASES = new Set(['actuating', 'rotating', 'lifting', 'returning', 'operating']);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
function visible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }
function setParam(param, value, now, smooth = .035) {
  if (!param || !Number.isFinite(value)) return;
  if (param.cancelScheduledValues) param.cancelScheduledValues(now);
  if (param.setTargetAtTime) param.setTargetAtTime(value, now, smooth); else param.value = value;
}
function disconnect(node) { if (node && node.disconnect) { try { node.disconnect(); } catch (_) { /* Already disconnected. */ } } }

/** A private branch on the existing listener. Sound is enabled on arrival.
 * A suspended browser context is unlocked by the first real interaction;
 * already permitted audio starts without an extra sound-button click. */
export default class IndustrialAudioSystem {
  constructor(ctx, document, simulation, library, notify) {
    this.ctx = ctx || {}; this.document = document; this.simulation = simulation; this.library = library; this.notify = notify || (() => {});
    this.voices = new Map(); this.buffers = new Map(); this.loading = new Map(); this.failed = new Set(); this.emitters = new Map(); this.controls = new Map(); this.lastShots = new Map();
    this.volume = .7; this.muted = false; this.activated = false; this.running = false; this.generation = 0; this.sequence = 0;
    this.listenerPosition = new THREE.Vector3(); this.position = new THREE.Vector3(); this.localPosition = new THREE.Vector3(); this.scale = new THREE.Vector3();
    try { const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); if (saved && Number.isFinite(saved.volume)) this.volume = clamp(saved.volume); } catch (_) { /* Local preferences are optional. */ }
    this.visibilityChanged = () => { if (this.hidden()) this._silence(); };
    if (typeof window !== 'undefined' && window.document && window.document.addEventListener) window.document.addEventListener('visibilitychange', this.visibilityChanged);
    this.stats = {voices: 0, loops: 0, buffers: 0, starts: 0, peakVoices: 0, dropped: 0};
    this.unlockTarget = typeof window !== 'undefined' && window.document;
    this.unlockEvents = ['pointerdown', 'keydown', 'touchend'];
    this.unlockAudio = event => {
      if (!event || event.isTrusted !== true || this.disposed || this.muted || this.activated) return;
      // The toggle has its own click action. Do not let pointerdown turn its
      // subsequent click into a second, contradictory toggle.
      if (event.target && event.target.closest && event.target.closest('[data-industrial-audio-toggle]')) return;
      return this._autoActivate(true);
    };
    this.unlockXR = () => { if (this.ctx.vrMode || this.ctx.renderer && this.ctx.renderer.xr && this.ctx.renderer.xr.isPresenting) this._autoActivate(true); };
    this._armUnlock();
  }

  _armUnlock() {
    if (this.unlockArmed || this.disposed || this.muted || this.activated) return;
    this.unlockArmed = true;
    if (this.unlockTarget && this.unlockTarget.addEventListener) this.unlockEvents.forEach(type => this.unlockTarget.addEventListener(type, this.unlockAudio, true));
    const xr = this.ctx.renderer && this.ctx.renderer.xr;
    if (xr && xr.addEventListener) xr.addEventListener('sessionstart', this.unlockXR);
  }
  _disarmUnlock() {
    if (!this.unlockArmed) return;
    this.unlockArmed = false;
    if (this.unlockTarget && this.unlockTarget.removeEventListener) this.unlockEvents.forEach(type => this.unlockTarget.removeEventListener(type, this.unlockAudio, true));
    const xr = this.ctx.renderer && this.ctx.renderer.xr;
    if (xr && xr.removeEventListener) xr.removeEventListener('sessionstart', this.unlockXR);
  }
  _autoActivate(gesture = false) {
    const context = this.ctx.audioListener && this.ctx.audioListener.context;
    if (this.disposed || this.muted || this.activated || this.activationPending || !context || (!gesture && context.state !== 'running')) return;
    return this.activate(false);
  }
  activate(unmute = true) {
    if (this.disposed) return Promise.resolve(false);
    if (unmute) this.muted = false;
    if (this.activationPending) return this.activationPending;
    const operation = this._activate(); this.activationPending = operation;
    operation.then(() => { if (this.activationPending === operation) this.activationPending = null; }, () => { if (this.activationPending === operation) this.activationPending = null; });
    return operation;
  }
  async _activate() {
    const listener = this.ctx.audioListener, context = listener && listener.context;
    if (!context || !context.createGain || !context.createBufferSource || !context.createPanner) { this.notify('Este navegador no dispone de audio espacial.'); return false; }
    try {
      // Resume only inside this explicitly invoked gesture. Never suspend or
      // close this shared context: native notes, teleport and rooms also use it.
      if (context.state === 'suspended' && context.resume) await context.resume();
      if (context.state === 'closed') throw new Error('El dispositivo de audio está cerrado.');
      if (this.disposed || this.muted || context.state !== 'running') return false;
      this.context = context;
      if (!this.master) { this.master = context.createGain(); this.master.gain.value = 0; this.master.connect(listener.getInput ? listener.getInput() : listener.gain || context.destination); }
      this.activated = true; this.faulted = false; this.failed.clear(); this._disarmUnlock(); this._master(); this._preload();
      if (this.onChange) this.onChange();
      return true;
    } catch (error) { this.notify('No se pudo activar el sonido: ' + error.message); return false; }
  }

  hidden() { return !this.ctx.vrMode && typeof window !== 'undefined' && window.document && window.document.hidden === true; }
  _save() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({volume: this.volume, muted: this.muted})); } catch (_) { /* Nonessential local setting. */ } }
  setVolume(value) { this.volume = clamp(Number(value)); this._save(); this._master(); if (this.onChange) this.onChange(); }
  setMuted(value) { this.muted = !!value; this._save(); this._master(); if (this.muted) { this._disarmUnlock(); this._silence(); } else if (!this.activated) { this._armUnlock(); this._autoActivate(); } if (this.onChange) this.onChange(); }
  _master() { if (this.master) setParam(this.master.gain, this.activated && !this.muted && !this.hidden() ? this.volume * .55 : 0, this.context.currentTime); }

  start(roomId) {
    this.stop(); this.roomId = String(roomId); this.running = true;
    this._autoActivate();
    this.eventCursor = this.simulation.events.length ? this.simulation.events[this.simulation.events.length - 1].id : null;
    this.runSequence = this.simulation.runSequence;
    this.environment = (this.document.studio && this.document.studio.environments || []).find(value => value.roomId === this.roomId) || {};
    const auto = this.environment.machineSounds === true;
    this.document.getObjects(this.roomId).forEach(object => {
      if (!object || object.userData.editorRuntimeHelper || object.userData.editorVisualOwnerId) return;
      const configs = this.document.getBehaviors(object), custom = configs.find(value => value.type === 'machineAudio'), zone = configs.find(value => value.type === 'audioZone');
      const record = this.simulation.records.get(object.userData.editorId), functional = record && ['conveyor', 'processor', 'source', 'palletQueue', 'control', 'motion'].some(type => record.components[type]);
      if (zone && zone.enabled) this.emitters.set('zone:' + object.userData.editorId, {id: 'zone:' + object.userData.editorId, object, config: zone, zone: true, active: false});
      if (custom ? custom.enabled : auto && functional) this.emitters.set(object.userData.editorId, {id: object.userData.editorId, object, config: custom || schema.normalize('machineAudio'), record, automatic: !custom, active: false});
      if (record && record.components.control) this.controls.set(record.id, this.simulation.getControlFeedback ? this.simulation.getControlFeedback(record.id).sequence : 0);
    });
    this._preload();
  }

  _preload() {
    if (!this.activated || !this.running || this.muted || this.hidden() || !this.ctx.camera) return;
    this.ctx.camera.getWorldPosition(this.listenerPosition);
    Array.from(this.emitters.values()).filter(emitter => emitter.config.asset && visible(emitter.object) && this._distance(emitter).attenuation > 0).sort((a, b) => a.object.getWorldPosition(new THREE.Vector3()).distanceToSquared(this.listenerPosition) - b.object.getWorldPosition(new THREE.Vector3()).distanceToSquared(this.listenerPosition)).slice(0, MAX_VOICES).forEach(emitter => this._buffer(emitter.config.asset, emitter.config.asset, emitter.config.preset, emitter.config.loop));
  }

  stop() {
    this.generation++; this.running = false; this._silence(); this.emitters.clear(); this.controls.clear(); this.lastShots.clear();
    this.loading.forEach(entry => { if (entry.controller) entry.controller.abort(); }); this.loading.clear();
  }
  dispose() {
    this.disposed = true; this._disarmUnlock();
    this.stop(); disconnect(this.master); this.master = null; this.buffers.clear(); this.failed.clear();
    if (typeof window !== 'undefined' && window.document && window.document.removeEventListener) window.document.removeEventListener('visibilitychange', this.visibilityChanged);
  }
  _silence() { Array.from(this.voices.values()).forEach(voice => this._destroy(voice)); this._stats(); }
  _destroy(voice) {
    if (!voice || voice.disposed) return; voice.disposed = true;
    if (voice.source) { voice.source.onended = null; try { voice.source.stop(); } catch (_) { /* Completed source. */ } }
    [voice.source, voice.filter, voice.gain, voice.panner].forEach(disconnect); this.voices.delete(voice.id);
  }
  _release(voice) {
    if (voice.releasing) return; voice.releasing = true; voice.endAt = this.context.currentTime + .06;
    setParam(voice.gain.gain, 0, this.context.currentTime, .015);
    try { voice.source.stop(voice.endAt); } catch (_) { this._destroy(voice); }
  }
  _stats() {
    this.stats.voices = this.voices.size; this.stats.loops = Array.from(this.voices.values()).filter(voice => voice.loop && !voice.releasing).length;
    this.stats.buffers = this.buffers.size; this.stats.peakVoices = Math.max(this.stats.peakVoices, this.voices.size);
  }

  _state(emitter, paused) {
    const config = emitter.config, record = emitter.record, components = record && record.components || {};
    let preset = config.preset, rate = config.playbackRate, level = 0;
    if (config.preset === 'off') return {level: 0, rate, preset};
    if (emitter.zone) return {level: 1, rate, preset: preset === 'auto' ? 'warehouse' : preset};
    if (paused || !this.simulation.running) return {level: 0, rate, preset};
    const machine = components.conveyor || components.processor || components.source || components.palletQueue || components.motion;
    const operational = machine && machine.enabled !== false && machine.powered !== false && machine.running !== false && !machine.paused && !machine.emergency;
    if (config.trigger === 'always') level = 1;
    else if (config.trigger === 'button' || config.trigger === 'cycle' || components.control) level = 0;
    else if (operational) {
      if (components.conveyor) {
        const belt = components.conveyor, speed = Math.abs(belt.actualSpeed || 0), cycling = ACTIVE_PHASES.has(belt.mechanismPhase);
        level = cycling ? .85 : speed > .0001 ? clamp(.4 + speed * .7, .2, 1) : 0;
        rate *= cycling ? 1 : clamp(.65 + speed * .7, .5, 2);
        if (preset === 'auto') preset = cycling ? belt.config.mechanism === 'elevator' ? 'elevator' : ['liftTransfer', 'pusher', 'steer', 'distributor'].includes(belt.config.mechanism) ? 'pneumatic' : 'motor' : belt.config.surface === 'belt' || belt.config.surface === 'modular' ? 'belt' : 'rollers';
        if (belt.config.drive === 'gravity') level *= .5;
      } else if (components.processor) { level = (components.processor.jobs || []).some(job => !job.results && ['setup', 'process'].includes(job.phase)) ? .8 : 0; if (preset === 'auto') preset = 'processor'; }
      else if (components.motion) { level = Math.abs(components.motion.speed || 0) > .0001 ? .6 : 0; if (preset === 'auto') preset = 'motor'; }
      else if (config.trigger === 'running') level = .7;
      // Source/buffer handling emits real load impacts instead of a perpetual motor.
    }
    if (preset === 'auto') preset = components.control ? 'button' : 'motor';
    return {level, rate: clamp(rate, .25, 3), preset};
  }

  _distance(emitter) {
    emitter.object.getWorldPosition(this.position); const distance = this.listenerPosition.distanceTo(this.position);
    if (!emitter.zone) return {distance, attenuation: distance >= emitter.config.range ? 0 : 1};
    emitter.object.updateWorldMatrix(true, false);
    this.localPosition.copy(this.listenerPosition); emitter.object.worldToLocal(this.localPosition);
    const config = emitter.config, p = this.localPosition;
    const outside = config.shape === 'sphere' ? Math.max(0, p.length() - config.radius) : Math.hypot(Math.max(0, Math.abs(p.x) - config.width / 2), Math.max(0, Math.abs(p.y) - config.height / 2), Math.max(0, Math.abs(p.z) - config.depth / 2));
    const blend = clamp(1 - outside / config.fade);
    return {distance, attenuation: blend * blend * (3 - 2 * blend)};
  }

  sync(roomId, delta = 0, paused = false) {
    try { this._sync(roomId, delta, paused); }
    catch (error) { this._silence(); this.activated = false; if (!this.faulted) this.notify('El sonido se desactivó: ' + error.message); this.faulted = true; if (this.onChange) this.onChange(); }
  }
  _sync(roomId, delta = 0, paused = false) {
    if (!this.running || String(roomId) !== this.roomId) return;
    this._autoActivate();
    this.paused = !!paused;
    const events = this.simulation.events || [], latest = events.length ? events[events.length - 1].id : this.eventCursor;
    if (this.runSequence !== this.simulation.runSequence) { this.runSequence = this.simulation.runSequence; this.eventCursor = latest; this._captureControls(); }
    if (!this.activated || this.muted || this.volume <= 0 || this.hidden() || !this.context || this.context.state === 'suspended') { this._silence(); this.eventCursor = latest; this._captureControls(); return; }
    this._master();
    const camera = this.ctx.camera;
    if (!camera) return; camera.getWorldPosition(this.listenerPosition);
    const now = this.context.currentTime;
    Array.from(this.voices.values()).forEach(voice => { if (voice.endAt && voice.endAt <= now) this._destroy(voice); });
    const candidates = [];
    this.emitters.forEach(emitter => {
      const state = this._state(emitter, paused), distance = this._distance(emitter);
      if (emitter.config.asset && emitter.record && emitter.record.components.control && distance.attenuation > 0 && visible(emitter.object)) this._buffer(emitter.config.asset, emitter.config.asset, 'button', false);
      state.level *= visible(emitter.object) ? distance.attenuation : 0;
      const active = state.level > .0001 && emitter.config.volume > 0;
      const value = {emitter, state, distance: distance.distance, gain: state.level * emitter.config.volume * (emitter.zone ? 1 : clamp(this.environment.machineVolume === undefined ? .25 : this.environment.machineVolume))};
      if (active && emitter.config.loop) candidates.push(value);
      else if (active && !emitter.active) this._play(value, false);
      emitter.active = active;
    });
    const environment = this.environment;
    if (environment.ambientSound || environment.ambientPreset && environment.ambientPreset !== 'off') {
      candidates.push({emitter: {id: 'ambient:' + this.roomId, ambient: true, config: {asset: environment.ambientSound || '', preset: environment.ambientPreset || 'warehouse', volume: environment.ambientVolume === undefined ? .12 : environment.ambientVolume, playbackRate: 1, loop: true}}, state: {preset: environment.ambientPreset === 'off' ? 'warehouse' : environment.ambientPreset || 'warehouse', rate: 1, level: 1}, distance: -1, gain: clamp(environment.ambientVolume === undefined ? .12 : environment.ambientVolume)});
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const selected = candidates.slice(0, MAX_LOOPS), wanted = new Set(selected.map(value => 'loop:' + value.emitter.id));
    this.voices.forEach(voice => { if (voice.loop && !wanted.has(voice.id)) this._release(voice); });
    selected.forEach(value => this._play(value, true));
    if (!paused) this._events(events); else this._captureControls();
    this.eventCursor = latest; this._stats();
  }

  _captureControls() { this.controls.forEach((sequence, id) => { if (this.simulation.getControlFeedback) this.controls.set(id, this.simulation.getControlFeedback(id).sequence); }); }
  _events(events) {
    this.controls.forEach((sequence, id) => {
      const feedback = this.simulation.getControlFeedback ? this.simulation.getControlFeedback(id) : {sequence: 0};
      if (feedback.sequence > sequence) { const emitter = this.emitters.get(id); if (emitter && ['auto', 'button'].includes(emitter.config.trigger)) this._shot(emitter, 'button'); }
      this.controls.set(id, feedback.sequence);
    });
    let from = this.eventCursor ? events.findIndex(event => event.id === this.eventCursor) + 1 : 0;
    // A bounded event log may have rotated. Only recent events can become sound.
    if (from < 0) from = 0;
    events.slice(from).filter(event => this.simulation.time - event.time <= .3).forEach(event => {
      const emitter = this.emitters.get(event.objectId); if (!emitter) return;
      if (CYCLES.has(event.type) && (emitter.config.trigger === 'cycle' || emitter.config.trigger === 'auto' && !LOADS.has(event.type))) {
        const belt = emitter.record && emitter.record.components.conveyor;
        const preset = event.type === 'mechanism-positioned' ? belt && belt.config.mechanism === 'elevator' ? 'elevator' : belt && ['turntable', 'merge'].includes(belt.config.mechanism) ? 'motor' : 'pneumatic' : 'processor';
        this._shot(emitter, emitter.config.preset === 'auto' ? preset : emitter.config.preset);
      } else if (LOADS.has(event.type) && emitter.config.trigger === 'auto') this._shot(emitter, 'load', !(emitter.config.asset && emitter.record && (emitter.record.components.source || emitter.record.components.palletQueue)));
    });
  }
  _shot(emitter, preset, handling = false) {
    if (!visible(emitter.object)) return;
    const distance = this._distance(emitter); if (!distance.attenuation || emitter.config.preset === 'off') return;
    const key = emitter.id + ':' + preset, now = this.context.currentTime;
    if (now - (this.lastShots.get(key) === undefined ? -1 : this.lastShots.get(key)) < .12) return;
    this.lastShots.set(key, now);
    this._play({emitter: Object.assign({}, emitter, {config: Object.assign({}, emitter.config, handling ? {asset: ''} : {})}), state: {preset: handling || emitter.config.preset === 'auto' ? preset : emitter.config.preset, rate: emitter.config.playbackRate, level: 1}, gain: emitter.config.volume * clamp(this.environment.machineVolume === undefined ? .25 : this.environment.machineVolume), distance: distance.distance}, false);
  }

  _play(value, loop) {
    const {emitter, state} = value, key = (loop ? 'loop:' : 'shot:') + emitter.id + (loop ? '' : ':' + (++this.sequence));
    const signature = emitter.config.asset || 'procedural:' + state.preset + ':' + (loop ? 'loop' : 'shot');
    const existing = this.voices.get(key);
    if (existing && existing.signature === signature && !existing.releasing) { this._update(existing, value); return; }
    if (existing) { this._release(existing); return; }
    const buffer = this._buffer(signature, emitter.config.asset, state.preset, loop);
    if (!buffer) {
      const pending = emitter.config.asset && this.loading.get(emitter.config.asset);
      if (!loop && pending && !pending.shot) pending.shot = {value, generation: this.generation, until: this.context.currentTime + 1};
      return;
    }
    if (this.voices.size >= MAX_VOICES) {
      const farthest = Array.from(this.voices.values()).filter(voice => !voice.loop).sort((a, b) => b.distance - a.distance)[0];
      if (!farthest || farthest.distance <= value.distance) { this.stats.dropped++; return; }
      this._destroy(farthest);
    }
    const context = this.context, source = context.createBufferSource(), gain = context.createGain(), filter = context.createBiquadFilter(), panner = emitter.ambient ? null : context.createPanner();
    source.buffer = buffer; source.loop = loop; gain.gain.value = 0;
    filter.type = 'lowpass'; filter.frequency.value = emitter.config.asset ? 16000 : ['button', 'pneumatic', 'load'].includes(state.preset) ? 4800 : 2800; filter.Q.value = .35;
    source.connect(filter); filter.connect(gain);
    if (panner) { panner.panningModel = 'equalpower'; panner.distanceModel = 'linear'; panner.refDistance = emitter.zone ? 1 : emitter.config.refDistance; panner.maxDistance = emitter.zone ? 1000 : emitter.config.range; panner.rolloffFactor = emitter.zone ? 0 : 1; gain.connect(panner); panner.connect(this.master); }
    else gain.connect(this.master);
    const voice = {id: key, signature, source, gain, filter, panner, loop, distance: value.distance, endAt: loop ? 0 : context.currentTime + buffer.duration / clamp(state.rate, .25, 3)};
    this.voices.set(key, voice); source.onended = () => { this._destroy(voice); this._stats(); };
    this._update(voice, value); source.start(); this.stats.starts++; this._stats();
  }
  _update(voice, value) {
    const now = this.context.currentTime; voice.distance = value.distance;
    setParam(voice.gain.gain, clamp(value.gain), now); setParam(voice.source.playbackRate, clamp(value.state.rate, .25, 3), now, .07);
    if (voice.panner && value.emitter.object) {
      value.emitter.object.getWorldPosition(this.position);
      if (voice.panner.positionX) { setParam(voice.panner.positionX, this.position.x, now); setParam(voice.panner.positionY, this.position.y, now); setParam(voice.panner.positionZ, this.position.z, now); }
      else voice.panner.setPosition(this.position.x, this.position.y, this.position.z);
    }
  }

  _remember(key, buffer) {
    const bytes = value => value.length * (value.numberOfChannels || 1) * 4;
    let used = Array.from(this.buffers.values()).reduce((sum, value) => sum + bytes(value), 0);
    while (this.buffers.size && !this.buffers.has(key) && (this.buffers.size >= MAX_BUFFERS || used + bytes(buffer) > MAX_DECODED_BYTES)) { const first = this.buffers.keys().next().value; used -= bytes(this.buffers.get(first)); this.buffers.delete(first); }
    this.buffers.set(key, buffer); return buffer;
  }
  _buffer(key, asset, preset, loop) {
    if (this.buffers.has(key)) return this.buffers.get(key);
    if (!asset) return this._remember(key, this._synthesize(preset, loop));
    if (this.loading.has(asset) || this.failed.has(asset)) return null;
    const generation = this.generation;
    let entry;
    try { schema.assetReference(asset); entry = this.library.getEntry(asset); if (!entry || entry.kind !== 'audio') throw new Error('Selecciona un archivo de audio de la biblioteca.'); if (entry.size > MAX_ASSET_BYTES) throw new Error('El audio supera 24 MB. Usa un clip más corto.'); }
    catch (error) { this.failed.add(asset); this.notify(error.message); return null; }
    const controller = typeof AbortController === 'undefined' ? null : new AbortController(), task = {controller}; this.loading.set(asset, task);
    Promise.resolve().then(async () => {
      const response = await fetch(this.library.getURL(asset), {credentials: 'same-origin', signal: controller ? controller.signal : undefined});
      if (!response.ok) throw new Error('No se pudo leer el archivo.');
      const advertised = Number(response.headers && response.headers.get('content-length')); if (advertised > MAX_ASSET_BYTES) throw new Error('El audio supera 24 MB.');
      const bytes = await response.arrayBuffer(); if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error('El audio supera 24 MB.');
      const buffer = await new Promise((resolve, reject) => { const pending = this.context.decodeAudioData(bytes, resolve, reject); if (pending && pending.catch) pending.catch(reject); });
      if (buffer.duration > 180) throw new Error('El audio supera 3 minutos. Usa un clip de ambiente o un ciclo más corto.');
      if (buffer.length * (buffer.numberOfChannels || 1) * 4 > MAX_DECODED_BYTES) throw new Error('El audio decodificado supera 64 MB. Usa un clip más corto.');
      if (this.running && generation === this.generation) {
        this._remember(key, buffer);
        const shot = task.shot;
        if (shot && !this.paused && !this.muted && !this.hidden() && this.context.currentTime <= shot.until && shot.generation === this.generation && visible(shot.value.emitter.object) && this._distance(shot.value.emitter).attenuation > 0) this._play(shot.value, false);
      }
    }).catch(error => {
      if (generation !== this.generation || error.name === 'AbortError') return;
      this.failed.add(asset); this.notify('No se pudo cargar el sonido ' + entry.name + ': ' + error.message);
    }).then(() => { if (this.loading.get(asset) === task) this.loading.delete(asset); });
    return null;
  }

  _synthesize(preset, loop) {
    const context = this.context, seconds = loop ? 2 : preset === 'button' ? .12 : preset === 'load' ? .38 : .65;
    const rate = context.sampleRate || 44100, buffer = context.createBuffer(1, Math.ceil(rate * seconds), rate), data = buffer.getChannelData(0);
    let seed = 73129, low = 0, slow = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate; seed = Math.imul(seed, 1664525) + 1013904223 | 0;
      const noise = (seed >>> 0) / 2147483648 - 1; low += .09 * (noise - low); slow += .004 * (noise - slow);
      const sine = frequency => Math.sin(t * frequency * Math.PI * 2), hum = sine(60) * .11 + sine(120) * .035;
      let sample;
      if (preset === 'button') sample = noise * .6 * Math.exp(-t * 110) + sine(1800) * .15 * Math.exp(-t * 85) + sine(420) * .2 * Math.exp(-t * 55);
      else if (preset === 'load') sample = sine(85) * .5 * Math.exp(-t * 24) + low * 1.6 * Math.exp(-t * 19) + noise * .16 * Math.exp(-t * 70);
      else if (preset === 'pneumatic') sample = noise * .25 * (loop ? .65 + .35 * sine(2) : Math.exp(-t * 5)) + sine(95) * .15 * (loop ? .1 : Math.exp(-t * 28));
      else if (preset === 'rollers') sample = hum * .7 + low * .5 + sine(620) * .065 * Math.pow(Math.max(0, sine(14)), 14);
      else if (preset === 'belt') sample = sine(48) * .13 + sine(96) * .035 + low * .65 * (1 + .15 * sine(3)) + noise * .025;
      else if (preset === 'elevator') sample = hum + sine(320) * .06 + low * .4 + sine(850) * .025 * Math.pow(Math.max(0, sine(8)), 12);
      else if (preset === 'processor') sample = hum + low * .7 + sine(165) * .045 * (.5 + .5 * sine(4));
      else if (preset === 'ventilation') sample = low * .65 + slow * .8 + sine(50) * .04 + sine(150) * .008;
      else if (preset === 'warehouse') sample = slow * 1.7 + low * .28 + sine(50) * .023 + sine(100) * .008;
      else if (preset === 'factory') sample = slow * 1.2 + low * .5 + sine(60) * .04 + sine(185) * .018 * (.5 + .5 * sine(2));
      else sample = hum + sine(240) * .025 + low * .4;
      const edge = Math.min(1, t / .008, (seconds - t) / (loop ? .008 : .025)); data[i] = clamp(sample, -1, 1) * Math.max(0, edge);
    }
    return buffer;
  }
}
