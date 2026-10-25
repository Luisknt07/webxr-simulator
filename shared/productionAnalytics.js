'use strict';

// Bounded simulation-time statistics. No GPU/DOM resources, wall clock timers
// or changes to machine state; histories survive offscreen production.
const STATES = ['busy', 'idle', 'setup', 'blocked', 'down', 'paused'];
const COUNTERS = ['entryCount', 'exitCount', 'entryUnits', 'exitUnits', 'receivedCount', 'receivedUnits'];
const FIELDS = ['time', ...COUNTERS, 'wip', 'loadPercent', 'utilization', 'blocked', 'blockedSeconds'];
let streamSequence = 0;
const historyCapacity = count => Math.max(2, Math.min(600, Math.floor(60000 / Math.max(1, count))));
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const positive = value => Math.max(0, finite(value));
const percent = (value, total) => total > 0 ? Math.max(0, Math.min(100, value / total * 100)) : 0;
function metrics() {
  return Object.assign({observedSeconds: 0, runningSeconds: 0, blockedStreak: 0},
    ...STATES.map(state => ({[state + 'Seconds']: 0})));
}
function rates(history) {
  return history.map((point, index) => {
    // Ten-second moving production rates remain readable for discrete cartons.
    let first = index; while (first > 0 && point.time - history[first].time < 10) first--;
    const baseline = history[first], elapsed = point.time - baseline.time;
    return Object.assign({}, point, {inputRate: elapsed > 0 ? Math.max(0, point.entryUnits - baseline.entryUnits) * 60 / elapsed : 0,
      outputRate: elapsed > 0 ? Math.max(0, point.exitUnits - baseline.exitUnits) * 60 / elapsed : 0});
  });
}
function controlChart(history) {
  // Individuals / moving range, span 2. NIST/SEMATECH 6.3.2.2:
  // https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc322.htm
  const points = history.slice(-120), values = points.map(point => point.outputRate);
  const center = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const movingRanges = points.slice(1).map((point, index) => ({time: point.time, value: Math.abs(point.outputRate - points[index].outputRate)}));
  const mrCenter = movingRanges.length ? movingRanges.reduce((sum, point) => sum + point.value, 0) / movingRanges.length : 0;
  const band = 3 * mrCenter / 1.128;
  return {metric: 'outputRate', method: 'I-MR', samples: values.length, window: 120, ready: values.length >= 20,
    center, lcl: Math.max(0, center - band), ucl: center + band,
    movingRanges, mrCenter, mrLcl: 0, mrUcl: 3.267 * mrCenter,
    basis: 'Tasa móvil de 10 s; límites descriptivos recalculados, no límites de especificación.'};
}

