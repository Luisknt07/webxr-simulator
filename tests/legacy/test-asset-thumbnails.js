const __layout = require("../../tooling/layout.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');

class Element {
  constructor() { this.children = []; this.dataset = {}; this.classList = { add() {} }; this.rect = { top: 0, left: 0, right: 100, bottom: 100 }; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute() {}
  removeAttribute(name) { delete this[name]; }
  addEventListener() {}
  removeEventListener() {}
  getBoundingClientRect() { return this.rect; }
}
const observers = [];
class IntersectionObserver {
  constructor(callback, options) { this.callback = callback; this.options = options; this.items = new Set(); observers.push(this); }
  observe(node) { this.items.add(node); }
  unobserve(node) { this.items.delete(node); }
  disconnect() { this.items.clear(); }
  show(node) { this.callback([{ target: node, isIntersecting: true }]); }
}
const renderers = [];
class Renderer {
  constructor() { this.domElement = { toDataURL: () => 'data:image/png;base64,dGh1bWJuYWls' }; this.rendered = 0; renderers.push(this); }
  setPixelRatio(value) { assert.equal(value, 1); }
  setSize(width, height) { assert.equal(width, 192); assert.equal(height, 128); }
  render(scene, camera) { assert(scene.isScene); assert(camera.isCamera); this.rendered++; }
  dispose() { this.disposed = true; }
  forceContextLoss() { this.lost = true; }
}
const basisTextures = [];
let basisDisposed = 0;
class BasisTextureLoader {
  setTranscoderPath(value) { assert.equal(value, "packages/render-three/vendor/"); return this; }
  setWorkerLimit(value) { assert.equal(value, 1); return this; }
  detectSupport(renderer) { assert(renderer); return this; }
  load(url, resolve) {
    const texture = new THREE.Texture({ width: 512, height: 256 });
    texture.addEventListener('dispose', () => { texture.disposed = true; });
    basisTextures.push(texture);
    resolve(texture);
  }
  dispose() { basisDisposed++; }
}
const source = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-asset-thumbnails.js"), '../src/editor/AssetThumbnails.js')), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class AssetThumbnails', 'class AssetThumbnails');
function load(Observer) {
  if (!arguments.length) Observer = IntersectionObserver;
  return new Function('THREE', 'BasisTextureLoader', 'document', 'IntersectionObserver', 'window', source + '\nreturn AssetThumbnails;')(
    Object.assign({}, THREE, { WebGLRenderer: Renderer }), BasisTextureLoader,
    { createElement: () => new Element() }, Observer,
    { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} }
  );
}
function entry(path, kind, extra = {}) { return Object.assign({ path, name: path.split('/').pop(), kind, extension: path.split('.').pop(), size: 100 }, extra); }
async function idle(thumbnails) { for (let i = 0; thumbnails.running && i < 100; i++) await new Promise(resolve => setImmediate(resolve)); assert.equal(thumbnails.running, false); }
function visible(node) { observers[observers.length - 1].show(node); }

async function run() {
  let loads = 0;
  let active = 0;
  let maxActive = 0;
  const resources = [];
  const library = {
    getURL: descriptor => '/assets/' + descriptor.path,
    managerFor: () => ({}),
    async instantiate(descriptor) {
      assert(!/\.blend$/.test(descriptor.path), 'Do not download Blender source for a thumbnail.');
      loads++; active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setImmediate(resolve));
      active--;
      const texture = new THREE.Texture();
      const material = new THREE.MeshBasicMaterial({ map: texture });
      const geometry = new THREE.BoxBufferGeometry();
      const object = new THREE.Mesh(geometry, material);
      [texture, material, geometry].forEach(resource => resource.addEventListener('dispose', () => { resource.disposed = true; }));
      resources.push({ texture, material, geometry });
      return object;
    }
  };
  const AssetThumbnails = load();
  const root = new Element();
  const thumbnails = new AssetThumbnails(library, root);
  const modelA = new Element();
  const modelB = new Element();
  thumbnails.attach(entry('a.glb', 'model'), modelA);
  thumbnails.attach(entry('b.glb', 'model'), modelB);
  assert.equal(loads, 0, 'Off-screen files do not load models.');
  assert.equal(observers[0].options.root, root);
  visible(modelA); visible(modelB);
  await idle(thumbnails);
  assert.equal(loads, 2);
  assert.equal(maxActive, 1, 'Only one model may load/render at a time.');
  assert.equal(renderers.length, 1, 'All thumbnails share one renderer.');
  assert.equal(renderers[0].rendered, 2);
  assert.equal(modelA.children[0].src, 'data:image/png;base64,dGh1bWJuYWls');
  resources.forEach(group => Object.values(group).forEach(resource => assert(resource.disposed, 'Private preview resources are released.')));

  const basis = new Element();
  thumbnails.attach(entry('a.basis', 'image'), basis); visible(basis); await idle(thumbnails);
  assert.equal(renderers.length, 1, 'Basis reuses the model renderer.');
  assert.equal(basisDisposed, 1);
  assert(basisTextures[0].disposed);
  assert.equal(basis.children[0].src, 'data:image/png;base64,dGh1bWJuYWls');

  const image = new Element();
  thumbnails.attach(entry('photo.png', 'image'), image); visible(image); await idle(thumbnails);
  assert.equal(image.children[0].src, '/assets/photo.png');
  image.children[0].onerror();
  assert.equal(image.dataset.thumbnailState, 'error', 'Broken images leave a usable type card.');
  assert.equal(image.children[1].textContent, 'IMAGEN');

  const blend = new Element();
  thumbnails.attach(entry('blender/a.blend', 'source', { thumbnailPath: 'editor-previews/a.png', previewPath: 'a.glb' }), blend);
  visible(blend); await idle(thumbnails);
  assert.equal(blend.children[0].src, '/assets/editor-previews/a.png');
  assert.equal(loads, 2, 'Embedded Blender thumbnails avoid loading the source/model.');
  for (const kind of ['audio', 'video', 'source', 'other']) {
    const node = new Element();
    thumbnails.attach(entry('file.' + kind, kind), node); visible(node); await idle(thumbnails);
    assert.equal(node.dataset.thumbnailState, 'ready');
    assert.equal(node.children.length, 2);
  }
  assert.equal(loads, 2);

  const fetchBefore = global.fetch;
  let cancelled = false;
  let reads = 0;
  global.fetch = async (url, options) => {
    assert.equal(options.headers.Range, 'bytes=0-4095');
    return { ok: true, body: { getReader() { return {
      async read() { reads++; return { done: false, value: new TextEncoder().encode('<script>literal</script>\n' + 'x'.repeat(10000)) }; },
      async cancel() { cancelled = true; }
    }; } } };
  };
  const text = new Element();
  thumbnails.attach(entry('note.md', 'text'), text); visible(text); await idle(thumbnails);
  global.fetch = fetchBefore;
  assert.equal(reads, 1);
  assert(cancelled, 'Text streaming stops once the bounded snippet has arrived.');
  assert(text.children[0].textContent.startsWith('<script>literal</script>'));
  assert.equal(text.children[0].textContent.length, 1600);

  const cachedCount = thumbnails.cache.size;
  thumbnails.reset();
  assert.equal(thumbnails.cache.size, cachedCount);
  const cachedModel = new Element();
  thumbnails.attach(entry('a.glb', 'model'), cachedModel);
  assert.equal(cachedModel.children[0].src, 'data:image/png;base64,dGh1bWJuYWls');
  assert.equal(loads, 2, 'Rebuilding the list uses cached thumbnails.');
  assert.equal(renderers[0].disposed, undefined);
  thumbnails.dispose();
  assert.equal(thumbnails.cache.size, 0);
  assert(renderers[0].disposed && renderers[0].lost, 'Leaving the editor releases its extra WebGL context.');

  const afterDispose = new Element();
  thumbnails.attach(entry('c.glb', 'model'), afterDispose); visible(afterDispose); await idle(thumbnails);
  assert.equal(loads, 3, 'The instance can be reused after dispose.');
  assert.equal(renderers.length, 2);

  let release;
  library.instantiate = () => new Promise(resolve => { release = resolve; });
  const stale = new Element();
  thumbnails.attach(entry('delayed.glb', 'model'), stale); visible(stale);
  const lateGeometry = new THREE.BoxBufferGeometry();
  let lateDisposed = false;
  lateGeometry.addEventListener('dispose', () => { lateDisposed = true; });
  thumbnails.dispose();
  release(new THREE.Mesh(lateGeometry, new THREE.MeshBasicMaterial()));
  await idle(thumbnails);
  assert(lateDisposed, 'A model completed after close is released without touching the old card.');
  assert.equal(stale.children[0].src, undefined);

  const FallbackThumbnails = load(undefined);
  const fallback = new FallbackThumbnails(library, root);
  const hidden = new Element(); hidden.rect = { top: 200, bottom: 300, left: 0, right: 100 };
  const shown = new Element();
  fallback.attach(entry('hidden.png', 'image'), hidden);
  fallback.attach(entry('shown.png', 'image'), shown);
  await idle(fallback);
  assert.equal(hidden.dataset.thumbnailState, 'idle', 'The non-Observer fallback also respects the visible viewport.');
  assert.equal(shown.children[0].src, '/assets/shown.png');
  fallback.dispose();
  console.log('Asset thumbnails: lazy loading, private resources, one renderer, cache, source images, bounded text and lifecycle passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
