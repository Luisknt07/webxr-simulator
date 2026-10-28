// Real r112 materials, factories, scene documents and decal geometry. Only image
// decoding and Canvas2D drawing are adapted; no GPU or network is required.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const THREE = require('three'), pbr = require('../shared/industrial-pbr');
const materialSchema = require('../shared/materials'), behaviorSchema = require('../shared/behaviors');
const rootPath = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(rootPath, file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function canvasDocument() {
  const canvases = [];
  return {canvases, createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = {width: 0, height: 0, operations: []}, stack = []; let x = 0, y = 0;
    const context = new Proxy({
      save() { stack.push([x, y]); }, restore() { [x, y] = stack.pop(); }, translate(a, b) { x += a; y += b; },
      fillRect(a, b, w, h) { canvas.operations.push({kind: 'rect', x: a + x, y: b + y, w, h, color: this.fillStyle}); },
      fillText(text, a, b) { canvas.operations.push({kind: 'text', text, x: a + x, y: b + y}); },
      measureText(text) { return {width: String(text).length * 12}; }
    }, {get(target, key) { return key in target ? target[key] : () => {}; }});
    canvas.getContext = () => context; canvases.push(canvas); return canvas;
  }};
}
const dom = canvasDocument();
const atlasAPI = new Function('THREE', 'document', source('src/editor/IndustrialStickerAtlas.js') + '\nreturn {makeStickerAtlas,stickerTile};')(THREE, dom);
const poolCode = source('src/editor/IndustrialPBRTextures.js').replace('default class IndustrialPBRTextures', 'return class IndustrialPBRTextures');
const Pool = new Function('THREE', 'pbr', poolCode)(THREE, pbr);
const decalCode = fs.readFileSync(path.join(rootPath, 'node_modules/three/examples/jsm/geometries/DecalGeometry.js'), 'utf8')
  .replace(/import \{[\s\S]*?\} from "[^"]+";/, '').replace('export { DecalGeometry, DecalVertex };', 'return DecalGeometry;');
const DecalGeometry = new Function('BufferGeometry', 'Float32BufferAttribute', 'Matrix4', 'Vector3', decalCode)(THREE.BufferGeometry, THREE.Float32BufferAttribute, THREE.Matrix4, THREE.Vector3);
const Finish = new Function('THREE', 'DecalGeometry', 'pbr', 'IndustrialPBRTextures', 'makeStickerAtlas', 'stickerTile', source('src/editor/IndustrialFinishSystem.js').replace('default class IndustrialFinishSystem', 'return class IndustrialFinishSystem'))
  (THREE, DecalGeometry, pbr, Pool, atlasAPI.makeStickerAtlas, atlasAPI.stickerTile);
const Surface = new Function('THREE', 'materialSchema', source('src/editor/SurfaceMaterialSystem.js').replace('default class SurfaceMaterialSystem', 'return class SurfaceMaterialSystem'))(THREE, materialSchema);
const dependencies = require('./load-robot-prefabs')(THREE);
const factory = new Function('THREE', 'behaviorSchema', 'require', source('src/editor/IndustrialPrefabs.js') + '\nreturn createIndustrialPrefab;')(THREE, behaviorSchema, dependencies.resolve);
const cad = require('../shared/cad');
const Document = new Function('THREE', 'behaviorSchema', 'createIndustrialPrefab', 'require', source('src/editor/SceneDocument.js').replace('default class SceneDocument', 'return class SceneDocument'))(THREE, behaviorSchema, factory, id => { assert.equal(id, '../../shared/cad'); return cad; });
const {getGeometryTree} = require('./load-geometry-acceleration')(THREE);
const CollisionWorld = new Function('THREE', 'getGeometryTree', source('src/lib/CollisionWorld.js').replace('default class CollisionWorld', 'return class CollisionWorld'))(THREE, getGeometryTree);
function context(tier = 'balanced', textureEdge = 1024) { const limits = {tier, textureEdge}; return {limits, graphics: {getLimits: () => limits}, renderer: {capabilities: {getMaxAnisotropy: () => 8}}, raycontrol: {states: {}}, vrMode: false}; }
const instant = url => Promise.resolve({src: url, width: Number(url.match(/-(\d+)\.jpg$/)[1]), height: Number(url.match(/-(\d+)\.jpg$/)[1])});
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const disposed = value => { let count = 0; value.addEventListener('dispose', () => count++); return () => count; };
const materials = object => { const values = new Set(); object.traverse(n => { if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => values.add(m)); }); return Array.from(values); };
const settle = async (system, room = 'hall') => { system.sync(room, .5); await Promise.all(Array.from(system.store.entries.values(), e => e.ready)); system.sync(room, .5); };
const setup = () => { const doc = new Document({}); doc.registerRoom('hall', new THREE.Group()); doc.registerRoom('sound', new THREE.Group()); return doc; };
function jpegSize(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8); assert.equal(bytes.readUInt16BE(bytes.length - 2), 0xffd9);
  let offset = 2;
  while (offset < bytes.length) {
    assert.equal(bytes[offset++], 0xff); while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++]; if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    assert(length >= 2); offset += length;
  }
  throw Error('JPEG missing SOF dimensions.');
}
function box(name, role = 'steel') {
  const material = new THREE.MeshStandardMaterial({color: '#8797a1', metalness: role === 'steel' ? .9 : .12, roughness: .5});
  material.name = role; material.userData.industrialMaterialRole = role;
  const result = new THREE.Mesh(new THREE.BoxBufferGeometry(), material); result.name = name; return result;
}
function stickerFixture() {
  const ctx = context(), doc = setup(), owner = new THREE.Group(), host = box('Housing');
  owner.userData.editorPrefabKey = 'control'; owner.add(host); doc.getRoot('hall').add(owner);
  owner.position.set(2, 1, -3); owner.rotation.set(.2, .5, -.1); owner.scale.set(1.4, .8, 1.1);
  owner.userData.industrialStickerAnchors = [{id: 'equipment-id', position: [0, 0, .5], normal: [0, 0, 1], size: [.22, .14]}];
  return {ctx, doc, owner, host, system: new Finish(ctx, doc, {load: instant})};
}
const tests = [];
function test(name, run) { tests.push({name, run}); }

