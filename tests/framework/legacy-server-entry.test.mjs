import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const entry = path.join(ROOT, 'tooling/build/run-webpack.js');
function fixture(t, source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smarttwin-legacy-entry-'));
  const preload = path.join(directory, 'probe.cjs'); fs.writeFileSync(preload, source);
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir())); assert(path.basename(resolved).startsWith('smarttwin-legacy-entry-'));
    fs.rmSync(resolved, {recursive:true});
  });
  return args => spawnSync(process.execPath, ['--require', preload, entry, ...args], {cwd:ROOT, encoding:'utf8', timeout:10000, windowsHide:true});
}

test('legacy default/explicit start fails before resolving, spawning or listening with a development server', t => {
  const run = fixture(t, `
    const Module = require('node:module'), net = require('node:net');
    const resolve = Module._resolveFilename;
    Module._resolveFilename = function(request, ...args) {
      if (String(request).includes('webpack-dev-server')) throw Error('FORBIDDEN_DEV_SERVER_RESOLUTION');
      return resolve.call(this, request, ...args);
    };
    require('node:child_process').spawnSync = () => { throw Error('FORBIDDEN_CHILD_SERVER'); };
    net.Server.prototype.listen = () => { throw Error('FORBIDDEN_NETWORK_LISTEN'); };
  `);
  for (const args of [[], ['start'], ['start', '--host', '0.0.0.0', '--port', '8080']]) {
    const result = run(args);
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 1);
    assert.match(result.stderr, /heredado está deshabilitado/); assert.match(result.stderr, /npm\.cmd run dev/); assert.match(result.stderr, /apps\/api\/index\.cjs/);
    assert.doesNotMatch(result.stderr, /FORBIDDEN_/); assert.equal(result.stdout, '');
  }
});

test('legacy build/watch retain compilation dispatch without resolving the development server', t => {
  const run = fixture(t, `
    const Module = require('node:module'), resolve = Module._resolveFilename;
    Module._resolveFilename = function(request, ...args) {
      if (String(request).includes('webpack-dev-server')) throw Error('FORBIDDEN_DEV_SERVER_RESOLUTION');
      return resolve.call(this, request, ...args);
    };
    require('node:child_process').spawnSync = (command, args, options) => {
      process.stdout.write(JSON.stringify({command, args, options})); return {status:0};
    };
  `);
  for (const [mode, flag] of [['build', '-p'], ['watch', '--watch']]) {
    const result = run([mode, '--config', 'synthetic-config.cjs']);
    assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, '');
    const call = JSON.parse(result.stdout);
    assert.equal(call.command, process.execPath); assert(call.args.some(argument => /webpack[\\/]bin[\\/]webpack\.js$/.test(argument)));
    assert.deepEqual(call.args.slice(-3), [flag, '--config', 'synthetic-config.cjs']); assert.equal(call.options.windowsHide, true);
  }
});

test('production entry remains importable without a development compiler or an implicit listener', () => {
  const source = `
    const Module = require('node:module'), load = Module._load;
    Module._load = function(request, ...args) {
      if (/^(?:webpack|webpack-dev-server)(?:\\/|$)/.test(request)) throw Error('FORBIDDEN_DEVELOPMENT_DEPENDENCY');
      return load.call(this, request, ...args);
    };
    require('node:net').Server.prototype.listen = () => { throw Error('FORBIDDEN_IMPLICIT_LISTENER'); };
    const api = require(process.argv[1]);
    if (typeof api.createApplication !== 'function') throw Error('MISSING_PRODUCTION_APPLICATION');
  `;
  const result = spawnSync(process.execPath, ['-e', source, path.join(ROOT, 'apps/api/index.cjs')], {cwd:ROOT, encoding:'utf8', timeout:10000, windowsHide:true});
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, ''); assert.equal(result.stdout, '');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node apps/api/index.cjs'); assert.equal(pkg.scripts.dev, 'node tooling/build/dev.cjs');
});
