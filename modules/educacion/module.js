import {defineModule, localFunction} from '../../packages/module-sdk/index.js';
import {assessmentManifest, sectorManifest} from './manifest.js';
export function createEducationModule(extraFunctions = []) { return defineModule({...sectorManifest, functions: [localFunction(assessmentManifest, () => import('./functions/evaluacion/index.js')), ...extraFunctions]}); }
export default createEducationModule();
