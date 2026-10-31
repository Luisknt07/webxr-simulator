'use strict';
// Local speech integrity plus private production-browser checks. Browser QA
// creates its own temporary SQLite account and Chrome profile, never a user DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomBytes} = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const ASSETS = path.join(ROOT, 'packages/voice-assistant/assets');
const OUTPUT = path.join(ROOT, 'data/qa-studio/voice-assistant');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function inspectWave(bytes) {
  assert(bytes.length >= 44, 'WAV must include PCM headers and samples.');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'RIFF length must match the actual file.');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let format, data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    assert(start + length <= bytes.length, 'WAV chunk exceeds the file.');
    if (id === 'fmt ') {
      assert(length >= 16);
      format = {encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8), blockAlign: bytes.readUInt16LE(start + 12), bitsPerSample: bytes.readUInt16LE(start + 14)};
    }
    if (id === 'data') data = bytes.subarray(start, start + length);
    offset = start + length + length % 2;
  }
  assert(format && data, 'WAV needs fmt and data chunks.');
  assert.deepEqual(format, {encoding: 1, channels: 1, sampleRate: 22050, byteRate: 44100, blockAlign: 2, bitsPerSample: 16});
  assert(data.length > 0 && data.length % 2 === 0);
  let squareSum = 0, peak = 0, nonzeroSamples = 0, crossings = 0, previous = 0;
  for (let offset = 0; offset < data.length; offset += 2) {
    const value = data.readInt16LE(offset) / 32768;
    squareSum += value * value; peak = Math.max(peak, Math.abs(value));
    if (value !== 0) nonzeroSamples++;
    if (value * previous < 0) crossings++;
    previous = value;
  }
  const frames = data.length / 2, duration = frames / format.sampleRate, rms = Math.sqrt(squareSum / frames);
  assert(duration > 1 && duration <= 20, 'Speech fixtures must be short, positive recordings.');
  assert(rms > 0.005 && peak > 0.05, 'Speech must have nonzero audible PCM energy.');
  assert(nonzeroSamples > frames * .15 && crossings > 50, 'Speech fixture cannot be an empty or constant PCM buffer.');
  return {...format, frames, duration, rms, peak, nonzeroSamples, crossings};
}

function validateAssets() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.language, 'es-MX');
  assert.equal(manifest.voice, 'Microsoft Sabina Desktop');
  assert.deepEqual(manifest.format, {container: 'wav', encoding: 'PCM', sampleRate: 22050, channels: 1, bitsPerSample: 16});
  assert.deepEqual(manifest.samples.map(sample => sample.id), ['welcome', 'pickup', 'route', 'deposit', 'completed', 'safety']);
  assert.match(fs.readFileSync(path.join(ASSETS, 'README.md'), 'utf8'), /Microsoft Sabina Desktop/);
  const samples = manifest.samples.map(sample => {
    assert.equal(sample.file, sample.id + '.wav');
    assert.equal(sample.language, manifest.language); assert.equal(sample.voice, manifest.voice);
    assert.equal(typeof sample.title, 'string'); assert(sample.title.length > 3);
    assert.equal(typeof sample.text, 'string'); assert(sample.text.length > 40);
    assert(!sample.text.includes('\uFFFD') && !sample.text.includes('\u00C3'), 'Spanish transcript must not be garbled.');
    const bytes = fs.readFileSync(path.join(ASSETS, sample.file)), pcm = inspectWave(bytes);
    assert.equal(sample.bytes, bytes.length); assert.equal(sample.sha256, hash(bytes));
    assert(Math.abs(sample.duration - pcm.duration) < .000001);
    return {id: sample.id, file: sample.file, bytes: bytes.length, sha256: sample.sha256, language: sample.language, voice: sample.voice, ...pcm};
  });
  return {realLocalSpeech: true, provenance: manifest.generatedWith, language: manifest.language, voice: manifest.voice, totalBytes: samples.reduce((sum, sample) => sum + sample.bytes, 0), samples};
}

