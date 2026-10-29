const __layout = require("../layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {request, hash} = require('./upgrade-cedi-examples'), {validateDocument} = require('../../apps/api/server/validation');
(async () => {
  const manifest = JSON.parse(fs.readFileSync(__layout.map(path.resolve(__layout.oldDir("scripts/verify-industrial-equipment-saved.js"), '../data/qa-studio/industrial-equipment-upgrade.json')), 'utf8')); assert.equal(manifest.mode, 'applied');
  const projects = [], totals = {monitors: 0, cards: 0, suspendedParts: 0, scenes: 0};
  for (const target of manifest.projects) {
    const project = (await request('/api/projects/' + target.id)).project; assert.equal(project.revision, target.nextRevision); assert.equal(hash(project.document), target.payloadHash);
    assert.deepEqual(validateDocument(project.document, value => value), project.document);
    const counts = {monitors: 0, cards: 0, suspendedParts: 0, scenes: 0};
    for (const room of Object.values(project.document.rooms)) {
      if (!room.additions.some(row => row.descriptor.type === 'industrialFloor')) continue;
      counts.scenes++;
      for (const row of room.additions) {
        if (row.behaviors.some(value => value.type === 'lineMonitor')) counts.monitors++;
        if (row.behaviors.some(value => value.type === 'info' && value.presentation === 'contextual')) counts.cards++;
        if (row.name.startsWith('Suspensión HMI v1 · ')) { counts.suspendedParts++; assert(row.position[1] > 3); assert(row.behaviors.some(value => value.type === 'collision' && value.enabled === false)); }
      }
    }
    Object.keys(totals).forEach(key => { totals[key] += counts[key]; }); projects.push({id: project.id, revision: project.revision, hash: hash(project.document), counts});
  }
  assert.deepEqual(totals, {monitors: 31, cards: 52, suspendedParts: 93, scenes: 16});
  const original = (await request('/api/projects/ce14b39b-5d77-45ea-a85e-1d7e0d76e872')).project; assert.equal(original.revision, 9); assert.equal(hash(original.document), '9a990ce7925ca3ca84a98fa02d363c9cef4da0f2a8bba961491e23dab54b3cac');
  const result = {passed: true, checkedAt: new Date().toISOString(), projects, totals, originalUnchanged: true, writes: []}; fs.writeFileSync(__layout.map(path.resolve(__layout.oldDir("scripts/verify-industrial-equipment-saved.js"), '../data/qa-studio/industrial-equipment-saved.json')), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
