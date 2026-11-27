import {defineFunction} from '../../packages/contracts/index.js';
import SimulationRuntime from '../../modules/logistica-industrial/functions/flujo-materiales/runtime/SimulationRuntime.js';
import VehicleDriving from '../../modules/logistica-industrial/functions/montacargas/runtime/VehicleDriving.js';
import IndustrialVisuals from '../../modules/logistica-industrial/functions/presentacion/runtime/IndustrialVisuals.js';
import CollisionWorld from '../../packages/render-three/src/CollisionWorld.js';
import EquipmentStudyViewer from '../../modules/logistica-industrial/functions/presentacion/runtime/EquipmentStudyViewer.js';
import LineMonitorSystem from '../../modules/logistica-industrial/functions/almacenamiento/runtime/LineMonitorSystem.js';
import * as THREE from 'three';
import seedPublicDemoStock from '../../projects/smarttwin/PublicDemoStock.cjs';
import DemoVehicleEntry from './DemoVehicleEntry.js';
import VehicleFacilityView from '../../modules/logistica-industrial/functions/montacargas/runtime/VehicleFacilityView.js';
import PublicDemoOperations from '../../projects/smarttwin/PublicDemoOperations.js';
import PublicDemoReceptionDisplay from '../../projects/smarttwin/PublicDemoReceptionDisplay.js';
import {PresentationGuard} from './SceneResilience.js';
import BehaviorRuntime from '../../packages/tools/editor/src/BehaviorRuntime.js';

export const DEMO_FUNCTION_ID = 'smarttwin/public-demo/logistics';
export const DEMO_MODULE_ID = 'smarttwin/public-demo';

/** The app selects this one local function. It reuses the tested logistics
 * runtime without constructing an editor, Studio connection or native room. */
export const demoFunction = defineFunction({
  id: DEMO_FUNCTION_ID, version: '1.0.0', capabilities: ['platform.scene', 'platform.document'],
  metadata: {title: 'Robot, transferencia de cajas y recorrido interactivo', legacyAdapter: true},
  register(scope) {
    const ctx = scope.port('platform.scene'), document = scope.port('platform.document');
    const collision = new CollisionWorld(ctx, document); ctx.collisionWorld = collision;
    const simulation = new SimulationRuntime(ctx, document, ctx.notify);
    const operations=new PublicDemoOperations(simulation);
    const facilityView=new VehicleFacilityView(ctx);
    const driving = new VehicleDriving(ctx, simulation, {notify: ctx.notify,keepCabWarm:true,lightweightCab:true,quickStartOnEntry:true,facilityView});
    const visuals = new IndustrialVisuals(ctx, document, simulation);
    const equipmentStudy = new EquipmentStudyViewer(ctx, document, simulation, {notify:ctx.notify});
    const monitors = new LineMonitorSystem(ctx, document, simulation,{extension:new PublicDemoReceptionDisplay(operations)});
    const vehicleEntry=new DemoVehicleEntry(ctx,simulation,driving);
    // Reuse the existing contextual-message and behavior engine, with only
    // these two presentation behaviors and no authoring/library capabilities.
    const interactionTypes=new Set(['info','hingeDoor']);
    const interactions=new BehaviorRuntime(ctx,{getObjects:room=>document.getObjects(room).filter(object=>document.getBehaviors(object).some(value=>interactionTypes.has(value.type))),
      getBehaviors:object=>document.getBehaviors(object).filter(value=>interactionTypes.has(value.type))},null,ctx.notify);
    const presentation=new PresentationGuard({onError(record,error){console.warn('Public display ('+record.name+'):',error);if(record.disabled&&ctx.notify)ctx.notify('Se desactivó temporalmente '+record.name+'. La simulación continúa.');}});
    const session = {
      simulation, driving, visuals, equipmentStudy, monitors, vehicleEntry, presentation, interactions, operations,paused: false,
      step(delta) {
        presentation.run('los mensajes y las puertas',()=>interactions.execute(delta,simulation.time));
        presentation.run('la ficha de equipos',()=>equipmentStudy.update(delta));
        presentation.run('los monitores de producción',()=>monitors.sync(document.roomId,delta,false));
        presentation.run('el acceso a la cabina',()=>vehicleEntry.sync());
        if (session.paused) return;
        try{driving.beforeStep();}catch(error){error.smartTwinStage='controles del montacargas';throw error;}
        try{operations.step(delta);simulation.execute(delta);}catch(error){error.smartTwinStage='flujo de materiales';throw error;}
      },
      // The host can execute several 60 Hz physical steps per browser frame.
      // Follow the final pose and validate the draw banks once before rendering.
      present(delta) {
        if(session.paused)return;
        try{driving.follow();}catch(error){error.smartTwinStage='vista de la cabina';throw error;}
        presentation.run('los indicadores visuales',()=>visuals.sync(document.roomId,delta,false));
        simulation.syncNativePresentation();
      },
      restart() {interactions.stop();equipmentStudy.close(); driving.unmount(true); simulation.start(document.roomId); seedPublicDemoStock(THREE, simulation);operations.reset();interactions.start(document.roomId);monitors.invalidate(); presentation.reset(); session.paused = false; visuals.dirty = true;},
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
    scope.onDispose(() => {interactions.stop();vehicleEntry.dispose();monitors.dispose();equipmentStudy.dispose();driving.dispose();facilityView.dispose(); visuals.dispose(); simulation.stop(); if (ctx.collisionWorld === collision) delete ctx.collisionWorld; if (ctx.demo === session) delete ctx.demo;});
    scope.register('systems', 'logistics', session);
    // Explicit opt-in for this read-only lesson. Reuse the runtime's existing
    // rig-aware render banks and actor-local immutable microfinish pooling.
    simulation.nativeManufacturedBatching=true;
    ctx.demo = session; simulation.start(document.roomId); seedPublicDemoStock(THREE, simulation);interactions.start(document.roomId); visuals.sync(document.roomId, 0, false);simulation.syncNativePresentation();
    driving.prepareCab(Array.from(simulation.records.values()).find(record=>record.components.vehicle));
  }
});

export const demoModule = {id: DEMO_MODULE_ID, version: '1.0.0', functions: [
  {id: DEMO_FUNCTION_ID, version: '1.0.0', capabilities: demoFunction.capabilities, metadata: demoFunction.metadata, load: () => Promise.resolve(demoFunction)}
]};
