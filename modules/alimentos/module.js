import {defineModule, localFunction} from '../../packages/module-sdk/index.js';
import {traceabilityManifest, sectorManifest} from './manifest.js';
export function createFoodModule(extraFunctions = []) { return defineModule({...sectorManifest, functions: [localFunction(traceabilityManifest, () => import('./functions/trazabilidad/index.js')), ...extraFunctions]}); }
export default createFoodModule();
