const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const {setup} = require('./test-vehicle-storage');
const read = file => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-project-loading-transition.js"), '..', file)), 'utf8');
const source = read("packages/tools/editor/src/SceneEditor.js");
const methods = source.slice(source.indexOf('  async applyServerProject('), source.indexOf('  async keepCurrentProject('));
const prepare = source.slice(source.indexOf('  async prepareRoom('), source.indexOf('  async historyStep('));
const Application = new Function('ROOM_IDS', 'return class Application {\n' + methods + prepare + '\n}')(['hall', 'sound']);
const Navigation = new Function(read("packages/render-three/src/RoomNavigation.js").replace('export default class RoomNavigation', 'return class RoomNavigation'))();

async function documentBudget() {
  const incoming = setup();
  for (let n = 0; n < 40; n++) incoming.addPrimitive('hall', 'box', '#334455');
  for (let n = 0; n < 30; n++) incoming.addPrimitive('sound', 'sphere', '#667788');
  const data = await incoming.serialize(), doc = setup();
  const old = doc.addPrimitive('hall', 'cylinder', '#aabbcc'), before = await doc.serialize();
  let clock = 0, yields = 0, built = 0;
  const instantiate = doc._instantiate.bind(doc); doc._instantiate = async descriptor => {built++; return instantiate(descriptor);};
  await doc.load(data, {activeRoomId: 'hall', now: () => clock += 4, yieldControl: async () => {
    yields++; assert.equal(doc.additions.size, 1, 'Prepared geometry stays detached until the destination is complete.'); assert.equal(doc.getObject(old.userData.editorId), old);
  }});
  assert(yields > 10); assert.equal(built, 40, 'Unselected rooms are not instantiated.'); assert(doc.hasPendingRoom('sound'));
  clock = yields = 0;
  await doc.activateRoom('sound', {now: () => clock += 4, yieldControl: async () => {yields++; assert.equal(doc.additions.size, 40);}});
  assert(yields > 5); assert.equal(built, 70); assert(!doc.hasPendingRoom('sound'));

  const stable = await doc.serialize(), stableObjects = [...doc.additions.values()].map(entry => entry.object), controller = new AbortController();
  clock = yields = 0;
  await assert.rejects(doc.load(before, {activeRoomId: 'hall', signal: controller.signal, now: () => clock += 8,
    yieldControl: async () => {if (++yields === 2) controller.abort();}}), error => error.name === 'AbortError');
  assert.equal(doc.loading, false); assert.deepEqual(await doc.serialize(), stable);
  stableObjects.forEach(object => assert.equal(doc.getObject(object.userData.editorId), object));
}

