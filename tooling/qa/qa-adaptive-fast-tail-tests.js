const __layout = require("../layout.cjs");
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {spawnSync} = require('node:child_process');
const root = __layout.map(path.resolve(__layout.oldDir("scripts/qa-adaptive-fast-tail-tests.js"), '..')), output = __layout.map(path.join(root, 'data/qa-studio'));
const commands = require('../../package.json').scripts.test.split(' && ');
const first = commands.indexOf("node tests/legacy/test-smooth-grade-support.js"), last = commands.indexOf("node tests/legacy/test-industrial-equipment-upgrade.js");
assert(first >= 0 && last >= first); const selected = commands.slice(first, last + 1); assert.equal(selected.length, 20);
fs.mkdirSync(output, {recursive: true}); const logFile = __layout.map(path.join(output, 'adaptive-fast-tail-tests.log')), reportFile = __layout.map(path.join(output, 'adaptive-fast-tail-tests.json'));
const report = {startedAt: new Date().toISOString(), finishedAt: null, tests: []}; fs.writeFileSync(logFile, 'Sequential regression tail, 20 tests; no graphics suite.\n');
for (const command of selected) {
  const args = command.split(' '); assert.equal(args.shift(), 'node'); assert(args.every(value => !value.includes('..')));
  const start = Date.now(), result = spawnSync(process.execPath, args, {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true});
  const row = {command, exitCode: result.status, signal: result.signal, elapsedMs: Date.now() - start, passed: result.status === 0, error: result.error && result.error.message || null}; report.tests.push(row);
  fs.appendFileSync(logFile, '\n' + command + '\n' + (result.stdout || '') + (result.stderr || '') + JSON.stringify(row) + '\n');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); console.log((row.passed ? 'PASS ' : 'FAIL ') + command + ' (' + row.elapsedMs + ' ms)');
}
report.finishedAt = new Date().toISOString(); report.passed = report.tests.every(row => row.passed); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); process.exitCode = report.passed ? 0 : 1;
