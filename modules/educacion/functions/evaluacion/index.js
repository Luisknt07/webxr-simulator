import {defineFunction} from '../../../../packages/module-sdk/index.js';
import {cloneData, fail} from '../../../../packages/contracts/index.js';
import {assessmentManifest} from '../../manifest.js';
import {validateAssessment, validateSubmission} from './schema.js';
import {authorizeAssessmentEdit} from './server.js';
import {migrateAssessmentState} from './migrations.js';
import {assessmentPanel} from './ui.js';
export default defineFunction({...assessmentManifest, register(scope) {
  let state = scope.state.get() || {assessments: [], submissions: []}; const save = next => { scope.state.set(next); state = next; };
  scope.register('commands', 'configure', input => { const assessment = validateAssessment(input); if (state.assessments.some(item => item.id === assessment.id)) fail('duplicate_assessment', 'Use a new id for a changed assessment.'); save({...state, assessments: state.assessments.concat(assessment)}); return assessment.id; });
  scope.register('commands', 'submit', input => {
    const value = validateSubmission(input), assessment = state.assessments.find(item => item.id === value.assessmentId); if (!assessment) fail('missing_assessment', 'Unknown assessment.');
    if (state.submissions.some(item => item.assessmentId === value.assessmentId && item.learnerId === value.learnerId)) fail('duplicate_submission', 'This learner already submitted the assessment.');
    let earned = 0, maximum = 0;
    for (const question of assessment.questions) { maximum += question.weight; if (Object.hasOwn(value.answers, question.id) && value.answers[question.id] === question.answer) earned += question.weight; }
    const result = {assessmentId: value.assessmentId, learnerId: value.learnerId, earned, maximum, score: earned / maximum}; save({...state, submissions: state.submissions.concat(result)}); return cloneData(result);
  });
  scope.register('commands', 'report', {readOnly:true, validate:input=>!!input&&typeof input.assessmentId==='string'&&!!input.assessmentId.trim()&&input.assessmentId.length<=180&&(input.learnerId===undefined||typeof input.learnerId==='string'&&input.learnerId.length<=180), execute:input => cloneData(state.submissions.filter(item => item.assessmentId === input.assessmentId && (input.learnerId === undefined || item.learnerId === input.learnerId)))});
  scope.register('components', 'assessment', {schemaVersion: 1, validate: input => { validateAssessment(input); return true; }});
  scope.register('server-validators', 'configure', {validate: validateAssessment, authorize: authorizeAssessmentEdit, permissions:['assessments.write']}); scope.register('server-validators', 'submit', {validate: validateSubmission});
  scope.register('migrations', 'state', migrateAssessmentState); scope.register('ui', 'assessment', assessmentPanel);
}});
