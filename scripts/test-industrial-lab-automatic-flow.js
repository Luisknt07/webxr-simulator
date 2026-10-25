'use strict';
// Every recipe runs against the actual authored floor, protection geometry,
// source products and narrow-phase CollisionWorld, rather than a logical graph.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), THREE = require('three');
const schema = require('../shared/behaviors');
const file = fs.readFileSync(path.join(__dirname, 'test-industrial-lab-lines.js'), 'utf8');
const boundary = file.indexOf('\nasync function run()');
const {harness, buildIndustrialLabLines, releaseGeometry} = new Function('require', '__dirname', file.slice(0, boundary) + '\nreturn {harness,buildIndustrialLabLines,releaseGeometry};')(require, __dirname);
const buildIndustrialLab = require('./load-industrial-lab')(THREE, schema, buildIndustrialLabLines);

async function run() {
  for (const id of process.argv.slice(2).length ? process.argv.slice(2) : ['manual-l', 'sorting', 'merge', 'elevator', 'pallets', 'assembly', 'rectangle', 'gravity', 'transfer-l']) {
    const f = harness.setup(), cell = buildIndustrialLab(f.document, 'hall', {scene: f.scene, cellIds: [id]}).cells[0], world = f.ctx.collisionWorld;
    assert(world); world.setRoom('hall'); f.scene.updateMatrixWorld(true);
    const authored = JSON.stringify(await f.document.serialize()); f.runtime.start('hall');
    const final = () => cell.receivers.map(object => f.runtime.records.get(object.userData.editorId).variables);
    for (let index = 0; index < 4000 && final().reduce((sum, state) => sum + state.completePallets, 0) !== 4; index++) {
      world.beginFrame();
      try { f.scene.updateMatrixWorld(true); f.runtime.execute(.1); } finally { world.endFrame(); }
    }
    const states = final();
    const diagnostic = Array.from(f.runtime.records.values()).filter(record => record.components.source || record.components.conveyor || record.components.processor || record.components.palletQueue).map(record => [record.object.name, record.variables]);
    assert.equal(states.reduce((sum, state) => sum + state.completePallets, 0), 4, id + ' fills four visible pallets under actual collision checks: ' + JSON.stringify(diagnostic));
    assert.equal(states.reduce((sum, state) => sum + state.receivedUnits, 0), 16, id + ' conserves all sixteen source units.');
    assert(!f.runtime.events.some(event => event.type === 'configuration-warning'), id + ' has no incompatible load or configuration warning.');
    f.runtime.stop(); assert.equal(JSON.stringify(await f.document.serialize()), authored, id + ' restores the editable scenario exactly.');
    console.log('Collision-checked automatic line:', id, '— four complete pallets, sixteen units.'); releaseGeometry(f);
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
