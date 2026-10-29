export {validateHarvest} from './schema.js';
export const authorizeHarvest = context => !!context && context.authenticated === true && Array.isArray(context.permissions) && context.permissions.includes('harvest.write');
