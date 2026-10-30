import {defineFunction} from '../../packages/contracts/index.js';
import SimulationRuntime from '../../modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js';
import VehicleDriving from '../../modules/logistica-industrial/functions/montacargas/runtime/VehicleDriving.js';
import IndustrialVisuals from '../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialVisuals.js';
import CollisionWorld from '../../packages/render-three/src/CollisionWorld.js';

export const DEMO_FUNCTION_ID = 'smarttwin/public-demo/logistics';
export const DEMO_MODULE_ID = 'smarttwin/public-demo';

/** The app selects this one local function. It reuses the tested logistics
 * runtime without constructing an editor, Studio connection or native room. */
export const demoFunction = defineFunction({
  id: DEMO_FUNCTION_ID, version: '1.0.0', capabilities: ['platform.scene', 'platform.document'],
  metadata: {title: 'Robot, banda y montacargas', legacyAdapter: true},
  register(scope) {
    const ctx = scope.port('platform.scene'), document = scope.port('platform.document');
    const collision = new CollisionWorld(ctx, document); ctx.collisionWorld = collision;
    const simulation = new SimulationRuntime(ctx, document, ctx.notify);
    const driving = new VehicleDriving(ctx, simulation, {notify: ctx.notify});
    const visuals = new IndustrialVisuals(ctx, document, simulation);
    const session = {
      simulation, driving, visuals, paused: false,
      step(delta) {
        if (session.paused) return;
        driving.beforeStep(); simulation.execute(delta); driving.follow(); visuals.sync(document.roomId, delta, false);
      },
      restart() {driving.unmount(true); simulation.start(document.roomId); session.paused = false; visuals.dirty = true;},
      setPaused(value) {session.paused = !!value; driving.resetInput(); if (session.paused) simulation.releaseHeldProducts();},
      stats() {
        const robot = Array.from(simulation.records.values()).find(record => record.components.robot);
        const vehicle = Array.from(simulation.records.values()).find(record => record.components.vehicle);
        const belt = vehicle && simulation.records.get(vehicle.components.vehicle.config.sourceId) || Array.from(simulation.records.values()).find(record => record.components.conveyor);
        return {time: simulation.time, running: simulation.running, paused: session.paused, products: simulation.products.size,
          robot: robot ? {id: robot.id, phase: robot.components.robot.phase, completed: robot.components.robot.completed || 0, warning: robot.components.robot.warning || ''} : null,
          belt: belt ? {id: belt.id, running: belt.components.conveyor.running, packages: belt.components.conveyor.packages.length, blocked: belt.components.conveyor.transferBlocked} : null,
          vehicle: vehicle ? {id: vehicle.id, carrying: !!vehicle.components.vehicle.entry, delivered: vehicle.components.vehicle.delivered || 0, driving: driving.id === vehicle.id} : null};
      }
    };
    // Register cleanup before any attach/start operation can throw.
    scope.onDispose(() => {driving.dispose(); visuals.dispose(); simulation.stop(); if (ctx.collisionWorld === collision) delete ctx.collisionWorld; if (ctx.demo === session) delete ctx.demo;});
    scope.register('systems', 'logistics', session);
    ctx.demo = session; simulation.start(document.roomId); visuals.sync(document.roomId, 0, false);
  }
});

export const demoModule = {id: DEMO_MODULE_ID, version: '1.0.0', functions: [
  {id: DEMO_FUNCTION_ID, version: '1.0.0', capabilities: demoFunction.capabilities, metadata: demoFunction.metadata, load: () => Promise.resolve(demoFunction)}
]};
