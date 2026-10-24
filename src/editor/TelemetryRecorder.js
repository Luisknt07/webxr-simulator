const clone = value => JSON.parse(JSON.stringify(value));
const number = value => typeof value === 'number' && Number.isFinite(value);
const safeVariable = key => /^[a-zA-Z_][a-zA-Z0-9_.]{0,79}$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key);
const safeObject = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,399}$/.test(value) &&
  !value.includes('..') && !value.includes('//') && !['__proto__', 'constructor', 'prototype'].includes(value);

// Bounded local recording: the engine supplies snapshots; this class owns no timers.
export default class TelemetryRecorder {
  constructor(options = {}) {
    this.maxSamples = Math.min(5000, Math.max(1, Number.isSafeInteger(options.maxSamples) ? options.maxSamples : 5000));
    this.maxEvents = Math.min(2000, Math.max(1, Number.isSafeInteger(options.maxEvents) ? options.maxEvents : 2000));
    this.active = false;
    this.limitReached = false;
    this._data = null;
    this._lastSample = new Map();
    this._seenEvents = new Set();
  }

  start({projectRevision, roomId}, snapshot = {}) {
    if (this.active) throw new Error('Ya hay una grabación activa.');
    this._origin = number(snapshot.time) ? snapshot.time : 0;
    this._time = 0;
    this._lastSample.clear();
    this._seenEvents.clear();
    this.limitReached = false;
    const now = new Date().toISOString();
    this._data = {projectRevision, roomId, startedAt: now, endedAt: now, duration: 0.000001, samples: [], events: []};
    this.active = true;
    this.capture(snapshot);
    return this.summary;
  }

  capture(snapshot = {}) {
    if (!this.active) return this.summary;
    const absolute = number(snapshot.time) ? snapshot.time : this._origin + this._time;
    if (absolute < this._origin + this._time) return this.summary;
    this._time = Math.min(604800, absolute - this._origin);
    for (const object of snapshot.objects || []) {
      if (!object || !safeObject(object.id) || !number(object.analyticsInterval) || object.analyticsInterval <= 0) continue;
      const previous = this._lastSample.get(object.id);
      if (previous !== undefined && this._time - previous + 1e-9 < object.analyticsInterval) continue;
      const variables = {};
      for (const [key, value] of Object.entries(object.variables || {}).slice(0, 64)) {
        if (safeVariable(key) && (typeof value === 'boolean' || number(value))) variables[key] = value;
      }
      if (!Object.keys(variables).length) continue;
      if (this._data.samples.length >= this.maxSamples) { this.limitReached = true; break; }
      this._data.samples.push({time: this._time, objectId: object.id, variables});
      this._lastSample.set(object.id, this._time);
      if (this._data.samples.length === this.maxSamples) { this.limitReached = true; break; }
    }
    for (const event of snapshot.events || []) {
      if (!event || !number(event.time) || !safeObject(event.objectId) || event.time < this._origin || event.time > absolute ||
          typeof event.type !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,79}$/.test(event.type)) continue;
      const message = typeof event.message === 'string' ? event.message.slice(0, 1000).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '') : '';
      const key = event.id === undefined ? JSON.stringify([event.time, event.objectId, event.type, message]) : 'id:' + String(event.id);
      if (this._seenEvents.has(key)) continue;
      const time = Math.min(this._time, Math.max(0, event.time - this._origin));
      if (this._data.events.length && time < this._data.events[this._data.events.length - 1].time) continue;
      if (this._data.events.length >= this.maxEvents) { this.limitReached = true; break; }
      this._seenEvents.add(key);
      this._data.events.push({time, objectId: event.objectId, type: event.type, message});
      if (this._data.events.length === this.maxEvents) { this.limitReached = true; break; }
    }
    this._data.duration = Math.max(0.000001, this._time);
    this._data.endedAt = new Date().toISOString();
    if (this.limitReached || this._time >= 604800) {
      this.limitReached = true;
      this.active = false;
    }
    return this.summary;
  }

  stop(snapshot) {
    if (!this._data) return null;
    if (this.active && snapshot) this.capture(snapshot);
    this.active = false;
    this._data.endedAt = new Date().toISOString();
    return this.payload;
  }

  get payload() { return this._data ? clone(this._data) : null; }
  get summary() {
    return {active: this.active, limitReached: this.limitReached, duration: this._data ? this._data.duration : 0,
      sampleCount: this._data ? this._data.samples.length : 0, eventCount: this._data ? this._data.events.length : 0};
  }
}

function cell(value) {
  let text = value === undefined || value === null ? '' : String(value);
  // Quote all cells and neutralize spreadsheet formulas, including whitespace prefixes.
  if (/^[\s]*[=+\-@]/.test(text) && typeof value !== 'number') text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function csv(payload) {
  const rows = [['kind', 'time', 'objectId', 'variable', 'value', 'type', 'message']];
  for (const sample of payload && payload.samples || []) {
    for (const [key, value] of Object.entries(sample.variables || {})) rows.push(['sample', sample.time, sample.objectId, key, value, '', '']);
  }
  for (const event of payload && payload.events || []) rows.push(['event', event.time, event.objectId, '', '', event.type, event.message]);
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
