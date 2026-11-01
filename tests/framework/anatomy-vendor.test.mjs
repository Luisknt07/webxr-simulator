import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const vendor = new URL('../../packages/tools/anatomy/vendor/anatomy/', import.meta.url);
test('the retired standalone Anatomy workshop is absent from the default editor package and catalog', async () => {
  const manifest=JSON.parse(await readFile(new URL('../../packages/tools/anatomy/tool.json',import.meta.url),'utf8'));
  assert.equal(manifest.retired,true);
  const {discoverEditorTools}=createRequire(import.meta.url)('../../tooling/build/editor-tools.cjs');
  const result=discoverEditorTools(fileURLToPath(new URL('../../',import.meta.url)));
  assert(!result.catalog.tools.some(tool=>tool.id==='anatomy'));
  assert(!result.files.some(file=>file.startsWith('packages/tools/anatomy/')));
});
test('Every vendored upstream file is pinned, licensed and byte-identical to its import manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('VENDOR.json', vendor), 'utf8'));
  assert.equal(manifest.commit, '1482e8469b0a9e0d8cc18ea2740a01423d29ae80');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.files.filter(file => file.path.startsWith('kit/')).length, 16);
  assert.equal(manifest.files.length, 160);
  assert.ok((await readFile(new URL('LICENSE', vendor), 'utf8')).includes('Copyright (c) 2026 Ryan'));
  assert.ok(!manifest.files.some(file => /^(\.git\/|\.github\/|agents\/)/.test(file.path)));
  for (const file of manifest.files) {
    assert.match(file.path, /^[\w./-]+$/);
    assert.ok(!file.path.split('/').includes('..'));
    const bytes = await readFile(new URL(file.path, vendor));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
    assert.equal(bytes.length, file.bytes, file.path);
  }
  for (const name of ['test-rig', 'spot-plate']) assert.ok((await stat(new URL('examples/' + name, vendor))).isDirectory());
});
