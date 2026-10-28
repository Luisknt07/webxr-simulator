'use strict';
// Real vehicle camera ownership + actual ScenePerformance resource collection.
// Renderer calls are the only adapted boundary; no live project data is used.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const fixture = fs.readFileSync(path.join(__dirname, 'test-vehicle-fork-camera.js'), 'utf8');
const {setup, renderer} = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('\nconst desktop = setup(')) + '\nreturn {setup,renderer};')(require, __dirname);
const read = name => fs.readFileSync(path.join(__dirname, '../src/editor', name + '.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class ' + name, 'return class ' + name);
const dependencies = ['RuntimeResourceMemory', 'CosmeticVisualLod', 'StaticArchitectureBatches'].map(name => new Function('THREE', read(name))(THREE));
const Performance = new Function('THREE', 'RuntimeResourceMemory', 'CosmeticVisualLod', 'StaticArchitectureBatches', read('ScenePerformance'))(THREE, ...dependencies);
const registered = (ctx, target) => ctx.performanceRenderTargets instanceof Set ? ctx.performanceRenderTargets.has(target) : Array.isArray(ctx.performanceRenderTargets) && ctx.performanceRenderTargets.includes(target);
let scenarios = 0;
// Negative control: reproduce the original resource-classification path by
// temporarily omitting the explicit integration owner. This is not a source
// stub: the actual collector evicts the hidden plane's RT texture as an image.
{
  const f = setup(false, true); renderer(f); f.document.rooms = new Map([['hall', {root: f.root}]]);
  assert(f.driving.mount(f.record.id)); assert(f.driving.docking.renderBefore(f.scene, .2));
  const feed = f.driving.docking.forkCamera, target = feed.target, manager = new Performance(f.ctx, f.document); let disposals = 0;
  target.texture.addEventListener('dispose', () => disposals++);
  const targets = f.ctx.performanceRenderTargets;
  assert(registered(f.ctx, target), 'The production owner must register its target.');
  if (targets instanceof Set) targets.delete(target); else targets.splice(targets.indexOf(target), 1);
  manager.setRoom('hall'); assert.equal(disposals, 1); assert(manager.evicted.has(target.texture), 'Unregistered hidden RT maps reproduce the original incorrect image eviction.');
  f.driving.dispose(); f.runtime.stop(); manager.dispose();
}
for (const container of ['default', 'set', 'array']) {
  const f = setup(false, true); renderer(f); f.document.rooms = new Map([['hall', {root: f.root}]]);
  const foreign = new THREE.WebGLRenderTarget(4, 4);
  if (container === 'set') f.ctx.performanceRenderTargets = new Set([foreign]);
  if (container === 'array') f.ctx.performanceRenderTargets = [foreign];
  assert(f.driving.mount(f.record.id));
  const feed = f.driving.docking.forkCamera, manager = new Performance(f.ctx, f.document);
  manager.setRoom('hall'); assert(f.driving.docking.renderBefore(f.scene, .2));
  const target = feed.target; let textureDisposals = 0, targetDisposals = 0;
  target.texture.addEventListener('dispose', () => textureDisposals++); target.addEventListener('dispose', () => targetDisposals++);
  assert.equal(feed.plane.visible, false, 'Desktop uses the overlay, keeping its VR feed plane hidden.');
  assert(registered(f.ctx, target), 'The camera must register its target before inactive-room/resource reconciliation.');
  for (let index = 0; index < 12; index++) {
    manager.invalidate(); manager.reconcile();
    const inventory = manager.resourceInventory();
    assert(inventory.resident.renderTargets.has(target)); assert(inventory.resident.textures.has(target.texture)); assert(inventory.retained.renderTargetTextures.has(target.texture));
    assert(!manager.evicted.has(target.texture)); assert.equal(textureDisposals, 0); assert.equal(targetDisposals, 0);
    assert(f.driving.docking.renderBefore(f.scene, .2)); assert.equal(feed.target, target);
  }
  feed.setEnabled(false); assert.equal(targetDisposals, 1); assert.equal(textureDisposals, 0);
  assert(!registered(f.ctx, target)); assert(!manager.resourceInventory().resident.renderTargets.has(target));
  if (container !== 'default') assert(registered(f.ctx, foreign), 'A camera release cannot remove unrelated integration targets.');
  feed.setEnabled(true); assert(f.driving.docking.renderBefore(f.scene, .2)); const replacement = feed.target;
  assert.notEqual(replacement, target); assert(registered(f.ctx, replacement)); manager.reconcile();
  let replacementDisposals = 0; replacement.addEventListener('dispose', () => replacementDisposals++);
  f.driving.docking.unmount(); assert.equal(replacementDisposals, 1); assert(!registered(f.ctx, replacement));
  manager.invalidate(); manager.reconcile(); assert(!manager.resourceInventory().resident.renderTargets.has(replacement));
  if (container !== 'default') assert(registered(f.ctx, foreign));
  f.driving.dispose(); f.runtime.stop(); manager.dispose(); foreign.dispose(); scenarios++;
}
console.log('Vehicle auxiliary camera residency: hidden desktop VR surface keeps its real render target/texture across 12 reconciliations, Set/array integrations preserve unrelated targets, disable/retry/unmount release exactly once (' + scenarios + ' cases).');
