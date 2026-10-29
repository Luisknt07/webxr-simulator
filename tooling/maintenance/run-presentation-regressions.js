const __layout = require("../layout.cjs");
'use strict';
// Resume the npm chain after the already recorded prefix, preserving its order
// and failing on the first command error. This is a QA runner, not a product task.
const {spawn} = require('node:child_process'), fs = require('node:fs'), path = require('node:path');
const commands = require('../../package.json').scripts.test.split(' && ');
const first = commands.findIndex(command => command.includes('test-industrial-lab.js'));
if (first < 0) throw new Error('Missing regression boundary.');
const result = {started: new Date().toISOString(), prefixLog: 'full-suite-presentation.log', boundary: commands[first], completed: []};
const file = __layout.map(path.resolve(__layout.oldDir("scripts/run-presentation-regressions.js"), '../data/qa-studio/presentation-regressions.json'));
(async () => {
  for (const command of commands.slice(first)) {
    const args = command.split(' '); if (args.shift() !== 'node') throw new Error('Unsupported test command.');
    const started = Date.now(), status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {cwd: __layout.map(path.resolve(__layout.oldDir("scripts/run-presentation-regressions.js"), '..')), stdio: 'inherit', windowsHide: true});
      child.once('error', reject); child.once('exit', code => resolve(code));
    });
    result.completed.push({command, status, seconds: (Date.now() - started) / 1000});
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    if (status !== 0) throw new Error(command + ' failed with ' + status);
  }
  result.passed = true; result.finished = new Date().toISOString(); fs.writeFileSync(file, JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
