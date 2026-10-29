// These modules contain metadata/local loader callbacks only. No function runtime
// is imported until the core resolves an explicit selection and its dependencies.
import logistics from './logistica-industrial/module.js';
import agriculture from './agricultura/module.js';
import tourism from './turismo/module.js';
import education from './educacion/module.js';
import food from './alimentos/module.js';
export const sectorModules = Object.freeze([logistics, agriculture, tourism, education, food]);
export default sectorModules;
