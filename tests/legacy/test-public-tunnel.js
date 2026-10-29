'use strict';

const assert = require('node:assert/strict');
const Server = require('webpack-dev-server/lib/Server');
const createSocketUrl = require('webpack-dev-server/client/utils/createSocketUrl');
const application = require('../../tooling/build/webpack.legacy.cjs').find(config => config.name === 'application');
const options = application.devServer;
const workspace = require('../../.vscode/settings.json');
assert.equal(workspace['remote.portsAttributes']['8080'].protocol, 'https',
  'VS Code forwards the local HTTPS service using TLS, not plain HTTP.');

// Exercise the real webpack-dev-server host/origin validator without starting
// its middleware or opening the application's database.
const server = Object.assign(Object.create(Server.prototype), {
  allowedHosts: options.allowedHosts, disableHostCheck: !!options.disableHostCheck,
  hostname: '0.0.0.0'
});
assert.equal(server.disableHostCheck, false, 'Host validation stays enabled.');
for (const host of ['localhost:8080', '127.0.0.1:8080', '192.168.1.25:8080',
  'tdv5t4s7-8080.use.devtunnels.ms', 'another-8080.devtunnels.ms']) {
  assert.equal(server.checkHost({host}), true, host);
  assert.equal(server.checkOrigin({origin: 'https://' + host}), true, host);
}
for (const host of ['attacker.invalid', 'evildevtunnels.ms',
  'tdv5t4s7-8080.use.devtunnels.ms.attacker.invalid']) {
  assert.equal(server.checkHost({host}), false, host);
  assert.equal(server.checkOrigin({origin: 'https://' + host}), false, host);
}
assert.equal(server.checkHost({}), false);
assert.equal(options.sockPort, 'location');
const query = '?https://0.0.0.0:8080&sockPort=' + options.sockPort;
assert.equal(createSocketUrl(query, 'https://tdv5t4s7-8080.use.devtunnels.ms/'),
  'https://tdv5t4s7-8080.use.devtunnels.ms/sockjs-node');
assert.equal(createSocketUrl(query, 'https://localhost:8080/'), 'https://localhost:8080/sockjs-node');
assert.equal(createSocketUrl(query, 'https://192.168.1.25:8080/'), 'https://192.168.1.25:8080/sockjs-node');
assert.equal(application.devServer.injectClient({target: 'webworker'}), false);
console.log('Public tunnels: bounded real Host/Origin validation and same-origin live-reload sockets passed.');
