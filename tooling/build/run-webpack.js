'use strict';
// Keep legacy compile/watch commands, without reopening the repository-root
// development server that bypasses the standalone application's boundaries.
const mode = process.argv[2] || 'start';
if (mode === 'start') {
  console.error('El servidor de desarrollo heredado está deshabilitado. Usa npm.cmd run dev o el servidor independiente apps/api/index.cjs.');
  process.exit(1);
}
const {spawnSync} = require('node:child_process');
const commands = {
  build: ['webpack/bin/webpack.js', '-p'],
  watch: ['webpack/bin/webpack.js', '--watch']
};
if (!commands[mode]) throw new Error('Unknown webpack command: ' + mode);
const [entry, ...args] = commands[mode];
const flags = Number(process.versions.node.split('.')[0]) >= 17 ? ['--openssl-legacy-provider'] : [];
const result = spawnSync(process.execPath, flags.concat(require.resolve(entry), args, process.argv.slice(3)), {stdio: 'inherit', windowsHide:true});
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status === null ? 1 : result.status);
