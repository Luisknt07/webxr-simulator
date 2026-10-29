import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {composeSelection} from '../../packages/core/index.js';
import {parseProject} from '../../packages/contracts/index.js';
import {discoverLocalModules} from '../../tooling/modules/discover.mjs';

const examples = new Set(['agricultura', 'turismo', 'educacion', 'alimentos']);
export async function runSectorExample(name = 'agricultura') {
  if (!examples.has(name)) throw new Error('Choose agricultura, turismo, educacion or alimentos.');
  const project = parseProject(await readFile(new URL(`../../projects/${name}/project.json`, import.meta.url), 'utf8'));
  const {catalog} = discoverLocalModules();
  const host = await composeSelection({catalog, worldId: project.worldId, selections: project.modules.map(module => ({moduleId: module.id, functions: module.functions}))});
  try {
    const inspection = host.inspectProject(project); if (inspection.components.some(component => component.status !== 'ready')) throw new Error('The example has an unavailable component.');
    let result;
    // These are application-owned demonstrations, not executable commands read
    // from a project manifest. Loading arbitrary JSON never runs this bootstrap.
    if (name === 'agricultura' || name === 'alimentos') {
      await host.dispatch('logistics.storage:transaction', {operations: [{type: 'add-location', location: {id: 'origin', capacityKg: 100, maxLoads: 5}}, {type: 'add-location', location: {id: 'cold-room', capacityKg: 100, maxLoads: 5}}]});
      if (name === 'agricultura') {
        await host.dispatch('agriculture.harvest:record', {id: 'mango-lot-1', crop: 'mango', lot: 'harvest-1', harvestDate: '2026-10-29', locationId: 'origin', quantity: 12, massKg: 20});
        const reservation = (await host.dispatch('logistics.storage:transaction', {operations: [{type: 'reserve', loadId: 'mango-lot-1', ownerId: 'operator-demo', toLocationId: 'cold-room'}]})).results[0];
        await host.dispatch('logistics.storage:transaction', {operations: [{type: 'commit', reservationId: reservation.id, ownerId: 'operator-demo'}]}); result = await host.dispatch('agriculture.harvest:harvests');
      } else { await host.dispatch('food.traceability:register-lot', {id: 'juice-lot-1', sku: 'juice', batch: 'batch-1', expires: '2027-01-01', locationId: 'cold-room', quantity: 6, massKg: 12}); result = await host.dispatch('food.traceability:trace', {loadId: 'juice-lot-1'}); }
    }
    if (name === 'turismo') { const route = project.entities[0].components[0].data; await host.dispatch('tourism.routes:configure', route); for (const point of route.points) await host.dispatch('tourism.routes:visit', {routeId: route.id, visitorId: 'guest-demo', position: point.position}); result = await host.dispatch('tourism.routes:progress', {routeId: route.id, visitorId: 'guest-demo'}); }
    if (name === 'educacion') { const assessment = project.entities[0].components[0].data; await host.dispatch('education.assessment:configure', assessment); result = await host.dispatch('education.assessment:submit', {assessmentId: assessment.id, learnerId: 'learner-demo', answers: {'stop-before-lifting': true, units: 0}}); }
    return {application: 'sector-demo', sector: name, result, status: host.status(), state: host.exportState()};
  } finally { await host.dispose(); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) console.log(JSON.stringify(await runSectorExample(process.argv[2]), null, 2));
