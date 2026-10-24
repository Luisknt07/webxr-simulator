/* Declarative automation is shared by the editor, simulation and HTTP boundary. */
'use strict';

const sourceVariables = ['active', 'occupied', 'count', 'running', 'powered', 'paused', 'autoSpawn', 'speed', 'actualSpeed', 'emergency', 'inFlight', 'entryCount', 'exitCount', 'routedMain', 'routedBranch', 'routingUnmatched', 'runSeconds', 'palletCount', 'palletCapacity', 'palletFull', 'transferBlocked', 'externalSupply', 'internalSupplyActive', 'moduleCount', 'enabled', 'position', 'autoGenerate', 'interval', 'outputInterval', 'queued', 'queuedUnits', 'occupancy', 'capacity', 'generated', 'generatedUnits', 'delivered', 'deliveredUnits', 'received', 'receivedUnits', 'blocked', 'full', 'empty', 'remaining', 'processTime', 'setupTime', 'operatorAvailable', 'busy', 'settingUp', 'waitingOperator', 'outputQueued', 'parallelism', 'outputCapacity', 'activeJobs', 'progress', 'setupProgress', 'setupRemaining', 'completed', 'completedUnits', 'utilization', 'setupSeconds', 'processSeconds', 'idleSeconds', 'blockedSeconds', 'operatorWaitSeconds', 'downSeconds', 'nominalCapacity'];
const targetVariables = ['running', 'powered', 'paused', 'autoSpawn', 'speed', 'emergency', 'enabled', 'autoGenerate', 'interval', 'outputInterval', 'processTime', 'setupTime', 'operatorAvailable'];
const operators = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
const edges = ['rising', 'falling', 'level'];
const keys = ['sourceId', 'variable', 'operator', 'value', 'targetId', 'targetVariable', 'set', 'edge'];
const booleanVariables = ['active', 'occupied', 'running', 'powered', 'paused', 'autoSpawn', 'palletFull', 'transferBlocked', 'externalSupply', 'internalSupplyActive', 'emergency', 'enabled', 'autoGenerate', 'blocked', 'full', 'empty', 'operatorAvailable', 'busy', 'settingUp', 'waitingOperator'];

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function objectReference(value, allowEmpty) {
  if (typeof value !== 'string' || value.length > 400 || (!allowEmpty && !value) ||
    (value && !/^[a-zA-Z0-9][a-zA-Z0-9_:/.-]*$/.test(value)) || value.split('/').includes('..') ||
    ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('Referencia de objeto inválida.');
  return value;
}

function scalar(value) {
  return typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000;
}

function normalizeRules(value) {
  let list = value;
  if (typeof value === 'string') {
    if (value.length > 32000) throw new Error('Las reglas admiten hasta 32000 caracteres.');
    try { list = JSON.parse(value); } catch (error) { throw new Error('Las reglas deben ser una lista JSON válida.'); }
  }
  if (!Array.isArray(list) || list.length > 64) throw new Error('Se permiten hasta 64 reglas de automatización.');
  return list.map(rule => {
    if (!plain(rule) || Object.keys(rule).some(key => !keys.includes(key)) || keys.some(key => rule[key] === undefined)) {
      throw new Error('La regla contiene campos desconocidos o incompletos.');
    }
    objectReference(rule.sourceId, false); objectReference(rule.targetId, false);
    if (!sourceVariables.includes(rule.variable) || !targetVariables.includes(rule.targetVariable) ||
      !operators.includes(rule.operator) || !edges.includes(rule.edge) || !scalar(rule.value) || !scalar(rule.set)) {
      throw new Error('Variable, operación o valor de regla inválido.');
    }
    if ((booleanVariables.includes(rule.variable) ? typeof rule.value !== 'boolean' : typeof rule.value !== 'number') ||
      (booleanVariables.includes(rule.targetVariable) ? typeof rule.set !== 'boolean' : typeof rule.set !== 'number') ||
      (typeof rule.value === 'boolean' && !['eq', 'ne'].includes(rule.operator)) ||
      (rule.targetVariable === 'speed' && Math.abs(rule.set) > 20) ||
      (['interval', 'outputInterval'].includes(rule.targetVariable) && (rule.set < 0.1 || rule.set > 120)) ||
      (rule.targetVariable === 'processTime' && (rule.set < 0.1 || rule.set > 3600)) ||
      (rule.targetVariable === 'setupTime' && (rule.set < 0 || rule.set > 3600))) {
      throw new Error('El tipo o rango del valor no corresponde a la variable de la regla.');
    }
    return keys.reduce((result, key) => { result[key] = rule[key]; return result; }, {});
  });
}

function compare(left, operator, right) {
  if (typeof left !== typeof right || !scalar(left)) return false;
  if (operator === 'eq') return left === right;
  if (operator === 'ne') return left !== right;
  if (operator === 'gt') return left > right;
  if (operator === 'gte') return left >= right;
  if (operator === 'lt') return left < right;
  return left <= right;
}

module.exports = {normalizeRules, compare, objectReference, sourceVariables, targetVariables, operators, edges};
