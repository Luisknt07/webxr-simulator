const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const materialSchema = require('../../packages/render-three/schema/materials');
const wearSchema = require('../../packages/render-three/schema/wear');

/** Load the production lab with its real persisted finishes in Node tests. */
module.exports = function loadIndustrialLab(THREE, schema, buildIndustrialLabLines) {
  const read = name => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-industrial-lab.js"), '../src/editor', name)), 'utf8')
    .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const applyIndustrialFinishes = new Function('THREE', 'materialSchema', 'wearSchema', read('IndustrialFinishes.js') + '\nreturn applyIndustrialFinishes;')(THREE, materialSchema, wearSchema);
  const buildCediEnvironment = new Function('THREE', 'schema', read('IndustrialCediEnvironment.js') + '\nreturn buildCediEnvironment;')(THREE, schema);
  const {applyIndustrialFloorPresentation} = require('./load-industrial-floor')(THREE, schema);
  const {applyIndustrialMonitorLayout} = require('./load-industrial-monitor-layout')(THREE, schema);
  const applyIndustrialMessages = new Function('schema', read('IndustrialMessages.js') + '\nreturn applyIndustrialMessages;')(schema);
  const {applyIndustrialAging} = require('./load-industrial-aging')(THREE);
  const retrofitCediRobotics = new Function('THREE', 'schema', read('IndustrialCediRobotics.js') + '\nreturn retrofitCediRobotics;')(THREE, schema);
  return new Function('THREE', 'schema', 'buildIndustrialLabLines', 'applyIndustrialFinishes', 'buildCediEnvironment', 'applyIndustrialFloorPresentation', 'applyIndustrialMonitorLayout', 'applyIndustrialMessages', 'applyIndustrialAging', 'retrofitCediRobotics', read('IndustrialLab.js') + '\nreturn buildIndustrialLab;')
    (THREE, schema, buildIndustrialLabLines, applyIndustrialFinishes, buildCediEnvironment, applyIndustrialFloorPresentation, applyIndustrialMonitorLayout, applyIndustrialMessages, applyIndustrialAging, retrofitCediRobotics);
};
