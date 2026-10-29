const __layout = require("../../tooling/layout.cjs");
'use strict';

// Real persistence methods with deferred network/hash work; no user database.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createHash, webcrypto} = require('node:crypto');
const {MAX_ASSET_BYTES} = require('../../packages/render-three/schema/asset-limits');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const clone = value => JSON.parse(JSON.stringify(value));
let fetchImpl = () => { throw new Error('Unexpected network request'); };
const clientSource = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-project-save-identity.js"), '../src/editor/ProjectClient.js')), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class ProjectClient', 'class ProjectClient');
const Client = new Function('fetch', 'MAX_ASSET_BYTES', 'crypto', clientSource + '\nreturn ProjectClient;')((...args) => fetchImpl(...args), MAX_ASSET_BYTES, webcrypto);
const editorSource = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-project-save-identity.js"), '../src/editor/SceneEditor.js')), 'utf8');
const saveMethods = editorSource.slice(editorSource.indexOf('  async saveProject('), editorSource.indexOf('  async exportProject('));
const SavingEditor = new Function('STORAGE_KEY', 'return class SavingEditor {\n' + saveMethods + '\n}')('hello-webxr-scene-backup');
const response = (value, status = 200) => ({ok: status >= 200 && status < 300, status, async json() { return value; }});
const document = {format: 'hello-webxr-editor', version: 1, rooms: {hall: {overrides: [], additions: []}}, imports: []};
const userA = {id: 'account-a', permissions: {editor: true}}, userB = {id: 'account-b', permissions: {editor: true}};
const savedA = {id: 'project-a', name: 'Private A', revision: 2, document: clone(document), access: {role: 'owner', ownerId: userA.id, canEdit: true}};
const savedB = {id: 'project-b', name: 'Private B', revision: 5, access: {role: 'owner', ownerId: userB.id, canEdit: true}};
const scopeError = error => error && error.status === 409 && error.code === 'session_changed';

function imports() {
  return [Buffer.from('private model A'), Buffer.from('private model B')].map((bytes, index) => ({id: 'import-' + index, path: 'model-' + index + '.glb', size: bytes.length,
    dataUrl: 'data:model/gltf-binary;base64,' + bytes.toString('base64')}));
}
async function assetResponse(options) {
  const bytes = Buffer.from(await options.body.arrayBuffer()), hash = createHash('sha256').update(bytes).digest('hex');
  return response({asset: {url: '/api/assets/' + hash, sha256: hash, size: bytes.length, mime: options.headers['X-Asset-Mime']}}, 201);
}
function clientHarness() { let identity = userA.id; const client = new Client(); client.identityProvider = () => identity; client.assetUploadAvailable = true; return {client, change(value) { identity = value; }}; }
function editorHarness() {
  const editor = new SavingEditor(), f = clientHarness(), changes = {restored: 0, remembered: 0, published: 0, renders: 0, requests: 0}, toasts = [];
  Object.assign(editor, {projectClient: f.client, ctx: {studio: {client: {user: userA}}}, accessView: {enabled: true, identityGeneration: 0}, projectGeneration: 1,
    currentProject: {id: savedA.id, name: savedA.name, revision: 1, access: savedA.access}, projectName: savedA.name, changeVersion: 1, dirty: true, storageAvailable: true,
    document: {async serialize() { return clone(document); }},
    library: {restoreImports() { changes.restored++; }, exportImports() { return []; }, async exportPortableImports() { return []; }, async getCatalog() { return []; }},
    projectSync: {publish() { changes.published++; }}, canEditDocument() { return true; }, updateStatus() {}, renderAssets() { changes.renders++; },
    toast(message) { toasts.push(message); }, rememberProject() { changes.remembered++; }, markRemoteProject() {}, scopedStorageKey(key) { return key + ':' + this.ctx.studio.client.user.id; }});
  return {editor, changes, toasts, changeAccount() { f.change(userB.id); editor.ctx.studio.client.user = userB; editor.accessView.identityGeneration++; editor.projectGeneration++; editor.currentProject = clone(savedB); editor.projectName = savedB.name; editor.dirty = true; editor.changeVersion++; }};
}

