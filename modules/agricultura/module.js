import {defineModule, localFunction} from '../../packages/module-sdk/index.js';
import {harvestManifest, sectorManifest} from './manifest.js';
export function createAgricultureModule(extraFunctions = []) { return defineModule({...sectorManifest, functions: [localFunction(harvestManifest, () => import('./functions/cosecha/index.js')), ...extraFunctions]}); }
export default createAgricultureModule();
