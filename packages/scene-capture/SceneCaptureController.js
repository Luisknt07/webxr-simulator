/* Capture only the rendered scene canvas. Call afterRender synchronously after the
 * primary render, before auxiliary camera compositing. No extra scene render,
 * source resize, preserveDrawingBuffer, network, audio or device permissions. */
const MIME_TYPES = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm'];
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const abortError = message => { const error = new Error(message || 'Captura cancelada.'); error.name = 'AbortError'; return error; };
const safeMessage = error => error && error.name === 'SecurityError'
    ? 'La vista contiene recursos que el navegador no permite capturar.'
    : 'No se pudo capturar la vista. Prueba otra vez o utiliza un navegador compatible.';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {}); return {promise, resolve, reject}; };

export function normalizeCaptureRegion(canvas, region) {
    const width = Math.floor(finite(canvas && canvas.width, 0)), height = Math.floor(finite(canvas && canvas.height, 0));
    if (width < 1 || height < 1) throw new Error('El escenario todavía no tiene un fotograma disponible.');
    if (!region) return {x:0, y:0, width, height};
    const values = ['x', 'y', 'width', 'height'].map(key => Number(region[key]));
    if (!values.every(Number.isFinite)) throw new Error('La región de captura no es válida.');
    const x = clamp(Math.floor(values[0]), 0, width - 1), y = clamp(Math.floor(values[1]), 0, height - 1);
    const w = Math.min(Math.floor(values[2]), width - x), h = Math.min(Math.floor(values[3]), height - y);
    if (w < 1 || h < 1 || values[0] < 0 || values[1] < 0) throw new Error('La región de captura no es válida.');
    return {x, y, width:w, height:h};
}

export function fitCaptureSize(width, height, options = {}) {
    width = finite(width, 0); height = finite(height, 0);
    if (width < 1 || height < 1) throw new Error('La vista de captura está vacía.');
    const maxWidth = clamp(finite(options.maxWidth, 3840), 2, 4096);
    const maxHeight = clamp(finite(options.maxHeight, 3840), 2, 4096);
    const maxPixels = clamp(finite(options.maxPixels, 8294400), 4, 16777216);
    const scale = Math.min(1, maxWidth / width, maxHeight / height, Math.sqrt(maxPixels / (width * height)));
    let w = Math.max(1, Math.floor(width * scale)), h = Math.max(1, Math.floor(height * scale));
    if (options.even) { w -= w % 2; h -= h % 2; if (w < 2 || h < 2) throw new Error('La vista es demasiado pequeña para grabar.'); }
    return {width:w, height:h};
}

export function fitFrame(sourceWidth, sourceHeight, width, height) {
    const scale = Math.min(width / sourceWidth, height / sourceHeight), w = sourceWidth * scale, h = sourceHeight * scale;
    return {x:(width - w) / 2, y:(height - h) / 2, width:w, height:h};
}

export function chooseRecordingMime(Recorder) {
    if (!Recorder) return null;
    if (typeof Recorder.isTypeSupported !== 'function') return '';
    for (const type of MIME_TYPES) { try { if (Recorder.isTypeSupported(type)) return type; } catch (_) {} }
    return null;
}

export function captureFilename(label, kind, mimeType, date = new Date()) {
    const clean = String(label || 'escenario').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'escenario';
    const stamp = date.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const extension = kind === 'photo' ? 'png' : /^video\/mp4(?:;|$)/i.test(mimeType || '') ? 'mp4' : 'webm';
    return 'smarttwin-' + clean + '-' + stamp + '.' + extension;
}

