import * as THREE from 'three';
import { BasisTextureLoader } from 'three/examples/jsm/loaders/BasisTextureLoader.js';

const WIDTH = 192;
const HEIGHT = 128;
const CACHE_LIMIT = 80;
const TYPE_LABELS = { model: '3D', image: 'IMAGEN', audio: 'AUDIO', video: 'VIDEO', text: 'TEXTO', source: 'BLENDER', other: 'ARCHIVO' };
const TYPE_ICONS = { model: '◇', image: '▧', audio: '♫', video: '▶', text: '{ }', source: '◉', other: '▤' };

// instantiate() returns private resources; never dispose the scene's shared assets.
function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).forEach(material => {
      materials.add(material);
      Object.keys(material).forEach(key => { if (material[key] && material[key].isTexture) textures.add(material[key]); });
      Object.keys(material.uniforms || {}).forEach(key => {
        const value = material.uniforms[key].value;
        if (value && value.isTexture) textures.add(value);
      });
    });
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

function keyFor(entry) {
  return [entry.id || entry.importId || entry.path, entry.url || '', entry.thumbnailPath || '', entry.previewPath || ''].join('|');
}

export default class AssetThumbnails {
  constructor(library, rootElement) {
    this.library = library;
    this.rootElement = rootElement;
    this.cache = new Map();
    this.attachments = new Map();
    this.jobs = new Map();
    this.queue = [];
    this.generation = 0;
    this.running = false;
    this.renderer = null;
    this.observer = null;
    this.fallbackCheck = null;
    this.activeAbort = null;
  }

  attach(entry, container) {
    const previous = this.attachments.get(container);
    if (previous) this._detach(previous);
    const subscription = { entry, container, key: keyFor(entry), generation: this.generation };
    this.attachments.set(container, subscription);
    container.classList.add('editor-asset-thumbnail', 'editor-asset-thumbnail--' + (entry.kind || 'other'));
    this._fallback(subscription);
    const cached = this.cache.get(subscription.key);
    if (cached) {
      subscription.requested = true;
      this.cache.delete(subscription.key);
      this.cache.set(subscription.key, cached);
      this._mount(subscription, cached);
    } else {
      this._observe();
      if (this.observer) this.observer.observe(container);
      else this._checkVisibility();
    }
    return () => this._detach(subscription);
  }

  reset() {
    this.generation++;
    if (this.observer) this.observer.disconnect();
    this.observer = null;
    if (this.fallbackCheck) {
      if (this.rootElement) this.rootElement.removeEventListener('scroll', this.fallbackCheck);
      if (typeof window !== 'undefined') window.removeEventListener('resize', this.fallbackCheck);
      this.fallbackCheck = null;
    }
    this.attachments.forEach(subscription => this._release(subscription));
    this.attachments.clear();
    this.jobs.clear();
    this.queue.length = 0;
    if (this.activeAbort) this.activeAbort.abort();
  }