test('84 offline CC0 JPEG files: hashes, dimensions, licenses and safe manifest paths', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootPath, 'assets/materials/pbr/manifest.json'))), seen = new Set(); let bytes = 0;
  assert.equal(manifest.license, 'CC0-1.0'); assert.equal(manifest.assets.length, 7);
  const license = fs.readFileSync(path.join(rootPath, 'assets/materials/pbr/LICENSE.txt'), 'utf8');
  for (const item of manifest.assets) {
    const profile = pbr.PROFILES.find(value => value.id === item.key); assert(profile); assert.equal(item.source, profile.source);
    assert.equal(item.license, 'CC0-1.0'); assert(item.author && license.includes(item.author)); assert(license.includes(item.source));
    if (item.archive) assert(/^[a-f0-9]{64}$/.test(item.archive.sha256));
    else ['color', 'normal', 'roughness'].forEach(channel => assert(/^[a-f0-9]{64}$/.test(item.maps[channel].sourceSha256)));
    for (const edge of [256, 512, 1024]) for (const channel of ['color', 'neutral', 'normal', 'roughness']) {
      const record = item.variants[edge][channel], expected = pbr.path(item.key, channel, edge); assert.equal(record.path, expected);
      const absolute = path.resolve(rootPath, record.path); assert(absolute.startsWith(path.join(rootPath, 'assets/materials/pbr') + path.sep));
      const buffer = fs.readFileSync(absolute); assert.equal(buffer.length, record.bytes); bytes += buffer.length;
      assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), record.sha256); assert.deepEqual(jpegSize(buffer), [edge, edge]); seen.add(record.path);
    }
  }
  assert.equal(seen.size, 84); assert.equal(fs.readdirSync(path.join(rootPath, 'assets/materials/pbr')).filter(name => name.endsWith('.jpg')).length, 84);
  assert(bytes < 9 * 1024 * 1024); console.log('  Offline photographic download: ' + (bytes / 1024 / 1024).toFixed(2) + ' MiB; no runtime network dependency.');
  for (const bad of [['unknown', 'normal', 512], ['steel', 'secret', 512], ['steel', 'color', 2048], ['../steel', 'normal', 256]]) assert.throws(() => pbr.path(...bad));
});

