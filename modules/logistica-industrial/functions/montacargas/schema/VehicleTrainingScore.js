'use strict';

// Pure, bounded checkpoint state. Geometry/custody remain the authority in
// VehicleTrainingRuntime; this module never moves cargo or advances a task.
const VERSION = 1, LEDGER_LIMIT = 32, COOLDOWN = 3, MAX_ERRORS = 1000000;
const REWARDS = Object.freeze({pickup: {points: 20, title: 'Pallet correcto recogido'}, route: {points: 20, title: 'Ruta recorrida conduciendo'}, complete: {points: 100, title: 'Depósito y retirada verificados'}, clean: {points: 25, title: 'Misión sin errores'}});
const PENALTIES = Object.freeze({'wrong-pallet': 10, 'wrong-destination': 10, 'unsafe-pickup': 5, 'unsafe-drop': 5, collision: 15});
const FEEDBACK_FIELDS = ['id', 'kind', 'code', 'taskId', 'message', 'retry', 'points', 'penalty', 'score', 'text'];
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const enabled = tasks => tasks.some(task => task.scoring === true);
const maximum = tasks => tasks.reduce((sum, task) => sum + (task.scoring ? 145 + (task.route.length ? 20 : 0) : 0), 0);
function signature(tasks) {
  let hash = 2166136261;
  const input = JSON.stringify(tasks);
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
const rewardKey = (task, code) => task.id + ':' + code;
function create(tasks) {
  if (!enabled(tasks)) return undefined;
  return {version: VERSION, program: signature(tasks), score: 0, earned: 0, deducted: 0, errorCount: 0, missionErrors: tasks.map(() => 0), errors: Object.keys(PENALTIES).reduce((value, key) => { value[key] = 0; return value; }, {}), rewardKeys: [], ledger: [], feedback: null, sequence: 0, clock: 0, cooldowns: {}};
}
function feedback(state, task, kind, code, message, retry, points, penalty = 0) {
  const result = {id: ++state.sequence, kind, code, taskId: task.id, message, retry, points, penalty, score: state.score, text: message + ' (' + (points > 0 ? '+' : '') + points + ' puntos).'};
  state.feedback = result;
  state.ledger.push(result);
  if (state.ledger.length > LEDGER_LIMIT) state.ledger.shift();
  return result;
}
function award(state, task, code) {
  if (!state || !task || !task.scoring || !REWARDS[code]) return null;
  const key = rewardKey(task, code), reward = REWARDS[code];
  if (state.rewardKeys.includes(key)) return null;
  state.rewardKeys.push(key); state.earned += reward.points; state.score += reward.points;
  return feedback(state, task, 'reward', code, reward.title, '', reward.points);
}
function penalize(state, task, index, code, message, retry) {
  if (!state || !task || !task.scoring || !PENALTIES[code] || state.errorCount >= MAX_ERRORS) return null;
  const last = state.cooldowns[code];
  if (last !== undefined && state.clock - last < COOLDOWN) return null;
  state.cooldowns[code] = state.clock;
  const penalty = PENALTIES[code], deducted = Math.min(state.score, penalty);
  state.score -= deducted; state.deducted += deducted; state.errorCount++; state.missionErrors[index]++; state.errors[code]++;
  return feedback(state, task, 'error', code, message, retry, deducted ? -deducted : 0, penalty);
}
function rewards(state, tasks) {
  if (!state) return [];
  return tasks.reduce((result, task) => result.concat(Object.keys(REWARDS).filter(code => state.rewardKeys.includes(rewardKey(task, code))).map(code => ({key: rewardKey(task, code), taskId: task.id, code, points: REWARDS[code].points, title: REWARDS[code].title}))), []);
}
function expectedKeys(tasks, training, activeProductId) {
  const keys = [];
  tasks.forEach((task, index) => {
    if (!task.scoring) return;
    const completed = index < training.index, current = index === training.index;
    const picked = completed || current && ['drop', 'withdraw'].includes(training.phase) || current && training.phase === 'error' && activeProductId === task.productId;
    if (picked) keys.push(rewardKey(task, 'pickup'));
    if (task.route.length && (completed || picked && training.waypointIndex === task.route.length && !training.routeFault)) keys.push(rewardKey(task, 'route'));
    if (completed) {
      keys.push(rewardKey(task, 'complete'));
      if (training.scoring.missionErrors[index] === 0) keys.push(rewardKey(task, 'clean'));
    }
  });
  return keys;
}
function validate(state, tasks, training, activeProductId = '') {
  if (!enabled(tasks)) return state === undefined;
  if (!plain(state) || state.version !== VERSION || state.program !== signature(tasks) || !integer(state.score, maximum(tasks)) || !integer(state.earned, maximum(tasks)) || !integer(state.deducted, state.earned) || state.score !== state.earned - state.deducted || !integer(state.errorCount, MAX_ERRORS) || !Number.isFinite(state.clock) || state.clock < 0 || state.clock > 1e10) return false;
  if (!Array.isArray(state.missionErrors) || state.missionErrors.length !== tasks.length || state.missionErrors.some((value, index) => !integer(value, MAX_ERRORS) || (!tasks[index].scoring || index > training.index) && value !== 0) || state.missionErrors.reduce((a, b) => a + b, 0) !== state.errorCount) return false;
  if (!plain(state.errors) || Object.keys(state.errors).length !== Object.keys(PENALTIES).length || Object.keys(PENALTIES).some(code => !integer(state.errors[code], MAX_ERRORS)) || Object.values(state.errors).reduce((a, b) => a + b, 0) !== state.errorCount || state.deducted > Object.keys(PENALTIES).reduce((sum, code) => sum + state.errors[code] * PENALTIES[code], 0)) return false;
  if (!Array.isArray(state.rewardKeys) || state.rewardKeys.length > tasks.length * 4 || new Set(state.rewardKeys).size !== state.rewardKeys.length) return false;
  const expected = expectedKeys(tasks, training, activeProductId);
  if (state.rewardKeys.length !== expected.length || expected.some(key => !state.rewardKeys.includes(key)) || rewards(state, tasks).reduce((sum, reward) => sum + reward.points, 0) !== state.earned) return false;
  if (!plain(state.cooldowns) || Object.keys(state.cooldowns).some(code => !PENALTIES[code] || !Number.isFinite(state.cooldowns[code]) || state.cooldowns[code] < 0 || state.cooldowns[code] > state.clock)) return false;
  if (!integer(state.sequence) || state.sequence !== state.rewardKeys.length + state.errorCount || !Array.isArray(state.ledger) || state.ledger.length !== Math.min(LEDGER_LIMIT, state.sequence)) return false;
  if (state.sequence === 0) return state.feedback === null;
  let balance, earned = 0, deducted = 0, errorCount = 0;
  const seenRewards = new Set(), errors = Object.keys(PENALTIES).reduce((result, code) => { result[code] = 0; return result; }, {}), missionErrors = tasks.map(() => 0);
  for (let i = 0; i < state.ledger.length; i++) {
    const row = state.ledger[i], task = row && tasks.find(task => task.id === row.taskId);
    if (!plain(row) || Object.keys(row).length !== FEEDBACK_FIELDS.length || !task || !task.scoring || row.id !== state.sequence - state.ledger.length + i + 1 || !['reward', 'error'].includes(row.kind) || !integer(row.score, maximum(tasks)) || !['message', 'retry', 'text'].every(key => typeof row[key] === 'string' && row[key].length <= 700) || !Number.isInteger(row.points)) return false;
    if (row.kind === 'reward' ? !REWARDS[row.code] || row.points !== REWARDS[row.code].points || row.penalty !== 0 || !state.rewardKeys.includes(rewardKey(task, row.code)) : !PENALTIES[row.code] || row.penalty !== PENALTIES[row.code] || row.points > 0 || row.points < -row.penalty) return false;
    if (i === 0) { balance = row.score - row.points; if (!integer(balance, maximum(tasks)) || state.sequence === state.ledger.length && balance !== 0) return false; }
    if (row.score !== balance + row.points) return false;
    if (row.kind === 'reward') {
      const key = rewardKey(task, row.code); if (seenRewards.has(key)) return false;
      seenRewards.add(key); earned += row.points;
    } else {
      if (row.points !== -Math.min(balance, row.penalty)) return false;
      deducted -= row.points; errorCount++; errors[row.code]++; missionErrors[tasks.indexOf(task)]++;
    }
    balance = row.score;
  }
  if (state.earned < earned || state.deducted < deducted || state.errorCount < errorCount || Object.keys(PENALTIES).some(code => state.errors[code] < errors[code]) || state.missionErrors.some((value, index) => value < missionErrors[index])) return false;
  if (state.sequence === state.ledger.length && (state.earned !== earned || state.deducted !== deducted || state.errorCount !== errorCount || Object.keys(PENALTIES).some(code => state.errors[code] !== errors[code]) || state.missionErrors.some((value, index) => value !== missionErrors[index]))) return false;
  const last = state.ledger[state.ledger.length - 1];
  return plain(state.feedback) && Object.keys(state.feedback).length === FEEDBACK_FIELDS.length && FEEDBACK_FIELDS.every(key => state.feedback[key] === last[key]) && state.feedback.score === state.score;
}
module.exports = {create, award, penalize, rewards, maximum, validate, REWARDS, PENALTIES, LEDGER_LIMIT, COOLDOWN};
