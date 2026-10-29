export {validateFoodLot} from './schema.js';
export const authorizeFoodWrite = context => !!context && context.authenticated === true && Array.isArray(context.permissions) && context.permissions.includes('food.write');
