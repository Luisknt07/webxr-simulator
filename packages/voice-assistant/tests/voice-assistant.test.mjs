import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceAssistant, resolveVoiceIntent} from '../VoiceAssistant.js';
import {createVoiceModule} from '../module.js';
import {createHost} from '../../core/index.js';

class Events {
  constructor() { this.events = new Map(); }
  addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(fn); }
  removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
  dispatch(name) { for (const fn of this.events.get(name) || []) fn(); }
  listenerCount() { return [...this.events.values()].reduce((sum, set) => sum + set.size, 0); }
}
class Utterance { constructor(text) { this.text = text; } }
class Synth extends Events {
  constructor() { super(); this.spoken = []; this.voices = [{voiceURI: 'es-default', name: 'Sabina', lang: 'es-MX', localService: true}]; this.cancelled = 0; }
  getVoices() { return this.voices; }
  speak(utterance) { this.spoken.push(utterance); }
  cancel() { this.cancelled++; }
  end() { this.spoken.at(-1)?.onend?.(); }
}
function setup(extra = {}) {
  const synth = new Synth();
  const doc = new Events(); doc.hidden = false;
  const win = new Events();
  const media = [];
  class Audio {
    constructor(src) { this.src = src; this.played = false; this.paused = false; media.push(this); }
    play() { this.played = true; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() { this.loaded = true; }
  }
  let snapshot = {roomId: 'room-a', projectId: 'project-a', sessionKey: 'a:0', guidance: {key: 'pickup', text: 'Alinea las horquillas con el palé.', sampleId: 'pickup'}, objective: 'Traslada dos palés.', controls: 'Usa W para avanzar.', content: 'Almacén de práctica.'};
  const timers = new Map(); let timerId = 0;
  const options = {window: win, document: doc, speechSynthesis: synth, SpeechSynthesisUtterance: Utterance, Audio, getSnapshot: () => snapshot,
    samples: [{id: 'welcome', label: 'Bienvenida', text: 'Bienvenido al laboratorio.', src: 'welcome.wav'}, {id: 'pickup', label: 'Recoger', text: 'Acércate al palé.', src: 'pickup.wav'}, {id: 'completed', label: 'Completado', text: 'Misión completada.', src: 'completed.wav'}],
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id), ...extra};
  const assistant = new VoiceAssistant(options);
  return {assistant, synth, doc, win, media, timers, options, get snapshot() { return snapshot; }, set snapshot(value) { snapshot = value; }};
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('preferences never authorize autoplay and disposed listeners release', () => {
  const saved = [];
  const localStorage = {getItem: () => JSON.stringify({enabled: true, automatic: true, volume: 0.4, rate: 1.2}), setItem: (_, value) => saved.push(JSON.parse(value))};
  const env = setup({localStorage}); const {assistant, synth, doc, win} = env;
  let calls = 0;
  const unsubscribe = assistant.subscribe(state => { calls++; state.voices.push({name: 'mutation'}); });
  assistant.step(1);
  assert.equal(synth.spoken.length, 0);
  assert.equal(assistant.state().enabled, false);
  assert.equal(assistant.state().volume, 0.4);
  assert.equal(assistant.state().rate, 1.2);
  assert.equal(assistant.state().voices.length, 1);
  assistant.setVolume(2); assistant.setRate(0.1);
  assert.equal(assistant.state().volume, 1); assert.equal(assistant.state().rate, 0.6);
  assert.equal(Object.hasOwn(saved.at(-1), 'enabled'), false);
  unsubscribe(); const before = calls; assistant.setAutomatic(false); assert.equal(calls, before);
  assert.ok(doc.listenerCount() && win.listenerCount() && synth.listenerCount());
  assistant.dispose(); assert.equal(doc.listenerCount() + win.listenerCount() + synth.listenerCount(), 0);
  assert.equal(env.timers.size, 0); assert.equal(assistant.state().disposed, true);
});

test('disabled idle service never reads simulation snapshots during frame ticks', () => {
  let reads = 0;
  const {assistant} = setup({getSnapshot: () => { reads++; return {sessionKey: 'live', guidance: {key: 'pickup', text: 'Alinea las horquillas.'}}; }});
  for (let tick = 0; tick < 100; tick++) assistant.step(1 / 60);
  assert.equal(reads, 0);
  assistant.enable(); assistant.step(1); assert.ok(reads > 0, 'enabling reads fresh authoritative context');
  assistant.disable(); const afterDisable = reads;
  for (let tick = 0; tick < 100; tick++) assistant.step(1 / 60);
  assert.equal(reads, afterDisable);
  assistant.dispose();
});

test('fixed Spanish intents read exact live context and never invent an answer', () => {
  const {assistant, synth} = setup();
  assert.equal(resolveVoiceIntent('¿Qué hago ahora?'), 'next');
  assert.equal(resolveVoiceIntent('Explícame esta sala'), 'content');
  for (const query of ['¿Dónde llevo este pallet?', 'destino', 'ubicación', 'cargar', 'descargar']) assert.equal(resolveVoiceIntent(query), 'objective');
  for (const query of ['Lee el cartel', 'lee este texto', 'contenido de la escena']) assert.equal(resolveVoiceIntent(query), 'content');
  const next = assistant.ask('¿Cuál es el siguiente paso?');
  assert.equal(next.text, 'Alinea las horquillas con el palé.');
  assert.equal(synth.spoken.at(-1).text, next.text);
  assistant.step(1); assert.equal(synth.spoken.length, 1, 'manual guidance is not immediately repeated by automatic narration');
  assistant.ask('objetivo'); assert.equal(synth.spoken.at(-1).text, 'Traslada dos palés.');
  assert.equal(synth.cancelled, 1, 'a new request replaces the single owned utterance');
  const unknown = assistant.ask('¿Cuánto costará la gasolina mañana?');
  assert.match(unknown.text, /siguiente paso, el objetivo, los controles/);
  assert.equal(unknown.intent, 'unknown'); assistant.dispose();
});

test('repeat refreshes next-step guidance after phase changes or checkpoint rewind with automatic narration off', () => {
  const env = setup(); const {assistant, synth} = env;
  assistant.setAutomatic(false); assistant.ask('next');
  env.snapshot.guidance = {key: 'withdraw', text: 'Retira ambas horquillas.'};
  const advanced = assistant.repeat();
  assert.equal(advanced.text, 'Retira ambas horquillas.'); assert.equal(synth.spoken.at(-1).text, advanced.text);
  env.snapshot.guidance = {key: 'pickup', text: 'Vuelve a alinear las horquillas.'};
  const rewound = assistant.repeat();
  assert.equal(rewound.text, 'Vuelve a alinear las horquillas.'); assert.equal(synth.spoken.at(-1).text, rewound.text);
  assert.equal(synth.spoken.length, 3); assert.equal(synth.cancelled, 2);
  assistant.ask('controls'); env.snapshot.controls = 'Nuevo texto de controles.';
  assert.equal(assistant.repeat().text, 'Usa W para avanzar.', 'other help can repeat its last displayed text');
  assistant.dispose();
});

test('voiceschanged selects Spanish voice without overwriting other listeners', () => {
  const {assistant, synth} = setup(); let other = 0;
  synth.addEventListener('voiceschanged', () => other++);
  const english = {voiceURI: 'en', name: 'English', lang: 'en-US'};
  const spanish = {voiceURI: 'es-local', name: 'Sabina', lang: 'es-MX', localService: true};
  synth.voices = [english, spanish]; synth.dispatch('voiceschanged');
  assert.equal(other, 1); assert.equal(assistant.state().voices[1].id, 'es-local');
  assistant.setRate(1.3); assistant.setVolume(0.5); assistant.ask('controls');
  assert.equal(synth.spoken.at(-1).voice, spanish); assert.equal(synth.spoken.at(-1).rate, 1.3); assert.equal(synth.spoken.at(-1).volume, 0.5);
  assistant.setVoice('en'); assistant.repeat(); assert.equal(synth.spoken.at(-1).voice, english);
  assistant.dispose(); assert.equal(synth.listenerCount(), 1);
});

test('automatic narration dedupes real phases, resets each run and requires verified completion', () => {
  const env = setup({guidanceInterval: 0.5}); const {assistant, synth} = env;
  assistant.enable(); assistant.step(1); assert.equal(synth.spoken.length, 1);
  synth.end(); env.snapshot.guidance.text = 'Texto cambiado por distancia, misma fase.';
  assistant.step(1); assert.equal(synth.spoken.length, 1);
  env.snapshot.guidance = {key: 'withdraw', text: 'Retira ambas horquillas.'}; assistant.step(1);
  assert.equal(synth.spoken.length, 2);
  env.snapshot.guidance = {key: 'complete', text: 'Misión completada.', completed: true, completionVerified: false};
  synth.end(); assistant.step(1); assert.equal(synth.spoken.length, 2, 'a deposit is not a completed mission');
  assert.match(assistant.ask('next').text, /todavía debe ser verificada/);
  synth.end(); env.snapshot.guidance.completionVerified = true; assistant.step(1);
  assert.equal(synth.spoken.at(-1).text, 'Misión completada.');
  synth.end(); const before = synth.spoken.length;
  env.snapshot.sessionKey = 'a:1'; assistant.step(1); assert.equal(synth.spoken.length, before + 1);
  env.snapshot.sessionKey = 'b:0'; env.snapshot.guidance = {key: 'pickup', text: 'Nueva sala, siguiente paso.'};
  assistant.repeat(); assert.equal(synth.spoken.at(-1).text, 'Nueva sala, siguiente paso.'); assistant.dispose();
});

test('unsupported TTS uses local recording, retains exact guidance text and cannot infer completion', () => {
  const env = setup({speechSynthesis: null, SpeechSynthesisUtterance: null, assetBaseURL: '/voice/assets'});
  const {assistant, media} = env;
  const answer = assistant.ask('next');
  assert.equal(answer.spoken, true); assert.equal(media.at(-1).src, '/voice/assets/pickup.wav');
  assert.equal(assistant.state().transcript, 'Alinea las horquillas con el palé.');
  env.snapshot.guidance = {key: 'drop', text: 'Misión completada.', sampleId: 'completed', completed: true, completionVerified: false};
  assistant.ask('next'); assert.equal(media.at(-1).src, '/voice/assets/welcome.wav');
  assert.match(assistant.state().transcript, /todavía debe ser verificada/);
  env.snapshot.guidance.completionVerified = true;
  assistant.ask('next'); assert.equal(media.at(-1).src, '/voice/assets/completed.wav');
  assistant.playSample('welcome'); assert.equal(assistant.state().lastIntent, 'sample');
  const old = media.at(-1); assistant.stop(); assert.equal(old.paused, true); assert.equal(old.src, '');
  assistant.dispose();
});

test('missing Spanish voices use recordings until voiceschanged publishes a Spanish voice', () => {
  const env = setup(); const {assistant, synth, media} = env;
  synth.voices = [{voiceURI: 'english', name: 'English', lang: 'en-US'}]; synth.dispatch('voiceschanged');
  assistant.ask('next'); assert.equal(synth.spoken.length, 0); assert.equal(media.at(-1).src, 'pickup.wav');
  synth.voices = []; synth.dispatch('voiceschanged');
  assistant.ask('objective'); assert.equal(synth.spoken.length, 0); assert.equal(media.at(-1).src, 'welcome.wav');
  synth.voices = [{voiceURI: 'spanish', name: 'Sabina', lang: 'es-MX', localService: true}]; synth.dispatch('voiceschanged');
  assistant.ask('controls'); assert.equal(synth.spoken.at(-1).lang, 'es-MX'); assert.equal(synth.spoken.at(-1).voice.voiceURI, 'spanish');
  assistant.dispose();
});

test('manual answers keep priority over ordinary automatic changes; urgent host guidance interrupts', () => {
  const env = setup(); const {assistant, synth} = env;
  assistant.ask('next'); assert.equal(synth.spoken.length, 1);
  env.snapshot.guidance = {key: 'route-1', text: 'Primera instrucción en ruta.'}; assistant.step(1);
  env.snapshot.guidance = {key: 'route-2', text: 'Última instrucción en ruta.'}; assistant.step(1);
  assert.equal(synth.spoken.length, 1); assert.equal(synth.cancelled, 0);
  synth.end(); assistant.step(1); assert.equal(synth.spoken.at(-1).text, 'Última instrucción en ruta.');
  assert.equal(synth.spoken.some(utterance => utterance.text === 'Primera instrucción en ruta.'), false);
  env.snapshot.guidance = {key: 'emergency', text: 'Detén el vehículo.', sampleId: 'safety', critical: true}; assistant.step(1);
  assert.equal(synth.cancelled, 1); assert.equal(synth.spoken.at(-1).text, 'Detén el vehículo.');
  assistant.step(1); assert.equal(synth.cancelled, 1, 'same urgent phase is announced only once');
  assistant.dispose();
});

test('automatic guidance cancels obsolete speech, debounces transient changes and speaks only the current short instruction', () => {
  const env = setup({guidanceInterval: 0.5}); const {assistant, synth} = env;
  env.snapshot.guidance.spokenText = 'Alinea las dos entradas.';
  assistant.enable(); assistant.step(.2); assistant.step(.2); assert.equal(synth.spoken.length, 0);
  assistant.step(.2); assert.equal(synth.spoken.at(-1).text, 'Alinea las dos entradas.');
  env.snapshot.guidance = {key: 'align-left', text: 'Información lateral larga.', spokenText: 'Gira un poco a la izquierda.'}; assistant.step(.2);
  assert.equal(synth.cancelled, 1, 'obsolete automatic speech is canceled at the phase boundary');
  env.snapshot.guidance = {key: 'align-right', text: 'Información derecha.', spokenText: 'Gira a la derecha.'}; assistant.step(.2);
  env.snapshot.guidance = {key: 'pickup-ready', text: 'Detalle de carga, ruta, objetivo y puntuación.', spokenText: 'Detén el vehículo y pulsa G para tomar la carga.'}; assistant.step(.2); assistant.step(.2); assistant.step(.2);
  assert.equal(synth.spoken.length, 2); assert.equal(synth.spoken.at(-1).text, 'Detén el vehículo y pulsa G para tomar la carga.');
  assert(!synth.spoken.some(row => /Gira/.test(row.text)), 'transient intermediate steps never form a narration queue');
  synth.end(); for (let i = 0; i < 100; i++) assistant.step(.2); assert.equal(synth.spoken.length, 2, 'being stuck on one step does not repeat it');
  assistant.dispose();
});

test('automatic voice prefers natural Spanish voices while preserving explicit device selection', () => {
  const {assistant, synth} = setup();
  const basic = {voiceURI: 'basic', name: 'Microsoft Sabina', lang: 'es-MX', localService: true};
  const natural = {voiceURI: 'natural', name: 'Microsoft Dalia Online Natural', lang: 'es-MX', localService: false};
  synth.voices = [basic, {voiceURI: 'english-natural', name: 'Natural English', lang: 'en-US'}, natural]; synth.dispatch('voiceschanged');
  assistant.ask('next'); assert.equal(synth.spoken.at(-1).voice, natural);
  assistant.setVoice('basic'); assistant.ask('next'); assert.equal(synth.spoken.at(-1).voice, basic); assistant.dispose();
});

test('AI questions receive read-only live context and late answers cannot cross a mission stage or session', async () => {
  let reply, request;
  const env = setup({remoteState: () => ({answer: true}), answerQuestion: options => { request = options; return new Promise(resolve => { reply = resolve; }); }});
  const {assistant, synth} = env;
  const answer = assistant.ask('¿Por qué no puedo tomar este pallet?'); assert.equal(assistant.state().thinking, true); assert.equal(request.snapshot, env.snapshot);
  env.snapshot.guidance = {key: 'next-stage', text: 'Nueva etapa.'}; assistant.step(.2); assert.equal(request.signal.aborted, true);
  reply({text: 'Respuesta anterior que no se debe leer.', source: 'ai'}); assert.equal(await answer, false); assert.equal(synth.spoken.length, 0);
  const current = assistant.ask('¿Qué significa esta estantería?'); reply({text: 'Es la ubicación de almacenamiento asignada en esta misión.', source: 'ai'});
  const result = await current; assert.equal(result.source, 'ai'); assert.equal(synth.spoken.at(-1).text, result.text); assert.equal(assistant.state().thinking, false);
  const pending = assistant.ask('¿Qué producto es este?'); env.snapshot.sessionKey = 'other-account'; assistant.step(.2); assert.equal(request.signal.aborted, true);
  reply({text: 'No se debe leer.', source: 'ai'}); assert.equal(await pending, false); assistant.dispose();
});

test('an unavailable AI falls back to honest bounded local help, never inventing success', async () => {
  const {assistant, synth} = setup({remoteState: () => ({answer: true}), answerQuestion: async () => { throw Error('offline'); }});
  const result = await assistant.ask('¿Qué me recomiendas para mejorar?');
  assert.equal(result.source, 'local'); assert.match(result.text, /Avanza despacio/); assert.match(assistant.state().status, /Ayuda del simulador/);
  assert.equal(synth.spoken.at(-1).text, result.text); assistant.dispose();
});

test('cloud speech uses the shared context, aborts stale synthesis and falls back to device voice when unavailable', async () => {
  let resolveAudio, request, sources = 0, stopped = 0;
  const context = {state: 'running', destination: {}, async decodeAudioData(bytes) { assert(bytes instanceof ArrayBuffer); return {}; }, createGain() { return {gain: {}, connect() {}, disconnect() {}}; }, createBufferSource() { sources++; return {playbackRate: {}, connect() {}, disconnect() {}, start() {}, stop() { stopped++; }}; }};
  const {assistant, synth} = setup({remoteState: () => ({speech: true}), getAudioContext: () => context, synthesize: options => { request = options; return new Promise(resolve => { resolveAudio = resolve; }); }});
  assistant.ask('next'); assert.equal(assistant.state().synthesizing, true); assistant.stop(); assert.equal(request.signal.aborted, true);
  resolveAudio({audio: new ArrayBuffer(20), contentType: 'audio/mpeg'}); await turn(); assert.equal(sources, 0, 'late audio cannot allocate a shared source');
  assistant.ask('controls'); resolveAudio({audio: new ArrayBuffer(20), contentType: 'audio/mpeg'}); await turn(); assert.equal(sources, 1); assert.equal(assistant.state().synthesizing, false); assert.equal(synth.spoken.length, 0);
  assistant.stop(); assert.equal(stopped, 1); assistant.options.synthesize = async () => { throw Error('offline'); }; assistant.ask('next'); await turn(); assert.equal(synth.spoken.length, 1, 'same exact text falls back to the device voice'); assistant.dispose();
});

test('an explicit device voice bypasses configured cloud synthesis', () => {
  let remoteCalls = 0;
  const {assistant, synth} = setup({remoteState: () => ({speech: true}), synthesize: async () => { remoteCalls++; return {audio: new ArrayBuffer(4)}; }});
  assistant.setVoice('es-default'); assistant.ask('next'); assert.equal(remoteCalls, 0); assert.equal(synth.spoken.at(-1).voice.voiceURI, 'es-default'); assistant.dispose();
});

test('blocked shared audio resume has a bounded device fallback and a late resume cannot play duplicate cloud audio', async () => {
  let resume, decoded = 0, sources = 0;
  const pendingResume = new Promise(resolve => { resume = resolve; });
  const context = {state: 'suspended', resume: () => pendingResume, async decodeAudioData() { decoded++; return {}; }, createBufferSource() { sources++; return {}; }};
  const {assistant, synth, timers} = setup({remoteState: () => ({speech: true}), getAudioContext: () => context, synthesize: async () => ({audio: new ArrayBuffer(20), contentType: 'audio/mpeg'})});
  assistant.ask('next'); await turn(); assert.equal(assistant.state().synthesizing, true); assert.equal(timers.size, 1);
  const timeout = [...timers.values()][0]; timeout(); assert.equal(assistant.state().synthesizing, false); assert.equal(synth.spoken.length, 1); assert.equal(sources, 0);
  resume(); await turn(); assert.equal(decoded, 0, 'late resume cannot even begin decoding after fallback'); assert.equal(sources, 0); assert.equal(synth.spoken.length, 1); assistant.dispose();
});

test('slow shared audio decoding has a bounded device fallback and late decode cannot allocate a source', async () => {
  let decode, sources = 0;
  const context = {state: 'running', decodeAudioData: () => new Promise(resolve => { decode = resolve; }), createBufferSource() { sources++; return {}; }};
  const {assistant, synth, timers} = setup({remoteState: () => ({speech: true}), getAudioContext: () => context, synthesize: async () => ({audio: new ArrayBuffer(20), contentType: 'audio/mpeg'})});
  assistant.ask('next'); await turn(); assert.equal(typeof decode, 'function'); [...timers.values()][0](); assert.equal(synth.spoken.length, 1); assert.equal(assistant.state().synthesizing, false);
  decode({}); await turn(); assert.equal(sources, 0); assert.equal(synth.spoken.length, 1); assistant.dispose();
});

test('recorded microphone questions are explicit, bounded, submitted on toggle and release every media track', async () => {
  let stopped = 0, opened = 0, recording, transcription;
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; recording = this; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({data: new Blob(['consulta'], {type: this.mimeType})}); this.onstop?.(); }
  }
  const env = setup({remoteState: () => ({transcription: true}), MediaRecorder: Recorder, getUserMedia: async options => { assert.equal(options.video, false); opened++; return {getTracks: () => [{stop() { stopped++; }}]}; }, transcribe: async options => { transcription = options; return {text: '¿Cuál es el objetivo?'}; }});
  const {assistant, synth} = env; assistant.enable(); assistant.step(1); assert.equal(opened, 0);
  assistant.listen(); await turn(); assert.equal(opened, 1); assert.equal(recording.state, 'recording'); assert.equal(assistant.state().listening, true);
  assistant.listen(); await turn(); assert.equal(stopped, 1); assert.equal(assistant.state().listening, false); assert(transcription.audio instanceof Blob); assert.equal(transcription.mimeType, 'audio/webm;codecs=opus'); assert.equal(synth.spoken.at(-1).text, 'Traslada dos palés.');
  assistant.listen(); await turn(); assistant.stop(); assert.equal(stopped, 2); assert.equal(recording.ondataavailable, null); assistant.dispose();
});

