'use strict';
// Executes the existing package test inventory without a shell. Reports are
// local QA artifacts; application databases and user projects are untouched.
const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..'), pkg = require('../../package.json');
const args = process.argv.slice(2), option = (key, fallback) => { const item = args.find(value => value.startsWith('--' + key + '=')); return item ? item.slice(key.length + 3) : fallback; };
const concurrent = Math.max(1, Math.min(3, Number(option('jobs', 2)) || 2));
const suite = option('suite', 'test:legacy');
const include = option('include', ''), exclude = option('exclude', '');
const destination = path.resolve(ROOT, option('out', 'data/qa-restructure/audit-project'));
if (!destination.startsWith(ROOT + path.sep)) throw Error('Audit reports must stay in this workspace.');
function expand(name, stack = []) {
  if (!pkg.scripts[name] || stack.includes(name)) throw Error('Invalid test script: ' + name);
  return pkg.scripts[name].split(/\s*&&\s*/).flatMap(command => {
    const words = command.trim().split(/\s+/);
    if (words[0] === 'npm' && words[1] === 'run' && words.length === 3) return expand(words[2], stack.concat(name));
    if (words.shift() !== 'node') throw Error('Unsupported test command: ' + command);
    const file = words.pop();
    if (!/^tests\/legacy\/test-[\w-]+\.js$/.test(file || '') || words.some(word => word !== '--experimental-vm-modules') || !fs.existsSync(path.join(ROOT, file))) throw Error('Unsupported test command: ' + command);
    return [words.concat(file)];
  });
}
const inventory = [...new Map(expand(suite).map(words => [words.join(' '), words])).values()];
const commands = inventory.filter(words => {
  const value = words.join(' '); return (!include || new RegExp(include).test(value)) && (!exclude || !new RegExp(exclude).test(value));
});
if (args.includes('--list')) { console.log(JSON.stringify({suite, inventory: inventory.length, selected: commands.length, excluded: inventory.filter(words => !commands.includes(words)).map(words => words.join(' '))})); process.exit(0); }
if (fs.existsSync(path.join(destination, 'report.json'))) throw Error('Choose a new --out directory to preserve the previous audit report.');
fs.mkdirSync(destination, {recursive: true});
const started = new Date(), results = [], queue = commands.slice();
const sha = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const artifacts = () => Object.fromEntries(['artifacts/workspace/bundle.js', 'artifacts/public-viewer/viewer.js', 'artifacts/core-empty/core-empty.js'].map(file => [file, sha(path.join(ROOT, file))]));
const artifactHashesAtStart = artifacts(), packageSha256 = sha(path.join(ROOT, 'package.json'));
let finished = null, artifactHashesAtFinish = null;
function save() {
  fs.writeFileSync(path.join(destination, 'report.json'), JSON.stringify({suite, started: started.toISOString(), updated: new Date().toISOString(), finished, node: process.version, packageSha256,
    include, exclude, inventory: inventory.length, excluded: inventory.filter(words => !commands.includes(words)).map(words => words.join(' ')), artifactHashesAtStart, artifactHashesAtFinish,
    total: commands.length, completed: results.length, passed: results.filter(result => result.status === 'passed').length,
    failed: results.filter(result => result.status !== 'passed').length, results}, null, 2));
}
async function worker() {
  while (queue.length) {
    const words = queue.shift(), file = words.find(word => word.endsWith('.js')), name = path.basename(file, '.js'), begin = Date.now();
    const scriptSha256Before = sha(path.join(ROOT, file));
    process.stdout.write('START ' + name + '\n');
    const result = await new Promise(resolve => {
      const output = fs.createWriteStream(path.join(destination, name + '.log'));
      const child = spawn(process.execPath, words, {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
      child.stdout.pipe(output, {end: false}); child.stderr.pipe(output, {end: false});
      child.once('error', error => { output.write(error.stack + '\n'); });
      child.once('close', (code, signal) => { const scriptSha256After = sha(path.join(ROOT, file)); output.end(() => resolve({name, command: [process.execPath].concat(words), pid: child.pid, status: code === 0 && scriptSha256After === scriptSha256Before ? 'passed' : 'failed', code, signal, scriptSha256Before, scriptSha256After, milliseconds: Date.now() - begin})); });
    });
    results.push(result); save(); process.stdout.write(result.status.toUpperCase() + ' ' + name + ' ' + (result.milliseconds / 1000).toFixed(2) + 's\n');
  }
}
save(); Promise.all(Array.from({length: concurrent}, worker)).then(() => { finished = new Date().toISOString(); artifactHashesAtFinish = artifacts(); save(); console.log(JSON.stringify({total: results.length, passed: results.filter(result => result.status === 'passed').length, failed: results.filter(result => result.status !== 'passed').length})); if (results.some(result => result.status !== 'passed')) process.exitCode = 1; }).catch(error => { console.error(error); process.exitCode = 1; });
