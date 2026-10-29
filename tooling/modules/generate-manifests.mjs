import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {discoverLocalModules, REPOSITORY} from './discover.mjs';
import {functionManifest} from '../../packages/contracts/index.js';

export async function generateManifests({root = REPOSITORY} = {}) {
  const discovery = discoverLocalModules({root}), base = path.join(discovery.root, 'modules');
  for (const module of discovery.modules) {
    const manifest = {format: 'smarttwin.sector', schemaVersion: 1, id: module.id, version: module.version, coreApi: module.coreApi, metadata: module.metadata, imports: module.imports,
      functions: module.functions.filter(entry => module.defaultFunctions.includes(entry.id)).map(entry => ({...functionManifest(entry), entry: entry.sectorEntry}))};
    await writeFile(path.join(base, module.metadata.folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const entry of module.functions) await writeFile(path.join(discovery.root, entry.packageDirectory, 'function-manifest.json'), JSON.stringify({format: 'smarttwin.function', schemaVersion: 1, ...functionManifest(entry), entry: entry.metadata.entry}, null, 2) + '\n');
  }
  return discovery.modules.length;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) console.log(`Wrote ${await generateManifests()} sector manifests.`);