function application() {
  const doc = setup(), old = doc.addPrimitive('hall', 'box', '#225566'), scene = new THREE.Scene();
  doc.rooms.forEach(entry => scene.add(entry.root));
  const camera = new THREE.PerspectiveCamera(), rig = new THREE.Group(); rig.add(camera); scene.add(rig); rig.position.set(2, 0, 3); camera.position.set(0, 1.6, 0);
  const ctx = {room: 0, roomTransition: false, scene, camera, cameraRig: rig, vrMode: false}, events = [], app = new Application();
  Object.defineProperty(app, 'roomId', {get: () => ['hall', 'sound'][ctx.room]});
  Object.assign(app, {ctx, document: doc, currentProject: {id: 'old', name: 'Original', revision: 1}, projectName: 'Original', publicView: false,
    projectGeneration: 0, active: false, dirty: true, transform: {enabled: false}, accessView: {enabled: true, identityGeneration: 0},
    assetThumbnails: {dispose() {}}, decals: {dispose() {}}, infoPreview: {dispose() {}}, simulationPanel: {modeChanged() {}},
    performance: {invalidate() {}}, library: {async getCatalog() {return [];}}});
  for (const method of ['cancelTransformDrag', 'clearAssembly', 'clearNavigation', 'clearAssetPreview', 'cancelDecalPlacement', 'clearObjectClipboard', 'select', 'renderAssets', 'rememberProject', 'markRemoteProject', 'updateStatus']) app[method] = () => {};
  app.stopRuntime = () => events.push('stop');
  app.startRuntime = () => {assert(ctx.roomTransition, 'A new/recovered runtime starts behind the cover.'); events.push('runtime:' + app.currentProject.id);};
  app.syncNative = () => doc.rooms.forEach((entry, id) => {entry.root.visible = id === app.roomId;});
  let covered = false;
  const navigation = new Navigation(ctx, {count: 2, getVersion: () => app.projectGeneration,
    cover: async request => {covered = true; events.push('cover'); request.yieldControl = async () => assert(covered); await Promise.resolve();},
    prepare: (room, request) => app.prepareRoom(['hall', 'sound'][room], {signal: request.signal, yieldControl: request.yieldControl}),
    commit: room => {assert(covered); ctx.room = room; app.syncNative();},
    prepareCurrent: async () => {assert(covered); app.startRuntime(); events.push('warm:' + app.currentProject.id);},
    recover: async () => {assert(covered); app.startRuntime();},
    finish: async () => {assert(!app.loadingProject && !doc.loading); events.push('reveal:' + app.currentProject.id); covered = false;},
    failed: () => {covered = true; events.push('error-cover');}});
  ctx.withRoomTransition = (work, options) => navigation.runExternal(work, options);
  app.hooks = {gotoRoom: room => navigation.go(room)};
  return {app, ctx, doc, old, events, navigation, covered: () => covered};
}
async function activationReentry() {
  const source = setup(); source.addPrimitive('sound', 'box', '#667788');
  const doc = setup(); await doc.load(await source.serialize(), {activeRoomId: 'hall'});
  const instantiate = doc._instantiate.bind(doc); let release, factoryCount = 0;
  doc._instantiate = async descriptor => {const content = await instantiate(descriptor); if (++factoryCount === 1) await new Promise(resolve => {release = resolve;}); return content;};
  const firstSignal = new AbortController(), nextSignal = new AbortController();
  const old = doc.activateRoom('sound', {signal: firstSignal.signal}); const oldResult = Promise.allSettled([old]);
  for(let i=0;i<10&&!release;i++)await Promise.resolve(); assert(release);
  firstSignal.abort(); const next = doc.activateRoom('sound', {signal: nextSignal.signal});
  assert.notStrictEqual(next, old, 'A re-entered room never inherits its previous aborted signal.');
  assert.equal(await next, true, 'The newest room request need not wait for the obsolete factory.');
  const objects = doc.getObjects('sound').slice(); assert.equal(doc.additions.size, 1);
  release(); await oldResult; assert.deepEqual(doc.getObjects('sound'), objects); assert.equal(doc.additions.size, 1, 'An obsolete factory cannot install duplicates or remove the new activation.');
}
async function projectSwitches() {
  const target = setup(); target.addPrimitive('hall', 'sphere', '#884422');
  const project = {id: 'new', name: 'Nuevo', revision: 1, document: await target.serialize(), access: {role: 'public', canEdit: false}, allowedRoomIds: ['hall']};
  const f = application(); await f.app.applyServerProject(project);
  assert.equal(f.app.currentProject.id, 'new'); assert.equal(f.app.publicView, true); assert.equal(f.covered(), false);
  assert(f.events.indexOf('cover') < f.events.indexOf('stop')); assert(f.events.indexOf('runtime:new') < f.events.indexOf('reveal:new'));
  assert.equal(f.events.filter(event => event.startsWith('reveal:')).length, 1, 'Same-room replacement is one covered transaction.');

  const failed = application(), before = await failed.doc.serialize(), history = failed.doc.undoStack.slice(), rig = failed.ctx.cameraRig.position.clone();
  let calls = 0; failed.ctx.roomAssets = {async prepareRoom() {if (++calls === 1) throw Error('Texture unavailable after document commit');}, setActiveRoom() {}};
  await assert.rejects(failed.app.applyServerProject(project), /Texture unavailable/);
  assert.deepEqual(await failed.doc.serialize(), before); assert.equal(failed.doc.getObject(failed.old.userData.editorId), failed.old);
  assert.equal(failed.app.currentProject.id, 'old'); assert.equal(failed.app.dirty, true); assert.deepEqual(failed.doc.undoStack, history); assert(failed.ctx.cameraRig.position.equals(rig));
  assert(!failed.events.includes('runtime:new')); assert(!failed.events.includes('reveal:new')); assert(failed.events.includes('reveal:old'));

  const warmup = application(), original = await warmup.doc.serialize();
  warmup.navigation.options.prepareCurrent = async () => {throw Error('Post-work warmup failure');};
  await assert.rejects(warmup.app.applyServerProject(project), /Post-work warmup/);
  assert.equal(warmup.app.currentProject.id, 'old', 'Final preparation failures restore project metadata after the document loader returned.');
  assert.deepEqual(await warmup.doc.serialize(), original); assert.equal(warmup.doc.getObject(warmup.old.userData.editorId), warmup.old);
  assert(!warmup.events.includes('reveal:new')); assert(!warmup.events.includes('runtime:new')); assert(warmup.events.includes('reveal:old')); assert(!warmup.covered());

  const identity = application(); identity.ctx.roomAssets = {async prepareRoom() {identity.app.accessView.identityGeneration++;}, setActiveRoom() {}};
  await assert.rejects(identity.app.applyServerProject(project), /cuenta cambi/);
  assert(identity.covered()); assert(identity.events.includes('error-cover')); assert(!identity.events.some(event => event.startsWith('reveal:')));
  assert([...identity.doc.rooms.values()].every(entry => !entry.root.visible), 'A changed identity never restores or reveals its predecessor world.');
}
async function run() {await documentBudget(); await activationReentry(); await projectSwitches(); console.log('Project transitions: cooperative detached preparation, lazy rooms, aborted-factory re-entry, cancelled-load identity rollback, same-room coverage, post-commit texture failure recovery and no private-world reveal after identity change passed.');}
if (require.main === module) run().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {run};
