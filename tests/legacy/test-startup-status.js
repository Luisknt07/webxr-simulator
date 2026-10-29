const __layout = require("../../tooling/layout.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__layout.map(require('node:path').join(__layout.oldDir("scripts/test-startup-status.js"), '../src/lib/StartupStatus.js')), 'utf8');

function harness() {
  const listeners = {}, nodes = {}, reports = [];
  let reloads = 0;
  ['loading', 'loading-title', 'loading-message', 'loading-error', 'loading-retry', 'progressbar'].forEach(id => {
    nodes[id] = {textContent: '', hidden: id === 'loading-error' || id === 'loading-retry', style: {}, classes: new Set(), attributes: {},
      classList: {add(value) { nodes[id].classes.add(value); }},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(type, callback) { this[type] = callback; }};
  });
  const window = {addEventListener(type, callback) { listeners[type] = callback; }, location: {reload() { reloads++; }}};
  const document = {getElementById(id) { return nodes[id]; }, addEventListener(type, callback) { listeners[type] = callback; }};
  vm.runInNewContext(source, {window, document, console: {error(...args) { reports.push(args); }}});
  listeners.DOMContentLoaded();
  return {status: window.webxrStartup, nodes, listeners, reports, reloads: () => reloads};
}

const normal = harness();
normal.status.progress(58, 58);
assert.equal(normal.nodes['loading-message'].textContent, 'Cargando recursos: 58 / 58');
assert.equal(normal.nodes.progressbar.attributes['stroke-dashoffset'], '-282');
normal.status.phase('Preparando las escenas y el editor…');
assert.equal(normal.nodes['loading-message'].textContent, 'Preparando las escenas y el editor…');
normal.status.complete();
assert.equal(normal.nodes.loading.style.display, 'none');
normal.listeners.error({error: new Error('Post-start runtime issue')});
assert.equal(normal.reports.length, 0, 'A later runtime error does not reopen or replace the loading screen.');

const failed = harness();
failed.listeners.error({error: new Error('Escala al apuntar fuera de rango')});
assert.equal(failed.nodes['loading-error'].textContent, 'Escala al apuntar fuera de rango');
assert.equal(failed.nodes['loading-error'].hidden, false);
assert.equal(failed.nodes['loading-retry'].hidden, false);
assert(failed.nodes.loading.classes.has('loading-failed'));
failed.status.progress(58, 58); failed.status.complete();
assert.notEqual(failed.nodes.loading.style.display, 'none', 'Completion cannot hide an unresolved startup error.');
failed.nodes['loading-retry'].click(); assert.equal(failed.reloads(), 1);
assert.equal(failed.reports.length, 1);

const unavailable = harness();
unavailable.listeners.error({target: {src: 'https://localhost:8080/bundle.js'}});
assert.equal(unavailable.nodes['loading-error'].textContent, 'No se pudo descargar la aplicación.');
const rejected = harness(); rejected.listeners.unhandledrejection({reason: new Error('Falló la inicialización del editor')});
assert.equal(rejected.nodes['loading-error'].textContent, 'Falló la inicialización del editor');
console.log('Startup status: complete progress, native initialization failures, unavailable bundle, async failure, retry and post-start isolation passed.');