test('adaptive shared pool: tiers, XR limits, correct color space and bounded ownership', async () => {
  const ctx = context(), requested = [], pool = new Pool(ctx, null, {load: url => { requested.push(url); return instant(url); }});
  for (const [tier, limit, vr, edge] of [['economy', 1024, false, 256], ['balanced', 1024, false, 512], ['high', 1024, false, 1024], ['ultra', 2048, false, 1024], ['high', 1024, true, 512], ['high', 256, true, 256]]) {
    ctx.limits.tier = tier; ctx.limits.textureEdge = limit; ctx.vrMode = vr; assert.equal(pool.edge(), edge);
  }
  ctx.limits.tier = 'balanced'; ctx.limits.textureEdge = 1024; ctx.vrMode = false;
  const a = pool.acquire('steel'), b = pool.acquire('steel'); assert.strictEqual(a, b); await a.ready; assert.equal(requested.length, 3);
  for (const [channel, texture] of Object.entries(a.textures)) {
    assert.equal(texture.encoding, channel === 'neutral' ? THREE.sRGBEncoding : THREE.LinearEncoding);
    assert.equal(texture.wrapS, THREE.RepeatWrapping); assert.equal(texture.wrapT, THREE.RepeatWrapping); assert.equal(texture.anisotropy, 4);
    assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter); assert(texture.generateMipmaps); assert(texture.userData.sharedIndustrialTexture);
  }
  assert.equal(pool.stats().estimatedGPUBytes, 512 * 512 * 16); assert.equal(pool.stats().textures, 3);
  const counts = Object.values(a.textures).map(disposed); pool.prune(new Set()); counts.forEach(count => assert.equal(count(), 1));
  // r112's wrappers can still reference the texture for a render in flight.
  // Dispose the GPU owner; keep valid pixel data until the last JS reference is
  // collected rather than making a retained Texture crash safeSetTexture2D.
  Object.values(a.textures).forEach(texture => assert.equal(texture.image.width, 512)); assert.equal(pool.entries.size, 0);
  pool.dispose(); counts.forEach(count => assert.equal(count(), 1));
});

test('asynchronous prune/reacquire and dispose reject stale completion and stale errors', async () => {
  const requests = [], ctx = context(); let changes = 0;
  const pool = new Pool(ctx, () => changes++, {load: (url, signal) => { const request = deferred(); requests.push(Object.assign(request, {url, signal})); return request.promise; }});
  const old = pool.acquire('steel'); pool.prune(new Set()); assert(requests.every(request => request.signal.aborted));
  const next = pool.acquire('steel'); requests.slice(0, 3).forEach(request => request.reject(Error('stale abort'))); await old.ready;
  assert.equal(changes, 0); assert.equal(pool.stats().failures, 0); assert(next.pending);
  requests.slice(3, 6).forEach(request => request.resolve({width: 512, height: 512})); await next.ready;
  assert.equal(changes, 1); assert(next.textures); assert.strictEqual(pool.entries.get('steel:512'), next);
  const pending = pool.acquire('wood'); pool.dispose(); requests.slice(6).forEach(request => request.resolve({width: 512, height: 512})); await pending.ready;
  assert.equal(pool.entries.size, 0); assert.equal(changes, 1); assert.equal(pending.textures, null);
});

test('browser Image loader completes and cancels without retained handlers', async () => {
  const images = [];
  class FakeImage { constructor() { this.width = this.height = 512; images.push(this); } set src(value) { this.url = value; } get src() { return this.url; } }
  const ImagePool = new Function('THREE', 'pbr', 'Image', poolCode)(THREE, pbr, FakeImage), pool = new ImagePool(context());
  const entry = pool.acquire('paint'); images.forEach(image => image.onload()); await entry.ready;
  assert(images.every(image => image.onload === null && image.onerror === null)); assert(entry.textures);
  pool.acquire('wood'); pool.prune(new Set(['paint:512'])); await Promise.all(Array.from(pool.entries.values(), item => item.ready));
  assert(images.slice(3).every(image => image.url === '' && image.onload === null && image.onerror === null)); pool.dispose();
});

test('actual vehicle roles are deterministic; unrelated part names cannot tint shared materials', async () => {
  const doc = setup(), vehicle = doc.addPrefab('hall', 'vehicle', 'forklift-electric-4w'), ctx = context();
  const system = new Finish(ctx, doc, {load: instant}); await settle(system);
  const expected = {steel: 'steel', frame: 'paint', accent: 'paint', rubber: 'rubber', seat: 'vinyl'}; let checked = 0;
  vehicle.traverse(mesh => {
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const role = material.userData.industrialMaterialRole;
      if (expected[role] && material.userData.industrialPhotographicDefault) {
        const classification = pbr.classify(material, mesh);
        // Label holders can intentionally be excluded by their descriptive name;
        // they still share the role material with the rest of the real chassis.
        if (classification) assert.equal(classification, expected[role], role + ' / ' + mesh.name);
        assert.equal(material.userData.industrialPhotographicDefault, expected[role]); checked++;
      }
    }
  });
  assert(checked > 30); assert(system.store.entries.size <= 4);
  const shared = new Map(); materials(vehicle).filter(m => m.normalMap && m.normalMap.userData.industrialPhotographicKey).forEach(m => {
    const id = m.normalMap.userData.industrialPhotographicKey; if (shared.has(id)) assert.strictEqual(m.normalMap, shared.get(id)); else shared.set(id, m.normalMap);
  });
  assert(shared.size >= 3); assert.equal(system.getStats().textures, shared.size * 3); system.dispose();
});

