'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {request, hash} = require('./upgrade-cedi-examples');
const {validateDocument} = require('../server/validation');
const reportFile = path.resolve(__dirname, '../data/qa-studio/industrial-floor-upgrade.json');
(async () => {
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')); assert.equal(report.mode, 'applied');
  const projects = [];
  for (const target of report.projects) {
    const current = (await request('/api/projects/' + target.id)).project;
    assert.equal(current.revision, target.nextRevision); assert.equal(hash(current.document), target.payloadHash);
    const validated = validateDocument(current.document, value => value); assert.deepEqual(validated, current.document);
    let scenes = 0, meshes = 0;
    for (const [roomId, room] of Object.entries(current.document.rooms)) {
      const actors = room.additions.filter(row => row.descriptor.type === 'industrialFloor');
      if (!actors.length) continue;
      assert.equal(actors.length, 1); const actor = actors[0];
      assert.deepEqual(actor.position, [0, 0, 0]); assert.deepEqual(actor.quaternion, [0, 0, 0, 1]); assert.deepEqual(actor.scale, [1, 1, 1]);
      assert(Math.abs(actor.descriptor.floorY) < .00001);
      scenes++; meshes += actor.descriptor.walkways.length;
    }
    projects.push({id: current.id, revision: current.revision, payloadHash: hash(current.document), scenes, pedestrianSegments: meshes});
  }
  assert.equal(projects.reduce((sum, value) => sum + value.scenes, 0), 16);
  const original = (await request('/api/projects/ce14b39b-5d77-45ea-a85e-1d7e0d76e872')).project;
  assert.equal(original.revision, 9); assert.equal(hash(original.document), '9a990ce7925ca3ca84a98fa02d363c9cef4da0f2a8bba961491e23dab54b3cac');
  const result = {passed: true, checkedAt: new Date().toISOString(), projects, originalUnchanged: true, writes: []};
  fs.writeFileSync(path.resolve(__dirname, '../data/qa-studio/industrial-floor-saved.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
