import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveProjectSelection} from '../../packages/core/project-selection.js';
import {validateProject} from '../../packages/contracts/index.js';
const fn = (id, requires=[]) => ({id,version:'1.0.0',requires:requires.map(id=>({id,version:'1.0.0'})),load(){throw Error('Selection must not import code.');}});
const catalog = [{id:'sector.storage',version:'1.0.0',functions:[fn('storage.inventory')]},{id:'sector.farm',version:'1.0.0',functions:[fn('farm.harvest',['storage.inventory']),fn('farm.weather')]}];
const project = modules => ({format:'smarttwin.project',version:1,worldId:'world.test',modules,entities:[]});
test('disabled modules and functions preserve data without loading code or entering the selected closure', () => {
  const input=project([{id:'sector.not-installed',version:'1.0.0',enabled:false},{id:'sector.farm',version:'1.0.0',functions:['farm.harvest',{id:'farm.weather',enabled:false}]}]);
  input.entities.push({id:'unknown',components:[{functionId:'future.sensor',functionVersion:'9.0.0',type:'future.sensor:value',schemaVersion:42,data:{message:'keep all fields'}}]});
  const result=resolveProjectSelection({catalog,project:input});
  assert.deepEqual(result.project,input);assert.deepEqual(result.functions.map(fn=>fn.id),['storage.inventory','farm.harvest']);assert.deepEqual(result.selections,[{moduleId:'sector.farm',functions:['farm.harvest']}]);
  assert(Object.isFrozen(result.project.entities[0].components[0].data));
});
test('disabling an explicit provider does not suppress a required cross-sector shared dependency', () => {
  const result=resolveProjectSelection({catalog,project:project([{id:'sector.storage',version:'1.0.0',enabled:false},{id:'sector.farm',version:'1.0.0',functions:['farm.harvest']}])});
  assert.deepEqual(result.functions.map(fn=>fn.id),['storage.inventory','farm.harvest']);
});
test('installed roots use explicit project defaults; new copied functions do not become automatic roots', () => {
  const result=resolveProjectSelection({catalog,project:project([{id:'sector.farm',version:'1.0.0'}]),defaultFunctions:{'sector.farm':['farm.weather']}});
  assert.deepEqual(result.functions.map(fn=>fn.id),['farm.weather']);
});
test('optional root absence is tolerated explicitly but a present root with a missing required provider fails', () => {
  const input=project([{id:'sector.farm',version:'1.0.0',functions:[{id:'farm.future',optional:true}]}]);
  assert.throws(()=>resolveProjectSelection({catalog,project:input}),{code:'missing_function'});
  assert.equal(resolveProjectSelection({catalog,project:input,allowOptionalMissing:true}).missing.length,1);
  assert.throws(()=>resolveProjectSelection({catalog:catalog.slice(1),project:project([{id:'sector.farm',version:'1.0.0',optional:true,functions:['farm.harvest']}]),allowOptionalMissing:true}),{code:'missing_function'});
});
test('module and function flags and duplicate roots are rejected consistently at the project data boundary', () => {
  for (const ref of [{id:'sector.farm',version:'1.0.0',enabled:'false'},{id:'sector.farm',version:'1.0.0',optional:1},{id:'sector.farm',version:'1.0.0',functions:[{id:'farm.weather',enabled:0}]},{id:'sector.farm',version:'1.0.0',functions:[{id:'farm.weather',optional:'yes'}]}]) assert.throws(()=>validateProject(project([ref])),{code:'invalid_project'});
  assert.throws(()=>validateProject(project([{id:'sector.farm',version:'1.0.0',functions:['farm.weather',{id:'farm.weather',enabled:false}]}])),{code:'duplicate_id'});
});
