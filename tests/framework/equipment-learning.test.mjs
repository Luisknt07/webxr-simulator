import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {commandAuthority} from '../../packages/assistant-core/contracts.js';
const require=createRequire(import.meta.url),learning=require('../../modules/logistica-industrial/functions/presentacion/schema/equipment-learning.js');
const catalog=require('../../modules/logistica-industrial/functions/presentacion/schema/equipment-study.js');
const description=type=>({type,config:{variant:learning.PROFILES[type].id,powered:true,maxLift:4,batteryDrainPerMeter:.015},joints:[{jointId:'J1',unit:'rad',current:.25}]});

test('pilot learning profiles contain complete selectable electronic architectures, not replacement meshes',()=>{
 for(const type of ['robot','vehicle']){const model=learning.describeLearning(description(type)),ids=new Set(model.componentIds);assert(ids.size>=16);assert.equal(model.nodes.length,ids.size);assert.deepEqual(new Set(model.nodes.map(row=>row[0])),ids);for(const [from,to,kind]of model.edges){assert(ids.has(from)&&ids.has(to));assert(['power','signal','safety','mechanical','fluid'].includes(kind));}for(const c of model.components){assert(c.conceptual);assert(c.operation.length>=3);assert(c.signals.length>0&&c.signals.every(s=>s.unit&&s.meaning));assert(c.faults.length>0&&c.faults.every(row=>row.length===3));assert(learning.sourcesFor(c).length>0);assert(!('geometry' in c));}}
 const robot=learning.describeLearning(description('robot'));assert(robot.edges.some(([from,to,kind])=>from==='supply'&&to==='io'&&kind==='power'));assert(!robot.edges.some(([from,to])=>from==='supply'&&to==='drive'),'Control supply must not be drawn as the motor power branch.');
 assert.equal(learning.describeLearning({...description('robot'),config:{variant:'scara-4'}}),null,'A different kinematic family must not inherit a misleading six-axis reference profile.');
});

test('teaching readings distinguish current simulation values, configuration and captured joints without inventing electronics',()=>{
 const desc=description('vehicle'),record={variables:{batteryPercent:73,lift:.42,loadKg:33},components:{vehicle:{actualSpeed:.5}}},before=JSON.stringify(record);
 const battery=learning.valueRows(desc,record,'battery');assert.equal(battery[0].value,73);assert.equal(battery[0].unit,'%');assert.equal(battery[1].from,'config');assert.equal(battery[1].value,.015);
 const traction=learning.valueRows(desc,record,'traction');assert.equal(traction.find(r=>r.key==='actualSpeed').value,.5);assert.equal(traction.find(r=>r.key==='speed').value,null);assert.deepEqual(learning.valueRows(desc,record,'io'),[]);
 record.variables.batteryPercent=72;assert.equal(learning.valueRows(desc,record,'battery')[0].value,72);record.variables.batteryPercent=73;assert.equal(JSON.stringify(record),before);
 const encoder=learning.valueRows(description('robot'),{},'encoder');assert.equal(encoder[0].from,'captured');assert.equal(encoder[0].value,.25);assert.equal(encoder[0].unit,'rad');
});

test('reference URLs and local images reject arbitrary hosts, credentials, traversal and executable sources',()=>{
 for(const value of ['javascript:alert(1)','http://www.kuka.com/test','https://www.kuka.com.evil.invalid/test','https://user:secret@www.kuka.com/test','https://127.0.0.1/test','https://www.kuka.com:8443/test'])assert.equal(learning.safeOfficialURL(value),null);
 for(const value of ['https://www.kuka.com/en-us/products/robotics-systems/industrial-robots/kr-agilus','https://www.catlifttruck.com/','https://cdn.curtisinstruments.com/products/test.pdf'])assert(learning.safeOfficialURL(value));
 const valid='modules/logistica-industrial/assets/study/robot.webp';assert.equal(learning.safeLocalImage(valid),valid);
 for(const value of ['https://www.kuka.com/robot.webp','modules/logistica-industrial/assets/study/../secret.webp','/modules/logistica-industrial/assets/study/robot.webp','modules/logistica-industrial/assets/study/evil.svg','data:image/png;base64,xxx','modules/logistica-industrial/assets/study/%2e%2e/secret.webp'])assert.equal(learning.safeLocalImage(value),null);
 for(const source of Object.values(learning.SOURCES))assert.equal(learning.safeOfficialURL(source.url),source.url);
});

test('generated learning questions confer neither edit authority nor scene navigation',()=>{
 for(const type of ['robot','vehicle'])for(const component of learning.describeLearning(description(type)).components){const query=learning.assistantQuestion(description(type),component),authority=commandAuthority(query);assert.equal(authority.edit,false);assert.equal(authority.navigate,false);assert(query.length<1800);assert(!query.includes('apiKey'));}
});

test('technical sheet reports the actual rendered rig model and fallback, rather than the auto preference',()=>{
 const actor={uuid:'vehicle-model-test',name:'Vehicle test',userData:{editorDefaultBehaviors:[{type:'vehicle',variant:'forklift-electric-4w',visualModel:'auto'}],vehicleRig:{visualModel:'legacy',visualModelFallback:'Configured dimensions exceed this reference body.'}},traverse(visit){visit(this);}},before=JSON.stringify(actor);
 const desc=catalog.describe(actor);assert.equal(desc.config.visualModel,'auto');assert.equal(desc.visual.id,'legacy');assert.equal(desc.visual.fallback,'Configured dimensions exceed this reference body.');assert.equal(JSON.stringify(actor),before);
});