test('microphone permission resolving after disposal stops the late stream without starting recording', async () => {
  let resolvePermission, stopped = 0, recorders = 0;
  class Recorder { constructor() { recorders++; } }
  const {assistant} = setup({remoteState: () => ({transcription: true}), MediaRecorder: Recorder, getUserMedia: () => new Promise(resolve => { resolvePermission = resolve; }), transcribe: async () => ({text: ''})});
  assistant.listen(); assistant.dispose(); resolvePermission({getTracks: () => [{stop() { stopped++; }}]}); await turn(); assert.equal(stopped, 1); assert.equal(recorders, 0);
});

test('a shared microphone analyser sends after spoken phrase and silence, without a second loop or closing the host context', async () => {
  let level = 0, submitted = 0, stopped = 0, sourceDisconnected = 0, analyserDisconnected = 0, closed = 0;
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({data: new Blob(['audio'], {type: 'audio/webm'})}); this.onstop?.(); }
  }
  const context = {state: 'running', close() { closed++; }, createMediaStreamSource() { return {connect() {}, disconnect() { sourceDisconnected++; }}; }, createAnalyser() { return {getFloatTimeDomainData(samples) { samples.fill(level); }, disconnect() { analyserDisconnected++; }}; }};
  const {assistant} = setup({remoteState: () => ({transcription: true}), MediaRecorder: Recorder, getAudioContext: () => context, getUserMedia: async () => ({getTracks: () => [{stop() { stopped++; }}]}), transcribe: async () => { submitted++; return {text: 'objetivo'}; }});
  assistant.listen(); await turn(); assert(assistant.microphoneMeter); for (let i = 0; i < 10; i++) assistant.step(.2); assert.equal(submitted, 0, 'silence without a spoken phrase never submits automatically');
  level = .08; assistant.step(.2); level = .001; for (let i = 0; i < 4; i++) assistant.step(.2); assert.equal(submitted, 0); assistant.step(.2); await turn();
  assert.equal(submitted, 1); assert.equal(stopped, 1); assert.equal(sourceDisconnected, 1); assert.equal(analyserDisconnected, 1); assert.equal(assistant.microphoneMeter, null); assert.equal(closed, 0); assistant.dispose(); assert.equal(closed, 0);
});

