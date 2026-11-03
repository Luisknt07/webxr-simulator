import SceneCaptureController from './SceneCaptureController.js';

export function captureTimer(milliseconds) {
    const seconds = Math.floor(Math.max(0, Number(milliseconds) || 0) / 1000);
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}

/* Relative toolbar: the host owns placement and lifecycle. Its controller can be
 * shared by public, learner and author views without coupling to their menus. */
export default class SceneCaptureToolbar {
    constructor(options = {}) {
        this.options = options;
        this.document = options.document || (typeof document !== 'undefined' ? document : null);
        this.window = options.window || (this.document && this.document.defaultView) || (typeof window !== 'undefined' ? window : {});
        if (!(options.controller instanceof SceneCaptureController) && (!options.controller || !options.controller.subscribe || !options.controller.onCapture)) throw new Error('Se necesita un controlador de captura.');
        this.controller = options.controller; this.root = null; this.listeners = []; this.url = null; this.disposed = false; this.epoch = null;
    }
    _element(tag, className, text) {
        const element = this.document.createElement(tag); if (className) element.className = className;
        if (text) element.textContent = text; return element;
    }
    _listen(node, type, callback) { node.addEventListener(type, callback); this.listeners.push(() => node.removeEventListener(type, callback)); }
    _button(label, icon) {
        const button = this._element('button', 'scene-capture-button'); button.type = 'button';
        const symbol = this._element('span', 'scene-capture-icon scene-capture-icon--' + icon); symbol.setAttribute('aria-hidden', 'true'); button.appendChild(symbol);
        const text = this._element('span', 'scene-capture-label', label); button.appendChild(text); button.captureLabel = text; return button;
    }
    mount(host) {
        if (this.disposed) throw new Error('La barra de captura está cerrada.');
        if (this.root) return this.root;
        this.root = this._element('div', 'scene-capture-toolbar'); this.root.setAttribute('role', 'toolbar'); this.root.setAttribute('aria-label', 'Capturar vista 3D');
        this.actions = this._element('div', 'scene-capture-actions'); this.root.appendChild(this.actions);
        this.photoButton = this._button('Foto', 'photo'); this.photoButton.setAttribute('aria-label', 'Guardar foto del escenario');
        this.recordButton = this._button('Grabar', 'record'); this.recordButton.setAttribute('aria-label', 'Grabar vídeo del escenario'); this.recordButton.setAttribute('aria-pressed', 'false');
        this.cancelButton = this._button('Descartar', 'cancel'); this.cancelButton.setAttribute('aria-label', 'Descartar la grabación actual'); this.cancelButton.hidden = true;
        this.timer = this._element('output', 'scene-capture-timer', '00:00'); this.timer.setAttribute('aria-label', 'Duración de la grabación'); this.timer.hidden = true;
        for (const element of [this.photoButton, this.recordButton, this.timer, this.cancelButton]) this.actions.appendChild(element);
        this.downloadLink = this._element('a', 'scene-capture-download'); this.downloadLink.hidden = true; this.downloadLink.setAttribute('aria-label', 'Descargar la última captura');
        this.root.appendChild(this.downloadLink);
        this.status = this._element('span', 'scene-capture-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite'); this.status.setAttribute('aria-atomic', 'true'); this.root.appendChild(this.status);
        // Keep keyboard and pointer actions local to prevent shortcuts from moving
        // a vehicle; the native button activation/focus behavior stays intact.
        for (const type of ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup']) this._listen(this.root, type, event => event.stopPropagation());
        this._listen(this.root, 'pointerdown', () => this._interact());
        this._listen(this.root, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') this._interact(); });
        this._listen(this.photoButton, 'click', () => this._run(() => this.controller.capturePhoto()));
        this._listen(this.recordButton, 'click', () => {
            const state = this.controller.getState();
            this._run(() => state.recording || state.preparing ? this.controller.stopRecording() : this.controller.startRecording());
        });
        this._listen(this.cancelButton, 'click', () => { this._interact(); this.controller.cancel('Grabación descartada.'); });
        this._listen(this.downloadLink, 'click', () => this._interact());
        host.appendChild(this.root);
        this.unsubscribe = this.controller.subscribe(state => this.update(state));
        this.unsubscribeCapture = this.controller.onCapture(result => this._offerCapture(result));
        return this.root;
    }
    _interact() { if (!this.disposed && this.options.onInteract) { try { this.options.onInteract(); } catch (_) {} } }
    _run(action) {
        if (this.disposed) return; this._interact(); this.error = '';
        Promise.resolve().then(() => { if (!this.disposed) return action(); }).catch(error => {
            if (this.disposed || (error && error.name === 'AbortError')) return;
            // Controlled errors originate from the capture adapter, never source
            // markup. DOM text is used even for hostile injected test messages.
            this.error = String(error && error.message || 'No se pudo completar la captura.').slice(0, 180);
            this.update(this.controller.getState());
        });
    }
    update(state) {
        if (!this.root || this.disposed) return;
        if (this.epoch !== state.epoch) { this._clearDownload(); this.error = ''; this.epoch = state.epoch; }
        const recording = !!state.recording, preparing = !!state.preparing, stopping = state.phase === 'stopping', active = recording || preparing || stopping;
        this.root.dataset.state = state.phase; this.root.dataset.recording = String(recording);
        this.photoButton.disabled = !state.canPhoto;
        this.photoButton.title = state.blockedReason || 'Guardar PNG de la vista 3D; sin menús ni controles.';
        this.photoButton.captureLabel.textContent = state.photoPending ? 'Capturando…' : 'Foto';
        this.recordButton.disabled = stopping || (!active && !state.canRecord);
        this.recordButton.captureLabel.textContent = stopping ? 'Guardando…' : active ? 'Detener' : 'Grabar';
        this.recordButton.setAttribute('aria-label', active ? 'Detener grabación del escenario' : 'Grabar vídeo del escenario');
        this.recordButton.setAttribute('aria-pressed', String(active));
        this.recordButton.title = active ? 'Finalizar y descargar el vídeo.' : state.recordingReason || 'Grabar solo la vista 3D; sin audio. Máximo ' + captureTimer(state.maxDurationMs) + '.';
        this.timer.hidden = !active; this.timer.textContent = captureTimer(state.elapsedMs);
        this.cancelButton.hidden = !active; this.cancelButton.disabled = stopping;
        const text = this.error || state.blockedReason || state.message || state.recordingReason || '';
        if (this.status.textContent !== text) this.status.textContent = text;
        this.status.hidden = !text; this.status.title = text;
        this.root.dataset.error = String(!!this.error);
    }
    _clearDownload() {
        const URL = this.window.URL;
        if (this.url && URL && URL.revokeObjectURL) URL.revokeObjectURL(this.url);
        this.url = null;
        if (this.downloadLink) { this.downloadLink.hidden = true; this.downloadLink.removeAttribute('href'); this.downloadLink.removeAttribute('download'); this.downloadLink.textContent = ''; }
    }
    _offerCapture(result) {
        if (this.disposed || !this.root || !result || !result.blob) return;
        const state = this.controller.getState(); if (state.epoch !== this.epoch || (state.blockedReason && !this.document.hidden)) return;
        this._clearDownload(); const URL = this.window.URL;
        if (!URL || !URL.createObjectURL) { this.error = 'La captura está lista, pero este navegador no permite descargarla.'; this.update(state); return; }
        try {
            this.url = URL.createObjectURL(result.blob); this.downloadLink.href = this.url; this.downloadLink.download = result.filename;
            this.downloadLink.textContent = result.kind === 'video' ? 'Descargar vídeo' : 'Descargar foto';
            this.downloadLink.setAttribute('aria-label', this.downloadLink.textContent + ' · ' + result.width + ' por ' + result.height + ' píxeles');
            this.downloadLink.hidden = false;
            // Some mobile browsers require another gesture after asynchronous
            // encoding. Keep the real download link visible in every case.
            if (!this.document.hidden) this.downloadLink.click();
        } catch (_) { this.error = 'No se pudo descargar automáticamente. Usa el enlace de descarga.'; this.update(state); }
    }
    dispose() {
        if (this.disposed) return; this.disposed = true;
        if (this.unsubscribe) this.unsubscribe(); if (this.unsubscribeCapture) this.unsubscribeCapture();
        for (const remove of this.listeners) remove(); this.listeners = []; this._clearDownload();
        if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root); this.root = null;
    }
}