export default class SceneCaptureController {
    constructor(options = {}) {
        this.options = options;
        this.document = options.document || (typeof document !== 'undefined' ? document : null);
        this.window = options.window || (this.document && this.document.defaultView) || (typeof window !== 'undefined' ? window : {});
        this.now = options.now || (() => this.window.performance && this.window.performance.now ? this.window.performance.now() : Date.now());
        this.schedule = (fn, ms) => this.window.setTimeout ? this.window.setTimeout(fn, ms) : setTimeout(fn, ms);
        this.unschedule = id => this.window.clearTimeout ? this.window.clearTimeout(id) : clearTimeout(id);
        this.Recorder = options.MediaRecorder || this.window.MediaRecorder;
        this.Blob = options.Blob || this.window.Blob || (typeof Blob !== 'undefined' ? Blob : null);
        this.listeners = new Set(); this.captureListeners = new Set();
        this.context = {active:true, xr:false, identity:''}; this.contextKey = null; this.epoch = 0;
        this.phase = 'idle'; this.message = ''; this.lastCapture = null; this.disposed = false;
        this.photo = null; this.record = null; this.source = null; this.sourceLost = false; this.lastEmit = 0;
        this.fps = clamp(finite(options.fps, 30), 1, 30);
        this.maxDurationMs = clamp(finite(options.maxDurationMs, 120000), 1000, 300000);
        this.maxBytes = clamp(finite(options.maxBytes, 134217728), 1048576, 268435456);
        this.startTimeoutMs = clamp(finite(options.startTimeoutMs, 5000), 100, 15000);
        this.onLost = event => { if (event && event.preventDefault) event.preventDefault(); this.sourceLost = true; this._abort('La vista 3D se ha interrumpido. Espera a que se recupere.', false); };
        this.onRestored = () => { this.sourceLost = false; this.message = 'Vista recuperada. Puedes iniciar una nueva captura.'; this._emit(); };
        this.onVisibility = () => {
            if (!this.document || !this.document.hidden) return;
            this._syncContext();
            if (this.photo) this._cancelPhoto(abortError('La captura se canceló al ocultar la página.'));
            if (this.record) {
                if (this.record.started) { this.message = 'Grabación finalizada al ocultar la página.'; this.stopRecording(); }
                else this.cancel('Grabación cancelada: la página está oculta.');
            }
        };
        // BrowserHost keeps its world alive in BFCache. Revoke captures while
        // cached, then allow a new explicit capture when that world resumes.
        this.onPageHide = event => {if (event && event.persisted) this.cancel('Captura cancelada al salir del escenario.'); else this.dispose();};
        if (this.document && this.document.addEventListener) this.document.addEventListener('visibilitychange', this.onVisibility);
        if (this.window.addEventListener) this.window.addEventListener('pagehide', this.onPageHide);
        this._syncContext();
    }

    _readContext() {
        let value = this.context;
        try { if (this.options.getContext) value = this.options.getContext() || {}; } catch (_) { value = {active:false}; }
        return {active:value.active !== false, xr:!!value.xr, identity:String(value.identity || '')};
    }

    _syncContext() {
        if (this.disposed) return;
        const value = this._readContext(), key = JSON.stringify([value.identity, value.active, value.xr]);
        if (this.contextKey !== key) {
            const previous = this.contextKey; this.context = value; this.contextKey = key;
            if (previous !== null) this._abort(value.xr ? 'Sal de RV para capturar la vista de escritorio.' : !value.active ? 'Abre un escenario para capturar su vista.' : 'El escenario cambió. Inicia una nueva captura.', true);
        }
        let source = null; try { source = this.options.getCanvas ? this.options.getCanvas() : this.options.canvas; } catch (_) {}
        if (source !== this.source) {
            if (this.source && (this.photo || this.record)) this._abort('La vista cambió. Inicia una nueva captura.', true);
            if (this.source && this.source.removeEventListener) { this.source.removeEventListener('webglcontextlost', this.onLost); this.source.removeEventListener('webglcontextrestored', this.onRestored); }
            this.source = source || null; this.sourceLost = false;
            if (this.source && this.source.addEventListener) { this.source.addEventListener('webglcontextlost', this.onLost); this.source.addEventListener('webglcontextrestored', this.onRestored); }
        }
    }