test('pause, hidden document, stop and disposal cancel own audio without stale callbacks', () => {
  const ducks = []; const env = setup({onDuck: active => ducks.push(active)}); const {assistant, synth, doc} = env;
  assistant.ask('next'); const lateEnd = synth.spoken.at(-1).onend;
  env.snapshot.paused = true; assistant.step(1); assert.equal(assistant.state().speaking, false); assert.equal(synth.cancelled, 1);
  env.snapshot.paused = false; assistant.ask('controls'); lateEnd(); assert.equal(assistant.state().speaking, true);
  doc.hidden = true; doc.dispatch('visibilitychange'); assert.equal(assistant.state().speaking, false);
  assert.equal(assistant.ask('next').spoken, false); assert.match(assistant.state().status, /pausada/);
  doc.hidden = false; assistant.ask('objective'); assistant.dispose();
  assert.equal(ducks.at(-1), false); assert.equal(env.timers.size, 0); assert.equal(assistant.ask('next'), false);
});

test('active visible immersive session can keep speaking with hidden companion document; hidden sessions always stop', () => {
  const env = setup(); const {assistant, synth, doc} = env;
  env.snapshot.immersiveActive = true;
  assistant.ask('next'); doc.hidden = true; doc.dispatch('visibilitychange'); assistant.step(1);
  assert.equal(assistant.state().speaking, true); assert.equal(synth.cancelled, 0);
  assert.equal(assistant.ask('controls').spoken, true, 'visible immersive help works while companion document is hidden');
  env.snapshot.hidden = true; doc.dispatch('visibilitychange');
  assert.equal(assistant.state().speaking, false); assert.equal(synth.cancelled, 2);
  assert.equal(assistant.ask('next').spoken, false, 'explicit hidden session overrides immersiveActive');
  env.snapshot.hidden = false; env.snapshot.immersiveActive = false;
  assert.equal(assistant.ask('next').spoken, false, 'a hidden document without a visible immersive session stays paused');
  doc.hidden = false; assistant.ask('next'); assert.equal(assistant.state().speaking, true);
  doc.hidden = true; doc.dispatch('visibilitychange'); assert.equal(assistant.state().speaking, false);
  assistant.dispose();
});

