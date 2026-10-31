const SETTINGS_KEY = 'smarttwin.voice-assistant.v1';
const MAX_TEXT = 1200;
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '';
const normalize = value => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿?¡!.,;:]/g, '');
const object = value => value && typeof value === 'object' ? value : {};
const safeCall = (callback, ...args) => { try { return typeof callback === 'function' ? callback(...args) : undefined; } catch (_) { return undefined; } };

/** Bounded, deterministic Spanish help. This service has no model, account or API key. */
export function resolveVoiceIntent(query) {
  const text = normalize(query);
  if (['next', 'objective', 'controls', 'content', 'repeat', 'stop'].includes(text)) return text;
  if (/\b(repite|repetir|otra vez)\b/.test(text)) return 'repeat';
  if (/\b(silencio|calla|detente|deja de hablar|para la voz)\b/.test(text)) return 'stop';
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
      status: 'Voz desactivada. Actívala para escuchar la ayuda.', error: '', transcript: '', lastIntent: '', disposed: false
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
    return {...this.value, voices: this.value.voices.map(voice => ({...voice})), samples: this.samples.slice(), capabilities: {...this.value.capabilities}};
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
      return {id, name: String(voice.name || voice.lang || 'Voz del sistema'), lang: String(voice.lang || ''), localService: voice.localService === true, default: voice.default === true};
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
  setAutomatic(value) { if (this.disposed) return; this.value.automatic = !!value; this.save(); this.emit(); }
  setVoice(id) { if (this.disposed) return; this.value.voiceId = typeof id === 'string' ? id : 'auto'; this.save(); this.emit(); }
  setVolume(value) { if (this.disposed) return; this.value.volume = clamp(value, 0, 1, this.value.volume); if (this.audio) this.audio.volume = this.value.volume; if (this.gain) this.gain.gain.value = this.value.volume; this.save(); this.emit(); }
  setRate(value) { if (this.disposed) return; this.value.rate = clamp(value, 0.6, 1.5, this.value.rate); if (this.audio) this.audio.playbackRate = this.value.rate; this.save(); this.emit(); }

  snapshot() { return object(safeCall(this.options.getSnapshot)); }
  isPaused(snapshot) { return snapshot.paused === true || snapshot.hidden === true || snapshot.immersiveActive !== true && !!(this.document && this.document.hidden); }
  adoptSnapshot(snapshot) {
    const session = String(snapshot.sessionKey || `${snapshot.roomId || ''}:${snapshot.projectId || ''}:${snapshot.restartKey || ''}`);
    if (session !== this.session) { this.stop(false); this.session = session; this.narrated.clear(); this.lastResponse = null; }
  }
  guidance(snapshot) {
    const raw = typeof snapshot.guidance === 'string' ? {text: snapshot.guidance} : object(snapshot.guidance || snapshot.currentGuidance);
    const completed = raw.completed === true;
    // Completion is a verified runtime fact, never a prediction based on proximity or a drop action.
    if (completed && raw.completionVerified !== true) return {text: 'La finalización todavía debe ser verificada por el simulador.', key: '', completed: false};
    return {text: clean(raw.text || snapshot.nextStep), key: String(raw.key || snapshot.phaseKey || raw.text || snapshot.nextStep || ''), sampleId: raw.sampleId, completed, critical: raw.critical === true};
  }

  ask(query = 'next') {
    if (this.disposed) return false;
    const intent = resolveVoiceIntent(query);
    if (intent === 'stop') { this.stop(); return {intent, text: 'Voz detenida.', spoken: false}; }
    if (intent === 'repeat') return this.repeat();
    const snapshot = this.snapshot();
    this.adoptSnapshot(snapshot);
    const guidance = this.guidance(snapshot);
    let text;
    if (intent === 'next') text = guidance.text || 'No hay un siguiente paso disponible en esta escena.';
    else if (intent === 'objective') text = clean(snapshot.objective) || 'Esta escena no ha publicado un objetivo.';
    else if (intent === 'controls') text = clean(snapshot.controls) || 'Consulta la guía de controles de la escena.';
    else if (intent === 'content') text = clean(snapshot.content) || 'Esta escena todavía no ha publicado una descripción.';
    else text = 'Puedo indicar el siguiente paso, el objetivo, los controles o el contenido de esta escena. Prueba: ¿qué hago ahora?';
    this.setEnabled(true);
    this.lastResponse = {intent, text, sampleId: intent === 'next' ? guidance.sampleId : undefined};
    this.value.lastIntent = intent;
    this.value.transcript = text;
    const spoken = !this.isPaused(snapshot) && this.speak(text, this.lastResponse.sampleId);
    if (intent === 'next' && guidance.key) this.narrated.add(guidance.key);
    if (this.isPaused(snapshot)) { this.value.status = 'Ayuda en texto. La voz está pausada con la escena.'; this.emit(); }
    return {intent, text, spoken};
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
    return voices.find(voice => /^es(?:-|_)/i.test(voice.lang) && voice.localService) || voices.find(voice => /^es(?:-|_|$)/i.test(voice.lang)) || null;
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
    this.value.error = error;
    this.value.status = error || 'Listo para ayudarte.';
    this.setDucked(false);
    this.emit();
  }

  speak(text, sampleId) {
    if (this.disposed || !this.value.enabled || this.isPaused(this.snapshot()) || !clean(text)) return false;
    this.stop(false);
    const generation = this.generation;
    this.value.transcript = clean(text);
    this.value.error = '';
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

  fallbackAudio(sampleId, generation) {
    if (this.disposed || generation !== this.generation) return false;
    const verified = this.guidance(this.snapshot()).completed;
    const exact = this.samples.find(sample => sample.text && (sample.id !== 'completed' || verified) && normalize(sample.text) === normalize(this.value.transcript));
    // Generic recordings must never claim that the current mission is completed.
    const requested = this.samples.find(sample => sample.id === sampleId && sample.id !== 'completed');
    const completed = sampleId === 'completed' && verified ? this.samples.find(sample => sample.id === 'completed') : null;
    const generic = this.samples.find(sample => sample.id === 'welcome') || this.samples.find(sample => sample.id === 'safety');
    const sample = exact || requested || completed || generic;
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
    if (this.value.listening) { this.stop(); return false; }
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
  }

  stop(notify = true) {
    if (this.disposed) return;
    this.generation++;
    this.clearTimer();
    if (this.utterance) {
      this.utterance.onend = this.utterance.onerror = null;
      this.utterance = null;
      safeCall(this.synthesis && this.synthesis.cancel && this.synthesis.cancel.bind(this.synthesis));
    }
    this.abortRecognition();
    this.releaseAudio();
    this.value.speaking = false;
    this.value.listening = false;
    this.setDucked(false);
    if (notify) { this.value.status = this.value.enabled ? 'Voz detenida.' : 'Voz desactivada.'; this.emit(); }
  }

  step(delta = 0) {
    if (this.disposed || !this.value.enabled && !this.value.speaking && !this.value.listening) return;
    this.elapsed += Number.isFinite(delta) && delta >= 0 ? delta : 0;
    if (this.elapsed < 0.2 && delta > 0) return;
    this.elapsed = 0;
    const snapshot = this.snapshot();
    this.adoptSnapshot(snapshot);
    if (this.isPaused(snapshot)) { if (this.value.speaking || this.value.listening) this.stop(); return; }
    if (!this.value.enabled || !this.value.automatic || this.value.listening) return;
    const guidance = this.guidance(snapshot);
    if (!guidance.text || !guidance.key || this.narrated.has(guidance.key)) return;
    // Only the host can label urgent safety guidance. Ordinary changes wait for
    // the current utterance, then read the latest snapshot without queuing old steps.
    if (this.value.speaking && !guidance.critical) return;
    this.narrated.add(guidance.key);
    // Cap retained identities even if an adapter publishes unstable phase keys.
    if (this.narrated.size > 128) this.narrated.delete(this.narrated.values().next().value);
    this.lastResponse = {intent: 'next', text: guidance.text, sampleId: guidance.sampleId};
    this.value.lastIntent = 'next';
    this.speak(guidance.text, guidance.sampleId);
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
