'use strict';
const fs = require('node:fs'), path = require('node:path'), inspector = require('node:inspector'), THREE = require('three');
const schema = require('../shared/behaviors');
const fixture = fs.readFileSync(path.join(__dirname, 'test-industrial-lab-lines.js'), 'utf8');
const {harness, releaseGeometry} = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('\nasync function run()')) + '\nreturn {harness,releaseGeometry};')(require, __dirname);
const builders = require('./load-industrial-cedi')(THREE, schema);
const Visuals = new Function('THREE', fs.readFileSync(path.join(__dirname, '../src/editor/IndustrialVisuals.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default class IndustrialVisuals', 'return class IndustrialVisuals'))(THREE);
const session = new inspector.Session(); session.connect();
const post = (method, args) => new Promise((resolve, reject) => session.post(method, args || {}, (error, result) => error ? reject(error) : resolve(result)));
(async () => {
  const f = harness.setup(), kind = process.argv[2] || 'lab', frames = Number(process.argv[3] || 60);
  if (process.argv.includes('--baseline')) {
    const source = require('node:child_process').execFileSync('git', ['show', 'HEAD:src/lib/CollisionWorld.js'], {encoding: 'utf8'}).replace(/^import .*;\r?\n/gm, '').replace('export default class CollisionWorld', 'return class CollisionWorld');
    const {getGeometryTree} = require('./load-geometry-acceleration.js')(THREE), Baseline = new Function('THREE', 'getGeometryTree', source)(THREE, getGeometryTree);
    f.ctx.collisionWorld = new Baseline(f.ctx, f.document);
  }
  kind === 'lab' ? builders.buildIndustrialLab(f.document, 'hall', {scene: f.scene, continuous: true}) : builders.buildIndustrialCediLevel(f.document, 'hall', {kind, scene: f.scene, continuous: true});
  const world = f.ctx.collisionWorld, visuals = new Visuals(f.ctx, f.document, f.runtime);
  world.setRoom('hall'); f.scene.updateMatrixWorld(true); f.runtime.start('hall');
  await post('Profiler.enable'); await post('Profiler.setSamplingInterval', {interval: 1000}); await post('Profiler.start');
  const begin = performance.now();
  for (let frame = 0; frame < frames; frame++) {
    world.beginFrame(); try { f.scene.updateMatrixWorld(true); f.runtime.execute(.1); visuals.sync('hall', .1, false); f.scene.updateMatrixWorld(true); } finally {world.endFrame();}
  }
  const elapsed = performance.now() - begin, {profile} = await post('Profiler.stop'); session.disconnect();
  const nodes = new Map(profile.nodes.map(node => [node.id, node])), parents = new Map(); profile.nodes.forEach(node => (node.children || []).forEach(id => parents.set(id, node.id)));
  const self = new Map(), total = new Map();
  (profile.samples || []).forEach((id, index) => {
    const ms = (profile.timeDeltas[index] || 1000) / 1000, name = node => (node.callFrame.functionName || '(anonymous)') + ':' + node.callFrame.lineNumber;
    const key = name(nodes.get(id)); self.set(key, (self.get(key) || 0) + ms);
    const seen = new Set(); for (let current = id; current; current = parents.get(current)) {const key = name(nodes.get(current)); if (!seen.has(key)) total.set(key, (total.get(key) || 0) + ms); seen.add(key);}
  });
  const top = map => Array.from(map, ([name, ms]) => ({name, ms: Math.round(ms), pct: Math.round(ms / elapsed * 100)})).sort((a,b) => b.ms-a.ms).slice(0, 25);
  console.log(JSON.stringify({kind, baseline: process.argv.includes('--baseline'), frames, elapsed: Math.round(elapsed), active: f.runtime.sourceRuntime.liveLoads(), stats: world.stats, entries: world.entries.length, self: top(self), total: top(total)}, null, 2));
  visuals.dispose(); releaseGeometry(f);
})().catch(error => {console.error(error); process.exitCode=1;});
