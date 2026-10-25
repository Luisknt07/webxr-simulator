'use strict';
const fs = require('node:fs'), path = require('node:path');

module.exports = function loadStudyScenes(THREE, schema, SceneDocument) {
  const read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const builders = require('./load-industrial-cedi')(THREE, schema);
  const {STUDY_SCENES, studyScene, STUDY_ENVIRONMENT_DEFAULTS} = new Function(read('editor/StudySceneCatalog.js') + '\nreturn {STUDY_SCENES,studyScene,STUDY_ENVIRONMENT_DEFAULTS};')();
  const ConveyorAssembly = builders.ConveyorAssembly;
  const buildConveyorExample = new Function('THREE', 'ConveyorAssembly', read('editor/ConveyorExamples.js') + '\nreturn buildConveyorExample;')(THREE, ConveyorAssembly);
  const buildIndustrialLabLines = new Function('THREE', 'ConveyorAssembly', 'buildConveyorExample', require('./load-industrial-continuous')() + read('editor/IndustrialLabLines.js') + '\nreturn buildIndustrialLabLines;')(THREE, ConveyorAssembly, buildConveyorExample);
  const {applyIndustrialFloorPresentation} = require('./load-industrial-floor')(THREE, schema);
  const {applyIndustrialMonitorLayout} = require('./load-industrial-monitor-layout')(THREE, schema);
  const applyIndustrialMessages = new Function('schema', read('editor/IndustrialMessages.js') + '\nreturn applyIndustrialMessages;')(schema);
  const {applyIndustrialAging} = require('./load-industrial-aging')(THREE);
  const {buildStudyScene, studySceneReport} = new Function('THREE', 'schema', 'ConveyorAssembly', 'buildIndustrialLabLines', 'buildIndustrialCediLevel', 'buildCediEnvironment', 'studyScene', 'STUDY_ENVIRONMENT_DEFAULTS', 'applyIndustrialFloorPresentation', 'applyIndustrialMonitorLayout', 'applyIndustrialMessages', 'applyIndustrialAging', read('editor/IndustrialStudyScenes.js') + '\nreturn {buildStudyScene,studySceneReport};')
    (THREE, schema, ConveyorAssembly, buildIndustrialLabLines, builders.buildIndustrialCediLevel, builders.buildCediEnvironment, studyScene, STUDY_ENVIRONMENT_DEFAULTS, applyIndustrialFloorPresentation, applyIndustrialMonitorLayout, applyIndustrialMessages, applyIndustrialAging);
  const project = new Function('THREE', 'schema', 'SceneDocument', 'buildStudyScene', 'studySceneReport', 'studyScene', read('editor/StudySceneProject.js') + '\nreturn {compileStudyProject,studyPreviewObject,studySceneBase};')(THREE, schema, SceneDocument, buildStudyScene, studySceneReport, studyScene);
  const loadStudioTools = (window, document) => new Function('THREE', 'schema', 'buildIndustrialLab', 'buildIndustrialCediLevel', 'buildStudyScene', 'studySceneReport', 'compileStudyProject', 'STUDY_SCENES', 'studyScene', 'applyIndustrialAging', 'window', 'document', read('studio/StudioTools.js').replace('default class StudioTools', 'return class StudioTools'))
    (THREE, schema, builders.buildIndustrialLab, builders.buildIndustrialCediLevel, buildStudyScene, studySceneReport, project.compileStudyProject, STUDY_SCENES, studyScene, applyIndustrialAging, window, document);
  return Object.assign({STUDY_SCENES, STUDY_ENVIRONMENT_DEFAULTS, studyScene, buildStudyScene, studySceneReport, loadStudioTools, ConveyorAssembly}, project);
};
