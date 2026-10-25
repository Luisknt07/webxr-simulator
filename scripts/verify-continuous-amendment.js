'use strict';
const fs = require('node:fs'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const sha = value => crypto.createHash('sha256').update(value).digest('hex'), norm = value => value.replace(/\r\n/g, '\n');
function verify() {
  const oldR = norm(fs.readFileSync('data/qa-studio/SimulationRuntime-before-manual-analytics.js', 'utf8'));
  const newR = norm(fs.readFileSync('src/editor/SimulationRuntime.js', 'utf8'));
  const oldL = norm(fs.readFileSync('data/qa-studio/IndustrialLabLines-before-continuous-return.js', 'utf8'));
  const newL = norm(fs.readFileSync('src/editor/IndustrialLabLines.js', 'utf8'));
  const from = "      useful = belt.packages.length > 0 && (Math.abs(belt.actualSpeed || 0) > 1e-7 || belt.mechanismPhase !== 'ready');";
  const to = "      const waitingForOperator = ['waitingOperator', 'waitingManualAction'].includes(belt.mechanismPhase);\n      useful = belt.packages.length > 0 && (Math.abs(belt.actualSpeed || 0) > 1e-7 || !waitingForOperator && belt.mechanismPhase !== 'ready');";
  assert(oldR.includes(from)); assert.equal(newR, oldR.replace(from, to));
  const beforeRoute = "conveyor('Desvío · descarga del circuito', 'distributor', {length: 2.2, branchSide: 'right', routing: 'branch'})";
  const afterRoute = "conveyor('Desvío · descarga del circuito', 'distributor', {length: 2.2, branchSide: 'right', routing: continuous ? 'percentage' : 'branch', branchPercentage: continuous ? 90 : 50})";
  const beforeFeed = "source('Source · entrada al circuito rectangular')";
  const afterFeed = "source('Source · entrada al circuito rectangular', continuous ? {outputInterval: 6} : {})";
  assert(oldL.includes(beforeRoute) && oldL.includes(beforeFeed));
  assert.equal(newL, oldL.replace(beforeRoute, afterRoute).replace(beforeFeed, afterFeed));
  const before = JSON.parse(fs.readFileSync('data/qa-studio/manual-analytics-before.json', 'utf8'));
  const changed = Object.entries(before.files).filter(([file, hash]) => sha(fs.readFileSync(file)) !== hash).map(([file]) => file).sort();
  assert.deepEqual(changed, ['src/editor/IndustrialLabLines.js', 'src/editor/SimulationRuntime.js']);
  const method = /\n  productionRow\(record\) \{[\s\S]*?\n  \}/, marker = '\n  productionRow(record) { ANALYTICS_ONLY }';
  const physics = sha(newR.replace(method, marker)); assert.equal(physics, before.normalizedPhysicsHash);
  return {beforeBundleHash: before.bundleHash, changedFiles: changed, exactRuntimeReplacement: true, exactLabRecipeReplacement: true,
    normalizedPhysicsHash: physics, physicsUnchanged: true, allOtherAppSourcesByteIdentical: true,
    beforeRuntimeHash: sha(oldR), afterRuntimeHash: sha(newR), beforeLabRecipeHash: sha(oldL), afterLabRecipeHash: sha(newL),
    policy: 'Rerun Lab900 with 90% exit / 10% return and a 6s Source dispatch window. Reuse Sorting/Packing900 only with identical room documents. Targeted real manual-station analytics test and fresh final UI required.'};
}
module.exports = verify;
if (require.main === module) { const proof = verify(); fs.writeFileSync('data/qa-studio/continuous-amendment-source-proof.json', JSON.stringify(proof, null, 2)); console.log(JSON.stringify(proof)); }