class Recorder {
  constructor() { this.reset(); }
  reset(machineCount = 1) {
    this.entries = new Map(); this.sampleVersion = 0; this.nextSample = 0;
    this.capacity = historyCapacity(machineCount);
    // This identifies an execution, not a wall-clock production measurement.
    this.streamId = (++streamSequence).toString(36) + '-' + Math.random().toString(36).slice(2);
    this.time = 0;
    this.historyCache = new Map();
  }
  observe(id, row, delta = 0) {
    let entry = this.entries.get(id);
    if (!entry) { entry = {row, metrics: metrics(), history: []}; this.entries.set(id, entry); }
    entry.row = row; const result = entry.metrics, elapsed = positive(delta);
    result.observedSeconds += elapsed;
    const state = STATES.includes(row.state) ? row.state : 'idle';
    if (row.isRunning && row.parallelFractions) {
      const fractions = row.parallelFractions.map(value => Math.max(0, Math.min(1, finite(value))));
      const total = fractions.reduce((sum, value) => sum + value, 0), divisor = Math.max(1, total);
      ['busy', 'setup', 'blocked'].forEach((kind, index) => { result[kind + 'Seconds'] += elapsed * fractions[index] / divisor; });
      result.idleSeconds += elapsed * Math.max(0, 1 - total);
    } else result[state + 'Seconds'] += elapsed;
    if (row.isRunning) result.runningSeconds += elapsed;
    result.blockedStreak = row.blocked || state === 'blocked' ? result.blockedStreak + elapsed : 0;
  }
  sample(time, force = false) {
    this.time = positive(time);
    if (!force && time + 1e-7 < this.nextSample) return;
    this.entries.forEach(entry => {
      const row = entry.row, m = entry.metrics;
      const point = Object.assign({time, wip: positive(row.occupied), loadPercent: percent(row.occupied, row.capacity),
        utilization: percent(m.busySeconds, m.observedSeconds), blocked: row.blocked || row.state === 'blocked' ? 1 : 0, blockedSeconds: m.blockedSeconds},
      ...COUNTERS.map(key => ({[key]: positive(row[key])})));
      if (entry.history.length && Math.abs(entry.history[entry.history.length - 1].time - time) < 1e-7) entry.history.pop();
      entry.history.push(point); if (entry.history.length > this.capacity) entry.history.splice(0, entry.history.length - this.capacity);
    });
    this.nextSample = Math.floor(time + 1e-7) + 1; this.sampleVersion++; this.historyCache.clear();
  }
  summary(ids) {
    const entries = ids.map(id => this.entries.get(id)).filter(Boolean), count = entries.length;
    const result = metrics();
    ['observedSeconds', 'runningSeconds', ...STATES.map(state => state + 'Seconds')].forEach(key => {
      result[key] = count ? entries.reduce((sum, entry) => sum + entry.metrics[key], 0) / count : 0;
    });
    const capacity = entries.reduce((sum, entry) => sum + positive(entry.row.capacity), 0);
    const occupied = entries.reduce((sum, entry) => sum + positive(entry.row.occupied), 0);
    Object.assign(result, {utilization: percent(result.busySeconds, result.observedSeconds), availability: percent(result.runningSeconds, result.observedSeconds),
      loadPercent: percent(occupied, capacity), atCapacity: !!count && entries.some(entry => entry.row.atCapacity || entry.row.capacity > 0 && entry.row.occupied >= entry.row.capacity),
      blocked: entries.some(entry => entry.row.blocked || entry.row.state === 'blocked'),
      congestion: entries.some(entry => entry.row.blocked && entry.metrics.blockedStreak >= 3),
      jamSuspected: entries.some(entry => entry.row.blocked && entry.row.obstruction && entry.metrics.blockedStreak >= 3),
      blockReason: Array.from(new Set(entries.filter(entry => entry.row.blocked || entry.row.state === 'blocked').map(entry => entry.row.blockReason).filter(Boolean))).join(' · '),
      basis: count > 1 ? 'Promedio temporal de ' + count + ' equipos; ocupación útil / tiempo observado.' : 'Ocupación útil / tiempo observado.'});
    return result;
  }
  history(ids, boundaries) {
    const key = JSON.stringify([ids, boundaries]); if (this.historyCache.has(key)) return this.historyCache.get(key);
    const entries = ids.map(id => ({id, entry: this.entries.get(id)})).filter(value => value.entry);
    if (!entries.length) return [];
    const input = new Set(boundaries.inputIds), output = new Set(boundaries.outputIds), storage = new Set(boundaries.storageIds);
    const timeline = entries[0].entry.history;
    const histories = entries.map(({id, entry}) => ({id, entry, points: new Map(entry.history.map(point => [point.time, point]))}));
    const result = rates(timeline.map(seed => {
      const points = histories.map(value => ({id: value.id, entry: value.entry, point: value.points.get(seed.time)})).filter(value => value.point);
      const sum = (set, key, stockKey) => points.reduce((total, value) => total + (!set || set.has(value.id) ? value.point[stockKey && storage.has(value.id) ? stockKey : key] || 0 : 0), 0);
      const totalCapacity = entries.reduce((total, value) => total + positive(value.entry.row.capacity), 0);
      return {time: seed.time, entryCount: sum(input, 'entryCount'), exitCount: sum(output, 'exitCount', 'receivedCount'),
        entryUnits: sum(input, 'entryUnits'), exitUnits: sum(output, 'exitUnits', 'receivedUnits'),
        wip: sum(null, 'wip'), loadPercent: percent(sum(null, 'wip'), totalCapacity),
        utilization: points.length ? sum(null, 'utilization') / points.length : 0,
        blocked: points.some(value => value.point.blocked) ? 1 : 0, blockedSeconds: points.length ? sum(null, 'blockedSeconds') / points.length : 0};
    }));
    this.historyCache.set(key, result); return result;
  }
  exportState(options = {}) {
    const samples = options.historySamples;
    if (samples !== undefined && (!Number.isInteger(samples) || samples < 1 || samples > 600)) throw new Error('Límite de muestras de producción inválido.');
    // Column arrays avoid tens of thousands of graph nodes in a checkpoint.
    // Manual sessions retain the full window. Frequent shared publications
    // send a tail; followers accumulate only the samples actually received.
    return {capacity: this.capacity, nextSample: this.nextSample, streamId: this.streamId, time: this.time, partial: samples !== undefined,
      entries: Array.from(this.entries, ([id, entry]) => {
        const history = samples === undefined ? entry.history : entry.history.slice(-samples);
        return {id, metrics: Object.assign({}, entry.metrics), columns: FIELDS.map(key => history.map(point => point[key]))};
      })};
  }
  importState(state) {
    if (!state) return;
    if (!Array.isArray(state.entries) || state.entries.length > 12000 || !Number.isInteger(state.capacity) || state.capacity < 2 ||
      state.capacity > historyCapacity(this.entries.size) || !Number.isSafeInteger(state.nextSample) || state.nextSample < 0 ||
      state.partial !== undefined && typeof state.partial !== 'boolean' ||
      state.streamId !== undefined && (typeof state.streamId !== 'string' || !state.streamId || state.streamId.length > 160 || /[\x00-\x1f\x7f]/.test(state.streamId)) ||
      state.time !== undefined && (typeof state.time !== 'number' || !Number.isFinite(state.time) || state.time < 0) ||
      state.partial === true && (state.streamId === undefined || state.time === undefined)) throw new Error('Histórico de producción inválido.');
    const replace = state.partial !== true || state.streamId !== this.streamId || state.time + 1e-7 < this.time;
    const updates = [], seen = new Set(); let points = 0, latest = 0;
    state.entries.forEach(saved => {
      const entry = this.entries.get(saved.id); if (!entry) throw new Error('El histórico referencia otro equipo.');
      if (seen.has(saved.id)) throw new Error('El histórico repite un equipo.'); seen.add(saved.id);
      if (!saved.metrics || !Array.isArray(saved.columns) || saved.columns.length !== FIELDS.length || !saved.columns.every(column => Array.isArray(column) && column.length === saved.columns[0].length && column.length <= state.capacity && column.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0))) throw new Error('Muestras de producción inválidas.');
      if (!Object.keys(metrics()).every(key => typeof saved.metrics[key] === 'number' && Number.isFinite(saved.metrics[key]) && saved.metrics[key] >= 0)) throw new Error('Tiempos de producción inválidos.');
      const incoming = saved.columns[0].map((time, index) => Object.assign({}, ...FIELDS.map((key, field) => ({[key]: saved.columns[field][index]}))));
      if (incoming.some((point, index) => index && point.time <= incoming[index - 1].time || state.time !== undefined && point.time > state.time + 1e-7)) throw new Error('El histórico no está ordenado.');
      const merged = new Map(replace ? [] : entry.history.map(point => [point.time, point]));
      incoming.forEach(point => merged.set(point.time, point));
      const history = Array.from(merged.values()).sort((a, b) => a.time - b.time).slice(-state.capacity);
      points += history.length; if (points > 60000) throw new Error('El histórico supera el límite de muestras.');
      if (history.length) latest = Math.max(latest, history[history.length - 1].time);
      updates.push({entry, metrics: Object.assign({}, saved.metrics), history});
    });
    if (seen.size !== this.entries.size) throw new Error('Faltan equipos en el histórico de producción.');
    updates.forEach(value => { value.entry.metrics = value.metrics; value.entry.history = value.history; });
    this.capacity = state.capacity; this.nextSample = state.nextSample; this.streamId = state.streamId || this.streamId;
    this.time = state.time === undefined ? latest : state.time; this.sampleVersion++; this.historyCache.clear();
  }
}

module.exports = {Recorder, controlChart, rates, percent};
