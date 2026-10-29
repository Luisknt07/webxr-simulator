const __layout = require("../../tooling/layout.cjs");
'use strict';
const fs = require('node:fs'), path = require('node:path');
const materialSchema = require('../../packages/render-three/schema/materials'), wearSchema = require('../../packages/render-three/schema/wear');

/** Node tests load the actual production builders and their persisted material,
 * architecture and metric-port dependencies without a WebGL presentation. */
module.exports = function loadIndustrialCedi(THREE, schema) {
  const read = name => fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/load-industrial-cedi.js"), '../src', name)), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const ConveyorAssembly = new Function('THREE', 'conveyorLayout', read('editor/ConveyorAssembly.js').replace('default class ConveyorAssembly', 'return class ConveyorAssembly'))(THREE, schema.conveyorLayout);
  const continuous = require('./load-industrial-continuous')();
  const buildIndustrialCediScenario = new Function('THREE', 'ConveyorAssembly', continuous + read('editor/IndustrialCediScenarios.js') + '\nreturn buildIndustrialCediScenario;')(THREE, ConveyorAssembly);
  const buildCediEnvironment = new Function('THREE', 'schema', read('editor/IndustrialCediEnvironment.js') + '\nreturn buildCediEnvironment;')(THREE, schema);
  const applyIndustrialFinishes = new Function('THREE', 'materialSchema', 'wearSchema', read('editor/IndustrialFinishes.js') + '\nreturn applyIndustrialFinishes;')(THREE, materialSchema, wearSchema);
  const {applyIndustrialFloorPresentation} = require('./load-industrial-floor')(THREE, schema);
  const {applyIndustrialMonitorLayout} = require('./load-industrial-monitor-layout')(THREE, schema);
  const applyIndustrialMessages = new Function('schema', read('editor/IndustrialMessages.js') + '\nreturn applyIndustrialMessages;')(schema);
  const {applyIndustrialAging} = require('./load-industrial-aging')(THREE);
  const retrofitCediRobotics = new Function('THREE', 'schema', read('editor/IndustrialCediRobotics.js') + '\nreturn retrofitCediRobotics;')(THREE, schema);
  const buildIndustrialCediLevel = new Function('THREE', 'schema', 'buildIndustrialCediScenario', 'buildCediEnvironment', 'applyIndustrialFinishes', 'applyIndustrialFloorPresentation', 'applyIndustrialMonitorLayout', 'applyIndustrialMessages', 'applyIndustrialAging', 'retrofitCediRobotics',
    read('editor/IndustrialCediLevel.js') + '\nreturn buildIndustrialCediLevel;')(THREE, schema, buildIndustrialCediScenario, buildCediEnvironment, applyIndustrialFinishes, applyIndustrialFloorPresentation, applyIndustrialMonitorLayout, applyIndustrialMessages, applyIndustrialAging, retrofitCediRobotics);
  const buildConveyorExample = new Function('THREE', 'ConveyorAssembly', read('editor/ConveyorExamples.js') + '\nreturn buildConveyorExample;')(THREE, ConveyorAssembly);
  const buildIndustrialLabLines = new Function('THREE', 'ConveyorAssembly', 'buildConveyorExample', continuous + read('editor/IndustrialLabLines.js') + '\nreturn buildIndustrialLabLines;')(THREE, ConveyorAssembly, buildConveyorExample);
  const buildIndustrialLab = require('./load-industrial-lab')(THREE, schema, buildIndustrialLabLines);
  const loadStudioTools = (window, document) => new Function('THREE', 'schema', 'buildIndustrialLab', 'buildIndustrialCediLevel', 'applyIndustrialAging', 'retrofitCediRobotics', 'window', 'document',
    read('studio/StudioTools.js').replace('default class StudioTools', 'return class StudioTools'))(THREE, schema, buildIndustrialLab, buildIndustrialCediLevel, applyIndustrialAging, retrofitCediRobotics, window, document);
  return {ConveyorAssembly, buildIndustrialCediScenario, buildCediEnvironment, applyIndustrialFinishes, buildIndustrialCediLevel, buildIndustrialLab, loadStudioTools, retrofitCediRobotics};
};