test('active-room and tier switches restore originals and release only derived texture owners', async () => {
  const ctx = context(), doc = setup(), a = doc.addPrefab('hall', 'vehicle', 'forklift-electric-4w');
  const b = doc.addPrefab('sound', 'vehicle', 'telehandler');
  const originals = new Map(materials(a).concat(materials(b)).map(m => [m, {map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, roughness: m.roughness, metalness: m.metalness, color: m.color.clone()}]));
  const system = new Finish(ctx, doc, {load: instant}); await settle(system);
  materials(b).forEach(m => assert.equal(m.userData.industrialPhotographicDefault, undefined));
  const prior = Array.from(system.store.entries.values()).flatMap(e => Object.values(e.textures || {})); const releases = prior.map(disposed);
  await settle(system, 'sound'); releases.forEach(count => assert.equal(count(), 1));
  materials(a).forEach(m => { const old = originals.get(m); assert.strictEqual(m.map, old.map); assert.strictEqual(m.normalMap, old.normalMap); assert.strictEqual(m.roughnessMap, old.roughnessMap); assert.equal(m.roughness, old.roughness); assert.equal(m.metalness, old.metalness); assert(m.color.equals(old.color)); });
  ctx.limits.tier = 'economy'; await settle(system, 'sound'); assert(Array.from(system.store.entries.keys()).every(key => key.endsWith(':256')));
  ctx.vrMode = true; ctx.limits.tier = 'high'; await settle(system, 'sound'); assert(Array.from(system.store.entries.keys()).every(key => key.endsWith(':512')));
  system.dispose(); assert.equal(system.bindings.size, 0); assert.equal(system.store.entries.size, 0);
});

test('native maps and moving UVs survive defaults, authored per-part PBR survives later sync', async () => {
  const doc = setup(), owner = new THREE.Group(); owner.userData.editorPrefabKey = 'conveyor'; doc.getRoot('hall').add(owner);
  const moving = box('Rodillos'), stationary = box('Carcasa', 'accent'), untouched = box('Perno'); owner.add(moving, stationary, untouched);
  const rollMap = new THREE.DataTexture(new Uint8Array([230, 230, 230, 255]), 1, 1); rollMap.offset.set(.2, .3); rollMap.repeat.set(3, 1);
  moving.userData.industrialRoller = true; moving.material.map = rollMap;
  const authoredNormal = new THREE.Texture({width: 4, height: 4}), authoredRough = new THREE.Texture({width: 4, height: 4});
  stationary.material.normalMap = authoredNormal; stationary.material.roughnessMap = authoredRough;
  const finish = new Finish(context(), doc, {load: instant}); await settle(finish);
  assert.strictEqual(moving.material.map, rollMap); assert.deepEqual(rollMap.offset.toArray(), [.2, .3]); assert.deepEqual(rollMap.repeat.toArray(), [3, 1]);
  assert.strictEqual(stationary.material.normalMap, authoredNormal); assert.strictEqual(stationary.material.roughnessMap, authoredRough);
  const original = untouched.material; owner.userData.editorBehaviors = [materialSchema.normalizeMaterial({preset: 'photo-wood', slot: 'part:Perno'})];
  const library = {async instantiate(asset) { const map = new THREE.Texture({width: 512, height: 512, src: asset.path}); map.encoding = THREE.sRGBEncoding; return new THREE.Mesh(new THREE.PlaneBufferGeometry(), new THREE.MeshBasicMaterial({map})); }};
  const surface = new Surface({}, {getRoot: () => doc.getRoot('hall'), getObjects: () => [owner]}, library);
  await surface.sync('hall'); const custom = untouched.material; assert.notStrictEqual(custom, original); assert(custom.userData.surfaceMaterialBinding);
  const maps = [custom.map, custom.normalMap, custom.roughnessMap], counts = maps.map(disposed);
  await settle(finish); assert.strictEqual(untouched.material, custom); assert.deepEqual([custom.map, custom.normalMap, custom.roughnessMap], maps);
  assert.equal(custom.normalScale.x, pbr.PROFILES.find(p => p.id === 'wood').normalStrength); assert.equal(custom.normalMap.encoding, THREE.LinearEncoding); assert.equal(custom.map.encoding, THREE.sRGBEncoding);
  finish.dispose(); counts.forEach(count => assert.equal(count(), 0)); assert.deepEqual([custom.map, custom.normalMap, custom.roughnessMap], maps); surface.dispose(); counts.forEach(count => assert.equal(count(), 1));
});

