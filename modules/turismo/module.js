import {defineModule, localFunction} from '../../packages/module-sdk/index.js';
import {routesManifest, sectorManifest} from './manifest.js';
export function createTourismModule(extraFunctions = []) { return defineModule({...sectorManifest, functions: [localFunction(routesManifest, () => import('./functions/recorridos/index.js')), ...extraFunctions]}); }
export default createTourismModule();