// This stub is used only on a separate document to inspect dynamic native-TTS
// requests and deterministic microphone error handling. The recording playback
// case above it uses the browser's actual audio decoder and output graph.
function nativeSpeechFixture(emptyVoices = false) {
  const qa = window.__voiceNativeQA = {utterances: [], cancels: 0, microphoneStarts: 0, microphoneAborts: 0};
  const voices = emptyVoices ? [] : [{voiceURI: 'qa:es-mx', name: 'QA Spanish local', lang: 'es-MX', localService: true}, {voiceURI: 'qa:es-alt', name: 'QA Spanish alternative', lang: 'es-ES', localService: true}];
  class Utterance { constructor(text) { this.text = text; } }
  const synthesis = {getVoices: () => voices, addEventListener() {}, removeEventListener() {}, speak(utterance) { qa.utterances.push({text: utterance.text, lang: utterance.lang, voice: utterance.voice && utterance.voice.voiceURI, volume: utterance.volume, rate: utterance.rate}); qa.active = utterance; }, cancel() { qa.cancels++; qa.active = null; }};
  class Recognition {
    start() { qa.microphoneStarts++; qa.recognition = this; }
    abort() { qa.microphoneAborts++; if (qa.recognition === this) qa.recognition = null; }
  }
  for (const [key, value] of Object.entries({speechSynthesis: synthesis, SpeechSynthesisUtterance: Utterance, SpeechRecognition: Recognition, webkitSpeechRecognition: undefined})) Object.defineProperty(window, key, {value, configurable: true});
}
function unsupportedSpeechFixture() {
  for (const key of ['speechSynthesis', 'SpeechSynthesisUtterance', 'SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, key, {value: undefined, configurable: true});
}

async function verifyBrowser(fixture, b, password, report) {
  console.log('Voice production QA: public UI and real local Spanish playback');
  const until = (callback, message) => b.until(callback, message, 60000);
  const click = async selector => {
    const point = await b.call(selector => { const element = document.querySelector(selector); if (!element || element.disabled) throw new Error('Unavailable voice control: ' + selector); const details=element.closest('details');if(details&&!details.open)details.querySelector('summary').click();element.scrollIntoView({block: 'nearest'}); const rect = element.getBoundingClientRect(); return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2}; }, selector);
    await b.send('Input.dispatchMouseEvent', {type: 'mousePressed', button: 'left', clickCount: 1, ...point});
    await b.send('Input.dispatchMouseEvent', {type: 'mouseReleased', button: 'left', clickCount: 1, ...point});
  };
  const attach = () => b.call(() => { const ctx = window.smartTwinViewer ? smartTwinViewer.context : window.context; if (!ctx || !ctx.voiceAssistant || !ctx.voicePanel) throw new Error('Voice module not attached to host context.'); window.__voiceQA = {ctx, assistant: ctx.voiceAssistant, panel: ctx.voicePanel}; return {state: ctx.voiceAssistant.state(), snapshot: ctx.voiceAssistant.snapshot()}; });
  const open = async () => { if (!await b.evaluate('Boolean(__voiceQA.panel.opened)')) await click('[data-voice-assistant-toggle]'); await until(() => b.evaluate('Boolean(__voiceQA.panel.opened && !document.querySelector("[data-voice-assistant-panel]").hidden)'), 'Voice panel did not open.'); };
  const stop = async () => { if (await b.evaluate('__voiceQA.assistant.state().speaking || __voiceQA.assistant.state().listening')) await click('[data-voice-action="stop"]'); };
  const panelLayout = async () => {
    const layout = await b.call(() => { const panel = document.querySelector('[data-voice-assistant-panel]'), close = panel.querySelector('[data-voice-action="close"]'), rect = node => { const r = node.getBoundingClientRect(); return {x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height}; }, button = close.getBoundingClientRect(), hit = document.elementFromPoint(button.x + button.width / 2, button.y + button.height / 2); return {panel: rect(panel), header: rect(panel.querySelector('.voice-assistant-header')), status: rect(panel.querySelector('.voice-assistant-status')), caption: rect(panel.querySelector('.voice-assistant-caption')), close: rect(close), closeReachable: !!hit && close.contains(hit)}; });
    assert(layout.header.x >= layout.panel.x && layout.header.right <= layout.panel.right + 1 && layout.header.y >= layout.panel.y, 'Panel header must fit inside the voice panel.');
    assert(layout.header.bottom <= layout.status.y + 1 && layout.status.bottom <= layout.caption.y + 1, 'Header, status and caption must not overlap.');
    assert(layout.close.width > 0 && layout.close.height > 0 && layout.close.right <= layout.panel.right + 1 && layout.close.bottom <= layout.panel.bottom + 1 && layout.closeReachable, 'The voice close button must remain visible and reachable.');
    return layout;
  };

  await b.send('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false});
  await b.send('Emulation.setFocusEmulationEnabled', {enabled: true});
  await b.send('Page.navigate', {url: fixture.origin + '/#escenarios'});
  await until(() => b.evaluate('Boolean(window.smartTwinGallery && document.querySelector(".scene-open[data-scene-id=vr-robot-dispatch]"))'), 'Public lesson gallery unavailable.');
  await click('.scene-open[data-scene-id="vr-robot-dispatch"]');
  await until(() => b.evaluate('Boolean(window.smartTwinViewer && smartTwinViewer.context.voiceAssistant && smartTwinViewer.context.voicePanel)'), 'Public voice module unavailable.');
  report.publicEntry = await attach(); assert.equal(report.publicEntry.state.enabled, false); assert.equal(report.publicEntry.state.speaking, false); assert.equal(report.publicEntry.state.listening, false); assert.equal(report.publicEntry.state.samples.length, 6);
  await until(() => b.evaluate('Boolean(document.querySelector(".viewer-header .header-actions [data-voice-assistant-toggle]"))'), 'Public voice launcher did not join the visible scene header.');
  report.publicLauncher = await b.call(() => { const element = document.querySelector('[data-voice-assistant-toggle]'), rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return {inHeader: !!element.closest('.viewer-header .header-actions'), floating: element.classList.contains('voice-assistant-launcher-floating'), reachable: rect.width > 0 && rect.height > 0 && !!hit && element.contains(hit)}; });
  assert(report.publicLauncher.inHeader && !report.publicLauncher.floating && report.publicLauncher.reachable);
  await open();
  report.publicPanelLayout = await panelLayout();
  // Disable automatic narration to isolate explicitly selected sample playback.
  await b.call(() => { const a = __voiceQA.assistant; a.setAutomatic(false); });
  await click('[data-voice-action="enabled"]');
  assert.equal(await b.evaluate('__voiceQA.assistant.state().enabled'), true);
  await b.call(() => { const select = document.querySelector('select[aria-label="Grabación de prueba"]'); select.value = 'welcome'; select.dispatchEvent(new Event('change', {bubbles: true})); });
  await click('[data-voice-action="samplePlay"]');
  await until(() => b.evaluate('Boolean(__voiceQA.assistant.source && __voiceQA.assistant.source.buffer || __voiceQA.assistant.audio && !__voiceQA.assistant.audio.paused && __voiceQA.assistant.audio.readyState >= 2)'), 'Real Spanish recording did not start.');
  report.realPlayback = await b.call(async () => {
    const a = __voiceQA.assistant, sample = a.samples.find(row => row.id === 'welcome'), sourceBuffer = a.source && a.source.buffer;
    const response = await fetch(a.sampleURL(sample)); if (!response.ok) throw new Error('Speech asset HTTP ' + response.status);
    const bytes = await response.arrayBuffer(), digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
    // Decode a fresh copy of the served WAV through the real browser decoder.
    // This separate context is QA owned; the host's shared context is untouched.
    const decoder = new AudioContext(); let decoded;
    try { decoded = await decoder.decodeAudioData(bytes.slice(0)); } finally { await decoder.close(); }
    const energy = buffer => { const data = buffer.getChannelData(0); let sum = 0, peak = 0; for (const value of data) { sum += value * value; peak = Math.max(peak, Math.abs(value)); } return {sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, frames: buffer.length, duration: buffer.duration, rms: Math.sqrt(sum / data.length), peak}; };
    const audio = a.audio;
    const shared = a.options.getAudioContext && a.options.getAudioContext();
    return {transport: sourceBuffer ? 'shared-web-audio' : 'native-html-audio', state: a.state(), sha256: digest, bytes: bytes.byteLength, decoded: energy(decoded), playingBuffer: sourceBuffer ? energy(sourceBuffer) : null, sharedContextState: shared && shared.state, playbackClock: sourceBuffer ? shared.currentTime : audio.currentTime, media: audio ? {paused: audio.paused, readyState: audio.readyState, currentTime: audio.currentTime, duration: audio.duration} : null};
  });
  const welcome = report.assets.samples.find(sample => sample.id === 'welcome');
  assert.equal(report.realPlayback.sha256, welcome.sha256); assert.equal(report.realPlayback.bytes, welcome.bytes);
  assert(report.realPlayback.decoded.rms > .005 && report.realPlayback.decoded.peak > .05);
  assert(Math.abs(report.realPlayback.decoded.duration - welcome.duration) < .002);
  assert.equal(report.realPlayback.state.lastIntent, 'sample'); assert.equal(report.realPlayback.state.speaking, true);
  if (report.realPlayback.playingBuffer) { assert(report.realPlayback.playingBuffer.rms > .005); assert.equal(report.realPlayback.sharedContextState, 'running'); }
  else { assert.equal(report.realPlayback.media.paused, false); assert(report.realPlayback.media.readyState >= 2); }
  report.realPlayback.advancedClock = await until(() => b.call(start => { const a = __voiceQA.assistant, clock = a.source ? a.options.getAudioContext().currentTime : a.audio && a.audio.currentTime; return a.state().speaking && clock > start + .02 ? clock : false; }, report.realPlayback.playbackClock), 'Real recording playback clock did not advance.');
  await b.screenshot('voice-real-spanish-playback');
  await stop();
  report.stopped = await b.call(() => ({state: __voiceQA.assistant.state(), sourceReleased: !__voiceQA.assistant.source, mediaReleased: !__voiceQA.assistant.audio, sharedContextState: __voiceQA.assistant.options.getAudioContext && __voiceQA.assistant.options.getAudioContext() && __voiceQA.assistant.options.getAudioContext().state}));
  assert.equal(report.stopped.state.speaking, false); assert(report.stopped.sourceReleased && report.stopped.mediaReleased); assert.notEqual(report.stopped.sharedContextState, 'closed');
  report.servedSamples = await b.call(async () => {
    const decoder = new AudioContext(), rows = [];
    try {
      for (const sample of __voiceQA.assistant.samples) {
        const response = await fetch(__voiceQA.assistant.sampleURL(sample)); if (!response.ok) throw new Error('Speech fixture unavailable: ' + sample.id);
        const bytes = await response.arrayBuffer(), digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join(''), decoded = await decoder.decodeAudioData(bytes.slice(0)), data = decoded.getChannelData(0);
        let energy = 0; for (const value of data) energy += value * value;
        rows.push({id: sample.id, bytes: bytes.byteLength, sha256: digest, duration: decoded.duration, rms: Math.sqrt(energy / data.length)});
      }
      return rows;
    } finally { await decoder.close(); }
  });
  assert.equal(report.servedSamples.length, 6);
  for (const served of report.servedSamples) { const source = report.assets.samples.find(sample => sample.id === served.id); assert.equal(served.sha256, source.sha256); assert.equal(served.bytes, source.bytes); assert(Math.abs(served.duration - source.duration) < .002); assert(served.rms > .005); }
  report.mobile = [];
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await b.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    await b.call(() => __voiceQA.panel.step(.3));
    const layout = await b.call(() => { const node = document.querySelector('[data-voice-assistant-panel]'), rect = node.getBoundingClientRect(); return {viewport: [innerWidth, innerHeight], rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom}, scrollWidth: document.documentElement.scrollWidth, panelScrollWidth: node.scrollWidth, panelClientWidth: node.clientWidth}; });
    assert(layout.rect.x >= 0 && layout.rect.y >= 0 && layout.rect.right <= width + 1 && layout.rect.bottom <= height + 1); assert(layout.scrollWidth <= width + 1); assert(layout.panelScrollWidth <= layout.panelClientWidth + 1);
    report.mobile.push(layout); await b.screenshot('voice-mobile-' + width);
  }
  await click('[data-voice-action="close"]'); assert.equal(await b.evaluate('__voiceQA.ctx.voicePanelOpen'), false);
  await b.send('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false});

  // Native speech and microphone are now deterministic test adapters on a new
  // document. They are never used to claim real audio generation or ASR quality.
  const native = await b.send('Page.addScriptToEvaluateOnNewDocument', {source: '(' + nativeSpeechFixture.toString() + ')();'});
  console.log('Voice production QA: private live mission and isolated native speech adapter');
  await b.send('Page.navigate', {url: fixture.origin + '/editor?libraryScene=vr-warehouse-missions'});
  await until(() => b.evaluate('Boolean(document.getElementById("login"))'), 'Private owner login unavailable.');
  await b.call(password => { const form = document.getElementById('login'); form.elements.username.value = 'qa_production_owner'; form.elements.password.value = password; form.requestSubmit(); }, password);
  const privateReady = () => until(() => b.evaluate('Boolean(window.context && context.editor && !context.editor.initializing && !context.editor.loadingProject && context.editor.currentProject && context.editor.currentProject.librarySceneId === "vr-warehouse-missions" && context.voiceAssistant && context.voicePanel)'), 'Private warehouse voice lesson did not initialize.');
  await privateReady(); await b.evaluate('context.studio.ready');
  await b.call(() => { const e = context.editor; if (e.active) e.leave(); e.simulationPaused = false; });
  await until(() => b.evaluate('Boolean(context.editor.simulation && context.editor.simulation.running && context.editor.simulation.vehicleTraining)'), 'Warehouse simulation unavailable.');
  report.privateEntry = await attach(); assert.equal(report.privateEntry.state.enabled, false); assert.equal(report.privateEntry.state.speechSupported, true);
  report.warehouse = await b.call(() => {
    const e = context.editor, s = e.simulation, vehicle = [...s.records.values()].find(record => record.components.vehicle && record.components.vehicle.config.trainingTasksJson !== '[]');
    if (!vehicle || !e.vehicleDriving.mount(vehicle.id)) throw new Error('Real warehouse training vehicle unavailable.');
    const d = e.vehicleDriving; s.vehicleRuntime.command(vehicle, 'powerOn', true); s.vehicleRuntime.command(vehicle, 'start', true); s.vehicleRuntime.command(vehicle, 'parkingBrake', false); d.follow(); d.holographicGuide.update(true); d.updateHUD();
    __voiceQA.vehicle = vehicle;
    const a = __voiceQA.assistant; a.setAutomatic(false);
    return {vehicleId: vehicle.id, actualGuidance: d.holographicGuide.getState(), mission: s.vehicleTraining.guidance(vehicle), snapshot: a.snapshot(), microphoneStarts: __voiceNativeQA.microphoneStarts};
  });
  assert.equal(report.warehouse.mission.phase, 'pickup'); assert.equal(report.warehouse.mission.completed, 0); assert.equal(report.warehouse.microphoneStarts, 0);
  assert(report.warehouse.snapshot.guidance.text.includes(report.warehouse.actualGuidance.instruction), 'Narration must include the live forklift instruction.');
  assert.notEqual(report.warehouse.snapshot.guidance.completed, true);
  await open();
  report.privatePanelLayout = await panelLayout();
  await click('[data-voice-action="next"]');
  report.nativeNext = await b.call(() => ({utterance: __voiceNativeQA.utterances.at(-1), snapshot: __voiceQA.assistant.snapshot(), state: __voiceQA.assistant.state(), count: __voiceNativeQA.utterances.length}));
  assert.equal(report.nativeNext.utterance.text, report.nativeNext.snapshot.guidance.spokenText||report.nativeNext.snapshot.guidance.text); assert.equal(report.nativeNext.state.lastIntent, 'next'); assert.equal(report.nativeNext.utterance.lang, 'es-MX');
  await stop();
  await click('[data-voice-action="repeat"]');
  report.repeated = await b.call(() => __voiceNativeQA.utterances.at(-1)); assert.equal(report.repeated.text, report.nativeNext.utterance.text); await stop();
  report.automatic = await b.call(() => {
    const a = __voiceQA.assistant, e = context.editor, vehicle = __voiceQA.vehicle, before = __voiceNativeQA.utterances.length;
    a.setAutomatic(true); a.step(.3); a.step(.3); const afterManualKey = __voiceNativeQA.utterances.length;
    // A real vehicle power interlock produces a new, authoritative instruction;
    // the task, product and warehouse completion state remain untouched.
    e.simulation.vehicleRuntime.command(vehicle, 'powerOff', true); e.vehicleDriving.holographicGuide.update(true); e.vehicleDriving.updateHUD();
    const changed = a.snapshot();for(let tick=0;tick<12;tick++)a.step(.3);const firstNewKey = __voiceNativeQA.utterances.length;for(let tick=0;tick<12;tick++)a.step(.3);const after = __voiceNativeQA.utterances.length, utterance = __voiceNativeQA.utterances.at(-1);
    a.setAutomatic(false); e.simulation.vehicleRuntime.command(vehicle, 'powerOn', true); e.simulation.vehicleRuntime.command(vehicle, 'start', true); e.simulation.vehicleRuntime.command(vehicle, 'parkingBrake', false); e.vehicleDriving.holographicGuide.update(true); e.vehicleDriving.updateHUD();
    return {before, afterManualKey, firstNewKey, after, changed, utterance};
  });
  assert.equal(report.automatic.afterManualKey, report.automatic.before); assert.equal(report.automatic.firstNewKey, report.automatic.before + 1); assert.equal(report.automatic.after, report.automatic.firstNewKey); assert.equal(report.automatic.utterance.text, report.automatic.changed.guidance.spokenText||report.automatic.changed.guidance.text); await stop();
  for (const intent of ['objective', 'controls', 'content']) {
    await click('[data-voice-action="' + intent + '"]');
    const narration = await b.call(intent => ({utterance: __voiceNativeQA.utterances.at(-1), expected: __voiceQA.assistant.snapshot()[intent], intent: __voiceQA.assistant.state().lastIntent}), intent);
    assert.equal(narration.intent, intent); assert.equal(narration.utterance.text, narration.expected); report['native' + intent[0].toUpperCase() + intent.slice(1)] = narration; await stop();
  }
  await b.call(() => { const node = document.querySelector('select[aria-label="Voz del dispositivo"]'); node.value = 'qa:es-alt'; node.dispatchEvent(new Event('change', {bubbles: true})); for (const [label, value] of [['Volumen de voz', '.55'], ['Velocidad', '1.2']]) { const node = document.querySelector('input[aria-label="' + label + '"]'); node.value = value; node.dispatchEvent(new Event('input', {bubbles: true})); } });
  await click('[data-voice-action="next"]');
  report.selectedVoice = await b.call(() => __voiceNativeQA.utterances.at(-1)); assert.equal(report.selectedVoice.voice, 'qa:es-alt'); assert.equal(report.selectedVoice.volume, .55); assert.equal(report.selectedVoice.rate, 1.2);
  report.pause = await b.call(() => { const a = __voiceQA.assistant, before = __voiceNativeQA.cancels; context.editor.simulationPaused = true; a.step(.3); const result = {state: a.state(), cancelled: __voiceNativeQA.cancels > before}; context.editor.simulationPaused = false; return result; });
  assert.equal(report.pause.state.speaking, false); assert(report.pause.cancelled);
  // The explicit mic button starts the isolated recognition adapter. A denied
  // permission result keeps help usable and never reaches a real microphone.
  await click('[data-voice-action="mic"]');
  assert.equal(await b.evaluate('__voiceNativeQA.microphoneStarts'), 1);
  await b.call(() => __voiceNativeQA.recognition.onerror({error: 'not-allowed'}));
  report.microphoneDenied = await b.call(() => __voiceQA.assistant.state()); assert.equal(report.microphoneDenied.listening, false); assert.match(report.microphoneDenied.status, /permiso/);
  await click('[data-voice-action="mic"]');
  await b.call(() => __voiceNativeQA.recognition.onresult({resultIndex: 0, results: [[{transcript: 'qué hago ahora'}]]}));
  report.microphoneIntent = await b.call(() => ({state: __voiceQA.assistant.state(), utterance: __voiceNativeQA.utterances.at(-1)})); assert.equal(report.microphoneIntent.state.lastIntent, 'next'); assert.equal(report.microphoneIntent.state.listening, false); assert.equal(report.microphoneIntent.utterance.text, report.nativeNext.utterance.text);
  await stop(); await b.screenshot('voice-private-live-mission');
  report.privateMobile = [];
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await b.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false}); await b.call(() => { __voiceQA.panel.element.scrollTop = 0; __voiceQA.panel.step(.3); });
    const layout = await panelLayout(); assert(layout.panel.x >= 0 && layout.panel.y >= 0 && layout.panel.right <= width + 1 && layout.panel.bottom <= height + 1);
    report.privateMobile.push({viewport: [width, height], ...layout}); await b.screenshot('voice-private-mobile-' + width);
  }
  await b.send('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false}); await b.call(() => { __voiceQA.panel.element.scrollTop = 0; __voiceQA.panel.step(.3); });

  report.xr = await b.call(() => {
    const {ctx, panel, assistant} = __voiceQA, pose = node => node ? node.position.toArray().concat(node.quaternion.toArray()) : [], camera = pose(ctx.camera), rig = pose(ctx.camera.parent), initialVolume = assistant.state().volume, releases = {geometry: 0, material: 0, texture: 0};
    const xr = ctx.renderer.xr, original = {mode: ctx.vrMode, presenting: xr.isPresenting, getSession: xr.getSession, getCamera: xr.getCamera}, session = {visibilityState: 'visible'};
    let result;
    // Everything is restored synchronously before the renderer's next frame.
    // The fixture supplies a session and the existing unchanged camera only.
    try {
      panel.close(); ctx.vrMode = true; xr.isPresenting = true; xr.getSession = () => session; xr.getCamera = () => ctx.camera;
      panel.step(.3); if (!panel.xrPanel) throw new Error('XR voice launcher unavailable.');
      const launcherVisible = panel.xrPanel.visible && !panel.opened && panel.xrCanvas.width === 512 && panel.xrCanvas.height === 160;
      const launcherController = {}, launcherHit = {actualObject: panel.xrPanel, object: panel.xrPanel, distance: 1.6, uv: {x: .5, y: .5}};
      panel.xrState.onSelectStart(launcherHit, launcherController); panel.xrState.onSelectEnd(launcherHit, launcherController);
      if (!panel.opened) throw new Error('XR ray action did not open voice controls.');
      const stateName = panel.stateName, mesh = panel.xrPanel, texture = panel.xrTexture;
      mesh.geometry.addEventListener('dispose', () => releases.geometry++); mesh.material.addEventListener('dispose', () => releases.material++); texture.addEventListener('dispose', () => releases.texture++);
      const hitRegion = key => { const region = panel.regions.find(row => row.key === key); return {actualObject: mesh, object: mesh, distance: 1.4, uv: {x: (region.x + region.width / 2) / 896, y: 1 - (region.y + region.height / 2) / 1024}}; };
      const controller = {}, hit = hitRegion('volumeDown');
      panel.xrState.onSelectStart(hit, controller); const firstVolume = assistant.state().volume; panel.xrState.onSelectStart(hit, controller); const heldVolume = assistant.state().volume; panel.xrState.onSelectEnd(hit, controller);
      const visible = mesh.visible, stateRegistered = ctx.raycontrol.states[stateName] === panel.xrState, worldSpace = mesh.parent === ctx.scene, activeSnapshot = assistant.snapshot(), countBefore = __voiceNativeQA.utterances.length, nextHit = hitRegion('next');
      panel.xrState.onSelectStart(nextHit, controller); panel.xrState.onSelectEnd(nextHit, controller);
      const utterance = __voiceNativeQA.utterances.at(-1), countAfter = __voiceNativeQA.utterances.length, speakingBeforeSuspend = assistant.state().speaking, cancelsBefore = __voiceNativeQA.cancels;
      session.visibilityState = 'hidden'; assistant.step(.3); panel.step(.3);
      const suspendedHidden = !panel.xrPanel.visible && !panel.opened && !ctx.voicePanelOpen, voiceStoppedOnSuspend = !assistant.state().speaking && __voiceNativeQA.cancels > cancelsBefore;
      result = {fixture: 'Simulated XR session visibility with the real canvas panel, bridge and ray callbacks; no headset session', stateName, launcherVisible, visible, worldSpace, stateRegistered, initialVolume, firstVolume, heldVolume, activeSnapshot, utterance, countBefore, countAfter, speakingBeforeSuspend, suspendedHidden, voiceStoppedOnSuspend};
    } finally { ctx.vrMode = original.mode; xr.isPresenting = original.presenting; xr.getSession = original.getSession; xr.getCamera = original.getCamera; panel.step(.3); }
    return {...result, releases, stateRemoved: !ctx.raycontrol.states[result.stateName], meshReleased: !panel.xrPanel, panelClosed: !ctx.voicePanelOpen, cameraUnchanged: camera.every((value, index) => Math.abs(value - pose(ctx.camera)[index]) < 1e-9) && rig.every((value, index) => Math.abs(value - pose(ctx.camera.parent)[index]) < 1e-9)};
  });
  assert(report.xr.launcherVisible && report.xr.visible && report.xr.worldSpace && report.xr.stateRegistered && report.xr.suspendedHidden && report.xr.voiceStoppedOnSuspend && report.xr.speakingBeforeSuspend && report.xr.stateRemoved && report.xr.meshReleased && report.xr.panelClosed && report.xr.cameraUnchanged); assert(report.xr.activeSnapshot.immersiveActive); assert.equal(report.xr.countAfter, report.xr.countBefore + 1); assert.equal(report.xr.utterance.text, report.xr.activeSnapshot.guidance.spokenText||report.xr.activeSnapshot.guidance.text); assert(report.xr.firstVolume < report.xr.initialVolume); assert.equal(report.xr.firstVolume, report.xr.heldVolume); assert.deepEqual(report.xr.releases, {geometry: 1, material: 1, texture: 1});
  await b.send('Page.removeScriptToEvaluateOnNewDocument', {identifier: native.identifier});

  const unsupported = await b.send('Page.addScriptToEvaluateOnNewDocument', {source: '(' + unsupportedSpeechFixture.toString() + ')();'});
  console.log('Voice production QA: unsupported-TTS text and real recording fallback');
  await b.send('Page.navigate', {url: fixture.origin + '/editor?libraryScene=vr-warehouse-missions'}); await privateReady(); await b.evaluate('context.studio.ready');
  await b.call(() => { if (context.editor.active) context.editor.leave(); context.editor.simulationPaused = false; });
  await until(() => b.evaluate('Boolean(context.editor.simulation && context.editor.simulation.running && !context.editor.busy)'), 'Fallback lesson runtime unavailable.');
  await attach(); await b.call(() => __voiceQA.assistant.setAutomatic(false)); await open();
  await click('[data-voice-action="objective"]');
  await until(() => b.evaluate('Boolean(__voiceQA.assistant.source && __voiceQA.assistant.source.buffer || __voiceQA.assistant.audio && !__voiceQA.assistant.audio.paused && __voiceQA.assistant.audio.readyState >= 2)'), 'Unsupported-TTS fallback did not play the real generic recording.');
  report.unsupported = await b.call(() => ({state: __voiceQA.assistant.state(), snapshot: __voiceQA.assistant.snapshot(), caption: document.querySelector('.voice-assistant-caption').textContent, microphoneDisabled: document.querySelector('[data-voice-action="mic"]').disabled, voiceDisabled: document.querySelector('select[aria-label="Voz del dispositivo"]').disabled, voiceSelection: document.querySelector('select[aria-label="Voz del dispositivo"]').value, sourceDuration: __voiceQA.assistant.source && __voiceQA.assistant.source.buffer.duration, mediaSource: __voiceQA.assistant.audio && __voiceQA.assistant.audio.src}));
  assert.equal(report.unsupported.state.speechSupported, false); assert.equal(report.unsupported.state.recognitionSupported, false); assert(report.unsupported.microphoneDisabled && report.unsupported.voiceDisabled); assert.equal(report.unsupported.voiceSelection, 'auto'); assert.equal(report.unsupported.caption, report.unsupported.snapshot.objective); assert.match(report.unsupported.state.status, /grabado/);
  if (report.unsupported.sourceDuration) assert(Math.abs(report.unsupported.sourceDuration - welcome.duration) < .002); else assert.match(report.unsupported.mediaSource, /welcome\.wav$/);
  await stop(); await b.screenshot('voice-unsupported-text-and-recording');
  await b.send('Page.removeScriptToEvaluateOnNewDocument', {identifier: unsupported.identifier});
  // Some browsers expose the API but have not installed a usable Spanish
  // voice. That common condition must also select the actual WAV fallback.
  const empty = await b.send('Page.addScriptToEvaluateOnNewDocument', {source: '(' + nativeSpeechFixture.toString() + ')(true);'});
  await b.send('Page.navigate', {url: fixture.origin + '/editor?libraryScene=vr-warehouse-missions'}); await privateReady(); await b.evaluate('context.studio.ready');
  await b.call(() => { if (context.editor.active) context.editor.leave(); context.editor.simulationPaused = false; });
  await until(() => b.evaluate('Boolean(context.editor.simulation && context.editor.simulation.running && !context.editor.busy)'), 'Empty-voice-list runtime unavailable.');
  await attach(); await b.call(() => __voiceQA.assistant.setAutomatic(false)); await open(); await click('[data-voice-action="objective"]');
  await until(() => b.evaluate('Boolean(__voiceQA.assistant.source && __voiceQA.assistant.source.buffer || __voiceQA.assistant.audio && !__voiceQA.assistant.audio.paused && __voiceQA.assistant.audio.readyState >= 2)'), 'Empty Spanish voice list did not use the actual recording fallback.');
  report.emptyNativeVoices = await b.call(() => ({state: __voiceQA.assistant.state(), utteranceCount: __voiceNativeQA.utterances.length, caption: document.querySelector('.voice-assistant-caption').textContent, objective: __voiceQA.assistant.snapshot().objective, voiceSelection: document.querySelector('select[aria-label="Voz del dispositivo"]').value, sourceDuration: __voiceQA.assistant.source && __voiceQA.assistant.source.buffer.duration, mediaSource: __voiceQA.assistant.audio && __voiceQA.assistant.audio.src}));
  assert.equal(report.emptyNativeVoices.state.speechSupported, true); assert.equal(report.emptyNativeVoices.state.voices.length, 0); assert.equal(report.emptyNativeVoices.utteranceCount, 0); assert.equal(report.emptyNativeVoices.voiceSelection, 'auto'); assert.equal(report.emptyNativeVoices.caption, report.emptyNativeVoices.objective); assert.match(report.emptyNativeVoices.state.status, /grabado/);
  if (report.emptyNativeVoices.sourceDuration) assert(Math.abs(report.emptyNativeVoices.sourceDuration - welcome.duration) < .002); else assert.match(report.emptyNativeVoices.mediaSource, /welcome\.wav$/);
  await stop();
  // Use a normal owned project in this disposable database. Library templates
  // are read-only, so authoring visibility must not bypass their access rules.
  console.log('Voice production QA: launcher reachability in private authoring and preview');
  await b.call(async () => {
    __voiceQA.panel.close(); const e = context.editor;
    const prepared = await e.studioTools.compileStudyProject(['vr-warehouse-missions'], {name: 'QA voice authoring disposable'});
    const copy = await e.projectClient.createProject(prepared.name, prepared.document); await e.applyServerProject(copy); e.projectSync.stop();
    if (!e.active) e.enter(); window.__voiceAuthorProjectId = copy.id;
  });
  await until(() => b.evaluate('Boolean(context.editor.active && !context.editor.busy && !context.editor.loadingProject && context.editor.currentProject.id === __voiceAuthorProjectId && context.voiceAssistant && context.voicePanel)'), 'Owned authoring project unavailable.');
  await attach();
  const launcherLayout = () => b.call(() => { const element = document.querySelector('[data-voice-assistant-toggle]'), rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return {editorActive: context.editor.active, inToolbar: element.parentNode === context.editor.toolbar, inPreviewHeader: !!element.closest('.studio-header-actions'), inBody: element.parentNode === document.body, floating: element.classList.contains('voice-assistant-launcher-floating'), width: rect.width, height: rect.height, reachable: rect.width > 0 && rect.height > 0 && !!hit && element.contains(hit), panelHidden: document.querySelector('[data-voice-assistant-panel]').hidden}; });
  await until(async () => { const layout = await launcherLayout(); return layout.reachable && layout; }, 'Voice launcher is unreachable while the editor hides its studio header.');
  report.authoringLauncher = await launcherLayout(); assert(report.authoringLauncher.editorActive && report.authoringLauncher.inToolbar && !report.authoringLauncher.floating && report.authoringLauncher.reachable);
  await open(); report.authoringPanelLayout = await panelLayout(); await b.screenshot('voice-authoring-launcher'); await click('[data-voice-action="close"]');
  await b.call(() => context.editor.leave());
  await until(async () => { const layout = await launcherLayout(); return !layout.editorActive && layout.inPreviewHeader && layout.reachable && layout; }, 'Voice launcher did not return to the visible preview header.');
  report.previewLauncher = await launcherLayout(); assert(!report.previewLauncher.editorActive && report.previewLauncher.inPreviewHeader && report.previewLauncher.reachable);
  report.disposal = await b.call(() => { const {assistant, panel} = __voiceQA; panel.dispose(); assistant.dispose(); return {serviceDisposed: assistant.state().disposed, speaking: assistant.state().speaking, listening: assistant.state().listening, panelDisposed: panel.disposed, domRemoved: !document.querySelector('[data-voice-assistant-panel]') && !document.querySelector('[data-voice-assistant-toggle]'), listeners: assistant.listeners.size, audioReleased: !assistant.source && !assistant.audio}; });
  assert(report.disposal.serviceDisposed && report.disposal.panelDisposed && report.disposal.domRemoved && report.disposal.audioReleased); assert.equal(report.disposal.speaking, false); assert.equal(report.disposal.listening, false); assert.equal(report.disposal.listeners, 0);
  await b.send('Page.removeScriptToEvaluateOnNewDocument', {identifier: empty.identifier});
}

