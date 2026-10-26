'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const root = path.resolve(__dirname, '..');

async function run() {
  // Exercise the actual dev-server routes without opening the user's database.
  let closes = 0;
  const api = (request, response) => response.json({storage: 'test'});
  api.close = () => { closes++; };
  const configModule = {exports: {}};
  const loadConfig = new Function('require', 'module', '__dirname', 'process', 'console',
    fs.readFileSync(path.join(root, 'webpack.config.js'), 'utf8'));
  loadConfig(name => name === './server/api.js' ? {createApiHandler: () => api} : require(name),
    configModule, root, {once() {}}, {log() {}});

  const app = express();
  const server = http.createServer(app);
  const application = configModule.exports.find(config => config.name === 'application');
  application.devServer.before(app, {listeningApp: server});
  // Match a GitHub Pages project site, which serves the app below a repository
  // prefix and has no Node API. Relative assets must remain below that prefix.
  app.use('/webxr-simulator', express.static(root));
  app.use(express.static(root));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const expected = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    for (const route of ['/', '/?editor', '/editor', '/editor?project=test-project&room=hall']) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-type'), /^text\/html/, route);
      assert.equal(await response.text(), expected, route);
    }
    const head = await fetch(origin + '/editor', {method: 'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(expected));
    assert.equal(await head.text(), '');

    for (const query of ['', '?project=test-project&room=hall', '?project=a%20b&room=hall']) {
      const response = await fetch(origin + '/editor/' + query, {redirect: 'manual'});
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/editor' + query);
    }
    for (const route of ['/editor/missing', '/editors', '/EDITOR', '/data/projects.sqlite', '/%64ata/projects.sqlite']) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 404, route);
    }

    assert.match(expected, /<base href="\.\/">/);
    const base = new URL('./', origin + '/editor');
    for (const resource of ['bundle.js', 'src/lib/StartupStatus.js', 'src/editor/editor.css', 'src/editor/projects.css', 'assets/loadingbg.jpg']) {
      const url = new URL(resource, base);
      assert.equal(url.pathname, '/' + resource);
      const response = await fetch(url, {method: 'HEAD'});
      assert.equal(response.status, 200, resource);
      assert(Number(response.headers.get('content-length')) > 0, resource);
      assert.doesNotMatch(response.headers.get('content-type'), /^text\/html/, resource);
    }
    for (const route of ['/webxr-simulator/', '/webxr-simulator/index.html?scene=lab-transfer-l']) {
      const response = await fetch(origin + route);
      assert.equal(await response.text(), expected);
      const projectBase = new URL('./', origin + route);
      for (const resource of ['bundle.js', 'src/lib/StartupStatus.js', 'src/editor/editor.css', 'assets/loadingbg.jpg']) {
        const url = new URL(resource, projectBase);
        assert.equal(url.pathname, '/webxr-simulator/' + resource);
        const asset = await fetch(url, {method: 'HEAD'});
        assert.equal(asset.status, 200, url.href);
        assert.doesNotMatch(asset.headers.get('content-type'), /^text\/html/);
      }
    }
    const health = await fetch(origin + '/api/health');
    assert.deepEqual(await health.json(), {storage: 'test'});
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  assert.equal(closes, 1);
  console.log('Editor HTTP routes: public root, exact /editor, canonical links and GitHub Pages subdirectory assets passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
