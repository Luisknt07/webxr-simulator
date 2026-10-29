import {createHost} from '../../packages/core/index.js';

// This application deliberately installs no sector, renderer, browser or assets.
const host = createHost({worldId: 'world.empty'});
if (host.status().functions.length || host.registry('systems').length) throw new Error('The empty core imported a sector.');
host.step(1 / 60);
console.log(JSON.stringify({application: 'core-empty', ...host.status()}));
await host.dispose();