test('real rolling wrappers survive prune and switch every inherited photographic channel to the new tier', async () => {
  const doc = setup(), actor = doc.addPrefab('hall', 'conveyor'), ctx = context();
  const finish = new Finish(ctx, doc, {load: instant}); await settle(finish);
  const Visuals = new Function('THREE', 'RollerInstanceBatches', source('src/editor/IndustrialVisuals.js').replace('default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE, require('./load-roller-instance-batches')(THREE));
  const visuals = new Visuals(ctx, doc, {running: false, records: new Map()}); visuals.sync('hall', 0, true); await settle(finish);
  const wrappers = []; actor.traverse(mesh => {if (mesh.userData.industrialRoller && mesh.material.normalMap) wrappers.push(mesh.material);}); assert(wrappers.length > 0);
  const retained = wrappers[0].normalMap, release = disposed(retained); await settle(finish, 'sound'); assert.equal(release(), 1); assert(retained.image && retained.image.width === 512);
  ctx.limits.tier = 'economy'; await settle(finish, 'hall'); visuals.sync('hall', 0, true); await settle(finish, 'hall');
  actor.traverse(mesh => {if (!mesh.material) return; for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) for (const field of ['map', 'normalMap', 'roughnessMap']) {
    const map = material[field]; if (map && map.userData && map.userData.industrialPhotographicKey) assert(map.userData.industrialPhotographicKey.endsWith(':256'), 'No inherited photographic wrapper can retain a larger abandoned tier.');
  }});
  visuals.dispose(); finish.dispose();
});

// Headless render-consumption check: inspect exactly the textures a visible
// Three.js scene would submit on each intervening frame. A real renderer can
// upload a disposed Texture again, so every borrowed map must still have its
// pool owner until the final frame that uses it.
function renderBorrowedMaps(root, system) {
  let rendered = 0;
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    for (let node = mesh; node; node = node.parent) if (!node.visible) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) for (const field of ['map', 'normalMap', 'roughnessMap', 'bumpMap']) {
      const texture = material[field], key = texture && texture.userData && texture.userData.industrialPhotographicKey;
      if (key) { assert(system.store.entries.has(key), 'Rendered ' + key + ' must retain its owning pool entry.'); assert(texture.image && texture.image.width > 0); rendered++; }
    }
  });
  assert(rendered > 0); return rendered;
}

test('deferred and failed tier replacement keeps every rendered GPU owner until substitution', async () => {
  const ctx = context(), doc = setup(); doc.addPrefab('hall', 'vehicle', 'forklift-electric-4w');
  const requests = [], finish = new Finish(ctx, doc, {load: url => {
    if (!url.endsWith('-256.jpg')) return instant(url);
    const ticket = deferred(); requests.push(ticket); return ticket.promise;
  }});
  await settle(finish);
  const oldEntries = Array.from(finish.store.entries.values()), releases = oldEntries.flatMap(entry => Object.values(entry.textures)).map(disposed);
  ctx.limits.tier = 'economy'; finish.sync('hall', .5);
  for (let frame = 0; frame < 5; frame++) { finish.sync('hall', .08); renderBorrowedMaps(doc.getRoot('hall'), finish); releases.forEach(count => assert.equal(count(), 0)); }
  const replacement = Array.from(finish.store.entries.values()).filter(entry => entry.edge === 256);
  requests.forEach(request => request.reject(Error('temporary image decode failure'))); await Promise.all(replacement.map(entry => entry.ready));
  for (let frame = 0; frame < 5; frame++) { finish.sync('hall', .1); renderBorrowedMaps(doc.getRoot('hall'), finish); releases.forEach(count => assert.equal(count(), 0)); }
  ctx.limits.tier = 'high'; finish.sync('hall', .5); renderBorrowedMaps(doc.getRoot('hall'), finish);
  await Promise.all(Array.from(finish.store.entries.values(), entry => entry.ready)); finish.sync('hall', .5);
  renderBorrowedMaps(doc.getRoot('hall'), finish); releases.forEach(count => assert.equal(count(), 1));
  oldEntries.forEach(entry => assert(!finish.store.entries.has(entry.key))); finish.dispose(); releases.forEach(count => assert.equal(count(), 1));
});

