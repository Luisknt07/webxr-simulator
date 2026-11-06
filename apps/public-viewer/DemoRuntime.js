import {defineFunction} from '../../packages/contracts/index.js';
import SimulationRuntime from '../../modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js';
import VehicleDriving from '../../modules/logistica-industrial/functions/montacargas/runtime/VehicleDriving.js';
import IndustrialVisuals from '../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialVisuals.js';
import CollisionWorld from '../../packages/render-three/src/CollisionWorld.js';
import EquipmentStudyViewer from '../../modules/logistica-industrial/functions/presentacion/runtime/EquipmentStudyViewer.js';
import LineMonitorSystem from '../../modules/logistica-industrial/functions/almacenamiento/runtime/LineMonitorSystem.js';
import * as THREE from 'three';
import seedPublicDemoStock from '../../projects/smarttwin/PublicDemoStock.cjs';

export const DEMO_FUNCTION_ID = 'smarttwin/public-demo/logistics';
export const DEMO_MODULE_ID = 'smarttwin/public-demo';

/** The app selects this one local function. It reuses the tested logistics
 * runtime without constructing an editor, Studio connection or native room. */
export const demoFunction = defineFunction({
  id: DEMO_FUNCTION_ID, version: '1.0.0', capabilities: ['platform.scene', 'platform.document'],
  metadata: {title: 'Dos robots y sistemas logísticos conectados', legacyAdapter: true},
  register(scope) {
    const ctx = scope.port('platform.scene'), document = scope.port('platform.document');
    const collision = new CollisionWorld(ctx, document); ctx.collisionWorld = collision;
    const simulation = new SimulationRuntime(ctx, document, ctx.notify);
    const driving = new VehicleDriving(ctx, simulation, {notify: ctx.notify});
    const visuals = new IndustrialVisuals(ctx, document, simulation);
    const equipmentStudy = new EquipmentStudyViewer(ctx, document, simulation, {notify:ctx.notify});
    const monitors = new LineMonitorSystem(ctx, document, simulation);
    const session = {
      simulation, driving, visuals, equipmentStudy, monitors, paused: false,
      step(delta) {
        equipmentStudy.update(delta);
        monitors.sync(document.roomId, delta, false);
        if (session.paused) return;
        driving.beforeStep(); simulation.execute(delta); driving.follow(); visuals.sync(document.roomId, delta, false);
      },
      restart() {equipmentStudy.close(); driving.unmount(true); simulation.start(document.roomId); seedPublicDemoStock(THREE, simulation); session.paused = false; visuals.dirty = true;},
      setPaused(value) {session.paused = !!value; driving.resetInput(); if (session.paused) simulation.releaseHeldProducts();},
      stats() {
        const records = Array.from(simulation.records.values()), robotRecords = records.filter(record => record.components.robot);
        const robots = robotRecords.map(record => ({id: record.id, phase: record.components.robot.phase, completed: record.components.robot.completed || 0, warning: record.components.robot.warning || ''}));
        const vehicle = Array.from(simulation.records.values()).find(record => record.components.vehicle);
        const belt = vehicle && simulation.records.get(vehicle.components.vehicle.config.sourceId) || Array.from(simulation.records.values()).find(record => record.components.conveyor);
        const palletizer=Array.from(simulation.records.values()).find(record=>record.components.palletQueue&&record.components.palletQueue.config.palletize),assembly=palletizer&&palletizer.components.palletQueue;
        return {time: simulation.time, running: simulation.running, paused: session.paused, products: simulation.products.size,
          robot: robots[0] || null, robots,
          racks: records.filter(record => record.components.palletQueue && record.components.palletQueue.config.rackSystem).length,
          monitors: monitors.entries.size,
          belt: belt ? {id: belt.id, running: belt.components.conveyor.running, packages: belt.components.conveyor.packages.length, blocked: belt.components.conveyor.transferBlocked} : null,
          palletizer:assembly?{completed:assembly.assembly.completed,cartons:assembly.received,perPallet:assembly.config.capacity,limit:assembly.config.palletizeLimit}:null,
          vehicle: vehicle ? {id: vehicle.id, carrying: !!vehicle.components.vehicle.entry, delivered: vehicle.components.vehicle.delivered || 0, driving: driving.id === vehicle.id} : null};
      }
    };
    // Register cleanup before any attach/start operation can throw.
    scope.onDispose(() => {monitors.dispose();equipmentStudy.dispose();driving.dispose(); visuals.dispose(); simulation.stop(); if (ctx.collisionWorld === collision) delete ctx.collisionWorld; if (ctx.demo === session) delete ctx.demo;});
    scope.register('systems', 'logistics', session);
    ctx.demo = session; simulation.start(document.roomId); seedPublicDemoStock(THREE, simulation); visuals.sync(document.roomId, 0, false);
  }
});

export const demoModule = {id: DEMO_MODULE_ID, version: '1.0.0', functions: [
  {id: DEMO_FUNCTION_ID, version: '1.0.0', capabilities: demoFunction.capabilities, metadata: demoFunction.metadata, load: () => Promise.resolve(demoFunction)}
]};