test('late native play rejection cannot cancel a newer request', async () => {
  let reject;
  class Audio {
    play() { return new Promise((_, no) => { reject = no; }); }
    pause() {} removeAttribute() {} load() {}
  }
  const {assistant} = setup({Audio});
  assistant.playSample('welcome'); const oldReject = reject;
  assistant.ask('controls'); oldReject(new Error('late rejection')); await turn();
  assert.equal(assistant.state().speaking, true); assert.equal(assistant.state().error, ''); assistant.dispose();
});

test('shared audio late decode cannot create sources after disposal or close the host context', async () => {
  let decoded, sources = 0, closed = 0, aborted = false;
  const context = {state: 'running', createBufferSource() { sources++; return {}; }, decodeAudioData: () => new Promise(resolve => { decoded = resolve; }), close() { closed++; }};
  const fetch = async (_, options) => { options.signal.addEventListener('abort', () => { aborted = true; }); return {ok: true, arrayBuffer: async () => new ArrayBuffer(12)}; };
  const {assistant} = setup({getAudioContext: () => context, fetch});
  assistant.playSample('welcome'); await turn(); assert.equal(typeof decoded, 'function');
  assistant.dispose(); decoded({}); await turn();
  assert.equal(aborted, true); assert.equal(sources, 0); assert.equal(closed, 0);
});

