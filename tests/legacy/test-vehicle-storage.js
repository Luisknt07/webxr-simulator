const __layout = require("../../tooling/layout.cjs");
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three'),schema=require('../../modules/logistica-industrial/contracts/behaviors.js'),vehicles=require('../../modules/logistica-industrial/functions/montacargas/schema/vehicles.js');
const dependencies=require('../support/load-robot-prefabs.js')(THREE),read=file=>fs.readFileSync(__layout.map(path.join(__layout.oldDir("scripts/test-vehicle-storage.js"),'..',file)),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const factory=new Function('THREE','behaviorSchema','require',read("modules/logistica-industrial/functions/presentacion/runtime/IndustrialPrefabs.js")+'\nreturn createIndustrialPrefab;')(THREE,schema,dependencies.resolve);
const Document=new Function('THREE','behaviorSchema','createIndustrialPrefab',read("packages/project-model/src/SceneDocument.js").replace('default class SceneDocument','return class SceneDocument'))(THREE,schema,factory);
const {validateDocument}=require('../../apps/api/server/validation.js');
const config=(doc,object)=>doc.getBehaviors(object).find(value=>value.type==='vehicle');
function setup(){const doc=new Document({});doc.registerRoom('hall',new THREE.Group());doc.registerRoom('sound',new THREE.Group());return doc;}
async function run(){const doc=setup(),actors=[];for(const definition of vehicles.VARIANTS){const object=doc.addPrefab('hall','vehicle',definition.id);actors.push(object);assert.equal(config(doc,object).variant,definition.id);assert(object.children[0].userData.vehicleRig);assert(object.children[0].userData.vehicleRig.driverSeat);}
  const actor=actors[1],original=config(doc,actor),revised=Object.assign({},original,{length:2.7,maxLift:5,frameColor:'#2a8a74',wear:.6});const rigBefore=actor.children[0].userData.vehicleRig;
  doc.setBehaviors(actor,[revised]);assert.equal(actor.children[0].userData.vehicleRig.config.length,2.7);assert.notEqual(actor.children[0].userData.vehicleRig,rigBefore);
  const copy=await doc.pasteObject(doc.captureObject(actor),'sound',2);assert.notEqual(copy.userData.editorId,actor.userData.editorId);assert.deepEqual(config(doc,copy),revised);assert.notEqual(copy.children[0].userData.vehicleRig,actor.children[0].userData.vehicleRig);
  const different=Object.assign(vehicles.defaults('telehandler'),{frameColor:'#c77936',maxLift:4.5});doc.setBehaviors(copy,[different]);assert.equal(copy.children[0].userData.vehicleRig.config.family,'telehandler');assert.equal(doc.additions.get(copy.userData.editorId).descriptor.variant,'telehandler');
  const saved=await doc.serialize();assert.doesNotThrow(()=>validateDocument(saved,value=>value));assert(!JSON.stringify(saved).includes('vehicleRig'));assert(!JSON.stringify(saved).includes('matrixWorld'));
  const restored=setup();await restored.load(saved);assert.deepEqual(await restored.serialize(),saved);const object=restored.getObject(copy.userData.editorId);assert.equal(object.children[0].userData.vehicleRig.config.variant,'telehandler');assert.equal(config(restored,object).frameColor,'#c77936');
  console.log('Vehicle storage: all13 actual SceneDocument factories, parametric rebuild, model change, independent cross-room copy, private rig and server-valid lossless save/reopen passed.');}
module.exports={run,setup,config,Document,factory,dependencies,read};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