    setContext(context) { if (this.disposed) return; this.context = Object.assign({}, this.context, context); this._syncContext(); this._emit(); }
    _reason() {
        const context = this._readContext();
        if (this.disposed) return 'La captura está cerrada.';
        if (context.xr) return 'Sal de RV para capturar la vista de escritorio.';
        if (!context.active) return 'Abre un escenario para capturar su vista.';
        if (this.document && this.document.hidden) return 'Vuelve a esta página para capturar.';
        if (this.sourceLost) return 'La vista 3D se está recuperando.';
        if (!this.source || this.source.width < 1 || this.source.height < 1) return 'Espera a que el escenario termine de cargar.';
        if (!this.document || !this.document.createElement || !this.Blob) return 'Este navegador no permite guardar capturas.';
        return '';
    }
    _recordReason() {
        const reason = this._reason(); if (reason) return reason;
        if (!this.Recorder || !this.source || typeof this.source.captureStream !== 'function' || chooseRecordingMime(this.Recorder) === null) return 'Vídeo no disponible en este navegador. Puedes guardar una foto.';
        return '';
    }
    _isCurrent(job) {
        if (this.disposed || job.epoch !== this.epoch || job.source !== this.source) return false;
        try { if ((this.options.getCanvas ? this.options.getCanvas() : this.options.canvas) !== job.source) return false; } catch (_) { return false; }
        const context = this._readContext();
        return context.active && !context.xr && context.identity === job.identity && !this.sourceLost;
    }
    getState() {
        const record = this.record, blockedReason = this._reason(), recordingReason = this._recordReason();
        return {phase:this.phase, busy:!!(this.photo || record), photoPending:!!this.photo, recording:!!(record && record.started && !record.stopping), preparing:!!(record && !record.started),
            elapsedMs:record && record.started ? Math.max(0, this.now() - record.startedAt) : 0,
            canPhoto:!blockedReason && !this.photo && this.phase !== 'stopping', canRecord:!recordingReason && !record,
            blockedReason, recordingReason, message:this.message, epoch:this.epoch, maxDurationMs:this.maxDurationMs,
            lastCapture:this.lastCapture ? Object.assign({}, this.lastCapture) : null};
    }
    subscribe(callback) { if (!this.disposed) this.listeners.add(callback); callback(this.getState()); return () => this.listeners.delete(callback); }
    onCapture(callback) { if (!this.disposed) this.captureListeners.add(callback); return () => this.captureListeners.delete(callback); }
    _emit() { const state = this.getState(); for (const callback of this.listeners) { try { callback(state); } catch (_) {} } }
    _newCanvas(size) {
        const canvas = this.document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
        let context;
        try {context = canvas.getContext('2d', {alpha:false}); if (!context) throw new Error('Captura 2D no disponible.');}
        catch (error) {canvas.width = canvas.height = 1; throw error;}
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        return {canvas, context};
    }
    _region() { return normalizeCaptureRegion(this.source, this.options.getRegion ? this.options.getRegion() : null); }
    _copy(job) {
        const region = this._region(), canvas = job.canvas, context = job.context;
        const frame = fitFrame(region.width, region.height, canvas.width, canvas.height);
        context.fillStyle = '#101b23'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(this.source, region.x, region.y, region.width, region.height, frame.x, frame.y, frame.width, frame.height);
    }
    _releaseCanvas(job) { if (job.canvas) { job.canvas.width = 1; job.canvas.height = 1; job.canvas = null; job.context = null; } }
    _label() { try { return typeof this.options.label === 'function' ? this.options.label() : this.options.label; } catch (_) { return 'escenario'; } }
    _result(kind, blob, job) {
        return {kind, blob, filename:captureFilename(this._label(), kind, blob.type), mimeType:blob.type, width:job.width, height:job.height,
            durationMs:kind === 'video' ? Math.max(0, finite(job.endedAt, this.now()) - job.startedAt) : undefined, frames:job.frames || 1};
    }
    _publish(result) {
        this.lastCapture = {kind:result.kind, filename:result.filename, mimeType:result.mimeType, width:result.width, height:result.height, bytes:result.blob.size, durationMs:result.durationMs};
        for (const callback of this.captureListeners) { try { callback(result); } catch (_) {} }
    }

    capturePhoto() {
        this._syncContext(); const reason = this._reason();
        if (reason || this.photo || this.phase === 'stopping') return Promise.reject(new Error(reason || 'Espera a que termine la captura actual.'));
        const pending = deferred();
        this.photo = {pending, epoch:this.epoch, identity:this.context.identity, source:this.source, encoding:false};
        this.photo.timer = this.schedule(() => { if (this.photo && this.photo.pending === pending) this._cancelPhoto(new Error('No llegó un fotograma nuevo. Vuelve al escenario y prueba otra vez.')); }, this.startTimeoutMs);
        this.message = 'Preparando foto del escenario…'; this._emit(); return pending.promise;
    }
    _cancelPhoto(error) {
        const photo = this.photo; if (!photo) return;
        this.photo = null; this.unschedule(photo.timer); this._releaseCanvas(photo); photo.pending.reject(error);
        if (error.name !== 'AbortError') this.message = error.message; this._emit();
    }
    _capturePhotoFrame() {
        const job = this.photo; if (!job || job.encoding) return;
        try {
            const region = this._region(), size = fitCaptureSize(region.width, region.height, this.options.photo);
            Object.assign(job, this._newCanvas(size), size); this._copy(job); job.encoding = true;
            job.canvas.toBlob(blob => {
                if (this.photo !== job || !this._isCurrent(job)) {
                    if (this.photo === job) this._cancelPhoto(abortError('El escenario cambió durante la captura.'));
                    return;
                }
                if (!blob || !blob.size || blob.type !== 'image/png') { this._cancelPhoto(new Error('No se pudo guardar la foto. Prueba otra vez.')); return; }
                this.photo = null; this.unschedule(job.timer); this._releaseCanvas(job);
                const result = this._result('photo', blob, job); this.message = 'Foto lista. Descarga disponible en este dispositivo.';
                this._publish(result); job.pending.resolve(result); this._emit();
            }, 'image/png');
        } catch (error) { this._cancelPhoto(new Error(safeMessage(error))); }
    }

