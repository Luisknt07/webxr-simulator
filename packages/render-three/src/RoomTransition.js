import * as THREE from 'three';

/** A separate opaque 3D render during loading, including immersive XR eyes.
 * No old room, compositor mirror texture or head/controller pose is reused. */
export default class RoomTransition {
  constructor(ctx, options = {}) {
    this.ctx = ctx; this.document = options.document || (typeof document === 'undefined' ? null : document); this.waiters = []; this.frame = 0; this.active = false;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#071014');
    this.shell = new THREE.Mesh(new THREE.SphereBufferGeometry(2, 12, 8), new THREE.MeshBasicMaterial({color: '#071014', side: THREE.BackSide, depthTest: false, depthWrite: false}));
    this.shell.frustumCulled = false; this.shell.layers.enableAll(); this.scene.add(this.shell);
    const dom = this.document;
    if (dom && dom.createElement) {
      this.canvas = dom.createElement('canvas'); this.canvas.width = 1024; this.canvas.height = 256; this.draw = this.canvas.getContext && this.canvas.getContext('2d');
      if (this.draw) {this.texture = new THREE.CanvasTexture(this.canvas); this.texture.encoding = THREE.sRGBEncoding; this.texture.minFilter = THREE.LinearFilter; this.texture.generateMipmaps = false;
        this.label = new THREE.Mesh(new THREE.PlaneBufferGeometry(1.25, .3125), new THREE.MeshBasicMaterial({map: this.texture, depthTest: false, depthWrite: false})); this.label.frustumCulled = false; this.label.layers.enableAll(); this.label.renderOrder = 1; this.scene.add(this.label);}
      this.dom = dom.createElement('section'); this.dom.setAttribute('role', 'status'); this.dom.setAttribute('aria-live', 'polite'); this.dom.dataset.roomTransition = '';
      Object.assign(this.dom.style, {position: 'fixed', inset: '0', zIndex: '2147483000', background: '#071014', color: '#d5e9ed', display: 'none', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '20px', font: '16px system-ui,sans-serif'});
      this.text = dom.createElement('p'); this.dom.appendChild(this.text);
      this.retryButton = dom.createElement('button'); this.retryButton.textContent = 'Reintentar'; this.retryButton.hidden = true; this.retryButton.onclick = () => this.retry && this.retry(); this.dom.appendChild(this.retryButton);
      this.exitButton = dom.createElement('button'); this.exitButton.textContent = 'Salir de realidad virtual'; this.exitButton.hidden = true; this.exitButton.onclick = () => this.exitVR(); this.dom.appendChild(this.exitButton);
      if (dom.body) dom.body.appendChild(this.dom);
    }
  }
  caption(message, error = false) {
    if (this.text) this.text.textContent = message;
    if (this.draw) {const c = this.draw; c.fillStyle = '#071014'; c.fillRect(0, 0, 1024, 256); c.fillStyle = '#a8eadb'; c.font = 'bold 38px sans-serif'; c.fillText(error ? 'No se pudo abrir el escenario' : 'Preparando escenario', 36, 78); c.fillStyle = '#e5f1f4'; c.font = '26px sans-serif'; c.fillText(String(message).slice(0, 70), 36, 135); if (error) {c.font = '24px sans-serif'; c.fillText('Gatillo: reintentar · B: salir de RV', 36, 204);} this.texture.needsUpdate = true;}
  }
  cover(request, message = 'Cargando el destino…') {
    this.active = true; this.error = false; this.retry = null; this.owner = request; this.ctx.roomTransition = true;
    if (this.dom) this.dom.style.display = 'flex'; if (this.retryButton) this.retryButton.hidden = true; if (this.exitButton) this.exitButton.hidden = true;
    this.caption(message); return this.nextFrame(request, 2);
  }
  nextFrame(request, frames = 1) {
    if (request && request.signal && request.signal.aborted) return Promise.reject(Object.assign(new Error('Transición cancelada.'), {name: 'AbortError'}));
    // Startup has no animation loop yet; hidden desktop tabs need not wait for
    // a frame nobody can see. The opaque DOM/3D gate remains active meanwhile.
    if (!this.frame || this.document && this.document.hidden && !this.ctx.vrMode) return new Promise((resolve, reject) => setTimeout(() => request && request.signal && request.signal.aborted ? reject(Object.assign(new Error('Transición cancelada.'), {name: 'AbortError'})) : resolve(), 0));
    return new Promise((resolve, reject) => {
      const waiter = {until: this.frame + frames, resolve, reject, request};
      const settle = error => {if (waiter.done) return; waiter.done = true; clearTimeout(waiter.timer); if (request && request.signal) request.signal.removeEventListener('abort', waiter.abort); this.waiters = this.waiters.filter(value => value !== waiter); error ? reject(error) : resolve();};
      waiter.finish = () => settle(); waiter.abort = () => settle(Object.assign(new Error('Transición cancelada.'), {name: 'AbortError'}));
      if (request && request.signal) request.signal.addEventListener('abort', waiter.abort, {once: true});
      // A paused/lost XR session must not deadlock project loading indefinitely.
      waiter.timer = setTimeout(waiter.finish, 250); this.waiters.push(waiter);
    });
  }
  presented() { this.frame++; this.waiters.slice().forEach(waiter => {if (this.frame >= waiter.until) waiter.finish();}); }
  warm(scene, camera, request) {
    if (!this.frame || this.document && this.document.hidden && !this.ctx.vrMode) return this.nextFrame(request);
    return new Promise((resolve, reject) => {
      const job = {scene, camera, request, resolve, reject}; this.warmJob = job;
      job.timer = setTimeout(() => {if (this.warmJob !== job) return; this.warmJob = null; try {request.assertCurrent(); resolve();} catch (error) {reject(error);}}, 250);
    });
  }
  render(renderer, camera, delta = 0) {
    if (!this.active) return false;
    camera.updateWorldMatrix(true, false);
    const tracked = this.ctx.vrMode && renderer.xr && renderer.xr.getCamera ? renderer.xr.getCamera(camera) : camera;
    const position = new THREE.Vector3().setFromMatrixPosition(tracked.matrixWorld), rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(tracked.matrixWorld));
    this.shell.position.copy(position); if (this.label) {this.label.position.copy(position).add(new THREE.Vector3(0, -.06, -1.3).applyQuaternion(rotation)); this.label.quaternion.copy(rotation);}
    if (this.dom) this.dom.style.display = 'flex'; if (this.exitButton) this.exitButton.hidden = !this.ctx.vrMode;
    const warm = this.warmJob; this.warmJob = null;
    let failure;
    if (warm) {clearTimeout(warm.timer); try {warm.request.assertCurrent(); renderer.render(warm.scene, warm.camera);} catch (error) {failure = error;}}
    // The cover is always the LAST render submitted to both eyes. The one-time
    // destination warm-up can upload buffers/shaders without exposing its frame.
    let coverFailure;
    try {renderer.render(this.scene, camera); if (this.ctx.xrMirror) this.ctx.xrMirror.postRender(this.scene, camera, delta);} catch (error) {coverFailure = error; failure = failure || error;}
    if (warm) failure ? warm.reject(failure) : warm.resolve();
    if (!coverFailure) this.presented();
    else {if (this.owner && this.owner.abort) this.owner.abort(); if (!this.error) this.fail(coverFailure, null);}
    if (this.error) this.errorInput(); return true;
  }
  async finish(request) {await this.nextFrame(request, 1); if (this.owner !== request || request && !request.isCurrent()) return; this.active = false; this.error = false; if (this.dom) this.dom.style.display = 'none';}
  fail(error, retry) {this.active = true; this.error = true; this.retry = () => {this.error = false; if (retry) Promise.resolve().then(retry).catch(() => {});}; this.errorHands = new WeakMap(); this.caption(error && error.message || 'Vuelve a intentarlo.', true); if (this.retryButton) this.retryButton.hidden = false;}
  errorInput() {
    for (const data of this.ctx.raycontrol && this.ctx.raycontrol.controllers || []) {
      const source = data.inputSource, pad = source && source.gamepad; if (!pad || pad.mapping !== 'xr-standard') continue;
      const pressed = n => !!(pad.buttons[n] && (pad.buttons[n].pressed || pad.buttons[n].value > .6));
      let state = this.errorHands.get(source); if (!state) {state = {armed: false}; this.errorHands.set(source, state);} if (!pressed(0) && !pressed(5)) state.armed = true;
      if (state.armed && pressed(5)) {state.armed = false; this.exitVR();} else if (state.armed && pressed(0)) {state.armed = false; if (this.retry) this.retry();}
    }
  }
  exitVR() {const session = this.ctx.renderer && this.ctx.renderer.xr && this.ctx.renderer.xr.getSession(); if (session && session.end) Promise.resolve(session.end()).catch(() => {});}
  dispose() {this.waiters.slice().forEach(waiter => waiter.abort()); if (this.warmJob) {clearTimeout(this.warmJob.timer); this.warmJob.reject(Object.assign(new Error('Transición cerrada.'), {name: 'AbortError'})); this.warmJob = null;} this.shell.geometry.dispose(); this.shell.material.dispose(); if (this.label) {this.label.geometry.dispose(); this.label.material.dispose(); this.texture.dispose();} if (this.dom) this.dom.remove(); this.active = false;}
}
