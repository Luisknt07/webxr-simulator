'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..'), seen = new Set(), queue = ['apps/core-empty/browser.js'];
while (queue.length) {
  const relative = queue.pop(); if (seen.has(relative)) continue; seen.add(relative);
  const file = path.join(ROOT, relative); assert(fs.existsSync(file), 'Missing static dependency: ' + relative);
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*|require\s*\()\s*['"]([^'"]+)['"]/g)) {
    if (!match[1].startsWith('.')) continue;
    let dependency = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])); if (!path.extname(dependency)) dependency += '.js'; queue.push(dependency);
  }
}
assert([...seen].every(file => file.startsWith('packages/') || file === 'apps/core-empty/browser.js'));
assert(![...seen].some(file => /modules\/|workspace\/|server\/|SceneEditor|SceneDocument|StudioExperience|CAD|AssetLibrary|assets\.js/.test(file)), 'The core browser graph must be independent of industry, authoring and backend.');
const viewer = fs.readFileSync(path.join(ROOT, 'apps/public-viewer/main.js'), 'utf8');
assert(viewer.includes('createBrowserHost')); assert(!/new THREE\.WebGLRenderer|\.setAnimationLoop\(/.test(viewer), 'The public app must use the shared browser adapter.');
const browserHost = fs.readFileSync(path.join(ROOT, 'packages/render-three/BrowserHost.js'), 'utf8');
assert.equal((browserHost.match(/setAnimationLoop\(frame\)/g) || []).length, 1);
console.log(JSON.stringify({app: 'core-empty.browser',localModules: seen.size,sectorImports: 0,sharedLoop: true,files: [...seen].sort()}));
