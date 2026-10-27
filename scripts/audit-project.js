'use strict';
// Executes the existing package test inventory without a shell. Reports are
// local QA artifacts; application databases and user projects are untouched.
const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..'), pkg = require('../package.json');
const args = process.argv.slice(2), option = (key, fallback) => { const item = args.find(value => value.startsWith('--' + key + '=')); return item ? item.slice(key.length + 3) : fallback; };
const concurrent = Math.max(1, Math.min(3, Number(option('jobs', 2)) || 2));
const include = option('include', ''), exclude = option('exclude', '');
const destination = path.resolve(ROOT, option('out', 'data/qa-studio/audit-project'));
if (!destination.startsWith(ROOT + path.sep)) throw Error('Audit reports must stay in this workspace.');
function expand(name, stack = []) {
  if (!pkg.scripts[name] || stack.includes(name)) throw Error('Invalid test script: ' + name);
  return pkg.scripts[name].split(/\s*&&\s*/).flatMap(command => {
    const words = command.trim().split(/\s+/);
    if (words[0] === 'npm' && words[1] === 'run' && words.length === 3) return expand(words[2], stack.concat(name));
    if (words.shift() !== 'node' || !words.some(word => /^scripts\/test-[\w-]+\.js$/.test(word)) || words.some(word => !/^[\w./=-]+$/.test(word))) throw Error('Unsupported test command: ' + command);
    return [words];
  });
}
const commands = [...new Map(expand('test').map(words => [words.join(' '), words])).values()].filter(words => {
  const value = words.join(' '); return (!include || new RegExp(include).test(value)) && (!exclude || !new RegExp(exclude).test(value));
});
fs.mkdirSync(destination, {recursive: true});
const started = new Date(), results = [], queue = commands.slice();
function save() {
  const bundle = path.join(ROOT, 'bundle.js');
  fs.writeFileSync(path.join(destination, 'report.json'), JSON.stringify({started: started.toISOString(), updated: new Date().toISOString(),
    bundleSha256: fs.existsSync(bundle) ? crypto.createHash('sha256').update(fs.readFileSync(bundle)).digest('hex') : null,
    total: commands.length, completed: results.length, passed: results.filter(result => result.status === 'passed').length,
    failed: results.filter(result => result.status !== 'passed').length, results}, null, 2));
}
async function worker() {
  while (queue.length) {
    const words = queue.shift(), file = words.find(word => word.endsWith('.js')), name = path.basename(file, '.js'), begin = Date.now();
    process.stdout.write('START ' + name + '\n');
    const result = await new Promise(resolve => {
      const output = fs.createWriteStream(path.join(destination, name + '.log'));
      const child = spawn(process.execPath, words, {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
      child.stdout.pipe(output, {end: false}); child.stderr.pipe(output, {end: false});
      child.once('error', error => { output.write(error.stack + '\n'); });
      child.once('close', (code, signal) => { output.end(); resolve({name, command: [process.execPath].concat(words), status: code === 0 ? 'passed' : 'failed', code, signal, milliseconds: Date.now() - begin}); });
    });
    results.push(result); save(); process.stdout.write(result.status.toUpperCase() + ' ' + name + ' ' + (result.milliseconds / 1000).toFixed(2) + 's\n');
  }
}
save(); Promise.all(Array.from({length: concurrent}, worker)).then(() => { save(); console.log(JSON.stringify({total: results.length, passed: results.filter(result => result.status === 'passed').length, failed: results.filter(result => result.status !== 'passed').length})); if (results.some(result => result.status !== 'passed')) process.exitCode = 1; }).catch(error => { console.error(error); process.exitCode = 1; });
