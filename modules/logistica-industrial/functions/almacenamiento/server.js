// The server installs this trusted validator explicitly; project JSON cannot add routes.
export {validateInventoryRequest} from './schema.js';
export function authorizeInventoryWrite(context) { return !!context && context.authenticated === true && context.permissions && context.permissions.includes('inventory.write'); }
