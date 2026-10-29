import {defineModule, localFunction} from '../../packages/module-sdk/index.js';
import {storageManifest, sectorManifest} from './manifest.js';
export function createLogisticsModule(extraFunctions = []) { return defineModule({...sectorManifest, functions: [localFunction(storageManifest, () => import('./functions/almacenamiento/index.js')), ...extraFunctions]}); }
export const storageModule = createLogisticsModule();
export default storageModule;
