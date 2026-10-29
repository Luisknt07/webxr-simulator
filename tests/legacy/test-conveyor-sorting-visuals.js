const __layout = require("../../tooling/layout.cjs");
// Real physical conveyor HMI, scene document and materials. Canvas/GPU are
// adapted; this does not claim physical headset or machine-vision validation.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harnessSource = fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-conveyor-sorting-visuals.js"), 'test-industrial-visuals.js')), 'utf8');
const start = harnessSource.indexOf('async function run()');
assert(start > 0);
const {setup, screen, text} = new Function('require', '__dirname', harnessSource.slice(0, start) + '\nreturn {setup,screen,text};')(require, __dirname);

async function run() {
  const f = setup();
  const configure = patch => {
    f.visuals.dispose();
    f.document.setBehaviors(f.belt, f.document.getBehaviors(f.belt).map(config => config.type === 'conveyor' ? Object.assign({}, config, patch) : config));
  };
  configure({layout: 'tee', junctionMode: 'split', routing: 'rules', routingDefault: 'main', routingRules: JSON.stringify([
    {field: 'quality', operator: 'eq', value: 'defective', route: 'branch'},
    {field: 'color', operator: 'eq', value: '#ff2200', route: 'main'}
  ])});
  const authored = await f.document.serialize();
  Object.assign(f.beltVariables, {routedMain: 34, routedBranch: 6, routingUnmatched: 2});
  f.visuals.sync('hall', 0, false);
  assert.match(text(f.visuals), /CLASIFICACIÓN/);
  assert.match(text(f.visuals), /POR REGLAS/);
  assert.match(text(f.visuals), /PRINCIPAL 34 · LATERAL 6/);
  assert.match(text(f.visuals), /Sin coincidencia → PRINCIPAL/);
  assert.match(text(f.visuals), /Atributos simulados/);
  assert(!text(f.visuals).includes('PALLET LLENO'));
  assert(!text(f.visuals).includes('ALIMENTACIÓN'), 'The split dashboard dedicates its fourth KPI to the routing mode.');
  const hmi = screen(f.visuals), paints = hmi.canvas.paints;
  for (let index = 0; index < 60; index++) f.visuals.sync('hall', 1 / 60, false);
  assert.equal(hmi.canvas.paints, paints, 'Stable classification counters do not repaint or upload their texture.');
  f.beltVariables.routedMain++;
  f.visuals.sync('hall', 0.25, false);
  assert.match(text(f.visuals), /PRINCIPAL 35 · LATERAL 6/);
  assert.equal(hmi.canvas.paints, paints + 1, 'Classification decisions invalidate the cached dashboard only once.');
  f.beltVariables.transferBlocked = true; f.beltVariables.actualSpeed = 0;
  f.visuals.sync('hall', 0.25, false);
  assert.match(text(f.visuals), /ESPERANDO SALIDA/);
  assert.match(text(f.visuals), /Salida elegida bloqueada · conserva el destino/);
  assert.match(text(f.visuals), /PRINCIPAL 35 · LATERAL 6/, 'Blocking a receiver must not silently change the displayed decision counts.');
  assert.deepEqual(await f.document.serialize(), authored, 'Live HMI and sensor feedback never leak into the saved authoring model.');
  configure({routing: 'percentage', branchPercentage: 34.5});
  f.beltVariables.transferBlocked = false; f.beltVariables.actualSpeed = 0.4;
  f.visuals.sync('hall', 0.25, false);
  assert.match(text(f.visuals), /34\.5% LAT\./); assert.match(text(f.visuals), /Reparto acumulado por cargas/);
  configure({routing: 'alternate'}); f.visuals.sync('hall', 0.25, false);
  assert.match(text(f.visuals), /ALTERNAR/); assert.match(text(f.visuals), /Decisiones al entrar en el módulo/);
  configure({routing: 'branch'}); f.visuals.sync('hall', 0.25, false);
  assert(screen(f.visuals).canvas.text.includes('LATERAL'));
  configure({junctionMode: 'merge'}); f.visuals.sync('hall', 0.25, false);
  assert(!text(f.visuals).includes('CLASIFICACIÓN'), 'A merge has no route-selection dashboard.');
  assert.match(text(f.visuals), /ALIMENTACIÓN/);
  f.visuals.dispose();
  console.log('Conveyor sorting visuals: physical HMI modes, per-route counters, blocked-choice feedback, throttled texture updates and authoring restoration passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