async function run(options = {}) {
  const assets = validateAssets();
  if (options.assetsOnly) { console.log(JSON.stringify(assets, null, 2)); return {passed: true, assets}; }
  const {startFixture, withBrowser} = require('./workspace-production.cjs');
  const workspace = fs.readFileSync(path.join(ROOT, 'artifacts/workspace/bundle.js'));
  const workspaceSha256 = hash(workspace), publicSha256 = hash(fs.readFileSync(path.join(ROOT, 'artifacts/public-viewer/viewer.js')));
  if (options.expectedWorkspaceSha256) assert.equal(workspaceSha256, options.expectedWorkspaceSha256, 'Workspace changed after review.');
  for (const [application, expected] of [['workspace', workspaceSha256], ['public-viewer', publicSha256]]) assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts', application, 'publication.json'), 'utf8')).bundleSha256, expected, 'Finish immutable production packaging before QA.');
  fs.mkdirSync(OUTPUT, {recursive: true});
  // withBrowser owns the shared screenshot destination, not the database.
  fs.mkdirSync(path.join(ROOT, 'data/qa-studio/workspace-production'), {recursive: true});
  const report = {startedAt: new Date().toISOString(), temporaryDatabaseOnly: true, disposableChromeProfile: true, workspaceSha256, publicSha256, assets, exceptions: [], consoleErrors: [], failedRequests: [], responses: [], screenshots: []};
  const password = 'Disposable-Voice-QA-' + randomBytes(16).toString('hex'), fixture = await startFixture(password);
  try {
    await withBrowser(fixture, report, browser => verifyBrowser(fixture, browser, password, report));
    assert.deepEqual(report.exceptions, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.failedRequests, []); assert.deepEqual(fixture.errors, []);
    const failures = report.responses.filter(response => response.url.startsWith(fixture.origin + '/') && response.status >= 400);
    assert.deepEqual(failures, []);
    report.passed = true;
    console.log(JSON.stringify({passed: true, workspaceSha256, publicSha256, samples: assets.samples.length, realLocalSpeech: true, report: path.join(OUTPUT, 'report.json')}));
    return report;
  } catch (error) { report.passed = false; report.failure = error.stack || String(error); throw error; }
  finally { report.completedAt = new Date().toISOString(); report.serverErrors = fixture.errors; fs.writeFileSync(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2)); await fixture.close(); }
}
module.exports = {run, validateAssets, inspectWave};
if (require.main === module) {
  const flag = process.argv.indexOf('--expected-workspace-sha256');
  run({assetsOnly: process.argv.includes('--assets-only'), expectedWorkspaceSha256: flag < 0 ? null : process.argv[flag + 1]}).catch(error => { console.error(error); process.exitCode = 1; });
}
