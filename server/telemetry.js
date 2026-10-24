'use strict';

const {ApiError, invalid, plain, safeTree} = require('./validation');

const MAX_SAMPLES = 5000;
const MAX_EVENTS = 2000;
const MAX_TELEMETRY_BYTES = 16 * 1024 * 1024;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function finite(value, label, minimum = -Infinity, maximum = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) invalid(label + ' no es válido.');
  return value;
}

function objectId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,399}$/.test(value) ||
      value.includes('..') || value.includes('//') || FORBIDDEN.has(value)) invalid('El identificador del objeto no es válido.');
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) invalid(label + ' no es válido.');
  return new Date(value).toISOString();
}

function validateRun(payload) {
  if (!plain(payload)) invalid('Los datos de la ejecución no son válidos.');
  if (!Array.isArray(payload.samples) || !Array.isArray(payload.events)) invalid('Faltan las muestras o los eventos de la ejecución.');
  if (payload.samples.length > MAX_SAMPLES || payload.events.length > MAX_EVENTS) {
    throw new ApiError(413, 'La ejecución supera el límite de 5000 muestras o 2000 eventos.', 'telemetry_limit');
  }
  safeTree(payload);
  if (!Number.isSafeInteger(payload.projectRevision) || payload.projectRevision < 1) invalid('La revisión registrada no es válida.');
  if (typeof payload.roomId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(payload.roomId)) invalid('La sala de la ejecución no es válida.');
  const duration = finite(payload.duration, 'La duración', Number.MIN_VALUE, 604800);
  const startedAt = timestamp(payload.startedAt, 'El inicio');
  const endedAt = timestamp(payload.endedAt, 'El final');
  if (Date.parse(endedAt) < Date.parse(startedAt)) invalid('El final debe ser posterior al inicio.');
  let previous = 0;
  const samples = payload.samples.map(sample => {
    if (!plain(sample) || !plain(sample.variables)) invalid('Una muestra no es válida.');
    const time = finite(sample.time, 'El tiempo de la muestra', previous, duration);
    previous = time;
    const entries = Object.entries(sample.variables);
    if (!entries.length || entries.length > 64) invalid('Una muestra debe contener entre 1 y 64 variables.');
    const variables = {};
    for (const [key, value] of entries) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_.]{0,79}$/.test(key) || FORBIDDEN.has(key)) invalid('El nombre de una variable no es válido.');
      if (typeof value !== 'boolean') finite(value, 'El valor de una variable');
      variables[key] = value;
    }
    return {time, objectId: objectId(sample.objectId), variables};
  });
  previous = 0;
  const events = payload.events.map(event => {
    if (!plain(event)) invalid('Un evento no es válido.');
    const time = finite(event.time, 'El tiempo del evento', previous, duration);
    previous = time;
    if (typeof event.type !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,79}$/.test(event.type)) invalid('El tipo de evento no es válido.');
    if (typeof event.message !== 'string' || event.message.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(event.message)) invalid('El mensaje del evento no es válido.');
    return {time, objectId: objectId(event.objectId), type: event.type, message: event.message};
  });
  return {projectRevision: payload.projectRevision, roomId: payload.roomId, startedAt, endedAt, duration, samples, events};
}

function runMeta(row) {
  return {id: row.id, projectId: row.project_id, projectRevision: row.project_revision,
    roomId: row.room_id, startedAt: row.started_at, endedAt: row.ended_at, duration: row.duration,
    sampleCount: row.sample_count, eventCount: row.event_count, createdAt: row.created_at};
}

module.exports = {validateRun, runMeta, MAX_SAMPLES, MAX_EVENTS, MAX_TELEMETRY_BYTES};
