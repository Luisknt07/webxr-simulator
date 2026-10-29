import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAssessment, validateSubmission} from './schema.js';
test('assessment weights are positive and question ids cannot alias each other', () => {
  const assessment = {id: 'lesson-1', questions: [{id: 'q1', answer: 'a', weight: 3}]}; assert.deepEqual(validateAssessment(assessment), assessment); assert.throws(() => validateAssessment({...assessment, questions: [...assessment.questions, ...assessment.questions]})); assert.throws(() => validateSubmission({assessmentId: assessment.id, learnerId: '', answers: {q1: 'a'}}));
});