    startRecording() {
        this._syncContext(); const reason = this._recordReason();
        if (reason || this.record) return Promise.reject(new Error(reason || 'Ya hay una grabación en curso.'));
        const start = deferred(), finish = deferred();
        try {
            const region = this._region(), size = fitCaptureSize(region.width, region.height, Object.assign({maxWidth:1920,maxHeight:1080,maxPixels:2073600}, this.options.video, {even:true}));
            const buffer = this._newCanvas(size);
            this.record = Object.assign(buffer, size, {start, finish, epoch:this.epoch, identity:this.context.identity, source:this.source,
                chunks:[], bytes:0, frames:0, started:false, stopping:false, finished:false, lastFrame:-Infinity, mimeType:chooseRecordingMime(this.Recorder)});
            this.record.startTimer = this.schedule(() => this._failRecord(this.record, new Error('No llegó un fotograma nuevo. Vuelve al escenario para grabar.')), this.startTimeoutMs);
            this.phase = 'preparing'; this.message = 'Preparando grabación de la vista 3D…'; this._emit();
        } catch (error) {
            const failure = new Error(safeMessage(error));
            if (this.record && this.record.start === start) this._failRecord(this.record, failure); else start.reject(failure);
        }
        return start.promise;
    }
    _beginRecording(job) {
        let stream = job.canvas.captureStream(0), tracks = stream.getVideoTracks(); job.stream = stream;
        if (!tracks.length) throw new Error('No hay una pista de vídeo disponible.');
        if (typeof tracks[0].requestFrame !== 'function') {
            for (const track of stream.getTracks()) track.stop();
            stream = job.canvas.captureStream(this.fps); job.stream = stream; tracks = stream.getVideoTracks();
        }
        if (!tracks.length || (stream.getAudioTracks && stream.getAudioTracks().length)) throw new Error('La captura debe contener solamente la vista 3D.');
        job.track = tracks[0]; job.onEnded = () => { if (!job.finished && !job.stopping) this._failRecord(job, new Error('El navegador interrumpió la grabación.')); };
        if (job.track.addEventListener) job.track.addEventListener('ended', job.onEnded);
        const recorderOptions = {videoBitsPerSecond:clamp(finite(this.options.videoBitsPerSecond, 8000000), 1000000, 16000000)};
        if (job.mimeType) recorderOptions.mimeType = job.mimeType;
        const recorder = new this.Recorder(stream, recorderOptions); job.recorder = recorder;
        recorder.ondataavailable = event => {
            if (job.finished || !this._isCurrent(job)) return;
            const data = event.data; if (!data || !data.size) return;
            if (job.bytes + data.size > this.maxBytes || job.chunks.length >= 1024) { this._failRecord(job, new Error('La grabación superó el tamaño permitido. Inicia un vídeo más corto.')); return; }
            job.chunks.push(data); job.bytes += data.size;
            if (!job.stopping && job.bytes >= this.maxBytes * .9) { this.message = 'Grabación finalizada al alcanzar el límite de tamaño.'; this.stopRecording(); }
        };
        recorder.onerror = () => this._failRecord(job, new Error('El navegador no pudo continuar grabando. Prueba un vídeo más corto.'));
        recorder.onstop = () => this._finishRecord(job);
        recorder.start(1000); job.started = true; job.startedAt = this.now(); this.unschedule(job.startTimer);
        job.durationTimer = this.schedule(() => { if (this.record === job && !job.stopping) { this.message = 'Grabación finalizada: se alcanzó el límite de tiempo.'; this.stopRecording(); } }, this.maxDurationMs);
        this.phase = 'recording'; this.message = 'Grabando solo el escenario; sin micrófono ni interfaz.';
        job.start.resolve({width:job.width,height:job.height,mimeType:recorder.mimeType || job.mimeType}); this._emit();
    }
    _cleanupRecord(job) {
        this.unschedule(job.startTimer); this.unschedule(job.durationTimer); this.unschedule(job.stopTimer);
        if (job.track && job.track.removeEventListener) job.track.removeEventListener('ended', job.onEnded);
        if (job.recorder) { job.recorder.ondataavailable = null; job.recorder.onerror = null; job.recorder.onstop = null; }
        if (job.stream) { for (const track of job.stream.getTracks()) { try { track.stop(); } catch (_) {} } }
        job.chunks = []; job.stream = null; job.track = null; job.recorder = null; this._releaseCanvas(job);
    }
    _failRecord(job, error) {
        if (!job || job.finished) return; job.finished = true;
        if (this.record === job) this.record = null;
        if (job.recorder) { job.recorder.ondataavailable = null; job.recorder.onerror = null; job.recorder.onstop = null; try { if (job.recorder.state !== 'inactive') job.recorder.stop(); } catch (_) {} }
        this._cleanupRecord(job); job.start.reject(error); job.finish.reject(error);
        this.phase = this.disposed ? 'disposed' : 'idle'; if (error.name !== 'AbortError') this.message = error.message; this._emit();
    }
    _finishRecord(job) {
        if (!job || job.finished) return;
        if (!this._isCurrent(job)) { this._failRecord(job, abortError('El escenario cambió durante la grabación.')); return; }
        const type = (job.recorder && job.recorder.mimeType) || (job.chunks[0] && job.chunks[0].type) || job.mimeType;
        if (!job.frames || !job.bytes || !/^video\/(webm|mp4)(?:;|$)/i.test(type || '')) { this._failRecord(job, new Error('La grabación no generó un vídeo válido. Inténtalo otra vez.')); return; }
        const blob = new this.Blob(job.chunks, {type}), result = this._result('video', blob, job);
        job.finished = true; if (this.record === job) this.record = null; this._cleanupRecord(job);
        this.phase = 'idle'; this.message = 'Vídeo listo. Descarga disponible en este dispositivo.';
        this._publish(result); job.finish.resolve(result); this._emit();
    }
    stopRecording() {
        this._syncContext(); const job = this.record; if (!job) return Promise.resolve(null);
        if (!job.started) { this.cancel('Grabación cancelada antes del primer fotograma.'); return Promise.resolve(null); }
        if (job.stopping) return job.finish.promise;
        job.stopping = true; job.endedAt = this.now(); this.phase = 'stopping'; this.message = 'Preparando vídeo para descargar…'; this.unschedule(job.durationTimer);
        job.stopTimer = this.schedule(() => this._failRecord(job, new Error('El navegador no pudo finalizar el vídeo.')), 10000);
        try { if (job.recorder.state !== 'inactive') job.recorder.stop(); else this._finishRecord(job); } catch (error) { this._failRecord(job, new Error(safeMessage(error))); }
        this._emit(); return job.finish.promise;
    }
    _abort(reason, invalidate) {
        if (invalidate) { this.epoch++; this.lastCapture = null; }
        this.message = reason || 'Captura cancelada.';
        if (this.photo) this._cancelPhoto(abortError(this.message));
        if (this.record) this._failRecord(this.record, abortError(this.message));
        this.phase = this.disposed ? 'disposed' : 'idle'; this._emit();
    }
    cancel(reason) { if (!this.disposed) this._abort(reason || 'Captura descartada.', true); }

    afterRender() {
        if (this.disposed) return; this._syncContext(); if (this._reason()) return;
        if (this.photo) this._capturePhotoFrame();
        const job = this.record, now = this.now();
        if (job && !job.stopping && now - job.lastFrame >= 1000 / this.fps - .5) {
            try {
                this._copy(job); job.frames++; if (!job.started) this._beginRecording(job);
                if (job.track && typeof job.track.requestFrame === 'function') job.track.requestFrame();
                job.lastFrame = now;
            } catch (error) { this._failRecord(job, new Error(safeMessage(error))); }
        }
        if (now - this.lastEmit >= 250) { this.lastEmit = now; this._emit(); }
    }
    dispose() {
        if (this.disposed) return; this.disposed = true; this._abort('Captura cerrada.', true);
        if (this.source && this.source.removeEventListener) { this.source.removeEventListener('webglcontextlost', this.onLost); this.source.removeEventListener('webglcontextrestored', this.onRestored); }
        if (this.document && this.document.removeEventListener) this.document.removeEventListener('visibilitychange', this.onVisibility);
        if (this.window.removeEventListener) this.window.removeEventListener('pagehide', this.onPageHide);
        this.source = null; this.listeners.clear(); this.captureListeners.clear();
    }
}
