'use strict';
// Exercise the complete authored platform, guards and real product collision
// world. A graph-only test cannot detect a rail crossing a transport opening.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors');
const file = fs.readFileSync(path.join(__dirname, 'test-industrial-lab-lines.js'), 'utf8');
const boundary = file.indexOf('\nasync function run()');
const {harness, buildIndustrialLabLines, releaseGeometry} = new Function('require', '__dirname', file.slice(0, boundary) + '\nreturn {harness,buildIndustrialLabLines,releaseGeometry};')(require, __dirname);
const buildIndustrialLab = require('./load-industrial-lab')(THREE, schema, buildIndustrialLabLines);
async function run() {
  const f = harness.setup(), lab = buildIndustrialLab(f.document, 'hall', {scene: f.scene, cellIds: ['elevator']});
  const cell = lab.cells[0], world = f.ctx.collisionWorld;
  assert(world, 'The actual collision world must remain enabled during line verification.');
  world.setRoom('hall'); f.scene.updateMatrixWorld(true);
  const authored = await f.document.serialize();
  f.runtime.start('hall');
  for (let index = 0; index < 4000 && f.runtime.records.get(cell.receiver.userData.editorId).variables.completePallets !== 4; index++) {
    world.beginFrame();
    try { f.scene.updateMatrixWorld(true); f.runtime.execute(.1); }
    finally { world.endFrame(); }
  }
  const output = f.runtime.records.get(cell.receiver.userData.editorId).variables;
  assert.equal(output.received, 16, 'All sixteen physical boxes pass the elevated guard opening and reach the upper pallet stock.');
  assert.equal(output.receivedUnits, 16); assert.equal(output.completePallets, 4);
  assert(!f.runtime.events.some(event => event.type === 'configuration-warning'), 'The elevated line has no collision/configuration warning.');
  const inlet = cell.objects.find(object => object.name.includes('Salida superior'));
  const record = f.runtime.records.get(inlet.userData.editorId), belt = record.components.conveyor;
  const origin = f.runtime.pathSurface(record, belt, f.runtime.pathPoint(belt.config, 0));
  const target = f.runtime.pathSurface(record, belt, f.runtime.pathPoint(belt.config, belt.config.length));
  const bounds = new THREE.Box3(origin.clone().add(new THREE.Vector3(-.125, .01, -.125)), origin.clone().add(new THREE.Vector3(.125, .26, .125)));
  const ignore = [inlet, cell.receiver];
  world.refresh();
  assert.equal(world.sweepBox(bounds, target.clone().sub(origin), {ignore}).blocked, false, 'Guard rails and posts leave the complete product corridor open.');
  f.runtime.stop();
  assert.deepEqual(await f.document.serialize(), authored, 'Running the collision-checked line restores every authored pose and setting.');
  releaseGeometry(f);
  console.log('Industrial lab physical flow: real elevated platform/guards, clear transport openings, sixteen delivered boxes/four complete pallets, persisted finishes/monitor, no warnings and exact authoring restoration passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
