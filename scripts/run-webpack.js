// Keep the original webpack 4 / Three.js runtime, including on current Node LTS.
const {spawnSync} = require('child_process');
const mode = process.argv[2] || 'start';
const commands = {
  start: ['webpack-dev-server/bin/webpack-dev-server.js', '-d', '--https', '--host', '0.0.0.0'],
  build: ['webpack/bin/webpack.js', '-p'],
  watch: ['webpack/bin/webpack.js', '--watch']
};
if (!commands[mode]) throw new Error('Unknown webpack command: ' + mode);
const [entry, ...args] = commands[mode];
const flags = Number(process.versions.node.split('.')[0]) >= 17 ? ['--openssl-legacy-provider'] : [];
const result = spawnSync(process.execPath, flags.concat(require.resolve(entry), args, process.argv.slice(3)), {stdio: 'inherit'});
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status === null ? 1 : result.status);
