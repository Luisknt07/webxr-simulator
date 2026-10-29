export {validateAssessment, validateSubmission} from './schema.js';
export const authorizeAssessmentEdit = context => !!context && context.authenticated === true && Array.isArray(context.permissions) && context.permissions.includes('assessments.write');
