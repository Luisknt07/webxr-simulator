const SETTINGS_KEY = 'smarttwin.voice-assistant.v1';
const MAX_TEXT = 1200;
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '';
const normalize = value => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿?¡!.,;:]/g, '');
const object = value => value && typeof value === 'object' ? value : {};
const safeCall = (callback, ...args) => { try { return typeof callback === 'function' ? callback(...args) : undefined; } catch (_) { return undefined; } };
const short = (value, limit = 260) => { const line = clean(value); if (line.length <= limit) return line; const cut = line.slice(0, limit + 1), boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; ')); return (boundary > limit * 0.45 ? cut.slice(0, boundary + 1) : cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '') + '.'); };

/** Bounded, deterministic Spanish help. This service has no model, account or API key. */
export function resolveVoiceIntent(query) {
  const text = normalize(query);
  if (['next', 'objective', 'controls', 'content', 'repeat', 'stop', 'recommendation', 'location', 'safety', 'status'].includes(text)) return text;
  if (/\b(repite|repetir|otra vez)\b/.test(text)) return 'repeat';
  if (/\b(silencio|calla|detente|deja de hablar|para la voz)\b/.test(text)) return 'stop';
  if (/\b(perdido|perdida|donde estoy|por donde|como llego|ruta|camino)\b/.test(text)) return 'location';
  if (/\b(recomienda|recomendacion|consejo|consejos|sugiere|mejorar)\b/.test(text)) return 'recommendation';
  if (/\b(no puedo|no me deja|atascado|atascada|atorado|atorada|trabado|trabada|no funciona|por que no)\b/.test(text)) return 'recommendation';
  if (/\b(seguridad|peligro|riesgo|precaucion|emergencia)\b/.test(text)) return 'safety';
  if (/\b(puntuacion|puntos|progreso|estado|cuanto llevo)\b/.test(text)) return 'status';
  if (/\b(objetivo|mision|meta|tarea|destino|ubicacion|cargar|descargar)\b/.test(text) || /\b(?:donde|adonde)\b.*\b(?:llevo|llevar|dejo|dejar|pallet|palet|pale)\b/.test(text)) return 'objective';
  if (/\b(controles|control|teclas|botones|manejar|conducir)\b/.test(text)) return 'controls';
  if (/\b(contenido|escena|sala|explica|explicar|equipos|cartel|texto)\b/.test(text)) return 'content';
  if (/\b(siguiente|continuar|ahora|hacer|paso|ayuda|guiame|instruccion)\b/.test(text)) return 'next';
  return 'unknown';
}

export class VoiceAssistant {
  constructor(options = {}) {
    this.options = options;
    this.window = options.window || (typeof window !== 'undefined' ? window : undefined);
    this.document = options.document || (this.window && this.window.document);
    this.storage = options.localStorage;
    if (!this.storage) { try { this.storage = this.window && this.window.localStorage; } catch (_) { /* Storage may be unavailable. */ } }
    this.synthesis = options.speechSynthesis || (this.window && this.window.speechSynthesis);
    this.Utterance = options.SpeechSynthesisUtterance || (this.window && this.window.SpeechSynthesisUtterance);
    this.Recognition = options.SpeechRecognition || (this.window && (this.window.SpeechRecognition || this.window.webkitSpeechRecognition));
    this.Audio = options.Audio || (this.window && this.window.Audio);
    this.listeners = new Set();
    this.removers = [];
    this.voiceObjects = new Map();
    this.generation = 0;
    this.session = null;
    this.narrated = new Set();
    this.lastResponse = null;
    this.elapsed = 0;
    this.clock = 0;
    this.lastAutomaticAt = -Infinity;
    this.pendingGuidance = null;
    this.playedAutomaticSamples = new Set();
    this.disposed = false;
    this.samples = (Array.isArray(options.samples) ? options.samples : []).slice(0, 32).filter(sample => sample && sample.id && (sample.src || sample.file)).map(sample => Object.freeze({
      id: String(sample.id), label: clean(sample.label || sample.title || sample.id), text: clean(sample.text), src: String(sample.src || sample.file)
    }));
    let settings = {};
    try { settings = object(JSON.parse(this.storage && this.storage.getItem(options.storageKey || SETTINGS_KEY) || '{}')); } catch (_) { /* Invalid settings do not block help. */ }
    this.value = {
      enabled: false, automatic: settings.automatic === undefined ? options.automatic !== false : settings.automatic !== false, speaking: false, listening: false,
      volume: clamp(settings.volume === undefined ? options.volume : settings.volume, 0, 1, 0.8), rate: clamp(settings.rate === undefined ? options.rate : settings.rate, 0.6, 1.5, 1),
      voiceId: typeof settings.voiceId === 'string' ? settings.voiceId : typeof options.voiceId === 'string' ? options.voiceId : 'auto', voices: [],
      speechSupported: !!(this.synthesis && this.Utterance), recognitionSupported: !!this.Recognition,
      capabilities: {speech: !!(this.synthesis && this.Utterance), recognition: !!this.Recognition, audio: !!(this.Audio || options.getAudioContext)},
      status: 'Voz desactivada. Actívala para escuchar la ayuda.', error: '', transcript: '', lastIntent: '', source: 'local', thinking: false, synthesizing: false, disposed: false
    };
    this.onVoicesChanged = () => this.refreshVoices();
    this.listenTo(this.synthesis, 'voiceschanged', this.onVoicesChanged);
    this.listenTo(this.document, 'visibilitychange', () => { if (this.isPaused(this.snapshot())) this.stop(); });
    this.listenTo(this.window, 'pagehide', () => this.stop());
    this.refreshVoices();
  }

  listenTo(target, event, callback) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(event, callback);
    this.removers.push(() => target.removeEventListener(event, callback));
  }

  state() {
    const remote = object(safeCall(this.options.remoteState));
    const capture = !!(this.options.getUserMedia || this.window && this.window.navigator && this.window.navigator.mediaDevices && this.window.navigator.mediaDevices.getUserMedia) && !!(this.options.MediaRecorder || this.window && this.window.MediaRecorder);
    this.value.capabilities.remoteAnswer = remote.answer === true && typeof this.options.answerQuestion === 'function';
    this.value.capabilities.remoteSpeech = remote.speech === true && typeof this.options.synthesize === 'function';
    this.value.capabilities.remoteTranscription = remote.transcription === true && typeof this.options.transcribe === 'function' && capture;
    this.value.recognitionSupported = !!this.Recognition || this.value.capabilities.remoteTranscription;
    this.value.capabilities.recognition = this.value.recognitionSupported;
    return {...this.value, remote:{configured:remote.configured===true,authenticated:remote.authenticated===true,reason:clean(remote.reason)}, voices: this.value.voices.map(voice => ({...voice})), samples: this.samples.slice(), capabilities: {...this.value.capabilities}};
  }

  subscribe(callback) {
    if (typeof callback !== 'function' || this.disposed) return () => {};
    this.listeners.add(callback);
    safeCall(callback, this.state());
    return () => this.listeners.delete(callback);
  }

  emit() {
    if (this.disposed) return;
    const state = this.state();
    for (const listener of this.listeners) safeCall(listener, state);
  }

  save() {
    const {automatic, volume, rate, voiceId} = this.value;
    try { if (this.storage) this.storage.setItem(this.options.storageKey || SETTINGS_KEY, JSON.stringify({automatic, volume, rate, voiceId})); } catch (_) { /* Help also works without persistence. */ }
  }

  refreshVoices() {
    if (this.disposed) return;
    const voices = safeCall(this.synthesis && this.synthesis.getVoices && this.synthesis.getVoices.bind(this.synthesis)) || [];
    this.voiceObjects.clear();
    this.value.voices = Array.from(voices).slice(0, 128).map((voice, index) => {
      const id = String(voice.voiceURI || `${voice.lang}:${voice.name}:${index}`);
      this.voiceObjects.set(id, voice);
      return {id, name: String(voice.name || voice.lang || 'Voz del sistema'), lang: String(voice.lang || ''), localService: voice.localService === true, default: voice.default === true, natural: /natural|neural|online|premium|google/i.test(String(voice.name || ''))};
    });
    this.emit();
  }

  setEnabled(enabled) {
    if (this.disposed) return false;
    this.value.enabled = !!enabled;
    if (!enabled) this.stop();
    if (enabled) {
      const context = safeCall(this.options.getAudioContext);
      if (context && context.state === 'suspended' && typeof context.resume === 'function') {
        // Invoke resume in the enabling gesture; delayed automatic help can then reuse this context.
        const resumed = safeCall(context.resume.bind(context));
        if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
      }
    }
    this.value.status = enabled ? 'Voz activada. Puedes pedir ayuda o reproducir una muestra.' : 'Voz desactivada. Actívala para escuchar la ayuda.';
    this.value.error = '';
    this.emit();
    return this.value.enabled;
  }
  enable() { return this.setEnabled(true); }
  disable() { return this.setEnabled(false); }
  setAutomatic(value) { if (this.disposed) return; this.value.automatic = !!value; if (!value) { this.pendingGuidance = null; if (this.activeAutomaticKey) this.stop(false); } this.save(); this.emit(); }
  setVoice(id) { if (this.disposed) return; this.value.voiceId = typeof id === 'string' ? id : 'auto'; this.save(); this.emit(); }
  setVolume(value) { if (this.disposed) return; this.value.volume = clamp(value, 0, 1, this.value.volume); if (this.audio) this.audio.volume = this.value.volume; if (this.gain) this.gain.gain.value = this.value.volume; this.save(); this.emit(); }
  setRate(value) { if (this.disposed) return; this.value.rate = clamp(value, 0.6, 1.5, this.value.rate); if (this.audio) this.audio.playbackRate = this.value.rate; this.save(); this.emit(); }

  snapshot() { return object(safeCall(this.options.getSnapshot)); }
  isPaused(snapshot) { return snapshot.paused === true || snapshot.hidden === true || snapshot.immersiveActive !== true && !!(this.document && this.document.hidden); }
  adoptSnapshot(snapshot) {
    const session = String(snapshot.sessionKey || `${snapshot.roomId || ''}:${snapshot.projectId || ''}:${snapshot.restartKey || ''}`);
    if (session !== this.session) { this.stop(false); this.session = session; this.narrated.clear(); this.playedAutomaticSamples.clear(); this.pendingGuidance = null; this.lastAutomaticAt = -Infinity; this.lastResponse = null; }
  }
  guidance(snapshot) {
    const raw = typeof snapshot.guidance === 'string' ? {text: snapshot.guidance} : object(snapshot.guidance || snapshot.currentGuidance);
    const completed = raw.completed === true;
    // Completion is a verified runtime fact, never a prediction based on proximity or a drop action.
    if (completed && raw.completionVerified !== true) return {text: 'La finalización todavía debe ser verificada por el simulador.', key: '', completed: false};
    return {text: clean(raw.text || snapshot.nextStep), spokenText: short(raw.spokenText || raw.brief || raw.text || snapshot.nextStep), key: String(raw.key || snapshot.phaseKey || raw.text || snapshot.nextStep || ''), sampleId: raw.sampleId, completed, critical: raw.critical === true};
  }

  localAnswer(intent, snapshot, guidance = this.guidance(snapshot)) {
    if (intent === 'next') return guidance.spokenText || guidance.text || 'No hay un siguiente paso disponible en esta escena.';
    if (intent === 'objective') return clean(snapshot.objective) || 'Esta escena no ha publicado un objetivo.';
    if (intent === 'controls') return clean(snapshot.controls) || 'Consulta la guía de controles de la escena.';
    if (intent === 'content') return clean(snapshot.content) || 'Esta escena todavía no ha publicado una descripción.';
    if (intent === 'location') return short([snapshot.route && snapshot.route.instruction, snapshot.objective, guidance.spokenText || guidance.text].filter(Boolean).join(' '), 450);
    if (intent === 'recommendation') return short([snapshot.recommendation || 'Avanza despacio y comprueba que el pasillo esté libre.', guidance.spokenText || guidance.text].filter(Boolean).join(' '), 450);
    if (intent === 'safety') return short(snapshot.safety || 'Comprueba el pasillo, mantén la carga baja durante el traslado y detén el vehículo antes de recoger o depositar un pallet.', 450);
    if (intent === 'status') return short(snapshot.progress || snapshot.objective || guidance.spokenText || guidance.text, 450);
    return 'Puedo indicar el siguiente paso, el objetivo, los controles, el contenido de esta escena y recomendaciones. Prueba: ¿qué hago ahora?';
  }

  contextKey(snapshot) { return String(snapshot.sessionKey || `${snapshot.roomId || ''}:${snapshot.projectId || ''}:${snapshot.restartKey || ''}`) + '|' + this.guidance(snapshot).key; }
  controller() { const Controller = this.options.AbortController || this.window && this.window.AbortController || (typeof AbortController !== 'undefined' ? AbortController : null); return Controller ? new Controller() : null; }
  remember(key) { if (!key) return; this.narrated.add(key); if (this.narrated.size > 128) this.narrated.delete(this.narrated.values().next().value); }

  ask(query = 'next') {
    if (this.disposed) return false;
    const intent = resolveVoiceIntent(query);
    if (intent === 'stop') { this.stop(); return {intent, text: 'Voz detenida.', spoken: false}; }
    if (intent === 'repeat') return this.repeat();
    const snapshot = this.snapshot();
    this.adoptSnapshot(snapshot);
    const guidance = this.guidance(snapshot);
    const remote = this.state().capabilities.remoteAnswer;
    if (remote && !['next', 'objective', 'controls', 'content'].includes(normalize(query)) && ['unknown', 'recommendation', 'location', 'safety', 'status', 'content'].includes(intent)) return this.askRemote(query, intent, snapshot);
    const text = this.localAnswer(intent, snapshot, guidance);
    this.setEnabled(true);
    this.lastResponse = {intent, text, sampleId: intent === 'next' ? guidance.sampleId : undefined};
    this.value.lastIntent = intent;
    this.value.source = 'local';
    this.value.transcript = text;
    const spoken = !this.isPaused(snapshot) && this.speak(text, this.lastResponse.sampleId);
    if (intent === 'next' && guidance.key) this.remember(guidance.key);
    if (this.isPaused(snapshot)) { this.value.status = 'Ayuda en texto. La voz está pausada con la escena.'; this.emit(); }
    return {intent, text, spoken};
  }

  async askRemote(query, intent, snapshot) {
    this.setEnabled(true); this.stop(false);
    const generation = this.generation, context = this.contextKey(snapshot), controller = this.controller();
    this.answerAbort = controller; this.answerContext = context; this.value.thinking = true; this.value.status = 'Consultando tu situación actual…'; this.value.error = ''; this.value.lastIntent = intent; this.emit();
    let answer, source = 'ai', fallback = false;
    try {
      const result = await this.options.answerQuestion({query: clean(query).slice(0, 1024), snapshot, signal: controller && controller.signal});
      answer = clean(result && result.text).slice(0, 700); source = result && result.source === 'local' ? 'local' : 'ai';
      if (!answer) throw Error('empty_answer');
    } catch (_) {
      if (this.disposed || generation !== this.generation || controller && controller.signal.aborted) return false;
      answer = this.localAnswer(intent, snapshot); source = 'local'; fallback = true;
    }
    if (this.disposed || generation !== this.generation || context !== this.contextKey(this.snapshot()) || this.isPaused(this.snapshot())) {
      if (!this.disposed && generation === this.generation) this.stop(false);
      return false;
    }
    this.answerAbort = null; this.answerContext = null; this.value.thinking = false; this.value.source = source; this.value.transcript = answer;
    this.lastResponse = {intent: 'answer', text: answer};
    const spoken = this.speak(answer);
    if (fallback) this.value.status = 'Ayuda del simulador. La consulta de IA no está disponible en este momento.';
    this.emit(); return {intent, text: answer, source, spoken};
  }

  repeat() {
    if (this.disposed) return false;
    this.adoptSnapshot(this.snapshot());
    if (!this.lastResponse || this.lastResponse.intent === 'next') return this.ask('next');
    const {intent, text, sampleId} = this.lastResponse;
    this.setEnabled(true);
    this.value.transcript = text;
    this.value.lastIntent = intent;
    return {intent, text, spoken: !this.isPaused(this.snapshot()) && this.speak(text, sampleId)};
  }

  chosenVoice() {
    if (this.voiceObjects.has(this.value.voiceId)) return this.voiceObjects.get(this.value.voiceId);
    const voices = Array.from(this.voiceObjects.values());
    const spanish = voices.filter(voice => /^es(?:-|_|$)/i.test(voice.lang));
    const score = voice => (/natural|neural|online|premium/i.test(String(voice.name || '')) ? 100 : /google/i.test(String(voice.name || '')) ? 80 : 0) + (/^es(?:-|_)(MX|US|EC|CO|AR|PE|CL)$/i.test(voice.lang) ? 12 : 0) + (voice.default ? 4 : 0) + (voice.localService ? 1 : 0);
    return spanish.sort((left, right) => score(right) - score(left))[0] || null;
  }

  setDucked(active) {
    if (this.ducked === active) return;
    this.ducked = active;
    safeCall(this.options.onDuck, active);
  }

  timer(callback, milliseconds) {
    const schedule = this.options.setTimeout || (this.window && this.window.setTimeout && this.window.setTimeout.bind(this.window)) || setTimeout;
    this.watchdog = schedule(callback, milliseconds);
    if (this.watchdog && typeof this.watchdog.unref === 'function') this.watchdog.unref();
  }

  clearTimer() {
    if (this.watchdog === undefined) return;
    const cancel = this.options.clearTimeout || (this.window && this.window.clearTimeout && this.window.clearTimeout.bind(this.window)) || clearTimeout;
    cancel(this.watchdog); this.watchdog = undefined;
  }

  finish(generation, error = '') {
    if (this.disposed || generation !== this.generation) return;
    this.clearTimer();
    this.utterance = null;
    this.releaseAudio();
    this.value.speaking = false;
    this.value.synthesizing = false;
    this.activeAutomaticKey = null;
    this.value.error = error;
    this.value.status = error || 'Listo para ayudarte.';
    this.setDucked(false);
    this.emit();
  }

  speak(text, sampleId, automaticKey = null) {
    if (this.disposed || !this.value.enabled || this.isPaused(this.snapshot()) || !clean(text)) return false;
    this.stop(false);
    const generation = this.generation;
    this.value.transcript = clean(text);
    this.value.error = '';
    this.activeAutomaticKey = automaticKey;
    if (this.value.voiceId === 'auto' && this.state().capabilities.remoteSpeech) {
      this.value.speaking = true; this.value.synthesizing = true; this.value.status = 'Preparando voz natural…'; this.setDucked(true); this.emit();
      this.startRemoteSpeech(this.value.transcript, sampleId, generation);
      return true;
    }
    return this.speakDevice(text, sampleId, generation);
  }

  speakDevice(text, sampleId, generation) {
    if (this.disposed || generation !== this.generation) return false;
    this.value.synthesizing = false;
    const voice = this.chosenVoice();
    // Empty voice lists occur while browsers load voices. Until Spanish is available,
    // recordings are preferable to letting an English default read Spanish instructions.
    if (!this.value.speechSupported || !voice) return this.fallbackAudio(sampleId, generation);
    let utterance;
    try {
      utterance = new this.Utterance(this.value.transcript);
      this.utterance = utterance;
      utterance.lang = 'es-MX';
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang || 'es-MX'; }
      utterance.volume = this.value.volume;
      utterance.rate = this.value.rate;
      utterance.pitch = 1;
      utterance.onend = () => this.finish(generation);
      utterance.onerror = event => {
        if (this.disposed || generation !== this.generation) return;
        if (event && ['canceled', 'interrupted'].includes(event.error)) return this.finish(generation);
        this.utterance = null;
        this.clearTimer();
        this.fallbackAudio(sampleId, generation);
      };
      this.value.speaking = true;
      this.value.status = 'Hablando…';
      this.setDucked(true);
      this.timer(() => { if (generation === this.generation) { this.stop(false); this.fallbackAudio(sampleId, this.generation); } }, Math.min(90000, 12000 + text.length * 110));
      this.emit();
      this.synthesis.speak(utterance);
      return true;
    } catch (_) {
      this.utterance = null;
      this.clearTimer();
      return this.fallbackAudio(sampleId, generation);
    }
  }

  async startRemoteSpeech(text, sampleId, generation) {
    const controller = this.controller(); this.speechAbort = controller;
    let fallbackStarted = false;
    const current = () => !this.disposed && generation === this.generation && !fallbackStarted && !(controller && controller.signal.aborted);
    const fallback = () => {
      if (!current()) return;
      fallbackStarted = true; if (controller) controller.abort(); this.speechAbort = null; this.clearTimer(); this.releaseAudio(); this.speakDevice(text, sampleId, generation);
    };
    this.timer(fallback, 20000);
    try {
      const result = await this.options.synthesize({text, signal: controller && controller.signal});
      if (!current()) return;
      // Autoplay can leave resume() pending indefinitely. Keep a separate
      // bounded startup watchdog through both resume and decoding, rather than
      // clearing all cancellation as soon as the network response arrives.
      this.clearTimer(); this.timer(fallback, 8000);
      const audio = result && result.audio;
      if (!(audio instanceof ArrayBuffer) || !audio.byteLength || audio.byteLength > 4 * 1024 * 1024) throw Error('invalid_speech_audio');
      const context = safeCall(this.options.getAudioContext);
      if (context && typeof context.createBufferSource === 'function') {
        if (context.state === 'suspended' && typeof context.resume === 'function') await context.resume();
        if (!current()) return;
        const buffer = await context.decodeAudioData(audio);
        if (!current()) return;
        const source = context.createBufferSource(), gain = context.createGain(); this.source = source; this.gain = gain;
        gain.gain.value = this.value.volume; source.buffer = buffer; source.playbackRate.value = this.value.rate; source.connect(gain); gain.connect(context.destination);
        source.onended = () => this.finish(generation); this.value.synthesizing = false; this.value.status = 'Hablando con voz natural…'; source.start();
        this.speechAbort = null; this.clearTimer();
        this.timer(() => { if (generation === this.generation) this.stop(); }, 90000); this.emit(); return;
      }
      const URLApi = this.options.URL || this.window && this.window.URL, BlobClass = this.options.Blob || this.window && this.window.Blob || (typeof Blob !== 'undefined' ? Blob : null);
      if (!URLApi || !URLApi.createObjectURL || !BlobClass || !this.Audio) throw Error('audio_output_unavailable');
      this.generatedAudioURL = URLApi.createObjectURL(new BlobClass([audio], {type: result.contentType || 'audio/mpeg'}));
      this.value.synthesizing = false; this.value.status = 'Hablando con voz natural…';
      this.speechAbort = null; this.clearTimer();
      this.timer(() => { if (generation === this.generation) this.stop(); }, 90000); this.startNativeAudio({src: this.generatedAudioURL}, generation); this.emit();
    } catch (_) {
      fallback();
    }
  }

  fallbackAudio(sampleId, generation) {
    if (this.disposed || generation !== this.generation) return false;
    const verified = this.guidance(this.snapshot()).completed;
    const exact = this.samples.find(sample => sample.text && (sample.id !== 'completed' || verified) && normalize(sample.text) === normalize(this.value.transcript));
    // Generic recordings must never claim that the current mission is completed.
    const requested = this.samples.find(sample => sample.id === sampleId && sample.id !== 'completed');
    const completed = sampleId === 'completed' && verified ? this.samples.find(sample => sample.id === 'completed') : null;
    const generic = this.samples.find(sample => sample.id === 'welcome') || this.samples.find(sample => sample.id === 'safety');
    const sample = exact || requested || completed || generic;
    // A recording is generic support, not synthesized live content. Automatic
    // prompts must never replay the same clip at every tiny approach change.
    if (sample && this.activeAutomaticKey) {
      if (this.playedAutomaticSamples.has(sample.id)) { this.finish(generation); this.value.status = 'Instrucción actual disponible en texto.'; this.emit(); return false; }
      this.playedAutomaticSamples.add(sample.id);
    }
    if (sample) return this.startAudio(sample, generation, true);
    this.value.speaking = false;
    this.value.status = 'Ayuda en texto. La voz del sistema no está disponible; prueba las muestras grabadas.';
    this.setDucked(false);
    this.emit();
    return false;
  }

  sampleURL(sample) {
    const base = String(this.options.assetBaseURL || '').replace(/\/+$/, '');
    if (/^(?:https?:|data:|blob:|\/)/.test(sample.src) || !base) return sample.src;
    return `${base}/${sample.src.replace(/^\.\//, '')}`;
  }

  playSample(id) {
    if (this.disposed) return false;
    const sample = this.samples.find(item => item.id === id);
    if (!sample) return false;
    this.adoptSnapshot(this.snapshot());
    this.setEnabled(true);
    this.stop(false);
    this.value.transcript = sample.text;
    this.value.lastIntent = 'sample';
    this.lastResponse = {intent: 'sample', text: sample.text, sampleId: sample.id};
    if (this.isPaused(this.snapshot())) { this.value.status = 'La voz está pausada con la escena.'; this.emit(); return false; }
    return this.startAudio(sample, this.generation, false);
  }

  startAudio(sample, generation, fallback) {
    if (this.disposed || generation !== this.generation) return false;
    if (!this.Audio && !this.options.getAudioContext) { this.finish(generation, 'Este navegador no puede reproducir audio.'); return false; }
    this.value.speaking = true;
    this.value.error = '';
    this.value.status = fallback ? 'Reproduciendo apoyo grabado; consulta la instrucción actual en el texto.' : `Reproduciendo muestra: ${sample.label}`;
    this.setDucked(true);
    this.timer(() => { if (generation === this.generation) this.stop(); }, 90000);
    this.emit();
    // A supplied shared AudioContext stays owned by the host and is never closed or suspended here.
    const context = safeCall(this.options.getAudioContext);
    if (context && typeof context.createBufferSource === 'function') {
      this.loadSharedAudio(context, sample, generation);
      return true;
    }
    return this.startNativeAudio(sample, generation);
  }

  async loadSharedAudio(context, sample, generation) {
    try {
      // Start resume before the first await so a sample button retains its activation gesture.
      if (context.state === 'suspended' && typeof context.resume === 'function') await context.resume();
      if (this.disposed || generation !== this.generation) return;
      const fetcher = this.options.fetch || (this.window && this.window.fetch && this.window.fetch.bind(this.window));
      if (!fetcher) throw new Error('no_fetch');
      const Controller = this.options.AbortController || (this.window && this.window.AbortController) || (typeof AbortController !== 'undefined' ? AbortController : null);
      this.audioAbort = Controller ? new Controller() : null;
      const response = await fetcher(this.sampleURL(sample), this.audioAbort ? {signal: this.audioAbort.signal} : undefined);
      if (!response || response.ok === false) throw new Error('audio_response');
      const data = await response.arrayBuffer();
      if (this.disposed || generation !== this.generation) return;
      // Only the currently selected clip is decoded; no cache grows during a session.
      const buffer = await context.decodeAudioData(data);
      if (this.disposed || generation !== this.generation) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      this.source = source;
      this.gain = gain;
      gain.gain.value = this.value.volume;
      source.buffer = buffer;
      source.playbackRate.value = this.value.rate;
      source.connect(gain); gain.connect(context.destination);
      source.onended = () => this.finish(generation);
      source.start();
    } catch (_) {
      if (!this.disposed && generation === this.generation) this.startNativeAudio(sample, generation);
    }
  }

  startNativeAudio(sample, generation) {
    if (!this.Audio) { this.finish(generation, 'No se pudo reproducir la muestra. La ayuda sigue disponible en texto.'); return false; }
    try {
      const audio = new this.Audio(this.sampleURL(sample));
      this.audio = audio;
      audio.preload = 'none';
      audio.volume = this.value.volume;
      audio.playbackRate = this.value.rate;
      audio.onended = () => this.finish(generation);
      audio.onerror = () => this.finish(generation, 'No se pudo reproducir la muestra. La ayuda sigue disponible en texto.');
      const started = audio.play();
      if (started && typeof started.catch === 'function') started.catch(() => this.finish(generation, 'Pulsa reproducir para permitir el audio en este navegador.'));
      return true;
    } catch (_) { this.finish(generation, 'No se pudo reproducir la muestra.'); return false; }
  }

  listen() {
    if (this.disposed) return false;
    this.adoptSnapshot(this.snapshot());
    if (this.value.listening) { if (this.recorder) return this.endRecording(true); this.stop(); return false; }
    if (this.state().capabilities.remoteTranscription) return this.startRecording();
    if (!this.Recognition) { this.value.status = 'El reconocimiento de voz no está disponible. Usa los botones o escribe una consulta.'; this.emit(); return false; }
    this.setEnabled(true);
    this.stop(false);
    if (this.isPaused(this.snapshot())) { this.value.status = 'El micrófono está pausado con la escena.'; this.emit(); return false; }
    const generation = this.generation;
    try {
      const recognition = new this.Recognition();
      this.recognition = recognition;
      recognition.lang = 'es-MX';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = event => {
        if (this.disposed || generation !== this.generation) return;
        const result = event && event.results && event.results[event.resultIndex || 0];
        const transcript = clean(result && result[0] && result[0].transcript);
        this.abortRecognition();
        this.clearTimer();
        this.value.listening = false;
        if (transcript) this.ask(transcript);
        else this.emit();
      };
      recognition.onerror = event => {
        if (this.disposed || generation !== this.generation) return;
        const denied = event && ['not-allowed', 'service-not-allowed'].includes(event.error);
        this.abortRecognition(); this.clearTimer(); this.value.listening = false;
        this.value.status = denied ? 'No hay permiso para usar el micrófono. Puedes usar los botones o escribir.' : 'No se reconoció la consulta. Puedes volver a intentarlo.';
        this.emit();
      };
      recognition.onend = () => {
        if (this.disposed || generation !== this.generation || !this.recognition) return;
        this.abortRecognition(); this.clearTimer(); this.value.listening = false; this.value.status = 'Micrófono detenido.'; this.emit();
      };
      this.value.listening = true;
      this.value.status = 'Escuchando una consulta…';
      this.timer(() => { if (generation === this.generation) this.stop(); }, 12000);
      recognition.start();
      this.emit();
      return true;
    } catch (_) { this.abortRecognition(); this.clearTimer(); this.value.listening = false; this.value.status = 'No se pudo iniciar el micrófono. Usa los botones o escribe.'; this.emit(); return false; }
  }

  startRecording() {
    this.setEnabled(true); this.stop(false);
    if (this.isPaused(this.snapshot())) { this.value.status = 'El micrófono está pausado con la escena.'; this.emit(); return false; }
    const generation = this.generation; this.value.listening = true; this.value.status = 'Permite el micrófono para hacer una pregunta.'; this.emit();
    this.captureMicrophone(generation); return true;
  }

  async captureMicrophone(generation) {
    let stream;
    try {
      const mediaDevices = this.window && this.window.navigator && this.window.navigator.mediaDevices;
      const getUserMedia = this.options.getUserMedia || mediaDevices && mediaDevices.getUserMedia.bind(mediaDevices);
      const Recorder = this.options.MediaRecorder || this.window && this.window.MediaRecorder;
      stream = await getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false});
      if (this.disposed || generation !== this.generation) { for (const track of stream.getTracks()) safeCall(track.stop.bind(track)); return; }
      this.microphoneStream = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => !Recorder.isTypeSupported || Recorder.isTypeSupported(type));
      const recorder = new Recorder(stream, mimeType ? {mimeType} : undefined); this.recorder = recorder; this.recordedChunks = []; this.recordedBytes = 0; this.recordSubmit = false;
      recorder.ondataavailable = event => {
        if (generation !== this.generation || !event.data || !event.data.size) return;
        this.recordedBytes += event.data.size;
        if (this.recordedBytes > 2 * 1024 * 1024) { this.stop(false); this.value.status = 'La pregunta de audio es demasiado larga. Vuelve a intentarlo con una frase breve.'; this.emit(); return; }
        this.recordedChunks.push(event.data);
      };
      recorder.onerror = () => { if (generation === this.generation) { this.stop(false); this.value.status = 'No se pudo grabar la consulta. Puedes escribir tu pregunta.'; this.emit(); } };
      recorder.onstop = () => {
        if (this.disposed || generation !== this.generation || this.recorder !== recorder) return;
        const chunks = this.recordedChunks.slice(), submit = this.recordSubmit, type = recorder.mimeType || mimeType || 'audio/webm';
        this.releaseMicrophone(); this.value.listening = false; this.clearTimer();
        if (submit && chunks.length) this.transcribeRecording(chunks, type, generation);
        else { this.value.status = 'No se grabó una pregunta. Puedes volver a intentarlo.'; this.emit(); }
      };
      recorder.start(250); this.prepareMicrophoneMeter(stream);
      this.value.status = this.microphoneMeter ? 'Te escucho. La pregunta se envía al terminar la frase; también puedes pulsar el micrófono.' : 'Te escucho. Pulsa el micrófono otra vez para enviar la pregunta.';
      this.timer(() => { if (generation === this.generation) this.endRecording(true); }, 12000); this.emit();
    } catch (_) {
      if (stream && this.microphoneStream !== stream) for (const track of stream.getTracks()) safeCall(track.stop.bind(track));
      if (!this.disposed && generation === this.generation) { this.releaseMicrophone(); this.clearTimer(); this.value.listening = false; this.value.status = 'No se pudo usar el micrófono. Comprueba el permiso o escribe tu pregunta.'; this.emit(); }
    }
  }

  endRecording(submit = true) {
    const recorder = this.recorder; if (!recorder) return false;
    this.recordSubmit = submit; this.value.status = submit ? 'Procesando tu pregunta…' : 'Grabación cancelada.'; this.emit();
    if (recorder.state !== 'inactive') safeCall(recorder.stop.bind(recorder));
    return true;
  }

  prepareMicrophoneMeter(stream) {
    const context = safeCall(this.options.getAudioContext);
    if (!context || typeof context.createMediaStreamSource !== 'function' || typeof context.createAnalyser !== 'function') return;
    let source, analyser;
    try {
      source = context.createMediaStreamSource(stream); analyser = context.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = .1;
      const floating = typeof analyser.getFloatTimeDomainData === 'function';
      if (!floating && typeof analyser.getByteTimeDomainData !== 'function') throw Error('no_meter');
      source.connect(analyser);
      // The microphone is measured, never connected to speakers. The host
      // retains ownership of the shared AudioContext and the only frame loop.
      this.microphoneMeter = {source, analyser, floating, samples: floating ? new Float32Array(512) : new Uint8Array(512), voiced: 0, silent: 0, age: 0, heard: false};
    } catch (_) { if (source) safeCall(source.disconnect.bind(source)); if (analyser) safeCall(analyser.disconnect.bind(analyser)); }
  }

  senseMicrophone(delta) {
    const meter = this.microphoneMeter;
    if (!meter || !this.recorder || this.recorder.state !== 'recording') return;
    try {
      if (meter.floating) meter.analyser.getFloatTimeDomainData(meter.samples); else meter.analyser.getByteTimeDomainData(meter.samples);
      let energy = 0; for (const sample of meter.samples) { const amplitude = meter.floating ? sample : (sample - 128) / 128; energy += amplitude * amplitude; }
      const rms = Math.sqrt(energy / meter.samples.length); if (!Number.isFinite(rms)) return;
      meter.age += delta;
      if (rms >= .022) { meter.voiced += delta; meter.silent = 0; if (meter.voiced >= .18) meter.heard = true; }
      else { meter.voiced = 0; if (meter.heard) meter.silent += delta; }
      if (meter.heard && meter.age >= .7 && meter.silent >= .95) this.endRecording(true);
    } catch (_) { this.releaseMicrophoneMeter(); }
  }

  releaseMicrophoneMeter() {
    const meter = this.microphoneMeter; this.microphoneMeter = null;
    if (meter) { safeCall(meter.source.disconnect.bind(meter.source)); safeCall(meter.analyser.disconnect.bind(meter.analyser)); }
  }

  async transcribeRecording(chunks, mimeType, generation) {
    const BlobClass = this.options.Blob || this.window && this.window.Blob || (typeof Blob !== 'undefined' ? Blob : null), controller = this.controller();
    if (!BlobClass) { this.value.status = 'Este navegador no puede enviar la grabación. Escribe tu consulta.'; this.emit(); return; }
    this.transcriptionAbort = controller; this.value.thinking = true; this.value.status = 'Entendiendo tu pregunta…'; this.emit();
    try {
      const result = await this.options.transcribe({audio: new BlobClass(chunks, {type: mimeType}), mimeType, signal: controller && controller.signal});
      if (this.disposed || generation !== this.generation || controller && controller.signal.aborted) return;
      this.transcriptionAbort = null; this.value.thinking = false; const transcript = clean(result && result.text);
      if (transcript) this.ask(transcript);
      else { this.value.status = 'No se reconoció una pregunta. Prueba de nuevo o escríbela.'; this.emit(); }
    } catch (_) {
      if (!this.disposed && generation === this.generation) { this.transcriptionAbort = null; this.value.thinking = false; this.value.status = 'No se pudo transcribir la consulta. Puedes escribirla.'; this.emit(); }
    }
  }

  releaseMicrophone() {
    this.releaseMicrophoneMeter();
    const recorder = this.recorder; this.recorder = null;
    if (recorder) { recorder.ondataavailable = recorder.onstop = recorder.onerror = null; if (recorder.state !== 'inactive') safeCall(recorder.stop.bind(recorder)); }
    if (this.microphoneStream) { for (const track of this.microphoneStream.getTracks()) safeCall(track.stop.bind(track)); this.microphoneStream = null; }
    this.recordedChunks = []; this.recordedBytes = 0; this.recordSubmit = false;
  }

  abortRecognition() {
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    recognition.onresult = recognition.onerror = recognition.onend = null;
    safeCall(recognition.abort && recognition.abort.bind(recognition));
  }

  releaseAudio() {
    if (this.audioAbort) this.audioAbort.abort();
    this.audioAbort = null;
    if (this.audio) {
      const audio = this.audio;
      this.audio = null;
      audio.onended = audio.onerror = null;
      safeCall(audio.pause && audio.pause.bind(audio));
      safeCall(audio.removeAttribute && audio.removeAttribute.bind(audio), 'src');
      safeCall(audio.load && audio.load.bind(audio));
    }
    if (this.source) { this.source.onended = null; safeCall(this.source.stop && this.source.stop.bind(this.source)); safeCall(this.source.disconnect && this.source.disconnect.bind(this.source)); this.source = null; }
    if (this.gain) { safeCall(this.gain.disconnect && this.gain.disconnect.bind(this.gain)); this.gain = null; }
    if (this.generatedAudioURL) { const URLApi = this.options.URL || this.window && this.window.URL; if (URLApi && URLApi.revokeObjectURL) safeCall(URLApi.revokeObjectURL.bind(URLApi), this.generatedAudioURL); this.generatedAudioURL = null; }
  }

  stop(notify = true) {
    if (this.disposed) return;
    this.generation++;
    this.clearTimer();
    for (const key of ['answerAbort', 'speechAbort', 'transcriptionAbort']) { if (this[key]) this[key].abort(); this[key] = null; }
    this.answerContext = null;
    this.releaseMicrophone();
    if (this.utterance) {
      this.utterance.onend = this.utterance.onerror = null;
      this.utterance = null;
      safeCall(this.synthesis && this.synthesis.cancel && this.synthesis.cancel.bind(this.synthesis));
    }
    this.abortRecognition();
    this.releaseAudio();
    this.value.speaking = false;
    this.value.listening = false;
    this.value.thinking = false;
    this.value.synthesizing = false;
    this.activeAutomaticKey = null;
    this.setDucked(false);
    if (notify) { this.remember(this.guidance(this.snapshot()).key); this.pendingGuidance = null; this.value.status = this.value.enabled ? 'Voz detenida.' : 'Voz desactivada.'; this.emit(); }
  }

  step(delta = 0) {
    if (this.disposed || !this.value.enabled && !this.value.speaking && !this.value.listening && !this.value.thinking) return;
    const elapsed = Number.isFinite(delta) && delta >= 0 ? Math.min(delta, 5) : 0;
    this.clock += elapsed; this.elapsed += elapsed;
    if (this.elapsed < 0.2 && delta > 0) return;
    const tick = this.elapsed;
    this.elapsed = 0;
    const snapshot = this.snapshot();
    this.adoptSnapshot(snapshot);
    if (this.isPaused(snapshot)) { if (this.value.speaking || this.value.listening || this.value.thinking) this.stop(); return; }
    if (this.value.listening) this.senseMicrophone(tick);
    if (this.answerContext && this.answerContext !== this.contextKey(snapshot)) this.stop(false);
    if (!this.value.enabled || !this.value.automatic || this.value.listening || this.value.thinking) return;
    const guidance = this.guidance(snapshot);
    // Cancel an obsolete automatic instruction as soon as its operational stage
    // changes. A manual question remains the operator's priority unless urgent.
    if (this.activeAutomaticKey && this.activeAutomaticKey !== guidance.key) this.stop(false);
    if (!guidance.text || !guidance.key || this.narrated.has(guidance.key)) return;
    if (!this.pendingGuidance || this.pendingGuidance.key !== guidance.key) this.pendingGuidance = {key: guidance.key, age: tick};
    else this.pendingGuidance.age += tick;
    const debounce = guidance.critical ? 0.1 : clamp(this.options.guidanceDebounce, 0.2, 3, 0.6);
    const interval = guidance.critical ? 0 : clamp(this.options.guidanceInterval, 0.5, 15, 2.4);
    if (this.pendingGuidance.age < debounce || this.clock - this.lastAutomaticAt < interval) return;
    if (this.value.speaking && !guidance.critical) return;
    this.remember(guidance.key);
    this.lastResponse = {intent: 'next', text: guidance.spokenText || guidance.text, sampleId: guidance.sampleId};
    this.value.lastIntent = 'next';
    this.value.source = 'local'; this.lastAutomaticAt = this.clock; this.pendingGuidance = null;
    this.speak(this.lastResponse.text, guidance.sampleId, guidance.key);
  }

  dispose() {
    if (this.disposed) return;
    this.stop(false);
    for (const remove of this.removers.splice(0)) safeCall(remove);
    this.narrated.clear();
    this.voiceObjects.clear();
    this.value.enabled = false;
    this.value.disposed = true;
    this.value.status = 'Asistente cerrado.';
    this.emit();
    this.disposed = true;
    this.listeners.clear();
  }
}

export const createVoiceAssistant = options => new VoiceAssistant(options);
export default createVoiceAssistant;