async function run() {
  const oldStorage = global.localStorage, writes = [];
  global.localStorage = {setItem(key, value) { writes.push({key, value}); }};
  try {
    const scope = clientHarness(); assert.equal(scope.client.scopeIdentity(), userA.id); scope.change(userB.id); assert.throws(() => scope.client.assertIdentity(userA.id), scopeError);

    const pendingReply = deferred(), network = clientHarness();
    fetchImpl = () => pendingReply.promise;
    const pendingRequest = network.client.getProject('project-a'); network.change(userB.id);
    const rejectedRequest = assert.rejects(pendingRequest, scopeError); pendingReply.resolve(response({project: savedA})); await rejectedRequest;
    const decoding = clientHarness(), decoded = deferred(), decodingStarted = deferred();
    fetchImpl = async () => ({ok: true, status: 200, json() { decodingStarted.resolve(); return decoded.promise; }});
    const decodeRequest = decoding.client.getProject('project-a'); await decodingStarted.promise; decoding.change(userB.id);
    const rejectedDecode = assert.rejects(decodeRequest, scopeError); decoded.resolve({project: savedA}); await rejectedDecode;

    const firstUpload = deferred(), uploadStarted = deferred(), staging = clientHarness(), posts = [];
    fetchImpl = async (url, options) => { posts.push({url, identity: options.headers['X-Studio-User']}); if (url.endsWith('/assets')) { uploadStarted.resolve(options); return firstUpload.promise; } throw new Error('Project metadata must not be posted after changing identity'); };
    const staged = staging.client.createProject('Private A', Object.assign(clone(document), {imports: imports()}));
    const firstOptions = await uploadStarted.promise; staging.change(userB.id);
    const rejectedStaging = assert.rejects(staged, scopeError); firstUpload.resolve(await assetResponse(firstOptions)); await rejectedStaging;
    assert.equal(posts.length, 1, 'changing account stops staging before a second upload or project POST'); assert.equal(posts[0].identity, userA.id);

    const cache = clientHarness(), uploads = [];
    fetchImpl = async (url, options) => {
      if (url.endsWith('/assets')) { uploads.push(options.headers['X-Studio-User']); return assetResponse(options); }
      const payload = JSON.parse(options.body); return response({project: {id: 'project-' + options.headers['X-Studio-User'], name: payload.name, revision: 1, document: payload.document}}, 201);
    };
    const inlineDocument = Object.assign(clone(document), {imports: [imports()[0]]});
    await cache.client.createProject('Account A first', inlineDocument); await cache.client.createProject('Account A cached', inlineDocument);
    assert.deepEqual(uploads, [userA.id], 'same-account inline hash cache avoids duplicate uploads');
    cache.change(userB.id); await cache.client.createProject('Account B own grant', inlineDocument);
    assert.deepEqual(uploads, [userA.id, userB.id], 'account B must obtain its own authorized asset reference');
    const repeatedBlob = new Blob([Buffer.from('shared in-memory File')], {type: 'text/plain'});
    await cache.client.uploadAsset(repeatedBlob); await cache.client.uploadAsset(repeatedBlob); cache.change(userA.id); await cache.client.uploadAsset(repeatedBlob);
    assert.deepEqual(uploads.slice(-2), [userB.id, userA.id], 'File/Blob WeakMap cache also belongs to one account');

    const saving = editorHarness(), saveReply = deferred(), saveStarted = deferred();
    saving.editor.projectClient.updateProject = async () => { saving.changes.requests++; saveStarted.resolve(); return saveReply.promise; };
    const save = saving.editor.saveProject(); await saveStarted.promise; saving.changeAccount();
    const rejectedSave = assert.rejects(save, scopeError); saveReply.resolve(savedA); await rejectedSave;
    assert.equal(saving.editor.currentProject.id, savedB.id); assert.equal(saving.editor.projectName, savedB.name); assert.equal(saving.editor.dirty, true);
    assert.equal(saving.changes.restored, 0); assert.equal(saving.changes.remembered, 0); assert.equal(saving.changes.published, 0); assert.equal(writes.length, 0, 'old private save is never persisted in account B browser storage');

    const serializing = editorHarness(), serialized = deferred(); serializing.editor.document.serialize = () => serialized.promise;
    serializing.editor.projectClient.updateProject = async () => { serializing.changes.requests++; return savedA; };
    const beforeDispatch = serializing.editor.saveProject(); serializing.changeAccount();
    const rejectedDispatch = assert.rejects(beforeDispatch, scopeError); serialized.resolve(clone(document)); await rejectedDispatch; assert.equal(serializing.changes.requests, 0, 'a pending serialization cannot dispatch private A content under B');

    const local = editorHarness(), portable = deferred(), exportStarted = deferred();
    local.editor.library.exportPortableImports = () => { exportStarted.resolve(); return portable.promise; };
    const localSave = local.editor.saveLocal(); await exportStarted.promise; local.changeAccount(); portable.resolve(imports()); await localSave;
    assert.equal(writes.length, 0); assert.equal(local.editor.currentProject.id, savedB.id); assert.equal(local.editor.dirty, true);

    const lateCatalog = editorHarness(), catalog = deferred(), catalogStarted = deferred();
    lateCatalog.editor.projectClient.updateProject = async () => savedA;
    lateCatalog.editor.library.getCatalog = () => { catalogStarted.resolve(); return catalog.promise; };
    const lateSave = lateCatalog.editor.saveProject(); await catalogStarted.promise;
    // Account A's successful save/backup occurred before switching. The pending
    // resource refresh still must not replace B's visible catalog afterward.
    const writtenBeforeSwitch = writes.length; lateCatalog.changeAccount(); lateCatalog.editor.entries = ['Account B resources'];
    const rejectedCatalog = assert.rejects(lateSave, scopeError); catalog.resolve(['Private A resources']); await rejectedCatalog;
    assert.deepEqual(lateCatalog.editor.entries, ['Account B resources']); assert.equal(writes.length, writtenBeforeSwitch);
    writes.length = 0;

    // Normal saves still update the authorized document and scoped backup.
    const normal = editorHarness(); normal.editor.projectClient.updateProject = async () => savedA;
    assert.equal((await normal.editor.saveProject()).revision, 2); assert.equal(normal.changes.restored, 1); assert.equal(normal.changes.published, 1);
    assert.equal(writes.length, 1); assert(writes[0].key.endsWith(':' + userA.id));
    console.log('Project save identity: delayed server/save replies, pre-dispatch serialization, local portable export, multi-file staging and hash/Blob caches cannot cross accounts; normal saves remain functional.');
  } finally { global.localStorage = oldStorage; }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