  dispose() {
    this.reset();
    this.cache.clear();
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
      this.renderer = null;
    }
  }

  _observe() {
    if (this.observer || this.fallbackCheck) return;
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(entries => {
        entries.forEach(item => {
          if (!item.isIntersecting) return;
          const subscription = this.attachments.get(item.target);
          if (subscription) this._enqueue(subscription);
        });
      }, { root: this.rootElement || null, rootMargin: '0px', threshold: 0 });
    } else {
      this.fallbackCheck = () => this._checkVisibility();
      if (this.rootElement) this.rootElement.addEventListener('scroll', this.fallbackCheck, { passive: true });
      if (typeof window !== 'undefined') window.addEventListener('resize', this.fallbackCheck, { passive: true });
    }
  }

  _checkVisibility() {
    const root = this.rootElement && this.rootElement.getBoundingClientRect ? this.rootElement.getBoundingClientRect() : {
      top: 0, left: 0, bottom: typeof window !== 'undefined' ? window.innerHeight : Infinity,
      right: typeof window !== 'undefined' ? window.innerWidth : Infinity
    };
    this.attachments.forEach(subscription => {
      if (subscription.requested) return;
      const node = subscription.container;
      const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : root;
      if (rect.bottom > root.top && rect.top < root.bottom && rect.right > root.left && rect.left < root.right) this._enqueue(subscription);
    });
  }

  _alive(subscription) {
    return subscription.generation === this.generation && this.attachments.get(subscription.container) === subscription;
  }

  _release(subscription) {
    if (subscription.cleanup) subscription.cleanup();
    subscription.cleanup = null;
  }

  _detach(subscription) {
    this._release(subscription);
    if (this.attachments.get(subscription.container) === subscription) this.attachments.delete(subscription.container);
    if (this.observer) this.observer.unobserve(subscription.container);
  }

  _fallback(subscription, failed = false) {
    const { container, entry } = subscription;
    container.textContent = '';
    container.dataset.thumbnailState = failed ? 'error' : 'idle';
    const icon = document.createElement('span');
    icon.className = 'editor-asset-thumbnail-type';
    icon.textContent = TYPE_ICONS[entry.kind] || TYPE_ICONS.other;
    icon.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span');
    caption.className = 'editor-asset-thumbnail-caption';
    caption.textContent = TYPE_LABELS[entry.kind] || TYPE_LABELS.other;
    container.appendChild(icon);
    container.appendChild(caption);
    if (failed) container.title = 'No se pudo generar la miniatura. Selecciona el archivo para ver sus detalles.';
  }

  _enqueue(subscription) {
    if (!this._alive(subscription) || subscription.requested) return;
    subscription.requested = true;
    if (this.observer) this.observer.unobserve(subscription.container);
    subscription.container.dataset.thumbnailState = 'loading';
    let job = this.jobs.get(subscription.key);
    if (!job) {
      job = { entry: subscription.entry, key: subscription.key, generation: this.generation, subscribers: [] };
      this.jobs.set(job.key, job);
      this.queue.push(job);
    }
    job.subscribers.push(subscription);
    this._drain();
  }

  async _drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        if (job.generation !== this.generation || !job.subscribers.some(subscription => this._alive(subscription))) continue;
        let result;
        try { result = await this._generate(job.entry, job.generation); }
        catch (error) { result = { failed: true }; }
        if (job.generation !== this.generation) continue;
        this.jobs.delete(job.key);
        this.cache.set(job.key, result);
        while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
        job.subscribers.forEach(subscription => { if (this._alive(subscription)) this._mount(subscription, result); });
      }
    } finally {
      this.running = false;
    }
  }

  _mount(subscription, result) {
    if (!this._alive(subscription)) return;
    const { container, entry } = subscription;
    this._release(subscription);
    if (result.failed) { this._fallback(subscription, true); return; }
    if (result.src) {
      const image = document.createElement('img');
      image.className = 'editor-asset-thumbnail-image';
      image.alt = 'Vista previa de ' + entry.name;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.draggable = false;
      image.onload = () => { if (this._alive(subscription)) container.dataset.thumbnailState = 'ready'; };
      image.onerror = () => {
        if (this._alive(subscription)) {
          this._fallback(subscription, true);
          this.cache.delete(subscription.key);
        }
      };
      container.textContent = '';
      container.appendChild(image);
      subscription.cleanup = () => {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
      };
      image.src = result.src;
      container.dataset.thumbnailState = 'ready';
    } else if (result.text) {
      container.textContent = '';
      const code = document.createElement('pre');
      code.className = 'editor-asset-thumbnail-code';
      code.textContent = result.text;
      code.setAttribute('aria-hidden', 'true');
      container.appendChild(code);
      container.dataset.thumbnailState = 'ready';
    } else {
      this._fallback(subscription);
      container.dataset.thumbnailState = 'ready';
    }
  }

  async _generate(entry, generation) {
    if (entry.thumbnailPath) return { src: this.library.getURL({ path: entry.thumbnailPath }) };
    if (entry.kind === 'image' && entry.extension !== 'basis') return { src: this.library.getURL(entry) };
    if (entry.kind === 'model' || entry.previewPath) return this._model(entry, generation);
    if (entry.kind === 'image' && entry.extension === 'basis') return this._basis(entry, generation);
    if (entry.kind === 'text') return this._text(entry);
    // Audio and video keep a distinctive, silent type card. Selecting them opens
    // the existing controlled media preview; listing files never starts playback.
    return {};
  }

  _getRenderer() {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(WIDTH, HEIGHT, false);
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    return this.renderer;
  }

  async _model(entry, generation) {
    const descriptor = entry.previewPath ? { path: entry.previewPath } : { importId: entry.importId || entry.id, path: entry.path };
    const object = await this.library.instantiate(descriptor, {preview: true});
    try {
      if (generation !== this.generation) return {};
      const renderer = this._getRenderer();
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1c2636);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x60708a, 1.5));
      const light = new THREE.DirectionalLight(0xffffff, 1.4);
      light.position.set(4, 8, 6);
      scene.add(light);
      scene.add(object);
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) throw new Error('El modelo no tiene geometría visible.');
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.01);
      const camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, Math.max(radius / 1000, 0.0001), radius * 100 + 100);
      camera.position.copy(center).add(new THREE.Vector3(1.2, 0.8, 1.5).normalize().multiplyScalar(radius * 3.5));
      camera.lookAt(center);
      renderer.render(scene, camera);
      return { src: renderer.domElement.toDataURL('image/png') };
    } finally {
      if (object.parent) object.parent.remove(object);
      disposeObject(object);
    }
  }

  async _basis(entry, generation) {
    const renderer = this._getRenderer();
    const loader = new BasisTextureLoader(this.library.managerFor(entry)).setTranscoderPath("packages/render-three/vendor/").setWorkerLimit(1);
    let texture;
    let material;
    let geometry;
    try {
      loader.detectSupport(renderer);
      texture = await new Promise((resolve, reject) => loader.load(this.library.getURL(entry), resolve, undefined, reject));
      if (generation !== this.generation) return {};
      texture.encoding = THREE.sRGBEncoding;
      texture.needsUpdate = true;
      const image = texture.image || {};
      const aspect = Math.max((image.width || 1) / (image.height || 1), 0.0001);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1c2636);
      geometry = new THREE.PlaneBufferGeometry(Math.min(2, 2 * aspect / (WIDTH / HEIGHT)), Math.min(2, 2 * (WIDTH / HEIGHT) / aspect));
      material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
      scene.add(new THREE.Mesh(geometry, material));
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
      camera.position.z = 1;
      renderer.render(scene, camera);
      return { src: renderer.domElement.toDataURL('image/png') };
    } finally {
      if (geometry) geometry.dispose();
      if (material) material.dispose();
      if (texture) texture.dispose();
      loader.dispose();
    }
  }

  async _text(entry) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    this.activeAbort = controller;
    const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null;
    try {
      const response = await fetch(this.library.getURL(entry), {
        credentials: 'same-origin', headers: { Range: 'bytes=0-4095' }, signal: controller ? controller.signal : undefined
      });
      if (!response.ok) throw new Error('No se pudo leer el texto.');
      let text = '';
      if (response.body && response.body.getReader && typeof TextDecoder !== 'undefined') {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let remaining = 4096;
        try {
          while (remaining > 0) {
            const part = await reader.read();
            if (part.done) break;
            const bytes = part.value.subarray(0, remaining);
            remaining -= bytes.length;
            text += decoder.decode(bytes, { stream: remaining > 0 });
          }
        } finally { await reader.cancel(); }
      } else if (Number(entry.size) <= 65536) {
        text = (await response.text()).slice(0, 4096);
      }
      return { text: text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 1600) };
    } finally {
      if (timeout) clearTimeout(timeout);
      if (this.activeAbort === controller) this.activeAbort = null;
    }
  }
}
