export {validateRoute, validateVisit} from './schema.js';
export const authorizeRouteEdit = context => !!context && context.authenticated === true && Array.isArray(context.permissions) && context.permissions.includes('routes.write');