test('real roller wrappers keep authored UVs and roughness stable across two deferred tier changes', async () => {
  const ctx = context(), doc = setup(), actor = doc.addPrefab('hall', 'conveyor'), requests = [];
  let delayed = false;
  const finish = new Finish(ctx, doc, {load: url => {
    if (!delayed) return instant(url);
    const ticket = deferred(); requests.push({ticket, url}); return ticket.promise;
  }});
  await settle(finish);
  const Visuals = new Function('THREE', 'RollerInstanceBatches', source('src/editor/IndustrialVisuals.js').replace('default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE, require('./load-roller-instance-batches')(THREE));
  const visuals = new Visuals(ctx, doc, {running: false, records: new Map()}); visuals.sync('hall', 0, true); await settle(finish);
  const rolling = []; actor.traverse(mesh => { if (mesh.userData.industrialRoller && mesh.material.normalMap) rolling.push(mesh.material); }); assert(rolling.length);
  const originals = new Map(rolling.map(material => [material, {map: material.map, roughness: material.roughness, base: material.userData.industrialPhotographicBase.roughness, offset: material.map.offset.toArray(), repeat: material.map.repeat.toArray()}]));
  delayed = true;
  for (const [tier, edge] of [['economy', 256], ['high', 1024]]) {
    ctx.limits.tier = tier; finish.sync('hall', .5);
    for (let frame = 0; frame < 4; frame++) { finish.sync('hall', .1); renderBorrowedMaps(doc.getRoot('hall'), finish); }
    const batch = requests.splice(0); assert(batch.length > 0);
    batch.forEach(({ticket, url}) => ticket.resolve({src: url, width: edge, height: edge})); await Promise.all(Array.from(finish.store.entries.values(), entry => entry.ready)); finish.sync('hall', .5);
    renderBorrowedMaps(doc.getRoot('hall'), finish);
    rolling.forEach(material => {
      const original = originals.get(material), binding = finish.bindings.get(material);
      assert.strictEqual(material.map, original.map, 'Rolling albedo keeps its independently animated texture.'); assert.equal(material.roughness, original.roughness, 'Roughness compensation is applied exactly once per tier.');
      assert.deepEqual(material.map.offset.toArray(), original.offset); assert.deepEqual(material.map.repeat.toArray(), original.repeat);
      assert.equal(material.normalMap.userData.industrialPhotographicKey.split(':')[1], String(edge));
      assert.equal(binding.original.normalMap, null); assert.equal(binding.original.roughnessMap, null); assert.equal(binding.original.roughness, original.base);
    });
  }
  finish.dispose(); rolling.forEach(material => {
    const original = originals.get(material); assert.equal(material.normalMap, null); assert.equal(material.roughnessMap, null); assert.equal(material.roughness, original.base); assert.strictEqual(material.map, original.map);
  }); visuals.dispose();
});

test('atlas tiles contain separate printed cells with correct CanvasTexture UV orientation', () => {
  const texture = atlasAPI.makeStickerAtlas(), canvas = texture.image;
  assert.equal(canvas.width, 1024); assert.equal(canvas.height, 512); assert(texture.flipY); assert.equal(texture.encoding, THREE.sRGBEncoding);
  const ids = ['equipment-id', 'warning-pinch', 'electrical', 'flow', 'grease', 'shipping', 'fragile', 'capacity'];
  ids.forEach((id, index) => {
    const tile = atlasAPI.stickerTile(id), x = index % 4 * 256, y = Math.floor(index / 4) * 256;
    assert.equal(tile.u * canvas.width, x); assert.equal((1 - tile.v - tile.h) * canvas.height, y);
    assert(canvas.operations.some(op => op.kind === 'rect' && op.x === x + 6 && op.y === y + 6 && op.w === 244 && op.h === 244));
    assert(canvas.operations.some(op => op.kind === 'text' && op.x >= x && op.x < x + 256 && op.y >= y && op.y < y + 256));
  }); texture.dispose();
});

test('projected labels remain on the exact transformed surface and create no collision or input state', async () => {
  const {ctx, doc, owner, host, system} = stickerFixture(); await settle(system);
  const entry = system.stickers.get(owner); assert.equal(entry.meshes.length, 1); const sticker = entry.meshes[0];
  assert.strictEqual(sticker.parent, host); assert(sticker.userData.editorRuntimeHelper); assert(sticker.userData.industrialFinishOverlay); assert.equal(sticker.castShadow, false);
  const world = new CollisionWorld(ctx, doc); assert.equal(world.physicalMesh(sticker), false); assert.deepEqual(ctx.raycontrol.states, {});
  const positions = sticker.geometry.attributes.position, normals = sticker.geometry.attributes.normal, uv = sticker.geometry.attributes.uv, tile = atlasAPI.stickerTile('equipment-id');
  for (let i = 0; i < positions.count; i++) {
    assert(Math.abs(positions.getZ(i) - .5) < 1e-6, 'Sticker does not float above its actual host face.');
    assert(new THREE.Vector3().fromBufferAttribute(normals, i).distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-5);
    assert(uv.getX(i) >= tile.u - 1e-7 && uv.getX(i) <= tile.u + tile.w + 1e-7); assert(uv.getY(i) >= tile.v - 1e-7 && uv.getY(i) <= tile.v + tile.h + 1e-7);
  }
  const geometry = sticker.geometry, count = disposed(geometry); owner.position.x += 2; system.sync('hall', .5); assert.strictEqual(system.stickers.get(owner).meshes[0].geometry, geometry);
  owner.visible = false; system.sync('hall', .5); assert.equal(count(), 1); assert.equal(sticker.parent, null); assert.equal(system.stickers.size, 0); system.dispose(); assert.equal(count(), 1);
});

test('a label reprojects after its host geometry is rebuilt under the same stable owner', async () => {
  const {doc, owner, host, system} = stickerFixture(); await settle(system);
  const previous = system.stickers.get(owner).meshes[0], count = disposed(previous.geometry), replacement = box('Replacement');
  owner.remove(host); owner.add(replacement); await settle(system);
  const current = system.stickers.get(owner).meshes[0]; assert(current && current !== previous); assert.strictEqual(current.parent, replacement); assert.equal(count(), 1); system.dispose();
});

test('the actual native ray filter ignores decorative stickers rather than replacing surface UVs', async () => {
  const {ctx, owner, system} = stickerFixture(); await settle(system);
  const RayControl = new Function('THREE', 'EventDispatcher', source('src/lib/RayControl.js').replace('default class RayControl', 'return class RayControl'))(THREE, class {});
  const sticker = system.stickers.get(owner).meshes[0], hit = {object: sticker, distance: 1, uv: new THREE.Vector2(.3, .4)};
  const filtered = RayControl.prototype.filterVisible.call({ctx}, [hit]);
  assert.equal(filtered.length, 0, 'Projected decoration must leave the real surface intersection and original UV coordinates available.'); system.dispose();
});

test('an initially unavailable target can acquire its decal after model loading', async () => {
  const {owner, host, system} = stickerFixture(); owner.remove(host); await settle(system); assert.equal(system.stickers.get(owner).meshes.length, 0);
  owner.add(host); await settle(system); assert.equal(system.stickers.get(owner).meshes.length, 1); system.dispose();
});

// This tiny DOM runs actual inspector handlers. It deliberately supplies no fake
// inspector implementation and retains full SceneDocument behavior validation.
function uiDocument() {
  return {createElement(tag) {
    return {tag, children: [], listeners: {}, attrs: {}, value: '', appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      addEventListener(type, callback) { (this.listeners[type] || (this.listeners[type] = [])).push(callback); }, setAttribute(key, value) { this.attrs[key] = value; },
      fire(type) { (this.listeners[type] || []).forEach(callback => callback({target: this})); }};
  }};
}
function inspectorFixture() {
  const ui = uiDocument(), Inspector = new Function('materialSchema', 'wearSchema', 'photographic', 'document', source('src/editor/MaterialInspector.js').replace('default class MaterialInspector', 'return class MaterialInspector'))(materialSchema, require('../shared/wear'), pbr, ui);
  const doc = setup(), actor = doc.addPrefab('hall', 'conveyor'), section = ui.createElement('section'), surface = new Surface({}, doc, {});
  const editor = {document: doc, materials: surface, entries: [], perform: callback => callback(), renderInspector() {}, toast() {}, section: () => ui.createElement('section'), field(parent, label, input) { parent.appendChild(input); return input; }};
  const inspector = new Inspector(editor); inspector.renderWear = () => {}; inspector.render(actor, section);
  const descendants = node => [node].concat(node.children.flatMap(descendants));
  return {doc, actor, surface, inspector, section, nodes: descendants(section)};
}
test('photo gallery modifies just the selected part, persists maps and keeps the rest intact', async () => {
  const {doc, actor, inspector, nodes} = inspectorFixture(), slot = inspector.target(actor);
  assert.notEqual(slot, 'all'); const buttons = nodes.filter(node => node.tag === 'button' && node.className && node.className.split(' ').includes('ed-photo-finish'));
  assert.equal(buttons.length, 7); buttons[2].fire('click');
  const assignments = materialSchema.assignments(doc.getBehaviors(actor).find(item => item.type === 'surfaceMaterial'));
  assert.equal(assignments.length, 1); assert.equal(assignments[0].slot, slot); assert.equal(assignments[0].normalMap, pbr.path('cardboard', 'normal'));
  const saved = await doc.serialize(), reopened = setup(); await reopened.load(saved);
  assert.deepEqual(reopened.getBehaviors(reopened.getObject(actor.userData.editorId)), doc.getBehaviors(actor));
});

test('general finish dropdown applies the photo preset maps to the selected part', () => {
  const {doc, actor, inspector, nodes} = inspectorFixture(), slot = inspector.target(actor), choice = nodes.find(node => node.attrs['aria-label'] === 'Acabado del material');
  assert(choice); choice.value = 'photo-steel'; choice.fire('change');
  const assignment = materialSchema.assignments(doc.getBehaviors(actor).find(item => item.type === 'surfaceMaterial'))[0];
  assert.equal(assignment.slot, slot); assert.equal(assignment.texture, pbr.path('steel', 'neutral')); assert.equal(assignment.normalMap, pbr.path('steel', 'normal')); assert.equal(assignment.roughnessMap, pbr.path('steel', 'roughness'));
});

test('actual CAD geometry supplies finite unit normals and metric nondegenerate UV triangles', () => {
  const doc = setup(), compiled = require('../shared/cad-engine').compile({steps: [{id: 's1', op: 'solid.box', params: {width: .8, depth: .5, height: .4}, inputs: []}]}), actor = doc.addCAD('hall', {type: 'cad', recipe: compiled.recipe, mesh: compiled.mesh, color: '#a2783d'}), mesh = actor.children[0];
  const position = mesh.geometry.attributes.position, normal = mesh.geometry.attributes.normal, uv = mesh.geometry.attributes.uv;
  assert.equal(normal.count, position.count); assert.equal(uv.count, position.count);
  for (let i = 0; i < normal.count; i++) assert(Math.abs(new THREE.Vector3().fromBufferAttribute(normal, i).length() - 1) < 1e-5);
  for (let i = 0; i < uv.count; i += 3) {
    const area = Math.abs((uv.getX(i + 1) - uv.getX(i)) * (uv.getY(i + 2) - uv.getY(i)) - (uv.getY(i + 1) - uv.getY(i)) * (uv.getX(i + 2) - uv.getX(i)));
    assert(Number.isFinite(area) && area > 1e-8, 'Every flat CAD face can sample its photographic normal map.');
    const face = new THREE.Triangle(new THREE.Vector3().fromBufferAttribute(position, i), new THREE.Vector3().fromBufferAttribute(position, i + 1), new THREE.Vector3().fromBufferAttribute(position, i + 2));
    assert(Math.abs(area / 2 - face.getArea() * 4) < 1e-6, 'CAD uses two UV repetitions per metre on all box faces.');
  }
});

test('every authored photo preset resolves through the real AssetLibrary to one local assets prefix', async () => {
  const requested = [];
  class TextureLoader {
    constructor(manager) {this.manager = manager;}
    load(url, done, progress, fail) {
      try {
        requested.push(url); const decoded = decodeURIComponent(url); assert(!decoded.includes('assets/assets/'), 'AssetLibrary must not add its prefix twice.');
        assert(fs.existsSync(path.join(rootPath, decoded)), 'The URL passed to the actual image loader must exist in the deployment.');
        done(new THREE.Texture({width: 512, height: 512, src: url}));
      } catch (error) {fail(error);}
    }
  }
  const Library = new Function('THREE', 'assetDefinitions', 'assetLimits', source('src/editor/AssetLibrary.js').replace('default class AssetLibrary', 'return class AssetLibrary'))
    (Object.assign({}, THREE, {TextureLoader}), {}, require('../shared/asset-limits'));
  const library = new Library({});
  for (const profile of pbr.PROFILES) for (const field of ['texture', 'normalMap', 'roughnessMap']) {
    const config = materialSchema.getPreset('photo-' + profile.id), result = await library.instantiate({path: config[field]});
    assert.equal(result.material.map.image.width, 512); result.geometry.dispose(); result.material.map.dispose(); result.material.dispose();
  }
  assert.equal(requested.length, 21);
  for (const prefix of ['/', '/webxr-simulator/']) requested.forEach(url => assert.equal(new URL(url, 'https://local.test' + prefix).pathname, prefix + url));
});

async function run() {
  const failures = [];
  for (const item of tests) {
    try { await item.run(); console.log('PASS ' + item.name); }
    catch (error) { failures.push(item.name); console.error('FAIL ' + item.name + '\n' + error.stack); }
  }
  if (failures.length) throw Error(failures.length + '/' + tests.length + ' photographic checks failed: ' + failures.join('; '));
  console.log('Industrial photographic materials: ' + tests.length + ' deterministic ownership, projection, real-document, UI and offline-source checks passed.');
}
module.exports = {run};
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
