export const storageManifest = Object.freeze({id: 'logistics.storage', version: '1.0.0', stateVersion: 1, provides: [{id: 'world.inventory', version: '1.0.0'}],
  metadata: {title: 'Almacenamiento', mode: 'logical-inventory', packageRoot: 'functions/almacenamiento', manifestExport: 'storageManifest', entry: 'index.js',
    schema: 'schema.js', server: 'server.js', migration: 'migrations.js', ui: 'ui.js', assets: [], tests: ['contract.test.mjs'],
    files: ['index.js', 'manifest.js', 'service.js', 'schema.js', 'server.js', 'migrations.js', 'ui.js', 'contract.test.mjs']}});