test('microphone is explicit, single-query and canceled on teardown', () => {
  const recognitions = [];
  class Recognition {
    constructor() { recognitions.push(this); }
    start() { this.started = true; }
    abort() { this.aborted = true; }
  }
  const {assistant, synth} = setup({SpeechRecognition: Recognition});
  assistant.enable(); assistant.step(1); assert.equal(recognitions.length, 0);
  assistant.listen(); const recognition = recognitions.at(-1);
  assert.equal(recognition.continuous, false); assert.equal(recognition.lang, 'es-MX');
  recognition.onresult({resultIndex: 0, results: [[{transcript: '¿Cuál es el objetivo?'}]]});
  assert.equal(recognition.aborted, true); assert.equal(assistant.state().listening, false);
  assert.equal(synth.spoken.at(-1).text, 'Traslada dos palés.');
  assistant.listen(); const pending = recognitions.at(-1); assistant.dispose(); assert.equal(pending.aborted, true); assert.equal(pending.onresult, null);
});

test('portable module requires its capability and releases service plus UI through host lifecycle', async () => {
  const denied = createHost({catalog: [createVoiceModule()]});
  await assert.rejects(denied.activate('shared.assistance'), {code: 'capability_denied'}); await denied.dispose();
  const env = setup(); env.assistant.dispose(); let service, uiDisposed = 0;
  const host = createHost({catalog: [createVoiceModule({rate: 1})], grants: ['platform.voice'], ports: {'platform.voice': {...env.options, createUI: assistant => { service = assistant; return {dispose() { uiDisposed++; }}; }}}});
  await host.activate('shared.assistance');
  assert.equal(host.status().services[0].id, 'world.voice');
  assert.equal(host.registry('systems')[0].key, 'assistant.voice:guidance');
  service.ask('next'); await host.pause('shared.assistance'); assert.equal(service.state().speaking, false);
  await host.remove('shared.assistance'); assert.equal(service.state().disposed, true); assert.equal(uiDisposed, 1);
  assert.equal(host.status().services.length, 0); await host.dispose();
});
